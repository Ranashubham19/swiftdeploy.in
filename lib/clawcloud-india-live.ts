const FETCH_TIMEOUT_MS = 8_000;
const IRCTC_API_HOST = "irctc1.p.rapidapi.com";

const NSE_SYMBOL_MAP: Record<string, string> = {
  "hdfc bank": "HDFCBANK.NS",
  "hdfcbank": "HDFCBANK.NS",
  "sbi": "SBIN.NS",
  "state bank": "SBIN.NS",
  "icici bank": "ICICIBANK.NS",
  "icicibank": "ICICIBANK.NS",
  "axis bank": "AXISBANK.NS",
  "kotak bank": "KOTAKBANK.NS",
  "kotak mahindra": "KOTAKBANK.NS",
  "yes bank": "YESBANK.NS",
  "indusind bank": "INDUSINDBK.NS",
  "bajaj finance": "BAJFINANCE.NS",
  "bajaj finserv": "BAJAJFINSV.NS",
  "tcs": "TCS.NS",
  "tata consultancy": "TCS.NS",
  "infosys": "INFY.NS",
  "infy": "INFY.NS",
  "wipro": "WIPRO.NS",
  "hcl tech": "HCLTECH.NS",
  "hcl technologies": "HCLTECH.NS",
  "tech mahindra": "TECHM.NS",
  "ltimindtree": "LTIM.NS",
  "reliance": "RELIANCE.NS",
  "ril": "RELIANCE.NS",
  "adani enterprises": "ADANIENT.NS",
  "adani ports": "ADANIPORTS.NS",
  "adani green": "ADANIGREEN.NS",
  "tata motors": "TATAMOTORS.NS",
  "tata steel": "TATASTEEL.NS",
  "tata power": "TATAPOWER.NS",
  "ongc": "ONGC.NS",
  "ntpc": "NTPC.NS",
  "power grid": "POWERGRID.NS",
  "coal india": "COALINDIA.NS",
  "hindustan unilever": "HINDUNILVR.NS",
  "hul": "HINDUNILVR.NS",
  "itc": "ITC.NS",
  "nestle india": "NESTLEIND.NS",
  "britannia": "BRITANNIA.NS",
  "dabur": "DABUR.NS",
  "marico": "MARICO.NS",
  "maruti": "MARUTI.NS",
  "maruti suzuki": "MARUTI.NS",
  "bajaj auto": "BAJAJ-AUTO.NS",
  "hero motocorp": "HEROMOTOCO.NS",
  "mahindra": "M&M.NS",
  "m&m": "M&M.NS",
  "eicher motors": "EICHERMOT.NS",
  "sun pharma": "SUNPHARMA.NS",
  "dr reddy": "DRREDDY.NS",
  "dr. reddy": "DRREDDY.NS",
  "cipla": "CIPLA.NS",
  "divi's lab": "DIVISLAB.NS",
  "bharti airtel": "BHARTIARTL.NS",
  "airtel": "BHARTIARTL.NS",
  "jio": "RELIANCE.NS",
  "nifty": "^NSEI",
  "nifty 50": "^NSEI",
  "nifty50": "^NSEI",
  "sensex": "^BSESN",
  "bse sensex": "^BSESN",
  "bank nifty": "^NSEBANK",
  "banknifty": "^NSEBANK",
  "midcap": "^NSEMDCP50",
};

type StockQuote = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  high: number;
  low: number;
  volume: number;
  marketCap?: number;
  exchange: string;
  currency: string;
  asOf: string;
};

type PnrStatus = {
  pnr: string;
  trainName: string;
  trainNumber: string;
  from: string;
  to: string;
  doj: string;
  chartStatus: string;
  passengers: Array<{
    number: number;
    bookingStatus: string;
    currentStatus: string;
    coach: string;
    berth: string;
  }>;
};

type TrainStatus = {
  trainName: string;
  trainNumber: string;
  from: string;
  to: string;
  currentStation?: string;
  delay?: number;
  runningStatus?: string;
};

