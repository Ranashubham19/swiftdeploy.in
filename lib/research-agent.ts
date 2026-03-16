import type {
  AssistantAnswer,
  QueryClassification,
  QueryType,
  ResearchDocument,
  SearchDiagnostics,
  SearchProvider,
  SearchProviderQueryDiagnostic,
  SearchProviderSummaryDiagnostic,
  ResearchPlan,
  ResearchProgressStep,
  ResearchRequestBody,
  ResearchRunResult,
  ResearchSource,
} from "@/lib/types";

import { rewriteQuestionWithMemory } from "@/lib/conversation-memory";
import { extractWebsiteContent } from "@/lib/crawl";
import { embedTexts } from "@/lib/embeddings";
import { env, getProviderSnapshot } from "@/lib/env";
import { startTrace } from "@/lib/langsmith";
import {
  buildResearchAnswerFromReport,
  generateCodingAnswer,
  generateDocumentAnswer,
  generateGreetingAnswer,
  generateGeneralKnowledgeAnswer,
  generateSourceBackedAnswer,
  generateStructuredReport,
  generateWebsiteAnalysisAnswer,
} from "@/lib/nvidia";
import { rerankChunks, rerankDocuments, rerankSources } from "@/lib/rerank";
import { searchInternetWithDiagnostics } from "@/lib/search";
import { persistResearchRun } from "@/lib/supabase";
import {
  chunkText,
  clipText,
  cosineSimilarity,
  domainFromUrl,
  extractUrls,
  normalizeUrlCandidate,
  stableId,
  uniqueBy,
} from "@/lib/utils";
import {
  retrieveResearchContext,
  storeResearchEmbeddings,
} from "@/lib/vector-store";

type ResearchCallbacks = {
  onProgress?: (step: ResearchProgressStep) => void;
  onSources?: (sources: ResearchSource[]) => void;
};

type IndexedChunk = {
  question: string;
  title: string;
  url: string;
  content: string;
  sourceProvider: string;
  domain: string;
  chunkIndex: number;
  vector: number[];
};

const TRUSTED_SOURCE_PATTERNS = [
  /\.gov$/i,
  /\.edu$/i,
  /reuters\.com$/i,
  /apnews\.com$/i,
  /bbc\.com$/i,
  /bloomberg\.com$/i,
  /cnn\.com$/i,
  /forbes\.com$/i,
  /ft\.com$/i,
  /nbcnews\.com$/i,
  /wsj\.com$/i,
  /cnbc\.com$/i,
  /nytimes\.com$/i,
  /aljazeera\.com$/i,
  /theguardian\.com$/i,
  /apple\.com$/i,
  /openai\.com$/i,
  /github\.com$/i,
  /developer\./i,
  /docs\./i,
];

const LOW_CONFIDENCE_SOURCE_PATTERNS = [
  /reddit\.com$/i,
  /quora\.com$/i,
  /youtube\.com$/i,
  /tiktok\.com$/i,
  /instagram\.com$/i,
  /facebook\.com$/i,
  /pinterest\.com$/i,
];

const COMMERCE_RETAILER_SOURCE_PATTERNS = [
  /samsung\.com$/i,
  /apple\.com$/i,
  /amazon\./i,
  /bestbuy\.com$/i,
  /walmart\.com$/i,
  /target\.com$/i,
  /flipkart\.com$/i,
  /croma\.com$/i,
  /reliancedigital\.in$/i,
  /att\.com$/i,
  /verizon\.com$/i,
  /t-mobile\.com$/i,
  /smartprix\.com$/i,
  /pricehistoryapp\.com$/i,
  /phonearena\.com$/i,
];

const LOW_AUTHORITY_RANKING_SOURCE_PATTERNS = [
  /fandom\.com$/i,
  /harrypotter\.com$/i,
  /unbelievable-facts\.com$/i,
  /blogspot\./i,
  /wordpress\./i,
  /pinterest\.com$/i,
  /facebook\.com$/i,
  /tiktok\.com$/i,
  /quora\.com$/i,
];

const TOPIC_RELEVANCE_STOP_WORDS = new Set([
  "a",
  "about",
  "all",
  "and",
  "are",
  "as",
  "at",
  "best",
  "by",
  "current",
  "for",
  "from",
  "how",
  "in",
  "is",
  "latest",
  "list",
  "most",
  "of",
  "on",
  "the",
  "this",
  "today",
  "top",
  "update",
  "what",
  "when",
  "where",
  "which",
  "who",
  "with",
  "world",
]);

function isSensitiveRealtimeQuery(question: string) {
  return /\b(war|conflict|attack|missile|nuclear|strike|ceasefire|military|protest|riot|election|hostage|earthquake|outbreak|sanction)\b/i.test(
    question,
  );
}

function isBroadRealtimeUpdateQuery(question: string) {
  return (
    /\b(latest|today|current|news|update|updates|right now|happening|status|situation|live)\b/i.test(
      question,
    ) &&
    !/\b(price|prices|stock|stocks|weather|forecast|score|scores|traffic|lpg|cylinder|deal|deals|buy|purchase|gdp|inflation|election|war|conflict|attack|earthquake|outbreak)\b/i.test(
      question,
    )
  );
}

