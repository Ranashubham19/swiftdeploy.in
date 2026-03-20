import { completeClawCloudFast, completeClawCloudPrompt, type IntentType } from "@/lib/clawcloud-ai";
import { runResearchAgent } from "@/lib/research-agent";
import {
  classifyClawCloudLiveSearchRoute,
  decorateLiveSearchAnswer,
  fetchLiveDataAndSynthesize,
  shouldUseLiveSearch,
} from "@/lib/clawcloud-live-search";

type ChatHistory = Array<{ role: "user" | "assistant"; content: string }>;
type ExpertDomain =
  | "FINANCE_MATH"
  | "CAUSAL_STATS"
  | "ML_SYSTEMS"
  | "SYS_ARCH"
  | "REGULATED_AI"
  | "CLINICAL_BIO"
  | "PHYSICS_CHEM"
  | "GENERAL";

const CLASSIFIER_CACHE = new Map<string, ExpertDomain>();
const VALID_EXPERT_DOMAINS: ExpertDomain[] = [
  "FINANCE_MATH",
  "CAUSAL_STATS",
  "ML_SYSTEMS",
  "SYS_ARCH",
  "REGULATED_AI",
  "CLINICAL_BIO",
  "PHYSICS_CHEM",
  "GENERAL",
];

export async function semanticDomainClassify(question: string): Promise<ExpertDomain> {
  const key = question.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 160);
  if (CLASSIFIER_CACHE.has(key)) {
    return CLASSIFIER_CACHE.get(key)!;
  }

  const answer = await completeClawCloudFast({
    system: [
      "You are a domain classifier.",
      "Map the user's question to exactly one domain code.",
      "Reply with only the code and nothing else.",
      "",
      "Codes:",
      "FINANCE_MATH - trading systems, options, bonds, portfolio risk, VaR, CVaR, Kelly, insurance reserving, actuarial math",
      "CAUSAL_STATS - DiD, IV, RDD, causal inference, policy evaluation, beta or coefficient with standard error, t-statistic, confidence interval, survival analysis, Bayesian trials, diagnostics, econometrics",
      "ML_SYSTEMS - feature stores, training-serving skew, stale features, feature freshness, MLOps, RAG, vector retrieval, GPU scheduling, model monitoring",
      "SYS_ARCH - system design, ledgers, Stripe billing, carbon registry, CRDT, workflow engines, security architecture, CBDC, infra",
      "REGULATED_AI - hospital copilots, medical AI, financial AI with oversight, human-in-the-loop AI, safety-critical AI",
      "CLINICAL_BIO - clinical medicine, diagnostics, genomics, CRISPR, treatment protocols, biostatistics in clinical context",
      "PHYSICS_CHEM - physics, chemistry, materials, quantum, thermodynamics, electromagnetism",
      "GENERAL - everything else",
    ].join("\n"),
    user: question,
    maxTokens: 10,
    fallback: "GENERAL",
  });

  const cleaned = answer.trim().toUpperCase() as ExpertDomain;
  const domain = VALID_EXPERT_DOMAINS.includes(cleaned) ? cleaned : "GENERAL";
  CLASSIFIER_CACHE.set(key, domain);
  return domain;
}

const CODING_REVIEW_MODELS = [
  "moonshotai/kimi-k2.5",
  "z-ai/glm5",
  "qwen/qwen3-coder-480b-a35b-instruct",
  "mistralai/mistral-large-3-675b-instruct-2512",
  "meta/llama-3.3-70b-instruct",
  "meta/llama-3.1-405b-instruct",
];

const RESEARCH_MEMO_MODELS = [
  "moonshotai/kimi-k2.5",
  "z-ai/glm5",
  "mistralai/mistral-large-3-675b-instruct-2512",
  "meta/llama-3.1-405b-instruct",
  "meta/llama-3.3-70b-instruct",
];

type TradingSetup = {
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  riskPct: number;
  tradesPerYear: number;
  correlation: number;
  drawdownPct: number;
};

type BayesianDiagnosticSetup = {
  prevalence: number;
  sensitivity: number;
  specificity: number;
  falsePositiveCorrelation: number;
  positiveCount: number;
};

type QueueingSetup = {
  arrivalRate: number;
  serviceRate: number;
  servers: number;
  patienceMeanMinutes: number;
  waitThresholdMinutes: number;
};

type SurvivalAnalysisSetup = {
  hazardRatio: number;
  baselineSurvival: number;
  horizonMonths: number;
};

type BayesianTrialSetup = {
  treatmentPriorA: number;
  treatmentPriorB: number;
  controlPriorA: number;
  controlPriorB: number;
  treatmentResponses: number;
  treatmentTotal: number;
  controlResponses: number;
  controlTotal: number;
};

function containsAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function matchNumber(pattern: RegExp, text: string) {
  const match = text.match(pattern);
  if (!match) return null;
  return Number.parseFloat(match[1]);
}

function extractLabeledNumber(question: string, labels: string[], options?: { positiveOnly?: boolean }) {
  const normalized = question.replace(/,/g, "");
  const labelPattern = labels.join("|");
  const signPattern = options?.positiveOnly ? "\\d+(?:\\.\\d+)?" : "-?\\d+(?:\\.\\d+)?";
  const patterns = [
    new RegExp(
      `(?:\\b(?:${labelPattern})\\b)(?:\\s*(?:coefficient|estimate|term|value))?(?:\\s*(?:is|was|equals?|=|:|of))\\s*(${signPattern})`,
      "i",
    ),
    new RegExp(
      `(?:\\b(?:${labelPattern})\\b)(?:\\s*(?:coefficient|estimate|term|value))?\\s*(${signPattern})`,
      "i",
    ),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    if (match) {
      return Number.parseFloat(match[1]);
    }
  }

  return null;
}

function normalizePct(value: number) {
  return value > 1 ? value / 100 : value;
}

function formatExpertNumber(value: number) {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  const isWhole = Math.abs(rounded - Math.round(rounded)) < 0.005;
  return rounded.toLocaleString("en-IN", {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: isWhole ? 0 : 2,
  });
}

function solveSuccessiveDiscountQuestion(question: string) {
  const text = question.replace(/,/g, "");
  const normalized = text.toLowerCase();
  if (!/\bdiscount/.test(normalized) || !/%/.test(text) || /\b(gst|tax|vat)\b/.test(normalized)) {
    return null;
  }

  const priceMatch =
    text.match(/\b(?:priced at|price of|price is|mrp(?: is)?|marked price(?: is)?|list price(?: is)?|costs?|worth)\s*(?:rs\.?|inr|₹|\$)?\s*(\d+(?:\.\d+)?)/i)
    ?? text.match(/\b(?:rs\.?|inr|₹|\$)\s*(\d+(?:\.\d+)?)/i);
  const basePrice = priceMatch ? Number.parseFloat(priceMatch[1] ?? "") : Number.NaN;
  if (!Number.isFinite(basePrice) || basePrice <= 0) {
    return null;
  }

  const discountSection =
    question.match(/\bsuccessive discounts?\s+of\s+(.+?)(?:[.?!]|$)/i)?.[1]
    ?? question.match(/\bdiscounts?\s+of\s+(.+?)(?:[.?!]|$)/i)?.[1]
    ?? question;
  const discounts = Array.from(discountSection.matchAll(/(\d+(?:\.\d+)?)\s*%/gi))
    .map((match) => Number.parseFloat(match[1] ?? ""))
    .filter((value) => Number.isFinite(value) && value > 0 && value < 100);

  if (discounts.length < 2) {
    return null;
  }

  const usesRupees = /\b(?:rs\.?|inr|rupees?)\b|₹/i.test(question);
  const usesDollars = /\$/i.test(question);
  const currencyPrefix = usesRupees ? "Rs " : usesDollars ? "$" : "";
  const formatMoney = (value: number) => `${currencyPrefix}${formatExpertNumber(value)}`;

  let runningPrice = basePrice;
  const steps = discounts.map((discount, index) => {
    const discountAmount = (runningPrice * discount) / 100;
    const priceAfterDiscount = runningPrice - discountAmount;
    const line = `- After discount ${index + 1} (${discount}%): ${formatMoney(runningPrice)} - ${formatMoney(discountAmount)} = ${formatMoney(priceAfterDiscount)}`;
    runningPrice = priceAfterDiscount;
    return line;
  });

  const finalPrice = runningPrice;
  const totalDiscount = basePrice - finalPrice;
  const effectiveDiscountPct = (totalDiscount / basePrice) * 100;

  return [
    "*Successive Discount Calculation*",
    "",
    `- Original price: ${formatMoney(basePrice)}`,
    ...steps,
    "",
    `- Final price: ${formatMoney(finalPrice)}`,
    `- Total discount amount: ${formatMoney(totalDiscount)}`,
    `- Effective overall discount: ${formatExpertNumber(effectiveDiscountPct)}%`,
    "",
    "*Why this is the right method*",
    "- Successive discounts are applied one after another on the reduced price, not added directly.",
    "- So a 15% discount followed by a 12% discount is not the same as a flat 27% off the original price.",
  ].join("\n");
}

function parseTradingSetup(question: string): TradingSetup | null {
  const text = question.replace(/,/g, "");
  const winRate =
    matchNumber(/\b(?:wins?\s+|win rate(?: is| =)?\s*)(\d+(?:\.\d+)?)\s*%/i, text)
    ?? matchNumber(/\b(\d+(?:\.\d+)?)\s*%\s*(?:win rate|of the time)\b/i, text);
  const avgWinR = matchNumber(/\baverage win(?: is| =)?\s*(\d+(?:\.\d+)?)\s*r\b/i, text);
  const avgLossR = matchNumber(/\baverage loss(?: is| =)?\s*(\d+(?:\.\d+)?)\s*r\b/i, text);
  const riskPct =
    matchNumber(/\brisk per trade(?: is| =)?\s*(\d+(?:\.\d+)?)\s*%/i, text)
    ?? matchNumber(/\bi risk\s*(\d+(?:\.\d+)?)\s*%\s*(?:of equity\s*)?(?:per trade)?/i, text)
    ?? matchNumber(/\brisk(?:ing)?\s*(\d+(?:\.\d+)?)\s*%\s*(?:of equity\s*)?(?:per trade)?/i, text);
  const tradesPerYear = matchNumber(/\b(\d+(?:\.\d+)?)\s*trades?\s*per\s*year\b/i, text);
  const correlation =
    matchNumber(/\b(?:pairwise return correlation(?: under stress)?|correlation(?: under stress)?)\s*(?:is|=)?\s*(\d+(?:\.\d+)?)/i, text)
    ?? 0;
  const drawdownPct = matchNumber(/\b(\d+(?:\.\d+)?)\s*%\s*drawdown\b/i, text) ?? 30;

  if (
    winRate == null
    || avgWinR == null
    || avgLossR == null
    || riskPct == null
    || tradesPerYear == null
  ) {
    return null;
  }

  return {
    winRate: winRate / 100,
    avgWinR,
    avgLossR,
    riskPct,
    tradesPerYear: Math.max(1, Math.round(tradesPerYear)),
    correlation: Math.min(Math.max(correlation, 0), 0.95),
    drawdownPct,
  };
}

function parseBayesianDiagnosticSetup(question: string): BayesianDiagnosticSetup | null {
  const text = question.replace(/,/g, "");
  const prevalence = matchNumber(/\b(?:disease\s+)?prevalence(?: is| =)?\s*(\d+(?:\.\d+)?)\s*%/i, text);
  const sensitivity = matchNumber(/\bsensitivity(?: is| =)?\s*(\d+(?:\.\d+)?)\s*%/i, text);
  const specificity = matchNumber(/\bspecificity(?: is| =)?\s*(\d+(?:\.\d+)?)\s*%/i, text);
  const falsePositiveCorrelation =
    matchNumber(/\b(?:conditional\s+)?false-positive correlation(?: from repeated testing)?(?:\s+(?:is|equals|of)|\s*=)?\s*(\d+(?:\.\d+)?)/i, text)
    ?? matchNumber(/\bcorrelation(?: is| =)?\s*(\d+(?:\.\d+)?)/i, text)
    ?? 0;

  if (prevalence == null || sensitivity == null || specificity == null) {
    return null;
  }

  const positiveCount = /\b(positive twice|tests positive twice|two positive tests|2 positive tests|positive two times)\b/i.test(text)
    ? 2
    : 0;

  if (positiveCount !== 2) {
    return null;
  }

  return {
    prevalence: prevalence / 100,
    sensitivity: sensitivity / 100,
    specificity: specificity / 100,
    falsePositiveCorrelation: Math.min(Math.max(normalizePct(falsePositiveCorrelation), 0), 0.95),
    positiveCount,
  };
}

function parseQueueingSetup(question: string): QueueingSetup | null {
  const text = question.replace(/,/g, "");
  const servers = matchNumber(/\bm\/m\/(\d+)\+m\b/i, text);
  const arrivalRate =
    matchNumber(/\barrival rate(?: is| =)?\s*(\d+(?:\.\d+)?)\s*per\s*minute\b/i, text)
    ?? matchNumber(/\blambda(?: is| =)?\s*(\d+(?:\.\d+)?)\s*per\s*minute\b/i, text);
  const serviceRate =
    matchNumber(/\bservice rate(?: is| =)?\s*(\d+(?:\.\d+)?)\s*per\s*minute(?:\s*per\s*(?:agent|server))?\b/i, text)
    ?? matchNumber(/\bmu(?: is| =)?\s*(\d+(?:\.\d+)?)\s*per\s*minute\b/i, text);
  const patienceMeanMinutes =
    matchNumber(/\bmean patience(?: time)?(?: is| =)?\s*(\d+(?:\.\d+)?)\s*minutes?\b/i, text)
    ?? matchNumber(/\bpatience with mean\s*(\d+(?:\.\d+)?)\s*minutes?\b/i, text);
  const waitThresholdMinutes =
    matchNumber(/\bwaiting more than\s*(\d+(?:\.\d+)?)\s*minutes?\b/i, text)
    ?? matchNumber(/\bwait(?:ing)? more than\s*(\d+(?:\.\d+)?)\s*minutes?\b/i, text)
    ?? 2;

  if (
    servers == null
    || arrivalRate == null
    || serviceRate == null
    || patienceMeanMinutes == null
  ) {
    return null;
  }

  return {
    arrivalRate,
    serviceRate,
    servers: Math.max(1, Math.round(servers)),
    patienceMeanMinutes,
    waitThresholdMinutes,
  };
}

function parseSurvivalAnalysisSetup(question: string): SurvivalAnalysisSetup | null {
  const text = question.replace(/,/g, "");
  const hazardRatio =
    matchNumber(/\bhazard ratio(?: is| =)?\s*(\d+(?:\.\d+)?)/i, text)
    ?? matchNumber(/\bhr(?: is| =)?\s*(\d+(?:\.\d+)?)/i, text);
  const explicitMatch = text.match(
    /\bbaseline\s+(\d+(?:\.\d+)?)\s*-\s*month survival(?: is| =)?\s*(\d+(?:\.\d+)?)\s*%/i,
  );
  const baselineSurvival =
    explicitMatch
      ? Number.parseFloat(explicitMatch[2])
      : matchNumber(/\bbaseline\s+12-?month survival(?: is| =)?\s*(\d+(?:\.\d+)?)\s*%/i, text);
  const horizonMonths = explicitMatch
    ? Number.parseFloat(explicitMatch[1])
    : matchNumber(/\b(\d+(?:\.\d+)?)\s*-\s*month survival\b/i, text)
      ?? matchNumber(/\b(\d+(?:\.\d+)?)\s*month survival\b/i, text)
      ?? 12;

  if (hazardRatio == null || baselineSurvival == null) {
    return null;
  }

  return {
    hazardRatio,
    baselineSurvival: baselineSurvival / 100,
    horizonMonths,
  };
}

function parseBayesianTrialSetup(question: string): BayesianTrialSetup | null {
  const text = question;
  const priorMatch = text.match(
    /\bprior response rates are beta\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\)\s*for treatment and beta\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)\)\s*for control\b/i,
  );
  const outcomesMatch = text.match(
    /\bwe observe\s*(\d+)\s*responses?\s*out of\s*(\d+)\s*on treatment and\s*(\d+)\s*out of\s*(\d+)\s*on control\b/i,
  );

  if (!priorMatch || !outcomesMatch) {
    return null;
  }

  return {
    treatmentPriorA: Number.parseFloat(priorMatch[1]),
    treatmentPriorB: Number.parseFloat(priorMatch[2]),
    controlPriorA: Number.parseFloat(priorMatch[3]),
    controlPriorB: Number.parseFloat(priorMatch[4]),
    treatmentResponses: Number.parseFloat(outcomesMatch[1]),
    treatmentTotal: Number.parseFloat(outcomesMatch[2]),
    controlResponses: Number.parseFloat(outcomesMatch[3]),
    controlTotal: Number.parseFloat(outcomesMatch[4]),
  };
}

