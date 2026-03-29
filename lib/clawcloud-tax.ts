import { matchesWholeAlias } from "@/lib/clawcloud-intent-match";

type GstSlab = 0 | 5 | 12 | 18 | 28;

const GST_SLAB_ITEMS: Record<string, { slab: GstSlab; category: string }> = {
  rice: { slab: 0, category: "Essential food" },
  wheat: { slab: 0, category: "Essential food" },
  milk: { slab: 0, category: "Essential food" },
  salt: { slab: 0, category: "Essential food" },
  vegetables: { slab: 0, category: "Essential food" },
  fruits: { slab: 0, category: "Essential food" },
  eggs: { slab: 0, category: "Essential food" },
  bread: { slab: 0, category: "Essential food" },
  medicine: { slab: 0, category: "Life-saving drugs" },
  book: { slab: 0, category: "Books / education" },
  books: { slab: 0, category: "Books / education" },
  newspaper: { slab: 0, category: "Print media" },
  oil: { slab: 5, category: "Edible oil" },
  sugar: { slab: 5, category: "Food" },
  tea: { slab: 5, category: "Beverages" },
  coffee: { slab: 5, category: "Beverages" },
  "packed food": { slab: 5, category: "Processed food" },
  footwear: { slab: 5, category: "Footwear < ₹1000" },
  phone: { slab: 12, category: "Electronics" },
  mobile: { slab: 12, category: "Electronics" },
  laptop: { slab: 12, category: "Electronics" },
  computer: { slab: 12, category: "Electronics" },
  furniture: { slab: 12, category: "Furniture" },
  hotel: { slab: 12, category: "Hotel (₹1000-₹7500/night)" },
  restaurant: { slab: 18, category: "Restaurant (AC)" },
  services: { slab: 18, category: "Most services" },
  software: { slab: 18, category: "Software / IT services" },
  it: { slab: 18, category: "IT services" },
  consulting: { slab: 18, category: "Professional services" },
  ac: { slab: 18, category: "Air conditioner" },
  refrigerator: { slab: 18, category: "Appliances" },
  washing: { slab: 18, category: "Appliances" },
  car: { slab: 28, category: "Automobiles" },
  cigarette: { slab: 28, category: "Tobacco" },
  tobacco: { slab: 28, category: "Tobacco" },
  alcohol: { slab: 28, category: "Liquor" },
  gambling: { slab: 28, category: "Gambling / betting" },
  pan: { slab: 28, category: "Masala pan" },
  cement: { slab: 28, category: "Cement" },
  paint: { slab: 28, category: "Paints" },
};

const TDS_RATES: Array<{
  keywords: string[];
  section: string;
  rate: number;
  threshold: number;
  description: string;
}> = [
  { keywords: ["salary", "salaries"], section: "192", rate: 30, threshold: 250_000, description: "Salary (as per slab)" },
  { keywords: ["interest", "fd", "fixed deposit"], section: "194A", rate: 10, threshold: 40_000, description: "Interest (bank FD)" },
  { keywords: ["contractor", "contract"], section: "194C", rate: 1, threshold: 30_000, description: "Contractor payment" },
  { keywords: ["professional", "consultant", "consulting", "freelance"], section: "194J", rate: 10, threshold: 30_000, description: "Professional fees" },
  { keywords: ["rent", "rental"], section: "194I", rate: 10, threshold: 240_000, description: "Rent (per year)" },
  { keywords: ["commission", "brokerage"], section: "194H", rate: 5, threshold: 15_000, description: "Commission/brokerage" },
  { keywords: ["dividend"], section: "194", rate: 10, threshold: 5_000, description: "Dividend" },
  { keywords: ["lottery", "prize", "winnings"], section: "194B", rate: 30, threshold: 10_000, description: "Lottery/Prize" },
];

