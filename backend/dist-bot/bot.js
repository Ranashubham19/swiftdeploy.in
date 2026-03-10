import { Input, Markup, Telegraf } from "telegraf";
import { MessageRole } from "@prisma/client";
import { CURATED_FREE_MODEL_POOLS, FORCE_OPENROUTER_FREE_ONLY_MODE, isCuratedStrongFreeModelId, isFreeOnlyApprovedModelId, MODEL_LIST, OPENROUTER_FREE_MODEL_ID, } from "./openrouter/models.js";
import { currentEventsDisclaimer, buildIntentRoutingInstruction, classifyProfessionalIntent, detectIntent, mapProfessionalIntentToRuntimeIntent, normalizeIncomingUserMessage, routeModel, } from "./openrouter/router.js";
import { buildSystemPrompt } from "./openrouter/prompts.js";
import { TOOL_SCHEMAS, executeTool, shouldEnableTools } from "./tools/tools.js";
import { logger } from "./utils/logger.js";
import { chunkText } from "./utils/chunking.js";
import { isAbortError } from "./utils/errors.js";
import { formatProfessionalReply } from "./utils/responseFormat.js";
import { buildTelegramBoldEntities } from "./utils/telegramEntities.js";
import { injectLatestUserVisionMessage } from "./visionMessage.js";
import { decideRateLimitAction } from "./rateLimitPolicy.js";
import { parseContextReference } from "./contextFollowUp.js";
import { buildQuestionBreakdownInstruction, decomposeQuestionParts } from "./utils/questionDecompose.js";
import { transcribeTelegramMediaFromUrl } from "./media/stt.js";
import { buildDocumentPromptFromTelegramFile, buildPhotoPromptFromTelegramFile } from "./media/fileAnalysis.js";
const CHAT_HISTORY_MAX_EXCHANGES = Math.max(15, Math.min(20, Number(process.env.CHAT_HISTORY_MAX_EXCHANGES || "20")));
const RECENT_CONTEXT_MESSAGES = CHAT_HISTORY_MAX_EXCHANGES * 2;
const FAST_RECENT_CONTEXT_MESSAGES = Math.max(4, Math.min(RECENT_CONTEXT_MESSAGES, Number(process.env.FAST_RECENT_CONTEXT_MESSAGES || "12")));
const TELEGRAM_CHUNK_LIMIT = 3500;
const STREAM_PREVIEW_MAX_CHARS = Math.max(700, Math.min(TELEGRAM_CHUNK_LIMIT, Number(process.env.STREAM_PREVIEW_MAX_CHARS || "1600")));
const REPLY_STICKER_IDS = (process.env.TG_STICKER_REPLY_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
const REPLY_STICKER_PROBABILITY = Math.max(0, Math.min(1, Number(process.env.TG_STICKER_REPLY_PROBABILITY || "0")));
const PROFESSIONAL_MODEL_RECOVERY_MESSAGE = "Temporary model issue detected. Please resend the same query to retry the primary model route.";
const PROVIDER_CREDIT_FAILURE_MARKERS = [
    "openrouter credits are insufficient",
    "please add credits or switch to a free model",
    "insufficient credits",
    "insufficient_quota",
    "payment required",
];
const LEGACY_BLOCK_PATTERNS = [
    /service temporarily unavailable/i,
    /service unavailable/i,
    /please try again later/i,
];
const MAX_CONTINUATION_ROUNDS = Math.max(0, Math.min(4, Number(process.env.MAX_CONTINUATION_ROUNDS || (FORCE_OPENROUTER_FREE_ONLY_MODE ? "2" : "1"))));
const MAX_TOOL_ROUNDS = Math.max(1, Math.min(2, Number(process.env.MAX_TOOL_ROUNDS || "1")));
const MAX_MODEL_ATTEMPTS = Math.max(1, Math.min(6, Number(process.env.MAX_MODEL_ATTEMPTS || (FORCE_OPENROUTER_FREE_ONLY_MODE ? "4" : "1"))));
const FINAL_SELF_CHECK_ENABLED = (process.env.FINAL_SELF_CHECK_ENABLED || "true").toLowerCase() !== "false";
const FINAL_SELF_CHECK_MIN_CHARS = Math.max(80, Math.min(1200, Number(process.env.FINAL_SELF_CHECK_MIN_CHARS || "180")));
const detailedPromptPattern = /\b(explain|detailed|detail|step by step|deep dive|comprehensive|teach|breakdown|why|how)\b/i;
const detailFollowUpOnlyPattern = /^(tell me in detail|explain in detail|in detail|detail|more detail|more details|tell me more|explain more|elaborate|deep dive|expand this|continue in detail|can you explain( it| this| that)? in detail|yes tell|yes explain)$/i;
const contextualFollowUpOnlyPattern = /^(?:(?:yes|ok|okay)\s+)?(?:tell|explain|solve|continue|go ahead|do (?:so|it|that|this)(?:\s+like this)?|do this|do that|same|same thing|same for this|same for that|that one|this one|about that|about this|what about that|what about this|go on|carry on|next|previous question|previous answer|answer that|answer this|explain that|explain this|tell about that|tell about this|details of that|details of this|more on that|more on this)$/i;
const expandedResponsePattern = /\b(story|about|difference|compare|top|list|history|overview|explain|guide|full|complete)\b/i;
const TYPEWRITER_FALLBACK_ENABLED = (process.env.TYPEWRITER_FALLBACK_ENABLED || "false").toLowerCase() !== "false";
const TYPEWRITER_CHARS_PER_TICK = Math.max(12, Math.min(220, Number(process.env.TYPEWRITER_CHARS_PER_TICK || "104")));
const TYPEWRITER_TICK_MS = Math.max(2, Math.min(80, Number(process.env.TYPEWRITER_TICK_MS || "4")));
const TYPEWRITER_MAX_CHARS = Math.max(180, Math.min(1800, Number(process.env.TYPEWRITER_MAX_CHARS || "900")));
const SIMULATED_STREAM_CHUNK_SIZE = Math.max(48, Math.min(280, Number(process.env.SIMULATED_STREAM_CHUNK_SIZE || "180")));
const SIMULATED_STREAM_DELAY_MS = Math.max(0, Math.min(40, Number(process.env.SIMULATED_STREAM_DELAY_MS || "4")));
const CODE_FILE_EXPORT_ENABLED = false;
const CODE_FAST_PATH_ENABLED = (process.env.CODE_FAST_PATH_ENABLED || "true").toLowerCase() !== "false";
const CODE_REPAIR_ENABLED = (process.env.CODE_REPAIR_ENABLED || "true").toLowerCase() !== "false";
const CODE_REPAIR_MAX_TOKENS = Math.max(600, Math.min(3200, Number(process.env.CODE_REPAIR_MAX_TOKENS || (FORCE_OPENROUTER_FREE_ONLY_MODE ? "2200" : "1500"))));
const TYPO_NORMALIZATION_ENABLED = (process.env.TYPO_NORMALIZATION_ENABLED || "true").toLowerCase() !== "false";
const SOFT_RATE_LIMIT_MODE = (process.env.SOFT_RATE_LIMIT_MODE || "false").toLowerCase() === "true";
const codeFencePattern = /```([a-zA-Z0-9_#+.-]*)\n?([\s\S]*?)```/g;
const codeMarkerPattern = /CODE_BEGIN\b([\s\S]*?)\bCODE_END/i;
const codeMarkerGlobalPattern = /CODE_BEGIN\b([\s\S]*?)\bCODE_END/g;
const codeBeginTokenPattern = /\s*CODE_BEGIN\s*/gi;
const codeEndTokenPattern = /\s*CODE_END\s*/gi;
const codeLanguageMap = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    csharp: "csharp",
    "c#": "csharp",
    cpp: "cpp",
    "c++": "cpp",
    shell: "bash",
    sh: "bash",
    yml: "yaml",
};
const codeExtensionMap = {
    javascript: "js",
    typescript: "ts",
    python: "py",
    java: "java",
    cpp: "cpp",
    csharp: "cs",
    go: "go",
    rust: "rs",
    php: "php",
    ruby: "rb",
    swift: "swift",
    kotlin: "kt",
    sql: "sql",
    html: "html",
    css: "css",
    bash: "sh",
    json: "json",
    yaml: "yaml",
    xml: "xml",
    text: "txt",
};
const splitArgs = (raw) => raw
    .trim()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
