import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  loadClawCloudEnv,
  maskUserId,
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

const reportPath = "tmp-clawcloud-feature-audit-medium-hard.json";

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

function formatDateKeyLocal(date = new Date(), timeZone = "Asia/Kolkata") {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);

    const year = parts.find((part) => part.type === "year")?.value ?? "1970";
    const month = parts.find((part) => part.type === "month")?.value ?? "01";
    const day = parts.find((part) => part.type === "day")?.value ?? "01";
    return `${year}-${month}-${day}`;
  } catch {
    return date.toISOString().split("T")[0] ?? "";
  }
}

const cases: AuditCase[] = [
  {
    id: "billing_plan_status",
    feature: "Billing plan status",
    area: "assistant",
    prompt:
      "Give me my exact current plan, today's run usage versus limit, active task limit, and what upgrading would change.",
    userMode: "shared",
    criteria: [
      { label: "States current plan", patterns: [/\bfree\b|\bstarter\b|\bpro\b/i, /\bplan\b/i] },
      { label: "Includes run usage or limit", patterns: [/\bused\b/i, /\bremaining\b/i, /\blimit\b/i, /\b\d+\/\d+\b/] },
      { label: "Mentions upgrade impact", patterns: [/\bupgrade\b/i, /\bmore\b[\s\S]{0,40}\bruns?\b/i, /\bactive tasks?\b/i] },
    ],
    minLength: 120,
  },
  {
    id: "memory_save",
    feature: "Memory save",
    area: "assistant",
    prompt:
      "Remember two things about me: my favorite language is Rust, and I prefer concise bullet summaries.",
    userMode: "shared",
    criteria: [
      { label: "Confirms saving memory", patterns: [/\bsaved\b/i, /\bremember\b/i] },
      { label: "Includes Rust", patterns: [/\brust\b/i] },
      { label: "Includes concise summary preference", patterns: [/\bconcise\b/i, /\bbullet\b/i, /\bsummary\b/i] },
    ],
  },
  {
    id: "memory_show",
    feature: "Memory show",
    area: "assistant",
    prompt:
      "What do you remember about my preferences right now?",
    userMode: "shared",
    criteria: [
      { label: "Returns Rust", patterns: [/\brust\b/i] },
      { label: "Returns concise summary preference", patterns: [/\bconcise\b/i, /\bbullet\b/i] },
      { label: "Shows memory/profile framing", patterns: [/\bmemory\b/i, /\bprofile\b/i, /\bsaved\b/i, /\bpreferences\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "Memory empty but explicit",
        patterns: [/\bdon't know much about you yet\b/i, /\bnothing saved yet\b/i],
        score: 3,
      },
    ],
    penalties: [
      {
        label: "Saved Rust under language preference instead of favorite language",
        patterns: [/\blanguage preference\b[\s\S]{0,40}\brust\b/i],
        penalty: 3,
      },
    ],
  },
  {
    id: "memory_forget",
    feature: "Memory forget",
    area: "assistant",
    prompt:
      "Forget my favorite language and my summary-style preference.",
    userMode: "shared",
    criteria: [
      { label: "Confirms deletion", patterns: [/\bforgot\b/i, /\bremoved\b/i, /\bdeleted\b/i, /\bcleared\b/i, /\bno longer\b/i] },
    ],
  },
  {
    id: "locale_set_hindi",
    feature: "Locale set to Hindi",
    area: "assistant",
    prompt:
      "From now on reply in Hindi unless I explicitly ask for English.",
    userMode: "shared",
    criteria: [
      { label: "Acknowledges Hindi", patterns: [/\bhindi\b/i, /[\u0900-\u097F]/] },
    ],
  },
  {
    id: "locale_show",
    feature: "Locale show",
    area: "assistant",
    prompt: "What language are you set to for me right now?",
    userMode: "shared",
    criteria: [
      { label: "Shows active language", patterns: [/\bhindi\b/i, /[\u0900-\u097F]/] },
    ],
  },
  {
    id: "locale_reset_english",
    feature: "Locale reset to English",
    area: "assistant",
    prompt: "Switch back to English and confirm it clearly.",
    userMode: "shared",
    criteria: [
      { label: "Acknowledges English", patterns: [/\benglish\b/i] },
    ],
  },
  {
    id: "reminder_set",
    feature: "Reminder set",
    area: "assistant",
    prompt:
      "Set a reminder for 2 hours 15 minutes from now to send the monthly GST summary to finance.",
    userMode: "shared",
    criteria: [
      { label: "Confirms reminder", patterns: [/\breminder\b/i, /\bgst summary\b/i, /\bfinance\b/i] },
      { label: "Includes timing", patterns: [/\b2\b/i, /\b15\b/i, /\bhour\b|\bminute\b/i, /\bam\b|\bpm\b/i] },
    ],
    minLength: 90,
  },
  {
    id: "reminder_list",
    feature: "Reminder list",
    area: "assistant",
    prompt:
      "List my active reminders with time and task.",
    userMode: "shared",
    criteria: [
      { label: "Lists reminder text", patterns: [/\bgst summary\b/i, /\bfinance\b/i] },
      { label: "Shows reminder framing", patterns: [/\breminder\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "No reminders but explicit",
        patterns: [/\bno active reminders\b/i, /\bdo not have any active reminders\b/i],
        score: 3,
      },
    ],
  },
  {
    id: "reminder_cancel_all",
    feature: "Reminder cancel all",
    area: "assistant",
    prompt:
      "Cancel all my reminders and tell me how many were removed.",
    userMode: "shared",
    criteria: [
      { label: "Confirms cancellation", patterns: [/\bcancelled\b/i, /\bremoved\b/i, /\bcleared\b/i] },
      { label: "Mentions count or all", patterns: [/\ball\b/i, /\b\d+\b/] },
    ],
    acceptableFallbacks: [
      {
        label: "No reminders to cancel but explicit",
        patterns: [/\bno active reminders\b/i, /\bnothing to cancel\b/i],
        score: 4,
      },
    ],
  },
  {
    id: "drive_list",
    feature: "Google Drive listing",
    area: "integrations",
    prompt:
      "List my 5 most recently modified Google Drive files and when each was last updated.",
    userMode: "shared",
    criteria: [
      { label: "Returns Drive files", patterns: [/\bgoogle drive\b/i, /\bmodified\b/i, /\bfile\b/i] },
      { label: "Includes multiple items or timestamps", patterns: [/\b1\b|\b2\b|\b3\b/i, /\bago\b|\bupdated\b|\bmodified\b/i] },
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
    prompt:
      "Give me today's calendar with start times, meeting titles, and any free gap longer than 30 minutes.",
    userMode: "shared",
    criteria: [
      { label: "Returns schedule details", patterns: [/\btoday\b/i, /\bmeeting\b|\bevent\b/i, /\b\d{1,2}:\d{2}\b/] },
      { label: "Mentions free gap or clear schedule", patterns: [/\bfree gap\b/i, /\bclear\b/i, /\bno meetings\b/i] },
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
    prompt:
      "Find unread emails from Raj from the last 7 days and give me the subject plus a one-line summary for each.",
    userMode: "shared",
    criteria: [
      { label: "Returns inbox results", patterns: [/\bsubject\b/i, /\bfrom:\b/i, /\bsummary\b|\bsnippet\b/i] },
      { label: "Mentions Raj or sender framing", patterns: [/\braj\b/i, /\bfrom\b/i] },
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
    prompt:
      "Using my connected data, summarize my last 30 days of spending by total amount and top categories.",
    userMode: "shared",
    criteria: [
      { label: "Mentions 30-day spending", patterns: [/\blast 30 days\b/i, /\bspent\b/i] },
      { label: "Includes money amount", patterns: [/\b₹|\brs\b|\binr\b/i] },
      { label: "Mentions categories or breakdown", patterns: [/\bcategory\b|\bbreakdown\b|\btop\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "No spending data found",
        patterns: [/\bno transactions found\b/i, /\bcould not find enough spending data\b/i],
        score: 5,
      },
    ],
    minLength: 120,
  },
  {
    id: "coding_nqueens",
    feature: "Coding",
    area: "core",
    prompt:
      "Write Python code for N-Queens that returns all solutions, and briefly explain the pruning strategy and time complexity.",
    userMode: "fresh",
    criteria: [
      { label: "Returns Python code", patterns: [/```python/i, /\bdef\b/i] },
      { label: "Mentions pruning/backtracking", patterns: [/\bbacktracking\b|\bprun(?:e|ing)\b|\bdfs\b/i] },
      { label: "Mentions complexity", patterns: [/\btime complexity\b/i, /\bcomplexity\b/i, /\bO\(/i] },
    ],
    minLength: 260,
  },
  {
    id: "math_discount_chain",
    feature: "Math",
    area: "core",
    prompt:
      "A laptop priced at Rs 84,000 gets successive discounts of 15% and 12%. What is the final price and total discount amount? Show the working.",
    userMode: "fresh",
    criteria: [
      { label: "Gets final price 62832", patterns: [/\b62832\b/, /\b62,832\b/] },
      { label: "Gets total discount 21168", patterns: [/\b21168\b/, /\b21,168\b/] },
      { label: "Shows working", patterns: [/\b15%\b/i, /\b12%\b/i, /\bcalculation\b|\bworking\b|\bafter\b/i] },
    ],
    minLength: 120,
  },
  {
    id: "explain_ai_ml_dl",
    feature: "Explain concepts",
    area: "core",
    prompt:
      "Explain AI vs ML vs deep learning in simple terms, give one real product example, and tell me when deep learning would be overkill.",
    userMode: "fresh",
    criteria: [
      { label: "Mentions AI", patterns: [/\bai\b/i] },
      { label: "Mentions machine learning", patterns: [/\bmachine learning\b|\bml\b/i] },
      { label: "Mentions deep learning", patterns: [/\bdeep learning\b/i] },
      { label: "Includes relationship framing", patterns: [/\bsubset\b/i, /\bpart of\b/i, /\bwithin\b/i] },
      { label: "Includes example or overkill note", patterns: [/\bexample\b/i, /\boverkill\b/i, /\bnot necessary\b/i] },
    ],
    minLength: 180,
  },
  {
    id: "translation_hindi",
    feature: "Translation",
    area: "core",
    prompt:
      "Translate this into natural Hindi: 'Please send the revised contract before tomorrow 10 AM, otherwise we will postpone the signing.'",
    userMode: "fresh",
    criteria: [
      { label: "Contains Hindi script", patterns: [/[\u0900-\u097F]/] },
      { label: "Looks like a full sentence", patterns: [/[।.]/, /\s[\u0900-\u097F]{2,}\s[\u0900-\u097F]{2,}/] },
    ],
    minLength: 30,
  },
  {
    id: "research_compare",
    feature: "Research comparison",
    area: "core",
    prompt:
      "For a production research agent that must cite sources, compare Tavily vs SerpAPI on freshness, control, latency, and operational risk, then recommend one.",
    userMode: "fresh",
    criteria: [
      { label: "Mentions Tavily", patterns: [/\btavily\b/i] },
      { label: "Mentions SerpAPI", patterns: [/\bserpapi\b/i] },
      { label: "Covers trade-off dimensions", patterns: [/\bfreshness\b/i, /\blatency\b/i, /\brisk\b|\boperational\b/i] },
      { label: "Makes a recommendation", patterns: [/\brecommend\b/i, /\bbest\b/i] },
    ],
    minLength: 220,
  },
  {
    id: "news_latest_ai",
    feature: "Latest news",
    area: "live",
    prompt:
      "What are the 3 most important AI developments this week for a startup founder, and why does each one matter?",
    userMode: "fresh",
    criteria: [
      { label: "Gives multiple updates", patterns: [/\b1\b|\b2\b|\b3\b/i, /\bthis week\b|\blatest\b|\brecent\b/i] },
      { label: "References concrete entities or products", patterns: [/\bopenai\b|\bgoogle\b|\bmeta\b|\banthropic\b|\bgemini\b/i] },
      { label: "Includes why it matters", patterns: [/\bmatters\b/i, /\bimpact\b/i, /\bstartup\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "Low-confidence live-news fallback",
        patterns: [/\bcould not verify enough reliable live news coverage\b/i, /\bnot enough reliable live news\b/i],
        score: 3.5,
      },
    ],
    minLength: 220,
  },
  {
    id: "web_search_population",
    feature: "Web search",
    area: "live",
    prompt:
      "Search the web and tell me Japan's current population using the latest reliable estimate, with source context.",
    userMode: "fresh",
    criteria: [
      { label: "Mentions Japan", patterns: [/\bjapan\b/i] },
      { label: "Provides population figure", patterns: [/\b1\d{2}(?:[.,]\d+)?\s*(million|mn)\b/i, /\b12[0-9],[0-9]{3},[0-9]{3}\b/] },
      { label: "Shows source context", patterns: [/\bsource\b|\bas of\b|\baccording to\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "No live data fallback",
        patterns: [/\blive data\b/i, /\bcould not verify\b/i, /\bretry shortly\b/i],
        score: 3.5,
      },
    ],
    minLength: 120,
  },
  {
    id: "finance_btc",
    feature: "Finance: crypto",
    area: "live",
    prompt:
      "What is BTC spot price today in USD and INR, and what short caution should I keep in mind before trading?",
    userMode: "fresh",
    criteria: [
      { label: "Mentions BTC or Bitcoin", patterns: [/\bbtc\b|\bbitcoin\b/i] },
      { label: "Provides USD price", patterns: [/\$\s?\d[\d,]*(?:\.\d+)?/] },
      { label: "Provides INR price or INR framing", patterns: [/\b₹\s?\d[\d,]*(?:\.\d+)?/i, /\binr\b/i] },
      { label: "Includes caution", patterns: [/\bnot financial advice\b/i, /\bverify before trading\b/i, /\bvolatil/i] },
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
        label: "Answered with a Bitcoin ETF instead of BTC spot",
        patterns: [/\betf\b/i, /\btrust\b/i],
        penalty: 3,
      },
    ],
  },
  {
    id: "finance_reliance",
    feature: "Finance: Indian stock",
    area: "live",
    prompt:
      "What is Reliance Industries share price today, and what is the intraday move if available?",
    userMode: "fresh",
    criteria: [
      { label: "Mentions Reliance", patterns: [/\breliance\b/i] },
      { label: "Provides a numeric price", patterns: [/\b₹\s?\d[\d,]*(?:\.\d+)?/i, /\brs\.?\s?\d[\d,]*(?:\.\d+)?\b/i, /\b\d[\d,]*(?:\.\d+)?\s*INR\b/i] },
      { label: "Mentions move or change", patterns: [/\bup\b|\bdown\b|\bchange\b|\bintraday\b|\b%\b/i] },
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
    prompt:
      "An invoice total is Rs 1180 inclusive of 18% GST. What are the taxable value and GST amount?",
    userMode: "fresh",
    criteria: [
      { label: "Mentions GST", patterns: [/\bgst\b/i] },
      { label: "Gets taxable value 1000", patterns: [/\b1000(?:\.00)?\b/i, /\b1,000(?:\.00)?\b/i] },
      { label: "Gets GST amount 180", patterns: [/\b180(?:\.00)?\b/i] },
      { label: "Frames inclusive calculation", patterns: [/\binclusive\b/i, /\btaxable\b|\bbase price\b/i] },
    ],
    minLength: 100,
  },
  {
    id: "holiday_onam",
    feature: "Holiday lookup",
    area: "live",
    prompt:
      "When is Onam in Kerala in 2025 and 2026?",
    userMode: "fresh",
    criteria: [
      { label: "Mentions Onam", patterns: [/\bonam\b/i] },
      { label: "Mentions Kerala", patterns: [/\bkerala\b/i] },
      { label: "Includes both years", patterns: [/\b2025\b/, /\b2026\b/] },
    ],
  },
  {
    id: "weather_delhi",
    feature: "Weather lookup",
    area: "live",
    prompt:
      "What's the weather in Delhi right now, including temperature and rain chances if available?",
    userMode: "fresh",
    criteria: [
      { label: "Mentions Delhi", patterns: [/\bdelhi\b/i] },
      { label: "Includes temperature", patterns: [/\btemperature\b/i, /\b\d+\s?(?:°c|c)\b/i] },
      { label: "Mentions weather conditions", patterns: [/\brain\b|\bhumidity\b|\bcloud\b|\bcondition\b/i] },
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
    prompt:
      "What is the latest India cricket score, including opponent and match state?",
    userMode: "fresh",
    criteria: [
      { label: "Mentions India or opponent", patterns: [/\bindia\b/i, /\bvs\b/i] },
      { label: "Includes score-style numbers", patterns: [/\b\d+\/\d+\b/, /\bovers?\b/i, /\bruns?\b/i] },
      { label: "Mentions match state", patterns: [/\bneed\b|\brequire\b|\bwon\b|\btrail\b|\blead\b|\bat stumps\b|\bin progress\b/i] },
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
    prompt:
      "Give me the key schedule details for train 12002, including origin, destination, and major timings.",
    userMode: "fresh",
    criteria: [
      { label: "Recognizes train number", patterns: [/\b12002\b/] },
      { label: "Mentions origin or destination", patterns: [/\borigin\b|\bdestination\b|\bstation\b/i] },
      { label: "Includes time details", patterns: [/\bdeparture\b|\barrival\b|\b\d{1,2}:\d{2}\b/i] },
    ],
    acceptableFallbacks: [
      {
        label: "Train data unavailable",
        patterns: [/\bcould not fetch\b/i, /\btry again\b/i, /\bnot available\b/i, /\bprovider rejected\b/i, /\binvalid\b/i],
        score: 3.5,
      },
    ],
    minLength: 100,
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

  const sharedUserId = (
    process.env.CLAWCLOUD_AUDIT_USER_ID
    || process.env.WHATSAPP_AUTO_TEST_USER_ID
    || ""
  ).trim();
  if (!sharedUserId) {
    throw new Error("Missing CLAWCLOUD_AUDIT_USER_ID / WHATSAPP_AUTO_TEST_USER_ID in env.");
  }

  const [{ getProviderSnapshot }, agentModule] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/clawcloud-agent"),
  ]);
  const { getClawCloudSupabaseAdmin } = await import("@/lib/clawcloud-supabase");

  const routeInboundAgentMessage =
    (agentModule as { routeInboundAgentMessage?: unknown }).routeInboundAgentMessage
    ?? (agentModule as { default?: { routeInboundAgentMessage?: unknown } }).default?.routeInboundAgentMessage;

  if (typeof routeInboundAgentMessage !== "function") {
    throw new Error("Could not resolve routeInboundAgentMessage from lib/clawcloud-agent.");
  }

  const providerSnapshot = getProviderSnapshot();
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const today = formatDateKeyLocal();

  const { data: originalAnalytics } = await supabaseAdmin
    .from("analytics_daily")
    .select("*")
    .eq("user_id", sharedUserId)
    .eq("date", today)
    .maybeSingle();

  if (originalAnalytics) {
    await supabaseAdmin
      .from("analytics_daily")
      .update({ tasks_run: 0, wa_messages_sent: 0, emails_processed: 0, drafts_created: 0, minutes_saved: 0 })
      .eq("user_id", sharedUserId)
      .eq("date", today);
  } else {
    await supabaseAdmin
      .from("analytics_daily")
      .upsert({
        user_id: sharedUserId,
        date: today,
        tasks_run: 0,
        wa_messages_sent: 0,
        emails_processed: 0,
        drafts_created: 0,
        minutes_saved: 0,
      }, { onConflict: "user_id,date" });
  }

  const results: AuditResult[] = [];

  try {
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
  } finally {
    if (originalAnalytics) {
      await supabaseAdmin
        .from("analytics_daily")
        .upsert(originalAnalytics, { onConflict: "user_id,date" });
    } else {
      await supabaseAdmin
        .from("analytics_daily")
        .delete()
        .eq("user_id", sharedUserId)
        .eq("date", today);
    }
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
    providerSnapshot,
    profile: "medium-hard",
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
    notes: [
      "Shared-user analytics_daily row for the day was restored after the audit.",
      "State-changing tests still exercised the real shared user for memory, locale, reminders, and integrations.",
    ],
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
    profile: report.profile,
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
      answerPreview: item.answer.replace(/\s+/g, " ").slice(0, 240),
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
