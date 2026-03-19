const FETCH_TIMEOUT_MS = 8_000;
const YAHOO_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";
const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3";
const EXCHANGE_RATE_BASE_URL = "https://open.er-api.com/v6/latest";

export type FinanceResult = {
  symbol: string;
  name: string;
  price: number;
  currency: string;
  secondaryPrices?: Array<{ currency: string; price: number }>;
  change: number;
  changePct: number;
  high24h?: number;
  low24h?: number;
  volume?: number;
  marketCap?: number;
  exchange?: string;
  asOf: string;
  source: string;
};

type FinanceQueryType =
  | "stock_india"
  | "stock_us"
  | "crypto"
  | "index"
  | "forex"
  | "commodity";

type FinanceQuery = {
  type: FinanceQueryType;
  query: string;
};

const CRYPTO_IDS: Record<string, string> = {
  bitcoin: "bitcoin",
  btc: "bitcoin",
  ethereum: "ethereum",
  eth: "ethereum",
  solana: "solana",
  sol: "solana",
  bnb: "binancecoin",
  binance: "binancecoin",
  xrp: "ripple",
  ripple: "ripple",
  cardano: "cardano",
  ada: "cardano",
  dogecoin: "dogecoin",
  doge: "dogecoin",
  polygon: "matic-network",
  matic: "matic-network",
  usdt: "tether",
  tether: "tether",
  usdc: "usd-coin",
  shib: "shiba-inu",
  "shiba inu": "shiba-inu",
  avax: "avalanche-2",
  avalanche: "avalanche-2",
  dot: "polkadot",
  polkadot: "polkadot",
  link: "chainlink",
  chainlink: "chainlink",
  ltc: "litecoin",
  litecoin: "litecoin",
};

const INDEX_SYMBOLS: Record<string, string> = {
  "nifty 50": "^NSEI",
  nifty: "^NSEI",
  nifty50: "^NSEI",
  sensex: "^BSESN",
  "bse sensex": "^BSESN",
  nasdaq: "^IXIC",
  "nasdaq composite": "^IXIC",
  "s&p 500": "^GSPC",
  sp500: "^GSPC",
  "s&p": "^GSPC",
  "dow jones": "^DJI",
  dow: "^DJI",
  djia: "^DJI",
  "ftse 100": "^FTSE",
  ftse: "^FTSE",
  nikkei: "^N225",
  "nikkei 225": "^N225",
  "hang seng": "^HSI",
  dax: "^GDAXI",
  "cac 40": "^FCHI",
  vix: "^VIX",
  "bank nifty": "^NSEBANK",
  banknifty: "^NSEBANK",
  midcap: "^NSEMDCP50",
};

const FOREX_PAIRS: Record<string, [string, string]> = {
  "usd to inr": ["USD", "INR"],
  "dollar to rupee": ["USD", "INR"],
  "dollar rate": ["USD", "INR"],
  "rupee rate": ["USD", "INR"],
  "inr to usd": ["INR", "USD"],
  "rupee to dollar": ["INR", "USD"],
  "eur to inr": ["EUR", "INR"],
  "euro to rupee": ["EUR", "INR"],
  "gbp to inr": ["GBP", "INR"],
  "pound to rupee": ["GBP", "INR"],
  "usd to eur": ["USD", "EUR"],
  "dollar to euro": ["USD", "EUR"],
  "eur to usd": ["EUR", "USD"],
  "euro to dollar": ["EUR", "USD"],
  "usd to gbp": ["USD", "GBP"],
  "jpy to inr": ["JPY", "INR"],
  "yen to rupee": ["JPY", "INR"],
  "aed to inr": ["AED", "INR"],
  "dirham to rupee": ["AED", "INR"],
  "sgd to inr": ["SGD", "INR"],
  "aud to inr": ["AUD", "INR"],
  "cad to inr": ["CAD", "INR"],
};