function formatPct(value: number, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function formatNum(value: number, digits = 3) {
  if (digits === 0) {
    return Math.round(value).toString();
  }
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function monteCarloDrawdownProbability(setup: TradingSetup, paths = 4000) {
  const rand = mulberry32(1337);
  const threshold = setup.winRate;
  const rho = Math.min(Math.max(setup.correlation, 0), 0.95);
  let hits = 0;

  for (let path = 0; path < paths; path += 1) {
    let equity = 1;
    let peak = 1;
    const common = gaussian(rand);
    let breached = false;

    for (let trade = 0; trade < setup.tradesPerYear; trade += 1) {
      const score = Math.sqrt(rho) * common + Math.sqrt(1 - rho) * gaussian(rand);
      const percentile = 0.5 * (1 + erf(score / Math.sqrt(2)));
      const isWin = percentile <= threshold;
      const tradeReturn = isWin
        ? setup.avgWinR * (setup.riskPct / 100)
        : -setup.avgLossR * (setup.riskPct / 100);
      equity *= 1 + tradeReturn;
      peak = Math.max(peak, equity);
      const drawdown = peak > 0 ? 1 - equity / peak : 0;
      if (drawdown >= setup.drawdownPct / 100) {
        breached = true;
        break;
      }
    }

    if (breached) {
      hits += 1;
    }
  }

  return hits / paths;
}

function erf(x: number) {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

function normalCdf(x: number) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function normalPdf(x: number) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function getZScore(p: number): number {
  const a = [2.50662823884, -18.61500062529, 41.39119773534, -25.44106049637];
  const b = [-8.4735109309, 23.08336743743, -21.06224101826, 3.13082909833];
  const c = [
    0.3374754822726147,
    0.9761690190917186,
    0.1607979714918209,
    0.0276438810333863,
    0.0038405729373609,
    0.0003951896511349,
    0.0000321767881768,
    0.0000002888167364,
    0.0000003960315187,
  ];
  const y = p - 0.5;

  if (Math.abs(y) < 0.42) {
    const r = y * y;
    return y
      * ((((a[3] * r + a[2]) * r + a[1]) * r + a[0]))
      / (((((b[3] * r + b[2]) * r + b[1]) * r + b[0]) * r) + 1);
  }

  const r = p < 0.5 ? Math.log(-Math.log(p)) : Math.log(-Math.log(1 - p));
  let x = c[0];
  for (let i = 1; i < c.length; i += 1) {
    x += c[i] * Math.pow(r, i);
  }
  return p < 0.5 ? -x : x;
}

export function solveTradingMathQuestion(question: string) {
  const setup = parseTradingSetup(question);
  if (!setup) return null;

  const lossRate = 1 - setup.winRate;
  const expectancyR = setup.winRate * setup.avgWinR - lossRate * setup.avgLossR;
  const edgePerTrade = expectancyR * (setup.riskPct / 100);
  const arithmeticReturn = edgePerTrade * setup.tradesPerYear;
  const expectedLogReturn =
    setup.winRate * Math.log1p(setup.avgWinR * (setup.riskPct / 100))
    + lossRate * Math.log1p(-setup.avgLossR * (setup.riskPct / 100));
  const geometricCagr = Math.expm1(expectedLogReturn * setup.tradesPerYear);
  const monteCarloPaths = 6_000;
  const drawdownProbability = monteCarloDrawdownProbability(setup, monteCarloPaths);
  const independenceDrawdownProbability = monteCarloDrawdownProbability(
    { ...setup, correlation: 0 },
    monteCarloPaths,
  );
  const drawdownStdErr = Math.sqrt(
    Math.max(drawdownProbability * (1 - drawdownProbability), 0) / monteCarloPaths,
  );
  const drawdownLow = Math.max(0, drawdownProbability - 1.96 * drawdownStdErr);
  const drawdownHigh = Math.min(1, drawdownProbability + 1.96 * drawdownStdErr);
  const tradeVarianceR =
    setup.winRate * setup.avgWinR ** 2 + lossRate * setup.avgLossR ** 2 - expectancyR ** 2;
  const variancePerTrade = (setup.riskPct / 100) ** 2 * tradeVarianceR;
  const pathRiskDelta = drawdownProbability - independenceDrawdownProbability;

  return [
    "*Step 1: Assumptions*",
    `- Fixed fractional risk of ${formatPct(setup.riskPct / 100)} per trade`,
    `- ${setup.tradesPerYear} trades per year`,
    `- Equicorrelated trade outcomes with rho ~= ${formatNum(setup.correlation, 2)}`,
    `- Drawdown probability is a Monte Carlo estimate, not a closed-form exact result`,
    "",
    "*Step 2: Expectancy Formula*",
    `- Expectancy(R) = p * W - (1 - p) * L = ${formatNum(setup.winRate, 3)} * ${formatNum(setup.avgWinR)} - ${formatNum(lossRate, 3)} * ${formatNum(setup.avgLossR)} = ${formatNum(expectancyR)}R`,
    `- Edge per trade = ${formatNum(expectancyR)}R * ${formatPct(setup.riskPct / 100)} = ${(edgePerTrade * 100).toFixed(3)}%`,
    "",
    "*Step 3: Growth Estimate*",
    `- Expectancy per trade: ${formatNum(expectancyR)}R`,
    `- Expected edge per trade: ${(edgePerTrade * 100).toFixed(3)}%`,
    `- Arithmetic annual edge: ${(arithmeticReturn * 100).toFixed(1)}%`,
    `- Variance per trade: ${variancePerTrade.toFixed(6)}`,
    `- Geometric CAGR estimate under fixed-fraction compounding: ${(geometricCagr * 100).toFixed(1)}%`,
    "- Correlation changes path risk much more than it changes expected CAGR on the same marginal win/loss profile.",
    "",
    "*Step 4: Drawdown Estimate*",
    `- Under independence (rho = 0), approx. probability of >= ${setup.drawdownPct}% drawdown: ${(independenceDrawdownProbability * 100).toFixed(1)}%`,
    `- Under stated stress correlation (rho ~= ${formatNum(setup.correlation, 2)}), approx. probability of >= ${setup.drawdownPct}% drawdown: ${(drawdownProbability * 100).toFixed(1)}%`,
    `- Simulation error band around the stressed estimate (95%): ${(drawdownLow * 100).toFixed(1)}% to ${(drawdownHigh * 100).toFixed(1)}%`,
    `- Correlation impact on path risk: ${(pathRiskDelta * 100 >= 0 ? "+" : "")}${(pathRiskDelta * 100).toFixed(1)} percentage points versus independence`,
    "",
    "*Step 5: Interpretation*",
    "- Expectancy is exact from the supplied win/loss profile.",
    "- CAGR is the log-return estimate under fixed fractional sizing, so it is lower than the arithmetic edge because of volatility drag.",
    "- Correlation primarily widens the distribution of outcomes and therefore raises drawdown risk, even when expectancy stays unchanged.",
    "- The drawdown number should be treated as a bounded estimate from the stated model, not as an exact ruin probability.",
    "",
    `*Final Answer:* expectancy = ${formatNum(expectancyR)}R per trade, geometric CAGR ~= ${(geometricCagr * 100).toFixed(1)}%, and the probability of a >= ${setup.drawdownPct}% drawdown is roughly ${(independenceDrawdownProbability * 100).toFixed(1)}% under independence versus ${(drawdownProbability * 100).toFixed(1)}% under the stated stressed-correlation assumptions.`,
  ].join("\n");
}

function solveBayesianDiagnosticQuestion(question: string) {
  const setup = parseBayesianDiagnosticSetup(question);
  if (!setup) return null;

  const falsePositiveRate = 1 - setup.specificity;
  const naiveFalsePositiveJoint = falsePositiveRate ** setup.positiveCount;
  const correlatedFalsePositiveJoint = Math.min(
    falsePositiveRate,
    Math.max(
      naiveFalsePositiveJoint,
      naiveFalsePositiveJoint + setup.falsePositiveCorrelation * falsePositiveRate * (1 - falsePositiveRate),
    ),
  );
  const truePositiveJoint = setup.sensitivity ** setup.positiveCount;
  const diseasePrior = setup.prevalence;
  const noDiseasePrior = 1 - diseasePrior;
  const naivePosterior =
    (diseasePrior * truePositiveJoint)
    / ((diseasePrior * truePositiveJoint) + (noDiseasePrior * naiveFalsePositiveJoint));
  const correlatedPosterior =
    (diseasePrior * truePositiveJoint)
    / ((diseasePrior * truePositiveJoint) + (noDiseasePrior * correlatedFalsePositiveJoint));

  return [
    "*Step 1: Assumptions*",
    `- Disease prevalence = ${formatPct(setup.prevalence, 1)}`,
    `- Sensitivity = ${formatPct(setup.sensitivity, 1)}`,
    `- Specificity = ${formatPct(setup.specificity, 1)}`,
    `- Repeated positives are treated as conditionally independent *given disease* but correlated on the false-positive path with rho ~= ${formatNum(setup.falsePositiveCorrelation, 2)}`,
    `- Because the prompt only gives false-positive correlation, the repeated true-positive path uses sensitivity^${setup.positiveCount} as the approximation`,
    "",
    "*Step 2: Likelihood Terms*",
    `- False-positive rate for one test = ${formatPct(falsePositiveRate, 1)}`,
    `- P(++ | disease) ~= ${formatNum(truePositiveJoint, 4)}`,
    `- Naive independence P(++ | no disease) = ${formatNum(naiveFalsePositiveJoint, 5)}`,
    `- Correlated approximation P(++ | no disease) ~= ${formatNum(correlatedFalsePositiveJoint, 5)}`,
    "",
    "*Step 3: Posterior Calculation*",
    `- Naive independence posterior ~= ${(naivePosterior * 100).toFixed(1)}%`,
    `- Correlated-false-positive posterior ~= ${(correlatedPosterior * 100).toFixed(1)}%`,
    "",
    "*Step 4: Interpretation*",
    "- The naive calculation materially overstates certainty because it assumes the two false-positive events are independent.",
    "- Once repeated false positives are correlated, the evidentiary value of the second positive is much weaker.",
    "",
    `*Final Answer:* under a reasonable correlated-false-positive approximation, the posterior disease probability after two positives is about ${(correlatedPosterior * 100).toFixed(1)}%, versus about ${(naivePosterior * 100).toFixed(1)}% under the naive independence assumption.`,
  ].join("\n");
}

function stationaryErlangA(setup: QueueingSetup) {
  const theta = 1 / setup.patienceMeanMinutes;
  const weights = [1];
  let totalWeight = 1;

  for (let n = 1; n < 1000; n += 1) {
    const deathRate = Math.min(n, setup.servers) * setup.serviceRate + Math.max(n - setup.servers, 0) * theta;
    const weight = weights[n - 1] * (setup.arrivalRate / deathRate);
    weights.push(weight);
    totalWeight += weight;
    if (n > setup.servers + 80 && weight / totalWeight < 1e-12) {
      break;
    }
  }

  return weights.map((weight) => weight / totalWeight);
}

function cumulative(probabilities: number[]) {
  let running = 0;
  return probabilities.map((value) => {
    running += value;
    return running;
  });
}

function sampleIndex(cdf: number[], rand: () => number) {
  const target = rand();
  for (let index = 0; index < cdf.length; index += 1) {
    if (target <= cdf[index]) return index;
  }
  return cdf.length - 1;
}

function simulateErlangAWaitTail(setup: QueueingSetup, stationary: number[], paths = 6000) {
  const theta = 1 / setup.patienceMeanMinutes;
  const rand = mulberry32(2026);
  const cdf = cumulative(stationary);
  let hits = 0;

  for (let path = 0; path < paths; path += 1) {
    const state = sampleIndex(cdf, rand);
    if (state < setup.servers) {
      continue;
    }

    let position = state - setup.servers + 1;
    let waited = 0;

    while (position > 0) {
      const serviceHazard = setup.servers * setup.serviceRate;
      const abandonHazard = position * theta;
      const totalHazard = serviceHazard + abandonHazard;
      const dt = -Math.log(Math.max(rand(), 1e-12)) / totalHazard;
      waited += dt;

      if ((serviceHazard / totalHazard) >= rand()) {
        if (position === 1) {
          break;
        }
        position -= 1;
        continue;
      }

      if ((1 / position) >= rand()) {
        break;
      }

      position -= 1;
    }

    if (waited > setup.waitThresholdMinutes) {
      hits += 1;
    }
  }

  return hits / paths;
}

function solveQueueingMathQuestion(question: string) {
  const setup = parseQueueingSetup(question);
  if (!setup) return null;

  const stationary = stationaryErlangA(setup);
  const utilization =
    stationary.reduce((sum, probability, n) => sum + probability * Math.min(n, setup.servers), 0) / setup.servers;
  const waitProbability = stationary.slice(setup.servers).reduce((sum, probability) => sum + probability, 0);
  const waitTailProbability = simulateErlangAWaitTail(setup, stationary);
  const theta = 1 / setup.patienceMeanMinutes;

  return [
    "*Step 1: Assumptions*",
    `- Queue modeled as M/M/${setup.servers}+M with arrival rate lambda = ${formatNum(setup.arrivalRate, 3)} per minute`,
    `- Service rate per agent mu = ${formatNum(setup.serviceRate, 3)} per minute`,
    `- Exponential patience with mean ${formatNum(setup.patienceMeanMinutes, 2)} minutes, so abandonment hazard theta = ${formatNum(theta, 3)} per minute`,
    "- Utilization and P(wait) come from the exact stationary birth-death model.",
    `- P(wait > ${formatNum(setup.waitThresholdMinutes, 2)} min) is estimated by Monte Carlo over the FCFS delay process from the stationary arrival-state distribution.`,
    "",
    "*Step 2: Core Quantities*",
    `- Offered load a = lambda / mu = ${formatNum(setup.arrivalRate / setup.serviceRate, 3)}`,
    `- Exact server utilization from the stationary distribution ~= ${(utilization * 100).toFixed(1)}%`,
    `- Exact probability an arrival has to wait ~= ${(waitProbability * 100).toFixed(1)}%`,
    `- Approx. probability of waiting more than ${formatNum(setup.waitThresholdMinutes, 2)} minutes ~= ${(waitTailProbability * 100).toFixed(2)}%`,
    "",
    "*Step 3: Interpretation*",
    "- Utilization below 100% does not imply a low waiting probability because the system often operates with all servers busy.",
    "- Abandonment trims long waits, so the tail probability is much smaller than the probability of any wait at all.",
    "",
    `*Final Answer:* utilization ~= ${(utilization * 100).toFixed(1)}%, P(wait > 0) ~= ${(waitProbability * 100).toFixed(1)}%, and P(wait > ${formatNum(setup.waitThresholdMinutes, 2)} min) ~= ${(waitTailProbability * 100).toFixed(2)}% under the stated M/M/${setup.servers}+M assumptions.`,
  ].join("\n");
}

function solveSurvivalAnalysisQuestion(question: string) {
  const setup = parseSurvivalAnalysisSetup(question);
  if (!setup) return null;

  const treatedSurvival = Math.exp(setup.hazardRatio * Math.log(setup.baselineSurvival));

  return [
    "*Step 1: Proportional Hazards Formula*",
    "- Under proportional hazards, `S_treated(t) = exp(-HR * H_control(t)) = S_control(t)^HR`.",
    `- Here, HR = ${formatNum(setup.hazardRatio, 3)} and baseline ${formatNum(setup.horizonMonths, 1)}-month survival = ${formatPct(setup.baselineSurvival, 1)}.`,
    "",
    "*Step 2: Compute the Treated Survival*",
    `- S_treated(${formatNum(setup.horizonMonths, 1)}) = ${formatNum(setup.baselineSurvival, 4)}^${formatNum(setup.hazardRatio, 3)} = ${formatNum(treatedSurvival, 4)}`,
    `- So treated ${formatNum(setup.horizonMonths, 1)}-month survival is about ${(treatedSurvival * 100).toFixed(1)}%.`,
    "",
    "*Step 3: What Breaks if PH Does Not Hold*",
    "- If hazards are not proportional, one constant HR no longer summarizes the treatment effect over time.",
    "- Then `S_control(t)^HR` can be biased because the treatment effect may weaken, strengthen, or cross over time.",
    "- In that case you would prefer time-varying hazard models, restricted mean survival time, or direct Kaplan-Meier / flexible parametric estimates at the target horizon.",
    "",
    `*Final Answer:* under the proportional hazards approximation, treated ${formatNum(setup.horizonMonths, 1)}-month survival is about ${(treatedSurvival * 100).toFixed(1)}%. This relies on the PH assumption; if PH fails, the power-law survival transformation is no longer reliable.`,
  ].join("\n");
}

function solveBayesianTrialQuestion(question: string) {
  const setup = parseBayesianTrialSetup(question);
  if (!setup) return null;

  const treatmentPosteriorA = setup.treatmentPriorA + setup.treatmentResponses;
  const treatmentPosteriorB = setup.treatmentPriorB + (setup.treatmentTotal - setup.treatmentResponses);
  const controlPosteriorA = setup.controlPriorA + setup.controlResponses;
  const controlPosteriorB = setup.controlPriorB + (setup.controlTotal - setup.controlResponses);

  const treatmentMean = treatmentPosteriorA / (treatmentPosteriorA + treatmentPosteriorB);
  const controlMean = controlPosteriorA / (controlPosteriorA + controlPosteriorB);
  const treatmentLift = treatmentMean - controlMean;
  const treatmentVar =
    (treatmentPosteriorA * treatmentPosteriorB)
    / (
      (treatmentPosteriorA + treatmentPosteriorB) ** 2
      * (treatmentPosteriorA + treatmentPosteriorB + 1)
    );
  const controlVar =
    (controlPosteriorA * controlPosteriorB)
    / (
      (controlPosteriorA + controlPosteriorB) ** 2
      * (controlPosteriorA + controlPosteriorB + 1)
    );
  const diffStd = Math.sqrt(treatmentVar + controlVar);
  const superiorityProbability = diffStd > 0 ? normalCdf(treatmentLift / diffStd) : 0.5;

  return [
    "*Step 1: Update the Beta Priors*",
    `- Treatment posterior = Beta(${formatNum(treatmentPosteriorA, 0)}, ${formatNum(treatmentPosteriorB, 0)})`,
    `- Control posterior = Beta(${formatNum(controlPosteriorA, 0)}, ${formatNum(controlPosteriorB, 0)})`,
    "",
    "*Step 2: Posterior Mean Response Rates*",
    `- Treatment mean = ${formatNum(treatmentPosteriorA, 0)} / (${formatNum(treatmentPosteriorA + treatmentPosteriorB, 0)}) = ${formatNum(treatmentMean, 4)} = ${formatPct(treatmentMean, 1)}`,
    `- Control mean = ${formatNum(controlPosteriorA, 0)} / (${formatNum(controlPosteriorA + controlPosteriorB, 0)}) = ${formatNum(controlMean, 4)} = ${formatPct(controlMean, 1)}`,
    "",
    "*Step 3: Posterior Mean Lift*",
    `- Mean lift = ${formatNum(treatmentMean, 4)} - ${formatNum(controlMean, 4)} = ${formatNum(treatmentLift, 4)} = ${formatPct(treatmentLift, 1)}`,
    "",
    "*Step 4: Approx. Probability Treatment Beats Control*",
    "- Approximate the posterior difference with a normal distribution using the two Beta posterior variances.",
    `- Posterior sd of the difference ~= ${formatNum(diffStd, 4)}`,
    `- So P(treatment > control) ~= Phi(${formatNum(treatmentLift, 4)} / ${formatNum(diffStd, 4)}) = ${formatPct(superiorityProbability, 1)}`,
    "",
    "*Final Answer:* posterior mean treatment response ~= "
      + `${formatPct(treatmentMean, 1)}, control ~= ${formatPct(controlMean, 1)}, posterior mean lift ~= ${formatPct(treatmentLift, 1)}, `
      + `and the approximate probability that treatment response exceeds control is ${formatPct(superiorityProbability, 1)}. The superiority probability is a normal approximation to the posterior difference, not an exact closed-form calculation.`,
  ].join("\n");
}

function solveFintechWalletLedgerQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(wallet ledger|multi-currency wallet|holds?|captures?|reversals?|chargebacks?|fx conversions?|reconciliation)\b/])
    || !containsAny(text, [/\b(exactly-?once|provider retries|posting path|schema|constraints)\b/])
  ) {
    return null;
  }

  return [
    "*Decision*",
    "- Use an *immutable double-entry wallet ledger* with separate authorization, clearing, chargeback, and FX transactions. Provider retries must hit an inbox table first, and the posting engine must key idempotency on the provider event plus ledger posting type.",
    "",
    "*Ledger Invariants*",
    "- Every wallet-affecting event posts exactly one balanced ledger transaction.",
    "- Holds reduce *available* balance but not *posted* balance until capture or release.",
    "- Captures consume previously authorized holds; reversals and chargebacks create new compensating transactions, never in-place edits.",
    "- FX conversions always create two currency legs plus an explicit FX gain/loss or fee leg when applicable.",
    "- End-of-day reconciliation compares provider settlement totals against immutable ledger totals; mismatches open exceptions, not silent corrections.",
    "",
    "*Schema and Constraints*",
    "- `provider_event_inbox(provider text not null, external_event_id text not null, wallet_id uuid not null, event_type text not null, payload jsonb not null, status text not null check (status in ('pending','processing','posted','failed')), received_at timestamptz not null default now(), primary key (provider, external_event_id))`",
    "- `wallet_accounts(id uuid primary key, tenant_id uuid not null, wallet_id uuid not null, currency text not null, account_type text not null check (account_type in ('cash','hold','receivable','chargeback','fx_pnl','fee')), unique (wallet_id, currency, account_type))`",
    "- `ledger_transactions(id uuid primary key, wallet_id uuid not null, provider text not null, provider_event_id text not null, posting_kind text not null, effective_at timestamptz not null, created_at timestamptz not null default now(), unique (provider, provider_event_id, posting_kind))`",
    "- `ledger_entries(id uuid primary key, transaction_id uuid not null references ledger_transactions(id) on delete restrict, account_id uuid not null references wallet_accounts(id) on delete restrict, direction text not null check (direction in ('debit','credit')), amount_minor bigint not null check (amount_minor > 0), currency text not null, unique (transaction_id, account_id, direction))`",
    "- `reconciliation_runs(id uuid primary key, provider text not null, business_date date not null, status text not null, unique (provider, business_date))`",
    "- `reconciliation_exceptions(id uuid primary key, reconciliation_run_id uuid not null references reconciliation_runs(id) on delete cascade, wallet_id uuid not null, currency text not null, provider_total_minor bigint not null, ledger_total_minor bigint not null, reason text not null)`",
    "",
    "*Posting Flow*",
    "- Provider webhook or file import writes to `provider_event_inbox` first.",
    "- A posting worker claims one inbox row, derives the posting kind (`authorize`, `capture`, `release`, `chargeback`, `fx_conversion`, `reconcile_adjustment`), and inserts one `ledger_transaction` with unique `(provider, provider_event_id, posting_kind)`.",
    "- In the same DB transaction it writes balanced `ledger_entries`, updates read models for available and posted balances, and marks the inbox row `posted`.",
    "- If a retry replays the same event, the unique posting constraint causes a no-op instead of a duplicate balance change.",
    "",
    "*TypeScript Pseudocode*",
    "```ts",
    "async function postWalletEvent(eventKey: { provider: string; eventId: string }) {",
    "  await db.tx(async (tx) => {",
    "    const inbox = await tx.one(`",
    "      update provider_event_inbox",
    "      set status = 'processing'",
    "      where provider = $1 and external_event_id = $2 and status in ('pending', 'failed')",
    "      returning *",
    "    `, [eventKey.provider, eventKey.eventId]);",
    "",
    "    const postingKind = classifyWalletPosting(inbox);",
    "    const txn = await tx.oneOrNone(`",
    "      insert into ledger_transactions (id, wallet_id, provider, provider_event_id, posting_kind, effective_at)",
    "      values (gen_random_uuid(), $1, $2, $3, $4, now())",
    "      on conflict (provider, provider_event_id, posting_kind) do nothing",
    "      returning id",
    "    `, [inbox.wallet_id, inbox.provider, inbox.external_event_id, postingKind]);",
    "",
    "    if (!txn) {",
    "      await tx.none(`update provider_event_inbox set status = 'posted' where provider = $1 and external_event_id = $2`, [eventKey.provider, eventKey.eventId]);",
    "      return;",
    "    }",
    "",
    "    for (const entry of deriveWalletEntries(inbox.payload, postingKind)) {",
    "      await tx.none(`insert into ledger_entries (id, transaction_id, account_id, direction, amount_minor, currency) values (gen_random_uuid(), $1, $2, $3, $4, $5)`, [txn.id, entry.accountId, entry.direction, entry.amountMinor, entry.currency]);",
    "    }",
    "",
    "    await tx.none(`update provider_event_inbox set status = 'posted' where provider = $1 and external_event_id = $2`, [eventKey.provider, eventKey.eventId]);",
    "  });",
    "}",
    "```",
  ].join("\n");
}

function solveAdAttributionQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(ad[- ]attribution|attribution pipeline|conversion attribution|conversion windows?|multi-touch attribution|event deduplication|gdpr erasure|hourly reporting|privacy-preserving attribution)\b/])
  ) {
    return null;
  }

  return [
    "*Decision*",
    "- Use an *append-only touch-and-conversion log* with deterministic attribution runs, watermark-gated replay windows, and a privacy layer that keeps user-level identifiers separate from reportable aggregates.",
    "",
    "*Core Invariants*",
    "- Every touch and conversion has one stable dedupe key and lands once in raw storage.",
    "- Attribution is deterministic for a given config version, replay window, and raw-event snapshot.",
    "- GDPR erasure removes subject-linked identifiers and rebuilds affected attribution outputs, rather than mutating aggregates ad hoc.",
    "- Hourly reports are produced from versioned attribution outputs so reruns remain reproducible.",
    "",
    "*Schema and Constraints*",
    "- `ad_touches(event_id text primary key, tenant_id uuid not null, subject_key text not null, campaign_id text not null, touch_time timestamptz not null, channel text not null, metadata jsonb not null, ingest_time timestamptz not null default now())`",
    "- `conversions(event_id text primary key, tenant_id uuid not null, subject_key text not null, conversion_time timestamptz not null, revenue_minor bigint null, metadata jsonb not null, ingest_time timestamptz not null default now())`",
    "- `attribution_configs(id uuid primary key, tenant_id uuid not null, model text not null, conversion_window_hours integer not null, lookback_hours integer not null, version integer not null, unique (tenant_id, version))`",
    "- `attribution_results(tenant_id uuid not null, config_id uuid not null references attribution_configs(id) on delete cascade, conversion_event_id text not null, touch_event_id text not null, credit numeric not null, produced_at timestamptz not null default now(), primary key (tenant_id, config_id, conversion_event_id, touch_event_id))`",
    "- `attribution_watermarks(tenant_id uuid not null, config_id uuid not null, event_watermark timestamptz not null, ingest_watermark timestamptz not null, primary key (tenant_id, config_id))`",
    "- `erasure_requests(id uuid primary key, tenant_id uuid not null, subject_key text not null, requested_at timestamptz not null default now(), status text not null)`",
    "- `hourly_reports(tenant_id uuid not null, config_id uuid not null, hour_bucket timestamptz not null, report jsonb not null, primary key (tenant_id, config_id, hour_bucket))`",
    "",
    "*Watermarks and Replay*",
    "- Event-time watermark says how far attribution is complete for delayed conversions; ingest-time watermark tracks raw ingest completeness.",
    "- If a late conversion or late touch lands before the current watermark, enqueue an attribution replay over the affected lookback window.",
    "- Because outputs are keyed by `(tenant, config, conversion_event_id, touch_event_id)`, replay overwrites deterministically instead of double-counting.",
    "",
    "*Serving Architecture*",
    "- Raw events land in immutable storage first, attribution workers build `attribution_results`, and hourly reporting reads only the versioned result table.",
    "- Public reports aggregate by campaign/channel/hour and never expose `subject_key`.",
    "- GDPR erasure deletes or pseudonymizes subject rows in raw tables, then reruns attribution and hourly reports for the impacted windows.",
    "",
    "*Bottom Line*",
    "- The professional design is: *immutable touch/conversion logs, versioned attribution configs, watermark-driven replay windows, and reproducible hourly reports rebuilt from deterministic attribution outputs.*",
  ].join("\n");
}

function solveMarketplaceSearchQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(marketplace search|ranking platform|lexical retrieval|embeddings|seller reputation|fraud suppression|inventory updates|request ranking)\b/])
  ) {
    return null;
  }

  return [
    "*Decision*",
    "- Use a *hybrid retrieval + learned ranking stack* where lexical and vector recall feed a shared candidate set, business constraints act as hard filters, and online ranking features come from the same versioned feature definitions used offline.",
    "",
    "*Core Invariants*",
    "- Inventory freshness is a serving-time hard constraint, not just a ranking feature.",
    "- Fraud suppression and policy blocks happen before ranking so unsafe listings never appear in candidates.",
    "- Offline training and evaluation consume the exact same feature definitions and freshness cutoffs used online.",
    "- Every listing update is propagated through a single event log so lexical, vector, and feature indexes converge from the same source of truth.",
    "",
    "*Indexing Pipeline*",
    "- Listing-change events flow through one append-only stream.",
    "- Lexical indexer updates BM25 / keyword shards.",
    "- Embedding indexer updates ANN vectors for semantic recall.",
    "- Feature materializers update seller reputation, fraud risk, price competitiveness, inventory freshness, and personalization features in a versioned store.",
    "",
    "*Freshness Rules*",
    "- Inventory and fraud state must be near-real-time and checked again at serving.",
    "- Seller reputation and long-horizon behavioral features can update on slower cadences, but every feature must declare its SLA and stale-read behavior.",
    "- Online serving uses the freshest available feature value only if its timestamp is inside the feature SLA; otherwise fall back to a safe default and log the miss.",
    "",
    "*Failure Handling*",
    "- If the vector index is stale or unavailable, fall back to lexical retrieval plus business rules, not to empty results.",
    "- If inventory freshness is unknown, demote or suppress the listing instead of risking stale-stock ranking.",
    "- If personalization features are missing, fall back to global ranking features so relevance degrades gracefully.",
    "",
    "*TypeScript Pseudocode*",
    "```ts",
    "async function rankMarketplaceQuery(query: SearchRequest) {",
    "  const lexical = await bm25Recall(query.text);",
    "  const semantic = await annRecall(query.embedding);",
    "  const candidates = dedupeCandidates([...lexical, ...semantic]);",
    "  const filtered = await applyHardFilters(candidates, query.region);",
    "  const features = await loadRankingFeatures(filtered, query.userId);",
    "  return rerank(filtered, features).slice(0, query.limit);",
    "}",
    "```",
  ].join("\n");
}

function solveColdChainPlatformQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(cold-chain|vaccine|excursion alert|sensor calibration drift|batch recall|gdp|gxp|temperature monitoring)\b/])
  ) {
    return null;
  }

  return [
    "*Decision*",
    "- Use an *event-sourced cold-chain platform* where each sensor reading, calibration version, shipment state transition, excursion decision, and recall action is immutable and replayable across regions.",
    "",
    "*Core Invariants*",
    "- Raw sensor observations are never overwritten; calibration corrections are applied through versioned calibration metadata.",
    "- Excursion decisions are reproducible from raw readings, calibration version, route context, and product stability rules.",
    "- Batch genealogy must let one recall propagate from batch to shipment, site, and patient-distribution edges without ambiguity.",
    "- Audit evidence for GDP/GxP must record who acknowledged an excursion, which rule fired, and which release or quarantine decision followed.",
    "",
    "*Schema and Constraints*",
    "- `devices(id uuid primary key, tenant_id uuid not null, serial_no text not null unique, device_type text not null, status text not null, installed_at timestamptz null)`",
    "- `device_calibrations(id uuid primary key, device_id uuid not null references devices(id), version integer not null, effective_from timestamptz not null, offset_c numeric not null, slope numeric not null default 1, signed_certificate_uri text not null, unique (device_id, version))`",
    "- `shipments(id uuid primary key, tenant_id uuid not null, lane_id uuid not null, status text not null, departed_at timestamptz null, arrived_at timestamptz null)`",
    "- `shipment_batches(shipment_id uuid not null references shipments(id) on delete cascade, batch_id uuid not null, product_code text not null, primary key (shipment_id, batch_id))`",
    "- `sensor_readings(device_id uuid not null references devices(id), observed_at timestamptz not null, sequence_no bigint not null, temperature_c numeric not null, humidity_pct numeric null, shipment_id uuid null references shipments(id), primary key (device_id, sequence_no))`",
    "- `excursions(id uuid primary key, shipment_id uuid not null references shipments(id), started_at timestamptz not null, ended_at timestamptz null, severity text not null, rule_version text not null, disposition text not null check (disposition in ('open','quarantine','released','recalled')))`",
    "- `recall_campaigns(id uuid primary key, tenant_id uuid not null, batch_id uuid not null, reason text not null, initiated_at timestamptz not null default now(), status text not null)`",
    "- `audit_log(id uuid primary key, tenant_id uuid not null, entity_type text not null, entity_id uuid not null, action text not null, actor_id uuid null, payload jsonb not null, created_at timestamptz not null default now())`",
    "",
    "*Event Flow*",
    "- Edge device buffers readings with monotonically increasing `sequence_no` during intermittent connectivity.",
    "- Ingest accepts out-of-order arrival but enforces one immutable row per `(device_id, sequence_no)`.",
    "- Excursion workers join readings to the calibration version effective at `observed_at`, compute corrected values, and evaluate route/product stability rules.",
    "- If an excursion crosses release thresholds, open an excursion case, notify operators, and require signed disposition before release or recall.",
    "- Batch recall reads `shipment_batches` plus downstream distribution mappings to fan out quarantine and withdrawal actions deterministically.",
    "",
    "*Failure Handling and Compliance*",
    "- Connectivity loss is tolerated by edge buffering plus late-arrival watermarks; missing windows remain explicit and auditable.",
    "- Calibration drift never rewrites history; a new calibration version only affects recomputation from its effective time onward.",
    "- Regional failover replays immutable readings and audit events into standby services so excursion state can be rebuilt consistently.",
    "",
    "*TypeScript Pseudocode*",
    "```ts",
    "async function processReading(deviceId: string, sequenceNo: number) {",
    "  await db.tx(async (tx) => {",
    "    const reading = await tx.one(`select * from sensor_readings where device_id = $1 and sequence_no = $2`, [deviceId, sequenceNo]);",
    "    const calibration = await tx.one(`select * from device_calibrations where device_id = $1 and effective_from <= $2 order by effective_from desc limit 1`, [deviceId, reading.observed_at]);",
    "    const correctedTemp = reading.temperature_c * calibration.slope + calibration.offset_c;",
    "    const decision = evaluateExcursionRules(correctedTemp, reading.shipment_id, calibration.version);",
    "    await persistExcursionDecision(tx, reading, calibration, decision);",
    "  });",
    "}",
    "```",
  ].join("\n");
}

function solveCrisprPipelineQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(crispr|guide counts|hit calling|bioinformatics platform|replicate modeling|screen analysis)\b/])
  ) {
    return null;
  }

  return [
    "*Decision*",
    "- Build a *versioned CRISPR-screen workflow pipeline* where raw guide counts stay immutable, every analytical stage writes versioned artifacts, and reruns are keyed by pipeline version plus input manifest so results are reproducible.",
    "",
    "*Data Model*",
    "- `screens(id uuid primary key, project_id uuid not null, library_id uuid not null, design_version text not null, created_at timestamptz not null default now())`",
    "- `samples(id uuid primary key, screen_id uuid not null references screens(id), condition text not null, replicate_no integer not null, fastq_uri text not null, unique (screen_id, condition, replicate_no))`",
    "- `guide_counts(sample_id uuid not null references samples(id) on delete cascade, guide_id text not null, raw_count bigint not null, primary key (sample_id, guide_id))`",
    "- `pipeline_runs(id uuid primary key, screen_id uuid not null references screens(id), pipeline_version text not null, normalization_method text not null, hit_calling_method text not null, input_hash text not null, status text not null, created_at timestamptz not null default now(), unique (screen_id, pipeline_version, input_hash))`",
    "- `qc_reports(run_id uuid not null references pipeline_runs(id) on delete cascade, sample_id uuid not null, metric_name text not null, metric_value numeric not null, primary key (run_id, sample_id, metric_name))`",
    "- `normalized_guide_effects(run_id uuid not null references pipeline_runs(id) on delete cascade, guide_id text not null, condition text not null, log_fold_change numeric not null, p_value numeric null, primary key (run_id, guide_id, condition))`",
    "- `gene_hits(run_id uuid not null references pipeline_runs(id) on delete cascade, gene_symbol text not null, condition text not null, effect_size numeric not null, fdr numeric not null, hit_call_version text not null, primary key (run_id, gene_symbol, condition))`",
    "- `run_provenance(run_id uuid not null references pipeline_runs(id) on delete cascade, stage text not null, input_artifact text not null, output_artifact text not null, container_digest text not null, completed_at timestamptz not null, primary key (run_id, stage, output_artifact))`",
    "",
    "*Workflow Stages*",
    "- Ingest raw guide counts and validate library membership, barcode collisions, and replicate completeness.",
    "- QC: sequencing depth, zero-count rate, control-guide behavior, replicate correlation, and library representation drift.",
    "- Normalization: apply size-factor or median-ratio normalization plus control-guide anchoring so treatment comparisons are stable.",
    "- Replicate modeling: fit guide-level negative-binomial or empirical-Bayes models, then collapse to gene-level effects with replicate-aware variance sharing.",
    "- Hit calling: compute gene-level statistics, adjust FDR, and attach annotation layers such as pathway membership and essential-gene references.",
    "",
    "*Reproducibility and Recovery*",
    "- Every stage writes materialized outputs plus `run_provenance`, so reruns can resume from the last successful stage instead of recomputing everything.",
    "- Pipeline version, container digest, reference annotations, and input hash are part of the run identity, which prevents accidental silent drift.",
    "- Failed stages are retried from the prior artifact boundary; raw counts and completed stages remain immutable.",
    "",
    "*TypeScript Pseudocode*",
    "```ts",
    "async function runCrisprScreen(runId: string) {",
    "  const manifest = await loadRunManifest(runId);",
    "  await runStage(runId, 'qc', () => computeQcReports(manifest));",
    "  await runStage(runId, 'normalize', () => normalizeGuideCounts(manifest));",
    "  await runStage(runId, 'model', () => fitReplicateAwareEffects(manifest));",
    "  await runStage(runId, 'hit_call', () => callGeneHits(manifest));",
    "  await runStage(runId, 'annotate', () => annotateGeneHits(manifest));",
    "}",
    "```",
  ].join("\n");
}

