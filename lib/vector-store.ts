import type { RetrievedChunk } from "@/lib/types";

import {
  retrieveResearchContext as retrieveFromPinecone,
  storeResearchEmbeddings as storeInPinecone,
} from "@/lib/pinecone";
import {
  retrieveResearchContext as retrieveFromWeaviate,
  storeResearchEmbeddings as storeInWeaviate,
} from "@/lib/weaviate";

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

export async function storeResearchEmbeddings(chunks: ChunkForStorage[]) {
  if (!chunks.length) {
    return false;
  }

  const pineconeStored = await storeInPinecone(chunks).catch(() => false);
  if (pineconeStored) {
    return true;
  }

  return storeInWeaviate(chunks).catch(() => false);
}

export async function retrieveResearchContext(queryVector: number[], limit = 6) {
  if (!queryVector.length) {
    return [] as RetrievedChunk[];
  }

  const pineconeResults = await retrieveFromPinecone(queryVector, limit).catch(
    () => [] as RetrievedChunk[],
  );
  if (pineconeResults.length) {
    return pineconeResults;
  }

  return retrieveFromWeaviate(queryVector, limit).catch(() => [] as RetrievedChunk[]);
}
