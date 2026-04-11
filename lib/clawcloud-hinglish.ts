const HINGLISH_WORDS = new Set([
  "main",
  "mai",
  "mein",
  "mujhe",
  "mera",
  "meri",
  "mere",
  "hum",
  "humara",
  "aap",
  "app",
  "tum",
  "tu",
  "tumhara",
  "kya",
  "kis",
  "kaise",
  "kese",
  "kyun",
  "kyunki",
  "kahan",
  "kab",
  "kaun",
  "kitna",
  "kitni",
  "karo",
  "karna",
  "kar",
  "kr",
  "karta",
  "karti",
  "karein",
  "karenge",
  "karange",
  "sakte",
  "sakta",
  "sakti",
  "skte",
  "skta",
  "skti",
  "batao",
  "bata",
  "batana",
  "chahiye",
  "chahta",
  "chahti",
  "samjhao",
  "samajhna",
  "dekho",
  "likh",
  "likho",
  "bhejna",
  "bhejo",
  "bhej",
  "lena",
  "lelo",
  "lega",
  "dena",
  "do",
  "dijiye",
  "aana",
  "jaana",
  "jao",
  "aao",
  "milao",
  "milna",
  "raho",
  "rakhna",
  "hona",
  "hai",
  "hain",
  "ho",
  "hoon",
  "hun",
  "tha",
  "thi",
  "the",
  "hoga",
  "hogi",
  "aur",
  "or",
  "ya",
  "lekin",
  "par",
  "toh",
  "to",
  "ab",
  "abhi",
  "kal",
  "aaj",
  "parso",
  "jab",
  "tab",
  "jaise",
  "waisa",
  "isliye",
  "isiliye",
  "phir",
  "warna",
  "bhi",
  "hi",
  "na",
  "nahi",
  "nahin",
  "mat",
  "bilkul",
  "zaroor",
  "thoda",
  "baat",
  "taraf",
  "kaam",
  "cheez",
  "jagah",
  "samay",
  "time",
  "din",
  "raat",
  "log",
  "aadmi",
  "aurat",
  "baccha",
  "dost",
  "ko",
  "dii",
  "didi",
  "bhai",
  "yaar",
  "paisa",
  "paise",
  "rupaye",
  "kharch",
  "kamai",
  "bachat",
  "loan",
  "byaj",
  "website",
  "app",
  "mobile",
  "phone",
  "computer",
  "internet",
  "wifi",
  "theek",
  "thik",
  "accha",
  "acha",
  "sahi",
  "galat",
  "mushkil",
  "asaan",
  "seedha",
  "jaldi",
  "dhire",
  "badhiya",
  "bekar",
  "bahut",
  "btao",
  "btana",
  "smjhao",
  "smjh",
  "bhompu",
  "pura",
  "puri",
  "poora",
  "poori",
  "detail",
  "vistar",
  "itihas",
  "kahani",
  "ghatna",
  "yudh",
  "samrajya",
  "raja",
  "rani",
  "desh",
  "duniya",
  "jankari",
]);

const AMBIGUOUS_HINGLISH_WORDS = new Set([
  "app",
  "detail",
  "do",
  "internet",
  "loan",
  "mobile",
  "or",
  "phone",
  "the",
  "time",
  "to",
  "website",
  "wifi",
]);

const HINDI_SUFFIXES = [
  /\b\w+(?:ega|egi|enge|oge|ogi|onga)\b/i,
  /\b\w+(?:ange|angi)\b/i,
  /\b\w+(?:raha|rahi|rahe)\b/i,
  /\b\w+(?:liya|liye|li|lia)\b/i,
  /\b\w+(?:karo|karna|karein|kijiye)\b/i,
  /\b\w+(?:wala|wali|wale)\b/i,
  /\b\w+(?:waala|waali|waale)\b/i,
];

