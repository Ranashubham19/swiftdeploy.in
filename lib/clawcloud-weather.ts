import { normalizeRegionalQuestion } from "@/lib/clawcloud-region-context";

type WttrResponse = {
  current_condition?: Array<{
    temp_C?: string;
    FeelsLikeC?: string;
    humidity?: string;
    windspeedKmph?: string;
    weatherDesc?: Array<{ value?: string }>;
    visibility?: string;
  }>;
  nearest_area?: Array<{
    areaName?: Array<{ value?: string }>;
    country?: Array<{ value?: string }>;
  }>;
  weather?: Array<{
    maxtempC?: string;
    mintempC?: string;
    hourly?: Array<{ chanceofrain?: string }>;
  }>;
};

type OpenMeteoGeocodeResponse = {
  results?: Array<{
    name?: string;
    country?: string;
    country_code?: string;
    admin1?: string;
    timezone?: string;
    latitude?: number;
    longitude?: number;
    population?: number;
    feature_code?: string;
  }>;
};

type OpenMeteoForecastResponse = {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    weather_code?: number;
  };
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
  };
  hourly?: {
    precipitation_probability?: number[];
  };
};

const WEATHER_LOCATION_CORRECTIONS: Record<string, string> = {
  dehli: "Delhi",
  dehradun: "Dehradun",
  dilli: "Delhi",
  delhi: "Delhi",
  bangaluru: "Bangalore",
  bengaluru: "Bangalore",
  banglore: "Bangalore",
  bangalor: "Bangalore",
  mumbai: "Mumbai",
  bombay: "Mumbai",
  kolkatta: "Kolkata",
  calcutta: "Kolkata",
  madras: "Chennai",
  chennai: "Chennai",
  hydrabad: "Hyderabad",
  hyderbad: "Hyderabad",
  pune: "Pune",
  lucknow: "Lucknow",
  jaipur: "Jaipur",
  ahmedabad: "Ahmedabad",
  ahemdabad: "Ahmedabad",
  chandigarh: "Chandigarh",
  chandighar: "Chandigarh",
  noida: "Noida",
  gurgaon: "Gurugram",
  gurugram: "Gurugram",
  // International common misspellings
  newyork: "New York",
  "new york": "New York",
  losangeles: "Los Angeles",
  sanfrancisco: "San Francisco",
  london: "London",
  londn: "London",
  tokio: "Tokyo",
  pekin: "Beijing",
  bejing: "Beijing",
  moskow: "Moscow",
  moscu: "Moscow",
  instanbul: "Istanbul",
  istambul: "Istanbul",
  duabi: "Dubai",
  dubay: "Dubai",
  singapur: "Singapore",
  sydny: "Sydney",
  melbrone: "Melbourne",
  bangkok: "Bangkok",
  karachi: "Karachi",
  lahore: "Lahore",
  islamabad: "Islamabad",
  dhaka: "Dhaka",
  dacca: "Dhaka",
  kathmandu: "Kathmandu",
  colombo: "Colombo",
};

const DIRECT_WEATHER_TERMS = [
  "weather",
  "whether",
  "temperature",
  "temperatures",
  "temp",
  "temprature",
  "temparature",
  "tempertature",
  "temperture",
  "forecast",
  "climate",
  "humidity",
  "wind",
  "rain",
  "rainfall",
  "feels like",
  "mausam",
  "\u092e\u094c\u0938\u092e",
  "clima",
  "tiempo",
  "meteo",
  "m\u00e9t\u00e9o",
  "wetter",
  "temperatura",
  "temp\u00e9rature",
  "\u0924\u093e\u092a\u092e\u093e\u0928",
  // Turkish
  "hava durumu",
  "hava",
  "s\u0131cakl\u0131k",
  // Arabic
  "\u0637\u0642\u0633",
  "\u062d\u0631\u0627\u0631\u0629",
  "\u062c\u0648",
  // Korean
  "\ub0a0\uc528",
  "\uae30\uc628",
  // Japanese
  "\u5929\u6c17",
  "\u6c17\u6e29",
  // Chinese
  "\u5929\u6c14",
  "\u6c14\u6e29",
  // Thai
  "\u0e2d\u0e32\u0e01\u0e32\u0e28",
  "\u0e2d\u0e38\u0e13\u0e2b\u0e20\u0e39\u0e21\u0e34",
  // Russian
  "\u043f\u043e\u0433\u043e\u0434\u0430",
  "\u0442\u0435\u043c\u043f\u0435\u0440\u0430\u0442\u0443\u0440\u0430",
  // Bengali
  "\u0986\u09ac\u09b9\u09be\u0993\u09af\u09bc\u09be",
  // Tamil
  "\u0b95\u0bbe\u0bb2\u0ba8\u0bbf\u0bb2\u0bc8",
  // Telugu
  "\u0c35\u0c3e\u0c24\u0c3e\u0c35\u0c30\u0c23\u0c02",
  // Urdu
  "\u0645\u0648\u0633\u0645",
  // Persian
  "\u0622\u0628 \u0648 \u0647\u0648\u0627",
  // Indonesian/Malay
  "cuaca",
  "suhu",
  // Vietnamese
  "th\u1eddi ti\u1ebft",
  "nhi\u1ec7t \u0111\u1ed9",
  // Swahili
  "hali ya hewa",
] as const;

