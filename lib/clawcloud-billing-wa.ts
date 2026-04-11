import { createRazorpaySubscription } from "@/lib/clawcloud-razorpay";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import {
  clawCloudActiveTaskLimits,
  clawCloudRunLimits,
  type ClawCloudPlan,
} from "@/lib/clawcloud-types";
import { getClawCloudTodayRunCount } from "@/lib/clawcloud-usage";

export type BillingIntent = "upgrade" | "plan_status" | "cancel" | null;

type UserPlanInfo = {
  plan: ClawCloudPlan;
  email: string;
  runsToday: number;
  dailyLimit: number;
  activeTaskCount: number;
  taskLimit: number;
  subscriptionStatus?: string;
  periodEnd?: string | null;
};

const UPGRADE_PATTERNS = [
  /\b(upgrade|buy|purchase|subscribe|get)\s+(to\s+)?(pro|starter|premium|paid|plan)\b/i,
  /\b(pro plan|starter plan)\b/i,
  /\bupgrade plan\b/i,
  /\bi want (pro|starter|premium)\b/i,
  /\b(switch|move) to (pro|starter)\b/i,
];

const PLAN_STATUS_PATTERNS = [
  /\b(my plan|current plan|what plan|which plan|my subscription|subscription status)\b/i,
  /\b(how many|how much).*(run|message|task|usage|limit|left|remaining)\b/i,
  /\b(plan status|billing|account plan|am i on)\b/i,
  /\b(runs left|tasks left|messages left)\b/i,
];

const CANCEL_PATTERNS = [
  /\b(cancel|downgrade|end)\s+(my\s+)?(plan|subscription|pro|starter)\b/i,
  /\bhow to cancel\b.*\b(plan|subscription|billing)\b/i,
  /\bstop subscription\b/i,
  /\bcancel billing\b/i,
];

const BILLING_STATUS_PATTERNS = [
  /\b(billing status|my billing|account billing|payment status|renewal date|next billing|billing cycle)\b/i,
  /^\s*(billing|plans?|subscription)\s*$/i,
];

const TECHNICAL_BILLING_PATTERNS = [
  /\b(stripe|razorpay|webhook|ledger|idempotent|schema|database|sql|event(?:s)?|inbox|dedupe|migration|cutover|rollback|shadow mode|dual-?write|architecture|system design|api|worker|queue|typescript|pseudocode)\b/i,
  /\b(design|implement|build|architect|model|migrate|debug|refactor|review|explain)\b/i,
  /\b(exactly-?once|eventual consistency|transaction boundaries|reconciliation|projection|balance mutation)\b/i,
];

const WHATSAPP_PLAN_FEATURES: Record<ClawCloudPlan, string[]> = {
  free: [
    "✅ WhatsApp agent setup",
    "✅ 3 active WhatsApp tasks",
    "✅ 10 AI runs per day",
    "✅ Chat, reminders, and media Q&A",
    "❌ Advanced task capacity",
    "❌ Priority support",
  ],
  starter: [
    "✅ WhatsApp agent setup",
    "✅ 10 active WhatsApp tasks",
    "✅ 100 AI runs per day",
    "✅ Contact memory and chat summaries",
    "✅ Media, PDF, and voice understanding",
    "❌ Priority support",
  ],
  pro: [
    "✅ Unlimited WhatsApp tasks",
    "✅ Unlimited AI runs",
    "✅ Advanced contact and history controls",
    "✅ Deep answers and stronger live-source checks",
    "✅ Priority support",
    "✅ Analytics dashboard",
  ],
};

export function detectBillingIntent(message: string): BillingIntent {
  const normalized = message.trim();

  if (
    /\bbilling\b/i.test(normalized)
    && TECHNICAL_BILLING_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return null;
  }

  if (UPGRADE_PATTERNS.some((pattern) => pattern.test(message))) return "upgrade";
  if (CANCEL_PATTERNS.some((pattern) => pattern.test(message))) return "cancel";
  if (
    PLAN_STATUS_PATTERNS.some((pattern) => pattern.test(message))
    || BILLING_STATUS_PATTERNS.some((pattern) => pattern.test(message))
  ) {
    return "plan_status";
  }
  return null;
}

function extractTargetPlan(message: string): "starter" | "pro" {
  return /\bpro\b/i.test(message) ? "pro" : "starter";
}

