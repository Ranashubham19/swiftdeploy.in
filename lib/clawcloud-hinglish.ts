const HINGLISH_WORDS = new Set([
  "main",
  "mujhe",
  "mera",
  "meri",
  "mere",
  "hum",
  "humara",
  "aap",
  "tumhara",
  "kya",
  "kaise",
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
  "karta",
  "karti",
  "karein",
  "batao",
  "bata",
  "batana",
  "chahiye",
  "chahta",
  "chahti",
  "samjhao",
  "samajhna",
  "dekho",
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
  "tha",
  "thi",
  "the",
  "hoga",
  "hogi",
  "aur",
  "ya",
  "lekin",
  "par",
  "toh",
  "to",
  "ab",
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
]);

const HINDI_SUFFIXES = [
  /\b\w+(?:ega|egi|enge|oge|ogi|onga)\b/i,
  /\b\w+(?:raha|rahi|rahe)\b/i,
  /\b\w+(?:liya|liye|li|lia)\b/i,
  /\b\w+(?:karo|karna|karein|kijiye)\b/i,
  /\b\w+(?:wala|wali|wale)\b/i,
  /\b\w+(?:waala|waali|waale)\b/i,
];

const HINGLISH_PHRASES = [
  /\b(mujhe|mujh ko)\s+\w+\s+(chahiye|chahti|chahta)\b/i,
  /\b(kya|kaisi)\s+(hai|hain|thi|tha|the)\b/i,
  /\b(batao|bata|samjhao|samajhao)\b/i,
  /\b(kal|aaj|abhi|parso)\s+(tak|se|ko|mein)\b/i,
  /\b(kaise|kyun|kab|kitna)\s+\w+\s+(hai|hain|hoga|hogi)\b/i,
  /\b(nahi|nahin|mat)\s+\w+/i,
  /\b(bahut|thoda|zyada|kuch)\s+\w+/i,
  /\bkya\s+(aap|tum|tu)\b/i,
  /\b(yaad|reminder)\s+(kar|dila|dilao|set)/i,
  /\bsamajh\s+(nahi|nahin)\b/i,
];

export function detectHinglish(message: string): boolean {
  const words = message.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    return false;
  }

  const hinglishWordCount = words.filter((word) => HINGLISH_WORDS.has(word)).length;
  const hinglishRatio = hinglishWordCount / words.length;
  const hasPhrase = HINGLISH_PHRASES.some((pattern) => pattern.test(message));
  const hasSuffix = HINDI_SUFFIXES.some((pattern) => pattern.test(message));

  return hinglishWordCount >= 2 || hasPhrase || hasSuffix || hinglishRatio > 0.25;
}

export function buildHinglishSystemSnippet(): string {
  return [
    "The user is writing in Hinglish (Roman-script Hindi mixed with English).",
    "Respond naturally in Hinglish and match the user's casual tone.",
    "Do not translate everything into pure Hindi or pure English.",
    "Use Roman script for Hindi words, not Devanagari.",
  ].join(" ");
}

export function extractHinglishIntent(message: string): "reminder" | "explain" | "coding" | null {
  const normalized = message.toLowerCase();

  if (/\b(yaad|reminder|remind)\b/.test(normalized) && /\b(kar|dilao|set|lagao)\b/.test(normalized)) {
    return "reminder";
  }
  if (/\b(samjhao|batao|bata|explain|kya hai)\b/.test(normalized)) {
    return "explain";
  }
  if (/\b(code|program|script|function)\b/.test(normalized) && /\b(likho|banao|karo|dikhao)\b/.test(normalized)) {
    return "coding";
  }

  return null;
}
