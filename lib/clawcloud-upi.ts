import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import {
  detectKnownMerchantInText,
  inferSpendingCategory,
  normalizeMerchantName,
} from "@/lib/clawcloud-india-normalization";

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
  /(?:\bat\b|\bto\b)\s+([A-Z][a-zA-Z0-9 &'.-]{2,40})(?:\s|$|\.)/,
  /(?:for|toward[s]?|from)\s+([A-Z][a-zA-Z0-9 &'.-]{2,40})/,
  /(?:merchant|payee|beneficiary)\s*[:\-]?\s*([A-Z][a-zA-Z0-9 &'.-]{2,40})/i,
];

const BANK_PATTERNS = [
  { name: "SBI", pattern: /\b(?:sbi|state bank)\b/i },
  { name: "HDFC Bank", pattern: /\b(?:hdfc|hdfcbk|hdfcbank)\b/i },
  { name: "ICICI Bank", pattern: /\b(?:icici|icicibank)\b/i },
  { name: "Axis Bank", pattern: /\b(?:axis|axisbk|axisbank)\b/i },
  { name: "Kotak Mahindra Bank", pattern: /\b(?:kotak|kotakbank)\b/i },
  { name: "PNB", pattern: /\b(?:pnb|punjab national)\b/i },
  { name: "Bank of India", pattern: /\b(?:boi|bank of india)\b/i },
  { name: "Union Bank", pattern: /\bunion bank\b/i },
  { name: "Canara Bank", pattern: /\bcanara\b/i },
  { name: "Yes Bank", pattern: /\byes bank\b/i },
  { name: "IndusInd Bank", pattern: /\bindusind\b/i },
  { name: "IDBI Bank", pattern: /\bidbi\b/i },
  { name: "Federal Bank", pattern: /\bfederal bank\b/i },
  { name: "South Indian Bank", pattern: /\bsouth indian bank\b/i },
  { name: "PhonePe", pattern: /\bphonepe\b/i },
  { name: "Google Pay", pattern: /\b(?:google pay|gpay|tez)\b/i },
  { name: "Paytm", pattern: /\bpaytm\b/i },
  { name: "BHIM", pattern: /\bbhim\b/i },
  { name: "Amazon Pay", pattern: /\bamazon pay\b/i },
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
  const knownMerchant = detectKnownMerchantInText(sms);
  if (knownMerchant) {
    return knownMerchant;
  }

  for (const pattern of MERCHANT_PATTERNS) {
    const match = sms.match(pattern);
    if (match?.[1]) {
      const merchant = normalizeMerchantName(match[1].trim(), sms);
      if (merchant.length >= 2) {
        return merchant;
      }
    }
  }

  const upiId = extractUpiId(sms);
  if (upiId) {
    const merchantFromUpi = normalizeMerchantName(upiId.split("@")[0] ?? upiId, sms);
    if (merchantFromUpi.length >= 2 && merchantFromUpi !== "Unknown") {
      return merchantFromUpi;
    }
  }

  return knownMerchant ?? "Unknown";
}

function extractBank(sms: string): string {
  for (const bank of BANK_PATTERNS) {
    if (bank.pattern.test(sms)) {
      return bank.name;
    }
  }
  return "Unknown Bank";
}

function extractUpiId(sms: string): string | undefined {
  const match = sms.match(/([a-zA-Z0-9.\-_]+@[a-zA-Z0-9.\-_]+)/);
  return match?.[1];
}

function categorise(merchant: string, sms: string): string {
  return inferSpendingCategory(merchant, sms);
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
