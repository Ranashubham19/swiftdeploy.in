export type ClawCloudWhatsAppAccountCandidate = {
  phone_number?: string | null;
  display_name?: string | null;
  is_active?: boolean | null;
  connected_at?: string | null;
  last_used_at?: string | null;
};

function toTimestamp(value: string | null | undefined) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function compareOptionalTimestampDesc(left: string | null | undefined, right: string | null | undefined) {
  const leftTs = toTimestamp(left);
  const rightTs = toTimestamp(right);
  if (leftTs !== null && rightTs !== null && leftTs !== rightTs) {
    return rightTs - leftTs;
  }
  if (leftTs !== null || rightTs !== null) {
    return rightTs !== null ? 1 : -1;
  }
  return 0;
}

export function pickAuthoritativeClawCloudWhatsAppAccount<T extends ClawCloudWhatsAppAccountCandidate>(
  accounts: T[] | null | undefined,
): T | null {
  const candidates = (accounts ?? []).filter((account) => account && typeof account === "object");
  if (!candidates.length) {
    return null;
  }

  return [...candidates].sort((left, right) => {
    const activeDiff = Number(Boolean(right.is_active)) - Number(Boolean(left.is_active));
    if (activeDiff) {
      return activeDiff;
    }

    const lastUsedDiff = compareOptionalTimestampDesc(left.last_used_at, right.last_used_at);
    if (lastUsedDiff) {
      return lastUsedDiff;
    }

    const connectedDiff = compareOptionalTimestampDesc(left.connected_at, right.connected_at);
    if (connectedDiff) {
      return connectedDiff;
    }

    const phoneDiff = Number(Boolean(right.phone_number)) - Number(Boolean(left.phone_number));
    if (phoneDiff) {
      return phoneDiff;
    }

    return String(left.display_name ?? "").localeCompare(String(right.display_name ?? ""));
  })[0] ?? null;
}
