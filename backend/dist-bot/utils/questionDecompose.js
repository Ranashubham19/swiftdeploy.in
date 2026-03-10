const cleanPart = (value) => String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[\-*•\d.)\s]+/, "")
    .trim();
const dedupeParts = (parts) => {
    const out = [];
    const seen = new Set();
    for (const raw of parts) {
        const part = cleanPart(raw);
        if (!part || part.length < 3)
            continue;
        const key = part.toLowerCase();
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(part);
    }
    return out;
};
export const decomposeQuestionParts = (input, maxParts = 6) => {
    const original = String(input || "").trim();
    if (!original) {
        return { original: "", parts: [], isMultiPart: false };
    }
    const lines = original
        .split(/\r?\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
    const numberedLineParts = lines
        .filter((line) => /^(\d+[\).]|[-*•])\s+/.test(line))
        .map((line) => line.replace(/^(\d+[\).]|[-*•])\s+/, "").trim());
    if (numberedLineParts.length >= 2) {
        const parts = dedupeParts(numberedLineParts).slice(0, maxParts);
        return { original, parts, isMultiPart: parts.length >= 2 };
    }
    const qSegments = original
        .split(/(?<=\?)/)
        .map((part) => part.trim())
        .filter(Boolean);
    if (qSegments.length >= 2) {
        const parts = dedupeParts(qSegments).slice(0, maxParts);
        return { original, parts, isMultiPart: parts.length >= 2 };
    }
    let parts = [];
    if (/\b(and also|also|as well as|plus|then)\b/i.test(original) && original.length > 60) {
        parts = original
            .split(/\b(?:and also|as well as|plus|then)\b/gi)
            .map((part) => cleanPart(part))
            .filter(Boolean);
    }
    if (parts.length < 2 && /[,;]\s*/.test(original) && /\b(explain|compare|tell|give|list|show|write|make|analy[sz]e)\b/i.test(original)) {
        parts = original
            .split(/[;]+/)
            .map((part) => cleanPart(part))
            .filter(Boolean);
    }
    const finalParts = dedupeParts(parts).slice(0, maxParts);
    return { original, parts: finalParts, isMultiPart: finalParts.length >= 2 };
};
export const buildQuestionBreakdownInstruction = (input) => {
    const decomposed = decomposeQuestionParts(input);
    if (!decomposed.isMultiPart)
        return "";
    const body = decomposed.parts.map((part, index) => `${index + 1}. ${part}`).join("\n");
    return [
        "Question breakdown (answer every part explicitly in order):",
        body,
        "Do not skip any part. If parts depend on each other, state assumptions briefly and continue.",
    ].join("\n");
};
