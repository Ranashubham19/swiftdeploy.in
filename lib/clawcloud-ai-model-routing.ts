export type AiModelRoutingKind = "comparison" | "ranking" | "fact";

export type AiModelRoutingDecision = {
  mode: "clarify" | "web_search";
  kind: AiModelRoutingKind;
  officialDomains: string[];
  searchQueries: string[];
  clarificationReply?: string;
};

type VendorSpec = {
  label: string;
  officialDomains: string[];
  patterns: RegExp[];
};

type AmbiguousFamily = {
  term: string;
  familyLabel: string;
  vendorLabel: string;
};

const COMPARISON_SIGNAL = /\b(compare|comparison|difference between|vs\.?|versus|which is better|better than|head[- ]to[- ]head|stack up against|trade-?off)\b/i;
const RANKING_SIGNAL = /\b(top\s*\d+|best|most advanced|strongest|leading|frontier|state of the art|sota|leaderboard|rank(?:ed|ing)?)\b/i;
const FACT_SIGNAL = /\b(what is|who makes|who built|made by|pricing|price|cost|release(?:d)?|launch(?:ed)?|availability|context window|benchmark|benchmarks|latency|speed|reasoning|coding|model|models|llm|ai)\b/i;
const GENERAL_AI_SIGNAL = /\b(ai|llm|model|models|foundation model|language model|reasoning model)\b/i;
const COMPARISON_AXIS_PATTERNS = [
  /\b(coding|code|programming)\b/i,
  /\b(reasoning|logic|math)\b/i,
  /\b(price|pricing|cost)\b/i,
  /\b(speed|latency|fast)\b/i,
  /\b(context(?: window)?|tokens?|memory)\b/i,
  /\b(tool use|agentic|agent)\b/i,
  /\b(multimodal|vision)\b/i,
  /\b(benchmarks?|safety|availability|release)\b/i,
  /\boverall\b/i,
];

const VENDORS: VendorSpec[] = [
  {
    label: "OpenAI",
    officialDomains: ["openai.com", "platform.openai.com"],
    patterns: [
      /\bopenai\b/i,
      /\bchatgpt\b/i,
      /\bgpt[- ]?\d+(?:\.\d+)?(?:\s+(?:mini|nano))?\b/i,
      /\bo[134](?:[- ]mini)?\b/i,
    ],
  },
  {
    label: "Anthropic",
    officialDomains: ["anthropic.com", "docs.anthropic.com"],
    patterns: [
      /\banthropic\b/i,
      /\bclaude\b/i,
    ],
  },
  {
    label: "Google",
    officialDomains: ["ai.google.dev", "blog.google", "deepmind.google"],
    patterns: [
      /\bgoogle\b/i,
      /\bgemini\b/i,
      /\bdeepmind\b/i,
    ],
  },
  {
    label: "xAI",
    officialDomains: ["x.ai", "docs.x.ai"],
    patterns: [
      /\bx\.ai\b/i,
      /\bxai\b/i,
      /\bgrok\b/i,
    ],
  },
  {
    label: "Meta",
    officialDomains: ["ai.meta.com", "about.meta.com"],
    patterns: [
      /\bmeta ai\b/i,
      /\bmeta\b/i,
      /\bllama\b/i,
    ],
  },
  {
    label: "DeepSeek",
    officialDomains: ["deepseek.com", "api-docs.deepseek.com"],
    patterns: [
      /\bdeepseek\b/i,
    ],
  },
  {
    label: "Mistral",
    officialDomains: ["mistral.ai", "docs.mistral.ai"],
    patterns: [
      /\bmistral\b/i,
    ],
  },
];

const AMBIGUOUS_CLAUDE_FAMILIES: AmbiguousFamily[] = [
  { term: "opus", familyLabel: "Claude Opus", vendorLabel: "Anthropic" },
  { term: "sonnet", familyLabel: "Claude Sonnet", vendorLabel: "Anthropic" },
  { term: "haiku", familyLabel: "Claude Haiku", vendorLabel: "Anthropic" },
];

function unique(values: string[]) {
  return [...new Set(values)];
}

function uniqueVendors(vendors: VendorSpec[]) {
  const seen = new Set<string>();
  return vendors.filter((vendor) => {
    if (seen.has(vendor.label)) {
      return false;
    }
    seen.add(vendor.label);
    return true;
  });
}

function collectMatchedVendors(question: string) {
  return VENDORS.filter((vendor) => vendor.patterns.some((pattern) => pattern.test(question)));
}

function collectAmbiguousClaudeFamilies(question: string) {
  return AMBIGUOUS_CLAUDE_FAMILIES.filter(({ term }) => new RegExp(`\\b${term}\\b`, "i").test(question));
}

function buildInferredClaudeFamilySnippets(question: string, families: AmbiguousFamily[]) {
  return unique(
    families.flatMap(({ term, familyLabel }) => {
      const match = question.match(new RegExp(`\\b${term}\\s+(\\d+(?:\\.\\d+)?)\\b`, "i"));
      const version = match?.[1]?.trim();
      return [version ? `${familyLabel} ${version}` : familyLabel];
    }),
  );
}

