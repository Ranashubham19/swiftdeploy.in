export type StructuredOutputMode =
  | { kind: "none" }
  | { kind: "json"; schemaHint?: string }
  | { kind: "yaml" }
  | { kind: "csv" }
  | { kind: "markdown_table" };

export const detectStructuredOutputMode = (prompt: string): StructuredOutputMode => {
  const text = String(prompt || "").toLowerCase();
  if (!text.trim()) return { kind: "none" };
  if (/\bjson schema\b/.test(text)) {
    return { kind: "json", schemaHint: "User requested JSON schema-compliant output." };
  }
  if (/\b(return|output|respond|format)( as)? json\b|\bjson only\b/.test(text)) {
    return { kind: "json" };
  }
  if (/\byaml\b/.test(text)) return { kind: "yaml" };
  if (/\bcsv\b/.test(text)) return { kind: "csv" };
  if (/\btable\b/.test(text) && /\bmarkdown\b/.test(text)) return { kind: "markdown_table" };
  return { kind: "none" };
};

export const buildStructuredOutputInstructions = (mode: StructuredOutputMode): string => {
  if (mode.kind === "none") return "";
  if (mode.kind === "json") {
    return [
      "Structured output mode enabled.",
      "- Return valid JSON only (no markdown fences).",
      "- Use double quotes for keys and string values.",
      "- Do not include explanatory text before or after JSON.",
      mode.schemaHint ? `- ${mode.schemaHint}` : "",
    ].filter(Boolean).join("\n");
  }
  if (mode.kind === "yaml") {
    return [
      "Structured output mode enabled.",
      "- Return valid YAML only (no markdown fences).",
      "- Do not include explanatory prose before or after the YAML.",
    ].join("\n");
  }
  if (mode.kind === "csv") {
    return [
      "Structured output mode enabled.",
      "- Return CSV only.",
      "- Include a header row.",
      "- Escape commas/quotes correctly.",
      "- Do not include explanatory prose before or after CSV.",
    ].join("\n");
  }
  return [
    "Structured output mode enabled.",
    "- Return a markdown table only.",
    "- Include a header row and separator row.",
    "- Do not include explanatory prose before or after the table.",
  ].join("\n");
};

export const normalizeStructuredOutput = (text: string, mode: StructuredOutputMode): string => {
  const raw = String(text || "").trim();
  if (!raw || mode.kind === "none") return raw;

  if (mode.kind === "json") {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
    try {
      return JSON.stringify(JSON.parse(cleaned));
    } catch {
      return cleaned;
    }
  }

  if (mode.kind === "yaml" || mode.kind === "csv" || mode.kind === "markdown_table") {
    return raw.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/i, "").trim();
  }

  return raw;
};
