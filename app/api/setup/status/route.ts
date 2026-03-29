import { NextRequest, NextResponse } from "next/server";

import { listGlobalLiteConnections } from "@/lib/clawcloud-global-lite";
import type { ClawCloudSetupStatusSnapshot } from "@/lib/clawcloud-setup-status";
import {
  getClawCloudErrorMessage,
  getClawCloudSupabaseAdmin,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";
import {
  ensureClawCloudWhatsAppWorkspaceReady,
  getClawCloudWhatsAppRuntimeStatus,
} from "@/lib/clawcloud-whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SETUP_STATUS_GLOBAL_LITE_TIMEOUT_MS = 700;
const SETUP_STATUS_WHATSAPP_RUNTIME_TIMEOUT_MS = 1_200;

function withNoStoreHeaders(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

function withTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number) {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, timeoutMs);

    promise
      .then((value) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        resolve(value);
      })
      .catch(() => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        resolve(fallback);
      });
  });
}

export async function GET(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return withNoStoreHeaders(
      NextResponse.json({ error: auth.error }, { status: auth.status }),
    );
  }

  try {
    const supabaseAdmin = getClawCloudSupabaseAdmin();
    const [{ data, error }, globalLiteConnections, whatsAppRuntime] = await Promise.all([
      supabaseAdmin
        .from("connected_accounts")
        .select(
          "provider, account_email, phone_number, display_name, is_active, connected_at, last_used_at",
        )
        .eq("user_id", auth.user.id)
        .order("provider", { ascending: true }),
      withTimeout(
        listGlobalLiteConnections(auth.user.id).catch(() => []),
        [],
        SETUP_STATUS_GLOBAL_LITE_TIMEOUT_MS,
      ),
      withTimeout(
        getClawCloudWhatsAppRuntimeStatus(auth.user.id).catch(() => null),
        null,
        SETUP_STATUS_WHATSAPP_RUNTIME_TIMEOUT_MS,
      ),
    ]);

    if (error) {
      throw new Error(error.message);
    }

    const connectedAccounts = (data ?? []) as NonNullable<
      ClawCloudSetupStatusSnapshot["connected_accounts"]
    >;
    const activeWhatsAppAccount = connectedAccounts.find(
      (account) => account.provider === "whatsapp" && account.is_active,
    );

    const whatsappConnected = typeof whatsAppRuntime?.connected === "boolean"
      ? whatsAppRuntime.connected
      : Boolean(activeWhatsAppAccount);

    if (whatsappConnected) {
      void ensureClawCloudWhatsAppWorkspaceReady(auth.user.id).catch(() => null);
    }

    const payload: ClawCloudSetupStatusSnapshot & {
      user: { id: string; email: string | null };
    } = {
      user: {
        id: auth.user.id,
        email: auth.user.email ?? null,
      },
      connected_accounts: connectedAccounts,
      global_lite_connections: globalLiteConnections,
      whatsapp_connected: whatsappConnected,
      whatsapp_phone: whatsAppRuntime?.phone ?? activeWhatsAppAccount?.phone_number ?? null,
      whatsapp_runtime: whatsAppRuntime,
    };

    return withNoStoreHeaders(NextResponse.json(payload));
  } catch (error) {
    return withNoStoreHeaders(
      NextResponse.json(
        { error: getClawCloudErrorMessage(error) },
        { status: 500 },
      ),
    );
  }
}