export function detectTaxQuery(message: string): "gst" | "tds" | "income_tax" | null {
  const normalized = message.toLowerCase();
  if (/\bgst\b/.test(normalized) || /goods and service/i.test(normalized)) {
    return "gst";
  }
  if (/\btds\b/.test(normalized) || /tax deducted at source/i.test(normalized)) {
    return "tds";
  }
  if (/\b(income tax|tax regime|new regime|old regime|itr|slab|80c|80d|80ccd|hra|87a|section 80|home loan interest)\b/.test(normalized)) {
    return "income_tax";
  }
  return null;
}

function parseAmount(message: string): number | null {
  const lakhMatch = message.match(/(\d+(?:\.\d+)?)\s*(?:lakh|lac|l)\b/i);
  if (lakhMatch) {
    return Number.parseFloat(lakhMatch[1]) * 100_000;
  }

  const croreMatch = message.match(/(\d+(?:\.\d+)?)\s*(?:crore|cr)\b/i);
  if (croreMatch) {
    return Number.parseFloat(croreMatch[1]) * 10_000_000;
  }

  const amountMatch = message.match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i)
    ?? message.match(/\b([\d,]+(?:\.\d{1,2})?)\b/);
  if (amountMatch) {
    return Number.parseFloat(amountMatch[1].replace(/,/g, ""));
  }

  return null;
}

function parseGstRate(message: string): GstSlab | null {
  const normalized = message.toLowerCase();
  const rateMatch = normalized.match(/\b(0|5|12|18|28)\s*%/);
  if (rateMatch) {
    return Number.parseInt(rateMatch[1], 10) as GstSlab;
  }

  for (const [keyword, info] of Object.entries(GST_SLAB_ITEMS)) {
    if (matchesWholeAlias(normalized, keyword)) {
      return info.slab;
    }
  }

  return null;
}

