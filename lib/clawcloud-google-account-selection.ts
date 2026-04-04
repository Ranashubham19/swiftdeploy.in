export type ClawCloudGoogleAccountCandidate = {
  account_email?: string | null;
  display_name?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  token_expiry?: string | null;
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

export function pickAuthoritativeClawCloudGoogleAccount<T extends ClawCloudGoogleAccountCandidate>(
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

    const expiryDiff = compareOptionalTimestampDesc(left.token_expiry, right.token_expiry);
    if (expiryDiff) {
      return expiryDiff;
    }

    const connectedDiff = compareOptionalTimestampDesc(left.connected_at, right.connected_at);
    if (connectedDiff) {
      return connectedDiff;
    }

    const refreshDiff = Number(Boolean(right.refresh_token)) - Number(Boolean(left.refresh_token));
    if (refreshDiff) {
      return refreshDiff;
    }

    const accessDiff = Number(Boolean(right.access_token)) - Number(Boolean(left.access_token));
    if (accessDiff) {
      return accessDiff;
    }

    const emailDiff = Number(Boolean(right.account_email)) - Number(Boolean(left.account_email));
    if (emailDiff) {
      return emailDiff;
    }

    return String(left.display_name ?? left.account_email ?? "").localeCompare(
      String(right.display_name ?? right.account_email ?? ""),
    );
  })[0] ?? null;
}