const WEATHER_OR_AIR_QUALITY_TERMS = [
  ...DIRECT_WEATHER_TERMS,
  "aqi",
  "air quality",
] as const;

const DIRECT_WEATHER_TERM_SOURCE = DIRECT_WEATHER_TERMS.join("|");
const WEATHER_OR_AIR_QUALITY_TERM_SOURCE = WEATHER_OR_AIR_QUALITY_TERMS.join("|");
const DIRECT_WEATHER_NON_LATIN_PATTERNS = [
  /\u092e\u094c\u0938\u092e/u,
  /\u0924\u093e\u092a\u092e\u093e\u0928/u,
  /\u0637\u0642\u0633/u, /\u062d\u0631\u0627\u0631\u0629/u, /\u062c\u0648/u,
  /\ub0a0\uc528/u, /\uae30\uc628/u,
  /\u5929\u6c17/u, /\u6c17\u6e29/u,
  /\u5929\u6c14/u, /\u6c14\u6e29/u,
  /\u0e2d\u0e32\u0e01\u0e32\u0e28/u, /\u0e2d\u0e38\u0e13\u0e2b\u0e20\u0e39\u0e21\u0e34/u,
  /\u043f\u043e\u0433\u043e\u0434\u0430/u, /\u0442\u0435\u043c\u043f\u0435\u0440\u0430\u0442\u0443\u0440\u0430/u,
  /\u0986\u09ac\u09b9\u09be\u0993\u09af\u09bc\u09be/u,
  /\u0b95\u0bbe\u0bb2\u0ba8\u0bbf\u0bb2\u0bc8/u,
  /\u0c35\u0c3e\u0c24\u0c3e\u0c35\u0c30\u0c23\u0c02/u,
  /\u0645\u0648\u0633\u0645/u,
  /\u0622\u0628 \u0648 \u0647\u0648\u0627/u,
];
const WEATHER_TIME_REFERENCE_SOURCE = [
  "today", "now", "right now", "currently", "tonight",
  "hoy", "ahora", "maintenant", "aujourd'hui",
  "\u0906\u091c", "\u0905\u092d\u0940",
  "\uc624\ub298", "\uc9c0\uae08",
  "\u4eca\u65e5", "\u4eca",
  "\u4eca\u5929", "\u73b0\u5728",
  "\u0627\u0644\u064a\u0648\u0645", "\u0627\u0644\u0622\u0646",
  "bug\u00fcn", "\u015fimdi",
  "\u0441\u0435\u0433\u043e\u0434\u043d\u044f", "\u0441\u0435\u0439\u0447\u0430\u0441",
  "\u0e27\u0e31\u0e19\u0e19\u0e35\u0e49",
  "h\u00f4m nay",
].join("|");
const WEATHER_LOCATION_CONNECTOR_SOURCE = [
  "in",
  "at",
  "of",
  "for",
  "en",
  "de",
  "del",
  "da",
  "do",
  "mein",
  "\u092e\u0947\u0902",
  "ka",
  "ki",
  "ke",
  "\u0915\u093e",
  "\u0915\u0940",
  "\u0915\u0947",
].join("|");
const WEATHER_CITY_CAPTURE = "([\\p{L}][\\p{L}\\p{M}\\s.'-]{1,40})";

export const DIRECT_WEATHER_KEYWORD_PATTERN = new RegExp(`\\b(?:${DIRECT_WEATHER_TERM_SOURCE})\\b`, "i");
export const WEATHER_OR_AIR_QUALITY_KEYWORD_PATTERN = new RegExp(`\\b(?:${WEATHER_OR_AIR_QUALITY_TERM_SOURCE})\\b`, "i");

