import { env } from "@/lib/env";
import { createDeterministicVector } from "@/lib/utils";

type VoyageEmbeddingResponse = {
  data?: Array<{
    embedding?: number[];
  }>;
};

type NvidiaEmbeddingResponse = {
  data?: Array<{
    embedding?: number[];
  }>;
};

function getNvidiaEmbeddingUrl() {
  let base = env.NVIDIA_BASE_URL.trim().replace(/\/+$/, "");
  base = base
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/embeddings$/i, "");

  if (!/\/v\d+$/i.test(base)) {
    base = `${base}/v1`;
  }

  return `${base}/embeddings`;
}

async function embedWithVoyage(texts: string[], inputType: "query" | "passage") {
  if (!env.VOYAGE_API_KEY) {
    return null;
  }

  const response = await fetch("https://api.voyageai.com/v1/embed", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.VOYAGE_EMBED_MODEL,
      input: texts,
      input_type: inputType === "query" ? "query" : "document",
    }),
  });

  if (!response.ok) {
    throw new Error(`Voyage embeddings failed with ${response.status}`);
  }

  const payload = (await response.json()) as VoyageEmbeddingResponse;
  const embeddings = payload.data?.map((item) => item.embedding ?? []) ?? [];

  if (embeddings.length !== texts.length || !embeddings[0]?.length) {
    throw new Error("Voyage embeddings returned an unexpected payload");
  }

  return embeddings;
}

async function embedWithNvidia(texts: string[], inputType: "query" | "passage") {
  if (!env.NVIDIA_API_KEY) {
    return null;
  }

  const response = await fetch(getNvidiaEmbeddingUrl(), {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: texts,
      model: env.NVIDIA_EMBED_MODEL,
      input_type: inputType,
    }),
  });

  if (!response.ok) {
    throw new Error(`NVIDIA embeddings failed with ${response.status}`);
  }

  const payload = (await response.json()) as NvidiaEmbeddingResponse;
  const embeddings = payload.data?.map((item) => item.embedding ?? []) ?? [];

  if (embeddings.length !== texts.length || !embeddings[0]?.length) {
    throw new Error("NVIDIA embeddings returned an unexpected payload");
  }

  return embeddings;
}

export async function embedTexts(
  texts: string[],
  inputType: "query" | "passage" = "passage",
) {
  const cleanTexts = texts.map((text) => text.trim()).filter(Boolean);
  if (!cleanTexts.length) {
    return [] as number[][];
  }

  try {
    const voyageEmbeddings = await embedWithVoyage(cleanTexts, inputType);
    if (voyageEmbeddings) {
      return voyageEmbeddings;
    }
  } catch {
    // Fall through to the next provider.
  }

  try {
    const nvidiaEmbeddings = await embedWithNvidia(cleanTexts, inputType);
    if (nvidiaEmbeddings) {
      return nvidiaEmbeddings;
    }
  } catch {
    // Fall through to deterministic local vectors.
  }

  return cleanTexts.map((text) => createDeterministicVector(`${inputType}:${text}`));
}
