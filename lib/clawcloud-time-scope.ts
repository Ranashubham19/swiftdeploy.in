function normalizeQuestion(question: string) {
  return question.toLowerCase().replace(/\s+/g, " ").trim();
}

export function extractExplicitQuestionYear(question: string): number | null {
  const matches = [...normalizeQuestion(question).matchAll(/\b(19|20)\d{2}\b/g)];
  if (!matches.length) {
    return null;
  }

  const last = matches[matches.length - 1]?.[0];
  const parsed = last ? Number.parseInt(last, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function hasHistoricalScope(question: string, currentYear = new Date().getFullYear()) {
  const normalized = normalizeQuestion(question);
  if (
    /\b(history|historical|of all time|throughout history|in human history|back then|at that time|in the past)\b/.test(
      normalized,
    )
  ) {
    return true;
  }

  const explicitYear = extractExplicitQuestionYear(normalized);
  return explicitYear !== null && explicitYear < currentYear;
}

export function hasPastYearScope(question: string, currentYear = new Date().getFullYear()) {
  const explicitYear = extractExplicitQuestionYear(question);
  return explicitYear !== null && explicitYear < currentYear;
}
