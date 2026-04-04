const DIRECT_QUERY_CORRECTIONS: Record<string, string> = {
  answeer: "answer",
  anser: "answer",
  arbic: "arabic",
  avangers: "avengers",
  calcluate: "calculate",
  calculte: "calculate",
  capitel: "capital",
  captial: "capital",
  chineese: "chinese",
  cdoe: "code",
  contnue: "continue",
  contonue: "continue",
  descibe: "describe",
  detialed: "detailed",
  detailled: "detailed",
  emai: "email",
  emial: "email",
  englsh: "english",
  engish: "english",
  explian: "explain",
  fibbonacci: "fibonacci",
  fibonaci: "fibonacci",
  flim: "film",
  frensh: "french",
  gmai: "gmail",
  gmial: "gmail",
  gmal: "gmail",
  helllo: "hello",
  hindii: "hindi",
  inboc: "inbox",
  inbxo: "inbox",
  japnese: "japanese",
  javscript: "javascript",
  javasript: "javascript",
  koreean: "korean",
  mailbx: "mailbox",
  mesage: "message",
  moive: "movie",
  movi: "movie",
  nw: "now",
  pythn: "python",
  pyhton: "python",
  profestional: "professional",
  profesisonal: "professional",
  replly: "reply",
  spanis: "spanish",
  stroy: "story",
  summarise: "summarize",
  summery: "summary",
  summrize: "summarize",
  telll: "tell",
  temparature: "temperature",
  temprature: "temperature",
  terperature: "temperature",
  typscript: "typescript",
  waht: "what",
  weahter: "weather",
  wether: "weather",
  whatsap: "whatsapp",
  whatsaap: "whatsapp",
  wher: "where",
  wich: "which",
  wrtie: "write",
};

const SAFE_QUERY_KEYWORDS = [
  "algorithm",
  "answer",
  "arabic",
  "build",
  "calculate",
  "capital",
  "chinese",
  "code",
  "coding",
  "compare",
  "compute",
  "continue",
  "conversation",
  "describe",
  "detailed",
  "email",
  "emails",
  "economics",
  "english",
  "explain",
  "fibonacci",
  "film",
  "finance",
  "french",
  "full",
  "gmail",
  "function",
  "geography",
  "gdp",
  "health",
  "hindi",
  "history",
  "important",
  "inbox",
  "japanese",
  "javascript",
  "korean",
  "language",
  "law",
  "latest",
  "mail",
  "mailbox",
  "math",
  "message",
  "movie",
  "newest",
  "news",
  "plot",
  "priority",
  "professional",
  "program",
  "python",
  "question",
  "recent",
  "reply",
  "science",
  "send",
  "show",
  "solve",
  "spanish",
  "story",
  "summarize",
  "summary",
  "technology",
  "temperature",
  "tell",
  "translation",
  "translate",
  "typescript",
  "unread",
  "weather",
  "what",
  "whatsapp",
  "where",
  "which",
  "who",
  "why",
  "write",
] as const;

const SAFE_QUERY_KEYWORD_SET = new Set<string>(SAFE_QUERY_KEYWORDS);
const LATIN_WORD_RE = /\b[\p{Script=Latin}][\p{Script=Latin}'-]{1,}\b/gu;
const STORY_INTENT_RE = /\b(?:story|plot|summary|synopsis|ending)\b/i;
const ENTERTAINMENT_SURFACE_RE = /\b(?:movie|film|drama|series|show|anime|novel|book|webtoon)\b/i;
const LANGUAGE_NAME_RE =
  /\b(?:arabic|chinese|english|french|german|hindi|italian|japanese|korean|portuguese|russian|spanish|thai|turkish|urdu)\b/i;

function applyCasePattern(source: string, replacement: string) {
  if (!source) {
    return replacement;
  }

  if (source === source.toUpperCase()) {
    return replacement.toUpperCase();
  }

  if (source[0] === source[0]?.toUpperCase()) {
    return replacement[0]?.toUpperCase() + replacement.slice(1);
  }

  return replacement;
}

function damerauLevenshteinDistance(a: string, b: string, maxDistance: number) {
  const source = a.toLowerCase();
  const target = b.toLowerCase();
  if (source === target) {
    return 0;
  }

  const lengthDelta = Math.abs(source.length - target.length);
  if (lengthDelta > maxDistance) {
    return Number.POSITIVE_INFINITY;
  }

  const rows = source.length + 1;
  const cols = target.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) {
    matrix[i]![0] = i;
  }
  for (let j = 0; j < cols; j += 1) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    let rowMin = Number.POSITIVE_INFINITY;
    for (let j = 1; j < cols; j += 1) {
      const cost = source[i - 1] === target[j - 1] ? 0 : 1;
      let value = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + cost,
      );

      if (
        i > 1
        && j > 1
        && source[i - 1] === target[j - 2]
        && source[i - 2] === target[j - 1]
      ) {
        value = Math.min(value, matrix[i - 2]![j - 2]! + 1);
      }

      matrix[i]![j] = value;
      rowMin = Math.min(rowMin, value);
    }

    if (rowMin > maxDistance) {
      return Number.POSITIVE_INFINITY;
    }
  }

  const result = matrix[source.length]![target.length]!;
  return result <= maxDistance ? result : Number.POSITIVE_INFINITY;
}

