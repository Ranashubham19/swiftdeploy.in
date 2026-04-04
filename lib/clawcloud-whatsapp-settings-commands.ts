import {
  getWhatsAppSettings,
  upsertWhatsAppSettings,
} from "@/lib/clawcloud-whatsapp-control";
import { listWhatsAppContacts } from "@/lib/clawcloud-whatsapp-inbox";
import { refreshClawCloudWhatsAppContacts } from "@/lib/clawcloud-whatsapp";
import { looksLikeWhatsAppSettingsKnowledgeQuestion } from "@/lib/clawcloud-workspace-knowledge";

export type WhatsAppSettingsCommandIntent =
  | "whatsapp_settings_status"
  | "whatsapp_settings_update"
  | "whatsapp_contacts_sync";

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function titleCase(value: string) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function parseTime(value: string) {
  const match = value.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3];

  if (meridiem === "pm" && hour < 12) {
    hour += 12;
  }
  if (meridiem === "am" && hour === 12) {
    hour = 0;
  }
  if (!meridiem && hour <= 7) {
    hour += 12;
  }

  if (hour > 23 || minute > 59) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function buildSettingsSummary(settings: Awaited<ReturnType<typeof getWhatsAppSettings>>) {
  return [
    "*WhatsApp assistant settings*",
    "",
    `Mode: ${titleCase(settings.automationMode)}`,
    "Autonomous actions in other chats: Off - ClawCloud only reads or sends there after your explicit command.",
    `Reply tone: ${titleCase(settings.replyMode)}`,
    `Group replies: ${settings.allowGroupReplies ? titleCase(settings.groupReplyMode) : "Disabled"}`,
    `Quiet hours: ${
      settings.quietHoursStart && settings.quietHoursEnd
        ? `${settings.quietHoursStart} - ${settings.quietHoursEnd}`
        : "Not set"
    }`,
    `Direct send commands: ${settings.allowDirectSendCommands ? "On" : "Off"}`,
    "Manual approval gates: Off",
  ].join("\n");
}

function parseAutomationMode(text: string) {
  const normalized = text.toLowerCase();
  if (/\bsuggest(?:\s+only)?\b/.test(normalized)) return "suggest_only" as const;
  if (/\bread(?:\s+only)?\b/.test(normalized)) return "read_only" as const;
  return null;
}

function parseReplyMode(text: string) {
  const normalized = text.toLowerCase();
  if (/\bprofessional\b/.test(normalized)) return "professional" as const;
  if (/\bfriendly\b/.test(normalized)) return "friendly" as const;
  if (/\bbrief\b/.test(normalized)) return "brief" as const;
  if (/\bbalanced\b/.test(normalized)) return "balanced" as const;
  return null;
}

function parseBooleanToggle(text: string) {
  const normalized = text.toLowerCase();
  if (/\b(turn on|enable|allow|activate)\b/.test(normalized)) return true;
  if (/\b(turn off|disable|stop|block)\b/.test(normalized)) return false;
  return null;
}

