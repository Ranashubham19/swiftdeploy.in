import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { isClawCloudMissingSchemaMessage } from "@/lib/clawcloud-schema-compat";

export type GlobalLiteProvider = "gmail" | "google_calendar" | "google_drive";
export type GlobalLiteMode = "gmail_capture" | "calendar_ics" | "drive_uploads";

export type GlobalLiteConnection = {
  provider: GlobalLiteProvider;
  mode: GlobalLiteMode;
  label: string | null;
  config: Record<string, unknown>;
  is_active: boolean;
  connected_at: string | null;
  updated_at: string | null;
};

export type GlobalLiteUpsertInput =
  | {
      provider: "gmail";
      email: string;
      label?: string | null;
    }
  | {
      provider: "google_calendar";
      icsUrl: string;
      label?: string | null;
    }
  | {
      provider: "google_drive";
      label?: string | null;
    };

const GLOBAL_LITE_TABLE = "global_lite_connections";
const LEGACY_THREAD_PREFIX = "global-lite";
const GLOBAL_LITE_PROVIDERS: GlobalLiteProvider[] = [
  "gmail",
  "google_calendar",
  "google_drive",
];

export function isGlobalLiteProvider(value: string): value is GlobalLiteProvider {
  return GLOBAL_LITE_PROVIDERS.includes(value as GlobalLiteProvider);
}

function isMissingRelationError(message: string) {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("could not find the table")
    || (normalized.includes("relation") && normalized.includes("does not exist"))
    || (normalized.includes("table") && normalized.includes("does not exist"))
    || normalized.includes("schema cache")
  );
}

function buildLegacyRowId(userId: string, provider: GlobalLiteProvider) {
  return `${LEGACY_THREAD_PREFIX}:${userId}:${provider}`;
}

function normalizeLabel(value: unknown) {
  const normalized = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return normalized ? normalized.slice(0, 120) : null;
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeHttpsUrl(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:") {
      return "";
    }

    return url.toString();
  } catch {
    return "";
  }
}

function normalizeConfig(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {} as Record<string, unknown>;
  }

  return value as Record<string, unknown>;
}

function defaultLabelForProvider(provider: GlobalLiteProvider) {
  switch (provider) {
    case "gmail":
      return "Gmail Lite";
    case "google_calendar":
      return "Calendar Lite";
    case "google_drive":
      return "Drive Lite";
  }
}

function defaultModeForProvider(provider: GlobalLiteProvider): GlobalLiteMode {
  switch (provider) {
    case "gmail":
      return "gmail_capture";
    case "google_calendar":
      return "calendar_ics";
    case "google_drive":
      return "drive_uploads";
  }
}

function titleForProvider(provider: GlobalLiteProvider) {
  switch (provider) {
    case "gmail":
      return "Global Lite Gmail";
    case "google_calendar":
      return "Global Lite Calendar";
    case "google_drive":
      return "Global Lite Drive";
  }
}

function normalizeConnectionRecord(row: Record<string, unknown>): GlobalLiteConnection {
  const provider = isGlobalLiteProvider(String(row.provider ?? ""))
    ? (String(row.provider) as GlobalLiteProvider)
    : "gmail";

  const mode = String(row.mode ?? defaultModeForProvider(provider)) as GlobalLiteMode;

  return {
    provider,
    mode,
    label: normalizeLabel(row.label) ?? defaultLabelForProvider(provider),
    config: normalizeConfig(row.config),
    is_active: row.is_active !== false,
    connected_at: typeof row.connected_at === "string" ? row.connected_at : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}

function connectionToLegacyPayload(connection: GlobalLiteConnection) {
  return {
    kind: "global_lite_connection",
    provider: connection.provider,
    mode: connection.mode,
    label: connection.label,
    config: connection.config,
    is_active: connection.is_active,
    connected_at: connection.connected_at,
    updated_at: connection.updated_at,
  };
}

function connectionFromLegacyPayload(payload: unknown): GlobalLiteConnection | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (record.kind !== "global_lite_connection") {
    return null;
  }

  return normalizeConnectionRecord(record);
}

export function describeGlobalLiteConnection(connection: GlobalLiteConnection) {
  switch (connection.provider) {
    case "gmail": {
      const email = normalizeEmail(connection.config.email);
      return email
        ? `Gmail Lite is ready for ${email}. Use imported or forwarded email snapshots whenever full Google Workspace OAuth is unavailable on this deployment.`
        : "Gmail Lite is enabled. Use imported or forwarded email snapshots whenever full Google Workspace OAuth is unavailable on this deployment.";
    }
    case "google_calendar": {
      const icsUrl = normalizeHttpsUrl(connection.config.icsUrl);
      if (!icsUrl) {
        return "Calendar Lite is enabled, but the private ICS feed still needs to be saved.";
      }

      return "Calendar Lite is linked with a private ICS feed for agenda, reminders, and read-only schedule context.";
    }
    case "google_drive":
      return "Drive Lite is enabled in upload and shared-doc mode for global users when full Google Drive OAuth is unavailable on this deployment.";
  }
}

