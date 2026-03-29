import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";
import { extractDocumentText, isSupportedDocument } from "@/lib/clawcloud-docs";
import {
  buildGoogleReconnectRequiredReply,
  getValidGoogleAccessToken,
  isClawCloudGoogleNotConnectedError,
  isClawCloudGoogleReconnectRequiredError,
} from "@/lib/clawcloud-google";
import { looksLikeDriveKnowledgeQuestion } from "@/lib/clawcloud-workspace-knowledge";

const DRIVE_TIMEOUT_MS = 10_000;
const DRIVE_MAX_FILES = 8;
const SHEETS_MAX_ROWS = 100;
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";

type DriveIntent = "read" | "list" | "search" | "write" | "details" | null;

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
  description?: string;
  size?: string;
  parents?: string[];
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
  /\b(drive files?|drive folders?|files? in (?:google\s+)?drive|folders? in (?:google\s+)?drive)\b/i,
  /\b(google sheet|google sheets|gsheet|spreadsheet)\b/i,
  /\b(google doc|google docs|gdoc)\b/i,
  /\b(folder|directory)\b/i,
  /\b(my (files?|documents?|folders?|sheets?|docs?|spreadsheets?))\b/i,
  /\b(recent|latest)\s+(drive\s+)?(files?|folders?|docs?|sheets?|spreadsheets?)\b/i,
  /\b(open|read|show|find|search|list)\s+(my\s+)?(file|folder|doc|sheet|spreadsheet|document)\b/i,
  /\b(what('?s| is) in|contents? of|summary of)\s+.*(folder|sheet|doc|file|spreadsheet)\b/i,
  /\b(update|append|add row|add to)\s+.*(sheet|spreadsheet)\b/i,
  /\b(details? of|show details? for|open link for)\s+.*(file|folder|doc|sheet|spreadsheet|document)\b/i,
];

const SHEET_WRITE_PATTERNS = [
  /\b(add|append|insert|update)\s+(a\s+)?row\b/i,
  /\b(add to|write to|update)\s+.*(sheet|spreadsheet)\b/i,
];

function hasExplicitDriveWorkspaceContext(message: string) {
  const normalized = message.toLowerCase().trim();
  return (
    /\b(my drive|drive files?|drive folders?|files? in (?:google\s+)?drive|folders? in (?:google\s+)?drive)\b/.test(normalized)
    || /\b(my (files?|documents?|folders?|sheets?|docs?|spreadsheets?))\b/.test(normalized)
    || (/\bmy\b/.test(normalized) && /\b(file|files|folder|folders|doc|docs|document|documents|sheet|sheets|spreadsheet|spreadsheets)\b/.test(normalized))
    || /\b(google doc|google docs|google sheet|google sheets|gdoc|gsheet)\b/.test(normalized)
    || /\b(?:in|from|on)\s+(?:google\s+)?drive\b/.test(normalized)
  );
}

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

async function googleBuffer(baseUrl: string, path: string, token: string): Promise<Buffer> {
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

    return Buffer.from(await response.arrayBuffer());
  });
}

function escapeDriveQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mimeIcon(mimeType: string) {
  if (mimeType.includes("spreadsheet")) return "📊";
  if (mimeType.includes("document")) return "📝";
  if (mimeType.includes("presentation")) return "🗂️";
  if (mimeType.includes("pdf")) return "📄";
  if (mimeType.includes("image")) return "🖼️";
  if (mimeType.includes("folder")) return "📁";
  return "📎";
}

