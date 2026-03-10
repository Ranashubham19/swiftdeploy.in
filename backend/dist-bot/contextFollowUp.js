const normalize = (v) => String(v || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
export const parseContextReference = (input) => {
    const text = normalize(input);
    if (!text) {
        return { isReference: false, target: "pair", ordinal: null, latest: false, preserveFormat: false };
    }
    const preserveFormat = /\b(same\s+(format|style|structure|pattern|template|layout)|previous\s+(format|style|structure)|same way)\b/.test(text);
    const answerTargetHint = /\b(answer|response|reply|solution)\b/.test(text)
        || /\bthat\s+answer\b/.test(text)
        || /\bthis\s+answer\b/.test(text)
        || /\bprevious\s+answer\b/.test(text)
        || /\blast\s+answer\b/.test(text);
    const questionTargetHint = /\b(question|prompt|query)\b/.test(text)
        || /\bthat\s+question\b/.test(text)
        || /\bthis\s+question\b/.test(text)
        || /\bprevious\s+question\b/.test(text)
        || /\blast\s+question\b/.test(text);
    const target = answerTargetHint
        ? "answer"
        : questionTargetHint
            ? "question"
            : "pair";
    let ordinal = null;
    const ordMatch = text.match(/\b(\d+)(?:st|nd|rd|th)?\s+(question|answer|response|reply|point|step)\b/) ||
        text.match(/\b(first|second|third|fourth|fifth)\s+(question|answer|response|reply|point|step)\b/);
    if (ordMatch) {
        const raw = String(ordMatch[1] || "").toLowerCase();
        const words = {
            first: 1,
            second: 2,
            third: 3,
            fourth: 4,
            fifth: 5,
        };
        ordinal = words[raw] || Math.max(1, Number.parseInt(raw, 10) || 0) || null;
    }
    const latest = /\b(last|latest|previous|earlier|above|before|prior|recent|newest|old|older)\b/.test(text);
    const contextWords = /\b(context|conversation|message|chat|thread|history)\b/.test(text)
        || /\b(that one|this one|same one)\b/.test(text)
        || /\b(same as (?:above|before|previous|earlier))\b/.test(text)
        || /\b(from|based on|according to)\s+(?:the\s+)?(?:previous|last|earlier|above)\b/.test(text);
    const genericRef = /\b(it|this|that|these|those|same|previous|last|earlier|above|before|prior|old)\b/.test(text);
    const action = /\b(explain|tell|show|write|make|do|give|provide|solve|continue|expand|detail|details|more|convert|format|answer|use|refer|clarify|elaborate|summari(?:ze|se)|improve|compare)\b/.test(text);
    const explicit = latest
        || ordinal !== null
        || /\b(previous question|previous answer|last answer|last question|old question|old answer|above answer|above question)\b/.test(text)
        || contextWords;
    return {
        isReference: explicit || (genericRef && action) || (contextWords && action),
        target,
        ordinal,
        latest,
        preserveFormat,
    };
};
