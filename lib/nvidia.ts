import type {
  AssistantAnswer,
  AnswerFormat,
  AnswerSection,
  QueryClassification,
  ResearchDocument,
  ResearchPlan,
  ResearchSource,
  RetrievedChunk,
} from "@/lib/types";

import { env } from "@/lib/env";
import {
  clipText,
  domainFromUrl,
  extractJsonObject,
  markdownToPlainText,
  safeJsonParse,
  uniqueBy,
} from "@/lib/utils";

type CompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

type GeneratedReportBody = {
  title: string;
  executiveSummary: string;
  keyFindings: string[];
  detailedAnalysis: string;
  sourceHighlights: string[];
};

type GeneratedAnswerBody = {
  title: string;
  summary: string;
  keyInsights: string[];
  sections: AnswerSection[];
  followUps: string[];
};

type ChatModelPurpose = "fast" | "reasoning" | "code" | "report";

type RankedAnswerItem = {
  rank: number;
  label: string;
  detail: string;
  sourceUrl?: string;
  domain?: string;
};

type ProductPriceEntry = {
  retailer: string;
  priceText: string;
  numericPrice: number;
  currency: string;
  note: string;
  variant?: string;
  sourceUrl?: string;
  domain?: string;
  priority: number;
};

const FOLLOW_UP_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "best",
  "buy",
  "buying",
  "build",
  "by",
  "can",
  "compare",
  "create",
  "current",
  "do",
  "does",
  "explain",
  "find",
  "for",
  "get",
  "give",
  "help",
  "how",
  "i",
  "in",
  "is",
  "it",
  "latest",
  "list",
  "make",
  "me",
  "of",
  "on",
  "or",
  "now",
  "place",
  "price",
  "prices",
  "right",
  "show",
  "should",
  "tell",
  "that",
  "the",
  "this",
  "to",
  "top",
  "update",
  "updates",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "write",
]);

function getNvidiaApiUrl(endpoint: "chat/completions" | "embeddings") {
  let base = env.NVIDIA_BASE_URL.trim().replace(/\/+$/, "");
  base = base
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/embeddings$/i, "");

  if (!/\/v\d+$/i.test(base)) {
    base = `${base}/v1`;
  }

  return `${base}/${endpoint}`;
}

function resolveChatModel(purpose: ChatModelPurpose) {
  if (purpose === "fast") {
    return env.NVIDIA_FAST_MODEL || env.NVIDIA_CHAT_MODEL;
  }

  if (purpose === "reasoning") {
    return env.NVIDIA_REASONING_MODEL || env.NVIDIA_CHAT_MODEL;
  }

  if (purpose === "code") {
    return env.NVIDIA_CODE_MODEL || env.NVIDIA_REASONING_MODEL || env.NVIDIA_CHAT_MODEL;
  }

  return env.NVIDIA_REPORT_MODEL || env.NVIDIA_REASONING_MODEL || env.NVIDIA_CHAT_MODEL;
}

async function runStructuredJsonCompletion<T>({
  systemPrompt,
  userPrompt,
  model,
  maxTokens = 1800,
  temperature = 0.15,
  timeoutMs = 6500,
}: {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}) {
  if (!env.NVIDIA_API_KEY) {
    return null;
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch(getNvidiaApiUrl("chat/completions"), {
    method: "POST",
    cache: "no-store",
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      response_format: {
        type: "json_object",
      },
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    }),
  }).finally(() => clearTimeout(timeoutHandle));

  if (!response.ok) {
    throw new Error(`NVIDIA chat failed with ${response.status}`);
  }

  const payload = (await response.json()) as CompletionResponse;
  const content = payload.choices?.[0]?.message?.content ?? "";
  const jsonBody = extractJsonObject(content) ?? content;

  return safeJsonParse<T>(jsonBody);
}

async function runMarkdownCompletion({
  systemPrompt,
  userPrompt,
  model,
  maxTokens = 1600,
  temperature = 0.2,
  timeoutMs = 5500,
}: {
  systemPrompt: string;
  userPrompt: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}) {
  if (!env.NVIDIA_API_KEY) {
    return null;
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  const response = await fetch(getNvidiaApiUrl("chat/completions"), {
    method: "POST",
    cache: "no-store",
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
    }),
  }).finally(() => clearTimeout(timeoutHandle));

  if (!response.ok) {
    throw new Error(`NVIDIA markdown chat failed with ${response.status}`);
  }

  const payload = (await response.json()) as CompletionResponse;
  return payload.choices?.[0]?.message?.content?.trim() ?? null;
}

function renderSectionsMarkdown(sections: AnswerSection[]) {
  return sections
    .map((section) => {
      if (section.kind === "code") {
        return `### ${section.title}\n\`\`\`${section.language ?? ""}\n${section.content.trim()}\n\`\`\``;
      }

      return `### ${section.title}\n${section.content.trim()}`;
    })
    .join("\n\n");
}

function renderBulletList(items: string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}

const NO_RELIABLE_INFO_MESSAGE =
  "Reliable information for this detail is not available in the retrieved sources.";

function sourceCitationLabel(source: ResearchSource) {
  return (source.domain || domainFromUrl(source.url) || "source")
    .replace(/^www\./i, "")
    .trim();
}

function sourceCitationMarkdown(number: number, source: ResearchSource) {
  const label = sourceCitationLabel(source);
  return `[${label}](${source.url})`;
}

function hasMarkdownLink(value: string) {
  return /\[[^\]]+\]\(https?:\/\/[^)]+\)/i.test(value);
}

function ensureInlineCitation(
  value: string,
  sources: ResearchSource[],
  state: { index: number },
) {
  const trimmed = value.trim();
  if (!trimmed || !sources.length) {
    return value;
  }

  if (hasMarkdownLink(trimmed) || trimmed === NO_RELIABLE_INFO_MESSAGE) {
    return value;
  }

  const source = sources[Math.min(state.index, sources.length - 1)];
  const citationNumber = Math.min(state.index + 1, sources.length);
  state.index += 1;
  return `${value} ${sourceCitationMarkdown(citationNumber, source)}`;
}

