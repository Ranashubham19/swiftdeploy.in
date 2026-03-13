export type ClawCloudPlan = "free" | "starter" | "pro";

export type ClawCloudTaskType =
  | "morning_briefing"
  | "draft_replies"
  | "meeting_reminders"
  | "email_search"
  | "evening_summary"
  | "custom_reminder"
  | "weekly_spend";

export type ClawCloudProvider =
  | "gmail"
  | "google_calendar"
  | "whatsapp"
  | "telegram"
  | "slack";

export type FrontendSetupTaskId =
  | "morning"
  | "drafts"
  | "calendar"
  | "search"
  | "evening"
  | "remind";

export type ClawCloudTaskConfig = Record<string, unknown>;

export type ClawCloudTaskSeed = {
  taskType: ClawCloudTaskType;
  scheduleTime: string | null;
  scheduleDays: string[] | null;
  config: ClawCloudTaskConfig;
  enabledByDefault: boolean;
};

export const clawCloudFrontendTaskMap: Record<FrontendSetupTaskId, ClawCloudTaskType> = {
  morning: "morning_briefing",
  drafts: "draft_replies",
  calendar: "meeting_reminders",
  search: "email_search",
  evening: "evening_summary",
  remind: "custom_reminder",
};

export const clawCloudRunLimits: Record<ClawCloudPlan, number> = {
  free: 10,
  starter: 100,
  pro: 9999,
};

export const clawCloudActiveTaskLimits: Record<ClawCloudPlan, number> = {
  free: 3,
  starter: 10,
  pro: 999,
};

export const clawCloudDefaultTaskSeeds: readonly ClawCloudTaskSeed[] = [
  {
    taskType: "morning_briefing",
    enabledByDefault: true,
    scheduleTime: "07:00",
    scheduleDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    config: { max_emails: 50, tone: "concise" },
  },
  {
    taskType: "draft_replies",
    enabledByDefault: true,
    scheduleTime: null,
    scheduleDays: null,
    config: { tone: "professional", auto_send: false },
  },
  {
    taskType: "meeting_reminders",
    enabledByDefault: true,
    scheduleTime: null,
    scheduleDays: null,
    config: { minutes_before: 30, include_context: true },
  },
  {
    taskType: "email_search",
    enabledByDefault: false,
    scheduleTime: null,
    scheduleDays: null,
    config: {},
  },
  {
    taskType: "evening_summary",
    enabledByDefault: false,
    scheduleTime: "21:00",
    scheduleDays: ["mon", "tue", "wed", "thu", "fri"],
    config: {},
  },
  {
    taskType: "custom_reminder",
    enabledByDefault: false,
    scheduleTime: null,
    scheduleDays: null,
    config: {},
  },
  {
    taskType: "weekly_spend",
    enabledByDefault: false,
    scheduleTime: "09:00",
    scheduleDays: ["sun"],
    config: {},
  },
] as const;

export function parseMeridiemTimeTo24Hour(value: string) {
  const normalized = value.trim();
  const match = normalized.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);

  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3].toUpperCase();

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  let hour24 = hours % 12;
  if (meridiem === "PM") {
    hour24 += 12;
  }

  return `${hour24.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

export function formatDateKey(date = new Date()) {
  return date.toISOString().split("T")[0] ?? "";
}