const COMMODITY_SYMBOLS: Record<string, string> = {
  gold: "GC=F",
  "gold price": "GC=F",
  silver: "SI=F",
  "silver price": "SI=F",
  "crude oil": "CL=F",
  oil: "CL=F",
  wti: "CL=F",
  brent: "BZ=F",
  "brent crude": "BZ=F",
  "natural gas": "NG=F",
  copper: "HG=F",
  platinum: "PL=F",
};

const INDIA_STOCK_ALIASES: Record<string, string> = {
  reliance: "RELIANCE",
  tcs: "TCS",
  infosys: "INFY",
  "hdfc bank": "HDFCBANK",
  "icici bank": "ICICIBANK",
  sbi: "SBIN",
  "state bank of india": "SBIN",
  "tata motors": "TATAMOTORS",
  itc: "ITC",
};

const US_STOCK_ALIASES: Record<string, string> = {
  apple: "AAPL",
  tesla: "TSLA",
  microsoft: "MSFT",
  google: "GOOGL",
  alphabet: "GOOGL",
  amazon: "AMZN",
  nvidia: "NVDA",
  meta: "META",
  facebook: "META",
  netflix: "NFLX",
};

function hasPriceSignal(question: string) {
  return (
    /\b(price|rate|value|worth|cost|trading|nav|market cap|how much is|what is .{0,40} (worth|value|price|rate)|today|current|live|now)\b/i.test(question)
    || /\b(usd|inr|eur|gbp|dollar|rupee|euro|pound)\b/i.test(question)
  );
}