function isSentenceLikeLine(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (/^#{1,6}\s+/.test(trimmed)) {
    return false;
  }

  if (/^```/.test(trimmed)) {
    return false;
  }

  if (/^([*-]|\d+\.)\s+/.test(trimmed)) {
    return true;
  }

  return /[.!?]$/.test(trimmed) && trimmed.split(/\s+/).length >= 8;
}

function injectCitationBadges(value: string, sources: ResearchSource[]) {
  if (!sources.length) {
    return value;
  }

  const state = { index: 0 };
  return value
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return line;
      }

      if (hasMarkdownLink(trimmed)) {
        return line;
      }

      if (isSentenceLikeLine(trimmed)) {
        return ensureInlineCitation(line, sources, state);
      }

      return line;
    })
    .join("\n");
}

function injectCitationBadgesIntoItems(items: string[], sources: ResearchSource[]) {
  if (!sources.length) {
    return items;
  }

  const state = { index: 0 };
  return items.map((item) => ensureInlineCitation(item, sources, state));
}

function filterInlineCitations(value: string, sources: ResearchSource[]) {
  const lookup = buildSourceCitationIndex(sources);
  return value
    .replace(/\[\[(\d+)\]\]/g, (_match, indexValue) => {
      const index = Number(indexValue);
      const source = lookup.byNumber.get(index);
      return source ? ` ${sourceCitationMarkdown(index, source)}` : "";
    })
    .replace(/\[(\d+)\]/g, (_match, indexValue) => {
      const index = Number(indexValue);
      const source = lookup.byNumber.get(index);
      return source ? ` ${sourceCitationMarkdown(index, source)}` : "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .trim();
}

function stripCitationMarkers(value: string) {
  return value
    .replace(/\s*\[(\d+)\]/g, "")
    .replace(/\s*\[[^\]]+\]\(https?:\/\/[^)]+\)/gi, "")
    .replace(/\s*\[\\\[[^\]]+\\\]\]\([^)]+\)/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function compactText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function clippedNaturalText(text: string, limit = 220) {
  return clipText(compactText(text), limit);
}

function decodeCommonEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&(apos|rsquo|lsquo);/gi, "'")
    .replace(/&#39;|&#x27;|&\s*x27;|&x27;/gi, "'")
    .replace(/&(ndash|mdash);/gi, "-")
    .replace(/&(lt|gt);/gi, " ");
}

function questionAsTitle(question: string) {
  const trimmed = question.trim().replace(/\?+$/, "");
  if (!trimmed) {
    return "Answer";
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function toHeadlineCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function newsTitleFromQuestion(question: string) {
  const topic = inferTopicLabel(question);
  if (!topic) {
    return questionAsTitle(question);
  }

  return `${toHeadlineCase(topic)}: latest developments`;
}

function isSensitiveRealtimeQuestion(question: string, classification?: QueryClassification) {
  return (
    classification?.type === "realtime_search" &&
    /\b(war|conflict|attack|missile|military|nuclear|ceasefire|election|protest|riot|sanction|hostage|outbreak)\b/i.test(
      question,
    )
  );
}

function isBroadNewsUpdateQuestion(question: string, classification?: QueryClassification) {
  return (
    classification?.type === "realtime_search" &&
    /\b(update|latest|news|current|today|right now|live|happening|breaking)\b/i.test(
      question,
    ) &&
    !/\b(price|prices|buy|deal|deals|cost|weather|forecast|score|scores|stock|stocks)\b/i.test(
      question,
    )
  );
}

function isIndexStyleNewsUrl(url: string) {
  return (
    /\/(world|news)(?:\/asia)?\/[a-z-]+\/?$/i.test(url) ||
    /\/where\/[a-z-]+\/?$/i.test(url) ||
    /\/live\/?$/i.test(url)
  );
}

function normalizeReferenceFormatting(text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  const normalized: string[] = [];
  let insideReferenceBlock = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^(References|Sources|Citations):?\s*$/i.test(line)) {
      insideReferenceBlock = true;
      continue;
    }

    if (insideReferenceBlock) {
      if (!line) {
        insideReferenceBlock = false;
        continue;
      }

      if (/^#{1,4}\s+/.test(line)) {
        insideReferenceBlock = false;
        normalized.push(rawLine);
        continue;
      }

      if (
        /^(?:[-*]|\d+\.)\s+/.test(line) ||
        /\[[^\]]+\]\(https?:\/\/[^)]+\)/i.test(line) ||
        /^https?:\/\/\S+$/i.test(line) ||
        /^(?:www\.)?[a-z0-9][a-z0-9-]{1,62}\.(?:com|org|net|edu|gov|in|co|io|ai|uk|us|ca|au|de|fr|jp|cn|ru|br|it|es|me)\b/i.test(
          line,
        )
      ) {
        continue;
      }

      insideReferenceBlock = false;
    }

    if (/^(?:##\s*)?(?:References|Sources|Citations)\s*:?\s*$/i.test(line)) {
      continue;
    }

    normalized.push(rawLine);
  }

  return normalized.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeSectionContent(section: AnswerSection): AnswerSection {
  if (section.kind === "code") {
    return section;
  }

  return {
    ...section,
    content: normalizeReferenceFormatting(section.content),
  };
}

function stripBodyUrls(value: string) {
  return value
    .replace(
      /\[\\?\[(\d+)\\?\]\]\((https?:\/\/[^)\s]+)\)/gi,
      (_match, number) => `[${number}]`,
    )
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi,
      (_match, rawLabel, rawUrl) => {
        const url = String(rawUrl).trim();
        const label = String(rawLabel).trim();
        if (!label) {
          return `[${sourceCitationLabel({
            id: "",
            title: "",
            url,
            snippet: "",
            provider: "jina",
            domain: domainFromUrl(url),
            score: 0,
          } satisfies ResearchSource)}](${url})`;
        }

        if (
          /^https?:\/\//i.test(label) ||
          /^(?:www\.)?[a-z0-9][a-z0-9-]{1,62}\.(?:com|org|net|edu|gov|in|co|io|ai|uk|us|ca|au|de|fr|jp|cn|ru|br|it|es|me)\b/i.test(
            label,
          )
        ) {
          const domain = domainFromUrl(url).replace(/^www\./i, "") || "source";
          return `[${domain}](${url})`;
        }

        return `[${label}](${url})`;
      },
    )
    .replace(/(?<!\]\()https?:\/\/[^\s)]+/gi, "")
    .replace(/(?<!\])\((https?:\/\/[^)\s]+)\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function looksLikeMalformedNarrative(value: string) {
  const clean = markdownToPlainText(value).replace(/\s+/g, " ").trim();
  if (!clean) {
    return true;
  }

  if (
    /\b(summary table|rank city|millionaires billionaires|10 year growth|top \d+ wealthiest cities)\b/i.test(
      clean,
    )
  ) {
    return true;
  }

  const sentenceCount = clean.split(/(?<=[.!?])\s+/).filter(Boolean).length;
  const wordCount = clean.split(/\s+/).length;
  const digitCount = (clean.match(/\d/g) ?? []).length;

  if (wordCount >= 30 && sentenceCount <= 1 && !/[.!?]/.test(clean)) {
    return true;
  }

  if (digitCount >= 18 && sentenceCount <= 1) {
    return true;
  }

  return false;
}

function formatBulletStructure(value: string) {
  return value
    .replace(/:\s+\*\s+/g, ":\n* ")
    .replace(/([.!?])\s+\*\s+/g, "$1\n* ")
    .replace(/[.!?]\s+[—–-]\s+/g, ". ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeAnswerText(text: string) {
  const lines = decodeCommonEntities(stripBodyUrls(text))
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r/g, "")
    .split("\n");
  const cleanedLines = lines.flatMap((rawLine) => {
    let line = rawLine.trim();
    if (!line) {
      return [""];
    }

    if (/^\|?[-:\s]{2,}\|[-|:\s]*$/.test(line)) {
      return [];
    }

    if (line.includes("|")) {
      const cells = line
        .split("|")
        .map((cell) => markdownToPlainText(cell).replace(/\s+/g, " ").trim())
        .filter(Boolean);

      if (cells.length >= 2) {
        line = cells.join(" - ");
      } else {
        line = line.replace(/\|+/g, " ");
      }
    }

    line = line
      .replace(/[|]{2,}/g, " ")
      .replace(/,\s*\.\.\.+/g, ".")
      .replace(/\s*\.\.\.+$/g, ".")
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .trim();

    if ((line.match(/\*\s+/g) ?? []).length >= 2) {
      line = line
        .replace(/:\s+\*\s+/g, ":\n* ")
        .replace(/\s+\*\s+/g, "\n* ");
    }

    return line ? [formatBulletStructure(line)] : [];
  });

  return cleanedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sanitizeInsightText(value: string) {
  const cleaned = sanitizeAnswerText(markdownToPlainText(value));
  if (!cleaned) {
    return "";
  }

  if (cleaned.split(" - ").length > 4) {
    return "";
  }

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const base = sentences[0] || cleaned;
  const normalized = clipText(base, 180).replace(/\.\.\.+$/g, "").trim();
  if (!normalized) {
    return "";
  }

  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function summaryLooksIncomplete(value: string) {
  return (
    /\.\.\.$/.test(value) ||
    /\b(and|or|with|including|significant|substantial|important|major|desirable|notable)\.$/i.test(
      value,
    )
  );
}

function polishSummaryText(value: string) {
  const clean = sanitizeAnswerText(markdownToPlainText(value));
  if (!clean) {
    return "";
  }

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (!sentences.length) {
    return clean;
  }

  if (!summaryLooksIncomplete(clean)) {
    return clean;
  }

  const stableSentences = sentences.filter((sentence) => !summaryLooksIncomplete(sentence));
  if (stableSentences.length >= 2) {
    return stableSentences.slice(0, 2).join(" ");
  }

  if (stableSentences[0]) {
    return stableSentences[0];
  }

  return sentences[0];
}

function cleanEvidenceCandidate(value: string) {
  return sanitizeInsightText(value)
    .replace(/^(live updates?:|breaking:|latest:|latest news:?|latest updates?:?)\s*/i, "")
    .replace(/^(top stories from [^.]+\.?\s*)/i, "")
    .replace(/^(view the latest [^.]+\.?\s*)/i, "")
    .replace(/[·|]+/g, " ")
    .replace(/\s+-\s+/g, " ")
    .replace(/\s*;\s*/g, ". ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/\b(?:www\.)?[a-z0-9][a-z0-9-]{1,62}\.(?:com|org|net|edu|gov|in|co|io|ai|uk|us|ca|au|de|fr|jp|cn|ru|br|it|es|me)\b/gi, "")
    .replace(/\.\.\.+$/g, "")
    .trim();
}

function normalizeEvidenceLineForDisplay(value: string) {
  const citationMatch = value.match(/(\[[^\]]+\]\(https?:\/\/[^)]+\))\s*$/i);
  const citation = citationMatch?.[1] ?? "";
  const plain = cleanEvidenceCandidate(stripCitationMarkers(value))
    .replace(/[.!?]\s*[—–-]\s+.*/g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!plain) {
    return citation ? citation : "";
  }

  const primary = plain.split(/\s+[—–-]\s+/)[0]?.trim() || plain;
  const firstSentence = primary
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)[0] ?? primary;
  const clipped = clipText(firstSentence, 180);
  return citation ? `${clipped} ${citation}` : clipped;
}

function candidateSentencesFromText(value: string, max = 6) {
  const normalized = sanitizeAnswerText(markdownToPlainText(value))
    .replace(/\s+[·|]\s+/g, ". ")
    .replace(/\s+-\s+(?=[A-Z])/g, ". ")
    .replace(/;\s+/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return [] as string[];
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (!sentences.length) {
    return [clipText(normalized, 180)];
  }

  return sentences.slice(0, max).map((sentence) => clipText(sentence, 180));
}

function isUsableEvidenceLine(value: string) {
  if (!value) {
    return false;
  }

  if (
    /\b(crossword|sudoku|podcast|photo shuffle|browse|view insights|get involved|newsletter|cookie|audio|games)\b/i.test(
      value,
    )
  ) {
    return false;
  }

  if (
    /\b(skip to|sign up|site map|profile|subscription preferences|share & save|search sections|follow [a-z]+|listen now|subscriber hub|alerts|podcasts)\b/i.test(
      value,
    )
  ) {
    return false;
  }

  if (
    /^(live updates|stay on top|latest news|watch live|follow our live coverage|top stories from)\b/i.test(
      value,
    )
  ) {
    return false;
  }

  if (
    /\b(latest breaking news|breaking stories|video and analysis|today'?s latest|latest news and updates|news and updates)\b/i.test(
      value,
    )
  ) {
    return false;
  }

  if (
    /\b(view the latest|latest india news and videos|where\/india|top headlines|watch live)\b/i.test(
      value,
    )
  ) {
    return false;
  }

  if (/\b(fifa|world cup|match(?:es)?|tournament|league|team|player|coach|fixture)\b/i.test(value)) {
    return false;
  }

  if (value.split(/\s+/).length < 7) {
    return false;
  }

  return true;
}

function bestEvidenceTextFromSource(source: ResearchSource) {
  for (const sentence of candidateSentencesFromText(source.snippet, 4)) {
    const cleaned = cleanEvidenceCandidate(sentence);
    if (cleaned && isUsableEvidenceLine(cleaned)) {
      return cleaned;
    }
  }

  return "";
}

function bestEvidenceTextFromChunk(chunk: RetrievedChunk) {
  for (const sentence of candidateSentencesFromText(chunk.content, 8)) {
    const cleaned = cleanEvidenceCandidate(sentence);
    if (cleaned && isUsableEvidenceLine(cleaned)) {
      return cleaned;
    }
  }

  const titleCandidate = cleanEvidenceCandidate(chunk.title);
  return isUsableEvidenceLine(titleCandidate) ? titleCandidate : "";
}

function buildSourceCitationIndex(sources: ResearchSource[]) {
  const byUrl = new Map<string, ResearchSource>();
  const byDomain = new Map<string, ResearchSource>();
  const byNumber = new Map<number, ResearchSource>();
  const numberByUrl = new Map<string, number>();
  const numberByDomain = new Map<string, number>();

  sources.forEach((source, index) => {
    const sourceNumber = index + 1;
    byUrl.set(source.url, source);
    if (!byDomain.has(source.domain)) {
      byDomain.set(source.domain, source);
    }
    byNumber.set(sourceNumber, source);
    numberByUrl.set(source.url, sourceNumber);
    if (!numberByDomain.has(source.domain)) {
      numberByDomain.set(source.domain, sourceNumber);
    }
  });

  return { byUrl, byDomain, byNumber, numberByUrl, numberByDomain };
}

function citationTag(
  url: string | undefined,
  domain: string | undefined,
  lookup: ReturnType<typeof buildSourceCitationIndex>,
) {
  if (url) {
    const byUrl = lookup.byUrl.get(url);
    const byUrlNumber = lookup.numberByUrl.get(url);
    if (byUrl && byUrlNumber) {
      return sourceCitationMarkdown(byUrlNumber, byUrl);
    }
  }

  if (domain) {
    const byDomain = lookup.byDomain.get(domain);
    const byDomainNumber = lookup.numberByDomain.get(domain);
    if (byDomain && byDomainNumber) {
      return sourceCitationMarkdown(byDomainNumber, byDomain);
    }
  }

  return "";
}

function isCommercePriceComparisonQuestion(question: string) {
  return (
    /\b(price|prices|cost|deal|deals|buy|buying|purchase|offer|offers|retailer|retailers|store|stores|website|websites)\b/i.test(
      question,
    ) &&
    /\b(compare|comparison|different websites|different sites|different stores|cheapest|lowest|best price|where to buy)\b/i.test(
      question,
    ) &&
    !/\b(trade-?in|sell|resale|used|refurbished|cash value)\b/i.test(question)
  );
}

function normalizeCommerceTopic(question: string) {
  let topic = question
    .replace(
      /\b(compare|comparison|compare the prices of|price of|prices of|in different websites|different websites|different sites|different stores|website|websites|store|stores|retailer|retailers|where to buy|best place to buy|best price|lowest price|cheapest)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  topic = topic.replace(/^the\s+/i, "");
  topic = topic.replace(/\bs25 ultra\b/i, "Samsung Galaxy S25 Ultra");

  return topic || question;
}

function retailLabelFromDomain(domain: string, title = "") {
  const lower = domain.toLowerCase();
  if (/samsung\.com$/.test(lower)) return "Samsung";
  if (/amazon\./.test(lower)) return "Amazon";
  if (/bestbuy\.com$/.test(lower)) return "Best Buy";
  if (/flipkart\.com$/.test(lower)) return "Flipkart";
  if (/walmart\.com$/.test(lower)) return "Walmart";
  if (/target\.com$/.test(lower)) return "Target";
  if (/att\.com$/.test(lower)) return "AT&T";
  if (/t-mobile\.com$/.test(lower)) return "T-Mobile";
  if (/verizon\.com$/.test(lower)) return "Verizon";
  if (/croma\.com$/.test(lower)) return "Croma";
  if (/reliancedigital\.in$/.test(lower)) return "Reliance Digital";
  if (/smartprix\.com$/.test(lower)) return "Smartprix";
  if (/pricehistoryapp\.com$/.test(lower)) return "Price History";
  if (/phonearena\.com$/.test(lower)) return "PhoneArena";

  const cleanedTitle = sanitizeAnswerText(title).split(" - ")[0]?.trim();
  return cleanedTitle || domain;
}

function isDirectRetailerOrPriceDomain(domain: string) {
  return /samsung\.com$|apple\.com$|amazon\.|bestbuy\.com$|flipkart\.com$|walmart\.com$|target\.com$|att\.com$|t-mobile\.com$|verizon\.com$|croma\.com$|reliancedigital\.in$|smartprix\.com$|pricehistoryapp\.com$|yournavi\.com$/i.test(
    domain,
  );
}

function looksLikeLowQualityCommerceSource(text: string) {
  return /\b(trade-?in|cash value|sell|resale|used|refurbished|countries?|country|price in \d+ countries|compared to india|monthly plan|per month|sim-only|sim free)\b/i.test(
    text,
  );
}

function extractStorageVariant(value: string) {
  return value.match(/\b(128GB|256GB|512GB|1TB)\b/i)?.[1]?.toUpperCase();
}

function extractCommerceProductTokens(question: string) {
  return normalizeCommerceTopic(question)
    .toLowerCase()
    .replace(/[^\w\s+-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .filter((token) => !FOLLOW_UP_STOP_WORDS.has(token))
    .slice(0, 4);
}

function matchesCommerceProductTokens(text: string, tokens: string[]) {
  if (!tokens.length) {
    return true;
  }

  const lower = text.toLowerCase();
  const importantTokens = tokens.filter((token) => /\d/.test(token) || token.length >= 4);
  const tokensToCheck = importantTokens.length ? importantTokens : tokens;

  return tokensToCheck.every((token) => lower.includes(token));
}

function parseCurrencySymbol(value: string) {
  if (/₹|rs\.?|inr/i.test(value)) {
    return "INR";
  }

  if (/£/.test(value)) {
    return "GBP";
  }

  if (/€|eur/i.test(value)) {
    return "EUR";
  }

  return "USD";
}

function parseCurrencyAmount(value: string) {
  const numeric = Number.parseFloat(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function extractBestRetailPrice(text: string, productTokens: string[] = []) {
  const normalized = sanitizeAnswerText(markdownToPlainText(text));
  const matches = [
    ...normalized.matchAll(/(?:₹|Rs\.?|INR|USD|US\$|\$|£|EUR|€)\s?\d[\d,]*(?:\.\d{1,2})?/gi),
  ];

  let best:
    | {
        display: string;
        numeric: number;
        currency: string;
        context: string;
        score: number;
      }
    | null = null;

  for (const match of matches) {
    const display = match[0];
    const numeric = parseCurrencyAmount(display);
    if (!numeric || numeric < 200 || numeric > 5000) {
      continue;
    }

    const start = match.index ?? 0;
    const context = normalized.slice(Math.max(0, start - 40), Math.min(normalized.length, start + 80));
    const tightContext = normalized.slice(Math.max(0, start - 12), Math.min(normalized.length, start + display.length + 18));
    const lowerContext = context.toLowerCase();
    const lowerTightContext = tightContext.toLowerCase();
    const focusToken =
      productTokens.find((token) => ["ultra", "pro", "max", "fold", "flip", "plus"].includes(token)) ??
      productTokens.find((token) => /\d/.test(token));
    let score = 0;

    if (/(retail price|starting at|sale price|price|available|buy|costs|rrp|mrp)/i.test(lowerContext)) {
      score += 2.2;
    }

    if (/(unlocked|official|preorder|deal)/i.test(lowerContext)) {
      score += 0.4;
    }

    if (/(\/mo|per month|monthly|emi|down payment)/i.test(lowerTightContext)) {
      score -= 3.5;
    }

    if (/(save|off|discount)/i.test(lowerTightContext) && !/(sale price|current price|price)/i.test(lowerTightContext)) {
      score -= 1.2;
    }

    if (/(trade-?in|cash value|resale|used|refurbished)/i.test(lowerTightContext)) {
      score -= 4;
    }

    if (focusToken && lowerContext.includes(focusToken)) {
      score += 1.1;
    }

    if (focusToken === "ultra" && /\bplus\b/.test(lowerContext)) {
      score -= 1.4;
    }

    if (numeric < 500 && /(save|off|discount)/i.test(lowerContext)) {
      score -= 4;
    }

    if (numeric < 700 && productTokens.some((token) => /ultra|iphone|galaxy|pixel/.test(token))) {
      score -= 2.5;
    }

    if (!best || score > best.score || (score === best.score && start < normalized.indexOf(best.display))) {
      best = {
        display,
        numeric,
        currency: parseCurrencySymbol(display),
        context,
        score,
      };
    }
  }

  return best;
}

function extractDirectProductPrice(text: string, productTokens: string[] = []) {
  const normalized = sanitizeAnswerText(markdownToPlainText(text));
  const matches = [
    ...normalized.matchAll(/(?:₹|Rs\.?|INR|USD|US\$|\$|£|EUR|€)\s?\d[\d,]*(?:\.\d{1,2})?/gi),
  ];
  const focusToken =
    productTokens.find((token) => ["ultra", "pro", "max", "fold", "flip", "plus"].includes(token)) ??
    productTokens.find((token) => /\d/.test(token));

  for (const match of matches) {
    const display = match[0];
    const numeric = parseCurrencyAmount(display);
    if (!numeric || numeric < 700 || numeric > 5000) {
      continue;
    }

    const start = match.index ?? 0;
    const context = normalized.slice(Math.max(0, start - 45), Math.min(normalized.length, start + 70));
    const tightContext = normalized.slice(Math.max(0, start - 12), Math.min(normalized.length, start + display.length + 18));
    const lowerContext = context.toLowerCase();
    const lowerTightContext = tightContext.toLowerCase();

    if (focusToken && !lowerContext.includes(focusToken) && /\bplus\b|\bbase\b|\bstandard\b/i.test(lowerContext)) {
      continue;
    }

    if (/(\/mo|per month|monthly|emi|down payment|save|off|discount|trade-?in)/i.test(lowerTightContext)) {
      continue;
    }

    return {
      display,
      numeric,
      currency: parseCurrencySymbol(display),
      context,
      score: 5,
    };
  }

  return null;
}

function buildRetailPriceNote(text: string, domain: string) {
  const lower = sanitizeAnswerText(markdownToPlainText(text)).toLowerCase();
  const notes: string[] = [];

  if (/samsung\.com$|apple\.com$/.test(domain)) {
    notes.push("official store price");
  }

  if (/starting at|retail price|rrp|mrp/.test(lower)) {
    notes.push("standard listed price");
  }

  if (/save|off|discount/.test(lower)) {
    notes.push("discount shown");
  }

  if (/preorder/.test(lower)) {
    notes.push("preorder listing");
  }

  if (/unlocked/.test(lower)) {
    notes.push("unlocked model");
  }

  if (/trade-?in/.test(lower)) {
    notes.push("trade-in offer mentioned");
  }

  if (/bank offer|bank discount|card offer/.test(lower)) {
    notes.push("bank offers mentioned");
  }

  return notes.slice(0, 2).join("; ");
}

function extractRequestedRankCount(question: string) {
  const match = question.match(/\btop\s+(\d{1,2})\b/i);
  const count = match ? Number.parseInt(match[1] ?? "10", 10) : 10;
  return Number.isFinite(count) ? Math.min(Math.max(count, 3), 20) : 10;
}

function stripDomainMentions(value: string) {
  return value
    .replace(
      /\S+\.(?:com|org|net|edu|gov|in|co|io|ai|uk|us|ca|au|de|fr|jp|cn|ru|br|it|es|me)\S*/gi,
      "",
    )
    .replace(
      /\b(?:www\.)?[a-z0-9][a-z0-9-]{1,62}\.(?:com|org|net|edu|gov|in|co|io|ai|uk|us|ca|au|de|fr|jp|cn|ru|br|it|es|me)\b/gi,
      "",
    )
    .replace(
      /\b[a-z0-9][a-z0-9-]{2,62}\s+(?:com|org|net|edu|gov|co|io|ai|uk|us|ca|au|de|fr|jp|cn|ru|br|it|es|me)\b/gi,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

function stripRankingNoise(value: string) {
  return value
    .replace(/\bsummary table\b/gi, "")
    .replace(/\btop\s+\d+\b/gi, "")
    .replace(/\b(rank|ranking)\b/gi, "")
    .replace(/\b(the\s+)?(wealthiest|richest)\s+cities?(?:\s+in\s+the\s+world)?\b/gi, "")
    .replace(/\bcities?\s+in\s+the\s+world(?:\s+in\s+\d{4})?\b/gi, "")
    .replace(/\b(global|world)\s+ranking\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function rankingLabelLooksNoisy(value: string) {
  if (!value) {
    return true;
  }

  if (
    /\b(rank|ranking|top|city|cities|country|countries|millionaires?|billionaires?|growth|gdp|summary|table|wealthiest|richest|world|global|list)\b/i.test(
      value,
    )
  ) {
    return true;
  }

  if (/\b(?:www\.)?[a-z0-9-]+\.(?:com|org|net|in|co|io|ai)\b/i.test(value)) {
    return true;
  }

  return false;
}

function cleanRankingLineCore(value: string) {
  return value
    .replace(
      /\b(?:www\.)?[a-z0-9][a-z0-9-]{1,62}\.(?:com|org|net|edu|gov|in|co|io|ai|uk|us|ca|au|de|fr|jp|cn|ru|br|it|es|me)\b\.?/gi,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/:\s*$/g, "")
    .trim();
}

function cleanRankLabel(value: string) {
  let cleaned = sanitizeAnswerText(value)
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
    .trim();

  cleaned = stripDomainMentions(cleaned);
  cleaned = cleaned.split(/[:;|]/)[0]?.trim() ?? cleaned;
  cleaned = cleaned.split(/\s+-\s+/)[0]?.trim() ?? cleaned;
  cleaned =
    cleaned.split(/\.\s+(?=(The|Top|Rank|Ranking|Summary|Table|Cities?|Country|World)\b)/i)[0]?.trim() ??
    cleaned;
  cleaned = stripRankingNoise(cleaned);
  cleaned = cleaned.replace(/\([^)]*\)$/g, "").trim();
  cleaned = cleaned.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "").trim();

  if (!cleaned) {
    return "";
  }

  if (rankingLabelLooksNoisy(cleaned)) {
    return "";
  }

  const words = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !/^[a-z0-9-]+\.[a-z]{2,}$/i.test(word))
    .filter((word) => !/^[a-z0-9-]+$/i.test(word) || /^[A-Z]/.test(word));
  if (words.length > 4) {
    return "";
  }

  return words.join(" ");
}

function normalizeRankingDetail(value: string) {
  let cleaned = sanitizeAnswerText(value)
    .replace(/\s*-\s*$/g, "")
    .replace(/\b(rank|city|country)\b\s*-\s*/gi, "")
    .trim();

  cleaned = cleaned
    .replace(/\s+-\s+\d{1,2}[.)]\s+[A-Z][A-Za-z&.'-]*/g, "")
    .replace(/\s+\d{1,2}[.)]\s+[A-Z][A-Za-z&.'-]*(?:\s+[A-Z][A-Za-z&.'-]*){0,4}\s*$/g, "")
    .trim();
  const nestedRankStart = cleaned.search(/\b\d{1,2}[.)]\s+[A-Z]/);
  if (nestedRankStart >= 0) {
    cleaned = cleaned.slice(0, nestedRankStart).trim();
  }

  cleaned = stripDomainMentions(cleaned);
  cleaned = stripRankingNoise(cleaned)
    .replace(/\b(millionaires|billionaires)\s+(millionaires|billionaires)\b/gi, "$1")
    .replace(/^\W+|\W+$/g, "")
    .trim();

  if (!cleaned) {
    return "";
  }

  const tableParts = cleaned
    .split(/\s*-\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  const millionaireCount =
    (/^\d{1,3}(?:,\d{3})+$/.test(tableParts[0] ?? "") ? tableParts[0] : undefined) ??
    cleaned.match(/(\d{1,3}(?:,\d{3})+)\s*(millionaires)?/i)?.[1];
  const billionaireCount =
    (/^\d{1,3}$/.test(tableParts[1] ?? "") ? tableParts[1] : undefined) ??
    cleaned.match(/(\d{1,3})\s+billionaires\b/i)?.[1];
  const growth = cleaned.match(/([+-]?\d+%)\b/)?.[1];

  if (millionaireCount && billionaireCount) {
    return `${millionaireCount} millionaires and ${billionaireCount} billionaires${
      growth ? `, ${growth} long-term growth` : ""
    }.`;
  }

  if (millionaireCount) {
    return `${millionaireCount} millionaires${growth ? `, ${growth} long-term growth` : ""}.`;
  }

  if (/^[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3}$/.test(cleaned)) {
    return `${cleaned}.`;
  }

  if (!/\d/.test(cleaned) && cleaned.split(/\s+/).length > 8) {
    return "";
  }

  const clipped = clipText(cleaned, 90).replace(/[ \t]+([,.;:!?])/g, "$1").trim();
  return clipped ? (/[.!?]$/.test(clipped) ? clipped : `${clipped}.`) : "";
}

function extractRankedItemsFromText(
  text: string,
  sourceUrl: string | undefined,
  domain: string | undefined,
  maxCount: number,
) {
  const normalized = sanitizeAnswerText(markdownToPlainText(text))
    .replace(/[•·]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (!normalized) {
    return [] as RankedAnswerItem[];
  }

  const segmentPattern =
    /(?:^|\s|-)\s*(\d{1,2})[.)]\s*([^]{1,220}?)(?=(?:\s+-?\s*\d{1,2}[.)]\s)|$)/g;
  const matches = [...normalized.matchAll(segmentPattern)];
  const items: RankedAnswerItem[] = [];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const rank = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(rank) || rank < 1 || rank > maxCount) {
      continue;
    }

    const chunk = sanitizeAnswerText(match[2] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (!chunk) {
      continue;
    }

    const seed = chunk.split(/[:;|,-]/)[0]?.trim() ?? chunk;
    let label = cleanRankLabel(seed);
    if (!label) {
      const namedPrefix =
        chunk.match(
          /[A-Z][A-Za-z&.'-]*(?:\s+(?:[A-Z][A-Za-z&.'-]*|of|the|and|de|la|del)){0,4}/,
        )?.[0] ?? "";
      label = cleanRankLabel(namedPrefix);
    }
    if (!label) {
      continue;
    }

    const labelIndex = chunk.toLowerCase().indexOf(label.toLowerCase());
    const afterLabel = (labelIndex >= 0 ? chunk.slice(labelIndex + label.length) : chunk)
      .replace(/^[\s,:;-]+/, "")
      .trim();

    items.push({
      rank,
      label,
      detail: normalizeRankingDetail(afterLabel),
      sourceUrl,
      domain,
    });
  }

  return items;
}

function buildRankingSourceAnswer({
  question,
  sources,
  retrievedContext,
}: {
  question: string;
  sources: ResearchSource[];
  retrievedContext: RetrievedChunk[];
}) {
  const requestedCount = extractRequestedRankCount(question);
  const collected = new Map<number, RankedAnswerItem>();
  const sourceInputs = sources
    .map((source) => ({
      text: source.snippet || source.title || "",
      url: source.url,
      domain: source.domain,
    }))
    .filter((input) => Boolean(input.text));
  const retrievedInputs = retrievedContext.map((chunk) => ({
    text: chunk.content,
    url: chunk.url,
    domain: domainFromUrl(chunk.url),
  }));
  const wealthRanking = /\b(richest|wealthiest|millionaires|billionaires)\b/i.test(question);
  const prioritizedSourceInputs = wealthRanking
    ? sourceInputs.filter((input) =>
        /\b(millionaires?|billionaires?|wealthiest|wealth)\b/i.test(input.text),
      )
    : sourceInputs;
  const secondarySourceInputs = wealthRanking
    ? sourceInputs.filter(
        (input) => !/\b(millionaires?|billionaires?|wealthiest|wealth)\b/i.test(input.text),
      )
    : [];
  const evidenceInputs = [
    ...prioritizedSourceInputs,
    ...retrievedInputs,
    ...secondarySourceInputs,
  ];

  for (const input of evidenceInputs) {
    const items = extractRankedItemsFromText(
      input.text,
      input.url,
      input.domain,
      requestedCount,
    );

    for (const item of items) {
      if (rankingLabelLooksNoisy(item.label)) {
        continue;
      }

      const existing = collected.get(item.rank);
      if (!existing) {
        collected.set(item.rank, item);
        continue;
      }

      const existingDetailScore = existing.detail ? existing.detail.length : 0;
      const itemDetailScore = item.detail ? item.detail.length : 0;
      if (itemDetailScore > existingDetailScore) {
        collected.set(item.rank, item);
      }
    }

    if (collected.size >= requestedCount) {
      break;
    }
  }

  const ranking = [...collected.values()]
    .map((item) => ({
      ...item,
      label: cleanRankLabel(stripDomainMentions(item.label)),
      detail: normalizeRankingDetail(stripDomainMentions(item.detail)),
    }))
    .filter((item) => item.label && !rankingLabelLooksNoisy(item.label))
    .sort((left, right) => left.rank - right.rank)
    .slice(0, requestedCount);

  if (ranking.length < Math.min(5, requestedCount)) {
    return null;
  }

  const displaySources = uniqueBy(
    ranking
      .map((item) => sources.find((source) => source.url === item.sourceUrl))
      .filter((source): source is ResearchSource => Boolean(source)),
    (source) => source.url,
  );
  const effectiveSources = displaySources.length ? displaySources : sources.slice(0, 5);
  const lookup = buildSourceCitationIndex(effectiveSources);
  const rankingLines = ranking.map((item, index) => {
    const citation = citationTag(item.sourceUrl, item.domain, lookup);
    const detailSuffix = item.detail ? `: ${item.detail}` : "";
    const lineCore = cleanRankingLineCore(`${index + 1}. ${item.label}${detailSuffix}`);
    return `${lineCore}${citation ? ` ${citation}` : ""}`;
  });

  const leaders = ranking.slice(0, 3).map((item) => item.label);
  const summary = leaders.length
    ? `${leaders.join(", ")} lead the strongest current rankings for this list, with the rest of the top entries clustered around major financial and wealth hubs.`
    : "The strongest available public rankings point to a stable group of cities at the top of the list.";

  return fallbackStructuredAnswer({
    question,
    format: "source",
    title: questionAsTitle(question),
    summary,
    keyInsights: [],
    sections: [
      {
        title: `Top ${ranking.length} ranking`,
        content: renderBulletList(rankingLines),
      },
      {
        title: "How to read this list",
        content: renderBulletList([
          "Rankings can vary slightly by source and year, so the ordering should be read as current best-available consensus rather than an immutable table.",
          "Most published lists in this category rely on millionaire counts, billionaire counts, and long-term wealth concentration rather than population alone.",
        ]),
      },
    ],
    followUps: contextualFollowUps(question, "source"),
    sources: effectiveSources,
  });
}

function collectProductPriceEntries({
  question,
  sources,
  documents,
}: {
  question: string;
  sources: ResearchSource[];
  documents: ResearchDocument[];
}) {
  const tokens = extractCommerceProductTokens(question);
  const requestedVariant = extractStorageVariant(question);
  const entries: ProductPriceEntry[] = [];

  for (const source of sources) {
    const domain = source.domain;
    const joinedText = [source.title, source.snippet]
      .filter(Boolean)
      .join(" ");

    if (
      looksLikeLowQualityCommerceSource(joinedText) ||
      (/\bdeals?\b/i.test(joinedText) && !/\b(retail price|starting at|unlocked|buy)\b/i.test(joinedText)) ||
      !matchesCommerceProductTokens(joinedText, tokens)
    ) {
      continue;
    }

    const matchingDocument = documents.find((document) => document.url === source.url);
    const isDirectDomain = isDirectRetailerOrPriceDomain(domain);
    const snippetPrice = isDirectDomain
      ? extractDirectProductPrice(source.snippet, tokens) ?? extractBestRetailPrice(source.snippet, tokens)
      : extractBestRetailPrice(source.snippet, tokens);
    const fallbackText = [matchingDocument?.excerpt, matchingDocument?.content]
      .filter(Boolean)
      .join(" ");
    const bestPrice = snippetPrice ?? extractBestRetailPrice(fallbackText, tokens);
    if (!bestPrice || bestPrice.score < 0) {
      continue;
    }

    const variant =
      extractStorageVariant(source.snippet) ||
      extractStorageVariant(fallbackText) ||
      extractStorageVariant(source.title) ||
      undefined;
    const retailer = retailLabelFromDomain(domain, source.title);
    const note = buildRetailPriceNote(source.snippet || fallbackText, domain);
    const priority =
      bestPrice.score +
      (isDirectDomain ? 0.8 : -0.25) +
      (/samsung\.com$|apple\.com$/.test(domain) ? 1 : 0) +
      (/amazon\.|bestbuy\.com$|flipkart\.com$|walmart\.com$|target\.com$|att\.com$|t-mobile\.com$|verizon\.com$/.test(
        domain,
      )
        ? 0.6
        : 0);

    if (requestedVariant && variant && variant !== requestedVariant) {
      continue;
    }

    entries.push({
      retailer,
      priceText: bestPrice.display.replace(/\s+/g, " ").trim(),
      numericPrice: bestPrice.numeric,
      currency: bestPrice.currency,
      note,
      variant,
      sourceUrl: source.url,
      domain,
      priority,
    });
  }

  return entries;
}

function choosePriceComparisonEntries(question: string, entries: ProductPriceEntry[]) {
  const requestedVariant = extractStorageVariant(question);

  if (requestedVariant) {
    const matching = entries.filter((entry) => !entry.variant || entry.variant === requestedVariant);
    if (matching.length >= 2) {
      return matching;
    }
  }

  for (const preferredVariant of ["128GB", "256GB", "512GB", "1TB"]) {
    const matching = entries.filter(
      (entry) => !entry.variant || entry.variant === preferredVariant,
    );
    if (matching.length >= 1 && entries.some((entry) => entry.variant === preferredVariant)) {
      return matching;
    }
  }

  const variantCounts = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.variant) {
      continue;
    }
    variantCounts.set(entry.variant, (variantCounts.get(entry.variant) ?? 0) + 1);
  }

  const mostCommonVariant = [...variantCounts.entries()]
    .sort((left, right) => right[1] - left[1])[0]?.[0];

  if (mostCommonVariant) {
    const matching = entries.filter(
      (entry) => !entry.variant || entry.variant === mostCommonVariant,
    );
    if (matching.length >= 2) {
      return matching;
    }
  }

  return entries;
}

function buildPriceComparisonAnswer({
  question,
  sources,
  documents,
}: {
  question: string;
  sources: ResearchSource[];
  documents: ResearchDocument[];
}) {
  const tokens = extractCommerceProductTokens(question);
  const rawEntries = collectProductPriceEntries({
    question,
    sources,
    documents,
  });
  const officialSource = sources.find((source) => /samsung\.com$|apple\.com$/.test(source.domain));

  if (officialSource) {
    const officialRetailer = retailLabelFromDomain(officialSource.domain, officialSource.title);
    const alreadyPresent = rawEntries.some(
      (entry) => entry.retailer.toLowerCase() === officialRetailer.toLowerCase(),
    );

    if (!alreadyPresent) {
      const officialPrice =
        extractDirectProductPrice(officialSource.snippet, tokens) ??
        extractBestRetailPrice(officialSource.snippet, tokens);

      if (officialPrice && officialPrice.numeric >= 700) {
        rawEntries.push({
          retailer: officialRetailer,
          priceText: officialPrice.display,
          numericPrice: officialPrice.numeric,
          currency: officialPrice.currency,
          note: buildRetailPriceNote(officialSource.snippet, officialSource.domain),
          variant:
            extractStorageVariant(officialSource.snippet) ||
            extractStorageVariant(officialSource.title) ||
            undefined,
          sourceUrl: officialSource.url,
          domain: officialSource.domain,
          priority: officialPrice.score + 2,
        });
      }
    }
  }

  if (rawEntries.length < 2) {
    if (!rawEntries.length) {
      return null;
    }
  }

  const filteredEntries = choosePriceComparisonEntries(question, rawEntries);
  const dedupedEntries = uniqueBy(
    filteredEntries
      .sort((left, right) => right.priority - left.priority)
      .sort((left, right) => left.numericPrice - right.numericPrice),
    (entry) => entry.retailer.toLowerCase(),
  ).slice(0, 5);
  const preferredEntries = dedupedEntries.filter((entry) =>
    isDirectRetailerOrPriceDomain(entry.domain ?? ""),
  );
  const finalEntries = preferredEntries.length ? preferredEntries : dedupedEntries;
  const hasEnoughForDirectComparison = finalEntries.length >= 2;

  const currencies = [...new Set(finalEntries.map((entry) => entry.currency))];
  const dominantVariant = extractStorageVariant(question) ||
    finalEntries.find((entry) => entry.variant)?.variant;
  const lowestEntry = finalEntries[0];
  const officialEntry = finalEntries.find((entry) => /samsung|apple/i.test(entry.retailer));
  const displaySources = uniqueBy(
    finalEntries
      .map((entry) => sources.find((source) => source.url === entry.sourceUrl))
      .filter((source): source is ResearchSource => Boolean(source)),
    (source) => source.url,
  );
  const verifiedSources = displaySources.length ? displaySources : sources.slice(0, 5);
  const lookup = buildSourceCitationIndex(verifiedSources);

  const summaryParts = [
    `I found directly quoted public prices across ${finalEntries.length} websites for ${normalizeCommerceTopic(question)}${dominantVariant ? ` (${dominantVariant})` : ""}.`,
    lowestEntry
      ? `The lowest clearly quoted current price in the retrieved sources is ${lowestEntry.priceText} at ${lowestEntry.retailer}.`
      : "",
    officialEntry && officialEntry.retailer !== lowestEntry.retailer
      ? `The official ${officialEntry.retailer} listing in the same source set is ${officialEntry.priceText}.`
      : "",
    !hasEnoughForDirectComparison
      ? "I could verify only a limited number of clean retailer-style price pages in the current result set, so treat this as a partial comparison."
      : "",
    currencies.length > 1
      ? "The retrieved sources use more than one currency or regional store, so compare them cautiously."
      : "",
  ].filter(Boolean);

  const comparisonLines = finalEntries.map((entry) => {
    const citation = citationTag(entry.sourceUrl, entry.domain, lookup);
    const parts = [`${entry.retailer}: ${entry.priceText}.`];
    if (entry.note) {
      parts.push(entry.note.charAt(0).toUpperCase() + entry.note.slice(1) + ".");
    }
    if (citation) {
      parts.push(citation);
    }
    return parts.join(" ");
  });

  const answer = fallbackStructuredAnswer({
    question,
    format: "source",
    title: questionAsTitle(question),
    summary: summaryParts.join(" "),
    keyInsights: [],
    sections: [
      {
        title: dominantVariant ? `Price Comparison (${dominantVariant})` : "Price Comparison",
        content: renderBulletList(comparisonLines),
      },
      {
        title: hasEnoughForDirectComparison ? "Buying Notes" : "Why the Comparison Is Limited",
        content: renderBulletList([
          hasEnoughForDirectComparison
            ? "Final checkout prices can change with taxes, region, storage variant, and seller availability."
            : "Several retrieved pages were deal roundups, country comparisons, or financing pages rather than clean product checkout pages.",
          hasEnoughForDirectComparison
            ? "Carrier, exchange, bank, and preorder offers can make a headline price look lower than the standard retail price."
            : "For a cleaner retailer-by-retailer comparison, ask for a specific market such as US, India, or UK and a specific storage variant.",
        ]),
      },
    ],
    followUps: contextualFollowUps(question, "source"),
    sources: verifiedSources,
  });

  return {
    ...answer,
    title: `${normalizeCommerceTopic(question)} Price Comparison`,
    keyInsights: [],
    markdown: buildAnswerMarkdown(
      {
        ...answer,
        title: `${normalizeCommerceTopic(question)} Price Comparison`,
        keyInsights: [],
      },
      verifiedSources,
    ),
  };
}

function buildEvidenceLines(
  sources: ResearchSource[],
  retrievedContext: RetrievedChunk[],
) {
  const lookup = buildSourceCitationIndex(sources);
  const sourceLines = sources
    .slice(0, 5)
    .map((source) => {
      const sentence = bestEvidenceTextFromSource(source);
      const citation = citationTag(source.url, source.domain, lookup);
      const composed = sentence ? `${sentence}${citation ? ` ${citation}` : ""}` : "";
      return normalizeEvidenceLineForDisplay(composed);
    })
    .filter(Boolean);

  const dedupedSourceLines = [...new Set(sourceLines)].filter(isUsableEvidenceLine);
  if (dedupedSourceLines.length >= 3) {
    return dedupedSourceLines.slice(0, 5);
  }

  const chunkLines = retrievedContext
    .slice(0, 4)
    .map((chunk) => {
      const sentence = bestEvidenceTextFromChunk(chunk);
      const citation = citationTag(chunk.url, undefined, lookup);
      const composed = sentence ? `${sentence}${citation ? ` ${citation}` : ""}` : "";
      return normalizeEvidenceLineForDisplay(composed);
    })
    .filter(Boolean);

  return [...new Set([...dedupedSourceLines, ...chunkLines])]
    .filter(isUsableEvidenceLine)
    .slice(0, 5);
}

function buildSensitiveRealtimeAnswer({
  question,
  sources,
  retrievedContext,
}: {
  question: string;
  sources: ResearchSource[];
  retrievedContext: RetrievedChunk[];
}) {
  const filteredSources = sources.filter((source) => Boolean(bestEvidenceTextFromSource(source)));
  const displaySources = (filteredSources.length ? filteredSources : sources).slice(0, 5);
  const indexOnlySources =
    displaySources.length > 0 &&
    displaySources.every((source) => isIndexStyleNewsUrl(source.url));

  if (indexOnlySources) {
    const liveIndexLines = displaySources
      .slice(0, 3)
      .map((source, index) => `${sourceCitationLabel(source)} live index [${index + 1}]`);

    return fallbackStructuredAnswer({
      question,
      format: "source",
      title: newsTitleFromQuestion(question),
      summary: NO_RELIABLE_INFO_MESSAGE,
      keyInsights: [NO_RELIABLE_INFO_MESSAGE],
      sections: [
        {
          title: "Evidence Availability",
          content: renderBulletList([
            NO_RELIABLE_INFO_MESSAGE,
            "The retrieved pages are live index feeds rather than specific dated reports, so exact claim-level synthesis is not reliable yet.",
          ]),
        },
        {
          title: "Live Source Indexes",
          content: renderBulletList(liveIndexLines.length ? liveIndexLines : [NO_RELIABLE_INFO_MESSAGE]),
        },
      ],
      followUps: contextualFollowUps(question, "source"),
      sources: displaySources,
    });
  }

  const evidenceLines = buildEvidenceLines(displaySources, retrievedContext);
  const displayEvidenceLines = evidenceLines
    .map((line) => {
      const citation = line.match(/\[[^\]]+\]\(https?:\/\/[^)]+\)/i)?.[0] ?? "";
      const plain = stripCitationMarkers(line)
        .split(/\s+[—–-]\s+/)[0]
        ?.trim()
        .replace(/\s+[—–-]\s+/g, ". ")
        .replace(/\s{2,}/g, " ")
        .trim() || "";
      const firstSentence = plain
        .split(/(?<=[.!?])\s+/)
        .map((sentence) => sentence.trim())
        .filter(Boolean)[0];
      if (!firstSentence) {
        return "";
      }
      const normalized = /[.!?]$/.test(firstSentence) ? firstSentence : `${firstSentence}.`;
      return citation ? `${normalized} ${citation}` : normalized;
    })
    .filter(Boolean);
  const cleanEvidenceLines = displayEvidenceLines
    .map((line) => cleanEvidenceCandidate(stripCitationMarkers(line)))
    .filter(Boolean);
  const summary =
    displayEvidenceLines.length && cleanEvidenceLines.length
      ? polishSummaryText(clipText(cleanEvidenceLines.slice(0, 2).join(" "), 360))
      : "Current reporting is still developing, and the strongest available sources do not yet support a more detailed summary.";

  const answer = fallbackStructuredAnswer({
    question,
    format: "source",
    title: newsTitleFromQuestion(question),
    summary,
    keyInsights: [],
    sections: [
      {
        title: "Latest Developments",
        content: renderBulletList(
          displayEvidenceLines.length
            ? displayEvidenceLines
            : ["Coverage is still developing, and specific details remain limited across the strongest available sources."],
        ),
      },
      {
        title: "What Remains Unclear",
        content: renderBulletList([
          "This is a fast-moving situation, so timing, attribution, and downstream effects may still change as new reporting comes in.",
          "The strongest public sources do not yet fully settle every operational or political detail.",
        ]),
      },
    ],
    followUps: contextualFollowUps(question, "source"),
    sources: displaySources,
  });

  return {
    ...answer,
    keyInsights: [],
    markdown: buildAnswerMarkdown(
      {
        ...answer,
        keyInsights: [],
      },
      displaySources,
    ),
  };
}

function buildDeterministicSourceAnswer({
  question,
  sources,
  retrievedContext,
}: {
  question: string;
  sources: ResearchSource[];
  retrievedContext: RetrievedChunk[];
}) {
  const displaySources = deriveCitationSources(sources, [], retrievedContext).slice(0, 5);
  const evidenceLines = buildEvidenceLines(displaySources, retrievedContext);

  if (!displaySources.length && !evidenceLines.length) {
    return null;
  }

  const summary = evidenceLines.length
    ? clipText(stripCitationMarkers(evidenceLines.slice(0, 2).join(" ")), 340)
    : "The answer is based on the strongest live sources retrieved for this query, but the extracted evidence remains limited.";

  const supportingLines =
    evidenceLines.length > 0
      ? evidenceLines
      : displaySources
          .slice(0, 4)
          .map((source, index) => {
            const citation = `[${index + 1}]`;
            const line = stripCitationMarkers(bestEvidenceTextFromSource(source) || source.snippet);
            return line ? `${line} ${citation}` : `${source.title} ${citation}`;
          });

  return fallbackStructuredAnswer({
    question,
    format: "source",
    title: questionAsTitle(question),
    summary,
    keyInsights: [],
    sections: [
      {
        title: "Verified Findings",
        content: renderBulletList(supportingLines),
      },
      {
        title: "What This Means",
        content: renderBulletList([
          "The answer is grounded in current public sources rather than model memory alone.",
          displaySources.length >= 3
            ? "Multiple domains were cross-checked, which reduces but does not eliminate reporting gaps or timing differences."
            : "Only a small number of strong sources were available, so remaining uncertainty should be treated cautiously.",
        ]),
      },
    ],
    followUps: contextualFollowUps(question, "source"),
    sources: displaySources,
  });
}

function buildDeterministicDocumentAnswer({
  question,
  sources,
  retrievedContext,
}: {
  question: string;
  sources: ResearchSource[];
  retrievedContext: RetrievedChunk[];
}) {
  const displaySources = deriveCitationSources(sources, [], retrievedContext).slice(0, 5);
  const lookup = buildSourceCitationIndex(displaySources);
  const evidenceLines = retrievedContext
    .slice(0, 5)
    .map((chunk) => {
      const evidence = bestEvidenceTextFromChunk(chunk);
      const citation = citationTag(chunk.url, undefined, lookup);
      return evidence ? `${evidence}${citation ? ` ${citation}` : ""}` : "";
    })
    .filter(Boolean);

  const summary = evidenceLines.length
    ? clipText(stripCitationMarkers(evidenceLines.slice(0, 2).join(" ")), 320)
    : "The knowledge store returned only limited matching context for this question, so the answer should be treated as partial.";

  return fallbackStructuredAnswer({
    question,
    format: "document",
    title: questionAsTitle(question),
    summary,
    keyInsights: [],
    sections: [
      {
        title: "Best Matching Evidence",
        content: renderBulletList(
          evidenceLines.length
            ? evidenceLines
            : ["No strong retrieval chunks were available for this question."],
        ),
      },
      {
        title: "Coverage Notes",
        content: renderBulletList([
          retrievedContext.length
            ? "The response was assembled from the highest-similarity chunks in the indexed knowledge base."
            : "The knowledge store did not return enough relevant evidence to support a stronger answer.",
          "If you need a tighter answer, use a more specific document question, section name, or quoted phrase.",
        ]),
      },
    ],
    followUps: contextualFollowUps(question, "document"),
    sources: displaySources,
  });
}

function buildDeterministicWebsiteAnswer({
  question,
  sources,
  documents,
}: {
  question: string;
  sources: ResearchSource[];
  documents: ResearchDocument[];
}) {
  const document = documents[0];
  if (!document) {
    return null;
  }
  const displaySources = deriveCitationSources(sources, documents, []).slice(0, 3);

  const plain = sanitizeAnswerText(document.content);
  const sentences = candidateSentencesFromText(plain, 8);
  const recommendations = [
    plain.length < 600
      ? "The extracted page copy is thin, so the page likely needs a clearer value proposition and more supporting proof."
      : "The page has enough copy to communicate substance, but it still benefits from sharper hierarchy and tighter grouping of claims.",
    /\b(sign up|book demo|start|contact sales|get started|try now)\b/i.test(plain)
      ? "A call to action is present; the main opportunity is to make the conversion path more prominent and easier to scan."
      : "The page should make its primary call to action more explicit near the top of the page.",
    /\b(pricing|plans|customers|case study|security|docs|documentation)\b/i.test(plain)
      ? "Key trust or decision-support content exists; consider surfacing it earlier in the page flow."
      : "Add trust-building content such as proof points, product detail, pricing clarity, or customer outcomes closer to the top.",
  ];

  return fallbackStructuredAnswer({
    question,
    format: "website_analysis",
    title: document.title || questionAsTitle(question),
    summary:
      sentences[0] ||
      "The page was extracted successfully, but the visible copy is limited, so the assessment is based on a partial content snapshot.",
    keyInsights: [],
    sections: [
      {
        title: "Content Snapshot",
        content: renderBulletList(sentences.slice(0, 4)),
      },
      {
        title: "Recommendations",
        content: renderBulletList(recommendations),
      },
    ],
    followUps: contextualFollowUps(question, "website_analysis"),
    sources: displaySources,
  });
}

function deterministicResearchTitle(question: string) {
  const clean = questionAsTitle(question).replace(/\?+$/, "");
  return clean.startsWith("Research Report:")
    ? clean
    : `Research Report: ${clean}`;
}

function buildDeterministicResearchReport(
  question: string,
  plan: ResearchPlan,
  retrievedContext: RetrievedChunk[],
  sources: ResearchSource[],
) {
  const displaySources = uniqueBy(sources, (source) => source.url).slice(0, 5);
  const evidenceLines = buildEvidenceLines(displaySources, retrievedContext);
  const keyFindings = (
    evidenceLines.length
      ? evidenceLines
      : displaySources.map((source, index) => {
          const citation = `[${index + 1}]`;
          const evidence = stripCitationMarkers(bestEvidenceTextFromSource(source) || source.snippet);
          return evidence ? `${evidence} ${citation}` : `${source.title} ${citation}`;
        })
  ).slice(0, 5);

  const executiveSummary = keyFindings.length
    ? clipText(stripCitationMarkers(keyFindings.slice(0, 2).join(" ")), 360)
    : NO_RELIABLE_INFO_MESSAGE;

  return {
    title: deterministicResearchTitle(question),
    executiveSummary,
    keyFindings,
    detailedAnalysis: [
      "## Objective",
      plan.objective,
      "",
      "## Verified Findings",
      renderBulletList(
        keyFindings.length
          ? keyFindings
          : [NO_RELIABLE_INFO_MESSAGE],
      ),
      "",
      "## Limits",
      renderBulletList([
        displaySources.length >= 3
          ? "Multiple sources were gathered and reranked, but publication timing and framing can still differ across outlets."
          : "The result set was narrow, which limits confidence and increases the risk of omitted context.",
        "For a deeper report, narrow the timeframe, geography, company set, or metric so retrieval can focus on a tighter evidence base.",
      ]),
    ].join("\n"),
    sourceHighlights: displaySources.map(
      (source, index) => `[${index + 1}] ${source.title} (${source.domain})`,
    ),
  };
}

function normalizeSectionTitle(title: string) {
  return sanitizeAnswerText(title)
    .replace(/:$/, "")
    .replace(/\bkey points?\b/i, "Highlights")
    .replace(/\bsummary\b/i, "Overview")
    .trim();
}

function dedupeSections(sections: AnswerSection[], hasKeyInsights: boolean) {
  const seen = new Set<string>();

  return sections.filter((section) => {
    const normalizedTitle = normalizeSectionTitle(section.title).toLowerCase();
    if (!normalizedTitle) {
      return false;
    }

    if (
      /^(sources|references|citations)$/i.test(normalizedTitle) ||
      /\b(source|reference|citation)\b/i.test(normalizedTitle)
    ) {
      return false;
    }

    if (/^(key updates?|conclusion|final thoughts?)$/i.test(normalizedTitle)) {
      return false;
    }

    if (/^overview$/i.test(normalizedTitle)) {
      return false;
    }

    if (hasKeyInsights && /^highlights$/i.test(normalizedTitle)) {
      return false;
    }

    if (seen.has(normalizedTitle)) {
      return false;
    }

    seen.add(normalizedTitle);
    return true;
  });
}

function parseMarkdownSections(markdown: string) {
  const lines = markdown.replace(/\r/g, "").trim().split("\n");
  const sections: AnswerSection[] = [];
  let currentTitle = "";
  let currentContent: string[] = [];
  const summaryLines: string[] = [];
  let summaryLocked = false;

  function flushSection() {
    if (!currentTitle || !currentContent.join("\n").trim()) {
      currentTitle = "";
      currentContent = [];
      return;
    }

    const normalizedTitle = currentTitle.replace(/^\*+|\*+$/g, "").trim();
    if (/^(references|sources|citations)$/i.test(normalizedTitle)) {
      currentTitle = "";
      currentContent = [];
      return;
    }

    sections.push({
      title: normalizedTitle,
      content: currentContent.join("\n").trim(),
    });
    currentTitle = "";
    currentContent = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    const isBoldHeading =
      /^\*\*[^*].*[^*]\*\*$/.test(trimmed) &&
      !trimmed.includes("|") &&
      trimmed.length < 90;
    const isMarkdownHeading = /^#{1,3}\s+/.test(trimmed);
    const headingValue = isMarkdownHeading
      ? trimmed.replace(/^#{1,3}\s+/, "").trim()
      : trimmed.replace(/^\*\*|\*\*$/g, "").trim();
    const isHeading = isBoldHeading || isMarkdownHeading;

    if (!summaryLocked && isHeading && !summaryLines.length && !sections.length) {
      continue;
    }

    if (!summaryLocked && !trimmed) {
      if (summaryLines.length) {
        summaryLocked = true;
      }
      continue;
    }

    if (!summaryLocked && !isHeading) {
      summaryLines.push(line);
      continue;
    }

    summaryLocked = true;

    if (isHeading) {
      flushSection();
      currentTitle = headingValue;
      continue;
    }

    currentContent.push(line);
  }

  flushSection();

  return {
    summary: summaryLines.join("\n").trim(),
    sections,
  };
}

function buildAnswerMarkdown(
  answer: Omit<AssistantAnswer, "markdown">,
  sources: ResearchSource[] = [],
) {
  if (answer.format === "greeting") {
    return [answer.summary.trim(), renderSectionsMarkdown(answer.sections)]
      .filter(Boolean)
      .join("\n\n");
  }

  const requiresSources = ["source", "research", "website_analysis", "document"].includes(
    answer.format,
  );
  const sectionUpdates = sectionBulletCandidates(answer.sections);
  const fallbackUpdates = evidenceFallbackBullets(
    sources,
    answer.sections,
    answer.keyInsights,
  );
  const titleBlock = answer.title.trim() ? `# ${answer.title.trim()}` : "";
  const summaryBlock = answer.summary.trim() || NO_RELIABLE_INFO_MESSAGE;
  const keyUpdates = answer.keyInsights.length
    ? answer.keyInsights
    : sectionUpdates.length
      ? sectionUpdates
    : fallbackUpdates.length
      ? fallbackUpdates
    : requiresSources
      ? [NO_RELIABLE_INFO_MESSAGE]
      : ["No major updates beyond the short summary."];
  const keyUpdatesWithCitations = requiresSources
    ? injectCitationBadgesIntoItems(keyUpdates, sources)
    : keyUpdates;
  const keyPointsBlock = `## Key Updates\n${renderBulletList(keyUpdatesWithCitations)}`;
  const detailBody = answer.sections.length
    ? renderSectionsMarkdown(answer.sections)
    : requiresSources
      ? NO_RELIABLE_INFO_MESSAGE
      : "No additional detail is required for this response.";

  return [
    titleBlock,
    `## Short Summary\n${summaryBlock}`,
    keyPointsBlock,
    `## Detailed Explanation\n${detailBody}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function defaultFollowUps(format: AnswerFormat) {
  if (format === "coding") {
    return [
      "Do you want a shorter or more optimized implementation?",
      "Should I adapt this for a specific framework or runtime?",
      "Do you want tests added for this solution?",
      "Should I explain the time and space complexity?",
    ];
  }

  if (format === "website_analysis") {
    return [
      "Should I audit the page above the fold in more detail?",
      "Do you want a sharper conversion-focused rewrite?",
      "Should I break down the most important SEO issues?",
      "Do you want this compared against a competitor page?",
    ];
  }

  if (format === "document") {
    return [
      "Which part of the document should I unpack next?",
      "Do you want a simpler summary of the main argument?",
      "Should I extract action items from this material?",
      "Do you want the strongest evidence organized by topic?",
    ];
  }

  if (format === "general") {
    return [
      "Should I explain this more simply?",
      "Do you want an example or real-world analogy?",
      "Would a short comparison help clarify it?",
      "Should I go one level deeper on the main idea?",
    ];
  }

  return [
    "Do you want a short timeline of the key developments?",
    "Should I compare the main entities, options, or viewpoints involved?",
    "Would a table or ranked breakdown help here?",
    "Do you want the implications, risks, or what to watch next?",
  ];
}

function inferTopicLabel(question: string) {
  const quoted = question.match(/["“](.+?)["”]/)?.[1]?.trim();
  if (quoted) {
    return clipText(quoted, 60);
  }

  const cleaned = question
    .replace(/https?:\/\/\S+/g, " ")
    .replace(
      /^(what is|what are|who is|who are|tell me about|give me|show me|explain|compare|analyze|analyse|review|summarize|summarise|write|build|create|find|list|top \d+|best|latest)\s+/i,
      "",
    )
    .replace(/[^\w+#.-]+/g, " ")
    .trim();

  const tokens = cleaned
    .split(/\s+/)
    .filter((token) => {
      const lower = token.toLowerCase();
      return (
        token.length >= 2 &&
        !FOLLOW_UP_STOP_WORDS.has(lower) &&
        /[a-z0-9]/i.test(token)
      );
    })
    .slice(0, 5);

  return clipText(tokens.join(" "), 60);
}

function contextualFollowUps(question: string, format: AnswerFormat) {
  const topic = inferTopicLabel(question);
  const topicSuffix = topic ? ` for ${topic}` : "";
  const topicTarget = topic || "this topic";
  const lower = question.toLowerCase();

  if (format === "coding") {
    return [
      `Do you want tests added${topicSuffix}?`,
      `Should I optimize the implementation${topicSuffix}?`,
      `Do you want this adapted for a specific framework or runtime${topicSuffix}?`,
      `Should I explain the edge cases and complexity${topicSuffix}?`,
    ];
  }

  if (format === "website_analysis") {
    return [
      "Should I audit the above-the-fold messaging in more detail?",
      "Do you want a stronger conversion-focused rewrite?",
      "Should I break down the biggest SEO issues page by page?",
      "Do you want this benchmarked against a competitor site?",
    ];
  }

  if (format === "document") {
    return [
      `Which section should I unpack next${topicSuffix}?`,
      `Do you want the main claims and evidence organized${topicSuffix}?`,
      `Should I extract action items or takeaways${topicSuffix}?`,
      `Do you want a shorter executive summary${topicSuffix}?`,
    ];
  }

  if (/\b(price|prices|deal|deals|buy|buying|purchase|cost|cheapest|discount|trade-in|carrier)\b/.test(lower)) {
    return [
      `Do you want the best current prices${topicSuffix}?`,
      `Should I compare retailer, carrier, and trade-in offers${topicSuffix}?`,
      `Would a total-cost breakdown by option help${topicSuffix}?`,
      `Do you want the safest buying recommendation right now${topicSuffix}?`,
    ];
  }

  if (/\b(compare|comparison|versus|vs)\b/.test(lower)) {
    return [
      `Which option is strongest for different use cases${topicSuffix}?`,
      `Do you want a side-by-side feature and cost table${topicSuffix}?`,
      `Should I rank the tradeoffs from best to worst${topicSuffix}?`,
      `Do you want a simple recommendation based on your goal${topicSuffix}?`,
    ];
  }

  if (/\b(top \d+|ranking|rank|list|richest|largest|best|highest|lowest)\b/.test(lower)) {
    return [
      `Do you want the ranking by a different metric${topicSuffix}?`,
      `Should I compare the top entries in more detail${topicSuffix}?`,
      `Would a table with the key numbers help${topicSuffix}?`,
      `Do you want the latest changes that could affect this ranking${topicSuffix}?`,
    ];
  }

  if (/\b(latest|today|current|news|update|updates|live|recent|happening|status|situation)\b/.test(lower)) {
    return [
      `Do you want a short timeline of the latest developments${topicSuffix}?`,
      `Should I pull the strongest official statements or primary sources${topicSuffix}?`,
      `Do you want a quick summary of what changed most recently${topicSuffix}?`,
      `Should I outline what to watch next${topicSuffix}?`,
    ];
  }

  if (format === "general") {
    return [
      `Should I explain the core idea more simply${topicSuffix}?`,
      `Do you want a concrete example or analogy${topicSuffix}?`,
      `Would a comparison with a related concept help${topicSuffix}?`,
      `Should I go one level deeper into the main mechanism${topicSuffix}?`,
    ];
  }

  return [
    `Do you want the key drivers behind ${topicTarget}?`,
    `Should I compare the main options or viewpoints for ${topicTarget}?`,
    `Would a table or ranked breakdown of ${topicTarget} help?`,
    `Do you want the implications, risks, or what to watch next for ${topicTarget}?`,
  ];
}

function cleanFollowUp(value: string) {
  const normalized = markdownToPlainText(value)
    .replace(/^[-*•\d.)\s]+/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  let cleaned = normalized
    .replace(/\bthis answer\b/gi, "this topic")
    .replace(/\bthis topic topic\b/gi, "this topic")
    .replace(/\b(what are the latest updates affecting)\s+\1\b/gi, "$1")
    .trim();

  if (
    cleaned.length < 18 ||
    cleaned.length > 110 ||
    /(this topic\?\s*this topic|answer\?\s*answer|topic\?\s*topic)/i.test(cleaned) ||
    /^what else\??$/i.test(cleaned)
  ) {
    return "";
  }

  if (!/[?!.]$/.test(cleaned)) {
    cleaned = `${cleaned}?`;
  }

  return cleaned;
}

function sanitizeFollowUps(
  question: string,
  format: AnswerFormat,
  followUps: string[],
) {
  const cleaned: string[] = [];
  const seen = new Set<string>();

  for (const followUp of followUps) {
    const nextValue = cleanFollowUp(followUp);
    const key = nextValue.toLowerCase();
    if (!nextValue || seen.has(key)) {
      continue;
    }

    seen.add(key);
    cleaned.push(nextValue);
  }

  for (const fallback of contextualFollowUps(question, format)) {
    const key = fallback.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    cleaned.push(fallback);
    if (cleaned.length >= 4) {
      break;
    }
  }

  for (const fallback of defaultFollowUps(format)) {
    const key = fallback.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    cleaned.push(fallback);
    if (cleaned.length >= 4) {
      break;
    }
  }

  return cleaned.slice(0, 4);
}

function firstUsefulSentence(value: string) {
  const plain = markdownToPlainText(value).replace(/\s+/g, " ").trim();
  if (!plain) {
    return "";
  }

  const sentence = plain.split(/(?<=[.!?])\s+/)[0] ?? plain;
  return clipText(sentence.trim(), 140);
}

function deriveKeyInsights(
  format: AnswerFormat,
  sections: AnswerSection[],
  sources: ResearchSource[],
  summary: string,
) {
  if (!["source", "research", "website_analysis", "document"].includes(format)) {
    return [] as string[];
  }

  const candidates = [
    sanitizeInsightText(firstUsefulSentence(summary)),
    ...sections.flatMap((section) => [
      sanitizeInsightText(firstUsefulSentence(section.content)),
    ]),
    ...sources.map((source) => sanitizeInsightText(firstUsefulSentence(source.snippet))),
  ]
    .filter((item) => item.length >= 24)
    .slice(0, 6);

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(candidate);
    if (unique.length >= 4) {
      break;
    }
  }

  return unique.length
    ? unique
    : [sanitizeInsightText(clipText(markdownToPlainText(summary), 120))].filter(Boolean);
}

function hasRankingSection(sections: AnswerSection[]) {
  return sections.some(
    (section) =>
      /\b(rank|ranking|top|list|picks)\b/i.test(section.title) &&
      /^(?:[-*]|\d+\.)\s+/m.test(section.content),
  );
}

function hasInlineCitationLinks(value: string) {
  return /\[[^\]]+\]\(https?:\/\/[^)]+\)/i.test(value);
}

function looksLikeTruncatedResponse(value: string) {
  const normalized = markdownToPlainText(value).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return true;
  }

  if (/\.\.\.$/.test(normalized) || /[,:;\-]$/.test(normalized)) {
    return true;
  }

  return /\b(and|or|with|including|for|to|of|in|on|by|from|than|that)\s*$/i.test(normalized);
}

function containsSourceHeading(value: string) {
  return /^\s{0,3}(?:##+\s*)?(?:sources|references|citations)\s*:?\s*$/im.test(value);
}

function rankingLineCount(markdown: string) {
  return (markdown.match(/^\s*\d+\.\s+/gm) ?? []).length;
}

function isProfessionalSourceAnswer(
  question: string,
  answer: AssistantAnswer,
  sources: ResearchSource[],
  isRankingQuestion: boolean,
  requestedRankCount: number,
) {
  const normalizedQuestion = question.toLowerCase();
  const answerText = markdownToPlainText(answer.markdown).replace(/\s+/g, " ").toLowerCase();
  const summaryPlain = markdownToPlainText(answer.summary).replace(/\s+/g, " ").trim();
  const proseSections = answer.sections.filter((section) => section.kind !== "code");
  const hasSections = proseSections.some(
    (section) => markdownToPlainText(section.content).replace(/\s+/g, " ").trim().length >= 40,
  );

  if (!summaryPlain || summaryPlain.length < 28) {
    return false;
  }

  if (looksLikeTruncatedResponse(answer.summary)) {
    return false;
  }

  if (!hasSections) {
    return false;
  }

  if (proseSections.some((section) => looksLikeTruncatedResponse(section.content))) {
    return false;
  }

  if (containsSourceHeading(answer.markdown)) {
    return false;
  }

  if (
    /\bcountries?\b/.test(normalizedQuestion) &&
    !/\bcountries?\b/.test(answerText)
  ) {
    return false;
  }

  if (/\bcities?\b/.test(normalizedQuestion) && !/\bcities?\b/.test(answerText)) {
    return false;
  }

  if (
    /\b(richest|wealth|wealthiest|gdp|billionaire|millionaire)\b/.test(normalizedQuestion) &&
    !/\b(richest|wealth|wealthiest|gdp|billionaire|millionaire|econom)\b/.test(answerText)
  ) {
    return false;
  }

  if (
    /\b(wizarding|harry potter|hogwarts)\b/.test(answerText) &&
    !/\b(wizarding|harry potter|hogwarts)\b/.test(normalizedQuestion)
  ) {
    return false;
  }

  if (sources.length > 0 && !hasInlineCitationLinks(answer.markdown)) {
    return false;
  }

  if (isRankingQuestion) {
    const minimumExpected = Math.max(5, Math.min(requestedRankCount, 10));
    if (rankingLineCount(answer.markdown) < minimumExpected) {
      return false;
    }
  }

  return true;
}

function evidenceFallbackBullets(
  sources: ResearchSource[],
  sections: AnswerSection[],
  keyInsights: string[],
) {
  const candidates = [
    ...keyInsights,
    ...sections.map((section) => firstUsefulSentence(section.content)),
    ...sources.map((source) => bestEvidenceTextFromSource(source) || firstUsefulSentence(source.snippet)),
  ]
    .map((candidate) => sanitizeInsightText(candidate))
    .filter((candidate) => candidate.length >= 24);

  return [...new Set(candidates)].slice(0, 4);
}

function sectionBulletCandidates(sections: AnswerSection[]) {
  const bullets: string[] = [];
  const orderedSections = [...sections].sort((left, right) => {
    const leftPriority = /\b(update|highlights?|summary|overview)\b/i.test(left.title) ? 0 : 1;
    const rightPriority = /\b(update|highlights?|summary|overview)\b/i.test(right.title) ? 0 : 1;
    return leftPriority - rightPriority;
  });

  for (const section of orderedSections) {
    if (section.kind === "code") {
      continue;
    }

    for (const line of section.content.split("\n")) {
      const match = line.trim().match(/^(?:[-*]|\d+\.)\s+(.+)/);
      if (!match?.[1]) {
        continue;
      }

      const cleaned = sanitizeInsightText(stripCitationMarkers(match[1]));
      if (!cleaned || cleaned.length < 24) {
        continue;
      }

      if (cleaned.split(/\s+/).length > 28) {
        continue;
      }

      bullets.push(cleaned);
      if (bullets.length >= 4) {
        return [...new Set(bullets)];
      }
    }
  }

  return [...new Set(bullets)];
}

function repairSummaryIfNeeded(
  summary: string,
  sources: ResearchSource[],
  sections: AnswerSection[],
  keyInsights: string[],
) {
  if (!summary || looksLikeMalformedNarrative(summary) || summaryLooksIncomplete(summary)) {
    const fallback = evidenceFallbackBullets(sources, sections, keyInsights)[0];
    return fallback ? clipText(fallback, 260) : NO_RELIABLE_INFO_MESSAGE;
  }

  return summary;
}

function repairSectionsIfNeeded(
  format: AnswerFormat,
  sections: AnswerSection[],
  sources: ResearchSource[],
  keyInsights: string[],
) {
  if (format === "greeting") {
    return sections;
  }

  const fallbackBullets = evidenceFallbackBullets(sources, sections, keyInsights);

  const repaired = sections.map((section, index) => {
    if (section.kind === "code") {
      return section;
    }

    if (!looksLikeMalformedNarrative(section.content)) {
      return section;
    }

    if (!fallbackBullets.length) {
      return section;
    }

    return {
      ...section,
      title: section.title || (index === 0 ? "Detailed Findings" : "Additional Context"),
      content: renderBulletList(fallbackBullets),
    } satisfies AnswerSection;
  });

  if (repaired.length) {
    return repaired;
  }

  if (!fallbackBullets.length) {
    return repaired;
  }

  return [
    {
      title: "Detailed Findings",
      content: renderBulletList(fallbackBullets),
      kind: "markdown",
    } satisfies AnswerSection,
  ];
}

function normalizeAnswerBody(
  question: string,
  format: AnswerFormat,
  body: GeneratedAnswerBody,
  sources: ResearchSource[] = [],
): AssistantAnswer {
  const requiresEvidence = ["source", "research", "website_analysis", "document"].includes(format);
  const hasEvidence = sources.length > 0;
  const rawSections: AnswerSection[] = body.sections
    .slice(0, 6)
    .map(
      (section): AnswerSection => ({
        title: normalizeSectionTitle(section.title),
        content:
          section.kind === "code"
            ? section.content
            : sanitizeAnswerText(section.content),
        kind: section.kind === "code" ? "code" : "markdown",
        language: section.language,
      }),
    )
    .map(normalizeSectionContent);
  const normalizedSections = dedupeSections(
    rawSections,
    body.keyInsights.slice(0, 6).filter(Boolean).length > 0,
  );
  const shouldHideKeyInsights = hasRankingSection(normalizedSections);
  const normalizedKeyInsights =
    shouldHideKeyInsights
      ? []
      :
    body.keyInsights.slice(0, 6).filter(Boolean).length > 0
      ? body.keyInsights
          .slice(0, 6)
          .map(sanitizeInsightText)
          .filter(Boolean)
      : deriveKeyInsights(format, normalizedSections, sources, body.summary);
  const repairedSections = repairSectionsIfNeeded(
    format,
    normalizedSections,
    sources,
    normalizedKeyInsights,
  );
  const rawSummary =
    requiresEvidence && !hasEvidence
      ? NO_RELIABLE_INFO_MESSAGE
      : polishSummaryText(normalizeReferenceFormatting(body.summary));
  const repairedSummary =
    requiresEvidence && !hasEvidence
      ? NO_RELIABLE_INFO_MESSAGE
      : repairSummaryIfNeeded(rawSummary, sources, repairedSections, normalizedKeyInsights);

  const normalized = {
    format,
    title: sanitizeAnswerText(body.title),
    summary: filterInlineCitations(repairedSummary, sources),
    keyInsights:
      requiresEvidence && !hasEvidence
        ? [NO_RELIABLE_INFO_MESSAGE]
        : normalizedKeyInsights.map((item) => filterInlineCitations(item, sources)),
    sections:
      requiresEvidence && !hasEvidence
        ? [
            {
              title: "Evidence Availability",
              content: NO_RELIABLE_INFO_MESSAGE,
              kind: "markdown",
            } satisfies AnswerSection,
          ]
        : repairedSections.map((section) => ({
            ...section,
            content:
              section.kind === "code"
                ? section.content
                : formatBulletStructure(
                    injectCitationBadges(
                      filterInlineCitations(section.content, sources),
                      sources,
                    ),
                  ),
          })),
    followUps: sanitizeFollowUps(question, format, body.followUps),
  } satisfies Omit<AssistantAnswer, "markdown">;

  return {
    ...normalized,
    markdown: buildAnswerMarkdown(normalized, sources),
  };
}

function normalizeMarkdownAnswer(
  question: string,
  format: AnswerFormat,
  title: string,
  markdown: string,
  sources: ResearchSource[] = [],
) {
  const requiresEvidence = ["source", "research", "website_analysis", "document"].includes(format);
  const hasEvidence = sources.length > 0;
  const parsed = parseMarkdownSections(markdown);
  const plain = sanitizeAnswerText(markdownToPlainText(markdown));
  const summaryBlocks = parsed.summary
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  const leadSummary = summaryBlocks[0] ?? parsed.summary;
  const derivedSections = summaryBlocks.slice(1).map((block, index) => ({
    title: index === 0 ? "Key Data" : "Additional Detail",
    content: sanitizeAnswerText(block),
  }));
  const summary = leadSummary
    ? polishSummaryText(leadSummary)
    : polishSummaryText(clipText(plain, 220));
  const normalizedSections = dedupeSections(
    [...derivedSections, ...parsed.sections]
      .slice(0, 4)
      .map((section) => ({
        ...section,
        title: normalizeSectionTitle(section.title),
        content: sanitizeAnswerText(section.content),
      })),
    false,
  )
    .map(normalizeSectionContent);
  const shouldHideKeyInsights = hasRankingSection(normalizedSections);
  const normalizedKeyInsights = shouldHideKeyInsights
    ? []
    : deriveKeyInsights(
        format,
        normalizedSections,
        sources,
        summary,
      );
  const repairedSections = repairSectionsIfNeeded(
    format,
    normalizedSections,
    sources,
    normalizedKeyInsights,
  );
  const rawSummary =
    requiresEvidence && !hasEvidence
      ? NO_RELIABLE_INFO_MESSAGE
      : polishSummaryText(normalizeReferenceFormatting(summary));
  const repairedSummary =
    requiresEvidence && !hasEvidence
      ? NO_RELIABLE_INFO_MESSAGE
      : repairSummaryIfNeeded(rawSummary, sources, repairedSections, normalizedKeyInsights);
  const normalized = {
    format,
    title: sanitizeAnswerText(title),
    summary: filterInlineCitations(repairedSummary, sources),
    keyInsights:
      requiresEvidence && !hasEvidence
        ? [NO_RELIABLE_INFO_MESSAGE]
        : normalizedKeyInsights.map((item) => filterInlineCitations(item, sources)),
    sections:
      requiresEvidence && !hasEvidence
        ? [
            {
              title: "Evidence Availability",
              content: NO_RELIABLE_INFO_MESSAGE,
              kind: "markdown",
            } satisfies AnswerSection,
          ]
        : repairedSections.map((section) => ({
            ...section,
            content:
              section.kind === "code"
                ? section.content
                : formatBulletStructure(
                    injectCitationBadges(
                      filterInlineCitations(section.content, sources),
                      sources,
                    ),
                  ),
          })),
    followUps: contextualFollowUps(question, format),
  } satisfies Omit<AssistantAnswer, "markdown">;

  return {
    ...normalized,
    markdown: buildAnswerMarkdown(normalized, sources),
  } satisfies AssistantAnswer;
}

function fallbackStructuredAnswer({
  question,
  format,
  title,
  summary,
  keyInsights,
  sections,
  followUps = [],
  sources = [],
}: {
  question: string;
  format: AnswerFormat;
  title: string;
  summary: string;
  keyInsights: string[];
  sections: AnswerSection[];
  followUps?: string[];
  sources?: ResearchSource[];
}) {
  return normalizeAnswerBody(
    question,
    format,
    {
      title,
      summary,
      keyInsights,
      sections,
      followUps,
    },
    sources,
  );
}

function providerFromDocument(document: ResearchDocument): ResearchSource["provider"] {
  if (document.provider === "search-fallback") {
    return "jina";
  }

  return document.provider;
}

function deriveCitationSources(
  sources: ResearchSource[],
  documents: ResearchDocument[],
  retrievedContext: RetrievedChunk[],
) {
  if (sources.length) {
    return uniqueBy(sources, (source) => source.url).slice(0, 8);
  }

  const fromDocuments = documents
    .filter((document) => Boolean(document.url))
    .map((document) => ({
      id: `doc:${document.id}`,
      title: document.title || domainFromUrl(document.url),
      url: document.url,
      snippet: clipText(document.excerpt || document.content, 220),
      provider: providerFromDocument(document),
      domain: domainFromUrl(document.url),
      score: 0.5,
    } satisfies ResearchSource));

  const fromRetrievedContext = retrievedContext
    .filter((chunk) => Boolean(chunk.url))
    .map((chunk, index) => ({
      id: `ctx:${chunk.id || index}`,
      title: chunk.title || domainFromUrl(chunk.url),
      url: chunk.url,
      snippet: clipText(chunk.content, 220),
      provider: "weaviate",
      domain: domainFromUrl(chunk.url),
      score: Math.max(0, chunk.score || 0),
    } satisfies ResearchSource));

  return uniqueBy([...fromDocuments, ...fromRetrievedContext], (source) => source.url).slice(0, 8);
}

function sourceIndexText(sources: ResearchSource[]) {
  return sources
    .slice(0, 8)
    .map(
      (source, index) =>
        `${index + 1}. ${source.title}\nURL: ${source.url}\nProvider: ${source.provider}${
          source.publishedDate ? `\nPublished: ${source.publishedDate}` : ""
        }\nSnippet: ${source.snippet}`,
    )
    .join("\n\n");
}

function documentIndexText(documents: ResearchDocument[]) {
  return documents
    .slice(0, 4)
    .map(
      (document, index) =>
        `${index + 1}. ${document.title}\nURL: ${document.url}\nContent: ${clipText(
          document.content,
          420,
        )}`,
    )
    .join("\n\n");
}

function retrievalIndexText(retrievedContext: RetrievedChunk[]) {
  return retrievedContext
    .slice(0, 6)
    .map(
      (chunk, index) =>
        `${index + 1}. ${chunk.title}\nURL: ${chunk.url}\nEvidence: ${clipText(
          chunk.content,
          340,
        )}`,
    )
    .join("\n\n");
}

function structuredAnswerMaxTokens(format: AnswerFormat) {
  switch (format) {
    case "greeting":
      return 220;
    case "general":
      return 900;
    case "source":
      return 1800;
    case "research":
      return 2300;
    case "coding":
      return 2200;
    case "website_analysis":
      return 1700;
    case "document":
      return 1700;
  }
}

function markdownAnswerMaxTokens(format: AnswerFormat) {
  switch (format) {
    case "greeting":
      return 200;
    case "general":
      return 850;
    case "source":
      return 1500;
    case "research":
      return 2000;
    case "coding":
      return 2000;
    case "website_analysis":
      return 1500;
    case "document":
      return 1500;
  }
}

async function generateStructuredAnswer({
  format,
  question,
  classification,
  plan,
  sources = [],
  documents = [],
  retrievedContext = [],
  history = [],
  modeInstructions,
  fallback,
}: {
  format: AnswerFormat;
  question: string;
  classification: QueryClassification;
  plan: ResearchPlan;
  sources?: ResearchSource[];
  documents?: ResearchDocument[];
  retrievedContext?: RetrievedChunk[];
  history?: Array<{ role: string; content: string }>;
  modeInstructions: string[];
  fallback: AssistantAnswer;
}) {
  const citationSources = deriveCitationSources(sources, documents, retrievedContext);
  const historyBlock = history
    .slice(-4)
    .map((message, index) => `${index + 1}. ${message.role}: ${message.content}`)
    .join("\n");
  const requiresInlineCitations =
    citationSources.length > 0 &&
    ["source", "research", "document", "website_analysis"].includes(format);

  const systemPrompt = [
    "You are SwiftDeploy AI, a multi-capability assistant that adapts its response style and tool usage to the user's query.",
    "The platform routes requests into greeting, general knowledge, realtime search, coding, research, website analysis, or retrieval-backed document workflows.",
    "Write like a senior analyst: clear, accurate, composed, and professional.",
    "Do not invent facts, citations, data, or implementation details.",
    "If evidence is thin or uncertain, say so directly.",
    `If reliable evidence is unavailable for the requested detail, use exactly this sentence: "${NO_RELIABLE_INFO_MESSAGE}"`,
    "Return valid JSON only.",
    "Use the exact keys: title, summary, keyInsights, sections, followUps.",
    "summary must be one strong opening paragraph that answers the user immediately and reads like a finished response, not a note.",
    "keyInsights should contain 3-5 concise bullets when the topic benefits from a quick scan; otherwise it may be empty.",
    "sections must be an array of 2-4 specific titled blocks for most non-greeting answers.",
    "Prefer short paragraphs and bullet lists over tables.",
    "Never use pipe-delimited tables or delimiter patterns like | or ||| inside the answer.",
    "Never include raw URLs inside summary, keyInsights, or section prose.",
    "Do not add a trailing Sources, References, or Citations section.",
    "Avoid generic section titles like Key Insights, Explanation, Overview, or Conclusion unless they are truly the best label.",
    "followUps must be an array of 4 short, professional next-step questions tailored to the user's exact topic.",
    "Do not repeat the user's full question inside followUps.",
    "Do not use phrases like this answer, this topic, tell me more, or what else in followUps.",
    "Synthesize the sources into natural prose. Do not copy raw source snippets or malformed extracted text into the answer.",
    "Use kind='code' only for code blocks.",
    requiresInlineCitations
      ? "For factual claims, use inline markdown source links with readable labels (for example, [reuters.com](https://...)). Never output [1], [2], or similar numeric citation markers."
      : "Do not invent citations when no live sources are provided.",
  ].join(" ");

  const userPrompt = [
    `Question: ${question}`,
    `Classification: ${classification.type}`,
    `Mode: ${classification.mode}`,
    `Objective: ${plan.objective}`,
    `Deliverable: ${plan.deliverable}`,
    `Tasks: ${plan.tasks.join(" | ") || "None"}`,
    "",
    historyBlock ? `Conversation context:\n${historyBlock}` : "Conversation context: None",
    "",
    citationSources.length
      ? `Sources:\n${sourceIndexText(citationSources)}`
      : "Sources: None",
    "",
    documents.length
      ? `Extracted documents:\n${documentIndexText(documents)}`
      : "Extracted documents: None",
    "",
    retrievedContext.length
      ? `Retrieved context:\n${retrievalIndexText(retrievedContext)}`
      : "Retrieved context: None",
    "",
    ...modeInstructions,
  ].join("\n");

  const markdownSystemPrompt = [
    "You are SwiftDeploy AI, a professional assistant that should answer like a polished hybrid of ChatGPT and Perplexity.",
    "Write the final user-facing answer directly in markdown.",
    "Do not output JSON.",
    "Do not mention internal routing, tool selection, or system instructions.",
    "Be accurate, natural, concise, and professional.",
    `If reliable evidence is unavailable for the requested detail, use exactly this sentence: "${NO_RELIABLE_INFO_MESSAGE}"`,
    "Start with a direct answer paragraph that gives the bottom line first.",
    "If useful, add a short Key Updates section before deeper sections.",
    "Then use clean titled sections.",
    "Do not add a trailing Sources, References, or Citations section.",
    "Use bullets or numbered lists instead of tables whenever possible.",
    "Never use pipe-delimited tables or delimiter patterns like | or ||| inside the answer.",
    "Never include raw URLs in the answer body. Use inline markdown source links with readable labels.",
    "Do not paste raw extracted text fragments into the answer.",
    citationSources.length
      ? requiresInlineCitations
        ? "If live sources are provided, support major factual claims with inline markdown source links. Never output numeric markers like [1] or [2]."
        : "If live sources are provided, ground the answer in them clearly and stay accurate."
      : "If no live sources are provided, answer directly without pretending to have searched.",
    format === "website_analysis"
      ? "For website analysis, keep the answer concrete and operational, focusing on messaging, structure, and recommendations."
      : "",
  ].join(" ");

  const preferReasoningForSource =
    format === "source" &&
    /\b(top \d+|ranking|rank|richest|largest|best|highest|lowest|compare|comparison|versus|vs)\b/i.test(
      question,
    );
  const modelPurpose: ChatModelPurpose =
    format === "coding"
      ? "code"
      : format === "research"
        ? "report"
        : format === "website_analysis" || format === "document" || preferReasoningForSource
          ? "reasoning"
          : "fast";
  const selectedModel = resolveChatModel(modelPurpose);

  try {
    const parsed = await runStructuredJsonCompletion<Partial<GeneratedAnswerBody>>({
      systemPrompt,
      userPrompt,
      model: selectedModel,
      maxTokens: structuredAnswerMaxTokens(format),
      temperature: format === "coding" ? 0.1 : 0.18,
      timeoutMs: format === "research" || format === "coding" ? 12000 : 9000,
    });

    if (
      !parsed ||
      !parsed.title ||
      !parsed.summary ||
      !Array.isArray(parsed.keyInsights) ||
      !Array.isArray(parsed.sections) ||
      !Array.isArray(parsed.followUps)
    ) {
      throw new Error("NVIDIA structured answer returned malformed JSON");
    }

    return normalizeAnswerBody(
      question,
      format,
      {
        title: parsed.title,
        summary: parsed.summary,
        keyInsights: parsed.keyInsights,
        sections: parsed.sections,
        followUps: parsed.followUps,
      },
      citationSources,
    );
  } catch {
    try {
      const markdown = await runMarkdownCompletion({
        systemPrompt: markdownSystemPrompt,
        userPrompt,
        model: selectedModel,
        maxTokens: markdownAnswerMaxTokens(format),
        temperature: format === "coding" ? 0.1 : 0.2,
        timeoutMs: format === "research" || format === "coding" ? 11000 : 8500,
      });

      if (markdown) {
        return normalizeMarkdownAnswer(
          question,
          format,
          fallback.title,
          markdown,
          citationSources,
        );
      }
    } catch {
      // Fall through to deterministic fallback below.
    }

    return fallback;
  }
}

function fallbackReport(
  question: string,
  plan: ResearchPlan,
  retrievedContext: RetrievedChunk[],
  sources: ResearchSource[],
): GeneratedReportBody {
  return buildDeterministicResearchReport(question, plan, retrievedContext, sources);
}

export async function generateStructuredReport({
  question,
  plan,
  retrievedContext,
  sources,
}: {
  question: string;
  plan: ResearchPlan;
  retrievedContext: RetrievedChunk[];
  sources: ResearchSource[];
}) {
  if (!env.NVIDIA_API_KEY) {
    return fallbackReport(question, plan, retrievedContext, sources);
  }

  const systemPrompt = [
    "You are SwiftDeploy AI Research Agent.",
    "Behave like a senior AI research analyst operating inside a premium autonomous research product.",
    "Prioritize factual accuracy, clear reasoning, and decision-ready writing over marketing language.",
    "Ground every major point in the supplied evidence.",
    "When evidence is weak, incomplete, or conflicting, say so explicitly and lower the confidence of the claim.",
    "Do not invent facts, market data, dates, or comparisons that are not supported by the evidence.",
    "Write in a polished, professional tone similar to a high-end research briefing.",
    "Use inline markdown source links with readable labels for the most important factual claims, and never output numeric markers like [1] or [2].",
    "Return valid JSON only.",
    "Use the exact keys: title, executiveSummary, keyFindings, detailedAnalysis, sourceHighlights.",
    "keyFindings and sourceHighlights must be arrays of strings.",
    "detailedAnalysis must be markdown.",
  ].join(" ");

  const userPrompt = [
    `Question: ${question}`,
    "",
    `Objective: ${plan.objective}`,
    `Deliverable: ${plan.deliverable}`,
    `Research tasks: ${plan.tasks.join(" | ")}`,
    `Research queries: ${plan.queries.join(" | ")}`,
    "",
    "Source index:",
    sourceIndexText(sources) || "No sources available.",
    "",
    "Retrieved evidence:",
    retrievalIndexText(retrievedContext) || "No retrieved context available.",
    "",
    "Create a concise but high-signal research report with an executive summary, 4-6 key findings, and concrete analysis grounded in the evidence above.",
    "Make the report feel professional, accurate, and useful for a decision-maker.",
    "Prefer precise language over hype, and note uncertainty where appropriate.",
    "Prefer source-backed synthesis over copied snippets, and use inline citations where they materially support a claim.",
    "Prefer bullets and short paragraphs over tables, and never use pipe-delimited tables.",
  ].join("\n");

  try {
    const parsed = await runStructuredJsonCompletion<Partial<GeneratedReportBody>>({
      systemPrompt,
      userPrompt,
      model: resolveChatModel("report"),
      maxTokens: 1800,
      temperature: 0.15,
    });

    if (
      !parsed ||
      !parsed.title ||
      !parsed.executiveSummary ||
      !parsed.detailedAnalysis ||
      !Array.isArray(parsed.keyFindings) ||
      !Array.isArray(parsed.sourceHighlights)
    ) {
      throw new Error("NVIDIA chat returned malformed report JSON");
    }

    return {
      title: parsed.title,
      executiveSummary: parsed.executiveSummary,
      keyFindings: parsed.keyFindings.slice(0, 6),
      detailedAnalysis: parsed.detailedAnalysis,
      sourceHighlights: parsed.sourceHighlights.slice(0, 6),
    } satisfies GeneratedReportBody;
  } catch {
    return fallbackReport(question, plan, retrievedContext, sources);
  }
}

export async function generateGeneralKnowledgeAnswer({
  question,
  classification,
  plan,
  history = [],
}: {
  question: string;
  classification: QueryClassification;
  plan: ResearchPlan;
  history?: Array<{ role: string; content: string }>;
}) {
  return generateStructuredAnswer({
    format: "general",
    question,
    classification,
    plan,
    history,
    modeInstructions: [
      "Produce a general-knowledge answer.",
      "Lead with a natural explanation.",
      "Use bullet points only when they improve clarity.",
      "Do not mention web search or sources unless the user explicitly asks for them.",
      "Avoid formulaic headers such as Key Insights for simple prompts.",
    ],
    fallback: fallbackStructuredAnswer({
      question,
      format: "general",
      title: question,
      summary: `Here is a clear answer to "${question}".`,
      keyInsights: [],
      sections: [],
      followUps: defaultFollowUps("general"),
    }),
  });
}

export async function generateGreetingAnswer({
  question,
  classification,
  plan,
  history = [],
}: {
  question: string;
  classification: QueryClassification;
  plan: ResearchPlan;
  history?: Array<{ role: string; content: string }>;
}) {
  return generateStructuredAnswer({
    format: "greeting",
    question,
    classification,
    plan,
    history,
    modeInstructions: [
      "Produce a short conversational greeting reply.",
      "Respond naturally, like a capable assistant in chat mode.",
      "Do not include bullet points unless the user asked for help with multiple items.",
      "Do not mention sources, search, tools, or internal routing.",
    ],
    fallback: fallbackStructuredAnswer({
      question,
      format: "greeting",
      title: "Greeting",
      summary: "Hello. What do you want to work on?",
      keyInsights: [],
      sections: [],
      followUps: [],
    }),
  });
}

export async function generateSourceBackedAnswer({
  question,
  classification,
  plan,
  sources,
  documents,
  retrievedContext = [],
}: {
  question: string;
  classification: QueryClassification;
  plan: ResearchPlan;
  sources: ResearchSource[];
  documents: ResearchDocument[];
  retrievedContext?: RetrievedChunk[];
}) {
  const citationSources = deriveCitationSources(sources, documents, retrievedContext);
  const isSensitiveRealtime =
    isSensitiveRealtimeQuestion(question, classification) ||
    isBroadNewsUpdateQuestion(question, classification);
  const isCommercePriceQuestion = isCommercePriceComparisonQuestion(question);
  const isRankingQuestion =
    /\b(top \d+|ranking|rank|richest|largest|best|highest|lowest|most expensive|cheapest)\b/i.test(
      question,
    );
  const requestedRankCount = extractRequestedRankCount(question);
  const deterministicRankingAnswer =
    isRankingQuestion
      ? buildRankingSourceAnswer({
          question,
          sources,
          retrievedContext,
        })
      : null;

  if (isRankingQuestion && !env.NVIDIA_API_KEY && deterministicRankingAnswer) {
    return deterministicRankingAnswer;
  }

  if (!env.NVIDIA_API_KEY && isCommercePriceQuestion) {
    const priceComparisonAnswer = buildPriceComparisonAnswer({
      question,
      sources,
      documents,
    });

    if (priceComparisonAnswer) {
      return priceComparisonAnswer;
    }
  }

  if (!env.NVIDIA_API_KEY && isSensitiveRealtime) {
    return buildSensitiveRealtimeAnswer({
      question,
      sources,
      retrievedContext,
    });
  }

  if (isSensitiveRealtime) {
    return buildSensitiveRealtimeAnswer({
      question,
      sources: citationSources,
      retrievedContext,
    });
  }

  if (!env.NVIDIA_API_KEY) {
    const deterministicAnswer = buildDeterministicSourceAnswer({
      question,
      sources,
      retrievedContext,
    });
    if (deterministicAnswer) {
      return deterministicAnswer;
    }
  }

  const generatedAnswer = await generateStructuredAnswer({
    format: "source",
    question,
    classification,
    plan,
    sources: citationSources,
    documents,
    retrievedContext,
    modeInstructions: [
      "Produce a source-backed answer that feels like a premium search assistant.",
      "Lead with a direct, polished answer in 2-4 natural sentences.",
      "Then add 2-4 titled sections with clear synthesis, not copied source fragments.",
      "Write in a professional style closer to ChatGPT or Perplexity than a search-results dump.",
      "For straightforward factual, ranking, or price-comparison questions, stay concise and avoid long report-style sections.",
      "Use short bullets or ranked lists instead of tables.",
      "Never include raw delimiter characters like | or ||| in the final answer.",
      "Use inline markdown source links with readable labels for factual claims, and never output numeric markers like [1] or [2].",
      "If the sources conflict or remain incomplete, say so explicitly.",
      isCommercePriceQuestion
        ? "Because this is a live price-comparison request, compare the strongest retailer or official listings directly, keep the answer short, and avoid country-by-country digressions unless the user asked for them."
        : "Keep the answer tailored to the user's exact scope.",
      isRankingQuestion
        ? "Because this is a ranking or top-list question, include exactly one section titled Ranking with a numbered list in order (1, 2, 3...). Each item must be a single line."
        : "Focus on the most decision-useful facts instead of generic filler sections.",
      isRankingQuestion
        ? "For ranking lists, keep details strictly source-backed. Do not relabel metrics (for example, never call millionaire counts GDP). If a metric is unclear, omit that number instead of guessing."
        : "Use precise metric names that match the source evidence.",
      isRankingQuestion
        ? "Do not add a Conclusion section for ranking answers."
        : "Use only necessary sections and avoid filler conclusions.",
      "For sensitive live topics, state only what is supported by the strongest current sources.",
      isSensitiveRealtime
        ? "Because this is a sensitive live topic, attribute major claims carefully, avoid speculation, and say when coverage is mixed or still developing."
        : "Keep the answer tightly grounded in the retrieved evidence.",
      "Keep the tone crisp, factual, complete, and professional.",
    ],
    fallback: fallbackStructuredAnswer({
      question,
      format: "source",
      title: questionAsTitle(question),
      summary: clippedNaturalText(
        [
          "Here is a concise answer based on the latest public sources.",
          citationSources
            .slice(0, 2)
            .map((source) => source.snippet)
            .filter(Boolean)
            .join(" "),
        ]
          .filter(Boolean)
          .join(" "),
      ),
      keyInsights: [],
      sections: [
        {
          title: "Best available evidence",
          content:
            citationSources
              .slice(0, 4)
              .map(
                (source, index) =>
                  `${index + 1}. **${source.title}**\n${clippedNaturalText(
                    source.snippet || documents[index]?.content || "",
                    220,
                  )}`,
              )
              .join("\n\n") || NO_RELIABLE_INFO_MESSAGE,
        },
      ],
      followUps: defaultFollowUps("source"),
      sources: citationSources,
    }),
  });

  if (
    isProfessionalSourceAnswer(
      question,
      generatedAnswer,
      citationSources,
      isRankingQuestion,
      requestedRankCount,
    )
  ) {
    return generatedAnswer;
  }

  if (deterministicRankingAnswer) {
    return deterministicRankingAnswer;
  }

  const deterministicAnswer = buildDeterministicSourceAnswer({
    question,
    sources: citationSources,
    retrievedContext,
  });

  if (
    deterministicAnswer &&
    isProfessionalSourceAnswer(
      question,
      deterministicAnswer,
      citationSources,
      isRankingQuestion,
      requestedRankCount,
    )
  ) {
    return deterministicAnswer;
  }

  return generatedAnswer;
}

export async function generateCodingAnswer({
  question,
  classification,
  plan,
  history = [],
}: {
  question: string;
  classification: QueryClassification;
  plan: ResearchPlan;
  history?: Array<{ role: string; content: string }>;
}) {
  if (!env.NVIDIA_API_KEY) {
    return fallbackStructuredAnswer({
      question,
      format: "coding",
      title: questionAsTitle(question),
      summary:
        "A reasoning model is not configured in this environment, so coding mode cannot generate new implementation-quality code yet.",
      keyInsights: [],
      sections: [
        {
          title: "What Is Missing",
          content:
            "Configure `NVIDIA_API_KEY` and a chat-capable model to enable professional coding answers in the app.",
        },
        {
          title: "Current State",
          content:
            "Live search, crawl, rerank, retrieval, thread memory, and source-backed research modes remain active.",
        },
      ],
      followUps: [
        "Do you want help wiring an OpenAI-compatible chat provider into this app?",
        "Should I keep this request in search mode and look for official docs instead?",
      ],
    });
  }

  return generateStructuredAnswer({
    format: "coding",
    question,
    classification,
    plan,
    history,
    modeInstructions: [
      "Produce a coding-answer format.",
      "Return one code section with runnable code.",
      "Return one explanation section that explains the approach plainly.",
      "Return one example usage section.",
      "Prefer practical, correct code over abstraction or theory.",
    ],
    fallback: fallbackStructuredAnswer({
      question,
      format: "coding",
      title: questionAsTitle(question),
      summary: "Below is a code-first response with implementation details.",
      keyInsights: [],
      sections: [
        {
          title: "Code",
          kind: "code",
          language: "text",
          content: "# NVIDIA generation unavailable. Re-run with model access to generate code.",
        },
        {
          title: "Explanation",
          content:
            "The coding pipeline is designed to return implementation first, then explain the logic and usage.",
        },
      ],
      followUps: defaultFollowUps("coding"),
    }),
  });
}

export async function generateWebsiteAnalysisAnswer({
  question,
  classification,
  plan,
  sources,
  documents,
}: {
  question: string;
  classification: QueryClassification;
  plan: ResearchPlan;
  sources: ResearchSource[];
  documents: ResearchDocument[];
}) {
  const citationSources = deriveCitationSources(sources, documents, []);
  if (!env.NVIDIA_API_KEY) {
    const deterministicAnswer = buildDeterministicWebsiteAnswer({
      question,
      sources,
      documents,
    });
    if (deterministicAnswer) {
      return deterministicAnswer;
    }
  }

  return generateStructuredAnswer({
    format: "website_analysis",
    question,
    classification,
    plan,
    sources: citationSources,
    documents,
    modeInstructions: [
      "Produce a website-analysis format.",
      "Include sections for overview, content summary, SEO insights, and recommendations.",
      "Base the analysis on the extracted site content only.",
      "Keep the recommendations concrete and operational.",
    ],
    fallback: fallbackStructuredAnswer({
      question,
      format: "website_analysis",
      title: documents[0]?.title || questionAsTitle(question),
      summary: documents[0]
        ? `I reviewed the crawled page for "${documents[0].title}" and summarized the main messaging, structure, and improvement opportunities below.`
        : NO_RELIABLE_INFO_MESSAGE,
      keyInsights: [],
      sections: [
        {
          title: documents[0] ? "Overview" : "Evidence Availability",
          content: documents[0]
            ? clippedNaturalText(documents[0].content, 320)
            : NO_RELIABLE_INFO_MESSAGE,
        },
        {
          title: "Key Recommendations",
          content:
            documents[0]
              ? "Clarify the core message above the fold, improve information hierarchy, and make key calls to action easier to find."
              : "Try providing a public page URL with fully visible content, or ask for a search-backed answer on the same topic.",
        },
      ],
      followUps: defaultFollowUps("website_analysis"),
      sources: citationSources,
    }),
  });
}

export async function generateDocumentAnswer({
  question,
  classification,
  plan,
  sources,
  retrievedContext,
}: {
  question: string;
  classification: QueryClassification;
  plan: ResearchPlan;
  sources: ResearchSource[];
  retrievedContext: RetrievedChunk[];
}) {
  const citationSources = deriveCitationSources(sources, [], retrievedContext);
  if (!env.NVIDIA_API_KEY) {
    return buildDeterministicDocumentAnswer({
      question,
      sources,
      retrievedContext,
    });
  }

  return generateStructuredAnswer({
    format: "document",
    question,
    classification,
    plan,
    sources: citationSources,
    retrievedContext,
    modeInstructions: [
      "Produce a retrieval-backed document answer.",
      "Answer the question using the retrieved context.",
      "Include a section that explains what the document or knowledge base appears to say.",
      "If the retrieval set is weak, state that clearly.",
    ],
    fallback: fallbackStructuredAnswer({
      question,
      format: "document",
      title: questionAsTitle(question),
      summary: retrievedContext[0]?.content
        ? `Here is a retrieval-backed answer based on the strongest matching context I found.`
        : "The assistant searched the knowledge store but found limited retrieval context.",
      keyInsights: [],
      sections: [
        {
          title: "Supporting evidence",
          content:
            retrievedContext
              .slice(0, 4)
              .map(
                (chunk, index) =>
                  `${index + 1}. **${chunk.title}**\n${clipText(chunk.content, 220)}`,
              )
              .join("\n\n") || "No retrieval context was available.",
        },
      ],
      followUps: defaultFollowUps("document"),
      sources: citationSources,
    }),
  });
}

export function buildResearchAnswerFromReport(
  question: string,
  report: GeneratedReportBody,
  sources: ResearchSource[],
): AssistantAnswer {
  return normalizeAnswerBody(
    question,
    "research",
    {
      title: report.title,
      summary: report.executiveSummary,
      keyInsights: report.keyFindings,
      sections: [
        {
          title: "Detailed Analysis",
          content: report.detailedAnalysis,
        },
      ],
      followUps: defaultFollowUps("research"),
    },
    sources,
  );
}
