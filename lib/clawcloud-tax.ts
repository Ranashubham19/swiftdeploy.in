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
  if (/\b(income tax|itr|slab|80c|hra|section 80)\b/.test(normalized)) {
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
    if (normalized.includes(keyword)) {
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
  const matched = TDS_RATES.find((item) => item.keywords.some((keyword) => normalized.includes(keyword)))
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
        "What GST rate applies?",
        "• Reply *GST 5%*, *GST 12%*, *GST 18%*, or *GST 28%*",
        "• Or mention the item: _'GST on ₹15000 laptop'_",
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

  return calculateIncomeTax(amount);
}
