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

function weaviateEnabled() {
  return Boolean(env.WEAVIATE_HOST && env.WEAVIATE_API_KEY);
}

function endpoint(path: string) {
  return `https://${env.WEAVIATE_HOST}${path}`;
}

async function weaviateFetch(path: string, init?: RequestInit) {
  return fetch(endpoint(path), {
    cache: "no-store",
    ...init,
    headers: {
      Authorization: `Bearer ${env.WEAVIATE_API_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export async function ensureWeaviateSchema() {
  if (!weaviateEnabled()) {
    return false;
  }

  const existingSchema = await weaviateFetch("/v1/schema");
  if (!existingSchema.ok) {
    return false;
  }

  const payload = (await existingSchema.json()) as {
    classes?: Array<{ class?: string }>;
  };

  if (
    payload.classes?.some(
      (entry) => entry.class === env.RESEARCH_WEAVIATE_CLASS,
    )
  ) {
    return true;
  }

  const createResponse = await weaviateFetch("/v1/schema", {
    method: "POST",
    body: JSON.stringify({
      class: env.RESEARCH_WEAVIATE_CLASS,
      description: "Research chunks captured by SwiftDeploy AI Research Agent",
      vectorizer: "none",
      properties: [
        { name: "question", dataType: ["text"] },
        { name: "title", dataType: ["text"] },
        { name: "url", dataType: ["text"] },
        { name: "content", dataType: ["text"] },
        { name: "sourceProvider", dataType: ["text"] },
        { name: "domain", dataType: ["text"] },
        { name: "chunkIndex", dataType: ["int"] },
        { name: "createdAt", dataType: ["date"] },
      ],
    }),
  });

  return createResponse.ok;
}

export async function storeResearchEmbeddings(chunks: ChunkForStorage[]) {
  if (!weaviateEnabled() || !chunks.length) {
    return false;
  }

  const schemaReady = await ensureWeaviateSchema();
  if (!schemaReady) {
    return false;
  }

  const response = await weaviateFetch("/v1/batch/objects", {
    method: "POST",
    body: JSON.stringify({
      objects: chunks.map((chunk) => ({
        class: env.RESEARCH_WEAVIATE_CLASS,
        vector: chunk.vector,
        properties: {
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
  if (!weaviateEnabled() || !queryVector.length) {
    return [] as RetrievedChunk[];
  }

  const vectorLiteral = queryVector
    .map((value) => (Number.isFinite(value) ? value.toFixed(8) : "0"))
    .join(",");

  const graphQlQuery = `{
    Get {
      ${env.RESEARCH_WEAVIATE_CLASS}(limit: ${limit}, nearVector: { vector: [${vectorLiteral}] }) {
        question
        title
        url
        content
        sourceProvider
        chunkIndex
        _additional {
          distance
        }
      }
    }
  }`;

  const response = await weaviateFetch("/v1/graphql", {
    method: "POST",
    body: JSON.stringify({
      query: graphQlQuery,
    }),
  });

  if (!response.ok) {
    return [] as RetrievedChunk[];
  }

  const payload = (await response.json()) as {
    data?: {
      Get?: Record<
        string,
        Array<{
          title?: string;
          url?: string;
          content?: string;
          sourceProvider?: string;
          chunkIndex?: number;
          _additional?: {
            distance?: number;
          };
        }>
      >;
    };
  };

  return (payload.data?.Get?.[env.RESEARCH_WEAVIATE_CLASS] ?? []).map((item) => ({
    id: stableId("weaviate", item.url ?? "", String(item.chunkIndex ?? 0)),
    title: item.title ?? "Untitled chunk",
    url: item.url ?? "",
    content: item.content ?? "",
    sourceProvider: item.sourceProvider ?? "weaviate",
    chunkIndex: Number(item.chunkIndex ?? 0),
    score: 1 - Number(item._additional?.distance ?? 1),
  }));
}
