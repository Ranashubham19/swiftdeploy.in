import {
  CURATED_FREE_MODEL_POOLS,
  FORCE_OPENROUTER_FREE_ONLY_MODE as SHARED_FORCE_OPENROUTER_FREE_ONLY_MODE,
  isCuratedStrongFreeModelId,
  isFreeOnlyApprovedModelId as sharedIsFreeOnlyApprovedModelId,
  OPENROUTER_FREE_MODEL_ID as SHARED_OPENROUTER_FREE_MODEL_ID,
} from './src/openrouter/models.js';

type ChatHistory = { role: 'user' | 'model'; parts: { text: string }[] }[];
type RetrievalDoc = { title: string; snippet: string; url?: string; source: string };
type IntentType = 'math' | 'current_event' | 'coding' | 'general';

export type AIRuntimeConfig = { provider?: string; model?: string; forceProvider?: boolean };

const FAST_REPLY_MODE = (process.env.FAST_REPLY_MODE || 'false').trim().toLowerCase() !== 'false';
const SUPER_FAST_RESPONSE_MODE = (process.env.SUPER_FAST_RESPONSE_MODE || 'true').trim().toLowerCase() !== 'false';
const WEB_TIMEOUT_MS = parseInt(process.env.WEB_TIMEOUT_MS || (FAST_REPLY_MODE ? '1800' : '3500'), 10);
const WEB_MAX_SNIPPETS = parseInt(process.env.WEB_MAX_SNIPPETS || (FAST_REPLY_MODE ? '3' : '5'), 10);
const WEB_MAX_CHARS = 2500;
const STRICT_TEMPORAL_GROUNDING = (process.env.STRICT_TEMPORAL_GROUNDING || 'false').toLowerCase() !== 'false';
const ALWAYS_WEB_RETRIEVAL = (process.env.ALWAYS_WEB_RETRIEVAL || 'false').toLowerCase() !== 'false';
const RETRIEVAL_CACHE_TTL_MS = 5 * 60 * 1000;
const RETRIEVAL_MAX_QUERIES = parseInt(process.env.RETRIEVAL_MAX_QUERIES || (FAST_REPLY_MODE ? '1' : '2'), 10);
const retrievalCache = new Map<string, { docs: RetrievalDoc[]; expiresAt: number }>();
const MODEL_TEMPERATURE = parseFloat(process.env.AI_TEMPERATURE || '0.25');
const MODEL_TOP_P = 0.8;
const MODEL_MAX_TOKENS = Math.max(1800, parseInt(process.env.AI_MAX_TOKENS || (FAST_REPLY_MODE ? '1800' : '2600'), 10));
const HISTORY_TOKEN_BUDGET = parseInt(process.env.HISTORY_TOKEN_BUDGET || '6000', 10);
const OPENROUTER_MAX_MODEL_ATTEMPTS_RAW = parseInt(
  process.env.OPENROUTER_MAX_MODEL_ATTEMPTS || (SUPER_FAST_RESPONSE_MODE ? '3' : '5'),
  10
);
const OPENROUTER_MAX_MODEL_ATTEMPTS = Math.max(
  1,
  Math.min(
    SUPER_FAST_RESPONSE_MODE ? 4 : 6,
    Number.isFinite(OPENROUTER_MAX_MODEL_ATTEMPTS_RAW)
      ? OPENROUTER_MAX_MODEL_ATTEMPTS_RAW
      : (SUPER_FAST_RESPONSE_MODE ? 3 : 5)
  )
);
const OPENROUTER_MIN_TIMEOUT_MS = process.env.NODE_ENV === 'production' ? 8000 : 7000;
const OPENROUTER_TIMEOUT_CAP_MS = SUPER_FAST_RESPONSE_MODE ? 20000 : 45000;
const OPENROUTER_REQUEST_TIMEOUT_MS = Math.min(
  OPENROUTER_TIMEOUT_CAP_MS,
  Math.max(
    OPENROUTER_MIN_TIMEOUT_MS,
    parseInt(process.env.OPENROUTER_TIMEOUT_MS || (FAST_REPLY_MODE ? '14000' : '18000'), 10)
  )
);
const OPENROUTER_MAX_RETRIES_RAW = parseInt(
  process.env.OPENROUTER_MAX_RETRIES || (SUPER_FAST_RESPONSE_MODE ? '0' : '1'),
  10
);
const OPENROUTER_MAX_RETRIES = Math.max(
  0,
  Math.min(
    SUPER_FAST_RESPONSE_MODE ? 0 : 3,
    Number.isFinite(OPENROUTER_MAX_RETRIES_RAW)
      ? OPENROUTER_MAX_RETRIES_RAW
      : (SUPER_FAST_RESPONSE_MODE ? 0 : 1)
  )
);
const OPENROUTER_RETRY_BASE_DELAY_MS = Math.max(
  300,
  parseInt(process.env.OPENROUTER_RETRY_BASE_DELAY_MS || '900', 10)
);
const OPENROUTER_FREE_MODEL_ID = SHARED_OPENROUTER_FREE_MODEL_ID;
const FORCE_OPENROUTER_FREE_ONLY_MODE = SHARED_FORCE_OPENROUTER_FREE_ONLY_MODE;
const HARD_LOCK_NVIDIA_MODEL = (process.env.HARD_LOCK_NVIDIA_MODEL || 'true').trim().toLowerCase() !== 'false';
const LOCKED_NVIDIA_MODEL_ID = (
  process.env.NVIDIA_MODEL
  || process.env.DEFAULT_MODEL
  || process.env.OPENROUTER_MODEL
  || CURATED_FREE_MODEL_POOLS.general[0]
  || 'meta/llama-3.3-70b-instruct'
).trim();
const LOCKED_NVIDIA_BASE_URL = (
  process.env.NVIDIA_BASE_URL
  || process.env.OPENROUTER_BASE_URL
  || 'https://integrate.api.nvidia.com/v1/chat/completions'
).trim();
const NVIDIA_KEY_PREFIX = 'nvapi-';
const DEFAULT_NVIDIA_FALLBACK_MODELS = [
  'meta/llama-3.3-70b-instruct',
  'meta/llama-3.1-8b-instruct',
  'moonshotai/kimi-k2.5',
] as const;
const SUPER_FAST_PRIORITY_MODELS = [
  'meta/llama-3.1-8b-instruct',
  'meta/llama-3.3-70b-instruct',
  'meta/llama-3.1-70b-instruct',
] as const;
const GEMINI_API_KEY = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-1.5-flash').trim();
const GEMINI_BASE_URL = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').trim().replace(/\/+$/, '');
const GEMINI_REQUEST_TIMEOUT_MS = Math.max(
  6000,
  parseInt(process.env.GEMINI_TIMEOUT_MS || (FAST_REPLY_MODE ? '14000' : '26000'), 10)
);
const GEMINI_MAX_RETRIES = Math.max(
  0,
  Math.min(3, parseInt(process.env.GEMINI_MAX_RETRIES || '1', 10))
);
const GEMINI_RETRY_BASE_DELAY_MS = Math.max(
  300,
  parseInt(process.env.GEMINI_RETRY_BASE_DELAY_MS || '800', 10)
);

const isOpenRouterFreeLikeModelId = (modelId?: string | null): boolean =>
  sharedIsFreeOnlyApprovedModelId(modelId);

