const ESCAPE_RE = /([\\_*\[\]()~`>#+\-=|{}.!])/g;
const CODE_BLOCK_RE = /```([\s\S]*?)```/g;
const escapeSegment = (input) => input.replace(ESCAPE_RE, "\\$1");
const escapeCode = (input) => input.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
export const toTelegramMarkdownV2 = (input) => {
    if (!input)
        return "";
    let output = "";
    let cursor = 0;
    for (const match of input.matchAll(CODE_BLOCK_RE)) {
        const index = match.index ?? 0;
        const before = input.slice(cursor, index);
        output += escapeSegment(before);
        const code = match[1] ?? "";
        output += `\`\`\`\n${escapeCode(code)}\n\`\`\``;
        cursor = index + match[0].length;
    }
    output += escapeSegment(input.slice(cursor));
    return output;
};
export const truncateForTelegram = (input, maxChars = 3500) => {
    if (input.length <= maxChars)
        return input;
    return `${input.slice(0, maxChars - 3)}...`;
};