function formatInr(amount: number): string {
  if (amount >= 10_000_000) {
    return `₹${(amount / 10_000_000).toFixed(2)} Cr`;
  }
  if (amount >= 100_000) {
    return `₹${(amount / 100_000).toFixed(2)} L`;
  }
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function calculateGst(amount: number, rate: GstSlab, isInclusive: boolean): string {
  let baseAmount: number;
  let gstAmount: number;
  let totalAmount: number;
  const explanation: string[] = [];

  if (isInclusive) {
    baseAmount = (amount * 100) / (100 + rate);
    gstAmount = amount - baseAmount;
    totalAmount = amount;
    explanation.push(
      `*Inclusive breakdown:* ${formatInr(amount)} / 1.${String(rate).padStart(2, "0")} = ${formatInr(baseAmount)}`,
      `*GST amount:* ${formatInr(amount)} - ${formatInr(baseAmount)} = ${formatInr(gstAmount)}`,
    );
  } else {
    baseAmount = amount;
    gstAmount = (amount * rate) / 100;
    totalAmount = amount + gstAmount;
    explanation.push(
      `*Taxable value:* ${formatInr(baseAmount)}`,
      `*GST amount:* ${formatInr(baseAmount)} x ${rate}% = ${formatInr(gstAmount)}`,
    );
  }

  const cgst = gstAmount / 2;
  const sgst = gstAmount / 2;

  return [
    `🧾 *GST Calculation @ ${rate}%*`,
    "",
    isInclusive ? `*Taxable value (before GST):* ${formatInr(baseAmount)}` : `*Base Amount:* ${formatInr(baseAmount)}`,
    `*CGST (${rate / 2}%):* ${formatInr(cgst)}`,
    `*SGST (${rate / 2}%):* ${formatInr(sgst)}`,
    `*Total GST:* ${formatInr(gstAmount)}`,
    "",
    ...explanation,
    "",
    `*${isInclusive ? "Invoice total (GST inclusive)" : "Total Amount (GST inclusive)"}:* ${formatInr(totalAmount)}`,
    "",
    "_For inter-state: IGST applies instead of CGST+SGST_",
  ].join("\n");
}

function calculateTds(amount: number, message: string): string {
  const normalized = message.toLowerCase();
  const matched = TDS_RATES.find((item) => item.keywords.some((keyword) => matchesWholeAlias(normalized, keyword)))
    ?? TDS_RATES.find((item) => item.section === "194J");

  if (!matched) {
    return "I could not determine the TDS section for that payment.";
  }

  if (amount <= matched.threshold) {
    return [
      `💰 *TDS Calculation - Section ${matched.section}*`,
      `_(${matched.description})_`,
      "",
      `*Amount:* ${formatInr(amount)}`,
      `*TDS threshold:* ${formatInr(matched.threshold)}`,
      "",
      `⚠️ *TDS not applicable* - amount is below the threshold of ${formatInr(matched.threshold)}.`,
    ].join("\n");
  }

  const tdsAmount = (amount * matched.rate) / 100;
  const netAmount = amount - tdsAmount;

  return [
    `💰 *TDS Calculation - Section ${matched.section}*`,
    `_(${matched.description})_`,
    "",
    `*Gross Amount:* ${formatInr(amount)}`,
    `*TDS Rate:* ${matched.rate}%`,
    `*TDS Amount:* ${formatInr(tdsAmount)}`,
    `*Net Receivable:* ${formatInr(netAmount)}`,
    "",
    "_Deposit TDS via ITNS 281 before the 7th of next month_",
    "_Consult a CA for your specific situation_",
  ].join("\n");
}

function calculateIncomeTax(annualIncome: number): string {
  const slabs = [
    { upTo: 300_000, rate: 0 },
    { upTo: 700_000, rate: 5 },
    { upTo: 1_000_000, rate: 10 },
    { upTo: 1_200_000, rate: 15 },
    { upTo: 1_500_000, rate: 20 },
    { upTo: Number.POSITIVE_INFINITY, rate: 30 },
  ];

  let tax = 0;
  let remaining = annualIncome;
  let previousLimit = 0;
  const breakdown: string[] = [];

  for (const slab of slabs) {
    if (remaining <= 0) {
      break;
    }

    const taxable = Math.min(remaining, slab.upTo - previousLimit);
    const slabTax = (taxable * slab.rate) / 100;
    if (slabTax > 0) {
      breakdown.push(`  ${formatInr(previousLimit)} - ${slab.upTo === Number.POSITIVE_INFINITY ? "above" : formatInr(slab.upTo)}: ${slab.rate}% = ${formatInr(slabTax)}`);
    }
    tax += slabTax;
    remaining -= taxable;
    previousLimit = slab.upTo;
  }

  const rebate = annualIncome <= 700_000 ? Math.min(tax, 25_000) : 0;
  const taxAfterRebate = tax - rebate;
  const cess = taxAfterRebate * 0.04;
  const totalTax = taxAfterRebate + cess;

  return [
    "📊 *Income Tax Estimate - FY2024-25 (New Regime)*",
    "",
    `*Annual Income:* ${formatInr(annualIncome)}`,
    "",
    "*Tax Breakdown:*",
    ...breakdown,
    rebate > 0 ? `*Rebate u/s 87A:* -${formatInr(rebate)}` : "",
    `*Tax after rebate:* ${formatInr(taxAfterRebate)}`,
    `*Cess (4%):* ${formatInr(cess)}`,
    "",
    `*Total Tax Payable:* ${formatInr(totalTax)}`,
    `*Effective Rate:* ${((totalTax / annualIncome) * 100).toFixed(2)}%`,
    `*Monthly TDS:* ~ ${formatInr(totalTax / 12)}`,
    "",
    "_Old regime may be better if you have deductions (80C, HRA, LTA). Consult a CA._",
  ].filter(Boolean).join("\n");
}

type IncomeTaxRegime = "new" | "old";

type IncomeTaxDeductions = {
  section80c: number;
  nps: number;
  hra: number;
  homeLoanInterest: number;
  section80d: number;
  other: number;
  total: number;
  notes: string[];
};

type IncomeTaxContext = {
  annualIncome: number;
  isMonthly: boolean;
  isSalaried: boolean;
  preferredRegime: IncomeTaxRegime | null;
  wantsComparison: boolean;
  deductions: IncomeTaxDeductions;
};

type IncomeTaxComputation = {
  regime: IncomeTaxRegime;
  annualIncome: number;
  standardDeduction: number;
  allowedDeductions: number;
  taxableIncome: number;
  slabTax: number;
  rebate: number;
  taxAfterRebate: number;
  cess: number;
  totalTax: number;
  effectiveRate: number;
  monthlyTds: number;
  breakdown: string[];
};

const INCOME_TAX_AMOUNT_PATTERN = "([\\d,]+(?:\\.\\d+)?(?:\\s*(?:lakh|lac|crore|cr))?)";

function parseTaggedTaxAmount(message: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = pattern.exec(message);
    const raw = match?.[1]?.trim();
    if (!raw) {
      continue;
    }
    const amount = parseAmount(raw);
    if (amount != null) {
      return amount;
    }
  }

  return null;
}

