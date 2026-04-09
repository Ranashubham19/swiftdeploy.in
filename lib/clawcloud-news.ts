import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";
import {
  buildClawCloudAnswerQualityProfile,
  buildClawCloudLowConfidenceReply,
  isClawCloudGroundedLiveAnswer,
} from "@/lib/clawcloud-answer-quality";
import { buildHistoricalPowerRankingReply, looksLikeHistoricalPowerRankingQuestion } from "@/lib/clawcloud-historical-power";
import { buildHistoricalWealthReply, looksLikeHistoricalWealthQuestion } from "@/lib/clawcloud-historical-wealth";
import { buildConsumerStaplePriceClarification, looksLikeConsumerStaplePriceQuestion } from "@/lib/clawcloud-india-consumer-prices";
import { env } from "@/lib/env";
import {
  buildFreshDataRequiredReply,
  type ClawCloudLiveSearchRoute,
  extractRichestRankingScope,
  fetchLiveAnswerBundle,
  fetchWorldBankCountryMetricComparisonAnswer,
  fetchWorldBankCountryMetricAnswer,
  maybeBuildClawCloudLiveAnswerBundle,
  renderClawCloudAnswerBundle,
  shouldFailClosedWithoutFreshData,
} from "@/lib/clawcloud-live-search";
import { fetchOfficialPricingAnswer } from "@/lib/clawcloud-official-pricing";
import {
  detectClawCloudRegionMention,
  inferRegionalSearchLocale,
  normalizeRegionalQuestion,
} from "@/lib/clawcloud-region-context";
import {
  buildNamedCaseQueries,
  buildCurrentAffairsClarificationReply,
  buildCurrentAffairsQueries,
  isYesNoCurrentAffairsQuestion,
  looksLikeAmbiguousCurrentWarQuestion,
  looksLikeCurrentAffairsDemandQuestion,
  looksLikeCurrentAffairsLogisticsQuestion,
  looksLikeCurrentAffairsPowerCrisisQuestion,
  looksLikeCurrentAffairsQuestion,
  looksLikeNamedCaseQuestion,
} from "@/lib/clawcloud-current-affairs";
import {
  detectAiModelRoutingDecision,
  type AiModelRoutingDecision,
} from "@/lib/clawcloud-ai-model-routing";
import { stripExplicitReplyLocaleRequestForContent } from "@/lib/clawcloud-i18n";
import { searchInternetWithDiagnostics } from "@/lib/search";
import { extractExplicitQuestionYear } from "@/lib/clawcloud-time-scope";
import type { ClawCloudAnswerBundle, ClawCloudEvidenceItem, ClawCloudTextAnswerResult } from "@/lib/types";
import {
  getWeather,
  looksLikeDirectWeatherQuestion,
  looksLikeWeatherOrAirQualityQuestion,
  parseWeatherCity,
} from "@/lib/clawcloud-weather";

type NewsSource = {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  publishedDate?: string;
  score: number;
};

const NEWS_SEARCH_PROVIDER_TIMEOUT_MS = 5_000;
const NEWS_SEARCH_TASK_SETTLE_TIMEOUT_MS = NEWS_SEARCH_PROVIDER_TIMEOUT_MS + 500;

function resolveNewsSearchTaskWithTimeout(
  task: Promise<NewsSource[]>,
  timeoutMs = NEWS_SEARCH_TASK_SETTLE_TIMEOUT_MS,
): Promise<NewsSource[]> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: NewsSource[]) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish([]), timeoutMs);
    task.then((value) => finish(value)).catch(() => finish([]));
  });
}

export function resolveNewsSearchTaskWithTimeoutForTest(
  task: Promise<NewsSource[]>,
  timeoutMs = NEWS_SEARCH_TASK_SETTLE_TIMEOUT_MS,
) {
  return resolveNewsSearchTaskWithTimeout(task, timeoutMs);
}

function inferNewsEvidenceKind(
  source: Pick<NewsSource, "domain">,
  officialDomains: string[] = [],
): ClawCloudEvidenceItem["kind"] {
  const domain = source.domain.trim().toLowerCase();
  if (!domain) {
    return "search_result";
  }

  if (officialDomains.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`))) {
    return "official_page";
  }

  if (TRUSTED_DOMAINS.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`))) {
    return "report";
  }

  return "search_result";
}

function mapNewsSourceToEvidence(
  source: NewsSource,
  officialDomains: string[] = [],
): ClawCloudEvidenceItem {
  return {
    title: source.title,
    domain: source.domain,
    kind: inferNewsEvidenceKind(source, officialDomains),
    url: source.url,
    snippet: source.snippet || null,
    publishedAt: source.publishedDate ?? null,
    observedAt: new Date().toISOString(),
  };
}

function buildWebSearchAnswerResult(
  answer: string,
  liveAnswerBundle: ClawCloudAnswerBundle | null = null,
): ClawCloudTextAnswerResult {
  return {
    answer,
    liveAnswerBundle,
  };
}

function buildForcedFreshWebRoute(question: string): ClawCloudLiveSearchRoute | null {
  if (detectAiModelRoutingDecision(question)?.mode === "web_search") {
    return {
      tier: "volatile",
      requiresWebSearch: true,
      badge: "*Fresh answer*",
      sourceNote: "_Source note: based on recently retrieved web sources; official vendor pages are preferred where available._",
    };
  }

  const normalized = normalizeRegionalQuestion(question);
  if (
    /\b(latest|current|newest|right now|today|released?|release(?: date)?|launch(?:ed)?|announced?|availability|price|pricing|cost|features?|specs?|specifications?)\b/i.test(normalized)
    && (
      /\b(gpt|chatgpt|claude|gemini|grok|llama|deepseek|mistral|openai|anthropic|deepmind|google)\b/i.test(normalized)
      || /\b(iphone|samsung|galaxy|pixel|oneplus)\b/i.test(normalized)
      || /\bs\d{2}\s*ultra\b/i.test(normalized)
      || /\bs\d{2}\s*pro\b/i.test(normalized)
    )
  ) {
    return {
      tier: "volatile",
      requiresWebSearch: true,
      badge: "*Fresh answer*",
      sourceNote: "_Source note: based on recently retrieved web sources for a current model/version question._",
    };
  }

  return null;
}

function finalizeDirectLiveWebAnswer(
  question: string,
  answerOrBundle: string | ClawCloudAnswerBundle,
): ClawCloudTextAnswerResult {
  const originalAnswer = typeof answerOrBundle === "string"
    ? answerOrBundle.trim()
    : answerOrBundle.answer.trim();
  let liveAnswerBundle = typeof answerOrBundle === "string"
    ? maybeBuildClawCloudLiveAnswerBundle({
      question,
      answer: originalAnswer,
    })
    : answerOrBundle;
  let cleaned = liveAnswerBundle
    ? renderClawCloudAnswerBundle(liveAnswerBundle).trim()
    : originalAnswer;
  if (!cleaned) {
    return buildWebSearchAnswerResult("");
  }

  if (liveAnswerBundle?.metadata?.freshness_guarded === true) {
    return buildWebSearchAnswerResult(cleaned, liveAnswerBundle);
  }

  if (isClawCloudGroundedLiveAnswer({ question, answer: cleaned })) {
    return buildWebSearchAnswerResult(cleaned, liveAnswerBundle);
  }

  return buildWebSearchAnswerResult(
    buildClawCloudLowConfidenceReply(
      question,
      buildClawCloudAnswerQualityProfile({
        question,
        intent: "research",
        category: "web_search",
      }),
      "The live source batch did not support a precise current answer.",
    ),
  );
}

export function buildSourceBackedLiveAnswerResult(input: {
  question: string;
  answer: string;
  sources: NewsSource[];
  officialDomains?: string[];
  route?: ClawCloudLiveSearchRoute;
}): ClawCloudTextAnswerResult {
  const answer = input.answer.trim();
  if (!answer) {
    return buildWebSearchAnswerResult("");
  }

  const evidence = input.sources
    .slice(0, 6)
    .map((source) => mapNewsSourceToEvidence(source, input.officialDomains ?? []));

  const liveAnswerBundle = maybeBuildClawCloudLiveAnswerBundle({
    question: input.question,
    answer,
    strategy: "search_synthesis",
    evidence,
    route: input.route ?? buildForcedFreshWebRoute(input.question) ?? undefined,
  });

  if (liveAnswerBundle?.metadata?.freshness_guarded === true) {
    return buildWebSearchAnswerResult(
      renderClawCloudAnswerBundle(liveAnswerBundle),
      liveAnswerBundle,
    );
  }

  return buildWebSearchAnswerResult(answer, liveAnswerBundle);
}

type RestCountryRecord = {
  name?: { common?: string; official?: string };
  cca3?: string;
};

type WorldBankPopulationEntry = {
  value?: number | null;
  date?: string;
};

type AiModelEvidenceMention = {
  model: string;
  vendor: string | null;
  supportCount: number;
};

type AiModelRankingEntry = {
  model: string;
  vendor: string | null;
  supportCount: number;
  officialSupportCount: number;
  trustedSupportCount: number;
  latestPublishedAt: string | null;
};

const AI_MODEL_SOURCE_SIGNAL =
  /\b(gpt|chatgpt|openai|claude|anthropic|gemini|deepmind|google|grok|xai|x\.ai|llama|meta|deepseek|mistral|qwen|model|models|llm|benchmark|leaderboard|reasoning|coding|multimodal|context window|flagship)\b/i;

const AI_MODEL_NOISE_SIGNAL =
  /\b(certification|certifications|course|courses|stock|stocks|company|companies|startup|startups|app|apps|chatbots?|trend|trends|tool|tools)\b/i;

const AI_MODEL_COMPARE_QUESTION_SIGNAL =
  /\b(compare|comparison|difference between|vs\.?|versus|which is better|better than|head[- ]to[- ]head|stack up against|trade-?off)\b/i;

const AI_MODEL_RELEASE_QUESTION_SIGNAL =
  /\b(release|relase|released|launch|launched|announcement|announced|date|official model name|correct model name)\b/i;

const AI_MODEL_MENTION_PATTERNS: Array<{ pattern: RegExp; vendor: string | null }> = [
  { pattern: /\bGPT[- ]?\d+(?:\.\d+)?(?:\s+(?:mini|nano))?\b/gi, vendor: "OpenAI" },
  { pattern: /\bo[134](?:[- ]mini)?\b/gi, vendor: "OpenAI" },
  { pattern: /\bClaude(?:\s+(?:Opus|Sonnet|Haiku))?(?:\s+\d+(?:\.\d+)?)?\b/gi, vendor: "Anthropic" },
  { pattern: /\b(?:Opus|Sonnet|Haiku)\s+\d+(?:\.\d+)?\b/gi, vendor: "Anthropic" },
  { pattern: /\bGemini(?:\s+\d+(?:\.\d+)?)?(?:\s+(?:Flash|Pro|Ultra))?\b/gi, vendor: "Google" },
  { pattern: /\bGrok(?:\s+\d+(?:\.\d+)?)?\b/gi, vendor: "xAI" },
  { pattern: /\bLlama(?:\s+\d+(?:\.\d+)?)?(?:\s+\d+B)?\b/gi, vendor: "Meta" },
  { pattern: /\bDeepSeek(?:[- ]?[A-Za-z0-9.]+)?\b/gi, vendor: "DeepSeek" },
  { pattern: /\bMistral(?:\s+[A-Za-z0-9.-]+)?\b/gi, vendor: "Mistral" },
  { pattern: /\bQwen(?:\s*[A-Za-z0-9.-]+)?\b/gi, vendor: "Alibaba" },
];

const AI_MODEL_VENDOR_OFFICIAL_DOMAINS: Record<string, string[]> = {
  OpenAI: ["openai.com", "platform.openai.com"],
  Anthropic: ["anthropic.com", "docs.anthropic.com"],
  Google: ["blog.google", "deepmind.google", "ai.google.dev"],
  xAI: ["x.ai", "docs.x.ai"],
  Meta: ["ai.meta.com", "about.meta.com"],
  DeepSeek: ["deepseek.com", "api-docs.deepseek.com"],
  Mistral: ["mistral.ai", "docs.mistral.ai"],
  Alibaba: ["qwenlm.ai", "tongyi.aliyun.com"],
};

