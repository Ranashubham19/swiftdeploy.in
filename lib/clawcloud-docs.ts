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

// ─── Public API ───────────────────────────────────────────────────────────────

export type DocExtractResult = {
  text: string;
  pageCount?: number;
  mimeType: string;
  fileName: string;
  truncated: boolean;
};

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
  lines.push("", "--- Document content ---", result.text, "--- End of document ---");
  return lines.join("\n");
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
      console.warn("[docs] PDF appears to be image-only (no extractable text)");
      return {
        text: "This PDF appears to contain only images. Text extraction was not possible.",
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