function buildAiModelClarificationReply(families: AmbiguousFamily[]) {
  const labels = unique(families.map((family) => family.familyLabel));
  return [
    "*Model name clarification*",
    "",
    `I can compare the right model cleanly, but ${labels.join(" / ")} is ambiguous when the vendor name is missing.`,
    "",
    "Please state the vendor explicitly, for example:",
    "- _Compare GPT-5.4 vs Claude Opus ..._",
    "- _Compare GPT-5.4 vs Claude Sonnet ..._",
    "",
    "Once that is explicit, I can compare release timing, capabilities, coding strength, latency, pricing, and best use cases in one answer.",
  ].join("\n");
}

function buildAiModelScopeClarificationReply(modelLabels: string[]) {
  const compared = modelLabels.length >= 2
    ? `${modelLabels[0]} and ${modelLabels[1]}`
    : "those models";

  return [
    "*AI model comparison*",
    "",
    `I can compare ${compared} cleanly, and I can also do an overall view if you prefer.`,
    "",
    "Useful comparison axes:",
    "- coding",
    "- reasoning",
    "- price",
    "- latency",
    "- context window",
    "- overall",
    "",
    `Example: _Compare ${compared} for coding._`,
  ].join("\n");
}

function countComparisonAxes(question: string) {
  return COMPARISON_AXIS_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(question) ? 1 : 0),
    0,
  );
}

function questionNeedsReleaseSignals(question: string) {
  return /\b(release|relase|released|launch|launched|announcement|announced|date)\b/i.test(question);
}

function extractVendorModelSnippets(question: string, vendor: VendorSpec) {
  const patternsByVendor: Record<string, RegExp[]> = {
    OpenAI: [
      /\bgpt[- ]?\d+(?:\.\d+)?(?:\s+(?:mini|nano))?\b/ig,
      /\bo[134](?:[- ]mini)?\b/ig,
      /\bchatgpt\b/ig,
    ],
    Anthropic: [
      /\bclaude(?:\s+(?:opus|sonnet|haiku))?(?:\s+\d+(?:\.\d+)?)?\b/ig,
    ],
    Google: [
      /\bgemini(?:\s+\d+(?:\.\d+)?)?(?:\s+(?:flash|pro|ultra))?\b/ig,
    ],
    xAI: [
      /\bgrok(?:\s+\d+(?:\.\d+)?)?\b/ig,
    ],
    Meta: [
      /\bllama(?:\s+\d+(?:\.\d+)?)?\b/ig,
    ],
    DeepSeek: [
      /\bdeepseek(?:[- ]?[a-z0-9.]+)?\b/ig,
    ],
    Mistral: [
      /\bmistral(?:\s+[a-z0-9.]+)?\b/ig,
    ],
  };

  const patterns = patternsByVendor[vendor.label] ?? [];
  const snippets = patterns.flatMap((pattern) => [...question.matchAll(pattern)].map((match) => match[0]?.trim() ?? ""));
  return unique(snippets.filter(Boolean));
}

function buildAiModelSearchQueries(
  question: string,
  officialDomains: string[],
  vendorSnippets: string[],
  kind: AiModelRoutingKind,
) {
  const trimmedQuestion = question.trim();
  const queries = [trimmedQuestion];
  const needsReleaseSignals = questionNeedsReleaseSignals(trimmedQuestion);

  if (kind === "comparison") {
    queries.push(`${trimmedQuestion} official comparison`);
    if (needsReleaseSignals) {
      queries.push(`${trimmedQuestion} official release date`);
    }
  } else if (kind === "ranking") {
    queries.push(`${trimmedQuestion} official frontier models`);
  } else if (needsReleaseSignals) {
    queries.push(`${trimmedQuestion} official release date`);
  } else {
    queries.push(`${trimmedQuestion} official`);
  }

  for (const snippet of vendorSnippets.slice(0, 4)) {
    queries.push(`${snippet} official`);
    if (kind === "comparison") {
      queries.push(`${snippet} official specs`);
    }
    if (needsReleaseSignals) {
      queries.push(`${snippet} release date official`);
      queries.push(`${snippet} official announcement`);
    }
  }

  for (const domain of officialDomains.slice(0, 3)) {
    queries.push(`${trimmedQuestion} site:${domain}`);
  }

  return unique(queries.filter(Boolean));
}

function buildRankingVendorFlagshipQueries(vendors: VendorSpec[]) {
  const perVendorQueries: Record<string, string[]> = {
    OpenAI: ["OpenAI GPT flagship model official site:openai.com"],
    Anthropic: ["Anthropic Claude flagship model official site:anthropic.com"],
    Google: ["Google Gemini flagship model official site:blog.google"],
    xAI: ["xAI Grok flagship model official site:x.ai"],
    Meta: ["Meta Llama flagship model official site:ai.meta.com"],
    DeepSeek: ["DeepSeek flagship model official site:deepseek.com"],
    Mistral: ["Mistral flagship model official site:mistral.ai"],
  };

  return unique(vendors.flatMap((vendor) => perVendorQueries[vendor.label] ?? []));
}

