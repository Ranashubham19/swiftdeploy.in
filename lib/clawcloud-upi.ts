import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";

export type UpiTransaction = {
  id?: string;
  user_id: string;
  amount: number;
  currency: "INR";
  merchant: string;
  upi_id?: string;
  bank?: string;
  transaction_type: "debit" | "credit";
  category: string;
  raw_sms: string;
  transacted_at: string;
  created_at?: string;
};

const UPI_DEBIT_PATTERNS = [
  /(?:rs\.?|inr|₹)\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:debited|deducted|spent|paid)/i,
  /debited\s+(?:rs\.?|inr|₹)\s*(\d[\d,]*(?:\.\d{1,2})?)/i,
  /(?:upi|paytm|phonepe|gpay|bhim|amazon pay)[^₹\d]*(?:rs\.?|inr|₹)\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:sent|paid|transferred)/i,
  /(?:inr|₹|rs\.?)\s*(\d[\d,]*(?:\.\d{1,2})?)\s*sent/i,
  /debited\s+with\s+(?:inr|rs\.?|₹)\s*(\d[\d,]*(?:\.\d{1,2})?)/i,
  /payment\s+of\s+(?:rs\.?|inr|₹)\s*(\d[\d,]*(?:\.\d{1,2})?)/i,
  /paid\s+(?:rs\.?|inr|₹)\s*(\d[\d,]*(?:\.\d{1,2})?)/i,
];

const UPI_CREDIT_PATTERNS = [
  /(?:rs\.?|inr|₹)\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(?:credited|received|added)/i,
  /credited\s+(?:rs\.?|inr|₹)\s*(\d[\d,]*(?:\.\d{1,2})?)/i,
  /received\s+(?:rs\.?|inr|₹)\s*(\d[\d,]*(?:\.\d{1,2})?)/i,
];