export function detectFinanceQuery(question: string): FinanceQuery | null {
  const lower = question.toLowerCase().trim();

  if (
    !hasPriceSignal(lower)
    && !/\b(stock|share|crypto|bitcoin|ethereum|forex|exchange rate|sensex|nifty|nasdaq|dow|gold|silver|oil)\b/i.test(lower)
  ) {
    return null;
  }

  for (const [name] of Object.entries(INDEX_SYMBOLS)) {
    if (lower.includes(name)) {
      return { type: "index", query: name };
    }
  }

  for (const name of Object.keys(CRYPTO_IDS)) {
    if (lower.includes(name)) {
      return { type: "crypto", query: name };
    }
  }

  for (const pair of Object.keys(FOREX_PAIRS)) {
    if (lower.includes(pair)) {
      return { type: "forex", query: pair };
    }
  }

  for (const [name] of Object.entries(COMMODITY_SYMBOLS)) {
    if (lower.includes(name)) {
      return { type: "commodity", query: name };
    }
  }

  for (const [name, symbol] of Object.entries(INDIA_STOCK_ALIASES)) {
    if (lower.includes(name)) {
      return { type: "stock_india", query: symbol };
    }
  }

  for (const [name, symbol] of Object.entries(US_STOCK_ALIASES)) {
    if (lower.includes(name)) {
      return { type: "stock_us", query: symbol };
    }
  }

  const indiaMatch =
    lower.match(/\b([a-z]{2,15})\s+(?:share|stock|nse|bse)\b/i)
    ?? lower.match(/\b(?:share|stock)\s+(?:of|price of)?\s+([a-z]{2,15})\b/i);
  if (indiaMatch?.[1]) {
    return { type: "stock_india", query: indiaMatch[1].toUpperCase() };
  }

  const usTickerMatch =
    lower.match(/\b([a-z]{1,5})\s+(?:nasdaq|nyse)\b/i)
    ?? lower.match(/\b(?:ticker|symbol)\s+([a-z]{1,5})\b/i);
  if (usTickerMatch?.[1]) {
    return { type: "stock_us", query: usTickerMatch[1].toUpperCase() };
  }

  return null;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function yahooFinanceQuote(symbols: string[]): Promise<FinanceResult[]> {
  try {
    const url = new URL(YAHOO_QUOTE_URL);
    url.searchParams.set("symbols", symbols.join(","));

    const response = await fetchWithTimeout(url.toString(), {
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; ClawCloud/1.0)",
      },
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as {
      quoteResponse?: {
        result?: Array<{
          symbol?: string;
          shortName?: string;
          longName?: string;
          regularMarketPrice?: number;
          regularMarketChange?: number;
          regularMarketChangePercent?: number;
          regularMarketDayHigh?: number;
          regularMarketDayLow?: number;
          regularMarketVolume?: number;
          marketCap?: number;
          currency?: string;
          fullExchangeName?: string;
        }>;
      };
    };

    return (data.quoteResponse?.result ?? [])
      .filter((entry) => entry.symbol && entry.regularMarketPrice != null)
      .map((entry) => ({
        symbol: entry.symbol ?? "",
        name: entry.shortName ?? entry.longName ?? entry.symbol ?? "",
        price: entry.regularMarketPrice ?? 0,
        currency: entry.currency ?? "USD",
        change: entry.regularMarketChange ?? 0,
        changePct: entry.regularMarketChangePercent ?? 0,
        high24h: entry.regularMarketDayHigh,
        low24h: entry.regularMarketDayLow,
        volume: entry.regularMarketVolume,
        marketCap: entry.marketCap,
        exchange: entry.fullExchangeName,
        asOf: new Date().toISOString(),
        source: "Yahoo Finance",
      }));
  } catch {
    return [];
  }
}

async function yahooFinanceChartQuote(symbol: string): Promise<FinanceResult | null> {
  try {
    const response = await fetchWithTimeout(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
      {
        headers: {
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; ClawCloud/1.0)",
        },
      },
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      chart?: {
        result?: Array<{
          meta?: {
            regularMarketPrice?: number;
            previousClose?: number;
            regularMarketDayHigh?: number;
            regularMarketDayLow?: number;
            regularMarketVolume?: number;
            marketCap?: number;
            currency?: string;
            exchangeName?: string;
            shortName?: string;
            longName?: string;
            regularMarketTime?: number;
            symbol?: string;
          };
        }>;
      };
    };

    const meta = data.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) {
      return null;
    }

    const price = meta.regularMarketPrice;
    const previousClose = meta.previousClose ?? price;

    return {
      symbol: meta.symbol ?? symbol,
      name: meta.shortName ?? meta.longName ?? meta.symbol ?? symbol,
      price,
      currency: meta.currency ?? "USD",
      change: price - previousClose,
      changePct: previousClose ? ((price - previousClose) / previousClose) * 100 : 0,
      high24h: meta.regularMarketDayHigh,
      low24h: meta.regularMarketDayLow,
      volume: meta.regularMarketVolume,
      marketCap: meta.marketCap,
      exchange: meta.exchangeName,
      asOf: meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000).toISOString()
        : new Date().toISOString(),
      source: "Yahoo Finance (chart)",
    };
  } catch {
    return null;
  }
}

function sortFinanceResultsBySymbolOrder(symbols: string[], results: FinanceResult[]) {
  const order = new Map(symbols.map((symbol, index) => [symbol.toUpperCase(), index]));
  return [...results].sort((a, b) => {
    const left = order.get(a.symbol.toUpperCase()) ?? Number.MAX_SAFE_INTEGER;
    const right = order.get(b.symbol.toUpperCase()) ?? Number.MAX_SAFE_INTEGER;
    return left - right;
  });
}

async function getBestYahooQuotes(symbols: string[]): Promise<FinanceResult[]> {
  const uniqueSymbols = [...new Set(symbols.filter(Boolean))];
  if (uniqueSymbols.length === 0) {
    return [];
  }

  const primaryQuotes = await yahooFinanceQuote(uniqueSymbols);
  if (primaryQuotes.length > 0) {
    return sortFinanceResultsBySymbolOrder(uniqueSymbols, primaryQuotes);
  }

  const fallbackQuotes = await Promise.all(uniqueSymbols.map((symbol) => yahooFinanceChartQuote(symbol)));
  return sortFinanceResultsBySymbolOrder(
    uniqueSymbols,
    fallbackQuotes.filter((quote): quote is FinanceResult => quote !== null),
  );
}

