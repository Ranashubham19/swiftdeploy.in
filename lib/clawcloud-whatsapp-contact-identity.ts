import { formatContactDisplayName, normalizeContactName } from "@/lib/clawcloud-contacts";

export type ClawCloudWhatsAppContactIdentityQuality =
  | "phone"
  | "alias_bridge"
  | "jid_only";

export type ClawCloudWhatsAppContactIdentitySeed = {
  jid?: string | null;
  phone?: string | null;
  displayName?: string | null;
  aliases?: string[] | null;
  messageCount?: number | null;
  lastMessageAt?: string | null;
  lastSeenAt?: string | null;
  identityKey?: string | null;
  identityAliases?: string[] | null;
  identityJids?: string[] | null;
};

export type ClawCloudWhatsAppContactIdentity = {
  identityKey: string;
  phone: string | null;
  primaryJid: string | null;
  jids: string[];
  displayName: string;
  aliases: string[];
  normalizedAliases: string[];
  quality: ClawCloudWhatsAppContactIdentityQuality;
  memberCount: number;
  messageCount: number | null;
  lastMessageAt: string | null;
  lastSeenAt: string | null;
};

export type ClawCloudWhatsAppDecoratedIdentitySeed<T> = T & {
  identityKey: string;
  identityAliases: string[];
  identityJids: string[];
  identityQuality: ClawCloudWhatsAppContactIdentityQuality;
};

type PreparedIdentitySeed<T> = {
  index: number;
  original: T;
  jid: string | null;
  phone: string | null;
  displayName: string;
  aliases: string[];
  normalizedAliases: string[];
  identityKey: string | null;
  identityJids: string[];
  messageCount: number | null;
  lastMessageAt: string | null;
  lastSeenAt: string | null;
};

type MutableIdentity = {
  identityKey: string;
  phone: string | null;
  primaryJid: string | null;
  jids: Set<string>;
  displayName: string;
  aliases: Set<string>;
  normalizedAliases: Set<string>;
  quality: ClawCloudWhatsAppContactIdentityQuality;
  memberCount: number;
  messageCount: number | null;
  lastMessageAt: string | null;
  lastSeenAt: string | null;
};

type IdentityGraphState<T> = {
  identities: Map<string, MutableIdentity>;
  assignments: Map<number, string>;
  preparedSeeds: PreparedIdentitySeed<T>[];
};

function cleanText(value: string | null | undefined) {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200d\uFE0F]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}

function normalizePhoneDigits(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits || null;
}

export function normalizeClawCloudWhatsAppIdentityJid(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase() || null;
}

function isLidJid(jid: string | null | undefined) {
  return /@lid$/i.test(String(jid ?? "").trim());
}

function phoneFromJid(jid: string | null | undefined) {
  const normalized = normalizeClawCloudWhatsAppIdentityJid(jid);
  if (!normalized || !/@s\.whatsapp\.net$/i.test(normalized)) {
    return null;
  }

  return normalizePhoneDigits(normalized.split("@")[0] ?? null);
}

export function normalizeClawCloudWhatsAppIdentityPhone(input: {
  jid?: string | null;
  phone?: string | null;
}) {
  return normalizePhoneDigits(input.phone) ?? phoneFromJid(input.jid);
}

function normalizeIdentityAlias(value: string | null | undefined) {
  const cleaned = cleanText(value);
  if (!cleaned) {
    return "";
  }

  return normalizeContactName(cleaned);
}

function expandIdentityAliasVariants(value: string | null | undefined) {
  const normalized = normalizeIdentityAlias(value);
  if (!normalized) {
    return [];
  }

  const variants = new Set<string>([normalized, normalized.replace(/\s+/g, "")]);
  for (const word of normalized.split(/\s+/).filter(Boolean)) {
    variants.add(word);
  }

  return [...variants].filter(Boolean);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))] as string[];
}

function latestIsoTimestamp(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .sort()
    .slice(-1)[0] ?? null;
}

