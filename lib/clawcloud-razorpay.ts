import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { env } from "@/lib/env";

type PaidPlan = "starter" | "pro";
type BillingPeriod = "monthly" | "annual";

export type RazorpayWebhookEvent = {
  event: string;
  payload: {
    subscription?: {
      entity: {
        id: string;
        plan_id: string;
        status: string;
        current_start: number | null;
        current_end: number | null;
        notes?: { userId?: string; plan?: string };
      };
    };
  };
};

const razorpayPlans: Record<PaidPlan, Record<BillingPeriod, string>> = {
  starter: {
    monthly: env.RAZORPAY_PLAN_STARTER_MONTHLY || "plan_REPLACE_STARTER_MONTHLY",
    annual: env.RAZORPAY_PLAN_STARTER_ANNUAL || "plan_REPLACE_STARTER_ANNUAL",
  },
  pro: {
    monthly: env.RAZORPAY_PLAN_PRO_MONTHLY || "plan_REPLACE_PRO_MONTHLY",
    annual: env.RAZORPAY_PLAN_PRO_ANNUAL || "plan_REPLACE_PRO_ANNUAL",
  },
};

function getRazorpayAuth() {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new Error("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required.");
  }

  return `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64")}`;
}

async function razorpayPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: getRazorpayAuth(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json().catch(() => ({}))) as T & {
    error?: { description?: string };
  };

  if (!response.ok) {
    throw new Error(json.error?.description || `Razorpay ${path} failed.`);
  }

  return json;
}

export async function createRazorpaySubscription(input: {
  userId: string;
  userEmail: string;
  userPhone?: string;
  plan: PaidPlan;
  period: BillingPeriod;
}) {
  const planId = razorpayPlans[input.plan][input.period];
  const subscription = await razorpayPost<{ id: string; short_url: string }>(
    "subscriptions",
    {
      plan_id: planId,
      total_count: input.period === "annual" ? 12 : 120,
      quantity: 1,
      notify_info: {
        notify_email: input.userEmail,
        notify_phone: input.userPhone || null,
      },
      notes: {
        userId: input.userId,
        plan: input.plan,
      },
      addons: [],
    },
  );

  return {
    subscriptionId: subscription.id,
    paymentUrl: subscription.short_url,
  };
}

export async function verifyRazorpayWebhookSignature(rawBody: string, signature: string) {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return true;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const computed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const computedHex = Array.from(new Uint8Array(computed))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return computedHex === signature;
}

function planFromRazorpayPlanId(planId: string): PaidPlan {
  const proIds = Object.values(razorpayPlans.pro);
  return proIds.includes(planId) ? "pro" : "starter";
}

export async function syncRazorpaySubscription(event: RazorpayWebhookEvent) {
  const subscription = event.payload.subscription?.entity;
  if (!subscription) {
    return;
  }

  const userId = subscription.notes?.userId;
  if (!userId) {
    return;
  }

  const supabase = getClawCloudSupabaseAdmin();
  const plan = planFromRazorpayPlanId(subscription.plan_id);
  const isActive = ["active", "authenticated", "created"].includes(subscription.status);
  const subscriptionPlan = isActive ? plan : "free";
  const subscriptionStatus = isActive ? subscription.status : "cancelled";

  await supabase.from("subscriptions").upsert(
    {
      user_id: userId,
      plan: subscriptionPlan,
      status: subscriptionStatus,
      razorpay_sub_id: subscription.id,
      current_period_start: subscription.current_start
        ? new Date(subscription.current_start * 1000).toISOString()
        : null,
      current_period_end: subscription.current_end
        ? new Date(subscription.current_end * 1000).toISOString()
        : null,
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  await supabase.from("users").update({ plan: subscriptionPlan }).eq("id", userId);
}