function expandIndianStockSymbols(symbol: string): string[] {
  const normalized = symbol.toUpperCase().replace(/\.(NS|BO)$/i, "");
  return [`${normalized}.NS`, `${normalized}.BO`, normalized];
}

async function coinGeckoPrice(
  coinId: string,
  preferredCurrency: "usd" | "inr" = "usd",
): Promise<FinanceResult | null> {
  try {
    const response = await fetchWithTimeout(
      `${COINGECKO_BASE_URL}/coins/${coinId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`,
      {
        headers: {
          "Accept": "application/json",
        },
      },
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      name?: string;
      symbol?: string;
      market_data?: {
        current_price?: Record<string, number>;
        price_change_24h?: number;
        price_change_percentage_24h?: number;
        high_24h?: Record<string, number>;
        low_24h?: Record<string, number>;
        total_volume?: Record<string, number>;
        market_cap?: Record<string, number>;
      };
    };

    const marketData = data.market_data;
    if (!marketData?.current_price) {
      return null;
    }

    const fallbackCurrency = marketData.current_price.usd != null ? "usd" : "inr";
    const key = marketData.current_price[preferredCurrency] != null
      ? preferredCurrency
      : fallbackCurrency;
    const currency = key.toUpperCase();
    const secondaryPrices = [
      marketData.current_price.usd != null
        ? { currency: "USD", price: marketData.current_price.usd }
        : null,
      marketData.current_price.inr != null
        ? { currency: "INR", price: marketData.current_price.inr }
        : null,
    ].filter((entry): entry is { currency: string; price: number } => Boolean(entry))
      .filter((entry) => entry.currency !== currency);

    return {
      symbol: (data.symbol ?? coinId).toUpperCase(),
      name: data.name ?? coinId,
      price: marketData.current_price[key] ?? 0,
      currency,
      secondaryPrices,
      change: marketData.price_change_24h ?? 0,
      changePct: marketData.price_change_percentage_24h ?? 0,
      high24h: marketData.high_24h?.[key],
      low24h: marketData.low_24h?.[key],
      volume: marketData.total_volume?.[key],
      marketCap: marketData.market_cap?.[key],
      asOf: new Date().toISOString(),
      source: "CoinGecko",
    };
  } catch {
    return null;
  }
}

async function fetchForexRate(from: string, to: string): Promise<FinanceResult | null> {
  try {
    const response = await fetchWithTimeout(`${EXCHANGE_RATE_BASE_URL}/${from}`);
    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      result?: string;
      rates?: Record<string, number>;
      time_last_update_utc?: string;
    };

    if (data.result !== "success" || !data.rates?.[to]) {
      return null;
    }

    return {
      symbol: `${from}/${to}`,
      name: `${from} to ${to}`,
      price: data.rates[to],
      currency: to,
      change: 0,
      changePct: 0,
      asOf: data.time_last_update_utc ?? new Date().toISOString(),
      source: "ExchangeRate-API",
    };
  } catch {
    const fallback = await getBestYahooQuotes([`${from}${to}=X`]);
    return fallback[0] ?? null;
  }
}