function pickPreferredDisplayName(current: string | null | undefined, candidate: string | null | undefined) {
  const currentValue = cleanText(current);
  const candidateValue = cleanText(candidate);
  if (!candidateValue) {
    return currentValue ?? null;
  }
  if (!currentValue) {
    return candidateValue;
  }

  const currentIsDigits = /^\d+$/.test(currentValue);
  const candidateIsDigits = /^\d+$/.test(candidateValue);
  if (currentIsDigits && !candidateIsDigits) {
    return candidateValue;
  }
  if (!currentIsDigits && candidateIsDigits) {
    return currentValue;
  }

  const currentWords = currentValue.split(/\s+/).filter(Boolean).length;
  const candidateWords = candidateValue.split(/\s+/).filter(Boolean).length;
  if (candidateWords > currentWords) {
    return candidateValue;
  }
  if (candidateValue.length > currentValue.length + 2) {
    return candidateValue;
  }

  return currentValue;
}

function pickBetterIdentityQuality(
  current: ClawCloudWhatsAppContactIdentityQuality,
  candidate: ClawCloudWhatsAppContactIdentityQuality,
) {
  const priority: Record<ClawCloudWhatsAppContactIdentityQuality, number> = {
    jid_only: 1,
    alias_bridge: 2,
    phone: 3,
  };

  return priority[candidate] >= priority[current] ? candidate : current;
}

function isMeaningfulAlias(alias: string) {
  return alias.length >= 3 && !/^\d+$/.test(alias);
}

function buildPreparedSeeds<T extends ClawCloudWhatsAppContactIdentitySeed>(seeds: T[]) {
  return seeds
    .map((seed, index): PreparedIdentitySeed<T> | null => {
      const jid = normalizeClawCloudWhatsAppIdentityJid(seed.jid);
      const phone = normalizeClawCloudWhatsAppIdentityPhone({
        jid,
        phone: seed.phone,
      });
      const aliases = uniqueStrings([
        seed.displayName,
        ...(Array.isArray(seed.aliases) ? seed.aliases : []),
        ...(Array.isArray(seed.identityAliases) ? seed.identityAliases : []),
        phone,
      ]);

      if (!jid && !phone && !aliases.length) {
        return null;
      }

      const displayName =
        pickPreferredDisplayName(
          seed.displayName,
          aliases.find((value) => !/^\d+$/.test(value)),
        )
        ?? phone
        ?? jid
        ?? "Unknown contact";

      const normalizedAliases = [...new Set(
        aliases
          .flatMap((alias) => expandIdentityAliasVariants(alias))
          .filter(Boolean),
      )];

      return {
        index,
        original: seed,
        jid,
        phone,
        displayName,
        aliases,
        normalizedAliases,
        identityKey: cleanText(seed.identityKey),
        identityJids: uniqueStrings(Array.isArray(seed.identityJids) ? seed.identityJids : []),
        messageCount:
          typeof seed.messageCount === "number" && Number.isFinite(seed.messageCount)
            ? Math.max(0, Math.trunc(seed.messageCount))
            : null,
        lastMessageAt: cleanText(seed.lastMessageAt),
        lastSeenAt: cleanText(seed.lastSeenAt),
      };
    })
    .filter((seed): seed is PreparedIdentitySeed<T> => seed !== null);
}

function createIdentityKey(seed: PreparedIdentitySeed<unknown>) {
  if (seed.phone) {
    return seed.identityKey?.startsWith("phone:") ? seed.identityKey : `phone:${seed.phone}`;
  }

  if (seed.jid) {
    return seed.identityKey?.startsWith("jid:") ? seed.identityKey : `jid:${seed.jid}`;
  }

  return `identity:${seed.index}`;
}