export function detectIndianStockQuery(message: string): string | null {
  const normalized = message.toLowerCase().trim();
  const suffixTickerMatch = message.match(/\b([A-Za-z]{2,20}\.(?:NS|BO))\s*(?:share|stock|price|quote)\b/i);
  if (suffixTickerMatch) {
    return suffixTickerMatch[1].toUpperCase();
  }

  const uppercaseTickerMatch = message.match(/\b([A-Z]{2,20})\s*(?:share|stock|price|quote)\b/);
  if (uppercaseTickerMatch) {
    return uppercaseTickerMatch[1].toUpperCase();
  }

  for (const [key, symbol] of Object.entries(NSE_SYMBOL_MAP)) {
    if (normalized.includes(key) && /\b(share|stock|price|today|live|quote|target|buy|sell|invest)\b/.test(normalized)) {
      return symbol;
    }
  }

  if (/\b(nifty|sensex|banknifty|bank nifty)\b/.test(normalized)) {
    if (/sensex/.test(normalized)) {
      return "^BSESN";
    }
    if (/bank nifty|banknifty/.test(normalized)) {
      return "^NSEBANK";
    }
    return "^NSEI";
  }

  return null;
}

async function fetchYahooQuote(symbol: string): Promise<StockQuote | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ClawCloud/1.0)" },
    });

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
            longName?: string;
            shortName?: string;
            exchangeName?: string;
            currency?: string;
            regularMarketTime?: number;
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
    const change = price - previousClose;
    const changePct = previousClose ? (change / previousClose) * 100 : 0;

    return {
      symbol,
      name: meta.longName ?? meta.shortName ?? symbol,
      price,
      change,
      changePct,
      high: meta.regularMarketDayHigh ?? price,
      low: meta.regularMarketDayLow ?? price,
      volume: meta.regularMarketVolume ?? 0,
      marketCap: meta.marketCap,
      exchange: meta.exchangeName ?? "NSE",
      currency: meta.currency ?? "INR",
      asOf: meta.regularMarketTime
        ? new Date(meta.regularMarketTime * 1000).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
            timeZone: "Asia/Kolkata",
          })
        : "N/A",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function formatStockReply(quote: StockQuote): string {
  const currencySymbol = quote.currency === "INR" ? "₹" : "$";
  const arrow = quote.change >= 0 ? "📈" : "📉";
  const sign = quote.change >= 0 ? "+" : "";
  const isIndex = quote.symbol.startsWith("^");
  const formatNum = (value: number) => {
    if (value >= 10_000_000) {
      return `${currencySymbol}${(value / 10_000_000).toFixed(2)} Cr`;
    }
    if (value >= 100_000) {
      return `${currencySymbol}${(value / 100_000).toFixed(2)} L`;
    }
    return `${currencySymbol}${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  };

  const lines = [
    `${arrow} *${quote.name}*`,
    `${isIndex ? "Index" : "Exchange"}: ${quote.exchange}`,
    "",
    `*Price:* ${currencySymbol}${quote.price.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`,
    `*Change:* ${sign}${currencySymbol}${Math.abs(quote.change).toFixed(2)} (${sign}${quote.changePct.toFixed(2)}%)`,
    `*Day Range:* ${currencySymbol}${quote.low.toLocaleString("en-IN", { maximumFractionDigits: 2 })} - ${currencySymbol}${quote.high.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`,
  ];

  if (!isIndex && quote.volume > 0) {
    lines.push(`*Volume:* ${(quote.volume / 1_000).toFixed(0)}K`);
  }

  if (quote.marketCap && !isIndex) {
    lines.push(`*Market Cap:* ${formatNum(quote.marketCap)}`);
  }

  lines.push("");
  lines.push(`_As of ${quote.asOf} IST_`);
  lines.push("⚠️ _Not financial advice. Verify before investing._");

  return lines.join("\n");
}

export async function answerIndianStockQuery(message: string): Promise<string | null> {
  const symbol = detectIndianStockQuery(message);
  if (!symbol) {
    return null;
  }

  const quote = await fetchYahooQuote(symbol);
  if (!quote) {
    return [
      `📊 *Could not fetch live data for ${symbol}*`,
      "",
      "NSE/BSE data may be delayed. Try again in a moment.",
      "Markets are open Mon-Fri 9:15 AM - 3:30 PM IST.",
    ].join("\n");
  }

  return formatStockReply(quote);
}

export function detectTrainIntent(message: string): { type: "pnr" | "running" | "schedule" | null; value: string } {
  const normalized = message.toLowerCase().trim();
  const pnrMatch = message.match(/\b(\d{10})\b/);
  if (pnrMatch && /\b(pnr|ticket|booking|status)\b/.test(normalized)) {
    return { type: "pnr", value: pnrMatch[1] };
  }

  if (pnrMatch && !message.match(/\b\d{11,}\b/)) {
    return { type: "pnr", value: pnrMatch[1] };
  }

  const trainMatch = message.match(/\b(\d{5})\b/);
  if (trainMatch && /\b(train|running|live|status|where is)\b/.test(normalized)) {
    return { type: "running", value: trainMatch[1] };
  }

  if (/\b(where is|running status|live status)\b/.test(normalized) && /\b(express|mail|rajdhani|shatabdi|duronto|vande bharat|superfast)\b/.test(normalized)) {
    const nameMatch = message.match(/([A-Z][a-zA-Z\s]+(?:express|mail|rajdhani|shatabdi|duronto|vande bharat|superfast))/i);
    return { type: "running", value: nameMatch?.[1]?.trim() ?? "" };
  }

  if (/\b(schedule|timetable|time table|departure|arrival|platform)\b/.test(normalized) && trainMatch) {
    return { type: "schedule", value: trainMatch[1] };
  }

  return { type: null, value: "" };
}

async function fetchPnrStatus(pnr: string): Promise<PnrStatus | null> {
  const apiKey = process.env.RAPIDAPI_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`https://${IRCTC_API_HOST}/api/v3/getPNRStatus?pnrNumber=${pnr}`, {
      signal: controller.signal,
      headers: {
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": IRCTC_API_HOST,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { data?: PnrStatus };
    return data.data ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTrainRunningStatus(trainNumber: string): Promise<TrainStatus | null> {
  const apiKey = process.env.RAPIDAPI_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`https://${IRCTC_API_HOST}/api/v1/liveTrainStatus?trainNo=${trainNumber}&startDay=1`, {
      signal: controller.signal,
      headers: {
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": IRCTC_API_HOST,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { data?: TrainStatus };
    return data.data ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function formatPnrReply(pnr: PnrStatus): string {
  const statusIcon = (status: string) => {
    if (/confirm|cnf/i.test(status)) {
      return "✅";
    }
    if (/wait/i.test(status)) {
      return "⏳";
    }
    if (/rac/i.test(status)) {
      return "🔶";
    }
    return "❓";
  };

  return [
    `🚂 *PNR Status: ${pnr.pnr}*`,
    "",
    `*Train:* ${pnr.trainName} (${pnr.trainNumber})`,
    `*Route:* ${pnr.from} -> ${pnr.to}`,
    `*Date:* ${pnr.doj}`,
    `*Chart:* ${pnr.chartStatus}`,
    "",
    "*Passengers:*",
    ...pnr.passengers.map((passenger) =>
      `  ${statusIcon(passenger.currentStatus)} Pax ${passenger.number}: ${passenger.currentStatus} (was: ${passenger.bookingStatus}) | Coach: ${passenger.coach} | Berth: ${passenger.berth}`
    ),
  ].join("\n");
}

function formatTrainRunningReply(status: TrainStatus): string {
  const delay = status.delay ?? 0;
  const delayLabel = delay === 0 ? "On time ✅" : `Late by ${delay} min ⚠️`;

  return [
    `🚂 *Train Status: ${status.trainName} (${status.trainNumber})*`,
    "",
    `*Route:* ${status.from} -> ${status.to}`,
    status.currentStation ? `*Currently at:* ${status.currentStation}` : "",
    `*Running status:* ${delayLabel}`,
    status.runningStatus ? `*Details:* ${status.runningStatus}` : "",
    "",
    "_Live data from IRCTC_",
  ].filter(Boolean).join("\n");
}

export async function answerTrainQuery(message: string): Promise<string | null> {
  const detected = detectTrainIntent(message);
  if (!detected.type) {
    return null;
  }

  const apiKey = process.env.RAPIDAPI_KEY?.trim();
  if (!apiKey) {
    return [
      "🚂 *Train & PNR status*",
      "",
      "To check PNR or train status live, I need the IRCTC API configured.",
      "In the meantime, check at:",
      "• *NTES app* (Indian Railways official)",
      "• *enquiry.indianrail.gov.in*",
      "• *WhereIsMyTrain app* by Google",
    ].join("\n");
  }

  if (detected.type === "pnr") {
    const status = await fetchPnrStatus(detected.value);
    return status
      ? formatPnrReply(status)
      : `❌ *Could not fetch PNR ${detected.value}.*\n\nThe PNR may be invalid or data is temporarily unavailable. Check at enquiry.indianrail.gov.in`;
  }

  if (detected.type === "running" && detected.value) {
    const status = await fetchTrainRunningStatus(detected.value);
    return status
      ? formatTrainRunningReply(status)
      : `❌ *Could not fetch live status for train ${detected.value}.*\n\nCheck the NTES app or enquiry.indianrail.gov.in`;
  }

  return null;
}
