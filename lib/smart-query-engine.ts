// lib/smart-query-engine.ts
// ─────────────────────────────────────────────────────────────────────────────
// SMART QUERY EXPANSION ENGINE
// Generates domain-optimized, multi-strategy search queries.
// Perplexity's superpower is knowing WHAT to search — this replicates it.
// ─────────────────────────────────────────────────────────────────────────────

export type QueryStrategy =
  | "exact"           // Direct question rephrasing
  | "entity"          // Extract and search for key entities
  | "authority"       // Target authoritative sources
  | "recency"         // Time-bound for freshness
  | "comparison"      // Comparison-specific framing
  | "academic"        // Academic/research angle
  | "how_to"          // Instructional framing
  | "definition"      // Definition/explanation framing
  | "news"            // News and current events
  | "data";           // Statistics and data points

export interface ExpandedQuery {
  query: string;
  strategy: QueryStrategy;
  priority: number;   // 1 (highest) → 5 (lowest)
  rationale: string;
}

export interface QueryExpansionResult {
  original: string;
  canonical: string;          // Cleaned, normalized question
  domain: string;             // Detected domain
  queries: ExpandedQuery[];
  entityHints: string[];      // Key entities to track in results
  temporalScope?: string;     // Date range if time-sensitive
  authorityDomains?: string[]; // Preferred domains for this query type
}

// ─── Domain detection ────────────────────────────────────────────────────────

type QueryDomain =
  | "technology"
  | "finance"
  | "health"
  | "science"
  | "law"
  | "history"
  | "sports"
  | "entertainment"
  | "politics"
  | "education"
  | "travel"
  | "food"
  | "coding"
  | "math"
  | "general";

function detectDomain(question: string): QueryDomain {
  const q = question.toLowerCase();

  const patterns: Array<[QueryDomain, RegExp]> = [
    ["coding", /\b(code|program|function|debug|api|library|framework|javascript|python|rust|typescript|react|sql|git|docker|kubernetes|aws|gcp|azure|npm|webpack|node)\b/],
    ["math", /\b(calculate|equation|formula|integral|derivative|probability|statistics|algebra|geometry|theorem|proof|solve|matrix)\b/],
    ["finance", /\b(stock|invest|market|crypto|bitcoin|nse|bse|mutual fund|rupee|dollar|profit|revenue|gdp|inflation|interest rate|loan|mortgage|portfolio|return|ipo|sensex|nifty)\b/],
    ["health", /\b(disease|symptom|medicine|drug|treatment|diagnosis|cancer|diabetes|heart|blood|immune|surgery|hospital|diet|nutrition|mental health|anxiety|depression)\b/],
    ["science", /\b(physics|chemistry|biology|quantum|molecular|cellular|dna|evolution|climate|energy|particle|atom|experiment|research|discovery)\b/],
    ["law", /\b(legal|law|court|case|judgment|act|section|ipc|constitution|rights|liability|contract|patent|copyright|dispute|attorney|advocate)\b/],
    ["technology", /\b(ai|machine learning|llm|gpt|cloud|saas|startup|software|hardware|processor|chip|semiconductor|5g|iot|blockchain|cyber|data center)\b/],
    ["history", /\b(century|war|ancient|history|historical|empire|kingdom|revolution|independence|civilization|dynasty|colonialism|world war)\b/],
    ["sports", /\b(cricket|football|tennis|basketball|ipl|fifa|nba|olympics|player|match|tournament|championship|team|score|wicket|goal|run)\b/],
    ["entertainment", /\b(movie|film|series|actor|director|music|song|album|streaming|netflix|bollywood|hollywood|award|oscar|grammy)\b/],
    ["politics", /\b(government|election|minister|parliament|policy|party|vote|democracy|president|prime minister|modi|biden|trump|congress|senate)\b/],
    ["education", /\b(university|college|course|exam|degree|upsc|jee|neet|scholarship|study|curriculum|syllabus|teacher|student|school)\b/],
    ["travel", /\b(destination|hotel|flight|visa|tourism|itinerary|passport|airport|tour|travel|country|city|trip|backpack|hostel)\b/],
    ["food", /\b(recipe|ingredient|cooking|dish|restaurant|cuisine|calorie|protein|vegetarian|vegan|spice|flavor|bake|grill|fry)\b/],
  ];

  for (const [domain, pattern] of patterns) {
    if (pattern.test(q)) return domain;
  }

  return "general";
}

