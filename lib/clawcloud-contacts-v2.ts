import {
  formatContactDisplayName,
  loadContacts,
  normalizeContactName,
  normalizePhone,
} from "@/lib/clawcloud-contacts";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { buildWhatsAppReceiptDerivedAliasMap } from "@/lib/clawcloud-whatsapp-contact-alias-receipts";
import { buildClawCloudWhatsAppContactIdentityGraph } from "@/lib/clawcloud-whatsapp-contact-identity";
import { loadFallbackSyncedWhatsAppContacts } from "@/lib/clawcloud-whatsapp-contacts";

export type ContactMatchBasis = "exact" | "prefix" | "word" | "fuzzy";

export type ContactMatch = {
  name: string;
  phone: string | null;
  jid?: string | null;
  aliases: string[];
  score: number;
  exact: boolean;
  matchedAlias?: string;
  matchBasis?: ContactMatchBasis;
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
const ADDRESS_HONORIFIC_MATCH_BONUS = 0.03;
const WHATSAPP_HISTORY_LIMIT = 600;
const PARTIAL_MATCH_QUERY_MIN_LENGTH = 3;
const HISTORY_RELATIONSHIP_ALIAS_MIN_OCCURRENCES = 2;
const HISTORY_ADDRESS_ALIAS_MIN_OCCURRENCES = 1;
const HISTORY_RELATIONSHIP_ALIAS_MESSAGE_MAX_LENGTH = 80;
const HISTORY_RELATIONSHIP_ALIAS_CANONICALS = new Set([
  "maa",
  "papa",
  "didi",
  "bhai",
  "bhaiya",
]);
const HISTORY_ADDRESS_PREFIX_STOPWORDS = new Set([
  "ok",
  "okay",
  "acha",
  "accha",
  "achha",
  "haan",
  "han",
  "hi",
  "hello",
  "hey",
  "tell",
  "show",
  "check",
  "read",
  "message",
  "messages",
  "chat",
  "history",
  "summary",
  "summarize",
  "conversation",
  "the",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "how",
  "kya",
  "kyu",
  "kyun",
  "kaise",
  "kab",
  "kahan",
  "kaun",
  "dear",
  "please",
  "plz",
  "pls",
  "thanks",
  "thank",
  "thanku",
  "thankyou",
  "thx",
  "good",
  "morning",
  "afternoon",
  "evening",
  "night",
  "gm",
  "gn",
  "ga",
  "ge",
  "shukriya",
  "ji",
]);
const SYSTEM_LIKE_HISTORY_ALIAS_PATTERN =
  /\b(?:clawcloud|daily limit reached|message delivered to|active contact mode|upgrade to|whatsapp conversation summary)\b/i;

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
  maa: [
    "mom", "mother", "mama", "mum", "mummy", "mommy", "ma",
    "\u5988\u5988", "\u5abd\u5abd", "\u5988", "\u5abd", "\u6bcd\u4eb2", "\u6bcd\u89aa",
    "\u304a\u6bcd\u3055\u3093", "\u30de\u30de", "\uc5c4\ub9c8", "\uc5b4\uba38\ub2c8",
    "mam\u00e1", "madre", "m\u00e3e", "mae", "maman", "m\u00e8re", "mere",
    "\u043c\u0430\u043c\u0430", "\u043c\u0430\u0442\u044c",
    "\u0623\u0645\u064a", "\u0627\u0645\u064a", "\u0648\u0627\u0644\u062f\u062a\u064a",
    "anne", "annem", "ibu", "\u0e41\u0e21\u0e48", "\u0e04\u0e38\u0e13\u0e41\u0e21\u0e48",
  ],
  mummy: ["mom", "mother", "mum", "mommy", "maa", "ma", "\u5988\u5988", "\u5abd\u5abd", "\uc5c4\ub9c8"],
  mom: ["mother", "mum", "mummy", "maa", "ma", "\u5988\u5988", "\u5abd\u5abd", "\uc5c4\ub9c8"],
  papa: [
    "dad", "father", "pappa", "baba", "daddy", "pitaji",
    "\u7238\u7238", "\u7238", "\u7236\u4eb2", "\u7236\u89aa",
    "\u304a\u7236\u3055\u3093", "\u30d1\u30d1", "\uc544\ube60", "\uc544\ubc84\uc9c0",
    "pap\u00e1", "padre", "pai", "papai", "p\u00e8re", "pere", "vater",
    "\u043f\u0430\u043f\u0430", "\u043e\u0442\u0435\u0446",
    "\u0623\u0628\u064a", "\u0627\u0628\u064a", "\u0648\u0627\u0644\u062f\u064a",
    "\u0e1e\u0e48\u0e2d", "\u0e04\u0e38\u0e13\u0e1e\u0e48\u0e2d",
  ],
  papaji: ["papa ji", "papa", "dad", "father", "pitaji", "daddy", "\u7238\u7238", "\u30d1\u30d1", "\uc544\ube60"],
  dii: [
    "didi", "di", "sister", "sis",
    "\u59d0\u59d0", "\u59d0",
    "\u304a\u59c9\u3055\u3093", "\u304a\u59c9\u3061\u3083\u3093",
    "\uc5b8\ub2c8", "\ub204\ub098",
    "hermana", "irm\u00e3", "irma", "s\u0153ur", "soeur", "schwester",
    "\u0441\u0435\u0441\u0442\u0440\u0430",
    "\u0623\u062e\u062a\u064a", "\u0627\u062e\u062a\u064a", "\u0e1e\u0e35\u0e48\u0e2a\u0e32\u0e27",
  ],
  di: ["didi", "dii", "sister", "sis", "\u59d0\u59d0", "\u304a\u59c9\u3055\u3093", "\uc5b8\ub2c8", "\ub204\ub098"],
  didi: ["dii", "di", "sister", "sis", "\u59d0\u59d0", "\u304a\u59c9\u3055\u3093", "\uc5b8\ub2c8", "\ub204\ub098"],
  bhai: ["bhaiya", "brother", "bro"],
  bhaiya: ["bhai", "brother", "bro"],
  boss: ["manager", "sir"],
};

const STRICT_RELATIONSHIP_CONTACT_CANONICALS = new Set([
  "maa",
  "papa",
  "didi",
  "bhai",
]);

