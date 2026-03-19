import type { ClawCloudPlan } from "@/lib/clawcloud-types";

const CLAWCLOUD_SETTINGS_URL = "https://swift-deploy.in/settings";
const CLAWCLOUD_PRICING_URL = "https://swift-deploy.in/pricing";

function formatPlanLabel(plan: ClawCloudPlan) {
  if (plan === "free") return "Free";
  if (plan === "starter") return "Starter";
  return "Pro";
}

function nextPlanLabel(plan: ClawCloudPlan) {
  return plan === "free" ? "Starter" : "Pro";
}

export function getClawCloudSettingsUrl() {
  return CLAWCLOUD_SETTINGS_URL;
}

export function getClawCloudPricingUrl() {
  return CLAWCLOUD_PRICING_URL;
}

export function buildDailyLimitReachedMessage(input: {
  plan: ClawCloudPlan;
  limit: number;
  upgradeUrl?: string;
}) {
  const upgradeUrl = input.upgradeUrl ?? CLAWCLOUD_SETTINGS_URL;
  const planLabel = formatPlanLabel(input.plan);
  const nextPlan = nextPlanLabel(input.plan);

  return [
    "\u23f1\ufe0f *Daily limit reached*",
    "",
    `You have used all *${input.limit} runs* included in the *${planLabel}* plan today.`,
    "Runs reset automatically at *midnight IST*.",
    "",
    `Need more room today? Upgrade to *${nextPlan}* at ${upgradeUrl}`,
  ].join("\n");
}

export function buildActiveAutomationLimitMessage(input: {
  plan: ClawCloudPlan;
  limit: number;
  upgradeUrl?: string;
}) {
  const upgradeUrl = input.upgradeUrl ?? CLAWCLOUD_SETTINGS_URL;
  const planLabel = formatPlanLabel(input.plan);
  return `You already have the maximum *${input.limit} active automations* on the *${planLabel}* plan. Manage or upgrade at ${upgradeUrl}.`;
}

export function buildBackgroundTaskFailureMessage(
  taskLabel: string,
  failure: "daily_limit" | "gmail" | "calendar" | "delivery" | "general",
) {
  switch (failure) {
    case "daily_limit":
      return [
        "\u26a0\ufe0f *Daily limit reached*",
        "",
        `Your ${taskLabel.toLowerCase()} could not run because today's usage limit has been reached.`,
        `You can manage your plan at ${CLAWCLOUD_PRICING_URL}.`,
      ].join("\n");
    case "gmail":
      return [
        `\u26a0\ufe0f *${taskLabel} could not access Gmail*`,
        "",
        `Your Google connection may need to be reconnected at ${CLAWCLOUD_SETTINGS_URL}.`,
      ].join("\n");
    case "calendar":
      return [
        `\u26a0\ufe0f *${taskLabel} could not access Calendar*`,
        "",
        `Please reconnect Google Calendar at ${CLAWCLOUD_SETTINGS_URL} and try again.`,
      ].join("\n");
    case "delivery":
      return [
        `\u26a0\ufe0f *${taskLabel} finished but delivery failed*`,
        "",
        "Please try again in a moment.",
      ].join("\n");
    default:
      return [
        `\u26a0\ufe0f *${taskLabel} ran into a problem*`,
        "",
        "Please try again in a few minutes.",
      ].join("\n");
  }
}

export function buildNoLiveDataProfessionalReply() {
  return [
    "\u{1F50D} *I could not verify enough reliable live sources right now.*",
    "",
    "I do not want to guess on a time-sensitive answer.",
    "Please retry with a narrower query, exact company/person name, or a clearer date/timeframe.",
  ].join("\n");
}