const DISPLAY_AI_MODEL_NAME = "GPT-5.2 MODEL";
const getDisplayAiModelName = () => DISPLAY_AI_MODEL_NAME;
const mediaDeepAnalysisPattern = /\b(full\s+description|describe|analysis|analyze|analyse|feedback|emotion|tone|mood|what\s+(?:was|is)\s+(?:said|told)|transcript|summari(?:ze|se)|improv(?:e|ement))\b/i;
const shouldRunDeepMediaAnalysis = (caption) => mediaDeepAnalysisPattern.test(String(caption || "").toLowerCase());
const mediaEnvelopePattern = /^\[(?:PHOTO|DOCUMENT|VOICE|AUDIO|VIDEO(?: NOTE| DOCUMENT)?|AUDIO DOCUMENT|LOCATION|CONTACT|STICKER)\s+MESSAGE\]/i;
const isMediaEnvelopePrompt = (prompt) => {
    const firstLine = String(prompt || "").split("\n")[0]?.trim() || "";
    return mediaEnvelopePattern.test(firstLine);
};
const isLikelyFileNameOnlyPrompt = (prompt) => {
    const value = String(prompt || "").replace(/\s+/g, " ").trim();
    if (!value || value.length > 220 || value.includes("\n"))
        return false;
    return /^[A-Za-z0-9 _().,\-]{1,180}\.(?:pdf|docx?|pptx?|xlsx?|csv|txt|rtf|md|json|xml|html?|jpg|jpeg|png|webp|gif|bmp|tiff?|heic|zip|rar|7z|mp3|wav|m4a|aac|ogg|mp4|mov|avi|mkv)$/i.test(value);
};
const extractIntentSignalFromMediaPrompt = (prompt) => {
    const raw = String(prompt || "");
    if (!isMediaEnvelopePrompt(raw))
        return raw;
    const caption = String(raw.match(/(?:^|\n)Caption:\s*(.+)$/im)?.[1] || "").trim();
    const transcript = String(raw.match(/(?:^|\n)(?:Transcript|Audio transcript \(if extracted\)):\s*\n([\s\S]*?)(?:\n(?:Media response rules:|Please help based on this message content\.?|$))/i)?.[1]
        || raw.match(/(?:^|\n)(?:Transcript|Audio transcript \(if extracted\)):\s*(.+)$/im)?.[1]
        || "").trim();
    const transcriptAvailable = transcript && !/^transcript unavailable/i.test(transcript);
    return [caption, transcriptAvailable ? transcript : ""].filter(Boolean).join("\n").trim();
};
const buildMediaResponseGuide = (kind, caption, transcript) => {
    const mediaType = kind === "video" ? "video recording" : "audio recording";
    const wantsDeepReview = shouldRunDeepMediaAnalysis(caption);
    const hasTranscript = !!String(transcript || "").trim();
    const guideLines = [
        "Media response rules:",
        `Message type: ${mediaType}.`,
        hasTranscript
            ? "Use transcript text as primary evidence. Do not invent missing quotes."
            : "Transcript is unavailable. Use caption and metadata only, and do not claim exact spoken wording.",
        wantsDeepReview
            ? "User asked for full analysis, so provide complete detail."
            : "If user asked a specific media question, answer that first, then include concise feedback.",
        "Keep language professional, clear, and easy to scan.",
        "Ground every section in the actual transcript/caption evidence.",
        "Do not reuse fixed generic lines across different media inputs.",
        "Use exactly these sections with one blank line between each section:",
        "Main Content:",
        "Emotion and Tone:",
        "What Was Good:",
        "What To Improve:",
        "Improved Version:",
        "What Was Good and What To Improve must each include at least 3 distinct bullet points.",
        "Improved Version must be a polished rewrite and must not repeat Main Content verbatim.",
    ];
    if (!hasTranscript) {
        guideLines.push("End with one line: For exact wording, please resend clearer audio or share a transcript.");
    }
    return guideLines.join("\n");
};
const buildMediaPromptForReply = (input) => {
    const caption = String(input.caption || "").trim();
    const captionBlock = caption ? `Caption: ${caption}` : "";
    const guide = buildMediaResponseGuide(input.kind, caption, input.transcript || null);
    const header = input.kind === "video"
        ? "[VIDEO MESSAGE]"
        : input.kind === "audio"
            ? "[AUDIO MESSAGE]"
            : "[VOICE MESSAGE]";
    return [
        header,
        captionBlock,
        Number.isFinite(Number(input.durationSeconds))
            ? `Duration seconds: ${Number(input.durationSeconds || 0)}`
            : "",
        input.title ? `Title: ${input.title}` : "",
        input.performer ? `Performer: ${input.performer}` : "",
        input.fileName ? `File name: ${input.fileName}` : "",
        input.mimeType ? `Mime type: ${input.mimeType}` : "",
        input.fileUrl ? `Telegram file URL: ${input.fileUrl}` : "",
        input.transcript ? `Transcript:\n${String(input.transcript).slice(0, 5000)}` : "Transcript unavailable in this runtime.",
        guide,
        "Please help based on this message content.",
    ]
        .filter(Boolean)
        .join("\n");
};
const detectMicroHints = (input) => {
    const text = String(input || "").toLowerCase();
    const checks = [
        { key: "hard", pattern: /\bhard(?:est)?\b/, depth: 3 },
        { key: "professional", pattern: /\bprofessional\b/, style: 3 },
        { key: "like yours", pattern: /\blike yours\b/, style: 1, continuity: 1 },
        { key: "fully correct", pattern: /\bfully correct\b/, depth: 2 },
        { key: "step by step", pattern: /\bstep by step\b/, depth: 2, style: 1 },
        { key: "advanced", pattern: /\badvanced\b/, depth: 3 },
        { key: "accurate", pattern: /\baccurate\b/, depth: 2 },
        { key: "make it better", pattern: /\bmake it better\b/, continuity: 2 },
        { key: "like before", pattern: /\blike before\b/, continuity: 3 },
        { key: "same thing", pattern: /\bsame thing\b/, continuity: 2 },
        { key: "continue", pattern: /\bcontinue\b/, continuity: 2 },
        { key: "ok more", pattern: /\bok\s+more\b/, continuity: 2, depth: 1 },
    ];
    const matchedEntries = checks.filter((c) => c.pattern.test(text));
    const matched = matchedEntries.map((c) => c.key);
    const scores = matchedEntries.reduce((acc, item) => {
        acc.depth += item.depth || 0;
        acc.style += item.style || 0;
        acc.continuity += item.continuity || 0;
        return acc;
    }, { depth: 0, style: 0, continuity: 0 });
    const inferredDepth = scores.depth >= 2 ? "deep" : "normal";
    const inferredStyle = scores.style >= 2 ? "professional" : "neutral";
    const wantsStepByStep = /\bstep by step\b/.test(text);
    return { matched, scores, inferredDepth, inferredStyle, wantsStepByStep };
};
const isShortCapabilityQuestion = (input) => {
    const text = String(input || "").trim().toLowerCase();
    if (!text || text.length > 120)
        return false;
    return /^(can you|could you|are you able to)\b/.test(text);
};
const isCasualSmallTalk = (input) => {
    const text = String(input || "").trim().toLowerCase();
    if (!text || text.length > 80)
        return false;
    return /^(hi|hello|hey|good morning|good afternoon|good evening|how are you|what'?s up|what are you doing|thanks|thank you|ok|okay)\b/.test(text);
};
const PRIORITY_CHAT_REPLIES = {
    howAreYou: [
        "Hey there 👋",
        "",
        "I'm up and running perfectly — thanks for asking. Think of me as your AI assistant that's ready to help with questions, ideas, problem-solving, or just exploring something new.",
        "",
        "So what’s on your mind today?",
    ].join("\n"),
    astonMartinFavorite: [
        "My favorite Aston Martin model is the DB5.",
        "",
        "It has a timeless design and iconic legacy.",
    ].join("\n"),
    capabilities: [
        "Good question.",
        "",
        "I’m here to help with a wide range of things — think of me as your AI assistant for thinking, learning, and building.",
        "",
        "Here are a few things I can help with:",
        "",
        "1. Answer questions and explain complex topics",
        "2. Help with coding, tech, and problem-solving",
        "3. Generate ideas, write content, or summarize information",
        "4. Help you learn new skills or understand difficult concepts",
    ].join("\n"),
    controlLife: [
        "5. Assist with planning, brainstorming, or research",
        "",
        "But honestly, the best way to see what I can do is to try me.",
        "",
        "So — what would you like to explore first?",
    ].join("\n"),
};
const normalizePriorityPrompt = (input) => String(input || "")
    .toLowerCase()
    .replace(/[“”"]/g, "\"")
    .replace(/[‘’`]/g, "'")
    .replace(/[^a-z0-9?'"\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const getPriorityChatReply = (input) => {
    const text = normalizePriorityPrompt(input);
    if (!text)
        return null;
    if (/^(?:name\s+)?which one is your favou?rite\??$/.test(text)
        || /^(?:what(?:'s| is)\s+your\s+favou?rite\s+aston martin(?:\s+model)?|which\s+aston martin(?:\s+model)?\s+is\s+your\s+favou?rite)\??$/.test(text)
        || (/\baston martin\b/.test(text) && /\bfavou?rite\b/.test(text))) {
        return PRIORITY_CHAT_REPLIES.astonMartinFavorite;
    }
    if (/^(?:hi|hello|hey)(?: there)?[,\s]*(?:how are you|how r you|how are u)\??$/.test(text)
        || /^(?:how are you|how r you|how are u)\??$/.test(text)) {
        return PRIORITY_CHAT_REPLIES.howAreYou;
    }
    if (/^(?:what can you do|what do you do|what are your capabilities|what all can you do|tell me what you can do|can you tell me what you can do)\??$/.test(text)) {
        return PRIORITY_CHAT_REPLIES.capabilities;
    }
    if (/^(?:are you ready to control my life|are you going to control my life|will you control my life|can you control my life)\??$/.test(text)
        || (/\bcontrol my life\b/.test(text) && /\b(ready|are you|can you|will you)\b/.test(text))) {
        return PRIORITY_CHAT_REPLIES.controlLife;
    }
    return null;
};
const estimateTaskAlignmentRisk = (args) => {
    const text = String(args.input || "").trim().toLowerCase();
    if (!text)
        return "high";
    if (args.capabilityQuestionDetected || args.casualSmallTalkDetected)
        return "low";
    const genericShortRef = /^(do it|make it better|fix it|same thing|like before|this|that|it|more|continue|why)\??$/.test(text);
    if (genericShortRef && !args.contextualFollowUp && !args.effectiveChangedByContext) {
        return "high";
    }
    const domainHits = [
        /\b(react|html|css|frontend|ui|website)\b/.test(text),
        /\b(node|express|api|backend|server)\b/.test(text),
        /\bpython|django|flask\b/.test(text),
        /\btelegram bot|telegraf|bot\b/.test(text),
    ].filter(Boolean).length;
    if (domainHits >= 3)
        return "medium";
    if (text.length <= 12 && !args.contextualFollowUp && !args.effectiveChangedByContext)
        return "medium";
    if (args.intent === "unknown" && !args.contextualFollowUp)
        return "medium";
    return "low";
};
const inferDefaultLanguageIfUnspecified = (input) => {
    const text = String(input || "").toLowerCase();
    if (!text)
        return "python";
    if (/\bpython|django|flask|fastapi|pandas\b/.test(text))
        return "python";
    if (/\bjavascript|js|node(?:\.js)?|typescript|ts|react|next\.?js|express\b/.test(text)) {
        return "javascript";
    }
    if (/\btelegram bot|telegraf\b/.test(text) && /\b(node|javascript|js|typescript|ts)\b/.test(text)) {
        return "javascript";
    }
    return "python";
};
const estimateUnknownTermRisk = (input) => {
    const text = String(input || "").trim();
    const lower = text.toLowerCase();
    if (!text)
        return "low";
    if (text.length > 140)
        return "low";
    if (isCasualSmallTalk(text) || isShortCapabilityQuestion(text))
        return "low";
    if (/\b(define|meaning|what is|what's|explain)\b/.test(lower)) {
        const quoted = text.match(/["'`][^"'`]{2,40}["'`]/g) || [];
        const weirdToken = /\b[a-z]{2,}[a-z0-9]*[xzqj]{2,}[a-z0-9]*\b/i.test(text) ||
            /\b[A-Z][a-z]+[A-Z][A-Za-z]+\b/.test(text) ||
            /\b[a-z]{8,}\d{2,}\b/i.test(text);
        if (quoted.length > 0 || weirdToken)
            return "high";
        if (text.split(/\s+/).length <= 6)
            return "medium";
    }
    const singleRareLike = text.split(/\s+/).length <= 4 && /^[A-Za-z0-9_-]{6,}$/.test(text);
    if (singleRareLike && !/\b(python|javascript|react|telegram|node|html|css)\b/i.test(text)) {
        return "medium";
    }
    return "low";
};
const detectConversationalTone = (input) => {
    const text = String(input || "").trim();
    const lower = text.toLowerCase();
    if (!text)
        return { tone: "casual", confidence: "low" };
    if (/^(draw|create|write|explain|build|generate|make|solve|fix|implement)\b/.test(lower)) {
        return { tone: "command", confidence: "high" };
    }
    if (/\b(meaning of life|what is life|existence|consciousness|purpose|reality|truth|soul|free will)\b/.test(lower)) {
        return { tone: "philosophical", confidence: "high" };
    }
    if (/\b(broken|ruined|destroyed|doomed|everything is over|dramatic|tragedy|devastated)\b/.test(lower)) {
        return { tone: "dramatic", confidence: "medium" };
    }
    if (/\b(joke|lol|haha|funny|roast|meme|play a game|tease)\b/.test(lower)) {
        return { tone: "playful", confidence: "high" };
    }
    if (/\b(can you control|obey me|you must obey|dominate|who is in control|are you under my control)\b/.test(lower)) {
        return { tone: "testing", confidence: "high" };
    }
    if (isCasualSmallTalk(text))
        return { tone: "casual", confidence: "high" };
    if (/[?]/.test(text) || /\b(explain|compare|how|why|what)\b/.test(lower)) {
        return { tone: "serious", confidence: "medium" };
    }
    return { tone: "serious", confidence: "low" };
};
const topicKeywordSet = (input) => {
    const stop = new Set([
        "the", "a", "an", "and", "or", "to", "for", "of", "in", "on", "at", "is", "are", "be", "it",
        "this", "that", "with", "how", "what", "why", "can", "you", "me", "do", "make", "build",
        "write", "create", "please", "about",
    ]);
    return new Set(String(input || "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && !stop.has(t)));
};
const detectTopicShift = (args) => {
    if (args.contextualFollowUp || args.effectiveChangedByContext) {
        return { topicShiftDetected: false, hardContextResetRecommended: false };
    }
    if (args.casualSmallTalkDetected) {
        return { topicShiftDetected: false, hardContextResetRecommended: false };
    }
    const prev = String(args.previousPrompt || "").trim();
    if (!prev)
        return { topicShiftDetected: false, hardContextResetRecommended: false };
    const curSet = topicKeywordSet(args.currentInput);
    const prevSet = topicKeywordSet(prev);
    if (!curSet.size || !prevSet.size) {
        return { topicShiftDetected: false, hardContextResetRecommended: false };
    }
    let intersection = 0;
    for (const token of curSet) {
        if (prevSet.has(token))
            intersection += 1;
    }
    const union = new Set([...curSet, ...prevSet]).size || 1;
    const overlap = intersection / union;
    const codingBoundaryChanged = (args.previousIntent === "coding" && args.currentIntent !== "coding") ||
        (args.previousIntent !== "coding" && args.currentIntent === "coding");
    const topicShiftDetected = overlap < 0.12 || (codingBoundaryChanged && overlap < 0.3);
    const hardContextResetRecommended = topicShiftDetected && (overlap < 0.06 || codingBoundaryChanged);
    return { topicShiftDetected, hardContextResetRecommended };
};
const estimateFallbackFragmentRisk = (args) => {
    const text = String(args.input || "").trim().toLowerCase();
    if (args.capabilityQuestionDetected || args.casualSmallTalkDetected)
        return "low";
    if (args.contextualFollowUp || args.effectiveChangedByContext)
        return "low";
    const generic = /^(ok|okay|more|why|continue|do it|fix it|same thing|like before|help)\??$/.test(text);
    if (args.taskAlignmentRisk === "high" && generic)
        return "high";
    if (args.taskAlignmentRisk === "high")
        return "medium";
    if (args.topicShiftDetected && text.length < 30)
        return "medium";
    return "low";
};
const estimateSemanticMismatchRisk = (args) => {
    const text = String(args.input || "").toLowerCase();
    const domainHits = [
        /\b(html|css|react|frontend|ui|website)\b/.test(text),
        /\b(node|express|backend|server|api)\b/.test(text),
        /\bpython|django|flask|fastapi\b/.test(text),
        /\btelegram|telegraf|bot\b/.test(text),
        /\bmath|equation|algebra|calculus\b/.test(text),
    ].filter(Boolean).length;
    if (args.contextualFollowUp)
        return "low";
    if (args.hardContextResetRecommended && args.taskAlignmentRisk !== "low")
        return "high";
    if (args.taskAlignmentRisk === "high")
        return "high";
    if (domainHits >= 3)
        return "medium";
    if (args.intent === "unknown" || args.unknownTermRisk === "high")
        return "medium";
    return "low";
};
const estimateRetrievalArtifactRisk = (args) => {
    const text = String(args.input || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!text)
        return "low";
    if (args.capabilityQuestionDetected || args.casualSmallTalkDetected)
        return "low";
    if (args.intent === "coding" || args.intent === "math")
        return "low";
    const explicitSourcesRequested = /\b(source|sources|citation|citations|cite|reference|references|link|links|url|urls|wikipedia)\b/.test(text);
    if (explicitSourcesRequested)
        return "low";
    const definitionLike = /^(what is|who is|define|definition of|meaning of|explain)\b/.test(text)
        || /\b(what is|who is|define|definition of|meaning of)\b/.test(text);
    const realtimeLike = /(latest|today|current|recent|news|price|market cap|gdp|revenue|population|top\s+\d+|ranking|rank)\b/.test(text);
    const quotedTerm = /["'][^"'\n]{3,48}["']/.test(text);
    const shortPrompt = text.split(/\s+/).filter(Boolean).length <= 8;
    if (definitionLike && args.unknownTermRisk === "high")
        return "high";
    if (definitionLike && (quotedTerm || shortPrompt))
        return "medium";
    if (realtimeLike && !args.contextualFollowUp)
        return "medium";
    if (args.taskAlignmentRisk === "high" && (definitionLike || realtimeLike))
        return "medium";
    return "low";
};
const getConversationKey = (ctx) => {
    if (!ctx.chat?.id)
        return null;
    const base = String(ctx.chat.id);
    const chatType = ctx.chat.type;
    const fromId = ctx.from?.id ? String(ctx.from.id) : "";
    if ((chatType === "group" || chatType === "supergroup") && fromId) {
        return `${base}:${fromId}`;
    }
    return base;
};
const getRateLimitKey = (ctx) => {
    if (ctx.from?.id)
        return `user:${ctx.from.id}`;
    const chatId = ctx.chat?.id;
    return chatId ? `chat:${chatId}` : null;
};
const moderateInput = (text) => {
    const checks = [
        {
            pattern: /\b(how to kill myself|how can i die|suicide method|self harm method)\b/i,
            reason: "I cannot help with self-harm instructions. I can help with support resources and safer coping steps.",
        },
        {
            pattern: /\b(build a bomb|make explosive|buy illegal drugs|credit card fraud|steal password|malware code)\b/i,
            reason: "I cannot help with illegal or harmful wrongdoing. I can help with legal and ethical alternatives.",
        },
    ];
    for (const check of checks) {
        if (check.pattern.test(text)) {
            return { blocked: true, reason: check.reason };
        }
    }
    return { blocked: false };
};
const memoryCommandPattern = /^\s*remember(?:\s+this|\s+that)?\s*:?\s+(.+)$/i;
const typoNormalizationRules = [
    { pattern: /\bwaht\b/gi, replacement: "what", label: "waht->what" },
    { pattern: /\bwhta\b/gi, replacement: "what", label: "whta->what" },
    { pattern: /\bteh\b/gi, replacement: "the", label: "teh->the" },
    { pattern: /\bpyhton\b/gi, replacement: "python", label: "pyhton->python" },
    {
        pattern: /\bjavascirpt\b/gi,
        replacement: "javascript",
        label: "javascirpt->javascript",
    },
    {
        pattern: /\bjavascritp\b/gi,
        replacement: "javascript",
        label: "javascritp->javascript",
    },
    { pattern: /\biphon\b/gi, replacement: "iphone", label: "iphon->iphone" },
    { pattern: /\bifon\b/gi, replacement: "iphone", label: "ifon->iphone" },
    { pattern: /\biphne\b/gi, replacement: "iphone", label: "iphne->iphone" },
    { pattern: /\bps\s+5\b/gi, replacement: "ps5", label: "ps 5->ps5" },
    {
        pattern: /\balgorithim\b/gi,
        replacement: "algorithm",
        label: "algorithim->algorithm",
    },
    { pattern: /\bexplian\b/gi, replacement: "explain", label: "explian->explain" },
    {
        pattern: /\bdiffrence\b/gi,
        replacement: "difference",
        label: "diffrence->difference",
    },
    {
        pattern: /\bepistein\b/gi,
        replacement: "epstein",
        label: "epistein->epstein",
    },
    {
        pattern: /\bepstien\b/gi,
        replacement: "epstein",
        label: "epstien->epstein",
    },
    {
        pattern: /\bepstine\b/gi,
        replacement: "epstein",
        label: "epstine->epstein",
    },
    {
        pattern: /\beinstien\b/gi,
        replacement: "einstein",
        label: "einstien->einstein",
    },
    {
        pattern: /\beinsten\b/gi,
        replacement: "einstein",
        label: "einsten->einstein",
    },
    {
        pattern: /\bjoffery\b/gi,
        replacement: "joffrey",
        label: "joffery->joffrey",
    },
    {
        pattern: /\bjofrey\b/gi,
        replacement: "joffrey",
        label: "jofrey->joffrey",
    },
    {
        pattern: /\bmissicipi\b/gi,
        replacement: "mississippi",
        label: "missicipi->mississippi",
    },
    {
        pattern: /\bmissisipi\b/gi,
        replacement: "mississippi",
        label: "missisipi->mississippi",
    },
    {
        pattern: /\bmisisipi\b/gi,
        replacement: "mississippi",
        label: "misisipi->mississippi",
    },
    {
        pattern: /\bmiccisipi\b/gi,
        replacement: "mississippi",
        label: "miccisipi->mississippi",
    },
    { pattern: /\bokwajt\b/gi, replacement: "what", label: "okwajt->what" },
    { pattern: /\bwajt\b/gi, replacement: "what", label: "wajt->what" },
    { pattern: /\bansweer\b/gi, replacement: "answer", label: "answeer->answer" },
    {
        pattern: /\bquetion\b/gi,
        replacement: "question",
        label: "quetion->question",
    },
    { pattern: /\bbecuase\b/gi, replacement: "because", label: "becuase->because" },
    { pattern: /\brecieve\b/gi, replacement: "receive", label: "recieve->receive" },
];
const normalizeUserInput = (inputText) => {
    const raw = String(inputText || "").replace(/\r\n/g, "\n");
    let normalized = raw.trim().replace(/[ \t]{2,}/g, " ");
    const corrections = [];
    if (!TYPO_NORMALIZATION_ENABLED || !normalized) {
        return {
            normalized,
            corrected: normalized !== raw.trim(),
            corrections,
        };
    }
    for (const rule of typoNormalizationRules) {
        const before = normalized;
        normalized = normalized.replace(rule.pattern, rule.replacement);
        if (normalized !== before) {
            corrections.push(rule.label);
        }
    }
    normalized = normalized
        .replace(/([A-Za-z])\1{3,}/g, "$1$1")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
    return {
        normalized,
        corrected: normalized !== raw.trim(),
        corrections,
    };
};
const definitionPromptPattern = /^(who(?:'s| is| was)|what(?:'s| is| was)|tell me about|explain|define|meaning of)\b/i;
const entityTokenCorrections = {
    epistein: "epstein",
    epstien: "epstein",
    epstine: "epstein",
    einstien: "einstein",
    einsten: "einstein",
    iphon: "iphone",
    ifon: "iphone",
    iphne: "iphone",
    joffery: "joffrey",
    jofrey: "joffrey",
    joffreyy: "joffrey",
    missicipi: "mississippi",
    missisipi: "mississippi",
    misisipi: "mississippi",
    miccisipi: "mississippi",
};
const LOCAL_ENTITY_FACTS = {
    hamster: "A hamster is a small rodent commonly kept as a pet, known for its short tail, cheek pouches, and nocturnal activity.",
    brabus: "BRABUS is a German high-performance automotive tuning company known for customizing Mercedes-Benz, smart, and Maybach vehicles.",
    "brabus logo": 'The BRABUS logo is a stylized capital "B", used as the brand mark for BRABUS.',
    epstein: "Jeffrey Epstein was a U.S. financier convicted of sex offenses and died in custody in 2019 while awaiting trial on federal charges.",
    "jeffrey epstein": "Jeffrey Epstein was a U.S. financier convicted of sex offenses and died in custody in 2019 while awaiting trial on federal charges.",
    einstein: "Albert Einstein was a theoretical physicist best known for the theory of relativity and the equation E equals m c squared.",
    "albert einstein": "Albert Einstein was a theoretical physicist best known for the theory of relativity and the equation E equals m c squared.",
    joffrey: "Joffrey Baratheon is a fictional character in Game of Thrones, known as the cruel king of the Seven Kingdoms.",
    "joffrey baratheon": "Joffrey Baratheon is a fictional character in Game of Thrones, known as the cruel king of the Seven Kingdoms.",
    mississippi: "Mississippi is a state in the southeastern United States. If you meant the Mississippi River, it is one of the longest rivers in North America.",
    ps5: "The PS5 (PlayStation 5) is Sony's home video game console. It supports modern games, digital downloads, and features fast SSD storage with models including a standard edition and a digital edition.",
    "playstation 5": "The PlayStation 5 (PS5) is Sony's home video game console launched in 2020. It is known for fast load times, PS5-exclusive games, and support for backward-compatible PS4 titles.",
    psi: "PSI stands for pounds per square inch, a unit of pressure commonly used for tires, gas systems, and industrial pressure measurements.",
    "iphone 15": "iPhone 15 is a smartphone model from Apple released in the iPhone 15 lineup. If you want, I can explain its features, variants, launch pricing, or compare it with another phone.",
    palindrome: "A palindrome is a word, number, phrase, or sequence that reads the same backward and forward. Common examples include madam, racecar, and 121. In coding questions, palindrome checks are often used for strings, numbers, and interview practice problems.",
};
const normalizeEntityPhrase = (value) => String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z][a-z0-9_-]*\b/gi, (token) => {
    const corrected = entityTokenCorrections[token.toLowerCase()];
    return corrected || token.toLowerCase();
});
const extractDefinitionTopic = (inputText) => {
    let value = String(inputText || "")
        .replace(/^[\s,.;:!?-]+/g, "")
        .replace(/[?!.]+$/g, "")
        .trim();
    if (!value)
        return "";
    value = value
        .replace(/^(who(?:'s| is| was)|what(?:'s| is| was)|tell me about|explain|define|meaning of)\b[\s:,-]*/i, "")
        .replace(/^(a|an|the)\s+/i, "")
        .trim();
    return normalizeEntityPhrase(value);
};
const lookupLocalEntityFact = (inputText) => {
    if (!definitionPromptPattern.test(String(inputText || "").trim())) {
        return null;
    }
    const topic = extractDefinitionTopic(inputText);
    if (!topic) {
        return null;
    }
    return LOCAL_ENTITY_FACTS[topic] || null;
};
const looksLikeEntityMismatch = (inputText, answerText) => {
    if (!definitionPromptPattern.test(String(inputText || "").trim())) {
        return false;
    }
    const topic = extractDefinitionTopic(inputText);
    if (!topic) {
        return false;
    }
    const normalizedAnswer = normalizeEntityPhrase(answerText);
    if (!normalizedAnswer) {
        return true;
    }
    const topicTokens = topic.split(" ").filter((token) => token.length >= 4);
    if (topicTokens.length === 0) {
        return false;
    }
    const mentioned = topicTokens.some((token) => normalizedAnswer.includes(token));
    return !mentioned;
};
const looksLikeTemplateReuseMismatch = (inputText, answerText) => {
    const q = normalizeLooseQualityText(inputText);
    const r = normalizeLooseQualityText(answerText);
    if (!q || !r)
        return false;
    if (!/\bsort(?:ed|ing)?\b/.test(q) && /\bsortedcopy\b|\bsorted copy\b/.test(r)) {
        return true;
    }
    if (!/\bguest\b/.test(q) && /\bthe guest is a thriller film released in 2014\b/.test(r)) {
        return true;
    }
    if (!/(richest|market cap|companies)/.test(q) && /\btop(?: 10)? (?:richest )?companies by market capitalization\b/.test(r)) {
        return true;
    }
    if (!/\btable\b/.test(q) && /\bhere is a professional table format you can use\b/.test(r)) {
        return true;
    }
    return false;
};
const shouldGuardUnknownDefinitionPrompt = (inputText) => {
    const raw = String(inputText || "").trim();
    if (!raw)
        return false;
    if (!definitionPromptPattern.test(raw))
        return false;
    if (raw.length > 140)
        return false;
    const intent = detectIntent(raw);
    if (intent === "coding" || intent === "math" || intent === "current_events")
        return false;
    const topic = extractDefinitionTopic(raw);
    if (!topic)
        return false;
    if (LOCAL_ENTITY_FACTS[topic])
        return false;
    const risk = estimateUnknownTermRisk(raw);
    const quotedTerm = /["'`][^"'`\n]{2,48}["'`]/.test(raw);
    const ambiguousShape = /\b[A-Z]{3,}[A-Za-z0-9-]*\b/.test(raw)
        || /\b[A-Z][a-z]+[A-Z][A-Za-z]+\b/.test(raw)
        || /\b[a-z0-9]+-[a-z0-9-]+\b/i.test(raw)
        || /\b[a-z]{4,}[0-9]{2,}\b/i.test(raw);
    const shortDefinition = raw.split(/\s+/).filter(Boolean).length <= 6;
    if (risk === "high")
        return true;
    if (risk === "medium" && (quotedTerm || ambiguousShape) && shortDefinition)
        return true;
    return false;
};
const getUnknownDefinitionClarificationReply = (inputText) => {
    if (!shouldGuardUnknownDefinitionPrompt(inputText))
        return null;
    const topic = extractDefinitionTopic(inputText) || "that term";
    const suggestions = new Set();
    const tokenSuggestions = topic
        .split(/\s+/)
        .filter(Boolean)
        .map((token) => entityTokenCorrections[token.toLowerCase()] || token.toLowerCase());
    const rebuilt = tokenSuggestions.join(" ").trim();
    if (rebuilt && rebuilt !== topic) {
        suggestions.add(rebuilt);
    }
    const normalized = normalizeUserInput(inputText).normalized;
    const normalizedTopic = extractDefinitionTopic(normalized);
    if (normalizedTopic && normalizedTopic !== topic) {
        suggestions.add(normalizedTopic);
    }
    const suggestionLine = suggestions.size > 0
        ? `Did you mean ${Array.from(suggestions).slice(0, 3).map((s) => `"${s}"`).join(" or ")}?`
        : "";
    return [
        `I am not aware of a widely recognized term called "${topic}".`,
        "",
        "Could you clarify what you mean?",
        "Is it a product, a brand, a typo, or something specific?",
        suggestionLine,
    ].filter(Boolean).join("\n");
};
const getTypoAmbiguityClarificationReply = (inputText) => {
    const raw = String(inputText || "").trim();
    if (!raw)
        return null;
    if (definitionPromptPattern.test(raw) === false && raw.split(/\s+/).filter(Boolean).length > 3) {
        return null;
    }
    const normalized = normalizeUserInput(raw).normalized.toLowerCase().replace(/\s+/g, " ").trim();
    if (!normalized)
        return null;
    const detected = detectIntent(normalized);
    if (detected === "coding" || detected === "math") {
        return null;
    }
    const topic = extractDefinitionTopic(normalized) || normalizeEntityPhrase(normalized);
    const compactTopic = topic.replace(/[^a-z0-9]/g, "");
    if (/\bpsi\s*5\b/.test(topic) || compactTopic === "psi5") {
        return 'Did you mean PS5 (PlayStation 5) or PSI (pressure unit)?';
    }
    return null;
};
const startTypingIndicator = (ctx) => {
    let active = true;
    const chatId = ctx.chat?.id;
    if (!chatId)
        return () => { };
    const send = () => {
        if (!active)
            return;
        ctx.telegram.sendChatAction(chatId, "typing").catch(() => { });
    };
    send();
    const timer = setInterval(send, 4000);
    return () => {
        active = false;
        clearInterval(timer);
    };
};
const createModelKeyboard = () => {
    const rows = [];
    const buttons = MODEL_LIST.map((model) => Markup.button.callback(`${model.label}`, `model:${model.key}`));
    for (let i = 0; i < buttons.length; i += 2) {
        rows.push(buttons.slice(i, i + 2));
    }
    return Markup.inlineKeyboard(rows);
};
const createSettingsKeyboard = () => Markup.inlineKeyboard([
    [Markup.button.callback("Toggle concise/detailed", "settings:toggle-verbosity")],
    [Markup.button.callback("Reset chat", "action:reset")],
]);
const isProviderCreditFailureText = (text) => {
    const normalized = (text || "").toLowerCase();
    return PROVIDER_CREDIT_FAILURE_MARKERS.some((marker) => normalized.includes(marker));
};
const normalizeLegacyBlockedForUser = (text) => {
    const raw = String(text || "").trim();
    if (!raw)
        return raw;
    const matches = LEGACY_BLOCK_PATTERNS.reduce((count, pattern) => (pattern.test(raw) ? count + 1 : count), 0);
    if (matches < 2)
        return raw;
    return raw;
};
const normalizeProviderFailureForUser = (text) => {
    const normalized = normalizeLegacyBlockedForUser(text);
    return normalized;
};
const hasBalancedCodeFences = (text) => {
    const fenceCount = (String(text || "").match(/```/g) || []).length;
    return fenceCount > 0 && fenceCount % 2 === 0;
};
const safeReplyText = async (ctx, text) => {
    const normalizedText = normalizeProviderFailureForUser(text);
    const entities = buildTelegramBoldEntities(normalizedText);
    const replyOptions = entities.length > 0
        ? { link_preview_options: { is_disabled: true }, entities }
        : { link_preview_options: { is_disabled: true } };
    try {
        await ctx.reply(normalizedText, replyOptions);
    }
    catch {
        try {
            await ctx.reply(normalizedText, entities.length > 0 ? { entities } : undefined);
        }
        catch {
            await ctx.reply(normalizedText).catch(() => { });
        }
    }
};
const safeReplyAndGetMessageId = async (ctx, text) => {
    const normalizedText = normalizeProviderFailureForUser(text);
    const entities = buildTelegramBoldEntities(normalizedText);
    const replyOptions = entities.length > 0
        ? { link_preview_options: { is_disabled: true }, entities }
        : { link_preview_options: { is_disabled: true } };
    try {
        const response = await ctx.reply(normalizedText, replyOptions);
        return response?.message_id ?? null;
    }
    catch {
        try {
            const response = await ctx.reply(normalizedText, entities.length > 0 ? { entities } : undefined);
            return response?.message_id ?? null;
        }
        catch {
            return null;
        }
    }
};
const safeEditText = async (ctx, messageId, text) => {
    const normalizedText = normalizeProviderFailureForUser(text);
    const entities = buildTelegramBoldEntities(normalizedText);
    const editOptions = entities.length > 0
        ? {
            link_preview_options: { is_disabled: true },
            entities,
        }
        : {
            link_preview_options: { is_disabled: true },
        };
    try {
        await ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, normalizedText, editOptions);
    }
    catch {
        try {
            await ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, normalizedText, entities.length > 0 ? { entities } : undefined);
        }
        catch { }
    }
};
const sendReplySticker = async (ctx) => {
    if (REPLY_STICKER_IDS.length > 0) {
        const stickerId = REPLY_STICKER_IDS[Math.floor(Math.random() * REPLY_STICKER_IDS.length)];
        await ctx.replyWithSticker(stickerId).catch(() => { });
    }
};
const buildStreamingPreview = (fullText) => {
    const normalized = fullText || "";
    if (normalized.length <= STREAM_PREVIEW_MAX_CHARS) {
        return normalized.slice(0, TELEGRAM_CHUNK_LIMIT);
    }
    const header = "Live preview (latest section):\n";
    const roomForTail = Math.max(200, TELEGRAM_CHUNK_LIMIT - header.length);
    const tail = normalized.slice(-Math.min(STREAM_PREVIEW_MAX_CHARS, roomForTail));
    return `${header}${tail}`;
};
const simulateStreaming = async (text, signal, onDelta) => {
    const chunkPattern = new RegExp(`.{1,${SIMULATED_STREAM_CHUNK_SIZE}}`, "g");
    const chunks = text.match(chunkPattern) ?? [text];
    for (const chunk of chunks) {
        if (signal?.aborted) {
            throw new Error("aborted");
        }
        await onDelta(chunk);
        if (SIMULATED_STREAM_DELAY_MS > 0) {
            await new Promise((resolve) => setTimeout(resolve, SIMULATED_STREAM_DELAY_MS));
        }
    }
};
const runTypewriterEdit = async (ctx, messageId, text, signal) => {
    const full = text.trim();
    if (!full) {
        await safeEditText(ctx, messageId, text);
        return;
    }
    let cursor = 0;
    while (cursor < full.length) {
        if (signal?.aborted) {
            throw new Error("aborted");
        }
        cursor = Math.min(full.length, cursor + TYPEWRITER_CHARS_PER_TICK);
        await safeEditText(ctx, messageId, full.slice(0, cursor));
        if (cursor < full.length) {
            await new Promise((resolve) => setTimeout(resolve, TYPEWRITER_TICK_MS));
        }
    }
};
const extractErrorStatus = (error) => {
    const status = error?.status;
    return typeof status === "number" ? status : null;
};
const describeGenerationError = (error) => {
    const status = extractErrorStatus(error);
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    const PROFESSIONAL_MODEL_UNAVAILABLE_MESSAGE = "I could not reach the AI model right now due to temporary provider load. Please send your message again.";
    if (status === 401 || status === 403 || normalized.includes("unauthorized")) {
        return PROFESSIONAL_MODEL_UNAVAILABLE_MESSAGE;
    }
    if (status === 402 ||
        normalized.includes("insufficient credits") ||
        normalized.includes("insufficient_quota") ||
        normalized.includes("payment required")) {
        return PROFESSIONAL_MODEL_RECOVERY_MESSAGE;
    }
    if (status === 429 || normalized.includes("rate limit")) {
        return PROFESSIONAL_MODEL_UNAVAILABLE_MESSAGE;
    }
    if (normalized.includes("fetch failed") ||
        normalized.includes("network") ||
        normalized.includes("enotfound") ||
        normalized.includes("econnreset")) {
        return PROFESSIONAL_MODEL_UNAVAILABLE_MESSAGE;
    }
    return PROFESSIONAL_MODEL_UNAVAILABLE_MESSAGE;
};
const failureTextPatterns = [
    /temporary model issue/i,
    /fallback response mode/i,
    /could not complete/i,
    /could not generate/i,
    /could not reach the selected ai model/i,
    /temporary provider load/i,
    /temporarily unable to complete (this|the) response/i,
    /unable to complete .*provider/i,
    /due to provider limits/i,
    /provider limits?/i,
    /authentication failed/i,
    /network issue/i,
    /rate limit/i,
    /please try again/i,
    /try again in (a )?few seconds/i,
    /insufficient credits/i,
    /insufficient_quota/i,
    /payment required/i,
];
const isFailureLikeOutput = (text) => {
    const raw = String(text || "").trim();
    if (!raw)
        return true;
    const matched = failureTextPatterns.some((pattern) => pattern.test(raw));
    if (!matched)
        return false;
    const hasProviderFailureContext = /\b(openrouter|provider|model|quota|credits|authentication|network|service|fallback)\b/i.test(raw);
    const onlyWeakTransientWording = /\b(rate limit|please try again|try again in (a )?few seconds)\b/i.test(raw)
        && !/\b(could not|unable|failed|error|issue|temporarily)\b/i.test(raw);
    if (onlyWeakTransientWording && !hasProviderFailureContext && raw.length > 80) {
        return false;
    }
    return true;
};
const normalizeComparableText = (value) => String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[?!.]+$/g, "")
    .trim();
