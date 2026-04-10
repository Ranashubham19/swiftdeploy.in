export type InboundMessageDedupOptions = {
  now?: number;
  ttlMs?: number;
  maxEntries?: number;
};

export function pruneInboundMessageDedupCache(
  cache: Map<string, number>,
  options: InboundMessageDedupOptions = {},
) {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? 10 * 60_000;
  const maxEntries = options.maxEntries ?? 10_000;

  if (cache.size <= maxEntries) {
    for (const [id, seenAt] of cache) {
      if (now - seenAt > ttlMs) {
        cache.delete(id);
      }
    }
    return;
  }

  const entries = [...cache.entries()].sort((a, b) => a[1] - b[1]);
  const trimmed = entries.slice(-Math.floor(maxEntries * 0.75));
  cache.clear();
  for (const [id, ts] of trimmed) {
    cache.set(id, ts);
  }
}

export function registerInboundMessageId(
  cache: Map<string, number>,
  messageId: string | null | undefined,
  options: InboundMessageDedupOptions = {},
) {
  const normalizedId = String(messageId ?? "").trim();
  if (!normalizedId) {
    return true;
  }

  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? 10 * 60_000;
  pruneInboundMessageDedupCache(cache, {
    ...options,
    now,
    ttlMs,
  });

  const seenAt = cache.get(normalizedId);
  if (typeof seenAt === "number" && now - seenAt <= ttlMs) {
    return false;
  }

  cache.set(normalizedId, now);
  return true;
}
