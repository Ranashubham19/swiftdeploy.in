function normalizeQuestion(question: string) {
  return question.toLowerCase().replace(/\s+/g, " ").trim();
}

export function looksLikeHistoricalWealthQuestion(question: string) {
  const normalized = normalizeQuestion(question);
  if (!/\b(richest|wealthiest|net worth|billionaire)\b/.test(normalized)) {
    return false;
  }

  return (
    /\b(in history|historical|of all time|ever|throughout history|in human history)\b/.test(normalized)
    || /\bhistory till now\b/.test(normalized)
    || (/\btill now\b/.test(normalized) && /\b(history|historical)\b/.test(normalized))
  );
}

export function buildHistoricalWealthReply(question: string) {
  const normalized = normalizeQuestion(question);
  const wantsTopList = /\btop\s*(10|ten)\b/.test(normalized) || /\blist\b/.test(normalized);

  if (!wantsTopList) {
    return [
      "*Wealthiest person in history*",
      "",
      "The safest direct answer is *Mansa Musa* of the Mali Empire, who is widely described by historians and reference works as the richest person in history.",
      "",
      "*Method note*",
      "• If you mean *inflation-adjusted private fortune*, Guinness World Records instead cites *John D. Rockefeller* as the richest ever by that method.",
      "• Historical wealth rankings are not fully standardized because imperial control, state assets, land, and private ownership are measured differently across eras.",
      "",
      "*Sources*",
      "• Britannica",
      "• Guinness World Records",
      "• History",
    ].join("\n");
  }

  return [
    "*Top 10 wealthiest people in history*",
    "",
    "*Important:* there is *no single universally accepted exact ranking* across all eras. Historical wealth lists depend on methodology.",
    "",
    "*Most commonly cited shortlist*",
    "1. *Mansa Musa* — Mali Empire; most often treated as #1 overall",
    "2. *John D. Rockefeller* — often #1 on inflation-adjusted private-fortune lists",
    "3. *Augustus Caesar*",
    "4. *Emperor Shenzong of Song*",
    "5. *Akbar I*",
    "6. *Andrew Carnegie*",
    "7. *Jacob Fugger*",
    "8. *Nicholas II*",
    "9. *Osman Ali Khan*",
    "10. *William the Conqueror*",
    "",
    "*What to trust most*",
    "• If you mean *broad historical consensus*: *Mansa Musa* is the safest #1 answer.",
    "• If you mean *inflation-adjusted personal fortune*: *John D. Rockefeller* is the safest #1 answer.",
    "",
    "*Sources*",
    "• Britannica on Mansa Musa and Rockefeller",
    "• Guinness World Records on Rockefeller",
    "• History on Mansa Musa",
  ].join("\n");
}
