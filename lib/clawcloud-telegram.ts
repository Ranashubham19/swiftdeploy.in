import { buildDocumentQuestionPrompt, extractDocumentText, isSupportedDocument } from "@/lib/clawcloud-docs";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { analyseImage, formatVisionReply, isVisionAvailable } from "@/lib/clawcloud-vision";
import { isWhisperAvailable, transcribeAudioBuffer } from "@/lib/clawcloud-whisper";
import { env } from "@/lib/env";

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

type TelegramApiEnvelope<T> = {
  ok?: boolean;
  description?: string;
  result?: T;
};

function getTelegramBotToken() {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is not set.");
  }

  return env.TELEGRAM_BOT_TOKEN;
}

async function callTelegramApi<T = void>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const token = getTelegramBotToken();
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json().catch(() => ({}))) as TelegramApiEnvelope<T>;
  if (!response.ok || json.ok === false) {
    throw new Error(json.description || `Telegram ${method} failed.`);
  }

  return json.result as T;
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

async function getTelegramFilePath(fileId: string): Promise<string | null> {
  const result = await callTelegramApi<{ file_path?: string }>("getFile", {
    file_id: fileId,
  }).catch(() => null);

  return result?.file_path?.trim() || null;
}

async function downloadTelegramFileBuffer(fileId: string): Promise<Buffer | null> {
  const filePath = await getTelegramFilePath(fileId);
  if (!filePath) {
    return null;
  }

  const token = getTelegramBotToken();
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!response.ok) {
    return null;
  }

  const bytes = await response.arrayBuffer();
  return Buffer.from(bytes);
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

async function routeTelegramAgentMessage(userId: string, text: string) {
  const { routeInboundAgentMessage } = await import("@/lib/clawcloud-agent");
  return routeInboundAgentMessage(userId, text).catch(() => null);
}

export async function handleTelegramUpdate(update: TelegramUpdate) {
  const message = update.message ?? update.edited_message;
  if (!message) {
    return;
  }

  const chatId = String(message.chat.id);
  const text = message.text?.trim() ?? "";
  const caption = message.caption?.trim() ?? "";
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

  if (text) {
    await sendTelegramChatAction(chatId, "typing");
    const response = await routeTelegramAgentMessage(linkedAccount.user_id, text);
    if (response) {
      await sendTelegramApiMessage(chatId, response);
    }
    return;
  }

  if (message.location) {
    await sendTelegramChatAction(chatId, "typing");
    const response = await routeTelegramAgentMessage(
      linkedAccount.user_id,
      buildLocationPrompt(message.location),
    );
    if (response) {
      await sendTelegramApiMessage(chatId, response);
    }
    return;
  }

  if (message.voice) {
    if (!isWhisperAvailable()) {
      await sendTelegramApiMessage(
        chatId,
        "Voice transcription is not configured yet on this deployment. Add GROQ_API_KEY or OPENAI_API_KEY to enable Telegram voice notes.",
      );
      return;
    }

    await sendTelegramChatAction(chatId, "typing");
    const voiceBuffer = await downloadTelegramFileBuffer(message.voice.file_id);
    if (!voiceBuffer) {
      await sendTelegramApiMessage(
        chatId,
        "I received your Telegram voice note but could not download it. Please try again.",
      );
      return;
    }

    const transcript = await transcribeAudioBuffer(
      voiceBuffer,
      message.voice.mime_type ?? "audio/ogg",
    );
    if (!transcript) {
      await sendTelegramApiMessage(
        chatId,
        "I received your Telegram voice note but could not transcribe it. Please try again or type your message.",
      );
      return;
    }

    const response = await routeTelegramAgentMessage(
      linkedAccount.user_id,
      `[Voice note transcribed from Telegram]: ${transcript}`,
    );
    if (response) {
      await sendTelegramApiMessage(chatId, response);
    }
    return;
  }

  if (message.document) {
    const mimeType = message.document.mime_type ?? "application/octet-stream";
    const fileName =
      message.document.file_name ?? `document.${mimeType.split("/")[1] ?? "bin"}`;

    if (!isSupportedDocument(mimeType, fileName)) {
      await sendTelegramApiMessage(
        chatId,
        `I received *${fileName}* but that file type is not supported yet.\n\nSupported formats: PDF, DOCX, XLSX, TXT, CSV, Markdown, and JSON.`,
      );
      return;
    }

    await sendTelegramChatAction(chatId, "typing");
    const documentBuffer = await downloadTelegramFileBuffer(message.document.file_id);
    if (!documentBuffer) {
      await sendTelegramApiMessage(
        chatId,
        `I received *${fileName}* but could not download it. Please try again.`,
      );
      return;
    }

    const extracted = await extractDocumentText(documentBuffer, mimeType, fileName);
    if (!extracted) {
      await sendTelegramApiMessage(
        chatId,
        `I received *${fileName}* but could not extract text from it. Supported formats are PDF, DOCX, XLSX, TXT, CSV, Markdown, and JSON.`,
      );
      return;
    }

    const response = await routeTelegramAgentMessage(
      linkedAccount.user_id,
      buildDocumentQuestionPrompt(extracted, caption),
    );
    if (response) {
      await sendTelegramApiMessage(chatId, response);
    }
    return;
  }

  if (message.photo?.length) {
    const bestPhoto = message.photo[message.photo.length - 1];
    const photoBuffer = bestPhoto
      ? await downloadTelegramFileBuffer(bestPhoto.file_id)
      : null;

    if (!photoBuffer) {
      await sendTelegramApiMessage(
        chatId,
        "I received your Telegram image but could not download it. Please try again.",
      );
      return;
    }

    if (isVisionAvailable()) {
      await sendTelegramChatAction(chatId, "typing");
      const visionAnswer = await analyseImage(photoBuffer, "image/jpeg", caption);
      if (visionAnswer) {
        await sendTelegramApiMessage(chatId, formatVisionReply(visionAnswer, Boolean(caption)));
        return;
      }
    }

    if (caption) {
      await sendTelegramChatAction(chatId, "typing");
      const response = await routeTelegramAgentMessage(linkedAccount.user_id, caption);
      if (response) {
        await sendTelegramApiMessage(chatId, response);
      }
      return;
    }

    await sendTelegramApiMessage(
      chatId,
      "Image analysis is not available right now. Send a caption with your question, or enable NVIDIA_API_KEY or OPENAI_API_KEY for Telegram image understanding.",
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
