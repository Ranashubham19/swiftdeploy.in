import { env } from "@/lib/env";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name?: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
    date: number;
  };
};

function getTelegramBotToken() {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set.");
  }

  return env.TELEGRAM_BOT_TOKEN;
}

async function sendTelegramApiMessage(chatId: string, text: string) {
  const token = getTelegramBotToken();
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
    }),
  });

  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as { description?: string };
    throw new Error(json.description || "Telegram sendMessage failed.");
  }
}

export async function sendClawCloudTelegramMessage(userId: string, text: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data: account } = await supabaseAdmin
    .from("connected_accounts")
    .select("account_email")
    .eq("user_id", userId)
    .eq("provider", "telegram")
    .eq("is_active", true)
    .maybeSingle();

  if (!account?.account_email) {
    throw new Error(`Telegram is not connected for user ${userId}.`);
  }

  await sendTelegramApiMessage(account.account_email, text);
}

export async function handleTelegramUpdate(update: TelegramUpdate) {
  const message = update.message;
  if (!message?.text) {
    return;
  }

  const chatId = String(message.chat.id);
  const text = message.text.trim();
  const supabaseAdmin = getClawCloudSupabaseAdmin();

  const startMatch = text.match(/^\/start\s+([a-zA-Z0-9_-]{10,})/);
  if (startMatch) {
    const userId = startMatch[1];

    await supabaseAdmin.from("connected_accounts").upsert(
      {
        user_id: userId,
        provider: "telegram",
        account_email: chatId,
        display_name: message.from?.first_name ?? "Telegram user",
        access_token: null,
        refresh_token: null,
        token_expiry: null,
        is_active: true,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    );

    await sendTelegramApiMessage(
      chatId,
      "ClawCloud connected. You can now receive your briefings and send commands here.",
    );
    return;
  }

  const { data: account } = await supabaseAdmin
    .from("connected_accounts")
    .select("user_id")
    .eq("provider", "telegram")
    .eq("account_email", chatId)
    .eq("is_active", true)
    .maybeSingle();

  if (!account?.user_id) {
    await sendTelegramApiMessage(
      chatId,
      "This Telegram account is not linked yet. Reconnect it from ClawCloud settings.",
    );
    return;
  }

  const { routeInboundAgentMessage } = await import("@/lib/clawcloud-agent");
  const response = await routeInboundAgentMessage(account.user_id, text);

  if (response) {
    await sendTelegramApiMessage(chatId, response);
  }
}

export function buildTelegramConnectUrl(userId: string) {
  const botUsername = env.TELEGRAM_BOT_USERNAME || "ClawCloudBot";
  return `https://t.me/${botUsername}?start=${userId}`;
}

export async function setTelegramWebhook(webhookUrl: string) {
  const token = getTelegramBotToken();
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET || undefined,
    }),
  });

  const json = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
  };

  if (!response.ok || !json.ok) {
    throw new Error(json.description || "Failed to set Telegram webhook.");
  }
}
