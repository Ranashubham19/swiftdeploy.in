import type { RetrievedChunk } from "@/lib/types";

import { env } from "@/lib/env";
import { stableId } from "@/lib/utils";

type ChunkForStorage = {
  question: string;
  title: string;
  url: string;
  content: string;
  sourceProvider: string;
  domain: string;
  chunkIndex: number;
  vector: number[];
};

type PineconeIndexDescription = {
  name?: string;
  host?: string;
  status?: {
    ready?: boolean;
    state?: string;
  };
};

let cachedHost: string | null = null;

function pineconeEnabled() {
  return Boolean(env.PINECONE_API_KEY && env.PINECONE_INDEX_NAME);
}

async function pineconeControlFetch(path: string, init?: RequestInit) {
  return fetch(`https://api.pinecone.io${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Api-Key": env.PINECONE_API_KEY,
      "Content-Type": "application/json",
      "X-Pinecone-API-Version": "2025-04",
      ...(init?.headers ?? {}),
    },
  });
}

async function describeIndex() {
  const response = await pineconeControlFetch(
    `/indexes/${encodeURIComponent(env.PINECONE_INDEX_NAME)}`,
  );

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as PineconeIndexDescription;
}

async function ensurePineconeIndex(dimension: number) {
  if (!pineconeEnabled()) {
    return null;
  }

  if (cachedHost) {
    return cachedHost;
  }

  const existing = await describeIndex();
  if (existing?.host) {
    cachedHost = existing.host;
    return cachedHost;
  }

  const createResponse = await pineconeControlFetch("/indexes", {
    method: "POST",
    body: JSON.stringify({
      name: env.PINECONE_INDEX_NAME,
      dimension,
      metric: "cosine",
      spec: {
        serverless: {
          cloud: env.PINECONE_CLOUD,
          region: env.PINECONE_REGION,
        },
      },
    }),
  });

  if (!createResponse.ok && createResponse.status !== 409) {
    return null;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const description = await describeIndex();
    if (description?.host && description?.status?.ready !== false) {
      cachedHost = description.host;
      return cachedHost;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  return null;
}

async function pineconeDataFetch(host: string, path: string, init?: RequestInit) {
  return fetch(`https://${host}${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Api-Key": env.PINECONE_API_KEY,
      "Content-Type": "application/json",
      "X-Pinecone-API-Version": "2025-04",
      ...(init?.headers ?? {}),
    },
  });
}

export async function storeResearchEmbeddings(chunks: ChunkForStorage[]) {
  if (!pineconeEnabled() || !chunks.length) {
    return false;
  }

  const dimension = chunks[0]?.vector.length ?? 0;
  if (!dimension) {
    return false;
  }

  const host = await ensurePineconeIndex(dimension);
  if (!host) {
    return false;
  }

  const response = await pineconeDataFetch(host, "/vectors/upsert", {
    method: "POST",
    body: JSON.stringify({
      namespace: env.PINECONE_NAMESPACE,
      vectors: chunks.map((chunk) => ({
        id: stableId("pinecone", chunk.url, String(chunk.chunkIndex)),
        values: chunk.vector,
        metadata: {
          question: chunk.question,
          title: chunk.title,
          url: chunk.url,
          content: chunk.content,
          sourceProvider: chunk.sourceProvider,
          domain: chunk.domain,
          chunkIndex: chunk.chunkIndex,
          createdAt: new Date().toISOString(),
        },
      })),
    }),
  });

  return response.ok;
}

export async function retrieveResearchContext(queryVector: number[], limit = 6) {
  if (!pineconeEnabled() || !queryVector.length) {
    return [] as RetrievedChunk[];
  }

  const host =
    cachedHost ||
    (await ensurePineconeIndex(queryVector.length)) ||
    (await describeIndex())?.host ||
    null;

  if (!host) {
    return [] as RetrievedChunk[];
  }

  const response = await pineconeDataFetch(host, "/query", {
    method: "POST",
    body: JSON.stringify({
      namespace: env.PINECONE_NAMESPACE,
      vector: queryVector,
      topK: limit,
      includeMetadata: true,
    }),
  });

  if (!response.ok) {
    return [] as RetrievedChunk[];
  }

  const payload = (await response.json()) as {
    matches?: Array<{
      id?: string;
      score?: number;
      metadata?: {
        title?: string;
        url?: string;
        content?: string;
        sourceProvider?: string;
        chunkIndex?: number;
      };
    }>;
  };

  return (payload.matches ?? []).map((match) => ({
    id: match.id ?? stableId("pinecone", match.metadata?.url ?? "", "0"),
    title: match.metadata?.title ?? "Untitled chunk",
    url: match.metadata?.url ?? "",
    content: match.metadata?.content ?? "",
    sourceProvider: match.metadata?.sourceProvider ?? "pinecone",
    chunkIndex: Number(match.metadata?.chunkIndex ?? 0),
    score: Number(match.score ?? 0),
  }));
}
