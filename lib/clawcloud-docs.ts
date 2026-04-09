import { looksLikeGroundedMediaPrompt } from "@/lib/clawcloud-media-context";

// lib/clawcloud-docs.ts
// ─────────────────────────────────────────────────────────────────────────────
// Document text extraction for WhatsApp file attachments.
//
// Supports: PDF, DOCX, DOC, XLSX, XLS, TXT, CSV, JSON
// Called from agent-server.ts when Baileys delivers a documentMessage.
//
// Uses pdfjs-dist for PDF and mammoth for DOCX — both are already in your
// dependency tree via the project. Falls back to raw text decode for plain
// text files.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_EXTRACT_CHARS = 12_000; // ~3 000 tokens — safe for a single LLM call
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB hard limit
export const DOCUMENT_CONTEXT_MARKER_START = "--- Document content ---";
export const DOCUMENT_CONTEXT_MARKER_END = "--- End of document ---";

// ─── Public API ───────────────────────────────────────────────────────────────

export type DocExtractResult = {
  text: string;
  pageCount?: number;
  mimeType: string;
  fileName: string;
  truncated: boolean;
};

type DocumentFailureReason =
  | "analysis_failed"
  | "download_failed"
  | "unsupported_type";

export function buildDocumentGroundingFailureReply(input: {
  fileName: string;
  userQuestion?: string | null;
  reason: DocumentFailureReason;
}) {
  const hadQuestion = Boolean(String(input.userQuestion ?? "").trim());
  const fileLabel = input.fileName?.trim() || "this document";

  if (input.reason === "download_failed") {
    return hadQuestion
      ? `I received *${fileLabel}* and your question, but I could not download the document content reliably. I will not guess from the filename or caption alone. Please resend the file or send a clearer copy.`
      : `I received *${fileLabel}*, but I could not download the document content reliably. Please resend the file or send a clearer copy.`;
  }

  if (input.reason === "unsupported_type") {
    return hadQuestion
      ? `I received *${fileLabel}* and your question, but that file type is not supported for grounded document analysis yet. I will not guess from the caption alone. Please resend it as PDF, DOCX, XLSX, TXT, CSV, Markdown, or JSON.`
      : `I received *${fileLabel}*, but that file type is not supported for grounded document analysis yet. Please resend it as PDF, DOCX, XLSX, TXT, CSV, Markdown, or JSON.`;
  }

  return hadQuestion
    ? `I received *${fileLabel}* and your question, but I could not extract reliable enough text to answer accurately. I am not going to guess from partial document content. Please resend a clearer file or ask about a specific visible section.`
    : `I received *${fileLabel}*, but I could not extract reliable enough text to answer accurately. Please resend a clearer file or ask about a specific visible section.`;
}

async function extractPdfWithOcr(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
  pageCount: number,
): Promise<DocExtractResult | null> {
  let worker: Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>> | null = null;

  try {
    const { createWorker } = await import("tesseract.js");
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs").catch(
      () => import("pdfjs-dist"),
    );
    const canvasModule = await import("canvas").catch(() => null);
    const createCanvas = canvasModule?.createCanvas;

    if (!createCanvas) {
      console.warn("[docs] OCR skipped: canvas package not installed");
      return null;
    }

    const uint8 = new Uint8Array(buffer);
    const pdfDoc = await pdfjsLib.getDocument({ data: uint8, verbosity: 0 }).promise;
    worker = await createWorker("eng+hin");

    const textParts: string[] = [];
    let totalChars = 0;
    let truncated = false;
    const maxPages = Math.min(pdfDoc.numPages, 5);

    for (let pageNum = 1; pageNum <= maxPages; pageNum += 1) {
      if (totalChars >= MAX_EXTRACT_CHARS) {
        truncated = true;
        break;
      }

      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");

      if (!context) {
        console.warn("[docs] OCR skipped: could not create canvas context");
        return null;
      }

      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;

      const imageBuffer = canvas.toBuffer("image/png");
      const recognized = await worker.recognize(imageBuffer);
      const pageText = recognized.data.text.trim().replace(/\s{2,}/g, " ");

      if (pageText.length > 20) {
        textParts.push(`[Page ${pageNum} — OCR]\n${pageText}`);
        totalChars += pageText.length;
      }
    }

    const fullText = textParts.join("\n\n");
    if (!fullText.trim()) {
      return null;
    }

    const finalText = truncated ? fullText.slice(0, MAX_EXTRACT_CHARS) : fullText;
    console.log(`[docs] OCR success: ${Math.min(pageCount, 5)} pages, ${finalText.length} chars`);

    return {
      text: `⚠️ _This PDF was scanned — text extracted via OCR (may have minor errors)_\n\n${finalText}`,
      pageCount,
      mimeType,
      fileName,
      truncated: truncated || pageCount > 5,
    };
  } catch (error) {
    console.error(
      "[docs] OCR fallback failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  } finally {
    if (worker) {
      await worker.terminate().catch(() => null);
    }
  }
}

