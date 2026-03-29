import type { ResearchRequestBody, ResearchRunResult } from "@/lib/types";

import { isClawCloudMissingSchemaColumn } from "@/lib/clawcloud-schema-compat";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { env } from "@/lib/env";

type PersistResearchUser = NonNullable<ResearchRequestBody["user"]> & {
  id?: string | null;
};

export async function persistResearchRun(
  result: ResearchRunResult,
  user: PersistResearchUser | null = null,
) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      persisted: false,
      reason: "Supabase env vars are missing",
    };
  }

  try {
    const userId = user?.id ?? user?.uid ?? null;
    const supabaseAdmin = getClawCloudSupabaseAdmin();
    const insertPayload = {
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
      user_id: userId,
      firebase_uid: user?.uid ?? userId,
      user_email: user?.email ?? null,
      user_name: user?.displayName ?? null,
      created_at: new Date().toISOString(),
    };

    let { error } = await supabaseAdmin.from(env.SUPABASE_PERSISTENCE_TABLE).insert(insertPayload);

    if (
      error
      && (
        isClawCloudMissingSchemaColumn(error.message ?? "", "user_id")
        || isClawCloudMissingSchemaColumn(error.message ?? "", "search_diagnostics")
      )
    ) {
      const legacyPayload = { ...insertPayload } as Record<string, unknown>;

      if (isClawCloudMissingSchemaColumn(error.message ?? "", "user_id")) {
        delete legacyPayload.user_id;
      }

      if (isClawCloudMissingSchemaColumn(error.message ?? "", "search_diagnostics")) {
        delete legacyPayload.search_diagnostics;
      }

      const retry = await supabaseAdmin.from(env.SUPABASE_PERSISTENCE_TABLE).insert(legacyPayload);
      if (!retry.error) {
        return {
          persisted: true,
          reason: "Persisted using legacy research_runs schema compatibility mode",
        };
      }

      error = retry.error;
    }

    if (error) {
      return {
        persisted: false,
        reason: `Supabase persistence failed: ${error.message}`,
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
