import { env } from "@/lib/env";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";

function getAgentServerBaseUrl() {
  return env.AGENT_SERVER_URL || "";
}

function assertAgentServerConfigured() {
  if (!getAgentServerBaseUrl() || !env.AGENT_SECRET) {
    throw new Error("WhatsApp agent server requires AGENT_SERVER_URL and AGENT_SECRET.");
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

export async function requestClawCloudWhatsAppQr(userId: string) {
  const response = await agentServerFetch(`/wa/qr/${userId}`, {
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

export async function sendClawCloudWhatsAppToPhone(phone: string, message: string) {
  const response = await agentServerFetch("/wa/send", {
    method: "POST",
    body: JSON.stringify({ phone, message }),
  });

  const json = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(json.error || "Failed to send WhatsApp message.");
  }

  return true;
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

    await sendClawCloudWhatsAppToPhone(account.phone_number, message);
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
