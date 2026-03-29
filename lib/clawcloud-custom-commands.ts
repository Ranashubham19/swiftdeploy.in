import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { getDurableMemoryFacts, type MemoryRow } from "@/lib/clawcloud-user-memory";

type CustomCommand = {
  id: string;
  user_id: string;
  command: string;
  prompt: string;
  description?: string | null;
  use_count: number;
  created_at: string;
};

export type CommandIntent =
  | { type: "save"; command: string; prompt: string }
  | { type: "delete"; command: string }
  | { type: "list" }
  | { type: "run"; command: string; argsText: string }
  | { type: "none" };

export type CommandResult =
  | { handled: true; response: string; expandedPrompt?: string }
  | { handled: false };

const MAX_USER_COMMANDS = 20;
const TEMPLATE_VARIABLE_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const DEFAULT_TIMEZONE = "Asia/Kolkata";
const PROFILE_BACKED_VARIABLES = new Set([
  "name",
  "preferred_name",
  "city",
  "country",
  "profession",
  "company",
  "reply_language",
  "programming_language",
  "timezone",
  "age",
  "interests",
  "preferred_tone",
  "wake_time",
  "work_hours",
  "goals",
  "priorities",
  "briefing_style",
  "focus_areas",
  "routine",
]);

const SAVE_COMMAND_PATTERNS = [
  /^save\s+(\/\w+)\s+as\s+(.+)$/i,
  /^create command\s+(\/\w+)\s*[:\-]\s*(.+)$/i,
  /^set\s+(\/\w+)\s+to\s+(.+)$/i,
];

const DELETE_COMMAND_PATTERNS = [
  /^delete\s+(\/\w+)$/i,
  /^remove command\s+(\/\w+)$/i,
  /^forget command\s+(\/\w+)$/i,
];

const LIST_COMMANDS_PATTERNS = [
  /^(my commands|list commands|show commands|\/commands|what commands)$/i,
  /^(my shortcuts|list shortcuts|show shortcuts)$/i,
];

const SYSTEM_COMMANDS: Record<string, string> = {
  "/help": "help",
  "/reminders": "show reminders",
  "/plan": "my plan",
  "/files": "list my files",
  "/weather": "weather",
  "/news": "latest news",
  "/spending": "how much did I spend this week",
  "/contacts": "list my contacts",
};

export function detectCommandIntent(message: string): CommandIntent {
  const trimmed = message.trim();

  for (const pattern of SAVE_COMMAND_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return {
        type: "save",
        command: match[1].toLowerCase(),
        prompt: match[2].trim(),
      };
    }
  }

  for (const pattern of DELETE_COMMAND_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return {
        type: "delete",
        command: match[1].toLowerCase(),
      };
    }
  }

  if (LIST_COMMANDS_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { type: "list" };
  }

  const commandMatch = trimmed.match(/^(\/\w+)(?:\s+(.+))?$/);
  if (commandMatch) {
    return {
      type: "run",
      command: commandMatch[1].toLowerCase(),
      argsText: commandMatch[2]?.trim() ?? "",
    };
  }

  return { type: "none" };
}

export async function getTopCustomCommands(userId: string, limit = 3) {
  const commands = await getAllCommands(userId);
  return commands
    .filter((command) => command.use_count > 0)
    .slice(0, limit);
}