function maybeRepairToken(token: string, fullInput: string) {
  const lower = token.toLowerCase();
  const directCorrection = DIRECT_QUERY_CORRECTIONS[lower];
  if (directCorrection) {
    return applyCasePattern(token, directCorrection);
  }

  if (SAFE_QUERY_KEYWORD_SET.has(lower) || lower.length < 4 || !/^[a-z][a-z'-]+$/i.test(token)) {
    return token;
  }

  if (
    lower === "move"
    && (STORY_INTENT_RE.test(fullInput) || ENTERTAINMENT_SURFACE_RE.test(fullInput))
  ) {
    return applyCasePattern(token, "movie");
  }

  const maxDistance = lower.length >= 7 ? 2 : 1;
  let bestCandidate: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of SAFE_QUERY_KEYWORDS) {
    if (Math.abs(candidate.length - lower.length) > maxDistance) {
      continue;
    }

    if (candidate[0] !== lower[0] || candidate[candidate.length - 1] !== lower[lower.length - 1]) {
      continue;
    }

    const distance = damerauLevenshteinDistance(lower, candidate, maxDistance);
    if (distance === Number.POSITIVE_INFINITY) {
      continue;
    }

    if (distance < bestDistance) {
      bestCandidate = candidate;
      bestDistance = distance;
      continue;
    }

    if (distance === bestDistance && bestCandidate && bestCandidate !== candidate) {
      bestCandidate = null;
    }
  }

  return bestCandidate ? applyCasePattern(token, bestCandidate) : token;
}

function repairLatinQueryTokens(input: string) {
  const matches = [...input.matchAll(LATIN_WORD_RE)];
  if (!matches.length) {
    return input;
  }

  let cursor = 0;
  let repaired = "";
  for (const match of matches) {
    const token = match[0] ?? "";
    const start = match.index ?? 0;
    const end = start + token.length;
    repaired += input.slice(cursor, start);
    repaired += maybeRepairToken(token, input);
    cursor = end;
  }

  repaired += input.slice(cursor);
  return repaired;
}

function expandTelegraphicQuery(input: string) {
  const normalized = input.trim();
  if (!normalized) {
    return normalized;
  }

  const capitalMatch = normalized.match(/^capital(?:\s+of)?\s+(.+)$/i);
  if (capitalMatch?.[1]?.trim()) {
    return `what is the capital of ${capitalMatch[1].trim()}`;
  }

  const storyMatch = normalized.match(/^(story|plot|summary|synopsis|ending)\s+of\s+(.+)$/i);
  if (storyMatch?.[1] && storyMatch[2]?.trim()) {
    return `tell me the ${storyMatch[1].toLowerCase()} of ${storyMatch[2].trim()}`;
  }

  const weatherMatch = normalized.match(/^(weather|temperature|forecast)\s+(.+)$/i);
  if (weatherMatch?.[1] && weatherMatch[2]?.trim()) {
    return `what is the ${weatherMatch[1].toLowerCase()} in ${weatherMatch[2].trim()}`;
  }

  const codingMatch = normalized.match(
    /^(fibonacci|binary search|palindrome|rat(?:\s+in\s+(?:a\s+)?)?maze|n[-\s]?queens?)(?:\s+(?:code|program|function|solution))?(?:\s+in\s+([a-z+#]+))?$/i,
  );
  if (codingMatch?.[1]) {
    const language = codingMatch[2]?.trim();
    return language
      ? `write ${codingMatch[1].toLowerCase()} code in ${language.toLowerCase()}`
      : `write ${codingMatch[1].toLowerCase()} code`;
  }

  return normalized;
}

function applyContextualPhraseRepairs(input: string) {
  let repaired = input;

  repaired = repaired.replace(
    /\b(tell me|give me|explain)\s+(?:the\s+)?(?:full\s+)?(?:detailed\s+)?movie\s+of\b/gi,
    (_, lead: string) => `${lead} the full story of the movie`,
  );

  repaired = repaired.replace(/\btell me story of\b/gi, "tell me the story of");
  repaired = repaired.replace(/\btell me plot of\b/gi, "tell me the plot of");
  repaired = repaired.replace(/\btell me summary of\b/gi, "tell me the summary of");

  if ((STORY_INTENT_RE.test(repaired) || ENTERTAINMENT_SURFACE_RE.test(repaired)) && LANGUAGE_NAME_RE.test(repaired)) {
    repaired = repaired.replace(/\bmove\b/gi, "movie");
  }

  return repaired;
}

const CONVERSATIONAL_LEAD_IN_RE =
  /^(?:(?:ok(?:ay)?|alright|all\s+right|fine|cool|hmm|hm|haan|han|ha|acha|achha|accha|ab|so|then|now|please|pls|plz)\s+){1,4}/i;

export function stripClawCloudConversationalLeadIn(value: string) {
  let trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  let previous = "";
  while (trimmed && trimmed !== previous) {
    previous = trimmed;
    trimmed = trimmed.replace(CONVERSATIONAL_LEAD_IN_RE, "").trim();
  }

  return trimmed;
}

export function normalizeClawCloudUnderstandingMessage(value: string) {
  let normalized = value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "";
  }

  normalized = applyContextualPhraseRepairs(normalized);
  normalized = repairLatinQueryTokens(normalized);
  normalized = applyContextualPhraseRepairs(normalized);
  normalized = expandTelegraphicQuery(normalized);

  return normalized.replace(/\s+/g, " ").trim();
}
