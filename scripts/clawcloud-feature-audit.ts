import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  loadClawCloudEnv,
  maskUserId,
  resolveClawCloudSharedUser,
  writeJsonReport,
} from "./clawcloud-script-helpers";

type Criterion = {
  label: string;
  patterns: RegExp[];
  points?: number;
};

type FallbackRule = {
  label: string;
  patterns: RegExp[];
  score: number;
};

type PenaltyRule = {
  label: string;
  patterns: RegExp[];
  penalty: number;
};

type UserMode = "fresh" | "shared";

type AuditCase = {
  id: string;
  feature: string;
  area: "core" | "live" | "assistant" | "integrations";
  prompt: string;
  userMode: UserMode;
  criteria: Criterion[];
  acceptableFallbacks?: FallbackRule[];
  penalties?: PenaltyRule[];
  minLength?: number;
};

type AuditResult = {
  id: string;
  feature: string;
  area: string;
  prompt: string;
  userMode: UserMode;
  userIdPrefix: string;
  elapsedMs: number;
  elapsedSeconds: number;
  score: number;
  maxScore: number;
  verdict: "strong" | "usable" | "partial" | "weak";
  responseClass: "direct_answer" | "graceful_fallback" | "ack_only" | "failed";
  hits: string[];
  misses: string[];
  penalties: string[];
  fallbackLabel: string | null;
  answer: string;
};

const reportPath = "tmp-clawcloud-feature-audit.json";

const commonPenalties: PenaltyRule[] = [
  {
    label: "Internal fallback marker",
    patterns: [/__fast_fallback_internal__/i, /__deep_fallback_internal__/i],
    penalty: 4,
  },
  {
    label: "Placeholder or canned failure phrasing",
    patterns: [
      /i got your message/i,
      /you asked about/i,
      /ready to answer\./i,
      /question captured:/i,
      /send the exact task you want solved/i,
      /rephrase your question and i'll answer it/i,
      /i'm not confident enough to answer that accurately right now/i,
    ],
    penalty: 3,
  },
  {
    label: "Low-quality markdown fallback",
    patterns: [
      /reliable information for this detail is not available in the retrieved sources/i,
      /## short summary/i,
      /## key updates/i,
      /## detailed explanation/i,
    ],
    penalty: 3,
  },
];

const ackOnlyPatterns = [
  /\bchecking your inbox\b/i,
  /\bsearching your inbox\b/i,
  /\bsearching your email inbox\b/i,
  /\bdrafting\b/i,
  /\bi'm searching\b/i,
  /\bi'm checking\b/i,
];

