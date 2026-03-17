import { NextResponse } from "next/server";

import { env, getProviderSnapshot } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const buildSha =
    process.env.RAILWAY_GIT_COMMIT_SHA
    || process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.GIT_COMMIT_SHA
    || null;

  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    build: {
      sha: buildSha,
      railwayService: process.env.RAILWAY_SERVICE_NAME || null,
    },
    providers: getProviderSnapshot(),
    storage: {
      supabaseThreadsTable: env.SUPABASE_THREADS_TABLE,
      supabaseRunsTable: env.SUPABASE_PERSISTENCE_TABLE,
      pineconeIndex: env.PINECONE_INDEX_NAME,
      pineconeNamespace: env.PINECONE_NAMESPACE,
    },
  });
}
