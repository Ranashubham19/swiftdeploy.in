export function matchesWholeAlias(text: string, alias: string) {
  const normalizedText = text.trim().toLowerCase();
  const normalizedAlias = alias.trim().toLowerCase();

  if (!normalizedText || !normalizedAlias) {
    return false;
  }

  const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${pattern}([^\\p{L}\\p{N}]|$)`, "iu").test(normalizedText);
}

export function extractEmailDomain(email: string) {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex === -1 || atIndex === normalized.length - 1) {
    return "";
  }

  return normalized
    .slice(atIndex + 1)
    .replace(/[>\s].*$/, "")
    .trim();
}

export function emailMatchesTld(email: string, tld: string) {
  const domain = extractEmailDomain(email);
  if (!domain) {
    return false;
  }

  return domain.endsWith(tld.trim().toLowerCase());
}