export function detectWhatsAppSettingsCommandIntent(text: string): WhatsAppSettingsCommandIntent | null {
  const normalized = text.toLowerCase().trim();

  if (looksLikeWhatsAppSettingsKnowledgeQuestion(text)) {
    return null;
  }

  if (
    /\b(sync|refresh|resync|scan)\b/.test(normalized)
    && /\bwhatsapp\b/.test(normalized)
    && /\bcontacts?\b/.test(normalized)
  ) {
    return "whatsapp_contacts_sync";
  }

  if (
    /\b(whatsapp|assistant)\s+(settings|mode|reply tone|group replies|quiet hours)\b/.test(normalized)
    || /\bwhat('s| is)\s+my\s+whatsapp\b/.test(normalized)
    || /\bshow\s+my\s+whatsapp\b/.test(normalized)
  ) {
    return /\b(set|turn on|turn off|enable|disable|switch|change|update|clear)\b/.test(normalized)
      ? "whatsapp_settings_update"
      : "whatsapp_settings_status";
  }

  if (
    /\b(set|turn on|turn off|enable|disable|switch|change|update|clear)\b/.test(normalized)
    && /\b(reply tone|group replies|quiet hours|automation mode|whatsapp mode|sensitive approval|direct send|first outreach)\b/.test(normalized)
  ) {
    return "whatsapp_settings_update";
  }

  return null;
}

export async function handleWhatsAppSettingsCommand(userId: string, text: string) {
  const intent = detectWhatsAppSettingsCommandIntent(text);
  if (!intent) {
    return null;
  }

  if (intent === "whatsapp_contacts_sync") {
    const refreshed = await refreshClawCloudWhatsAppContacts(userId);
    const contacts = await listWhatsAppContacts(userId).catch(() => []);

    if (!contacts.length) {
      return [
        "WhatsApp contact refresh completed.",
        "",
        "I refreshed your linked WhatsApp session, but it still is not exposing named contacts yet.",
        "I can still work with saved ClawCloud contacts, recent WhatsApp chats that expose names, or a direct phone number.",
      ].join("\n");
    }

    const sample = contacts
      .slice(0, 5)
      .map((contact) => `- ${contact.display_name}${contact.phone_number ? ` - +${contact.phone_number}` : ""}`);

    return [
      "WhatsApp contacts synced.",
      "",
      `Available contacts now: ${contacts.length}`,
      refreshed.previousCount !== undefined
        ? `Session contacts refreshed from ${refreshed.previousCount} to ${refreshed.contactCount}.`
        : `Session contacts refreshed to ${refreshed.contactCount}.`,
      refreshed.persistedCount !== undefined
        ? `Persisted contacts available to ClawCloud now: ${refreshed.persistedCount}.`
        : null,
      refreshed.historyMessageCount !== undefined
        ? `Stored WhatsApp messages available to ClawCloud now: ${refreshed.historyMessageCount}.`
        : null,
      "",
      "This scan uses saved WhatsApp contacts, chat history, and participant names exposed by your linked session.",
      "",
      "You can now retry names like these:",
      ...sample,
    ].filter(Boolean).join("\n");
  }

  if (intent === "whatsapp_settings_status") {
    const settings = await getWhatsAppSettings(userId);
    return buildSettingsSummary(settings);
  }

  const normalized = text.toLowerCase();
  const patch: Record<string, unknown> = {};

  if (/\b(reply tone|tone)\b/.test(normalized)) {
    const replyMode = parseReplyMode(text);
    if (!replyMode) {
      return "Tell me the reply tone you want: balanced, professional, friendly, or brief.";
    }
    patch.replyMode = replyMode;
  }

  if (/\b(automation mode|whatsapp mode|mode)\b/.test(normalized)) {
    if (/\bapprove(?:\s+before\s+send)?\b/.test(normalized)) {
      return "Approve-before-send mode is retired. ClawCloud now sends only when you explicitly ask, and autonomous outbound actions stay off by default.";
    }
    const automationMode = parseAutomationMode(text);
    if (!automationMode) {
      return "Tell me the WhatsApp mode you want: suggest only or read only. Autonomous replies in other chats stay off.";
    }
    patch.automationMode = automationMode;
  }

  if (/\bgroup replies?\b/.test(normalized)) {
    const toggle = parseBooleanToggle(text);
    if (toggle === null && !/\bmention only\b/.test(normalized)) {
      return "Tell me whether to allow group replies, disable them, or switch to mention only.";
    }
    if (/\bmention only\b/.test(normalized)) {
      patch.allowGroupReplies = true;
      patch.groupReplyMode = "mention_only";
    } else if (toggle) {
      patch.allowGroupReplies = true;
      patch.groupReplyMode = "allow";
    } else {
      patch.allowGroupReplies = false;
      patch.groupReplyMode = "never";
    }
  }

  if (/\bquiet hours?\b/.test(normalized)) {
    if (/\b(clear|remove|disable)\b/.test(normalized)) {
      patch.quietHoursStart = null;
      patch.quietHoursEnd = null;
    } else {
      const match =
        text.match(/\b(?:quiet hours?|set quiet hours?)\s+(?:from\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(?:to|-)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i)
        ?? text.match(/\bfrom\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(?:to|-)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
      const start = parseTime(match?.[1] ?? "");
      const end = parseTime(match?.[2] ?? "");
      if (!start || !end) {
        return "Tell me quiet hours like: set quiet hours from 10pm to 7am.";
      }
      patch.quietHoursStart = start;
      patch.quietHoursEnd = end;
    }
  }

  if (/\bsensitive approval\b/.test(normalized)) {
    return "Sensitive approval is retired. Direct user commands already run without a Yes/No gate, and autonomous outbound actions stay off until you explicitly ask for them.";
  }

  if (/\bdirect send\b/.test(normalized)) {
    const toggle = parseBooleanToggle(text);
    if (toggle === null) {
      return "Tell me whether to enable or disable direct send commands.";
    }
    patch.allowDirectSendCommands = toggle;
  }

  if (/\bfirst outreach\b/.test(normalized)) {
    return "First-outreach approval is retired. ClawCloud will not start outbound contact on its own, and direct sends only happen when you explicitly ask for them.";
  }

  if (!Object.keys(patch).length) {
    return [
      "I can update your WhatsApp assistant settings.",
      "",
      "Examples:",
      "_Set WhatsApp mode to suggest only_",
      "_Set WhatsApp mode to read only_",
      "_Set reply tone to professional_",
      "_Turn off group replies_",
      "_Set quiet hours from 10pm to 7am_",
    ].join("\n");
  }

  const next = await upsertWhatsAppSettings(userId, patch);
  return [
    "WhatsApp assistant settings updated.",
    "",
    buildSettingsSummary(next),
  ].join("\n");
}
