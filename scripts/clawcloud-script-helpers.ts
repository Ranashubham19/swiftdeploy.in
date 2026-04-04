import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { pickAuthoritativeClawCloudWhatsAppAccount } from "../lib/clawcloud-whatsapp-account-selection";

const DEFAULT_CLAWCLOUD_AUDIT_EMAIL = "clawcloud-audit@swiftdeploy.test";
const DEFAULT_CLAWCLOUD_AUDIT_NAME = "ClawCloud Audit";

type ScriptUserSource =
  | "cli"
  | "env"
  | "env_unverified"
  | "audit_email"
  | "audit_created";

type ResolveSharedUserOptions = {
  cliUserId?: string | null;
  envKeys?: string[];
  auditEmail?: string | null;
  auditName?: string | null;
  allowCreateAuditUser?: boolean;
  requireActiveWhatsApp?: boolean;
};

export type ResolvedClawCloudSharedUser = {
  userId: string;
  source: ScriptUserSource;
  staleConfiguredKeys: string[];
  auditEmail: string | null;
};

function stripOuterQuotes(value: string) {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export function loadEnvFile(filename: string) {
  const filePath = resolve(process.cwd(), filename);
  if (!existsSync(filePath)) {
    return;
  }

  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const splitAt = trimmed.indexOf("=");
    if (splitAt <= 0) {
      continue;
    }

    const key = trimmed.slice(0, splitAt).trim();
    if (!key || process.env[key]) {
      continue;
    }

    const value = stripOuterQuotes(trimmed.slice(splitAt + 1).trim());
    process.env[key] = value;
  }
}

