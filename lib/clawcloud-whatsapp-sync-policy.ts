export type ClawCloudWhatsAppSyncPolicy = {
  contactRefreshTarget: number;
  contactRefreshMaxPasses: number;
  historyTarget: number;
  historyBufferLimit: number;
  historyKnownLookupLimit: number;
  historyPersistBatchLimit: number;
  historyExpansionChatLimit: number;
  historyExpansionBatchSize: number;
  historyExpansionMaxAttemptsPerCursor: number;
  historyContactBackfillScanLimit: number;
};

type BuildClawCloudWhatsAppSyncPolicyInput = Partial<ClawCloudWhatsAppSyncPolicy>;

function clampPositiveInt(
  value: number | null | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function buildClawCloudWhatsAppSyncPolicy(
  input: BuildClawCloudWhatsAppSyncPolicyInput = {},
): ClawCloudWhatsAppSyncPolicy {
  const contactRefreshTarget = clampPositiveInt(input.contactRefreshTarget, 300, 25, 5_000);
  const contactRefreshMaxPasses = clampPositiveInt(input.contactRefreshMaxPasses, 5, 1, 12);
  const historyBufferLimit = clampPositiveInt(input.historyBufferLimit, 12_000, 1_000, 50_000);
  const historyTarget = clampPositiveInt(
    input.historyTarget,
    Math.min(6_000, historyBufferLimit),
    240,
    historyBufferLimit,
  );
  const historyKnownLookupLimit = clampPositiveInt(
    input.historyKnownLookupLimit,
    historyBufferLimit,
    historyBufferLimit,
    50_000,
  );
  const historyPersistBatchLimit = clampPositiveInt(
    input.historyPersistBatchLimit,
    Math.min(4_000, historyBufferLimit),
    200,
    historyBufferLimit,
  );
  const historyExpansionChatLimit = clampPositiveInt(input.historyExpansionChatLimit, 24, 1, 100);
  const historyExpansionBatchSize = clampPositiveInt(input.historyExpansionBatchSize, 120, 20, 300);
  const historyExpansionMaxAttemptsPerCursor = clampPositiveInt(
    input.historyExpansionMaxAttemptsPerCursor,
    8,
    1,
    20,
  );
  const historyContactBackfillScanLimit = clampPositiveInt(
    input.historyContactBackfillScanLimit,
    4_000,
    800,
    20_000,
  );

  return {
    contactRefreshTarget,
    contactRefreshMaxPasses,
    historyTarget,
    historyBufferLimit,
    historyKnownLookupLimit,
    historyPersistBatchLimit,
    historyExpansionChatLimit,
    historyExpansionBatchSize,
    historyExpansionMaxAttemptsPerCursor,
    historyContactBackfillScanLimit,
  };
}

export function shouldRequestMoreClawCloudWhatsAppHistory(currentCount: number, target: number) {
  const normalizedCurrent = Number.isFinite(currentCount) ? Math.max(0, Math.trunc(currentCount)) : 0;
  const normalizedTarget = Number.isFinite(target) ? Math.max(1, Math.trunc(target)) : 1;
  return normalizedCurrent < normalizedTarget;
}