const MERCHANT_PATTERNS = [
  /(?:sent to|paid to|to vpa|transferred to)\s+([a-zA-Z0-9.\-_]+@[a-zA-Z0-9.\-_]+)/i,
  /(?:\bat\b|\bto\b)\s+([A-Z][a-zA-Z0-9 &'.-]{2,30})(?:\s|$|\.)/,
  /(?:for|toward[s]?)\s+([A-Z][a-zA-Z0-9 &'.-]{2,30})/,
];

const BANK_NAMES = [
  "SBI",
  "HDFC",
  "ICICI",
  "Axis",
  "Kotak",
  "PNB",
  "BOI",
  "Union Bank",
  "Canara",
  "Yes Bank",
  "IndusInd",
  "IDBI",
  "Federal Bank",
  "South Indian Bank",
  "PhonePe",
  "Google Pay",
  "GPay",
  "Paytm",
  "BHIM",
  "Amazon Pay",
] as const;

export function detectUpiSms(message: string): boolean {
  const normalized = message.toLowerCase();

  if (!/(?:rs\.?|inr|₹)\s*\d/.test(normalized)) {
    return false;
  }

  if (!/\b(debited|credited|paid|sent|received|upi|txn|transaction|payment|transfer|neft|imps|rtgs|a\/c|account)\b/.test(normalized)) {
    return false;
  }

  if (/\b(how much|what is|tell me|show me|explain)\b/.test(normalized)) {
    return false;
  }

  return message.length >= 30;
}

function extractAmount(sms: string): { amount: number; type: "debit" | "credit" } | null {
  for (const pattern of UPI_DEBIT_PATTERNS) {
    const match = sms.match(pattern);
    if (match?.[1]) {
      const amount = Number.parseFloat(match[1].replace(/,/g, ""));
      if (amount > 0) {
        return { amount, type: "debit" };
      }
    }
  }

  for (const pattern of UPI_CREDIT_PATTERNS) {
    const match = sms.match(pattern);
    if (match?.[1]) {
      const amount = Number.parseFloat(match[1].replace(/,/g, ""));
      if (amount > 0) {
        return { amount, type: "credit" };
      }
    }
  }

  return null;
}

function extractMerchant(sms: string): string {
  for (const pattern of MERCHANT_PATTERNS) {
    const match = sms.match(pattern);
    if (match?.[1]) {
      const merchant = match[1].trim().replace(/@.*/, "");
      if (merchant.length >= 2) {
        return merchant;
      }
    }
  }

  return "Unknown";
}

function extractBank(sms: string): string {
  const upper = sms.toUpperCase();
  for (const bank of BANK_NAMES) {
    if (upper.includes(bank.toUpperCase())) {
      return bank;
    }
  }
  return "Unknown Bank";
}

function extractUpiId(sms: string): string | undefined {
  const match = sms.match(/([a-zA-Z0-9.\-_]+@[a-zA-Z0-9.\-_]+)/);
  return match?.[1];
}

function categorise(merchant: string, sms: string): string {
  const combined = `${merchant} ${sms}`.toLowerCase();

  if (/swiggy|zomato|domino|pizza|food|restaurant|cafe|eat|blinkit|zepto|dunzo|bigbasket/.test(combined)) {
    return "food";
  }
  if (/amazon|flipkart|myntra|ajio|meesho|nykaa|shop|store|mart|bazar/.test(combined)) {
    return "shopping";
  }
  if (/uber|ola|rapido|metro|bus|auto|cab|petrol|fuel|toll/.test(combined)) {
    return "transport";
  }
  if (/netflix|spotify|youtube|prime|hotstar|zee5|sony|disney|jio|airtel|vi\b|bsnl/.test(combined)) {
    return "subscription";
  }
  if (/doctor|hospital|pharmacy|medicine|clinic|health|apollo/.test(combined)) {
    return "health";
  }
  if (/electricity|water|gas|broadband|wifi|rent|maintenance|society/.test(combined)) {
    return "utilities";
  }
  if (/hotel|flight|train|irctc|makemytrip|goibibo|airbnb|oyo|travel/.test(combined)) {
    return "travel";
  }
  if (/school|college|university|course|udemy|coursera|education|tuition/.test(combined)) {
    return "education";
  }

  return "other";
}

export function parseUpiSms(sms: string, userId: string): UpiTransaction | null {
  const extracted = extractAmount(sms);
  if (!extracted) {
    return null;
  }

  const merchant = extractMerchant(sms);
  const bank = extractBank(sms);
  const upiId = extractUpiId(sms);
  const category = categorise(merchant, sms);

  return {
    user_id: userId,
    amount: extracted.amount,
    currency: "INR",
    merchant,
    upi_id: upiId,
    bank,
    transaction_type: extracted.type,
    category,
    raw_sms: sms.slice(0, 500),
    transacted_at: new Date().toISOString(),
  };
}

export async function saveUpiTransaction(txn: UpiTransaction): Promise<boolean> {
  const db = getClawCloudSupabaseAdmin();
  const { error } = await db.from("upi_transactions").insert({
    user_id: txn.user_id,
    amount: txn.amount,
    currency: txn.currency,
    merchant: txn.merchant,
    upi_id: txn.upi_id,
    bank: txn.bank,
    transaction_type: txn.transaction_type,
    category: txn.category,
    raw_sms: txn.raw_sms,
    transacted_at: txn.transacted_at,
  });

  if (error) {
    console.error("[upi] saveUpiTransaction error:", error.message);
    return false;
  }

  return true;
}

export async function getUpiTransactions(userId: string, days = 30): Promise<UpiTransaction[]> {
  const db = getClawCloudSupabaseAdmin();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await db
    .from("upi_transactions")
    .select("*")
    .eq("user_id", userId)
    .gte("transacted_at", since)
    .order("transacted_at", { ascending: false })
    .limit(100);

  if (error) {
    return [];
  }

  return (data ?? []) as UpiTransaction[];
}

export function formatUpiSaveReply(txn: UpiTransaction): string {
  const symbol = "₹";
  const type = txn.transaction_type === "debit" ? "spent" : "received";
  const emoji = txn.transaction_type === "debit" ? "💸" : "💰";

  return [
    `${emoji} *Transaction saved!*`,
    "",
    `*Amount:* ${symbol}${txn.amount.toLocaleString("en-IN")}`,
    `*Type:* ${type.charAt(0).toUpperCase() + type.slice(1)}`,
    `*Merchant:* ${txn.merchant}`,
    `*Category:* ${txn.category.charAt(0).toUpperCase() + txn.category.slice(1)}`,
    txn.bank && txn.bank !== "Unknown Bank" ? `*Bank:* ${txn.bank}` : "",
    "",
    "_Ask me: 'How much did I spend on food this month?'_",
  ].filter(Boolean).join("\n");
}