function addPreparedSeedToIdentity<T>(
  state: IdentityGraphState<T>,
  seed: PreparedIdentitySeed<T>,
  identityKey: string,
  quality: ClawCloudWhatsAppContactIdentityQuality,
) {
  const existing = state.identities.get(identityKey);
  const next = existing ?? {
    identityKey,
    phone: seed.phone,
    primaryJid: seed.jid,
    jids: new Set<string>(),
    displayName: seed.displayName,
    aliases: new Set<string>(),
    normalizedAliases: new Set<string>(),
    quality,
    memberCount: 0,
    messageCount: null,
    lastMessageAt: null,
    lastSeenAt: null,
  };

  next.phone = next.phone ?? seed.phone ?? null;
  if (!next.primaryJid && seed.jid && !isLidJid(seed.jid)) {
    next.primaryJid = seed.jid;
  } else if (!next.primaryJid && seed.jid) {
    next.primaryJid = seed.jid;
  }

  next.displayName =
    pickPreferredDisplayName(next.displayName, seed.displayName)
    ?? next.displayName;
  next.quality = pickBetterIdentityQuality(next.quality, quality);
  next.memberCount += 1;
  next.messageCount = Math.max(next.messageCount ?? 0, seed.messageCount ?? 0) || null;
  next.lastMessageAt = latestIsoTimestamp([next.lastMessageAt, seed.lastMessageAt]);
  next.lastSeenAt = latestIsoTimestamp([next.lastSeenAt, seed.lastSeenAt]);

  if (seed.jid) {
    next.jids.add(seed.jid);
  }
  for (const jid of seed.identityJids) {
    const normalized = normalizeClawCloudWhatsAppIdentityJid(jid);
    if (normalized) {
      next.jids.add(normalized);
    }
  }
  for (const alias of seed.aliases) {
    next.aliases.add(alias);
  }
  for (const alias of seed.normalizedAliases) {
    next.normalizedAliases.add(alias);
  }

  state.identities.set(identityKey, next);
  state.assignments.set(seed.index, identityKey);
}

function buildAliasIndex<T>(state: IdentityGraphState<T>) {
  const index = new Map<string, Set<string>>();

  for (const identity of state.identities.values()) {
    for (const alias of identity.normalizedAliases) {
      if (!isMeaningfulAlias(alias)) {
        continue;
      }

      const bucket = index.get(alias) ?? new Set<string>();
      bucket.add(identity.identityKey);
      index.set(alias, bucket);
    }
  }

  return index;
}

function scoreAliasBridge<T>(seed: PreparedIdentitySeed<T>, identity: MutableIdentity) {
  let score = 0;

  for (const alias of seed.normalizedAliases) {
    if (!isMeaningfulAlias(alias)) {
      continue;
    }

    if (identity.normalizedAliases.has(alias)) {
      score = Math.max(score, alias.length >= 5 ? 8 : 6);
      continue;
    }

    const words = alias.split(/\s+/).filter((word) => isMeaningfulAlias(word));
    const overlap = words.filter((word) => identity.normalizedAliases.has(word)).length;
    if (overlap >= 2) {
      score = Math.max(score, 5);
    } else if (overlap === 1 && words.length >= 2) {
      score = Math.max(score, 4);
    }
  }

  return score;
}

function identityCanReuseExplicitKey<T>(
  seed: PreparedIdentitySeed<T>,
  identity: MutableIdentity | undefined,
) {
  if (!identity) {
    return false;
  }

  if (seed.phone && identity.phone && seed.phone === identity.phone) {
    return true;
  }

  if (seed.jid && identity.jids.has(seed.jid)) {
    return true;
  }

  if (seed.identityJids.some((jid) => identity.jids.has(jid))) {
    return true;
  }

  return seed.normalizedAliases.some((alias) => identity.normalizedAliases.has(alias));
}