function isCommercePriceComparisonQuery(question: string) {
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

function isRankingSearchQuestion(question: string) {
  return /\b(top \d+|ranking|rank|richest|largest|best|highest|lowest|most expensive|cheapest)\b/i.test(
    question,
  );
}

function shouldUseFastSearchPipeline(
  question: string,
  classification: QueryClassification,
) {
  if (classification.mode !== "search") {
    return false;
  }

  if (
    isCommercePriceComparisonQuery(question) ||
    isSensitiveRealtimeQuery(question) ||
    isRankingSearchQuestion(question)
  ) {
    return false;
  }

  return true;
}

function shouldUseFastResearchPipeline(sources: ResearchSource[]) {
  if (sources.length < 2) {
    return false;
  }

  const usableSnippetCount = sources.filter((source) => source.snippet.trim().length >= 120).length;
  return usableSnippetCount >= Math.min(3, sources.length);
}

function normalizeCommerceSearchTopic(question: string) {
  let topic = question
    .replace(
      /\b(compare|comparison|compare the prices of|price of|prices of|in different websites|different websites|different sites|different stores|website|websites|store|stores|retailer|retailers|where to buy|best place to buy|best price|lowest price|cheapest)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  topic = topic.replace(/\bs25 ultra\b/i, "Samsung Galaxy S25 Ultra");

  return topic || question;
}

function isPhonePriceQuery(question: string) {
  return /\b(galaxy|iphone|pixel|phone|smartphone|ultra|pro max|fold|flip)\b/i.test(question);
}

function isTrustedSource(source: ResearchSource) {
  return TRUSTED_SOURCE_PATTERNS.some((pattern) => pattern.test(source.domain));
}

function isLowConfidenceSource(source: ResearchSource) {
  return LOW_CONFIDENCE_SOURCE_PATTERNS.some((pattern) => pattern.test(source.domain));
}

function classifyQuery(question: string): QueryClassification {
  const normalized = question.trim();
  const lower = normalized.toLowerCase();
  const normalizedGreeting = lower.replace(/([a-z])\1{1,}/g, "$1");
  const urls = extractUrls(normalized);
  const hasPdfUrl = urls.some((url) => /\.pdf($|[?#])/i.test(url));
  const looksLikeLiveIncident =
    /\b(scene|status|situation|update|updates|latest|happening|ongoing|breaking)\b/i.test(
      normalized,
    ) &&
    /\b(case|incident|murder|attack|riot|protest|crash|stabbing|shooting|war|conflict|arrest|investigation)\b/i.test(
      normalized,
    );
  const shortNamedIncident =
    normalized.split(/\s+/).length <= 10 &&
    /\b(case|incident|murder|attack|riot|protest|war|conflict)\b/i.test(normalized);
  const isGreeting =
    normalized.length <= 80 &&
    [
      lower,
      normalizedGreeting,
    ].some((candidate) =>
      /^(hi|hello|hey|yo|good (morning|afternoon|evening)|how are you|thanks|thank you|sup|what's up)\b[!.? ]*$/i.test(
        candidate,
      ),
    );
  const wantsDocumentRetrieval =
    hasPdfUrl ||
    /\b(pdf|document|whitepaper|manual|paper|knowledge base|knowledgebase|docs|documentation|transcript|ebook|file)\b/i.test(
      normalized,
    );

  const scores: Record<QueryType, number> = {
    greeting: 0,
    general_knowledge: 0,
    realtime_search: 0,
    comparison: 0,
    coding: 0,
    research: 0,
    website_analysis: 0,
  };

  if (isGreeting) {
    return {
      type: "greeting",
      mode: "chat",
      reasoning:
        "The prompt is conversational and should be answered naturally without tools or rigid structure.",
      confidence: "high",
    };
  }

  if (
    /\b(code|coding|python|javascript|typescript|java|c\+\+|c#|react|next\.?js|sql|regex|debug|bug|function|class|script|algorithm|binary search|api endpoint|refactor|implement)\b/i.test(
      normalized,
    )
  ) {
    scores.coding += 7;
  }

  if (
    /\b(latest|today|current|recent|news|live|updated|update|updates|price|stock|funding round|just announced|score|weather|forecast|traffic|ceo|president|prime minister|as of|this week|right now|happening|ongoing|breaking|war|conflict|ceasefire|attack|election|202[5-9])\b/i.test(
      normalized,
    )
  ) {
    scores.realtime_search += 5;
  }

  if (
    /^(tell me|give me|what'?s|what is|show me).*\b(update|latest|news|happening|situation)\b/i.test(
      normalized,
    )
  ) {
    scores.realtime_search += 3;
  }

  if (looksLikeLiveIncident) {
    scores.realtime_search += 4;
  }

  if (shortNamedIncident) {
    scores.realtime_search += 2;
  }

  if (
    /\b(compare|comparison|versus|vs|research|analyze|analysis|deep dive|market|industry|landscape|competitive|competitor|strategy|growth|trend|report|brief|due diligence|benchmark)\b/i.test(
      normalized,
    )
  ) {
    scores.research += 5;
  }

  if (/\b(compare|comparison|versus|vs|difference|differences|better than)\b/i.test(normalized)) {
    scores.comparison += 6;
  }

  if (
    /\b(website|site|homepage|landing page|seo|audit|analyze this website|analyze website|review website)\b/i.test(
      normalized,
    )
  ) {
    scores.website_analysis += 6;
  }

  if (urls.length > 0 && !hasPdfUrl) {
    scores.website_analysis += 4;
  }

  if (lower.startsWith("what is") || lower.startsWith("explain ")) {
    scores.general_knowledge += 3;
  }

  if (normalized.length > 110) {
    scores.research += 1;
  }

  if (
    /\b(compare|versus|vs)\b/i.test(normalized) &&
    /\b(market|company|industry|country|sector|growth|startup|product)\b/i.test(
      normalized,
    )
  ) {
    scores.research += 2;
  }

  if (scores.coding >= 7) {
    return {
      type: "coding",
      mode: "code",
      reasoning: "Programming keywords indicate the user wants implementation help.",
      confidence: "high",
    };
  }

  if (wantsDocumentRetrieval) {
    return {
      type: scores.research >= 5 ? "research" : "general_knowledge",
      mode: "document",
      reasoning:
        "The prompt references a document or knowledge source, so retrieval-backed answering is the best fit.",
      confidence: "high",
    };
  }

  if (isCommercePriceComparisonQuery(normalized)) {
    return {
      type: "comparison",
      mode: "search",
      reasoning:
        "The prompt asks for a live retailer-by-retailer price comparison, so source-backed search is a better fit than a long research report.",
      confidence: "high",
    };
  }

  const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1]);
  const top = ranked[0] as [QueryType, number];
  const next = ranked[1]?.[1] ?? 0;

  if (top[1] <= 0) {
    return {
      type: "realtime_search",
      mode: "search",
      reasoning:
        "Non-greeting prompts default to live search so the answer stays current and source-backed.",
      confidence: "medium",
    };
  }

  const selectedType =
    top[0] === "general_knowledge" ? "realtime_search" : top[0];
  const modeByType: Record<QueryType, QueryClassification["mode"]> = {
    greeting: "chat",
    general_knowledge: "chat",
    realtime_search: "search",
    comparison: "research",
    coding: "code",
    research: "research",
    website_analysis: "website",
  };

  const reasonByType: Record<QueryType, string> = {
    greeting:
      "The prompt is conversational and should be answered directly in a natural tone.",
    general_knowledge:
      "The question looks conceptual and can be answered with reasoning-first generation.",
    realtime_search:
      "The wording suggests current or changing information, so live web search is appropriate.",
    comparison:
      "The prompt asks for a side-by-side evaluation, so multi-source comparison research is appropriate.",
    coding:
      "The request is code-oriented and should be handled as a developer-assistant task.",
    research:
      "The prompt asks for comparison, analysis, or strategic synthesis across multiple signals.",
    website_analysis:
      "The prompt references a website or URL and calls for page-level analysis.",
  };

  return {
    type: selectedType,
    mode: modeByType[selectedType],
    reasoning: reasonByType[selectedType],
    confidence: top[1] - next >= 2 ? "high" : "medium",
  };
}

function buildSearchQueries(question: string, classification: QueryClassification) {
  const lower = question.toLowerCase();
  const commerceTopic = normalizeCommerceSearchTopic(question);
  const currentYear = new Date().getFullYear();
  const queries = new Set<string>([question]);

  if (isCommercePriceComparisonQuery(question)) {
    queries.add(`${commerceTopic} official price`);
    if (/\b(india|inr|₹|rs\.?)\b/i.test(question)) {
      queries.add(`${commerceTopic} Amazon price`);
      queries.add(`${commerceTopic} Flipkart price`);
      queries.add(`${commerceTopic} Smartprix price`);
    } else if (isPhonePriceQuery(question)) {
      queries.add(`${commerceTopic} Amazon price`);
      queries.add(`${commerceTopic} AT&T retail price`);
      queries.add(`${commerceTopic} Best Buy price`);
    } else {
      queries.add(`${commerceTopic} Amazon price`);
      queries.add(`${commerceTopic} Walmart price`);
      queries.add(`${commerceTopic} retailer price comparison`);
    }

    return [...queries]
      .map((query) => query.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 5);
  }

  if (
    /\b(price|prices|buy|buying|cheapest|cheaper|cost|deal|deals|discount|trade[- ]?in|carrier)\b/i.test(
      lower,
    )
  ) {
    queries.add(`${question} price comparison`);
    queries.add(`cheapest ${question.replace(/\b(best place to buy|where is|where can i buy)\b/gi, "").trim()}`.trim());
    queries.add(`${question} by country`);
  }

  if (
    /\b(compare|comparison|versus|vs|difference|differences|better than)\b/i.test(lower)
  ) {
    queries.add(`${question} comparison`);
    queries.add(`${question} differences`);
    queries.add(`${question} pros cons`);
  }

  if (
    /\b(scene|status|situation|update|updates|latest|news|happening|incident|case|war|conflict|attack|protest|election|today|current|recent|live)\b/i.test(
      lower,
    )
  ) {
    queries.add(`${question} latest update`);
    queries.add(`${question} official statement`);
    queries.add(`${question} live updates`);
  }

  if (isBroadRealtimeUpdateQuery(question)) {
    queries.add(`India latest developments ${currentYear} Reuters`);
    queries.add(`India latest developments ${currentYear} AP News`);
    queries.add(`India latest developments ${currentYear} BBC`);
  }

  if (isSensitiveRealtimeQuery(question)) {
    queries.add(`${question} Reuters`);
    queries.add(`${question} AP official`);
  }

  if (
    /\b(richest|top \d+|ranking|rank|list|net worth|billionaire|largest|best|highest|lowest)\b/i.test(
      question,
    )
  ) {
    queries.add(`${question} latest`);
    queries.add(`${question} ranking`);
    queries.add(`${question} official data`);
  }

  if (classification.mode === "research" || classification.type === "research") {
    queries.add(`${question} analysis`);
    queries.add(`${question} report`);
    queries.add(`${question} official data`);
  }

  if (/^(who is|what is|which|when|where|how many|tell me about)\b/i.test(lower)) {
    queries.add(`${question} official source`);
    queries.add(`${question} facts`);
  }

  queries.add(`${question} latest`);

  return [...queries]
    .map((query) => query.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 5);
}

function summarizeProviderQueries(
  providerQueries: SearchProviderQueryDiagnostic[],
): SearchProviderSummaryDiagnostic[] {
  const providers: SearchProvider[] = ["tavily", "serpapi", "jina"];

  return providers.map((provider) => {
    const providerDiagnostics = providerQueries.filter(
      (diagnostic) => diagnostic.provider === provider,
    );
    const attempted = providerDiagnostics.filter(
      (diagnostic) => diagnostic.attempted,
    );
    const successful = attempted.filter((diagnostic) => diagnostic.ok);
    const failed = attempted.filter((diagnostic) => !diagnostic.ok);
    const durations = attempted.map((diagnostic) => diagnostic.durationMs);
    const totalDuration = durations.reduce((sum, duration) => sum + duration, 0);

    return {
      provider,
      attemptedQueries: attempted.length,
      successfulQueries: successful.length,
      failedQueries: failed.length,
      totalResults: providerDiagnostics.reduce(
        (sum, diagnostic) => sum + diagnostic.resultCount,
        0,
      ),
      averageDurationMs: attempted.length
        ? Math.round(totalDuration / attempted.length)
        : 0,
      maxDurationMs: durations.length ? Math.max(...durations) : 0,
      lastError: failed.at(-1)?.error,
    } satisfies SearchProviderSummaryDiagnostic;
  });
}

function formatProviderSummaryForProgress(diagnostics: SearchDiagnostics) {
  return diagnostics.providerSummary
    .map((summary) => {
      if (!summary.attemptedQueries) {
        return `${summary.provider}: disabled`;
      }

      const latencyLabel =
        summary.averageDurationMs > 0 ? `${summary.averageDurationMs}ms avg` : "no latency data";
      const failureLabel =
        summary.failedQueries > 0
          ? `, ${summary.failedQueries} failed`
          : "";
      return `${summary.provider}: ${summary.successfulQueries}/${summary.attemptedQueries} ok, ${summary.totalResults} hits, ${latencyLabel}${failureLabel}`;
    })
    .join(" | ");
}

function shouldRetryLowCoverageSearch(
  mode: "search" | "research",
  sourceCount: number,
  diagnostics: SearchDiagnostics,
) {
  const minimumByMode = mode === "research" ? 6 : 4;
  const activeProviders = diagnostics.providerSummary.filter(
    (summary) => summary.successfulQueries > 0,
  ).length;

  return sourceCount < minimumByMode || activeProviders < 2;
}

function buildLowCoverageRetryQueries(
  question: string,
  classification: QueryClassification,
  attemptedQueries: string[],
) {
  const attempted = new Set(
    attemptedQueries.map((query) => query.replace(/\s+/g, " ").trim().toLowerCase()),
  );
  const year = new Date().getFullYear();
  const base = question
    .replace(/\b(latest|today|current|right now|live)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const candidates = new Set<string>([
    `${base} ${year} official source`,
    `${base} ${year} Reuters`,
    `${base} ${year} AP News`,
    `${base} facts and figures`,
  ]);

  if (isRankingSearchQuestion(question)) {
    candidates.add(`${base} ranking methodology ${year}`);
    candidates.add(`${base} wealth report ${year}`);
    candidates.add(`${base} millionaire count ranking ${year}`);
  }

  if (isSensitiveRealtimeQuery(question) || isBroadRealtimeUpdateQuery(question)) {
    candidates.add(`${base} official statement ${year}`);
    candidates.add(`${base} verified update ${year}`);
  }

  if (classification.mode === "research") {
    candidates.add(`${base} market report ${year}`);
    candidates.add(`${base} official dataset`);
  }

  if (isCommercePriceComparisonQuery(question)) {
    candidates.add(`${base} official store price`);
    candidates.add(`${base} retailer comparison ${year}`);
  }

  return [...candidates]
    .map((query) => query.replace(/\s+/g, " ").trim())
    .filter((query) => query && !attempted.has(query.toLowerCase()))
    .slice(0, 4);
}

function mergeSearchDiagnostics(
  base: SearchDiagnostics,
  retry: SearchDiagnostics,
  mergedSourceCount: number,
  retryQueries: string[],
  retryReason: string,
): SearchDiagnostics {
  const providerQueries = [...base.providerQueries, ...retry.providerQueries];

  return {
    queries: [...new Set([...base.queries, ...retry.queries])],
    rawResultCount: base.rawResultCount + retry.rawResultCount,
    dedupedResultCount: mergedSourceCount,
    providerQueries,
    providerSummary: summarizeProviderQueries(providerQueries),
    retryCount: (base.retryCount ?? 0) + 1,
    retryReason,
    retryQueries,
  };
}

function strictCoverageThreshold(mode: "search" | "research") {
  return mode === "research" ? 4 : 3;
}

function shouldEnterStrictCoverageMode(
  mode: "search" | "research",
  sourceCount: number,
  diagnostics: SearchDiagnostics | null,
) {
  if (!diagnostics) {
    return false;
  }

  const effectiveCoverage = Math.max(
    sourceCount,
    diagnostics?.dedupedResultCount ?? 0,
    diagnostics?.rawResultCount ?? 0,
  );

  if (effectiveCoverage < strictCoverageThreshold(mode)) {
    return true;
  }

  const successfulProviders = diagnostics.providerSummary.filter(
    (summary) => summary.successfulQueries > 0,
  ).length;
  if (successfulProviders <= 0) {
    return true;
  }

  if (successfulProviders >= 2) {
    return false;
  }

  // Allow high-confidence single-provider runs when coverage volume is strong.
  const strongSingleProviderFloor = mode === "research" ? 10 : 8;
  return effectiveCoverage < strongSingleProviderFloor;
}

function strictCoverageSummary(
  mode: "search" | "research",
  sourceCount: number,
  diagnostics: SearchDiagnostics,
) {
  const successfulProviders = diagnostics.providerSummary.filter(
    (summary) => summary.successfulQueries > 0,
  ).length;
  const minimum = strictCoverageThreshold(mode);

  return `Coverage remained below threshold after retry: ${sourceCount} sources (minimum ${minimum}) and ${successfulProviders} active providers.`;
}

function buildStrictCoverageAnswer(
  question: string,
  mode: "search" | "research",
  diagnostics: SearchDiagnostics,
): AssistantAnswer {
  const providerLines = diagnostics.providerSummary.map((summary) => {
    if (!summary.attemptedQueries) {
      return `${summary.provider}: not configured in this environment.`;
    }

    const base = `${summary.provider}: ${summary.successfulQueries}/${summary.attemptedQueries} successful queries, ${summary.totalResults} raw hits.`;
    if (summary.failedQueries > 0 && summary.lastError) {
      return `${base} Last error: ${summary.lastError}.`;
    }

    return base;
  });
  const retryLines = diagnostics.retryQueries?.length
    ? diagnostics.retryQueries.map((query) => `- ${query}`)
    : ["- No additional retry queries were available for this question."];
  const title = mode === "research" ? "Research Coverage Is Limited" : "Evidence Coverage Is Limited";
  const summary =
    "I couldn’t verify enough high-quality sources for this exact query yet.";
  const keyUpdates = [
    strictCoverageSummary(mode, diagnostics.dedupedResultCount, diagnostics),
    diagnostics.retryCount > 0
      ? `Automatic retry was executed with ${diagnostics.retryQueries?.length ?? 0} extra query variants.`
      : "Automatic retry was not triggered because no safe retry variants were available.",
    "The answer is intentionally conservative to avoid unsupported claims.",
  ];
  const detailed = [
    "### Coverage Diagnostics",
    renderBulletList(providerLines),
    "",
    "### Retry Queries Used",
    retryLines.join("\n"),
    "",
    "### What To Do Next",
    renderBulletList([
      "Narrow the scope to a specific geography, date range, or metric.",
      "Ask for authoritative sources only (for example government, regulator, or primary publication domains).",
      "If you have a target source URL, provide it directly for focused extraction.",
    ]),
  ].join("\n");

  return {
    format: mode === "research" ? "research" : "source",
    title,
    summary,
    keyInsights: keyUpdates,
    sections: [
      {
        title: "Detailed Explanation",
        content: detailed,
        kind: "markdown",
      },
    ],
    followUps: [
      "Should I retry with only government and primary-source domains?",
      "Do you want this narrowed to a specific country or city?",
      "Should I focus on a specific date window (for example last 7 or 30 days)?",
      "Do you want a query pack you can run manually for verification?",
    ],
    markdown: [
      `${title}`,
      "",
      summary,
      "",
      "Key Updates:",
      renderBulletList(keyUpdates),
      "",
      "Details:",
      detailed,
    ].join("\n"),
  };
}

function buildPlan(
  question: string,
  classification: QueryClassification,
  history: ResearchRequestBody["history"] = [],
): ResearchPlan {
  const priorContext =
    history?.length && history.at(-1)?.content
      ? `while staying consistent with the earlier conversation about "${history.at(-1)?.content}"`
      : "using the current user request as the primary scope";

  if (classification.type === "greeting") {
    return {
      objective: `Reply to "${question}" naturally and briefly ${priorContext}.`,
      tasks: [
        "Acknowledge the user naturally.",
        "Respond conversationally without rigid formatting.",
        "Do not invoke search, crawling, or retrieval unless the user adds a substantive task.",
      ],
      queries: [],
      deliverable: "Short conversational reply.",
    };
  }

  switch (classification.mode) {
    case "chat":
      return {
        objective: `Answer "${question}" clearly using direct reasoning ${priorContext}.`,
        tasks: [
          "Interpret the concept or request accurately.",
          "Explain the answer clearly and professionally.",
          "Add bullets or an example only when they improve clarity.",
        ],
        queries: [],
        deliverable: "Direct explanation with optional bullets or example.",
      };
    case "search":
      return {
        objective: `Answer "${question}" using live web search and source-backed synthesis.`,
        tasks: [
          "Expand the user query into multiple search formulations.",
          "Search current public web results from multiple providers.",
          "Retrieve the strongest recent sources and extract their contents.",
          "Rerank evidence and synthesize a structured cited answer.",
        ],
        queries: buildSearchQueries(question, classification),
        deliverable: "Title, summary, key points, conclusion, and cited sources.",
      };
    case "research":
      return {
        objective: `Answer "${question}" with current, multi-source web research and a structured decision-ready report.`,
        tasks: [
          `Clarify the research objective ${priorContext}.`,
          "Expand the query into multiple research angles.",
          "Search current public web results from multiple providers.",
          "Extract the strongest articles, landing pages, and factual reference sources.",
          "Rerank evidence, resolve contradictions, and package the findings into an executive-grade cited report.",
        ],
        queries: buildSearchQueries(question, classification),
        deliverable:
          "Title, executive summary, key points, comparisons where useful, conclusion, and cited sources.",
      };
    case "code":
      return {
        objective: `Answer "${question}" as a developer assistant with code, explanation, and example usage.`,
        tasks: [
          "Infer the target language or framework.",
          "Generate correct, practical code.",
          "Explain the approach concisely.",
          "Show example usage or expected behavior.",
        ],
        queries: [],
        deliverable: "Code block, explanation, and example usage.",
      };
    case "website":
      return {
        objective: `Analyze the referenced website and return a structured website assessment.`,
        tasks: [
          "Resolve the target website URL.",
          "Crawl the main content.",
          "Analyze messaging, content structure, and SEO signals.",
          "Return recommendations and key observations.",
        ],
        queries: [],
        deliverable:
          "Overview, content summary, SEO insights, and key recommendations.",
      };
    case "document":
      return {
        objective: `Answer "${question}" using retrieval-backed context from Weaviate and any referenced document URL.`,
        tasks: [
          "Resolve any referenced document URL.",
          "Retrieve the strongest matching chunks from the knowledge store.",
          "Answer from retrieved evidence and note any gaps.",
        ],
        queries: [],
        deliverable: "Retrieval-backed answer with supporting evidence and sources.",
      };
  }
}

function progressStep(
  phase: ResearchProgressStep["phase"],
  label: string,
  detail?: string,
  status: ResearchProgressStep["status"] = "completed",
): ResearchProgressStep {
  return {
    id: crypto.randomUUID(),
    phase,
    label,
    detail,
    status,
    timestamp: new Date().toISOString(),
  };
}

function renderBulletList(items: string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}

function buildSearchFallbackDocument(source: ResearchSource): ResearchDocument {
  return {
    id: stableId("search-fallback", source.url),
    title: source.title,
    url: source.url,
    content: source.snippet,
    provider: "search-fallback",
    excerpt: source.snippet,
  };
}

function createDirectSource(url: string, provider: ResearchSource["provider"] = "firecrawl") {
  const normalized = normalizeUrlCandidate(url);
  const domain = domainFromUrl(normalized);

  return {
    id: stableId("direct-source", normalized),
    title: domain,
    url: normalized,
    snippet: "",
    provider,
    domain,
    score: 1,
  } satisfies ResearchSource;
}

function trustedSourceBoost(source: ResearchSource) {
  const domain = source.domain.toLowerCase();
  const trustedMatch = TRUSTED_SOURCE_PATTERNS.some((pattern) => pattern.test(domain));
  if (trustedMatch) {
    return 0.5;
  }

  if (/official|docs|developer|press|report|data/i.test(`${source.title} ${source.url}`)) {
    return 0.18;
  }

  return 0;
}

function recencySourceBoost(source: ResearchSource) {
  if (!source.publishedDate) {
    return 0;
  }

  const parsed = new Date(source.publishedDate);
  if (Number.isNaN(parsed.getTime())) {
    return 0;
  }

  const ageDays = (Date.now() - parsed.getTime()) / 86_400_000;
  if (ageDays <= 7) {
    return 0.28;
  }

  if (ageDays <= 30) {
    return 0.18;
  }

  if (ageDays <= 180) {
    return 0.08;
  }

  return 0;
}

function factualPageBoost(source: ResearchSource) {
  if (/\b(report|study|official|documentation|release|announcement|filing|results|price|ranking|comparison)\b/i.test(`${source.title} ${source.snippet}`)) {
    return 0.12;
  }

  return 0;
}

function topicRelevanceTokens(question: string) {
  return [...new Set(
    question
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^\w\s-]+/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(
        (token) =>
          token.length >= 3 &&
          !TOPIC_RELEVANCE_STOP_WORDS.has(token) &&
          !/^\d+$/.test(token),
      ),
  )].slice(0, 12);
}

function topicRelevanceAdjustment(question: string, source: ResearchSource) {
  const text = `${source.title} ${source.snippet} ${source.url}`.toLowerCase();
  const tokens = topicRelevanceTokens(question);
  if (!tokens.length) {
    return 0;
  }

  const matched = tokens.filter((token) => text.includes(token)).length;
  const coverage = matched / tokens.length;
  let score = coverage * 0.5;

  if (coverage < 0.12) {
    score -= 0.65;
  }

  if (isRankingSearchQuestion(question)) {
    if (LOW_AUTHORITY_RANKING_SOURCE_PATTERNS.some((pattern) => pattern.test(source.domain))) {
      score -= 1.2;
    }

    if (
      /\b(wizarding|harry potter|hogwarts|fiction|fantasy|movie|movies|film|films|celebrity|anime|game)\b/i.test(
        text,
      )
    ) {
      score -= 1.4;
    }

    if (
      /\b(richest|wealth|wealthiest|gdp|millionaire|billionaire|net worth|econom)\b/i.test(
        question,
      ) &&
      !/\b(richest|wealth|wealthiest|gdp|millionaire|billionaire|net worth|econom)\b/i.test(
        text,
      )
    ) {
      score -= 0.5;
    }
  }

  return score;
}

function questionSourceAdjustment(question: string, source: ResearchSource) {
  let score = 0;
  const broadRealtimeUpdate = isBroadRealtimeUpdateQuery(question);
  const rankingQuestion = isRankingSearchQuestion(question);

  if (isSensitiveRealtimeQuery(question)) {
    if (isTrustedSource(source)) {
      score += 0.5;
    }

    if (isLowConfidenceSource(source)) {
      score -= 0.45;
    }
  }

  if (broadRealtimeUpdate) {
    if (isTrustedSource(source)) {
      score += 0.45;
    }

    if (isLowConfidenceSource(source)) {
      score -= 0.5;
    }

    if (
      /\b(tag|topic|latest news|where\/|live updates?|watch live|photo|video)\b/i.test(
        `${source.title} ${source.snippet} ${source.url}`,
      )
    ) {
      score -= 0.25;
    }

    if (
      /\/(world|news)\/(?:asia\/)?india\/?$/i.test(source.url) ||
      /\/where\/india\/?$/i.test(source.url)
    ) {
      score -= 0.35;
    }
  }

  if (isCommercePriceComparisonQuery(question)) {
    if (COMMERCE_RETAILER_SOURCE_PATTERNS.some((pattern) => pattern.test(source.domain))) {
      score += 0.55;
    }

    if (
      /\b(price|buy|deal|deals|offer|offers|availability|preorder|starting at|retail price)\b/i.test(
        `${source.title} ${source.snippet}`,
      )
    ) {
      score += 0.18;
    }

    if (
      /\b(trade-?in|sell|cash value|used|refurbished|resale)\b/i.test(
        `${source.title} ${source.snippet}`,
      )
    ) {
      score -= 0.75;
    }

    if (
      /\b(countries?|country|global|world|compared to india|price in \d+ countries)\b/i.test(
        `${source.title} ${source.snippet}`,
      )
    ) {
      score -= 0.55;
    }

    if (
      /\b(review|reviews|hands-on|specs|news)\b/i.test(`${source.title} ${source.snippet}`) &&
      !/\bprice|deal|offer|buy\b/i.test(`${source.title} ${source.snippet}`)
    ) {
      score -= 0.2;
    }

    if (
      /\b(deals?|per month|monthly|contract|plan|sim-only|sim free)\b/i.test(
        `${source.title} ${source.snippet}`,
      ) &&
      !/\b(retail price|starting at|unlocked|buy)\b/i.test(`${source.title} ${source.snippet}`)
    ) {
      score -= 0.45;
    }
  }

  if (rankingQuestion) {
    if (isTrustedSource(source)) {
      score += 0.4;
    }

    if (isLowConfidenceSource(source)) {
      score -= 0.6;
    }
  }

  score += topicRelevanceAdjustment(question, source);

  return score;
}

function assembleBestSources(
  question: string,
  sources: ResearchSource[],
  maxSources = env.RESEARCH_MAX_SOURCES,
) {
  const rescored = uniqueBy(sources, (source) => normalizeUrlCandidate(source.url))
    .map((source) => ({
      ...source,
      score:
        source.score +
        trustedSourceBoost(source) +
        recencySourceBoost(source) +
        factualPageBoost(source) +
        questionSourceAdjustment(question, source),
    }))
    .sort((left, right) => right.score - left.score);

  const rankingQuestion = isRankingSearchQuestion(question);
  const rankingFiltered = rankingQuestion
    ? rescored.filter((source) => source.score >= 0.15 || isTrustedSource(source))
    : rescored;

  const sensitiveRealtime = isSensitiveRealtimeQuery(question);
  const broadRealtimeUpdate = isBroadRealtimeUpdateQuery(question);
  const trustedCount = rankingFiltered.filter((source) => isTrustedSource(source)).length;
  const eligibleSources =
    sensitiveRealtime && trustedCount >= 2
      ? rankingFiltered.filter((source) => isTrustedSource(source) && !isLowConfidenceSource(source))
      : broadRealtimeUpdate && trustedCount >= 3
        ? rankingFiltered.filter((source) => isTrustedSource(source) && !isLowConfidenceSource(source))
        : rankingFiltered.filter((source) => !isLowConfidenceSource(source));

  const perDomain = new Map<string, number>();
  const selected: ResearchSource[] = [];
  const maxPerDomain = isCommercePriceComparisonQuery(question) || broadRealtimeUpdate ? 1 : 2;

  for (const source of eligibleSources) {
    const count = perDomain.get(source.domain) ?? 0;
    if (count >= maxPerDomain) {
      continue;
    }

    perDomain.set(source.domain, count + 1);
    selected.push(source);
    if (selected.length >= maxSources) {
      break;
    }
  }

  return selected.length ? selected : rankingFiltered.slice(0, maxSources);
}

async function extractDocumentsFromSources(sources: ResearchSource[]) {
  const crawled = await Promise.allSettled(
    sources.map((source) => extractWebsiteContent(source)),
  );

  const documents = crawled.filter(
    (result): result is PromiseFulfilledResult<ResearchDocument | null> =>
      result.status === "fulfilled" &&
      Boolean(result.value && result.value.content.length > 140),
  )
  .map((result) => result.value)
  .filter(
    (document): document is ResearchDocument =>
      Boolean(document && document.content.length > 140),
  );

  const fallbacks = sources
    .filter((source) => !documents.some((document) => document.url === source.url))
    .map(buildSearchFallbackDocument);

  return uniqueBy([...documents, ...fallbacks], (document) => document.url).slice(0, 5);
}

async function indexDocuments(question: string, documents: ResearchDocument[]) {
  if (!documents.length) {
    return [] as IndexedChunk[];
  }

  const chunkRecords = documents.flatMap((document) =>
    chunkText(document.content)
      .slice(0, env.RESEARCH_MAX_CHUNKS_PER_SOURCE)
      .map((chunk, chunkIndex) => ({
        question,
        title: document.title,
        url: document.url,
        content: chunk,
        sourceProvider: document.provider,
        domain: domainFromUrl(document.url),
        chunkIndex,
      })),
  );

  const passageEmbeddings = await embedTexts(
    chunkRecords.map((record) => record.content),
    "passage",
  );

  const chunksWithVectors = chunkRecords.map((record, index) => ({
    ...record,
    vector: passageEmbeddings[index] ?? [],
  }));

  await storeResearchEmbeddings(chunksWithVectors);

  return chunksWithVectors;
}

async function retrieveContextFromIndex(
  question: string,
  indexedChunks: IndexedChunk[],
  limit = env.RESEARCH_RETRIEVE_LIMIT,
) {
  const [queryVector] = await embedTexts([question], "query");
  let retrievedContext = await retrieveResearchContext(queryVector, limit);

  if (!retrievedContext.length && queryVector.length && indexedChunks.length) {
    retrievedContext = indexedChunks
      .map((chunk) => ({
        id: stableId("local-retrieval", chunk.url, String(chunk.chunkIndex)),
        title: chunk.title,
        url: chunk.url,
        content: chunk.content,
        sourceProvider: chunk.sourceProvider,
        chunkIndex: chunk.chunkIndex,
        score: cosineSimilarity(queryVector, chunk.vector),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  return retrievedContext;
}

export async function runResearchAgent(
  input: ResearchRequestBody,
  callbacks: ResearchCallbacks = {},
): Promise<ResearchRunResult> {
  const rawQuestion = input.question.trim();
  if (!rawQuestion) {
    throw new Error("A question is required.");
  }

  const progress: ResearchProgressStep[] = [];
  const pushProgress = (
    phase: ResearchProgressStep["phase"],
    label: string,
    detail?: string,
    status: ResearchProgressStep["status"] = "completed",
  ) => {
    const step = progressStep(phase, label, detail, status);
    progress.push(step);
    callbacks.onProgress?.(step);
  };

  const rewrite = rewriteQuestionWithMemory(
    rawQuestion,
    input.history,
    input.memory ?? null,
  );
  const question = rewrite.resolvedQuestion;
  const classification = classifyQuery(question);
  const plan = {
    ...buildPlan(question, classification, input.history),
    queries: rewrite.rewrittenQueries.length
      ? rewrite.rewrittenQueries
      : buildSearchQueries(question, classification),
  };
  const trace = await startTrace("swiftdeploy-research-run", {
    question: rawQuestion,
    resolvedQuestion: question,
    classification,
    queries: plan.queries,
    memory: rewrite.memory,
  });

  pushProgress("memory", "Conversation memory prepared", rewrite.memory.summary);
  if (rewrite.usedConversationContext) {
    pushProgress(
      "rewrite",
      "Follow-up resolved",
      `Rewritten as: ${clipText(question, 140)}`,
    );
  }
  pushProgress(
    "classification",
    "Query classified",
    `${classification.type} -> ${classification.mode} (${classification.confidence} confidence)`,
  );
  pushProgress("analysis", "Question analyzed", classification.reasoning);
  pushProgress(
    "planning",
    "Pipeline selected",
    `${plan.tasks.length} tasks / ${Math.max(plan.queries.length, 1)} execution paths`,
  );

  let sources: ResearchSource[] = [];
  let retrievedContext: ResearchRunResult["retrievedContext"] = [];
  let report: ResearchRunResult["report"] = null;
  let answer: ResearchRunResult["answer"] | null = null;
  let searchDiagnostics: SearchDiagnostics | null = null;

  const runSearchWithAutoRetry = async (mode: "search" | "research") => {
    const initialSearch = await searchInternetWithDiagnostics(plan.queries, {
      maxQueries: Math.min(plan.queries.length, env.RESEARCH_MAX_SEARCH_QUERIES),
      maxResults: env.RESEARCH_MAX_SEARCH_RESULTS,
    });

    let mergedSources = initialSearch.sources;
    let diagnostics = initialSearch.diagnostics;

    pushProgress(
      "search",
      "Provider diagnostics captured",
      formatProviderSummaryForProgress(diagnostics),
    );

    if (shouldRetryLowCoverageSearch(mode, mergedSources.length, diagnostics)) {
      const retryQueries = buildLowCoverageRetryQueries(
        rewrite.usedConversationContext ? question : rawQuestion,
        classification,
        diagnostics.queries,
      );

      if (retryQueries.length) {
        pushProgress(
          "rewrite",
          "Low source coverage detected",
          [
            strictCoverageSummary(
              mode,
              Math.max(
                mergedSources.length,
                diagnostics.dedupedResultCount,
                diagnostics.rawResultCount,
              ),
              diagnostics,
            ),
            `Retrying with ${retryQueries.length} additional query variants:`,
            ...retryQueries.map((query) => `- ${query}`),
          ].join("\n"),
        );

        const retrySearch = await searchInternetWithDiagnostics(retryQueries, {
          maxQueries: Math.min(retryQueries.length, env.RESEARCH_MAX_SEARCH_QUERIES),
          maxResults: env.RESEARCH_MAX_SEARCH_RESULTS,
        });

        mergedSources = uniqueBy(
          [...mergedSources, ...retrySearch.sources],
          (source) => normalizeUrlCandidate(source.url),
        )
          .sort((left, right) => right.score - left.score)
          .slice(0, env.RESEARCH_MAX_SEARCH_RESULTS);

        diagnostics = mergeSearchDiagnostics(
          diagnostics,
          retrySearch.diagnostics,
          mergedSources.length,
          retryQueries,
          `Initial candidate source count (${initialSearch.sources.length}) was below threshold for ${mode} mode.`,
        );

        pushProgress(
          "search",
          "Search retry completed",
          `${mergedSources.length} candidate sources after retry. ${formatProviderSummaryForProgress(diagnostics)}`,
        );
      } else {
        pushProgress(
          "rewrite",
          "Low source coverage detected",
          `${strictCoverageSummary(
            mode,
            Math.max(
              mergedSources.length,
              diagnostics.dedupedResultCount,
              diagnostics.rawResultCount,
            ),
            diagnostics,
          )} No additional safe retry queries were generated.`,
          "error",
        );
      }
    }

    return {
      sources: mergedSources,
      diagnostics,
    };
  };

  try {
    if (classification.type === "greeting") {
      answer = await generateGreetingAnswer({
        question: rawQuestion,
        classification,
        plan,
        history: input.history,
      });
      pushProgress("reasoning", "Greeting response generated", "Natural chat reply prepared");
    } else {
      switch (classification.mode) {
        case "chat": {
          answer = await generateGeneralKnowledgeAnswer({
            question: rawQuestion,
            classification,
            plan,
            history: input.history,
          });
          pushProgress(
            "reasoning",
            "Reasoning response generated",
            answer.keyInsights.length
              ? `${answer.keyInsights.length} bullets produced`
              : "Direct explanation produced without extra bullet formatting",
          );
          break;
        }

        case "code": {
          answer = await generateCodingAnswer({
            question: rawQuestion,
            classification,
            plan,
            history: input.history,
          });
          pushProgress(
            "reasoning",
            "Coding response generated",
            `${answer.sections.length} structured sections produced`,
          );
          break;
        }

        case "search": {
          const searchRun = await runSearchWithAutoRetry("search");
          const searchResults = searchRun.sources;
          searchDiagnostics = searchRun.diagnostics;

          if (!searchResults.length) {
            pushProgress(
              "search",
              "Live search returned no sources",
              "I couldn’t verify enough high-quality sources for this exact detail yet.",
              "error",
            );

            answer = await generateSourceBackedAnswer({
              question: rawQuestion,
              classification,
              plan,
              sources: [],
              documents: [],
              retrievedContext: [],
            });
            pushProgress(
              "reasoning",
              "No-source fallback generated",
              "Response returned without unsupported claims",
            );
            break;
          }

          pushProgress(
            "search",
            "Live search completed",
            `${searchResults.length} candidate sources gathered across expanded queries`,
          );

          sources = assembleBestSources(question, await rerankSources(question, searchResults));
          callbacks.onSources?.(sources);
          pushProgress(
            "rerank",
            "Source reranking completed",
            `${sources.length} high-confidence sources selected for retrieval`,
          );

          if (shouldEnterStrictCoverageMode("search", sources.length, searchDiagnostics)) {
            answer = buildStrictCoverageAnswer(
              rawQuestion,
              "search",
              searchDiagnostics ?? {
                queries: plan.queries,
                rawResultCount: searchResults.length,
                dedupedResultCount: sources.length,
                providerQueries: [],
                providerSummary: [],
                retryCount: 0,
              },
            );
            pushProgress(
              "reasoning",
              "Strict evidence mode activated",
              strictCoverageSummary(
                "search",
                sources.length,
                searchDiagnostics ?? {
                  queries: plan.queries,
                  rawResultCount: searchResults.length,
                  dedupedResultCount: sources.length,
                  providerQueries: [],
                  providerSummary: [],
                  retryCount: 0,
                },
              ),
              "error",
            );
            break;
          }

          if (shouldUseFastSearchPipeline(question, classification)) {
            answer = await generateSourceBackedAnswer({
              question: rawQuestion,
              classification,
              plan,
              sources,
              documents: [],
              retrievedContext: [],
            });
            pushProgress(
              "reasoning",
              "Fast source-backed answer generated",
              `${Math.max(answer.keyInsights.length, sources.length)} evidence points prepared from live sources`,
            );
            break;
          }

          const workingDocuments = await extractDocumentsFromSources(sources);

          pushProgress(
            "crawl",
            "Source extraction completed",
            `${workingDocuments.length} source documents prepared for retrieval-backed synthesis`,
          );

          const documents = await rerankDocuments(question, workingDocuments);
          pushProgress(
            "rerank",
            "Document reranking completed",
            `${documents.length} extracted documents sorted by relevance`,
          );

          if (documents.length) {
            const indexedChunks = await indexDocuments(question, documents);
            if (indexedChunks.length) {
              pushProgress(
                "embedding",
                "Knowledge embeddings prepared",
                `${indexedChunks.length} chunks indexed in Pinecone`,
              );
              retrievedContext = await retrieveContextFromIndex(
                question,
                indexedChunks,
                env.RESEARCH_RETRIEVE_LIMIT,
              );
              if (retrievedContext.length) {
                retrievedContext = await rerankChunks(question, retrievedContext);
                pushProgress(
                  "rerank",
                  "Evidence reranking completed",
                  `${retrievedContext.length} evidence chunks prepared for synthesis`,
                );
              }
              pushProgress(
                "retrieval",
                "Context retrieval completed",
                `${retrievedContext.length} chunks ranked for source-backed synthesis`,
              );
            }
          }

          answer = await generateSourceBackedAnswer({
            question: rawQuestion,
            classification,
            plan,
            sources,
            documents,
            retrievedContext,
          });
          pushProgress(
            "reasoning",
            "Source-backed answer generated",
            `${Math.max(answer.keyInsights.length, sources.length)} evidence points prepared`,
          );
          break;
        }

        case "research": {
          const searchRun = await runSearchWithAutoRetry("research");
          const searchResults = searchRun.sources;
          searchDiagnostics = searchRun.diagnostics;

          if (!searchResults.length) {
            pushProgress(
              "search",
              "Internet search returned no sources",
              "I couldn’t verify enough high-quality sources for this exact detail yet.",
              "error",
            );

            const reportBody = await generateStructuredReport({
              question: rawQuestion,
              plan,
              retrievedContext: [],
              sources: [],
            });

            report = {
              ...reportBody,
              sources: [],
              plan,
              retrievalContext: [],
            };
            answer = buildResearchAnswerFromReport(rawQuestion, reportBody, []);
            pushProgress("report", "Structured report generated", clipText(report.title, 90));
            break;
          }

          pushProgress(
            "search",
            "Internet search completed",
            `${searchResults.length} candidate sources gathered across expanded queries`,
          );

          sources = assembleBestSources(question, await rerankSources(question, searchResults));
          callbacks.onSources?.(sources);
          pushProgress(
            "rerank",
            "Source reranking completed",
            `${sources.length} sources prioritized for deep research`,
          );

          if (shouldEnterStrictCoverageMode("research", sources.length, searchDiagnostics)) {
            answer = buildStrictCoverageAnswer(
              rawQuestion,
              "research",
              searchDiagnostics ?? {
                queries: plan.queries,
                rawResultCount: searchResults.length,
                dedupedResultCount: sources.length,
                providerQueries: [],
                providerSummary: [],
                retryCount: 0,
              },
            );
            pushProgress(
              "reasoning",
              "Strict evidence mode activated",
              strictCoverageSummary(
                "research",
                sources.length,
                searchDiagnostics ?? {
                  queries: plan.queries,
                  rawResultCount: searchResults.length,
                  dedupedResultCount: sources.length,
                  providerQueries: [],
                  providerSummary: [],
                  retryCount: 0,
                },
              ),
              "error",
            );
            break;
          }

          if (shouldUseFastResearchPipeline(sources)) {
            const reportBody = await generateStructuredReport({
              question: rawQuestion,
              plan,
              retrievedContext: [],
              sources,
            });

            pushProgress(
              "reasoning",
              "Fast research synthesis completed",
              `${reportBody.keyFindings.length} key findings generated from live sources`,
            );

            report = {
              ...reportBody,
              sources,
              plan,
              retrievalContext: [],
            };
            answer = buildResearchAnswerFromReport(rawQuestion, reportBody, sources);
            pushProgress("report", "Structured report generated", clipText(report.title, 90));
            break;
          }

          const crawledDocuments = await extractDocumentsFromSources(sources.slice(0, 4));
          pushProgress(
            "crawl",
            "Source extraction completed",
            `${crawledDocuments.length} documents prepared for retrieval`,
          );

          const documents = await rerankDocuments(question, crawledDocuments);
          pushProgress(
            "rerank",
            "Document reranking completed",
            `${documents.length} extracted documents sorted by relevance`,
          );

          const indexedChunks = await indexDocuments(question, documents);
          pushProgress(
            "embedding",
            "Knowledge embeddings prepared",
            `${indexedChunks.length} chunks indexed in Pinecone`,
          );

          retrievedContext = await retrieveContextFromIndex(question, indexedChunks);
          if (retrievedContext.length) {
            retrievedContext = await rerankChunks(question, retrievedContext);
            pushProgress(
              "rerank",
              "Evidence reranking completed",
              `${retrievedContext.length} evidence chunks prioritized for synthesis`,
            );
          }
          pushProgress(
            "retrieval",
            "Context retrieval completed",
            `${retrievedContext.length} chunks ranked for synthesis`,
          );

          const reportBody = await generateStructuredReport({
            question: rawQuestion,
            plan,
            retrievedContext,
            sources,
          });

          pushProgress(
            "reasoning",
            "Synthesis completed",
            `${reportBody.keyFindings.length} key findings generated`,
          );

          report = {
            ...reportBody,
            sources,
            plan,
            retrievalContext: retrievedContext,
          };
          answer = buildResearchAnswerFromReport(rawQuestion, reportBody, sources);
          pushProgress("report", "Structured report generated", clipText(report.title, 90));
          break;
        }

        case "website": {
          const targetUrl = extractUrls(question)[0];
          if (!targetUrl) {
            throw new Error("A website URL is required for website analysis.");
          }

          sources = [createDirectSource(targetUrl)];
          callbacks.onSources?.(sources);
          pushProgress("crawl", "Website crawl started", sources[0].url);

          const document = await extractWebsiteContent(sources[0]);
          if (!document) {
            pushProgress(
              "crawl",
              "Website extraction returned limited content",
              "I couldn’t verify enough high-quality sources for this exact detail yet.",
              "error",
            );
            answer = await generateWebsiteAnalysisAnswer({
              question: rawQuestion,
              classification,
              plan,
              sources,
              documents: [],
            });
            pushProgress(
              "reasoning",
              "Website fallback generated",
              "Response returned without unsupported claims",
            );
            break;
          }

          pushProgress(
            "crawl",
            "Website content extracted",
            `${clipText(document.title, 70)} was extracted for analysis`,
          );

          const indexedChunks = await indexDocuments(question, [document]);
          if (indexedChunks.length) {
            pushProgress(
              "embedding",
              "Website content indexed",
              `${indexedChunks.length} chunks embedded for retrieval`,
            );
            retrievedContext = await retrieveContextFromIndex(question, indexedChunks, 4);
            if (retrievedContext.length) {
              retrievedContext = await rerankChunks(question, retrievedContext);
              pushProgress(
                "rerank",
                "Evidence reranking completed",
                `${retrievedContext.length} website chunks prioritized for analysis`,
              );
            }
            pushProgress(
              "retrieval",
              "Website context ranked",
              `${retrievedContext.length} chunks prepared for analysis`,
            );
          }

          answer = await generateWebsiteAnalysisAnswer({
            question: rawQuestion,
            classification,
            plan,
            sources,
            documents: [document],
          });
          pushProgress(
            "reasoning",
            "Website analysis generated",
            `${answer.keyInsights.length} recommendations and insights prepared`,
          );
          break;
        }

        case "document": {
          const referencedUrl = extractUrls(question)[0];
          let indexedChunks: IndexedChunk[] = [];

          if (referencedUrl) {
            sources = [createDirectSource(referencedUrl)];
            callbacks.onSources?.(sources);
            pushProgress("crawl", "Document retrieval started", sources[0].url);

            const document = await extractWebsiteContent(sources[0]);
            if (document) {
              pushProgress(
                "crawl",
                "Document content extracted",
                `${clipText(document.title, 70)} was added to the working set`,
              );
              indexedChunks = await indexDocuments(question, [document]);
              if (indexedChunks.length) {
                pushProgress(
                  "embedding",
                  "Document indexed",
                  `${indexedChunks.length} chunks embedded and stored`,
                );
              }
            }
          }

          retrievedContext = await retrieveContextFromIndex(question, indexedChunks);
          if (retrievedContext.length) {
            retrievedContext = await rerankChunks(question, retrievedContext);
            pushProgress(
              "rerank",
              "Evidence reranking completed",
              `${retrievedContext.length} retrieval chunks prioritized for answering`,
            );
          }
          pushProgress(
            "retrieval",
            "Knowledge retrieval completed",
            `${retrievedContext.length} chunks returned from Pinecone or local fallback`,
          );

          answer = await generateDocumentAnswer({
            question: rawQuestion,
            classification,
            plan,
            sources,
            retrievedContext,
          });
          pushProgress(
            "reasoning",
            "Retrieval-backed answer generated",
            retrievedContext.length
              ? `${retrievedContext.length} evidence chunks used`
              : "Response generated with limited retrieval context",
          );
          break;
        }
      }
    }

    if (!answer) {
      throw new Error("The assistant did not produce an answer.");
    }

    const result: ResearchRunResult = {
      question: rawQuestion,
      resolvedQuestion: question,
      classification,
      plan,
      progress,
      sources,
      retrievedContext,
      answer,
      report,
      memory: rewrite.memory,
      rewrittenQueries: plan.queries,
      usedConversationContext: rewrite.usedConversationContext,
      providerSnapshot: getProviderSnapshot(),
      searchDiagnostics,
    };

    await persistResearchRun(result, input.user);
    await trace?.end({
      classification: classification.type,
      mode: classification.mode,
      resolvedQuestion: question,
      sourceCount: sources.length,
      retrievedCount: retrievedContext.length,
      searchDiagnostics,
      reportTitle: report?.title,
    });

    return result;
  } catch (error) {
    await trace?.fail(error, {
      classification: classification.type,
      mode: classification.mode,
      progress,
    });
    throw error;
  }
}