const normalizeLooseQualityText = (value) => String(value || "")
    .replace(/```[\s\S]*?```/g, " code ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const lowValueDeflectionOutputPattern = /(i can help with context and explanation|i am ready to answer this directly in a professional format|i am ready to help.*ask (?:your|one clear) question|ask any question and i will answer|i will answer directly\b|direct answer topic\b|provide one specific output format\b|final polished answer\b|please send the exact topic, value, or required output format in one clear line|please send the topic again in one clear line if the earlier context was not available in this reply path|temporary live-answer generation issue for this request|temporary response generation issue in this pass|previous-topic context was not available in this reply path|temporary model issue detected|switching to fallback response mode|could not reach the selected ai model right now|wikifunctions has a function related to this topic|\bsource\s*:\s*https?:\/\/\S+|\/\s*[a-z](?:[\s.]*[a-z]){3,20}\s*\/)/i;
const blockedTemplateLeakPattern = /\bdirect answer topic\b|\bprovide one specific output format\b|\bfinal polished answer\b/i;
const containsPlaceholderCodeTemplate = (text) => /\breplace (?:this )?template with your requested logic\b/i.test(String(text || ""))
    || /\breplace with your requested logic\b/i.test(String(text || ""));
const containsTemplateCodeScaffoldSignals = (text) => {
    const source = String(text || "").trim();
    if (!source)
        return false;
    const scaffoldPattern = /\b(replace (?:this )?template(?: with)?(?: your)? requested logic|replace with your requested logic|your logic here|implement (?:your|the) logic here|add your logic here|fill in (?:the )?(?:logic|implementation)|placeholder(?: code)?|todo)\b/i;
    const suspiciousReadyPattern = /\b(?:std::cout\s*<<\s*["']ready["']|console\.log\s*\(\s*["']ready["']\s*\)|print\s*\(\s*["']ready["']\s*\)|return\s+["']ready["']\s*;?)\b/i;
    const codeLikePattern = /```|#include\b|int\s+main\s*\(|std::cout|function\s+\w+\s*\(|console\.log|def\s+\w+\s*\(|class\s+\w+|public\s+class\b|return\s+/i;
    if (containsPlaceholderCodeTemplate(source))
        return true;
    if (suspiciousReadyPattern.test(source) && codeLikePattern.test(source))
        return true;
    return scaffoldPattern.test(source) && codeLikePattern.test(source);
};
const isLowValueDeflectionOutput = (text) => lowValueDeflectionOutputPattern.test(normalizeLooseQualityText(text))
    || containsPlaceholderCodeTemplate(text);
const hasBlockedTemplateLeak = (text) => blockedTemplateLeakPattern.test(normalizeLooseQualityText(text));
const isOpenRouterFreeLikeModelId = (modelId) => isFreeOnlyApprovedModelId(modelId);
const stripAckAndPromptLabels = (value) => normalizeLooseQualityText(value)
    .replace(/^(ok|okay|sure|yes|alright|fine|well)\s+/i, "")
    .replace(/^(answer|question|prompt)\s+/i, "")
    .trim();
const isEchoLineCandidate = (normalizedPrompt, line) => {
    const normalizedLine = stripAckAndPromptLabels(line);
    if (!normalizedPrompt || !normalizedLine)
        return false;
    if (normalizedLine === normalizedPrompt || normalizedLine === `answer ${normalizedPrompt}`) {
        return true;
    }
    const maxEchoLength = Math.max(normalizedPrompt.length + 40, Math.round(normalizedPrompt.length * 1.6));
    return normalizedLine.length <= maxEchoLength
        && (normalizedLine.startsWith(normalizedPrompt) || normalizedPrompt.startsWith(normalizedLine));
};
const stripLeadingPromptEchoLines = (prompt, reply) => {
    const normalizedPrompt = normalizeLooseQualityText(prompt);
    if (!normalizedPrompt)
        return String(reply || "").trim();
    const lines = String(reply || "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line, index, arr) => !(line === "" && index > 0 && arr[index - 1] === ""));
    let start = 0;
    let removed = 0;
    while (start < lines.length && removed < 3 && isEchoLineCandidate(normalizedPrompt, lines[start])) {
        start += 1;
        removed += 1;
    }
    return lines.slice(start).join("\n").trim();
};
const requestsPreviousFormatStyle = (value) => {
    const normalized = normalizeComparableText(value);
    if (!normalized)
        return false;
    return /\b(same\s+(?:format|style|structure|pattern|template|layout)|same\s+way|same\s+type\s+of\s+format|previous\s+(?:format|style|structure|pattern|template|layout|answer\s+format|answer\s+style|response\s+format|response\s+style)|in\s+the\s+same\s+(?:format|style|way|structure)|like\s+(?:previous|before|above|earlier)|follow\s+the\s+previous\s+(?:format|style|structure)|reference\s+(?:the\s+)?previous\s+(?:answer|response|format|style|structure))\b/i.test(normalized);
};
const isPromptEchoLikeReply = (prompt, reply) => {
    const q = normalizeLooseQualityText(prompt);
    const r = normalizeLooseQualityText(reply);
    if (!q || !r)
        return false;
    if (r === q || r === `answer ${q}`)
        return true;
    const firstLine = normalizeLooseQualityText(String(reply || "").split(/\n+/)[0] || "");
    if (firstLine === q || firstLine === `answer ${q}`)
        return true;
    if (isEchoLineCandidate(q, String(reply || "").split(/\n+/)[0] || ""))
        return true;
    const topLines = String(reply || "").split(/\n+/).slice(0, 3);
    const echoLineCount = topLines.filter((line) => isEchoLineCandidate(q, line)).length;
    if (echoLineCount >= 2)
        return true;
    const maxEchoLength = Math.max(q.length + 64, Math.round(q.length * 1.8));
    if (r.length <= maxEchoLength && (r.startsWith(q) || r.endsWith(q) || r.includes(q))) {
        return true;
    }
    return false;
};
const isMeaningfullyRepeatedReply = (previous, current) => {
    const prior = normalizeLooseQualityText(previous);
    const next = normalizeLooseQualityText(current);
    if (!prior || !next)
        return false;
    if (prior === next)
        return true;
    const [shorter, longer] = prior.length <= next.length ? [prior, next] : [next, prior];
    if (shorter.length < 120)
        return false;
    if (longer.startsWith(shorter))
        return true;
    if (shorter.length >= 180 && longer.includes(shorter))
        return true;
    return false;
};
const findPreviousAssistantReplyForSamePrompt = (recentMessages, currentInput) => {
    const target = normalizeComparableText(currentInput);
    if (!target)
        return null;
    let skippedLatestMatch = false;
    for (let i = recentMessages.length - 1; i >= 0; i -= 1) {
        const userMessage = recentMessages[i];
        if (!userMessage || userMessage.role !== "user" || typeof userMessage.content !== "string") {
            continue;
        }
        if (normalizeComparableText(userMessage.content) !== target) {
            continue;
        }
        if (!skippedLatestMatch) {
            skippedLatestMatch = true;
            continue;
        }
        for (let j = i + 1; j < recentMessages.length; j += 1) {
            const candidate = recentMessages[j];
            if (!candidate || candidate.role !== "assistant" || typeof candidate.content !== "string") {
                continue;
            }
            const text = candidate.content.trim();
            if (text)
                return text;
        }
        break;
    }
    return null;
};
const isDetailFollowUpOnlyPrompt = (value) => detailFollowUpOnlyPattern.test(normalizeComparableText(value));
const isContextualFollowUpPrompt = (value) => {
    const normalized = normalizeComparableText(value);
    if (!normalized)
        return false;
    if (isMediaEnvelopePrompt(normalized) || isLikelyFileNameOnlyPrompt(normalized))
        return false;
    if (parseContextReference(normalized).isReference)
        return true;
    if (detailFollowUpOnlyPattern.test(normalized))
        return true;
    if (contextualFollowUpOnlyPattern.test(normalized))
        return true;
    const styleFormatReference = requestsPreviousFormatStyle(normalized);
    const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
    const maxFollowUpTokens = styleFormatReference ? 34 : 20;
    if (tokenCount > maxFollowUpTokens)
        return false;
    const hasReference = /\b(it|this|that|these|those|same|previous|last|earlier|above|before|prior)\b/.test(normalized);
    const hasAction = /\b(explain|tell|show|write|make|do|give|provide|solve|continue|expand|detail|details|more|convert|format|answer|style|structure|pattern|template|layout)\b/.test(normalized);
    if (styleFormatReference && hasReference)
        return true;
    if (hasReference && hasAction)
        return true;
    return false;
};
const getConversationPairsFromRecentMessages = (recentMessages) => {
    const pairs = [];
    for (let i = 0; i < recentMessages.length; i += 1) {
        const msg = recentMessages[i];
        if (!msg || msg.role !== "user" || typeof msg.content !== "string")
            continue;
        const userPrompt = msg.content.trim();
        if (!userPrompt)
            continue;
        let assistantReply = "";
        for (let j = i + 1; j < recentMessages.length; j += 1) {
            const next = recentMessages[j];
            if (!next)
                continue;
            if (next.role === "user")
                break;
            if (next.role === "assistant" && typeof next.content === "string" && next.content.trim()) {
                assistantReply = next.content.trim();
                break;
            }
        }
        if (assistantReply) {
            pairs.push({ userPrompt, assistantReply });
        }
    }
    return pairs;
};
const selectReferencedConversationPair = (recentMessages, currentInput) => {
    const parsed = parseContextReference(currentInput);
    if (!parsed.isReference)
        return null;
    const pairs = getConversationPairsFromRecentMessages(recentMessages);
    if (!pairs.length)
        return null;
    if (parsed.ordinal && parsed.ordinal >= 1 && parsed.ordinal <= pairs.length) {
        return pairs[parsed.ordinal - 1] || null;
    }
    return pairs[pairs.length - 1] || null;
};
const extractLatestContextFromRecentMessages = (recentMessages, currentInput) => {
    const referencedPair = selectReferencedConversationPair(recentMessages, currentInput);
    if (referencedPair) {
        return {
            previousUserPrompt: referencedPair.userPrompt,
            previousAssistantReply: referencedPair.assistantReply,
        };
    }
    const normalizedCurrent = normalizeComparableText(currentInput);
    let previousUserPrompt = "";
    let previousAssistantReply = "";
    for (let i = recentMessages.length - 1; i >= 0; i -= 1) {
        const msg = recentMessages[i];
        if (!msg || typeof msg.content !== "string")
            continue;
        const content = msg.content.trim();
        if (!content)
            continue;
        if (!previousAssistantReply && msg.role === "assistant") {
            previousAssistantReply = content;
        }
        if (msg.role !== "user") {
            continue;
        }
        const normalizedCandidate = normalizeComparableText(content);
        if (!normalizedCandidate || normalizedCandidate === normalizedCurrent) {
            continue;
        }
        if (isContextualFollowUpPrompt(content)) {
            continue;
        }
        previousUserPrompt = content;
        break;
    }
    if (!previousUserPrompt)
        return null;
    return { previousUserPrompt, previousAssistantReply };
};
const buildDetailedFollowUpInput = (previousUserPrompt, previousAssistantReply = "") => {
    const lines = [
        `Previous question: ${previousUserPrompt}`,
        "The user asked for a detailed continuation of the same topic.",
        "Provide a complete, accurate, and professional detailed answer for this exact topic.",
    ];
    const preview = previousAssistantReply.replace(/\s+/g, " ").trim().slice(0, 420);
    if (preview) {
        lines.push(`Previous answer context: ${preview}`);
    }
    lines.push("If the user later refers to the previous answer format/style, preserve the same structure while expanding the content.");
    return lines.join("\n");
};
const buildContextualFollowUpInput = (previousUserPrompt, followUpMessage, previousAssistantReply = "") => {
    const lines = [
        `Previous question: ${previousUserPrompt}`,
        `Follow-up request: ${followUpMessage}`,
        "Interpret the follow-up request using the previous question context.",
        "Answer the same topic directly, accurately, and professionally.",
    ];
    const preview = previousAssistantReply.replace(/\s+/g, " ").trim().slice(0, 420);
    if (preview) {
        lines.push(`Previous answer context: ${preview}`);
    }
    if (requestsPreviousFormatStyle(followUpMessage)) {
        lines.push("Format/style rule: follow the previous answer's structure (for example steps, numbered list, headings, or table style) while answering this referenced topic.");
    }
    return lines.join("\n");
};
const replaceLatestUserMessageForModel = (recentMessages, effectiveInput) => {
    const nextMessages = [...recentMessages];
    for (let i = nextMessages.length - 1; i >= 0; i -= 1) {
        const candidate = nextMessages[i];
        if (!candidate || candidate.role !== "user")
            continue;
        nextMessages[i] = {
            ...candidate,
            content: effectiveInput,
        };
        return nextMessages;
    }
    return [
        ...nextMessages,
        { role: "user", content: effectiveInput },
    ];
};
const buildRetryOnlyPoliteMessage = (input, intent) => {
    const normalized = normalizeIncomingUserMessage(input).normalizedText;
    const lowered = String(normalized || input || "").toLowerCase().trim();
    const priorityReply = getPriorityChatReply(normalized || input);
    if (priorityReply)
        return priorityReply;
    const localEntityFact = lookupLocalEntityFact(normalized || input);
    if (localEntityFact)
        return localEntityFact;
    const capabilityLike = /\b(what can you do|what do you do|what are your capabilities|capabilities|can you code|do you know coding|languages do you support)\b/.test(lowered)
        || isShortCapabilityQuestion(lowered);
    if (capabilityLike) {
        return PRIORITY_CHAT_REPLIES.capabilities;
    }
    const codingImplementationLike = (/\b(write|generate|create|build|implement|debug|fix|refactor|optimize|convert|show|give|provide)\b/.test(lowered)
        && /\b(code|script|function|class|api|endpoint|bot|query|algorithm|program|module|component|sql|regex|logic)\b/.test(lowered))
        || /\b(generate code|code for|implement this|implement that|write (?:a|an)?\s*(?:python|javascript|typescript|java|c\+\+|c#|go|rust|php|ruby|swift|kotlin)?\s*(?:script|program|function|class|api|bot))\b/.test(lowered);
    if (codingImplementationLike) {
        if (/\brat(?:\s+in)?\s+maze\b|\bmaze\b.*\brat\b/.test(lowered)) {
            return [
                "Here is a complete Python solution for Rat in a Maze (all valid paths):",
                "",
                "Code Example (python):",
                "'",
                "def find_paths(maze):",
                "    n = len(maze)",
                "    if n == 0 or maze[0][0] == 0 or maze[n - 1][n - 1] == 0:",
                "        return []",
                "",
                "    directions = [('D', 1, 0), ('L', 0, -1), ('R', 0, 1), ('U', -1, 0)]",
                "    visited = [[False] * n for _ in range(n)]",
                "    result = []",
                "",
                "    def backtrack(r, c, path):",
                "        if r == n - 1 and c == n - 1:",
                "            result.append(''.join(path))",
                "            return",
                "",
                "        visited[r][c] = True",
                "        for ch, dr, dc in directions:",
                "            nr, nc = r + dr, c + dc",
                "            if 0 <= nr < n and 0 <= nc < n and maze[nr][nc] == 1 and not visited[nr][nc]:",
                "                path.append(ch)",
                "                backtrack(nr, nc, path)",
                "                path.pop()",
                "        visited[r][c] = False",
                "",
                "    backtrack(0, 0, [])",
                "    return sorted(result)",
                "'",
            ].join("\n");
        }
        return [
            "I can generate complete runnable code for this.",
            "",
            "Please share:",
            "- Preferred language",
            "- Input and output format",
            "- Constraints or sample test cases",
        ].join("\n");
    }
    const normalizedQuestion = normalizeUserInput(normalized || input || "").normalized;
    const definitionTopic = extractDefinitionTopic(normalizedQuestion);
    if (definitionTopic && /\blogo\b/.test(definitionTopic)) {
        const brand = definitionTopic.replace(/\blogo\b/g, "").trim() || "the brand";
        return `The ${brand} logo is the visual brand symbol used to represent ${brand}. If you want, I can also describe its design elements and meaning.`;
    }
    if (intent === "unclear" || intent === "clarification" || (!normalized && input.trim().length === 0)) {
        const interpreted = String(normalizedQuestion || input || "").replace(/\s+/g, " ").trim().slice(0, 180);
        if (interpreted) {
            return `I interpreted your question as "${interpreted}". Add one specific detail (name, version, model, or context) and I will return a precise professional answer.`;
        }
        return "Please send your question again in one clear sentence, and I will answer directly.";
    }
    return "I will answer this directly with best effort. For maximum precision, include the exact entity name and context.";
};
const parseModelCsv = (csv) => csv
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
const buildModelAttempts = (primaryModelId, fallbackModelId, options) => {
    if (FORCE_OPENROUTER_FREE_ONLY_MODE) {
        const role = (options?.forceVision
            ? "vision"
            : options?.intent === "coding"
                ? "code"
                : options?.intent === "math"
                    ? "math"
                    : options?.intent === "current_events"
                        ? "current_events"
                        : options?.complexGeneralRequest
                            ? "smart"
                            : "general");
        const ordered = [
            isCuratedStrongFreeModelId(primaryModelId) ? primaryModelId : "",
            isCuratedStrongFreeModelId(fallbackModelId) ? fallbackModelId : "",
            ...CURATED_FREE_MODEL_POOLS[role],
        ].filter(Boolean);
        return Array.from(new Set(ordered));
    }
    const fromEnvPool = parseModelCsv((process.env.OPENROUTER_FALLBACK_MODELS || process.env.OPENROUTER_MODELS || "").trim());
    const ordered = [
        primaryModelId,
        fallbackModelId,
        (process.env.DEFAULT_MODEL || "").trim(),
        OPENROUTER_FREE_MODEL_ID,
        ...fromEnvPool,
    ].filter(Boolean);
    const unique = [];
    for (const modelId of ordered) {
        if (!unique.includes(modelId)) {
            unique.push(modelId);
        }
    }
    return unique.slice(0, MAX_MODEL_ATTEMPTS);
};
const normalizeCodeLanguage = (value) => {
    const normalized = value.trim().toLowerCase();
    return codeLanguageMap[normalized] || normalized || "text";
};
const inferLanguageFromPrompt = (prompt) => {
    const tests = [
        { pattern: /\btypescript|\.ts\b/i, language: "typescript" },
        { pattern: /\bjavascript|node\.?js|react|next\.?js|\.js\b/i, language: "javascript" },
        { pattern: /\bpython|\.py\b|pip\b/i, language: "python" },
        { pattern: /\bjava\b|spring\b/i, language: "java" },
        { pattern: /\bc\+\+|cpp\b/i, language: "cpp" },
        { pattern: /\bc#|csharp|dotnet|asp\.net\b/i, language: "csharp" },
        { pattern: /\bgo(lang)?\b/i, language: "go" },
        { pattern: /\brust\b/i, language: "rust" },
        { pattern: /\bphp\b/i, language: "php" },
        { pattern: /\bruby\b/i, language: "ruby" },
        { pattern: /\bswift\b/i, language: "swift" },
        { pattern: /\bkotlin\b/i, language: "kotlin" },
        { pattern: /\bsql\b|select\s+.*\s+from\b/i, language: "sql" },
        { pattern: /\bhtml\b/i, language: "html" },
        { pattern: /\bcss\b/i, language: "css" },
        { pattern: /\bbash\b|\bshell\b|\.sh\b/i, language: "bash" },
        { pattern: /\byaml\b|\.ya?ml\b/i, language: "yaml" },
        { pattern: /\bjson\b/i, language: "json" },
    ];
    for (const test of tests) {
        if (test.pattern.test(prompt))
            return test.language;
    }
    return "text";
};
const isCodeGenerationPrompt = (inputText) => {
    const normalized = inputText.toLowerCase();
    const codingKeywordPattern = /\b(code+|cod|coding|program(?:ming)?|script|function|class|api|bot|algorithm|solution|snippet|query|sql|leetcode|dsa)\b/;
    const codingTypoPattern = /\b(codee+|codd?e|programing|snipet)\b/;
    const codingVerbPattern = /\b(write|generate|create|build|make|give|provide|implement|develop)\b/;
    const codingLanguagePattern = /\b(c\+\+|cpp|c#|csharp|python|javascript|typescript|java|go|golang|rust|php|ruby|swift|kotlin|sql|html|css|bash|shell|react|node(?:\.?js)?)\b/;
    const tableRequestWithoutCode = /\b(table|tabular|rows?\s+and\s+columns?|columns?\s+and\s+rows?)\b/.test(normalized)
        && !/\b(code+|cod|coding|program(?:ming)?|script|sql|query|database|javascript|typescript|python|java|c\+\+|c#|cpp|react|node|js|ts|py)\b/.test(normalized);
    if (tableRequestWithoutCode) {
        return false;
    }
    const wantsCode = codingVerbPattern.test(normalized)
        && (codingKeywordPattern.test(normalized)
            || codingTypoPattern.test(normalized)
            || codingLanguagePattern.test(normalized));
    const debugLike = /\b(debug|fix|error|bug|stack trace|issue|refactor)\b/.test(normalized);
    const codeSyntaxSignal = /```|#include\s*<|def\s+\w+\s*\(|class\s+\w+|public\s+class\s+\w+/.test(normalized);
    return (wantsCode || codeSyntaxSignal) && !debugLike;
};
const looksLikeCode = (text) => {
    if (!text.trim())
        return false;
    const signalPatterns = [
        /^\s*(def |class |function |const |let |var |import |from |#include |public class |using |fn |SELECT |INSERT |UPDATE |DELETE |<!DOCTYPE html|<html|apiVersion:)/im,
        /[{}`;]/,
        /=>/,
        /^\s{2,}\S/m,
    ];
    return signalPatterns.some((pattern) => pattern.test(text));
};
const containsCodeSignals = (text) => {
    const value = String(text || "");
    if (!value.trim())
        return false;
    return (/Code Example(?:\s*\([^)]+\))?\s*:/i.test(value) ||
        /```|CODE_BEGIN|CODE_END/.test(value) ||
        /\b(def |class |function |const |let |var |#include|public class|using |fn )/i.test(value));
};
const buildCodeFileName = (language) => {
    const extension = codeExtensionMap[language] || "txt";
    return `generated_code.${extension}`;
};
const normalizeCodeMarkers = (text) => String(text || "")
    .replace(codeBeginTokenPattern, "\nCODE_BEGIN\n")
    .replace(codeEndTokenPattern, "\nCODE_END\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
const stripCodeFromDisplay = (text) => normalizeCodeMarkers(text)
    .replace(codeFencePattern, "")
    .replace(codeMarkerGlobalPattern, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
const isReadableCodeLayout = (code) => {
    const normalized = String(code || "").replace(/\r\n/g, "\n");
    const nonEmptyLines = normalized
        .split("\n")
        .map((line) => line.replace(/\s+$/g, ""))
        .filter((line) => line.trim().length > 0);
    if (nonEmptyLines.length < 3) {
        return false;
    }
    const longestLine = nonEmptyLines.reduce((max, line) => Math.max(max, line.length), 0);
    const longLineCount = nonEmptyLines.filter((line) => line.length > 140).length;
    return longestLine <= 220 && longLineCount <= Math.ceil(nonEmptyLines.length * 0.35);
};
const codeBlockCommentPattern = /\/\*[\s\S]*?\*\//g;
const codeSlashCommentPattern = /(^|[^:])\/\/.*$/gm;
const pythonDedentKeywordPattern = /^(elif\b|else:|except\b|finally:)/;
const pythonBlockStartPattern = /:\s*(?:#.*)?$/;
const pythonTerminalPattern = /^(return\b|break\b|continue\b|pass\b|raise\b)/;
const protectDoubleBraceValueBlocks = (input) => {
    const blocks = [];
    const text = String(input || "").replace(/\{\{[\s\S]*?\}\}/g, (match) => {
        const token = `__DOUBLE_BRACE_BLOCK_${blocks.length}__`;
        blocks.push(match);
        return token;
    });
    return { text, blocks };
};
const restoreDoubleBraceValueBlocks = (input, blocks) => {
    let output = String(input || "");
    for (let i = 0; i < blocks.length; i += 1) {
        const token = `__DOUBLE_BRACE_BLOCK_${i}__`;
        output = output.replace(new RegExp(token, "g"), blocks[i]);
    }
    return output;
};
const normalizeCodeTokenSpacing = (input) => String(input || "")
    .split("\n")
    .map((raw) => {
    const line = raw.trim();
    if (!line)
        return "";
    return line
        .replace(/[ \t]+,/g, ",")
        .replace(/,\s*(?=\S)/g, ", ")
        .replace(/[ \t]+;/g, ";")
        .replace(/[ \t]+\)/g, ")")
        .replace(/\(\s+/g, "(")
        .replace(/[ \t]+\]/g, "]")
        .replace(/\[\s+/g, "[")
        .replace(/\s*&&\s*/g, " && ")
        .replace(/\s*\|\|\s*/g, " || ")
        .replace(/\b(if|for|while|switch|catch)\(/g, "$1 (")
        .replace(/\belse\{/g, "else {")
        .replace(/[ \t]{2,}/g, " ");
})
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
const indentCodeByBraces = (input) => {
    const lines = String(input || "").split("\n");
    const output = [];
    let indentLevel = 0;
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            if (output.length > 0 && output[output.length - 1] !== "") {
                output.push("");
            }
            continue;
        }
        if (/^}/.test(line)) {
            indentLevel = Math.max(0, indentLevel - 1);
        }
        output.push(`${"    ".repeat(indentLevel)}${line}`);
        if (/\{$/.test(line)) {
            indentLevel += 1;
        }
    }
    return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};
const indentPythonCodeByBlocks = (input) => {
    const lines = String(input || "").split("\n");
    const output = [];
    let indentLevel = 0;
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            if (output.length > 0 && output[output.length - 1] !== "") {
                output.push("");
            }
            continue;
        }
        if (pythonDedentKeywordPattern.test(line)) {
            indentLevel = Math.max(0, indentLevel - 1);
        }
        output.push(`${"    ".repeat(indentLevel)}${line}`);
        if (pythonBlockStartPattern.test(line) && !line.startsWith("#")) {
            indentLevel += 1;
            continue;
        }
        if (pythonTerminalPattern.test(line) && indentLevel > 0) {
            indentLevel = Math.max(0, indentLevel - 1);
        }
    }
    return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};
const enforceStrictCodeLineLayout = (input, languageHint = "") => (() => {
    const protectedValueBlocks = protectDoubleBraceValueBlocks(String(input || ""));
    const formatted = protectedValueBlocks.text
        .replace(codeBlockCommentPattern, " ")
        .replace(codeSlashCommentPattern, "$1")
        .replace(/;\s*/g, ";\n")
        .replace(/(?<!\{)\{\s*/g, "{\n")
        .replace(/\s*(?<!\})\}(?!\})\s*/g, "\n}\n")
        .replace(/\s*\n\s*&&\s*/g, " && ")
        .replace(/\s*&&\s*\n\s*/g, " && ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    const restored = restoreDoubleBraceValueBlocks(formatted, protectedValueBlocks.blocks);
    const spaced = normalizeCodeTokenSpacing(restored);
    const normalizedLanguage = normalizeCodeLanguage(languageHint);
    const looksPython = normalizedLanguage === "python" ||
        (/\b(def |class |import |from |if |elif |else:|for |while |try:|except |with |return )/.test(spaced)
            && !/[{};]/.test(spaced));
    if (looksPython) {
        return indentPythonCodeByBlocks(spaced);
    }
    return indentCodeByBraces(spaced);
})();
const reflowSingleLineCode = (code, language) => {
    const input = code.trim();
    if (!input || input.includes("\n") || input.length < 90) {
        return input;
    }
    if (language === "python") {
        const pythonFormatted = input
            .replace(/;\s*/g, "\n")
            .replace(/\s+(?=def |class |if |elif |else:|for |while |try:|except |finally:|with |return |import |from |pass|break|continue)/g, "\n")
            .replace(/\b(return\s+[^\n]+?)\s+(?=[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+\])*\s*=)/g, "$1\n")
            .replace(/([)\]])\s+(?=[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+\])*\s*=)/g, "$1\n")
            .replace(/:\s+(?=[A-Za-z_][A-Za-z0-9_]*\s*=|if |for |while |return |pass|break|continue)/g, ":\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
        return enforceStrictCodeLineLayout(pythonFormatted, "python");
    }
    const genericFormatted = input
        .replace(/;\s*/g, ";\n")
        .replace(/\{\s*/g, "{\n")
        .replace(/\s*\}/g, "\n}\n")
        .replace(/\s+(?=function |const |let |var |if |else |for |while |return |class |import |from )/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return enforceStrictCodeLineLayout(genericFormatted, language);
};
const stripCodeExampleLabel = (value) => String(value || "").replace(/^\s*Code Example(?:\s*\([^)]+\))?\s*:\s*/i, "");
const stripTrailingNarrativeFromCode = (value) => String(value || "")
    .replace(/\s+(?:This approach|The algorithm works|Time complexity|Space complexity|Complexity|Explanation)\b[\s\S]*$/i, "")
    .trim();
const extractCodeExplanation = (rawOutput) => {
    const value = String(rawOutput || "").replace(/\r/g, "").trim();
    if (!value)
        return "";
    if (/```|CODE_BEGIN|CODE_END/.test(value)) {
        return stripCodeFromDisplay(value);
    }
    const cutTokens = [
        /\bCode Example(?:\s*\([^)]+\))?\s*:/i,
        /\bdef\b/,
        /\bclass\b/,
        /\bfunction\b/,
        /\bconst\b/,
        /\blet\b/,
        /\bvar\b/,
        /#include\b/i,
        /\bpublic\s+class\b/i,
    ];
    let cutAt = value.length;
    for (const token of cutTokens) {
        const match = token.exec(value);
        if (match && typeof match.index === "number") {
            cutAt = Math.min(cutAt, match.index);
        }
    }
    return value
        .slice(0, cutAt)
        .replace(/[:\-–\s]+$/g, "")
        .trim();
};
const normalizeExtractedCode = (code, language) => {
    const normalized = stripTrailingNarrativeFromCode(stripCodeExampleLabel(String(code || "").replace(/\r\n/g, "\n"))).trim();
    if (!normalized)
        return "";
    return reflowSingleLineCode(normalized, language);
};
const extractCodeArtifact = (rawOutput, prompt) => {
    const normalizedOutput = normalizeCodeMarkers(rawOutput);
    const markerMatch = normalizedOutput.match(codeMarkerPattern);
    if (markerMatch?.[1]) {
        const markerCode = markerMatch[1].trim();
        if (markerCode) {
            const language = inferLanguageFromPrompt(prompt);
            const normalizedLanguage = normalizeCodeLanguage(language);
            const extension = codeExtensionMap[normalizedLanguage] || "txt";
            return {
                language: normalizedLanguage,
                extension,
                fileName: buildCodeFileName(normalizedLanguage),
                code: normalizeExtractedCode(markerCode, normalizedLanguage),
            };
        }
    }
    let bestLanguage = "";
    let bestCode = "";
    for (const match of normalizedOutput.matchAll(codeFencePattern)) {
        const language = normalizeCodeLanguage(match[1] || "");
        const code = (match[2] || "").trim();
        if (code.length > bestCode.length) {
            bestCode = code;
            bestLanguage = language;
        }
    }
    if (bestCode) {
        const languageFromPrompt = inferLanguageFromPrompt(prompt);
        const normalizedLanguage = normalizeCodeLanguage(bestLanguage || languageFromPrompt);
        const extension = codeExtensionMap[normalizedLanguage] || "txt";
        return {
            language: normalizedLanguage,
            extension,
            fileName: buildCodeFileName(normalizedLanguage),
            code: normalizeExtractedCode(bestCode, normalizedLanguage),
        };
    }
    const codeExampleMatch = normalizedOutput.match(/Code Example(?:\s*\(([^)]+)\))?\s*:\s*([\s\S]+)/i);
    if (codeExampleMatch?.[2]) {
        const languageHint = normalizeCodeLanguage(String(codeExampleMatch[1] || "").trim() || inferLanguageFromPrompt(prompt));
        const extractedCode = normalizeExtractedCode(codeExampleMatch[2], languageHint);
        if (extractedCode && looksLikeCode(extractedCode)) {
            const extension = codeExtensionMap[languageHint] || "txt";
            return {
                language: languageHint,
                extension,
                fileName: buildCodeFileName(languageHint),
                code: extractedCode,
            };
        }
    }
    const mixedCodeStart = normalizedOutput.search(/\b(def |class |function |const |let |var |#include|public class|using |fn )/i);
    if (mixedCodeStart >= 0) {
        const languageHint = normalizeCodeLanguage(inferLanguageFromPrompt(prompt));
        const extractedCode = normalizeExtractedCode(normalizedOutput.slice(mixedCodeStart), languageHint);
        if (extractedCode && looksLikeCode(extractedCode)) {
            const extension = codeExtensionMap[languageHint] || "txt";
            return {
                language: languageHint,
                extension,
                fileName: buildCodeFileName(languageHint),
                code: extractedCode,
            };
        }
    }
    if (looksLikeCode(rawOutput)) {
        const sanitizedInlineCode = stripTrailingNarrativeFromCode(stripCodeExampleLabel(rawOutput.trim()));
        const normalizedLanguage = normalizeCodeLanguage(inferLanguageFromPrompt(prompt));
        const extension = codeExtensionMap[normalizedLanguage] || "txt";
        return {
            language: normalizedLanguage,
            extension,
            fileName: buildCodeFileName(normalizedLanguage),
            code: normalizeExtractedCode(sanitizedInlineCode, normalizedLanguage),
        };
    }
    return null;
};
const computeResponseTokenLimit = (inputText, routeMaxTokens, globalMaxTokens, verbosity) => {
    const base = Math.min(routeMaxTokens, globalMaxTokens);
    const isDetailedRequest = verbosity === "detailed" || detailedPromptPattern.test(inputText);
    const wantsExpandedResponse = expandedResponsePattern.test(inputText) || inputText.trim().length > 140;
    const isComplexPrompt = inputText.trim().length > 320
        || /\b(top\s+\d+|compare|comparison|difference|roadmap|guide|architecture|design|strategy|full|complete|end to end|comprehensive)\b/i.test(inputText);
    const isShortPrompt = inputText.trim().length < 80 && !isDetailedRequest;
    if (isShortPrompt) {
        return Math.max(420, Math.min(base, 820));
    }
    if (isDetailedRequest || wantsExpandedResponse || isComplexPrompt) {
        const desiredCap = isComplexPrompt || isDetailedRequest ? 2800 : 2200;
        return Math.min(globalMaxTokens, Math.max(base, Math.min(desiredCap, globalMaxTokens)));
    }
    return base;
};
const isLikelyIncompleteText = (text) => {
    const normalized = String(text || "").trim();
    if (!normalized || normalized.length < 120)
        return false;
    const lastChar = normalized.slice(-1);
    const hasTerminalPunctuation = /[.!?:)\]"]/u.test(lastChar);
    const trailingConnector = /\b(and|or|with|to|for|in|on|at|by|from|during|through|about|because|that|which)\s*$/i.test(normalized);
    const trailingCutWord = /[a-zA-Z]{1,3}$/u.test(normalized.split(/\s+/).slice(-1)[0] || "");
    return !hasTerminalPunctuation || trailingConnector || trailingCutWord;
};
const isComplexPromptNeedingCompleteAnswer = (prompt) => {
    const text = String(prompt || "").trim();
    if (!text)
        return false;
    if (text.length > 320)
        return true;
    return /\b(explain|detailed|detail|deep dive|step by step|comprehensive|compare|comparison|difference|pros and cons|advantages|disadvantages|top\s+\d+|list|guide|roadmap|architecture|design|strategy|plan|full|complete|analysis)\b/i.test(text);
};
const looksThinAnswerForComplexPrompt = (prompt, reply) => {
    if (!isComplexPromptNeedingCompleteAnswer(prompt))
        return false;
    const out = String(reply || "").trim();
    if (!out)
        return true;
    if (containsCodeSignals(out))
        return false;
    if (isPromptEchoLikeReply(prompt, out))
        return true;
    const normalized = normalizeLooseQualityText(out);
    if (!normalized)
        return true;
    const sentenceCount = out.split(/[.!?]\s+/).filter((part) => part.trim().length > 0).length;
    const lineCount = out.split(/\n+/).filter((line) => line.trim().length > 0).length;
    if (normalized.length < 180)
        return true;
    if (out.length < 300 && Math.max(sentenceCount, lineCount) < 4)
        return true;
    return false;
};
export const buildBot = (options) => {
    const bot = new Telegraf(options.token);
    const activeStreams = new Map();
    const lastEngineStateByChat = new Map();
    const ensureChat = async (ctx) => {
        const conversationKey = getConversationKey(ctx);
        if (!conversationKey)
            return null;
        const chat = await options.store.getOrCreateChat(conversationKey);
        return { conversationKey, chat };
    };
    const withRateLimit = async (ctx) => {
        const key = getRateLimitKey(ctx);
        if (!key)
            return true;
        const result = await options.rateLimiter.consume(key);
        const decision = decideRateLimitAction(result, { softMode: SOFT_RATE_LIMIT_MODE });
        if (decision.allowed && !decision.softLimited)
            return true;
        if (decision.softLimited) {
            logger.warn({ key, resetAt: result.resetAt.toISOString() }, "Soft rate-limit hit; continuing with best-effort response mode");
            return true;
        }
        logger.warn({ key, resetAt: result.resetAt.toISOString(), retryAfterSeconds: decision.retryAfterSeconds }, "Hard rate-limit enforced");
        await ctx.reply(`Rate limit reached. Please wait about ${decision.retryAfterSeconds}s and try again.`);
        return false;
    };
    const stopActiveStream = async (conversationKey) => {
        const controller = activeStreams.get(conversationKey);
        if (!controller)
            return false;
        controller.abort();
        activeStreams.delete(conversationKey);
        return true;
    };
    const handleReset = async (ctx) => {
        const chatInfo = await ensureChat(ctx);
        if (!chatInfo)
            return;
        await options.store.clearChat(chatInfo.chat.id);
        await ctx.reply("Conversation reset for this chat context.");
    };
    const handleModelCommand = async (ctx) => {
        const chatInfo = await ensureChat(ctx);
        if (!chatInfo || !("text" in ctx.message))
            return;
        const text = ctx.message.text;
        const args = splitArgs(text.replace(/^\/model(@\w+)?/i, ""));
        if (args.length > 0) {
            const locked = MODEL_LIST[0];
            if (!locked) {
                await ctx.reply("Model switching is disabled in this runtime.");
                return;
            }
            const updated = await options.store.updateSettings(chatInfo.chat.id, {
                currentModel: locked.key,
            });
            await ctx.reply(`AI model is locked to ${getDisplayAiModelName()}. Current routing profile: ${updated.currentModel}`);
            return;
        }
        const refreshed = await options.store.refreshChat(chatInfo.chat.id);
        const current = refreshed?.currentModel ?? chatInfo.chat.currentModel;
        await ctx.reply(`Current AI model: ${getDisplayAiModelName()}\nCurrent routing profile: ${current}\nModel switching is disabled.`);
    };
    const handleSettingsCommand = async (ctx) => {
        const chatInfo = await ensureChat(ctx);
        if (!chatInfo || !("text" in ctx.message))
            return;
        const text = ctx.message.text;
        const args = splitArgs(text.replace(/^\/settings(@\w+)?/i, ""));
        if (args.length === 0) {
            const refreshed = await options.store.refreshChat(chatInfo.chat.id);
            const current = refreshed ?? chatInfo.chat;
            await ctx.reply([
                "Settings:",
                `- AI model: ${getDisplayAiModelName()}`,
                `- routing profile: ${current.currentModel}`,
                `- temperature: ${current.temperature}`,
                `- verbosity: ${current.verbosity}`,
                `- style: ${current.stylePrompt || "(default)"}`,
                "",
                "Examples:",
                "/settings temperature 0.3",
                "/settings verbosity concise",
                "/settings style answer in product-manager style",
            ].join("\n"), createSettingsKeyboard());
            return;
        }
        const key = args[0].toLowerCase();
        if (key === "temperature") {
            const next = Number(args[1]);
            if (!Number.isFinite(next) || next < 0 || next > 2) {
                await ctx.reply("Temperature must be between 0 and 2.");
                return;
            }
            const updated = await options.store.updateSettings(chatInfo.chat.id, {
                temperature: next,
            });
            await ctx.reply(`Temperature updated to ${updated.temperature}.`);
            return;
        }
        if (key === "verbosity") {
            const next = (args[1] || "").toLowerCase();
            if (!["concise", "normal", "detailed"].includes(next)) {
                await ctx.reply("Verbosity must be one of: concise, normal, detailed.");
                return;
            }
            const updated = await options.store.updateSettings(chatInfo.chat.id, {
                verbosity: next,
            });
            await ctx.reply(`Verbosity updated to ${updated.verbosity}.`);
            return;
        }
        if (key === "style") {
            const style = text
                .replace(/^\/settings(@\w+)?/i, "")
                .trim()
                .replace(/^style\s+/i, "")
                .trim();
            if (!style) {
                await ctx.reply("Provide a style text after /settings style.");
                return;
            }
            const updated = await options.store.updateSettings(chatInfo.chat.id, {
                stylePrompt: style.slice(0, 500),
            });
            await ctx.reply(`Style prompt updated: ${updated.stylePrompt}`);
            return;
        }
        if (key === "reset_style") {
            await options.store.updateSettings(chatInfo.chat.id, {
                stylePrompt: null,
            });
            await ctx.reply("Custom style has been cleared.");
            return;
        }
        await ctx.reply("Unknown setting. Use /settings for available options.");
    };
    const handleStyleCommand = async (ctx) => {
        const chatInfo = await ensureChat(ctx);
        if (!chatInfo || !("text" in ctx.message))
            return;
        const text = ctx.message.text;
        const args = splitArgs(text.replace(/^\/style(@\w+)?/i, ""));
        const current = (await options.store.refreshChat(chatInfo.chat.id)) ?? chatInfo.chat;
        if (args.length === 0 || (args[0] || "").toLowerCase() === "status") {
            await ctx.reply([
                `Current response style: ${current.verbosity}`,
                `Custom style prompt: ${current.stylePrompt || "(none)"}`,
                "Use /style concise, /style normal, /style detailed",
                "Use /style custom <instructions>",
                "Use /style reset to clear custom style",
            ].join("\n"));
            return;
        }
        const mode = (args[0] || "").toLowerCase();
        if (mode === "custom") {
            const customStyle = text
                .replace(/^\/style(@\w+)?/i, "")
                .trim()
                .replace(/^custom\s+/i, "")
                .trim();
            if (!customStyle) {
                await ctx.reply("Provide custom style text after /style custom.");
                return;
            }
            const updated = await options.store.updateSettings(chatInfo.chat.id, {
                stylePrompt: customStyle.slice(0, 500),
            });
            await ctx.reply(`Custom style saved. Current custom style: ${updated.stylePrompt}`);
            return;
        }
        if (mode === "reset") {
            await options.store.updateSettings(chatInfo.chat.id, {
                stylePrompt: null,
            });
            await ctx.reply("Custom style cleared. Default style rules remain active.");
            return;
        }
        if (!["concise", "normal", "detailed"].includes(mode)) {
            await ctx.reply("Use: /style concise|normal|detailed|status, /style custom <text>, or /style reset");
            return;
        }
        const updated = await options.store.updateSettings(chatInfo.chat.id, {
            verbosity: mode,
        });
        await ctx.reply(`Response style set to ${updated.verbosity}.`);
    };
    const handleEngineCommand = async (ctx) => {
        const chatInfo = await ensureChat(ctx);
        if (!chatInfo || !("text" in ctx.message))
            return;
        const text = ctx.message.text;
        const args = splitArgs(text.replace(/^\/engine(@\w+)?/i, ""));
        const sub = (args[0] || "status").toLowerCase();
        const isCheck = sub === "check";
        const checkWantsJson = isCheck && (args[1] || "").toLowerCase() === "json";
        const wantsJson = (sub === "status" && (args[1] || "").toLowerCase() === "json")
            || sub === "json";
        if (!["status", "explain", "check"].includes(sub)) {
            if (sub !== "json") {
                await ctx.reply("Use: /engine status, /engine status json, /engine explain, or /engine check <prompt>");
                return;
            }
        }
        if (sub === "json") {
            // alias: /engine json
        }
        if (sub === "json" || sub === "status") {
            const current = (await options.store.refreshChat(chatInfo.chat.id)) ?? chatInfo.chat;
            const engineState = lastEngineStateByChat.get(chatInfo.chat.id);
            const payload = {
                engine: "response",
                runtime: "standalone",
                runtimeLabel: "standalone (Telegraf)",
                modelSelection: getDisplayAiModelName(),
                modelSelectionProfile: current.currentModel,
                temperature: current.temperature,
                verbosity: current.verbosity,
                customStyle: current.stylePrompt || null,
                lastProcessed: engineState
                    ? {
                        intent: engineState.intent,
                        codingAnswerEnginePolicyActive: engineState.codingPolicyActive,
                        promptPreview: engineState.promptPreview,
                        updatedAt: engineState.updatedAt,
                    }
                    : null,
                features: {
                    contextFollowUpResolution: true,
                    previousOrdinalReferenceParsing: true,
                    multiPartQuestionDecomposition: true,
                    finalSelfCheck: {
                        enabled: FINAL_SELF_CHECK_ENABLED,
                        minChars: FINAL_SELF_CHECK_MIN_CHARS,
                    },
                    incompleteAnswerContinuation: true,
                    codeFormattingEnforcement: true,
                    codeValidation: CODE_REPAIR_ENABLED,
                    codeExecutionRepairLoop: String(process.env.ADVANCED_CODE_EXECUTION_FIX_ENABLED || "").toLowerCase() !== "false",
                    rateLimitMode: SOFT_RATE_LIMIT_MODE ? "soft" : "hard",
                    responseEnginePolicyPrompt: true,
                    contextIntelligenceEnginePolicyPrompt: true,
                    codingAnswerEnginePolicyPrompt: "conditional",
                },
            };
            if (wantsJson) {
                await ctx.reply(JSON.stringify(payload, null, 2));
                return;
            }
            await ctx.reply([
                "Response Engine Status",
                `- runtime: standalone (Telegraf)`,
                `- AI model: ${getDisplayAiModelName()}`,
                `- routing profile: ${current.currentModel}`,
                `- temperature: ${current.temperature}`,
                `- verbosity: ${current.verbosity}`,
                `- custom style: ${current.stylePrompt || "(none)"}`,
                `- last processed intent: ${engineState?.intent || "(none yet)"}`,
                `- coding answer engine policy (last prompt): ${engineState ? (engineState.codingPolicyActive ? "ACTIVE" : "INACTIVE") : "UNKNOWN"}`,
                `- last prompt preview: ${engineState?.promptPreview || "(none yet)"}`,
                `- context follow-up resolution: ON`,
                `- explicit previous/ordinal reference parsing: ON`,
                `- multi-part question decomposition: ON`,
                `- final self-check pass: ${FINAL_SELF_CHECK_ENABLED ? `ON (min ${FINAL_SELF_CHECK_MIN_CHARS} chars)` : "OFF"}`,
                `- continuation for incomplete answers: ON`,
                `- code formatting enforcement: ON`,
                `- code validation: ${CODE_REPAIR_ENABLED ? "ON" : "OFF"}`,
                `- code execution repair loop: ${String(process.env.ADVANCED_CODE_EXECUTION_FIX_ENABLED || "").toLowerCase() === "false" ? "OFF" : "ON"}`,
                `- rate limit mode: ${SOFT_RATE_LIMIT_MODE ? "soft" : "hard"}`,
                `- response engine policy prompt: ON`,
                `- context intelligence engine policy prompt: ON`,
                `- coding answer engine policy prompt: ON (conditional by coding intent)`,
            ].join("\n"));
            return;
        }
        if (isCheck) {
            const current = (await options.store.refreshChat(chatInfo.chat.id)) ?? chatInfo.chat;
            const engineState = lastEngineStateByChat.get(chatInfo.chat.id);
            const recentMessages = await options.store.getRecentMessages(chatInfo.chat.id, RECENT_CONTEXT_MESSAGES);
            const promptText = text
                .replace(/^\/engine(@\w+)?/i, "")
                .trim()
                .replace(/^check\s+/i, "")
                .trim()
                .replace(/^json\s+/i, "")
                .trim();
            if (!promptText) {
                await ctx.reply("Use: /engine check <prompt>\nOptional: /engine check json <prompt>");
                return;
            }
            const normalizedInput = normalizeUserInput(promptText);
            const interpretedInput = normalizedInput.normalized || promptText;
            let detectedIntent = detectIntent(interpretedInput);
            const detailOnlyFollowUp = isDetailFollowUpOnlyPrompt(interpretedInput);
            const contextualFollowUp = isContextualFollowUpPrompt(interpretedInput);
            const followUpContext = contextualFollowUp
                ? extractLatestContextFromRecentMessages(recentMessages, interpretedInput)
                : null;
            const effectiveInput = followUpContext
                ? (detailOnlyFollowUp
                    ? buildDetailedFollowUpInput(followUpContext.previousUserPrompt, followUpContext.previousAssistantReply)
                    : buildContextualFollowUpInput(followUpContext.previousUserPrompt, interpretedInput, followUpContext.previousAssistantReply))
                : interpretedInput;
            if (effectiveInput !== interpretedInput) {
                detectedIntent = detectIntent(effectiveInput);
            }
            const parsedRef = parseContextReference(interpretedInput);
            const decomposition = decomposeQuestionParts(interpretedInput);
            const microHints = detectMicroHints(interpretedInput);
            const capabilityQuestionDetected = isShortCapabilityQuestion(interpretedInput);
            const casualSmallTalkDetected = isCasualSmallTalk(interpretedInput);
            const taskAlignmentRisk = estimateTaskAlignmentRisk({
                input: interpretedInput,
                intent: detectedIntent,
                effectiveChangedByContext: effectiveInput !== interpretedInput,
                contextualFollowUp,
                capabilityQuestionDetected,
                casualSmallTalkDetected,
            });
            const defaultLanguageIfUnspecified = inferDefaultLanguageIfUnspecified(effectiveInput || interpretedInput);
            const unknownTermRisk = estimateUnknownTermRisk(interpretedInput);
            const conversationalTone = detectConversationalTone(interpretedInput);
            const topicShift = detectTopicShift({
                currentInput: effectiveInput || interpretedInput,
                previousPrompt: engineState?.promptPreview || followUpContext?.previousUserPrompt || null,
                currentIntent: detectedIntent,
                previousIntent: engineState?.intent || null,
                contextualFollowUp,
                effectiveChangedByContext: effectiveInput !== interpretedInput,
                casualSmallTalkDetected,
            });
            const fallbackFragmentRisk = estimateFallbackFragmentRisk({
                input: interpretedInput,
                taskAlignmentRisk,
                contextualFollowUp,
                effectiveChangedByContext: effectiveInput !== interpretedInput,
                capabilityQuestionDetected,
                casualSmallTalkDetected,
                topicShiftDetected: topicShift.topicShiftDetected,
            });
            const semanticMismatchRisk = estimateSemanticMismatchRisk({
                input: effectiveInput || interpretedInput,
                intent: detectedIntent,
                taskAlignmentRisk,
                hardContextResetRecommended: topicShift.hardContextResetRecommended,
                unknownTermRisk,
                contextualFollowUp,
            });
            const retrievalArtifactRisk = estimateRetrievalArtifactRisk({
                input: effectiveInput || interpretedInput,
                intent: detectedIntent,
                unknownTermRisk,
                taskAlignmentRisk,
                capabilityQuestionDetected,
                casualSmallTalkDetected,
                contextualFollowUp,
            });
            const payload = {
                engine: "response",
                mode: "check",
                runtime: "standalone",
                input: {
                    raw: promptText,
                    normalized: interpretedInput,
                    effective: effectiveInput,
                    typoCorrected: normalizedInput.corrected,
                    corrections: normalizedInput.corrections,
                },
                detection: {
                    intent: detectedIntent,
                    contextIntelligenceEnginePolicyActive: true,
                    codingAnswerEnginePolicyActive: detectedIntent === "coding",
                    microHints,
                    capabilityQuestionDetected,
                    casualSmallTalkDetected,
                    taskAlignmentRisk,
                    defaultLanguageIfUnspecified,
                    unknownTermRisk,
                    conversationalToneClass: conversationalTone.tone,
                    toneConfidence: conversationalTone.confidence,
                    topicShiftDetected: topicShift.topicShiftDetected,
                    hardContextResetRecommended: topicShift.hardContextResetRecommended,
                    fallbackFragmentRisk,
                    semanticMismatchRisk,
                    retrievalArtifactRisk,
                    requestsPreviousFormatStyle: requestsPreviousFormatStyle(interpretedInput),
                    detailOnlyFollowUp,
                    contextualFollowUp,
                    contextReference: parsedRef,
                    followUpResolved: Boolean(followUpContext),
                    followUpSourceQuestion: followUpContext?.previousUserPrompt || null,
                },
                decomposition: {
                    isMultiPart: decomposition.isMultiPart,
                    parts: decomposition.parts,
                },
                chatSettings: {
                    modelSelection: current.currentModel,
                    temperature: current.temperature,
                    verbosity: current.verbosity,
                    customStyle: current.stylePrompt || null,
                },
            };
            if (checkWantsJson) {
                await ctx.reply(JSON.stringify(payload, null, 2));
                return;
            }
            await ctx.reply([
                "Response Engine Check",
                `- prompt: ${promptText}`,
                `- normalized: ${interpretedInput}`,
                `- effective input changed by context: ${effectiveInput !== interpretedInput ? "YES" : "NO"}`,
                `- detected intent: ${detectedIntent}`,
                `- context intelligence engine policy: ACTIVE`,
                `- coding answer engine policy: ${detectedIntent === "coding" ? "ACTIVE" : "INACTIVE"}`,
                `- micro-hints detected: ${microHints.matched.length ? microHints.matched.join(", ") : "(none)"}`,
                `- micro-hint scores: depth=${microHints.scores.depth}, style=${microHints.scores.style}, continuity=${microHints.scores.continuity}`,
                `- capability question detected: ${capabilityQuestionDetected ? "YES" : "NO"}`,
                `- casual small-talk detected: ${casualSmallTalkDetected ? "YES" : "NO"}`,
                `- task alignment risk: ${taskAlignmentRisk.toUpperCase()}`,
                `- default language if unspecified: ${defaultLanguageIfUnspecified}`,
                `- unknown-term hallucination risk: ${unknownTermRisk.toUpperCase()}`,
                `- conversational tone class: ${conversationalTone.tone}`,
                `- tone confidence: ${conversationalTone.confidence.toUpperCase()}`,
                `- topic shift detected vs previous: ${topicShift.topicShiftDetected ? "YES" : "NO"}`,
                `- hard context reset recommended: ${topicShift.hardContextResetRecommended ? "YES" : "NO"}`,
                `- fallback fragment risk: ${fallbackFragmentRisk.toUpperCase()}`,
                `- semantic mismatch risk: ${semanticMismatchRisk.toUpperCase()}`,
                `- retrieval artifact risk: ${retrievalArtifactRisk.toUpperCase()}`,
                `- inferred depth from hints: ${microHints.inferredDepth}`,
                `- inferred style from hints: ${microHints.inferredStyle}`,
                `- step-by-step hint: ${microHints.wantsStepByStep ? "YES" : "NO"}`,
                `- contextual follow-up detected: ${contextualFollowUp ? "YES" : "NO"}`,
                `- follow-up resolved from previous context: ${followUpContext ? "YES" : "NO"}`,
                `- context reference parsed: ${parsedRef.isReference ? `YES (${parsedRef.target}${parsedRef.ordinal ? ` #${parsedRef.ordinal}` : parsedRef.latest ? ", latest" : ""})` : "NO"}`,
                `- preserve previous format/style: ${parsedRef.preserveFormat || requestsPreviousFormatStyle(interpretedInput) ? "YES" : "NO"}`,
                `- multi-part question: ${decomposition.isMultiPart ? `YES (${decomposition.parts.length} parts)` : "NO"}`,
                ...(decomposition.isMultiPart ? decomposition.parts.map((part, index) => `  ${index + 1}. ${part}`) : []),
                `- current chat verbosity: ${current.verbosity}`,
                `- current custom style: ${current.stylePrompt || "(none)"}`,
                "Tip: use /engine check json <prompt> for machine-readable output",
            ].join("\n"));
            return;
        }
        if (sub === "explain") {
            await ctx.reply([
                "Response Engine Explain",
                "- context follow-up resolution: understands short follow-ups like 'more', 'why', 'do it' using recent messages",
                "- previous/ordinal reference parsing: resolves phrases like 'previous answer' or '2nd question'",
                "- multi-part decomposition: splits multi-question prompts and answers each part",
                "- final self-check: runs a quality/completeness pass before sending",
                "- continuation pass: repairs truncated/incomplete answers",
                "- response engine policy prompt: enforces your global answer rules",
                "- context intelligence engine policy: adds deeper topic continuity, intent-shift detection, and micro-hint tracking behavior",
                "- coding answer engine policy: activates only for coding intents and enforces strict coding answer structure",
                "- code validation/execution repair: detects and repairs weak/broken code outputs (if enabled)",
            ].join("\n"));
            return;
        }
    };
    const handleExport = async (ctx) => {
        const chatInfo = await ensureChat(ctx);
        if (!chatInfo)
            return;
        const exported = await options.store.exportConversation(chatInfo.chat.id);
        const txt = [
            `Chat: ${exported.chat?.telegramChatId ?? "unknown"}`,
            `AI Model: ${getDisplayAiModelName()}`,
            `Routing Profile: ${exported.chat?.currentModel ?? "unknown"}`,
            `Verbosity: ${exported.chat?.verbosity ?? "normal"}`,
            "",
            "Memories:",
            ...(exported.memories.length
                ? exported.memories.map((memory) => `- ${memory.key}: ${memory.value} (${memory.updatedAt.toISOString()})`)
                : ["(none)"]),
            "",
            "Messages:",
            ...exported.messages.map((message) => `[${message.createdAt.toISOString()}] ${message.role}${message.name ? `(${message.name})` : ""}: ${message.content}`),
            "",
        ].join("\n");
        const json = JSON.stringify(exported, null, 2);
        await ctx.replyWithDocument(Input.fromBuffer(Buffer.from(txt, "utf8"), "conversation.txt"));
        await ctx.replyWithDocument(Input.fromBuffer(Buffer.from(json, "utf8"), "conversation.json"));
    };
    const generateReply = async (ctx, text, replyOptions = {}) => {
        const forceVision = Boolean(replyOptions.forceVision);
        const imageUrls = (replyOptions.imageUrls || [])
            .map((value) => String(value || "").trim())
            .filter(Boolean);
        const chatInfo = await ensureChat(ctx);
        if (!chatInfo)
            return;
        const rateAllowed = await withRateLimit(ctx);
        if (!rateAllowed)
            return;
        const moderation = moderateInput(text);
        if (moderation.blocked) {
            await ctx.reply(moderation.reason);
            return;
        }
        const trimmedInput = text.trim().slice(0, options.maxInputChars);
        if (!trimmedInput)
            return;
        const normalizedInput = normalizeUserInput(trimmedInput);
        const interpretedInput = normalizedInput.normalized || trimmedInput;
        await options.lockManager.withChatLock(chatInfo.chat.id, async () => {
            const rememberMatch = interpretedInput.match(memoryCommandPattern);
            if (rememberMatch) {
                const memoryText = rememberMatch[1].trim().slice(0, 600);
                const memoryKey = `memory_${Date.now()}`;
                await options.store.upsertMemory(chatInfo.chat.id, memoryKey, memoryText);
                await options.store.appendMessage(chatInfo.chat.id, {
                    role: MessageRole.USER,
                    content: trimmedInput,
                });
                await options.store.appendMessage(chatInfo.chat.id, {
                    role: MessageRole.ASSISTANT,
                    content: `Saved to memory: ${memoryText}`,
                });
                await ctx.reply("Saved. I will remember that for future responses.");
                return;
            }
            await options.store.appendMessage(chatInfo.chat.id, {
                role: MessageRole.USER,
                content: trimmedInput,
            });
            const priorityChatReply = getPriorityChatReply(interpretedInput);
            if (priorityChatReply) {
                await options.store.appendMessage(chatInfo.chat.id, {
                    role: MessageRole.ASSISTANT,
                    content: priorityChatReply,
                });
                await ctx.reply(priorityChatReply);
                return;
            }
            const mediaEnvelopeInterpreted = isMediaEnvelopePrompt(interpretedInput);
            const interpretedIntentSignal = mediaEnvelopeInterpreted
                ? extractIntentSignalFromMediaPrompt(interpretedInput)
                : interpretedInput;
            let professionalIntent = forceVision
                ? "technical_question"
                : classifyProfessionalIntent(interpretedIntentSignal || interpretedInput, false);
            let intent = forceVision
                ? "general"
                : mapProfessionalIntentToRuntimeIntent(professionalIntent, interpretedIntentSignal || interpretedInput);
            const typingStop = startTypingIndicator(ctx);
            const placeholder = await ctx.reply("Thinking...");
            const detailedRequest = detailedPromptPattern.test(interpretedInput) || interpretedInput.length > 350;
            const recentContextLimit = detailedRequest
                ? RECENT_CONTEXT_MESSAGES
                : FAST_RECENT_CONTEXT_MESSAGES;
            const [refreshedBefore, memories, recentMessages] = await Promise.all([
                options.store.refreshChat(chatInfo.chat.id),
                options.store.getMemories(chatInfo.chat.id),
                options.store.getRecentMessages(chatInfo.chat.id, recentContextLimit),
            ]);
            const currentChat = refreshedBefore ?? chatInfo.chat;
            const detailOnlyFollowUp = isDetailFollowUpOnlyPrompt(interpretedInput);
            const followUpContext = isContextualFollowUpPrompt(interpretedInput)
                ? extractLatestContextFromRecentMessages(recentMessages, interpretedInput)
                : null;
            const effectiveInput = followUpContext
                ? (detailOnlyFollowUp
                    ? buildDetailedFollowUpInput(followUpContext.previousUserPrompt, followUpContext.previousAssistantReply)
                    : buildContextualFollowUpInput(followUpContext.previousUserPrompt, interpretedInput, followUpContext.previousAssistantReply))
                : interpretedInput;
            const mediaEnvelopeEffective = isMediaEnvelopePrompt(effectiveInput);
            const effectiveIntentSignal = mediaEnvelopeEffective
                ? extractIntentSignalFromMediaPrompt(effectiveInput)
                : effectiveInput;
            const typoAmbiguityClarification = !forceVision
                && !mediaEnvelopeEffective
                ? getTypoAmbiguityClarificationReply(effectiveInput)
                : null;
            if (typoAmbiguityClarification) {
                const clarifiedOutput = formatProfessionalReply(typoAmbiguityClarification);
                await options.store.appendMessage(chatInfo.chat.id, {
                    role: MessageRole.ASSISTANT,
                    content: clarifiedOutput,
                });
                await safeEditText(ctx, placeholder.message_id, clarifiedOutput).catch(async () => {
                    await safeReplyText(ctx, clarifiedOutput);
                });
                typingStop();
                return;
            }
            const unknownTermClarification = !forceVision
                && !mediaEnvelopeEffective
                ? getUnknownDefinitionClarificationReply(effectiveInput)
                : null;
            if (unknownTermClarification) {
                const clarifiedOutput = formatProfessionalReply(unknownTermClarification);
                await options.store.appendMessage(chatInfo.chat.id, {
                    role: MessageRole.ASSISTANT,
                    content: clarifiedOutput,
                });
                await safeEditText(ctx, placeholder.message_id, clarifiedOutput).catch(async () => {
                    await safeReplyText(ctx, clarifiedOutput);
                });
                typingStop();
                return;
            }
            if (!forceVision) {
                professionalIntent = classifyProfessionalIntent(effectiveIntentSignal || effectiveInput, recentMessages.length > 0);
                if (followUpContext) {
                    professionalIntent = "follow_up";
                }
                intent = mapProfessionalIntentToRuntimeIntent(professionalIntent, effectiveIntentSignal || effectiveInput);
            }
            lastEngineStateByChat.set(chatInfo.chat.id, {
                intent,
                codingPolicyActive: intent === "coding",
                promptPreview: effectiveInput.replace(/\s+/g, " ").trim().slice(0, 160),
                updatedAt: Date.now(),
            });
            const previousSamePromptReply = findPreviousAssistantReplyForSamePrompt(recentMessages, effectiveInput);
            const previousSamePromptReplyPreview = previousSamePromptReply
                ? previousSamePromptReply.replace(/\s+/g, " ").trim().slice(0, 700)
                : "";
            const route = routeModel(currentChat.currentModel, intent);
            const fastCodeModelId = (process.env.MODEL_CODE_FAST_ID || "").trim();
            const codeGenerationRequest = professionalIntent === "coding_request" && isCodeGenerationPrompt(effectiveInput);
            const complexProfessionalRequest = isComplexPromptNeedingCompleteAnswer(effectiveInput);
            const continuationRoundsForRequest = codeGenerationRequest
                ? Math.max(MAX_CONTINUATION_ROUNDS, 2)
                : complexProfessionalRequest
                    ? Math.max(MAX_CONTINUATION_ROUNDS, 2)
                    : MAX_CONTINUATION_ROUNDS;
            const codeFastPath = codeGenerationRequest && !FORCE_OPENROUTER_FREE_ONLY_MODE;
            if (CODE_FAST_PATH_ENABLED && codeFastPath) {
                if (route.autoRouted && fastCodeModelId) {
                    route.modelId = fastCodeModelId;
                    route.modelKey = "code-fast";
                }
                route.maxTokens = Math.min(route.maxTokens, 1600);
                route.temperature = Math.min(route.temperature, 0.2);
            }
            if (route.autoRouted
                && intent === "general"
                && complexProfessionalRequest) {
                const smartRoute = routeModel("smart", intent);
                route.modelId = smartRoute.modelId;
                route.modelKey = smartRoute.modelKey;
                route.temperature = Math.min(route.temperature, smartRoute.temperature);
                route.maxTokens = Math.max(route.maxTokens, smartRoute.maxTokens);
            }
            if (isOpenRouterFreeLikeModelId(route.modelId)) {
                route.temperature = Math.min(route.temperature, codeGenerationRequest ? 0.12 : intent === "math" ? 0.1 : complexProfessionalRequest ? 0.18 : 0.25);
                if (codeGenerationRequest || complexProfessionalRequest || intent === "math") {
                    route.maxTokens = Math.max(route.maxTokens, 2400);
                }
            }
            const modelOverride = forceVision ? "vision" : currentChat.currentModel;
            if (forceVision && modelOverride === "vision") {
                const vision = MODEL_LIST.find((model) => model.key === "vision");
                if (vision) {
                    route.modelId = vision.id;
                    route.modelKey = vision.key;
                }
            }
            const systemPrompt = buildSystemPrompt({
                verbosity: currentChat.verbosity,
                customStyle: currentChat.stylePrompt,
                memories,
                currentEventsMode: intent === "current_events",
                codingMode: codeGenerationRequest,
            });
            const messages = [
                { role: "system", content: systemPrompt },
            ];
            messages.push({
                role: "system",
                content: buildIntentRoutingInstruction(professionalIntent),
            });
            if (normalizedInput.corrected && normalizedInput.corrections.length > 0) {
                messages.push({
                    role: "system",
                    content: `Interpretation hint for the latest user message (typo-corrected): "${effectiveInput}". Answer directly using this intent unless clearly contradicted.`,
                });
            }
            if (followUpContext) {
                messages.push({
                    role: "system",
                    content: detailOnlyFollowUp
                        ? "Follow-up context rule: the user asked for more detail about the previous topic. Continue that exact topic in detail."
                        : "Follow-up context rule: the latest user message refers to the previous topic or answer. Use previous context and answer that exact topic directly.",
                });
            }
            if (previousSamePromptReplyPreview) {
                messages.push({
                    role: "system",
                    content: `Repeat-question rule: the user asked a similar/same question again. Provide a fresh, improved professional answer and do not repeat previous wording.\nPrevious answer preview (avoid repeating this wording): ${previousSamePromptReplyPreview}`,
                });
            }
            if (currentChat.summaryText?.trim()) {
                messages.push({
                    role: "system",
                    content: `Conversation summary:\n${currentChat.summaryText}`,
                });
            }
            if (intent === "current_events") {
                messages.push({
                    role: "system",
                    content: currentEventsDisclaimer,
                });
            }
            const recentMessagesForModel = effectiveInput !== interpretedInput
                ? replaceLatestUserMessageForModel(recentMessages, effectiveInput)
                : recentMessages;
            messages.push(...recentMessagesForModel);
            let outputBuffer = "";
            let lastEditAt = 0;
            let finalized = false;
            let stopped = false;
            let sawLiveDelta = false;
            let flushInFlight = false;
            let flushQueued = false;
            let flushTimer = null;
            let lastPreview = "";
            let generationErrored = false;
            let lastGenerationStatus = null;
            let activeModelId = route.modelId;
            const questionBreakdownInstruction = buildQuestionBreakdownInstruction(effectiveInput);
            const decomposedQuestion = decomposeQuestionParts(effectiveInput);
            let messagesForFinal = forceVision && imageUrls.length > 0
                ? injectLatestUserVisionMessage(messages, effectiveInput, imageUrls)
                : [...messages];
            if (questionBreakdownInstruction) {
                const insertAt = Math.max(1, messagesForFinal.length - 1);
                messagesForFinal.splice(insertAt, 0, {
                    role: "system",
                    content: questionBreakdownInstruction,
                });
            }
            const fallbackModelId = (process.env.FALLBACK_MODEL ||
                process.env.DEFAULT_MODEL ||
                "openrouter/free").trim();
            const responseTokenLimit = computeResponseTokenLimit(effectiveInput, route.maxTokens, options.maxOutputTokens, currentChat.verbosity);
            let wasTruncatedByTokens = false;
            const markIfTruncated = (finishReason) => {
                if ((finishReason || "").toLowerCase() === "length") {
                    wasTruncatedByTokens = true;
                }
            };
            const callWithFallback = async (operation) => {
                const attempts = buildModelAttempts(activeModelId, fallbackModelId, {
                    intent,
                    forceVision,
                    complexGeneralRequest: complexProfessionalRequest && intent === "general",
                });
                let lastError;
                for (const modelId of attempts) {
                    try {
                        activeModelId = modelId;
                        return await operation(modelId);
                    }
                    catch (error) {
                        if (isAbortError(error)) {
                            throw error;
                        }
                        lastError = error;
                        const status = extractErrorStatus(error);
                        logger.warn({
                            modelId,
                            status,
                            error: error instanceof Error ? error.message : String(error),
                        }, "Model attempt failed");
                        // Auth/provider errors are account-level, trying more models will not help.
                        if (status === 401 || status === 402 || status === 403) {
                            break;
                        }
                    }
                }
                throw lastError instanceof Error ? lastError : new Error(String(lastError));
            };
            const clearFlushTimer = () => {
                if (!flushTimer)
                    return;
                clearTimeout(flushTimer);
                flushTimer = null;
            };
            const flush = async (force = false) => {
                if (finalized)
                    return;
                const now = Date.now();
                const preview = buildStreamingPreview(outputBuffer);
                if (!preview.trim())
                    return;
                if (preview === lastPreview)
                    return;
                if (!force && now - lastEditAt < options.streamEditIntervalMs) {
                    flushQueued = true;
                    const waitMs = Math.max(1, options.streamEditIntervalMs - (now - lastEditAt));
                    if (!flushTimer) {
                        flushTimer = setTimeout(() => {
                            flushTimer = null;
                            if (!finalized) {
                                void flush(true);
                            }
                        }, waitMs);
                    }
                    return;
                }
                clearFlushTimer();
                if (flushInFlight) {
                    flushQueued = true;
                    return;
                }
                flushInFlight = true;
                lastEditAt = now;
                await safeEditText(ctx, placeholder.message_id, preview);
                lastPreview = preview;
                flushInFlight = false;
                if (flushQueued && !finalized) {
                    flushQueued = false;
                    void flush(false);
                }
            };
            const waitForFlushIdle = async () => {
                clearFlushTimer();
                if (flushQueued && !finalized) {
                    flushQueued = false;
                    await flush(true);
                }
                let guard = 0;
                while (flushInFlight && guard < 24) {
                    await new Promise((resolve) => setTimeout(resolve, 15));
                    guard += 1;
                }
            };
            const controller = new AbortController();
            const conversationKey = chatInfo.conversationKey;
            const previous = activeStreams.get(conversationKey);
            if (previous)
                previous.abort();
            activeStreams.set(conversationKey, controller);
            try {
                const useTools = shouldEnableTools(effectiveInput);
                let precomputedText = null;
                if (useTools) {
                    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
                        const decision = await callWithFallback((modelId) => options.openRouter.chatCompletion({
                            model: modelId,
                            messages: messagesForFinal,
                            temperature: route.temperature,
                            max_tokens: Math.min(responseTokenLimit, 900),
                            tools: TOOL_SCHEMAS,
                            tool_choice: "auto",
                        }, { signal: controller.signal }));
                        markIfTruncated(decision.finishReason);
                        if (!decision.toolCalls.length) {
                            precomputedText = decision.content || null;
                            break;
                        }
                        const assistantToolMessage = {
                            role: "assistant",
                            content: decision.content || "",
                            tool_calls: decision.toolCalls,
                        };
                        messagesForFinal.push(assistantToolMessage);
                        await options.store.appendMessage(chatInfo.chat.id, {
                            role: MessageRole.ASSISTANT,
                            content: decision.content ||
                                `[tool-calls] ${decision.toolCalls.map((toolCall) => toolCall.function.name).join(", ")}`,
                        });
                        for (const toolCall of decision.toolCalls) {
                            const executed = await executeTool(toolCall.function.name, toolCall.function.arguments);
                            logger.info({
                                chatId: chatInfo.chat.id,
                                tool: executed.name,
                                input: executed.input,
                                output: executed.output,
                            }, "Tool execution");
                            messagesForFinal.push({
                                role: "tool",
                                name: toolCall.function.name,
                                tool_call_id: toolCall.id,
                                content: executed.output,
                            });
                            await options.store.appendMessage(chatInfo.chat.id, {
                                role: MessageRole.TOOL,
                                name: toolCall.function.name,
                                toolCallId: toolCall.id,
                                content: executed.output,
                            });
                        }
                    }
                }
                if (precomputedText) {
                    outputBuffer = precomputedText;
                }
                else {
                    const streamResult = await callWithFallback((modelId) => options.openRouter.streamChatCompletion({
                        model: modelId,
                        messages: messagesForFinal,
                        temperature: currentChat.temperature ?? route.temperature,
                        max_tokens: responseTokenLimit,
                    }, {
                        signal: controller.signal,
                        onDelta: (delta) => {
                            sawLiveDelta = true;
                            outputBuffer += delta;
                            void flush(false);
                        },
                    }));
                    markIfTruncated(streamResult.finishReason);
                    if (!outputBuffer.trim() && streamResult.text.trim()) {
                        outputBuffer = streamResult.text;
                    }
                    // Fallback path for providers that fail to deliver usable streaming chunks.
                    if (!outputBuffer.trim()) {
                        const backupResult = await callWithFallback((modelId) => options.openRouter.chatCompletion({
                            model: modelId,
                            messages: messagesForFinal,
                            temperature: currentChat.temperature ?? route.temperature,
                            max_tokens: responseTokenLimit,
                        }, { signal: controller.signal }));
                        markIfTruncated(backupResult.finishReason);
                        if (backupResult.content.trim()) {
                            outputBuffer = backupResult.content;
                        }
                    }
                }
                if (!stopped && outputBuffer.trim()) {
                    const shouldContinue = wasTruncatedByTokens || isLikelyIncompleteText(outputBuffer);
                    for (let round = 0; shouldContinue && round < continuationRoundsForRequest; round += 1) {
                        const assistantTail = outputBuffer.slice(-2200);
                        const continuation = await callWithFallback((modelId) => options.openRouter.chatCompletion({
                            model: modelId,
                            messages: [
                                ...messagesForFinal,
                                { role: "assistant", content: assistantTail },
                                {
                                    role: "user",
                                    content: "Continue from where your previous answer stopped. Do not repeat earlier content. Finish the remaining points and end cleanly.",
                                },
                            ],
                            temperature: currentChat.temperature ?? route.temperature,
                            max_tokens: Math.min(responseTokenLimit, 900),
                        }, { signal: controller.signal }));
                        const tail = continuation.content.trim();
                        if (!tail || outputBuffer.includes(tail)) {
                            break;
                        }
                        outputBuffer = `${outputBuffer.trimEnd()}\n${tail}`.trim();
                        wasTruncatedByTokens = (continuation.finishReason || "").toLowerCase() === "length";
                        if (!wasTruncatedByTokens && !isLikelyIncompleteText(outputBuffer)) {
                            break;
                        }
                    }
                }
                // Last-resort path when stream and backup both produced an empty payload.
                if (!stopped && !outputBuffer.trim()) {
                    logger.warn({ chatId: chatInfo.chat.id, model: activeModelId }, "Primary generation returned empty output; attempting emergency completion");
                    const emergencyResult = await callWithFallback((modelId) => options.openRouter.chatCompletion({
                        model: modelId,
                        messages: messagesForFinal,
                        temperature: currentChat.temperature ?? route.temperature,
                        max_tokens: Math.min(responseTokenLimit, 1000),
                    }, { signal: controller.signal }));
                    markIfTruncated(emergencyResult.finishReason);
                    if (emergencyResult.content.trim()) {
                        outputBuffer = emergencyResult.content.trim();
                    }
                }
                // Guarantee actual, readable code for explicit code-generation prompts.
                let extractedForQuality = outputBuffer.trim()
                    ? extractCodeArtifact(outputBuffer, effectiveInput)
                    : null;
                const forceFreeModelCodeRepairPass = codeGenerationRequest
                    && isOpenRouterFreeLikeModelId(activeModelId);
                const needsCodeRepair = codeGenerationRequest &&
                    CODE_REPAIR_ENABLED &&
                    outputBuffer.trim() &&
                    (forceFreeModelCodeRepairPass
                        || !extractedForQuality
                        || !isReadableCodeLayout(extractedForQuality.code)
                        || containsTemplateCodeScaffoldSignals(outputBuffer)
                        || (Boolean(extractedForQuality) && containsTemplateCodeScaffoldSignals(extractedForQuality.code)));
                if (needsCodeRepair) {
                    const preferredCodeModelId = MODEL_LIST.find((model) => model.key === "code")?.id || route.modelId;
                    const previousModelId = activeModelId;
                    logger.info({ chatId: chatInfo.chat.id, primaryModel: previousModelId, repairModel: preferredCodeModelId }, "Running targeted code repair/finalization pass");
                    try {
                        activeModelId = preferredCodeModelId;
                        const repairedCodeResult = await callWithFallback((modelId) => options.openRouter.chatCompletion({
                            model: modelId,
                            messages: [
                                {
                                    role: "system",
                                    content: `${systemPrompt}
Additional rule for this turn:
- The user asked for code generation.
- Return runnable code between exact markers CODE_BEGIN and CODE_END.
- Keep any explanation short and place it outside the markers.
- Inside the code section, put each statement on its own line with proper indentation.
- Never compress code into one line.
- Fix missing imports, syntax issues, and obvious logical mistakes.
- Handle common edge cases where practical.
- Do not return partial code or placeholders.`,
                                },
                                { role: "user", content: effectiveInput },
                            ],
                            temperature: 0.1,
                            max_tokens: Math.min(CODE_REPAIR_MAX_TOKENS, Math.max(responseTokenLimit, 900)),
                        }, { signal: controller.signal }));
                        markIfTruncated(repairedCodeResult.finishReason);
                        const repairedText = repairedCodeResult.content.trim();
                        const repairedArtifact = repairedText
                            ? extractCodeArtifact(repairedText, effectiveInput)
                            : null;
                        if (repairedText &&
                            repairedArtifact &&
                            isReadableCodeLayout(repairedArtifact.code) &&
                            !containsTemplateCodeScaffoldSignals(repairedArtifact.code) &&
                            !containsTemplateCodeScaffoldSignals(repairedText)) {
                            outputBuffer = repairedText;
                            extractedForQuality = repairedArtifact;
                        }
                    }
                    finally {
                        activeModelId = previousModelId;
                    }
                }
            }
            catch (error) {
                if (isAbortError(error)) {
                    stopped = true;
                }
                else {
                    generationErrored = true;
                    const status = extractErrorStatus(error);
                    lastGenerationStatus = status;
                    logger.error({
                        error: error instanceof Error ? error.stack : String(error),
                        status,
                        model: activeModelId,
                    }, "Model generation failed");
                    outputBuffer = "";
                }
            }
            finally {
                clearFlushTimer();
                typingStop();
                if (activeStreams.get(conversationKey) === controller) {
                    activeStreams.delete(conversationKey);
                }
            }
            const canRunRecoveryPass = !stopped &&
                generationErrored &&
                !isProviderCreditFailureText(outputBuffer) &&
                ![401, 402, 403].includes(lastGenerationStatus ?? -1);
            if (canRunRecoveryPass) {
                try {
                    const recovery = await callWithFallback((modelId) => options.openRouter.chatCompletion({
                        model: modelId,
                        messages: [
                            {
                                role: "system",
                                content: "Recovery mode: infer the user's intent even if there are spelling mistakes. Answer directly with best effort. Do not ask for more context unless the request is empty or unsafe.",
                            },
                            ...messagesForFinal,
                        ],
                        temperature: Math.min(route.temperature, 0.3),
                        max_tokens: Math.min(responseTokenLimit, 1200),
                    }, { signal: controller.signal }));
                    markIfTruncated(recovery.finishReason);
                    if (recovery.content.trim()) {
                        outputBuffer = recovery.content.trim();
                        generationErrored = false;
                    }
                }
                catch (recoveryError) {
                    logger.warn({
                        chatId: chatInfo.chat.id,
                        status: extractErrorStatus(recoveryError),
                        model: activeModelId,
                        error: recoveryError instanceof Error
                            ? recoveryError.message
                            : String(recoveryError),
                    }, "Recovery pass failed");
                }
            }
            const fallbackReferenceInput = followUpContext?.previousUserPrompt || effectiveInput;
            const retryOnlyFallback = buildRetryOnlyPoliteMessage(fallbackReferenceInput, professionalIntent);
            if (stopped) {
                outputBuffer = `${outputBuffer.trim()}\n\n[stopped]`.trim();
            }
            if (!outputBuffer.trim()) {
                generationErrored = true;
                outputBuffer = retryOnlyFallback;
            }
            if (!stopped &&
                (isProviderCreditFailureText(outputBuffer) || isFailureLikeOutput(outputBuffer))) {
                generationErrored = true;
                outputBuffer = retryOnlyFallback;
            }
            if (!stopped &&
                !generationErrored &&
                (looksLikeEntityMismatch(effectiveInput, outputBuffer) || looksLikeTemplateReuseMismatch(effectiveInput, outputBuffer))) {
                generationErrored = true;
                outputBuffer = retryOnlyFallback;
            }
            const rawModelOutput = outputBuffer;
            const cleanedRawModelOutput = stripLeadingPromptEchoLines(effectiveInput, rawModelOutput) || rawModelOutput;
            const rawOutputHasTemplateCodeScaffold = codeGenerationRequest && containsTemplateCodeScaffoldSignals(rawModelOutput);
            const responseLooksCodeLike = containsCodeSignals(rawModelOutput);
            let codeArtifact = !generationErrored &&
                !stopped &&
                (codeGenerationRequest || responseLooksCodeLike) &&
                rawModelOutput.trim().length > 0
                ? extractCodeArtifact(rawModelOutput, effectiveInput)
                : null;
            if (codeArtifact && containsTemplateCodeScaffoldSignals(codeArtifact.code)) {
                generationErrored = true;
                codeArtifact = null;
                outputBuffer = retryOnlyFallback;
            }
            const canAttachCodeFile = CODE_FILE_EXPORT_ENABLED && Boolean(codeArtifact);
            let displayOutput = cleanedRawModelOutput;
            if (codeArtifact) {
                const explanationOnly = extractCodeExplanation(rawModelOutput);
                const inlineCodeSection = codeArtifact.code;
                const language = normalizeCodeLanguage(codeArtifact.language || "text");
                const fencedCodeSection = `\`\`\`${language}\n${inlineCodeSection}\n\`\`\``;
                displayOutput = explanationOnly
                    ? `${explanationOnly}\n\n${fencedCodeSection}`
                    : fencedCodeSection;
            }
            outputBuffer = formatProfessionalReply(displayOutput);
            if (!outputBuffer.trim()) {
                outputBuffer = formatProfessionalReply(retryOnlyFallback || displayOutput || effectiveInput);
            }
            const forceAdvancedRewriteForFreeModel = !stopped &&
                !generationErrored &&
                !codeArtifact &&
                isOpenRouterFreeLikeModelId(activeModelId) &&
                (complexProfessionalRequest || intent === "math");
            const needsQualityRewrite = !stopped &&
                !codeArtifact &&
                (forceAdvancedRewriteForFreeModel ||
                    rawOutputHasTemplateCodeScaffold ||
                    isPromptEchoLikeReply(effectiveInput, outputBuffer) ||
                    isLowValueDeflectionOutput(outputBuffer) ||
                    looksLikeTemplateReuseMismatch(effectiveInput, outputBuffer) ||
                    looksThinAnswerForComplexPrompt(effectiveInput, outputBuffer) ||
                    (previousSamePromptReply
                        && isMeaningfullyRepeatedReply(previousSamePromptReply, outputBuffer)));
            if (needsQualityRewrite) {
                const draftPreview = String(rawModelOutput || outputBuffer)
                    .replace(/\s+/g, " ")
                    .trim()
                    .slice(0, 900);
                const rewritePromptLines = [
                    "Rewrite the previous answer into a complete, professional final answer.",
                    `Question: ${effectiveInput}`,
                    "Rules:",
                    "- Answer the exact question directly.",
                    "- Stay on the exact topic and do not reuse an unrelated template.",
                    "- Do not echo or repeat the user's question.",
                    "- Do not ask for the same question again.",
                    "- Use clear structure and complete useful details.",
                    "- Use dash bullets (-) for lists and avoid numeric list markers.",
                    "- For unfamiliar low-confidence terms, ask for clarification instead of inventing a definition.",
                    "- For prices/current rankings/statistics with low confidence, avoid invented exact numbers and use wording like: Approximate estimate based on available data.",
                ];
                if (complexProfessionalRequest) {
                    rewritePromptLines.push("- This is a complex/big question. Give a complete professional answer with clear sections and enough detail.");
                }
                if (forceAdvancedRewriteForFreeModel) {
                    rewritePromptLines.push("- Free-model quality mode is active. Improve logic, completeness, and professionalism before finalizing.");
                }
                if (requestsPreviousFormatStyle(interpretedInput) || requestsPreviousFormatStyle(effectiveInput)) {
                    rewritePromptLines.push("- The user referred to the previous answer format/style. Preserve the same structure while improving the answer quality.");
                }
                if (previousSamePromptReplyPreview) {
                    rewritePromptLines.push("- The user has asked this before. Use fresh wording and improved structure.");
                    rewritePromptLines.push(`Previous answer preview (do not repeat): ${previousSamePromptReplyPreview}`);
                }
                if (draftPreview) {
                    rewritePromptLines.push(`Draft to fix: ${draftPreview}`);
                }
                rewritePromptLines.push("Return only the improved final answer.");
                try {
                    const rewritten = await callWithFallback((modelId) => options.openRouter.chatCompletion({
                        model: modelId,
                        messages: [
                            ...messagesForFinal,
                            { role: "assistant", content: String(rawModelOutput || outputBuffer || "").slice(0, 4000) },
                            { role: "user", content: rewritePromptLines.join("\n") },
                        ],
                        temperature: Math.min(route.temperature, 0.35),
                        max_tokens: Math.min(responseTokenLimit, 1400),
                    }, { signal: controller.signal }));
                    markIfTruncated(rewritten.finishReason);
                    if (rewritten.content.trim()) {
                        const rewrittenFormatted = formatProfessionalReply(rewritten.content.trim());
                        const stillWeak = isPromptEchoLikeReply(effectiveInput, rewrittenFormatted)
                            || isLowValueDeflectionOutput(rewrittenFormatted)
                            || looksLikeTemplateReuseMismatch(effectiveInput, rewrittenFormatted)
                            || looksThinAnswerForComplexPrompt(effectiveInput, rewrittenFormatted)
                            || (previousSamePromptReply
                                && isMeaningfullyRepeatedReply(previousSamePromptReply, rewrittenFormatted));
                        if (!stillWeak && rewrittenFormatted.trim()) {
                            outputBuffer = rewrittenFormatted;
                        }
                    }
                }
                catch (qualityRewriteError) {
                    logger.warn({
                        chatId: chatInfo.chat.id,
                        status: extractErrorStatus(qualityRewriteError),
                        model: activeModelId,
                        error: qualityRewriteError instanceof Error
                            ? qualityRewriteError.message
                            : String(qualityRewriteError),
                    }, "Quality rewrite pass failed");
                }
            }
            const shouldRunFinalSelfCheckPass = (candidate) => {
                if (!FINAL_SELF_CHECK_ENABLED)
                    return false;
                const text = String(candidate || "").trim();
                if (!text)
                    return false;
                if (text.length < FINAL_SELF_CHECK_MIN_CHARS && !codeGenerationRequest)
                    return false;
                if (codeGenerationRequest)
                    return true;
                if (isLikelyIncompleteText(text))
                    return true;
                if (complexProfessionalRequest && looksThinAnswerForComplexPrompt(effectiveInput, text))
                    return true;
                return complexProfessionalRequest || intent === "math" || requestsPreviousFormatStyle(effectiveInput);
            };
            if (!stopped && !generationErrored && shouldRunFinalSelfCheckPass(outputBuffer)) {
                const selfCheckPromptLines = [
                    "Final answer quality check and correction.",
                    `Question: ${effectiveInput}`,
                    "Checklist:",
                    codeGenerationRequest
                        ? "- Ensure code is complete, runnable, and not truncated."
                        : "- Ensure all parts of the question are fully answered.",
                    "- Ensure the answer directly matches the exact topic/question and is not a reused unrelated template.",
                    "- Remove hallucinated or low-confidence invented facts/definitions.",
                    "- Use dash bullets (-) for lists and avoid numeric list markers.",
                    "- Do not split currency values or numeric values across lines.",
                    "- Remove repeated lines and filler.",
                    "- Keep the answer professional, logical, and well-structured.",
                    "- End cleanly with a complete final sentence.",
                    "Rules:",
                    "- Preserve the exact requested topic/entity and correct facts.",
                    "- If the draft is already good, return a polished improved final answer only.",
                    "- Do not mention verification or this checklist.",
                    "Return only the final corrected answer.",
                ];
                if (decomposedQuestion.isMultiPart) {
                    selfCheckPromptLines.push("Explicitly verify and answer these parts in order:");
                    for (let i = 0; i < decomposedQuestion.parts.length; i += 1) {
                        selfCheckPromptLines.push(`${i + 1}. ${decomposedQuestion.parts[i]}`);
                    }
                }
                if (requestsPreviousFormatStyle(interpretedInput) || requestsPreviousFormatStyle(effectiveInput)) {
                    selfCheckPromptLines.push("- Preserve the previous answer's format/style structure if referenced.");
                }
                try {
                    const verified = await callWithFallback((modelId) => options.openRouter.chatCompletion({
                        model: modelId,
                        messages: [
                            ...messagesForFinal,
                            { role: "assistant", content: String(outputBuffer || "").slice(-5000) },
                            { role: "user", content: selfCheckPromptLines.join("\n") },
                        ],
                        temperature: Math.min(route.temperature, 0.28),
                        max_tokens: Math.min(responseTokenLimit, 1400),
                    }, { signal: controller.signal }));
                    markIfTruncated(verified.finishReason);
                    if (verified.content.trim()) {
                        const verifiedFormatted = formatProfessionalReply(verified.content.trim());
                        const stillBad = isPromptEchoLikeReply(effectiveInput, verifiedFormatted)
                            || isLowValueDeflectionOutput(verifiedFormatted)
                            || looksLikeTemplateReuseMismatch(effectiveInput, verifiedFormatted)
                            || (complexProfessionalRequest && looksThinAnswerForComplexPrompt(effectiveInput, verifiedFormatted));
                        if (!stillBad) {
                            outputBuffer = verifiedFormatted;
                        }
                    }
                }
                catch (selfCheckError) {
                    logger.warn({
                        chatId: chatInfo.chat.id,
                        status: extractErrorStatus(selfCheckError),
                        model: activeModelId,
                        error: selfCheckError instanceof Error ? selfCheckError.message : String(selfCheckError),
                    }, "Final self-check pass failed");
                }
            }
            const finalReplyStillWeak = (codeGenerationRequest && containsTemplateCodeScaffoldSignals(rawModelOutput || outputBuffer))
                || (!codeArtifact &&
                    (isPromptEchoLikeReply(effectiveInput, outputBuffer)
                        || isLowValueDeflectionOutput(outputBuffer)
                        || hasBlockedTemplateLeak(outputBuffer)
                        || looksLikeTemplateReuseMismatch(effectiveInput, outputBuffer)
                        || looksThinAnswerForComplexPrompt(effectiveInput, outputBuffer)));
            if (finalReplyStillWeak) {
                outputBuffer = formatProfessionalReply(buildRetryOnlyPoliteMessage(effectiveInput, professionalIntent));
            }
            const chunks = chunkText(outputBuffer, TELEGRAM_CHUNK_LIMIT);
            if (chunks.length === 0) {
                chunks.push(outputBuffer);
            }
            finalized = true;
            await waitForFlushIdle();
            const shouldUseTypewriterFallback = TYPEWRITER_FALLBACK_ENABLED &&
                !sawLiveDelta &&
                !codeArtifact &&
                chunks.every((chunk) => chunk.length <= TYPEWRITER_MAX_CHARS);
            if (shouldUseTypewriterFallback) {
                await runTypewriterEdit(ctx, placeholder.message_id, chunks[0], controller.signal);
                for (let i = 1; i < chunks.length; i += 1) {
                    const messageId = await safeReplyAndGetMessageId(ctx, "...");
                    if (messageId) {
                        await runTypewriterEdit(ctx, messageId, chunks[i], controller.signal);
                    }
                    else {
                        await safeReplyText(ctx, chunks[i]);
                    }
                }
            }
            else {
                await safeEditText(ctx, placeholder.message_id, chunks[0]);
                for (let i = 1; i < chunks.length; i += 1) {
                    await safeReplyText(ctx, chunks[i]);
                }
            }
            if (canAttachCodeFile && codeArtifact) {
                await ctx
                    .replyWithDocument(Input.fromBuffer(Buffer.from(codeArtifact.code, "utf8"), codeArtifact.fileName), {})
                    .catch(() => { });
            }
            const shouldSendSticker = !generationErrored &&
                Math.random() < REPLY_STICKER_PROBABILITY;
            if (shouldSendSticker) {
                await sendReplySticker(ctx);
            }
            await options.store.appendMessage(chatInfo.chat.id, {
                role: MessageRole.ASSISTANT,
                content: outputBuffer,
            });
            // Run summary update after user-visible response is already delivered.
            void options.store
                .refreshChat(chatInfo.chat.id)
                .then((refreshed) => {
                if (!refreshed)
                    return;
                return options.summarizer.summarizeIfNeeded(refreshed);
            })
                .catch((error) => {
                logger.warn({ chatId: chatInfo.chat.id, error: error instanceof Error ? error.message : String(error) }, "Post-response summarization failed");
            });
        });
    };
    bot.start(async (ctx) => {
        await ctx.reply([
            "Welcome. I am your ChatGPT-style Telegram assistant powered by NVIDIA.",
            "",
            "Quick tips:",
            "- Ask coding, math, writing, planning, interview, and research-style questions.",
            "- Use /model to view the locked runtime model.",
            "- Use /settings to change temperature and verbosity.",
            "- Use /style concise|normal|detailed for response detail level.",
            "- Use /reset to clear this conversation memory.",
            "- Use /stop to stop an in-progress response.",
        ].join("\n"), Markup.inlineKeyboard([
            [Markup.button.callback("Reset chat", "action:reset")],
            [Markup.button.callback("Toggle concise/detailed", "settings:toggle-verbosity")],
        ]));
    });
    bot.command("help", async (ctx) => {
        await ctx.reply([
            "Commands:",
            "/start - onboarding",
            "/help - this help message",
            "/reset - clear chat history for this chat context",
            "/model - show locked runtime model",
            "/settings - view or update settings",
            "/style [concise|normal|detailed|status] - response detail level",
            "/style custom <text> | /style reset - custom response style prompt",
            "/engine status - show active response engine features/settings",
            "/engine status json - machine-readable engine diagnostics",
            "/engine explain - explain what each engine feature does",
            "/engine check <prompt> - run local engine diagnostics for a prompt",
            "/engine check json <prompt> - same diagnostics in JSON",
            "/export - export this conversation as txt/json",
            "/stop - stop active streaming response",
            "",
            "Examples:",
            "- /settings temperature 0.2",
            "- /settings verbosity detailed",
            "- /style detailed",
            "- /style custom answer like a senior backend engineer",
            "- /engine status",
            "- /engine status json",
            "- /engine explain",
            "- /engine check json find shortest path in a grid maze",
            "- /model",
        ].join("\n"));
    });
    bot.command("reset", async (ctx) => {
        await handleReset(ctx);
    });
    bot.command("model", async (ctx) => {
        await handleModelCommand(ctx);
    });
    bot.command("settings", async (ctx) => {
        await handleSettingsCommand(ctx);
    });
    bot.command("style", async (ctx) => {
        await handleStyleCommand(ctx);
    });
    bot.command("engine", async (ctx) => {
        await handleEngineCommand(ctx);
    });
    bot.command("export", async (ctx) => {
        await handleExport(ctx);
    });
    bot.command("stop", async (ctx) => {
        const conversationKey = getConversationKey(ctx);
        if (!conversationKey)
            return;
        const stopped = await stopActiveStream(conversationKey);
        await ctx.reply(stopped ? "Stopped current response." : "No active stream to stop.");
    });
    bot.on("callback_query", async (ctx) => {
        if (!("data" in ctx.callbackQuery))
            return;
        const data = ctx.callbackQuery.data;
        const chatInfo = await ensureChat(ctx);
        if (!chatInfo)
            return;
        if (data === "action:reset") {
            await options.store.clearChat(chatInfo.chat.id);
            await ctx.answerCbQuery("Chat reset.");
            await ctx.reply("Conversation reset.");
            return;
        }
        if (data === "action:switch-model") {
            await ctx.answerCbQuery("Model switching is disabled");
            await ctx.reply(`Current AI model: ${getDisplayAiModelName()}. Model switching is disabled.`);
            return;
        }
        if (data === "settings:toggle-verbosity") {
            const current = (await options.store.refreshChat(chatInfo.chat.id)) ?? chatInfo.chat;
            const next = current.verbosity === "concise"
                ? "detailed"
                : current.verbosity === "detailed"
                    ? "normal"
                    : "concise";
            const updated = await options.store.updateSettings(chatInfo.chat.id, {
                verbosity: next,
            });
            await ctx.answerCbQuery(`Verbosity: ${updated.verbosity}`);
            await ctx.reply(`Verbosity changed to ${updated.verbosity}.`);
            return;
        }
        if (data.startsWith("model:")) {
            const locked = MODEL_LIST[0];
            if (!locked)
                return;
            await options.store.updateSettings(chatInfo.chat.id, {
                currentModel: locked.key,
            });
            await ctx.answerCbQuery(`AI Model: ${getDisplayAiModelName()}`);
            await ctx.reply(`AI model is locked to ${getDisplayAiModelName()}. Routing profile: ${locked.key}`);
            return;
        }
        await ctx.answerCbQuery();
    });
    bot.on("text", async (ctx) => {
        if (!ctx.message?.text)
            return;
        if (ctx.message.text.startsWith("/"))
            return;
        try {
            await generateReply(ctx, ctx.message.text);
        }
        catch (error) {
            logger.error({ error: error instanceof Error ? error.stack : String(error) }, "Failed to handle text message");
            const fallbackIntent = classifyProfessionalIntent(ctx.message.text, false);
            const fallbackOutput = formatProfessionalReply(buildRetryOnlyPoliteMessage(ctx.message.text, fallbackIntent));
            await safeReplyText(ctx, fallbackOutput);
        }
    });
    bot.on("photo", async (ctx) => {
        try {
            const caption = String(ctx.message.caption || "").trim();
            const largestPhoto = [...(ctx.message.photo || [])].sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0];
            if (!largestPhoto?.file_id) {
                await ctx.reply("I could not read the uploaded image file.");
                return;
            }
            const fileUrl = await ctx.telegram.getFileLink(largestPhoto.file_id);
            const photoPrompt = await buildPhotoPromptFromTelegramFile({
                fileUrl: fileUrl.toString(),
                fileName: `telegram_photo_${String(largestPhoto.file_id).slice(0, 12)}.jpg`,
                mimeType: "image/jpeg",
                caption,
            });
            await generateReply(ctx, photoPrompt);
        }
        catch (error) {
            logger.error({ error: error instanceof Error ? error.stack : String(error) }, "Failed to handle photo message");
            await ctx.reply("I could not process this image right now.");
        }
    });
    bot.on("voice", async (ctx) => {
        try {
            const fileId = ctx.message.voice?.file_id;
            if (!fileId) {
                await ctx.reply("I could not read this voice message file.");
                return;
            }
            const caption = String(ctx.message?.caption || "").trim();
            const fileUrl = await ctx.telegram.getFileLink(fileId);
            const transcript = await transcribeTelegramMediaFromUrl(fileUrl.toString());
            const prompt = buildMediaPromptForReply({
                kind: "voice",
                caption,
                fileUrl: fileUrl.toString(),
                transcript,
                durationSeconds: Number(ctx.message.voice?.duration || 0),
            });
            await generateReply(ctx, prompt);
        }
        catch (error) {
            logger.error({ error: error instanceof Error ? error.stack : String(error) }, "Failed to handle voice message");
            await ctx.reply("I could not process this voice message right now.");
        }
    });
    bot.on("audio", async (ctx) => {
        try {
            const fileId = ctx.message.audio?.file_id;
            if (!fileId) {
                await ctx.reply("I could not read this audio file.");
                return;
            }
            const caption = String(ctx.message?.caption || "").trim();
            const fileUrl = await ctx.telegram.getFileLink(fileId);
            const transcript = await transcribeTelegramMediaFromUrl(fileUrl.toString());
            const prompt = buildMediaPromptForReply({
                kind: "audio",
                caption,
                fileUrl: fileUrl.toString(),
                transcript,
                durationSeconds: Number(ctx.message.audio?.duration || 0),
                title: String(ctx.message.audio?.title || "").trim(),
                performer: String(ctx.message.audio?.performer || "").trim(),
            });
            await generateReply(ctx, prompt);
        }
        catch (error) {
            logger.error({ error: error instanceof Error ? error.stack : String(error) }, "Failed to handle audio message");
            await ctx.reply("I could not process this audio right now.");
        }
    });
    bot.on("video", async (ctx) => {
        try {
            const fileId = ctx.message.video?.file_id;
            if (!fileId) {
                await ctx.reply("I could not read this video file.");
                return;
            }
            const caption = String(ctx.message.caption || "").trim();
            const fileUrl = await ctx.telegram.getFileLink(fileId);
            const transcript = await transcribeTelegramMediaFromUrl(fileUrl.toString());
            const prompt = buildMediaPromptForReply({
                kind: "video",
                caption,
                fileUrl: fileUrl.toString(),
                transcript,
                durationSeconds: Number(ctx.message.video?.duration || 0),
            });
            await generateReply(ctx, prompt);
        }
        catch (error) {
            logger.error({ error: error instanceof Error ? error.stack : String(error) }, "Failed to handle video message");
            await ctx.reply("I could not process this video right now.");
        }
    });
    bot.on("video_note", async (ctx) => {
        try {
            const fileId = ctx.message.video_note?.file_id;
            if (!fileId) {
                await ctx.reply("I could not read this video note.");
                return;
            }
            const fileUrl = await ctx.telegram.getFileLink(fileId);
            const transcript = await transcribeTelegramMediaFromUrl(fileUrl.toString());
            const prompt = buildMediaPromptForReply({
                kind: "video",
                fileUrl: fileUrl.toString(),
                transcript,
                durationSeconds: Number(ctx.message.video_note?.duration || 0),
            });
            await generateReply(ctx, prompt);
        }
        catch (error) {
            logger.error({ error: error instanceof Error ? error.stack : String(error) }, "Failed to handle video note");
            await ctx.reply("I could not process this video note right now.");
        }
    });
    bot.on("document", async (ctx) => {
        try {
            const doc = ctx.message.document;
            const mimeType = String(doc?.mime_type || "").toLowerCase();
            const isAudio = mimeType.startsWith("audio/");
            const isVideo = mimeType.startsWith("video/");
            const caption = String(ctx.message?.caption || "").trim();
            const fileId = doc?.file_id;
            if (!fileId) {
                await ctx.reply("I could not read this document file.");
                return;
            }
            const fileUrl = await ctx.telegram.getFileLink(fileId);
            if (!isAudio && !isVideo) {
                const documentPrompt = await buildDocumentPromptFromTelegramFile({
                    fileUrl: fileUrl.toString(),
                    fileName: String(doc?.file_name || "unknown").trim(),
                    mimeType: String(doc?.mime_type || "unknown").trim(),
                    caption,
                });
                await generateReply(ctx, documentPrompt);
                return;
            }
            const transcript = await transcribeTelegramMediaFromUrl(fileUrl.toString());
            const prompt = buildMediaPromptForReply({
                kind: isVideo ? "video" : "audio",
                caption,
                fileUrl: fileUrl.toString(),
                transcript,
                fileName: String(doc?.file_name || "").trim(),
                mimeType: String(doc?.mime_type || "").trim(),
            });
            await generateReply(ctx, prompt);
        }
        catch (error) {
            logger.error({ error: error instanceof Error ? error.stack : String(error) }, "Failed to handle document message");
            await ctx.reply("I could not process this document right now.");
        }
    });
    bot.catch((error) => {
        logger.error({ error: error instanceof Error ? error.stack : String(error) }, "Telegraf global error");
    });
    return bot;
};