export async function getLiveFinanceData(question: string): Promise<FinanceResult | null> {
  const detected = detectFinanceQuery(question);
  if (!detected) {
    return null;
  }

  try {
    switch (detected.type) {
      case "crypto": {
        const coinId = CRYPTO_IDS[detected.query.toLowerCase()];
        const prefersInr = /\b(inr|rupee|rs\.?|₹)\b/i.test(question) && !/\b(usd|dollar|\$)\b/i.test(question);
        return coinId ? await coinGeckoPrice(coinId, prefersInr ? "inr" : "usd") : null;
      }
      case "index": {
        const symbol = INDEX_SYMBOLS[detected.query.toLowerCase()];
        const quotes = symbol ? await getBestYahooQuotes([symbol]) : [];
        return quotes[0] ?? null;
      }
      case "forex": {
        const pair = FOREX_PAIRS[detected.query.toLowerCase()];
        return pair ? await fetchForexRate(pair[0], pair[1]) : null;
      }
      case "commodity": {
        const symbol = COMMODITY_SYMBOLS[detected.query.toLowerCase()];
        const quotes = symbol ? await getBestYahooQuotes([symbol]) : [];
        return quotes[0] ?? null;
      }
      case "stock_india": {
        const quotes = await getBestYahooQuotes(expandIndianStockSymbols(detected.query));
        return quotes[0] ?? null;
      }
      case "stock_us": {
        const quotes = await getBestYahooQuotes([detected.query.toUpperCase()]);
        return quotes[0] ?? null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function formatFinanceReply(result: FinanceResult): string {
  const positive = result.changePct >= 0;
  const arrow = positive ? "\u{1F4C8}" : "\u{1F4C9}";
  const sign = positive ? "+" : "";
  const asOf = new Date(result.asOf).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const fetchedAt = new Date();
  const fetchedTime = fetchedAt.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const fetchedDate = fetchedAt.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const currencySymbol = symbolForCurrency(result.currency);

  const lines: string[] = [
    `${arrow} *${result.name}* (${result.symbol})`,
    "",
    `\u{1F4B0} *Price:* ${currencySymbol}${formatNumber(result.price, result.currency)}`,
    `\u{1F4CA} *Change:* ${sign}${currencySymbol}${formatNumber(Math.abs(result.change), result.currency)} (${sign}${result.changePct.toFixed(2)}%)`,
  ];

  if (result.secondaryPrices?.length) {
    for (const quote of result.secondaryPrices.slice(0, 2)) {
      lines.push(`\u{1F504} *Also in ${quote.currency}:* ${symbolForCurrency(quote.currency)}${formatNumber(quote.price, quote.currency)}`);
    }
  }

  if (result.high24h != null && result.low24h != null) {
    lines.push(`\u{1F4C8} *Day High:* ${currencySymbol}${formatNumber(result.high24h, result.currency)}`);
    lines.push(`\u{1F4C9} *Day Low:* ${currencySymbol}${formatNumber(result.low24h, result.currency)}`);
  }

  if (result.volume != null && result.volume > 0) {
    lines.push(`\u{1F4E6} *Volume:* ${formatVolume(result.volume)}`);
  }

  if (result.marketCap != null && result.marketCap > 0) {
    lines.push(`\u{1F3E6} *Market Cap:* ${formatMarketCap(result.marketCap, result.currency)}`);
  }

  if (result.exchange) {
    lines.push("");
    lines.push(`_Exchange: ${result.exchange}_`);
  }

  lines.push(`\u{1F4E1} _Live data as of ${asOf} IST - ${result.source}_`);
  lines.push(`_Data fetched: ${fetchedTime} IST, ${fetchedDate}_`);
  lines.push("\u26A0\uFE0F _Not financial advice. Verify on NSE/BSE or other official sources before any financial decision._");
  return lines.join("\n");
}

function symbolForCurrency(currency: string) {
  if (currency === "INR") return "\u20B9";
  if (currency === "USD") return "$";
  if (currency === "EUR") return "\u20AC";
  if (currency === "GBP") return "\u00A3";
  return `${currency} `;
}

function formatNumber(value: number, currency: string) {
  if (currency === "INR" && value >= 10_000_000) {
    return `${(value / 10_000_000).toFixed(2)} Cr`;
  }
  if (currency === "INR" && value >= 100_000) {
    return `${(value / 100_000).toFixed(2)} L`;
  }
  if (value >= 1_000) {
    return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }
  if (value < 0.01) {
    return value.toFixed(8);
  }
  if (value < 1) {
    return value.toFixed(4);
  }
  return value.toFixed(2);
}

function formatVolume(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toLocaleString("en-IN");
}

function formatMarketCap(value: number, currency: string) {
  const symbol = symbolForCurrency(currency);
  if (value >= 1_000_000_000_000) return `${symbol}${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `${symbol}${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(2)}M`;
  return `${symbol}${value.toLocaleString("en-IN")}`;
}