const HINGLISH_PHRASES = [
  /\b(mujhe|mujh ko)\s+\w+\s+(chahiye|chahti|chahta)\b/i,
  /\b(kya|kaisi)\s+(hai|hain|thi|tha|the)\b/i,
  /\b(batao|btao|bata|btana|samjhao|smjhao|samajhao)\b/i,
  /\b(kal|aaj|abhi|parso)\s+(tak|se|ko|mein)\b/i,
  /\b(kaise|kyun|kab|kitna)\s+\w+\s+(hai|hain|hoga|hogi)\b/i,
  /\b(aap|tum|tu)\s+(kaise|kese|theek|thik)\s+(ho|hai|hain)\b/i,
  /\b(nahi|nahin|mat)\s+\w+/i,
  /\b(bahut|thoda|zyada|kuch)\s+\w+/i,
  /\bkya\s+(aap|tum|tu)\b/i,
  /\b(yaad|reminder)\s+(kar|dila|dilao|set)/i,
  /\bsamajh\s+(nahi|nahin)\b/i,
  /\babhi\s+kis\s+se\s+baat\s+kar\s+rahe\s+ho\b/i,
  /\b(?:ab|abhi)\s+(?:mere|meri)\s+(?:taraf\s+se|behalf\s+(?:me|mai|mein|par|pe))\s+(?:aap\s+)?[\w'.-]+\s+se\s+baat\s+kar(?:o|na|enge|karenge|karange|rahe|rhe)\b/i,
  /\b[\w'.-]+\s+se\s+(?:mere|meri)\s+(?:taraf\s+se|behalf\s+(?:me|mai|mein|par|pe))\s+baat\s+kar(?:o|na|enge|karenge|karange)\b/i,
  /\b[\w'.-]+\s+se\s+baat\s+karna\s+band\s+karo\b/i,
  /\b.+\s+likh(?:\s*(?:ke|kar))?\s*(?:bhej|send)?\s*(?:do|de|dena|dijiye|kar(?:o|na)?)\s+.+\s+(?:ko|k)\b/i,
  /\b.+\s+bhej(?:\s*(?:do|de|dena|dijiye|na))\s+.+\s+(?:ko|k)\b/i,
  /\b.+\s+(?:ko|k)\s+.+\s+likh(?:\s*(?:ke|kar))?\s*(?:bhej|send)?\s*(?:do|de|dena|dijiye|kar(?:o|na)?)\b/i,
  /\b.+\s+(?:ko|k)\s+.+\s+bhej(?:\s*(?:do|de|dena|dijiye|na))\b/i,
];

const SHORT_ENGLISH_COLLOQUIAL_RE =
  /^(?:what|why|how|when|where|who|which|is|are|do|does|did|can|could|would|should)\b(?:\s+[a-z']+){1,4}$/i;

export function detectHinglish(message: string): boolean {
  const normalized = String(message ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const words = message
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/^[^a-z]+|[^a-z]+$/g, ""))
    .filter(Boolean);
  if (words.length < 2) {
    return false;
  }

  const hinglishWords = words.filter((word) => HINGLISH_WORDS.has(word));
  const strongHinglishWordCount = hinglishWords.filter((word) => !AMBIGUOUS_HINGLISH_WORDS.has(word)).length;
  const hinglishRatio = strongHinglishWordCount / words.length;
  const hasPhrase = HINGLISH_PHRASES.some((pattern) => pattern.test(message));
  const hasSuffix =
    strongHinglishWordCount >= 1
    && HINDI_SUFFIXES.some((pattern) => pattern.test(message));
  const looksLikeShortEnglishColloquial =
    !hasPhrase
    && !hasSuffix
    && strongHinglishWordCount <= 1
    && words.length <= 5
    && SHORT_ENGLISH_COLLOQUIAL_RE.test(normalized);

  if (looksLikeShortEnglishColloquial) {
    return false;
  }

  return strongHinglishWordCount >= 2 || hasPhrase || hasSuffix || hinglishRatio > 0.25;
}

export function buildHinglishSystemSnippet(): string {
  return [
    "The user is writing in Hinglish (Roman-script Hindi mixed with English).",
    "Respond naturally in Hinglish and match the user's casual tone, but stay clear and professional.",
    "Keep technical words, product names, and financial terms in simple English when that sounds more natural.",
    "Do not translate everything into pure Hindi or pure English.",
    "Use Roman script for Hindi words, not Devanagari.",
    "Keep sentences short and WhatsApp-friendly.",
  ].join(" ");
}

export function extractHinglishIntent(message: string): "reminder" | "explain" | "coding" | null {
  const normalized = message.toLowerCase();

  if (/\b(yaad|reminder|remind)\b/.test(normalized) && /\b(kar|dilao|set|lagao)\b/.test(normalized)) {
    return "reminder";
  }
  if (/\b(samjhao|smjhao|batao|btao|bata|btana|explain|kya hai)\b/.test(normalized)) {
    return "explain";
  }
  if (/\b(code|program|script|function)\b/.test(normalized) && /\b(likho|banao|karo|dikhao)\b/.test(normalized)) {
    return "coding";
  }

  return null;
}

/**
 * Detect if a Hinglish message requests detailed/comprehensive output.
 * Used to escalate from "fast" to "deep" response mode.
 */
export function isHinglishDetailRequest(message: string): boolean {
  const normalized = message.toLowerCase();
  return /\b(full\s+detail|pura|puri|poora|poori|vistar\s*se|detail\s*(mai|mein|me|m)|sab\s+kuch|puri\s+jankari|poori\s+jankari)\b/i.test(normalized)
    && /\b(batao|btao|bata|btana|samjhao|smjhao|likho|do|dijiye|explain)\b/i.test(normalized);
}
