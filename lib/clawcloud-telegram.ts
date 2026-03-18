import { env } from "@/lib/env";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";

type TelegramMessage = {
  message_id: number;
  from?: { id: number; first_name?: string; username?: string };
  chat: { id: number; type: string };
  text?: string;
  caption?: string;
  voice?: { file_id: string; duration: number; mime_type?: string };
  document?: { file_id: string; file_name?: string; mime_type?: string };
  photo?: Array<{ file_id: string; width: number; height: number }>;
  sticker?: { file_id: string };
  location?: { latitude: number; longitude: number };
  date: number;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

function getTelegramBotToken() {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set.");
  }

  return env.TELEGRAM_BOT_TOKEN;
}

async function callTelegramApi(method: string, body: Record<string, unknown>) {
  const token = getTelegramBotToken();
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    description?: string;
  };

  if (!response.ok || json.ok === false) {
    throw new Error(json.description || `Telegram ${method} failed.`);
  }
}

async function sendTelegramApiMessage(chatId: string, text: string) {
  await callTelegramApi("sendMessage", {
    chat_id: chatId,
    text,
  });
}

async function sendTelegramChatAction(chatId: string, action: "typing") {
  await callTelegramApi("sendChatAction", {
    chat_id: chatId,
    action,
  }).catch(() => null);
}

async function getTelegramLinkedAccount(chatId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();

  const { data: primary } = await supabaseAdmin
    .from("connected_accounts")
    .select("user_id")
    .eq("provider", "telegram")
    .eq("account_email", chatId)
    .eq("is_active", true)
    .maybeSingle();

  if (primary?.user_id) {
    return primary;
  }

  const { data: secondary } = await supabaseAdmin
    .from("connected_accounts")
    .select("user_id")
    .eq("provider", "telegram")
    .eq("phone_number", chatId)
    .eq("is_active", true)
    .maybeSingle();

  return secondary ?? null;
}

export async function sendClawCloudTelegramMessage(userId: string, text: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data: account } = await supabaseAdmin
    .from("connected_accounts")
    .select("account_email, phone_number")
    .eq("user_id", userId)
    .eq("provider", "telegram")
    .eq("is_active", true)
    .maybeSingle();

  const chatId = account?.account_email || account?.phone_number;
  if (!chatId) {
    throw new Error(`Telegram is not connected for user ${userId}.`);
  }

  await sendTelegramApiMessage(chatId, text);
}

function buildLocationPrompt(location: { latitude: number; longitude: number }) {
  return `Tell me about this location and what is nearby: coordinates ${location.latitude}, ${location.longitude}. Include useful local context.`;
}

export async function handleTelegramUpdate(update: TelegramUpdate) {
  const message = update.message ?? update.edited_message;
  if (!message) {
    return;
  }

  const chatId = String(message.chat.id);
  const text = message.text?.trim() ?? "";
  const supabaseAdmin = getClawCloudSupabaseAdmin();

  const startMatch = text.match(/^\/start\s+([a-zA-Z0-9_-]{10,})/);
  if (startMatch) {
    const userId = startMatch[1];

    await supabaseAdmin.from("connected_accounts").upsert(
      {
        user_id: userId,
        provider: "telegram",
        account_email: chatId,
        phone_number: chatId,
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
      "ClawCloud connected. You can now send commands here and receive your briefings.",
    );
    return;
  }

  const linkedAccount = await getTelegramLinkedAccount(chatId);
  if (!linkedAccount?.user_id) {
    await sendTelegramApiMessage(
      chatId,
      "This Telegram account is not linked yet. Reconnect it from ClawCloud settings.",
    );
    return;
  }

  const { routeInboundAgentMessage } = await import("@/lib/clawcloud-agent");

  if (text) {
    await sendTelegramChatAction(chatId, "typing");
    const response = await routeInboundAgentMessage(linkedAccount.user_id, text).catch(() => null);
    if (response) {
      await sendTelegramApiMessage(chatId, response);
    }
    return;
  }

  if (message.location) {
    await sendTelegramChatAction(chatId, "typing");
    const response = await routeInboundAgentMessage(
      linkedAccount.user_id,
      buildLocationPrompt(message.location),
    ).catch(() => null);
    if (response) {
      await sendTelegramApiMessage(chatId, response);
    }
    return;
  }

  if (message.voice) {
    await sendTelegramApiMessage(
      chatId,
      "Voice messages are not supported on Telegram yet. Please type your question for now.",
    );
    return;
  }

  if (message.document) {
    await sendTelegramApiMessage(
      chatId,
      "Document uploads on Telegram are coming soon. For now, send the document on WhatsApp.",
    );
    return;
  }

  if (message.photo?.length) {
    await sendTelegramApiMessage(
      chatId,
      "Image analysis on Telegram is coming soon. Please use WhatsApp for image uploads right now.",
    );
    return;
  }

  if (message.sticker) {
    await sendTelegramApiMessage(chatId, "Sticker received. What can I help you with next?");
  }
}

export function buildTelegramConnectUrl(userId: string) {
  const botUsername = env.TELEGRAM_BOT_USERNAME || "ClawCloudBot";
  return `https://t.me/${botUsername}?start=${userId}`;
}

export async function setTelegramWebhook(webhookUrl: string) {
  await callTelegramApi("setWebhook", {
    url: webhookUrl,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET || undefined,
  });
}