function extractBillingPeriod(message: string): "monthly" | "annual" {
  return /\b(annual|yearly|year)\b/i.test(message) ? "annual" : "monthly";
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildUsageBar(used: number, limit: number) {
  if (limit >= 9_999) {
    return "▓▓▓▓▓▓▓▓▓▓ Unlimited";
  }

  const filled = Math.min(10, Math.round((used / Math.max(limit, 1)) * 10));
  return `${"▓".repeat(filled)}${"░".repeat(10 - filled)} ${Math.round((used / Math.max(limit, 1)) * 100)}%`;
}

async function getUserPlanInfo(userId: string): Promise<UserPlanInfo> {
  const db = getClawCloudSupabaseAdmin();

  const [userResult, subscriptionResult, runsToday, tasksResult] = await Promise.all([
    db.from("users").select("plan, email").eq("id", userId).single(),
    db.from("subscriptions").select("status, current_period_end").eq("user_id", userId).maybeSingle(),
    getClawCloudTodayRunCount(userId),
    db.from("agent_tasks").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_enabled", true),
  ]);

  const plan = (userResult.data?.plan ?? "free") as ClawCloudPlan;

  return {
    plan,
    email: userResult.data?.email ?? "",
    runsToday,
    dailyLimit: clawCloudRunLimits[plan],
    activeTaskCount: tasksResult.count ?? 0,
    taskLimit: clawCloudActiveTaskLimits[plan],
    subscriptionStatus: subscriptionResult.data?.status ?? undefined,
    periodEnd: subscriptionResult.data?.current_period_end ?? null,
  };
}

function formatPlanStatus(info: UserPlanInfo) {
  const runsLeft = info.dailyLimit >= 9_999 ? "Unlimited" : String(Math.max(0, info.dailyLimit - info.runsToday));
  const lines = [
    `💳 *Your ClawCloud Plan: ${titleCase(info.plan)}*`,
    "",
    `*Daily runs:* ${info.runsToday}/${info.dailyLimit >= 9_999 ? "∞" : info.dailyLimit}`,
    buildUsageBar(info.runsToday, info.dailyLimit),
    `*Runs remaining today:* ${runsLeft}`,
    "",
    `*Active tasks:* ${info.activeTaskCount}/${info.taskLimit >= 999 ? "∞" : info.taskLimit}`,
  ];

  if (info.subscriptionStatus) {
    lines.push(`*Status:* ${titleCase(info.subscriptionStatus)}`);
  }

  if (info.periodEnd) {
    lines.push(
      `*Next billing:* ${new Date(info.periodEnd).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })}`,
    );
  }

  lines.push("", "*Your plan includes:*");
  for (const feature of WHATSAPP_PLAN_FEATURES[info.plan]) {
    lines.push(feature);
  }

  if (info.plan !== "pro") {
    lines.push("", "_Type *upgrade to pro* to unlock the full plan._");
    lines.push("_Manage billing at: swift-deploy.in/settings_");
  }

  return lines.join("\n");
}

async function buildUpgradeReply(userId: string, message: string) {
  const targetPlan = extractTargetPlan(message);
  const period = extractBillingPeriod(message);
  const targetLabel = titleCase(targetPlan);
  const periodLabel = period === "annual" ? "Annual" : "Monthly";
  const info = await getUserPlanInfo(userId);

  if (info.plan === "pro" || (info.plan === "starter" && targetPlan === "starter")) {
    return [
      `✅ *You're already on ${titleCase(info.plan)}.*`,
      "",
      "Reply *my plan* to check your usage and renewal details.",
      "Manage billing at *swift-deploy.in/settings*.",
    ].join("\n");
  }

  try {
    const subscription = await createRazorpaySubscription({
      userId,
      userEmail: info.email,
      plan: targetPlan,
      period,
    });

    return [
      `🚀 *Upgrade to ${targetLabel} - ${periodLabel}*`,
      "",
      ...WHATSAPP_PLAN_FEATURES[targetPlan],
      "",
      "*Pay securely here:*",
      subscription.paymentUrl,
      "",
      "_Powered by Razorpay. Your plan activates after payment._",
    ].join("\n");
  } catch (error) {
    console.error("[billing-wa] upgrade error:", error instanceof Error ? error.message : error);
    return [
      `💳 *Upgrade to ${targetLabel}*`,
      "",
      ...WHATSAPP_PLAN_FEATURES[targetPlan],
      "",
      "I couldn't create the payment link right now.",
      "Please use *swift-deploy.in/pricing* or try again in a moment.",
    ].join("\n");
  }
}

function buildCancelReply() {
  return [
    "ℹ️ *How to cancel your subscription*",
    "",
    "1. Open *swift-deploy.in/settings*",
    "2. Go to *Plan & Billing*",
    "3. Choose *Cancel subscription*",
    "",
    "Your plan stays active until the current billing period ends.",
    "_Reply *my plan* if you want to check the current status first._",
  ].join("\n");
}

export async function handleBillingCommand(userId: string, message: string) {
  const intent = detectBillingIntent(message);
  if (!intent) {
    return null;
  }

  if (intent === "upgrade") {
    return buildUpgradeReply(userId, message);
  }

  if (intent === "plan_status") {
    const info = await getUserPlanInfo(userId);
    return formatPlanStatus(info);
  }

  return buildCancelReply();
}
