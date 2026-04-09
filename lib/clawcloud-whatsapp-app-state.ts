export const CLAWCLOUD_WHATSAPP_CONTACT_REFRESH_COLLECTIONS = [
  "regular",
  "regular_high",
  "regular_low",
  "critical_block",
  "critical_unblock_low",
] as const;

export type ClawCloudWhatsAppAppStateCollection =
  typeof CLAWCLOUD_WHATSAPP_CONTACT_REFRESH_COLLECTIONS[number];

const CRITICAL_UNBLOCK_LOW_PATCH_MISMATCH_PATTERN = /tried remove, but no previous op/i;

export function buildClawCloudAppStateCollectionCooldownExpiry(
  now: number,
  cooldownMs: number,
) {
  return now + Math.max(0, cooldownMs);
}

export function getClawCloudEligibleAppStateCollections(
  collections: readonly ClawCloudWhatsAppAppStateCollection[],
  cooldowns: ReadonlyMap<ClawCloudWhatsAppAppStateCollection, number>,
  now = Date.now(),
) {
  return collections.filter((collection) => (cooldowns.get(collection) ?? 0) <= now);
}

export function shouldCooldownClawCloudAppStateCollection(
  collection: ClawCloudWhatsAppAppStateCollection,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return collection === "critical_unblock_low"
    && CRITICAL_UNBLOCK_LOW_PATCH_MISMATCH_PATTERN.test(message);
}