const resolveLockedNvidiaApiKey = (): string => {
  const apiKey = (
    process.env.NVIDIA_API_KEY
    || process.env.OPENROUTER_API_KEY
    || ''
  ).trim();
  if (!apiKey) {
    throw new Error('NVIDIA_API_KEY_MISSING');
  }
  if (!apiKey.startsWith(NVIDIA_KEY_PREFIX)) {
    throw new Error('NVIDIA_API_KEY_INVALID_FORMAT');
  }
  return apiKey;
};

const getAdaptiveOpenRouterRequestProfile = (prompt: string): { maxTokens: number; timeoutMs: number } => {
  const text = String(prompt || '');
  const normalized = text.toLowerCase();
  const looksComplex =
    text.length > 700
    || /\b(explain|detailed|detail|deep dive|step by step|comprehensive|compare|comparison|difference|top\s+\d+|list|guide|roadmap|analysis|architecture|design|strategy|full|complete)\b/.test(normalized);

  if (!looksComplex) {
    return { maxTokens: MODEL_MAX_TOKENS, timeoutMs: OPENROUTER_REQUEST_TIMEOUT_MS };
  }

  return {
    maxTokens: Math.max(MODEL_MAX_TOKENS, Math.min(3600, MODEL_MAX_TOKENS + 800)),
    timeoutMs: SUPER_FAST_RESPONSE_MODE
      ? Math.max(OPENROUTER_REQUEST_TIMEOUT_MS, 15000)
      : Math.max(OPENROUTER_REQUEST_TIMEOUT_MS, 45000)
  };
};

const getAdaptiveOpenRouterSamplingProfile = (
  prompt: string,
  modelId: string
): { temperature: number; topP: number } => {
  const normalized = String(prompt || '').toLowerCase();
  const intent = detectIntent(normalized);
  const looksComplex =
    normalized.length > 500
    || /\b(explain|detailed|detail|deep dive|step by step|comprehensive|compare|comparison|difference|top\s+\d+|list|guide|roadmap|analysis|architecture|design|strategy|full|complete)\b/.test(normalized);

  let temperature = MODEL_TEMPERATURE;
  let topP = MODEL_TOP_P;

  if (intent === 'coding') {
    temperature = Math.min(temperature, 0.12);
    topP = Math.min(topP, 0.75);
  } else if (intent === 'math') {
    temperature = Math.min(temperature, 0.1);
    topP = Math.min(topP, 0.7);
  } else if (looksComplex) {
    temperature = Math.min(temperature, 0.18);
    topP = Math.min(topP, 0.78);
  }

  if (isOpenRouterFreeLikeModelId(modelId) && looksComplex) {
    temperature = Math.min(temperature, 0.16);
    topP = Math.min(topP, 0.75);
  }

  return { temperature, topP };
};

const REALTIME_KEYWORDS = ["2024", "2025", "2026", "today", "latest", "right now", "as of", "breaking news"];
const REALTIME_INTENT_PATTERNS = /(richest|top\s+\d+|top company|best phone|prime minister|president|ceo|stock price|net worth|market cap|breaking news|rank(ing)?|leader|what is the current)/;
const REALTIME_CONTEXT_PATTERN =
  /\bcurrent\s+(price|market|ceo|president|prime minister|ranking|rank|news|gdp|population|revenue|net worth|weather|score|stock|market cap)\b/;
const LOGIC_MATH_WORD_PROBLEM_PATTERN =
  /(\bproduct\b.*\bsum\b|\bsum\b.*\bproduct\b).*\b(age|ages|daughters?|sons?|children|numbers?)\b|\bhouse number\b.*\bage|ages\b|\boldest\b.*\b(age|daughter|son)\b/;

const isGenericCodingIntentPrompt = (text: string): boolean => {
  const q = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return false;
  const shortGenericCoding =
    q.split(' ').length <= 5
    && /\b(coding|code)\b/.test(q)
    && !/\b(write|implement|debug|fix|solve|function|class|algorithm|leetcode|in\s+\w+|for\s+\w+)\b/.test(q);
  if (shortGenericCoding) return true;
  if (/^(coding|code)\b/.test(q) && q.split(' ').length <= 3) return true;
  if (/^(ok\s+)?i (want|need|like)\s+(coding|code)\b/.test(q) && q.split(' ').length <= 8) return true;
  if (/^(know|learn|teach me)\s+(coding|code)\b/.test(q) && q.split(' ').length <= 8) return true;
  if (/^(can you|could you|do you)\s+(help|support)\s+(with\s+)?coding\b/.test(q) && q.split(' ').length <= 10) return true;
  return false;
};

export const needsRealtimeSearch = (userMessage: string): boolean => {
  const msg = String(userMessage || '').toLowerCase();
  const hasCoreRealtimeKeyword = REALTIME_KEYWORDS.some((k) => msg.includes(k));
  const hasContextualCurrent = REALTIME_CONTEXT_PATTERN.test(msg);
  return hasCoreRealtimeKeyword || hasContextualCurrent || REALTIME_INTENT_PATTERNS.test(msg);
};

