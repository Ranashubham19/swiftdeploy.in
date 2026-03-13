import type { ResearchRequestBody, ResearchRunResult } from "@/lib/types";

import { env } from "@/lib/env";
import { buildSupabaseHeaders } from "@/lib/supabase-headers";

export async function persistResearchRun(
  result: ResearchRunResult,
  user: ResearchRequestBody["user"] = null,
) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return {
      persisted: false,
      reason: "Supabase env vars are missing",
    };
  }

  try {
    const response = await fetch(
      `${env.SUPABASE_URL}/rest/v1/${env.SUPABASE_PERSISTENCE_TABLE}`,
      {
        method: "POST",
        cache: "no-store",
        headers: buildSupabaseHeaders(env.SUPABASE_ANON_KEY, {
          Prefer: "return=minimal",
        }),
        body: JSON.stringify({
          question: result.question,
          plan: {
            resolvedQuestion: result.resolvedQuestion,
            rewrittenQueries: result.rewrittenQueries,
            usedConversationContext: result.usedConversationContext,
            memory: result.memory,
            ...result.plan,
            classification: result.classification,
          },
          progress: result.progress,
          search_diagnostics: result.searchDiagnostics ?? null,
          sources: result.sources,
          retrieved_context: result.retrievedContext,
          report: result.report
            ? {
                ...result.report,
                generated_answer: result.answer,
                classification: result.classification,
              }
            : {
                generated_answer: result.answer,
                classification: result.classification,
              },
          firebase_uid: user?.uid ?? null,
          user_email: user?.email ?? null,
          user_name: user?.displayName ?? null,
          created_at: new Date().toISOString(),
        }),
      },
    );

    if (!response.ok) {
      return {
        persisted: false,
        reason: `Supabase persistence failed with ${response.status}`,
      };
    }

    return { persisted: true };
  } catch (error) {
    return {
      persisted: false,
      reason: error instanceof Error ? error.message : "Supabase persistence failed",
    };
  }
}
