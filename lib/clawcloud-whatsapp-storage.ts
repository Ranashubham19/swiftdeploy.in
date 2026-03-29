export type ClawCloudWhatsAppSessionStorageStatus =
  | "healthy"
  | "degraded"
  | "misconfigured";

export type ClawCloudWhatsAppSessionStorageHealth = {
  status: ClawCloudWhatsAppSessionStorageStatus;
  configuredBaseDir: string | null;
  resolvedBaseDir: string;
  runningOnRailway: boolean;
  persistentVolumeExpected: boolean;
  persistentVolumeConfigured: boolean;
  persistentVolumeRecommendedPath: string | null;
  writable: boolean;
  probeError: string | null;
  authDirCount: number;
  checkpointCount: number;
  syncCheckpointCount: number;
  checkedAt: string | null;
  warnings: string[];
};

function normalizeOptionalString(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

function normalizeIso(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function normalizeCount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

export function resolveClawCloudWhatsAppSessionBaseDir(input: {
  configuredBaseDir?: string | null;
  isRailwayRuntime: boolean;
}) {
  const configured = normalizeOptionalString(input.configuredBaseDir);
  if (configured) {
    if (/^(?:[a-zA-Z]:[\\/]|\/)/.test(configured) || !input.isRailwayRuntime) {
      return configured;
    }

    return "/data/wa-sessions";
  }

  return input.isRailwayRuntime ? "/data/wa-sessions" : "./wa-sessions";
}

export function isClawCloudWhatsAppPersistentVolumePath(
  resolvedBaseDir: string,
  isRailwayRuntime: boolean,
) {
  if (!isRailwayRuntime) {
    return true;
  }

  const normalized = resolvedBaseDir.replace(/\\/g, "/").trim();
  return normalized === "/data" || normalized.startsWith("/data/");
}

export function buildClawCloudWhatsAppSessionStorageHealth(input: {
  configuredBaseDir?: string | null;
  resolvedBaseDir: string;
  isRailwayRuntime: boolean;
  writable: boolean;
  probeError?: string | null;
  authDirCount?: number;
  checkpointCount?: number;
  syncCheckpointCount?: number;
  checkedAt?: string | null;
}) : ClawCloudWhatsAppSessionStorageHealth {
  const persistentVolumeExpected = input.isRailwayRuntime;
  const persistentVolumeConfigured = isClawCloudWhatsAppPersistentVolumePath(
    input.resolvedBaseDir,
    input.isRailwayRuntime,
  );
  const authDirCount = normalizeCount(input.authDirCount);
  const checkpointCount = normalizeCount(input.checkpointCount);
  const syncCheckpointCount = normalizeCount(input.syncCheckpointCount);
  const warnings: string[] = [];

  if (persistentVolumeExpected && !persistentVolumeConfigured) {
    warnings.push("Railway should store WhatsApp sessions on a mounted /data volume path.");
  }

  if (!input.writable) {
    warnings.push("WhatsApp session storage is not writable.");
  }

  if (authDirCount > 0 && checkpointCount === 0) {
    warnings.push("Saved auth directories exist, but no recovery checkpoints were found yet.");
  } else if (checkpointCount > 0 && checkpointCount < authDirCount) {
    warnings.push("Some saved auth directories do not have recovery checkpoints yet.");
  }

  if (authDirCount > 0 && syncCheckpointCount === 0) {
    warnings.push("Saved auth directories exist, but no sync checkpoints were found yet.");
  } else if (syncCheckpointCount > 0 && syncCheckpointCount < authDirCount) {
    warnings.push("Some saved auth directories do not have sync checkpoints yet.");
  }

  const status: ClawCloudWhatsAppSessionStorageStatus =
    persistentVolumeExpected && !persistentVolumeConfigured
      ? "misconfigured"
      : input.writable
        ? "healthy"
        : "degraded";

  return {
    status,
    configuredBaseDir: normalizeOptionalString(input.configuredBaseDir),
    resolvedBaseDir: input.resolvedBaseDir,
    runningOnRailway: input.isRailwayRuntime,
    persistentVolumeExpected,
    persistentVolumeConfigured,
    persistentVolumeRecommendedPath: persistentVolumeExpected ? "/data/wa-sessions" : null,
    writable: input.writable,
    probeError: normalizeOptionalString(input.probeError),
    authDirCount,
    checkpointCount,
    syncCheckpointCount,
    checkedAt: normalizeIso(input.checkedAt),
    warnings,
  };
}
