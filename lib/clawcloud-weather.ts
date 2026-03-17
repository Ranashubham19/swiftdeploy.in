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
    return null;
  }
}

export function parseWeatherCity(message: string): string | null {
  const t = message.toLowerCase().trim();

  const p1 = t.match(/(?:weather|temperature|temp|forecast|climate)\s+(?:in|at|of|for)\s+([a-z][a-z\s]{1,30})/i);
  if (p1) return p1[1].trim();

  const p2 = t.match(/^([a-z][a-z\s]{1,30})\s+(?:weather|temperature|temp|forecast)/i);
  if (p2) return p2[1].trim();

  const p3 = t.match(/(?:today|now|right now|currently)\s+(?:in|at)\s+([a-z][a-z\s]{1,30})/i);
  if (p3) return p3[1].trim();

  const p4 = t.match(/(?:in|at)\s+([a-z][a-z\s]{1,30})\s+(?:today|now|right now)/i);
  if (p4) return p4[1].trim();

  return null;
}
