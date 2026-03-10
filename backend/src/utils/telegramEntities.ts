export type TelegramBoldEntity = {
  type: "bold";
  offset: number;
  length: number;
};

type Range = {
  offset: number;
  length: number;
};

const headingLinePattern = /^\s*[A-Za-z][A-Za-z0-9 ,()/'"+-]{1,90}:\s*$/;
const listLinePattern = /^\s*(?:[-*]\s+|\d+[.)]\s+|[A-Za-z][.)]\s+)(.+)$/;
const keyLabelPrefixPattern = /^\s*([A-Za-z][A-Za-z0-9 ,()/'"+-]{1,60}:)\s+\S/;

const mergeRanges = (ranges: Range[]): Range[] => {
  if (ranges.length <= 1) return ranges;
  const sorted = [...ranges].sort((a, b) => a.offset - b.offset);
  const merged: Range[] = [];

  for (const current of sorted) {
    if (current.length <= 0) continue;
    if (merged.length === 0) {
      merged.push({ ...current });
      continue;
    }
    const last = merged[merged.length - 1];
    const lastEnd = last.offset + last.length;
    const currentEnd = current.offset + current.length;
    if (current.offset <= lastEnd) {
      last.length = Math.max(lastEnd, currentEnd) - last.offset;
      continue;
    }
    merged.push({ ...current });
  }

  return merged;
};

const collectBoldRanges = (text: string): Range[] => {
  const value = String(text || "");
  if (!value) return [];

  const ranges: Range[] = [];
  const lines = value.split("\n");
  let cursor = 0;

  for (const rawLine of lines) {
    const line = String(rawLine || "");
    const trimmed = line.trim();
    if (trimmed) {
      if (headingLinePattern.test(trimmed)) {
        const start = line.indexOf(trimmed);
        if (start >= 0) {
          ranges.push({ offset: cursor + start, length: trimmed.length });
        }
      } else {
        const listMatch = line.match(listLinePattern);
        if (listMatch && String(listMatch[0] || "").trim()) {
          const full = String(listMatch[0] || "").trimEnd();
          const start = line.indexOf(full);
          if (start >= 0) {
            ranges.push({ offset: cursor + start, length: full.length });
          }
        } else {
          const keyLabelMatch = line.match(keyLabelPrefixPattern);
          if (keyLabelMatch?.[1]) {
            const label = keyLabelMatch[1];
            const start = line.indexOf(label);
            if (start >= 0) {
              ranges.push({ offset: cursor + start, length: label.length });
            }
          }
        }
      }
    }
    cursor += line.length + 1;
  }

  return mergeRanges(ranges);
};

export const buildTelegramBoldEntities = (text: string): TelegramBoldEntity[] => {
  const ranges = collectBoldRanges(text);
  const maxEntities = 90;
  return ranges
    .slice(0, maxEntities)
    .map((range) => ({
      type: "bold" as const,
      offset: range.offset,
      length: range.length,
    }))
    .filter((item) => item.length > 0);
};