// ─── Authority domain map ─────────────────────────────────────────────────────

const AUTHORITY_DOMAINS: Record<QueryDomain, string[]> = {
  technology: ["techcrunch.com", "wired.com", "arstechnica.com", "theverge.com", "hbr.org"],
  finance: ["economictimes.indiatimes.com", "moneycontrol.com", "investopedia.com", "bloomberg.com", "wsj.com"],
  health: ["who.int", "cdc.gov", "webmd.com", "mayoclinic.org", "nih.gov"],
  science: ["nature.com", "science.org", "scientificamerican.com", "arxiv.org", "pubmed.ncbi.nlm.nih.gov"],
  law: ["sci.gov.in", "barandbench.com", "livelaw.in", "law.cornell.edu", "legislation.gov.uk"],
  history: ["britannica.com", "history.com", "bbc.co.uk", "nationalgeographic.com"],
  sports: ["espncricinfo.com", "espn.com", "bbc.com/sport", "cricbuzz.com", "sportskeeda.com"],
  entertainment: ["rottentomatoes.com", "imdb.com", "variety.com", "hollywoodreporter.com"],
  politics: ["thehindu.com", "reuters.com", "apnews.com", "bbc.com/news", "ndtv.com"],
  education: ["ug.edu.in", "ugc.ac.in", "education.gov.in", "khanacademy.org", "coursera.org"],
  travel: ["lonelyplanet.com", "tripadvisor.com", "skyscanner.com", "nytimes.com/travel"],
  food: ["allrecipes.com", "seriouseats.com", "bonappetit.com", "foodnetwork.com"],
  coding: ["stackoverflow.com", "github.com", "developer.mozilla.org", "docs.python.org", "devdocs.io"],
  math: ["wolframalpha.com", "khanacademy.org", "mathworld.wolfram.com", "betterexplained.com"],
  general: ["wikipedia.org", "britannica.com", "bbc.com", "reuters.com"],
};

// ─── Temporal scope detector ──────────────────────────────────────────────────

function detectTemporalScope(question: string): string | undefined {
  const q = question.toLowerCase();
  if (/\b(today|right now|currently|live|breaking)\b/.test(q)) return "last 24 hours";
  if (/\b(this week|last week|recent|latest)\b/.test(q)) return "last 7 days";
  if (/\b(this month|last month|recently)\b/.test(q)) return "last 30 days";
  if (/\b(this year|2025|2024)\b/.test(q)) return "2024–2025";
  if (/\b(last year|2023)\b/.test(q)) return "2023–2024";
  return undefined;
}

// ─── Entity extractor ────────────────────────────────────────────────────────

function extractEntities(question: string): string[] {
  const words = question.split(/\s+/);
  const entities: string[] = [];

  // Proper nouns (capitalized words that aren't at sentence start)
  const properNouns = words
    .slice(1)
    .filter((w) => /^[A-Z][a-z]{2,}/.test(w) && !["The", "This", "That", "When", "What", "How"].includes(w));
  entities.push(...properNouns.slice(0, 3));

  // Known product/company patterns
  const knownPatterns = /\b(GPT|ChatGPT|Claude|Gemini|iPhone|Android|React|Python|JavaScript|TypeScript|Node\.js|Docker|Kubernetes|AWS|GCP|Azure|Tesla|Apple|Google|Microsoft|Meta|Amazon|OpenAI|Anthropic|NVIDIA|Bitcoin|Ethereum)\b/g;
  const matches = question.match(knownPatterns) ?? [];
  entities.push(...matches);

  return [...new Set(entities)];
}

// ─── Query generator per strategy ────────────────────────────────────────────

