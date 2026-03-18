import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";
import { upsertAnalyticsDaily } from "@/lib/clawcloud-analytics";
import { getClawCloudGmailMessages } from "@/lib/clawcloud-google";
import { getUserLocale, translateMessage } from "@/lib/clawcloud-i18n";
import { getUpiTransactions } from "@/lib/clawcloud-upi";
import { sendClawCloudWhatsAppMessage } from "@/lib/clawcloud-whatsapp";

type SpendEntry = {
  merchant: string;
  amount: number;
  currency: string;
  date: string;
  category: string;
};

type WeeklySpendSummary = {
  totalAmount: number;
  currency: string;
  entries: SpendEntry[];
  topCategories: Array<{ category: string; total: number }>;
  topMerchants: Array<{ merchant: string; total: number }>;
};

const receiptQuery = [
  'subject:(receipt OR invoice OR order OR payment OR transaction OR "your order" OR "payment received" OR "order confirmation")',
  "newer_than:7d",
  "-label:spam",
].join(" ");

async function extractSpendFromEmail(emailText: string): Promise<SpendEntry | null> {
  try {
    const result = await completeClawCloudPrompt({
      system: [
        "Extract purchase or payment data from the email text.",
        "Return only JSON with keys merchant, amount, currency, date, category.",
        "Use a 3-letter ISO currency code.",
        "Use one of these categories: food, shopping, transport, entertainment, utilities, health, travel, subscription, other.",
        "If this is not a receipt or payment email, return NULL.",
      ].join(" "),
      user: emailText.slice(0, 1500),
      maxTokens: 120,
      fallback: "NULL",
    });

    const trimmed = result.trim();
    if (trimmed === "NULL" || !trimmed.startsWith("{")) {
      return null;
    }

    const parsed = JSON.parse(trimmed) as Partial<SpendEntry>;
    if (!parsed.merchant || !parsed.amount || !parsed.currency) {
      return null;
    }

    return {
      merchant: String(parsed.merchant),
      amount: Number(parsed.amount),
      currency: String(parsed.currency).toUpperCase(),
      date: String(parsed.date || new Date().toISOString().split("T")[0]),
      category: String(parsed.category || "other"),
    };
  } catch {
    return null;
  }
}

function buildWeeklySummary(entries: SpendEntry[]): WeeklySpendSummary {
  if (entries.length === 0) {
    return {
      totalAmount: 0,
      currency: "USD",
      entries: [],
      topCategories: [],
      topMerchants: [],
    };
  }

  const currencyCount: Record<string, number> = {};
  for (const entry of entries) {
    currencyCount[entry.currency] = (currencyCount[entry.currency] ?? 0) + 1;
  }

  const dominantCurrency =
    Object.entries(currencyCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
  const sameCurrencyEntries = entries.filter((entry) => entry.currency === dominantCurrency);
  const totalAmount = sameCurrencyEntries.reduce((sum, entry) => sum + entry.amount, 0);

  const categoryTotals: Record<string, number> = {};
  const merchantTotals: Record<string, number> = {};

  for (const entry of sameCurrencyEntries) {
    categoryTotals[entry.category] = (categoryTotals[entry.category] ?? 0) + entry.amount;
    merchantTotals[entry.merchant] = (merchantTotals[entry.merchant] ?? 0) + entry.amount;
  }

  return {
    totalAmount,
    currency: dominantCurrency,
    entries: sameCurrencyEntries,
    topCategories: Object.entries(categoryTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, total]) => ({ category, total })),
    topMerchants: Object.entries(merchantTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([merchant, total]) => ({ merchant, total })),
  };
}

function formatSpendMessage(summary: WeeklySpendSummary) {
  if (summary.entries.length === 0) {
    return "Weekly spending summary\n\nNo transactions were found in your inbox this week.";
  }

  const formatAmount = (amount: number) =>
    `${summary.currency} ${amount.toLocaleString("en", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const lines = [
    "Weekly spending summary",
    "",
    `Total spent: ${formatAmount(summary.totalAmount)} (${summary.entries.length} transactions)`,
    "",
    "By category:",
    ...summary.topCategories.map((entry) => `- ${entry.category}: ${formatAmount(entry.total)}`),
    "",
    "Top merchants:",
    ...summary.topMerchants.map((entry) => `- ${entry.merchant}: ${formatAmount(entry.total)}`),
    "",
    'Ask me things like "How much did I spend on food?"',
  ];

  return lines.join("\n");
}

export async function runWeeklySpendSummary(userId: string) {
  const locale = await getUserLocale(userId);
  const emails = await getClawCloudGmailMessages(userId, {
    query: receiptQuery,
    maxResults: 50,
  });

  const entries: SpendEntry[] = [];
  for (let index = 0; index < emails.length; index += 5) {
    const batch = emails.slice(index, index + 5);
    const results = await Promise.all(
      batch.map((email) =>
        extractSpendFromEmail(`${email.subject}\n\n${email.body || email.snippet}`),
      ),
    );
    entries.push(...results.filter((value): value is SpendEntry => value !== null));
  }

  const summary = buildWeeklySummary(entries);
  const translatedMessage = await translateMessage(formatSpendMessage(summary), locale);

  await sendClawCloudWhatsAppMessage(userId, translatedMessage);
  await upsertAnalyticsDaily(userId, {
    emails_processed: emails.length,
    tasks_run: 1,
    wa_messages_sent: 1,
  });

  return {
    transactions: summary.entries.length,
    total: summary.totalAmount,
    currency: summary.currency,
  };
}

export async function answerSpendingQuestion(userId: string, question: string) {
  const locale = await getUserLocale(userId);
  const [emails, upiTransactions] = await Promise.all([
    getClawCloudGmailMessages(userId, {
      query: receiptQuery,
      maxResults: 30,
    }),
    getUpiTransactions(userId, 30).catch(() => []),
  ]);

  const entries: SpendEntry[] = [];
  for (const email of emails.slice(0, 20)) {
    const entry = await extractSpendFromEmail(`${email.subject}\n\n${email.body || email.snippet}`);
    if (entry) {
      entries.push(entry);
    }
  }

  const upiEntries: SpendEntry[] = upiTransactions.map((txn) => ({
    merchant: txn.merchant,
    amount: txn.amount,
    currency: txn.currency,
    date: txn.transacted_at.split("T")[0] ?? txn.transacted_at,
    category: txn.category,
  }));

  const allEntries = [...entries, ...upiEntries];

  const context = allEntries
    .map((entry) => `${entry.date} | ${entry.merchant} | ${entry.amount} ${entry.currency} | ${entry.category}`)
    .join("\n");

  const answer = await completeClawCloudPrompt({
    system:
      "You are a concise personal finance assistant. Answer only from the transaction data provided.",
    user: `Question: ${question}\n\nTransactions:\n${context || "No transactions found."}`,
    maxTokens: 250,
    fallback: "I could not find enough spending data to answer that.",
  });

  return translateMessage(answer, locale);
}
