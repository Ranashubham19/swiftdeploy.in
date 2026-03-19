const MERCHANT_ALIASES = [
  { displayName: "Amazon", category: "shopping", patterns: [/\bamazon\b/i, /\bamzn\b/i, /\bamazon pay\b/i] },
  { displayName: "Flipkart", category: "shopping", patterns: [/\bflipkart\b/i, /\bfkart\b/i] },
  { displayName: "Myntra", category: "shopping", patterns: [/\bmyntra\b/i] },
  { displayName: "Ajio", category: "shopping", patterns: [/\bajio\b/i] },
  { displayName: "Nykaa", category: "shopping", patterns: [/\bnykaa\b/i] },
  { displayName: "Meesho", category: "shopping", patterns: [/\bmeesho\b/i] },
  { displayName: "DMart", category: "shopping", patterns: [/\bdmart\b/i] },
  { displayName: "BigBasket", category: "food", patterns: [/\bbigbasket\b/i, /\bbbnow\b/i] },
  { displayName: "Blinkit", category: "food", patterns: [/\bblinkit\b/i, /\bgrofers\b/i] },
  { displayName: "Zepto", category: "food", patterns: [/\bzepto\b/i] },
  { displayName: "Swiggy", category: "food", patterns: [/\bswiggy\b/i, /\bbundl\b/i] },
  { displayName: "Zomato", category: "food", patterns: [/\bzomato\b/i] },
  { displayName: "Domino's", category: "food", patterns: [/\bdomino'?s?\b/i] },
  { displayName: "McDonald's", category: "food", patterns: [/\bmcdonald'?s?\b/i] },
  { displayName: "Uber", category: "transport", patterns: [/\buber\b/i] },
  { displayName: "Ola", category: "transport", patterns: [/\bola\b/i] },
  { displayName: "Rapido", category: "transport", patterns: [/\brapido\b/i] },
  { displayName: "IRCTC", category: "travel", patterns: [/\birctc\b/i] },
  { displayName: "MakeMyTrip", category: "travel", patterns: [/\bmakemytrip\b/i, /\bmmt\b/i] },
  { displayName: "Goibibo", category: "travel", patterns: [/\bgoibibo\b/i] },
  { displayName: "Airbnb", category: "travel", patterns: [/\bairbnb\b/i] },
  { displayName: "OYO", category: "travel", patterns: [/\boyo\b/i] },
  { displayName: "Netflix", category: "subscription", patterns: [/\bnetflix\b/i] },
  { displayName: "Spotify", category: "subscription", patterns: [/\bspotify\b/i] },
  { displayName: "YouTube", category: "subscription", patterns: [/\byoutube\b/i, /\byt premium\b/i] },
  { displayName: "Amazon Prime", category: "subscription", patterns: [/\bprime video\b/i, /\bamazon prime\b/i] },
  { displayName: "Disney+ Hotstar", category: "subscription", patterns: [/\bhotstar\b/i, /\bdisney\b/i] },
  { displayName: "Jio", category: "utilities", patterns: [/\bjio\b/i] },
  { displayName: "Airtel", category: "utilities", patterns: [/\bairtel\b/i] },
  { displayName: "Vi", category: "utilities", patterns: [/\bvodafone\b/i, /\bidea\b/i, /\bvi\b/i] },
  { displayName: "BSNL", category: "utilities", patterns: [/\bbsnl\b/i] },
  { displayName: "Apollo Pharmacy", category: "health", patterns: [/\bapollo\b/i] },
  { displayName: "PharmEasy", category: "health", patterns: [/\bpharmeasy\b/i] },
  { displayName: "Tata 1mg", category: "health", patterns: [/\b1mg\b/i, /\btata 1mg\b/i] },
  { displayName: "Paytm", category: "wallet", patterns: [/\bpaytm\b/i] },
  { displayName: "PhonePe", category: "wallet", patterns: [/\bphonepe\b/i, /\bybl\b/i] },
  { displayName: "Google Pay", category: "wallet", patterns: [/\bgpay\b/i, /\bgoogle pay\b/i, /\btez\b/i] },
];

const CATEGORY_SYNONYMS: Record<string, string> = {
  groceries: "food",
  grocery: "food",
  dining: "food",
  restaurant: "food",
  bills: "utilities",
  recharge: "utilities",
  telecom: "utilities",
  commute: "transport",
  taxi: "transport",
  cab: "transport",
  medicine: "health",
  medical: "health",
  pharmacy: "health",
  movies: "entertainment",
  ott: "subscription",
  shopping: "shopping",
  ecommerce: "shopping",
  travel: "travel",
  education: "education",
  subscriptions: "subscription",
  wallet: "wallet",
};

const CATEGORY_PATTERNS = [
  { category: "food", pattern: /\b(swiggy|zomato|restaurant|cafe|food|dine|blinkit|zepto|bigbasket|domino|pizza|grocery|groceries)\b/i },
  { category: "shopping", pattern: /\b(amazon|flipkart|myntra|ajio|meesho|nykaa|store|shop|mart|bazaar|dmart)\b/i },
  { category: "transport", pattern: /\b(uber|ola|rapido|metro|bus|auto|cab|petrol|fuel|diesel|toll|parking)\b/i },
  { category: "subscription", pattern: /\b(netflix|spotify|youtube|prime|hotstar|ott|subscription|renewal|membership)\b/i },
  { category: "health", pattern: /\b(doctor|hospital|pharmacy|medicine|clinic|health|apollo|1mg|pharmeasy)\b/i },
  { category: "utilities", pattern: /\b(electricity|water|gas|broadband|wifi|recharge|mobile|postpaid|prepaid|rent|maintenance|society|jio|airtel|bsnl|vi)\b/i },
  { category: "travel", pattern: /\b(hotel|flight|train|irctc|makemytrip|goibibo|airbnb|oyo|travel)\b/i },
  { category: "education", pattern: /\b(school|college|university|course|udemy|coursera|education|tuition|fees)\b/i },
  { category: "wallet", pattern: /\b(paytm|phonepe|google pay|gpay|tez|wallet)\b/i },
];

const NOISE_PATTERNS = [
  /\b(?:upi|txn|txnid|transaction|ref(?:erence)?|utr|payment|transfer|transferred|received|credited|debited|sent|paid|via|using|from|to|bank|a\/c|account|ending|vpa|ifsc|number|no|id|status|success|successful)\b/gi,
  /\bxx\d{2,6}\b/gi,
  /\b\d{6,}\b/g,
];

const STATE_ALIASES: Array<{ state: string; patterns: RegExp[] }> = [
  { state: "Andhra Pradesh", patterns: [/\bandhra pradesh\b/i, /\bandhra\b/i, /\bap\b/i] },
  { state: "Assam", patterns: [/\bassam\b/i] },
  { state: "Bihar", patterns: [/\bbihar\b/i] },
  { state: "Delhi", patterns: [/\bdelhi\b/i, /\bnew delhi\b/i, /\bncr\b/i] },
  { state: "Gujarat", patterns: [/\bgujarat\b/i, /\bguj\b/i] },
  { state: "Karnataka", patterns: [/\bkarnataka\b/i, /\bblr\b/i, /\bbengaluru\b/i, /\bbangalore\b/i] },
  { state: "Kerala", patterns: [/\bkerala\b/i] },
  { state: "Maharashtra", patterns: [/\bmaharashtra\b/i, /\bmumbai\b/i, /\bpune\b/i] },
  { state: "Odisha", patterns: [/\bodisha\b/i, /\borissa\b/i] },
  { state: "Punjab", patterns: [/\bpunjab\b/i] },
  { state: "Tamil Nadu", patterns: [/\btamil nadu\b/i, /\btn\b/i, /\bchennai\b/i] },
  { state: "Telangana", patterns: [/\btelangana\b/i, /\bhyderabad\b/i] },
  { state: "West Bengal", patterns: [/\bwest bengal\b/i, /\bbengal\b/i, /\bkolkata\b/i] },
];

function titleCasePreservingAcronyms(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (part.length <= 4 && /^[A-Z0-9]+$/.test(part)) {
        return part;
      }
      if (/^[A-Z]{2,}[0-9]*$/.test(part)) {
        return part;
      }
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

function stripNoise(value: string) {
  let cleaned = value
    .replace(/@.*/, " ")
    .replace(/[|,:;()[\]{}_*]+/g, " ")
    .replace(/[._-]+/g, " ");

  for (const pattern of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, " ");
  }

  return cleaned.replace(/\s+/g, " ").trim();
}

export function detectKnownMerchantInText(text: string): string | null {
  for (const alias of MERCHANT_ALIASES) {
    if (alias.patterns.some((pattern) => pattern.test(text))) {
      return alias.displayName;
    }
  }
  return null;
}

export function normalizeMerchantName(rawMerchant: string, context = ""): string {
  const combined = `${rawMerchant} ${context}`.trim();
  const knownMerchant = detectKnownMerchantInText(combined);
  if (knownMerchant) {
    return knownMerchant;
  }

  const stripped = stripNoise(rawMerchant);
  if (!stripped) {
    return detectKnownMerchantInText(context) ?? "Unknown";
  }

  const words = stripped.split(/\s+/).slice(0, 4);
  const compact = words.join(" ");
  if (!compact) {
    return detectKnownMerchantInText(context) ?? "Unknown";
  }

  return titleCasePreservingAcronyms(compact);
}

export function inferSpendingCategory(merchant: string, context = ""): string {
  const combined = `${merchant} ${context}`.trim();
  const knownMerchant = MERCHANT_ALIASES.find((alias) =>
    alias.patterns.some((pattern) => pattern.test(combined)),
  );
  if (knownMerchant) {
    return knownMerchant.category;
  }

  for (const entry of CATEGORY_PATTERNS) {
    if (entry.pattern.test(combined)) {
      return entry.category;
    }
  }

  return "other";
}

export function normalizeSpendingCategory(
  rawCategory: string | undefined,
  merchant = "",
  context = "",
): string {
  const normalized = rawCategory?.toLowerCase().trim() ?? "";
  if (!normalized) {
    return inferSpendingCategory(merchant, context);
  }

  if (CATEGORY_SYNONYMS[normalized]) {
    return CATEGORY_SYNONYMS[normalized];
  }

  if (Object.values(CATEGORY_SYNONYMS).includes(normalized)) {
    return normalized;
  }

  return inferSpendingCategory(merchant, `${normalized} ${context}`);
}

export function detectIndianStateFromText(text: string): string | null {
  for (const entry of STATE_ALIASES) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      return entry.state;
    }
  }
  return null;
}

export function holidayMatchesState(states: string[] | undefined, requestedState: string | null): boolean {
  if (!requestedState) {
    return true;
  }
  if (!states?.length) {
    return true;
  }
  return states.some((state) => state.toLowerCase() === requestedState.toLowerCase());
}

export function formatHolidayStateSuffix(states: string[] | undefined): string {
  if (!states?.length) {
    return "";
  }
  if (states.length === 1) {
    return ` (${states[0]} holiday)`;
  }
  return ` (${states.join(", ")})`;
}