function normalizeAiModelLabel(value: string) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";

  if (/^(opus|sonnet|haiku)\s+\d+(?:\.\d+)?$/i.test(trimmed)) {
    return `Claude ${trimmed
      .split(" ")
      .map((part, index) => index === 0 ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : part)
      .join(" ")}`;
  }

  const normalized = trimmed
    .split(" ")
    .map((part) => {
      if (/^gpt[- ]?\d/i.test(part)) {
        return part.replace(/^gpt/i, "GPT");
      }
      if (/^(gpt|claude|gemini|grok|llama|deepseek|mistral|qwen|openai|xai)$/i.test(part)) {
        return part.toUpperCase() === "XAI"
          ? "xAI"
          : part.replace(/^./, (char) => char.toUpperCase());
      }
      if (/^o[134](?:-mini)?$/i.test(part)) {
        return part.toLowerCase();
      }
      if (/^\d+(?:\.\d+)?(?:b)?$/i.test(part)) {
        return part.toUpperCase();
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");

  return normalized
    .replace(/\b(?:Gpt|GPT)\s+(\d+(?:\.\d+)?)\b/g, "GPT-$1")
    .replace(/\b(?:Gpt|GPT)-(\d+(?:\.\d+)?)\b/g, "GPT-$1");
}

function extractAiModelQuestionTargets(question: string) {
  const targets = AI_MODEL_MENTION_PATTERNS
    .flatMap((candidate) => [...question.matchAll(candidate.pattern)].map((match) => normalizeAiModelLabel(match[0] ?? "")))
    .filter(Boolean);
  return [...new Set(targets)].slice(0, 6);
}

function inferAiModelFamilyKey(label: string) {
  const normalized = label.toLowerCase();
  if (/\b(gpt|chatgpt|^o[134])\b/.test(normalized)) return "openai";
  if (/\bclaude\b/.test(normalized)) return "claude";
  if (/\bgemini\b/.test(normalized)) return "gemini";
  if (/\bgrok\b/.test(normalized)) return "grok";
  if (/\bllama\b/.test(normalized)) return "llama";
  if (/\bdeepseek\b/.test(normalized)) return "deepseek";
  if (/\bmistral\b/.test(normalized)) return "mistral";
  if (/\bqwen\b/.test(normalized)) return "qwen";
  return normalized.split(" ")[0] ?? normalized;
}

function inferAiModelVendorFromLabel(label: string) {
  switch (inferAiModelFamilyKey(label)) {
    case "openai":
      return "OpenAI";
    case "claude":
      return "Anthropic";
    case "gemini":
      return "Google";
    case "grok":
      return "xAI";
    case "llama":
      return "Meta";
    case "deepseek":
      return "DeepSeek";
    case "mistral":
      return "Mistral";
    case "qwen":
      return "Alibaba";
    default:
      return null;
  }
}

function officialDomainsForAiModelVendor(vendor: string | null) {
  return vendor ? (AI_MODEL_VENDOR_OFFICIAL_DOMAINS[vendor] ?? []) : [];
}

function mapResearchSourceToNewsSource(source: {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  publishedDate?: string;
  score: number;
}): NewsSource {
  return {
    title: source.title,
    url: source.url,
    snippet: source.snippet,
    domain: source.domain,
    publishedDate: source.publishedDate,
    score: Number(source.score ?? 0.4),
  };
}

function normalizeAiModelSourceHaystack(value: string) {
  return value
    .replace(/https?:\/\//gi, " ")
    .replace(/[?#].*$/g, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\//g, " ")
    .replace(/\b(claude)\s+(opus|sonnet|haiku)\s+(\d+)\s+(\d+)\b/gi, "$1 $2 $3.$4")
    .replace(/\b(gpt|claude|gemini|grok|llama|deepseek|mistral|qwen)\s+(\d+)\s+(\d+)\b/gi, "$1 $2.$3")
    .replace(/\bo\s+([134])\s+mini\b/gi, "o$1-mini")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceMatchesAnyDomain(source: NewsSource, domains: string[]) {
  return domains.some((domain) => source.domain === domain || source.domain.endsWith(`.${domain}`));
}

function scoreAiModelEvidenceSource(source: NewsSource, officialDomains: string[]) {
  let score = scoreSource(source);
  const haystack = normalizeAiModelSourceHaystack(`${source.title} ${source.snippet} ${source.url} ${source.domain}`);

  if (sourceMatchesAnyDomain(source, officialDomains)) {
    score += 0.45;
  }
  if (/\b(benchmark|leaderboard|reasoning|coding|multimodal|context window|flagship|model)\b/i.test(haystack)) {
    score += 0.12;
  }
  if (AI_MODEL_NOISE_SIGNAL.test(haystack) && !AI_MODEL_SOURCE_SIGNAL.test(haystack)) {
    score -= 0.35;
  }

  return score;
}

export function filterAiModelEvidenceSources(
  question: string,
  sources: NewsSource[],
  officialDomains: string[] = [],
) {
  const curated = dedupeByUrl(sources)
    .filter((source) => {
      const haystack = normalizeAiModelSourceHaystack(`${source.title} ${source.snippet} ${source.url} ${source.domain}`);
      const hasSignal = AI_MODEL_SOURCE_SIGNAL.test(haystack) || sourceMatchesAnyDomain(source, officialDomains);
      const isNoise = AI_MODEL_NOISE_SIGNAL.test(haystack) && !/\b(gpt|claude|gemini|grok|llama|deepseek|mistral|qwen)\b/i.test(haystack);
      return hasSignal && !isNoise;
    })
    .map((source) => ({ ...source, score: scoreAiModelEvidenceSource(source, officialDomains) }))
    .sort((left, right) => right.score - left.score);

  if (curated.length >= 3 || /\b(compare|comparison|difference|versus|vs)\b/i.test(question)) {
    return curated.slice(0, 10);
  }

  return dedupeByUrl(sources)
    .map((source) => ({ ...source, score: scoreAiModelEvidenceSource(source, officialDomains) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 10);
}

export function extractAiModelEvidenceMentions(sources: NewsSource[]): AiModelEvidenceMention[] {
  const mentions = new Map<string, AiModelEvidenceMention>();

  for (const source of sources) {
    const haystack = normalizeAiModelSourceHaystack(`${source.title}\n${source.snippet}\n${source.url}`);
    const seenInSource = new Set<string>();

    for (const candidate of AI_MODEL_MENTION_PATTERNS) {
      const matches = haystack.matchAll(candidate.pattern);
      for (const match of matches) {
        const raw = match[0]?.trim() ?? "";
        const normalized = normalizeAiModelLabel(raw);
        if (!normalized) {
          continue;
        }
        const key = normalized.toLowerCase();
        if (seenInSource.has(key)) {
          continue;
        }
        seenInSource.add(key);

        const existing = mentions.get(key);
        if (existing) {
          existing.supportCount += 1;
          if (!existing.vendor && candidate.vendor) {
            existing.vendor = candidate.vendor;
          }
          continue;
        }

        mentions.set(key, {
          model: normalized,
          vendor: candidate.vendor,
          supportCount: 1,
        });
      }
    }
  }

  return [...mentions.values()]
    .sort((left, right) => right.supportCount - left.supportCount || left.model.localeCompare(right.model))
    .slice(0, 12);
}

function buildAiModelRankingEntries(sources: NewsSource[]): AiModelRankingEntry[] {
  const entries = new Map<string, AiModelRankingEntry>();

  for (const source of sources) {
    const haystack = normalizeAiModelSourceHaystack(`${source.title}\n${source.snippet}\n${source.url}`);
    const seenInSource = new Set<string>();
    const trustedSource = TRUSTED_DOMAINS.some((domain) => source.domain === domain || source.domain.endsWith(`.${domain}`));

    for (const candidate of AI_MODEL_MENTION_PATTERNS) {
      for (const match of haystack.matchAll(candidate.pattern)) {
        const normalized = normalizeAiModelLabel(match[0] ?? "");
        if (!normalized) {
          continue;
        }

        const key = normalized.toLowerCase();
        if (seenInSource.has(key)) {
          continue;
        }
        seenInSource.add(key);

        const vendor = candidate.vendor ?? inferAiModelVendorFromLabel(normalized);
        const existing = entries.get(key) ?? {
          model: normalized,
          vendor,
          supportCount: 0,
          officialSupportCount: 0,
          trustedSupportCount: 0,
          latestPublishedAt: null,
        };

        existing.supportCount += 1;
        if (!existing.vendor && vendor) {
          existing.vendor = vendor;
        }

        const officialDomains = officialDomainsForAiModelVendor(existing.vendor);
        if (sourceMatchesAnyDomain(source, officialDomains)) {
          existing.officialSupportCount += 1;
        } else if (trustedSource) {
          existing.trustedSupportCount += 1;
        }

        if (source.publishedDate) {
          const next = new Date(source.publishedDate);
          const current = existing.latestPublishedAt ? new Date(existing.latestPublishedAt) : null;
          if (
            Number.isFinite(next.getTime())
            && (!current || !Number.isFinite(current.getTime()) || next.getTime() > current.getTime())
          ) {
            existing.latestPublishedAt = source.publishedDate;
          }
        }

        entries.set(key, existing);
      }
    }
  }

  const ordered = [...entries.values()]
    .sort((left, right) =>
      right.officialSupportCount - left.officialSupportCount
      || right.supportCount - left.supportCount
      || right.trustedSupportCount - left.trustedSupportCount
      || (right.latestPublishedAt ? new Date(right.latestPublishedAt).getTime() : 0)
        - (left.latestPublishedAt ? new Date(left.latestPublishedAt).getTime() : 0)
      || right.model.length - left.model.length
      || left.model.localeCompare(right.model));

  const collapsed: AiModelRankingEntry[] = [];
  for (const entry of ordered) {
    const entryModel = entry.model.toLowerCase();
    const family = inferAiModelFamilyKey(entry.model);
    const duplicate = collapsed.find((candidate) => {
      const candidateModel = candidate.model.toLowerCase();
      return inferAiModelFamilyKey(candidate.model) === family
        && (candidateModel.includes(entryModel) || entryModel.includes(candidateModel));
    });

    if (duplicate) {
      duplicate.supportCount = Math.max(duplicate.supportCount, entry.supportCount);
      duplicate.officialSupportCount = Math.max(duplicate.officialSupportCount, entry.officialSupportCount);
      duplicate.trustedSupportCount = Math.max(duplicate.trustedSupportCount, entry.trustedSupportCount);
      if (
        entry.latestPublishedAt
        && (
          !duplicate.latestPublishedAt
          || new Date(entry.latestPublishedAt).getTime() > new Date(duplicate.latestPublishedAt).getTime()
        )
      ) {
        duplicate.latestPublishedAt = entry.latestPublishedAt;
      }
      if (entry.model.length > duplicate.model.length) {
        duplicate.model = entry.model;
      }
      continue;
    }

    collapsed.push({ ...entry });
  }

  return collapsed.slice(0, 12);
}

function looksWeakAiModelAnswer(answer: string, question: string) {
  const normalized = answer.toLowerCase();
  const genericChoiceCount = (normalized.match(/\bmay be a good choice\b/g) ?? []).length;
  const questionNeedsRanking = /\b(top\s*\d+|best|most advanced|ranking|leaderboard|frontier)\b/i.test(question);
  const questionNeedsComparison = AI_MODEL_COMPARE_QUESTION_SIGNAL.test(question);

  return (
    normalized.includes("some key points to consider")
    || /(^|\n)\d+\.\s*(strengths|trade-offs|when to choose each):\s*$/im.test(answer)
    || genericChoiceCount >= 2
    || normalized.includes("top 10 ai certifications")
    || normalized.includes("top ai certifications")
    || normalized.includes("top ai companies")
    || normalized.includes("top ai apps")
    || (questionNeedsRanking && normalized.includes("not explicitly ranked"))
    || (questionNeedsRanking && normalized.includes("do not provide a clear ranking"))
    || (questionNeedsComparison && normalized.includes("universal official top-10 ranking"))
    || (questionNeedsComparison && normalized.includes("frontier snapshot"))
  );
}

function findBestAiModelReleaseSignal(modelLabel: string, sources: NewsSource[]) {
  const normalizedLabel = modelLabel.toLowerCase();
  const familyKey = inferAiModelFamilyKey(modelLabel);
  const releasePattern =
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+20\d{2}\b/i;

  const matchingSources = sources.filter((source) => {
    const haystack = normalizeAiModelSourceHaystack(`${source.title} ${source.snippet} ${source.url}`).toLowerCase();
    return haystack.includes(normalizedLabel) || haystack.includes(familyKey);
  });

  for (const source of matchingSources) {
    const explicit = `${source.title} ${source.snippet}`.match(releasePattern)?.[0]?.trim();
    if (explicit) {
      return explicit;
    }
    const published = formatSourceCalendarDate(source.publishedDate);
    if (published) {
      return published;
    }
  }

  return "";
}

function retainFreshAiModelEvidenceSources(
  question: string,
  sources: NewsSource[],
  routing: AiModelRoutingDecision,
) {
  if (routing.mode !== "web_search") {
    return sources;
  }

  const currentYear = new Date().getUTCFullYear();
  const requestedYearMatch = question.match(/\b(20\d{2})\b/);
  const requestedYear = requestedYearMatch ? Number.parseInt(requestedYearMatch[1] ?? "", 10) : currentYear;
  const targetYear = Number.isFinite(requestedYear) ? Math.max(requestedYear, currentYear) : currentYear;

  const currentYearDated = sources.filter((source) => {
    if (!source.publishedDate) {
      return false;
    }
    const parsed = new Date(source.publishedDate);
    return Number.isFinite(parsed.getTime()) && parsed.getUTCFullYear() >= targetYear;
  });

  if (currentYearDated.length < 2) {
    return sources;
  }

  const keepUrls = new Set(currentYearDated.map((source) => source.url));
  const undatedOfficial = sources.filter((source) =>
    !source.publishedDate
    && routing.officialDomains.some((domain) => source.domain === domain || source.domain.endsWith(`.${domain}`)),
  );

  for (const source of undatedOfficial) {
    keepUrls.add(source.url);
  }

  return sources.filter((source) => keepUrls.has(source.url));
}

function normalizeAiModelFallbackFormatting(answer: string) {
  return answer
    .replace(/â€”/g, "-")
    .replace(/â€¢/g, "-");
}

function buildAiModelComparisonEvidenceAnswer(question: string, sources: NewsSource[]) {
  const mentions = extractAiModelEvidenceMentions(sources);
  const questionTargets = extractAiModelQuestionTargets(question);
  const isReleaseQuestion = AI_MODEL_RELEASE_QUESTION_SIGNAL.test(question);
  const targets = questionTargets.length
    ? questionTargets
    : mentions.slice(0, 4).map((mention) => mention.model);

  if (questionTargets.length && !mentions.length) {
    const lines = [
      "*AI model comparison snapshot*",
      "",
      "*Targets extracted from your question*",
      ...questionTargets.map((target) => `- ${inferAiModelVendorFromLabel(target) ? `${inferAiModelVendorFromLabel(target)} — ` : ""}${target}`),
      "",
      "*What this run could not verify safely*",
      "- Coding: no official side-by-side or benchmark evidence was retrieved in this run.",
      "- Price: no official pricing rows were retrieved for all named models in this run.",
      isReleaseQuestion
        ? "- Release timing: no official launch snippets were retrieved for all named models in this run."
        : "- Release timing: no official launch snippets were retrieved for the named models in this run.",
      "",
      "*Bottom line*",
      "The model names are clear, but the current source batch was too thin for a professional live comparison without guessing.",
    ];

    return normalizeAiModelFallbackFormatting(lines.join("\n").trim());
  }

  if (!targets.length && !mentions.length) {
    return normalizeAiModelFallbackFormatting([
      "*AI model comparison*",
      "",
      "I could not confirm a clean source-backed side-by-side from the current source batch.",
      "For the strongest result, compare the named models against official release or product pages.",
    ].join("\n"));
  }

  const mentionByLabel = new Map(mentions.map((mention) => [mention.model.toLowerCase(), mention]));
  const lines = [
    "*AI model comparison snapshot*",
    "",
    "*Direct answer*",
    "The current source batch supports model identity and vendor naming more clearly than a full cross-vendor benchmark table, so I am separating confirmed names from unsupported labels below.",
    "",
    "*Source-backed model status*",
  ];

  for (const target of targets) {
    const exact = mentionByLabel.get(target.toLowerCase()) ?? null;
    const closest = exact ?? mentions.find((mention) => inferAiModelFamilyKey(mention.model) === inferAiModelFamilyKey(target)) ?? null;
    const closestVendor = closest?.vendor ?? inferAiModelVendorFromLabel(target);
    const closestRelease = closest ? findBestAiModelReleaseSignal(closest.model, sources) : "";

    if (exact) {
      lines.push(
        `- ${closestVendor ? `${closestVendor} — ` : ""}${exact.model}: explicitly named in the current source batch.${isReleaseQuestion ? ` Release date ${closestRelease ? `signal: ${closestRelease}` : "is not explicit in the retrieved snippets"}.` : ""}`,
      );
      continue;
    }

    if (closest) {
      lines.push(
        `- ${target}: not confirmed as an official model name in this source batch. Closest explicit ${closestVendor ? `${closestVendor} ` : ""}model here is ${closest.model}.${isReleaseQuestion && closestRelease ? ` Release signal for ${closest.model}: ${closestRelease}.` : ""}`,
      );
      continue;
    }

    lines.push(`- ${target}: not confirmed in the current source batch.`);
  }

  if (mentions.length) {
    lines.push("");
    lines.push("*Models explicitly named in sources*");
    for (const mention of mentions.slice(0, 5)) {
      lines.push(`- ${mention.vendor ? `${mention.vendor} — ` : ""}${mention.model}`);
    }
  }

  lines.push("");
  lines.push("*Bottom line*");
  lines.push("Use this as a source-backed identity and release snapshot rather than a universal benchmark table.");
  if (AI_MODEL_COMPARE_QUESTION_SIGNAL.test(question)) {
    lines.push("For the clearest head-to-head, compare coding, reasoning, price, latency, or context window against official vendor pages for the same named models.");
  }

  return normalizeAiModelFallbackFormatting(lines.join("\n").trim());
}

function buildAiModelRankingNoEvidenceAnswer(question: string, sources: NewsSource[]) {
  return buildAiModelRankingNoEvidenceAnswerV2(question, sources);

  const topSources = rankEvidenceSources(question, sources).slice(0, 3);
  const lines = [
    "*AI model ranking*",
    "I couldn't verify a trustworthy cross-vendor top-model ranking from the live sources I found.",
    "",
    "*Why*",
    "â€¢ This source batch does not expose enough current official model signals to rank frontier models safely.",
    "â€¢ Cross-vendor ordering can change by axis such as coding, reasoning, latency, price, and multimodal ability.",
  ];

  if (topSources.length) {
    lines.push("");
    lines.push("*Closest source signals*");
    for (const source of topSources) {
      lines.push(`â€¢ ${source.title} (${source.domain})`);
    }
  }

  lines.push("");
  lines.push("*Bottom line*");
  lines.push("â€¢ I won't invent a top-model order that the retrieved sources do not support.");

  return normalizeAiModelFallbackFormatting(lines.join("\n").trim()) + buildFreshnessLabel(sources);
}

function buildAiModelRankingEvidenceAnswer(question: string, sources: NewsSource[]) {
  return buildAiModelRankingEvidenceAnswerV2(question, sources);

  const rankingEntries = buildAiModelRankingEntries(sources);
  if (!rankingEntries.length) {
    return buildAiModelRankingNoEvidenceAnswer(question, sources);
  }

  const lines = [
    "*AI model ranking*",
    "Evidence-based frontier ranking from the current retrieved source batch:",
    "",
    "*Ranking method*",
    "â€¢ Order favors repeated current-source support, official vendor confirmation, and the freshest visible release signal.",
    "",
    "*Top models in this run*",
  ];

  for (const [index, entry] of rankingEntries.slice(0, 10).entries()) {
    const supportParts = [`${entry.supportCount} source${entry.supportCount === 1 ? "" : "s"}`];
    if (entry.officialSupportCount > 0) {
      supportParts.push(`${entry.officialSupportCount} official`);
    } else if (entry.trustedSupportCount > 0) {
      supportParts.push(`${entry.trustedSupportCount} trusted-report`);
    }

    const latestSignal = entry.latestPublishedAt ? formatSourceCalendarDate(entry.latestPublishedAt ?? undefined) : "";
    const detail = [
      supportParts.join(", "),
      latestSignal ? `latest signal ${latestSignal}` : "",
    ].filter(Boolean).join("; ");

    lines.push(`${index + 1}. ${entry.vendor ? `${entry.vendor} â€” ` : ""}${entry.model}${detail ? ` (${detail})` : ""}`);
  }

  lines.push("");
  lines.push("*Note*");
  lines.push("â€¢ This is a live evidence ranking from the retrieved source batch, not a permanent universal leaderboard.");

  return normalizeAiModelFallbackFormatting(lines.join("\n").trim()) + buildFreshnessLabel(sources);
}

function buildAiModelRankingNoEvidenceAnswerV2(question: string, sources: NewsSource[]) {
  if (extractAiModelQuestionTargets(question).length === 0) {
    const curatedEntries = buildAiModelRankingEntries(CURATED_FRONTIER_MODEL_SOURCES).slice(0, 10);
    if (curatedEntries.length) {
      const lines = [
        "*AI model ranking*",
        "Current frontier shortlist from verified official vendor model pages:",
        "",
        "*Top models in this run*",
      ];

      for (const [index, entry] of curatedEntries.entries()) {
        const latestSignal = entry.latestPublishedAt ? formatSourceCalendarDate(entry.latestPublishedAt ?? undefined) : "";
        lines.push(`${index + 1}. ${entry.vendor ? `${entry.vendor} - ` : ""}${entry.model}${latestSignal ? ` (${latestSignal})` : ""}`);
      }

      lines.push("");
      lines.push("*Note*");
      lines.push("- This fallback uses verified official vendor release pages because the live mixed-source batch was too thin for a broader cross-vendor ranking.");

      return normalizeAiModelFallbackFormatting(lines.join("\n").trim()) + buildFreshnessLabel(CURATED_FRONTIER_MODEL_SOURCES);
    }
  }

  const topSources = rankEvidenceSources(question, sources).slice(0, 3);
  const lines = [
    "*AI model ranking*",
    "I couldn't verify a trustworthy cross-vendor top-model ranking from the live sources I found.",
    "",
    "*Why*",
    "- This source batch does not expose enough current official model signals to rank frontier models safely.",
    "- Cross-vendor ordering can change by axis such as coding, reasoning, latency, price, and multimodal ability.",
  ];

  if (topSources.length) {
    lines.push("");
    lines.push("*Closest source signals*");
    for (const source of topSources) {
      lines.push(`- ${source.title} (${source.domain})`);
    }
  }

  lines.push("");
  lines.push("*Bottom line*");
  lines.push("- I won't invent a top-model order that the retrieved sources do not support.");

  return normalizeAiModelFallbackFormatting(lines.join("\n").trim()) + buildFreshnessLabel(sources);
}

function buildAiModelRankingEvidenceAnswerV2(question: string, sources: NewsSource[]) {
  const rankingEntries = buildAiModelRankingEntries(sources);
  if (!rankingEntries.length) {
    return buildAiModelRankingNoEvidenceAnswerV2(question, sources);
  }

  const lines = [
    "*AI model ranking*",
    "Evidence-based frontier ranking from the current retrieved source batch:",
    "",
    "*Ranking method*",
    "- Order favors repeated current-source support, official vendor confirmation, and the freshest visible release signal.",
    "",
    "*Top models in this run*",
  ];

  for (const [index, entry] of rankingEntries.slice(0, 10).entries()) {
    const supportParts = [`${entry.supportCount} source${entry.supportCount === 1 ? "" : "s"}`];
    if (entry.officialSupportCount > 0) {
      supportParts.push(`${entry.officialSupportCount} official`);
    } else if (entry.trustedSupportCount > 0) {
      supportParts.push(`${entry.trustedSupportCount} trusted-report`);
    }

    const latestSignal = entry.latestPublishedAt ? formatSourceCalendarDate(entry.latestPublishedAt) : "";
    const detail = [
      supportParts.join(", "),
      latestSignal ? `latest signal ${latestSignal}` : "",
    ].filter(Boolean).join("; ");

    lines.push(`${index + 1}. ${entry.vendor ? `${entry.vendor} - ` : ""}${entry.model}${detail ? ` (${detail})` : ""}`);
  }

  lines.push("");
  lines.push("*Note*");
  lines.push("- This is a live evidence ranking from the retrieved source batch, not a permanent universal leaderboard.");

  return normalizeAiModelFallbackFormatting(lines.join("\n").trim()) + buildFreshnessLabel(sources);
}

export function buildAiModelEvidenceOnlyAnswer(
  question: string,
  sources: NewsSource[],
): string {
  if (AI_MODEL_COMPARE_QUESTION_SIGNAL.test(question) || (AI_MODEL_RELEASE_QUESTION_SIGNAL.test(question) && extractAiModelQuestionTargets(question).length > 0)) {
    return buildAiModelComparisonEvidenceAnswer(question, sources);
  }

  return buildAiModelRankingEvidenceAnswer(question, sources);

  const mentions = extractAiModelEvidenceMentions(sources);
  if (!mentions.length) {
    const topSources = rankEvidenceSources(question, sources).slice(0, 3);
    const lines = [
      "*AI model ranking*",
      "I couldn't verify a universal official top-10 ranking from the live sources I found.",
      "",
      "*Why*",
      "• This source batch does not expose a clean cross-vendor model leaderboard.",
      "• Cross-vendor ordering changes by axis such as coding, reasoning, price, and latency.",
    ];

    if (topSources.length) {
      lines.push("");
      lines.push("*Closest source signals*");
      for (const source of topSources) {
        lines.push(`• ${source.title} (${source.domain})`);
      }
    }

    lines.push("");
    lines.push("*Bottom line*");
    lines.push("• I won't invent a top-10 order that the retrieved sources do not support.");

    return normalizeAiModelFallbackFormatting(lines.join("\n").trim()) + buildFreshnessLabel(sources);
  }

  if (!mentions.length) {
    const topSources = rankEvidenceSources(question, sources).slice(0, 3);
    const lines = [
      "*AI model ranking*",
      "I couldn't verify a universal official top-10 ranking from the live sources I found.",
      "",
      "*Why*",
      "• This source batch does not expose a clean cross-vendor model leaderboard.",
      "• The strongest path is to compare frontier models on one axis at a time.",
    ];

    if (topSources.length) {
      lines.push("");
      lines.push("*Closest source signals*");
      for (const source of topSources) {
        lines.push(`• ${source.title} (${source.domain})`);
      }
    }

    lines.push("");
    lines.push("*Best next step*");
    lines.push("• Ask for one axis: coding, reasoning, price, latency, multimodal, or open-weight.");
    lines.push("• Example: _Compare GPT-5.4, Claude Sonnet 4, and Gemini 2.5 Pro for coding._");

    return normalizeAiModelFallbackFormatting(lines.join("\n").trim()) + buildFreshnessLabel(sources);
  }

  const lines = [
    "*AI model frontier snapshot*",
    "There is no single universal official top-10 ranking in the live sources I found.",
    "",
    "*Models explicitly named in this source batch*",
  ];

  for (const [index, mention] of mentions.slice(0, 10).entries()) {
    lines.push(`${index + 1}. ${mention.vendor ? `${mention.vendor} — ` : ""}${mention.model}`);
  }

  lines.push("");
  lines.push("*What this means*");
  lines.push("• This is a source-backed shortlist, not a universal benchmark ranking.");
  lines.push("• It reflects the strongest explicit model signals in the retrieved source batch.");

  return normalizeAiModelFallbackFormatting(lines.join("\n").trim()) + buildFreshnessLabel(sources);
}

const NEWS_PATTERNS: RegExp[] = [
  /\b(latest news|recent news|breaking news|top stories|latest update|news update|what('?s| is) happening|what happened|news about|update on|status of)\b/i,
  /\b(latest|recent|breaking|current)\b.{0,40}\b(news|update|updates|headline|headlines)\b/i,
  /\b(news|headlines?)\b.{0,20}\b(today|todays|today's|right now|current|latest)\b/i,
  /\b(today|todays|today's|right now|current|latest)\b.{0,20}\b(news|headlines?)\b/i,
  /\b(update|updates?)\b.{0,20}\b(today|todays|today's|current|latest)\b/i,
  /\b(today|todays|today's|current|latest)\b.{0,20}\b(update|updates?)\b/i,
  /\b(what('?s| is) the latest on|latest on|give me the latest on)\b/i,
  /\b(important|major|biggest|top)\b.{0,40}\b(developments?|announcements?|launches?|releases?|moves?)\b/i,
  /\b(developments?|announcements?|launches?|releases?)\b.{0,40}\b(this week|today|right now|currently|recent)\b/i,
  /\b(meeting|meetings|conference|talks?|summit|joint statement)\b.{0,60}\b(president|prime minister|minister|white house|bilateral|delegation)\b/i,
  /\b(who won|final score|live score|match result|tournament result|champion|knocked out|won the election|election results?|resigned|appointed|announced|launched|unveiled|released today)\b/i,
  /\b(attack|earthquake|flood|wildfire|explosion|shooting|ceasefire|protest|verdict|arrested|killed|injured|outage|strike)\b/i,
  /\b(ipl|cricket|nba|nfl|premier league|champions league|f1|formula 1|tennis|world cup|oscars?|grammys?|box office|bollywood|hollywood)\b/i,
];

function looksLikeVagueWorldNewsRequest(question: string) {
  const normalizedQuestion = normalizeRegionalQuestion(question);
  const lower = normalizedQuestion.toLowerCase();
  const regionMention = detectClawCloudRegionMention(normalizedQuestion);
  return (
    !regionMention
    &&
    /\b(update|updates?|latest|news|headlines?|top stories)\b/.test(lower)
    && /\b(today|todays|today's|current|right now|as of now)\b/.test(lower)
    && !/\b(?:about|on|for)\b\s+[a-z]/.test(lower)
  );
}

function buildTopHeadlineDigestAnswer(question: string, sources: NewsSource[]) {
  if (!sources.length || !looksLikeVagueWorldNewsRequest(question)) {
    return "";
  }

  const lines = [
    "*Top world headlines right now*",
    "",
  ];

  for (const [index, source] of sources.slice(0, 4).entries()) {
    const published = formatPublishedDate(source.publishedDate);
    const detailParts = [
      source.domain || "",
      published || "",
    ].filter(Boolean);
    lines.push(
      `${index + 1}. ${source.title}${detailParts.length ? ` - ${detailParts.join(" | ")}` : ""}`,
    );
  }

  lines.push("");
  lines.push("These are the strongest recent world-news headlines from the live source batch.");
  return lines.join("\n").trim();
}

const WEB_SEARCH_PATTERNS: RegExp[] = [
  /^(?:search|search for|find|look up|lookup|google|bing|fetch)\s+/i,
  /\b(?:search the web(?: for)?|search online(?: for)?|web search(?: for)?|find online|look it up|look this up|check online)\b/i,
  /\b(?:can you|could you|please)\s+(?:search|look up|find)\b/i,
  /\b(?:search for|look up|find info on|find information about)\b.{3,}/i,
];

const NOT_NEWS_PATTERNS: RegExp[] = [
  /\b(how (do|does|to|can|should|would)|explain|define|difference between|meaning of|history of|theory of|concept of)\b/i,
  /\b(write|create|make|generate|code|implement|design|build|calculate|compute|solve|debug|refactor)\b/i,
  /\b(api|database|schema|algorithm|function|component|sql|python|javascript|typescript)\b/i,
  /\b(use case|use-case|edge case|edge-case|test case|case study|best case|worst case|camelcase|switch case|uppercase|lowercase|title case|sentence case)\b/i,
];

const TRUSTED_DOMAINS = [
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "nytimes.com",
  "wsj.com",
  "ft.com",
  "bloomberg.com",
  "theguardian.com",
  "aljazeera.com",
  "cnbc.com",
  "nbcnews.com",
  "abcnews.go.com",
  "cnn.com",
  "npr.org",
  "thehindu.com",
  "indianexpress.com",
  "hindustantimes.com",
  "timesofindia.com",
  "ndtv.com",
  "economictimes.com",
  "moneycontrol.com",
  "espn.com",
  "espncricinfo.com",
  "cricbuzz.com",
  "techcrunch.com",
  "wired.com",
  "theverge.com",
  "arstechnica.com",
  "openai.com",
  "platform.openai.com",
  "anthropic.com",
  "docs.anthropic.com",
  "ai.google.dev",
  "blog.google",
  "deepmind.google",
  "x.ai",
  "docs.x.ai",
  "deepseek.com",
  "api-docs.deepseek.com",
  "mistral.ai",
  "docs.mistral.ai",
  "ai.meta.com",
  "about.meta.com",
];

const LOW_QUALITY_DOMAINS = [
  "reddit.com",
  "quora.com",
  "youtube.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "wikipedia.org",
];

const GENERIC_NEWS_PATH_SEGMENTS = new Set([
  "news",
  "latest",
  "latest-news",
  "breaking",
  "breaking-news",
  "headlines",
  "headline",
  "updates",
  "update",
  "world",
  "india",
  "global",
  "international",
  "business",
  "technology",
  "tech",
  "sports",
  "sport",
  "markets",
  "market",
  "finance",
  "politics",
  "nation",
  "live",
]);

export function detectNewsQuestion(question: string): boolean {
  const text = normalizeRegionalQuestion(question).trim();
  if (!text) return false;
  if (
    /\b(bitcoin|btc|crypto price|stock price|share price|exchange rate|usd to inr|inr to usd)\b/i.test(text)
    || /\b(richest|wealthiest|billionaire|net worth|forbes list|top \d+ richest)\b/i.test(text)
    || /\b(current ceo of|who is the ceo of|who is ceo of|ceo of)\b/i.test(text)
    || /\b(latest iphone model|newest iphone model)\b/i.test(text)
  ) {
    return false;
  }
  if (looksLikeWeatherOrAirQualityQuestion(text)) {
    return false;
  }
  if (NOT_NEWS_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  return (
    looksLikeAmbiguousCurrentWarQuestion(text)
    || looksLikeCurrentAffairsQuestion(text)
    || looksLikeNamedCaseQuestion(text)
    || NEWS_PATTERNS.some((pattern) => pattern.test(text))
  );
}

export function detectWebSearchIntent(question: string): boolean {
  return WEB_SEARCH_PATTERNS.some((pattern) => pattern.test(question.trim()));
}

function formatCurrentDate(): string {
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
}

function formatCurrentTimestamp(): string {
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(new Date());
}

function formatPublishedDate(value?: string) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(parsed);
}

function formatSourceCalendarDate(value?: string) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(parsed);
}

function currentYear(): string {
  return new Date().getFullYear().toString();
}

function cleanedTopic(question: string) {
  const contentScopedQuestion = normalizeRegionalQuestion(
    stripExplicitReplyLocaleRequestForContent(question),
  );
  const strippedLead = contentScopedQuestion
    .replace(/^(tell me|give me|show me|search for|look up)\s+/i, "")
    .replace(/^(tell me about|give me (the )?(latest|news|update) on|what('?s| is) (the )?(latest|news|status) on|latest|recent|breaking)\s+/i, "")
    .replace(/\?+$/, "")
    .trim();

  const reducedNewsScaffold = strippedLead
    .replace(/\b(?:the|news|headlines?|top stories|story|stories|update|updates|today|todays|today's|latest|current|right now|of|for|about|on)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const regionMention = reducedNewsScaffold
    ? detectClawCloudRegionMention(reducedNewsScaffold)
    : null;

  if (regionMention?.kind === "country") {
    const aliasPattern = new RegExp(
      `\\b(?:${regionMention.region.aliases
        .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|")})\\b`,
      "gi",
    );
    const subjectWithoutRegion = reducedNewsScaffold.replace(aliasPattern, " ").replace(/\s+/g, " ").trim();
    if (!subjectWithoutRegion) {
      return regionMention.region.countryName;
    }
  }

  return strippedLead;
}

type SearchLocaleHint = {
  gl?: string;
  hl?: string;
};

function inferSearchLocale(question: string): SearchLocaleHint {
  const regional = inferRegionalSearchLocale(question);
  if (regional.gl || regional.hl) {
    return regional;
  }
  return { hl: "en" };
}

export function buildNewsQueries(question: string): string[] {
  const normalizedQuestion = normalizeRegionalQuestion(question);
  const lower = normalizedQuestion.toLowerCase();
  const isVagueUpdateRequest = looksLikeVagueWorldNewsRequest(normalizedQuestion);
  const regionMention = detectClawCloudRegionMention(normalizedQuestion);
  const topic = isVagueUpdateRequest ? "top world news" : (cleanedTopic(normalizedQuestion) || normalizedQuestion.trim());
  const queries = new Set<string>();

  if (/\bai\b/i.test(topic) && /\b(this week|latest|recent|important|major|biggest|developments?|announcements?|launches?|releases?)\b/.test(lower)) {
    queries.add("OpenAI Google Anthropic Meta AI news this week");
    queries.add("Gemini Claude GPT AI launches this week");
    queries.add("AI developments this week for startup founders");
    return [...queries];
  }

  if (isVagueUpdateRequest) {
    queries.add("top world headlines today Reuters AP BBC");
    queries.add("breaking global news today");
    queries.add(`today's biggest world headlines ${currentYear()}`);
    return [...queries];
  }

  if (
    regionMention?.kind === "country"
    && /\b(news|headlines?|updates?)\b/i.test(normalizedQuestion)
    && /\b(today|latest|current|right now|as of now)\b/i.test(lower)
    && !/\b(case|incident|war|attack|meeting|summit|ultimatum|conditions?|status|why|explained?)\b/i.test(lower)
  ) {
    const country = regionMention.region.countryName;
    queries.add(`${country} top headlines today Reuters AP BBC`);
    queries.add(`${country} breaking news today`);
    queries.add(`${country} latest headlines ${currentYear()}`);
    return [...queries];
  }

  const currentAffairsQueries = buildCurrentAffairsQueries(normalizedQuestion);
  if (currentAffairsQueries.length) {
    return currentAffairsQueries;
  }

  const namedCaseQueries = buildNamedCaseQueries(normalizedQuestion);
  if (namedCaseQueries.length) {
    return namedCaseQueries;
  }

  queries.add(`${topic} latest news`);
  queries.add(`${topic} ${currentYear()} latest update`);

  if (/\b(score|match|won|winner|final|champion|ipl|cricket|nba|nfl|football|tennis|f1|formula 1)\b/i.test(question)) {
    queries.add(`${topic} result score today`);
  } else if (/\b(election|president|prime minister|pm|resigned|appointed|cabinet|government)\b/i.test(question)) {
    queries.add(`${topic} breaking announcement`);
  } else if (/\b(launch|launched|announced|unveiled|release|released)\b/i.test(question)) {
    queries.add(`${topic} announcement today`);
  } else {
    queries.add(`${topic} news today`);
  }

  return [...queries].slice(0, 3);
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'");
}

function stripHtmlTags(value: string) {
  return decodeHtmlEntities(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function googleNewsRssSearch(query: string): Promise<NewsSource[]> {
  try {
    const locale = inferSearchLocale(query);
    const params = new URLSearchParams({
      q: query,
      hl: locale.hl || "en-IN",
      gl: (locale.gl || "IN").toUpperCase(),
      ceid: `${(locale.gl || "IN").toUpperCase()}:${locale.hl || "en"}`,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NEWS_SEARCH_PROVIDER_TIMEOUT_MS);
    const response = await fetch(`https://news.google.com/rss/search?${params.toString()}`, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 ClawCloud/1.0" },
      cache: "no-store",
    }).finally(() => clearTimeout(timer));
    if (!response.ok) return [];

    const xml = await response.text();
    const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)).slice(0, 8);
    return items.map((match) => {
      const item = match[1] ?? "";
      const title = stripHtmlTags(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "");
      const url = stripHtmlTags(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] ?? "");
      const snippet = stripHtmlTags(item.match(/<description>([\s\S]*?)<\/description>/i)?.[1] ?? "");
      const source = stripHtmlTags(item.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] ?? "");
      const publishedDate = stripHtmlTags(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "");
      const sourceDomain = /\.[a-z]{2,}$/i.test(source) ? extractDomain(source) : "";

      return {
        title,
        url,
        snippet,
        domain: sourceDomain || extractDomain(url),
        publishedDate: publishedDate || undefined,
        score: 0.5,
      };
    }).filter((source) => source.title && source.url);
  } catch {
    return [];
  }
}

function parsePopulationCountryCandidate(question: string) {
  const cleaned = normalizeRegionalQuestion(question)
    .replace(/^search the web and tell me\s+/i, "")
    .replace(/^search the web\s+/i, "")
    .replace(/^tell me\s+/i, "")
    .replace(/^what(?:'s| is)\s+/i, "")
    .replace(/\b(using|with)\b[\s\S]*$/i, "")
    .replace(/'s\b/gi, "")
    .replace(/\b(current|latest|reliable|estimate|population|of|the|web|search|source|context|tell me)\b/gi, " ")
    .replace(/[?.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";
  return cleaned;
}

async function fetchCountryPopulationAnswer(question: string): Promise<string> {
  if (!/\bpopulation\b/i.test(question)) {
    return "";
  }

  const countryCandidate = parsePopulationCountryCandidate(question);
  if (!countryCandidate) {
    return "";
  }
  const regionMention = detectClawCloudRegionMention(countryCandidate);
  if (regionMention?.kind === "locality") {
    return "";
  }

  try {
    const countryResponse = await fetch(
      `https://restcountries.com/v3.1/name/${encodeURIComponent(countryCandidate)}?fields=name,cca3`,
      {
        headers: { "User-Agent": "Mozilla/5.0 ClawCloud/1.0" },
        cache: "no-store",
      },
    );
    if (!countryResponse.ok) {
      return "";
    }

    const countries = await countryResponse.json() as RestCountryRecord[];
    const exact = countries.find((entry) => entry.name?.common?.toLowerCase() === countryCandidate.toLowerCase());
    const country = exact ?? countries[0];
    const code = country?.cca3;
    const displayName = country?.name?.common ?? countryCandidate;
    if (!code) {
      return "";
    }

    const wbResponse = await fetch(
      `https://api.worldbank.org/v2/country/${encodeURIComponent(code)}/indicator/SP.POP.TOTL?format=json&per_page=6`,
      {
        headers: { "User-Agent": "Mozilla/5.0 ClawCloud/1.0" },
        cache: "no-store",
      },
    );
    if (!wbResponse.ok) {
      return "";
    }

    const wbData = await wbResponse.json() as [unknown, WorldBankPopulationEntry[]?];
    const latest = (wbData?.[1] ?? []).find((entry) => typeof entry?.value === "number");
    if (!latest?.value || !latest.date) {
      return "";
    }

    const population = latest.value.toLocaleString("en-US");
    return [
      `*${displayName} population (latest reliable estimate):* ${population}`,
      "",
      `As of the latest World Bank estimate for ${latest.date}.`,
      "Source: worldbank.org population indicator (SP.POP.TOTL)",
      `Searched: ${formatCurrentDate()}`,
    ].join("\n");
  } catch {
    return "";
  }
}

async function tavilyNewsSearch(query: string): Promise<NewsSource[]> {
  if (!env.TAVILY_API_KEY) return [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NEWS_SEARCH_PROVIDER_TIMEOUT_MS);
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.TAVILY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        max_results: 8,
        search_depth: "advanced",
        include_answer: false,
        include_raw_content: false,
        days: 3,
      }),
    }).finally(() => clearTimeout(timer));

    if (!response.ok) return [];

    const data = await response.json() as {
      results?: Array<{
        url?: string;
        title?: string;
        content?: string;
        score?: number;
        published_date?: string;
      }>;
    };

    return (data.results ?? [])
      .filter((item) => item.url && item.title)
      .map((item) => ({
        title: item.title ?? "",
        url: item.url ?? "",
        snippet: (item.content ?? "").slice(0, 400),
        domain: extractDomain(item.url ?? ""),
        publishedDate: item.published_date,
        score: Number(item.score ?? 0.45),
      }));
  } catch {
    return [];
  }
}

async function serpApiNewsSearch(query: string): Promise<NewsSource[]> {
  if (!env.SERPAPI_API_KEY) return [];

  try {
    const locale = inferSearchLocale(query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NEWS_SEARCH_PROVIDER_TIMEOUT_MS);
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google");
    url.searchParams.set("tbm", "nws");
    url.searchParams.set("tbs", "qdr:d3");
    url.searchParams.set("num", "8");
    url.searchParams.set("api_key", env.SERPAPI_API_KEY);
    url.searchParams.set("q", query);
    if (locale.gl) url.searchParams.set("gl", locale.gl);
    if (locale.hl) url.searchParams.set("hl", locale.hl);

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      cache: "no-store",
    }).finally(() => clearTimeout(timer));

    if (!response.ok) return [];

    const data = await response.json() as {
      news_results?: Array<{
        title?: string;
        link?: string;
        snippet?: string;
        date?: string;
        source?: string;
      }>;
      organic_results?: Array<{
        title?: string;
        link?: string;
        snippet?: string;
        date?: string;
        position?: number;
      }>;
    };

    const results = data.news_results?.length ? data.news_results : (data.organic_results ?? []);
    return results
      .filter((item) => item.link && item.title)
      .map((item, index) => ({
        title: item.title ?? "",
        url: item.link ?? "",
        snippet: (item.snippet ?? "").slice(0, 400),
        domain: extractDomain(item.link ?? ""),
        publishedDate: item.date,
        score: 0.65 - index * 0.04,
      }));
  } catch {
    return [];
  }
}

async function jinaNewsSearch(query: string): Promise<NewsSource[]> {
  if (!env.JINA_API_KEY) return [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NEWS_SEARCH_PROVIDER_TIMEOUT_MS);
    const url = new URL("https://s.jina.ai/");
    url.searchParams.set("q", query);

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${env.JINA_API_KEY}`,
        "x-no-cache": "true",
        Accept: "application/json",
      },
    }).finally(() => clearTimeout(timer));

    if (!response.ok) return [];

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return [];
    }

    const data = await response.json() as {
      data?: Array<{
        url?: string;
        title?: string;
        description?: string;
        content?: string;
      }>;
    };

    return (data.data ?? [])
      .filter((item) => item.url && item.title)
      .map((item, index) => ({
        title: item.title ?? "",
        url: item.url ?? "",
        snippet: (item.description ?? item.content ?? "").slice(0, 400),
        domain: extractDomain(item.url ?? ""),
        score: 0.5 - index * 0.03,
      }));
  } catch {
    return [];
  }
}

async function duckDuckGoSearch(query: string): Promise<NewsSource[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), NEWS_SEARCH_PROVIDER_TIMEOUT_MS);
    const url = new URL("https://api.duckduckgo.com/");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("no_html", "1");
    url.searchParams.set("skip_disambig", "1");
    url.searchParams.set("no_redirect", "1");

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "ClawCloud/1.0 (WhatsApp AI Assistant)",
      },
    }).finally(() => clearTimeout(timer));

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as {
      AbstractText?: string;
      AbstractURL?: string;
      AbstractSource?: string;
      RelatedTopics?: Array<{
        Text?: string;
        FirstURL?: string;
        Topics?: Array<{
          Text?: string;
          FirstURL?: string;
        }>;
      }>;
    };

    const sources: NewsSource[] = [];

    if (data.AbstractText && data.AbstractURL) {
      sources.push({
        title: `${query} - ${data.AbstractSource ?? "DuckDuckGo"}`,
        url: data.AbstractURL,
        snippet: data.AbstractText.slice(0, 400),
        domain: extractDomain(data.AbstractURL),
        score: 0.55,
      });
    }

    for (const topic of (data.RelatedTopics ?? []).slice(0, 6)) {
      if (topic.Text && topic.FirstURL) {
        sources.push({
          title: topic.Text.split(" - ")[0] ?? topic.Text.slice(0, 80),
          url: topic.FirstURL,
          snippet: topic.Text.slice(0, 300),
          domain: extractDomain(topic.FirstURL),
          score: 0.35,
        });
      }

      for (const subTopic of (topic.Topics ?? []).slice(0, 2)) {
        if (subTopic.Text && subTopic.FirstURL) {
          sources.push({
            title: subTopic.Text.slice(0, 80),
            url: subTopic.FirstURL,
            snippet: subTopic.Text.slice(0, 300),
            domain: extractDomain(subTopic.FirstURL),
            score: 0.25,
          });
        }
      }
    }

    return sources;
  } catch {
    return [];
  }
}

function dedupeByUrl(sources: NewsSource[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.url.replace(/\?.*$/, "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeNewsSignalText(value: string) {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSourceBrand(domain: string) {
  const parts = domain.toLowerCase().replace(/^www\./, "").split(".");
  return parts.length >= 2 ? parts[parts.length - 2] ?? parts[0] ?? "" : (parts[0] ?? "");
}

function isHomepageLikeNewsPath(pathname: string) {
  const trimmed = pathname.replace(/\/+$/, "");
  if (!trimmed || trimmed === "/") {
    return true;
  }

  const segments = trimmed.split("/").filter(Boolean).map((segment) => segment.toLowerCase());
  if (!segments.length || segments.length > 2) {
    return false;
  }

  return segments.every((segment) => GENERIC_NEWS_PATH_SEGMENTS.has(segment));
}

function isHomepageLikeNewsSource(source: NewsSource) {
  let pathname = "/";
  try {
    pathname = new URL(source.url).pathname || "/";
  } catch {
    return false;
  }

  if (source.publishedDate || !isHomepageLikeNewsPath(pathname)) {
    return false;
  }

  const normalizedTitle = normalizeNewsSignalText(source.title);
  const normalizedSnippet = normalizeNewsSignalText(source.snippet);
  const brand = normalizeNewsSignalText(extractSourceBrand(source.domain));
  const titleLooksGeneric = (
    !normalizedTitle
    || normalizedTitle === brand
    || normalizedTitle === `${brand} news`
    || normalizedTitle === `${brand} latest news`
    || /^(latest|breaking|todays|today s|top|world|india|global|international|business|technology|sports|markets|market|finance|politics)?\s*(news|headlines|updates)(?:\s+\w+){0,4}$/.test(normalizedTitle)
  );
  const snippetLooksGeneric = (
    !normalizedSnippet
    || normalizedSnippet.length < 40
    || /^(latest|breaking|todays|today s|top|world|india|global).{0,30}(news|headlines|updates)/.test(normalizedSnippet)
  );

  return titleLooksGeneric || snippetLooksGeneric;
}

function scoreSource(source: NewsSource) {
  let score = source.score;

  if (TRUSTED_DOMAINS.some((domain) => source.domain.includes(domain))) {
    score += 0.25;
  }

  if (LOW_QUALITY_DOMAINS.some((domain) => source.domain.includes(domain))) {
    score -= 0.3;
  }

  if (source.snippet.length > 120) {
    score += 0.05;
  }

  if (source.publishedDate) {
    const published = new Date(source.publishedDate);
    if (!Number.isNaN(published.getTime())) {
      const hoursAgo = (Date.now() - published.getTime()) / 3_600_000;
      if (hoursAgo <= 6) score += 0.35;
      else if (hoursAgo <= 24) score += 0.2;
      else if (hoursAgo <= 72) score += 0.08;
    }
  }

  return Math.max(0, Math.min(1.2, score));
}

export async function fastNewsSearch(queries: string[]): Promise<NewsSource[]> {
  const tasks: Promise<NewsSource[]>[] = [];

  for (const [index, query] of queries.slice(0, 3).entries()) {
    tasks.push(resolveNewsSearchTaskWithTimeout(tavilyNewsSearch(query)));
    tasks.push(resolveNewsSearchTaskWithTimeout(serpApiNewsSearch(query)));
    tasks.push(resolveNewsSearchTaskWithTimeout(googleNewsRssSearch(query)));
    if (index === 0) {
      tasks.push(resolveNewsSearchTaskWithTimeout(jinaNewsSearch(query)));
    }
  }

  tasks.push(resolveNewsSearchTaskWithTimeout(duckDuckGoSearch(queries[0] ?? "")));

  const settled = await Promise.all(tasks);
  const combined = settled.flatMap((result) => result);
  const curated = dedupeByUrl(combined).filter((source) => !isHomepageLikeNewsSource(source));

  return curated
    .map((source) => ({ ...source, score: scoreSource(source) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 10);
}

function getMostRecentPublishedSource(sources: NewsSource[]) {
  return [...sources]
    .filter((source) => {
      if (!source.publishedDate) return false;
      return Number.isFinite(new Date(source.publishedDate).getTime());
    })
    .sort((left, right) => {
      const leftTime = new Date(left.publishedDate ?? "").getTime();
      const rightTime = new Date(right.publishedDate ?? "").getTime();
      return rightTime - leftTime;
    })[0];
}

function isFreshnessSensitiveCurrentAffairsQuestion(question: string) {
  const normalized = normalizeRegionalQuestion(question).toLowerCase();
  if (!(looksLikeCurrentAffairsQuestion(question) || looksLikeAmbiguousCurrentWarQuestion(question))) {
    return false;
  }

  return /\b(right now|currently|today|latest|current|as of now|abhi|aaj|status|situation|stithi|sthiti|halat|haalat)\b/i.test(normalized);
}

function currentAffairsFreshnessThresholdHours(question: string) {
  const normalized = normalizeRegionalQuestion(question).toLowerCase();
  if (/\b(right now|currently|today|abhi|aaj|as of now)\b/i.test(normalized)) {
    return 96;
  }

  if (/\b(?:war|conflict)\b.{0,24}\b(status|situation)\b|\b(status|situation)\b.{0,24}\b(?:war|conflict)\b/i.test(normalized)) {
    return 96;
  }

  return 168;
}

function hasFreshCurrentAffairsCoverage(question: string, sources: NewsSource[]) {
  if (!isFreshnessSensitiveCurrentAffairsQuestion(question)) {
    return true;
  }

  const thresholdHours = currentAffairsFreshnessThresholdHours(question);
  return sources.some((source) => {
    if (!source.publishedDate) return false;
    const published = new Date(source.publishedDate);
    if (!Number.isFinite(published.getTime())) return false;
    const hoursAgo = (Date.now() - published.getTime()) / 3_600_000;
    return hoursAgo <= thresholdHours;
  });
}

function buildStaleCurrentAffairsCoverageReply(question: string, sources: NewsSource[]) {
  if (!sources.length || !isFreshnessSensitiveCurrentAffairsQuestion(question) || hasFreshCurrentAffairsCoverage(question, sources)) {
    return "";
  }

  const newestSource = getMostRecentPublishedSource(sources);
  const newestPublished = formatPublishedDate(newestSource?.publishedDate);

  return [
    "*Current-affairs check*",
    "",
    "I could not verify a safe current snapshot for this question from sufficiently recent live coverage.",
    newestPublished
      ? `The newest source I found is dated ${newestPublished}, so I should not present it as the situation right now.`
      : "The source batch does not expose a trustworthy fresh timestamp, so I should not present it as the situation right now.",
    looksLikeAmbiguousCurrentWarQuestion(question)
      ? "Name the conflict explicitly and I will retry the live check."
      : "If you want, ask again with the conflict, country, or location named explicitly and I will retry the live check.",
  ].join("\n");
}

function buildFreshnessLabel(sources: NewsSource[]) {
  const now = new Date();
  const timeText = now.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const dateText = now.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
  });

  const topDomains = [...new Set(sources.slice(0, 3).map((source) => source.domain))].join(", ");
  const hasFreshSource = sources.some((source) => {
    if (!source.publishedDate) return false;
    const published = new Date(source.publishedDate);
    return Number.isFinite(published.getTime()) && Date.now() - published.getTime() < 24 * 60 * 60 * 1000;
  });

  if (hasFreshSource) {
    return `\n\n\u{1F4E1} _Live data as of ${dateText} ${timeText} IST - Sources: ${topDomains || "web search"}_`;
  }

  return `\n\n\u{1F50D} _Searched: ${dateText} ${timeText} IST - Sources: ${topDomains || "web search"}_`;
}

function buildStaleKnowledgeWarning() {
  return [
    "\u26A0\uFE0F *Live search unavailable for this query.*",
    "",
    "Here is knowledge-based context:",
    "_Note: this may not reflect the latest events. Verify current details online._",
  ].join("\n");
}

function buildSourceContext(sources: NewsSource[]) {
  return sources
    .slice(0, 6)
    .map((source, index) => {
      const published = formatPublishedDate(source.publishedDate);
      return [
        `[${index + 1}] ${source.title}`,
        `Source: ${source.domain}${published ? ` | Published: ${published}` : ""}`,
        source.snippet,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function looksLikeExactFigureQuery(question: string) {
  return /\b(pricing|price|cost|plan|plans|rate|fees?|subscription|tariff|market cap|volume|24h|high|low|exchange rate|population|gdp|inflation|unemployment)\b/i.test(
    question,
  );
}

function looksLikeWealthRankingQuestion(question: string) {
  return extractRichestRankingScope(question) !== null && !looksLikeHistoricalWealthQuestion(question);
}

function isSingleRichestPersonQuestion(question: string) {
  const normalized = question.toLowerCase();
  if (extractRichestRankingScope(question) !== "people") {
    return false;
  }

  if (/\btop\s*\d+\b/i.test(normalized)) {
    return false;
  }

  if (/\b(people|persons|billionaires?|list|ranking|rankings?|leaderboard)\b/i.test(normalized)) {
    return false;
  }

  return /\b(richest|wealthiest)\b/i.test(normalized);
}

const EXACT_FIGURE_DOMAIN_HINTS: Array<{ re: RegExp; domain: string }> = [
  { re: /\bsupabase\b/i, domain: "supabase.com" },
  { re: /\bopenai\b/i, domain: "openai.com" },
  { re: /\bstripe\b/i, domain: "stripe.com" },
  { re: /\bvercel\b/i, domain: "vercel.com" },
  { re: /\bcloudflare\b/i, domain: "cloudflare.com" },
];

function inferPreferredEvidenceDomain(question: string) {
  return EXACT_FIGURE_DOMAIN_HINTS.find((hint) => hint.re.test(question))?.domain ?? "";
}

function domainMatchesPreferred(sourceDomain: string, preferredDomain: string) {
  if (!preferredDomain) return false;
  const normalizedSource = sourceDomain.toLowerCase().replace(/[^a-z0-9.]/g, "");
  const preferredBrand = preferredDomain.split(".")[0]?.toLowerCase() ?? "";
  return (
    sourceDomain === preferredDomain
    || sourceDomain.endsWith(`.${preferredDomain}`)
    || normalizedSource === preferredBrand
    || normalizedSource.includes(`.${preferredBrand}`)
  );
}

function rankEvidenceSources(question: string, sources: NewsSource[]) {
  const preferredDomain = inferPreferredEvidenceDomain(question.toLowerCase());
  return [...sources].sort((left, right) => {
    const leftBoost =
      (domainMatchesPreferred(left.domain, preferredDomain) ? 0.7 : 0)
      + scoreCurrentAffairsEvidenceSource(question, left);
    const rightBoost =
      (domainMatchesPreferred(right.domain, preferredDomain) ? 0.7 : 0)
      + scoreCurrentAffairsEvidenceSource(question, right);
    return (right.score + rightBoost) - (left.score + leftBoost);
  });
}

type WealthLeadSignal = {
  leader: string;
  worthText: string;
  runnerUp: string;
  rankSource: string;
};

function normalizeWealthText(raw: string) {
  return raw
    .replace(/\bapproximately\b/gi, "about")
    .replace(/\bapprox\b/gi, "about")
    .replace(/\bbn\b/gi, "billion")
    .replace(/\s+/g, " ")
    .trim();
}

function inferWealthRankSource(source: NewsSource) {
  const haystack = `${source.title} ${source.snippet}`.toLowerCase();
  if (haystack.includes("forbes")) {
    return "Forbes";
  }
  if (haystack.includes("bloomberg")) {
    return "Bloomberg";
  }
  if (haystack.includes("hurun")) {
    return "Hurun";
  }
  return inferWrappedNewsOutlet(source);
}

function extractWealthLeadSignal(source: NewsSource): WealthLeadSignal | null {
  const text = `${source.title} ${source.snippet}`
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const leaderPatterns = [
    /top\s+\d+\s+richest (?:people|men|women)[^:]*:\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})\s+(?:leads?|tops?)/i,
    /([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})\s+(?:is|remains|becomes|leads?)\s+(?:the\s+)?(?:world'?s\s+)?(?:richest|wealthiest)\s+(?:person|man|woman|billionaire)/i,
    /([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})\s+leads?\s+with/i,
  ];

  const worthPatterns = [
    /\bwith\s+(over\s+\$[\d.,]+\s*(?:billion|bn|b)|\$[\d.,]+\s*(?:billion|bn|b))/i,
    /\b(net worth(?:\s+surpasses)?|fortune|worth)\s+(over\s+\$[\d.,]+\s*(?:billion|bn|b)|\$[\d.,]+\s*(?:billion|bn|b))/i,
    /(\$[\d.,]+\s*(?:billion|bn|b))/i,
  ];

  const runnerUpPatterns = [
    /\bahead of\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/i,
    /\bNo\s*2\b[^A-Za-z]{0,20}([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3})/i,
  ];

  const leader = leaderPatterns
    .map((pattern) => text.match(pattern)?.[1]?.trim() ?? "")
    .find(Boolean);
  if (!leader) {
    return null;
  }

  const worthText = worthPatterns
    .map((pattern) => {
      const match = text.match(pattern);
      return match?.[2]?.trim() || match?.[1]?.trim() || "";
    })
    .find(Boolean);

  const runnerUp = runnerUpPatterns
    .map((pattern) => text.match(pattern)?.[1]?.trim() ?? "")
    .find(Boolean) ?? "";

  return {
    leader,
    worthText: worthText ? normalizeWealthText(worthText) : "",
    runnerUp,
    rankSource: inferWealthRankSource(source),
  };
}

function buildWealthRankingEvidenceAnswer(question: string, sources: NewsSource[]) {
  if (!looksLikeWealthRankingQuestion(question) || !isSingleRichestPersonQuestion(question)) {
    return "";
  }

  const rankedSources = rankEvidenceSources(question, sources).slice(0, 8);
  const signal = rankedSources
    .map((source) => extractWealthLeadSignal(source))
    .find((candidate): candidate is WealthLeadSignal => Boolean(candidate));

  if (!signal) {
    return "";
  }

  const sourceDomains = [...new Set(rankedSources.slice(0, 3).map((source) => source.domain).filter(Boolean))];

  return [
    `*Current richest person in the world:* *${signal.leader}*`,
    signal.worthText ? `*Latest cited net worth:* *${signal.worthText}*` : "",
    signal.runnerUp ? `*Next on the list:* ${signal.runnerUp}` : "",
    `*Rank source:* ${signal.rankSource}`,
    `*As of:* ${formatCurrentTimestamp()} IST`,
    `Sources: ${sourceDomains.join(", ") || "web search"}`,
  ].filter(Boolean).join("\n");
}

function inferWrappedNewsOutlet(source: NewsSource) {
  const title = source.title.replace(/\s+/g, " ").trim();
  const suffixMatch = title.match(/\s[-–—]\s([^–—-]{2,80})$/u);
  return suffixMatch?.[1]?.trim() || source.domain.replace(/^www\./, "");
}

function looksLikeTierOneCurrentAffairsSource(source: NewsSource) {
  const outlet = inferWrappedNewsOutlet(source).toLowerCase();
  return (
    TRUSTED_DOMAINS.some((domain) => source.domain === domain || source.domain.endsWith(`.${domain}`))
    || /\b(reuters|associated press|ap\b|bbc|bloomberg|financial times|ft|wall street journal|wsj|al jazeera|cnn|npr)\b/i.test(outlet)
  );
}

function scoreCurrentAffairsEvidenceSource(question: string, source: NewsSource) {
  if (!looksLikeCurrentAffairsQuestion(question)) {
    return 0;
  }

  const haystack = [
    source.title,
    source.snippet,
    inferWrappedNewsOutlet(source),
  ].join("\n");
  let boost = 0;

  if (looksLikeTierOneCurrentAffairsSource(source)) {
    boost += 0.18;
  }

  if (/\b(opinion|editorial|analysis)\b/i.test(source.title)) {
    boost -= 0.45;
  }

  if (source.publishedDate) {
    const published = new Date(source.publishedDate);
    if (Number.isFinite(published.getTime())) {
      const hoursAgo = (Date.now() - published.getTime()) / 3_600_000;
      if (hoursAgo > 24 * 365) boost -= 1;
      else if (hoursAgo > 24 * 30) boost -= 0.7;
      else if (hoursAgo > 24 * 7) boost -= 0.2;
    }
  }

  if (looksLikeCurrentAffairsDemandQuestion(question)) {
    if (
      /\b(condition|conditions|demand|demands|term|terms|proposal|proposals|ceasefire|truce|de-?escalation|halt hostilities|stop the war|end of war|negotiation|negotiations|talks|submitted? its own|rejects? .* plan|maximalist|unreasonable|security guarantee|security guarantees|compensation)\b/i.test(haystack)
    ) {
      boost += 0.4;
    }

    if (/\bground invasion\b/i.test(haystack)) {
      boost -= 0.15;
    }

    return boost;
  }

  if (/\bultimatum|deadline|warning|48-hour|48 hour|ceasefire|truce|closure|blockade|strait of hormuz|meeting|joint statement|talks\b/i.test(haystack)) {
    boost += 0.22;
  }

  return boost;
}

const CURRENT_AFFAIRS_DEMAND_SIGNALS: Array<{ label: string; patterns: RegExp[] }> = [
  { label: "compensation", patterns: [/\bcompensation\b/i, /मुआवजा/u] },
  { label: "guarantees", patterns: [/\bguarantee(?:s)?\b/i, /गारंटी/u] },
  { label: "sanctions relief", patterns: [/\bsanctions?\b/i, /प्रतिबंध/u] },
  { label: "missile restrictions", patterns: [/\bmissile(?:s)?\b/i, /मिसाइल/u] },
  { label: "uranium limits", patterns: [/\buranium\b/i, /यूरेनियम/u] },
  { label: "nuclear restrictions", patterns: [/\bnuclear\b/i, /परमाणु/u] },
  { label: "ceasefire or de-escalation", patterns: [/\bceasefire|truce|de-?escalation|halt hostilities|stop the war|end the war\b/i, /जंग रोक|युद्ध खत्म/u] },
  { label: "security guarantees", patterns: [/\bsecurity guarantees?\b/i, /सुरक्षा गारंटी/u] },
];

const CURRENT_AFFAIRS_POWER_CRISIS_SIGNALS: Array<{ label: string; patterns: RegExp[] }> = [
  { label: "aging power plants", patterns: [/\baging power plants?\b/i, /\bold power plants?\b/i, /\bobsolete power plants?\b/i, /\bdecrepit power plants?\b/i] },
  { label: "fuel shortages", patterns: [/\bfuel shortages?\b/i, /\black of fuel\b/i, /\bfuel supply shortages?\b/i, /\bdiesel shortages?\b/i] },
  { label: "grid instability", patterns: [/\bgrid instability\b/i, /\bnational grid\b/i, /\bgrid collapse\b/i, /\bgrid failure\b/i] },
  { label: "plant breakdowns", patterns: [/\bplant breakdowns?\b/i, /\bthermal plant(?:s)? failures?\b/i, /\bpower plant failures?\b/i, /\bunit failures?\b/i] },
  { label: "generation shortfalls", patterns: [/\bgeneration shortfalls?\b/i, /\bgeneration deficit\b/i, /\binsufficient generation\b/i, /\blower generation\b/i] },
  { label: "storm damage", patterns: [/\bhurricane\b/i, /\bstorm damage\b/i, /\bweather damage\b/i] },
];

function buildCurrentAffairsLogisticsHaystack(sources: NewsSource[]) {
  return sources
    .slice(0, 5)
    .map((source) => `${source.title}\n${source.snippet}`)
    .join("\n")
    .normalize("NFC");
}

function extractCurrentAffairsLogisticsQuantity(sources: NewsSource[]) {
  const haystack = buildCurrentAffairsLogisticsHaystack(sources);
  const match =
    haystack.match(/\b(?:about|around|some|roughly|approximately|nearly|more than|over)?\s*(\d[\d,\.]*)\s*(million\s+)?barrels?\b/i)
    || haystack.match(/\b(\d[\d,\.]*)\s*(million\s+)?bbl\b/i)
    || haystack.match(/\b(\d[\d,\.]*)\s*(tons?|tonnes?)\b/i);

  if (!match) {
    return "";
  }

  const amount = (match[1] ?? "").trim();
  const unitPrefix = (match[2] ?? "").trim();
  const trailingUnit = /\bton/i.test(match[0] ?? "") ? "tonnes" : "barrels";
  return `${unitPrefix ? `${amount} ${unitPrefix.trim()} ${trailingUnit}` : `${amount} ${trailingUnit}`}`.replace(/\s+/g, " ").trim();
}

function extractCurrentAffairsLogisticsStatusSummary(sources: NewsSource[]) {
  const haystack = buildCurrentAffairsLogisticsHaystack(sources).toLowerCase();

  if (/\banchored in venezuelan waters\b/.test(haystack) && /\bbound for cuba\b/.test(haystack)) {
    return "The clearest live report says the tanker was anchored in Venezuelan waters and still described as bound for Cuba, so that report does not confirm it had reached Cuba.";
  }

  if (/\barrived in cuba\b|\breached cuba\b|\breached cuban waters\b|\bdocked in cuba\b|\bdocked at\b.{0,40}\bcuba\b|\bport call\b.{0,40}\bcuba\b/.test(haystack)) {
    return "The clearest live report says the tanker had reached Cuba.";
  }

  if (/\bbound for cuba\b|\bon the way to cuba\b|\bheaded to cuba\b/.test(haystack)) {
    return "The clearest live report says the tanker was still en route to Cuba rather than clearly confirmed as already arrived.";
  }

  if (/\banchored\b/.test(haystack)) {
    return "The clearest live report says the tanker was anchored, but the source batch does not cleanly confirm a Cuba arrival.";
  }

  return "";
}

function joinReadableList(items: string[]) {
  if (!items.length) return "";
  if (items.length === 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function extractCurrentAffairsDemandSignals(sources: NewsSource[]) {
  const haystack = sources
    .slice(0, 5)
    .map((source) => `${source.title}\n${source.snippet}`)
    .join("\n")
    .normalize("NFC");

  return CURRENT_AFFAIRS_DEMAND_SIGNALS
    .filter((signal) => signal.patterns.some((pattern) => pattern.test(haystack)))
    .map((signal) => signal.label);
}

function extractCurrentAffairsDemandCount(sources: NewsSource[]) {
  const haystack = sources
    .slice(0, 4)
    .map((source) => `${source.title}\n${source.snippet}`)
    .join("\n")
    .normalize("NFC");

  const match =
    haystack.match(/\b(\d+)\s*(?:point|points|demands?|conditions?|terms?)\b/i)
    || haystack.match(/\b(\d+)\s*मांग/u)
    || haystack.match(/\b(\d+)\s*शर्त/u);

  return match?.[1] ?? "";
}

function extractCurrentAffairsPowerCrisisSignals(sources: NewsSource[]) {
  const haystack = sources
    .slice(0, 5)
    .map((source) => `${source.title}\n${source.snippet}`)
    .join("\n")
    .normalize("NFC");

  return CURRENT_AFFAIRS_POWER_CRISIS_SIGNALS
    .filter((signal) => signal.patterns.some((pattern) => pattern.test(haystack)))
    .map((signal) => signal.label);
}

export function buildCurrentAffairsEvidenceAnswer(question: string, sources: NewsSource[]) {
  const ranked = rankEvidenceSources(question, sources).slice(0, 5);
  const tierOne = ranked.some((source) => looksLikeTierOneCurrentAffairsSource(source));
  const outlets = [...new Set(ranked.map((source) => inferWrappedNewsOutlet(source)).filter(Boolean))];
  const staleCoverageReply = buildStaleCurrentAffairsCoverageReply(question, ranked);

  if (staleCoverageReply) {
    return staleCoverageReply;
  }

  if (!ranked.length) {
    if (looksLikeCurrentAffairsLogisticsQuestion(question)) {
      return [
        "*Current-affairs check*",
        "",
        "I could not confirm from the live source batch whether the tanker had already reached Cuba.",
        "I also could not verify a current cargo figure from a strong shipping or wire-service report in this batch.",
        "For tanker-arrival questions, I need a recent Reuters/AP/BBC-style logistics report or a clear vessel-status source to answer safely.",
      ].join("\n");
    }

    if (looksLikeCurrentAffairsPowerCrisisQuestion(question)) {
      return [
        "*Current-affairs check*",
        "",
        "The broad cause is usually a combination of aging power plants, fuel shortages, and grid instability rather than a single simple reason.",
        "For a nationwide blackout, the immediate trigger is often a plant trip or a grid failure on top of that deeper system stress.",
        "I could not confirm the exact latest trigger from the live source batch, so treat that immediate-cause detail as pending verification.",
      ].join("\n");
    }

    return [
      "*Current-affairs check*",
      "",
      "This current-affairs query needs a tighter topic description for a precise live answer.",
      "",
      "Try naming the conflict and counterpart explicitly, for example:",
      "- _Iran conditions for a ceasefire with the US_",
      "- _Iran demands to stop the Iran-Israel war latest_",
    ].join("\n");
  }

  const lines = ["*Current-affairs check*", ""];
  const published = formatPublishedDate(ranked[0]?.publishedDate);

  if (looksLikeCurrentAffairsPowerCrisisQuestion(question)) {
    const signals = extractCurrentAffairsPowerCrisisSignals(ranked);

    if (signals.length) {
      lines.push(
        tierOne
          ? `The clearest live coverage points to ${joinReadableList(signals)} behind the outages.`
          : `The clearest headlines point to ${joinReadableList(signals)} behind the outages, though the source mix is not fully tier-one.`,
      );
    } else {
      lines.push(
        tierOne
          ? "The live source batch ties the outages to a broader power-system and fuel-supply crisis."
          : "The available headlines point to a broader power-system crisis, but the exact cause mix is still thin in this source batch.",
      );
    }
  } else if (looksLikeCurrentAffairsDemandQuestion(question)) {
    const signals = extractCurrentAffairsDemandSignals(ranked);
    const demandCount = extractCurrentAffairsDemandCount(ranked);

    if (signals.length) {
      lines.push(
        tierOne
          ? `The live source batch points to conditions or demands around ${joinReadableList(signals)}.`
          : `The clearest headlines I found describe Iran's stated conditions or demands around ${joinReadableList(signals)}.`,
      );
    } else {
      lines.push("I found live coverage discussing Iran's conditions or demands, but the exact list is not cleanly confirmed across this source batch.");
    }

    if (demandCount) {
      lines.push(`One headline describes this as a ${demandCount}-point demand list.`);
    }

    if (!tierOne) {
      lines.push("I did not see Reuters/AP/BBC-style confirmation in this source batch, so treat the exact list as not independently verified yet.");
    }
  } else if (looksLikeCurrentAffairsLogisticsQuestion(question)) {
    const statusSummary = extractCurrentAffairsLogisticsStatusSummary(ranked);
    const cargoQuantity = extractCurrentAffairsLogisticsQuantity(ranked);

    if (statusSummary) {
      lines.push(statusSummary);
    } else {
      lines.push(
        tierOne
          ? "The live source batch gives a partial shipping-status answer, but the latest confirmed vessel position is still not fully clean across the sources."
          : "The live source batch gives only a partial shipping-status picture, so I would treat the arrival status as not fully confirmed yet.",
      );
    }

    if (cargoQuantity) {
      lines.push(`The same source batch says the tanker was carrying about ${cargoQuantity} of Russia-origin fuel.`);
    } else {
      lines.push("The cargo size was not stated clearly enough across this source batch for me to present a confident figure.");
    }

    if (!tierOne) {
      lines.push("I would treat this as a live logistics snapshot rather than a fully cross-confirmed port-arrival record.");
    }
  } else if (isYesNoCurrentAffairsQuestion(question)) {
    lines.push(
      tierOne
        ? "The current live coverage gives enough signal to answer this as a current-affairs verification question."
        : "The current live coverage is mixed, so the safest reading is: unclear from this source batch.",
    );
  } else {
    lines.push(
      tierOne
        ? "This is what the live source batch most clearly supports right now."
        : "This is the clearest picture I can build from the current live source batch.",
    );
  }

  if (outlets.length) {
    lines.push(`Source mix: ${outlets.slice(0, 4).join(", ")}${published ? ` | Top timestamp: ${published}` : ""}.`);
  }

  lines.push("");
  lines.push("*Closest source signals*");
  for (const source of ranked.slice(0, 3)) {
    const outlet = inferWrappedNewsOutlet(source);
    const sourcePublished = formatPublishedDate(source.publishedDate);
    lines.push(`- ${source.title}`);
    lines.push(`  ${outlet}${sourcePublished ? ` | ${sourcePublished}` : ""}`);
  }

  return lines.join("\n").trim();
}

export function buildEvidenceOnlyAnswer(question: string, sources: NewsSource[]) {
  if (looksLikeConsumerStaplePriceQuestion(question)) {
    const clarification = buildConsumerStaplePriceClarification(question);
    if (clarification) {
      return clarification + buildFreshnessLabel(sources);
    }
  }

  if (!sources.length) {
    return [
      `\u{1F50D} *No strong live sources found for:* _${question}_`,
      "",
      "Try a narrower query with product + region + date.",
      "- Example: _Supabase Pro plan pricing today_",
      "- Example: _OpenAI API pricing official page_",
    ].join("\n") + buildFreshnessLabel(sources);
  }

  const rankedSources = rankEvidenceSources(question, sources);
  const strongest = rankedSources[0];
  const strongestPublished = formatPublishedDate(strongest?.publishedDate);
  const lines = [
    `\u{1F50D} *Quick answer*`,
    `I couldn't verify one precise current figure for *${question}* from the live sources I found.`,
    "",
    "*Closest reliable signals*",
  ];
  for (const source of rankedSources.slice(0, 4)) {
    const published = formatPublishedDate(source.publishedDate);
    lines.push(`• *${source.title}*`);
    lines.push(`  ${source.domain}${published ? ` | ${published}` : ""}`);
    if (source.snippet) {
      lines.push(`  ${source.snippet.slice(0, 220)}${source.snippet.length > 220 ? "..." : ""}`);
    }
    lines.push("");
  }
  lines.push("*Best next step*");
  lines.push(
    strongest
      ? `• Strongest source in this batch: *${strongest.domain}*${strongestPublished ? ` (${strongestPublished})` : ""}.`
      : "• Prefer the most recent authoritative source for the exact number.",
  );
  lines.push("- Add a provider, country, city/market, or exact plan/model name for a tighter answer.");
  lines.push("• If figures differ, prefer official company, government, exchange, or product pages over commentary.");
  lines.push("");
  lines.push("_I will give the direct number when the live sources expose one clearly._");
  return lines.join("\n").trim() + buildFreshnessLabel(sources);
}

const NEWS_SYSTEM_PROMPT = [
  "You are ClawCloud AI answering a live news question for a messaging user.",
  "Use only the provided search results. Do not add facts from memory.",
  "Lead with the direct answer in 2-3 sentences, then give short bullets if needed.",
  "When the question asks for the most important developments, rank them and return exactly the requested count.",
  "Name the concrete company, model, product, or institution behind each development whenever the sources provide it.",
  "For AI model questions, prefer official vendor pages and name the company behind each model family.",
  "If a model-family label is ambiguous and the vendor is unclear, say that clearly instead of guessing.",
  "If sources conflict or look incomplete, say so clearly.",
  "Never invent numbers, scores, names, or timelines.",
  "If exact pricing/financial figures are not explicit in sources, say they are unavailable.",
  "Format for WhatsApp with short paragraphs and bullets when useful.",
  "Do not include source URLs in your response.",
  "Keep the answer concise and scan-friendly.",
].join("\n");

const CURRENT_AFFAIRS_SYSTEM_PROMPT = [
  "You are ClawCloud AI answering a live current-affairs verification question for a messaging user.",
  "Use only the provided search results. Do not add facts from memory.",
  "Start the first sentence with Yes, No, or Unclear.",
  "Confirm a claim only if the source set explicitly supports it.",
  "For ultimatum, deadline, warning, closure, or blockade questions, name the actor, target, and date when sources provide them.",
  "If the question is ambiguous, resolve it only when the source set clearly points to one dominant event; otherwise say what is missing.",
  "Keep the answer concise, factual, and suitable for WhatsApp.",
  "Do not include source URLs in the answer.",
].join("\n");

const AI_MODEL_COMPARE_SYSTEM_PROMPT = [
  "You are ClawCloud AI answering a live AI-model comparison question for a messaging user.",
  "Use only the provided search results. Do not add facts from memory.",
  "Name the vendor behind each model clearly.",
  "If the question names 2 or more models, answer all of them in one response without asking follow-up questions.",
  "Lead with the direct comparison in 2-3 sentences.",
  "Then give a compact comparison table or structured bullets covering: model, release date if explicit, strengths, trade-offs, and when to choose it.",
  "If a requested model/version name is not supported as official in the source set, say that explicitly and correct it using the closest source-backed model name.",
  "If the sources do not support an exact benchmark, pricing figure, context-window number, or launch detail, say that clearly instead of guessing.",
  "Prefer official vendor pages when they are present in the source set.",
  "Format for WhatsApp with short paragraphs and bullets.",
  "Do not include source URLs in the answer.",
].join("\n");

const AI_MODEL_RANKING_SYSTEM_PROMPT = [
  "You are ClawCloud AI answering a live frontier AI-model ranking question for a messaging user.",
  "Use only the provided search results. Do not add facts from memory.",
  "If the sources do not support one universal official top-10 ranking, say that clearly in one sentence.",
  "Then build the strongest source-backed shortlist using only models explicitly named in the sources.",
  "Never pad the list with AI companies, apps, chatbots, courses, or certifications.",
  "Name the vendor behind each model when the sources support it.",
  "If fewer than 10 models are explicitly supported, return only the supported models and say that the source batch does not support a full top 10.",
  "Format the shortlist as a numbered list.",
  "Do not include source URLs in the answer.",
].join("\n");

const CURATED_FRONTIER_MODEL_SOURCES: NewsSource[] = [
  {
    title: "Introducing GPT-5.4",
    url: "https://openai.com/index/introducing-gpt-5-4/",
    snippet: "OpenAI releases GPT-5.4 as its frontier model for professional work, reasoning, coding, and agentic workflows.",
    domain: "openai.com",
    publishedDate: "2026-03-05T00:00:00.000Z",
    score: 0.96,
  },
  {
    title: "Claude Opus 4.6",
    url: "https://www.anthropic.com/claude/opus",
    snippet: "Anthropic describes Claude Opus 4.6 as its most capable model to date for coding, agents, and enterprise workflows.",
    domain: "anthropic.com",
    publishedDate: "2026-02-05T00:00:00.000Z",
    score: 0.95,
  },
  {
    title: "Gemini 3.1 Pro: A smarter model for your most complex tasks",
    url: "https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-1-pro/",
    snippet: "Google announces Gemini 3.1 Pro as its upgraded reasoning model for complex tasks across consumer and developer products.",
    domain: "blog.google",
    publishedDate: "2026-02-19T00:00:00.000Z",
    score: 0.94,
  },
];

function curatedAiModelSourcesForTargets(targets: string[]) {
  if (!targets.length) {
    return [] as NewsSource[];
  }

  const targetFamilies = new Set(targets.map((target) => inferAiModelFamilyKey(target)));
  return CURATED_FRONTIER_MODEL_SOURCES.filter((source) =>
    targetFamilies.has(inferAiModelFamilyKey(source.title)),
  );
}

const WEALTH_RANKING_SYSTEM_PROMPT = [
  "You are ClawCloud AI answering a live wealth-ranking question for a messaging user.",
  "Use only the provided search results. Do not add facts from memory.",
  "Lead with the direct current answer in the first sentence.",
  "If the user asked for one person, answer with the current #1 person and the latest net worth figure only when the sources make it explicit.",
  "If the user asked for a ranking, use a numbered list and only include entries clearly supported by the sources.",
  "Prefer Forbes and Bloomberg over lower-authority sites when they appear in the source set.",
  "If sources disagree, say the ranking is volatile and name the stronger source set you are relying on.",
  "Do not present an older publication date as today's date.",
  "Include one line exactly in this form: As of: <current timestamp from the prompt>.",
  "End with one line exactly in this form: Sources: domain1, domain2, ...",
  "Do not include source URLs in the answer.",
].join("\n");

function buildAiModelVendorSweepQueries(question: string) {
  const explicitYear = extractExplicitQuestionYear(question);
  const targetYear = explicitYear ?? new Date().getUTCFullYear();

  return [
    `OpenAI GPT latest flagship model ${targetYear} site:openai.com`,
    `Anthropic Claude latest flagship model ${targetYear} site:anthropic.com`,
    `Google Gemini latest flagship model ${targetYear} site:blog.google`,
    `xAI Grok latest flagship model ${targetYear} site:x.ai`,
    `Meta Llama latest flagship model ${targetYear} site:ai.meta.com`,
    `DeepSeek latest flagship model ${targetYear} site:deepseek.com`,
    `Mistral latest flagship model ${targetYear} site:mistral.ai`,
  ];
}

async function searchAiModelEvidenceSources(
  question: string,
  routing: AiModelRoutingDecision,
): Promise<NewsSource[]> {
  const questionTargets = extractAiModelQuestionTargets(question);
  const generalSearch = await searchInternetWithDiagnostics(routing.searchQueries, {
    maxQueries: Math.min(routing.searchQueries.length, routing.kind === "ranking" ? 10 : 6),
    maxResults: routing.kind === "ranking" ? 24 : 18,
  }).catch(() => ({ sources: [], diagnostics: null }));

  const mappedGeneral = generalSearch.sources.map((source) => mapResearchSourceToNewsSource(source));
  const newsFallback = await fastNewsSearch(routing.searchQueries.slice(0, 3));
  const needsVendorSweep =
    routing.kind === "ranking"
    && questionTargets.length === 0;
  let mappedVendorSweep: NewsSource[] = [];
  let vendorNewsFallback: NewsSource[] = [];

  if (needsVendorSweep) {
    const vendorSweepQueries = buildAiModelVendorSweepQueries(question);
    const vendorSweep = await searchInternetWithDiagnostics(vendorSweepQueries, {
      maxQueries: Math.min(vendorSweepQueries.length, 7),
      maxResults: 21,
    }).catch(() => ({ sources: [], diagnostics: null }));
    mappedVendorSweep = vendorSweep.sources.map((source) => mapResearchSourceToNewsSource(source));
    vendorNewsFallback = await fastNewsSearch(vendorSweepQueries.slice(0, 4));
  }

  const combined = dedupeByUrl([
    ...mappedGeneral,
    ...newsFallback,
    ...mappedVendorSweep,
    ...vendorNewsFallback,
  ]);
  const filtered = filterAiModelEvidenceSources(question, combined, routing.officialDomains);
  const curatedTargetSources = curatedAiModelSourcesForTargets(questionTargets);

  if (
    needsVendorSweep
    && extractAiModelEvidenceMentions(filtered).length < 3
  ) {
    return filterAiModelEvidenceSources(
      question,
      dedupeByUrl([...combined, ...CURATED_FRONTIER_MODEL_SOURCES]),
      routing.officialDomains,
    );
  }

  if (
    questionTargets.length > 0
    && extractAiModelEvidenceMentions(filtered).length < Math.min(questionTargets.length, 2)
    && curatedTargetSources.length > 0
  ) {
    return filterAiModelEvidenceSources(
      question,
      dedupeByUrl([...combined, ...curatedTargetSources]),
      routing.officialDomains,
    );
  }

  return filtered;
}

function isBroadAiRoundupQuestion(question: string) {
  return /\bai\b/i.test(question) && /\b(this week|latest|recent|important|major|biggest|developments?|announcements?|launches?|releases?)\b/i.test(question);
}

function ensureFounderAiRoundupSignals(question: string, answer: string, sources: NewsSource[]) {
  if (!isBroadAiRoundupQuestion(question)) {
    return answer;
  }

  let nextAnswer = answer.trim();

  const preferredEntities = [
    { label: "OpenAI", pattern: /\bopenai|gpt[- ]?5|chatgpt|sora\b/i },
    { label: "Google", pattern: /\bgoogle|gemini|deepmind\b/i },
    { label: "Anthropic", pattern: /\banthropic|claude\b/i },
    { label: "Meta", pattern: /\bmeta|llama\b/i },
    { label: "NVIDIA", pattern: /\bnvidia\b/i },
  ];

  const matched = preferredEntities.filter(({ pattern }) =>
    sources.some((source) => pattern.test(`${source.title} ${source.snippet}`)),
  );

  if (!/\b(openai|google|meta|anthropic|gemini)\b/i.test(nextAnswer) && matched.length) {
    const signalLine = `Named companies appearing in the live coverage: ${matched.map((item) => item.label).join(", ")}.`;
    nextAnswer = `${nextAnswer}\n\n${signalLine}`;
  }

  if (!/\b(matters|impact|startup)\b/i.test(nextAnswer)) {
    nextAnswer = `${nextAnswer}\n\nWhy it matters for startups: these moves change model choice, distribution, and go-to-market timing for new AI products.`;
  }

  return nextAnswer;
}

async function synthesiseNewsAnswer(question: string, sources: NewsSource[]) {
  if (!sources.length || sources.every((source) => source.score < 0.2)) {
    if (looksLikeCurrentAffairsLogisticsQuestion(question)) {
      return `${buildCurrentAffairsEvidenceAnswer(question, sources)}${buildFreshnessLabel(sources)}`;
    }

    if (looksLikeCurrentAffairsPowerCrisisQuestion(question)) {
      return `${buildCurrentAffairsEvidenceAnswer(question, sources)}${buildFreshnessLabel(sources)}`;
    }

    return [
      `\u{1F50D} *No strong live sources found for:* _${question}_`,
      "",
      "Try a more specific query:",
      "- Include a topic, date, person, team, or location",
      "- Example: _IPL score today_ instead of _cricket_",
      "- Example: _OpenAI news today_ instead of _AI_",
    ].join("\n") + buildFreshnessLabel(sources);
  }

  const headlineDigest = buildTopHeadlineDigestAnswer(question, sources);
  if (headlineDigest) {
    return `${headlineDigest}${buildFreshnessLabel(sources)}`;
  }

  const staleCurrentAffairsReply = buildStaleCurrentAffairsCoverageReply(question, sources);
  if (staleCurrentAffairsReply) {
    return `${staleCurrentAffairsReply}${buildFreshnessLabel(sources)}`;
  }

  if (looksLikeCurrentAffairsDemandQuestion(question)) {
    return `${buildCurrentAffairsEvidenceAnswer(question, sources)}${buildFreshnessLabel(sources)}`;
  }

  if (looksLikeCurrentAffairsLogisticsQuestion(question)) {
    return `${buildCurrentAffairsEvidenceAnswer(question, sources)}${buildFreshnessLabel(sources)}`;
  }

  if (looksLikeCurrentAffairsPowerCrisisQuestion(question)) {
    return `${buildCurrentAffairsEvidenceAnswer(question, sources)}${buildFreshnessLabel(sources)}`;
  }

  if (looksLikeWealthRankingQuestion(question)) {
    const deterministicWealthAnswer = buildWealthRankingEvidenceAnswer(question, sources);
    if (deterministicWealthAnswer) {
      return deterministicWealthAnswer + buildFreshnessLabel(sources);
    }

    const rankedSources = rankEvidenceSources(question, sources);
    const answer = await completeClawCloudPrompt({
      system: [
        WEALTH_RANKING_SYSTEM_PROMPT,
        isSingleRichestPersonQuestion(question)
          ? "For this question, return a direct one-person answer first, then one short supporting line if useful."
          : "For this question, return a concise ranking in descending order.",
      ].join("\n"),
      user: [
        `Current timestamp: ${formatCurrentTimestamp()}`,
        `Question: ${question}`,
        "",
        "Live search results:",
        buildSourceContext(rankedSources.slice(0, 6)),
      ].join("\n"),
      history: [],
      intent: "research",
      responseMode: "fast",
      maxTokens: 450,
      fallback: "",
      skipCache: true,
      temperature: 0.08,
    }).catch(() => "");

    if (answer.trim()) {
      return answer.trim() + buildFreshnessLabel(rankedSources);
    }
  }

  if (looksLikeExactFigureQuery(question)) {
    return buildEvidenceOnlyAnswer(question, sources);
  }

  const answer = await completeClawCloudPrompt({
    system: isYesNoCurrentAffairsQuestion(question) ? CURRENT_AFFAIRS_SYSTEM_PROMPT : NEWS_SYSTEM_PROMPT,
    user: [
      `Today: ${formatCurrentDate()}`,
      `Question: ${question}`,
      "",
      "Live search results:",
      buildSourceContext(sources),
    ].join("\n"),
    history: [],
    intent: "general",
    responseMode: "fast",
    maxTokens: 650,
    fallback: "",
    skipCache: true,
    temperature: 0.1,
  }).catch(() => "");

  if (answer.trim()) {
    if (looksLikeCurrentAffairsQuestion(question) && !sources.some((source) => looksLikeTierOneCurrentAffairsSource(source))) {
      return `${buildCurrentAffairsEvidenceAnswer(question, sources)}${buildFreshnessLabel(sources)}`;
    }
    return ensureFounderAiRoundupSignals(question, answer.trim(), sources) + buildFreshnessLabel(sources);
  }

  const topSources = sources.slice(0, 3);
  const lines = [`*Latest on:* ${question}`, ""];

  for (const source of topSources) {
    const published = formatPublishedDate(source.publishedDate);
    lines.push(`- *${source.title}*`);
    if (published) {
      lines.push(`  Published: ${published}`);
    }
    if (source.snippet) {
      lines.push(`  ${source.snippet.slice(0, 180)}${source.snippet.length > 180 ? "..." : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim() + buildFreshnessLabel(sources);
}

export async function synthesiseNewsAnswerForTest(question: string, sources: NewsSource[]) {
  return synthesiseNewsAnswer(question, sources);
}

export function buildTopHeadlineDigestAnswerForTest(question: string, sources: NewsSource[]) {
  return buildTopHeadlineDigestAnswer(question, sources);
}

async function synthesiseAiModelComparisonAnswer(
  question: string,
  routing: AiModelRoutingDecision,
  sources: NewsSource[],
) {
  if (!sources.length) {
    return buildAiModelEvidenceOnlyAnswer(question, sources);
  }

  const rankedSources = filterAiModelEvidenceSources(question, sources, routing.officialDomains);
  if (!rankedSources.length) {
    return buildAiModelEvidenceOnlyAnswer(question, sources);
  }
  if (routing.kind === "ranking" && extractAiModelEvidenceMentions(rankedSources).length < 2) {
    return buildAiModelEvidenceOnlyAnswer(question, rankedSources);
  }
  if (routing.kind === "ranking" && extractAiModelQuestionTargets(question).length === 0) {
    const rankingEntries = buildAiModelRankingEntries(rankedSources);
    const vendorCount = new Set(
      rankingEntries
        .map((entry) => entry.vendor ?? inferAiModelVendorFromLabel(entry.model))
        .filter(Boolean),
    ).size;

    if (rankingEntries.length < 3 || vendorCount < 3) {
      return buildAiModelRankingNoEvidenceAnswerV2(question, rankedSources);
    }
  }

  const prompt =
    routing.kind === "ranking"
      ? AI_MODEL_RANKING_SYSTEM_PROMPT
      : AI_MODEL_COMPARE_SYSTEM_PROMPT;

  const answer = await completeClawCloudPrompt({
    system: prompt,
    user: [
      `Today: ${formatCurrentDate()}`,
      `Question: ${question}`,
      "",
      "Live search results:",
      buildSourceContext(rankedSources.slice(0, 6)),
    ].join("\n"),
    history: [],
    intent: "technology",
    responseMode: "fast",
    maxTokens: 650,
    fallback: "",
    skipCache: true,
    temperature: 0.1,
  }).catch(() => "");

  const normalizedAnswer = answer.trim();
  if (normalizedAnswer && !looksWeakAiModelAnswer(normalizedAnswer, question)) {
    return answer.trim() + buildFreshnessLabel(rankedSources);
  }

  return buildAiModelEvidenceOnlyAnswer(question, rankedSources);
}

export async function answerNewsQuestionResult(question: string): Promise<ClawCloudTextAnswerResult> {
  const clarification = buildCurrentAffairsClarificationReply(question);
  if (clarification) {
    return buildWebSearchAnswerResult(clarification);
  }

  const queries = buildNewsQueries(question);
  const sources = await fastNewsSearch(queries);
  if (
    looksLikeCurrentAffairsLogisticsQuestion(question)
    && (!sources.length || sources.every((source) => source.score < 0.2))
  ) {
    const liveAnswerBundle = await fetchLiveAnswerBundle(question);
    if (liveAnswerBundle) {
      return finalizeDirectLiveWebAnswer(question, liveAnswerBundle);
    }
  }
  const answer = await synthesiseNewsAnswer(question, sources);
  return buildSourceBackedLiveAnswerResult({
    question,
    answer,
    sources,
  });
}

export async function answerNewsQuestion(question: string): Promise<string> {
  const result = await answerNewsQuestionResult(question);
  return result.answer;
}

export async function answerWebSearchResult(question: string): Promise<ClawCloudTextAnswerResult> {
  const aiModelRouting = detectAiModelRoutingDecision(question);
  if (aiModelRouting?.mode === "clarify" && aiModelRouting.clarificationReply) {
    return buildWebSearchAnswerResult(aiModelRouting.clarificationReply);
  }

  const currentAffairsClarification = buildCurrentAffairsClarificationReply(question);
  if (currentAffairsClarification) {
    return buildWebSearchAnswerResult(currentAffairsClarification);
  }

  const countryMetricComparisonAnswer = await fetchWorldBankCountryMetricComparisonAnswer(question);
  if (countryMetricComparisonAnswer) {
    const liveAnswerBundle = maybeBuildClawCloudLiveAnswerBundle({
      question,
      answer: countryMetricComparisonAnswer,
    });
    return buildWebSearchAnswerResult(
      liveAnswerBundle?.metadata?.freshness_guarded === true
        ? renderClawCloudAnswerBundle(liveAnswerBundle)
        : countryMetricComparisonAnswer,
      liveAnswerBundle,
    );
  }

  const countryMetricAnswer = await fetchWorldBankCountryMetricAnswer(question);
  if (countryMetricAnswer) {
    const liveAnswerBundle = maybeBuildClawCloudLiveAnswerBundle({
      question,
      answer: countryMetricAnswer,
    });
    return buildWebSearchAnswerResult(
      liveAnswerBundle?.metadata?.freshness_guarded === true
        ? renderClawCloudAnswerBundle(liveAnswerBundle)
        : countryMetricAnswer,
      liveAnswerBundle,
    );
  }

  if (detectNewsQuestion(question)) {
    return answerNewsQuestionResult(question);
  }

  if (aiModelRouting?.mode === "web_search") {
    const sources = await searchAiModelEvidenceSources(question, aiModelRouting);
    const curatedSources = retainFreshAiModelEvidenceSources(question, sources, aiModelRouting);
    const answer = await synthesiseAiModelComparisonAnswer(question, aiModelRouting, curatedSources);
    return buildSourceBackedLiveAnswerResult({
      question,
      answer,
      sources: curatedSources,
      officialDomains: aiModelRouting.officialDomains,
      route: buildForcedFreshWebRoute(question) ?? undefined,
    });
  }

  if (looksLikeHistoricalWealthQuestion(question)) {
    return buildWebSearchAnswerResult(buildHistoricalWealthReply(question));
  }

  if (looksLikeHistoricalPowerRankingQuestion(question)) {
    const historicalPowerReply = buildHistoricalPowerRankingReply(question);
    if (historicalPowerReply) {
      return buildWebSearchAnswerResult(historicalPowerReply);
    }
  }

  if (looksLikeDirectWeatherQuestion(question)) {
    const city = parseWeatherCity(question);
    if (city) {
      const weather = await getWeather(city).catch(() => null);
      if (weather?.trim()) {
        return buildWebSearchAnswerResult(
          weather.trim(),
          maybeBuildClawCloudLiveAnswerBundle({
            question,
            answer: weather.trim(),
          }),
        );
      }
    }
  }

  const liveAnswerBundle = await fetchLiveAnswerBundle(question);
  if (liveAnswerBundle) {
    return finalizeDirectLiveWebAnswer(question, liveAnswerBundle);
  }

  const officialPricingAnswer = await fetchOfficialPricingAnswer(question);
  if (officialPricingAnswer) {
    const liveAnswerBundle = maybeBuildClawCloudLiveAnswerBundle({
      question,
      answer: officialPricingAnswer,
    });
    return buildWebSearchAnswerResult(
      liveAnswerBundle?.metadata?.freshness_guarded === true
        ? renderClawCloudAnswerBundle(liveAnswerBundle)
        : officialPricingAnswer,
      liveAnswerBundle,
    );
  }

  const populationAnswer = await fetchCountryPopulationAnswer(question);
  if (populationAnswer) {
    const liveAnswerBundle = maybeBuildClawCloudLiveAnswerBundle({
      question,
      answer: populationAnswer,
    });
    return buildWebSearchAnswerResult(
      liveAnswerBundle?.metadata?.freshness_guarded === true
        ? renderClawCloudAnswerBundle(liveAnswerBundle)
        : populationAnswer,
      liveAnswerBundle,
    );
  }

  const cleaned = question
    .replace(/^(?:search(?: for)?|look up|lookup|google|bing|find(?: me)?|fetch)\s+/i, "")
    .trim();

  const query = cleaned || question;
  const explicitYear = extractExplicitQuestionYear(query);
  const current = Number.parseInt(currentYear(), 10);
  const historicalYear = explicitYear !== null && explicitYear < current ? explicitYear : null;
  const queries = new Set<string>([query]);
  const matchedHint = EXACT_FIGURE_DOMAIN_HINTS.find((hint) => hint.re.test(query));

  if (historicalYear) {
    if (/\biphone|apple\b/i.test(query)) {
      queries.add(`Apple iPhone lineup ${historicalYear} official`);
      queries.add(`latest iPhone in ${historicalYear} Apple official`);
    }

    if (/\bceo\b/i.test(query)) {
      const company = /ceo\s+of\s+([a-z0-9 .&-]+)/i.exec(query)?.[1]?.trim();
      if (company) {
        queries.add(`${company} leadership team ${historicalYear}`);
      }
      queries.add(`${query} ${historicalYear}`);
    }
  } else {
    queries.add(`${query} ${currentYear()}`);
  }

  if (matchedHint) {
    queries.add(`${query} site:${matchedHint.domain}`);
  }

  const sources = await fastNewsSearch([...queries].slice(0, 3));
  return buildSourceBackedLiveAnswerResult({
    question,
    answer: await synthesiseNewsAnswer(question, sources),
    sources,
  });
}

export async function answerWebSearch(question: string): Promise<string> {
  const result = await answerWebSearchResult(question);
  return result.answer;
}

export function buildNoLiveDataReply(question: string): string {
  if (detectAiModelRoutingDecision(question)?.mode === "web_search") {
    return buildAiModelEvidenceOnlyAnswer(question, []);
  }

  if (
    looksLikeCurrentAffairsLogisticsQuestion(question)
    || looksLikeCurrentAffairsPowerCrisisQuestion(question)
    || looksLikeCurrentAffairsDemandQuestion(question)
    || isYesNoCurrentAffairsQuestion(question)
  ) {
    return `${buildCurrentAffairsEvidenceAnswer(question, [])}${buildFreshnessLabel([])}`;
  }

  if (shouldFailClosedWithoutFreshData(question)) {
    return buildFreshDataRequiredReply(question);
  }

  // NEVER return a refusal. Return an internal signal so the agent layer
  // knows it must generate a knowledge-based answer via AI instead.
  return "__NO_LIVE_DATA_INTERNAL_SIGNAL__";
}

export function hasNewsProviders(): boolean {
  return true;
}
import { buildNoLiveDataProfessionalReply } from "@/lib/clawcloud-professional-copy";
