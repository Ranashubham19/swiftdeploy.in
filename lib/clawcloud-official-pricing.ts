import { load as loadHtml } from "cheerio";

type OfficialPricingProvider = "openai_api" | "stripe" | "vercel" | "supabase";

export type OfficialPricingQuery = {
  provider: OfficialPricingProvider;
  target?: string;
};

type OfficialPageText = {
  sourceUrl: string;
  resolvedUrl: string;
  text: string;
};

type OpenAiPriceRow = {
  model: string;
  input: string;
  cachedInput: string;
  output: string;
};

const FETCH_TIMEOUT_MS = 8_000;
const PRICING_SIGNAL = /\b(pricing|price|prices|plan|plans|cost|costs|fee|fees|billing|subscription|per month|monthly|usage credit|token pricing|input price|output price)\b/i;
const PLAN_SIGNAL = /\b(free|hobby|pro|team|enterprise)\b/i;
const COMPARISON_SIGNAL = /\b(compare|comparison|difference between|vs\.?|versus)\b/i;
const PRICING_BUILD_CONTEXT_SIGNAL =
  /\b(build|design|implement|create|develop|code|architect|wireframe|prototype|mockup|template|landing page|pricing page|checkout flow|schema|migration|integration|component|ui)\b/i;

const OPENAI_API_SIGNAL = /\bopenai\b.*\b(api|token|model|gpt)\b|\bgpt[- ]?5(?:\.\d+)?(?:\s+(?:mini|nano))?\b/i;
const OPENAI_UNSUPPORTED_SIGNAL = /\b(chatgpt plus|chatgpt pro|chatgpt team|chatgpt enterprise|sora|dall[- ]?e|realtime|audio|voice|transcription|whisper)\b/i;
const STRIPE_SIGNAL = /\bstripe\b/i;
const STRIPE_UNSUPPORTED_SIGNAL = /\b(connect|terminal|billing|atlas|tax|radar|issuing|treasury|identity|climate)\b/i;
const VERCEL_SIGNAL = /\bvercel\b/i;
const VERCEL_UNSUPPORTED_SIGNAL = /\b(blob|edge config|speed insights|web analytics|observability|monitoring|workflow|sandbox|functions|fluid compute|waf|botid|firewall|data transfer)\b/i;
const SUPABASE_SIGNAL = /\bsupabase\b/i;
const SUPABASE_UNSUPPORTED_SIGNAL = /\b(pitr|point in time recovery|ipv4|custom domain|log drain|advanced mfa|compute add-?on|storage add-?on)\b/i;