export function detectAiModelRoutingDecision(question: string): AiModelRoutingDecision | null {
  const text = question.trim();
  if (!text) {
    return null;
  }

  const hasComparisonSignal = COMPARISON_SIGNAL.test(text);
  const hasRankingSignal = RANKING_SIGNAL.test(text);
  const hasFactSignal = FACT_SIGNAL.test(text);
  const ambiguousClaudeFamilies = collectAmbiguousClaudeFamilies(text);
  const inferredClaudeVendor =
    ambiguousClaudeFamilies.length > 0
    && (
      hasComparisonSignal
      || hasFactSignal
      || hasRankingSignal
      || /\b(gpt|openai|claude|anthropic|gemini|google|grok|xai|meta|llama|deepseek|mistral|llm|model|models|ai)\b/i.test(text)
    );
  const matchedVendors = uniqueVendors([
    ...collectMatchedVendors(text),
    ...(inferredClaudeVendor ? VENDORS.filter((vendor) => vendor.label === "Anthropic") : []),
  ]);
  const vendorSnippets = unique([
    ...matchedVendors.flatMap((vendor) => extractVendorModelSnippets(text, vendor)),
    ...buildInferredClaudeFamilySnippets(text, ambiguousClaudeFamilies),
  ]);
  const hasAmbiguousFamilyModelContext =
    ambiguousClaudeFamilies.length > 0
    && (
      hasComparisonSignal
      || hasFactSignal
      || hasRankingSignal
      || /\b(gpt|openai|claude|anthropic|gemini|google|grok|xai|meta|llama|deepseek|mistral|llm|model|models|ai)\b/i.test(text)
    );
  const hasNamedModelContext =
    matchedVendors.length > 0
    || vendorSnippets.length > 0
    || hasAmbiguousFamilyModelContext;

  const hasModelContext = (
    hasNamedModelContext
    || (hasRankingSignal && GENERAL_AI_SIGNAL.test(text))
    || (
      ambiguousClaudeFamilies.length > 0
      && (
        hasComparisonSignal
        || /\b(gpt|openai|claude|anthropic|gemini|google|grok|xai|meta|llama|deepseek|mistral|llm|model|models|ai)\b/i.test(text)
      )
    )
  );

  if (!hasModelContext) {
    return null;
  }

  const comparisonAxisCount = countComparisonAxes(text);

  if (!hasComparisonSignal && !hasFactSignal && !hasRankingSignal) {
    return null;
  }

  const kind: AiModelRoutingKind = hasComparisonSignal
    ? "comparison"
    : hasRankingSignal
      ? "ranking"
      : "fact";
  if (kind !== "ranking" && !hasNamedModelContext) {
    return null;
  }

  const officialDomains = unique(
    (kind === "ranking" && matchedVendors.length === 0
      ? VENDORS
      : matchedVendors).flatMap((vendor) => vendor.officialDomains),
  );
  const rankingVendors = kind === "ranking" && matchedVendors.length === 0
    ? VENDORS
    : matchedVendors;
  const searchQueries = kind === "ranking" && rankingVendors.length > 0
    ? unique([
      ...buildRankingVendorFlagshipQueries(rankingVendors),
      ...buildAiModelSearchQueries(text, officialDomains, vendorSnippets, kind),
    ])
    : buildAiModelSearchQueries(text, officialDomains, vendorSnippets, kind);

  if (kind === "ranking") {
    queriesPush(searchQueries, [
      `${text} benchmark leaderboard`,
      `${text} flagship model official`,
      "latest frontier AI models official releases",
      "frontier AI model reasoning coding official releases",
      "OpenAI Anthropic Google xAI Meta DeepSeek Mistral flagship models official",
    ]);
  } else if (kind === "comparison") {
    queriesPush(searchQueries, [
      `${text} benchmark`,
      `${text} official specs`,
      comparisonAxisCount > 1 || comparisonAxisCount === 0
        ? `${text} reasoning coding latency price release date`
        : "",
    ]);
  }

  for (const snippet of vendorSnippets.slice(0, 4)) {
    searchQueries.push(`${snippet} official`);
  }
  for (const vendor of matchedVendors.slice(0, 3)) {
    const snippets = extractVendorModelSnippets(text, vendor);
    for (const snippet of snippets.slice(0, 2)) {
      for (const domain of vendor.officialDomains.slice(0, 2)) {
        searchQueries.push(`${snippet} site:${domain}`);
      }
    }
  }

  return {
    mode: "web_search",
    kind,
    officialDomains,
    searchQueries: unique(searchQueries),
  };
}

function queriesPush(target: string[], values: string[]) {
  for (const value of values) {
    if (value.trim()) {
      target.push(value.trim());
    }
  }
}