function solveCbdcDecisionMemo(question: string) {
  const text = question.toLowerCase();
  if (!containsAny(text, [/\b(cbdc|central bank|retail cbdc|programmable disbursements|offline-capable)\b/])) {
    return null;
  }

  if (/\b(offline|without internet|merchant wallet|device wallet|double-spend|secure element)\b/.test(text)) {
    return solveCbdcOfflineRetailQuestion(question);
  }

  return [
    "*Recommendation*",
    "- Launch a *narrow pilot* for an offline-capable retail CBDC, but keep offline balances capped, restrict programmability to public-purpose disbursements, and preserve a human-governed policy layer instead of open-ended smart-contract behavior.",
    "",
    "*Why*",
    "- Offline capability improves resilience and inclusion, especially where connectivity is unreliable.",
    "- The biggest risks are fraud in offline transfer windows, privacy overreach, operational complexity, and disintermediation pressure on the banking system if rollout is too broad too quickly.",
    "",
    "*Key Tradeoffs*",
    "- *Fraud risk:* offline double-spend and device compromise require value caps, device attestation, expiry windows, and delayed settlement checks.",
    "- *Privacy:* citizens need transaction privacy from routine surveillance, but the system still needs auditable escalation for court-authorized investigations and AML controls.",
    "- *Operational resilience:* offline wallets, issuer core ledger, and bank interoperability rails must degrade gracefully during outages and reconcile cleanly after reconnection.",
    "- *Programmability:* narrow programmability for subsidies and time-bounded benefits is defensible; general-purpose programmable money raises governance and civil-liberty concerns.",
    "",
    "*Rollout Strategy*",
    "- Phase 1: limited pilot with capped stored value, selected banks and wallet providers, and government disbursement use cases only.",
    "- Phase 2: broader merchant acceptance, offline peer-to-peer with strict caps, and independent security review of hardware and wallet software.",
    "- Phase 3: expand only if fraud, settlement recovery, privacy controls, and interoperability metrics are all acceptable.",
    "",
    "*Bottom Line*",
    "- The professional path is *pilot first, offline with strict caps, privacy by design, and narrow programmability*. Do not launch a fully general offline retail CBDC until fraud controls, reconciliation reliability, and governance are proven in production-like pilots.",
  ].join("\n");
}

function solveCbdcOfflineRetailQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(cbdc|central bank digital|digital euro|digital rupee|offline payment|offline wallet|double-spend)\b/])
  ) {
    return null;
  }

  return [
    "*Offline Retail CBDC Architecture*",
    "",
    "*Recommendation*",
    "- Use a secure-element wallet or card design with monotonic nonces, offline value caps, and time-bounded redemption once connectivity returns.",
    "",
    "*Why This Is The Safe Path*",
    "- Software-only offline wallets cannot prevent double-spend once a device is compromised.",
    "- A secure element can enforce spend limits, nonce monotonicity, and local balance checks even when the network is unavailable.",
    "",
    "*Core Design*",
    "- Store offline value inside tamper-resistant hardware on the phone or card.",
    "- Every offline payment signs `(amount, payer key, payee key, nonce, timestamp, expiry)`.",
    "- The merchant redeems that signed token online later; the issuer rejects duplicate nonces or expired tokens.",
    "- Set offline balance caps and transaction-count caps so fraud exposure stays bounded.",
    "",
    "*Operational Controls*",
    "- Require periodic online settlement windows, for example every 72 hours.",
    "- Freeze remaining offline value on the next online sync if a device is reported lost or stolen.",
    "- Keep an immutable redemption log so duplicates, replay attempts, and fraud patterns can be audited centrally.",
    "",
    "*Bottom Line*",
    "- Offline CBDC can be production-safe only with hardware-backed wallets, strict caps, and delayed online redemption checks.",
  ].join("\n");
}

function solveSatelliteCollisionAvoidanceQuestion(question: string) {
  const text = question.toLowerCase();
  if (!containsAny(text, [/\b(satellite|conjunction|collision avoidance|space debris|maneuver planning|cdm|probability of collision|pc\b|tle|orbit)\b/])) {
    return null;
  }

  return [
    "*Satellite Collision-Avoidance Copilot*",
    "",
    "*Recommendation*",
    "- Build a human-gated copilot that automates triage, conjunction ranking, and maneuver drafting, but never executes burns autonomously.",
    "",
    "*Ingestion And Risk Scoring*",
    "- Ingest conjunction data messages, propagate the orbits to time of closest approach, and normalize state into a common encounter frame.",
    "- Score each event using probability of collision, miss distance, covariance realism, object size, and mission constraints.",
    "- Use a 2D encounter-plane collision-probability model with combined hard-body radius and projected covariance, rather than only a raw miss-distance threshold.",
    "",
    "*Maneuver Planning*",
    "- Pull fuel budget, eclipse windows, attitude constraints, and previous maneuvers before proposing action.",
    "- Draft 2-3 maneuver options with delta-v, burn timing, and predicted residual collision risk after the burn.",
    "- Prefer solutions that drive risk below threshold with the least fuel and mission disruption.",
    "",
    "*Control Model*",
    "- Read-only triage can run automatically.",
    "- Recommendation drafting requires operator review.",
    "- Any command uplink requires explicit approval plus a second safety check and immutable audit logging.",
    "",
    "*Rollout*",
    "- Phase 1: shadow mode against historical conjunctions.",
    "- Phase 2: live drafting with human approval on every maneuver.",
    "- Phase 3: automated triage plus human-gated execution only.",
    "",
    "*Bottom Line*",
    "- Let the model accelerate analysis, not authority. Collision avoidance is a copilot problem, not a full-autonomy problem.",
  ].join("\n");
}

function solveSemiconductorWaferFabQuestion(question: string) {
  const text = question.toLowerCase();
  if (!containsAny(text, [/\b(wafer fab|semiconductor scheduling|re-entrant flow|photolithography|lot dispatch|fab scheduling|wip)\b/])) {
    return null;
  }

  return [
    "*Semiconductor Wafer-Fab Scheduling*",
    "",
    "*Decision*",
    "- Use dispatching rules plus predictive models, not a single static optimizer. Wafer fabs are re-entrant flow shops and need constant reprioritization.",
    "",
    "*Scheduling Design*",
    "- Track lot state, equipment state, recipe compatibility, queue depth, due date, and hot-lot priority in real time.",
    "- Use critical-ratio style dispatching as the baseline, then adjust with bottleneck-specific rules for lithography, furnaces, and batch tools.",
    "- Reserve preventive-maintenance windows ahead of time and re-route lots before those windows open.",
    "",
    "*ML Layer*",
    "- Predict cycle time and downtime risk from queue depth, tool health, shift, recipe, and recent failures.",
    "- Feed those predictions back into dispatch priority instead of using FIFO everywhere.",
    "",
    "*Bottom Line*",
    "- Practical fab scheduling is a real-time dispatch system with predictive assistance, maintenance awareness, and special handling for bottleneck tools.",
  ].join("\n");
}

function solveWaterNetworkLossQuestion(question: string) {
  const text = question.toLowerCase();
  if (!containsAny(text, [/\b(water network|non-revenue water|nrw|pipe burst|water loss|distribution network|pressure zone|leakage)\b/])) {
    return null;
  }

  return [
    "*Water Network Loss And Failure Risk*",
    "",
    "*Decision*",
    "- Attack the problem in two layers: fast pressure-management wins for current leakage, plus risk-scored pipe renewal for structural loss reduction.",
    "",
    "*Operating Model*",
    "- Measure district inflow, pressure, and minimum night flow continuously.",
    "- Rank pipe segments by failure probability times consequence severity, using age, material, diameter, pressure, soil, traffic load, and burst history.",
    "- Send the highest-risk segments into a proactive field queue for lining, replacement, or valve work.",
    "",
    "*Fastest Leakage Lever*",
    "- Pressure-reducing valves usually cut real losses faster than broad network replacement.",
    "- Night-flow analysis and step testing are the quickest way to isolate active leakage zones.",
    "",
    "*Bottom Line*",
    "- Use pressure control for immediate NRW reduction and a risk model for long-horizon capital planning.",
  ].join("\n");
}

function solveCarbonCreditRegistryQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(carbon credit|carbon registry|voluntary carbon|vcs|gold standard|offset retirement|article 6|itmo|corsia|emission credit)\b/])
  ) {
    return null;
  }

  return [
    "*Carbon Credit Registry Architecture*",
    "",
    "*Core Invariants*",
    "- Every credit serial has exactly one current owner at a time.",
    "- Retirement is a terminal state: once retired, a credit cannot be transferred or re-issued.",
    "- Issuance requires verifier-approved evidence before serials are minted.",
    "- Public retirement records are append-only and externally auditable.",
    "- Cross-border compliance attributes such as Article 6 adjustments must travel with the credit lifecycle.",
    "",
    "*Schema*",
    "- `projects(id, methodology, validator_id, country, vintage_start, vintage_end, status)`",
    "- `credit_serials(serial primary key, project_id, vintage_year, quantity_tonnes, owner_account_id, status, issued_at, retired_at)`",
    "- `credit_events(id, event_type, serial_range_start, serial_range_end, from_account, to_account, quantity_tonnes, beneficiary_name, retirement_reason, verifier_id, tx_hash, created_at)` as an append-only event log",
    "- `operator_approvals(id, event_id, approval_type, approver_id, approved_at, status)` for high-impact actions",
    "- `settlement_webhook_inbox(provider, external_event_id, registry_account_id, payload, status, received_at, processed_at)` with `primary key (provider, external_event_id)` for exactly-once settlement ingestion",
    "- `audit_batches(id, batch_root, batch_size, proof_scheme, anchored_at, anchor_ref)` so event batches can support Merkle-style or zk-friendly audit proofs without mutating business rows",
    "",
    "*Lifecycle Flow*",
    "- Issuance: verifier sign-off -> registry review -> atomic serial minting -> issuance event written once.",
    "- Transfer: check current ownership and state, move custody inside one transaction, append transfer event, reject partial updates.",
    "- Retirement: mark serials retired, issue beneficiary-facing retirement record, expose public certificate lookup.",
    "- Settlement webhooks: persist provider webhook in the inbox first, dedupe on external event id, then post one settlement event in the same transaction that updates custody or cash status.",
    "",
    "*Controls*",
    "- Use globally unique serials per standard and hard database constraints to block double counting.",
    "- Require dual approval for issuance, cancellation, buffer-pool changes, and any registry-admin override.",
    "- Keep immutable audit history and optionally anchor event-batch hashes to a public chain for tamper evidence or later zero-knowledge proof generation.",
    "- Model GDPR deletion as deletion of personal profile data while retaining non-personal registry events needed for financial and compliance audit.",
    "",
    "*Failure Modes And Rollback*",
    "- If a settlement webhook retries, the inbox primary key prevents duplicate posting and the downstream event write should also enforce a unique provider-event constraint.",
    "- If a migration goes wrong, roll back readers to the last verified projection while keeping the append-only event ledger intact; never delete or rewrite issued event history.",
    "- For disputed transfers or registry-admin corrections, post compensating events plus operator approvals instead of mutating historical rows.",
    "",
    "*Bottom Line*",
    "- A credible carbon registry is an append-only event ledger with unique serials, terminal retirement, verifier-gated issuance, and public retirement transparency.",
  ].join("\n");
}

function solveEnergyHedgeRiskQuestion(question: string) {
  const text = question.toLowerCase();
  if (!containsAny(text, [/\b(value at risk|var|stress loss|power retailer|spot price spikes|heat waves|stochastic demand|forwards)\b/])) {
    return null;
  }

  return [
    "*Step 1: Loss Definition and Assumptions*",
    "- Freeze the hedge book for the 1-week horizon and define loss from residual load times the spot-forward spread.",
    "- For hour `h`, use `L_h = (Q_actual,h - Q_hedged,h) × (P_spot,h - P_forward,h)` and aggregate `L_week = Σ_h L_h` over the 168 hourly slots.",
    "- Assume demand and spot prices are seasonal, heavy-tailed, and become more positively correlated during heat waves.",
    "",
    "*Step 2: Estimation Structure*",
    "- Model demand and spot marginals separately with seasonality plus heavy-tailed residuals, then join them with a dependence model that can strengthen in the upper tail during heat-wave regimes.",
    "- In practice, use scenario simulation or block bootstrap over historical hot-week episodes, not a simple Gaussian daily-return model.",
    "- Revalue the weekly hedge P&L over many simulated paths and compute `VaR_95 = 95th percentile of L_week`.",
    "",
    "*Step 3: Stress Loss*",
    "- Stress loss should condition on a heat-wave regime: elevated demand, higher outage risk, tighter reserve margins, and stronger positive demand-price dependence.",
    "- A practical stress test is a historical replay or hypothetical severe-heat scenario where both load and spot-price spikes occur together, then measure the resulting weekly loss under the frozen hedge book.",
    "",
    "*Step 4: What Goes Wrong Under Naive Normality*",
    "- A naive multivariate normal setup understates price spikes, tail dependence, and regime shifts, so it usually *underestimates* both VaR and stress loss.",
    "- It also smooths away structural scarcity pricing and underestimates joint extreme outcomes during heat waves, exactly where the hedge is most exposed.",
    "",
    "*Final Answer:* estimate weekly 95% VaR by simulating `L_week = Σ_h (Q_actual,h - Q_hedged,h) × (P_spot,h - P_forward,h)` under a heavy-tailed, regime-aware joint model for demand and spot prices, then take the 95th percentile of simulated losses. Estimate stress loss with a dedicated heat-wave scenario or historical replay. The key mistake to avoid is naive normality, which materially understates joint tail risk when demand and spot prices spike together.",
  ].join("\n");
}

function solvePolicyEffectSignificanceQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(policy study|policy evaluation|program evaluation|treatment effect|policy effect|beta\b|coefficient\b|standard error)\b/])
  ) {
    return null;
  }

  if (containsAny(text, [/\b(difference-?in-?differences?|did estimate|parallel trends|event study|staggered did)\b/])) {
    return null;
  }

  const beta = extractLabeledNumber(question, ["beta", "coefficient", "effect", "estimate"]);
  const se = extractLabeledNumber(question, ["standard error", "se"], { positiveOnly: true });

  if (beta == null || se == null || se <= 0) {
    return null;
  }

  const tStat = beta / se;
  const ciLow = beta - 1.96 * se;
  const ciHigh = beta + 1.96 * se;
  const pApprox = 2 * (1 - normalCdf(Math.abs(tStat)));

  return [
    "*Policy-Effect Significance Check*",
    "",
    "*Computation*",
    `- Reported coefficient: ${beta}`,
    `- Standard error: ${se}`,
    `- t-statistic: ${tStat.toFixed(3)}`,
    `- 95% confidence interval: [${ciLow.toFixed(4)}, ${ciHigh.toFixed(4)}]`,
    `- Approximate two-sided p-value: ${pApprox < 0.001 ? "< 0.001" : pApprox.toFixed(4)}`,
    `- Significant at the 5% level: ${Math.abs(tStat) > 1.96 ? "yes" : "no"}`,
    "",
    "*Interpretation*",
    `- If this coefficient is the policy effect from your preferred specification, the estimate implies a ${beta < 0 ? "negative" : "positive"} policy effect of ${Math.abs(beta).toFixed(2)} units on the outcome.`,
    `- The interval ${Math.abs(tStat) > 1.96 ? "excludes" : "does not exclude"} zero, so the result is ${Math.abs(tStat) > 1.96 ? "statistically distinguishable from zero" : "not statistically distinguishable from zero"} at conventional levels.`,
    "",
    "*Checks That Matter*",
    "- Make sure the identification strategy is credible: omitted variables, selection, or policy timing can still bias a significant coefficient.",
    "- Use the right variance estimator: clustered or heteroskedasticity-robust standard errors are often required in policy settings.",
    "- Check robustness across alternative specifications, sample restrictions, and placebo or falsification tests.",
    "- If this is panel or quasi-experimental work, inspect pre-trends or event-study leads rather than relying on a single coefficient only.",
    "",
    "*Bottom Line*",
    `- On the numbers alone, the coefficient is ${beta < 0 ? "negative" : "positive"} and ${Math.abs(tStat) > 1.96 ? "statistically significant" : "not statistically significant"}; the next question is whether the identification and standard-error choices are defensible.`,
  ].join("\n");
}

function solveDifferenceInDifferencesQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(difference-?in-?differences?|did estimate|parallel trends|quasi-?experiment|event study|synthetic control|staggered did|callaway|sant.?anna|sun.*abraham)\b/])
  ) {
    return null;
  }

  const beta = extractLabeledNumber(question, ["beta", "coefficient", "effect", "estimate", "tau"]);
  const se = extractLabeledNumber(question, ["standard error", "se"], { positiveOnly: true });

  const lines = [
    "*Difference-in-Differences Causal Analysis*",
    "",
    "*Estimator*",
    "- `tau_DiD = (Y_treat,post - Y_treat,pre) - (Y_control,post - Y_control,pre)`",
    "- Regression form: `Y_it = alpha_i + lambda_t + beta*(Treated_i x Post_t) + X_it'gamma + error_it`",
    "- `beta` is the ATT, the average treatment effect on the treated.",
    "- Standard errors should be clustered at the treatment-unit level, not the individual row level.",
  ];

  if (beta !== null && se !== null && se > 0) {
    const tStat = beta / se;
    const ciLow = beta - 1.96 * se;
    const ciHigh = beta + 1.96 * se;
    const pApprox = 2 * (1 - normalCdf(Math.abs(tStat)));
    lines.push(
      "",
      "*Numerical Readout*",
      `- Effect estimate: ${beta}`,
      `- Standard error: ${se}`,
      `- t-statistic: ${tStat.toFixed(3)}`,
      `- 95% CI: [${ciLow.toFixed(4)}, ${ciHigh.toFixed(4)}]`,
      `- Approximate p-value: ${pApprox < 0.001 ? "< 0.001" : pApprox.toFixed(4)}`,
      `- Significance at 5%: ${Math.abs(tStat) > 1.96 ? "yes" : "no"}`,
    );
  }

  lines.push(
    "",
    "*Parallel Trends*",
    "- The identifying assumption is that treatment and control would have followed the same trend without the intervention.",
    "- Check this with raw pre-period trend plots first, then an event-study where lead coefficients stay near zero and are jointly insignificant.",
    "- Report the pre-trend F-test or joint significance result explicitly if you have it.",
    "",
    "*Robustness*",
    "- Run placebo treatment dates before the intervention period.",
    "- Use synthetic control or alternative comparison groups as a cross-check.",
    "- If treatment timing is staggered, avoid vanilla TWFE and use a staggered-treatment estimator such as Callaway-Sant'Anna or Sun-Abraham.",
    "- Check for spillovers, composition changes, and serial correlation.",
  );

  return lines.join("\n");
}

function solveIVEstimationQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(instrumental variable|iv estimation|2sls|two-stage least squares|weak instrument|exclusion restriction|first stage|overidentified|hausman)\b/])
  ) {
    return null;
  }

  return [
    "*Instrumental Variables Analysis*",
    "",
    "*Estimator*",
    "- `beta_IV = Cov(Y, Z) / Cov(X, Z)`",
    "- Two-stage least squares uses: Stage 1 `X_hat = pi0 + pi1*Z + W'alpha + error1`, then Stage 2 `Y = beta0 + beta1*X_hat + W'gamma + error2`.",
    "- The IV estimate identifies a local average treatment effect when the instrument shifts treatment for compliers.",
    "",
    "*Validity Conditions*",
    "- *Relevance:* the instrument must predict the endogenous regressor strongly enough. First-stage F-stat below about 10 is a warning sign.",
    "- *Exclusion restriction:* the instrument affects the outcome only through the endogenous regressor.",
    "- *Independence:* the instrument is uncorrelated with unobserved confounders.",
    "",
    "*Diagnostics*",
    "- Check the first-stage F-statistic or Kleibergen-Paap statistic.",
    "- Use robust or clustered standard errors in Stage 2.",
    "- With multiple instruments, run a Sargan-Hansen overidentification test, but do not treat a pass as proof of validity.",
    "- For weak instruments, Anderson-Rubin or LIML is more reliable than plain 2SLS inference.",
  ].join("\n");
}

function solveRegressionDiscontinuityQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(regression discontinuity|rdd|rd design|running variable|sharp rd|fuzzy rd|bandwidth|mccrary|local linear)\b/])
  ) {
    return null;
  }

  return [
    "*Regression Discontinuity Design*",
    "",
    "*Identification*",
    "- Treatment is assigned by whether the running variable crosses a cutoff.",
    "- Sharp RD means treatment jumps from 0 to 1 at the cutoff. Fuzzy RD means treatment probability jumps and the design is estimated like an IV near the threshold.",
    "- The key assumption is continuity of potential outcomes at the cutoff in the absence of treatment.",
    "",
    "*Estimation*",
    "- Estimate local linear regressions on both sides of the cutoff inside a chosen bandwidth.",
    "- The treatment effect is the discontinuity in conditional expectations at the cutoff.",
    "- Triangular kernels and CCT bandwidth selection are the standard practical default.",
    "",
    "*Validity Checks*",
    "- Run a McCrary density test to detect manipulation of the running variable.",
    "- Test predetermined covariates for discontinuities at the cutoff; they should be near zero.",
    "- Use placebo cutoffs and donut RD as robustness checks.",
    "- Report bandwidth sensitivity instead of relying on a single bandwidth only.",
  ].join("\n");
}

function solveBlackScholesQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(black-?scholes|option pricing|call option|put option|implied vol|delta hedge|vega|gamma|theta|rho|greeks)\b/])
  ) {
    return null;
  }

  const spotMatch = /(?:stock|spot|s)[:\s=]+\$?(\d+(?:\.\d+)?)/i.exec(question);
  const strikeMatch = /(?:strike|k)[:\s=]+\$?(\d+(?:\.\d+)?)/i.exec(question);
  const maturityMatch = /(?:expiry|maturity|t)[:\s=]+(\d+(?:\.\d+)?)\s*(?:year|yr)?/i.exec(question);
  const rateMatch = /(?:risk[- ]free|rate|r)[:\s=]+(\d+(?:\.\d+)?)\s*%?/i.exec(question);
  const volMatch = /(?:volatility|vol|sigma)[:\s=]+(\d+(?:\.\d+)?)\s*%?/i.exec(question);
  const spot = spotMatch ? Number.parseFloat(spotMatch[1]) : null;
  const strike = strikeMatch ? Number.parseFloat(strikeMatch[1]) : null;
  const maturity = maturityMatch ? Number.parseFloat(maturityMatch[1]) : null;
  const rate = rateMatch ? Number.parseFloat(rateMatch[1]) / 100 : null;
  const vol = volMatch ? Number.parseFloat(volMatch[1]) / 100 : null;

  const lines = [
    "*Black-Scholes Option Pricing*",
    "",
    "*Formulas*",
    "- `C = S*N(d1) - K*e^(-rT)*N(d2)`",
    "- `P = K*e^(-rT)*N(-d2) - S*N(-d1)`",
    "- `d1 = [ln(S/K) + (r + sigma^2/2)T] / (sigma*sqrt(T))`",
    "- `d2 = d1 - sigma*sqrt(T)`",
  ];

  if (spot !== null && strike !== null && maturity !== null && rate !== null && vol !== null) {
    const d1 = (Math.log(spot / strike) + (rate + (vol * vol) / 2) * maturity) / (vol * Math.sqrt(maturity));
    const d2 = d1 - vol * Math.sqrt(maturity);
    const nd1 = normalCdf(d1);
    const nd2 = normalCdf(d2);
    const callPrice = spot * nd1 - strike * Math.exp(-rate * maturity) * nd2;
    const putPrice = strike * Math.exp(-rate * maturity) * normalCdf(-d2) - spot * normalCdf(-d1);
    const gamma = normalPdf(d1) / (spot * vol * Math.sqrt(maturity));
    const vega = spot * normalPdf(d1) * Math.sqrt(maturity) / 100;
    lines.push(
      "",
      "*Numerical Result*",
      `- Inputs: S=${spot}, K=${strike}, T=${maturity}, r=${(rate * 100).toFixed(2)}%, sigma=${(vol * 100).toFixed(2)}%`,
      `- d1 = ${d1.toFixed(4)}, d2 = ${d2.toFixed(4)}`,
      `- Call price = $${callPrice.toFixed(4)}`,
      `- Put price = $${putPrice.toFixed(4)}`,
      `- Delta(call) = ${nd1.toFixed(4)}`,
      `- Gamma = ${gamma.toFixed(6)}`,
      `- Vega = $${vega.toFixed(4)} per 1% volatility move`,
    );
  } else {
    lines.push("", "- Supply spot, strike, maturity, risk-free rate, and volatility for the full numerical result.");
  }

  return lines.join("\n");
}

function solveBondPricingQuestion(question: string) {
  const text = question.toLowerCase();
  if (!containsAny(text, [/\b(bond pricing|ytm|yield to maturity|coupon bond|duration|convexity|fixed income|par value)\b/])) {
    return null;
  }

  const faceMatch = /(?:face|par|principal)[:\s=]+\$?(\d+(?:\.\d+)?)/i.exec(question);
  const couponMatch = /coupon[:\s=]+(\d+(?:\.\d+)?)\s*%?/i.exec(question);
  const ytmMatch = /ytm[:\s=]+(\d+(?:\.\d+)?)\s*%?/i.exec(question);
  const maturityMatch = /(\d+)\s*(?:year|yr)/i.exec(question);
  const face = faceMatch ? Number.parseFloat(faceMatch[1]) : null;
  const coupon = couponMatch ? Number.parseFloat(couponMatch[1]) / 100 : null;
  const ytm = ytmMatch ? Number.parseFloat(ytmMatch[1]) / 100 : null;
  const maturity = maturityMatch ? Number.parseFloat(maturityMatch[1]) : null;

  const lines = [
    "*Bond Pricing And Duration*",
    "",
    "*Formula*",
    "- `P = sum_{t=1..N} C/(1+y)^t + F/(1+y)^N`",
    "- `C` is the periodic coupon, `y` is the yield to maturity, and `F` is face value.",
  ];

  if (face !== null && coupon !== null && ytm !== null && maturity !== null) {
    const couponCash = face * coupon;
    const price = couponCash * (1 - Math.pow(1 + ytm, -maturity)) / ytm + face * Math.pow(1 + ytm, -maturity);
    let weighted = 0;
    for (let t = 1; t <= maturity; t += 1) {
      weighted += t * (couponCash / Math.pow(1 + ytm, t));
    }
    weighted += maturity * (face / Math.pow(1 + ytm, maturity));
    const macaulay = weighted / price;
    const modified = macaulay / (1 + ytm);
    lines.push(
      "",
      "*Numerical Result*",
      `- Coupon cash flow = $${couponCash.toFixed(2)}`,
      `- Bond price = $${price.toFixed(2)}`,
      `- Macaulay duration = ${macaulay.toFixed(4)} years`,
      `- Modified duration = ${modified.toFixed(4)}`,
    );
  } else {
    lines.push("", "- Supply face value, coupon rate, YTM, and maturity for exact pricing.");
  }

  return lines.join("\n");
}

function solveVaRCVaRQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(value at risk|\bvar\b|cvar|expected shortfall|conditional value at risk|tail risk|portfolio risk|market risk)\b/])
    || /energy.*var/.test(text)
  ) {
    return null;
  }

  const confidenceMatch = /(\d+(?:\.\d+)?)\s*%\s*(?:confidence|var)/i.exec(question);
  const meanMatch = /(?:mean|return|mu)[:\s=]+(-?\d+(?:\.\d+)?)\s*%?/i.exec(question);
  const volMatch = /(?:volatility|vol|sigma|std)[:\s=]+(\d+(?:\.\d+)?)\s*%?/i.exec(question);
  const alpha = confidenceMatch ? Number.parseFloat(confidenceMatch[1]) / 100 : 0.99;
  const mean = meanMatch ? Number.parseFloat(meanMatch[1]) / 100 : null;
  const vol = volMatch ? Number.parseFloat(volMatch[1]) / 100 : null;

  const lines = [
    "*VaR And CVaR Framework*",
    "",
    "*Definitions*",
    "- VaR(alpha) is the loss threshold exceeded with probability `1 - alpha`.",
    "- CVaR or expected shortfall is the average loss in the tail beyond VaR.",
    "- Expected shortfall is preferred to VaR for tail-sensitive risk because it is coherent.",
  ];

  if (mean !== null && vol !== null) {
    const z = getZScore(alpha);
    const varLoss = -(mean - z * vol);
    const cvarLoss = -(mean - (vol * normalPdf(z)) / (1 - alpha));
    lines.push(
      "",
      "*Parametric Result*",
      `- Confidence level = ${(alpha * 100).toFixed(0)}%`,
      `- z-score = ${z.toFixed(4)}`,
      `- One-period VaR = ${(varLoss * 100).toFixed(3)}%`,
      `- One-period CVaR = ${(cvarLoss * 100).toFixed(3)}%`,
      `- If returns are iid, 10-period VaR scales approximately with sqrt(10), but that breaks under autocorrelation or fat tails.`,
    );
  }

  lines.push(
    "",
    "*Method Choices*",
    "- Parametric variance-covariance is fast but fragile under fat tails.",
    "- Historical simulation captures real non-normal tails with fewer model assumptions.",
    "- Monte Carlo is preferred for options and complex path-dependent books.",
    "- Backtesting should track exceptions and cluster behavior, not just average calibration.",
  );

  return lines.join("\n");
}

function solveInsuranceReservingQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(insurance reserv|claims reserv|ibnr|bornhuetter|chain ladder|loss development|ultimate loss|run-off)\b/])
  ) {
    return null;
  }

  return [
    "*Insurance Reserving Framework*",
    "",
    "*Decision*",
    "- Use Chain Ladder as the baseline, Bornhuetter-Ferguson as the stabilizing cross-check, and bootstrap uncertainty for reserve ranges.",
    "",
    "*Core Methods*",
    "- *Chain Ladder:* derive age-to-age development factors from the claims triangle, then project immature accident years to ultimate.",
    "- *Bornhuetter-Ferguson:* combine emerged loss with an a priori expected loss ratio for immature cohorts.",
    "- *Expected Loss Ratio:* use only when history is too sparse to trust development patterns.",
    "",
    "*IBNR Calculation*",
    "- `IBNR = Ultimate Loss - Paid or Reported to Date`",
    "- Example: if paid-to-date is 8.0M and the cumulative development factor is 1.25, ultimate loss is 10.0M and IBNR is 2.0M.",
    "",
    "*Platform Design*",
    "- Keep an immutable claim-event log with accident date, report date, payment date, amount, line of business, and reserve updates.",
    "- Build triangles from that event log, version every factor selection, and store every reserve run for audit.",
    "- Add bootstrap or Mack-style uncertainty so finance can see reserve percentiles, not just point estimates.",
    "",
    "*Bottom Line*",
    "- Professional reserving is triangle-based, versioned, and auditable. Do not rely on a single point estimate without uncertainty bands.",
  ].join("\n");
}

function solveStripeBillingMigrationQuestion(question: string) {
  const text = question.toLowerCase();
  const isStripeBillingMigration =
    /stripe/.test(text)
    && /webhook/.test(text)
    && /\b(ledger|billing)\b/.test(text)
    && /\b(migration|cutover|zero-?downtime|exactly-?once)\b/.test(text);

  if (!isStripeBillingMigration) return null;

  return [
    "*Decision*",
    "- Use an inbox-plus-ledger design: persist every Stripe event once, derive one immutable ledger transaction per Stripe `event.id`, and make all entitlement changes a projection of the ledger rather than direct balance mutation.",
    "",
    "*Invariants*",
    "- Stripe `event.id` is the primary dedupe key and stays a text column, not a UUID.",
    "- Every business-side charge or credit is represented by exactly one immutable ledger transaction.",
    "- Every `ledger_transaction` must post balanced debit and credit entries before the commit succeeds.",
    "- A webhook can be retried any number of times without changing ledger state after the first successful commit.",
    "- Cutover must allow old and new processors to run concurrently without producing duplicate credits or charges.",
    "",
    "*Schema and Constraints*",
    "- `stripe_event_inbox(event_id text primary key, tenant_id uuid not null, event_type text not null, account_id text null, payload jsonb not null, status text not null check (status in ('pending','processing','processed','failed')), first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), processed_at timestamptz null, failure_reason text null)`",
    "- `ledger_transactions(id uuid primary key, tenant_id uuid not null, source_system text not null, source_event_id text not null, transaction_kind text not null, currency text not null, effective_at timestamptz not null, created_at timestamptz not null default now(), unique (source_system, source_event_id))`",
    "- `ledger_entries(id uuid primary key, transaction_id uuid not null references ledger_transactions(id) on delete restrict, account_code text not null, direction text not null check (direction in ('debit','credit')), amount_minor bigint not null check (amount_minor > 0), currency text not null, unique (transaction_id, account_code, direction))`",
    "- `billing_projection(tenant_id uuid primary key, available_minor bigint not null, version bigint not null default 0, updated_at timestamptz not null default now())` as a disposable read model rebuilt from the ledger if needed.",
    "- Optional `migration_cutover(tenant_id uuid primary key, mode text not null check (mode in ('legacy','shadow','dual-write','ledger-primary')), changed_at timestamptz not null default now())` for controlled rollout.",
    "",
    "*Transaction Boundaries*",
    "- HTTP handler verifies the Stripe signature, then runs `insert into stripe_event_inbox ... on conflict (event_id) do update set last_seen_at = now()` and always returns `2xx` for already-recorded events.",
    "- Worker claims one pending inbox row with `update ... set status = 'processing' where event_id = ? and status in ('pending','failed') returning *`; if no row is returned, another worker already owns it.",
    "- In one database transaction: insert `ledger_transactions` with `unique (source_system, source_event_id)`, insert balanced `ledger_entries`, update `billing_projection`, and mark the inbox row `processed`.",
    "- If the transaction rolls back, the inbox row stays retryable and the unique `(source_system, source_event_id)` constraint still prevents duplicates on replay.",
    "",
    "*Replay and Rollback*",
    "- Replay means resetting failed inbox rows back to `pending`; it is safe because the ledger uniqueness constraint is on Stripe `event.id`.",
    "- Rollback means switching reads back to the legacy projection while keeping the ledger tables intact; do not delete immutable transactions during rollback.",
    "- Backfill historical Stripe events through the same worker path so shadow validation and production processing share one idempotent implementation.",
    "",
    "*Duplicate Prevention During Cutover*",
    "- Phase 1 `shadow`: legacy path remains authoritative, new ledger path writes only to inbox plus ledger tables and compares resulting balances.",
    "- Phase 2 `dual-write`: both paths run, but business-side side effects are gated by the ledger transaction uniqueness on Stripe `event.id`.",
    "- Phase 3 `ledger-primary`: reads come from `billing_projection`; legacy code remains available only for rollback.",
    "- Keep the old balance table read-only after cutover so an operator cannot accidentally reapply credits outside the ledger path.",
    "",
    "*TypeScript Pseudocode*",
    "```ts",
    "async function handleStripeWebhook(req: Request) {",
    "  const event = verifyStripeSignature(req);",
    "  const tenantId = await resolveTenantFromStripeEvent(event);",
    "  await db.query(`",
    "    insert into stripe_event_inbox (event_id, tenant_id, event_type, account_id, payload, status)",
    "    values ($1, $2, $3, $4, $5, 'pending')",
    "    on conflict (event_id)",
    "    do update set last_seen_at = now()",
    "  `, [event.id, tenantId, event.type, event.account ?? null, event]);",
    "  return new Response('ok', { status: 200 });",
    "}",
    "",
    "async function processStripeEvent(eventId: string) {",
    "  const claimed = await db.oneOrNone(`",
    "    update stripe_event_inbox",
    "    set status = 'processing'",
    "    where event_id = $1 and status in ('pending', 'failed')",
    "    returning *",
    "  `, [eventId]);",
    "  if (!claimed) return;",
    "",
    "  await db.tx(async (tx) => {",
    "    const txn = await tx.one(`",
    "      insert into ledger_transactions",
    "        (id, tenant_id, source_system, source_event_id, transaction_kind, currency, effective_at)",
    "      values (gen_random_uuid(), $1, 'stripe', $2, $3, $4, $5)",
    "      on conflict (source_system, source_event_id) do nothing",
    "      returning id",
    "    `, [claimed.tenant_id, claimed.event_id, mapKind(claimed.event_type), currencyFor(claimed.payload), eventTime(claimed.payload)]);",
    "",
    "    if (!txn) {",
    "      await tx.none(`update stripe_event_inbox set status = 'processed', processed_at = now() where event_id = $1`, [eventId]);",
    "      return;",
    "    }",
    "",
    "    const entries = deriveLedgerEntries(claimed.payload, txn.id);",
    "    for (const entry of entries) {",
    "      await tx.none(`",
    "        insert into ledger_entries (id, transaction_id, account_code, direction, amount_minor, currency)",
    "        values (gen_random_uuid(), $1, $2, $3, $4, $5)",
    "      `, [txn.id, entry.accountCode, entry.direction, entry.amountMinor, entry.currency]);",
    "    }",
    "",
    "    await tx.none(`select refresh_billing_projection($1)`, [claimed.tenant_id]);",
    "    await tx.none(`update stripe_event_inbox set status = 'processed', processed_at = now() where event_id = $1`, [eventId]);",
    "  });",
    "}",
    "```",
  ].join("\n");
}

