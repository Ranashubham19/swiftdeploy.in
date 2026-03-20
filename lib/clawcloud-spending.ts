import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";
import { upsertAnalyticsDaily } from "@/lib/clawcloud-analytics";
import {
  buildGoogleReconnectRequiredReply,
  getClawCloudGmailMessages,
  isClawCloudGoogleReconnectRequiredError,
} from "@/lib/clawcloud-google";
import {
  normalizeMerchantName,
  normalizeSpendingCategory,
} from "@/lib/clawcloud-india-normalization";
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

type SpendSummary = {
  periodLabel: string;
  windowDays: number;
  totalAmount: number;
  currency: string;
  entries: SpendEntry[];
  topCategories: Array<{ category: string; total: number }>;
  topMerchants: Array<{ merchant: string; total: number }>;
  averageTicket: number;
  biggestExpense: SpendEntry | null;
};

type SpendSourceFetch = {
  emails: Awaited<ReturnType<typeof getClawCloudGmailMessages>>;
  upiTransactions: Awaited<ReturnType<typeof getUpiTransactions>>;
  gmailLimited: boolean;
  reconnectRequired: boolean;
};

function buildReceiptQuery(days: number) {
  return [
    'subject:(receipt OR invoice OR order OR payment OR transaction OR "your order" OR "payment received" OR "order confirmation")',
    `newer_than:${days}d`,
    "-label:spam",
  ].join(" ");
}

function normalizeSpendEntry(entry: SpendEntry, context = ""): SpendEntry {
  const merchant = normalizeMerchantName(entry.merchant, context);
  return {
    ...entry,
    merchant,
    category: normalizeSpendingCategory(entry.category, merchant, context),
  };
}

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
      merchant: normalizeMerchantName(String(parsed.merchant), emailText),
      amount: Number(parsed.amount),
      currency: String(parsed.currency).toUpperCase(),
      date: String(parsed.date || new Date().toISOString().split("T")[0]),
      category: normalizeSpendingCategory(String(parsed.category || "other"), String(parsed.merchant), emailText),
    };
  } catch {
    return null;
  }
}

