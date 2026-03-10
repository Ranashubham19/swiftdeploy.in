type CodeGenerationIntentPolicyOptions = {
  isLikelyCodePrompt?: (prompt: string) => boolean;
};

const isGenericCodingIntentPrompt = (text: string): boolean => {
  const v = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!v) return false;
  const shortGenericCoding =
    v.split(' ').length <= 5
    && /\b(coding|code)\b/.test(v)
    && !/\b(write|implement|debug|fix|solve|function|class|algorithm|leetcode|in\s+\w+|for\s+\w+)\b/.test(v);
  if (shortGenericCoding) return true;
  if (/^(coding|code)\b/.test(v) && v.split(' ').length <= 3) return true;
  if (/^(ok\s+)?i (want|need|like)\s+(coding|code)\b/.test(v) && v.split(' ').length <= 8) return true;
  if (/^(know|learn|teach me)\s+(coding|code)\b/.test(v) && v.split(' ').length <= 8) return true;
  if (/^(can you|could you|do you)\s+(help|support)\s+(with\s+)?coding\b/.test(v) && v.split(' ').length <= 10) return true;
  return false;
};

const lineLooksLikeCodeSignal = (line: string): boolean => {
  const value = String(line || '').trim();
  if (!value) return false;
  const hasCodePunctuation = /[{}()[\];=<>:+\-*/,%!&|^]/.test(value);
  if (hasCodePunctuation) return true;

  if (/^(#include|using\s+namespace|using\s+std::|import |from |def |class |function |const |let |var |public\b|private\b|protected\b|static\b|int\b|long\b|float\b|double\b|char\b|bool\b|void\b|template\b|async\b|await\b|fn\b|struct\b|enum\b|type\b)/i.test(value)) {
    return true;
  }

  if (/^(if|else|for|while|switch|case|break|continue|return|try|catch|finally|elif|except|with)\b/i.test(value)) {
    return /[():{}[\];=<>:+\-*/,%!&|^]/.test(value) || /:$/.test(value);
  }

  return false;
};

const containsCodeLikeSignals = (text: string): boolean => {
  const source = String(text || '').trim();
  if (!source) return false;

  return /Code Example(?:\s*\([^)]+\))?\s*:/i.test(source)
    || /```|CODE_BEGIN|CODE_END/.test(source)
    || /\b(def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(|class\s+[A-Za-z_][A-Za-z0-9_]*|function\s+[A-Za-z_][A-Za-z0-9_]*\s*\(|const\s+[A-Za-z_][A-Za-z0-9_]*\s*=|let\s+[A-Za-z_][A-Za-z0-9_]*\s*=|var\s+[A-Za-z_][A-Za-z0-9_]*\s*=|#include\b|public\s+class\b|using\s+namespace\b|using\s+std::|fn\s+[A-Za-z_][A-Za-z0-9_]*\s*\()/i.test(source)
    || /\b(for|while|if)\s*\([^)]*;[^)]*;[^)]*\)/.test(source)
    || /^\s*(for|while|if|elif|else|try|except|with)\b[^\n]*:/m.test(source)
    || /<[a-z!/][^>]*>/i.test(source);
};

const stripCodeArtifactsFromNarrative = (input: string): string => {
  const source = String(input || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/CODE_BEGIN\b[\s\S]*?\bCODE_END/gi, ' ')
    .replace(/\bCode Example(?:\s*\([^)]+\))?:[\s\S]*$/i, ' ')
    .replace(/\bCode:\s*[\s\S]*$/i, ' ')
    .replace(/\r/g, '')
    .trim();

  if (!source) return '';

  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !lineLooksLikeCodeSignal(line));

  return lines.join(' ').replace(/\s{2,}/g, ' ').trim();
};

export const isExplicitCodeGenerationRequest = (prompt: string): boolean => {
  const value = String(prompt || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!value || isGenericCodingIntentPrompt(value)) return false;
  if (/\b(write code|show example|generate script|create implementation)\b/.test(value)) return true;
  if (/\b(with code|in code|code only)\b/.test(value)) return true;
  if (
    /\b(write|show|generate|create|implement|build)\b[\s\S]{0,90}\b(code|script|implementation|solution|program|snippet|function|class|query|regex)\b/.test(value)
  ) {
    return true;
  }
  if (
    /\b(give|provide|share|return|send)\b[\s\S]{0,90}\b(code|script|implementation|solution|snippet|program)\b/.test(value)
  ) {
    return true;
  }
  if (
    /\b(solve|implement|build|write)\b[\s\S]{0,80}\b(in|using)\s+(python|javascript|typescript|java|c\+\+|cpp|c#|csharp|go|golang|rust|sql|php|ruby|swift|kotlin)\b/.test(value)
  ) {
    return true;
  }
  if (/\b(debug|fix|refactor|optimize|correct)\b[\s\S]{0,60}\b(code|script|function|query|program)\b/.test(value)) return true;
  if (/\bshow\b[\s\S]{0,40}\bexample\b/.test(value) && /\b(code|coding|script|implementation|program|function|class|python|javascript|typescript|java|c\+\+|cpp|sql)\b/.test(value)) {
    return true;
  }
  return false;
};

export const enforceCodeGenerationIntentPolicy = (
  prompt: string,
  reply: string,
  options?: CodeGenerationIntentPolicyOptions
): string => {
  const source = String(reply || '').trim();
  if (!source) return source;
  if (isExplicitCodeGenerationRequest(prompt)) return source;
  if (!containsCodeLikeSignals(source)) return source;

  const narrative = stripCodeArtifactsFromNarrative(source);
  if (narrative) {
    return `${narrative}\n\nIf you want code, say "write code" and share the target language.`.trim();
  }

  if (options?.isLikelyCodePrompt?.(prompt)) {
    return 'I can explain this concept first. If you want implementation, say "write code" and include language plus constraints.';
  }
  return 'If you want implementation, say "write code" and include language plus constraints.';
};