function capTaxDeduction(amount: number | null, cap: number, label: string, notes: string[]) {
  if (amount == null || amount <= 0) {
    return 0;
  }
  if (amount > cap) {
    notes.push(`${label} capped at ${formatInr(cap)} for this estimate.`);
    return cap;
  }
  return amount;
}

function parseIncomeTaxDeductions(message: string): IncomeTaxDeductions {
  const notes: string[] = [];

  const section80c = capTaxDeduction(
    parseTaggedTaxAmount(message, [
      new RegExp(`(?:80c|section 80c)(?:\\s*(?:investment|deduction|is|=|of|:|for|upto|up to))?\\s*(?:â‚¹|rs\\.?|inr)?\\s*${INCOME_TAX_AMOUNT_PATTERN}`, "i"),
    ]),
    150_000,
    "80C",
    notes,
  );
  const nps = capTaxDeduction(
    parseTaggedTaxAmount(message, [
      new RegExp(`(?:nps|80ccd(?:\\(1b\\))?)(?:\\s*(?:deduction|is|=|of|:|for|upto|up to))?\\s*(?:â‚¹|rs\\.?|inr)?\\s*${INCOME_TAX_AMOUNT_PATTERN}`, "i"),
    ]),
    50_000,
    "NPS",
    notes,
  );
  const hra = parseTaggedTaxAmount(message, [
    new RegExp(`(?:hra|house rent allowance)(?:\\s*(?:exemption|deduction|is|=|of|:|for))?\\s*(?:â‚¹|rs\\.?|inr)?\\s*${INCOME_TAX_AMOUNT_PATTERN}`, "i"),
  ]) ?? 0;
  const homeLoanInterest = capTaxDeduction(
    parseTaggedTaxAmount(message, [
      new RegExp(`(?:home loan interest|housing loan interest|section 24)(?:\\s*(?:deduction|is|=|of|:|for|upto|up to))?\\s*(?:â‚¹|rs\\.?|inr)?\\s*${INCOME_TAX_AMOUNT_PATTERN}`, "i"),
    ]),
    200_000,
    "Home loan interest",
    notes,
  );
  const section80d = capTaxDeduction(
    parseTaggedTaxAmount(message, [
      new RegExp(`(?:80d|medical insurance|health insurance)(?:\\s*(?:deduction|is|=|of|:|for|upto|up to))?\\s*(?:â‚¹|rs\\.?|inr)?\\s*${INCOME_TAX_AMOUNT_PATTERN}`, "i"),
    ]),
    25_000,
    "80D",
    notes,
  );
  const other = parseTaggedTaxAmount(message, [
    new RegExp(`(?:other deductions|additional deductions)(?:\\s*(?:is|=|of|:|for))?\\s*(?:â‚¹|rs\\.?|inr)?\\s*${INCOME_TAX_AMOUNT_PATTERN}`, "i"),
  ]) ?? 0;

  const total = section80c + nps + hra + homeLoanInterest + section80d + other;

  return {
    section80c,
    nps,
    hra,
    homeLoanInterest,
    section80d,
    other,
    total,
    notes,
  };
}