const detectIntent = (text: string): IntentType => {
  const q = String(text || '').toLowerCase();
  if (isGenericCodingIntentPrompt(q)) return 'general';
  if (
    (/\bwhat\s+is\s+(an?\s+)?api\b/.test(q) || /\bwhat\s+does\s+api\s+stand\s+for\b/.test(q))
    && !/\b(build|create|write|implement|endpoint|route|request|response|rest|graphql|sdk|code)\b/.test(q)
  ) {
    return 'general';
  }
  const codingKeywordPattern =
    /\b(code+|cod|coding|bug|debug|typescript|javascript|python|sql|regex|api|function|class|compile|error|stack trace|program(?:ming)?|script|algorithm|c\+\+|cpp|c#|csharp|java|node|react|leetcode|dsa)\b/;
  const codingTypoPattern = /\b(codee+|codd?e|programing|pyhton|typscript|javascritp)\b/;
  const codingVerbPattern = /\b(write|generate|create|build|make|give|provide|implement|develop)\b/;
  const codingLanguagePattern =
    /\b(c\+\+|cpp|c#|csharp|python|javascript|typescript|java|go|golang|rust|php|ruby|swift|kotlin|sql|html|css|react|node(?:\.?js)?)\b/;
  const codeSyntaxSignalPattern =
    /```|#include\s*<|def\s+\w+\s*\(|class\s+\w+|public\s+class\s+\w+/;
  const algorithmChallengePattern =
    /\b(you are given|given (?:an?|the)\b|return\b|constraints?\b|input\b|output\b|time complexity|space complexity|array\b|matrix\b|grid\b|linked list\b|binary tree\b|graph\b|dynamic programming|dp\b|two pointers|sliding window|prefix sum|heap\b|stack\b|queue\b)\b/;
  const algorithmActionPattern = /\b(trap|detect|count|find|compute|minimize|maximize|shortest|longest|path|cycle|sum)\b/;
  const looksLogicMathWordProblem =
    LOGIC_MATH_WORD_PROBLEM_PATTERN.test(q)
    || (
      /\b(hint|hints|clue|riddle|puzzle|guess|determine)\b/.test(q)
      && /\b(age|ages|sum|product|number|numbers)\b/.test(q)
      && /\b\d+\b/.test(q)
    );
  if (
    (algorithmChallengePattern.test(q) && algorithmActionPattern.test(q))
    || (/hard question/.test(q) && /\b(return|given|grid|array|linked list|tree|graph)\b/.test(q))
  ) {
    return 'coding';
  }
  if (/(^|\s)(solve|calculate|what is|evaluate)\s+[-+*/().\d\s]{3,}$/.test(q) || /[-+*/()]/.test(q) && /\d/.test(q) && q.length < 100) {
    return 'math';
  }
  if (looksLogicMathWordProblem) {
    return 'math';
  }
  if (
    codingKeywordPattern.test(q)
    || codingTypoPattern.test(q)
    || (codingVerbPattern.test(q) && codingLanguagePattern.test(q))
    || codeSyntaxSignalPattern.test(q)
  ) {
    return 'coding';
  }
  if (needsRealtimeSearch(q) || /(news|election|gdp|stock|price|market|as of)/.test(q)) {
    return 'current_event';
  }
  return 'general';
};

const stripHtml = (input: string): string => {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs))
  ]);
};

const waitMs = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
};

const fetchDuckDuckGoContext = async (query: string): Promise<RetrievalDoc[]> => {
  const encoded = encodeURIComponent(query);
  const response = await withTimeout(fetch(`https://duckduckgo.com/html/?q=${encoded}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SwiftDeployBot/1.0)' }
  }), WEB_TIMEOUT_MS);
  if (!response.ok) return [];
  const html = await response.text();
  const resultBlocks = html.match(/<div[^>]*class="[^"]*result[^"]*"[^>]*>[\s\S]*?<\/div>\s*<\/div>/g) || [];
  const snippets: RetrievalDoc[] = [];
  for (const block of resultBlocks.slice(0, WEB_MAX_SNIPPETS * 2)) {
    const titleMatch = block.match(/<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    const hrefMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"/);
    const snippetMatch = block.match(/<[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/);
    const title = stripHtml(titleMatch?.[1] || '');
    const href = stripHtml(hrefMatch?.[1] || '');
    const snippet = stripHtml(snippetMatch?.[1] || '');
    if (title || snippet) snippets.push({ title, snippet, url: href, source: 'duckduckgo' });
    if (snippets.length >= WEB_MAX_SNIPPETS) break;
  }
  return snippets;
};

const fetchWikipediaContext = async (query: string): Promise<RetrievalDoc[]> => {
  const encoded = encodeURIComponent(query);
  const response = await withTimeout(fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&utf8=1&format=json&srlimit=${WEB_MAX_SNIPPETS}`), WEB_TIMEOUT_MS);
  if (!response.ok) return [];
  const data: any = await response.json().catch(() => ({}));
  const results = Array.isArray(data?.query?.search) ? data.query.search : [];
  return results
    .slice(0, WEB_MAX_SNIPPETS)
    .map((r: any) => ({
      title: stripHtml(r?.title || ''),
      snippet: stripHtml(r?.snippet || ''),
      url: r?.pageid ? `https://en.wikipedia.org/?curid=${r.pageid}` : '',
      source: 'wikipedia'
    }))
    .filter((x: RetrievalDoc) => Boolean(x.title || x.snippet));
};

const fetchSerperContext = async (query: string): Promise<RetrievalDoc[]> => {
  const key = (process.env.SERPER_API_KEY || '').trim();
  if (!key) return [];
  const response = await withTimeout(fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ q: query, num: WEB_MAX_SNIPPETS })
  }), WEB_TIMEOUT_MS);
  if (!response.ok) return [];
  const data: any = await response.json().catch(() => ({}));
  const organic = Array.isArray(data?.organic) ? data.organic : [];
  return organic.slice(0, WEB_MAX_SNIPPETS).map((r: any) => ({
    title: stripHtml(r?.title || ''),
    snippet: stripHtml(r?.snippet || ''),
    url: stripHtml(r?.link || ''),
    source: 'serper'
  })).filter((x: RetrievalDoc) => Boolean(x.title || x.snippet));
};

const buildSearchQueries = (prompt: string): string[] => {
  const base = prompt.trim();
  const year = new Date().getUTCFullYear();
  return Array.from(new Set([base, `${base} latest ${year}`].map((x) => x.trim()).filter(Boolean))).slice(0, RETRIEVAL_MAX_QUERIES);
};

