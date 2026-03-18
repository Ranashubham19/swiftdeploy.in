type HolidayEntry = {
  name: string;
  date: string;
  type: "national" | "festival" | "bank" | "market" | "regional";
  states?: string[];
  religion?: "hindu" | "muslim" | "christian" | "sikh" | "jain" | "buddhist" | "all";
  description?: string;
};

const HOLIDAYS_2025: HolidayEntry[] = [
  { name: "New Year's Day", date: "2025-01-01", type: "national" },
  { name: "Makar Sankranti", date: "2025-01-14", type: "festival", religion: "hindu" },
  { name: "Republic Day", date: "2025-01-26", type: "national", description: "Constitution of India adopted (1950)" },
  { name: "Maha Shivratri", date: "2025-02-26", type: "festival", religion: "hindu" },
  { name: "Holi", date: "2025-03-14", type: "festival", religion: "hindu", description: "Festival of colours" },
  { name: "Good Friday", date: "2025-04-18", type: "bank", religion: "christian" },
  { name: "Ram Navami", date: "2025-04-06", type: "festival", religion: "hindu" },
  { name: "Mahavir Jayanti", date: "2025-04-10", type: "bank", religion: "jain" },
  { name: "Dr. Ambedkar Jayanti", date: "2025-04-14", type: "national" },
  { name: "Eid ul-Fitr", date: "2025-03-31", type: "bank", religion: "muslim", description: "End of Ramadan (approx)" },
  { name: "Eid ul-Adha", date: "2025-06-07", type: "bank", religion: "muslim", description: "Bakrid (approx)" },
  { name: "Guru Purnima", date: "2025-07-10", type: "festival", religion: "hindu" },
  { name: "Independence Day", date: "2025-08-15", type: "national", description: "India's independence from British rule (1947)" },
  { name: "Janmashtami", date: "2025-08-16", type: "festival", religion: "hindu", description: "Birthday of Lord Krishna" },
  { name: "Ganesh Chaturthi", date: "2025-08-27", type: "festival", religion: "hindu" },
  { name: "Onam", date: "2025-09-05", type: "festival", religion: "hindu", states: ["Kerala"] },
  { name: "Gandhi Jayanti", date: "2025-10-02", type: "national", description: "Birthday of Mahatma Gandhi" },
  { name: "Navratri begins", date: "2025-10-02", type: "festival", religion: "hindu" },
  { name: "Dussehra (Vijayadashami)", date: "2025-10-02", type: "festival", religion: "hindu" },
  { name: "Diwali (Lakshmi Puja)", date: "2025-10-20", type: "festival", religion: "hindu", description: "Festival of lights" },
  { name: "Bhai Dooj", date: "2025-10-22", type: "festival", religion: "hindu" },
  { name: "Guru Nanak Jayanti", date: "2025-11-05", type: "bank", religion: "sikh" },
  { name: "Christmas", date: "2025-12-25", type: "national", religion: "christian" },
];

const HOLIDAYS_2026: HolidayEntry[] = [
  { name: "New Year's Day", date: "2026-01-01", type: "national" },
  { name: "Makar Sankranti", date: "2026-01-14", type: "festival", religion: "hindu" },
  { name: "Republic Day", date: "2026-01-26", type: "national" },
  { name: "Holi", date: "2026-03-03", type: "festival", religion: "hindu" },
  { name: "Ram Navami", date: "2026-03-27", type: "festival", religion: "hindu" },
  { name: "Dr. Ambedkar Jayanti", date: "2026-04-14", type: "national" },
  { name: "Independence Day", date: "2026-08-15", type: "national" },
  { name: "Gandhi Jayanti", date: "2026-10-02", type: "national" },
  { name: "Diwali", date: "2026-11-08", type: "festival", religion: "hindu" },
  { name: "Christmas", date: "2026-12-25", type: "national" },
];

const ALL_HOLIDAYS = [...HOLIDAYS_2025, ...HOLIDAYS_2026];

