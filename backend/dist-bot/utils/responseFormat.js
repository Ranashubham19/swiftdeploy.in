const markdownCodeFencePattern = /```([a-zA-Z0-9_#+.-]*)\n?([\s\S]*?)```/g;
const markerCodeBlockPattern = /CODE_BEGIN\b([\s\S]*?)\bCODE_END/g;
const headingPattern = /^\s*#{1,6}\s+/gm;
const hrPattern = /^\s*[-_*]{3,}\s*$/gm;
const boldPattern = /\*\*(.*?)\*\*/g;
const italicPattern = /\*(.*?)\*/g;
const inlineCodePattern = /`([^`]+)`/g;
const tableDividerPattern = /^\s*\|?\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$/;
const tableRowPattern = /^\s*\|.*\|\s*$/;
const listItemPattern = /^\s*(?:[-*\u2022]+|\d+[.)]|[a-zA-Z][.)])\s+(.*)$/;
const numberedPattern = /^\d+\.\s+/;
const shortHeadingPattern = /^[A-Za-z][A-Za-z0-9 ,()/-]{2,80}:$/;
const codePlaceholderPattern = /^__CODE_BLOCK_\d+__$/;
const codeBeginTokenPattern = /\s*CODE_BEGIN\s*/gi;
const codeEndTokenPattern = /\s*CODE_END\s*/gi;
const inlineCodeLabelPattern = /Code Example(?:\s*\(([^)]+)\))?\s*:/i;
const codeStartSignalPattern = /\b(def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(|class\s+[A-Za-z_][A-Za-z0-9_]*|function\s+[A-Za-z_][A-Za-z0-9_]*\s*\(|const\s+[A-Za-z_][A-Za-z0-9_]*\s*=|let\s+[A-Za-z_][A-Za-z0-9_]*\s*=|var\s+[A-Za-z_][A-Za-z0-9_]*\s*=|#include\b|public class\b|using\s+namespace\b|using\s+std::|fn\s+[A-Za-z_][A-Za-z0-9_]*\s*\(|SELECT\b|INSERT\b|UPDATE\b|DELETE\b|CREATE TABLE\b|if\s*\([^)]*\)|for\s*\([^)]*;[^)]*;[^)]*\)|while\s*\([^)]*\)|switch\s*\([^)]*\)|<!DOCTYPE html|<html)/i;
const codeNarrativeTailPattern = /\s+(?:This approach|The algorithm works|Time complexity|Space complexity|Complexity|Explanation|In summary|You can|This solution)\b[\s\S]*$/i;
const latexInlineMathPattern = /\$([^$\n]{1,220})\$/g;
const latexFractionPattern = /\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/gi;
const escapedParenPattern = /\\([()])/g;
const sentenceBoundaryPattern = /(?<=[.!?])\s+/;
const blockCommentPattern = /\/\*[\s\S]*?\*\//g;
const slashCommentPattern = /(^|[^:])\/\/.*$/gm;
const compressedPythonCommentPattern = /#.*?(?=(?:\bdef\s+[A-Za-z_][A-Za-z0-9_]*\s*\(|\bclass\s+[A-Za-z_][A-Za-z0-9_]*|\breturn\b|\bif\s+[^:\n]{1,120}:|\bfor\s+[^:\n]{1,120}:|\bwhile\s+[^:\n]{1,120}:|\btry:|\bwith\s+[^:\n]{1,120}:|[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+\])*\s*=(?!=)|$))/gi;
const pythonDedentKeywordPattern = /^(elif\b|else:|except\b|finally:)/;
const pythonBlockStartPattern = /:\s*(?:#.*)?$/;
const pythonTerminalPattern = /^(return\b|break\b|continue\b|pass\b|raise\b)/;
const normalizeCodeFenceLanguage = (language) => String(language || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_#+.-]/g, "");
const normalizeAscii = (input) => input
    .normalize("NFKD")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .replace(/\r\n/g, "\n");
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
const insertLineBreaksAfterStatementSemicolons = (input) => {
    const source = String(input || "");
    if (!source.includes(";"))
        return source;
    let out = "";
    let parenDepth = 0;
    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;
    let escapeNext = false;
    for (let i = 0; i < source.length; i += 1) {
        const ch = source[i];
        out += ch;
        if (escapeNext) {
            escapeNext = false;
            continue;
        }
        if (ch === "\\") {
            if (inSingle || inDouble || inBacktick) {
                escapeNext = true;
            }
            continue;
        }
        if (!inDouble && !inBacktick && ch === "'") {
            inSingle = !inSingle;
            continue;
        }
        if (!inSingle && !inBacktick && ch === "\"") {
            inDouble = !inDouble;
            continue;
        }
        if (!inSingle && !inDouble && ch === "`") {
            inBacktick = !inBacktick;
            continue;
        }
        if (inSingle || inDouble || inBacktick) {
            continue;
        }
        if (ch === "(") {
            parenDepth += 1;
            continue;
        }
        if (ch === ")") {
            parenDepth = Math.max(0, parenDepth - 1);
            continue;
        }
        if (ch === ";" && parenDepth === 0) {
            let j = i + 1;
            while (j < source.length && (source[j] === " " || source[j] === "\t")) {
                j += 1;
            }
            const afterToken = source.slice(j).match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1]?.toLowerCase() || "";
            const shouldStayInline = afterToken === "else" || afterToken === "while" || afterToken === "catch" || afterToken === "finally";
            if (j < source.length && source[j] !== "\n" && !shouldStayInline) {
                out += "\n";
            }
            i = j - 1;
        }
    }
    return out.replace(/[ \t]+\n/g, "\n");
};
const computeParenDelta = (input) => {
    const source = String(input || "");
    let delta = 0;
    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;
    let escapeNext = false;
    for (let i = 0; i < source.length; i += 1) {
        const ch = source[i];
        if (escapeNext) {
            escapeNext = false;
            continue;
        }
        if (ch === "\\") {
            if (inSingle || inDouble || inBacktick) {
                escapeNext = true;
            }
            continue;
        }
        if (!inDouble && !inBacktick && ch === "'") {
            inSingle = !inSingle;
            continue;
        }
        if (!inSingle && !inBacktick && ch === "\"") {
            inDouble = !inDouble;
            continue;
        }
        if (!inSingle && !inDouble && ch === "`") {
            inBacktick = !inBacktick;
            continue;
        }
        if (inSingle || inDouble || inBacktick) {
            continue;
        }
        if (ch === "(") {
            delta += 1;
            continue;
        }
        if (ch === ")") {
            delta -= 1;
        }
    }
    return delta;
};
const normalizeCollapsedControlHeader = (input) => String(input || "")
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s*;\s*/g, "; ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*\{\s*$/, " {")
    .trim();
const collapseMultilineControlHeaders = (input) => {
    const lines = String(input || "").split("\n");
    const output = [];
    const controlHeaderPattern = /^(?:for|if|while|switch|catch)\s*\(|^\}\s*while\s*\(/;
    for (let i = 0; i < lines.length; i += 1) {
        const rawLine = String(lines[i] || "");
        const trimmed = rawLine.trim();
        if (!trimmed || !controlHeaderPattern.test(trimmed) || computeParenDelta(trimmed) <= 0) {
            output.push(rawLine);
            continue;
        }
        const indent = (rawLine.match(/^\s*/) || [""])[0];
        let merged = trimmed;
        let balance = computeParenDelta(trimmed);
        let j = i + 1;
        while (j < lines.length && balance > 0) {
            const candidate = String(lines[j] || "").trim();
            if (candidate) {
                merged = `${merged} ${candidate}`.trim();
                balance += computeParenDelta(candidate);
            }
            j += 1;
        }
        if (balance <= 0 && j > i + 1) {
            output.push(`${indent}${normalizeCollapsedControlHeader(merged)}`);
            i = j - 1;
            continue;
        }
        output.push(rawLine);
    }
    return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};
const collapseWrappedOperatorLines = (input) => {
    const lines = String(input || "").split("\n");
    const output = [];
    const startsWithOperatorPattern = /^(?:\+|-|\*|\/|%|&&|\|\||==|!=|<=|>=|<|>|=|\?|,)/;
    const endsWithOperatorPattern = /(?:\+|-|\*|\/|%|&&|\|\||==|!=|<=|>=|<|>|=|\?|,)\s*$/;
    for (const rawLine of lines) {
        const line = String(rawLine || "");
        const trimmed = line.trim();
        if (!trimmed) {
            if (output.length > 0 && output[output.length - 1] !== "") {
                output.push("");
            }
            continue;
        }
        if (output.length === 0) {
            output.push(line);
            continue;
        }
        const prev = String(output[output.length - 1] || "");
        const prevTrimmed = prev.trim();
        const shouldMerge = (endsWithOperatorPattern.test(prevTrimmed) && !/[;{}]$/.test(prevTrimmed))
            || startsWithOperatorPattern.test(trimmed);
        if (shouldMerge) {
            output[output.length - 1] = `${prevTrimmed} ${trimmed}`.replace(/\s{2,}/g, " ").trim();
            continue;
        }
        output.push(line);
    }
    while (output.length > 0 && output[output.length - 1] === "") {
        output.pop();
    }
    return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};
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
    const withStatementBreaks = insertLineBreaksAfterStatementSemicolons(protectedValueBlocks.text);
    const formatted = withStatementBreaks
        .replace(blockCommentPattern, " ")
        .replace(slashCommentPattern, "$1")
        .replace(/(?<!\{)\{\s*/g, "{\n")
        .replace(/\s*(?<!\})\}(?!\})\s*/g, "\n}\n")
        .replace(/\s*\n\s*&&\s*/g, " && ")
        .replace(/\s*&&\s*\n\s*/g, " && ")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    const restored = restoreDoubleBraceValueBlocks(formatted, protectedValueBlocks.blocks);
    const spaced = normalizeCodeTokenSpacing(restored);
    const compactHeaders = collapseMultilineControlHeaders(spaced);
    const compactOperators = collapseWrappedOperatorLines(compactHeaders);
    const language = normalizeCodeFenceLanguage(languageHint);
    const looksPython = language === "python" ||
        (/\b(def |class |import |from |if |elif |else:|for |while |try:|except |with |return )/.test(compactOperators)
            && !/[{};]/.test(compactOperators));
    if (looksPython) {
        return indentPythonCodeByBlocks(compactOperators);
    }
    return indentCodeByBraces(compactOperators);
})();
const reflowCompressedCode = (value, languageHint) => {
    const code = String(value || "")
        .replace(blockCommentPattern, " ")
        .replace(slashCommentPattern, "$1")
        .trim();
    if (!code) {
        return code;
    }
    const hasCompressedSignal = !code.includes("\n")
        || /:\s+(?=[A-Za-z_][A-Za-z0-9_,\s\[\]]*\s*=|if |for |while |return |print\()/i.test(code)
        || /;\s+\S/.test(code);
    if (!hasCompressedSignal || code.length < 60) {
        return code;
    }
    const language = (languageHint || "").toLowerCase();
    const looksPython = language.includes("python") ||
        /\b(def |class |import |from |if |elif |else:|for |while |try:|except |with |return )/.test(code);
    if (looksPython) {
        const pythonFormatted = code
            .replace(compressedPythonCommentPattern, " ")
            .replace(/;\s*/g, ";\n")
            .replace(/\s+(?=def |class |import |from |if |elif |else:|for |while |try:|except |with |return |pass|break|continue)/g, "\n")
            .replace(/\b(return\s+[^\n]+?)\s+(?=[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+\])*\s*=)/g, "$1\n")
            .replace(/([)\]])\s+(?=[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+\])*\s*=)/g, "$1\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
        return enforceStrictCodeLineLayout(pythonFormatted, "python");
    }
    const genericFormatted = insertLineBreaksAfterStatementSemicolons(code)
        .replace(/\{\s*/g, "{\n")
        .replace(/\s*\}/g, "\n}\n")
        .replace(/\s+(?=function |const |let |var |if |else |for |while |return |class |import |from |public |private |protected |async )/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    return enforceStrictCodeLineLayout(genericFormatted, languageHint);
};
const cleanCode = (value, languageHint = "") => {
    const normalized = String(value || "")
        .replace(/\r\n/g, "\n")
        .replace(/\t/g, "  ")
        .split("\n")
        .map((line) => line.replace(/\s+$/g, ""))
        .join("\n")
        .trim();
    const reflowed = reflowCompressedCode(normalized, languageHint);
    return enforceStrictCodeLineLayout(reflowed, languageHint);
};
const stripCodeNarrativeTail = (value) => String(value || "").replace(codeNarrativeTailPattern, "").trim();
const looksCodeDense = (value) => {
    const text = String(value || "").trim();
    if (!text)
        return false;
    const keywordHits = (text.match(/\b(def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(|class\s+[A-Za-z_][A-Za-z0-9_]*|function\s+[A-Za-z_][A-Za-z0-9_]*\s*\(|const\s+[A-Za-z_][A-Za-z0-9_]*\s*=|let\s+[A-Za-z_][A-Za-z0-9_]*\s*=|var\s+[A-Za-z_][A-Za-z0-9_]*\s*=|import |from |return\b[^\n;]*;|if\s*\([^)]*\)|elif\b[^\n]*:|else:|for\s*\([^)]*;[^)]*;[^)]*\)|while\s*\([^)]*\)|try:|except\b[^\n]*:|with\b[^\n]*:|#include|public |private |protected |SELECT |INSERT |UPDATE |DELETE )/gi) || []).length;
    const symbolHits = (text.match(/[{}()[\];=]/g) || []).length;
    return (keywordHits >= 2
        || (keywordHits >= 1 && symbolHits >= 2)
        || /=>|;\s*\S/.test(text));
};
const tryExtractInlineCodeBlock = (text, index) => {
    const match = String(text || "").match(/([\s\S]*?)Code Example(?:\s*\(([^)]+)\))?\s*:\s*([\s\S]+)/i);
    if (!match?.[3]) {
        return { text, block: null };
    }
    const intro = String(match[1] || "").trim();
    const language = String(match[2] || "").trim().toLowerCase();
    const remainder = String(match[3] || "").trim();
    const codeStart = remainder.search(codeStartSignalPattern);
    const rawCode = stripCodeNarrativeTail(codeStart >= 0 ? remainder.slice(codeStart) : remainder);
    const cleaned = cleanCode(rawCode, language);
    if (!cleaned || !looksCodeDense(cleaned)) {
        return { text, block: null };
    }
    const placeholder = `__CODE_BLOCK_${index}__`;
    const nextText = `${intro ? `${intro}\n\n` : ""}${placeholder}`;
    return {
        text: nextText,
        block: {
            placeholder,
            language,
            code: cleaned,
        },
    };
};
const tryExtractInlineCodeBlob = (text, index) => {
    const match = String(text || "").match(/([\s\S]*?)(\b(?:def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(|class\s+[A-Za-z_][A-Za-z0-9_]*|function\s+[A-Za-z_][A-Za-z0-9_]*\s*\(|const\s+[A-Za-z_][A-Za-z0-9_]*\s*=|let\s+[A-Za-z_][A-Za-z0-9_]*\s*=|var\s+[A-Za-z_][A-Za-z0-9_]*\s*=|#include|public class|using\s+namespace|using\s+std::|fn\s+[A-Za-z_][A-Za-z0-9_]*\s*\(|SELECT |INSERT |UPDATE |DELETE |CREATE TABLE )[\s\S]*)/i);
    if (!match?.[2]) {
        return { text, block: null };
    }
    const intro = String(match[1] || "").trim();
    const rawCode = stripCodeNarrativeTail(match[2]);
    const cleaned = cleanCode(rawCode);
    if (!cleaned || !looksCodeDense(cleaned)) {
        return { text, block: null };
    }
    const placeholder = `__CODE_BLOCK_${index}__`;
    const nextText = `${intro ? `${intro}\n\n` : ""}${placeholder}`;
    return {
        text: nextText,
        block: {
            placeholder,
            language: "",
            code: cleaned,
        },
    };
};
const normalizeMathExpressionOperators = (input) => String(input || "")
    .replace(/\b(?:is\s+equal\s+to|equal\s+to|equals)\b/gi, " = ")
    .replace(/(\d(?:[\d.,]*))\s+(plus)\s+(\d(?:[\d.,]*))/gi, "$1 + $3")
    .replace(/(\d(?:[\d.,]*))\s+(minus)\s+(\d(?:[\d.,]*))/gi, "$1 - $3")
    .replace(/(\d(?:[\d.,]*))\s+(multiplied by|times)\s+(\d(?:[\d.,]*))/gi, "$1 * $3")
    .replace(/(\d(?:[\d.,]*))\s+(divided by|over)\s+(\d(?:[\d.,]*))/gi, "$1 / $3")
    .replace(/(\d(?:[\d.,]*))\s+(modulo|mod)\s+(\d(?:[\d.,]*))/gi, "$1 % $3")
    .replace(/(\d(?:[\d.,]*))\s+(to the power of|raised to|power of)\s+(\d(?:[\d.,]*))/gi, "$1 ^ $3")
    .replace(/\b([a-z])\s+(plus|minus|times|multiplied by|divided by|over|modulo|mod|to the power of|raised to|power of)\s+([a-z])\b/gi, (_match, left, opWord, right) => {
    const operator = /plus/i.test(opWord) ? "+"
        : /minus/i.test(opWord) ? "-"
            : /(times|multiplied by)/i.test(opWord) ? "*"
                : /(divided by|over)/i.test(opWord) ? "/"
                    : /(modulo|mod)/i.test(opWord) ? "%"
                        : "^";
    return `${left} ${operator} ${right}`;
})
    .replace(/(\d(?:[\d.,]*))\s*([+\-*/%^])\s*(\d(?:[\d.,]*))/g, "$1 $2 $3")
    .replace(/[ \t]{2,}/g, " ");
const ensureBlankLineBetweenNumberedPoints = (lines) => {
    const out = [];
    for (let i = 0; i < lines.length; i += 1) {
        const line = String(lines[i] || "").trim();
        if (!line) {
            if (out.length > 0 && out[out.length - 1] !== "") {
                out.push("");
            }
            continue;
        }
        out.push(line);
        if (!numberedPattern.test(line)) {
            continue;
        }
        let nextIndex = i + 1;
        while (nextIndex < lines.length && !String(lines[nextIndex] || "").trim()) {
            nextIndex += 1;
        }
        if (nextIndex < lines.length
            && numberedPattern.test(String(lines[nextIndex] || "").trim())
            && out[out.length - 1] !== "") {
            out.push("");
        }
    }
    while (out.length > 0 && out[out.length - 1] === "") {
        out.pop();
    }
    return out;
};
const stripSpecialCharsFromPlainText = (line) => String(line || "")
    .replace(/[^A-Za-z0-9 \t.,:;!?'"(){}\[\]<>+\-*/%=_^&|]/g, " ")
    .replace(/([,:;!?])([A-Za-z0-9])/g, "$1 $2")
    .replace(/([A-Za-z])([([{])([A-Za-z])/g, "$1 $2 $3")
    .replace(/([A-Za-z])([)}\]])([A-Za-z])/g, "$1 $2 $3")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trimEnd();
const normalizeTableRowSpacing = (line) => {
    const trimmed = String(line || "").trim();
    if (!tableRowPattern.test(trimmed) || tableDividerPattern.test(trimmed)) {
        return trimmed;
    }
    const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
    const cells = inner
        .split("|")
        .map((cell) => cell.trim().replace(/[ \t]{2,}/g, " "));
    return `| ${cells.join(" | ")} |`;
};
const polishPlainTextPunctuationLine = (line) => {
    const trimmed = String(line || "").trim();
    if (!trimmed)
        return "";
    if (codePlaceholderPattern.test(trimmed))
        return trimmed;
    if (tableDividerPattern.test(trimmed))
        return trimmed;
    if (tableRowPattern.test(trimmed))
        return normalizeTableRowSpacing(trimmed);
    const isListLine = /^\s*(?:\d+\.\s+|[-*]\s+)/.test(trimmed);
    const isHeadingLine = shortHeadingPattern.test(trimmed);
    let out = trimmed
        .replace(/\s+([,.;:!?])/g, "$1")
        .replace(/([,.;:!?])([A-Za-z0-9\"'])/g, "$1 $2")
        .replace(/([([{])\s+/g, "$1")
        .replace(/\s+([)\]}])/g, "$1")
        .replace(/[ \t]{2,}/g, " ")
        .trimEnd();
    out = out
        .replace(/\b([A-Za-z])\.\s([A-Za-z])\.\s([A-Za-z])\.(?=\s|$)/g, "$1.$2.$3.")
        .replace(/\b([A-Za-z])\.\s([A-Za-z])\.(?=\s|$)/g, "$1.$2.");
    const shouldAddPeriod = !isListLine
        && !isHeadingLine
        && out.length >= 56
        && !/[.!?;:]$/.test(out)
        && /[A-Za-z0-9")]$/.test(out)
        && !/\b(?:USD|EUR|INR|GBP|JPY|AED|QAR|SAR|CHF|SGD|CAD|AUD|CNY)\s+\d[\d,]*(?:\.\d+)?\s*(?:trillion|billion|million|thousand|crore|lakh|%|percent)?$/i.test(out);
    if (shouldAddPeriod) {
        out = `${out}.`;
    }
    return out;
};
const extractCodeBlocks = (input) => {
    const blocks = [];
    let text = input
        .replace(codeBeginTokenPattern, "\nCODE_BEGIN\n")
        .replace(codeEndTokenPattern, "\nCODE_END\n")
        .replace(/\n{3,}/g, "\n\n");
    let index = 0;
    text = text.replace(markdownCodeFencePattern, (_match, language, code) => {
        const cleaned = cleanCode(code, language);
        if (!cleaned) {
            return "";
        }
        const placeholder = `__CODE_BLOCK_${index}__`;
        blocks.push({
            placeholder,
            language: (language || "").trim().toLowerCase(),
            code: cleaned,
        });
        index += 1;
        return `\n${placeholder}\n`;
    });
    text = text.replace(markerCodeBlockPattern, (_match, code) => {
        const cleaned = cleanCode(code);
        if (!cleaned) {
            return "";
        }
        const placeholder = `__CODE_BLOCK_${index}__`;
        blocks.push({
            placeholder,
            language: "",
            code: cleaned,
        });
        index += 1;
        return `\n${placeholder}\n`;
    });
    if (inlineCodeLabelPattern.test(text)) {
        let guard = 0;
        while (guard < 3) {
            guard += 1;
            const extracted = tryExtractInlineCodeBlock(text, index);
            if (!extracted.block)
                break;
            blocks.push(extracted.block);
            text = extracted.text;
            index += 1;
        }
    }
    if (blocks.length === 0 && codeStartSignalPattern.test(text)) {
        const extracted = tryExtractInlineCodeBlob(text, index);
        if (extracted.block) {
            blocks.push(extracted.block);
            text = extracted.text;
            index += 1;
        }
    }
    return { text, blocks };
};
const restoreCodeBlocks = (text, blocks) => {
    let output = text;
    for (const block of blocks) {
        const escapedPlaceholder = block.placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const language = normalizeCodeFenceLanguage(block.language);
        if (language) {
            const escapedLanguage = language.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            output = output.replace(new RegExp(`(^|\\n)\\s*${escapedLanguage}\\s*\\n\\s*${escapedPlaceholder}`, "gi"), `$1${block.placeholder}`);
        }
        let plainCode = String(block.code || "").trim();
        plainCode = plainCode
            .replace(/^\s*```[a-zA-Z0-9_#+.-]*\s*/i, "")
            .replace(/\s*```\s*$/i, "")
            .replace(/\n\s*`{1,3}\s*$/g, "")
            .trim();
        if (language) {
            const escapedLanguage = language.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            plainCode = plainCode.replace(new RegExp(`^${escapedLanguage}\\s*\\n`, "i"), "").trim();
        }
        const plainCodeSection = language
            ? `Code Example (${language}):\n\`\`\`${language}\n${plainCode}\n\`\`\``
            : `Code Example:\n\`\`\`\n${plainCode}\n\`\`\``;
        output = output.replace(new RegExp(escapedPlaceholder, "g"), plainCodeSection);
    }
    return output;
};
const removeMarkdownArtifacts = (input) => {
    let output = input;
    output = output.replace(headingPattern, "");
    output = output.replace(hrPattern, "");
    output = output.replace(boldPattern, "$1");
    output = output.replace(italicPattern, "$1");
    output = output.replace(inlineCodePattern, "$1");
    output = output.replace(latexInlineMathPattern, "$1");
    output = output.replace(latexFractionPattern, "($1)/($2)");
    output = output.replace(/\\times/gi, " x ");
    output = output.replace(/\\cdot/gi, " * ");
    output = output.replace(/\\div/gi, " / ");
    output = output.replace(/\\leq/gi, " <= ");
    output = output.replace(/\\geq/gi, " >= ");
    output = output.replace(/\\neq/gi, " != ");
    output = output.replace(/\\approx/gi, " approx ");
    output = output.replace(/\\pm/gi, " +/- ");
    output = output.replace(escapedParenPattern, "$1");
    output = output.replace(/\\[,;:]/g, " ");
    output = output.replace(/\\!/g, "");
    output = output.replace(/\\[a-zA-Z]+/g, "");
    output = output.replace(/\$+/g, "");
    return output;
};
const rawRetrievalArtifactPattern = /\bdirect answer topic\b|\bprovide one specific output format\b|\bfinal polished answer\b|\bwikifunctions has a function related to this topic\b|\bwikidata\b|\bwikiquote\b|\bwikimedia commons\b|\bwiktionary\b|^\s*source\s*:\s*https?:\/\/\S+|\bhttps?:\/\/(?:[a-z]+\.)?wikipedia\.org\/[^\s<>"'`]+|\/\s*[a-z](?:[\s.]*[a-z]){3,20}\s*\//im;
const stripRawRetrievalArtifactsFromPlainText = (input) => {
    const value = String(input || "").replace(/\r/g, "");
    if (!value)
        return value;
    const parts = value.split(/(```[\s\S]*?```)/g).filter(Boolean);
    const sanitizePlain = (segment) => {
        let out = String(segment || "");
        out = out
            .replace(/^\s*Best-effort answer from fallback sources.*$/gim, "")
            .replace(/^\s*Best-effort comparison context from fallback sources.*$/gim, "")
            .replace(/^\s*Direct answer topic:.*$/gim, "")
            .replace(/^\s*Provide one specific output format.*$/gim, "")
            .replace(/\bDirect answer topic\b.*$/gim, "")
            .replace(/\bProvide one specific output format\b[\s\S]*?\bfinal polished answer\.?/gim, "")
            .replace(/^\s*Wikifunctions has a function related to this topic\.?\s*$/gim, "")
            .replace(/^\s*(?:Wiktionary|Wikidata|Wikiquote|Wikimedia Commons)\b.*$/gim, "")
            .replace(/^\s*Source:\s*https?:\/\/[^\s]+.*$/gim, "")
            .replace(/^\s*Source:\s*.*$/gim, "")
            .replace(/\bprovide one specific output format\b/gi, "")
            .replace(/\bfinal polished answer\b/gi, "")
            .replace(/\bWikifunctions has a function related to this topic\.?/gi, "")
            .replace(/\b(?:Wiktionary|Wikidata|Wikiquote|Wikimedia Commons)\b/gi, "")
            .replace(/\(\s*https?:\/\/[^\)]{1,220}\)/gi, "")
            .replace(/\bhttps?:\/\/en\.wikipedia\.org\/\?curid=\d+\b/gi, "")
            .replace(/\bhttps?:\/\/(?:[a-z]+\.)?wikipedia\.org\/[^\s<>"'`]+/gi, "")
            .replace(/\/pl\.\s*n\.\s*drom\//gi, "")
            .replace(/\/\s*[a-z](?:[\s.]*[a-z]){3,20}\s*\//gi, "")
            .replace(/\bsource\s*https?:\/\/[^\s<>"'`]+/gi, "")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
        return out;
    };
    return parts
        .map((part) => (part.startsWith("```") ? part.trim() : sanitizePlain(part)))
        .filter(Boolean)
        .join("\n\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
};
const renumberLists = (lines) => {
    const out = [];
    let listIndex = 0;
    let inList = false;
    let blankStreak = 0;
    let inTable = false;
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            out.push("");
            blankStreak += 1;
            continue;
        }
        blankStreak = 0;
        if (tableDividerPattern.test(line)) {
            out.push(line);
            inList = false;
            listIndex = 0;
            inTable = true;
            continue;
        }
        if (tableRowPattern.test(line)) {
            out.push(line);
            inList = false;
            listIndex = 0;
            inTable = true;
            continue;
        }
        if (inTable && !tableRowPattern.test(line) && !tableDividerPattern.test(line)) {
            inTable = false;
        }
        const itemMatch = line.match(listItemPattern);
        if (itemMatch) {
            const content = itemMatch[1].trim();
            if (!inList) {
                listIndex = 1;
            }
            else {
                listIndex += 1;
            }
            out.push(`${listIndex}. ${content}`);
            inList = true;
            continue;
        }
        // Preserve wrapped list-item continuations (common in long Telegram replies):
        // 1. Item title -
        //    continuation line...
        if (inList && blankStreak === 0 && out.length > 0 && numberedPattern.test(out[out.length - 1])) {
            out[out.length - 1] = `${out[out.length - 1].trimEnd()} ${line}`
                .replace(/[ \t]{2,}/g, " ")
                .trimEnd();
            continue;
        }
        inList = false;
        listIndex = 0;
        out.push(line);
    }
    return out;
};
const addParagraphSpacing = (lines) => {
    const out = [];
    const lastNonBlank = () => [...out].reverse().find((line) => line.trim().length > 0) || "";
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            if (out.length > 0 && out[out.length - 1] !== "") {
                out.push("");
            }
            continue;
        }
        const previous = lastNonBlank();
        const isNumbered = numberedPattern.test(line);
        const wasNumbered = numberedPattern.test(previous);
        const isHeading = shortHeadingPattern.test(line);
        const wasHeading = shortHeadingPattern.test(previous);
        const isTableLine = tableRowPattern.test(line) || tableDividerPattern.test(line);
        const wasTableLine = tableRowPattern.test(previous) || tableDividerPattern.test(previous);
        if (out.length > 0 && out[out.length - 1] !== "") {
            if (isTableLine && wasTableLine) {
                // Preserve compact table rows.
            }
            else if (isNumbered && wasNumbered) {
                out.push("");
            }
            else if (isHeading ||
                (isNumbered && !wasNumbered) ||
                (!isNumbered && wasNumbered && !isHeading)) {
                out.push("");
            }
            else if (!isNumbered &&
                !wasNumbered &&
                !isTableLine &&
                !wasTableLine &&
                !isHeading &&
                !wasHeading &&
                !codePlaceholderPattern.test(line)) {
                const previousEndsSentence = /[.!?]$/.test(previous);
                if (previousEndsSentence && line.length > 20) {
                    out.push("");
                }
            }
        }
        out.push(line);
    }
    return out;
};
const splitDenseParagraphLines = (lines) => {
    const out = [];
    for (const rawLine of lines) {
        const line = String(rawLine || "").trim();
        if (!line) {
            out.push("");
            continue;
        }
        if (codePlaceholderPattern.test(line)
            || numberedPattern.test(line)
            || shortHeadingPattern.test(line)
            || tableRowPattern.test(line)
            || tableDividerPattern.test(line)) {
            out.push(line);
            continue;
        }
        if (line.length < 180) {
            out.push(line);
            continue;
        }
        const sentences = line
            .split(sentenceBoundaryPattern)
            .map((x) => x.trim())
            .filter(Boolean);
        if (sentences.length < 3) {
            out.push(line);
            continue;
        }
        for (let i = 0; i < sentences.length; i += 1) {
            out.push(sentences[i]);
            if (i < sentences.length - 1) {
                out.push("");
            }
        }
    }
    return out;
};
const splitDenseMathSolutionLines = (lines) => {
    const out = [];
    const isProtectedLine = (line) => !line
        || codePlaceholderPattern.test(line)
        || numberedPattern.test(line)
        || shortHeadingPattern.test(line)
        || tableRowPattern.test(line)
        || tableDividerPattern.test(line);
    const looksMathDense = (line) => {
        const value = String(line || "").trim();
        if (!value)
            return false;
        const eqCount = (value.match(/=/g) || []).length;
        const operatorHits = (value.match(/\s[+\-*/%^x]\s/g) || []).length;
        const digitHits = (value.match(/\d/g) || []).length;
        const stepWordHits = (value.match(/\b(step|equation|calculation|therefore|hence|result|final answer|then|next)\b/gi) || []).length;
        return ((eqCount >= 1 && digitHits >= 3 && (operatorHits >= 1 || stepWordHits >= 1))
            || eqCount >= 2
            || /\bcalculation:\s*.+\s=\s.+/i.test(value));
    };
    for (const rawLine of lines) {
        const trimmed = String(rawLine || "").trim();
        if (isProtectedLine(trimmed) || !looksMathDense(trimmed)) {
            out.push(trimmed);
            continue;
        }
        const expanded = trimmed
            .replace(/;\s+(?=\S)/g, ";\n")
            .replace(/:\s+(?=(?:Step\s*\d+|Calculation|Equation|Result|Final answer)\b)/gi, ":\n")
            .replace(/,\s+(?=(?:Step\s*\d+|Calculation|Equation|Result|Final answer|Therefore|Hence|So|Then|Next)\b)/gi, "\n")
            .replace(/,\s+(?=(?:[A-Za-z][A-Za-z0-9_]*\s*=\s*|[-(]?\d[\d.,()]*\s*[+\-*/%^x=]))/g, "\n")
            .replace(/\s+(?=(?:Therefore|Hence|So|Then|Next|Result)\b)/gi, "\n")
            .replace(/(?<=\d)\s+(?=\d+\s*[x*+\-/^%=])/g, "\n")
            .replace(/(=\s*[-]?\d+(?:\.\d+)?)(\s+)(?=(?:[A-Za-z][A-Za-z ]{1,20}:|Step\s*\d+))/g, "$1\n");
        const parts = expanded
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean);
        if (parts.length <= 1) {
            out.push(trimmed);
            continue;
        }
        out.push(...parts);
    }
    return out;
};
const convertLeadingNumberedBulletsToDashLines = (lines) => lines.map((rawLine) => {
    if (!rawLine)
        return rawLine;
    if (codePlaceholderPattern.test(rawLine.trim()))
        return rawLine;
    return rawLine.replace(/^(\s*)(?:[1-9]|[1-9]\d)[.)]\s+/, "$1- ");
});
const enforceDashListStyleOutsideCode = (text) => {
    const value = String(text || "").replace(/\r/g, "").trim();
    if (!value)
        return value;
    const parts = value.split(/(```[\s\S]*?```|CODE_BEGIN[\s\S]*?CODE_END)/g).filter(Boolean);
    const normalizePlain = (segment) => convertLeadingNumberedBulletsToDashLines(String(segment || "").split("\n")).join("\n");
    return parts
        .map((part) => (/^(?:```|CODE_BEGIN)/.test(part) ? part.trim() : normalizePlain(part)))
        .filter(Boolean)
        .join("\n\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
};
export const formatProfessionalReply = (input) => {
    const ascii = normalizeAscii(input || "");
    const rawArtifactLikeInput = rawRetrievalArtifactPattern.test(ascii);
    const extracted = extractCodeBlocks(ascii);
    const artifactStripped = stripRawRetrievalArtifactsFromPlainText(extracted.text);
    const stripped = removeMarkdownArtifacts(artifactStripped);
    const operatorNormalized = normalizeMathExpressionOperators(stripped);
    const lines = operatorNormalized.split("\n");
    const normalizedLines = ensureBlankLineBetweenNumberedPoints(splitDenseMathSolutionLines(splitDenseParagraphLines(addParagraphSpacing(renumberLists(lines)))))
        .map((line) => {
        if (codePlaceholderPattern.test(line.trim())) {
            return line.trim();
        }
        return polishPlainTextPunctuationLine(stripSpecialCharsFromPlainText(normalizeMathExpressionOperators(line)));
    })
        .filter((line, index, arr) => {
        if (line !== "")
            return true;
        return index === 0 || arr[index - 1] !== "";
    });
    const baseOutput = normalizedLines.join("\n").trim();
    const restored = restoreCodeBlocks(baseOutput, extracted.blocks);
    const output = enforceDashListStyleOutsideCode(restored.replace(/\n{4,}/g, "\n\n\n").trim());
    if (output) {
        return ensureProfessionalParagraphSpacing(output);
    }
    const plainFallback = stripSpecialCharsFromPlainText(normalizeMathExpressionOperators(removeMarkdownArtifacts(stripRawRetrievalArtifactsFromPlainText(ascii)))).trim();
    if (plainFallback) {
        return ensureProfessionalParagraphSpacing(enforceDashListStyleOutsideCode(plainFallback));
    }
    const directFallback = String(input || "").replace(/\r\n/g, "\n").trim();
    if (rawArtifactLikeInput) {
        return "";
    }
    if (directFallback) {
        return ensureProfessionalParagraphSpacing(enforceDashListStyleOutsideCode(directFallback));
    }
    return "";
};
const professionalListLinePattern = /^\s*(?:[-*]\s+|\d+[.)]\s+|[A-Za-z][.)]\s+)/;
const professionalHeadingLinePattern = /^\s*[A-Za-z][A-Za-z0-9 ,()/'"+-]{1,90}:\s*$/;
const tightenListSpacingOutsideCode = (text) => {
    const value = String(text || "").replace(/\r/g, "").trim();
    if (!value)
        return value;
    const parts = value
        .split(/(Code Example(?:\s*\([^)]+\))?:\n'\n[\s\S]*?\n')/g)
        .filter(Boolean);
    const normalizePlain = (segment) => {
        const lines = String(segment || "").split("\n");
        const out = [];
        let pendingBlank = false;
        let previousType = "none";
        for (let i = 0; i < lines.length; i += 1) {
            const line = String(lines[i] || "").replace(/[ \t]+$/g, "");
            const trimmed = line.trim();
            if (!trimmed) {
                pendingBlank = true;
                continue;
            }
            const currentType = professionalHeadingLinePattern.test(trimmed)
                ? "heading"
                : professionalListLinePattern.test(trimmed)
                    ? "bullet"
                    : "text";
            let needsGap = false;
            if (out.length > 0 && out[out.length - 1] !== "") {
                if (pendingBlank) {
                    if (!(previousType === "bullet" && currentType === "bullet")) {
                        needsGap = true;
                    }
                }
                if (currentType === "heading") {
                    needsGap = true;
                }
                else if (previousType === "heading") {
                    needsGap = true;
                }
                else if (currentType === "bullet" && previousType === "text") {
                    needsGap = true;
                }
                else if (currentType === "text" && previousType === "bullet") {
                    needsGap = true;
                }
            }
            if (needsGap && out[out.length - 1] !== "") {
                out.push("");
            }
            out.push(trimmed);
            previousType = currentType;
            pendingBlank = false;
        }
        return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    };
    return parts
        .map((part) => (/^Code Example(?:\s*\([^)]+\))?:\n'/i.test(part.trim()) ? part.trim() : normalizePlain(part)))
        .filter(Boolean)
        .join("\n\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
};
const ensureProfessionalParagraphSpacing = (text) => {
    const value = String(text || "").replace(/\r/g, "").trim();
    if (!value)
        return value;
    const parts = value
        .split(/(Code Example(?:\s*\([^)]+\))?:\n'\n[\s\S]*?\n')/g)
        .filter(Boolean);
    const normalized = parts.map((part) => {
        if (/^Code Example(?:\s*\([^)]+\))?:/i.test(part.trim())) {
            return part.trim();
        }
        return String(part || "")
            .replace(/([^\n:]{2,}:)\n(?=\S)/g, "$1\n\n")
            .replace(/([.!?])\n(?=[A-Z])/g, "$1\n\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    });
    return tightenListSpacingOutsideCode(normalized.join("\n\n").replace(/\n{3,}/g, "\n\n").trim());
};