function buildIdentityGraphState<T extends ClawCloudWhatsAppContactIdentitySeed>(seeds: T[]) {
  const state: IdentityGraphState<T> = {
    identities: new Map<string, MutableIdentity>(),
    assignments: new Map<number, string>(),
    preparedSeeds: buildPreparedSeeds(seeds),
  };

  const unresolved: PreparedIdentitySeed<T>[] = [];
  for (const seed of state.preparedSeeds) {
    if (seed.phone) {
      addPreparedSeedToIdentity(state, seed, createIdentityKey(seed), "phone");
      continue;
    }

    if (seed.jid && !isLidJid(seed.jid)) {
      addPreparedSeedToIdentity(state, seed, createIdentityKey(seed), "jid_only");
      continue;
    }

    unresolved.push(seed);
  }

  const aliasIndex = buildAliasIndex(state);

  for (const seed of unresolved) {
    if (seed.identityKey && identityCanReuseExplicitKey(seed, state.identities.get(seed.identityKey))) {
      addPreparedSeedToIdentity(state, seed, seed.identityKey, "alias_bridge");
      continue;
    }

    const scored = new Map<string, number>();
    for (const alias of seed.normalizedAliases) {
      if (!isMeaningfulAlias(alias)) {
        continue;
      }

      for (const identityKey of aliasIndex.get(alias) ?? []) {
        const identity = state.identities.get(identityKey);
        if (!identity) {
          continue;
        }

        scored.set(
          identityKey,
          Math.max(scored.get(identityKey) ?? 0, scoreAliasBridge(seed, identity)),
        );
      }
    }

    const ranked = [...scored.entries()]
      .map(([identityKey, score]) => ({
        identityKey,
        score,
      }))
      .filter((entry) => entry.score >= 6)
      .sort((left, right) => right.score - left.score);

    const top = ranked[0];
    const runnerUp = ranked[1];
    if (top && (!runnerUp || top.score - runnerUp.score >= 3)) {
      addPreparedSeedToIdentity(state, seed, top.identityKey, "alias_bridge");
      continue;
    }

    addPreparedSeedToIdentity(state, seed, createIdentityKey(seed), "jid_only");
  }

  return state;
}

function finalizeIdentity(identity: MutableIdentity): ClawCloudWhatsAppContactIdentity {
  const aliases = uniqueStrings([
    identity.displayName,
    ...identity.aliases,
    identity.phone,
  ]);

  return {
    identityKey: identity.identityKey,
    phone: identity.phone,
    primaryJid: identity.primaryJid ?? [...identity.jids][0] ?? null,
    jids: [...identity.jids].sort(),
    displayName:
      pickPreferredDisplayName(identity.displayName, aliases.find((alias) => !/^\d+$/.test(alias)))
      ?? identity.phone
      ?? [...identity.jids][0]
      ?? "Unknown contact",
    aliases,
    normalizedAliases: [...identity.normalizedAliases].sort(),
    quality: identity.quality,
    memberCount: identity.memberCount,
    messageCount: identity.messageCount,
    lastMessageAt: identity.lastMessageAt,
    lastSeenAt: identity.lastSeenAt,
  };
}

export function buildClawCloudWhatsAppContactIdentityGraph(
  seeds: ClawCloudWhatsAppContactIdentitySeed[],
): ClawCloudWhatsAppContactIdentity[] {
  const state = buildIdentityGraphState(seeds);
  return [...state.identities.values()]
    .map((identity) => finalizeIdentity(identity))
    .sort((left, right) =>
      String(right.lastSeenAt ?? right.lastMessageAt ?? "").localeCompare(
        String(left.lastSeenAt ?? left.lastMessageAt ?? ""),
      ),
    );
}

export function decorateClawCloudWhatsAppContactIdentitySeeds<T extends ClawCloudWhatsAppContactIdentitySeed>(
  seeds: T[],
): Array<ClawCloudWhatsAppDecoratedIdentitySeed<T>> {
  const state = buildIdentityGraphState(seeds);
  const finalized = new Map<string, ClawCloudWhatsAppContactIdentity>(
    [...state.identities.values()].map((identity) => {
      const finalIdentity = finalizeIdentity(identity);
      return [finalIdentity.identityKey, finalIdentity];
    }),
  );

  return seeds.map((seed, index) => {
    const assignedKey = state.assignments.get(index) ?? `identity:${index}`;
    const identity = finalized.get(assignedKey);
    return {
      ...seed,
      identityKey: assignedKey,
      identityAliases: identity?.aliases ?? uniqueStrings([
        seed.displayName,
        ...(Array.isArray(seed.aliases) ? seed.aliases : []),
      ]),
      identityJids: identity?.jids ?? uniqueStrings(Array.isArray(seed.identityJids) ? seed.identityJids : []),
      identityQuality: identity?.quality ?? "jid_only",
    };
  });
}

export function formatClawCloudWhatsAppIdentityDisplayName(value: string | null | undefined) {
  const cleaned = cleanText(value);
  if (!cleaned || /^\d+$/.test(cleaned)) {
    return cleaned ?? null;
  }

  return formatContactDisplayName(cleaned);
}