function parseIncomeTaxContext(message: string, amount: number): IncomeTaxContext {
  const normalized = message.toLowerCase();
  const hasOldRegime = /\bold regime\b/.test(normalized);
  const hasNewRegime = /\bnew regime\b/.test(normalized);
  const preferredRegime =
    hasOldRegime && hasNewRegime ? null : hasOldRegime ? "old" : hasNewRegime ? "new" : null;
  const deductions = parseIncomeTaxDeductions(message);
  const wantsComparison =
    (hasOldRegime && hasNewRegime)
    || /\b(compare|comparison|vs|versus|better|which regime)\b/.test(normalized)
    || (preferredRegime === null && deductions.total > 0);
  const isMonthly =
    /\b(monthly|per month|a month|month)\b/.test(normalized)
    && !/\b(annual|annually|yearly|per year|p\.?a\.?|lpa|ctc|package)\b/.test(normalized);
  const isSalaried = /\b(salary|salaried|ctc|package|pay|payroll|pension)\b/.test(normalized);
  const annualIncome = isMonthly ? amount * 12 : amount;

  return {
    annualIncome,
    isMonthly,
    isSalaried,
    preferredRegime,
    wantsComparison,
    deductions,
  };
}

function calculateProgressiveIncomeTax(
  taxableIncome: number,
  slabs: Array<{ upTo: number; rate: number }>,
): { tax: number; breakdown: string[] } {
  let tax = 0;
  let remaining = taxableIncome;
  let previousLimit = 0;
  const breakdown: string[] = [];

  for (const slab of slabs) {
    if (remaining <= 0) {
      break;
    }

    const taxablePortion = Math.min(remaining, slab.upTo - previousLimit);
    const slabTax = (taxablePortion * slab.rate) / 100;
    if (taxablePortion > 0) {
      const upperLabel = slab.upTo === Number.POSITIVE_INFINITY ? "above" : formatInr(slab.upTo);
      breakdown.push(`- ${formatInr(previousLimit)} to ${upperLabel}: ${slab.rate}% on ${formatInr(taxablePortion)} = ${formatInr(slabTax)}`);
    }
    tax += slabTax;
    remaining -= taxablePortion;
    previousLimit = slab.upTo;
  }

  return { tax, breakdown };
}

function computeIncomeTaxRegime(context: IncomeTaxContext, regime: IncomeTaxRegime): IncomeTaxComputation {
  const standardDeduction = context.isSalaried ? 50_000 : 0;
  const allowedDeductions =
    regime === "old"
      ? context.deductions.section80c
        + context.deductions.nps
        + context.deductions.hra
        + context.deductions.homeLoanInterest
        + context.deductions.section80d
        + context.deductions.other
      : 0;
  const taxableIncome = Math.max(0, context.annualIncome - standardDeduction - allowedDeductions);
  const slabs = regime === "new"
    ? [
      { upTo: 300_000, rate: 0 },
      { upTo: 700_000, rate: 5 },
      { upTo: 1_000_000, rate: 10 },
      { upTo: 1_200_000, rate: 15 },
      { upTo: 1_500_000, rate: 20 },
      { upTo: Number.POSITIVE_INFINITY, rate: 30 },
    ]
    : [
      { upTo: 250_000, rate: 0 },
      { upTo: 500_000, rate: 5 },
      { upTo: 1_000_000, rate: 20 },
      { upTo: Number.POSITIVE_INFINITY, rate: 30 },
    ];
  const { tax: slabTax, breakdown } = calculateProgressiveIncomeTax(taxableIncome, slabs);
  const rebateThreshold = regime === "new" ? 700_000 : 500_000;
  const rebateCap = regime === "new" ? 25_000 : 12_500;
  const rebate = taxableIncome <= rebateThreshold ? Math.min(slabTax, rebateCap) : 0;
  const taxAfterRebate = slabTax - rebate;
  const cess = taxAfterRebate * 0.04;
  const totalTax = taxAfterRebate + cess;
  const effectiveRate = context.annualIncome > 0 ? (totalTax / context.annualIncome) * 100 : 0;
  const monthlyTds = totalTax / 12;

  return {
    regime,
    annualIncome: context.annualIncome,
    standardDeduction,
    allowedDeductions,
    taxableIncome,
    slabTax,
    rebate,
    taxAfterRebate,
    cess,
    totalTax,
    effectiveRate,
    monthlyTds,
    breakdown,
  };
}