export type ContactSearchCandidate = {
  name: string;
  phone: string | null;
  jid: string | null;
  aliases: string[];
  identityKey?: string | null;
};

export type ResolvedContactMatchSource = "fuzzy" | "live";

export type ResolvedContactMatchConfidence =
  | "verified"
  | "confirmation_required"
  | "weak";

type WhatsAppContactRow = {
  jid: string | null;
  phone_number: string | null;
  contact_name: string | null;
  notify_name: string | null;
  verified_name: string | null;
  aliases?: string[] | null;
};

type WhatsAppMessageRow = {
  remote_jid: string | null;
  remote_phone: string | null;
  contact_name: string | null;
  content?: string | null;
  direction?: string | null;
  message_type?: string | null;
  chat_type?: string | null;
};

type ContactScoreDetail = {
  score: number;
  exact: boolean;
  matchedAlias: string;
  matchBasis: ContactMatchBasis;
};

type FallbackWhatsAppContactCandidate = Awaited<ReturnType<typeof loadFallbackSyncedWhatsAppContacts>>[number];

const RESOLVED_CONTACT_GENERIC_TOKENS = new Set([
  "contact",
  "classmate",
  "friend",
  "mate",
  "bro",
  "bhai",
  "dost",
  "sir",
  "madam",
  "mr",
  "mrs",
  "ms",
]);

export function normalizeResolvedContactNameTokens(value: string) {
  const rawTokens = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const specificTokens = uniqueStrings(
    rawTokens.filter((token) => {
      if (token.length < 3 || RESOLVED_CONTACT_GENERIC_TOKENS.has(token)) {
        return false;
      }

      if (normalizeAddressHonorificToken(token)) {
        return false;
      }

      const canonical = normalizeContactName(token);
      return Boolean(canonical && !STRICT_RELATIONSHIP_CONTACT_CANONICALS.has(canonical));
    }),
  );

  if (specificTokens.length) {
    return specificTokens;
  }

  return uniqueStrings(
    rawTokens.filter((token) => token.length >= 2 && !RESOLVED_CONTACT_GENERIC_TOKENS.has(token)),
  );
}