function mimeLabel(mimeType: string) {
  if (mimeType === GOOGLE_SHEET_MIME) return "Google Sheet";
  if (mimeType === GOOGLE_DOC_MIME) return "Google Doc";
  if (mimeType === GOOGLE_FOLDER_MIME) return "Folder";
  if (mimeType.includes("pdf")) return "PDF";
  if (mimeType.includes("json")) return "JSON";
  if (mimeType.includes("csv")) return "CSV";
  if (mimeType.includes("text")) return "Text";
  if (mimeType.includes("spreadsheet")) return "Spreadsheet";
  if (mimeType.includes("document")) return "Document";
  return mimeType;
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

function formatFileSize(size: string | undefined) {
  const bytes = Number(size ?? "");
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "Unknown size";
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function extractFileName(message: string) {
  return message
    .replace(/\b(open|read|show|find|search for|look for|list|summary of|summarise|summarize|contents? of|what'?s? in|add to|write to|update|details? of|show details? for|open link for)\b/gi, "")
    .replace(/\b(my|the|a|an)\b/gi, "")
    .replace(/\b(google sheet|google sheets|google doc|google docs|google drive|drive|spreadsheet|sheet|document|doc|file|files|folder|folders|directory|gdoc|gsheet)\b/gi, "")
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
    `/drive/v3/files?pageSize=${maxResults}&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime,webViewLink,description,size,parents)&q=trashed=false`,
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
    `/drive/v3/files?q=${q}&pageSize=6&fields=files(id,name,mimeType,modifiedTime,webViewLink,description,size,parents)`,
    token,
  );

  return data.files ?? [];
}

async function listFolderChildren(token: string, folderId: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const data = await googleJson<{ files?: DriveFile[] }>(
    "https://www.googleapis.com",
    `/drive/v3/files?q=${q}&pageSize=12&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime,webViewLink,description,size,parents)`,
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

async function downloadDriveFile(token: string, fileId: string) {
  return googleBuffer(
    "https://www.googleapis.com",
    `/drive/v3/files/${fileId}?alt=media`,
    token,
  );
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
  const normalized = message.toLowerCase().trim();
  if (looksLikeDriveKnowledgeQuestion(message)) {
    return null;
  }

  if (SHEET_WRITE_PATTERNS.some((pattern) => pattern.test(message))) {
    return "write";
  }

  const hasDriveKeyword = /\b(google drive|my drive|gdrive|g drive|drive)\b/.test(normalized);
  const hasDriveObjectKeyword = /\b(file|files|folder|folders|doc|docs|document|documents|sheet|sheets|spreadsheet|spreadsheets)\b/.test(normalized);
  const hasDriveActionKeyword = /\b(list|show|read|open|find|search|look for|what(?:'s| is) in|contents? of|summary of|details? of|append|add row|update|write to)\b/.test(normalized);
  const hasDriveWorkspaceContext = hasExplicitDriveWorkspaceContext(message);
  const hasLoosePersonalFileAccess = /\bmy\b/.test(normalized) && hasDriveActionKeyword && hasDriveObjectKeyword;
  const looksLikeDrivePlanningPrompt =
    /\b(design|plan|organize|organise|structure|template|workflow|strategy|naming convention|taxonomy)\b/.test(normalized)
    && /\b(google drive|drive|folder|folders|file|files|document|documents|sheet|sheets|spreadsheet|spreadsheets)\b/.test(normalized);

  if (
    (!DRIVE_PATTERNS.some((pattern) => pattern.test(message)) && !(hasDriveKeyword && (hasDriveObjectKeyword || hasDriveActionKeyword)) && !hasLoosePersonalFileAccess)
    || (!hasDriveWorkspaceContext && !hasLoosePersonalFileAccess && !(hasDriveKeyword && hasDriveActionKeyword && hasDriveObjectKeyword))
  ) {
    return null;
  }

  if (looksLikeDrivePlanningPrompt && !hasDriveActionKeyword) {
    return null;
  }

  if (/\b(list|show me|recent|latest|what files|what folders)\b/i.test(message)) {
    if (!/\b(read|open|what(?:'s| is) in|contents? of|summary of)\b/i.test(message)) {
      return "list";
    }
  }

  if (/\b(find|search for|look for)\b/i.test(message)) {
    return "search";
  }

  if (/\b(details? of|show details? for|open link for|file info)\b/i.test(message)) {
    return "details";
  }

  if (/\b(read|open|what(?:'s| is) in|contents? of|summary of)\b/i.test(message)) {
    return "read";
  }

  return null;
}

function connectedDriveReply() {
  return [
    "📂 *Google Drive not connected*",
    "",
    "Reconnect Google at *swift-deploy.in/settings* to grant Drive and Sheets access.",
    "Then try again with _list my files_ or _read my sales sheet_.",
  ].join("\n");
}

function driveUnavailableReply() {
  return [
    "ðŸ“‚ *I couldn't read Google Drive right now.*",
    "",
    "Please try again in a moment.",
    "If this keeps happening, reconnect Google at *swift-deploy.in/settings* and try again.",
  ].join("\n");
}

function looksLikeDriveReconnectError(error: unknown) {
  if (isClawCloudGoogleReconnectRequiredError(error)) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  return (
    normalized.includes("google api 401")
    || normalized.includes("google api 403")
    || /\binsufficient\b.*\bscope\b/.test(normalized)
    || /\binsufficient\b.*\bpermission\b/.test(normalized)
    || /\bpermission denied\b/.test(normalized)
    || /\bunauthorized\b/.test(normalized)
    || /\bforbidden\b/.test(normalized)
  );
}

function buildDriveFileSummary(file: DriveFile) {
  const lines = [
    `${mimeIcon(file.mimeType)} *${file.name}*`,
    `${mimeLabel(file.mimeType)} - modified ${formatRelativeTime(file.modifiedTime)}`,
  ];
  if (file.description) {
    lines.push(file.description.trim());
  }
  if (file.webViewLink) {
    lines.push(`Open: ${file.webViewLink}`);
  }
  return lines.join("\n");
}

export async function handleDriveQuery(userId: string, message: string) {
  let token: string;
  try {
    token = await getValidGoogleAccessToken(userId, "google_drive");
  } catch (error) {
    if (isClawCloudGoogleNotConnectedError(error, "google_drive")) {
      return connectedDriveReply();
    }
    if (looksLikeDriveReconnectError(error)) {
      return buildGoogleReconnectRequiredReply("Google Drive");
    }
    return connectedDriveReply();
  }

  const intent = detectDriveIntent(message);
  try {

  if (intent === "list") {
    const files = await listRecentFiles(token);
    if (!files.length) {
      return "📂 *No recent Drive files found.*";
    }

    const lines = ["📂 *Recent Google Drive files*", ""];
    for (const file of files) {
      lines.push(buildDriveFileSummary(file));
      lines.push("");
    }
    lines.push("_Say 'read [file name]' to open one or 'details of [file name]' for metadata._");
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
      lines.push(buildDriveFileSummary(file));
      lines.push("");
    }
    lines.push("_Say 'read [file name]' to open one or 'details of [file name]' for metadata._");
    return lines.join("\n");
  }

  if (intent === "details") {
    const query = extractFileName(message);
    const files = await searchFiles(token, query);
    const file = files[0];
    if (!file) {
      return `📂 *I couldn't find "${query || "that file"}" in your Drive.*`;
    }

    return [
      `${mimeIcon(file.mimeType)} *${file.name}*`,
      "",
      `Type: ${mimeLabel(file.mimeType)}`,
      `Modified: ${formatRelativeTime(file.modifiedTime)}`,
      `Size: ${formatFileSize(file.size)}`,
      file.description ? `Description: ${file.description}` : "",
      file.webViewLink ? `Open: ${file.webViewLink}` : "",
    ].filter(Boolean).join("\n");
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

  if (file.mimeType === GOOGLE_FOLDER_MIME) {
    const children = await listFolderChildren(token, file.id);
    if (!children.length) {
      return `📁 *${file.name}*\n\nThis folder is empty right now.`;
    }

    const lines = [`📁 *${file.name}*`, "", "Recent items inside:", ""];
    for (const child of children) {
      lines.push(buildDriveFileSummary(child));
      lines.push("");
    }
    return lines.join("\n");
  }

  const isSheet = file.mimeType === GOOGLE_SHEET_MIME;
  const isDoc = file.mimeType === GOOGLE_DOC_MIME;
  const supportsDocumentExtraction = isSupportedDocument(file.mimeType, file.name);

  if (!isSheet && !isDoc && !supportsDocumentExtraction) {
    return [
      `${mimeIcon(file.mimeType)} *${file.name}*`,
      "",
      "I can currently read Google Docs, Google Sheets, PDFs, Word files, Excel files, TXT, CSV, Markdown, and JSON files from Drive.",
      `This file type is not supported yet: _${file.mimeType}_`,
      file.webViewLink ? `Open: ${file.webViewLink}` : "",
    ].filter(Boolean).join("\n");
  }

  const content = isSheet
    ? await readGoogleSheet(token, file.id).catch(() => "")
    : isDoc
      ? await readGoogleDoc(token, file.id).catch(() => "")
      : await downloadDriveFile(token, file.id)
        .then((buffer) => extractDocumentText(buffer, file.mimeType, file.name))
        .then((result) => result?.text ?? "")
        .catch(() => "");

  if (!content) {
    return `❌ *I couldn't read ${file.name} right now.* The file may be restricted, image-only, or too large.`;
  }

  const cleanedQuestion = fileName
    ? message
      .replace(/\b(open|read|show|find|summarise|summarize|summary of|what'?s? in|contents? of|details? of)\b/gi, "")
      .replace(new RegExp(escapeRegex(fileName), "gi"), "")
      .trim()
    : message.trim();

  const answer = await answerAboutContent(
    content,
    file.name,
    cleanedQuestion || "Summarise this file and highlight what matters most.",
  );

  return [
    `${isSheet ? "📊" : "📝"} *${file.name}*`,
    file.webViewLink ? `Open: ${file.webViewLink}` : "",
    "",
    answer,
  ].filter(Boolean).join("\n");
  } catch (error) {
    if (looksLikeDriveReconnectError(error)) {
      return buildGoogleReconnectRequiredReply("Google Drive");
    }
    return driveUnavailableReply();
  }
}