export function loadClawCloudEnv() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function createSupabaseAdminClient() {
  const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function findPublicUserById(userId: string) {
  const supabaseAdmin = createSupabaseAdminClient();
  if (!supabaseAdmin || !userId) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to validate shared QA user ${maskUserId(userId)}: ${error.message}`);
  }

  return data?.id ? String(data.id) : null;
}

async function findPublicUserByEmail(email: string) {
  const supabaseAdmin = createSupabaseAdminClient();
  if (!supabaseAdmin || !email) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id,email")
    .eq("email", email)
    .limit(1);

  if (error) {
    throw new Error(`Unable to look up shared QA user by email ${email}: ${error.message}`);
  }

  return data?.[0]?.id ? String(data[0].id) : null;
}

async function hasActiveWhatsAppAccount(userId: string) {
  const supabaseAdmin = createSupabaseAdminClient();
  if (!supabaseAdmin || !userId) {
    return false;
  }

  const { data, error } = await supabaseAdmin
    .from("connected_accounts")
    .select("phone_number, display_name, is_active, connected_at, last_used_at")
    .eq("user_id", userId)
    .eq("provider", "whatsapp")
    .limit(12);

  if (error) {
    throw new Error(`Unable to inspect WhatsApp linkage for shared QA user ${maskUserId(userId)}: ${error.message}`);
  }

  const preferredAccount = pickAuthoritativeClawCloudWhatsAppAccount(data ?? []);
  return Boolean(preferredAccount?.is_active);
}

async function createAuditUser(email: string, fullName: string) {
  const supabaseAdmin = createSupabaseAdminClient();
  if (!supabaseAdmin) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const created = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      name: fullName,
      full_name: fullName,
    },
    app_metadata: {
      provider: "email",
      providers: ["email"],
      source: "clawcloud_audit",
    },
  });

  if (created.error || !created.data.user?.id) {
    throw new Error(created.error?.message || "Unable to create the shared QA audit user.");
  }

  const userId = String(created.data.user.id);
  const { error: upsertError } = await supabaseAdmin
    .from("users")
    .upsert(
      {
        id: userId,
        email,
        full_name: fullName,
      },
      { onConflict: "id" },
    );

  if (upsertError) {
    throw new Error(`Created audit auth user but could not sync public.users: ${upsertError.message}`);
  }

  return userId;
}

export async function resolveClawCloudSharedUser(
  options: ResolveSharedUserOptions = {},
): Promise<ResolvedClawCloudSharedUser> {
  const envKeys = options.envKeys?.length
    ? options.envKeys
    : ["CLAWCLOUD_AUDIT_USER_ID", "WHATSAPP_AUTO_TEST_USER_ID"];
  const requireActiveWhatsApp = options.requireActiveWhatsApp === true;
  const staleConfiguredKeys: string[] = [];
  const cliUserId = options.cliUserId?.trim() ?? "";
  const auditEmail = (
    options.auditEmail?.trim()
    || process.env.CLAWCLOUD_AUDIT_USER_EMAIL?.trim()
    || DEFAULT_CLAWCLOUD_AUDIT_EMAIL
  ).toLowerCase();
  const auditName = (
    options.auditName?.trim()
    || process.env.CLAWCLOUD_AUDIT_USER_NAME?.trim()
    || DEFAULT_CLAWCLOUD_AUDIT_NAME
  );

  if (cliUserId) {
    if (!isUuid(cliUserId)) {
      throw new Error(`The provided --user value is not a valid UUID: ${cliUserId}`);
    }

    const resolvedCliUserId = await findPublicUserById(cliUserId);
    if (!resolvedCliUserId) {
      throw new Error(`The provided --user value does not exist in public.users: ${cliUserId}`);
    }

    return {
      userId: resolvedCliUserId,
      source: "cli",
      staleConfiguredKeys,
      auditEmail,
    };
  }

  const supabaseAdmin = createSupabaseAdminClient();
  if (!supabaseAdmin) {
    const fallbackUserId = envKeys
      .map((key) => (process.env[key] ?? "").trim())
      .find(Boolean);

    if (fallbackUserId) {
      return {
        userId: fallbackUserId,
        source: "env_unverified",
        staleConfiguredKeys,
        auditEmail,
      };
    }

    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY, and no shared QA user id was configured.",
    );
  }

  for (const key of envKeys) {
    const configuredId = (process.env[key] ?? "").trim();
    if (!configuredId) {
      continue;
    }

    if (!isUuid(configuredId)) {
      staleConfiguredKeys.push(key);
      continue;
    }

    const resolvedConfiguredId = await findPublicUserById(configuredId);
    if (resolvedConfiguredId) {
      if (!requireActiveWhatsApp) {
        return {
          userId: resolvedConfiguredId,
          source: "env",
          staleConfiguredKeys,
          auditEmail,
        };
      }

      if (await hasActiveWhatsAppAccount(resolvedConfiguredId).catch(() => false)) {
        return {
          userId: resolvedConfiguredId,
          source: "env",
          staleConfiguredKeys,
          auditEmail,
        };
      }

      staleConfiguredKeys.push(key);
      continue;
    }

    staleConfiguredKeys.push(key);
  }

  const existingAuditUserId = await findPublicUserByEmail(auditEmail);
  if (existingAuditUserId) {
    if (await hasActiveWhatsAppAccount(existingAuditUserId).catch(() => false)) {
      return {
        userId: existingAuditUserId,
        source: "audit_email",
        staleConfiguredKeys,
        auditEmail,
      };
    }

    return {
      userId: existingAuditUserId,
      source: "audit_email",
      staleConfiguredKeys,
      auditEmail,
    };
  }

  if (!options.allowCreateAuditUser) {
    throw new Error(
      `No valid shared QA user id was found in ${envKeys.join(", ")} and no audit user exists at ${auditEmail}.`,
    );
  }

  const createdAuditUserId = await createAuditUser(auditEmail, auditName);
  return {
    userId: createdAuditUserId,
    source: "audit_created",
    staleConfiguredKeys,
    auditEmail,
  };
}

export function parseFlag(flag: string) {
  return process.argv.includes(flag);
}

export function parseOption(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  const next = process.argv[index + 1];
  return next && !next.startsWith("--") ? next : null;
}

export function writeJsonReport(reportPath: string, payload: unknown) {
  writeFileSync(
    resolve(process.cwd(), reportPath),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

export function maskUserId(value: string) {
  if (!value) {
    return "";
  }

  return value.length <= 8 ? value : `${value.slice(0, 8)}...`;
}

function tryParseJson(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

export function extractLastJsonPayload(raw: string) {
  const direct = tryParseJson(raw);
  if (direct !== null) {
    return direct;
  }

  for (let index = raw.lastIndexOf("{"); index >= 0; index = raw.lastIndexOf("{", index - 1)) {
    const candidate = raw.slice(index).trim();
    const parsed = tryParseJson(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

export function runTsxJsonScript(scriptPath: string, args: string[] = []) {
  const command = process.execPath;
  const cliPath = resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const result = spawnSync(
    command,
    [cliPath, scriptPath, ...args],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
    },
  );

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const json = extractLastJsonPayload(stdout);

  return {
    ok: result.status === 0,
    exitCode: result.status ?? 1,
    stdout,
    stderr,
    json,
  };
}
