import { createHash } from "crypto";

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function clipText(value: string, maxLength = 240) {
  const clean = normalizeWhitespace(value);
  if (clean.length <= maxLength) {
    return clean;
  }

  return `${clean.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function uniqueBy<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function markdownToPlainText(markdown: string) {
  return normalizeWhitespace(
    markdown
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[#>*_\-\n]/g, " "),
  );
}

export function stripHtml(html: string) {
  return normalizeWhitespace(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
  );
}

// Character-based chunking tuned to roughly 500-800 token windows.
export function chunkText(value: string, size = 3000, overlap = 420) {
  const clean = normalizeWhitespace(value);
  if (clean.length <= size) {
    return [clean];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < clean.length) {
    const end = Math.min(clean.length, cursor + size);
    chunks.push(clean.slice(cursor, end));
    if (end >= clean.length) {
      break;
    }
    cursor = Math.max(0, end - overlap);
  }

  return chunks;
}

function normalizeVector(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) {
    return vector;
  }
  return vector.map((value) => value / magnitude);
}

export function createDeterministicVector(value: string, size = 1024) {
  const hash = createHash("sha256").update(value).digest();
  const vector = Array.from({ length: size }, (_, index) => {
    const source = hash[index % hash.length] ?? 0;
    return ((source - 128) / 128) * (1 - ((index % 13) * 0.012));
  });

  return normalizeVector(vector);
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (!left.length || !right.length || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator ? dot / denominator : 0;
}

export function stableId(...parts: string[]) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

export function normalizeUrlCandidate(value: string) {
  const trimmed = value.trim().replace(/[),.;]+$/, "");
  if (!trimmed) {
    return "";
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[^\s]*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return "";
}

export function extractUrls(value: string) {
  const matches =
    value.match(
      /(https?:\/\/[^\s)]+)|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?/gi,
    ) ?? [];

  return [...new Set(matches.map((match) => normalizeUrlCandidate(match)).filter(Boolean))];
}

export function safeJsonParse<T>(value: string) {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function extractJsonObject(value: string) {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start === -1 || end === -1 || start >= end) {
    return null;
  }
  return value.slice(start, end + 1);
}