function hasAnchoredSpecificNameOverlap(input: {
  requestedName: string;
  resolvedName: string;
}) {
  const requestedSpecificTokens = normalizeResolvedContactNameTokens(input.requestedName);
  const requestedRawTokens = String(input.requestedName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  if (requestedSpecificTokens.length !== 1 || requestedRawTokens.length <= 1) {
    return false;
  }

  const requestedSpecific = requestedSpecificTokens[0]!;
  const resolvedTokens = normalizeResolvedContactNameTokens(input.resolvedName);
  return resolvedTokens.some((resolvedToken) => namesShareTokenLoosely(requestedSpecific, resolvedToken));
}

function normalizeRelationshipSafeContactName(name: string) {
  let normalized = String(name ?? "")
    .normalize("NFKC")
    .replace(/[\u200d\uFE0F]/g, "")
    .replace(/[_]+/g, " ")
    .replace(/[â€œâ€"']/g, "")
    .replace(/[^\p{L}\p{M}\p{N}\s.&+\-/\u0900-\u097F]/gu, " ")
    .toLowerCase()
    .trim();

  if (!normalized) {
    return "";
  }

  normalized = normalized.replace(/'s$/, "").trim();
  normalized = normalized.replace(/\b(?:contact|phone|number)\b/gi, "").replace(/\s+/g, " ").trim();

  const words = normalized.split(/\s+/).filter(Boolean);
  while (words.length > 1) {
    const lastWord = words[words.length - 1];
    if (lastWord && HINDI_HONORIFICS.includes(lastWord as (typeof HINDI_HONORIFICS)[number])) {
      words.pop();
      continue;
    }
    break;
  }

  return words.join(" ").trim();
}

function normalizeHistoryAddressPreservingHonorifics(name: string) {
  return String(name ?? "")
    .normalize("NFKC")
    .replace(/[\u200d\uFE0F]/g, "")
    .replace(/[_]+/g, " ")
    .replace(/[Ã¢â‚¬Å“Ã¢â‚¬Â"']/g, "")
    .replace(/[^\p{L}\p{M}\p{N}\s.&+\-/\u0900-\u097F]/gu, " ")
    .toLowerCase()
    .replace(/'s$/, "")
    .replace(/\b(?:contact|phone|number)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAddressAwareContactScoreName(name: string) {
  const preserved = normalizeHistoryAddressPreservingHonorifics(name);
  const stripped = normalizeRelationshipSafeContactName(name);
  if (!preserved) {
    return stripped;
  }

  const preservedWords = preserved.split(/\s+/).filter(Boolean);
  if (preservedWords.length < 2) {
    return stripped || preserved;
  }

  const trailingHonorific = preservedWords[preservedWords.length - 1];
  const leadingToken = preservedWords[0];
  const leadingIsGenericRelationship = Boolean(
    leadingToken
    && (
      HINDI_HONORIFICS.includes(leadingToken as (typeof HINDI_HONORIFICS)[number])
      || STRICT_RELATIONSHIP_CONTACT_CANONICALS.has(normalizeContactName(leadingToken))
    ),
  );

  if (
    trailingHonorific
    && HINDI_HONORIFICS.includes(trailingHonorific as (typeof HINDI_HONORIFICS)[number])
    && leadingToken
    && leadingToken.length >= 3
    && !leadingIsGenericRelationship
  ) {
    return preserved;
  }

  return stripped || preserved;
}

function getSingleCanonicalRelationshipAlias(value: string) {
  const canonical = normalizeContactName(value);
  const tokens = canonical.split(/\s+/).filter(Boolean);
  if (tokens.length !== 1) {
    return null;
  }

  const token = tokens[0]!;
  return STRICT_RELATIONSHIP_CONTACT_CANONICALS.has(token) ? token : null;
}

function isAnchoredStrictRelationshipAliasVariant(input: {
  rawRequestedName: string;
  primaryQuery: string;
  queryVariant: string;
  storedName: string;
}) {
  const requestedRelationshipAlias =
    getSingleCanonicalRelationshipAlias(input.rawRequestedName)
    ?? getSingleCanonicalRelationshipAlias(input.primaryQuery);
  if (!requestedRelationshipAlias) {
    return true;
  }

  const variantRelationshipAlias = getSingleCanonicalRelationshipAlias(input.queryVariant);
  if (variantRelationshipAlias !== requestedRelationshipAlias) {
    return true;
  }

  const normalizedVariant = normalizeRelationshipSafeContactName(input.queryVariant);
  const normalizedPrimaryQuery = normalizeRelationshipSafeContactName(input.primaryQuery);
  const normalizedRequestedName = normalizeRelationshipSafeContactName(input.rawRequestedName);
  const compactRequestedName = normalizedRequestedName.replace(/\s+/g, "");
  const compactVariant = normalizedVariant.replace(/\s+/g, "");

  if (
    !normalizedVariant
    || normalizedVariant === normalizedPrimaryQuery
    || normalizedVariant === normalizedRequestedName
    || (compactRequestedName && compactVariant === compactRequestedName)
  ) {
    return true;
  }

  const normalizedStoredCanonical = normalizeContactName(input.storedName);
  if (!normalizedStoredCanonical) {
    return false;
  }

  return (
    normalizedStoredCanonical === requestedRelationshipAlias
    || normalizedStoredCanonical.startsWith(`${requestedRelationshipAlias} `)
    || normalizedStoredCanonical.endsWith(` ${requestedRelationshipAlias}`)
  );
}

function hasLiteralRelationshipTokenOverlap(requestedName: string, resolvedName: string) {
  const requestedTokens = normalizeRelationshipSafeContactName(requestedName)
    .split(/\s+/)
    .filter(Boolean);
  const resolvedTokens = normalizeRelationshipSafeContactName(resolvedName)
    .split(/\s+/)
    .filter(Boolean);

  if (!requestedTokens.length || !resolvedTokens.length) {
    return false;
  }

  return requestedTokens.some((requestedToken) =>
    resolvedTokens.some((resolvedToken) => namesShareTokenLoosely(requestedToken, resolvedToken)));
}

function isSpecificNamedRelationshipVariant(
  resolvedName: string,
  requestedRelationshipAlias: string,
) {
  const resolvedTokens = normalizeHistoryAddressPreservingHonorifics(resolvedName)
    .split(/\s+/)
    .filter(Boolean);
  if (resolvedTokens.length < 2) {
    return false;
  }

  const canonicalTokens = resolvedTokens
    .map((token) => normalizeContactName(token))
    .filter(Boolean);
  if (!canonicalTokens.includes(requestedRelationshipAlias)) {
    return false;
  }

  return resolvedTokens.some((token) => {
    if (token.length < 3) {
      return false;
    }

    if (normalizeAddressHonorificToken(token)) {
      return false;
    }

    const canonical = normalizeContactName(token);
    return Boolean(canonical && !STRICT_RELATIONSHIP_CONTACT_CANONICALS.has(canonical));
  });
}

function requiresStrictRelationshipAliasConfirmation(input: {
  requestedName: string;
  resolvedName: string;
}) {
  const requestedRelationshipAlias = getSingleCanonicalRelationshipAlias(input.requestedName);
  if (!requestedRelationshipAlias) {
    return false;
  }

  if (isSpecificNamedRelationshipVariant(input.resolvedName, requestedRelationshipAlias)) {
    return true;
  }

  return !hasLiteralRelationshipTokenOverlap(input.requestedName, input.resolvedName);
}

export function normalizeResolvedContactMatchScore(score: number | null | undefined) {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return null;
  }

  const normalized = score > 1 ? score / 100 : score;
  return Math.max(0, Math.min(1, normalized));
}

export function isConfidentResolvedContactMatch(input: {
  requestedName: string;
  resolvedName: string;
  exact: boolean;
  score: number;
  matchBasis: ContactMatchBasis | null;
}) {
  if (requiresStrictRelationshipAliasConfirmation(input)) {
    return false;
  }

  if (input.exact) {
    return true;
  }

  const normalizedScore = normalizeResolvedContactMatchScore(input.score) ?? 0;
  const requestedTokens = normalizeResolvedContactNameTokens(input.requestedName);
  const resolvedTokens = normalizeResolvedContactNameTokens(input.resolvedName);
  if (!requestedTokens.length || !resolvedTokens.length) {
    return normalizedScore >= 0.9;
  }

  const requestedJoined = requestedTokens.join(" ");
  const resolvedJoined = resolvedTokens.join(" ");
  if (requestedJoined === resolvedJoined || resolvedJoined.startsWith(`${requestedJoined} `)) {
    return true;
  }

  const overlapCount = requestedTokens.filter((token) => resolvedTokens.includes(token)).length;
  if (overlapCount === requestedTokens.length) {
    return true;
  }

  if (
    hasAnchoredSpecificNameOverlap(input)
    && normalizedScore >= 0.88
    && (input.matchBasis === "exact" || input.matchBasis === "prefix" || input.matchBasis === "word")
  ) {
    return true;
  }

  if (input.matchBasis === "word" && normalizedScore >= 0.9 && overlapCount >= 1) {
    return requestedTokens.length === 1;
  }

  if (
    input.matchBasis === "prefix"
    && requestedTokens[0]
    && requestedTokens[0].length >= 4
    && normalizedScore >= 0.93
  ) {
    return requestedTokens.length === 1;
  }

  if (input.matchBasis === "fuzzy" && normalizedScore >= 0.97 && requestedTokens.length > 1) {
    return true;
  }

  return false;
}

export function isProfessionallyCommittedResolvedContactMatch(input: {
  requestedName: string;
  resolvedName: string;
  exact: boolean;
  score: number;
  matchBasis: ContactMatchBasis | null;
  source: ResolvedContactMatchSource;
}) {
  if (requiresStrictRelationshipAliasConfirmation(input)) {
    return false;
  }

  if (!isConfidentResolvedContactMatch(input)) {
    return false;
  }

  if (input.exact) {
    return true;
  }

  const normalizedScore = normalizeResolvedContactMatchScore(input.score) ?? 0;
  const requestedTokens = normalizeResolvedContactNameTokens(input.requestedName);
  if (!requestedTokens.length) {
    return input.source === "fuzzy" && normalizedScore >= 0.96;
  }

  if (input.source === "live") {
    return false;
  }

  if (requestedTokens.length === 1) {
    if (
      input.source === "fuzzy"
      && hasAnchoredSpecificNameOverlap(input)
      && normalizedScore >= 0.88
      && (input.matchBasis === "exact" || input.matchBasis === "prefix" || input.matchBasis === "word")
    ) {
      return true;
    }

    return input.exact || input.matchBasis === "exact";
  }

  if (input.matchBasis === "prefix") {
    return normalizedScore >= 0.92;
  }

  if (input.matchBasis === "word") {
    return normalizedScore >= 0.94;
  }

  return input.matchBasis === "exact" || (input.matchBasis === "fuzzy" && normalizedScore >= 0.97);
}

export function classifyResolvedContactMatchConfidence(input: {
  requestedName: string;
  resolvedName: string;
  exact: boolean;
  score: number;
  matchBasis: ContactMatchBasis | null;
  source: ResolvedContactMatchSource;
}): ResolvedContactMatchConfidence {
  if (requiresStrictRelationshipAliasConfirmation(input)) {
    return "confirmation_required";
  }

  if (isProfessionallyCommittedResolvedContactMatch(input)) {
    return "verified";
  }

  if (isConfidentResolvedContactMatch(input)) {
    return "confirmation_required";
  }

  return "weak";
}

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
  return normalizeRelationshipSafeContactName(name);
}

function getNameVariants(query: string): string[] {
  const base = normalizeName(query);
  const variants = new Set<string>();

  if (base) {
    variants.add(base);
    variants.add(base.replace(/\s+/g, ""));
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

function expandStoredAliasVariants(alias: string): string[] {
  const normalized = normalizeName(alias);
  const addressAware = normalizeAddressAwareContactScoreName(alias);
  if (!normalized && !addressAware) {
    return [];
  }

  const variants = new Set<string>();
  for (const variant of [normalized, addressAware]) {
    if (!variant) {
      continue;
    }
    variants.add(variant);
    variants.add(variant.replace(/\s+/g, ""));
  }

  const words = normalized.split(/\s+/).filter(Boolean);

  for (const word of words) {
    variants.add(word);
  }

  return [...variants].filter(Boolean);
}

function pickBetterContactScore(current: ContactScoreDetail | null, next: ContactScoreDetail) {
  if (!current) {
    return next;
  }

  if (next.score > current.score) {
    return next;
  }

  if (next.score === current.score && next.matchBasis === "exact" && current.matchBasis !== "exact") {
    return next;
  }

  if (next.score === current.score) {
    const currentAlias = normalizeAddressAwareContactScoreName(current.matchedAlias);
    const nextAlias = normalizeAddressAwareContactScoreName(next.matchedAlias);
    const currentWordCount = currentAlias.split(/\s+/).filter(Boolean).length;
    const nextWordCount = nextAlias.split(/\s+/).filter(Boolean).length;

    if (nextWordCount > currentWordCount) {
      return next;
    }

    if (nextWordCount === currentWordCount && nextAlias.length > currentAlias.length) {
      return next;
    }
  }

  return current;
}

function namesShareTokenLoosely(left: string, right: string) {
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function normalizeAddressHonorificToken(token: string) {
  const normalized = normalizeContactName(token);
  if (normalized && HINDI_HONORIFICS.includes(normalized as (typeof HINDI_HONORIFICS)[number])) {
    return normalized;
  }

  for (const expansion of COMMON_NICKNAME_EXPANSIONS[normalized] ?? []) {
    const canonical = normalizeContactName(expansion);
    if (canonical && HINDI_HONORIFICS.includes(canonical as (typeof HINDI_HONORIFICS)[number])) {
      return canonical;
    }
  }

  return null;
}

function extractAddressHonorificTokens(value: string) {
  return normalizeHistoryAddressPreservingHonorifics(value)
    .split(/\s+/)
    .map((token) => normalizeAddressHonorificToken(token))
    .filter((token): token is string => Boolean(token));
}

function scoreContact(
  queryVariants: string[],
  storedName: string,
  primaryQuery: string,
  rawRequestedName: string,
): ContactScoreDetail {
  const normalizedStored = normalizeAddressAwareContactScoreName(storedName);
  const storedWords = normalizedStored.split(/\s+/).filter(Boolean);
  const primaryQueryWords = primaryQuery.split(/\s+/).filter(Boolean);
  const requestedHonorifics = new Set(extractAddressHonorificTokens(rawRequestedName));
  const storedHonorifics = new Set(extractAddressHonorificTokens(storedName));
  const addressHonorificBonus =
    requestedHonorifics.size && [...storedHonorifics].some((token) => requestedHonorifics.has(token))
      ? ADDRESS_HONORIFIC_MATCH_BONUS
      : 0;
  const compactPrimaryQuery = primaryQuery.replace(/\s+/g, "");
  const compactStored = normalizedStored.replace(/\s+/g, "");
  const hasCompositePrimaryQuery = primaryQueryWords.length > 1;
  const storedContainsAllPrimaryWords = hasCompositePrimaryQuery
    && primaryQueryWords.every((queryWord) => storedWords.some((storedWord) => namesShareTokenLoosely(storedWord, queryWord)));
  let best: ContactScoreDetail | null = null;

  if (storedContainsAllPrimaryWords) {
    best = pickBetterContactScore(best, {
      score:
        normalizedStored.startsWith(primaryQuery) || compactStored.startsWith(compactPrimaryQuery)
          ? STARTS_WITH_SCORE + 0.04 + addressHonorificBonus
          : WORD_MATCH_SCORE + 0.06 + addressHonorificBonus,
      exact: false,
      matchedAlias: storedName,
      matchBasis:
        normalizedStored.startsWith(primaryQuery) || compactStored.startsWith(compactPrimaryQuery)
          ? "prefix"
          : "word",
    });
  }

  for (const query of queryVariants) {
    if (!query) continue;
    if (!isAnchoredStrictRelationshipAliasVariant({
      rawRequestedName,
      primaryQuery,
      queryVariant: query,
      storedName,
    })) {
      continue;
    }

    const queryWords = query.split(/\s+/).filter(Boolean);
    const compactQuery = query.replace(/\s+/g, "");
    const isFullQueryExact =
      Boolean(primaryQuery)
      && (query === primaryQuery || compactQuery === compactPrimaryQuery);
    const isLooseSingleWordVariant = queryWords.length === 1 && !isFullQueryExact;
    const blocksCompositeStructuredFallback =
      hasCompositePrimaryQuery
      && !storedContainsAllPrimaryWords
      && (
        isLooseSingleWordVariant
        || (compactQuery === compactPrimaryQuery && query !== primaryQuery)
      );

    if (hasCompositePrimaryQuery && isLooseSingleWordVariant && !storedContainsAllPrimaryWords) {
      continue;
    }

    if (normalizedStored === query) {
      if (isFullQueryExact) {
        return {
          score: EXACT_SCORE,
          exact: true,
          matchedAlias: storedName,
          matchBasis: "exact",
        };
      }

      best = pickBetterContactScore(best, {
        score: WORD_MATCH_SCORE + 0.01 + addressHonorificBonus,
        exact: false,
        matchedAlias: storedName,
        matchBasis: "word",
      });
      continue;
    }

    const allowLoosePartialMatch =
      query.length >= PARTIAL_MATCH_QUERY_MIN_LENGTH
      && !blocksCompositeStructuredFallback;

    if (
      allowLoosePartialMatch
      && (normalizedStored.startsWith(query) || query.startsWith(normalizedStored))
    ) {
      best = pickBetterContactScore(best, {
        score: STARTS_WITH_SCORE + addressHonorificBonus,
        exact: false,
        matchedAlias: storedName,
        matchBasis: "prefix",
      });
      continue;
    }

    const allowLooseWordFallback =
      allowLoosePartialMatch
      && !(
        hasCompositePrimaryQuery
        && !storedContainsAllPrimaryWords
        && isFullQueryExact
      );

    if (allowLooseWordFallback) {
      for (const word of storedWords) {
        if (word === query || word.startsWith(query) || query.startsWith(word)) {
          best = pickBetterContactScore(best, {
            score: WORD_MATCH_SCORE + addressHonorificBonus,
            exact: false,
            matchedAlias: storedName,
            matchBasis: "word",
          });
        }
      }
    }

    if (query === primaryQuery) {
      best = pickBetterContactScore(best, {
        score: similarity(query, normalizedStored) + addressHonorificBonus,
        exact: false,
        matchedAlias: storedName,
        matchBasis: "fuzzy",
      });

      best = pickBetterContactScore(best, {
        score: similarity(query, storedWords[0] ?? normalizedStored) * 0.9 + addressHonorificBonus,
        exact: false,
        matchedAlias: storedWords[0] ?? storedName,
        matchBasis: "fuzzy",
      });
    }
  }

  return best ?? {
    score: 0,
    exact: false,
    matchedAlias: storedName,
    matchBasis: "fuzzy",
  };
}

function describeContactMatchReason(match: ContactMatch) {
  const alias = match.matchedAlias?.trim();
  switch (match.matchBasis) {
    case "exact":
      return alias ? `exact alias "${alias}"` : "exact alias match";
    case "prefix":
      return alias ? `close alias "${alias}"` : "close alias match";
    case "word":
      return alias ? `shared name word "${alias}"` : "shared name word";
    case "fuzzy":
    default:
      return alias ? `similar alias "${alias}"` : "similar alias match";
  }
}

function buildAmbiguityPrompt(queryName: string, matches: ContactMatch[]): string {
  const requestedLabel = queryName.replace(/\s+/g, " ").trim() || "that contact";
  return [
    `I found more than one strong WhatsApp match for "${requestedLabel}".`,
    "",
    `Which ${requestedLabel} should I use?`,
    "",
    ...matches.map((match, index) =>
      match.phone
        ? `*${index + 1}.* ${match.name} - +${match.phone} (${describeContactMatchReason(match)})`
        : `*${index + 1}.* ${match.name} (${describeContactMatchReason(match)})`,
    ),
    "",
    "Tell me the exact contact name or full number and I will use the right chat.",
    'Example: _Send "Hello" to Raj Sharma_',
  ].join("\n");
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function buildContactIdentityKey(input: {
  identityKey?: string | null;
  phone?: string | null;
  jid?: string | null;
}) {
  const identityKey = String(input.identityKey ?? "").trim();
  if (identityKey) {
    return identityKey;
  }

  const phone = normalizePhone(String(input.phone ?? ""));
  if (phone) {
    return `phone:${phone}`;
  }

  const jid = String(input.jid ?? "").trim().toLowerCase();
  return jid ? `jid:${jid}` : null;
}

function normalizeHistoryAliasInferenceText(value: string) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200d\uFE0F]/g, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s\u0900-\u097F]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferRelationshipAliasesFromShortDirectChatText(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (
    !raw
    || raw.length > HISTORY_RELATIONSHIP_ALIAS_MESSAGE_MAX_LENGTH
    || /[\r\n]/.test(raw)
    || SYSTEM_LIKE_HISTORY_ALIAS_PATTERN.test(raw)
  ) {
    return [] as string[];
  }

  const normalized = normalizeHistoryAliasInferenceText(raw);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [] as string[];
  }

  const phraseCandidates = uniqueStrings([
    words[0],
    words[words.length - 1],
    words.slice(0, 2).join(" "),
    words.slice(-2).join(" "),
  ]);

  return phraseCandidates
    .map((phrase) => normalizeContactName(phrase))
    .filter((alias) => HISTORY_RELATIONSHIP_ALIAS_CANONICALS.has(alias));
}

function inferAddressLikeAliasesFromShortDirectChatText(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (
    !raw
    || raw.length > HISTORY_RELATIONSHIP_ALIAS_MESSAGE_MAX_LENGTH
    || /[\r\n]/.test(raw)
    || SYSTEM_LIKE_HISTORY_ALIAS_PATTERN.test(raw)
  ) {
    return [] as string[];
  }

  const normalized = normalizeHistoryAliasInferenceText(raw);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (!words.length) {
    return [] as string[];
  }

  const relationshipAliases = inferRelationshipAliasesFromShortDirectChatText(raw);
  const trimmedWords = [...words];
  while (trimmedWords.length && HISTORY_ADDRESS_PREFIX_STOPWORDS.has(trimmedWords[0]!)) {
    trimmedWords.shift();
  }

  if (trimmedWords.length < 2) {
    return relationshipAliases;
  }

  const first = trimmedWords[0]!;
  const second = trimmedWords[1]!;
  const third = trimmedWords[2] ?? "";
  const secondIsHonorific = HINDI_HONORIFICS.includes(second as (typeof HINDI_HONORIFICS)[number]);
  const thirdIsHonorific = HINDI_HONORIFICS.includes(third as (typeof HINDI_HONORIFICS)[number]);
  const firstIsSpecificName =
    first.length >= 3
    && !HINDI_HONORIFICS.includes(first as (typeof HINDI_HONORIFICS)[number])
    && !HISTORY_ADDRESS_PREFIX_STOPWORDS.has(first)
    && !STRICT_RELATIONSHIP_CONTACT_CANONICALS.has(normalizeContactName(first));

  const aliases = new Set<string>(relationshipAliases);
  if (firstIsSpecificName && secondIsHonorific) {
    aliases.add(normalizeHistoryAddressPreservingHonorifics(`${first} ${second}`));
    if (third && thirdIsHonorific) {
      aliases.add(normalizeHistoryAddressPreservingHonorifics(`${first} ${second} ${third}`));
    }
  }

  return [...aliases].filter(Boolean);
}

function buildHistoryDerivedWhatsAppAliases(messages: WhatsAppMessageRow[]) {
  const aliasCounts = new Map<string, Map<string, number>>();

  for (const message of messages) {
    if (String(message.direction ?? "").trim().toLowerCase() !== "outbound") {
      continue;
    }

    const chatType = String(message.chat_type ?? "").trim().toLowerCase();
    if (chatType && chatType !== "direct") {
      continue;
    }

    const messageType = String(message.message_type ?? "").trim().toLowerCase();
    if (messageType && messageType !== "text") {
      continue;
    }

    const inferredAliases = inferAddressLikeAliasesFromShortDirectChatText(message.content);
    if (!inferredAliases.length) {
      continue;
    }

    const phone = normalizeWhatsAppCandidatePhone(message.remote_jid, message.remote_phone);
    const keys = uniqueStrings([
      buildContactIdentityKey({ phone }),
      buildContactIdentityKey({ jid: message.remote_jid }),
    ]);

    for (const key of keys) {
      const counts = aliasCounts.get(key) ?? new Map<string, number>();
      for (const alias of inferredAliases) {
        counts.set(alias, (counts.get(alias) ?? 0) + 1);
      }
      aliasCounts.set(key, counts);
    }
  }

  const inferredByIdentity = new Map<string, string[]>();
  for (const [key, counts] of aliasCounts.entries()) {
    const aliases = [...counts.entries()]
      .filter(([alias, count]) => {
        const canonicalAlias = normalizeContactName(alias);
        if (HISTORY_RELATIONSHIP_ALIAS_CANONICALS.has(canonicalAlias)) {
          return count >= HISTORY_RELATIONSHIP_ALIAS_MIN_OCCURRENCES;
        }

        return count >= HISTORY_ADDRESS_ALIAS_MIN_OCCURRENCES;
      })
      .sort((left, right) => {
        if (right[1] !== left[1]) {
          return right[1] - left[1];
        }
        return left[0].localeCompare(right[0]);
      })
      .map(([alias]) => alias);

    if (aliases.length) {
      inferredByIdentity.set(key, aliases);
    }
  }

  return inferredByIdentity;
}

export function buildHistoryDerivedWhatsAppAliasesForTest(messages: WhatsAppMessageRow[]) {
  return Object.fromEntries(
    [...buildHistoryDerivedWhatsAppAliases(messages).entries()].map(([key, aliases]) => [key, [...aliases]]),
  ) as Record<string, string[]>;
}

export function extractWhatsAppHistorySearchTokensForTest(rawName: string) {
  return [...extractWhatsAppHistorySearchTokens(rawName)];
}

function isStructuredContactMatch(match: Pick<ContactMatch, "exact" | "matchBasis">) {
  return Boolean(match.exact || match.matchBasis === "exact" || match.matchBasis === "prefix" || match.matchBasis === "word");
}

function normalizeWhatsAppCandidatePhone(jid: string | null | undefined, phone: string | null | undefined) {
  const normalizedJid = String(jid ?? "").trim().toLowerCase();
  if (normalizedJid.endsWith("@lid")) {
    return null;
  }

  return normalizePhone(phone ?? "");
}

function buildSavedContactCandidates(entries: Array<[string, string]>): ContactSearchCandidate[] {
  const candidates: ContactSearchCandidate[] = [];

  for (const [storedName, phone] of entries) {
    const normalizedPhone = normalizePhone(phone);
    const normalizedName = normalizeName(storedName);
    if (!normalizedPhone || !normalizedName) {
      continue;
    }

    candidates.push({
      name: formatContactDisplayName(storedName),
      phone: normalizedPhone,
      jid: null,
      aliases: uniqueStrings([storedName, normalizedName]),
      identityKey: normalizedPhone ? `phone:${normalizedPhone}` : null,
    });
  }

  return candidates;
}

function extractWhatsAppHistorySearchTokens(rawName: string) {
  const normalized = normalizeHistoryAddressPreservingHonorifics(rawName);
  if (!normalized) {
    return [] as string[];
  }

  return uniqueStrings(
    normalized
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => {
        if (!token || token.length < 3) {
          return false;
        }

        if (HISTORY_ADDRESS_PREFIX_STOPWORDS.has(token)) {
          return false;
        }

        if (normalizeAddressHonorificToken(token)) {
          return false;
        }

        const canonical = normalizeContactName(token);
        return Boolean(canonical && !STRICT_RELATIONSHIP_CONTACT_CANONICALS.has(canonical));
      }),
  );
}

function buildPhoneMatchedContact(
  candidate: ContactSearchCandidate,
  score: number,
  exact: boolean,
): ContactMatch {
  const normalizedPhone = normalizePhone(String(candidate.phone ?? ""));
  return {
    name: candidate.name,
    phone: normalizedPhone || null,
    jid: candidate.jid,
    aliases: [...candidate.aliases],
    score,
    exact,
    matchedAlias: normalizedPhone || undefined,
    matchBasis: exact ? "exact" : "prefix",
  };
}

function buildWhatsAppContactCandidatesFromRows(input: {
  contacts: WhatsAppContactRow[];
  messages: WhatsAppMessageRow[];
  fallbackContacts: FallbackWhatsAppContactCandidate[];
}) {
  const inferredHistoryAliases = buildHistoryDerivedWhatsAppAliases(input.messages);
  const receiptDerivedAliases = buildWhatsAppReceiptDerivedAliasMap(
    input.messages.map((message) => ({
      content: message.content,
      direction: message.direction,
      chatType: message.chat_type,
      remotePhone: message.remote_phone,
      remoteJid: message.remote_jid,
    })),
  );
  const identities = buildClawCloudWhatsAppContactIdentityGraph([
    ...input.contacts.map((contact) => ({
      jid: contact.jid,
      phone: normalizeWhatsAppCandidatePhone(contact.jid, contact.phone_number),
      displayName: contact.contact_name ?? contact.notify_name ?? contact.verified_name,
      aliases: uniqueStrings([
        contact.contact_name,
        contact.notify_name,
        contact.verified_name,
        ...(Array.isArray(contact.aliases) ? contact.aliases : []),
      ]),
    })),
    ...input.messages.map((message) => ({
      jid: message.remote_jid,
      phone: normalizeWhatsAppCandidatePhone(message.remote_jid, message.remote_phone),
      displayName: message.contact_name ?? message.remote_phone ?? message.remote_jid,
      aliases: uniqueStrings([message.contact_name, message.remote_phone]),
    })),
    ...input.fallbackContacts.map((contact) => ({
      jid: contact.jid,
      phone: normalizeWhatsAppCandidatePhone(contact.jid, contact.phone_number),
      displayName: contact.contact_name ?? contact.notify_name ?? contact.verified_name,
      aliases: uniqueStrings([
        contact.contact_name,
        contact.notify_name,
        contact.verified_name,
        ...(Array.isArray(contact.aliases) ? contact.aliases : []),
        ...(Array.isArray(contact.identity_aliases) ? contact.identity_aliases : []),
      ]),
      identityKey: contact.identity_key,
      identityJids: contact.identity_jids,
    })),
    ...[...receiptDerivedAliases.entries()].map(([phone, aliases]) => ({
      jid: `${phone}@s.whatsapp.net`,
      phone,
      displayName: formatContactDisplayName(aliases[0] ?? phone),
      aliases,
      identityKey: `phone:${phone}`,
    })),
  ]);

  return identities.map((identity) => {
    const identityKey = buildContactIdentityKey({
      identityKey: identity.identityKey,
      phone: identity.phone,
      jid: identity.primaryJid,
    });
    const inferredAliases = uniqueStrings([
      ...(identityKey ? inferredHistoryAliases.get(identityKey) ?? [] : []),
      ...(identity.primaryJid ? inferredHistoryAliases.get(buildContactIdentityKey({ jid: identity.primaryJid }) ?? "") ?? [] : []),
    ]);
    const displayNameLooksNumeric = !/[^\d\s+()\-]/.test(identity.displayName);

    return {
      name:
        displayNameLooksNumeric && inferredAliases.length
          ? formatContactDisplayName(inferredAliases[0] ?? identity.displayName)
          : identity.displayName,
      phone: identity.phone,
      jid: identity.primaryJid,
      aliases: [...new Set([
        ...identity.aliases.flatMap((alias) => expandStoredAliasVariants(alias)),
        ...inferredAliases.flatMap((alias) => expandStoredAliasVariants(alias)),
      ])],
      identityKey: identity.identityKey,
    } satisfies ContactSearchCandidate;
  });
}

async function loadWhatsAppContactCandidates(userId: string): Promise<ContactSearchCandidate[]> {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const [contactsResult, messagesResult] = await Promise.all([
    supabaseAdmin
      .from("whatsapp_contacts")
      .select("jid, phone_number, contact_name, notify_name, verified_name")
      .eq("user_id", userId)
      .order("last_seen_at", { ascending: false })
      .limit(300),
    supabaseAdmin
      .from("whatsapp_messages")
      .select("remote_jid, remote_phone, contact_name, content, direction, message_type, chat_type")
      .eq("user_id", userId)
      .order("sent_at", { ascending: false })
      .limit(WHATSAPP_HISTORY_LIMIT),
  ]);
  const fallbackContacts = await loadFallbackSyncedWhatsAppContacts(userId).catch(() => []);

  const contacts = ((contactsResult.data ?? []) as WhatsAppContactRow[]).filter(Boolean);
  const messages = ((messagesResult.data ?? []) as WhatsAppMessageRow[]).filter(Boolean);
  return buildWhatsAppContactCandidatesFromRows({
    contacts,
    messages,
    fallbackContacts,
  });
}

async function loadTargetedWhatsAppHistoryCandidates(
  userId: string,
  rawName: string,
): Promise<ContactSearchCandidate[]> {
  const searchTokens = extractWhatsAppHistorySearchTokens(rawName);
  if (!searchTokens.length) {
    return [];
  }

  const tokenFilters = searchTokens.slice(0, 3);
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const fallbackContacts = await loadFallbackSyncedWhatsAppContacts(userId).catch(() => []);
  const contactFilter = tokenFilters
    .flatMap((token) => [
      `contact_name.ilike.%${token}%`,
      `notify_name.ilike.%${token}%`,
      `verified_name.ilike.%${token}%`,
    ])
    .join(",");
  const messageFilter = tokenFilters
    .flatMap((token) => [
      `contact_name.ilike.%${token}%`,
      `content.ilike.%${token}%`,
    ])
    .join(",");

  const [contactsResult, messagesResult] = await Promise.all([
    supabaseAdmin
      .from("whatsapp_contacts")
      .select("jid, phone_number, contact_name, notify_name, verified_name")
      .eq("user_id", userId)
      .or(contactFilter)
      .limit(120),
    supabaseAdmin
      .from("whatsapp_messages")
      .select("remote_jid, remote_phone, contact_name, content, direction, message_type, chat_type")
      .eq("user_id", userId)
      .or(messageFilter)
      .order("sent_at", { ascending: false })
      .limit(1200),
  ]);

  const contacts = ((contactsResult.data ?? []) as WhatsAppContactRow[]).filter(Boolean);
  const messages = ((messagesResult.data ?? []) as WhatsAppMessageRow[]).filter(Boolean);
  if (!contacts.length && !messages.length) {
    return [];
  }

  return buildWhatsAppContactCandidatesFromRows({
    contacts,
    messages,
    fallbackContacts,
  });
}

export function rankContactCandidates(
  rawName: string,
  candidates: ContactSearchCandidate[],
): FuzzyLookupResult {
  if (!candidates.length) {
    return { type: "not_found", suggestions: [] };
  }

  const phoneQuery = normalizePhone(rawName);
  if (phoneQuery) {
    const exactPhoneMatches = candidates
      .filter((candidate) => normalizePhone(String(candidate.phone ?? "")) === phoneQuery)
      .map((candidate) => buildPhoneMatchedContact(candidate, EXACT_SCORE, true));
    if (exactPhoneMatches.length === 1) {
      return { type: "found", contact: exactPhoneMatches[0]! };
    }
    if (exactPhoneMatches.length > 1) {
      const matches = exactPhoneMatches.slice(0, 4);
      return {
        type: "ambiguous",
        matches,
        prompt: buildAmbiguityPrompt(rawName, matches),
      };
    }

    const suffixPhoneMatches = candidates
      .filter((candidate) => {
        const normalizedPhone = normalizePhone(String(candidate.phone ?? ""));
        return Boolean(
          normalizedPhone
          && phoneQuery.length >= 7
          && (
            normalizedPhone.endsWith(phoneQuery)
            || phoneQuery.endsWith(normalizedPhone)
          ),
        );
      })
      .map((candidate) => buildPhoneMatchedContact(candidate, STARTS_WITH_SCORE, false));
    if (suffixPhoneMatches.length === 1) {
      return { type: "found", contact: suffixPhoneMatches[0]! };
    }
    if (suffixPhoneMatches.length > 1) {
      const matches = suffixPhoneMatches.slice(0, 4);
      return {
        type: "ambiguous",
        matches,
        prompt: buildAmbiguityPrompt(rawName, matches),
      };
    }
  }

  const queryVariants = getNameVariants(rawName);
  const primaryQuery = normalizeName(rawName);
  const scored: ContactMatch[] = [];

  for (const candidate of candidates) {
    const bestMatch = candidate.aliases.reduce<ContactScoreDetail | null>((best, alias) => {
      const detail = scoreContact(queryVariants, alias, primaryQuery, rawName);
      return pickBetterContactScore(best, detail);
    }, null);

    if ((bestMatch?.score ?? 0) >= FUZZY_THRESHOLD) {
      scored.push({
        name: candidate.name,
        phone: candidate.phone,
        jid: candidate.jid,
        aliases: [...candidate.aliases],
        score: bestMatch?.score ?? 0,
        exact: !!bestMatch?.exact,
        matchedAlias: bestMatch?.matchedAlias,
        matchBasis: bestMatch?.matchBasis,
      });
    }
  }

  scored.sort((left, right) => right.score - left.score);

  if (!scored.length) {
    return {
      type: "not_found",
      suggestions: candidates
        .slice(0, 5)
        .map((candidate) => candidate.name),
    };
  }

  const exactMatches = scored.filter((match) => match.exact || match.matchBasis === "exact");
  if (exactMatches.length) {
    scored.splice(0, scored.length, ...exactMatches);
  } else if (scored.some(isStructuredContactMatch)) {
    const structuredMatches = scored.filter(isStructuredContactMatch);
    scored.splice(0, scored.length, ...structuredMatches);
  }

  if (scored.length === 1) {
    return { type: "found", contact: scored[0]! };
  }

  const top = scored[0]!;
  const runnerUp = scored[1]!;
  if ((top.exact && !runnerUp.exact) || top.score - runnerUp.score > AMBIGUOUS_THRESHOLD) {
    return { type: "found", contact: top };
  }

  const matches = scored.slice(0, 4);
  return {
    type: "ambiguous",
    matches,
    prompt: buildAmbiguityPrompt(rawName, matches),
  };
}

export async function lookupContactFuzzy(
  userId: string,
  rawName: string,
): Promise<FuzzyLookupResult> {
  const contacts = await loadContacts(userId);
  const entries = Object.entries(contacts);
  const savedCandidates = buildSavedContactCandidates(entries);
  const whatsAppCandidates = await loadWhatsAppContactCandidates(userId).catch(() => []);

  const mergedByIdentity = new Map<string, ContactSearchCandidate>();
  for (const candidate of [...savedCandidates, ...whatsAppCandidates]) {
    const key = candidate.identityKey ?? candidate.phone ?? candidate.jid;
    if (!key) {
      continue;
    }

    const existing = mergedByIdentity.get(key);
    if (!existing) {
      mergedByIdentity.set(key, candidate);
      continue;
    }

    const mergedAliases = new Set<string>([...existing.aliases, ...candidate.aliases]);
    mergedByIdentity.set(key, {
      name: existing.name.length >= candidate.name.length ? existing.name : candidate.name,
      phone: existing.phone ?? candidate.phone ?? null,
      jid: existing.jid ?? candidate.jid ?? null,
      aliases: [...mergedAliases],
      identityKey: existing.identityKey ?? candidate.identityKey ?? key,
    });
  }

  const initialResult = rankContactCandidates(rawName, [...mergedByIdentity.values()]);
  if (initialResult.type !== "not_found") {
    return initialResult;
  }

  const targetedHistoryCandidates = await loadTargetedWhatsAppHistoryCandidates(userId, rawName).catch(() => []);
  if (!targetedHistoryCandidates.length) {
    return initialResult;
  }

  for (const candidate of targetedHistoryCandidates) {
    const key = candidate.identityKey ?? candidate.phone ?? candidate.jid;
    if (!key) {
      continue;
    }

    const existing = mergedByIdentity.get(key);
    if (!existing) {
      mergedByIdentity.set(key, candidate);
      continue;
    }

    const mergedAliases = new Set<string>([...existing.aliases, ...candidate.aliases]);
    mergedByIdentity.set(key, {
      name: existing.name.length >= candidate.name.length ? existing.name : candidate.name,
      phone: existing.phone ?? candidate.phone ?? null,
      jid: existing.jid ?? candidate.jid ?? null,
      aliases: [...mergedAliases],
      identityKey: existing.identityKey ?? candidate.identityKey ?? key,
    });
  }

  return rankContactCandidates(rawName, [...mergedByIdentity.values()]);
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
    "- recent WhatsApp chats and contact names",
    "- group participant names seen during WhatsApp sync",
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
