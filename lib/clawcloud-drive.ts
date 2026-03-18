import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";
import { getValidGoogleAccessToken } from "@/lib/clawcloud-google";

const DRIVE_TIMEOUT_MS = 10_000;
const DRIVE_MAX_FILES = 8;
const SHEETS_MAX_ROWS = 100;
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";

type DriveIntent = "read" | "list" | "search" | "write" | null;

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
};

type SheetsValuesResponse = {
  values?: string[][];
};

type SheetsMetadataResponse = {
  sheets?: Array<{
    properties?: {
      title?: string;
    };
  }>;
};

const DRIVE_PATTERNS = [
  /\b(google drive|my drive|gdrive|g drive)\b/i,
  /\b(google sheet|google sheets|gsheet|spreadsheet)\b/i,
  /\b(google doc|google docs|gdoc)\b/i,
  /\b(my (files?|documents?|sheets?|docs?|spreadsheets?))\b/i,
  /\b(open|read|show|find|search|list)\s+(my\s+)?(file|doc|sheet|spreadsheet|document)\b/i,
  /\b(what('?s| is) in|contents? of|summary of)\s+.*(sheet|doc|file|spreadsheet)\b/i,
  /\b(update|append|add row|add to)\s+.*(sheet|spreadsheet)\b/i,
];

const SHEET_WRITE_PATTERNS = [
  /\b(add|append|insert|update)\s+(a\s+)?row\b/i,
  /\b(add to|write to|update)\s+.*(sheet|spreadsheet)\b/i,
];

function withTimeout<T>(factory: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DRIVE_TIMEOUT_MS);
  return factory(controller.signal).finally(() => clearTimeout(timer));
}

async function googleJson<T>(baseUrl: string, path: string, token: string): Promise<T> {
  return withTimeout(async (signal) => {
    const response = await fetch(`${baseUrl}${path}`, {
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(`Google API ${response.status}: ${details.slice(0, 200)}`);
    }

    return response.json() as Promise<T>;
  });
}

async function googleText(baseUrl: string, path: string, token: string): Promise<string> {
  return withTimeout(async (signal) => {
    const response = await fetch(`${baseUrl}${path}`, {
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(`Google API ${response.status}: ${details.slice(0, 200)}`);
    }

    return response.text();
  });
}

function escapeDriveQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function mimeIcon(mimeType: string) {
  if (mimeType.includes("spreadsheet")) return "📊";
  if (mimeType.includes("document")) return "📝";
  if (mimeType.includes("presentation")) return "📽️";
  if (mimeType.includes("pdf")) return "📄";
  if (mimeType.includes("image")) return "🖼️";
  if (mimeType.includes("folder")) return "📁";
  return "📎";
}

function formatRelativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
}

function extractFileName(message: string) {
  return message
    .replace(/\b(open|read|show|find|search for|look for|list|summary of|summarise|summarize|contents? of|what'?s? in|add to|write to|update)\b/gi, "")
    .replace(/\b(my|the|a|an)\b/gi, "")
    .replace(/\b(google sheet|google sheets|google doc|google docs|google drive|spreadsheet|sheet|document|doc|file|files|gdoc|gsheet)\b/gi, "")
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractWriteTargetName(message: string) {
  const match = message.match(/(?:add row|append|insert|update)(?:\s+(?:to|into))?\s+(.+?)(?::|$)/i);
  if (!match?.[1]) {
    return "";
  }

  return match[1]
    .replace(/\b(sheet|spreadsheet|google sheet|google sheets)\b/gi, "")
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSheetRow(message: string): string[] {
  const match = message.match(/(?:add row|append|insert|update)[^:]*:\s*(.+)$/i);
  if (!match?.[1]) {
    return [];
  }

  return match[1]
    .split(/[,|;]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 20);
}

async function listRecentFiles(token: string, maxResults = DRIVE_MAX_FILES): Promise<DriveFile[]> {
  const data = await googleJson<{ files?: DriveFile[] }>(
    "https://www.googleapis.com",
    `/drive/v3/files?pageSize=${maxResults}&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime,webViewLink)&q=trashed=false`,
    token,
  );

  return data.files ?? [];
}

async function searchFiles(token: string, query: string): Promise<DriveFile[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return listRecentFiles(token, 5);
  }

  const safeQuery = escapeDriveQuery(normalizedQuery);
  const q = encodeURIComponent(`(name contains '${safeQuery}' or fullText contains '${safeQuery}') and trashed=false`);
  const data = await googleJson<{ files?: DriveFile[] }>(
    "https://www.googleapis.com",
    `/drive/v3/files?q=${q}&pageSize=5&fields=files(id,name,mimeType,modifiedTime,webViewLink)`,
    token,
  );

  return data.files ?? [];
}

async function readGoogleDoc(token: string, fileId: string) {
  const raw = await googleText(
    "https://www.googleapis.com",
    `/drive/v3/files/${fileId}/export?mimeType=text/plain`,
    token,
  );

  return raw.trim().slice(0, 8_000);
}

async function getSheetTitle(token: string, fileId: string) {
  const metadata = await googleJson<SheetsMetadataResponse>(
    "https://sheets.googleapis.com",
    `/v4/spreadsheets/${fileId}?fields=sheets.properties.title`,
    token,
  );

  return metadata.sheets?.[0]?.properties?.title?.trim() || "Sheet1";
}

async function readGoogleSheet(token: string, fileId: string, sheetName?: string) {
  const title = sheetName || await getSheetTitle(token, fileId);
  const range = encodeURIComponent(`${title}!A1:Z${SHEETS_MAX_ROWS}`);
  const data = await googleJson<SheetsValuesResponse>(
    "https://sheets.googleapis.com",
    `/v4/spreadsheets/${fileId}/values/${range}`,
    token,
  );

  const rows = data.values ?? [];
  if (!rows.length) {
    return "The sheet appears to be empty.";
  }

  return rows.map((row) => row.join("\t")).join("\n").slice(0, 8_000);
}

async function appendToSheet(token: string, fileId: string, values: string[], sheetName?: string) {
  const title = sheetName || await getSheetTitle(token, fileId);
  const range = encodeURIComponent(`${title}!A1`);

  return withTimeout(async (signal) => {
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${range}:append?valueInputOption=USER_ENTERED`,
      {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ values: [values] }),
      },
    );

    return response.ok;
  });
}

async function answerAboutContent(content: string, fileName: string, question: string) {
  return completeClawCloudPrompt({
    system: [
      "You are ClawCloud AI answering a user's question about their Google Drive file.",
      "Answer only from the provided file content.",
      "Format for WhatsApp with short sections, bullets, and clear takeaways.",
      "If the file looks like a spreadsheet, describe the data in plain language.",
    ].join(" "),
    user: [
      `File: ${fileName}`,
      `Question: ${question || "Summarise this file."}`,
      "",
      "--- FILE CONTENT ---",
      content,
      "--- END ---",
    ].join("\n"),
    intent: "research",
    responseMode: "fast",
    maxTokens: 550,
    fallback: `📂 *${fileName}*\n\n${content.slice(0, 900)}`,
    skipCache: true,
  });
}

export function detectDriveIntent(message: string): DriveIntent {
  if (!DRIVE_PATTERNS.some((pattern) => pattern.test(message))) {
    return null;
  }

  if (SHEET_WRITE_PATTERNS.some((pattern) => pattern.test(message))) {
    return "write";
  }

  if (/\b(list|show me|recent|latest|what files)\b/i.test(message)) {
    return "list";
  }

  if (/\b(find|search for|look for)\b/i.test(message)) {
    return "search";
  }

  return "read";
}

function connectedDriveReply() {
  return [
    "📂 *Google Drive not connected*",
    "",
    "Reconnect Google at *swift-deploy.in/settings* to grant Drive and Sheets access.",
    "Then try again with _list my files_ or _read my sales sheet_.",
  ].join("\n");
}

export async function handleDriveQuery(userId: string, message: string) {
  let token: string;
  try {
    token = await getValidGoogleAccessToken(userId, "google_drive");
  } catch {
    return connectedDriveReply();
  }

  const intent = detectDriveIntent(message);

  if (intent === "list") {
    const files = await listRecentFiles(token);
    if (!files.length) {
      return "📂 *No recent Drive files found.*";
    }

    const lines = ["📂 *Recent Google Drive files*", ""];
    for (const file of files) {
      lines.push(`${mimeIcon(file.mimeType)} *${file.name}*`);
      lines.push(`_Modified ${formatRelativeTime(file.modifiedTime)}_`);
    }
    lines.push("", "_Say 'read [file name]' to open one._");
    return lines.join("\n");
  }

  if (intent === "search") {
    const query = extractFileName(message);
    const files = await searchFiles(token, query);
    if (!files.length) {
      return `📂 *No files found for "${query || "that search"}".*\n\nTry _list my files_ to browse recent files.`;
    }

    const lines = [`📂 *Search results for "${query || "your files"}"*`, ""];
    for (const file of files) {
      lines.push(`${mimeIcon(file.mimeType)} *${file.name}* — _${formatRelativeTime(file.modifiedTime)}_`);
    }
    lines.push("", "_Say 'read [file name]' to open one._");
    return lines.join("\n");
  }

  if (intent === "write") {
    const rowValues = extractSheetRow(message);
    const fileName = extractWriteTargetName(message);

    if (!fileName) {
      return [
        "📊 *Tell me which sheet to update.*",
        "",
        "Example:",
        "_Add row to Sales Tracker: Rahul, 5000, March_",
      ].join("\n");
    }

    if (!rowValues.length) {
      return [
        "📊 *I need the row values too.*",
        "",
        "Example:",
        "_Add row to Sales Tracker: Rahul, 5000, March_",
      ].join("\n");
    }

    const files = await searchFiles(token, fileName);
    const sheet = files.find((file) => file.mimeType === GOOGLE_SHEET_MIME);
    if (!sheet) {
      return `📊 *I couldn't find a Google Sheet named "${fileName}".*`;
    }

    const success = await appendToSheet(token, sheet.id, rowValues).catch(() => false);
    return success
      ? `✅ *Row added to ${sheet.name}*\n\n${rowValues.join(" | ")}`
      : `❌ *I couldn't add that row to ${sheet.name} right now.*`;
  }

  const fileName = extractFileName(message);
  const files = fileName ? await searchFiles(token, fileName) : await listRecentFiles(token, 1);
  const file = files[0];

  if (!file) {
    return [
      `📂 *I couldn't find "${fileName || "that file"}" in your Drive.*`,
      "",
      "Try:",
      "• _List my files_",
      "• _Find budget spreadsheet_",
      "• _Read project plan doc_",
    ].join("\n");
  }

  const isSheet = file.mimeType === GOOGLE_SHEET_MIME;
  const isDoc = file.mimeType === GOOGLE_DOC_MIME;

  if (!isSheet && !isDoc) {
    return [
      `${mimeIcon(file.mimeType)} *${file.name}*`,
      "",
      "I can currently read *Google Docs* and *Google Sheets*.",
      `This file type isn't supported yet: _${file.mimeType}_`,
    ].join("\n");
  }

  const content = isSheet
    ? await readGoogleSheet(token, file.id).catch(() => "")
    : await readGoogleDoc(token, file.id).catch(() => "");

  if (!content) {
    return `❌ *I couldn't read ${file.name} right now.* The file may be restricted or too large.`;
  }

  const cleanedQuestion = fileName
    ? message
      .replace(/\b(open|read|show|find|summarise|summarize|summary of|what'?s? in|contents? of)\b/gi, "")
      .replace(new RegExp(fileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "")
      .trim()
    : message.trim();

  const answer = await answerAboutContent(
    content,
    file.name,
    cleanedQuestion || "Summarise this file and highlight what matters most.",
  );

  return `${isSheet ? "📊" : "📝"} *${file.name}*\n\n${answer}`;
}