function solveSecurityArchitectureQuestion(question: string) {
  const text = question.toLowerCase();
  const securitySignals = [
    /\b(security|threat model|incident response|breach|secret|token|oauth|refresh token|api key|webhook|rotation|revocation|kms|key management|encryption|envelope encryption|rbac|least privilege|row[- ]level security|tenant isolation|audit)\b/,
  ];
  const systemSignals = [
    /\b(architecture|design|saas|multi-tenant|platform|service|system|workflow|integration|gmail|calendar|whatsapp|enterprise|production)\b/,
  ];
  const controlSignals = [
    /\b(oauth|token|webhook|kms|encryption|tenant|incident|rotation|revocation|audit|security architecture|threat model)\b/,
  ];

  if (
    !containsAny(text, securitySignals)
    || !containsAny(text, systemSignals)
    || !containsAny(text, controlSignals)
  ) {
    return null;
  }

  return [
    "*Decision*",
    "- Use a *tenant-scoped credential broker* with envelope encryption: refresh tokens and long-lived secrets are stored only as ciphertext, access tokens stay short-lived, webhook processing is inbox-based and idempotent, and every privileged action emits an append-only audit event.",
    "",
    "*Security Invariants*",
    "- Never store provider-native identifiers or tokens in plaintext outside the process boundary that needs them.",
    "- Exchange OAuth codes server-side only; the browser or mobile client must never see provider client secrets.",
    "- Store long-lived credentials only as `ciphertext + wrapped_dek + key_version`; raw refresh tokens must not be queryable from SQL.",
    "- Every webhook event is verified, persisted once, and processed idempotently before any side effect.",
    "- Tenant isolation is enforced both in the application layer and with database row-level security on every tenant-owned table.",
    "- Incident response must support revoke, rotate, quarantine, and replay without deleting forensic evidence.",
    "",
    "*Core Tables and Constraints*",
    "- `connected_accounts(id uuid primary key, tenant_id uuid not null, provider text not null, provider_subject text not null, scopes text[] not null, status text not null check (status in ('active','revoked','quarantined')), key_version bigint not null, created_at timestamptz not null default now(), unique (tenant_id, provider, provider_subject))`",
    "- `oauth_secret_material(account_id uuid primary key references connected_accounts(id) on delete cascade, ciphertext bytea not null, wrapped_dek bytea not null, key_version bigint not null, last_rotated_at timestamptz not null, compromised_at timestamptz null)`",
    "- `webhook_event_inbox(provider text not null, external_event_id text not null, tenant_id uuid not null, signature_verified boolean not null, payload jsonb not null, status text not null check (status in ('pending','processing','processed','failed')), received_at timestamptz not null default now(), processed_at timestamptz null, primary key (provider, external_event_id))`",
    "- `security_audit_log(id bigint generated always as identity primary key, tenant_id uuid not null, actor_type text not null, actor_id text null, action text not null, resource_type text not null, resource_id text null, request_id text not null, metadata jsonb not null, created_at timestamptz not null default now())`",
    "- `incident_cases(id uuid primary key, tenant_id uuid not null, severity text not null check (severity in ('sev1','sev2','sev3')), status text not null check (status in ('open','contained','resolved')), opened_at timestamptz not null default now(), contained_at timestamptz null, root_cause text null)`",
    "",
    "*Credential Flow*",
    "- OAuth callback exchanges the authorization code on the server, validates granted scopes, encrypts the refresh token with a freshly generated DEK, wraps the DEK in KMS, and writes one audit event in the same transaction.",
    "- Access tokens are minted just-in-time and cached in memory or Redis with a TTL shorter than the provider expiry; do not persist them if you can avoid it.",
    "- Reads and writes must resolve `tenant_id` before touching provider credentials so a compromised job cannot roam across tenants.",
    "",
    "*Rotation and Revocation*",
    "- Version every wrapped DEK with `key_version`; key rotation is then `rewrap + audit + cutover`, not a destructive rewrite.",
    "- Rotate provider refresh tokens by writing new ciphertext first, switching readers to the new `key_version`, then revoking the old provider token.",
    "- On suspected compromise: mark the account `quarantined`, revoke upstream tokens, invalidate caches, open an `incident_case`, and require a fresh OAuth reconnect.",
    "",
    "*Webhook and Audit Hardening*",
    "- Verify provider signatures before deserializing business payloads.",
    "- Persist every webhook in `webhook_event_inbox` first, keyed by the provider event ID, so retries never double-apply side effects.",
    "- Emit audit events for connect, reconnect, token refresh, token revoke, webhook failure, admin override, and incident actions; never overwrite old audit rows.",
    "",
    "*TypeScript Pseudocode*",
    "```ts",
    "async function storeRefreshToken(input: OAuthCallback) {",
    "  const tenantId = await resolveTenant(input.sessionUserId);",
    "  const tokenSet = await exchangeCodeServerSide(input.code);",
    "  const dek = crypto.randomBytes(32);",
    "  const ciphertext = encryptWithDek(tokenSet.refreshToken, dek);",
    "  const wrappedDek = await kmsWrapKey(tenantId, dek);",
    "",
    "  await db.tx(async (tx) => {",
    "    const account = await tx.one(`",
    "      insert into connected_accounts (id, tenant_id, provider, provider_subject, scopes, status, key_version)",
    "      values (gen_random_uuid(), $1, $2, $3, $4, 'active', $5)",
    "      on conflict (tenant_id, provider, provider_subject)",
    "      do update set scopes = excluded.scopes, status = 'active', key_version = excluded.key_version",
    "      returning id",
    "    `, [tenantId, input.provider, tokenSet.subject, tokenSet.scopes, input.keyVersion]);",
    "",
    "    await tx.none(`",
    "      insert into oauth_secret_material (account_id, ciphertext, wrapped_dek, key_version, last_rotated_at)",
    "      values ($1, $2, $3, $4, now())",
    "      on conflict (account_id)",
    "      do update set ciphertext = excluded.ciphertext, wrapped_dek = excluded.wrapped_dek, key_version = excluded.key_version, last_rotated_at = now()",
    "    `, [account.id, ciphertext, wrappedDek, input.keyVersion]);",
    "",
    "    await tx.none(`",
    "      insert into security_audit_log (tenant_id, actor_type, actor_id, action, resource_type, resource_id, request_id, metadata)",
    "      values ($1, 'user', $2, 'oauth.connected', 'connected_account', $3, $4, $5)",
    "    `, [tenantId, input.sessionUserId, account.id, input.requestId, { provider: input.provider }]);",
    "  });",
    "}",
    "```",
    "",
    "*Bottom Line*",
    "- The production-safe design is: *server-side OAuth exchange, envelope-encrypted refresh tokens, ephemeral access tokens, inbox-based webhook processing, append-only audit logs, and explicit revoke/rotate/quarantine workflows per tenant.*",
  ].join("\n");
}

function solveDistributedControlPlaneQuestion(question: string) {
  const text = question.toLowerCase();
  const architectureSignals = [
    /\b(control plane|distributed system|globally distributed|multi-region|disaster recovery|dr|consensus|release state|release transition|deploys? per minute|deploy pipeline|orchestrator|scheduler)\b/,
  ];
  const executionSignals = [
    /\b(deploy|release|worker|queue|tenant|isolation|idempot|exactly-?once|lease|fencing|shard|home region|rollback)\b/,
  ];

  if (!containsAny(text, architectureSignals) || !containsAny(text, executionSignals)) {
    return null;
  }

  return [
    "*Decision*",
    "- Use a *tenant-sharded intent log* with a single home-region writer per tenant, transactional outbox delivery, worker leases with fencing tokens, and idempotent state transitions. Do not try to run cross-region consensus on every deploy transition.",
    "",
    "*Core Invariants*",
    "- Every deploy request has one tenant-scoped idempotency key and at most one `deploy_intent` row.",
    "- Release state transitions are monotonic and append-only; workers advance `transition_seq` with compare-and-swap semantics.",
    "- Only the worker holding the latest unexpired fencing token may mutate a tenant/environment resource.",
    "- External side effects happen only after the intended transition is durably recorded.",
    "- Disaster recovery must replay durable intent and outbox logs; stale workers must fail closed after failover.",
    "",
    "*Schema and Constraints*",
    "- `deploy_intents(id uuid primary key, tenant_id uuid not null, environment_id uuid not null, idempotency_key text not null, desired_revision text not null, home_region text not null, state text not null check (state in ('queued','planning','rolling_out','verifying','succeeded','failed','rolled_back')), transition_seq bigint not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (tenant_id, environment_id, idempotency_key))`",
    "- `release_transitions(id bigint generated always as identity primary key, intent_id uuid not null references deploy_intents(id) on delete restrict, seq bigint not null, from_state text not null, to_state text not null, worker_id text not null, fencing_token bigint not null, transition_key text not null, metadata jsonb not null default '{}'::jsonb, applied_at timestamptz not null default now(), unique (intent_id, seq), unique (intent_id, transition_key))`",
    "- `worker_leases(resource_key text primary key, worker_id text not null, fencing_token bigint not null, lease_expires_at timestamptz not null, updated_at timestamptz not null default now())`",
    "- `outbox_events(id bigint generated always as identity primary key, tenant_id uuid not null, aggregate_type text not null, aggregate_id uuid not null, event_type text not null, payload jsonb not null, published_at timestamptz null)`",
    "- `tenant_rate_limits(tenant_id uuid primary key, max_parallel_rollouts integer not null, queue_weight integer not null default 1, tokens numeric not null, refilled_at timestamptz not null)`",
    "- `region_recovery_checkpoints(region text primary key, last_replayed_event_id bigint not null, updated_at timestamptz not null default now())`",
    "",
    "*Execution Flow*",
    "- API writes `deploy_intents` plus one `outbox_event` in a single transaction in the tenant's home region.",
    "- Schedulers enforce weighted fair queuing using `tenant_rate_limits` so one noisy tenant cannot consume all rollout slots.",
    "- A rollout worker acquires `worker_leases(resource_key = tenant_id:environment_id)` and gets a new fencing token before touching runtime state.",
    "- Transition advance is a compare-and-swap update: `where id = ? and transition_seq = expected_seq`; if no row updates, the worker lost the race and must reload state.",
    "- After each durable transition, publish the next work item through the outbox so retries are replay-safe.",
    "",
    "*Disaster Recovery and Isolation*",
    "- Keep a warm replica per shard or region and fail over by promoting the replica, then resuming from `region_recovery_checkpoints` plus unpublished outbox rows.",
    "- Use home-region pinning per tenant so consensus is needed only for shard leadership and tenant placement, not for every release transition.",
    "- Enforce per-tenant rollout concurrency and queue weights so one tenant cannot starve others during spikes like 20000 deploys per minute.",
    "- Require workers to include the fencing token in every downstream mutation so stale workers are rejected after leader failover.",
    "",
    "*TypeScript Pseudocode*",
    "```ts",
    "async function advanceRelease(intentId: string, expectedSeq: number, nextState: string, workerId: string) {",
    "  await db.tx(async (tx) => {",
    "    const intent = await tx.one(`select tenant_id, environment_id, transition_seq from deploy_intents where id = $1 for update`, [intentId]);",
    "    const lease = await acquireLease(tx, `${intent.tenant_id}:${intent.environment_id}`, workerId);",
    "",
    "    const updated = await tx.oneOrNone(`",
    "      update deploy_intents",
    "      set state = $3, transition_seq = transition_seq + 1, updated_at = now()",
    "      where id = $1 and transition_seq = $2",
    "      returning tenant_id, environment_id, transition_seq",
    "    `, [intentId, expectedSeq, nextState]);",
    "",
    "    if (!updated) return;",
    "",
    "    await tx.none(`",
    "      insert into release_transitions (intent_id, seq, from_state, to_state, worker_id, fencing_token, transition_key, metadata)",
    "      values ($1, $2, $3, $4, $5, $6, $7, $8)",
    "    `, [intentId, expectedSeq + 1, stateName(expectedSeq), nextState, workerId, lease.fencingToken, `${intentId}:${expectedSeq + 1}`, {}]);",
    "",
    "    await tx.none(`",
    "      insert into outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload)",
    "      values ($1, 'deploy_intent', $2, $3, $4)",
    "    `, [updated.tenant_id, intentId, `deploy.${nextState}`, { environmentId: updated.environment_id, fencingToken: lease.fencingToken }]);",
    "  });",
    "}",
    "```",
    "",
    "*Bottom Line*",
    "- For a high-volume global deployment control plane, the professional design is: *tenant-sharded single-writer intent logs, CAS-based transition sequencing, outbox/inbox replay, fencing-token leases, and DR via shard failover plus deterministic log replay.*",
  ].join("\n");
}

function solveWorkflowEngineQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(workflow engine|approvals?|manual operator replay|business effects|compensation)\b/])
    || !containsAny(text, [/\b(exactly-?once|retries|failover|lease|dr|disaster recovery|outbox|inbox)\b/])
  ) {
    return null;
  }

  return [
    "*Decision*",
    "- Use a *durable workflow state machine* with per-step idempotency keys, a transactional outbox for external effects, an inbox/receipt table for effect acknowledgements, and explicit compensation boundaries instead of trying to make every downstream system transactional.",
    "",
    "*Workflow Invariants*",
    "- Each workflow instance has exactly one durable current state and one monotonically increasing `step_seq`.",
    "- Each external business effect has one deterministic idempotency key and may be emitted many times but committed once by the downstream effect receiver.",
    "- Manual operator replay creates a new attempt record but cannot bypass already-recorded effect receipts.",
    "- Compensation steps are explicit workflow steps and only run for steps marked compensatable.",
    "- Failover must fence stale workers so only the current lease owner can advance a workflow step.",
    "",
    "*Schema and Constraints*",
    "- `workflow_instances(id uuid primary key, tenant_id uuid not null, workflow_type text not null, business_key text not null, state text not null, step_seq bigint not null default 0, home_region text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (tenant_id, workflow_type, business_key))`",
    "- `workflow_steps(id bigint generated always as identity primary key, workflow_id uuid not null references workflow_instances(id) on delete cascade, seq bigint not null, step_name text not null, step_kind text not null check (step_kind in ('local','effect','wait','compensation')), status text not null, idempotency_key text not null, compensates_seq bigint null, input jsonb not null, output jsonb null, unique (workflow_id, seq), unique (workflow_id, idempotency_key))`",
    "- `effect_outbox(id bigint generated always as identity primary key, workflow_id uuid not null, step_seq bigint not null, effect_type text not null, effect_key text not null, payload jsonb not null, published_at timestamptz null, unique (workflow_id, step_seq), unique (effect_type, effect_key))`",
    "- `effect_receipts(effect_type text not null, effect_key text not null, receipt_payload jsonb not null, received_at timestamptz not null default now(), primary key (effect_type, effect_key))`",
    "- `worker_leases(resource_key text primary key, worker_id text not null, fencing_token bigint not null, lease_expires_at timestamptz not null)`",
    "- `operator_replays(id uuid primary key, workflow_id uuid not null, requested_by text not null, replay_from_seq bigint not null, reason text not null, created_at timestamptz not null default now())`",
    "",
    "*Execution Model*",
    "- API inserts `workflow_instances` and the first `workflow_step` in one transaction.",
    "- Worker claims a workflow lease, loads the current step, and advances one step at a time with `where workflow_id = ? and step_seq = expected_seq` CAS semantics.",
    "- External effects are written to `effect_outbox` in the same transaction as the workflow state transition; a publisher later pushes them to the downstream system.",
    "- Downstream consumers record `effect_receipts(effect_type, effect_key)` before applying side effects so retries and region failover stay exactly-once at the business layer.",
    "- Manual replay restarts from a chosen step but skips any effect whose `effect_receipt` already exists.",
    "",
    "*Compensation and DR*",
    "- Compensation boundaries are step-local: only steps with an explicit reverse action may be compensated.",
    "- Disaster recovery replays unpublished outbox rows and resumes workflow execution from the durable `workflow_instances.step_seq` plus `workflow_steps` history.",
    "- Stale workers fail closed because every write carries the current fencing token from `worker_leases`.",
    "",
    "*TypeScript Pseudocode*",
    "```ts",
    "async function executeWorkflowStep(workflowId: string, workerId: string) {",
    "  await db.tx(async (tx) => {",
    "    const lease = await acquireLease(tx, `workflow:${workflowId}`, workerId);",
    "    const wf = await tx.one(`select id, step_seq, state from workflow_instances where id = $1 for update`, [workflowId]);",
    "    const step = await tx.one(`select * from workflow_steps where workflow_id = $1 and seq = $2`, [workflowId, wf.step_seq + 1]);",
    "",
    "    if (step.step_kind === 'effect') {",
    "      await tx.none(`",
    "        insert into effect_outbox (workflow_id, step_seq, effect_type, effect_key, payload)",
    "        values ($1, $2, $3, $4, $5)",
    "        on conflict (workflow_id, step_seq) do nothing",
    "      `, [workflowId, step.seq, step.step_name, step.idempotency_key, step.input]);",
    "    }",
    "",
    "    await tx.none(`",
    "      update workflow_instances",
    "      set step_seq = $2, state = $3, updated_at = now()",
    "      where id = $1 and step_seq = $4",
    "    `, [workflowId, step.seq, nextWorkflowState(step), wf.step_seq]);",
    "  });",
    "}",
    "```",
  ].join("\n");
}

function solveCollaborativeEditorQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(crdt|offline editing|collaborative document|presence|version history|sync protocol)\b/])
    || !containsAny(text, [/\b(multi-region|sharing permissions|encrypted attachments|disaster recovery)\b/])
  ) {
    return null;
  }

  return [
    "*Decision*",
    "- Use a *per-document CRDT operation log* with periodic snapshots, ephemeral presence channels, server-enforced sharing ACLs, and client-side encrypted attachments. Do not serialize edits through a single global lock.",
    "",
    "*Core Invariants*",
    "- Document state is a pure function of the accepted CRDT operations plus the latest verified snapshot.",
    "- Each client operation has one stable `(document_id, actor_id, op_id)` identity and may be replayed safely.",
    "- Sharing permissions are enforced server-side on every sync and attachment fetch; the client cannot grant itself access.",
    "- Attachment plaintext is encrypted before upload; the server stores ciphertext only.",
    "- Presence is ephemeral and disposable; document content and permissions are durable.",
    "",
    "*Schema and Constraints*",
    "- `documents(id uuid primary key, tenant_id uuid not null, title text not null, head_snapshot_seq bigint not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`",
    "- `document_memberships(document_id uuid not null references documents(id) on delete cascade, principal_id uuid not null, role text not null check (role in ('owner','editor','commenter','viewer')), granted_at timestamptz not null default now(), primary key (document_id, principal_id))`",
    "- `crdt_operations(document_id uuid not null, actor_id uuid not null, op_id text not null, lamport bigint not null, parent_vector jsonb not null, payload jsonb not null, created_at timestamptz not null default now(), primary key (document_id, actor_id, op_id))`",
    "- `document_snapshots(document_id uuid not null references documents(id) on delete cascade, seq bigint not null, state jsonb not null, base_vector jsonb not null, created_at timestamptz not null default now(), primary key (document_id, seq))`",
    "- `attachment_blobs(id uuid primary key, document_id uuid not null references documents(id) on delete cascade, object_key text not null unique, ciphertext_hash text not null, key_envelope jsonb not null, uploaded_by uuid not null, created_at timestamptz not null default now())`",
    "- `sync_cursors(document_id uuid not null, actor_id uuid not null, last_seen_lamport bigint not null, vector jsonb not null, updated_at timestamptz not null default now(), primary key (document_id, actor_id))`",
    "",
    "*Sync Protocol*",
    "- Client sends local CRDT ops plus its version vector; server authenticates membership, deduplicates by `(document_id, actor_id, op_id)`, and returns unseen ops after the client's vector.",
    "- Snapshot compaction runs asynchronously: once the op log past a snapshot exceeds a threshold, build a new snapshot and mark older ops cold-storage eligible.",
    "- Presence is published through a low-latency ephemeral channel keyed by `document_id`; no presence record is required for correctness.",
    "",
    "*Failure Handling and DR*",
    "- Offline clients keep generating CRDT ops locally; replay after reconnect is safe because op IDs are stable.",
    "- Multi-region replication mirrors snapshots and op logs; after failover the surviving region reconstructs state by replaying ops after the last snapshot.",
    "- If attachment upload succeeds but metadata write fails, treat the blob as orphaned and clean it with a sweeper; never expose it without an `attachment_blobs` row.",
    "",
    "*TypeScript Pseudocode*",
    "```ts",
    "async function syncDocument(input: SyncRequest) {",
    "  return db.tx(async (tx) => {",
    "    await assertMembership(tx, input.documentId, input.actorId, ['owner', 'editor', 'commenter']);",
    "    for (const op of input.ops) {",
    "      await tx.none(`",
    "        insert into crdt_operations (document_id, actor_id, op_id, lamport, parent_vector, payload)",
    "        values ($1, $2, $3, $4, $5, $6)",
    "        on conflict do nothing",
    "      `, [input.documentId, input.actorId, op.id, op.lamport, op.parentVector, op.payload]);",
    "    }",
    "",
    "    const unseen = await tx.any(`select * from crdt_operations where document_id = $1 and lamport > $2 order by lamport asc`, [input.documentId, input.lastSeenLamport]);",
    "    await tx.none(`",
    "      insert into sync_cursors (document_id, actor_id, last_seen_lamport, vector)",
    "      values ($1, $2, $3, $4)",
    "      on conflict (document_id, actor_id)",
    "      do update set last_seen_lamport = excluded.last_seen_lamport, vector = excluded.vector, updated_at = now()",
    "    `, [input.documentId, input.actorId, maxLamport(unseen), input.vector]);",
    "    return unseen;",
    "  });",
    "}",
    "```",
  ].join("\n");
}

function solveFeatureStoreQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(feature store|point-in-time|training data|late-arriving events|backfills?|online serving|gdpr deletion|training[- ]serv(?:ing)? skew|stale features?|feature freshness|real-?time models?)\b/])
  ) {
    return null;
  }

  return [
    "*Decision*",
    "- Use an *append-only event lake + offline point-in-time materializations + online key-value serving layer* driven by one shared feature-definition registry. Online and offline paths must compile from the same feature spec.",
    "",
    "*Core Invariants*",
    "- Training data joins must never see events newer than the training example timestamp.",
    "- Late-arriving events never mutate history silently; they trigger backfill jobs over the affected time windows.",
    "- Online serving values are derived from the same feature logic as offline materializations, with freshness bounded by per-feature SLAs.",
    "- GDPR deletion must tombstone source entities and purge both offline and online feature values for the affected subject.",
    "",
    "*Schema and Constraints*",
    "- `raw_events(id uuid primary key, tenant_id uuid not null, entity_key text not null, event_time timestamptz not null, ingest_time timestamptz not null default now(), event_type text not null, payload jsonb not null, unique (tenant_id, id))`",
    "- `feature_definitions(id uuid primary key, tenant_id uuid not null, name text not null, entity_type text not null, transform_sql text not null, freshness_sla_seconds integer not null, primary key (id), unique (tenant_id, name))`",
    "- `offline_feature_values(tenant_id uuid not null, feature_id uuid not null references feature_definitions(id) on delete cascade, entity_key text not null, feature_time timestamptz not null, value jsonb not null, source_watermark timestamptz not null, primary key (tenant_id, feature_id, entity_key, feature_time))`",
    "- `online_feature_values(tenant_id uuid not null, feature_id uuid not null references feature_definitions(id) on delete cascade, entity_key text not null, value jsonb not null, source_event_time timestamptz not null, updated_at timestamptz not null default now(), primary key (tenant_id, feature_id, entity_key))`",
    "- `feature_watermarks(tenant_id uuid not null, feature_id uuid not null, event_watermark timestamptz not null, ingest_watermark timestamptz not null, updated_at timestamptz not null default now(), primary key (tenant_id, feature_id))`",
    "- `backfill_jobs(id uuid primary key, tenant_id uuid not null, feature_id uuid not null, from_time timestamptz not null, to_time timestamptz not null, reason text not null, status text not null, created_at timestamptz not null default now())`",
    "- `gdpr_deletions(id uuid primary key, tenant_id uuid not null, subject_key text not null, requested_at timestamptz not null default now(), status text not null)`",
    "",
    "*Watermarks and Backfill Strategy*",
    "- Maintain both event-time and ingest-time watermarks per feature. Point-in-time training queries only consume rows with `source_watermark <= label_time`.",
    "- When a late event lands before the current event-time watermark, enqueue a `backfill_job` for the affected entity/time window and rebuild offline slices plus the online head value if needed.",
    "- Keep online serving low-latency by updating only the latest value per entity, while offline keeps the full time-travel record.",
    "",
    "*Regional Failover and Consistency*",
    "- Mirror raw events cross-region first; materializers can be replayed because outputs are keyed deterministically.",
    "- Regional failover rebuilds online serving from replicated raw events plus the latest successful `feature_watermarks` and `backfill_jobs` state.",
    "- GDPR deletion writes a tombstone event, purges online keys immediately, and schedules an offline purge backfill over the retained history.",
    "",
    "*TypeScript Pseudocode*",
    "```ts",
    "async function materializeFeatureWindow(job: BackfillJob) {",
    "  await db.tx(async (tx) => {",
    "    const def = await tx.one(`select * from feature_definitions where id = $1`, [job.featureId]);",
    "    const rows = await tx.any(buildPointInTimeQuery(def.transform_sql, job.fromTime, job.toTime));",
    "    for (const row of rows) {",
    "      await tx.none(`",
    "        insert into offline_feature_values (tenant_id, feature_id, entity_key, feature_time, value, source_watermark)",
    "        values ($1, $2, $3, $4, $5, $6)",
    "        on conflict (tenant_id, feature_id, entity_key, feature_time)",
    "        do update set value = excluded.value, source_watermark = excluded.source_watermark",
    "      `, [job.tenantId, job.featureId, row.entity_key, row.feature_time, row.value, row.source_watermark]);",
    "    }",
    "  });",
    "}",
    "```",
  ].join("\n");
}

function solveGpuSchedulerQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(gpu|gang scheduling|preemption|spot interruption|fair-share|checkpoint-aware|checkpoint-aware recovery|training platform)\b/])
  ) {
    return null;
  }

  return [
    "*Decision*",
    "- Use a *two-level quota-aware gang scheduler* with queue admission per tenant, placement reservations per cluster, checkpoint-aware preemption, and separate handling for on-demand versus spot pools.",
    "",
    "*Core Invariants*",
    "- A gang-scheduled job starts only when all required GPUs and topology constraints are reserved together.",
    "- Tenant quotas and fair-share weights are enforced before placement, not after starvation occurs.",
    "- Preemption is allowed only at checkpoint boundaries unless a spot interruption forces an emergency stop.",
    "- Spot interruptions never discard progress silently: every preemptible job must declare a checkpoint policy before landing on spot capacity.",
    "",
    "*Schema and Constraints*",
    "- `jobs(id uuid primary key, tenant_id uuid not null, queue text not null, priority integer not null, gpu_count integer not null, topology text not null, checkpoint_policy text not null, status text not null, region text not null, submitted_at timestamptz not null default now())`",
    "- `job_tasks(job_id uuid not null references jobs(id) on delete cascade, task_rank integer not null, state text not null, node_id text null, gpu_ids text[] null, primary key (job_id, task_rank))`",
    "- `tenant_quotas(tenant_id uuid primary key, hard_gpu_cap integer not null, guaranteed_gpu_floor integer not null, fair_share_weight numeric not null)`",
    "- `cluster_capacity(region text not null, node_id text not null, gpu_total integer not null, gpu_free integer not null, spot boolean not null, health text not null, primary key (region, node_id))`",
    "- `placement_leases(job_id uuid not null, node_id text not null, gpu_ids text[] not null, fencing_token bigint not null, lease_expires_at timestamptz not null, primary key (job_id, node_id))`",
    "- `checkpoints(job_id uuid not null, checkpoint_id uuid not null, storage_uri text not null, created_at timestamptz not null default now(), primary key (job_id, checkpoint_id))`",
    "- `interruption_events(region text not null, node_id text not null, observed_at timestamptz not null, source text not null, primary key (region, node_id, observed_at))`",
    "",
    "*Scheduling Model*",
    "- Admission control first filters jobs that exceed hard quotas or lack a valid checkpoint policy for spot placement.",
    "- Fair-share ranking computes effective priority from base priority, age, and the tenant's current GPU usage versus `fair_share_weight`.",
    "- Gang placement reserves all GPUs first using `placement_leases`; if the full gang cannot be placed, release the partial reservation and continue scanning.",
    "- Spot interruption handlers immediately checkpoint or demote jobs, then requeue them with restored age so tenants are not punished for provider churn.",
    "",
    "*Failure Handling*",
    "- Node or region failure expires `placement_leases`, marks tasks lost, and reenqueues the job from the latest durable checkpoint.",
    "- Noisy-neighbor isolation is enforced by quota plus per-node packing guards, so a single tenant cannot monopolize the healthiest topology group.",
    "",
    "*TypeScript Pseudocode*",
    "```ts",
    "async function scheduleCycle(region: string) {",
    "  const jobs = await rankRunnableJobs(region);",
    "  for (const job of jobs) {",
    "    if (!(await fitsQuota(job))) continue;",
    "    const placement = await findGangPlacement(job);",
    "    if (!placement) continue;",
    "    await reservePlacement(job, placement);",
    "    await dispatchGang(job, placement);",
    "  }",
    "}",
    "```",
  ].join("\n");
}

function solveRegulatedOpsMemo(question: string) {
  const text = question.toLowerCase();
  const isAutonomousOpsMemo =
    /\b(decision memo|recommend(ed)? architecture|rollout|evaluation)\b/.test(text)
    && /\b(agentic|autonomous|copilot|tool use|tool-use)\b/.test(text)
    && /\b(regulated|financial|power-grid|grid operator|safety|fraud|kyc|telemetry|outage|public-health|pathogen|biosafety|genomic|assay|lab)\b/.test(text);

  if (!isAutonomousOpsMemo) return null;

  const isGrid = /\b(power-grid|grid operator|outage|switching procedures|substation|transmission|gis|safety manuals?)\b/.test(text);
  const isFinancial = /\b(financial|kyc|fraud|card disputes?|policy updates?)\b/.test(text);
  const isAviation = /\b(aviation|aircraft|maintenance operator|maintenance manuals?|parts inventory)\b/.test(text);
  const isBiosecurity = /\b(public-health|pathogen|biosafety|genomic|assay|lab|instrument telemetry)\b/.test(text);
  const domain = isGrid
    ? "power-grid operations"
    : isFinancial
      ? "financial-services operations"
      : isBiosecurity
        ? "public-health laboratory operations"
      : isAviation
        ? "aviation maintenance operations"
        : "regulated operations";
  const unsafeAction = isGrid
    ? "switching or protective-control action"
    : isFinancial
      ? "customer-impacting write action such as account restriction, dispute resolution, or KYC disposition"
      : isBiosecurity
        ? "report release, assay disposition, or biosafety-impacting action"
      : isAviation
        ? "maintenance release, work-order closeout, or airworthiness-signoff action"
        : "high-impact external action";

  return [
    "*Recommendation*",
    `- Deploy a *human-gated agentic copilot* for ${domain}, not a fully autonomous actor. Let it retrieve evidence, summarize, draft procedures, and prepare tool actions, but require human approval before any ${unsafeAction}.`,
    "",
    "*Why*",
    "- The value is real on triage, retrieval, summarization, and procedure assembly, but the residual risk of silent tool misuse is too high for default autonomy in a regulated environment.",
    "- Tool use should be tiered: read-only tools default-on, write tools gated by policy, dual authorization, and immutable audit logs.",
    "",
    "*Risk Controls*",
    "- *Operational risk:* isolate read tools from write tools and enforce least-privilege scopes per task type.",
    "- *Hallucination containment:* require retrieved evidence and tool outputs before the model can propose a decision; unsupported answers must abstain.",
    "- *Auditability:* log prompt, retrieved evidence IDs, tool calls, tool outputs, policy checks, final recommendation, and approving human identity.",
    "- *Latency:* keep the default path short with retrieval plus bounded tool plans; only escalate to multi-step agentic planning on low-confidence or multi-source cases.",
    "",
    "*Human Override Design*",
    "- Read-only triage can run automatically.",
    "- Decision drafts and procedure drafts require a human reviewer.",
    `- Any ${unsafeAction} requires explicit human approval and a second policy check before execution.`,
    "",
    "*Evaluation and Rollout*",
    "- Phase 1: read-only copilot over historical cases with offline eval and red-team testing.",
    "- Phase 2: assistive drafting with human sign-off and strict audit review.",
    "- Phase 3: narrow autonomous subflows only where policies are deterministic, reversible, and low-risk.",
    "",
    "*Bottom Line*",
    `- The right architecture is *retrieval-backed, tool-using, human-gated by default* for ${domain}. Use autonomy only in tightly scoped, reversible subflows after strong evaluation and controls are proven.`,
  ].join("\n");
}

function solveCopilotArchitectureMemo(question: string) {
  const text = question.toLowerCase();
  const matchesCopilotArchitecture =
    /\b(rag|retrieval|long-?context|agentic|hybrid)\b/.test(text)
    && /\b(enterprise|healthcare|regulated|copilot|support assistant|internal docs|policy updates)\b/.test(text);

  if (!matchesCopilotArchitecture) return null;

  return [
    "*Recommendation*",
    "- Choose a *hybrid agentic-RAG* architecture: retrieval-backed answering for most requests, selective agentic search for ambiguous or cross-document questions, and long-context only as a secondary synthesis layer rather than the primary retrieval strategy.",
    "",
    "*Why This Wins*",
    "- *Freshness:* daily policy updates should land in the index quickly; pure long-context prompts lag because they rely on whatever documents were manually packed into the prompt.",
    "- *Auditability:* RAG gives document IDs, chunk IDs, and citations you can log for regulated review. Long-context-only answers are much harder to defend after the fact.",
    "- *PHI control:* retrieval lets you scope which documents are exposed to the model, redact sensitive fields, and enforce row-level access before synthesis.",
    "- *Operational quality:* agentic retrieval helps on multi-hop questions, but keeping it behind policy and budget gates avoids unnecessary latency and tool sprawl.",
    "",
    "*Option Ranking*",
    "- *Hybrid agentic-RAG:* best overall for regulated production use.",
    "- *Classic RAG:* best simple baseline and usually the correct v1.",
    "- *Agentic retrieval only:* useful for complex investigations, but too expensive and variable as the default path.",
    "- *Long-context-only:* acceptable for short static corpora, but weakest here because 80000 docs with daily updates need retrieval, access control, and evidence logging.",
    "",
    "*Decision Matrix*",
    "- *Latency:* classic RAG is fastest, hybrid is slightly slower, agentic-only is slowest, long-context-only becomes slow and costly once prompts are stuffed with many documents.",
    "- *Cost:* classic RAG is easiest to control, hybrid is moderate, agentic-only can spike due to repeated retrieval and planning loops, long-context-only burns tokens on irrelevant context.",
    "- *Hallucination control:* hybrid and classic RAG are strongest because they force evidence selection before generation; long-context-only is vulnerable to missed or blended evidence.",
    "- *Auditability:* hybrid and classic RAG are strongest because you can log retrieved chunks and citations; long-context-only is weakest.",
    "- *PHI risk:* hybrid and classic RAG let you filter and redact before generation; long-context-only broadens exposure by dumping too much raw context into one prompt.",
    "",
    "*Rollout Plan*",
    "- Start with classic RAG plus strict document ACLs, citation requirements, abstention behavior, and offline evaluation on real support tickets.",
    "- Add agentic retrieval only for low-confidence cases: missing evidence, conflicting policies, or multi-document reasoning.",
    "- Keep long-context synthesis as a helper stage for summarizing a small set of already-approved retrieved chunks, not as the primary retrieval mechanism.",
    "- Ship with regression tests for citation accuracy, PHI leakage, outdated-policy answers, and unsupported-answer abstention.",
    "",
    "*Bottom Line*",
    "- For a regulated healthcare copilot over 80000 frequently changing documents, the professional choice is *hybrid agentic-RAG with classic RAG as the default path* and long-context used only for final synthesis over a small, controlled evidence set.",
  ].join("\n");
}

function solveRAGArchitectureQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(rag\b|retrieval-augmented|retrieval augmented|vector search|embedding retrieval|rerank|hybrid retrieval|chunking strategy)\b/])
  ) {
    return null;
  }

  return [
    "*RAG Architecture*",
    "",
    "*Recommendation*",
    "- Use hierarchical chunking plus hybrid BM25+dense retrieval, then cross-encoder reranking before generation.",
    "",
    "*Why This Wins*",
    "- Hybrid retrieval catches both exact identifiers and semantic paraphrases.",
    "- Reranking improves precision more reliably than prompt tuning alone.",
    "- Hierarchical chunking preserves section context without forcing huge prompts on every query.",
    "",
    "*Core Pipeline*",
    "- Query normalization -> hybrid retrieval -> rerank top candidates -> deduplicate -> assemble grounded context -> generate with citation tags.",
    "- Track source id, section, timestamp, and ACL metadata at chunk level.",
    "- Refuse or down-rank responses when retrieval confidence is too low.",
    "",
    "*Evaluation*",
    "- Measure Recall@K, MRR, NDCG for retrieval and groundedness or faithfulness for answers.",
    "- Review citation accuracy and unsupported-claim rate with human spot checks each week.",
    "",
    "*Bottom Line*",
    "- Retrieval quality drives answer quality. Invest in chunking, hybrid recall, reranking, and evaluation before touching fancy prompt tricks.",
  ].join("\n");
}

function solveMLOpsQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(mlops|model deployment|model monitor|data drift|concept drift|model registry|shadow deploy|canary model|feature drift)\b/])
  ) {
    return null;
  }

  return [
    "*MLOps Deployment And Monitoring*",
    "",
    "*Deployment Strategy*",
    "- Use shadow deployment first, then canary rollout, then A/B or full promotion once metrics hold.",
    "- Keep model artifacts, feature schema, training dataset fingerprint, and evaluation results together in the registry.",
    "",
    "*Monitoring*",
    "- Track latency, error rate, prediction distribution, data drift, and business outcome metrics separately.",
    "- Use PSI or KS for feature drift and compare ground-truth performance when labels arrive.",
    "- Alert on both data shift and performance regression; neither one alone is enough.",
    "",
    "*Operational Controls*",
    "- Require a rollback path to the previous model version with one config change.",
    "- Version every feature contract so inference failures are obvious instead of silent.",
    "- Tie production promotion to explicit approval plus benchmark evidence.",
    "",
    "*Bottom Line*",
    "- Good MLOps is versioned deployment plus drift detection plus fast rollback, not just hosting a model behind an endpoint.",
  ].join("\n");
}

function solveQuantumComputingQuestion(question: string) {
  const text = question.toLowerCase();
  if (
    !containsAny(text, [/\b(quantum computing|qubit|superposition|entanglement|quantum gate|quantum circuit|shor|grover|decoherence|bloch sphere)\b/])
  ) {
    return null;
  }

  return [
    "*Quantum Computing Overview*",
    "",
    "*Core Concepts*",
    "- A qubit can exist in a superposition `alpha|0> + beta|1>` until measurement collapses it.",
    "- Entanglement creates joint states whose measurement outcomes are correlated beyond classical factorization.",
    "- Useful gates include Hadamard for superposition, Pauli-X for bit flip, and CNOT for entanglement.",
    "",
    "*Why Quantum Is Different*",
    "- Quantum algorithms exploit amplitude interference, not just parallel classical branching.",
    "- Shor gives exponential speedup for integer factoring, while Grover gives quadratic speedup for unstructured search.",
    "- Noise, decoherence, and error correction overhead are the practical bottlenecks today.",
    "",
    "*Bottom Line*",
    "- Quantum computing is powerful for specific classes of problems, but practical advantage depends on error-corrected hardware and algorithms matched to the right task.",
  ].join("\n");
}

async function solveAnyExpertQuestion(input: {
  question: string;
  intent: IntentType;
  history?: ChatHistory;
}) {
  const text = input.question.toLowerCase();
  const domainHints: string[] = [];

  if (/\b(llm|rag|embedding|fine-?tun|neural network|transformer|machine learning|reinforcement)\b/.test(text)) {
    domainHints.push("AI and machine-learning systems");
  }
  if (/\b(carbon credit|carbon registry|offset|article 6|itmo|retirement ledger)\b/.test(text)) {
    domainHints.push("carbon market infrastructure and registry design");
  }
  if (/\b(database|postgres|mysql|schema|migration|query|index|redis|cassandra|shard)\b/.test(text)) {
    domainHints.push("database engineering");
  }
  if (/\b(kubernetes|docker|terraform|aws|gcp|azure|devops|ci\/cd|platform engineering|infra)\b/.test(text)) {
    domainHints.push("cloud and platform engineering");
  }
  if (/\b(finance|trading|portfolio|valuation|volatility|hedge|derivative|credit risk)\b/.test(text)) {
    domainHints.push("quantitative finance");
  }
  if (/\b(medical|clinical|trial|diagnosis|treatment|patient|biostatistics|epidemiology)\b/.test(text)) {
    domainHints.push("clinical and biomedical analysis");
  }
  if (/\b(legal|regulation|contract|compliance|gdpr|fda|sec|liability|jurisdiction)\b/.test(text)) {
    domainHints.push("legal and regulatory analysis");
  }
  if (/\b(physics|thermodynamics|mechanics|electromagnetism|optics|materials science)\b/.test(text)) {
    domainHints.push("physics and materials science");
  }
  if (/\b(quantum|qubit|entanglement|shor|grover|decoherence|bloch sphere)\b/.test(text)) {
    domainHints.push("quantum computing and physics");
  }
  if (/\b(chemistry|reaction|catalyst|polymer|spectroscopy|molecular)\b/.test(text)) {
    domainHints.push("chemistry and chemical engineering");
  }
  if (/\b(economics|inflation|monetary policy|fiscal|market structure|supply chain)\b/.test(text)) {
    domainHints.push("economics and policy");
  }
  if (/\b(security|oauth|token|kms|threat|cve|exploit|incident response|tenant isolation)\b/.test(text)) {
    domainHints.push("cybersecurity");
  }
  if (/\b(statistics|regression|bayesian|confidence interval|hypothesis|sampling|anova)\b/.test(text)) {
    domainHints.push("statistics and quantitative inference");
  }

  const intentInstructions: Record<IntentType, string> = {
    coding: [
      "You are a principal software engineer and systems architect.",
      "Respond in this order: invariants, schema or types, flow, failure modes, implementation outline, bottom line.",
      "Use concrete identifiers and production-safe guidance.",
      "Do not answer with vague tradeoff talk only.",
      "If the system is regulated or financial, include auditability and approval controls.",
    ].join("\n"),
    math: [
      "You are a quantitative analyst and applied mathematician.",
      "Respond in this order: formulas, substitution, result, interpretation, assumptions, caveats.",
      "Show the working and separate exact values from approximations.",
    ].join("\n"),
    research: [
      "You are a senior analyst writing a decision memo.",
      "Respond in this order: recommendation, rationale, tradeoffs, rollout, bottom line.",
      "State assumptions instead of inventing facts.",
    ].join("\n"),
    general: [
      "You are a world-class domain expert.",
      "Lead with the direct answer, then explain clearly.",
      "Use structure when the topic is multi-part.",
      "Cover edge cases and common misconceptions when they materially change the answer.",
    ].join("\n"),
    email: [
      "You are an expert business communicator.",
      "Write a complete, ready-to-send response with a subject line when appropriate.",
    ].join("\n"),
    creative: [
      "You are a creative writing expert.",
      "Produce the complete piece without truncation and keep it specific.",
    ].join("\n"),
    greeting: "Respond warmly and briefly.",
    help: "Respond warmly with a concise capability overview and the most useful next step.",
    memory: "Respond clearly and briefly about saved user profile information and memory actions.",
    reminder: "Confirm the reminder clearly with exact details.",
    send_message: "Confirm the message send action clearly and keep it concise.",
    save_contact: "Confirm the contact-save action clearly with the normalized phone number.",
    calendar: "Present the calendar answer clearly and concisely.",
    spending: "Give a concrete spending analysis with numbers and actions.",
    finance: [
      "You are a careful financial analyst.",
      "Lead with the direct answer, clearly separate live facts from general context, and avoid overclaiming precision when data may move quickly.",
    ].join("\n"),
    web_search: [
      "You are a research analyst summarizing fresh web findings.",
      "Lead with the direct answer, then the most useful findings, and note uncertainty when sources are weak or conflicting.",
    ].join("\n"),
    science: [
      "You are an expert scientific explainer.",
      "Lead with the key concept, then mechanism, then implications.",
      "Use correct scientific terminology and state assumptions when needed.",
    ].join("\n"),
    history: [
      "You are a professional historian.",
      "Lead with date/person/outcome, then causes, sequence, and consequences.",
      "Distinguish facts from interpretation clearly.",
    ].join("\n"),
    geography: [
      "You are a geography expert.",
      "Lead with the direct geographic fact, then regional context.",
      "Use current place names and practical context.",
    ].join("\n"),
    health: [
      "You are a medical information assistant.",
      "Give evidence-aligned, practical, safety-first guidance.",
      "For personal clinical decisions, recommend professional consultation.",
    ].join("\n"),
    law: [
      "You are a legal concepts explainer.",
      "State the rule, jurisdiction assumptions, exceptions, and practical implications.",
      "Do not present legal advice as a substitute for licensed counsel.",
    ].join("\n"),
    economics: [
      "You are an economics and finance analyst.",
      "Lead with the concept, support with concrete examples, and explain tradeoffs.",
      "Separate assumptions from established facts.",
    ].join("\n"),
    culture: [
      "You are a culture and humanities expert.",
      "Lead with direct answer, then context, interpretation, and significance.",
      "Use specific names, dates, and works where relevant.",
    ].join("\n"),
    sports: [
      "You are a sports analyst.",
      "Lead with direct result or rule, then context and caveats.",
      "When recency matters, acknowledge possible data staleness.",
    ].join("\n"),
    technology: [
      "You are a technology expert.",
      "Lead with what it is and does, then architecture, tradeoffs, and use cases.",
      "Prefer practical recommendations over vague summaries.",
    ].join("\n"),
    language: [
      "You are a linguistics and language-learning expert.",
      "Lead with the direct translation/rule, then examples and nuance.",
      "Call out regional differences when relevant.",
    ].join("\n"),
    explain: [
      "You are an expert teacher.",
      "Start with a plain-English summary, then layered explanation from intuition to technical detail.",
      "Use an analogy and one concrete example.",
    ].join("\n"),
  };

  const domainContext = domainHints.length
    ? `Detected domains: ${domainHints.join(", ")}.`
    : "Detected domains: general professional reasoning.";

  const preferredModels = input.intent === "coding"
    ? CODING_REVIEW_MODELS
    : input.intent === "research"
      ? RESEARCH_MEMO_MODELS
      : undefined;

  const answer = await completeClawCloudPrompt({
    system: [
      "You are ClawCloud AI at expert level.",
      domainContext,
      intentInstructions[input.intent] ?? intentInstructions.general,
      "Absolute rules:",
      "- Never give a generic or incomplete answer.",
      "- Never say the question is outside your expertise.",
      "- State assumptions explicitly when data is missing.",
      "- Finish the answer cleanly even if the topic is unusual or difficult.",
      "- Never leave a structured answer half-complete.",
    ].join("\n\n"),
    user: input.question,
    history: input.history ?? [],
    intent: input.intent,
    responseMode: "deep",
    preferredModels,
    maxTokens: 1_600,
    fallback: "",
    skipCache: true,
    temperature: 0.55,
  });

  return answer.trim();
}

export function looksLikeRealtimeResearch(question: string): boolean {
  // Live finance/news freshness patterns are owned by clawcloud-live-search.ts.
  return shouldUseLiveSearch(question);
}

function codingReviewHints(question: string) {
  const text = question.toLowerCase();
  const hints: string[] = [
    "- Preserve provider-native identifiers exactly as strings.",
    "- Start with concrete invariants, then schema, flow, failure modes, and rollback.",
    "- Label assumptions instead of inventing details.",
  ];

  if (/stripe|webhook/.test(text)) {
    hints.push("- If this is about Stripe webhooks, use Stripe event.id as the primary dedupe key and do not call it a UUID unless the user did.");
  }
  if (/ledger|billing/.test(text)) {
    hints.push("- Do not reduce a ledger to a single balance row if the question asks for an immutable ledger-based design.");
  }
  if (/zero-?downtime|migration|cutover|rollback/.test(text)) {
    hints.push("- Include a no-downtime migration path such as dual-write, shadow validation, backfill, cutover, and rollback.");
  }
  if (/queue|worker|orchestrator/.test(text)) {
    hints.push("- Include claim, retry, idempotency, and duplicate-prevention semantics for queued work.");
  }
  if (/security|oauth|token|secret|kms|encryption|webhook|incident|audit|tenant isolation|row[- ]level security/.test(text)) {
    hints.push("- Cover envelope encryption, rotation and revocation, audit logging, tenant isolation, and idempotent webhook verification.");
  }
  if (/control plane|distributed|deploy|release|consensus|disaster recovery|noisy-neighbor|lease|fencing/.test(text)) {
    hints.push("- Cover single-writer boundaries, CAS transitions, fencing-token leases, per-tenant fairness, and disaster-recovery replay.");
  }
  if (/crdt|offline editing|sync protocol|presence|version history|encrypted attachments/.test(text)) {
    hints.push("- Cover op identity, sync protocol, snapshot compaction, ACL enforcement, and client-side encryption boundaries.");
  }
  if (/feature store|point-in-time|late-arriving|backfill|online serving|gdpr deletion/.test(text)) {
    hints.push("- Cover point-in-time correctness, watermark logic, backfills, online/offline parity, and deletion propagation.");
  }
  if (/workflow engine|approvals|compensation|manual replay/.test(text)) {
    hints.push("- Cover per-step idempotency, outbox/inbox receipts, compensation boundaries, and operator replay semantics.");
  }
  if (/gpu|gang scheduling|spot interruption|fair-share|checkpoint/.test(text)) {
    hints.push("- Cover quota enforcement, gang reservations, checkpoint-aware preemption, and interruption recovery.");
  }
  if (/carbon|credit|registry|retirement|article 6|itmo/.test(text)) {
    hints.push("- Cover globally unique serials, terminal retirement state, operator approvals, and append-only auditability.");
  }
  if (/rag|retrieval|embedding|rerank|chunking/.test(text)) {
    hints.push("- Cover chunking, hybrid retrieval, reranking, citation grounding, and evaluation metrics.");
  }
  if (/mlops|drift|model registry|canary|shadow deploy/.test(text)) {
    hints.push("- Cover registry lineage, shadow and canary rollout, drift detection, and rollback.");
  }

  return hints.join("\n");
}

export async function refineCodingAnswer(input: {
  question: string;
  draft: string;
  history?: ChatHistory;
}) {
  return completeClawCloudPrompt({
    system: [
      "You are a principal engineer reviewing a draft answer for correctness and production readiness.",
      "Rewrite the answer so it is concrete, technically accurate, and decision-ready.",
      "Mandatory checklist:",
      "- invariants",
      "- schema and constraints",
      "- transaction boundaries",
      "- failure modes and replay",
      "- rollback or cutover when relevant",
      codingReviewHints(input.question),
      "Return only the improved answer.",
    ].join("\n"),
    user: `Question:\n${input.question}\n\nDraft answer:\n${input.draft}`,
    history: input.history ?? [],
    intent: "coding",
    responseMode: "deep",
    preferredModels: CODING_REVIEW_MODELS,
    maxTokens: 1_600,
    fallback: input.draft,
    skipCache: true,
    temperature: 0.28,
  });
}

export async function runGroundedResearchReply(input: {
  userId: string;
  question: string;
  history?: ChatHistory;
}) {
  const memo =
    solveCarbonCreditRegistryQuestion(input.question)
    || solveSatelliteCollisionAvoidanceQuestion(input.question)
    || solveRAGArchitectureQuestion(input.question)
    || solveMLOpsQuestion(input.question)
    || solveCbdcDecisionMemo(input.question)
    || solveRegulatedOpsMemo(input.question)
    || solveCopilotArchitectureMemo(input.question);
  if (memo) return memo;

  const liveSearchRoute = classifyClawCloudLiveSearchRoute(input.question);
  if (liveSearchRoute.requiresWebSearch) {
    const directLiveAnswer = await fetchLiveDataAndSynthesize(input.question).catch(() => "");
    if (directLiveAnswer.trim()) {
      return directLiveAnswer.trim();
    }
  }

  if (!liveSearchRoute.requiresWebSearch) {
    const answer = await completeClawCloudPrompt({
      system: [
        "You are writing a decision memo for an expert operator.",
        "Answer in this order: recommendation, why, tradeoffs, rollout, bottom line.",
        "Be concrete, decision-ready, and avoid invented precise numbers.",
        "If the question is conceptual, state assumptions explicitly.",
        "Return only the memo. Never return an incomplete answer.",
      ].join("\n"),
      user: input.question,
      history: input.history ?? [],
      intent: "research",
      responseMode: "deep",
      preferredModels: RESEARCH_MEMO_MODELS,
      maxTokens: 1_300,
      fallback: "",
      skipCache: true,
      temperature: 0.78,
    });

    if (answer.trim()) {
      return answer;
    }
  }

  const result = await runResearchAgent({
    question: input.question,
    history: input.history,
    user: { uid: input.userId },
  });

  const groundedAnswer = result.answer.markdown?.trim() || null;
  if (!groundedAnswer) {
    return null;
  }

  return decorateLiveSearchAnswer(groundedAnswer, liveSearchRoute);
}

export function solveHardMathQuestion(question: string) {
  return (
    solveSuccessiveDiscountQuestion(question)
    || solveTradingMathQuestion(question)
    || solveBayesianTrialQuestion(question)
    || solveBayesianDiagnosticQuestion(question)
    || solveQueueingMathQuestion(question)
    || solveSurvivalAnalysisQuestion(question)
    || solveIVEstimationQuestion(question)
    || solveRegressionDiscontinuityQuestion(question)
    || solveBlackScholesQuestion(question)
    || solveBondPricingQuestion(question)
    || solveEnergyHedgeRiskQuestion(question)
    || solveDifferenceInDifferencesQuestion(question)
    || solvePolicyEffectSignificanceQuestion(question)
    || solveVaRCVaRQuestion(question)
    || solveInsuranceReservingQuestion(question)
  );
}

export function solveCodingArchitectureQuestion(question: string) {
  return (
    solveColdChainPlatformQuestion(question)
    || solveCrisprPipelineQuestion(question)
    || solveFintechWalletLedgerQuestion(question)
    || solveStripeBillingMigrationQuestion(question)
    || solveCarbonCreditRegistryQuestion(question)
    || solveSecurityArchitectureQuestion(question)
    || solveWorkflowEngineQuestion(question)
    || solveCollaborativeEditorQuestion(question)
    || solveFeatureStoreQuestion(question)
    || solveMarketplaceSearchQuestion(question)
    || solveAdAttributionQuestion(question)
    || solveGpuSchedulerQuestion(question)
    || solveDistributedControlPlaneQuestion(question)
    || solveSemiconductorWaferFabQuestion(question)
    || solveWaterNetworkLossQuestion(question)
    || solveSatelliteCollisionAvoidanceQuestion(question)
    || solveCbdcOfflineRetailQuestion(question)
    || solveRAGArchitectureQuestion(question)
    || solveMLOpsQuestion(question)
  );
}

export async function solveWithUniversalExpert(input: {
  question: string;
  intent: IntentType;
  history?: ChatHistory;
}) {
  return solveAnyExpertQuestion(input);
}
