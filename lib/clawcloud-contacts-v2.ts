import {
  formatContactDisplayName,
  loadContacts,
  normalizeContactName,
} from "@/lib/clawcloud-contacts";

export type ContactMatch = {
  name: string;
  phone: string;
  score: number;
  exact: boolean;
};

export type FuzzyLookupResult =
  | { type: "found"; contact: ContactMatch }
  | { type: "ambiguous"; matches: ContactMatch[]; prompt: string }
  | { type: "not_found"; suggestions: string[] };

const EXACT_SCORE = 1;
const STARTS_WITH_SCORE = 0.92;
const WORD_MATCH_SCORE = 0.88;
const FUZZY_THRESHOLD = 0.65;
const AMBIGUOUS_THRESHOLD = 0.1;

const HINDI_HONORIFICS = [
  "bhai",
  "didi",
  "bhaiya",
  "dada",
  "nana",
  "nani",
  "chacha",
  "chachi",
  "mama",
  "mami",
  "bua",
  "fufa",
  "ji",
  "saab",
  "sahab",
  "sir",
] as const;

const COMMON_NICKNAME_EXPANSIONS: Record<string, string[]> = {
  raj: ["rajesh", "rajendra", "rajan", "rajiv", "rajat"],
  priya: ["priyanka", "priyanshi"],
  sonu: ["sonali", "sonam", "sonal"],
  tina: ["teena"],
  aman: ["amandeep", "amanjot", "amanbir"],
  maa: ["mom", "mother", "mama", "mum", "mummy", "mommy", "ma"],
  papa: ["dad", "father", "pappa", "baba", "daddy", "pitaji"],
  boss: ["manager", "sir"],
};

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix: number[][] = [];
  for (let row = 0; row <= b.length; row += 1) {
    matrix[row] = [row];
  }
  for (let column = 0; column <= a.length; column += 1) {
    matrix[0]![column] = column;
  }

  for (let row = 1; row <= b.length; row += 1) {
    for (let column = 1; column <= a.length; column += 1) {
      const cost = a[column - 1] === b[row - 1] ? 0 : 1;
      matrix[row]![column] = Math.min(
        matrix[row - 1]![column]! + 1,
        matrix[row]![column - 1]! + 1,
        matrix[row - 1]![column - 1]! + cost,
      );
    }
  }

  return matrix[b.length]![a.length]!;
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function normalizeName(name: string): string {
  let normalized = normalizeContactName(name);

  for (const honorific of HINDI_HONORIFICS) {
    if (normalized.endsWith(` ${honorific}`)) {
      normalized = normalized.slice(0, -(honorific.length + 1)).trim();
      break;
    }
  }

  return normalized.trim();
}

function getNameVariants(query: string): string[] {
  const base = normalizeName(query);
  const variants = new Set<string>();

  if (base) {
    variants.add(base);
  }

  const baseWords = base.split(/\s+/).filter(Boolean);
  for (const word of baseWords) {
    variants.add(word);
    for (const expansion of COMMON_NICKNAME_EXPANSIONS[word] ?? []) {
      variants.add(expansion);
    }
  }

  for (const expansion of COMMON_NICKNAME_EXPANSIONS[base] ?? []) {
    variants.add(expansion);
  }

  return [...variants].filter(Boolean);
}

function scoreContact(queryVariants: string[], storedName: string): number {
  const normalizedStored = normalizeName(storedName);
  const storedWords = normalizedStored.split(/\s+/).filter(Boolean);
  let best = 0;

  for (const query of queryVariants) {
    if (!query) continue;

    if (normalizedStored === query) {
      return EXACT_SCORE;
    }

    if (normalizedStored.startsWith(query) || query.startsWith(normalizedStored)) {
      best = Math.max(best, STARTS_WITH_SCORE);
      continue;
    }

    for (const word of storedWords) {
      if (word === query || word.startsWith(query) || query.startsWith(word)) {
        best = Math.max(best, WORD_MATCH_SCORE);
      }
    }

    best = Math.max(best, similarity(query, normalizedStored));
    best = Math.max(best, similarity(query, storedWords[0] ?? normalizedStored) * 0.9);
  }

  return best;
}

function buildAmbiguityPrompt(queryName: string, matches: ContactMatch[]): string {
  return [
    `I found ${matches.length} contacts matching "${queryName}":`,
    "",
    ...matches.map((match, index) => `*${index + 1}.* ${match.name}`),
    "",
    "Reply with the number to pick, for example _1_ or _2_.",
  ].join("\n");
}

export async function lookupContactFuzzy(
  userId: string,
  rawName: string,
): Promise<FuzzyLookupResult> {
  const contacts = await loadContacts(userId);
  const entries = Object.entries(contacts);

  if (!entries.length) {
    return { type: "not_found", suggestions: [] };
  }

  const queryVariants = getNameVariants(rawName);
  const scored: ContactMatch[] = [];

  for (const [storedName, phone] of entries) {
    const score = scoreContact(queryVariants, storedName);
    if (score >= FUZZY_THRESHOLD) {
      scored.push({
        name: formatContactDisplayName(storedName),
        phone,
        score,
        exact: score >= EXACT_SCORE,
      });
    }
  }

  scored.sort((left, right) => right.score - left.score);

  if (!scored.length) {
    return {
      type: "not_found",
      suggestions: entries.slice(0, 5).map(([name]) => formatContactDisplayName(name)),
    };
  }

  if (scored.length === 1) {
    return { type: "found", contact: scored[0]! };
  }

  const top = scored[0]!;
  const runnerUp = scored[1]!;
  if (top.exact || top.score - runnerUp.score > AMBIGUOUS_THRESHOLD) {
    return { type: "found", contact: top };
  }

  const matches = scored.slice(0, 4);
  return {
    type: "ambiguous",
    matches,
    prompt: buildAmbiguityPrompt(rawName, matches),
  };
}

export async function lookupContactSimple(
  userId: string,
  rawName: string,
): Promise<string | null> {
  const result = await lookupContactFuzzy(userId, rawName);
  return result.type === "found" ? result.contact.phone : null;
}

export function formatNotFoundReply(queryName: string, suggestions: string[]): string {
  const lines = [
    `I couldn't match "${queryName}" in your available contacts.`,
    "",
    "I can send from:",
    "- saved ClawCloud contacts",
    "- synced WhatsApp contacts from your linked session",
    "- a direct WhatsApp number",
    "",
    `Save it here: _Save contact: ${queryName} = +91XXXXXXXXXX_`,
    'Or send direct: _Send "Hello" to +91XXXXXXXXXX_',
  ];

  if (suggestions.length) {
    lines.push("");
    lines.push(`Your saved contacts: ${suggestions.join(", ")}`);
  }

  return lines.join("\n");
}

export function formatAmbiguousReply(queryName: string, matches: ContactMatch[]): string {
  return buildAmbiguityPrompt(queryName, matches);
}
