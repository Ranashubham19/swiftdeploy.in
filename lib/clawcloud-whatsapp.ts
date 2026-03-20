import { env } from "@/lib/env";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";

type LocalWhatsAppResolveResult = {
  name: string;
  phone: string | null;
  jid: string | null;
};

type LocalWhatsAppRuntime = {
  send?: (input: {
    userId?: string | null;
    phone?: string | null;
    jid?: string | null;
    message: string;
    contactName?: string | null;
  }) => Promise<boolean>;
  resolveContact?: (input: {
    userId: string;
    contactName: string;
  }) => Promise<LocalWhatsAppResolveResult | null>;
};

let localWhatsAppRuntime: LocalWhatsAppRuntime | null = null;

export function registerClawCloudWhatsAppRuntime(runtime: LocalWhatsAppRuntime) {
  localWhatsAppRuntime = runtime;
}

function normalizeAgentServerUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function getAgentServerBaseUrl() {
  const explicit = normalizeAgentServerUrl(env.AGENT_SERVER_URL);
  if (explicit) {
    return explicit;
  }

  const backendApi = normalizeAgentServerUrl(env.BACKEND_API_URL);
  if (backendApi) {
    return backendApi;
  }

  return "";
}

function assertAgentServerConfigured() {
  if (!getAgentServerBaseUrl() || !env.AGENT_SECRET) {
    throw new Error(
      "WhatsApp agent server requires AGENT_SERVER_URL (or BACKEND_API_URL) and AGENT_SECRET.",
    );
  }
}

async function agentServerFetch(path: string, init: RequestInit = {}) {
  assertAgentServerConfigured();

  const response = await fetch(`${getAgentServerBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.AGENT_SECRET}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  return response;
}

export async function getClawCloudWhatsAppAccount(userId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("connected_accounts")
    .select("phone_number, display_name, is_active")
    .eq("user_id", userId)
    .eq("provider", "whatsapp")
    .single();

  if (error || !data) {
    return null;
  }

  return data as {
    phone_number: string | null;
    display_name: string | null;
    is_active: boolean;
  };
}

export async function requestClawCloudWhatsAppQr(
  userId: string,
  options?: { forceRefresh?: boolean },
) {
  const refreshQuery = options?.forceRefresh ? "?refresh=1" : "";
  const response = await agentServerFetch(`/wa/qr/${userId}${refreshQuery}`, {
    method: "GET",
  });

  const json = (await response.json()) as {
    qr?: string;
    status?: string;
    phone?: string | null;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(json.error || "Unable to start WhatsApp connection.");
  }

  return json;
}

export async function disconnectClawCloudWhatsApp(userId: string) {
  const response = await agentServerFetch(`/wa/session/${userId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error || "Unable to disconnect WhatsApp.");
  }

  return true;
}

export async function sendClawCloudWhatsAppToPhone(
  phone: string | null,
  message: string,
  options?: { userId?: string; contactName?: string | null; jid?: string | null },
) {
  if (!getAgentServerBaseUrl() || !env.AGENT_SECRET) {
    if (localWhatsAppRuntime?.send) {
      const ok = await localWhatsAppRuntime.send({
        userId: options?.userId ?? null,
        phone,
        jid: options?.jid ?? null,
        message,
        contactName: options?.contactName ?? null,
      });
      if (!ok) {
        throw new Error("Failed to send WhatsApp message.");
      }
      return true;
    }
  }

  const response = await agentServerFetch("/wa/send", {
    method: "POST",
    body: JSON.stringify({
      phone: phone ?? null,
      jid: options?.jid ?? null,
      message,
      userId: options?.userId ?? null,
      contactName: options?.contactName ?? null,
    }),
  });

  const json = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(json.error || "Failed to send WhatsApp message.");
  }

  return true;
}

export async function resolveClawCloudWhatsAppContact(userId: string, contactName: string) {
  if (!getAgentServerBaseUrl() || !env.AGENT_SECRET) {
    if (localWhatsAppRuntime?.resolveContact) {
      return localWhatsAppRuntime.resolveContact({ userId, contactName });
    }
  }

  const response = await agentServerFetch("/wa/resolve-contact", {
    method: "POST",
    body: JSON.stringify({
      userId,
      contactName,
    }),
  });

  if (response.status === 404) {
    return null;
  }

  const json = (await response.json().catch(() => ({}))) as {
    error?: string;
    name?: string;
    phone?: string | null;
    jid?: string | null;
  };

  if (!response.ok) {
    throw new Error(json.error || "Failed to resolve WhatsApp contact.");
  }

  if (!json.name || !json.phone) {
    return null;
  }

  return {
    name: json.name,
    phone: json.phone ?? null,
    jid: json.jid ?? null,
  };
}

export async function sendClawCloudWhatsAppMessage(userId: string, message: string) {
  const primaryResponse = await agentServerFetch(`/wa/send-user/${encodeURIComponent(userId)}`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
  let shouldLogLocally = false;

  if (!primaryResponse.ok) {
    const account = await getClawCloudWhatsAppAccount(userId);
    if (!account?.phone_number) {
      return false;
    }

    await sendClawCloudWhatsAppToPhone(account.phone_number, message, { userId });
    shouldLogLocally = true;
  }

  if (shouldLogLocally) {
    const supabaseAdmin = getClawCloudSupabaseAdmin();
    await supabaseAdmin.from("whatsapp_messages").insert({
      user_id: userId,
      direction: "outbound",
      content: message,
      message_type: "text",
      sent_at: new Date().toISOString(),
    });
  }

  return true;
}
