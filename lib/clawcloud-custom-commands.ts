import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";

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
  | { type: "run"; command: string }
  | { type: "none" };

export type CommandResult =
  | { handled: true; response: string; expandedPrompt?: string }
  | { handled: false };

const MAX_USER_COMMANDS = 20;

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

  const command = trimmed.match(/^(\/\w+)/)?.[1]?.toLowerCase();
  if (command) {
    return { type: "run", command };
  }

  return { type: "none" };
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

function listCommandsReply(userCommands: CustomCommand[]) {
  const lines = ["⚡ *Your saved commands*", "", "*Built-in commands:*"];
  for (const [command, prompt] of Object.entries(SYSTEM_COMMANDS)) {
    lines.push(`• *${command}* -> _${prompt}_`);
  }

  if (!userCommands.length) {
    lines.push("", "_No custom commands saved yet._");
  } else {
    lines.push("", "*Your custom commands:*");
    for (const command of userCommands) {
      const preview = command.prompt.slice(0, 60);
      const suffix = command.prompt.length > 60 ? "..." : "";
      lines.push(`• *${command.command}* -> _${preview}${suffix}_`);
      if (command.use_count > 0) {
        lines.push(`_Used ${command.use_count} time${command.use_count === 1 ? "" : "s"}_`);
      }
    }
  }

  lines.push(
    "",
    "*To save one:*",
    "_save /standup as What are my meetings and top emails today?_",
  );

  return lines.join("\n");
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
        response: "❌ *That command is too short.* Add a fuller prompt after _save /name as ..._.",
      };
    }

    if (SYSTEM_COMMANDS[intent.command]) {
      return {
        handled: true,
        response: `❌ *${intent.command} is built in* and can't be overridden.`,
      };
    }

    const saved = await saveCommand(userId, intent.command, intent.prompt);
    return {
      handled: true,
      response: saved
        ? [
            "✅ *Command saved!*",
            "",
            `*${intent.command}* -> _${intent.prompt.slice(0, 120)}${intent.prompt.length > 120 ? "..." : ""}_`,
            "",
            `Type *${intent.command}* anytime to run it.`,
          ].join("\n")
        : `❌ *I couldn't save ${intent.command}.* You may have reached the ${MAX_USER_COMMANDS}-command limit.`,
    };
  }

  if (intent.type === "delete") {
    if (SYSTEM_COMMANDS[intent.command]) {
      return {
        handled: true,
        response: `❌ *${intent.command} is a built-in command* and can't be deleted.`,
      };
    }

    const deleted = await deleteCommand(userId, intent.command);
    return {
      handled: true,
      response: deleted
        ? `✅ *${intent.command} deleted.*`
        : `❌ *${intent.command} wasn't found.* Type _my commands_ to see your saved commands.`,
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
        expandedPrompt: builtIn,
      };
    }

    const command = await getCommand(userId, intent.command);
    if (!command) {
      return {
        handled: true,
        response: [
          `❓ *Unknown command: ${intent.command}*`,
          "",
          "Type *my commands* to see what's available.",
          `To save it, send: _save ${intent.command} as your prompt here_`,
        ].join("\n"),
      };
    }

    void incrementUseCount(userId, intent.command);
    return {
      handled: true,
      response: "",
      expandedPrompt: command.prompt,
    };
  }

  return { handled: false };
}
