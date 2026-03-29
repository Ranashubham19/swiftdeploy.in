import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";

export type BillingWebhookProvider = "stripe" | "razorpay";
export type BillingWebhookStatus = "pending" | "processing" | "processed" | "failed";

type BillingWebhookInboxRow = {
  id: string;
  provider: BillingWebhookProvider;
  external_event_id: string;
  event_type: string;
  user_id: string | null;
  status: BillingWebhookStatus;
  payload: Record<string, unknown>;
  signature_verified: boolean;
  attempts: number;
  first_seen_at: string;
  last_seen_at: string;
  processed_at: string | null;
  failure_reason: string | null;
  updated_at: string;
};

type RegisterBillingWebhookInput = {
  provider: BillingWebhookProvider;
  externalEventId: string;
  eventType: string;
  userId?: string | null;
  payload: Record<string, unknown>;
  signatureVerified: boolean;
};

type BillingWebhookBeginResult =
  | { action: "process"; record: BillingWebhookInboxRow }
  | { action: "duplicate"; record: BillingWebhookInboxRow }
  | { action: "in_progress"; record: BillingWebhookInboxRow };

const BILLING_FAILURE_REASON_LIMIT = 600;
const BILLING_WEBHOOK_PROCESSING_LEASE_MS = 10 * 60 * 1000;
const BILLING_WEBHOOK_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function trimBillingFailureReason(reason: string) {
  const normalized = reason.trim();
  if (normalized.length <= BILLING_FAILURE_REASON_LIMIT) {
    return normalized;
  }

  return `${normalized.slice(0, BILLING_FAILURE_REASON_LIMIT - 3)}...`;
}

async function readBillingWebhookRecord(
  provider: BillingWebhookProvider,
  externalEventId: string,
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("billing_webhook_events")
    .select("*")
    .eq("provider", provider)
    .eq("external_event_id", externalEventId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? null) as BillingWebhookInboxRow | null;
}

async function upsertBillingWebhookRecord(
  input: RegisterBillingWebhookInput,
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const existing = await readBillingWebhookRecord(input.provider, input.externalEventId);
  const now = new Date().toISOString();
  const existingUpdatedAt = existing ? new Date(existing.updated_at).getTime() : Number.NaN;
  const wasStaleProcessing =
    existing?.status === "processing"
    && Number.isFinite(existingUpdatedAt)
    && Date.now() - existingUpdatedAt > BILLING_WEBHOOK_PROCESSING_LEASE_MS;

  if (!existing) {
    const { data, error } = await supabaseAdmin
      .from("billing_webhook_events")
      .insert({
        provider: input.provider,
        external_event_id: input.externalEventId,
        event_type: input.eventType,
        user_id: input.userId ?? null,
        status: "pending",
        payload: input.payload,
        signature_verified: input.signatureVerified,
        attempts: 1,
        first_seen_at: now,
        last_seen_at: now,
      })
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return {
      record: data as BillingWebhookInboxRow,
      wasStaleProcessing: false,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("billing_webhook_events")
    .update({
      event_type: input.eventType,
      user_id: input.userId ?? existing.user_id ?? null,
      payload: input.payload,
      signature_verified: existing.signature_verified || input.signatureVerified,
      attempts: Math.max(Number(existing.attempts ?? 1) + 1, 2),
      last_seen_at: now,
    })
    .eq("id", existing.id)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return {
    record: data as BillingWebhookInboxRow,
    wasStaleProcessing,
  };
}

export function normalizeBillingWebhookUserId(userId?: string | null) {
  const value = userId?.trim();
  if (!value) {
    return null;
  }

  return BILLING_WEBHOOK_UUID_RE.test(value) ? value : null;
}

export async function buildBillingWebhookPayloadHash(rawBody: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawBody),
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function resolveStripeWebhookEventId(
  eventId: string | undefined,
  rawBody: string,
) {
  const normalized = eventId?.trim();
  if (normalized) {
    return normalized;
  }

  return `stripe-body-${await buildBillingWebhookPayloadHash(rawBody)}`;
}

export async function resolveRazorpayWebhookEventId(
  headerEventId: string | null,
  rawBody: string,
) {
  const normalized = headerEventId?.trim();
  if (normalized) {
    return normalized;
  }

  return `razorpay-body-${await buildBillingWebhookPayloadHash(rawBody)}`;
}

export async function beginBillingWebhookProcessing(
  input: RegisterBillingWebhookInput,
): Promise<BillingWebhookBeginResult> {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { record, wasStaleProcessing } = await upsertBillingWebhookRecord(input);

  if (record.status === "processed") {
    return { action: "duplicate", record };
  }

  if (record.status === "processing" && !wasStaleProcessing) {
    return { action: "in_progress", record };
  }

  const { data, error } = await supabaseAdmin
    .from("billing_webhook_events")
    .update({
      status: "processing",
      failure_reason: null,
    })
    .eq("id", record.id)
    .in(
      "status",
      wasStaleProcessing ? ["pending", "failed", "processing"] : ["pending", "failed"],
    )
    .select("*")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (data) {
    return { action: "process", record: data as BillingWebhookInboxRow };
  }

  const latest = await readBillingWebhookRecord(input.provider, input.externalEventId);
  if (!latest) {
    throw new Error("Billing webhook record disappeared before processing.");
  }

  if (latest.status === "processed") {
    return { action: "duplicate", record: latest };
  }

  return { action: "in_progress", record: latest };
}

export async function markBillingWebhookProcessed(
  provider: BillingWebhookProvider,
  externalEventId: string,
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from("billing_webhook_events")
    .update({
      status: "processed",
      processed_at: new Date().toISOString(),
      failure_reason: null,
    })
    .eq("provider", provider)
    .eq("external_event_id", externalEventId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function markBillingWebhookFailed(
  provider: BillingWebhookProvider,
  externalEventId: string,
  errorMessage: string,
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from("billing_webhook_events")
    .update({
      status: "failed",
      processed_at: null,
      failure_reason: trimBillingFailureReason(errorMessage),
    })
    .eq("provider", provider)
    .eq("external_event_id", externalEventId);

  if (error) {
    throw new Error(error.message);
  }
}
