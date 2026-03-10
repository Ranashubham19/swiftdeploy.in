import fs from "node:fs";
import path from "node:path";

export type RAGSnippet = {
  id: string;
  title: string;
  sourcePath: string;
  snippet: string;
  score: number;
};

type IndexedDoc = {
  id: string;
  title: string;
  sourcePath: string;
  text: string;
  tokens: string[];
};

let ragCache: { root: string; docs: IndexedDoc[]; builtAt: number } | null = null;

const tokenize = (value: string): string[] =>
  String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

const readKnowledgeFiles = (root: string): IndexedDoc[] => {
  if (!fs.existsSync(root)) return [];
  const docs: IndexedDoc[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(txt|md|markdown|json|csv)$/i.test(entry.name)) continue;
      try {
        const raw = fs.readFileSync(full, "utf8");
        const text = raw.length > 80_000 ? raw.slice(0, 80_000) : raw;
        docs.push({
          id: full,
          title: entry.name,
          sourcePath: full,
          text,
          tokens: tokenize(text),
        });
      } catch {}
    }
  };
  walk(root);
  return docs;
};

const ensureIndex = (knowledgeRoot?: string): IndexedDoc[] => {
  const root =
    String(knowledgeRoot || process.env.KNOWLEDGE_BASE_DIR || "").trim() ||
    path.resolve(process.cwd(), "knowledge");
  if (ragCache && ragCache.root === root && Date.now() - ragCache.builtAt < 60_000) {
    return ragCache.docs;
  }
  const docs = readKnowledgeFiles(root);
  ragCache = { root, docs, builtAt: Date.now() };
  return docs;
};

export const retrieveKnowledgeSnippets = (
  query: string,
  opts?: { topK?: number; knowledgeRoot?: string },
): RAGSnippet[] => {
  const q = String(query || "").trim();
  if (!q) return [];
  const queryTokens = tokenize(q);
  if (!queryTokens.length) return [];
  const docs = ensureIndex(opts?.knowledgeRoot);
  const topK = Math.max(1, Math.min(6, opts?.topK ?? 3));

  const scored = docs
    .map((doc) => {
      let score = 0;
      for (const token of queryTokens) {
        if (doc.tokens.includes(token)) score += 2;
        if (doc.title.toLowerCase().includes(token)) score += 3;
      }
      if (score <= 0) return null;
      const idx = doc.text.toLowerCase().indexOf(queryTokens.find((t) => doc.text.toLowerCase().includes(t)) || "");
      const start = Math.max(0, idx - 220);
      const snippet = doc.text.slice(start, start + 700).replace(/\s+/g, " ").trim();
      return {
        id: doc.id,
        title: doc.title,
        sourcePath: doc.sourcePath,
        snippet,
        score,
      } as RAGSnippet;
    })
    .filter(Boolean) as RAGSnippet[];

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
};

export const formatRagSnippetsBlock = (snippets: RAGSnippet[]): string => {
  if (!snippets.length) return "";
  return [
    "Knowledge-base context (internal docs, prioritize when relevant):",
    ...snippets.map(
      (s, i) => `[KB${i + 1}] ${s.title}\nPath: ${s.sourcePath}\nExcerpt: ${s.snippet}`,
    ),
  ].join("\n\n");
};