function buildIncomeTaxInputLines(context: IncomeTaxContext): string[] {
  const lines = [`*Annual gross income:* ${formatInr(context.annualIncome)}`];

  if (context.isMonthly) {
    lines.push("*Income basis:* Monthly income annualized x 12");
  }
  if (context.isSalaried) {
    lines.push("*Salary treatment:* Standard deduction applied");
  }

  return lines;
}

function buildIncomeTaxDeductionLines(deductions: IncomeTaxDeductions): string[] {
  const lines: string[] = [];
  if (deductions.section80c > 0) {
    lines.push(`- 80C: ${formatInr(deductions.section80c)}`);
  }
  if (deductions.nps > 0) {
    lines.push(`- NPS / 80CCD(1B): ${formatInr(deductions.nps)}`);
  }
  if (deductions.hra > 0) {
    lines.push(`- HRA exemption: ${formatInr(deductions.hra)}`);
  }
  if (deductions.homeLoanInterest > 0) {
    lines.push(`- Home loan interest: ${formatInr(deductions.homeLoanInterest)}`);
  }
  if (deductions.section80d > 0) {
    lines.push(`- 80D / medical insurance: ${formatInr(deductions.section80d)}`);
  }
  if (deductions.other > 0) {
    lines.push(`- Other deductions: ${formatInr(deductions.other)}`);
  }
  return lines;
}

function formatIncomeTaxComputation(computation: IncomeTaxComputation, label: string): string[] {
  return [
    `*${label}*`,
    `- Taxable income: ${formatInr(computation.taxableIncome)}`,
    `- Standard deduction: ${formatInr(computation.standardDeduction)}`,
    `- Other deductions used: ${formatInr(computation.allowedDeductions)}`,
    ...computation.breakdown,
    computation.rebate > 0 ? `- Rebate u/s 87A: -${formatInr(computation.rebate)}` : "- Rebate u/s 87A: Rs 0.00",
    `- Tax after rebate: ${formatInr(computation.taxAfterRebate)}`,
    `- Cess (4%): ${formatInr(computation.cess)}`,
    `- Total Tax Payable: ${formatInr(computation.totalTax)}`,
    `- Effective Rate: ${computation.effectiveRate.toFixed(2)}%`,
    `- Monthly TDS: ${formatInr(computation.monthlyTds)}`,
  ];
}

function calculateIncomeTaxDetailed(message: string, amount: number): string {
  const context = parseIncomeTaxContext(message, amount);
  const inputLines = buildIncomeTaxInputLines(context);
  const deductionLines = buildIncomeTaxDeductionLines(context.deductions);

  if (context.wantsComparison) {
    const newRegime = computeIncomeTaxRegime(context, "new");
    const oldRegime = computeIncomeTaxRegime(context, "old");
    const savings = Math.abs(newRegime.totalTax - oldRegime.totalTax);
    const betterLine =
      savings < 1
        ? "*Better option:* Both regimes are effectively the same for this input."
        : oldRegime.totalTax < newRegime.totalTax
          ? `*Better option:* Old regime saves ${formatInr(savings)} versus new regime.`
          : `*Better option:* New regime saves ${formatInr(savings)} versus old regime.`;

    return [
      "📊 *Income Tax Estimate - FY2024-25*",
      "",
      "*Comparison:* Old Regime vs New Regime",
      ...inputLines,
      ...(deductionLines.length > 0
        ? [
          "",
          "*Reported old-regime deductions considered:*",
          ...deductionLines,
        ]
        : []),
      "",
      ...formatIncomeTaxComputation(newRegime, "New Regime Summary"),
      "",
      ...formatIncomeTaxComputation(oldRegime, "Old Regime Summary"),
      "",
      betterLine,
      ...(context.deductions.notes.length > 0 ? ["", ...context.deductions.notes.map((note) => `_${note}_`)] : []),
      "",
      "_This is a planning estimate. Final tax can change with employer payroll treatment, exemptions, and filing details._",
    ].filter(Boolean).join("\n");
  }

  const regime = context.preferredRegime ?? "new";
  const computation = computeIncomeTaxRegime(context, regime);
  const label = regime === "new" ? "New Regime" : "Old Regime";
  const notes: string[] = [];

  if (regime === "new" && context.deductions.total > 0) {
    notes.push("Old-regime deductions like 80C, HRA, and home-loan interest are not applied in this new-regime estimate.");
  }
  if (regime === "old" && context.deductions.total === 0) {
    notes.push("No old-regime deductions were detected, so only the salary standard deduction is applied where relevant.");
  }
  notes.push(...context.deductions.notes);

  return [
    `📊 *Income Tax Estimate - FY2024-25 (${label})*`,
    "",
    ...inputLines,
    ...(deductionLines.length > 0 && regime === "old"
      ? [
        "",
        "*Reported deductions used:*",
        ...deductionLines,
      ]
      : []),
    "",
    ...formatIncomeTaxComputation(computation, `${label} Calculation`),
    ...(notes.length > 0 ? ["", ...notes.map((note) => `_${note}_`)] : []),
  ].filter(Boolean).join("\n");
}

