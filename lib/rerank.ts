import type { ResearchDocument, ResearchSource, RetrievedChunk } from "@/lib/types";

import { env } from "@/lib/env";
import { clipText } from "@/lib/utils";

type RerankCandidate = {
  id: string;
  title: string;
  body: string;
};

type RerankStrategy = "quality" | "fast";

type JinaRerankResponse = {
  results?: Array<{
    index?: number;
    relevance_score?: number;
  }>;
  data?: Array<{
    index?: number;
    relevance_score?: number;
  }>;
};

type CohereRerankResponse = {
  results?: Array<{
    index?: number;
    relevance_score?: number;
  }>;
};

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(input, {
    ...init,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutHandle));
}

function tokenize(value: string) {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );
}

function lexicalScore(query: string, body: string) {
  const queryTokens = tokenize(query);
  const bodyTokens = tokenize(body);
  if (!queryTokens.size || !bodyTokens.size) {
    return 0;
  }

  let hits = 0;
  for (const token of queryTokens) {
    if (bodyTokens.has(token)) {
      hits += 1;
    }
  }

  return hits / queryTokens.size;
}

async function rerankWithJina(question: string, candidates: RerankCandidate[]) {
  if (!env.JINA_API_KEY || !candidates.length) {
    return null;
  }

  const response = await fetchWithTimeout("https://api.jina.ai/v1/rerank", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${env.JINA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "jina-reranker-v2-base-multilingual",
      query: question,
      top_n: candidates.length,
      documents: candidates.map((candidate) => candidate.body),
    }),
  }, 2600);

  if (!response.ok) {
    throw new Error(`Jina rerank failed with ${response.status}`);
  }

  const payload = (await response.json()) as JinaRerankResponse;
  const results = payload.results ?? payload.data ?? [];
  if (!results.length) {
    throw new Error("Jina rerank returned an empty result set");
  }

  return results;
}

async function rerankWithCohere(question: string, candidates: RerankCandidate[]) {
  if (!env.COHERE_API_KEY || !candidates.length) {
    return null;
  }

  const response = await fetchWithTimeout("https://api.cohere.com/v2/rerank", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${env.COHERE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "rerank-v3.5",
      query: question,
      top_n: candidates.length,
      documents: candidates.map((candidate) => candidate.body),
    }),
  }, 2600);

  if (!response.ok) {
    throw new Error(`Cohere rerank failed with ${response.status}`);
  }

  const payload = (await response.json()) as CohereRerankResponse;
  if (!payload.results?.length) {
    throw new Error("Cohere rerank returned an empty result set");
  }

  return payload.results;
}

async function rerankCandidates(
  question: string,
  candidates: RerankCandidate[],
  strategy: RerankStrategy = "quality",
) {
  if (!candidates.length) {
    return [] as Array<{ index: number; score: number }>;
  }

  if (strategy === "fast") {
    return candidates.map((candidate, index) => ({
      index,
      score: lexicalScore(question, candidate.body),
    }));
  }

  try {
    const results = await rerankWithJina(question, candidates);
    if (results) {
      return results.map((result) => ({
        index: Number(result.index ?? 0),
        score: Number(result.relevance_score ?? 0),
      }));
    }
  } catch {
    // Fall through to the next provider.
  }

  try {
    const results = await rerankWithCohere(question, candidates);
    if (results) {
      return results.map((result) => ({
        index: Number(result.index ?? 0),
        score: Number(result.relevance_score ?? 0),
      }));
    }
  } catch {
    // Fall through to lexical reranking.
  }

  return candidates.map((candidate, index) => ({
    index,
    score: lexicalScore(question, candidate.body),
  }));
}

function sortWithScores<T>(items: T[], scores: Array<{ index: number; score: number }>) {
  const byIndex = new Map(scores.map((entry) => [entry.index, entry.score]));
  return items
    .map((item, index) => ({
      item,
      score: byIndex.get(index) ?? 0,
    }))
    .sort((left, right) => right.score - left.score)
    .map(({ item, score }) => ({ item, score }));
}

export async function rerankSources(
  question: string,
  sources: ResearchSource[],
  options: { strategy?: RerankStrategy } = {},
) {
  const candidates = sources.map((source) => ({
    id: source.id,
    title: source.title,
    body: [source.title, source.domain, source.snippet].filter(Boolean).join("\n"),
  }));

  const scored = sortWithScores(
    sources,
    await rerankCandidates(question, candidates, options.strategy),
  );
  return scored.map(({ item, score }) => ({
    ...item,
    score: Number.isFinite(score) ? score : item.score,
  }));
}

export async function rerankDocuments(
  question: string,
  documents: ResearchDocument[],
  options: { strategy?: RerankStrategy } = {},
) {
  const candidates = documents.map((document) => ({
    id: document.id,
    title: document.title,
    body: [document.title, clipText(document.content, 2400)].join("\n"),
  }));

  const scored = sortWithScores(
    documents,
    await rerankCandidates(question, candidates, options.strategy),
  );
  return scored.map(({ item }) => item);
}

export async function rerankChunks(
  question: string,
  chunks: RetrievedChunk[],
  options: { strategy?: RerankStrategy } = {},
) {
  const candidates = chunks.map((chunk) => ({
    id: chunk.id,
    title: chunk.title,
    body: [chunk.title, clipText(chunk.content, 2200)].join("\n"),
  }));

  const scored = sortWithScores(
    chunks,
    await rerankCandidates(question, candidates, options.strategy),
  );
  return scored.map(({ item, score }) => ({
    ...item,
    score,
  }));
}
