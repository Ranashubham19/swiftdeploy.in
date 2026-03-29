import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

function parseEnvValue(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    return "";
  }

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function loadEnvFile(filename) {
  const fullPath = path.join(projectRoot, filename);
  if (!fs.existsSync(fullPath)) {
    return;
  }

  const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key]) {
      continue;
    }

    process.env[key] = parseEnvValue(trimmed.slice(separatorIndex + 1));
  }
}

function getSupabaseUrl() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
}

function maskToken(value) {
  const plaintext = String(value ?? "").trim();
  if (!plaintext) {
    return null;
  }

  if (plaintext.length <= 8) {
    return `${plaintext.slice(0, 2)}***`;
  }

  return `${plaintext.slice(0, 4)}***${plaintext.slice(-4)}`;
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const [{ createClient }, secretBox] = await Promise.all([
    import("@supabase/supabase-js"),
    import("../lib/clawcloud-secret-box.ts"),
  ]);

  const { encryptSecretValue, looksEncryptedSecretValue } = secretBox;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await supabase
    .from("connected_accounts")
    .select("id, user_id, provider, access_token, refresh_token");

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  const summary = {
    scannedRows: rows.length,
    rowsWithTokens: 0,
    updatedRows: 0,
    alreadyEncryptedRows: 0,
    providerUpdates: {},
    preview: [],
  };

  for (const row of rows) {
    const currentAccessToken = typeof row.access_token === "string" ? row.access_token : "";
    const currentRefreshToken = typeof row.refresh_token === "string" ? row.refresh_token : "";
    const hasToken = Boolean(currentAccessToken.trim() || currentRefreshToken.trim());

    if (!hasToken) {
      continue;
    }

    summary.rowsWithTokens += 1;

    const nextAccessToken = currentAccessToken && !looksEncryptedSecretValue(currentAccessToken)
      ? encryptSecretValue(currentAccessToken)
      : currentAccessToken || null;
    const nextRefreshToken = currentRefreshToken && !looksEncryptedSecretValue(currentRefreshToken)
      ? encryptSecretValue(currentRefreshToken)
      : currentRefreshToken || null;

    const changed = nextAccessToken !== (currentAccessToken || null)
      || nextRefreshToken !== (currentRefreshToken || null);

    if (!changed) {
      summary.alreadyEncryptedRows += 1;
      continue;
    }

    const { error: updateError } = await supabase
      .from("connected_accounts")
      .update({
        access_token: nextAccessToken,
        refresh_token: nextRefreshToken,
      })
      .eq("id", row.id);

    if (updateError) {
      throw updateError;
    }

    summary.updatedRows += 1;
    const provider = String(row.provider ?? "unknown");
    summary.providerUpdates[provider] = (summary.providerUpdates[provider] ?? 0) + 1;
    if (summary.preview.length < 10) {
      summary.preview.push({
        id: row.id,
        userId: row.user_id,
        provider,
        accessToken: maskToken(currentAccessToken),
        refreshToken: maskToken(currentRefreshToken),
      });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