async function extractXlsx(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<DocExtractResult | null> {
  try {
    const xlsxModule = await import("xlsx") as typeof import("xlsx") & {
      default?: typeof import("xlsx");
    };
    const XLSX = xlsxModule.default ?? xlsxModule;
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const textParts: string[] = [];
    let totalChars = 0;
    let truncated = false;

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) {
        continue;
      }

      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
      if (!csv) {
        continue;
      }

      const sheetText = `[Sheet: ${sheetName}]\n${csv}`;
      const separatorLength = textParts.length > 0 ? 2 : 0;
      const remainingChars = MAX_EXTRACT_CHARS - totalChars - separatorLength;

      if (remainingChars <= 0) {
        truncated = true;
        break;
      }

      if (sheetText.length > remainingChars) {
        textParts.push(sheetText.slice(0, remainingChars));
        truncated = true;
        break;
      }

      textParts.push(sheetText);
      totalChars += sheetText.length + separatorLength;
    }

    const finalText = textParts.join("\n\n").trim();

    if (!finalText) {
      console.warn("[docs] Excel file appears empty");
      return null;
    }

    console.log(
      `[docs] Excel extracted: ${workbook.SheetNames.length} sheets, ${finalText.length} chars`,
    );
    return { text: finalText, mimeType, fileName, truncated };
  } catch (error) {
    console.error(
      "[docs] Excel extraction failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Extract readable text from a document buffer.
 *
 * @param buffer    Raw file bytes
 * @param mimeType  MIME type from WhatsApp documentMessage
 * @param fileName  Original file name reported by WhatsApp
 * @returns         Extracted text result, or null if unsupported/failed
 */
export async function extractDocumentText(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<DocExtractResult | null> {
  if (!buffer || buffer.length === 0) {
    console.warn("[docs] Empty buffer, skipping extraction");
    return null;
  }

  if (buffer.length > MAX_FILE_SIZE_BYTES) {
    console.warn(
      `[docs] File too large: ${(buffer.length / 1024 / 1024).toFixed(1)} MB — max 15 MB`,
    );
    return null;
  }

  const lower = (mimeType + fileName).toLowerCase();
  console.log(`[docs] Extracting "${fileName}" (${mimeType}, ${buffer.length} bytes)`);

  try {
    // ── PDF ──────────────────────────────────────────────────────────────────
    if (lower.includes("pdf")) {
      return await extractPdf(buffer, mimeType, fileName);
    }

    // ── DOCX / DOC ───────────────────────────────────────────────────────────
    if (
      lower.includes("docx") ||
      lower.includes("officedocument.wordprocessingml") ||
      lower.includes("msword")
    ) {
      return await extractDocx(buffer, mimeType, fileName);
    }

    if (
      lower.includes("xlsx") ||
      lower.includes("xls") ||
      lower.includes("spreadsheetml") ||
      lower.includes("ms-excel")
    ) {
      return await extractXlsx(buffer, mimeType, fileName);
    }

    // ── Plain text / CSV / Markdown ──────────────────────────────────────────
    if (
      lower.includes("text/") ||
      lower.includes(".txt") ||
      lower.includes(".csv") ||
      lower.includes(".md") ||
      lower.includes(".json")
    ) {
      return extractPlainText(buffer, mimeType, fileName);
    }

    console.warn(`[docs] Unsupported file type: ${mimeType} (${fileName})`);
    return null;
  } catch (error) {
    console.error(
      "[docs] Extraction error:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Returns true if the MIME type / filename looks like a supported document.
 */
export function isSupportedDocument(mimeType: string, fileName: string): boolean {
  const lower = (mimeType + fileName).toLowerCase();
  return (
    lower.includes("pdf") ||
    lower.includes("docx") ||
    lower.includes("msword") ||
    lower.includes("officedocument.wordprocessingml") ||
    lower.includes("spreadsheetml") ||
    lower.includes("ms-excel") ||
    lower.includes("text/plain") ||
    lower.includes(".txt") ||
    lower.includes(".csv") ||
    lower.includes(".md") ||
    lower.includes(".json") ||
    lower.includes(".xlsx") ||
    lower.includes(".xls")
  );
}

/**
 * Build the prefix string injected before the extracted text in the agent prompt.
 */
export function buildDocumentPromptPrefix(result: DocExtractResult): string {
  const lines: string[] = [
    `📄 *User sent a document: "${result.fileName}"*`,
    `Type: ${result.mimeType}`,
  ];
  if (result.pageCount) {
    lines.push(`Pages: ${result.pageCount}`);
  }
  if (result.truncated) {
    lines.push(
      `⚠️ Document is large — showing first ${MAX_EXTRACT_CHARS} characters.`,
    );
  }
  lines.push("", DOCUMENT_CONTEXT_MARKER_START, result.text, DOCUMENT_CONTEXT_MARKER_END);
  return lines.join("\n");
}

export function buildDocumentQuestionPrompt(
  result: DocExtractResult,
  userQuestion?: string | null,
): string {
  const prefix = buildDocumentPromptPrefix(result);
  const trimmedQuestion = userQuestion?.trim();

  if (trimmedQuestion) {
    return `${prefix}\n\nUser question about this document: ${trimmedQuestion}`;
  }

  return `${prefix}\n\nPlease summarize this document and highlight the key points.`;
}

export function looksLikeDocumentPrompt(text: string): boolean {
  if (!text.trim()) {
    return false;
  }

  return (
    /user sent a document:/i.test(text)
    || text.includes(DOCUMENT_CONTEXT_MARKER_START)
    || text.includes(DOCUMENT_CONTEXT_MARKER_END)
    || /\buser question about this document:/i.test(text)
    || /\bfollow-up question about this document:/i.test(text)
    || looksLikeGroundedMediaPrompt(text)
  );
}

export function extractDocumentContextSnippet(
  text: string,
  maxChars = 3_200,
): string | null {
  const trimmed = text.trim();
  if (!looksLikeDocumentPrompt(trimmed)) {
    return null;
  }

  const startIndex = trimmed.indexOf(DOCUMENT_CONTEXT_MARKER_START);
  const endIndex = trimmed.indexOf(DOCUMENT_CONTEXT_MARKER_END);
  const hasMarkers = startIndex >= 0 && endIndex > startIndex;
  const snippet = hasMarkers
    ? trimmed.slice(0, endIndex + DOCUMENT_CONTEXT_MARKER_END.length)
    : trimmed;

  if (snippet.length <= maxChars) {
    return snippet;
  }

  if (!hasMarkers) {
    return `${snippet.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
  }

  const header = trimmed.slice(0, startIndex).trimEnd();
  const contentStart = startIndex + DOCUMENT_CONTEXT_MARKER_START.length;
  const documentText = trimmed.slice(contentStart, endIndex).trim();
  const questionMatch = trimmed
    .slice(endIndex + DOCUMENT_CONTEXT_MARKER_END.length)
    .trim();
  const reservedChars = `${header}\n${DOCUMENT_CONTEXT_MARKER_START}\n${DOCUMENT_CONTEXT_MARKER_END}\n\n${questionMatch}`.length;
  const availableChars = Math.max(400, maxChars - reservedChars - 1);
  const shortenedDocument = documentText.length > availableChars
    ? `${documentText.slice(0, Math.max(0, availableChars - 1)).trimEnd()}...`
    : documentText;

  return [
    header,
    DOCUMENT_CONTEXT_MARKER_START,
    shortenedDocument,
    DOCUMENT_CONTEXT_MARKER_END,
    questionMatch,
  ].filter(Boolean).join("\n");
}

// ─── PDF extraction ───────────────────────────────────────────────────────────

async function extractPdf(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<DocExtractResult | null> {
  try {
    // Dynamic import — pdfjs-dist is an optional peer dependency
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs").catch(
      () => import("pdfjs-dist"),
    );

    // pdfjs needs a Uint8Array
    const uint8 = new Uint8Array(buffer);
    const loadingTask = pdfjsLib.getDocument({ data: uint8, verbosity: 0 });
    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;

    const textParts: string[] = [];
    let totalChars = 0;
    let truncated = false;

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      if (totalChars >= MAX_EXTRACT_CHARS) {
        truncated = true;
        break;
      }

      const page = await pdfDoc.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str ?? "" : ""))
        .join(" ")
        .replace(/\s{2,}/g, " ")
        .trim();

      if (pageText) {
        textParts.push(`[Page ${pageNum}]\n${pageText}`);
        totalChars += pageText.length;
      }
    }

    const fullText = textParts.join("\n\n");
    const finalText = truncated
      ? fullText.slice(0, MAX_EXTRACT_CHARS)
      : fullText;

    if (!finalText.trim()) {
      console.warn("[docs] PDF appears to be image-only — attempting OCR fallback");
      const ocrResult = await extractPdfWithOcr(buffer, mimeType, fileName, numPages);
      if (ocrResult) {
        return ocrResult;
      }
      return {
        text: "⚠️ This PDF appears to contain scanned images only. OCR extraction was attempted but could not read the text clearly. Please try sending a clearer scan or a text-based PDF.",
        pageCount: numPages,
        mimeType,
        fileName,
        truncated: false,
      };
    }

    console.log(
      `[docs] PDF extracted: ${numPages} pages, ${finalText.length} chars`,
    );
    return {
      text: finalText,
      pageCount: numPages,
      mimeType,
      fileName,
      truncated,
    };
  } catch (error) {
    console.error(
      "[docs] PDF extraction failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

// ─── DOCX extraction ─────────────────────────────────────────────────────────

async function extractDocx(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<DocExtractResult | null> {
  try {
    // Dynamic import — mammoth is an optional peer dependency
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mammoth = await import("mammoth");

    const result = await mammoth.extractRawText({ buffer });

    if (result.messages?.length) {
      for (const msg of result.messages) {
        if (msg.type === "error") {
          console.warn(`[docs] mammoth warning: ${msg.message}`);
        }
      }
    }

    const rawText = result.value?.trim() ?? "";
    if (!rawText) {
      console.warn("[docs] DOCX returned empty text");
      return null;
    }

    const truncated = rawText.length > MAX_EXTRACT_CHARS;
    const finalText = truncated ? rawText.slice(0, MAX_EXTRACT_CHARS) : rawText;

    console.log(
      `[docs] DOCX extracted: ${finalText.length} chars`,
    );
    return { text: finalText, mimeType, fileName, truncated };
  } catch (error) {
    console.error(
      "[docs] DOCX extraction failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

// ─── Plain text extraction ────────────────────────────────────────────────────

function extractPlainText(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): DocExtractResult {
  const rawText = buffer.toString("utf-8");
  const truncated = rawText.length > MAX_EXTRACT_CHARS;
  const text = truncated ? rawText.slice(0, MAX_EXTRACT_CHARS) : rawText;

  console.log(`[docs] Plain text extracted: ${text.length} chars`);
  return { text, mimeType, fileName, truncated };
}
