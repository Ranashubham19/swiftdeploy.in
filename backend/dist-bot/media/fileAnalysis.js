import { createRequire } from "module";
import { inflateRawSync } from "zlib";
const FILE_DOWNLOAD_TIMEOUT_MS = Math.max(5000, Math.min(25000, Number(process.env.FILE_DOWNLOAD_TIMEOUT_MS || "15000")));
const FILE_MAX_BYTES = Math.max(1024 * 1024, Math.min(30 * 1024 * 1024, Number(process.env.FILE_MAX_BYTES || `${12 * 1024 * 1024}`)));
const FILE_CONTENT_PROMPT_CHARS = Math.max(1200, Math.min(9000, Number(process.env.FILE_CONTENT_PROMPT_CHARS || "3600")));
const FILE_VISION_PROMPT_CHARS = Math.max(300, Math.min(2200, Number(process.env.FILE_VISION_PROMPT_CHARS || "900")));
const requireFromMedia = createRequire(import.meta.url);
let cachedPdfParseAdapter = null;
const imageExtensions = new Set([
    "jpg",
    "jpeg",
    "png",
    "webp",
    "bmp",
    "gif",
    "tiff",
    "tif",
    "heic",
    "heif",
    "svg",
]);
const textExtensions = new Set([
    "txt",
    "md",
    "markdown",
    "csv",
    "tsv",
    "json",
    "jsonl",
    "xml",
    "html",
    "htm",
    "yaml",
    "yml",
    "ini",
    "conf",
    "cfg",
    "log",
    "sql",
    "js",
    "jsx",
    "ts",
    "tsx",
    "py",
    "java",
    "c",
    "cpp",
    "h",
    "hpp",
    "cs",
    "go",
    "rs",
    "rb",
    "php",
    "swift",
    "kt",
    "kts",
    "sh",
    "bash",
    "zsh",
    "ps1",
    "bat",
    "env",
]);
const officeXmlExtensions = new Set(["docx", "pptx", "xlsx"]);
const textLikeMimeHints = [
    "text/",
    "application/json",
    "application/xml",
    "application/javascript",
    "application/x-javascript",
    "application/sql",
    "application/x-yaml",
    "application/yaml",
    "application/x-sh",
    "application/x-httpd-php",
];
const extractFileExtension = (name) => {
    const value = String(name || "").trim().toLowerCase();
    const dot = value.lastIndexOf(".");
    if (dot <= 0 || dot === value.length - 1)
        return "";
    return value.slice(dot + 1);
};
const looksImageLike = (mimeType, extension) => {
    if (String(mimeType || "").toLowerCase().startsWith("image/"))
        return true;
    return imageExtensions.has(String(extension || "").toLowerCase());
};
const looksPdfLike = (mimeType, extension) => {
    return String(mimeType || "").toLowerCase() === "application/pdf" || String(extension || "").toLowerCase() === "pdf";
};
const looksTextLike = (mimeType, extension) => {
    const mime = String(mimeType || "").toLowerCase();
    if (textLikeMimeHints.some((hint) => mime.startsWith(hint) || mime === hint))
        return true;
    return textExtensions.has(String(extension || "").toLowerCase());
};
const deriveOcrFileTypeHint = (mimeType, extension) => {
    const ext = String(extension || "").trim().toLowerCase();
    if (ext === "pdf" || String(mimeType || "").toLowerCase() === "application/pdf")
        return "PDF";
    if (ext)
        return ext.toUpperCase();
    const mime = String(mimeType || "").toLowerCase();
    if (mime.startsWith("image/")) {
        const imageKind = mime.split("/")[1] || "";
        return String(imageKind).toUpperCase();
    }
    return "";
};
const normalizePlainText = (text) => String(text || "")
    .replace(/\r/g, "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
const stripHtmlLikeTags = (html) => {
    const source = String(html || "");
    return normalizePlainText(source
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">"));
};
const scoreTextLikelihood = (text) => {
    const value = String(text || "");
    if (!value)
        return 0;
    let printable = 0;
    let replacement = 0;
    for (const ch of value) {
        const code = ch.charCodeAt(0);
        if (ch === "\uFFFD")
            replacement += 1;
        if (ch === "\n"
            || ch === "\r"
            || ch === "\t"
            || (code >= 32 && code <= 126)
            || (code >= 160 && code <= 55295)) {
            printable += 1;
        }
    }
    const ratio = printable / Math.max(1, value.length);
    const replacementPenalty = replacement / Math.max(1, value.length);
    return ratio - replacementPenalty * 2.2;
};
const decodeBufferAsText = (buffer, extension) => {
    if (!buffer || buffer.length === 0)
        return null;
    const utf8 = normalizePlainText(buffer.toString("utf8"));
    if (!utf8)
        return null;
    const textScore = scoreTextLikelihood(utf8.slice(0, 40000));
    const forceText = textExtensions.has(String(extension || "").toLowerCase());
    if (!forceText && textScore < 0.76)
        return null;
    const ext = String(extension || "").toLowerCase();
    if (ext === "html" || ext === "htm" || ext === "xml") {
        return stripHtmlLikeTags(utf8) || utf8;
    }
    if (ext === "json" || ext === "jsonl") {
        if (ext === "jsonl") {
            return utf8;
        }
        try {
            const parsed = JSON.parse(utf8);
            return normalizePlainText(JSON.stringify(parsed, null, 2));
        }
        catch {
            return utf8;
        }
    }
    return utf8;
};
const decodeXmlEntities = (value) => String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
    const cp = Number.parseInt(String(hex || ""), 16);
    return Number.isFinite(cp) ? String.fromCodePoint(cp) : " ";
})
    .replace(/&#(\d+);/g, (_m, dec) => {
    const cp = Number.parseInt(String(dec || ""), 10);
    return Number.isFinite(cp) ? String.fromCodePoint(cp) : " ";
});
const findZipEocdOffset = (buffer) => {
    const signature = 0x06054b50;
    const minOffset = Math.max(0, buffer.length - 0xFFFF - 22);
    for (let i = buffer.length - 22; i >= minOffset; i -= 1) {
        if (buffer.readUInt32LE(i) === signature)
            return i;
    }
    return -1;
};
const parseZipEntries = (buffer) => {
    if (!buffer || buffer.length < 32)
        return [];
    const entries = [];
    const eocdOffset = findZipEocdOffset(buffer);
    if (eocdOffset < 0 || eocdOffset + 22 > buffer.length)
        return [];
    const centralDirSize = buffer.readUInt32LE(eocdOffset + 12);
    const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);
    if (centralDirOffset <= 0 || centralDirOffset >= buffer.length)
        return [];
    let offset = centralDirOffset;
    const centralDirEnd = Math.min(buffer.length, centralDirOffset + centralDirSize);
    while (offset + 46 <= centralDirEnd) {
        const centralSig = buffer.readUInt32LE(offset);
        if (centralSig !== 0x02014b50)
            break;
        const compression = buffer.readUInt16LE(offset + 10);
        const compressedSize = buffer.readUInt32LE(offset + 20);
        const fileNameLength = buffer.readUInt16LE(offset + 28);
        const extraLength = buffer.readUInt16LE(offset + 30);
        const commentLength = buffer.readUInt16LE(offset + 32);
        const localHeaderOffset = buffer.readUInt32LE(offset + 42);
        const nameStart = offset + 46;
        const nameEnd = nameStart + fileNameLength;
        if (nameEnd > buffer.length)
            break;
        const entryName = buffer.slice(nameStart, nameEnd).toString("utf8").replace(/\\/g, "/");
        const localHeaderMin = localHeaderOffset + 30;
        if (localHeaderOffset >= 0 && localHeaderMin <= buffer.length && buffer.readUInt32LE(localHeaderOffset) === 0x04034b50) {
            const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
            const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
            const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
            const dataEnd = dataStart + compressedSize;
            if (dataStart >= 0 && dataEnd <= buffer.length && dataEnd > dataStart) {
                const compressed = buffer.slice(dataStart, dataEnd);
                let decoded = null;
                if (compression === 0) {
                    decoded = compressed;
                }
                else if (compression === 8) {
                    try {
                        decoded = inflateRawSync(compressed);
                    }
                    catch {
                        decoded = null;
                    }
                }
                if (decoded && decoded.length > 0) {
                    entries.push({ name: entryName, data: decoded });
                }
            }
        }
        offset = nameEnd + extraLength + commentLength;
    }
    return entries;
};
const xmlToReadableText = (xml) => normalizePlainText(decodeXmlEntities(String(xml || "")
    .replace(/<\/(?:w:p|a:p|text:p|p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")));
const extractTextFromOfficeXmlZip = (buffer, extension) => {
    if (!buffer || buffer.length === 0)
        return null;
    const ext = String(extension || "").toLowerCase().trim();
    if (!officeXmlExtensions.has(ext))
        return null;
    const entries = parseZipEntries(buffer);
    if (!entries.length)
        return null;
    const shouldInclude = (name) => {
        const n = String(name || "").toLowerCase();
        if (ext === "docx") {
            return /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(n);
        }
        if (ext === "pptx") {
            return /^ppt\/(?:slides\/slide\d+|notesSlides\/notesSlide\d+|slideLayouts\/slideLayout\d+)\.xml$/.test(n);
        }
        if (ext === "xlsx") {
            return /^xl\/(?:sharedstrings|worksheets\/sheet\d+|charts\/chart\d+)\.xml$/.test(n);
        }
        return false;
    };
    const selected = entries.filter((entry) => shouldInclude(entry.name));
    const candidateEntries = selected.length > 0
        ? selected
        : entries.filter((entry) => String(entry.name || "").toLowerCase().endsWith(".xml"));
    const fragments = candidateEntries
        .slice(0, 220)
        .map((entry) => xmlToReadableText(entry.data.toString("utf8")))
        .filter(Boolean);
    if (!fragments.length)
        return null;
    const combined = normalizePlainText(fragments.join("\n\n"));
    if (!combined)
        return null;
    const wordCount = combined.split(/\s+/).filter(Boolean).length;
    if (wordCount < 20)
        return null;
    return combined;
};
const decodePdfEscapes = (value) => String(value || "")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
const normalizePdfFragment = (value) => normalizePlainText(String(value || "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ")
    .replace(/\s{2,}/g, " "));
const looksHumanReadablePdfFragment = (value) => {
    const text = String(value || "").trim();
    if (!text)
        return false;
    if (text.length < 8)
        return false;
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < 2)
        return false;
    const letters = (text.match(/[A-Za-z]/g) || []).length;
    const digits = (text.match(/[0-9]/g) || []).length;
    const symbols = (text.match(/[^A-Za-z0-9\s]/g) || []).length;
    const alphaRatio = letters / Math.max(1, text.length);
    const symbolRatio = symbols / Math.max(1, text.length);
    // Keep normal text-like fragments, reject binary-looking random fragments.
    if (alphaRatio < 0.22 && digits < 3)
        return false;
    if (symbolRatio > 0.28)
        return false;
    return true;
};
const isLikelyGibberishText = (value) => {
    const text = normalizePdfFragment(value).toLowerCase();
    if (!text)
        return true;
    const tokens = text.split(/\s+/).filter(Boolean);
    if (tokens.length < 8)
        return true;
    const words = tokens.filter((token) => /[a-z]/.test(token));
    if (words.length < 6)
        return true;
    const vowelWords = words.filter((token) => /[aeiou]/.test(token)).length;
    const alphaChars = (text.match(/[a-z]/g) || []).length;
    const digitChars = (text.match(/[0-9]/g) || []).length;
    const alphaRatio = alphaChars / Math.max(1, text.length);
    const vowelWordRatio = vowelWords / Math.max(1, words.length);
    const tokenDensity = words.length / Math.max(1, tokens.length);
    if (alphaRatio < 0.35)
        return true;
    if (vowelWordRatio < 0.42)
        return true;
    if (tokenDensity < 0.45 && digitChars > alphaChars)
        return true;
    return false;
};
const extractTextFromPdfRawBuffer = (buffer) => {
    if (!buffer || buffer.length === 0)
        return null;
    const raw = buffer.toString("latin1");
    if (!raw.includes("%PDF"))
        return null;
    const matches = raw.match(/\((?:\\.|[^\\()]){4,240}\)/g) || [];
    if (matches.length === 0)
        return null;
    const lines = [];
    for (const token of matches.slice(0, 1200)) {
        const inner = token.slice(1, -1);
        const decoded = normalizePdfFragment(decodePdfEscapes(inner));
        if (!decoded)
            continue;
        if (!looksHumanReadablePdfFragment(decoded))
            continue;
        const score = scoreTextLikelihood(decoded);
        if (score < 0.8)
            continue;
        lines.push(decoded);
    }
    const joined = normalizePlainText(lines.join("\n"));
    if (!joined)
        return null;
    const totalWords = joined.split(/\s+/).filter(Boolean).length;
    if (totalWords < 20)
        return null;
    if (isLikelyGibberishText(joined))
        return null;
    return joined;
};
const trimForPrompt = (text, maxChars) => {
    const value = normalizePlainText(text);
    if (!value)
        return { value: "", truncated: false };
    if (value.length <= maxChars)
        return { value, truncated: false };
    return { value: `${value.slice(0, Math.max(200, maxChars)).trim()}...`, truncated: true };
};
const normalizeVisionChatEndpoint = (raw, fallback) => {
    const baseFallback = String(fallback || "").trim();
    const trimmed = String(raw || "").trim().replace(/\/+$/, "");
    const source = trimmed || baseFallback;
    if (!source)
        return "";
    if (/\/chat\/completions$/i.test(source))
        return source;
    let normalized = source.replace(/\/audio\/transcriptions$/i, "").replace(/\/+$/, "");
    if (/\/v1$/i.test(normalized)) {
        return `${normalized}/chat/completions`;
    }
    if (/\/v1\//i.test(normalized)) {
        normalized = normalized.replace(/\/v1\/.*$/i, "/v1");
        return `${normalized}/chat/completions`;
    }
    return `${normalized}/v1/chat/completions`;
};
const getPdfParseAdapter = () => {
    if (cachedPdfParseAdapter)
        return cachedPdfParseAdapter;
    try {
        const loaded = requireFromMedia("pdf-parse");
        const candidate = loaded?.default || loaded;
        const adapter = {};
        if (typeof candidate === "function") {
            adapter.v1Fn = candidate;
        }
        const v2CtorCandidate = loaded?.PDFParse || candidate?.PDFParse;
        if (typeof v2CtorCandidate === "function") {
            adapter.v2Ctor = v2CtorCandidate;
        }
        if (!adapter.v1Fn && !adapter.v2Ctor)
            return null;
        cachedPdfParseAdapter = adapter;
        return adapter;
    }
    catch {
        return null;
    }
};
const extractTextFromPdfLibrary = async (buffer) => {
    if (!buffer || buffer.length === 0)
        return null;
    const adapter = getPdfParseAdapter();
    if (!adapter)
        return null;
    if (adapter.v1Fn) {
        try {
            const parsed = await adapter.v1Fn(buffer);
            const text = normalizePlainText(String(parsed?.text || ""));
            if (text && !isLikelyGibberishText(text))
                return text;
        }
        catch {
            // Continue to v2 parser.
        }
    }
    if (adapter.v2Ctor) {
        let instance = null;
        try {
            instance = new adapter.v2Ctor({ data: buffer });
            const parsed = instance.getText ? await instance.getText() : null;
            const candidate = typeof parsed === "string" ? parsed : String(parsed?.text || "");
            const text = normalizePlainText(candidate);
            if (text && !isLikelyGibberishText(text))
                return text;
        }
        catch {
            return null;
        }
        finally {
            if (instance?.destroy) {
                await Promise.resolve(instance.destroy()).catch(() => { });
            }
        }
    }
    return null;
};
const extractParsedTextFromOcrSpacePayload = (payload) => {
    const parsed = Array.isArray(payload?.ParsedResults) ? payload.ParsedResults : [];
    const text = parsed
        .map((entry) => String(entry?.ParsedText || "").trim())
        .filter(Boolean)
        .join("\n")
        .trim();
    return text || null;
};
const extractOcrSpaceError = (payload) => {
    const direct = payload?.ErrorMessage;
    const details = payload?.ErrorDetails;
    const directText = Array.isArray(direct)
        ? direct.map((item) => String(item || "").trim()).filter(Boolean).join(" | ")
        : String(direct || "").trim();
    const detailText = String(details || "").trim();
    const base = [directText, detailText].filter(Boolean).join(" | ").trim();
    if (base)
        return base;
    if (payload?.IsErroredOnProcessing)
        return "OCR provider returned processing error.";
    return null;
};
const extractTextViaOcrSpace = async (input) => {
    const apiKey = String(process.env.OCR_SPACE_API_KEY || "").trim();
    if (!apiKey)
        return { text: null, error: "OCR API key is not configured.", method: "none" };
    const timeoutMs = Math.max(5000, Number(input.timeoutMs || 16000));
    const fileUrl = String(input.fileUrl || "").trim();
    const fileTypeHint = String(input.fileTypeHint || "").trim().toUpperCase();
    let bestError = null;
    if (/^https?:\/\//i.test(fileUrl)) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const body = new URLSearchParams({
                url: fileUrl,
                language: "eng",
                isOverlayRequired: "false",
                detectOrientation: "true",
                scale: "true",
                OCREngine: "2",
            });
            if (fileTypeHint)
                body.set("filetype", fileTypeHint);
            const response = await fetch("https://api.ocr.space/parse/image", {
                method: "POST",
                headers: {
                    apikey: apiKey,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: body.toString(),
                signal: controller.signal,
            });
            if (response.ok) {
                const payload = (await response.json().catch(() => ({})));
                const text = extractParsedTextFromOcrSpacePayload(payload);
                if (text)
                    return { text, error: null, method: "url" };
                const err = extractOcrSpaceError(payload);
                if (err)
                    bestError = err;
            }
            else {
                bestError = `OCR URL request failed with status ${response.status}.`;
            }
        }
        catch {
            bestError = bestError || "OCR URL request failed.";
        }
        finally {
            clearTimeout(timeout);
        }
    }
    const fileBuffer = input.fileBuffer;
    if (!fileBuffer || fileBuffer.length === 0) {
        return { text: null, error: bestError, method: "none" };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const form = new FormData();
        form.set("language", "eng");
        form.set("isOverlayRequired", "false");
        form.set("detectOrientation", "true");
        form.set("scale", "true");
        form.set("OCREngine", "2");
        if (fileTypeHint)
            form.set("filetype", fileTypeHint);
        const safeFileName = String(input.fileName || "upload.bin").trim() || "upload.bin";
        const safeMimeType = String(input.mimeType || "application/octet-stream").trim() || "application/octet-stream";
        form.set("file", new Blob([fileBuffer], { type: safeMimeType }), safeFileName);
        const response = await fetch("https://api.ocr.space/parse/image", {
            method: "POST",
            headers: {
                apikey: apiKey,
            },
            body: form,
            signal: controller.signal,
        });
        if (!response.ok) {
            return {
                text: null,
                error: bestError || `OCR upload request failed with status ${response.status}.`,
                method: "upload",
            };
        }
        const payload = (await response.json().catch(() => ({})));
        const text = extractParsedTextFromOcrSpacePayload(payload);
        if (text)
            return { text, error: null, method: "upload" };
        return {
            text: null,
            error: bestError || extractOcrSpaceError(payload),
            method: "upload",
        };
    }
    catch {
        return { text: null, error: bestError || "OCR upload request failed.", method: "upload" };
    }
    finally {
        clearTimeout(timeout);
    }
};
const analyzeImageViaOpenRouter = async (imageUrl, caption) => {
    const url = String(imageUrl || "").trim();
    if (!/^https?:\/\//i.test(url))
        return null;
    const featureToggle = String(process.env.LEGACY_IMAGE_ANALYSIS_ENABLED || process.env.VISION_ANALYSIS_ENABLED || "").trim().toLowerCase();
    const explicitlyDisabled = ["0", "false", "off", "no"].includes(featureToggle);
    const providers = [
        {
            endpoint: normalizeVisionChatEndpoint(String(process.env.NVIDIA_VISION_BASE_URL || process.env.NVIDIA_BASE_URL || "").trim(), "https://integrate.api.nvidia.com/v1/chat/completions"),
            apiKey: String(process.env.NVIDIA_API_KEY || "").trim(),
            model: String(process.env.NVIDIA_VISION_MODEL
                || process.env.OPENROUTER_VISION_MODEL
                || "meta/llama-3.2-90b-vision-instruct").trim(),
        },
        {
            endpoint: normalizeVisionChatEndpoint(String(process.env.OPENROUTER_BASE_URL || "").trim(), "https://openrouter.ai/api/v1/chat/completions"),
            apiKey: String(process.env.OPENROUTER_API_KEY || "").trim(),
            model: String(process.env.OPENROUTER_VISION_MODEL || process.env.DEFAULT_MODEL || "openrouter/free").trim(),
        },
    ].filter((provider) => provider.apiKey && provider.endpoint && provider.model);
    if (explicitlyDisabled || providers.length === 0)
        return null;
    const prompt = caption
        ? `Analyze this uploaded file preview image and summarize the full visible content. User context: ${caption}`
        : "Analyze this uploaded file preview image and summarize the visible content.";
    for (const provider of providers) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(provider.endpoint, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${provider.apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: provider.model,
                    temperature: 0.2,
                    max_tokens: 700,
                    messages: [
                        {
                            role: "user",
                            content: [
                                { type: "text", text: prompt },
                                { type: "image_url", image_url: { url } },
                            ],
                        },
                    ],
                }),
                signal: controller.signal,
            });
            if (!response.ok)
                continue;
            const data = (await response.json().catch(() => ({})));
            const content = data?.choices?.[0]?.message?.content;
            const text = Array.isArray(content)
                ? content
                    .map((item) => String(item?.text || item || "").trim())
                    .filter(Boolean)
                    .join("\n")
                    .trim()
                : String(content || "").trim();
            if (text)
                return text;
        }
        catch {
            // Continue to next provider candidate.
        }
        finally {
            clearTimeout(timeout);
        }
    }
    return null;
};
const downloadFileBuffer = async (fileUrl) => {
    const notes = [];
    const url = String(fileUrl || "").trim();
    if (!/^https?:\/\//i.test(url)) {
        notes.push("File URL was missing or invalid.");
        return { buffer: null, notes };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FILE_DOWNLOAD_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            notes.push(`File download failed with status ${response.status}.`);
            return { buffer: null, notes };
        }
        const declaredLength = Number(response.headers.get("content-length") || 0);
        if (Number.isFinite(declaredLength) && declaredLength > FILE_MAX_BYTES) {
            notes.push(`File too large for direct extraction (${declaredLength} bytes).`);
            return { buffer: null, notes };
        }
        const array = await response.arrayBuffer();
        const buffer = Buffer.from(array);
        if (buffer.length > FILE_MAX_BYTES) {
            notes.push(`File exceeded extraction size limit (${buffer.length} bytes).`);
            return { buffer: null, notes };
        }
        return { buffer, notes };
    }
    catch {
        notes.push("File download timed out or failed.");
        return { buffer: null, notes };
    }
    finally {
        clearTimeout(timeout);
    }
};
const analyzeDocumentFile = async (input) => {
    const fileUrl = String(input.fileUrl || "").trim();
    const fileName = String(input.fileName || "").trim();
    const mimeType = String(input.mimeType || "").trim().toLowerCase();
    const extension = extractFileExtension(fileName);
    const notes = [];
    const category = looksImageLike(mimeType, extension)
        ? "image"
        : looksPdfLike(mimeType, extension)
            ? "pdf"
            : looksTextLike(mimeType, extension)
                ? "text"
                : "binary";
    if (!fileUrl) {
        notes.push("Telegram file URL was unavailable.");
        return {
            category,
            extractionStatus: "none",
            extractionMethod: "none",
            extractedText: "",
            visionSummary: "",
            notes,
        };
    }
    if (category === "image") {
        const [ocrResult, visionSummary] = await Promise.all([
            extractTextViaOcrSpace({
                fileUrl,
                mimeType,
                fileName,
                fileTypeHint: deriveOcrFileTypeHint(mimeType, extension),
                timeoutMs: 15000,
            }),
            analyzeImageViaOpenRouter(fileUrl, String(input.caption || "")),
        ]);
        const ocr = normalizePlainText(String(ocrResult.text || ""));
        const vision = normalizePlainText(String(visionSummary || ""));
        const method = ocr && vision
            ? "ocr+vision"
            : ocr
                ? "ocr"
                : vision
                    ? "vision"
                    : "none";
        if (!ocr) {
            notes.push(ocrResult.error
                ? `Image OCR note: ${String(ocrResult.error).slice(0, 220)}`
                : "Image OCR text was unavailable.");
        }
        if (!vision)
            notes.push("Vision summary was unavailable.");
        return {
            category,
            extractionStatus: ocr || vision ? "partial" : "none",
            extractionMethod: method,
            extractedText: ocr,
            visionSummary: vision,
            notes,
        };
    }
    if (category === "pdf") {
        const downloaded = await downloadFileBuffer(fileUrl);
        notes.push(...downloaded.notes);
        const libraryText = downloaded.buffer ? await extractTextFromPdfLibrary(downloaded.buffer) : null;
        if (libraryText) {
            return {
                category,
                extractionStatus: "full",
                extractionMethod: "pdf-parse",
                extractedText: libraryText,
                visionSummary: "",
                notes,
            };
        }
        const ocrResult = await extractTextViaOcrSpace({
            fileUrl,
            fileBuffer: downloaded.buffer,
            fileName,
            mimeType: mimeType || "application/pdf",
            fileTypeHint: "PDF",
            timeoutMs: 22000,
        });
        const ocr = normalizePlainText(String(ocrResult.text || ""));
        if (ocr) {
            return {
                category,
                extractionStatus: "partial",
                extractionMethod: "ocr",
                extractedText: ocr,
                visionSummary: "",
                notes,
            };
        }
        if (ocrResult.error) {
            notes.push(`OCR note: ${String(ocrResult.error).slice(0, 240)}`);
        }
        const fallbackPdfText = downloaded.buffer ? extractTextFromPdfRawBuffer(downloaded.buffer) : null;
        if (fallbackPdfText) {
            notes.push("Used fallback PDF text decoding from raw file bytes.");
            return {
                category,
                extractionStatus: "partial",
                extractionMethod: "pdf-raw",
                extractedText: fallbackPdfText,
                visionSummary: "",
                notes,
            };
        }
        notes.push("PDF text extraction was unavailable in this attempt.");
        return {
            category,
            extractionStatus: "none",
            extractionMethod: "none",
            extractedText: "",
            visionSummary: "",
            notes,
        };
    }
    const downloaded = await downloadFileBuffer(fileUrl);
    notes.push(...downloaded.notes);
    if (!downloaded.buffer) {
        return {
            category,
            extractionStatus: "none",
            extractionMethod: "none",
            extractedText: "",
            visionSummary: "",
            notes,
        };
    }
    if (officeXmlExtensions.has(extension)) {
        const officeText = extractTextFromOfficeXmlZip(downloaded.buffer, extension);
        if (officeText) {
            return {
                category: "text",
                extractionStatus: "full",
                extractionMethod: "office-xml",
                extractedText: officeText,
                visionSummary: "",
                notes,
            };
        }
        notes.push("Office XML extraction was limited in this attempt.");
    }
    const decoded = decodeBufferAsText(downloaded.buffer, extension);
    if (!decoded) {
        notes.push("Could not decode this file as readable text.");
        return {
            category,
            extractionStatus: "none",
            extractionMethod: "binary",
            extractedText: "",
            visionSummary: "",
            notes,
        };
    }
    return {
        category: category === "binary" ? "text" : category,
        extractionStatus: "full",
        extractionMethod: "text",
        extractedText: decoded,
        visionSummary: "",
        notes,
    };
};
const buildDocumentResponseGuide = (caption, hasExtractedContent, extractionStatus) => {
    const askedQuestion = String(caption || "").trim();
    const lines = [
        "Document response rules:",
        hasExtractedContent
            ? "Use extracted file content as primary evidence. Do not invent facts outside the file."
            : "Content extraction is limited. Use available metadata and be explicit about limitations.",
        askedQuestion
            ? "If caption includes a question, answer it first in 2 to 4 lines."
            : "If no direct question is present, start with the file purpose and context.",
        "Treat file upload itself as an explicit request for a professional detailed summary.",
        "Do not ask the user to resend with a caption. Caption is optional.",
        "Then provide exactly these sections with one blank line between sections:",
        "File Overview:",
        "Detailed Topic Summary:",
        "Key Points and Concepts:",
        "Practical Learnings:",
        "Action Items:",
    ];
    if (extractionStatus !== "full") {
        lines.push("Add one transparent limitation line describing what could not be extracted.");
    }
    return lines.join("\n");
};
const buildPhotoResponseGuide = (caption, hasEvidence, extractionStatus) => {
    const askedQuestion = String(caption || "").trim();
    const lines = [
        "Photo response rules:",
        hasEvidence
            ? "Use OCR/vision evidence from this image as primary grounding. Do not invent unseen details."
            : "Visual extraction is limited. Be transparent about limits and still give best-effort useful observations.",
        askedQuestion
            ? "If caption includes a question, answer it first before the sectioned summary."
            : "If caption is empty, infer the likely user goal from visible image content.",
        "Then provide exactly these sections with one blank line between sections:",
        "File Overview:",
        "Detailed Topic Summary:",
        "Key Points and Concepts:",
        "Practical Learnings:",
        "Action Items:",
    ];
    if (extractionStatus !== "full") {
        lines.push("Include one short limitation line if OCR/vision evidence is partial.");
    }
    return lines.join("\n");
};
export const buildPhotoPromptFromTelegramFile = async (input) => {
    const fileName = String(input.fileName || "telegram_photo.jpg").trim() || "telegram_photo.jpg";
    const mimeType = String(input.mimeType || "image/jpeg").trim() || "image/jpeg";
    const caption = String(input.caption || "").trim();
    const captionBlock = caption ? `Caption: ${caption}` : "";
    const analysis = await analyzeDocumentFile({
        fileUrl: input.fileUrl,
        fileName,
        mimeType,
        caption,
    });
    const ocr = trimForPrompt(analysis.extractedText, Math.min(3200, FILE_CONTENT_PROMPT_CHARS));
    const vision = trimForPrompt(analysis.visionSummary, Math.min(2200, FILE_VISION_PROMPT_CHARS));
    const noteLines = analysis.notes
        .map((line) => normalizePlainText(line))
        .filter(Boolean)
        .slice(0, 6);
    const sections = [
        "[PHOTO MESSAGE]",
        captionBlock,
        `File name: ${fileName}`,
        `Mime type: ${mimeType}`,
        input.fileUrl ? `Telegram file URL: ${String(input.fileUrl).trim()}` : "",
        `Extraction method: ${analysis.extractionMethod}`,
        `Extraction status: ${analysis.extractionStatus}`,
        ocr.value ? `OCR text:\n${ocr.value}` : "",
        ocr.truncated ? "OCR text was truncated for prompt safety." : "",
        vision.value ? `Vision analysis:\n${vision.value}` : "",
        vision.truncated ? "Vision analysis was truncated for prompt safety." : "",
        noteLines.length > 0 ? `Image extraction notes:\n- ${noteLines.join("\n- ")}` : "",
        buildPhotoResponseGuide(caption, !!(ocr.value || vision.value), analysis.extractionStatus),
        "Please help based on this message content.",
    ].filter(Boolean);
    return sections.join("\n");
};
export const buildDocumentPromptFromTelegramFile = async (input) => {
    const fileName = String(input.fileName || "unknown").trim() || "unknown";
    const mimeType = String(input.mimeType || "unknown").trim() || "unknown";
    const caption = String(input.caption || "").trim();
    const captionBlock = caption ? `Caption: ${caption}` : "";
    const analysis = await analyzeDocumentFile(input);
    const extracted = trimForPrompt(analysis.extractedText, FILE_CONTENT_PROMPT_CHARS);
    const vision = trimForPrompt(analysis.visionSummary, FILE_VISION_PROMPT_CHARS);
    const noteLines = analysis.notes
        .map((line) => normalizePlainText(line))
        .filter(Boolean)
        .slice(0, 6);
    const sections = [
        "[DOCUMENT MESSAGE]",
        captionBlock,
        `File name: ${fileName}`,
        `Mime type: ${mimeType}`,
        input.fileUrl ? `Telegram file URL: ${String(input.fileUrl).trim()}` : "",
        `Detected file category: ${analysis.category}`,
        `Extraction method: ${analysis.extractionMethod}`,
        `Extraction status: ${analysis.extractionStatus}`,
        extracted.value ? `Extracted content:\n${extracted.value}` : "Extracted content unavailable in this attempt.",
        extracted.truncated ? "Extracted content was truncated for prompt safety." : "",
        vision.value ? `Visual file analysis:\n${vision.value}` : "",
        noteLines.length > 0 ? `Extraction notes:\n- ${noteLines.join("\n- ")}` : "",
        buildDocumentResponseGuide(caption, !!extracted.value, analysis.extractionStatus),
        "Please help based on this message content.",
    ].filter(Boolean);
    return sections.join("\n");
};
