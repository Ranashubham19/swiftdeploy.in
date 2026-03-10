import fs from "node:fs";
import path from "node:path";

export type SemanticMemoryItem = {
  key: string;
  text: string;
  tags: string[];
  updatedAt: number;
};

type MemoryStoreFile = Record<string, SemanticMemoryItem[]>;

const store = new Map<string, SemanticMemoryItem[]>();
let loaded = false;

const memoryFile = (): string =>
  (process.env.SEMANTIC_MEMORY_FILE || "").trim() ||
  (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, "swiftdeploy-semantic-memory.json")
    : path.resolve(process.cwd(), "runtime", "swiftdeploy-semantic-memory.json"));

const normalize = (v: string): string =>
  String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractTags = (text: string): string[] => {
  const tokens = normalize(text)
    .split(" ")
    .filter((t) => t.length >= 3);
  return Array.from(new Set(tokens)).slice(0, 24);
};

const ensureLoaded = (): void => {
  if (loaded) return;
  loaded = true;
  try {
    const file = memoryFile();
    if (!fs.existsSync(file)) return;
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as MemoryStoreFile;
    for (const [key, items] of Object.entries(parsed || {})) {
      store.set(
        key,
        Array.isArray(items)
          ? items.map((i) => ({
              key: String(i?.key || ""),
              text: String(i?.text || ""),
              tags: Array.isArray(i?.tags) ? i.tags.map((t) => String(t)) : extractTags(String(i?.text || "")),
              updatedAt: Math.max(0, Number(i?.updatedAt || Date.now())),
            }))
          : [],
      );
    }
  } catch {}
};

const persist = (): void => {
  try {
    const file = memoryFile();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const out: MemoryStoreFile = {};
    for (const [k, v] of store.entries()) out[k] = v;
    fs.writeFileSync(file, JSON.stringify(out, null, 2), "utf8");
  } catch {}
};

export const ingestSemanticMemory = (conversationKey: string | undefined, userMessage: string): void => {
  const key = String(conversationKey || "").trim();
  const text = String(userMessage || "").trim();
  if (!key || !text) return;
  ensureLoaded();

  const patterns: RegExp[] = [
    /\bmy name is\b/i,
    /\bi am (?:a|an)\b/i,
    /\bi work as\b/i,
    /\bi prefer\b/i,
    /\bremember this\b/i,
    /\bmy timezone is\b/i,
    /\bi use\b/i,
  ];
  if (!patterns.some((p) => p.test(text)) && text.length > 220) return;

  const items = store.get(key) ?? [];
  const normalized = normalize(text);
  const existing = items.find((item) => normalize(item.text) === normalized);
  if (existing) {
    existing.updatedAt = Date.now();
  } else {
    items.unshift({
      key: `mem_${Date.now()}`,
      text: text.slice(0, 500),
      tags: extractTags(text),
      updatedAt: Date.now(),
    });
  }
  store.set(key, items.slice(0, 40));
  persist();
};

export const retrieveSemanticMemory = (conversationKey: string | undefined, query: string): SemanticMemoryItem[] => {
  const key = String(conversationKey || "").trim();
  if (!key) return [];
  ensureLoaded();
  const items = store.get(key) ?? [];
  const qTags = extractTags(query);
  if (!qTags.length) return items.slice(0, 3);
  return items
    .map((item) => ({
      item,
      score: qTags.reduce((sum, tag) => sum + (item.tags.includes(tag) ? 1 : 0), 0),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.item.updatedAt - a.item.updatedAt)
    .slice(0, 5)
    .map((x) => x.item);
};

export const formatSemanticMemoryBlock = (items: SemanticMemoryItem[]): string => {
  if (!items.length) return "";
  return [
    "User long-term memory context (use when relevant, do not overuse):",
    ...items.map((item, idx) => `- [M${idx + 1}] ${item.text}`),
  ].join("\n");
};