async function getAllCommands(userId: string) {
  const db = getClawCloudSupabaseAdmin();
  const { data } = await db
    .from("custom_commands")
    .select("*")
    .eq("user_id", userId)
    .order("use_count", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(MAX_USER_COMMANDS);

  return (data ?? []) as CustomCommand[];
}

async function getCommand(userId: string, command: string) {
  const db = getClawCloudSupabaseAdmin();
  const { data } = await db
    .from("custom_commands")
    .select("*")
    .eq("user_id", userId)
    .eq("command", command)
    .maybeSingle();

  return (data as CustomCommand | null) ?? null;
}

async function saveCommand(userId: string, command: string, prompt: string) {
  const existing = await getAllCommands(userId);
  if (existing.length >= MAX_USER_COMMANDS && !existing.some((item) => item.command === command)) {
    return false;
  }

  const db = getClawCloudSupabaseAdmin();
  const { error } = await db.from("custom_commands").upsert(
    {
      user_id: userId,
      command,
      prompt,
      description: buildCommandDescription(prompt),
      use_count: 0,
    },
    { onConflict: "user_id,command" },
  );

  return !error;
}

async function deleteCommand(userId: string, command: string) {
  const db = getClawCloudSupabaseAdmin();
  const { data } = await db
    .from("custom_commands")
    .delete()
    .eq("user_id", userId)
    .eq("command", command)
    .select("id");

  return (data?.length ?? 0) > 0;
}

async function incrementUseCount(userId: string, command: string) {
  const db = getClawCloudSupabaseAdmin();
  const { data } = await db
    .from("custom_commands")
    .select("id, use_count")
    .eq("user_id", userId)
    .eq("command", command)
    .maybeSingle();

  if (!data?.id) {
    return;
  }

  await db
    .from("custom_commands")
    .update({ use_count: Number(data.use_count ?? 0) + 1 })
    .eq("id", data.id)
    .catch(() => null);
}

function buildCommandDescription(prompt: string) {
  return prompt
    .replace(TEMPLATE_VARIABLE_RE, (_, key: string) => `[${normalizePlaceholderKey(key)}]`)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function extractTemplateVariables(prompt: string): string[] {
  const matches = [...prompt.matchAll(TEMPLATE_VARIABLE_RE)];
  return Array.from(
    new Set(matches.map((match) => normalizePlaceholderKey(match[1]))),
  );
}

function normalizePlaceholderKey(value: string) {
  return value.trim().toLowerCase();
}

function stripWrappingQuotes(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function humanizePlaceholder(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTemplateVariableBadge(prompt: string) {
  const variables = extractTemplateVariables(prompt);
  if (!variables.length) {
    return "";
  }

  return ` Variables: ${variables.map((item) => `{{${item}}}`).join(", ")}`;
}

function listCommandsReply(userCommands: CustomCommand[]) {
  const lines = ["*Your saved commands*", "", "*Built-in commands:*"];
  for (const [command, prompt] of Object.entries(SYSTEM_COMMANDS)) {
    lines.push(`- *${command}* -> _${prompt}_`);
  }

  if (!userCommands.length) {
    lines.push("", "_No custom commands saved yet._");
  } else {
    lines.push("", "*Your custom commands:*");
    for (const command of userCommands) {
      const preview = command.prompt.slice(0, 70);
      const suffix = command.prompt.length > 70 ? "..." : "";
      lines.push(`- *${command.command}* -> _${preview}${suffix}_`);
      const variableBadge = formatTemplateVariableBadge(command.prompt);
      if (variableBadge) {
        lines.push(`  _${variableBadge.trim()}_`);
      }
      if (command.use_count > 0) {
        lines.push(`  _Used ${command.use_count} time${command.use_count === 1 ? "" : "s"}_`);
      }
    }
  }

  lines.push(
    "",
    "*Good examples:*",
    "_save /standup as Draft my standup using priorities={{priorities}} and blockers={{input}}_",
    "_save /brief as Give me today's plan with focus on {{focus_areas}} in a {{preferred_tone}} tone_",
    "",
    "You can run template commands with values like:",
    "_/standup blockers=\"waiting on QA\"_",
  );

  return lines.join("\n");
}

function formatCommandUsageExample(command: string, missingVariables: string[]) {
  const example = missingVariables
    .map((key, index) => `${key}="${index === 0 ? "your value" : "another value"}"`)
    .join(" ");
  return `${command} ${example}`.trim();
}

function buildMissingVariableReply(command: string, missingVariables: string[]) {
  const labels = missingVariables.map(humanizePlaceholder);
  const profileBacked = missingVariables.filter((item) => PROFILE_BACKED_VARIABLES.has(item));
  const lines = [
    `*${command}* needs a bit more information before I can run it.`,
    "",
    `Missing: ${labels.join(", ")}`,
    "",
    "Run it like this:",
    `_${formatCommandUsageExample(command, missingVariables)}_`,
  ];

  if (profileBacked.length) {
    lines.push(
      "",
      "You can also save profile-backed values once, for example:",
      `_remember my ${humanizePlaceholder(profileBacked[0]).toLowerCase()} is your value_`,
    );
  }

  return lines.join("\n");
}

function parseCommandArgs(argsText: string, templateVariables: string[]) {
  const trimmed = argsText.trim();
  if (!trimmed) {
    return {};
  }

  const normalized = trimmed.replace(/^with\s+/i, "").trim();
  const values: Record<string, string> = {
    input: normalized,
  };

  const matches = [
    ...normalized.matchAll(
      /([a-zA-Z0-9_]+)\s*(?:=|:)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,]+)(?:,|$)/g,
    ),
  ];

  if (matches.length) {
    for (const match of matches) {
      const key = normalizePlaceholderKey(match[1]);
      const value = stripWrappingQuotes(match[2]);
      if (value) {
        values[key] = value;
      }
    }
  } else if (templateVariables.length === 1) {
    values[templateVariables[0]] = normalized;
  }

  return values;
}

function buildSystemVariables(timeZone: string) {
  const now = new Date();
  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
  const shortDateFormatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  });
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  });
  const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone,
  });
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  return {
    today: dateFormatter.format(now),
    tomorrow: dateFormatter.format(tomorrow),
    date: shortDateFormatter.format(now),
    time: timeFormatter.format(now),
    day: weekdayFormatter.format(now),
    weekday: weekdayFormatter.format(now),
    timezone: timeZone,
  };
}

