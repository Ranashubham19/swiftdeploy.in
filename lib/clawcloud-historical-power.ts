function normalizeHistoricalPowerQuestion(question: string) {
  return question.toLowerCase().replace(/\s+/g, " ").trim();
}

export function looksLikeHistoricalPowerRankingQuestion(text: string) {
  const normalized = normalizeHistoricalPowerQuestion(text);
  return (
    /\b(top\s*\d+|most powerful|powerful(?:est)?|dominant powers?|major powers?)\b/.test(normalized)
    && /\b(countries|country|states|state|empires|empire|kingdoms?|civilizations?|powers?)\b/.test(normalized)
    && /\b(\d{1,4}\s*(?:ad|ce|bc|bce)|\d{1,2}(?:st|nd|rd|th)\s+century|ancient|medieval)\b/.test(normalized)
  );
}

function buildApproximate400AdReply() {
  return [
    "🏛️ *Approximate major powers around 400 AD*",
    "",
    "_There is no single universally accepted exact top-10 ranking for 400 AD, because modern countries did not exist yet and historians usually compare empires and states instead._",
    "",
    "If you mean the strongest *states/empires* around 400 AD, the safest approximate list is:",
    "1. *Eastern Roman Empire* — richer eastern Mediterranean core and stronger surviving imperial administration.",
    "2. *Western Roman Empire* — still one of the largest political powers in Europe and North Africa, though weakening.",
    "3. *Sasanian Empire* — Rome's main imperial rival across Iran and Mesopotamia.",
    "4. *Gupta Empire* — the leading power in much of northern India.",
    "5. *Northern Wei* — one of the strongest states in northern China.",
    "6. *Eastern Jin* — the main southern Chinese state at the time.",
    "7. *Aksumite Kingdom* — major Red Sea trade and military power in northeast Africa.",
    "8. *Goguryeo* — powerful kingdom in Korea and Manchuria.",
    "9. *Hunnic confederations* — rising steppe military force across Eurasia.",
    "10. *Teotihuacan* — one of the most influential urban powers in Mesoamerica.",
    "",
    "*Important note:* this is an approximate historian-style comparison, not an official universally agreed ranking.",
  ].join("\n");
}

export function buildHistoricalPowerRankingReply(question: string): string | null {
  if (!looksLikeHistoricalPowerRankingQuestion(question)) {
    return null;
  }

  const normalized = normalizeHistoricalPowerQuestion(question);
  if (/\b400\s*(?:ad|ce)\b/.test(normalized)) {
    return buildApproximate400AdReply();
  }

  return [
    "🏛️ *Historical Power Ranking*",
    "",
    "There is no single universally accepted *top 10 most powerful countries* list for ancient or medieval periods, because modern countries often did not exist yet.",
    "",
    "For these questions, the safer way is to compare *empires and states* by military reach, territory, tax base, trade influence, and diplomacy.",
    "",
    "If you want, ask with an exact era like:",
    "• _Top 10 strongest empires around 400 AD_",
    "• _Major powers in 300 BCE_",
    "• _Most powerful states in the 12th century_",
  ].join("\n");
}