export function detectHolidayQuery(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    /\b(holiday|festival|छुट्टी|tyohar|diwali|holi|eid|christmas|dussehra|navratri|janmashtami|ganesh|onam|pongal|ugadi|baisakhi|lohri|makar|republic day|independence day|gandhi jayanti|ambedkar)\b/.test(normalized)
    || (/\b(when is|when's|kab hai|kab hoga|date of|next)\b/.test(normalized) && /\b(holiday|festival|celebration)\b/.test(normalized))
    || /\b(is .* holiday|is today a holiday|next holiday)\b/.test(normalized)
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00+05:30`);
  return date.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function getTodayIndianDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function getDaysUntil(dateStr: string): number {
  const today = new Date(`${getTodayIndianDate()}T00:00:00+05:30`);
  const target = new Date(`${dateStr}T00:00:00+05:30`);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function answerHolidayQuery(message: string): string | null {
  const normalized = message.toLowerCase();
  const today = getTodayIndianDate();
  const todayFormatted = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });

  if (/\b(today|aaj)\b/.test(normalized) && /\b(holiday|छुट्टी)\b/.test(normalized)) {
    const todayHolidays = ALL_HOLIDAYS.filter((holiday) => holiday.date === today);
    if (todayHolidays.length > 0) {
      const names = todayHolidays.map((holiday) => `*${holiday.name}*`).join(" & ");
      return `🎉 *Yes! Today is a holiday.*\n\n${names}\n_${todayFormatted}_`;
    }

    return `📅 *No, today is not a public holiday.*\n_${todayFormatted}_\n\n_Note: Some states may observe additional holidays._`;
  }

  if (/\b(next|upcoming|agle|next public)\b/.test(normalized) && /\b(holiday|festival|छुट्टी)\b/.test(normalized)) {
    const upcoming = ALL_HOLIDAYS
      .filter((holiday) => holiday.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);

    if (upcoming.length === 0) {
      return null;
    }

    return [
      "📅 *Upcoming Indian Holidays*",
      "",
      ...upcoming.map((holiday) => {
        const days = getDaysUntil(holiday.date);
        const label = days === 0 ? "Today!" : days === 1 ? "Tomorrow" : `In ${days} days`;
        return `• *${holiday.name}* - ${formatDate(holiday.date)} _(${label})_`;
      }),
    ].join("\n");
  }

  const festivalKeywords: Record<string, string[]> = {
    diwali: ["Diwali", "Deepavali"],
    holi: ["Holi"],
    eid: ["Eid"],
    christmas: ["Christmas"],
    dussehra: ["Dussehra"],
    navratri: ["Navratri"],
    janmashtami: ["Janmashtami"],
    ganesh: ["Ganesh Chaturthi"],
    onam: ["Onam"],
    "republic day": ["Republic Day"],
    "independence day": ["Independence Day"],
    "gandhi jayanti": ["Gandhi Jayanti"],
    "ambedkar jayanti": ["Dr. Ambedkar Jayanti"],
    shivratri: ["Maha Shivratri"],
    "guru nanak": ["Guru Nanak Jayanti"],
    lohri: [],
    baisakhi: [],
    pongal: [],
  };

  for (const [keyword, names] of Object.entries(festivalKeywords)) {
    if (!normalized.includes(keyword)) {
      continue;
    }

    const matches = ALL_HOLIDAYS
      .filter((holiday) =>
        names.some((name) => holiday.name.toLowerCase().includes(name.toLowerCase()))
        || holiday.name.toLowerCase().includes(keyword)
      )
      .sort((a, b) => a.date.localeCompare(b.date));

    if (matches.length === 0) {
      return `📅 *${keyword.charAt(0).toUpperCase() + keyword.slice(1)}*\n\nI don't have the exact date in my calendar. Check at calendarlabs.com/indian-holidays or ask me to search the web.`;
    }

    const lines = [`🎉 *${matches[0].name}*`, ""];
    for (const match of matches) {
      const days = getDaysUntil(match.date);
      const tag = days < 0 ? "Passed" : days === 0 ? "Today! 🎊" : `In ${days} days`;
      lines.push(`*${match.date.split("-")[0]}:* ${formatDate(match.date)} _(${tag})_`);
      if (match.description) {
        lines.push(`_${match.description}_`);
      }
    }
    return lines.join("\n");
  }

  if (/\b(list|all|saare|this month|this year)\b/.test(normalized) && /\b(holiday|festival)\b/.test(normalized)) {
    const year = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
    }).format(new Date());
    const monthMatch = message.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i);
    let filtered = ALL_HOLIDAYS.filter((holiday) => holiday.date.startsWith(year));

    if (monthMatch) {
      const monthIndex = new Date(`${monthMatch[1]} 1`).getMonth() + 1;
      const monthString = monthIndex.toString().padStart(2, "0");
      filtered = ALL_HOLIDAYS.filter((holiday) => holiday.date.startsWith(`${year}-${monthString}`));
    }

    if (filtered.length === 0) {
      return "📅 No holidays found for that period.";
    }

    return [
      `📅 *Indian Holidays - ${monthMatch?.[1] ?? year}*`,
      "",
      ...filtered
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((holiday) => `• *${holiday.name}* - ${formatDate(holiday.date)}`),
    ].join("\n");
  }

  return null;
}
