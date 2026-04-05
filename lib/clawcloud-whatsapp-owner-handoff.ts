type WhatsAppOwnerCandidate = {
  user_id?: string | null;
  phone_number?: string | null;
  account_email?: string | null;
  connected_at?: string | null;
  last_used_at?: string | null;
};

function normalizePhoneDigits(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits || null;
}

function toTimestamp(value: string | null | undefined) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function compareTimestampDesc(left: string | null | undefined, right: string | null | undefined) {
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

export function listRetiredWhatsAppOwnerUserIds(input: {
  activeUserId: string;
  activePhone: string | null | undefined;
  accounts: WhatsAppOwnerCandidate[] | null | undefined;
}) {
  const activeUserId = String(input.activeUserId ?? "").trim();
  const activePhone = normalizePhoneDigits(input.activePhone);
  if (!activeUserId || !activePhone) {
    return [] as string[];
  }

  return [...(input.accounts ?? [])]
    .filter((account) => account && typeof account === "object")
    .filter((account) => {
      const userId = String(account.user_id ?? "").trim();
      if (!userId || userId === activeUserId) {
        return false;
      }

      const phone =
        normalizePhoneDigits(account.phone_number)
        ?? normalizePhoneDigits(account.account_email);
      return phone === activePhone;
    })
    .sort((left, right) => {
      const lastUsedDiff = compareTimestampDesc(left.last_used_at, right.last_used_at);
      if (lastUsedDiff) {
        return lastUsedDiff;
      }

      const connectedDiff = compareTimestampDesc(left.connected_at, right.connected_at);
      if (connectedDiff) {
        return connectedDiff;
      }

      return String(left.user_id ?? "").localeCompare(String(right.user_id ?? ""));
    })
    .map((account) => String(account.user_id ?? "").trim())
    .filter(Boolean);
}
