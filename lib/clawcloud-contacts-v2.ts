import {
  formatContactDisplayName,
  loadContacts,
  normalizeContactName,
  normalizePhone,
} from "@/lib/clawcloud-contacts";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
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
const WHATSAPP_HISTORY_LIMIT = 600;

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
  mummy: ["mom", "mother", "mum", "mommy", "maa", "ma"],
  mom: ["mother", "mum", "mummy", "maa", "ma"],
  papa: ["dad", "father", "pappa", "baba", "daddy", "pitaji"],
  papaji: ["papa ji", "papa", "dad", "father", "pitaji", "daddy"],
  dii: ["didi", "di", "sister", "sis"],
  di: ["didi", "dii", "sister", "sis"],
  didi: ["dii", "di", "sister", "sis"],
  bhai: ["bhaiya", "brother", "bro"],
  bhaiya: ["bhai", "brother", "bro"],
  boss: ["manager", "sir"],
};

export type ContactSearchCandidate = {
  name: string;
  phone: string | null;
  jid: string | null;
  aliases: string[];
  identityKey?: string | null;
};

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
};

type ContactScoreDetail = {
  score: number;
  exact: boolean;
  matchedAlias: string;
  matchBasis: ContactMatchBasis;
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
  if (!normalized) {
    return [];
  }

  const variants = new Set<string>([normalized, normalized.replace(/\s+/g, "")]);
  const words = normalized.split(/\s+/).filter(Boolean);

  for (const word of words) {
    variants.add(word);
    for (const expansion of COMMON_NICKNAME_EXPANSIONS[word] ?? []) {
      variants.add(normalizeName(expansion));
    }
  }

  for (const expansion of COMMON_NICKNAME_EXPANSIONS[normalized] ?? []) {
    variants.add(normalizeName(expansion));
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

  return current;
}

function scoreContact(queryVariants: string[], storedName: string): ContactScoreDetail {
  const normalizedStored = normalizeName(storedName);
  const storedWords = normalizedStored.split(/\s+/).filter(Boolean);
  let best: ContactScoreDetail | null = null;

  for (const query of queryVariants) {
    if (!query) continue;

    if (normalizedStored === query) {
      return {
        score: EXACT_SCORE,
        exact: true,
        matchedAlias: storedName,
        matchBasis: "exact",
      };
    }

    if (normalizedStored.startsWith(query) || query.startsWith(normalizedStored)) {
      best = pickBetterContactScore(best, {
        score: STARTS_WITH_SCORE,
        exact: false,
        matchedAlias: storedName,
        matchBasis: "prefix",
      });
      continue;
    }

    for (const word of storedWords) {
      if (word === query || word.startsWith(query) || query.startsWith(word)) {
        best = pickBetterContactScore(best, {
          score: WORD_MATCH_SCORE,
          exact: false,
          matchedAlias: storedName,
          matchBasis: "word",
        });
      }
    }

    best = pickBetterContactScore(best, {
      score: similarity(query, normalizedStored),
      exact: false,
      matchedAlias: storedName,
      matchBasis: "fuzzy",
    });

    best = pickBetterContactScore(best, {
      score: similarity(query, storedWords[0] ?? normalizedStored) * 0.9,
      exact: false,
      matchedAlias: storedWords[0] ?? storedName,
      matchBasis: "fuzzy",
    });
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
  return [
    `I found more than one strong WhatsApp match for "${queryName}":`,
    "",
    ...matches.map((match, index) =>
      match.phone
        ? `*${index + 1}.* ${match.name} - +${match.phone} (${describeContactMatchReason(match)})`
        : `*${index + 1}.* ${match.name} (${describeContactMatchReason(match)})`,
    ),
    "",
    "Tell me the exact contact name or full number and I will queue the right chat.",
    'Example: _Send "Hello" to Raj Sharma_',
  ].join("\n");
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
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
      .select("remote_jid, remote_phone, contact_name")
      .eq("user_id", userId)
      .order("sent_at", { ascending: false })
      .limit(WHATSAPP_HISTORY_LIMIT),
  ]);
  const fallbackContacts = await loadFallbackSyncedWhatsAppContacts(userId).catch(() => []);

  const contacts = ((contactsResult.data ?? []) as WhatsAppContactRow[]).filter(Boolean);
  const messages = ((messagesResult.data ?? []) as WhatsAppMessageRow[]).filter(Boolean);
  const identities = buildClawCloudWhatsAppContactIdentityGraph([
    ...contacts.map((contact) => ({
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
    ...messages.map((message) => ({
      jid: message.remote_jid,
      phone: normalizeWhatsAppCandidatePhone(message.remote_jid, message.remote_phone),
      displayName: message.contact_name ?? message.remote_phone ?? message.remote_jid,
      aliases: uniqueStrings([message.contact_name, message.remote_phone]),
    })),
    ...fallbackContacts.map((contact) => ({
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
  ]);

  return identities.map((identity) => ({
    name: identity.displayName,
    phone: identity.phone,
    jid: identity.primaryJid,
    aliases: [...new Set(
      identity.aliases.flatMap((alias) => expandStoredAliasVariants(alias)),
    )],
    identityKey: identity.identityKey,
  }));
}

export function rankContactCandidates(
  rawName: string,
  candidates: ContactSearchCandidate[],
): FuzzyLookupResult {
  if (!candidates.length) {
    return { type: "not_found", suggestions: [] };
  }

  const queryVariants = getNameVariants(rawName);
  const scored: ContactMatch[] = [];

  for (const candidate of candidates) {
    const bestMatch = candidate.aliases.reduce<ContactScoreDetail | null>((best, alias) => {
      const detail = scoreContact(queryVariants, alias);
      if (detail.score > (best?.score ?? 0)) {
        return detail;
      }
      return best;
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
