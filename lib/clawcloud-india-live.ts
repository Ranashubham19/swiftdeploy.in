import { formatFinanceReply, getLiveFinanceData } from "@/lib/clawcloud-finance";
import { matchesWholeAlias } from "@/lib/clawcloud-intent-match";

const FETCH_TIMEOUT_MS = 8_000;
const IRCTC_API_HOST = "irctc1.p.rapidapi.com";

const NSE_SYMBOL_MAP: Record<string, string> = {
  "hdfc bank": "HDFCBANK.NS",
  hdfcbank: "HDFCBANK.NS",
  sbi: "SBIN.NS",
  "state bank": "SBIN.NS",
  "icici bank": "ICICIBANK.NS",
  icicibank: "ICICIBANK.NS",
  "axis bank": "AXISBANK.NS",
  "kotak bank": "KOTAKBANK.NS",
  "kotak mahindra": "KOTAKBANK.NS",
  "yes bank": "YESBANK.NS",
  "indusind bank": "INDUSINDBK.NS",
  "bajaj finance": "BAJFINANCE.NS",
  "bajaj finserv": "BAJAJFINSV.NS",
  tcs: "TCS.NS",
  "tata consultancy": "TCS.NS",
  infosys: "INFY.NS",
  infy: "INFY.NS",
  wipro: "WIPRO.NS",
  "hcl tech": "HCLTECH.NS",
  "hcl technologies": "HCLTECH.NS",
  "tech mahindra": "TECHM.NS",
  ltimindtree: "LTIM.NS",
  reliance: "RELIANCE.NS",
  ril: "RELIANCE.NS",
  "adani enterprises": "ADANIENT.NS",
  "adani ports": "ADANIPORTS.NS",
  "adani green": "ADANIGREEN.NS",
  "tata motors": "TATAMOTORS.NS",
  "tata steel": "TATASTEEL.NS",
  "tata power": "TATAPOWER.NS",
  ongc: "ONGC.NS",
  ntpc: "NTPC.NS",
  "power grid": "POWERGRID.NS",
  "coal india": "COALINDIA.NS",
  "hindustan unilever": "HINDUNILVR.NS",
  hul: "HINDUNILVR.NS",
  itc: "ITC.NS",
  "nestle india": "NESTLEIND.NS",
  britannia: "BRITANNIA.NS",
  dabur: "DABUR.NS",
  marico: "MARICO.NS",
  maruti: "MARUTI.NS",
  "maruti suzuki": "MARUTI.NS",
  "bajaj auto": "BAJAJ-AUTO.NS",
  "hero motocorp": "HEROMOTOCO.NS",
  mahindra: "M&M.NS",
  "m&m": "M&M.NS",
  "eicher motors": "EICHERMOT.NS",
  "sun pharma": "SUNPHARMA.NS",
  "dr reddy": "DRREDDY.NS",
  "dr. reddy": "DRREDDY.NS",
  cipla: "CIPLA.NS",
  "divi's lab": "DIVISLAB.NS",
  "bharti airtel": "BHARTIARTL.NS",
  airtel: "BHARTIARTL.NS",
  jio: "RELIANCE.NS",
  nifty: "^NSEI",
  "nifty 50": "^NSEI",
  nifty50: "^NSEI",
  sensex: "^BSESN",
  "bse sensex": "^BSESN",
  "bank nifty": "^NSEBANK",
  banknifty: "^NSEBANK",
  midcap: "^NSEMDCP50",
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

type TrainScheduleStop = {
  station_name?: string;
  stationCode?: string;
  station_code?: string;
  state_name?: string;
  day?: string | number;
  arrival_time?: string;
  departure_time?: string;
  halt_time?: string;
  distance_from_source?: string | number;
  stop?: boolean;
};

type TrainSchedule = {
  trainName?: string;
  trainNumber?: string;
  train_name?: string;
  train_number?: string;
  from?: string;
  to?: string;
  from_station_name?: string;
  to_station_name?: string;
  source?: string;
  destination?: string;
  route?: TrainScheduleStop[];
};

type RapidTrainResult<T> = {
  data: T | null;
  status: number | null;
};

export function detectIndianStockQuery(message: string): string | null {
  const normalized = message.toLowerCase().trim();
  const suffixTickerMatch = message.match(/\b([A-Za-z]{2,20}\.(?:NS|BO))\s*(?:share|stock|price|quote)\b/i);
  if (suffixTickerMatch) {
    return suffixTickerMatch[1].toUpperCase();
  }

  const uppercaseTickerMatch = message.match(/\b([A-Z]{2,20})\s*(?:share|stock|price|quote)\b/);
  if (uppercaseTickerMatch) {
    const ticker = uppercaseTickerMatch[1].toUpperCase();
    if (ticker === "NIFTY") {
      return "^NSEI";
    }
    if (ticker === "SENSEX") {
      return "^BSESN";
    }
    if (ticker === "BANKNIFTY") {
      return "^NSEBANK";
    }
    return NSE_SYMBOL_MAP[ticker.toLowerCase()] ?? ticker;
  }

  for (const [key, symbol] of Object.entries(NSE_SYMBOL_MAP)) {
    if (
      matchesWholeAlias(normalized, key)
      && /\b(share|stock|price|today|live|quote|target|buy|sell|invest)\b/.test(normalized)
    ) {
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
  const currencySymbol = quote.currency === "INR" ? "Rs " : "$";
  const arrow = quote.change >= 0 ? "[UP]" : "[DOWN]";
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
  lines.push("_Not financial advice. Verify before investing._");

  return lines.join("\n");
}

export async function answerIndianStockQuery(message: string): Promise<string | null> {
  const symbol = detectIndianStockQuery(message);
  if (!symbol) {
    return null;
  }

  const quote = await fetchYahooQuote(symbol);
  if (quote) {
    return formatStockReply(quote);
  }

  const financeFallback = await getLiveFinanceData(message).catch(() => null);
  if (financeFallback) {
    return formatFinanceReply(financeFallback);
  }

  return [
    `Live market data for ${symbol} is unavailable right now.`,
    "",
    "Yahoo market data looks temporarily delayed right now.",
    "Please retry in a minute or share the exact NSE/BSE ticker.",
    "Markets are open Mon-Fri 9:15 AM - 3:30 PM IST.",
  ].join("\n");
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
  if (/\b(schedule|timetable|time table|departure|arrival|platform)\b/.test(normalized) && trainMatch) {
    return { type: "schedule", value: trainMatch[1] };
  }

  if (trainMatch && /\b(train|running|live|status|where is)\b/.test(normalized)) {
    return { type: "running", value: trainMatch[1] };
  }

  if (/\b(where is|running status|live status)\b/.test(normalized) && /\b(express|mail|rajdhani|shatabdi|duronto|vande bharat|superfast)\b/.test(normalized)) {
    const nameMatch = message.match(/([A-Z][a-zA-Z\s]+(?:express|mail|rajdhani|shatabdi|duronto|vande bharat|superfast))/i);
    return { type: "running", value: nameMatch?.[1]?.trim() ?? "" };
  }

  return { type: null, value: "" };
}

async function fetchPnrStatus(pnr: string): Promise<RapidTrainResult<PnrStatus>> {
  const apiKey = process.env.RAPIDAPI_KEY?.trim();
  if (!apiKey) {
    return { data: null, status: null };
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
      return { data: null, status: response.status };
    }

    const data = await response.json() as { data?: PnrStatus };
    return { data: data.data ?? null, status: response.status };
  } catch {
    return { data: null, status: null };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTrainRunningStatus(trainNumber: string): Promise<RapidTrainResult<TrainStatus>> {
  const apiKey = process.env.RAPIDAPI_KEY?.trim();
  if (!apiKey) {
    return { data: null, status: null };
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
      return { data: null, status: response.status };
    }

    const data = await response.json() as { data?: TrainStatus };
    return { data: data.data ?? null, status: response.status };
  } catch {
    return { data: null, status: null };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTrainSchedule(trainNumber: string): Promise<RapidTrainResult<TrainSchedule>> {
  const apiKey = process.env.RAPIDAPI_KEY?.trim();
  if (!apiKey) {
    return { data: null, status: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`https://${IRCTC_API_HOST}/api/v1/getTrainSchedule?trainNo=${trainNumber}`, {
      signal: controller.signal,
      headers: {
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": IRCTC_API_HOST,
      },
    });

    if (!response.ok) {
      return { data: null, status: response.status };
    }

    const payload = await response.json() as { data?: TrainSchedule };
    return { data: payload.data ?? null, status: response.status };
  } catch {
    return { data: null, status: null };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeScheduleTime(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^(n\/?a|source|dest|destination|--|00:00)$/i.test(trimmed)) return null;
  return trimmed;
}

function normalizeScheduleStation(stop?: TrainScheduleStop | null): string | null {
  const name = stop?.station_name?.trim()
    || stop?.stationCode?.trim()
    || stop?.station_code?.trim();
  return name || null;
}

function formatScheduleTiming(stop?: TrainScheduleStop | null, edge: "origin" | "destination" | "mid" = "mid"): string {
  if (!stop) return "Timing not available";

  const arrival = normalizeScheduleTime(stop.arrival_time);
  const departure = normalizeScheduleTime(stop.departure_time);
  const halt = normalizeScheduleTime(stop.halt_time);
  const day = stop.day ? `Day ${stop.day}` : null;

  if (edge === "origin") {
    return [departure ? `Departure ${departure}` : null, day].filter(Boolean).join(" | ") || "Departure time not available";
  }

  if (edge === "destination") {
    return [arrival ? `Arrival ${arrival}` : null, day].filter(Boolean).join(" | ") || "Arrival time not available";
  }

  return [
    arrival ? `Arrival ${arrival}` : null,
    departure ? `Departure ${departure}` : null,
    halt ? `Halt ${halt}` : null,
    day,
  ].filter(Boolean).join(" | ") || "Timing not available";
}

function formatTrainScheduleReply(schedule: TrainSchedule, trainNumber: string): string {
  const route = (schedule.route ?? []).filter((stop) => stop && (stop.stop !== false));
  const originStop = route[0] ?? null;
  const destinationStop = route.length ? route[route.length - 1] : null;
  const trainName = schedule.trainName || schedule.train_name || "Train";
  const resolvedTrainNumber = schedule.trainNumber || schedule.train_number || trainNumber;
  const originStation = schedule.from || schedule.from_station_name || schedule.source || normalizeScheduleStation(originStop) || "Origin station unavailable";
  const destinationStation = schedule.to || schedule.to_station_name || schedule.destination || normalizeScheduleStation(destinationStop) || "Destination station unavailable";

  const majorStops = route
    .filter((stop, index) => index > 0 && index < route.length - 1)
    .filter((stop) => normalizeScheduleStation(stop) && (normalizeScheduleTime(stop.arrival_time) || normalizeScheduleTime(stop.departure_time)))
    .slice(0, 3);

  return [
    `Train Schedule: ${trainName} (${resolvedTrainNumber})`,
    "",
    `*Origin station:* ${originStation}`,
    `*Departure:* ${formatScheduleTiming(originStop, "origin")}`,
    `*Destination station:* ${destinationStation}`,
    `*Arrival:* ${formatScheduleTiming(destinationStop, "destination")}`,
    "",
    "*Major timings:*",
    ...(majorStops.length
      ? majorStops.map((stop) => `- *${normalizeScheduleStation(stop)}:* ${formatScheduleTiming(stop)}`)
      : ["- Major intermediate station timings were not returned by the provider."]),
    "",
    "_Schedule data via IRCTC provider._",
  ].join("\n");
}

function formatPnrReply(pnr: PnrStatus): string {
  const statusIcon = (status: string) => {
    if (/confirm|cnf/i.test(status)) {
      return "[CONFIRMED]";
    }
    if (/wait/i.test(status)) {
      return "[WAITLIST]";
    }
    if (/rac/i.test(status)) {
      return "[RAC]";
    }
    return "[STATUS]";
  };

  return [
    `Train PNR Status: ${pnr.pnr}`,
    "",
    `*Train:* ${pnr.trainName} (${pnr.trainNumber})`,
    `*Route:* ${pnr.from} -> ${pnr.to}`,
    `*Date:* ${pnr.doj}`,
    `*Chart:* ${pnr.chartStatus}`,
    "",
    "*Passengers:*",
    ...pnr.passengers.map((passenger) =>
      `- ${statusIcon(passenger.currentStatus)} Pax ${passenger.number}: ${passenger.currentStatus} (was: ${passenger.bookingStatus}) | Coach: ${passenger.coach} | Berth: ${passenger.berth}`,
    ),
  ].join("\n");
}

function formatTrainRunningReply(status: TrainStatus): string {
  const delay = status.delay ?? 0;
  const delayLabel = delay === 0 ? "On time" : `Late by ${delay} min`;

  return [
    `Train Status: ${status.trainName} (${status.trainNumber})`,
    "",
    `*Route:* ${status.from} -> ${status.to}`,
    status.currentStation ? `*Currently at:* ${status.currentStation}` : "",
    `*Running status:* ${delayLabel}`,
    status.runningStatus ? `*Details:* ${status.runningStatus}` : "",
    "",
    "_Live data from IRCTC_",
  ].filter(Boolean).join("\n");
}

function buildTrainFallbackReply(
  type: "pnr" | "running" | "schedule",
  value: string,
  status: number | null,
) {
  const statusHint =
    status === 429
      ? "The live train provider has likely hit its free-tier quota for now."
      : status === 400
        ? (
          type === "schedule"
            ? `I could not get a usable schedule response for train ${value} from the rail provider.`
            : "The train input looks invalid or the provider rejected the start-day details."
        )
        : status === 403 || status === 401
          ? "The live train provider is currently rejecting API access."
          : (
            type === "schedule"
              ? `I could not get live schedule details for train ${value} from the rail provider right now.`
              : "Live train data is temporarily unavailable from the provider."
          );

  const actionLine =
    type === "pnr"
      ? `Use the same PNR ${value} on enquiry.indianrail.gov.in for an official check.`
      : type === "schedule"
        ? `Use train number ${value} on NTES or enquiry.indianrail.gov.in to check the origin station, destination station, departure time, and major arrival timings.`
        : `Use train number ${value} on the NTES app or enquiry.indianrail.gov.in/live to confirm the latest running status.`;

  return [
    "Train status update",
    "",
    statusHint,
    actionLine,
    "",
    "Official fallbacks:",
    "- NTES app (Indian Railways official)",
    "- enquiry.indianrail.gov.in",
    "- RailMadad or station enquiry if you are already travelling",
  ].join("\n");
}

export async function answerTrainQuery(message: string): Promise<string | null> {
  const detected = detectTrainIntent(message);
  if (!detected.type) {
    return null;
  }

  const apiKey = process.env.RAPIDAPI_KEY?.trim();
  if (!apiKey) {
    return [
      "Train & PNR status",
      "",
      "To check PNR or train status live, I need the IRCTC API configured.",
      "In the meantime, check at:",
      "- NTES app (Indian Railways official)",
      "- enquiry.indianrail.gov.in",
      "- Where Is My Train",
    ].join("\n");
  }

  if (detected.type === "pnr") {
    const result = await fetchPnrStatus(detected.value);
    return result.data
      ? formatPnrReply(result.data)
      : buildTrainFallbackReply("pnr", detected.value, result.status);
  }

  if (detected.type === "running" && detected.value) {
    const result = await fetchTrainRunningStatus(detected.value);
    return result.data
      ? formatTrainRunningReply(result.data)
      : buildTrainFallbackReply("running", detected.value, result.status);
  }

  if (detected.type === "schedule" && detected.value) {
    const result = await fetchTrainSchedule(detected.value);
    return result.data
      ? formatTrainScheduleReply(result.data, detected.value)
      : buildTrainFallbackReply("schedule", detected.value, result.status);
  }

  return null;
}