function buildMemoryVariableMap(facts: MemoryRow[]) {
  const memoryVariables: Record<string, string> = {};

  for (const fact of facts) {
    const key = normalizePlaceholderKey(fact.key);
    if (!memoryVariables[key]) {
      memoryVariables[key] = fact.value;
    }
  }

  const preferredName = memoryVariables.preferred_name || memoryVariables.name || "";
  if (preferredName) {
    memoryVariables.name = preferredName;
  }
  if (memoryVariables.priorities) {
    memoryVariables.priority = memoryVariables.priorities;
  }
  if (memoryVariables.focus_areas) {
    memoryVariables.focus = memoryVariables.focus_areas;
  }
  if (memoryVariables.preferred_tone) {
    memoryVariables.tone = memoryVariables.preferred_tone;
  }
  if (memoryVariables.briefing_style) {
    memoryVariables.style = memoryVariables.briefing_style;
  }

  return memoryVariables;
}

async function expandCommandPrompt(
  userId: string,
  prompt: string,
  argsText: string,
) {
  const templateVariables = extractTemplateVariables(prompt);
  if (!templateVariables.length) {
    return {
      expandedPrompt: argsText ? `${prompt} ${argsText}`.trim() : prompt,
      missingVariables: [] as string[],
    };
  }

  const facts = await getDurableMemoryFacts(userId).catch(() => []);
  const memoryVariables = buildMemoryVariableMap(facts);
  const timeZone = memoryVariables.timezone || DEFAULT_TIMEZONE;
  const systemVariables = buildSystemVariables(timeZone);
  const argVariables = parseCommandArgs(argsText, templateVariables);
  const missingVariables: string[] = [];

  const expandedPrompt = prompt.replace(TEMPLATE_VARIABLE_RE, (_, rawKey: string) => {
    const key = normalizePlaceholderKey(rawKey);
    const resolved =
      argVariables[key]
      || memoryVariables[key]
      || (systemVariables as Record<string, string>)[key];

    if (resolved) {
      return resolved;
    }

    missingVariables.push(key);
    return `{{${key}}}`;
  });

  return {
    expandedPrompt,
    missingVariables: Array.from(new Set(missingVariables)),
  };
}

export async function handleCustomCommand(userId: string, message: string): Promise<CommandResult> {
  const intent = detectCommandIntent(message);
  if (intent.type === "none") {
    return { handled: false };
  }

  if (intent.type === "save") {
    if (intent.prompt.length < 6) {
      return {
        handled: true,
        response: "That command is too short. Add a fuller prompt after _save /name as ..._.",
      };
    }

    if (SYSTEM_COMMANDS[intent.command]) {
      return {
        handled: true,
        response: `*${intent.command}* is built in and cannot be overridden.`,
      };
    }

    const saved = await saveCommand(userId, intent.command, intent.prompt);
    const variables = extractTemplateVariables(intent.prompt);
    const response = saved
      ? [
        "*Command saved.*",
        "",
        `*${intent.command}* -> _${intent.prompt.slice(0, 140)}${intent.prompt.length > 140 ? "..." : ""}_`,
        variables.length
          ? `Variables: ${variables.map((item) => `{{${item}}}`).join(", ")}`
          : "This one is ready to run exactly as saved.",
        "",
        variables.length
          ? `Run it with: _${formatCommandUsageExample(intent.command, variables)}_`
          : `Type *${intent.command}* anytime to run it.`,
      ].join("\n")
      : `I could not save ${intent.command}. You may have reached the ${MAX_USER_COMMANDS}-command limit.`;

    return { handled: true, response };
  }

  if (intent.type === "delete") {
    if (SYSTEM_COMMANDS[intent.command]) {
      return {
        handled: true,
        response: `*${intent.command}* is a built-in command and cannot be deleted.`,
      };
    }

    const deleted = await deleteCommand(userId, intent.command);
    return {
      handled: true,
      response: deleted
        ? `*${intent.command}* deleted.`
        : `I could not find *${intent.command}*. Type _my commands_ to see your saved commands.`,
    };
  }

  if (intent.type === "list") {
    const commands = await getAllCommands(userId);
    return {
      handled: true,
      response: listCommandsReply(commands),
    };
  }

  if (intent.type === "run") {
    const builtIn = SYSTEM_COMMANDS[intent.command];
    if (builtIn) {
      return {
        handled: true,
        response: "",
        expandedPrompt: intent.argsText ? `${builtIn} ${intent.argsText}`.trim() : builtIn,
      };
    }

    const command = await getCommand(userId, intent.command);
    if (!command) {
      return {
        handled: true,
        response: [
          `Unknown command: ${intent.command}`,
          "",
          "Type *my commands* to see what is available.",
          `To save it, send: _save ${intent.command} as your prompt here_`,
        ].join("\n"),
      };
    }

    const expanded = await expandCommandPrompt(userId, command.prompt, intent.argsText);
    if (expanded.missingVariables.length) {
      return {
        handled: true,
        response: buildMissingVariableReply(intent.command, expanded.missingVariables),
      };
    }

    void incrementUseCount(userId, intent.command);
    return {
      handled: true,
      response: "",
      expandedPrompt: expanded.expandedPrompt,
    };
  }

  return { handled: false };
}