function buildSpendSummary(entries: SpendEntry[], windowDays: number, periodLabel: string): SpendSummary {
  const cutoff = new Date(Date.now() - windowDays * 86_400_000);
  const scopedEntries = entries.filter((entry) => {
    const parsed = new Date(`${entry.date}T00:00:00`);
    return Number.isFinite(parsed.getTime()) ? parsed >= cutoff : true;
  });

  if (scopedEntries.length === 0) {
    return {
      periodLabel,
      windowDays,
      totalAmount: 0,
      currency: "USD",
      entries: [],
      topCategories: [],
      topMerchants: [],
      averageTicket: 0,
      biggestExpense: null,
    };
  }

  const normalizedEntries = scopedEntries.map((entry) => normalizeSpendEntry(entry));
  const currencyCount: Record<string, number> = {};
  for (const entry of normalizedEntries) {
    currencyCount[entry.currency] = (currencyCount[entry.currency] ?? 0) + 1;
  }

  const dominantCurrency =
    Object.entries(currencyCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
  const sameCurrencyEntries = normalizedEntries.filter((entry) => entry.currency === dominantCurrency);
  const totalAmount = sameCurrencyEntries.reduce((sum, entry) => sum + entry.amount, 0);

  const categoryTotals: Record<string, number> = {};
  const merchantTotals: Record<string, number> = {};

  for (const entry of sameCurrencyEntries) {
    categoryTotals[entry.category] = (categoryTotals[entry.category] ?? 0) + entry.amount;
    merchantTotals[entry.merchant] = (merchantTotals[entry.merchant] ?? 0) + entry.amount;
  }

  const biggestExpense = [...sameCurrencyEntries].sort((a, b) => b.amount - a.amount)[0] ?? null;

  return {
    periodLabel,
    windowDays,
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
    averageTicket: sameCurrencyEntries.length ? totalAmount / sameCurrencyEntries.length : 0,
    biggestExpense,
  };
}

function buildMonthlyInsights(summary: SpendSummary): string[] {
  if (summary.entries.length === 0) {
    return [];
  }

  const lines: string[] = [];
  const formatAmount = (amount: number) =>
    `${summary.currency} ${amount.toLocaleString("en", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  if (summary.topCategories[0]) {
    lines.push(`Top category this month: ${summary.topCategories[0].category} (${formatAmount(summary.topCategories[0].total)})`);
  }

  if (summary.biggestExpense) {
    lines.push(`Largest payment: ${summary.biggestExpense.merchant} (${formatAmount(summary.biggestExpense.amount)})`);
  }

  if (summary.averageTicket > 0) {
    lines.push(`Average transaction size: ${formatAmount(summary.averageTicket)}`);
  }

  return lines;
}

function formatAmount(currency: string, amount: number) {
  return `${currency} ${amount.toLocaleString("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatSpendMessage(weeklySummary: SpendSummary, monthlySummary: SpendSummary) {
  if (weeklySummary.entries.length === 0 && monthlySummary.entries.length === 0) {
    return "Weekly spending summary\n\nNo transactions were found in your recent inbox or saved UPI history.";
  }

  const weeklyCurrency = weeklySummary.entries.length ? weeklySummary.currency : monthlySummary.currency;
  const lines = [
    "Weekly spending summary",
    "",
    `Last 7 days: ${formatAmount(weeklyCurrency, weeklySummary.totalAmount)} (${weeklySummary.entries.length} transactions)`,
  ];

  if (weeklySummary.topCategories.length) {
    lines.push("");
    lines.push("This week by category:");
    lines.push(...weeklySummary.topCategories.map((entry) => `- ${entry.category}: ${formatAmount(weeklyCurrency, entry.total)}`));
  }

  if (weeklySummary.topMerchants.length) {
    lines.push("");
    lines.push("This week top merchants:");
    lines.push(...weeklySummary.topMerchants.map((entry) => `- ${entry.merchant}: ${formatAmount(weeklyCurrency, entry.total)}`));
  }

  if (monthlySummary.entries.length) {
    lines.push("");
    lines.push("Monthly snapshot:");
    lines.push(`- Last 30 days: ${formatAmount(monthlySummary.currency, monthlySummary.totalAmount)} (${monthlySummary.entries.length} transactions)`);
    lines.push(...buildMonthlyInsights(monthlySummary).map((line) => `- ${line}`));
  }

  lines.push("");
  lines.push('Ask me things like "How much did I spend on food this month?"');
  return lines.join("\n");
}

function buildSpendingFacts(weeklySummary: SpendSummary, monthlySummary: SpendSummary) {
  const weeklyCurrency = weeklySummary.entries.length ? weeklySummary.currency : monthlySummary.currency;
  const lines = [
    `Last 7 days total: ${formatAmount(weeklyCurrency, weeklySummary.totalAmount)} across ${weeklySummary.entries.length} transactions.`,
    `Last 30 days total: ${formatAmount(monthlySummary.currency, monthlySummary.totalAmount)} across ${monthlySummary.entries.length} transactions.`,
  ];

  if (monthlySummary.topCategories.length) {
    lines.push(`Top categories last 30 days: ${monthlySummary.topCategories.map((entry) => `${entry.category} ${formatAmount(monthlySummary.currency, entry.total)}`).join(", ")}.`);
  }

  if (monthlySummary.topMerchants.length) {
    lines.push(`Top merchants last 30 days: ${monthlySummary.topMerchants.map((entry) => `${entry.merchant} ${formatAmount(monthlySummary.currency, entry.total)}`).join(", ")}.`);
  }

  if (monthlySummary.biggestExpense) {
    lines.push(`Largest payment last 30 days: ${monthlySummary.biggestExpense.merchant} ${formatAmount(monthlySummary.currency, monthlySummary.biggestExpense.amount)} on ${monthlySummary.biggestExpense.date}.`);
  }

  return lines.join("\n");
}

function buildTransactionContext(entries: SpendEntry[]) {
  return entries
    .slice(0, 120)
    .map((entry) => `${entry.date} | ${entry.merchant} | ${entry.amount} ${entry.currency} | ${entry.category}`)
    .join("\n");
}

function getLookbackDays(question: string) {
  const lower = question.toLowerCase();
  if (/\b(quarter|90 days|3 months)\b/.test(lower)) {
    return 90;
  }
  if (/\b(month|30 days|last 30)\b/.test(lower)) {
    return 60;
  }
  return 30;
}

async function fetchSpendSources(userId: string, lookbackDays: number): Promise<SpendSourceFetch> {
  const result: SpendSourceFetch = {
    emails: [],
    upiTransactions: [],
    gmailLimited: false,
    reconnectRequired: false,
  };

  const [emailResult, upiResult] = await Promise.allSettled([
    getClawCloudGmailMessages(userId, {
      query: buildReceiptQuery(lookbackDays),
      maxResults: 60,
    }),
    getUpiTransactions(userId, lookbackDays).catch(() => []),
  ]);

  if (emailResult.status === "fulfilled") {
    result.emails = emailResult.value;
  } else {
    result.gmailLimited = true;
    result.reconnectRequired = isClawCloudGoogleReconnectRequiredError(emailResult.reason);
  }

  if (upiResult.status === "fulfilled") {
    result.upiTransactions = upiResult.value;
  }

  return result;
}

function buildSpendDataUnavailableReply(periodLabel: string, gmailLimited: boolean) {
  const lines = [
    `I could not find enough spending data for ${periodLabel}.`,
    "",
    `Total spend for ${periodLabel}: INR 0.00`,
    "Top categories: none found.",
  ];

  if (gmailLimited) {
    lines.push("");
    lines.push("Gmail receipt data is not connected right now, so this check can only use any other connected payment history.");
  }

  lines.push("");
  lines.push("No transactions found in your connected data for this period.");
  return lines.join("\n");
}

function mergeSpendEntries(emailEntries: SpendEntry[], upiEntries: SpendEntry[]) {
  return [...emailEntries, ...upiEntries].map((entry) => normalizeSpendEntry(entry));
}

function buildWeeklySummary(entries: SpendEntry[]): SpendSummary {
  if (entries.length === 0) {
    return {
      periodLabel: "Last 7 days",
      windowDays: 7,
      totalAmount: 0,
      currency: "USD",
      entries: [],
      topCategories: [],
      topMerchants: [],
      averageTicket: 0,
      biggestExpense: null,
    };
  }
  return buildSpendSummary(entries, 7, "Last 7 days");
}

export async function runWeeklySpendSummary(userId: string) {
  const locale = await getUserLocale(userId);
  const sourceData = await fetchSpendSources(userId, 30);
  const { emails, upiTransactions, gmailLimited, reconnectRequired } = sourceData;

  if (!emails.length && !upiTransactions.length) {
    const message = reconnectRequired
      ? buildGoogleReconnectRequiredReply("Gmail")
      : buildSpendDataUnavailableReply("the last 30 days", gmailLimited);
    await sendClawCloudWhatsAppMessage(userId, await translateMessage(message, locale));
    await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
    return {
      transactions: 0,
      total: 0,
      currency: "USD",
    };
  }

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

  const upiEntries: SpendEntry[] = upiTransactions.map((txn) => ({
    merchant: txn.merchant,
    amount: txn.amount,
    currency: txn.currency,
    date: txn.transacted_at.split("T")[0] ?? txn.transacted_at,
    category: txn.category,
  }));

  const mergedEntries = mergeSpendEntries(entries, upiEntries);
  const weeklySummary = buildWeeklySummary(mergedEntries);
  const monthlySummary = buildSpendSummary(mergedEntries, 30, "Last 30 days");
  const spendMessage = formatSpendMessage(weeklySummary, monthlySummary);
  const translatedMessage = await translateMessage(
    gmailLimited && upiEntries.length
      ? `${spendMessage}\n\n_Note: Gmail receipt data is currently unavailable, so this summary uses only other connected payment history._`
      : spendMessage,
    locale,
  );

  await sendClawCloudWhatsAppMessage(userId, translatedMessage);
  await upsertAnalyticsDaily(userId, {
    emails_processed: emails.length,
    tasks_run: 1,
    wa_messages_sent: 1,
  });

  return {
    transactions: weeklySummary.entries.length,
    total: weeklySummary.totalAmount,
    currency: weeklySummary.currency,
  };
}

export async function answerSpendingQuestion(userId: string, question: string) {
  const locale = await getUserLocale(userId);
  const lookbackDays = getLookbackDays(question);
  const periodLabel = lookbackDays >= 60 ? "the last 30 days" : `the last ${lookbackDays} days`;
  const {
    emails,
    upiTransactions,
    gmailLimited,
    reconnectRequired,
  } = await fetchSpendSources(userId, lookbackDays);

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

  const allEntries = mergeSpendEntries(entries, upiEntries);
  if (!allEntries.length) {
    const fallback = reconnectRequired
      ? buildGoogleReconnectRequiredReply("Gmail")
      : buildSpendDataUnavailableReply(periodLabel, gmailLimited);
    return translateMessage(fallback, locale);
  }

  const weeklySummary = buildWeeklySummary(allEntries);
  const monthlySummary = buildSpendSummary(allEntries, 30, "Last 30 days");
  const facts = buildSpendingFacts(weeklySummary, monthlySummary);
  const context = buildTransactionContext(allEntries);

  const answer = await completeClawCloudPrompt({
    system: [
      "You are a concise personal finance assistant.",
      "Answer only from the transaction facts and transactions provided.",
      "Prefer exact totals from the summary facts when possible.",
      "If the requested period or category is not covered by the data, say that clearly instead of guessing.",
    ].join(" "),
    user: `Question: ${question}\n\nSummary facts:\n${facts}\n\nTransactions:\n${context || "No transactions found."}`,
    maxTokens: 300,
    fallback: "I could not find enough spending data to answer that.",
  });

  const finalAnswer = gmailLimited && upiEntries.length
    ? `${answer}\n\n_Note: Gmail receipt data is currently unavailable, so this answer uses only other connected payment history._`
    : answer;

  return translateMessage(finalAnswer, locale);
}