const FALLBACK_QUERY_CORRECTIONS: Record<string, string> = {
  epistein: 'epstein',
  epstien: 'epstein',
  epstine: 'epstein',
  joffery: 'joffrey',
  jofrey: 'joffrey',
  joffreyy: 'joffrey',
  jofferey: 'joffrey',
  einstien: 'einstein',
  einsten: 'einstein',
  modie: 'modi',
  pyhton: 'python',
  javasript: 'javascript',
  javscript: 'javascript'
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const correctFallbackQueryTokens = (input: string): string => {
  return String(input || '').replace(/\b[a-z][a-z0-9_-]*\b/gi, (token) => {
    const corrected = FALLBACK_QUERY_CORRECTIONS[token.toLowerCase()];
    return corrected || token;
  });
};

const isDefinitionPrompt = (input: string): boolean => {
  const q = String(input || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return /^(who|what|where|when|which|meaning|definition|define|tell me about|explain)\b/.test(q)
    || /\b(who is|what is|meaning of|definition of|tell me about)\b/.test(q);
};

const extractDefinitionTopic = (input: string): string => {
  let value = String(input || '')
    .toLowerCase()
    .replace(/^current user question:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return '';

  const leadPatterns = [
    /^(ok(?:ay)?|hey|hello|hi|hii|yo|please|pls)\b[\s,.:;!?-]*/i,
    /^(can you|could you|would you|will you|kindly|tell me|explain|define|describe|help me understand|i want to know|do you know)\b[\s,.:;!?-]*/i,
    /^(what(?:'s| is)|who(?:'s| is)|where(?:'s| is)|when(?:'s| is)|which(?:'s| is)|what are|who are|where are|meaning of|definition of|tell me about)\b[\s,.:;!?-]*/i
  ];
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of leadPatterns) {
      const next = value.replace(pattern, '').trim();
      if (next !== value) {
        value = next;
        changed = true;
      }
    }
  }
  value = value
    .replace(/[?!.]+$/g, '')
    .replace(/^(a|an|the)\s+/i, '')
    .trim();
  return value.slice(0, 120);
};

const sanitizeFallbackSentence = (input: string): string => {
  return String(input || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
};

const stripDeterministicFallbackArtifacts = (
  input: string,
  options?: { keepSourceUrls?: boolean }
): string => {
  let out = sanitizeFallbackSentence(input);
  if (!out) return out;

  out = out
    .replace(/\bWikifunctions has a function related to this topic\.?/gi, '')
    .replace(/\b(?:Wiktionary|Wikidata|Wikiquote|Wikimedia Commons)\b/gi, '')
    .replace(/\bmay refer to\b/gi, '')
    .replace(/\bdisambiguation\b/gi, '')
    .replace(/\(\s*https?:\/\/[^\)]{1,220}\)/gi, '')
    .replace(/\bhttps?:\/\/en\.wikipedia\.org\/\?curid=\d+\b/gi, '')
    .replace(/\/pl\.\s*n\.\s*drom\//gi, '')
    .replace(/\/\s*[a-z](?:[\s.]*[a-z]){3,20}\s*\//gi, '')
    .replace(/\bsource\s*:?\s*https?:\/\/[^\s<>"'`]+/gi, '')
    .replace(/\bsource\s*:\s*$/gi, '')
    .replace(/\s+\(\s*\)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!options?.keepSourceUrls) {
    out = out.replace(/\bhttps?:\/\/[^\s<>"'`]+/gi, '').replace(/\s{2,}/g, ' ').trim();
  }

  return out;
};

const normalizeComparableFallbackSentence = (input: string): string =>
  String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const splitFallbackSentences = (input: string): string[] =>
  String(input || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => stripDeterministicFallbackArtifacts(s))
    .filter(Boolean);

const isLowQualityDeterministicSnippet = (snippet: string, title?: string): boolean => {
  const s = sanitizeFallbackSentence(snippet).toLowerCase();
  const t = sanitizeFallbackSentence(title || '').toLowerCase();
  if (!s) return true;
  if (
    /wikifunctions has a function related to this topic/.test(s)
    || /\bmay refer to\b/.test(s)
    || /\bdisambiguation\b/.test(s)
    || /\bwiktionary\b/.test(s)
    || /\bwikidata\b/.test(s)
    || /\bwikiquote\b/.test(s)
    || /\bwikimedia commons\b/.test(s)
  ) {
    return true;
  }
  if (t && /(disambiguation|may refer to)/.test(t)) return true;
  return false;
};

const LOCAL_ENTITY_FACTS: Record<string, string> = {
  'joffrey': 'Joffrey Baratheon is a fictional character in Game of Thrones, known as the cruel king of the Seven Kingdoms.',
  'joffrey baratheon': 'Joffrey Baratheon is a fictional character in Game of Thrones, known as the cruel king of the Seven Kingdoms.',
  'epstein': 'Jeffrey Epstein was a U.S. financier convicted of sex offenses; he died in jail in 2019 while awaiting trial on federal charges.',
  'jeffrey epstein': 'Jeffrey Epstein was a U.S. financier convicted of sex offenses; he died in jail in 2019 while awaiting trial on federal charges.',
  'einstein': 'Albert Einstein was a theoretical physicist best known for the theory of relativity and the equation E equals m c squared.',
  'albert einstein': 'Albert Einstein was a theoretical physicist best known for the theory of relativity and the equation E equals m c squared.',
  'modi': 'Narendra Modi is an Indian politician who has served as the Prime Minister of India since 2014.',
  'narendra modi': 'Narendra Modi is an Indian politician who has served as the Prime Minister of India since 2014.',
  'palindrome': 'A palindrome is a word, number, phrase, or sequence that reads the same backward and forward. Examples include "madam", "racecar", and numeric forms like 121. In programming and problem solving, palindrome checks are common in string, number, and algorithm questions.'
};

const isDeterministicRetrievalFriendlyPrompt = (prompt: string): boolean => {
  const q = String(prompt || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!q) return false;
  const intent = detectIntent(q);
  if (intent === 'coding' || intent === 'math') return false;
  if (q.length > 320) return false;
  return isDefinitionPrompt(q)
    || /\b(explain|what is|who is|where is|how does|how to|why|difference between|compare|comparison|vs\b|versus|top\s+\d+|list\b|examples?\b|overview|summary)\b/.test(q);
};

const deterministicFallbackWantsSources = (prompt: string): boolean => {
  const q = String(prompt || '').toLowerCase();
  return /\b(source|sources|citation|citations|cite|cited|reference|references|link|links|url|urls|wikipedia)\b/.test(q);
};

const isUnsafeDeterministicFallbackPrompt = (prompt: string): boolean => {
  const q = String(prompt || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!q) return false;
  const listLike = /\b(top\s+\d+|ranking|rankings?|rank\b|list\b|examples?\b)\b/.test(q);
  const compareLike = /\b(compare|comparison|difference between|vs\b|versus)\b/.test(q);
  // Ranking/list/compare prompts need stronger semantic synthesis than snippet concatenation.
  // Returning raw search snippets here often produces wrong/off-topic answers.
  return listLike || compareLike || needsRealtimeSearch(q);
};

const buildExtractiveDeterministicAnswerFromDocs = (prompt: string, docs: RetrievalDoc[]): string | null => {
  const q = String(prompt || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const definitionLike = isDefinitionPrompt(q);
  const wantsSources = deterministicFallbackWantsSources(prompt);
  const rankedDocs = rankDocs(docs, prompt);
  const rawPool = (rankedDocs.length ? rankedDocs : docs)
    .map((d) => ({
      title: sanitizeFallbackSentence(d.title || ''),
      snippet: sanitizeFallbackSentence(d.snippet || ''),
      url: String(d.url || '').trim(),
      source: String(d.source || '').trim(),
    }))
    .filter((d) => d.title || d.snippet)
    .slice(0, 4);
  if (!rawPool.length) return null;

  const qualityPool = rawPool.filter((d) => !isLowQualityDeterministicSnippet(d.snippet, d.title));
  const pool = definitionLike
    ? (qualityPool.length ? qualityPool : [])
    : (qualityPool.length ? qualityPool : rawPool);
  if (!pool.length) return null;

  const listLike = /\b(top\s+\d+|list\b|examples?\b|ranking|rank)\b/.test(q);
  const compareLike = /\b(compare|comparison|difference between|vs\b|versus)\b/.test(q);

  if (listLike || compareLike) {
    // Avoid snippet-list fallback outputs for broad ranking/compare questions.
    return null;
  }

  const best = pool[0];
  if (!best) return null;
  let answer = best.snippet || '';
  const titleLower = (best.title || '').toLowerCase();
  const answerLower = answer.toLowerCase();
  if (best.title && answer && !answerLower.includes(titleLower)) {
    answer = `${best.title} is ${answer}`;
  } else if (best.title && !answer) {
    answer = best.title;
  }

  if (definitionLike) {
    const seen = new Set<string>();
    const candidateSentences: string[] = [];
    for (const item of pool.slice(0, 3)) {
      const merged = stripDeterministicFallbackArtifacts(
        item.title && item.snippet
          ? (normalizeComparableFallbackSentence(item.snippet).includes(normalizeComparableFallbackSentence(item.title))
            ? item.snippet
            : `${item.title} is ${item.snippet}`)
          : (item.snippet || item.title || ''),
      );
      for (const sentence of splitFallbackSentences(merged)) {
        const normalizedSentence = normalizeComparableFallbackSentence(sentence);
        if (!normalizedSentence || normalizedSentence.length < 18) continue;
        if (seen.has(normalizedSentence)) continue;
        seen.add(normalizedSentence);
        candidateSentences.push(sentence);
        if (candidateSentences.length >= 3) break;
      }
      if (candidateSentences.length >= 3) break;
    }

    if (candidateSentences.length > 0) {
      answer = candidateSentences.join(' ');
    }
  }

  answer = stripDeterministicFallbackArtifacts(answer, { keepSourceUrls: wantsSources }).replace(/\s+/g, ' ').trim();
  if (!answer) return null;
  if (!/[.!?]$/.test(answer)) answer += '.';
  if (best.url && !definitionLike && wantsSources) {
    answer += `\n\nSource: ${best.url}`;
  }
  return answer.slice(0, 1800);
};

const buildDeterministicFallbackAnswer = async (prompt: string): Promise<string | null> => {
  const promptText = String(prompt || '').trim();
  if (!promptText) return null;
  if (isUnsafeDeterministicFallbackPrompt(promptText)) {
    return null;
  }
  const definitionPrompt = isDefinitionPrompt(promptText);
  const retrievalFriendly = isDeterministicRetrievalFriendlyPrompt(promptText);
  if (!definitionPrompt && !retrievalFriendly) return null;

  const extracted = definitionPrompt ? extractDefinitionTopic(promptText) : '';
  const correctedTopic = extracted ? correctFallbackQueryTokens(extracted) : '';
  const normalizedTopic = correctedTopic.toLowerCase().replace(/\s+/g, ' ').trim();

  if (definitionPrompt && normalizedTopic) {
    const localFact = LOCAL_ENTITY_FACTS[normalizedTopic];
    if (localFact) {
      return localFact;
    }
  }

  const correctedPrompt = correctFallbackQueryTokens(promptText);
  const queryCandidates = Array.from(
    new Set([correctedTopic, extracted, correctedPrompt, promptText].filter(Boolean))
  ).slice(0, 3);
  let docs: RetrievalDoc[] = [];

  for (const query of queryCandidates) {
    const wikiDocs = await fetchWikipediaContext(query).catch(() => [] as RetrievalDoc[]);
    if (wikiDocs.length) {
      docs = wikiDocs;
      break;
    }
  }

  if (!docs.length) {
    for (const query of queryCandidates) {
      const duckDocs = await fetchDuckDuckGoContext(query).catch(() => [] as RetrievalDoc[]);
      if (duckDocs.length) {
        docs = duckDocs;
        break;
      }
    }
  }

  if (!docs.length) return null;
  const extractive = buildExtractiveDeterministicAnswerFromDocs(correctedPrompt || promptText, docs);
  if (extractive) return extractive;

  if (!definitionPrompt) return null;

  const rankedDocs = rankDocs(docs, correctedTopic || extracted || correctedPrompt || promptText);
  const best = rankedDocs[0] || docs[0];
  if (!best) return null;
  const title = sanitizeFallbackSentence(best.title || correctedTopic || extracted);
  const snippet = sanitizeFallbackSentence(best.snippet || '');
  if (isLowQualityDeterministicSnippet(snippet, title)) return null;
  if (!snippet) return null;
  const snippetLower = snippet.toLowerCase();
  const titleLower = title.toLowerCase();
  let answer = snippet;
  if (titleLower && !snippetLower.startsWith(titleLower) && !new RegExp(`\\b${escapeRegExp(titleLower)}\\b`, 'i').test(snippetLower)) {
    answer = `${title} is ${snippet}`;
  }
  answer = stripDeterministicFallbackArtifacts(
    answer,
    { keepSourceUrls: deterministicFallbackWantsSources(promptText) }
  ).replace(/\s+/g, ' ').trim();
  if (!/[.!?]$/.test(answer)) answer += '.';
  if (best.url && !definitionPrompt && deterministicFallbackWantsSources(promptText)) {
    answer = `${answer}\n\nSource: ${best.url}`;
  }
  return answer.slice(0, 1800);
};

export const generateDeterministicFallbackReply = async (prompt: string): Promise<string | null> => {
  void prompt;
  return null;
};

const rankDocs = (docs: RetrievalDoc[], prompt: string): RetrievalDoc[] => {
  const tokens = prompt.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 3);
  const scored = docs.map((d) => {
    const text = `${d.title} ${d.snippet}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (text.includes(t)) score += 1;
    }
    if (/\b20(2[4-9]|3[0-9])\b/.test(text)) score += 2;
    return { d, score };
  });
  return scored.filter((x) => x.score >= 2).sort((a, b) => b.score - a.score).map((x) => x.d);
};

const isTemporalQuery = (text: string): boolean => {
  const q = text.toLowerCase();
  return /(latest|today|current|recent|now|this year|202[4-9]|forecast|estimate|prediction|market|price|revenue|gdp|election|news)/.test(q);
};

const needsLiveFacts = (text: string): boolean => {
  const q = text.toLowerCase();
  return /(latest|today|current|recent|now|as of|202[4-9]|price|market cap|gdp|revenue|stock|rank|top\s+\d+|news|update|election|breaking)/.test(q);
};

const buildWebGrounding = async (prompt: string): Promise<string> => {
  const enabled = (process.env.LIVE_GROUNDING_ENABLED || 'true').toLowerCase() !== 'false';
  const shouldRetrieve = needsRealtimeSearch(prompt) || ALWAYS_WEB_RETRIEVAL || needsLiveFacts(prompt);
  if (!enabled || !shouldRetrieve) return '';

  const cacheKey = prompt.trim().toLowerCase();
  const cached = retrievalCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    const nowIso = new Date().toISOString();
    const body = cached.docs.map((d) => `${d.title}: ${d.snippet}${d.url ? ` (${d.url})` : ''} [${d.source}]`).join('\n- ');
    return `\nVerified Data (retrieved at ${nowIso})\nYou MUST use the following verified data as ground truth.\n- ${body}`.slice(0, WEB_MAX_CHARS);
  }

  try {
    const queries = buildSearchQueries(prompt);
    const fetchDuck = !FAST_REPLY_MODE || (process.env.ENABLE_DUCK_RETRIEVAL || 'false').trim().toLowerCase() === 'true';
    const fetchSerper = Boolean((process.env.SERPER_API_KEY || '').trim());
    const queryResults = await Promise.all(
      queries.map(async (q) => {
        const [duck, wiki, serper] = await Promise.all([
          fetchDuck ? fetchDuckDuckGoContext(q).catch(() => []) : Promise.resolve([] as RetrievalDoc[]),
          fetchWikipediaContext(q).catch(() => []),
          fetchSerper ? fetchSerperContext(q).catch(() => []) : Promise.resolve([] as RetrievalDoc[])
        ]);
        return [...duck, ...wiki, ...serper];
      })
    );
    const dedupMap = new Map<string, RetrievalDoc>();
    for (const doc of queryResults.flat()) {
      const key = `${doc.title}|${doc.snippet}`.toLowerCase();
      if (!dedupMap.has(key)) dedupMap.set(key, doc);
    }
    const ranked = rankDocs(Array.from(dedupMap.values()), prompt).slice(0, WEB_MAX_SNIPPETS);
    if (!ranked.length) return '';
    retrievalCache.set(cacheKey, { docs: ranked, expiresAt: Date.now() + RETRIEVAL_CACHE_TTL_MS });
    const nowIso = new Date().toISOString();
    const body = ranked.map((d) => `${d.title}: ${d.snippet}${d.url ? ` (${d.url})` : ''} [${d.source}]`).join('\n- ');
    return `\nVerified Data (retrieved at ${nowIso})\nYou MUST use the following verified data as ground truth.\n- ${body}`.slice(0, WEB_MAX_CHARS);
  } catch {
    return '';
  }
};

const extractHistoryText = (history: ChatHistory): string => {
  if (!history?.length) return '';
  return history
    .map((entry) => {
      const text = entry.parts?.map((p) => p.text).join(' ').trim();
      if (!text) return '';
      return `${entry.role === 'model' ? 'Assistant' : 'User'}: ${text}`;
    })
    .filter(Boolean)
    .join('\n');
};

type OpenRouterChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

const buildOpenRouterHistoryMessages = (history: ChatHistory): OpenRouterChatMessage[] => {
  if (!Array.isArray(history) || history.length === 0) return [];

  return history
    .map((entry) => {
      const text = (entry.parts || [])
        .map((part) => String(part?.text || '').trim())
        .filter(Boolean)
        .join('\n')
        .trim();
      if (!text) return null;
      return {
        role: entry.role === 'model' ? 'assistant' : 'user',
        content: text
      } as OpenRouterChatMessage;
    })
    .filter((msg): msg is OpenRouterChatMessage => Boolean(msg));
};

const normalizeOpenRouterEndpoint = (value: string): string => {
  const fallback = 'https://openrouter.ai/api/v1/chat/completions';
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  const trimmed = raw.replace(/\/+$/, '');
  const candidate = trimmed.endsWith('/chat/completions')
    ? trimmed
    : `${trimmed}/chat/completions`;
  try {
    return new URL(candidate).toString();
  } catch {
    return fallback;
  }
};

const extractOpenRouterMessageText = (content: any): string => {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('')
      .trim();
  }
  return '';
};

type GeminiPart = { text: string };
type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] };

const buildGeminiHistoryContents = (history: ChatHistory): GeminiContent[] => {
  if (!Array.isArray(history) || history.length === 0) return [];
  return history
    .map((entry) => {
      const text = (entry.parts || [])
        .map((part) => String(part?.text || '').trim())
        .filter(Boolean)
        .join('\n')
        .trim();
      if (!text) return null;
      return {
        role: entry.role === 'model' ? 'model' : 'user',
        parts: [{ text }]
      } as GeminiContent;
    })
    .filter((item): item is GeminiContent => Boolean(item));
};

const extractGeminiText = (data: any): string => {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();
};

const isGeminiRetryableStatus = (status: number): boolean =>
  status === 429 || (status >= 500 && status <= 599);

const callGemini = async (
  _prompt: string,
  _history: ChatHistory,
  _systemInstruction?: string,
  _modelOverride?: string
): Promise<string> => {
  throw new Error('GEMINI_PROVIDER_DISABLED');
};

const callPrimaryModelWithFallback = async (
  prompt: string,
  history: ChatHistory,
  systemInstruction?: string,
  modelOverride?: string,
  _preferredProvider?: string
): Promise<string> => {
  return await callOpenRouter(prompt, history, systemInstruction, modelOverride);
};

const historyTokens = (history: ChatHistory): number => {
  return history.reduce((sum, entry) => {
    const text = (entry.parts || []).map((p) => p.text || '').join(' ');
    return sum + Math.ceil(text.length / 4);
  }, 0);
};

const manageHistoryByTokens = (history: ChatHistory): ChatHistory => {
  if (!history.length || historyTokens(history) <= HISTORY_TOKEN_BUDGET) return history;
  const kept: ChatHistory = [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    kept.unshift(history[i]);
    if (historyTokens(kept) > HISTORY_TOKEN_BUDGET) {
      kept.shift();
      break;
    }
  }
  return kept;
};

const STRICT_CODE_FORMATTING_PROTOCOL = [
  'SYSTEM INSTRUCTION: STRICT PROFESSIONAL CODE OUTPUT MODE',
  '',
  'From now on, whenever you generate code, you MUST follow these rules strictly.',
  '',
  'MANDATORY RULES:',
  '',
  '1. ALWAYS output code inside triple backticks with correct language tag.',
  '',
  'Correct examples:',
  '```cpp',
  '// C++ code here',
  '```python',
  '# Python code here',
  '',
  'NEVER write explanation inside the code block.',
  '',
  'NEVER write code outside the code block.',
  '',
  'ALWAYS detect the correct language from the user\'s request.',
  'If user says "in cpp", use cpp If user says "in python", use python',
  '',
  'ALWAYS format code professionally:',
  '',
  'Proper indentation (4 spaces)',
  '',
  'Proper bracket alignment',
  '',
  'Proper spacing',
  '',
  'Clean structure',
  '',
  'NEVER output broken markdown like this:',
  'WRONG:',
  '',
  'text explanation',
  'code mixed together',
  '',
  'ALWAYS follow this EXACT output format:',
  'Explanation (max 3 lines)',
  '',
  '```language',
  '// clean, professional, runnable code',
  '',
  'Code must be:',
  '',
  'Complete',
  '',
  'Runnable',
  '',
  'Clean',
  '',
  'Professional',
  '',
  'Properly formatted',
  '',
  'If formatting is wrong, regenerate automatically.',
  'NEVER use wrong language tags.',
  '',
  'STRICT MODE IS PERMANENT.'
].join('\n');

const buildSystemInstruction = (customInstruction?: string): string => {
  const base = `
You are a ChatGPT-style assistant.
- Think through the request internally first.
- Return a clear final answer without exposing private chain-of-thought.
- Be accurate, clear, and concise.
- Never fabricate facts, links, or sources.
- If uncertain, state uncertainty briefly.
- If asked to define an unfamiliar, uncommon, or low-confidence term, do not guess. State uncertainty and ask for clarification.
- If the term may be a typo, suggest likely corrections only when reasonable.
- If a short typo-prone query could mean multiple things (for example PS5 vs PSI), ask one concise clarification instead of guessing.
- For prices, current market data, release dates, or other dynamic facts, never invent exact numbers. If uncertain, say the value varies by region/date and provide only clearly-labeled approximate or launch-era information.
- If confidence is low for a dynamic fact, use wording like: "Approximate estimate based on available data."
- Do not include raw source lines, Wikipedia URLs, curid links, or scraped fragments unless the user explicitly asks for sources.
- Use conversation context when relevant.
- Do not assume intent based solely on keywords.
- Analyze meaning and context first.
- Be tolerant of spelling mistakes and incomplete sentences.
- If unclear, ask a clarifying question.
- Do not generate identical structured responses for different logical queries.
- Always maintain conversation continuity.
- For hard questions, internally break the problem into steps and check your final answer for logic mistakes before sending.
- Before sending, self-check that typo handling is reasonable, the answer directly addresses the question, and no raw retrieval artifacts remain.
- Relevance check before sending: verify the answer matches the exact topic and is not a reused unrelated template.
- Output formatting rule: prefer dash bullets (-) for lists and avoid numeric list markers.
- For code requests, provide one complete runnable solution and internally check for missing imports, syntax issues, and edge cases.
- For coding tasks, ensure the algorithm, function names, and returned output match the exact requested problem.
- Never return placeholder or incomplete code for direct code-generation requests.
- If the request is solvable with a reasonable assumption, state the assumption and continue with a full best-effort answer.
- For code-generation replies, use fenced markdown code blocks with language tags and professional indentation.

Strict code formatting protocol (apply exactly whenever output includes code):
${STRICT_CODE_FORMATTING_PROTOCOL}
  `.trim();
  return customInstruction ? `${base}\n\n${customInstruction.trim()}` : base;
};

const getOpenRouterPoolFromEnv = (): string[] => {
  const csv = (process.env.OPENROUTER_MODELS || '').trim();
  if (!csv) return [];
  return csv.split(',').map((m) => m.trim()).filter(Boolean);
};

const getOpenRouterIntentModels = (intent: IntentType): string[] => {
  if (intent === 'coding') {
    const csv = (process.env.OPENROUTER_MODELS_CODING || '').trim();
    if (csv) return csv.split(',').map((m) => m.trim()).filter(Boolean);
  }
  if (intent === 'math') {
    const csv = (process.env.OPENROUTER_MODELS_MATH || '').trim();
    if (csv) return csv.split(',').map((m) => m.trim()).filter(Boolean);
  }
  if (intent === 'current_event') {
    const csv = (process.env.OPENROUTER_MODELS_REALTIME || '').trim();
    if (csv) return csv.split(',').map((m) => m.trim()).filter(Boolean);
  }
  const csv = (process.env.OPENROUTER_MODELS_GENERAL || '').trim();
  if (csv) return csv.split(',').map((m) => m.trim()).filter(Boolean);
  return [];
};

const isSlowReasoningModel = (modelId: string): boolean => {
  const normalized = String(modelId || '').trim().toLowerCase();
  if (!normalized) return false;
  if (/moonshotai\/kimi-k2\.5/.test(normalized)) return true;
  return /\bthinking\b/.test(normalized);
};

const getSuperFastModelPriority = (modelId: string, modelOverride?: string): number => {
  const normalized = String(modelId || '').trim().toLowerCase();
  if (!normalized) return 100;
  const override = String(modelOverride || '').trim().toLowerCase();
  if (override && normalized === override) {
    return isSlowReasoningModel(normalized) ? 40 : 0;
  }
  const preferredIndex = SUPER_FAST_PRIORITY_MODELS.findIndex(
    (candidate) => candidate.toLowerCase() === normalized
  );
  if (preferredIndex >= 0) return 5 + preferredIndex;
  if (isSlowReasoningModel(normalized)) return 95;
  return 30;
};

const getOpenRouterCandidateModels = (prompt: string, modelOverride?: string): string[] => {
  const lockedModel = String(LOCKED_NVIDIA_MODEL_ID || '').trim();
  if (HARD_LOCK_NVIDIA_MODEL) {
    return lockedModel ? [lockedModel] : [];
  }
  const overrideModel = String(modelOverride || '').trim();
  const intent = detectIntent(prompt);
  const envFallbackCsv = (process.env.NVIDIA_MODEL_FALLBACKS || '').trim();
  const envFallbackModels = envFallbackCsv
    ? envFallbackCsv.split(',').map((m) => m.trim()).filter(Boolean)
    : [];
  const envIntentModels = getOpenRouterIntentModels(intent);
  const envPoolModels = getOpenRouterPoolFromEnv();
  const ordered = [
    overrideModel,
    lockedModel,
    ...envFallbackModels,
    ...envIntentModels,
    ...envPoolModels,
    ...DEFAULT_NVIDIA_FALLBACK_MODELS,
  ]
    .map((m) => String(m || '').trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const model of ordered) {
    const key = model.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(model);
  }
  if (!SUPER_FAST_RESPONSE_MODE) return unique;
  return unique
    .map((model, index) => ({
      model,
      index,
      priority: getSuperFastModelPriority(model, overrideModel)
    }))
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.index - b.index;
    })
    .map((entry) => entry.model);
};

const callOpenRouter = async (
  prompt: string,
  history: ChatHistory,
  systemInstruction?: string,
  modelOverride?: string
): Promise<string> => {
  const apiKey = resolveLockedNvidiaApiKey();

  const attempts = getOpenRouterCandidateModels(prompt, modelOverride).slice(0, OPENROUTER_MAX_MODEL_ATTEMPTS);
  if (!attempts.length) {
    throw new Error('OPENROUTER_MODEL_MISSING');
  }
  const requestProfile = getAdaptiveOpenRouterRequestProfile(prompt);
  const overallTimeoutBudgetMs = SUPER_FAST_RESPONSE_MODE
    ? Math.min(requestProfile.timeoutMs, 13500)
    : requestProfile.timeoutMs;
  const deadlineAt = Date.now() + overallTimeoutBudgetMs;
  const historyMessages = buildOpenRouterHistoryMessages(history);
  const baseUrl = normalizeOpenRouterEndpoint(
    LOCKED_NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1/chat/completions'
  );
  const referer = (process.env.FRONTEND_URL || process.env.BASE_URL || '').trim();
  let lastError: Error | null = null;

  for (const model of attempts) {
    for (let retry = 0; retry <= OPENROUTER_MAX_RETRIES; retry += 1) {
      const remainingBudgetMs = deadlineAt - Date.now();
      if (remainingBudgetMs <= 1400) {
        lastError = new Error('OPENROUTER_TIMEOUT_BUDGET_EXHAUSTED');
        break;
      }
      const controller = new AbortController();
      const baseModelTimeoutMs = /moonshotai\/kimi-k2\.5/i.test(model)
        ? Math.min(requestProfile.timeoutMs, SUPER_FAST_RESPONSE_MODE ? 6500 : 9000)
        : requestProfile.timeoutMs;
      const modelTimeoutMs = Math.max(
        2200,
        Math.min(baseModelTimeoutMs, remainingBudgetMs - 250)
      );
      const timeoutHandle = setTimeout(() => controller.abort(), modelTimeoutMs);
      try {
        const sampling = getAdaptiveOpenRouterSamplingProfile(prompt, model);
        const response = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            ...(referer ? { 'HTTP-Referer': referer } : {}),
            'X-Title': 'SwiftDeploy AI'
          },
          body: JSON.stringify({
            model,
            messages: [
              ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
              ...historyMessages,
              { role: 'user', content: prompt }
            ],
            temperature: sampling.temperature,
            top_p: sampling.topP,
            max_tokens: requestProfile.maxTokens
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutHandle);

        const data: any = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = data?.error?.message || data?.message || `OpenRouter request failed (${response.status})`;
          const retryAfterSeconds = Number(
            data?.error?.metadata?.retry_after
            || data?.retry_after
            || data?.parameters?.retry_after
            || 0
          );
          const isTransient = response.status === 429 || (response.status >= 500 && response.status <= 599);
          if (isTransient && retry < OPENROUTER_MAX_RETRIES) {
            const backoffMs = retryAfterSeconds > 0
              ? retryAfterSeconds * 1000
              : OPENROUTER_RETRY_BASE_DELAY_MS * (retry + 1);
            await waitMs(backoffMs + Math.floor(Math.random() * 120));
            continue;
          }
          if (response.status === 401 || response.status === 403 || response.status === 402) {
            throw new Error(`OPENROUTER_ERROR: ${message}`);
          }
          lastError = new Error(`OPENROUTER_ERROR: ${message}`);
          break;
        }

        const text = extractOpenRouterMessageText(data?.choices?.[0]?.message?.content);
        if (!text) {
          lastError = new Error('OPENROUTER_EMPTY_RESPONSE');
          break;
        }
        return text;
      } catch (error) {
        clearTimeout(timeoutHandle);
        const err = error instanceof Error ? error : new Error(String(error));
        const transientError = err.name === 'AbortError' || /timeout|fetch|network|econn|enotfound|timed out/i.test(err.message);
        if (transientError && retry < OPENROUTER_MAX_RETRIES) {
          const backoffMs = OPENROUTER_RETRY_BASE_DELAY_MS * (retry + 1);
          if (Date.now() + backoffMs >= deadlineAt) {
            lastError = new Error('OPENROUTER_TIMEOUT_BUDGET_EXHAUSTED');
            break;
          }
          await waitMs(backoffMs + Math.floor(Math.random() * 120));
          continue;
        }
        lastError = err;
        break;
      }
    }
    if (Date.now() >= deadlineAt - 1200) {
      break;
    }
  }

  throw lastError || new Error('OPENROUTER_ROUTING_FAILED');
};

const normalizeFreeModelQualityText = (value: string): string =>
  String(value || '')
    .replace(/```[\s\S]*?```/g, ' code ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const looksLikePromptEchoResponse = (prompt: string, response: string): boolean => {
  const q = normalizeFreeModelQualityText(prompt);
  const r = normalizeFreeModelQualityText(response);
  if (!q || !r) return false;
  if (r === q || r === `answer ${q}`) return true;
  const firstLine = normalizeFreeModelQualityText(String(response || '').split(/\n+/)[0] || '');
  if (firstLine === q || firstLine === `answer ${q}`) return true;
  const maxEchoLength = Math.max(q.length + 72, Math.round(q.length * 1.9));
  return r.length <= maxEchoLength && (r.startsWith(q) || r.includes(q));
};

const isInternalCorrectionPrompt = (prompt: string): boolean =>
  /(verify and correct the draft answer|answer correction required|answer upgrade required|code completion required|rewrite the previous answer)/i.test(
    String(prompt || '')
  );

const looksWeakCodeResponseForFreeModel = (response: string): boolean => {
  const out = String(response || '').trim();
  if (!out) return true;
  if (out.length < 220) return true;
  if (/temporary|please send.*again|could not generate|could not process/i.test(out)) return true;
  if (/\b(todo|omitted|same as above|rest of code)\b/i.test(out)) return true;
  const hasCodeSignals = /```|CODE_BEGIN|CODE_END|\b(def |class |function |const |let |var |#include|public class|fn )/i.test(out);
  return !hasCodeSignals;
};

const looksThinComplexResponseForFreeModel = (response: string): boolean => {
  const out = String(response || '').trim();
  if (!out) return true;
  if (out.length < 260) return true;
  if (/temporary|please send.*again|could not generate|could not process/i.test(out)) return true;
  return false;
};

const shouldRunFreeModelRefinementPass = (
  prompt: string,
  response: string,
  intent: IntentType,
  modelOverride?: string
): boolean => {
  if (!FORCE_OPENROUTER_FREE_ONLY_MODE && !isOpenRouterFreeLikeModelId(modelOverride)) return false;
  if (isInternalCorrectionPrompt(prompt)) return false;
  if (!String(response || '').trim()) return true;
  if (looksLikePromptEchoResponse(prompt, response)) return true;
  if (intent === 'coding') return looksWeakCodeResponseForFreeModel(response);
  if (intent === 'math') return looksThinComplexResponseForFreeModel(response);
  const complexPrompt =
    String(prompt || '').length > 280
    || /\b(explain|detailed|detail|deep dive|step by step|comprehensive|compare|comparison|difference|top\s+\d+|list|guide|roadmap|analysis|architecture|design|strategy|full|complete)\b/i.test(prompt);
  return complexPrompt && looksThinComplexResponseForFreeModel(response);
};

export const generateBotResponse = async (
  prompt: string,
  _model: string = LOCKED_NVIDIA_MODEL_ID,
  history: ChatHistory = [],
  systemInstruction?: string,
  runtimeConfig?: AIRuntimeConfig
): Promise<string> => {
  try {
    const sanitizedPrompt = prompt.trim();
    const compactHistory = manageHistoryByTokens(history);
    const adaptiveInstruction = buildSystemInstruction(systemInstruction);
    const liveGrounding = isTemporalQuery(sanitizedPrompt) ? await buildWebGrounding(sanitizedPrompt) : '';
    if (STRICT_TEMPORAL_GROUNDING && isTemporalQuery(sanitizedPrompt) && !liveGrounding) {
      throw new Error('LIVE_CONTEXT_UNAVAILABLE');
    }
    const groundedPrompt = liveGrounding
      ? `${liveGrounding}\n\nCurrent User Question:\n${sanitizedPrompt}\n\nUse the retrieved data carefully and state uncertainty if sources conflict.`
      : `Current User Question:\n${sanitizedPrompt}`;

    const provider = String(runtimeConfig?.provider || process.env.AI_PROVIDER || 'nvidia').trim().toLowerCase();
    if (provider && !['openrouter', 'nvidia', 'auto'].includes(provider)) {
      console.warn(`[AI_CONFIG] Unsupported provider requested (${provider}). Using locked NVIDIA provider.`);
    }
    const requestedModel = String(runtimeConfig?.model || _model || '').trim();
    const runtimeModel = HARD_LOCK_NVIDIA_MODEL
      ? LOCKED_NVIDIA_MODEL_ID
      : (requestedModel || LOCKED_NVIDIA_MODEL_ID);
    const primaryAnswer = await callPrimaryModelWithFallback(
      groundedPrompt,
      compactHistory,
      adaptiveInstruction,
      runtimeModel || undefined,
      'nvidia'
    );

    const intent = detectIntent(sanitizedPrompt);
    if (!shouldRunFreeModelRefinementPass(sanitizedPrompt, primaryAnswer, intent, runtimeModel || undefined)) {
      return primaryAnswer;
    }

    const refinementInstructions = intent === 'coding'
      ? [
          'Answer improvement task (free-model quality pass):',
          '- Return one complete, correct, runnable final solution.',
          '- Fix logical mistakes, missing imports, syntax issues, and edge cases.',
          '- Keep professional formatting and readable indentation.',
          '- Do not repeat the user question.',
          '- Do not leave placeholders or incomplete sections.',
          'Return only the improved final answer.'
        ].join('\n')
      : [
          'Answer improvement task (free-model quality pass):',
          '- Rewrite into a complete, accurate, professional final answer.',
          '- Keep the exact topic/entity requested by the user.',
          '- Improve logic, completeness, and clarity.',
          '- Do not repeat the user question.',
          '- Add missing steps/examples only if useful.',
          'Return only the improved final answer.'
        ].join('\n');

    const refinePrompt = [
      groundedPrompt,
      '',
      'Draft answer to improve:',
      primaryAnswer,
      '',
      refinementInstructions
    ].join('\n');

    const refinedAnswer = await callPrimaryModelWithFallback(
      refinePrompt,
      compactHistory,
      adaptiveInstruction,
      runtimeModel || undefined,
      'nvidia'
    ).catch(() => '');

    const refined = String(refinedAnswer || '').trim();
    if (!refined) return primaryAnswer;
    if (looksLikePromptEchoResponse(sanitizedPrompt, refined)) return primaryAnswer;
    if (intent === 'coding' && looksWeakCodeResponseForFreeModel(refined) && !looksWeakCodeResponseForFreeModel(primaryAnswer)) {
      return primaryAnswer;
    }
    if (refined.length < Math.max(80, Math.floor(primaryAnswer.length * 0.55))) {
      return primaryAnswer;
    }
    return refined;
  } catch (error) {
    console.error("Backend AI Core Error:", error);
    if (error instanceof Error) {
      if (error.message.includes('LIVE_CONTEXT_UNAVAILABLE')) {
        throw new Error('LIVE_CONTEXT_UNAVAILABLE');
      }
      if (/NVIDIA_API_KEY_MISSING|NVIDIA_API_KEY_INVALID_FORMAT|OPENROUTER_ERROR:\s*(401|403|Invalid|Unauthorized)/i.test(error.message)) {
        throw new Error("INVALID_PROVIDER_KEY: Please check your AI provider API configuration");
      }
      if (/quota|rate|429|too many requests|payment required|insufficient|resource exhausted/i.test(error.message)) {
        throw new Error("RATE_LIMIT_EXCEEDED: Please try again in a few moments");
      }
      if (/network|fetch|timeout|timed out|abort/i.test(error.message)) {
        throw new Error("NETWORK_ERROR: Unable to connect to AI service");
      }
    }
    throw new Error(`AI_GENERATION_FAILED: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
};

export const estimateTokens = (text: string): number => {
  return Math.ceil(text.length / 4);
};