const OPENAI_API_URLS = ["https://openai.com/api/pricing/"];
const STRIPE_PRICING_URLS = ["https://stripe.com/pricing", "https://stripe.com/us/pricing"];
const VERCEL_PRICING_URLS = ["https://vercel.com/pricing"];
const SUPABASE_PRICING_URLS = [
  "https://supabase.com/docs/guides/platform/billing-faq",
  "https://supabase.com/docs/guides/platform/billing-on-supabase",
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeWhitespace(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function cleanHtmlToText(raw: string) {
  const $ = loadHtml(raw);
  $("script, style, noscript, svg").remove();
  return normalizeWhitespace($("body").text());
}

function cleanReaderText(raw: string) {
  return normalizeWhitespace(raw);
}

async function fetchTextWithTimeout(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "text/html, text/plain;q=0.9",
        "User-Agent": "Mozilla/5.0 (compatible; ClawCloud/1.0)",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const text = await response.text();
    return {
      resolvedUrl: response.url || url,
      text,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildReaderMirrorUrl(url: string) {
  return `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`;
}

async function fetchOfficialPageText(urls: string[]): Promise<OfficialPageText | null> {
  for (const sourceUrl of urls) {
    const direct = await fetchTextWithTimeout(sourceUrl);
    if (direct) {
      const cleaned = cleanHtmlToText(direct.text);
      if (cleaned.length >= 200) {
        return {
          sourceUrl,
          resolvedUrl: direct.resolvedUrl,
          text: cleaned,
        };
      }
    }

    const mirror = await fetchTextWithTimeout(buildReaderMirrorUrl(sourceUrl));
    if (mirror) {
      const cleaned = cleanReaderText(mirror.text);
      if (cleaned.length >= 200) {
        return {
          sourceUrl,
          resolvedUrl: mirror.resolvedUrl,
          text: cleaned,
        };
      }
    }
  }

  return null;
}

function formatSearchedDate() {
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date());
}

function detectOpenAiTarget(question: string) {
  if (/\bgpt[- ]?5\.4\s+nano\b/i.test(question)) return "GPT-5.4 nano";
  if (/\bgpt[- ]?5\.4\s+mini\b/i.test(question)) return "GPT-5.4 mini";
  if (/\bgpt[- ]?5\.4\b/i.test(question)) return "GPT-5.4";
  return "";
}

function detectPlanTarget(question: string) {
  if (/\bhobby\b/i.test(question)) return "Hobby";
  if (/\bpro\b/i.test(question)) return "Pro";
  if (/\bteam\b/i.test(question)) return "Team";
  if (/\benterprise\b/i.test(question)) return "Enterprise";
  if (/\bfree\b/i.test(question)) return "Free";
  return "";
}

export function detectOfficialPricingQuery(question: string): OfficialPricingQuery | null {
  const text = question.trim();
  if (!text) return null;
  if (COMPARISON_SIGNAL.test(text)) {
    return null;
  }

  const hasPricingSignal = PRICING_SIGNAL.test(text) || PLAN_SIGNAL.test(text);
  if (!hasPricingSignal) {
    return null;
  }

  if (PRICING_BUILD_CONTEXT_SIGNAL.test(text) && /\b(openai|gpt|stripe|vercel|supabase)\b/i.test(text)) {
    return null;
  }

  if (OPENAI_API_SIGNAL.test(text) && !OPENAI_UNSUPPORTED_SIGNAL.test(text)) {
    const target = detectOpenAiTarget(text);
    return target ? { provider: "openai_api", target } : { provider: "openai_api" };
  }

  if (STRIPE_SIGNAL.test(text) && !STRIPE_UNSUPPORTED_SIGNAL.test(text)) {
    return { provider: "stripe" };
  }

  if (VERCEL_SIGNAL.test(text) && !VERCEL_UNSUPPORTED_SIGNAL.test(text)) {
    const target = detectPlanTarget(text);
    return target ? { provider: "vercel", target } : { provider: "vercel" };
  }

  if (SUPABASE_SIGNAL.test(text) && !SUPABASE_UNSUPPORTED_SIGNAL.test(text)) {
    const target = detectPlanTarget(text);
    return target ? { provider: "supabase", target } : { provider: "supabase" };
  }

  return null;
}

function parseOpenAiRows(text: string): OpenAiPriceRow[] {
  const rows: OpenAiPriceRow[] = [];
  const pattern = /(GPT-[0-9.]+(?:\s+(?:mini|nano))?)[\s\S]{0,260}?Input:\s*(\$[0-9.,]+(?:\s*\/\s*1M\s*tokens)?)[\s\S]{0,120}?Cached input:\s*(\$[0-9.,]+(?:\s*\/\s*1M\s*tokens)?)[\s\S]{0,120}?Output:\s*(\$[0-9.,]+(?:\s*\/\s*1M\s*tokens)?)/gi;
  for (const match of text.matchAll(pattern)) {
    const model = match[1]?.trim();
    const input = match[2]?.trim();
    const cachedInput = match[3]?.trim();
    const output = match[4]?.trim();
    if (!model || !input || !cachedInput || !output) continue;
    rows.push({ model, input, cachedInput, output });
  }
  return rows;
}

function buildOpenAiPricingReply(page: OfficialPageText, question: string) {
  const rows = parseOpenAiRows(page.text);
  if (!rows.length) {
    return "";
  }

  const target = detectOpenAiTarget(question);
  const targetRow = target
    ? rows.find((row) => row.model.toLowerCase() === target.toLowerCase())
    : null;

  const lines = targetRow
    ? [
      `*${targetRow.model} pricing (official)*`,
      "",
      `- Input: ${targetRow.input}`,
      `- Cached input: ${targetRow.cachedInput}`,
      `- Output: ${targetRow.output}`,
    ]
    : [
      "*OpenAI API pricing (official)*",
      "",
      ...rows.slice(0, 3).flatMap((row) => [
        `- ${row.model}: input ${row.input}, cached input ${row.cachedInput}, output ${row.output}`,
      ]),
    ];

  lines.push(
    "",
    "*Source*",
    "- OpenAI API pricing",
    `- Searched: ${formatSearchedDate()}`,
  );

  return lines.join("\n");
}

function parseStripeLocale(resolvedUrl: string) {
  const match = resolvedUrl.match(/stripe\.com\/([a-z]{2}(?:-[a-z]{2})?)\/pricing/i);
  return match?.[1]?.toUpperCase() ?? "";
}

function buildStripePricingReply(page: OfficialPageText) {
  const domestic =
    page.text.match(/([0-9.]+%\s*\+\s*[^\s]+)\s+(?:per successful card charge\s+for\s+)?domestic cards/i)?.[1]
    ?? page.text.match(/domestic cards[\s\S]{0,80}?([0-9.]+%\s*\+\s*[^\s]+)/i)?.[1]
    ?? "";
  const international =
    page.text.match(/([0-9.]+%\s*\+\s*[^\s]+)\s+(?:per successful card charge\s+for\s+)?international cards/i)?.[1]
    ?? page.text.match(/international cards[\s\S]{0,80}?([0-9.]+%\s*\+\s*[^\s]+)/i)?.[1]
    ?? "";
  const hasNoMonthlyFees = /no setup fees?,\s*monthly fees?,?\s*or hidden fees/i.test(page.text);
  const hasCustomPricing = /\bcustom pricing\b|\btalk to sales\b|\bdesigned for businesses with large payments volume\b/i.test(page.text);
  const locale = parseStripeLocale(page.resolvedUrl);

  if (!domestic && !international && !hasNoMonthlyFees) {
    return "";
  }

  const lines = [
    "*Stripe pricing (official page summary)*",
    "",
    "- Stripe localizes pricing by region.",
  ];

  if (locale) {
    lines.push(`- Locale retrieved: ${locale}`);
  }
  if (domestic) {
    lines.push(`- Domestic cards: ${domestic}`);
  }
  if (international) {
    lines.push(`- International cards: ${international}`);
  }
  if (hasNoMonthlyFees) {
    lines.push("- No setup fees, monthly fees, or hidden fees on the standard pricing page.");
  }
  if (hasCustomPricing) {
    lines.push("- Custom pricing is available for larger businesses.");
  }

  lines.push(
    "",
    "*Source*",
    "- Stripe pricing",
    `- Searched: ${formatSearchedDate()}`,
  );

  return lines.join("\n");
}

function buildVercelPricingReply(page: OfficialPageText, question: string) {
  const hobby = page.text.match(/\bHobby\b[\s\S]{0,120}?\bFree forever\b/i)?.[0] ? "Free forever" : "";
  const pro = page.text.match(/(\$[0-9,]+\s*\/\s*mo\s*\+\s*additional usage)/i)?.[1] ?? "";
  const proCredit = page.text.match(/(\$[0-9,]+ of included usage credit)/i)?.[1] ?? "";
  const hasEnterpriseCustom = /\bEnterprise\b[\s\S]{0,180}?(get a demo|request trial|custom)/i.test(page.text);
  const target = detectPlanTarget(question);

  if (!hobby && !pro && !hasEnterpriseCustom) {
    return "";
  }

  const lines = ["*Vercel pricing (official)*", ""];

  if (target === "Hobby" && hobby) {
    lines.push(`- Hobby: ${hobby}`);
  } else if (target === "Pro" && pro) {
    lines.push(`- Pro: ${pro}`);
    if (proCredit) {
      lines.push(`- Pro includes: ${proCredit}`);
    }
  } else if (target === "Enterprise" && hasEnterpriseCustom) {
    lines.push("- Enterprise: custom pricing via sales/demo.");
  } else {
    if (hobby) lines.push(`- Hobby: ${hobby}`);
    if (pro) lines.push(`- Pro: ${pro}`);
    if (proCredit) lines.push(`- Pro includes: ${proCredit}`);
    if (hasEnterpriseCustom) lines.push("- Enterprise: custom pricing via sales/demo.");
  }

  lines.push(
    "",
    "*Source*",
    "- Vercel pricing",
    `- Searched: ${formatSearchedDate()}`,
  );

  return lines.join("\n");
}

function buildSupabasePricingReply(page: OfficialPageText, question: string) {
  const hasPlanList = /\bFree,\s*Pro,\s*Team(?: or|,)\s*Enterprise\b/i.test(page.text);
  const proPrice = page.text.match(/\$25\s+Pro Plan/i)?.[0] ? "$25/month" : "";
  const computeCredits = page.text.match(/\$10\s+in\s+Compute\s+Credits/i)?.[0] ? "$10 in compute credits" : "";
  const extraProjects = page.text.match(/additional projects start at ~?\$10 a month/i)?.[0] ? "Additional projects start at about $10/month on the default compute size." : "";
  const target = detectPlanTarget(question);

  if (!hasPlanList && !proPrice && !computeCredits && !extraProjects) {
    return "";
  }

  const lines = ["*Supabase pricing (official billing docs)*", ""];

  if (target === "Pro" && proPrice) {
    lines.push(`- Pro: ${proPrice}`);
  } else if (target && target !== "Pro") {
    if (hasPlanList) {
      lines.push("- Plans listed in the official docs: Free, Pro, Team, Enterprise.");
    }
    lines.push(`- Exact ${target} pricing was not explicitly quoted on the official billing docs page I retrieved.`);
  } else {
    if (hasPlanList) {
      lines.push("- Plans: Free, Pro, Team, Enterprise.");
    }
    if (proPrice) {
      lines.push(`- Pro: ${proPrice}`);
    }
  }

  if (computeCredits) {
    lines.push(`- Paid orgs include: ${computeCredits}.`);
  }
  if (extraProjects) {
    lines.push(`- ${extraProjects}`);
  }

  lines.push(
    "",
    "*Source*",
    "- Supabase official billing docs",
    `- Searched: ${formatSearchedDate()}`,
  );

  return lines.join("\n");
}

export async function fetchOfficialPricingAnswer(question: string): Promise<string> {
  const detected = detectOfficialPricingQuery(question);
  if (!detected) {
    return "";
  }

  if (detected.provider === "openai_api") {
    const page = await fetchOfficialPageText(OPENAI_API_URLS);
    return page ? buildOpenAiPricingReply(page, question) : "";
  }

  if (detected.provider === "stripe") {
    const page = await fetchOfficialPageText(STRIPE_PRICING_URLS);
    return page ? buildStripePricingReply(page) : "";
  }

  if (detected.provider === "vercel") {
    const page = await fetchOfficialPageText(VERCEL_PRICING_URLS);
    return page ? buildVercelPricingReply(page, question) : "";
  }

  if (detected.provider === "supabase") {
    const page = await fetchOfficialPageText(SUPABASE_PRICING_URLS);
    return page ? buildSupabasePricingReply(page, question) : "";
  }

  return "";
}
