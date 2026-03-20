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
    latitude?: number;
    longitude?: number;
  }>;
};

type OpenMeteoForecastResponse = {
  current?: {
    temperature_2m?: number;
    relative_humidity_2m?: number;
    wind_speed_10m?: number;
    weather_code?: number;
  };
  hourly?: {
    precipitation_probability?: number[];
  };
};

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
      `https://geocoding-api.open-meteo.com/v1/search?name=${encoded}&count=1&language=en&format=json`,
      { headers: { "User-Agent": "ClawCloud-AI/1.0" } },
    );
    if (!geoResponse.ok) return null;

    const geoData = await geoResponse.json() as OpenMeteoGeocodeResponse;
    const place = geoData.results?.[0];
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
      "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code",
      "&hourly=precipitation_probability",
      "&forecast_days=1",
      "&timezone=Asia%2FKolkata",
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
    const location = place.country ? `${place.name}, ${place.country}` : (place.name ?? city);

    const lines = [
      `${emoji} *Weather in ${location}*`,
      "",
      `🌡️ *Temperature:* ${Math.round(forecast.current.temperature_2m ?? 0)}°C`,
      `☁️ *Condition:* ${desc}`,
      `💧 *Humidity:* ${Math.round(forecast.current.relative_humidity_2m ?? 0)}%`,
      `💨 *Wind:* ${Math.round(forecast.current.wind_speed_10m ?? 0)} km/h`,
    ];

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

    const cityName = area?.areaName?.[0]?.value ?? city;
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
    .replace(/\b(right now|currently|now|today|tonight)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.-\s]+|[,.-\s]+$/g, "");
}

export function parseWeatherCity(message: string): string | null {
  const t = message.toLowerCase().trim();

  const p1 = t.match(/(?:weather|temperature|temp|forecast|climate)\s+(?:in|at|of|for)\s+([a-z][a-z\s]{1,30})/i);
  if (p1) return cleanWeatherCityCandidate(p1[1] ?? "") || null;

  const p2 = t.match(/^([a-z][a-z\s]{1,30})\s+(?:weather|temperature|temp|forecast)/i);
  if (p2) return cleanWeatherCityCandidate(p2[1] ?? "") || null;

  const p3 = t.match(/(?:today|now|right now|currently)\s+(?:in|at)\s+([a-z][a-z\s]{1,30})/i);
  if (p3) return cleanWeatherCityCandidate(p3[1] ?? "") || null;

  const p4 = t.match(/(?:in|at)\s+([a-z][a-z\s]{1,30})\s+(?:today|now|right now)/i);
  if (p4) return cleanWeatherCityCandidate(p4[1] ?? "") || null;

  return null;
}