function generateStrategicQueries(
  question: string,
  domain: QueryDomain,
  entities: string[],
  temporal?: string,
): ExpandedQuery[] {
  const q = question.trim();
  const queries: ExpandedQuery[] = [];
  const currentYear = new Date().getFullYear();

  // Strategy 1: Exact rephrasing (always first)
  queries.push({
    query: q,
    strategy: "exact",
    priority: 1,
    rationale: "Direct question as the primary search intent.",
  });

  // Strategy 2: Entity-focused
  if (entities.length > 0) {
    queries.push({
      query: `${entities.slice(0, 2).join(" ")} ${extractKeyVerb(q)}`.trim(),
      strategy: "entity",
      priority: 2,
      rationale: `Focused on key entities: ${entities.slice(0, 2).join(", ")}.`,
    });
  }

  // Strategy 3: Domain authority framing
  queries.push({
    query: buildAuthorityQuery(q, domain, currentYear),
    strategy: "authority",
    priority: 2,
    rationale: `Targeted at authoritative ${domain} sources.`,
  });

  // Strategy 4: Recency-boosted (if temporal)
  if (temporal || isRealtimeQuestion(q)) {
    queries.push({
      query: `${q} ${currentYear}`,
      strategy: "recency",
      priority: 2,
      rationale: "Time-bounded for freshness.",
    });
  }

  // Strategy 5: Domain-specific framing
  const domainQuery = buildDomainSpecificQuery(q, domain);
  if (domainQuery !== q) {
    queries.push({
      query: domainQuery,
      strategy: "academic",
      priority: 3,
      rationale: `${domain}-optimized query framing.`,
    });
  }

  // Strategy 6: Data/statistics angle
  if (isDataQuestion(q)) {
    queries.push({
      query: `${q} statistics data ${currentYear}`,
      strategy: "data",
      priority: 3,
      rationale: "Targeting quantitative data sources.",
    });
  }

  // Strategy 7: How-to framing for instructional questions
  if (/\b(how|steps|guide|tutorial)\b/.test(q.toLowerCase())) {
    queries.push({
      query: `step by step ${q}`,
      strategy: "how_to",
      priority: 3,
      rationale: "Instructional framing for higher-quality guides.",
    });
  }

  // Remove duplicates and return top 5
  const seen = new Set<string>();
  return queries
    .filter((qe) => {
      const key = qe.query.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return qe.query.length > 3;
    })
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 5);
}

function extractKeyVerb(question: string): string {
  const words = question.toLowerCase().split(/\s+/);
  const verbs = ["is", "are", "was", "were", "has", "have", "can", "could", "will", "does", "do"];
  const keyWords = words.filter((w) => !verbs.includes(w) && w.length > 3);
  return keyWords.slice(0, 3).join(" ");
}

function buildAuthorityQuery(question: string, domain: QueryDomain, year: number): string {
  const domainTriggers: Record<string, string> = {
    technology: `${question} site:techcrunch.com OR site:wired.com`,
    finance: `${question} ${year} report analysis`,
    health: `${question} clinical evidence research`,
    science: `${question} peer reviewed study`,
    coding: `${question} best practices documentation`,
    law: `${question} legal framework India`,
    general: `${question} expert analysis`,
  };

  return domainTriggers[domain] ?? `${question} expert analysis ${year}`;
}

function buildDomainSpecificQuery(question: string, domain: QueryDomain): string {
  const prefixes: Partial<Record<QueryDomain, string>> = {
    finance: "financial analysis",
    health: "medical research",
    science: "scientific explanation",
    law: "legal analysis India",
    coding: "technical documentation",
    math: "mathematical solution",
  };

  const prefix = prefixes[domain];
  if (prefix) return `${prefix}: ${question}`;
  return question;
}

function isRealtimeQuestion(q: string): boolean {
  return /\b(today|now|current|latest|recent|price|stock|news|live|breaking)\b/.test(q.toLowerCase());
}

function isDataQuestion(q: string): boolean {
  return /\b(how many|percentage|rate|number of|statistics|data|report|survey|study|growth|market size)\b/.test(q.toLowerCase());
}

// ─── Main expand function ─────────────────────────────────────────────────────