export function looksLikeCreativeWeatherPrompt(text: string) {
  return (
    /\b(write|create|compose|generate|draft)\b/.test(text)
    && /\b(poem|haiku|sonnet|limerick|story|lyrics|song|caption|verse)\b/.test(text)
  );
}

export function looksLikeDirectWeatherQuestion(text: string) {
  const normalized = normalizeRegionalQuestion(text.normalize("NFKC")).toLowerCase().trim();
  return normalized.length > 0
    && !looksLikeCreativeWeatherPrompt(normalized)
    && (
      DIRECT_WEATHER_KEYWORD_PATTERN.test(normalized)
      || DIRECT_WEATHER_NON_LATIN_PATTERNS.some((pattern) => pattern.test(normalized))
    );
}

export function looksLikeWeatherOrAirQualityQuestion(text: string) {
  const normalized = normalizeRegionalQuestion(text.normalize("NFKC")).toLowerCase().trim();
  return normalized.length > 0
    && !looksLikeCreativeWeatherPrompt(normalized)
    && (
      WEATHER_OR_AIR_QUALITY_KEYWORD_PATTERN.test(normalized)
      || DIRECT_WEATHER_NON_LATIN_PATTERNS.some((pattern) => pattern.test(normalized))
    );
}

function titleCaseLocation(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export function normalizeWeatherLocationName(value: string, requestedCity?: string) {
  const normalized = value.trim();
  if (!normalized) {
    return requestedCity?.trim() || normalized;
  }

  const corrected = WEATHER_LOCATION_CORRECTIONS[normalized.toLowerCase()];
  if (corrected) {
    return corrected;
  }

  const requested = requestedCity?.trim();
  if (!requested) {
    return normalized;
  }

  const requestedCorrected = WEATHER_LOCATION_CORRECTIONS[requested.toLowerCase()];
  if (requestedCorrected && requestedCorrected.toLowerCase() === normalized.toLowerCase()) {
    return requestedCorrected;
  }

  return normalized;
}

function normalizeWeatherLocationKey(value: string, requestedCity?: string) {
  return normalizeWeatherLocationName(value, requestedCity)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function weatherLocationFeatureBonus(featureCode: string | null | undefined) {
  switch ((featureCode ?? "").toUpperCase()) {
    case "PPLC":
      return 120;
    case "PPLA":
    case "PPLA2":
    case "PPLA3":
    case "PPLA4":
      return 90;
    case "PPL":
    case "PPLL":
    case "PPLX":
      return 60;
    default:
      return 0;
  }
}

function weatherLocationPopulationBonus(population: number | null | undefined) {
  if (!Number.isFinite(population) || (population ?? 0) <= 0) {
    return 0;
  }

  return Math.min(80, Math.round(Math.log10((population ?? 0) + 1) * 12));
}

function scoreOpenMeteoWeatherLocationCandidate(
  candidate: NonNullable<OpenMeteoGeocodeResponse["results"]>[number],
  requestedCity: string,
) {
  const requestedKey = normalizeWeatherLocationKey(requestedCity, requestedCity);
  const nameKey = normalizeWeatherLocationKey(candidate.name ?? "", requestedCity);
  const adminKey = normalizeWeatherLocationKey(candidate.admin1 ?? "", requestedCity);
  const timezoneCityKey = normalizeWeatherLocationKey(
    (candidate.timezone ?? "").split("/").pop()?.replace(/_/g, " ") ?? "",
    requestedCity,
  );

  let score = weatherLocationFeatureBonus(candidate.feature_code)
    + weatherLocationPopulationBonus(candidate.population);

  if (nameKey && requestedKey) {
    if (nameKey === requestedKey) {
      score += 1_000;
    } else if (
      nameKey.startsWith(`${requestedKey} `)
      || nameKey.endsWith(` ${requestedKey}`)
      || requestedKey.startsWith(`${nameKey} `)
      || requestedKey.endsWith(` ${nameKey}`)
    ) {
      score += 700;
    } else if (nameKey.includes(requestedKey) || requestedKey.includes(nameKey)) {
      score += 400;
    }
  }

  if (timezoneCityKey && requestedKey) {
    if (timezoneCityKey === requestedKey) {
      score += 500;
    } else if (timezoneCityKey.includes(requestedKey) || requestedKey.includes(timezoneCityKey)) {
      score += 150;
    }
  }

  if (adminKey && requestedKey && adminKey === requestedKey) {
    score += 120;
  }

  return score;
}

function pickBestOpenMeteoWeatherLocation(
  results: OpenMeteoGeocodeResponse["results"],
  requestedCity: string,
) {
  if (!Array.isArray(results) || !results.length) {
    return null;
  }

  let best = results[0] ?? null;
  let bestScore = best ? scoreOpenMeteoWeatherLocationCandidate(best, requestedCity) : Number.NEGATIVE_INFINITY;

  for (const candidate of results.slice(1)) {
    const score = scoreOpenMeteoWeatherLocationCandidate(candidate, requestedCity);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function looksLikeWeatherLocationMatch(resolvedLocation: string, requestedCity: string) {
  const resolvedKey = normalizeWeatherLocationKey(resolvedLocation, requestedCity);
  const requestedKey = normalizeWeatherLocationKey(requestedCity, requestedCity);
  if (!resolvedKey || !requestedKey) {
    return false;
  }

  return (
    resolvedKey === requestedKey
    || resolvedKey.startsWith(`${requestedKey} `)
    || resolvedKey.endsWith(` ${requestedKey}`)
    || requestedKey.startsWith(`${resolvedKey} `)
    || requestedKey.endsWith(` ${resolvedKey}`)
    || resolvedKey.includes(requestedKey)
    || requestedKey.includes(resolvedKey)
  );
}

function weatherEmoji(desc: string): string {
  const d = desc.toLowerCase();
  if (d.includes("sunny") || d.includes("clear")) return "☀️";
  if (d.includes("partly cloudy")) return "⛅";
  if (d.includes("cloudy") || d.includes("overcast")) return "☁️";
  if (d.includes("rain") || d.includes("drizzle")) return "🌧️";
  if (d.includes("thunder") || d.includes("storm")) return "⛈️";
  if (d.includes("snow") || d.includes("sleet")) return "❄️";
  if (d.includes("fog") || d.includes("mist") || d.includes("haze")) return "🌫️";
  if (d.includes("wind")) return "💨";
  if (d.includes("hot")) return "🌡️";
  return "🌤️";
}

function weatherDescriptionFromCode(code: number | null | undefined): string {
  switch (code) {
    case 0: return "Clear";
    case 1:
    case 2: return "Partly cloudy";
    case 3: return "Overcast";
    case 45:
    case 48: return "Foggy";
    case 51:
    case 53:
    case 55: return "Drizzle";
    case 61:
    case 63:
    case 65: return "Rain";
    case 71:
    case 73:
    case 75: return "Snow";
    case 80:
    case 81:
    case 82: return "Rain showers";
    case 95:
    case 96:
    case 99: return "Thunderstorm";
    default: return "Weather update";
  }
}

async function getWeatherFromOpenMeteo(city: string): Promise<string | null> {
  try {
    const encoded = encodeURIComponent(city.trim());
    const geoResponse = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encoded}&count=8&language=en&format=json`,
      { headers: { "User-Agent": "ClawCloud-AI/1.0" } },
    );
    if (!geoResponse.ok) return null;

    const geoData = await geoResponse.json() as OpenMeteoGeocodeResponse;
    const place = pickBestOpenMeteoWeatherLocation(geoData.results, city);
    if (
      !place
      || !Number.isFinite(place.latitude)
      || !Number.isFinite(place.longitude)
    ) {
      return null;
    }

    const forecastUrl = [
      "https://api.open-meteo.com/v1/forecast",
      `?latitude=${place.latitude}`,
      `&longitude=${place.longitude}`,
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code",
      "&daily=temperature_2m_max,temperature_2m_min",
      "&hourly=precipitation_probability",
      "&forecast_days=1",
      "&timezone=auto",
    ].join("");
    const forecastResponse = await fetch(forecastUrl, {
      headers: { "User-Agent": "ClawCloud-AI/1.0" },
    });
    if (!forecastResponse.ok) return null;

    const forecast = await forecastResponse.json() as OpenMeteoForecastResponse;
    if (!forecast.current) return null;

    const desc = weatherDescriptionFromCode(forecast.current.weather_code);
    const emoji = weatherEmoji(desc);
    const rainProbabilities = forecast.hourly?.precipitation_probability ?? [];
    const maxRain = rainProbabilities.length ? Math.max(...rainProbabilities) : 0;
    const cityName = normalizeWeatherLocationName(place.name ?? city, city);
    const location = place.country ? `${cityName}, ${place.country}` : cityName;
    const feelsLike = Number.isFinite(forecast.current.apparent_temperature)
      ? Math.round(forecast.current.apparent_temperature ?? 0)
      : Math.round(forecast.current.temperature_2m ?? 0);
    const maxTemp = forecast.daily?.temperature_2m_max?.[0];
    const minTemp = forecast.daily?.temperature_2m_min?.[0];

    const lines = [
      `${emoji} *Weather in ${location}*`,
      "",
      `🌡️ *Temperature:* ${Math.round(forecast.current.temperature_2m ?? 0)}°C`,
      `☁️ *Condition:* ${desc}`,
      `💧 *Humidity:* ${Math.round(forecast.current.relative_humidity_2m ?? 0)}%`,
      `💨 *Wind:* ${Math.round(forecast.current.wind_speed_10m ?? 0)} km/h`,
    ];

    lines[2] = `ðŸŒ¡ï¸ *Temperature:* ${Math.round(forecast.current.temperature_2m ?? 0)}Â°C (feels like ${feelsLike}Â°C)`;
    if (Number.isFinite(maxTemp) && Number.isFinite(minTemp)) {
      lines.splice(3, 0, `ðŸ“Š *Today:* High ${Math.round(maxTemp ?? 0)}Â°C / Low ${Math.round(minTemp ?? 0)}Â°C`);
    }

    lines[2] = `*Temperature:* ${Math.round(forecast.current.temperature_2m ?? 0)}°C (feels like ${feelsLike}°C)`;
    if (Number.isFinite(maxTemp) && Number.isFinite(minTemp)) {
      lines[3] = `*Today:* High ${Math.round(maxTemp ?? 0)}°C / Low ${Math.round(minTemp ?? 0)}°C`;
    }

    if (maxRain > 0) {
      lines.push(`🌧️ *Rain chance:* ${Math.round(maxRain)}%`);
    }

    lines.push("");
    lines.push("_Updated just now · Source: open-meteo.com_");
    return lines.join("\n");
  } catch {
    return null;
  }
}

export async function getWeather(city: string): Promise<string | null> {
  const preferredProviderReply = await getWeatherFromOpenMeteo(city);
  if (preferredProviderReply) {
    return preferredProviderReply;
  }

  try {
    const encoded = encodeURIComponent(city.trim());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6_000);

    const response = await fetch(`https://wttr.in/${encoded}?format=j1`, {
      signal: controller.signal,
      headers: { "User-Agent": "ClawCloud-AI/1.0" },
    }).finally(() => clearTimeout(timer));

    if (!response.ok) return null;

    const data = (await response.json()) as WttrResponse;
    const current = data.current_condition?.[0];
    if (!current) return null;

    const area = data.nearest_area?.[0];
    const today = data.weather?.[0];
    const desc = current.weatherDesc?.[0]?.value ?? "Clear";
    const emoji = weatherEmoji(desc);

    const tempC = current.temp_C ?? "?";
    const feelsLike = current.FeelsLikeC ?? "?";
    const humidity = current.humidity ?? "?";
    const wind = current.windspeedKmph ?? "?";
    const visibility = current.visibility ?? "?";
    const maxTemp = today?.maxtempC ?? tempC;
    const minTemp = today?.mintempC ?? tempC;
    const providerAreaName = area?.areaName?.[0]?.value ?? "";

    if (providerAreaName && !looksLikeWeatherLocationMatch(providerAreaName, city)) {
      return null;
    }

    const cityName = normalizeWeatherLocationName(providerAreaName || city, city);
    const country = area?.country?.[0]?.value ?? "";
    const location = country ? `${cityName}, ${country}` : cityName;

    const rainChances = (today?.hourly ?? [])
      .map((hour) => Number.parseInt(hour.chanceofrain ?? "0", 10))
      .filter((value) => Number.isFinite(value));
    const maxRain = rainChances.length ? Math.max(...rainChances) : 0;

    const lines = [
      `${emoji} *Weather in ${location}*`,
      "",
      `🌡️ *Temperature:* ${tempC}°C (feels like ${feelsLike}°C)`,
      `📊 *Today:* High ${maxTemp}°C / Low ${minTemp}°C`,
      `☁️ *Condition:* ${desc}`,
      `💧 *Humidity:* ${humidity}%`,
      `💨 *Wind:* ${wind} km/h`,
      `👁️ *Visibility:* ${visibility} km`,
    ];

    if (maxRain > 10) {
      lines.push(`🌧️ *Rain chance:* ${maxRain}%`);
    }

    lines.push("");
    lines.push("_Updated just now · Source: wttr.in_");
    return lines.join("\n");
  } catch {
    return getWeatherFromOpenMeteo(city);
  }
}

function cleanWeatherCityCandidate(value: string) {
  return value
    .replace(new RegExp(`\\b(?:${WEATHER_TIME_REFERENCE_SOURCE})\\b`, "giu"), "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+(?:\u0915\u093e|\u0915\u0940|\u0915\u0947)$/u, "")
    .replace(/\s+(?:ka|ki|ke)$/iu, "")
    .replace(/^[,.-\s]+|[,.-\s]+$/g, "");
}

export function parseWeatherCity(message: string): string | null {
  const t = message.normalize("NFKC").toLowerCase().trim();
  const looksLikeCreativeWritingRequest = looksLikeCreativeWeatherPrompt(t);

  if (looksLikeCreativeWritingRequest) {
    return null;
  }

  const weatherTerms = `(?:${DIRECT_WEATHER_TERM_SOURCE})`;
  const hindiWeatherTerms = "(?:\u092e\u094c\u0938\u092e|\u0924\u093e\u092a\u092e\u093e\u0928)";

  const pHindi = t.match(new RegExp(`^${WEATHER_CITY_CAPTURE}\\s+(?:का|की|के)\\s+${hindiWeatherTerms}`, "iu"));
  if (pHindi) return cleanWeatherCityCandidate(pHindi[1] ?? "") || null;

  const p1 = t.match(new RegExp(`\\b${weatherTerms}\\b\\s+\\b(?:${WEATHER_LOCATION_CONNECTOR_SOURCE})\\b\\s+${WEATHER_CITY_CAPTURE}`, "iu"));
  if (p1) return cleanWeatherCityCandidate(p1[1] ?? "") || null;

  const p2 = t.match(new RegExp(`^${WEATHER_CITY_CAPTURE}\\s+\\b${weatherTerms}\\b`, "iu"));
  if (p2) {
    const candidate = cleanWeatherCityCandidate(p2[1] ?? "") || "";
    if (candidate && !/\b(write|create|compose|generate|draft|tell|show|about|poem|haiku|lyrics|story)\b/i.test(candidate)) {
      return candidate;
    }
  }

  const p2b = t.match(new RegExp(`^${WEATHER_CITY_CAPTURE}\\s+\\b(?:${WEATHER_LOCATION_CONNECTOR_SOURCE})\\b\\s+\\b${weatherTerms}\\b`, "iu"));
  if (p2b) {
    const candidate = cleanWeatherCityCandidate(p2b[1] ?? "") || "";
    if (candidate) {
      return candidate;
    }
  }

  const p3 = t.match(new RegExp(`\\b(?:${WEATHER_TIME_REFERENCE_SOURCE})\\b[\\s,]*\\b${weatherTerms}\\b[\\s,]*(?:${WEATHER_LOCATION_CONNECTOR_SOURCE})\\s+${WEATHER_CITY_CAPTURE}`, "iu"));
  if (p3) return cleanWeatherCityCandidate(p3[1] ?? "") || null;

  const p4 = t.match(new RegExp(`\\b${weatherTerms}\\b[\\s\\S]{0,24}\\b(?:${WEATHER_LOCATION_CONNECTOR_SOURCE})\\b\\s+${WEATHER_CITY_CAPTURE}\\s+\\b(?:${WEATHER_TIME_REFERENCE_SOURCE})\\b`, "iu"));
  if (p4) return cleanWeatherCityCandidate(p4[1] ?? "") || null;

  const p5 = t.match(new RegExp(`${WEATHER_CITY_CAPTURE}\\s+\\b(?:${WEATHER_LOCATION_CONNECTOR_SOURCE})\\b\\s+\\b(?:${WEATHER_TIME_REFERENCE_SOURCE})\\b[\\s,]*\\b${weatherTerms}\\b`, "iu"));
  if (p5) return cleanWeatherCityCandidate(p5[1] ?? "") || null;

  return null;
}