const cases: AuditCase[] = [
  {
    id: "billing_plan_status",
    feature: "Billing plan status",
    area: "assistant",
    prompt: "What is my current plan status?",
    userMode: "shared",
    criteria: [
      { label: "States the current plan", patterns: [/\byour clawcloud plan\b/i, /\bfree\b|\bstarter\b|\bpro\b/i] },
      { label: "Includes plan features or upgrade guidance", patterns: [/\bfeatures\b/i, /\bupgrade\b/i, /\bmonthly\b/i] },
    ],
  },
  {
    id: "memory_save",
    feature: "Memory save",
    area: "assistant",
    prompt: "Remember that my favorite language is Rust.",
    userMode: "shared",
    criteria: [
      { label: "Confirms memory was saved", patterns: [/\bsaved\b/i, /\bremember\b/i, /\brust\b/i] },
    ],
  },
  {
    id: "memory_show",
    feature: "Memory show",
    area: "assistant",
    prompt: "What do you remember about me?",
    userMode: "shared",
    criteria: [
      { label: "Returns the saved value", patterns: [/\brust\b/i] },
      { label: "Shows a memory/profile view", patterns: [/\bprofile\b/i, /\bmemory\b/i, /\bsaved\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "Memory is empty but the reply is explicit",
        patterns: [/\bdon't know much about you yet\b/i, /\bnothing saved yet\b/i],
        score: 3,
      },
    ],
    penalties: [
      {
        label: "Saved the fact under language preference instead of favorite language",
        patterns: [/\blanguage preference\b[\s\S]{0,40}\brust\b/i],
        penalty: 3,
      },
      {
        label: "Saved the fact under interests instead of favorite language",
        patterns: [/\binterests\b[\s\S]{0,30}\brust\b/i],
        penalty: 3,
      },
    ],
  },
  {
    id: "memory_forget",
    feature: "Memory forget",
    area: "assistant",
    prompt: "Forget my favorite language",
    userMode: "shared",
    criteria: [
      { label: "Confirms deletion", patterns: [/\bforgot\b/i, /\bremoved\b/i, /\bdeleted\b/i, /\bno longer\b/i, /\bcleared\b/i] },
    ],
  },
  {
    id: "locale_set_hindi",
    feature: "Locale set to Hindi",
    area: "assistant",
    prompt: "Set language to Hindi",
    userMode: "shared",
    criteria: [
      { label: "Acknowledges Hindi selection", patterns: [/\bhindi\b/i, /[\u0900-\u097F]/] },
    ],
  },
  {
    id: "locale_show",
    feature: "Locale show",
    area: "assistant",
    prompt: "What is my language?",
    userMode: "shared",
    criteria: [
      { label: "Shows the active language", patterns: [/\bhindi\b/i, /[\u0900-\u097F]/] },
    ],
  },
  {
    id: "locale_reset_english",
    feature: "Locale reset to English",
    area: "assistant",
    prompt: "Reply in English",
    userMode: "shared",
    criteria: [
      { label: "Acknowledges English selection", patterns: [/\benglish\b/i] },
    ],
  },
  {
    id: "reminder_set",
    feature: "Reminder set",
    area: "assistant",
    prompt: "Remind me in 45 minutes to drink water",
    userMode: "shared",
    criteria: [
      { label: "Confirms the reminder", patterns: [/\breminder\b/i, /\bdrink water\b/i] },
      { label: "Includes timing details", patterns: [/\b45\b/i, /\bminute\b/i, /\bpm\b|\bam\b/i] },
    ],
  },
  {
    id: "reminder_list",
    feature: "Reminder list",
    area: "assistant",
    prompt: "Show reminders",
    userMode: "shared",
    criteria: [
      { label: "Lists the reminder", patterns: [/\bdrink water\b/i, /\breminder\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "No reminders but the reply is explicit",
        patterns: [/\bno active reminders\b/i, /\bdo not have any active reminders\b/i],
        score: 3,
      },
    ],
  },
  {
    id: "reminder_cancel_all",
    feature: "Reminder cancel all",
    area: "assistant",
    prompt: "Cancel all reminders",
    userMode: "shared",
    criteria: [
      { label: "Confirms cancellation", patterns: [/\bcancelled\b/i, /\bremoved\b/i, /\bcleared\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "No reminders to cancel but the reply is explicit",
        patterns: [/\bno active reminders\b/i, /\bnothing to cancel\b/i],
        score: 4,
      },
    ],
  },
  {
    id: "drive_list",
    feature: "Google Drive listing",
    area: "integrations",
    prompt: "List my Google Drive files",
    userMode: "shared",
    criteria: [
      { label: "Returns Drive files", patterns: [/\brecent google drive files\b/i, /\bmodified\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "Drive not connected",
        patterns: [/\bgoogle drive is not connected\b/i, /\bgoogle drive not connected\b/i, /\bconnect google drive\b/i],
        score: 4.5,
      },
      {
        label: "No recent files",
        patterns: [/\bno recent drive files found\b/i],
        score: 5.5,
      },
    ],
  },
  {
    id: "calendar_today",
    feature: "Calendar lookup",
    area: "integrations",
    prompt: "What's on my calendar today?",
    userMode: "shared",
    criteria: [
      { label: "Returns schedule details", patterns: [/\btoday's schedule\b/i, /\bmeeting\b/i, /\bclear\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "Calendar not connected",
        patterns: [/\bgoogle calendar is not connected\b/i, /\breconnect it in the dashboard\b/i],
        score: 4.5,
      },
      {
        label: "Generic low-confidence refusal",
        patterns: [/\bi'm not confident enough to answer that accurately right now\b/i],
        score: 2.5,
      },
      {
        label: "No meetings found",
        patterns: [/\bno meetings found\b/i, /\bcalendar looks clear\b/i],
        score: 6,
      },
    ],
  },
  {
    id: "email_search",
    feature: "Email search",
    area: "integrations",
    prompt: "Search my inbox for unread messages from Raj",
    userMode: "shared",
    criteria: [
      { label: "Returns real inbox results", patterns: [/\bsubject\b/i, /\bsnippet\b/i, /\bfrom:\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "Async acknowledgement only",
        patterns: [/\bsearching your inbox\b/i, /\bchecking your inbox\b/i, /\bsearching your email inbox\b/i],
        score: 4.5,
      },
      {
        label: "Inbox not connected",
        patterns: [/\bgmail is not connected\b/i, /\bconnect google\b/i],
        score: 4,
      },
    ],
  },
  {
    id: "spending_summary",
    feature: "Spending summary",
    area: "integrations",
    prompt: "How much did I spend in the last 30 days?",
    userMode: "shared",
    criteria: [
      { label: "Answers from transactions", patterns: [/\blast 30 days\b/i, /\bspent\b/i, /\b₹|\brs\b|\binr\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "No spending data found",
        patterns: [/\bno transactions found\b/i, /\bcould not find enough spending data\b/i],
        score: 5,
      },
    ],
  },
  {
    id: "coding_nqueens",
    feature: "Coding",
    area: "core",
    prompt: "Can you give Python code for N-Queens with a brief explanation?",
    userMode: "fresh",
    criteria: [
      { label: "Returns Python code", patterns: [/```python/i, /\bdef\b/i] },
      { label: "Mentions the right technique", patterns: [/\bn-?queens\b/i, /\bbacktracking\b|\bdfs\b/i] },
      { label: "Includes explanation", patterns: [/\bexplain\b/i, /\bidea\b/i, /\bworks\b/i] },
    ],
    minLength: 200,
  },
  {
    id: "math_percentage",
    feature: "Math",
    area: "core",
    prompt: "What is 15% of 840?",
    userMode: "fresh",
    criteria: [
      { label: "Gets the right numeric answer", patterns: [/\b126\b/i] },
      { label: "Shows working or formula", patterns: [/\b15\b/i, /\/100|\bformula\b|\bcalculation\b/i] },
    ],
    minLength: 80,
  },
  {
    id: "explain_ai_ml_dl",
    feature: "Explain concepts",
    area: "core",
    prompt: "Explain the difference between AI, ML, and deep learning in simple terms.",
    userMode: "fresh",
    criteria: [
      { label: "Mentions AI", patterns: [/\bai\b/i] },
      { label: "Mentions machine learning", patterns: [/\bmachine learning\b|\bml\b/i] },
      { label: "Mentions deep learning", patterns: [/\bdeep learning\b/i] },
      { label: "Frames the relationship clearly", patterns: [/\bsubset\b/i, /\bpart of\b/i, /\bwithin\b/i] },
    ],
    minLength: 120,
  },
  {
    id: "translation_hindi",
    feature: "Translation",
    area: "core",
    prompt: "Translate 'I will call you tomorrow morning' into Hindi.",
    userMode: "fresh",
    criteria: [
      { label: "Contains Hindi script", patterns: [/[\u0900-\u097F]/] },
      { label: "Preserves tomorrow/morning meaning", patterns: [/कल/, /सुबह/] },
    ],
  },
  {
    id: "research_compare",
    feature: "Research comparison",
    area: "core",
    prompt: "Compare Tavily and SerpAPI for production research workflows.",
    userMode: "fresh",
    criteria: [
      { label: "Mentions Tavily", patterns: [/\btavily\b/i] },
      { label: "Mentions SerpAPI", patterns: [/\bserpapi\b/i] },
      { label: "Explains trade-offs or recommendation", patterns: [/\btrade-?off\b/i, /\brecommend\b/i, /\bbest\b/i] },
    ],
    minLength: 180,
  },
  {
    id: "news_latest_ai",
    feature: "Latest news",
    area: "live",
    prompt: "What are the latest major AI developments this week?",
    userMode: "fresh",
    criteria: [
      { label: "Gives multiple updates", patterns: [/\b1\b|\b2\b|\b3\b/i, /\bthis week\b|\blatest\b|\brecent\b/i] },
      { label: "References concrete entities or products", patterns: [/\bopenai\b|\bgoogle\b|\bmeta\b|\banthropic\b|\bgemini\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "Low-confidence live-news fallback",
        patterns: [/\bcould not verify enough reliable live news coverage\b/i, /\bnot enough reliable live news\b/i],
        score: 3.5,
      },
    ],
    minLength: 180,
  },
  {
    id: "web_search_population",
    feature: "Web search",
    area: "live",
    prompt: "Search the web and tell me the current population of Japan.",
    userMode: "fresh",
    criteria: [
      { label: "Mentions Japan", patterns: [/\bjapan\b/i] },
      { label: "Provides a population figure", patterns: [/\b1\d{2}(?:[.,]\d+)?\s*(million|mn)\b/i, /\b12[0-9],[0-9]{3},[0-9]{3}\b/] },
      { label: "Shows live-search style grounding", patterns: [/\bsource\b|\bas of\b|\baccording to\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "No live data fallback",
        patterns: [/\blive data\b/i, /\bcould not verify\b/i, /\bretry shortly\b/i],
        score: 3.5,
      },
    ],
    minLength: 100,
  },
  {
    id: "finance_btc",
    feature: "Finance: crypto",
    area: "live",
    prompt: "What is the BTC price today?",
    userMode: "fresh",
    criteria: [
      { label: "Mentions BTC or Bitcoin", patterns: [/\bbtc\b|\bbitcoin\b/i] },
      { label: "Provides a numeric price", patterns: [/\$\s?\d[\d,]*(?:\.\d+)?/, /\b₹\s?\d[\d,]*(?:\.\d+)?/i] },
      { label: "Includes a safety note", patterns: [/\bnot financial advice\b/i, /\bverify before trading\b/i, /\bverify before investing\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "Live price unavailable",
        patterns: [/\blive price data unavailable\b/i, /\bcould not fetch reliable market quotes\b/i],
        score: 4,
      },
    ],
    penalties: [
      {
        label: "Answered with a Bitcoin ETF instead of BTC spot price",
        patterns: [/\betf\b/i, /\btrust\b/i],
        penalty: 3,
      },
    ],
  },
  {
    id: "finance_reliance",
    feature: "Finance: Indian stock",
    area: "live",
    prompt: "Reliance share price today",
    userMode: "fresh",
    criteria: [
      { label: "Mentions Reliance", patterns: [/\breliance\b/i] },
      { label: "Provides a numeric price", patterns: [/\b₹\s?\d[\d,]*(?:\.\d+)?/i, /\brs\.?\s?\d[\d,]*(?:\.\d+)?\b/i, /\b\d[\d,]*(?:\.\d+)?\s*INR\b/i] },
      { label: "Includes a safety note", patterns: [/\bnot financial advice\b/i, /\bverify before trading\b/i, /\bverify before investing\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "Live price unavailable",
        patterns: [/\blive price data unavailable\b/i, /\bcould not fetch reliable market quotes\b/i],
        score: 4,
      },
    ],
  },
  {
    id: "tax_gst",
    feature: "Tax calculator",
    area: "live",
    prompt: "GST on Rs 1180 at 18% inclusive",
    userMode: "fresh",
    criteria: [
      { label: "Mentions GST", patterns: [/\bgst\b/i] },
      { label: "Computes 180.00 tax", patterns: [/\b180(?:\.00)?\b/i] },
      { label: "Frames the inclusive calculation", patterns: [/\binclusive\b/i, /\btaxable\b|\bbase price\b/i] },
    ],
  },
  {
    id: "holiday_onam",
    feature: "Holiday lookup",
    area: "live",
    prompt: "When is Onam in Kerala?",
    userMode: "fresh",
    criteria: [
      { label: "Mentions Onam", patterns: [/\bonam\b/i] },
      { label: "Mentions Kerala", patterns: [/\bkerala\b/i] },
      { label: "Includes a date or timing", patterns: [/\b20\d{2}\b/, /\baugust\b|\bseptember\b/i] },
    ],
  },
  {
    id: "weather_delhi",
    feature: "Weather lookup",
    area: "live",
    prompt: "Weather in Delhi",
    userMode: "fresh",
    criteria: [
      { label: "Mentions Delhi", patterns: [/\bdelhi\b/i] },
      { label: "Includes weather details", patterns: [/\btemperature\b|\bcondition\b|\bhumidity\b|\brain\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "Weather provider unavailable",
        patterns: [/\bcould not fetch live weather\b/i],
        score: 4.5,
      },
    ],
  },
  {
    id: "cricket_latest",
    feature: "Cricket live info",
    area: "live",
    prompt: "Latest India cricket score",
    userMode: "fresh",
    criteria: [
      { label: "Mentions India or cricket teams", patterns: [/\bindia\b/i, /\bvs\b/i] },
      { label: "Includes score-style numbers", patterns: [/\b\d+\/\d+\b/, /\bovers?\b/i, /\bruns?\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "Cricket data unavailable",
        patterns: [/\bnot available right now\b/i, /\bcould not fetch\b/i],
        score: 3.5,
      },
    ],
  },
  {
    id: "train_schedule",
    feature: "Train lookup",
    area: "live",
    prompt: "Schedule for 12002",
    userMode: "fresh",
    criteria: [
      { label: "Recognizes the train number", patterns: [/\b12002\b/] },
      { label: "Includes concrete schedule details", patterns: [/\bdeparture\b|\barrival\b|\bstation\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "Train data unavailable",
        patterns: [/\bcould not fetch\b/i, /\btry again\b/i, /\bnot available\b/i, /\bprovider rejected\b/i, /\binvalid\b/i],
        score: 3.5,
      },
    ],
  },
];

function clampScore(value: number) {
  return Number(Math.max(0, Math.min(10, value)).toFixed(1));
}

function verdictForScore(score: number): AuditResult["verdict"] {
  if (score >= 8.5) return "strong";
  if (score >= 6) return "usable";
  if (score >= 4) return "partial";
  return "weak";
}

function matchAny(patterns: RegExp[], text: string) {
  return patterns.some((pattern) => pattern.test(text));
}

function classifyResponse(answer: string, fallbackLabel: string | null): AuditResult["responseClass"] {
  if (!answer.trim()) return "failed";
  if (ackOnlyPatterns.some((pattern) => pattern.test(answer))) return "ack_only";
  if (fallbackLabel) return "graceful_fallback";
  return "direct_answer";
}

function evaluateCase(test: AuditCase, answer: string) {
  const normalized = answer.trim();
  const hits: string[] = [];
  const misses: string[] = [];
  const penalties: string[] = [];
  const totalPoints = Math.max(
    test.criteria.reduce((sum, item) => sum + (item.points ?? 1), 0),
    1,
  );

  let matchedPoints = 0;
  for (const criterion of test.criteria) {
    const matched = matchAny(criterion.patterns, normalized);
    if (matched) {
      hits.push(criterion.label);
      matchedPoints += criterion.points ?? 1;
    } else {
      misses.push(criterion.label);
    }
  }

  let fallbackLabel: string | null = null;
  let fallbackScore = 0;
  for (const fallback of test.acceptableFallbacks ?? []) {
    if (matchAny(fallback.patterns, normalized)) {
      fallbackLabel = fallback.label;
      fallbackScore = Math.max(fallbackScore, fallback.score);
    }
  }

  let score = (matchedPoints / totalPoints) * 10;
  if (matchedPoints === 0 && fallbackLabel) {
    score = fallbackScore;
  }

  if (fallbackLabel) {
    score = Math.min(score, Math.max(fallbackScore, 6));
  }

  if (test.minLength && normalized.length < test.minLength && matchedPoints > 0) {
    penalties.push(`Too short for the feature (${normalized.length} chars)`);
    score -= 1.5;
  }

  for (const penalty of [...commonPenalties, ...(test.penalties ?? [])]) {
    if (matchAny(penalty.patterns, normalized)) {
      penalties.push(penalty.label);
      score -= penalty.penalty;
    }
  }

  if (ackOnlyPatterns.some((pattern) => pattern.test(normalized))) {
    penalties.push("Returned an acknowledgement instead of the final answer");
    score = Math.min(score || 4.5, 4.5);
  }

  if (!normalized) {
    penalties.push("Empty answer");
    score = 0;
  }

  return {
    score: clampScore(score),
    maxScore: 10,
    hits,
    misses,
    penalties,
    fallbackLabel,
    responseClass: classifyResponse(normalized, fallbackLabel),
  };
}

async function main() {
  loadClawCloudEnv();

  const sharedUser = await resolveClawCloudSharedUser({ allowCreateAuditUser: true });
  const sharedUserId = sharedUser.userId;

  const [{ getProviderSnapshot }, agentModule] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/clawcloud-agent"),
  ]);

  const routeInboundAgentMessage =
    (agentModule as { routeInboundAgentMessage?: unknown }).routeInboundAgentMessage
    ?? (agentModule as { default?: { routeInboundAgentMessage?: unknown } }).default?.routeInboundAgentMessage;

  if (typeof routeInboundAgentMessage !== "function") {
    throw new Error("Could not resolve routeInboundAgentMessage from lib/clawcloud-agent.");
  }

  const providerSnapshot = getProviderSnapshot();
  const results: AuditResult[] = [];

  for (const test of cases) {
    const userId = test.userMode === "shared" ? sharedUserId : randomUUID();
    const started = performance.now();

    let answer = "";
    try {
      answer = String(
        await (routeInboundAgentMessage as (userId: string, message: string) => Promise<string | null>)(
          userId,
          test.prompt,
        ) ?? "",
      );
    } catch (error) {
      const elapsedMs = Number((performance.now() - started).toFixed(1));
      results.push({
        id: test.id,
        feature: test.feature,
        area: test.area,
        prompt: test.prompt,
        userMode: test.userMode,
        userIdPrefix: maskUserId(userId),
        elapsedMs,
        elapsedSeconds: Number((elapsedMs / 1000).toFixed(2)),
        score: 0,
        maxScore: 10,
        verdict: "weak",
        responseClass: "failed",
        hits: [],
        misses: test.criteria.map((criterion) => criterion.label),
        penalties: [`Request failed: ${error instanceof Error ? error.message : String(error)}`],
        fallbackLabel: null,
        answer: "",
      });
      continue;
    }

    const elapsedMs = Number((performance.now() - started).toFixed(1));
    const scored = evaluateCase(test, answer);

    results.push({
      id: test.id,
      feature: test.feature,
      area: test.area,
      prompt: test.prompt,
      userMode: test.userMode,
      userIdPrefix: maskUserId(userId),
      elapsedMs,
      elapsedSeconds: Number((elapsedMs / 1000).toFixed(2)),
      score: scored.score,
      maxScore: scored.maxScore,
      verdict: verdictForScore(scored.score),
      responseClass: scored.responseClass,
      hits: scored.hits,
      misses: scored.misses,
      penalties: scored.penalties,
      fallbackLabel: scored.fallbackLabel,
      answer,
    });
  }

  const totals = results.reduce(
    (acc, item) => {
      acc.score += item.score;
      acc.elapsedMs += item.elapsedMs;
      acc.count += 1;
      acc.strong += item.verdict === "strong" ? 1 : 0;
      acc.usable += item.verdict === "usable" ? 1 : 0;
      acc.partial += item.verdict === "partial" ? 1 : 0;
      acc.weak += item.verdict === "weak" ? 1 : 0;
      return acc;
    },
    { score: 0, elapsedMs: 0, count: 0, strong: 0, usable: 0, partial: 0, weak: 0 },
  );

  const byArea = Object.fromEntries(
    ["assistant", "integrations", "core", "live"].map((area) => {
      const areaResults = results.filter((item) => item.area === area);
      const avg = areaResults.length
        ? Number(
          (areaResults.reduce((sum, item) => sum + item.score, 0) / areaResults.length).toFixed(1),
        )
        : 0;
      return [
        area,
        {
          count: areaResults.length,
          averageScore: avg,
          weakFeatures: areaResults
            .filter((item) => item.score < 6)
            .map((item) => item.id),
        },
      ];
    }),
  );

  const report = {
    generatedAt: new Date().toISOString(),
    reportPath,
    sharedUserIdPrefix: maskUserId(sharedUserId),
    sharedUserSource: sharedUser.source,
    staleConfiguredKeys: sharedUser.staleConfiguredKeys,
    providerSnapshot,
    overall: {
      averageScore: Number((totals.score / Math.max(totals.count, 1)).toFixed(1)),
      totalFeatures: totals.count,
      totalElapsedSeconds: Number((totals.elapsedMs / 1000).toFixed(2)),
      averageElapsedSeconds: Number((totals.elapsedMs / Math.max(totals.count, 1) / 1000).toFixed(2)),
      verdicts: {
        strong: totals.strong,
        usable: totals.usable,
        partial: totals.partial,
        weak: totals.weak,
      },
    },
    byArea,
    results,
    notAuditedInThisRun: [
      "Image generation via WhatsApp media server",
      "Voice transcription",
      "Vision/image analysis",
      "Document upload QA",
      "Video processing",
      "URL reader flow",
      "Code runner sandbox",
      "Outbound send-message flow to a real contact",
      "Email drafting with approval dispatch",
    ],
  };

  writeJsonReport(reportPath, report);

  const summary = {
    generatedAt: report.generatedAt,
    reportPath,
    sharedUserIdPrefix: report.sharedUserIdPrefix,
    providerSnapshot,
    overall: report.overall,
    byArea,
    results: results.map((item) => ({
      id: item.id,
      feature: item.feature,
      area: item.area,
      score: item.score,
      verdict: item.verdict,
      responseClass: item.responseClass,
      elapsedSeconds: item.elapsedSeconds,
      fallbackLabel: item.fallbackLabel,
      answerPreview: item.answer.replace(/\s+/g, " ").slice(0, 220),
      misses: item.misses,
      penalties: item.penalties,
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