export function answerTaxQuery(message: string): string | null {
  const type = detectTaxQuery(message);
  if (!type) {
    return null;
  }

  const amount = parseAmount(message);
  const normalized = message.toLowerCase();

  if (type === "gst") {
    if (!amount) {
      return [
        "🧾 *GST Slabs (India)*",
        "",
        "• *0%* - Essential foods, books, medicine",
        "• *5%* - Edible oils, sugar, tea, basic footwear",
        "• *12%* - Phones, laptops, furniture, mid-range hotels",
        "• *18%* - Restaurants (AC), IT services, consulting, appliances",
        "• *28%* - Cars, tobacco, cement, luxury goods",
        "",
        "💡 _Send me an amount and item to calculate: 'GST on ₹15,000 laptop'_",
      ].join("\n");
    }

    const rate = parseGstRate(message);
    if (!rate) {
      return [
        `🧾 *GST Calculation for ${formatInr(amount)}*`,
        "",
        "I cannot infer the GST rate from that description alone.",
        "GST depends on the exact good or service classification.",
        "",
        "What GST rate applies?",
        "• Reply *GST 5%*, *GST 12%*, *GST 18%*, or *GST 28%*",
        "• Or mention the actual item/service: _'GST on ₹15000 laptop'_",
        "• If this is a service quote, share the service category or your known GST rate.",
      ].join("\n");
    }

    const isInclusive = /inclus|included|gst incl/i.test(normalized);
    return calculateGst(amount, rate, isInclusive);
  }

  if (type === "tds") {
    if (!amount) {
      return [
        "💰 *TDS Rates (Key Sections)*",
        "",
        "• *194J* - Professional/consulting fees: 10% (threshold ₹30K)",
        "• *194C* - Contractor payments: 1% (threshold ₹30K)",
        "• *194A* - Bank FD interest: 10% (threshold ₹40K)",
        "• *194I* - Rent: 10% (threshold ₹2.4L/year)",
        "• *194H* - Commission/brokerage: 5% (threshold ₹15K)",
        "• *194B* - Lottery/prizes: 30% (threshold ₹10K)",
        "",
        "💡 _Send me an amount to calculate: 'TDS on ₹1 lakh freelance payment'_",
      ].join("\n");
    }

    return calculateTds(amount, message);
  }

  if (!amount) {
    return [
      "📊 *Income Tax - FY2024-25 (New Regime Slabs)*",
      "",
      "• Up to ₹3L: 0%",
      "• ₹3L - ₹7L: 5%",
      "• ₹7L - ₹10L: 10%",
      "• ₹10L - ₹12L: 15%",
      "• ₹12L - ₹15L: 20%",
      "• Above ₹15L: 30%",
      "",
      "*Rebate:* No tax if income <= ₹7L (u/s 87A)",
      "",
      "💡 _Send your income: 'Income tax on 12 lakh salary'_",
    ].join("\n");
  }

  return calculateIncomeTaxDetailed(message, amount);
}
