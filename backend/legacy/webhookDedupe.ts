export type TelegramUpdateDeduper = {
  hasDuplicate: (scope: string, updateId: number | string | null | undefined) => boolean;
  markSeen: (scope: string, updateId: number | string | null | undefined) => void;
  isDuplicate: (scope: string, updateId: number | string | null | undefined) => boolean;
  stats: () => { size: number };
};

export const createTelegramUpdateDeduper = (
  ttlMs = 10 * 60 * 1000,
  maxEntries = 20_000,
): TelegramUpdateDeduper => {
  const seen = new Map<string, number>();

  const prune = (now: number): void => {
    for (const [key, expiresAt] of seen) {
      if (expiresAt > now) continue;
      seen.delete(key);
    }
    if (seen.size <= maxEntries) return;
    const overflow = seen.size - maxEntries;
    let removed = 0;
    for (const key of seen.keys()) {
      seen.delete(key);
      removed += 1;
      if (removed >= overflow) break;
    }
  };

  return {
    hasDuplicate: (scope, updateId) => {
      const normalizedScope = String(scope || "global").trim() || "global";
      const id = String(updateId ?? "").trim();
      if (!/^\d+$/.test(id)) return false;
      const key = `${normalizedScope}:${id}`;
      const now = Date.now();
      prune(now);
      const expiresAt = seen.get(key);
      if (expiresAt && expiresAt > now) {
        return true;
      }
      return false;
    },
    markSeen: (scope, updateId) => {
      const normalizedScope = String(scope || "global").trim() || "global";
      const id = String(updateId ?? "").trim();
      if (!/^\d+$/.test(id)) return;
      const key = `${normalizedScope}:${id}`;
      const now = Date.now();
      prune(now);
      seen.set(key, now + ttlMs);
    },
    isDuplicate: (scope, updateId) => {
      const duplicate = ((): boolean => {
        const normalizedScope = String(scope || "global").trim() || "global";
        const id = String(updateId ?? "").trim();
        if (!/^\d+$/.test(id)) return false;
        const key = `${normalizedScope}:${id}`;
        const now = Date.now();
        prune(now);
        const expiresAt = seen.get(key);
        if (expiresAt && expiresAt > now) return true;
        seen.set(key, now + ttlMs);
        return false;
      })();
      return duplicate;
    },
    stats: () => ({ size: seen.size }),
  };
};