export function validateGlobalLiteUpsertInput(input: GlobalLiteUpsertInput): GlobalLiteConnection {
  const provider = input.provider;
  const now = new Date().toISOString();

  if (provider === "gmail") {
    const email = normalizeEmail(input.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Enter a valid email address for Gmail Lite.");
    }

    return {
      provider,
      mode: "gmail_capture",
      label: normalizeLabel(input.label) ?? defaultLabelForProvider(provider),
      config: { email },
      is_active: true,
      connected_at: now,
      updated_at: now,
    };
  }

  if (provider === "google_calendar") {
    const icsUrl = normalizeHttpsUrl(input.icsUrl);
    if (!icsUrl) {
      throw new Error("Enter a valid private ICS calendar link.");
    }

    return {
      provider,
      mode: "calendar_ics",
      label: normalizeLabel(input.label) ?? defaultLabelForProvider(provider),
      config: { icsUrl },
      is_active: true,
      connected_at: now,
      updated_at: now,
    };
  }

  return {
    provider,
    mode: "drive_uploads",
    label: normalizeLabel(input.label) ?? defaultLabelForProvider(provider),
    config: {},
    is_active: true,
    connected_at: now,
    updated_at: now,
  };
}

async function listLegacyGlobalLiteConnections(userId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("chat_threads")
    .select("id, active_result")
    .eq("user_id", userId)
    .like("id", `${LEGACY_THREAD_PREFIX}:${userId}:%`);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? [])
    .map((row: Record<string, unknown>) => connectionFromLegacyPayload(row.active_result))
    .filter((value): value is GlobalLiteConnection => Boolean(value))
    .filter((connection) => connection.is_active);
}

export async function listGlobalLiteConnections(userId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from(GLOBAL_LITE_TABLE)
    .select("provider, mode, label, config, is_active, connected_at, updated_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("provider", { ascending: true });

  if (error) {
    if (isMissingRelationError(error.message) || isClawCloudMissingSchemaMessage(error.message)) {
      return listLegacyGlobalLiteConnections(userId);
    }

    throw new Error(error.message);
  }

  return (data ?? []).map((row: Record<string, unknown>) => normalizeConnectionRecord(row));
}

async function upsertLegacyGlobalLiteConnection(userId: string, connection: GlobalLiteConnection) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const payload = {
    id: buildLegacyRowId(userId, connection.provider),
    user_id: userId,
    title: titleForProvider(connection.provider),
    updated_at: connection.updated_at,
    messages: [],
    progress: [],
    sources: [],
    active_result: connectionToLegacyPayload(connection),
  };

  const { error } = await supabaseAdmin.from("chat_threads").upsert(payload);
  if (error) {
    throw new Error(error.message);
  }

  return connection;
}

export async function upsertGlobalLiteConnection(
  userId: string,
  input: GlobalLiteUpsertInput,
) {
  const connection = validateGlobalLiteUpsertInput(input);
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const payload = {
    user_id: userId,
    provider: connection.provider,
    mode: connection.mode,
    label: connection.label,
    config: connection.config,
    is_active: true,
    connected_at: connection.connected_at,
    updated_at: connection.updated_at,
  };

  const { error } = await supabaseAdmin
    .from(GLOBAL_LITE_TABLE)
    .upsert(payload, { onConflict: "user_id,provider" });

  if (error) {
    if (isMissingRelationError(error.message) || isClawCloudMissingSchemaMessage(error.message)) {
      return upsertLegacyGlobalLiteConnection(userId, connection);
    }

    throw new Error(error.message);
  }

  return connection;
}

async function deleteLegacyGlobalLiteConnection(userId: string, provider: GlobalLiteProvider) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from("chat_threads")
    .delete()
    .eq("id", buildLegacyRowId(userId, provider));

  if (error) {
    throw new Error(error.message);
  }
}

export async function deleteGlobalLiteConnection(
  userId: string,
  provider: GlobalLiteProvider,
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from(GLOBAL_LITE_TABLE)
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider);

  if (error) {
    if (isMissingRelationError(error.message) || isClawCloudMissingSchemaMessage(error.message)) {
      await deleteLegacyGlobalLiteConnection(userId, provider);
      return;
    }

    throw new Error(error.message);
  }
}
