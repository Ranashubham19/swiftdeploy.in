import { matchesWholeAlias } from "@/lib/clawcloud-intent-match";

const CRICAPI_BASE = "https://api.cricapi.com/v1";
const CRICKET_TIMEOUT_MS = 8_000;
const IPL_TEAM_CODES = ["rcb", "csk", "mi", "kkr", "srh", "dc", "rr", "pbks", "gt", "lsg"] as const;

const CRICKET_PATTERNS = [
  /\b(cricket|ipl|t20|odi|test match|bcci)\b/i,
  /\b(score|scorecard|live score|match score)\b.*\b(cricket|ipl|india|pakistan|australia|england)\b/i,
  /\b(india|pakistan|australia|england|sri lanka|south africa|new zealand|west indies|bangladesh|afghanistan)\b.*\b(vs|vs\.|versus|match|playing|score)\b/i,
  /\b(ipl \d{4}|ipl score|ipl today|ipl match)\b/i,
  /\b(rcb|csk|mi|kkr|srh|dc|rr|pbks|gt|lsg)\b.*\b(score|match|playing|vs)\b/i,
  /\b(who won|who is winning|batting|bowling|wicket|run rate|over)\b.*\b(match|cricket)\b/i,
];

export function detectCricketIntent(message: string): boolean {
  return CRICKET_PATTERNS.some((pattern) => pattern.test(message));
}

type CricMatch = {
  id: string;
  name: string;
  status: string;
  venue?: string;
  date?: string;
  dateTimeGMT?: string;
  teams?: string[];
  teamInfo?: Array<{ name: string; shortname: string; img?: string }>;
  score?: Array<{
    r: number;
    w: number;
    o: number;
    inning: string;
  }>;
  series_id?: string;
  matchType?: string;
  matchStarted?: boolean;
  matchEnded?: boolean;
};

async function fetchCurrentMatches(): Promise<CricMatch[]> {
  const apiKey = process.env.CRICAPI_KEY?.trim();
  if (!apiKey) {
    return [];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CRICKET_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${CRICAPI_BASE}/currentMatches?apikey=${apiKey}&offset=0`,
      { signal: controller.signal },
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as { data?: CricMatch[] };
    return data.data ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSeriesMatches(query: string): Promise<CricMatch[]> {
  const apiKey = process.env.CRICAPI_KEY?.trim();
  if (!apiKey) {
    return [];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CRICKET_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${CRICAPI_BASE}/matches?apikey=${apiKey}&offset=0&search=${encodeURIComponent(query)}`,
      { signal: controller.signal },
    );

    if (!response.ok) {
      return [];
    }

    const data = await response.json() as { data?: CricMatch[] };
    return data.data ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function formatScore(match: CricMatch): string {
  const scores = match.score ?? [];
  const lines: string[] = [];

  lines.push(`🏏 *${match.name}*`);

  if (match.venue) {
    lines.push(`📍 ${match.venue}`);
  }

  lines.push("");

  if (scores.length === 0) {
    lines.push(`_Status: ${match.status}_`);
    return lines.join("\n");
  }

  for (const inning of scores) {
    const overs = Number(inning.o).toFixed(1);
    lines.push(`*${inning.inning}*: ${inning.r}/${inning.w} (${overs} ov)`);
  }

  lines.push("");
  lines.push(`📊 *${match.status}*`);

  return lines.join("\n");
}

function isIPLMatch(match: CricMatch): boolean {
  const name = (match.name ?? "").toLowerCase();
  const teamShortnames = (match.teamInfo ?? [])
    .map((team) => team.shortname?.toLowerCase() ?? "")
    .filter(Boolean);
  return (
    matchesWholeAlias(name, "ipl")
    || matchesWholeAlias(name, "indian premier league")
    || IPL_TEAM_CODES.some((team) => matchesWholeAlias(name, team))
    || teamShortnames.some((team) => IPL_TEAM_CODES.some((code) => matchesWholeAlias(team, code)))
  );
}

function isIndiaMatch(match: CricMatch): boolean {
  const name = (match.name ?? "").toLowerCase();
  return (
    matchesWholeAlias(name, "india")
    || (match.teams ?? []).some((team) => matchesWholeAlias(team, "india"))
  );
}

function extractSearchHint(message: string): string {
  const lower = message.toLowerCase();
  const iplTeams: Record<string, string> = {
    rcb: "Royal Challengers",
    csk: "Chennai Super Kings",
    mi: "Mumbai Indians",
    kkr: "Kolkata Knight Riders",
    srh: "Sunrisers Hyderabad",
    dc: "Delhi Capitals",
    rr: "Rajasthan Royals",
    pbks: "Punjab Kings",
    gt: "Gujarat Titans",
    lsg: "Lucknow Super Giants",
  };

  for (const [abbr, full] of Object.entries(iplTeams)) {
    if (matchesWholeAlias(lower, abbr)) {
      return full;
    }
  }

  if (matchesWholeAlias(lower, "ipl")) {
    return "IPL";
  }

  if (matchesWholeAlias(lower, "india")) {
    return "India";
  }

  return "";
}

function formatMultipleMatches(matches: CricMatch[], label: string): string {
  const lines = [`🏏 *${label}*`, ""];

  for (const match of matches) {
    lines.push(formatScore(match));
    lines.push("─────────────────");
  }

  const now = new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
    hour12: true,
  });
  lines.push(`_Updated: ${now} IST_`);

  return lines.join("\n");
}

export async function answerCricketQuery(message: string): Promise<string> {
  const allMatches = await fetchCurrentMatches();

  if (!allMatches.length) {
    const hint = extractSearchHint(message);
    if (hint) {
      const found = await fetchSeriesMatches(hint);
      if (found.length) {
        return formatMultipleMatches(found.slice(0, 3), "Recent matches");
      }
    }

    return [
      "🏏 *No live cricket matches right now*",
      "",
      "There are no matches currently in progress.",
      "Try again when a match is scheduled, or ask:",
      "• _IPL 2025 schedule_",
      "• _India next match_",
    ].join("\n");
  }

  const lower = message.toLowerCase();
  let filtered = allMatches;

  if (matchesWholeAlias(lower, "ipl") || IPL_TEAM_CODES.some((team) => matchesWholeAlias(message, team))) {
    filtered = allMatches.filter(isIPLMatch);
  } else if (matchesWholeAlias(lower, "india")) {
    filtered = allMatches.filter(isIndiaMatch);
  }

  if (!filtered.length) {
    filtered = allMatches;
  }

  const liveMatches = filtered.filter((match) => match.matchStarted && !match.matchEnded);
  const recentMatches = filtered.filter((match) => match.matchEnded).slice(0, 2);

  if (liveMatches.length > 0) {
    return formatMultipleMatches(liveMatches.slice(0, 3), "Live now");
  }

  if (recentMatches.length > 0) {
    return formatMultipleMatches(recentMatches, "Recent results");
  }

  return formatMultipleMatches(filtered.slice(0, 3), "Upcoming matches");
}

export function isCricketAvailable(): boolean {
  return Boolean(process.env.CRICAPI_KEY?.trim());
}
