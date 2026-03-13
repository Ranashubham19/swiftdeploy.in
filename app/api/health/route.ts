import { NextResponse } from "next/server";

import { env, getProviderSnapshot } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    providers: getProviderSnapshot(),
    storage: {
      supabaseThreadsTable: env.SUPABASE_THREADS_TABLE,
      supabaseRunsTable: env.SUPABASE_PERSISTENCE_TABLE,
      pineconeIndex: env.PINECONE_INDEX_NAME,
      pineconeNamespace: env.PINECONE_NAMESPACE,
    },
  });
}