export function expandQuery(question: string): QueryExpansionResult {
  const canonical = canonicalizeQuestion(question);
  const domain = detectDomain(canonical);
  const entities = extractEntities(canonical);
  const temporal = detectTemporalScope(canonical);
  const queries = generateStrategicQueries(canonical, domain, entities, temporal);

  return {
    original: question,
    canonical,
    domain,
    queries,
    entityHints: entities,
    temporalScope: temporal,
    authorityDomains: AUTHORITY_DOMAINS[domain],
  };
}

function canonicalizeQuestion(question: string): string {
  return question
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s\-.,?!'"]/g, "")
    .replace(/\?+$/, "?");
}

// ─── Query scorer (ranks incoming search results) ─────────────────────────────

export function scoreQueryRelevance(
  sourceUrl: string,
  sourceDomain: string,
  preferredDomains: string[],
): number {
  const url = sourceUrl.toLowerCase();
  const domain = sourceDomain.toLowerCase();

  for (const preferred of preferredDomains) {
    if (domain.includes(preferred) || url.includes(preferred)) return 1.0;
  }

  // Partial match
  const tld = domain.split(".").slice(-2).join(".");
  if (preferredDomains.some((d) => d.includes(tld) || tld.includes(d.split(".")[0]))) return 0.8;

  return 0.5;
}

// ─── Follow-up generator (post-answer) ───────────────────────────────────────

export function generateSmartFollowUps(
  question: string,
  domain: QueryDomain,
  entities: string[],
): string[] {
  const entity = entities[0] ?? "this topic";
  const domainFollowUps: Record<QueryDomain, string[]> = {
    technology: [
      `What are the latest developments in ${entity}?`,
      `How does ${entity} compare to its competitors?`,
      `What are the security implications of ${entity}?`,
      `What's the future roadmap for ${entity}?`,
    ],
    finance: [
      `What are the risk factors for ${entity}?`,
      `How has ${entity} performed historically?`,
      `What do analysts say about ${entity}?`,
      `How does this affect my portfolio?`,
    ],
    health: [
      `What are the treatment options for ${entity}?`,
      `Are there any clinical trials for ${entity}?`,
      `What do specialists recommend for ${entity}?`,
      `What lifestyle changes help with ${entity}?`,
    ],
    science: [
      `What does the latest research say about ${entity}?`,
      `How is ${entity} being applied practically?`,
      `What are the unanswered questions about ${entity}?`,
      `Who are the leading researchers on ${entity}?`,
    ],
    coding: [
      `Can you show me a working example?`,
      `What are common bugs and how to fix them?`,
      `How does this scale in production?`,
      `What are the alternatives to this approach?`,
    ],
    law: [
      `What are the recent court judgments on this?`,
      `What is the exact legal procedure?`,
      `Are there any exceptions to this rule?`,
      `What penalties apply for violation?`,
    ],
    general: [
      `Can you explain this in more detail?`,
      `What are the main controversies around this?`,
      `What are the practical implications?`,
      `Who are the leading experts on this?`,
    ],
    history: [`What were the key causes?`, `Who were the major figures?`, `What were the long-term effects?`, `How does this compare to similar events?`],
    sports: [`What do the statistics say?`, `How has performance changed recently?`, `What are the upcoming events?`, `What's the expert analysis?`],
    entertainment: [`What are the critics saying?`, `How does it compare to similar works?`, `What are the box office numbers?`, `What's next from the creator?`],
    politics: [`What do different parties say?`, `What are the policy implications?`, `How does this affect voters?`, `What's the historical precedent?`],
    education: [`What are the career prospects?`, `What are the top institutions for this?`, `What skills are required?`, `How long does this take?`],
    travel: [`What's the best time to visit?`, `What are the visa requirements?`, `What are the must-see attractions?`, `What's the estimated budget?`],
    food: [`Can I substitute any ingredients?`, `What wine pairs well with this?`, `What are the nutrition facts?`, `Are there any variations of this dish?`],
    math: [`Can you show the step-by-step solution?`, `What formula was used?`, `Are there other methods to solve this?`, `What does this result mean in practice?`],
  };

  return (domainFollowUps[domain] ?? domainFollowUps.general).slice(0, 4);
}

export { detectDomain };
export type { QueryDomain };
