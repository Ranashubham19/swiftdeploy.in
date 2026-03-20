import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { listWhatsAppReplyApprovals } from "@/lib/clawcloud-whatsapp-approval";
import { getWhatsAppSettings, maskWhatsAppContentPreview, writeWhatsAppAuditLog } from "@/lib/clawcloud-whatsapp-control";
import { listWhatsAppHistory, listWhatsAppContacts } from "@/lib/clawcloud-whatsapp-inbox";
import { listWhatsAppWorkflowRuns, listWhatsAppWorkflows } from "@/lib/clawcloud-whatsapp-workflows";
import type {
  WhatsAppAuditEntry,
  WhatsAppExportBundle,
  WhatsAppPrivacyDeleteMode,
} from "@/lib/clawcloud-whatsapp-workspace-types";

export async function listWhatsAppAuditLog(userId: string, limit = 120) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("whatsapp_audit_log")
    .select("id, event_type, actor, target_type, target_value, summary, metadata, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 300));

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as WhatsAppAuditEntry[];
}

export async function exportWhatsAppWorkspaceData(userId: string): Promise<WhatsAppExportBundle> {
  const settings = await getWhatsAppSettings(userId);
  const [contacts, approvals, workflows, workflowRuns, auditLog, historySnapshot] = await Promise.all([
    listWhatsAppContacts(userId),
    listWhatsAppReplyApprovals(userId, 500),
    listWhatsAppWorkflows(userId),
    listWhatsAppWorkflowRuns(userId, 500),
    listWhatsAppAuditLog(userId, 500),
    listWhatsAppHistory({ userId, limit: 500 }),
  ]);

  const maskedHistory = historySnapshot.rows.map((row) => ({
    ...row,
    content: maskWhatsAppContentPreview(row.content, settings.maskSensitivePreviews, row.sensitivity),
  }));

  return {
    exported_at: new Date().toISOString(),
    settings,
    contacts,
    approvals: approvals.map((approval) => ({
      ...approval,
      source_message: maskWhatsAppContentPreview(
        approval.source_message,
        settings.maskSensitivePreviews,
        approval.sensitivity,
      ),
      draft_reply: maskWhatsAppContentPreview(
        approval.draft_reply,
        settings.maskSensitivePreviews,
        approval.sensitivity,
      ),
    })),
    workflows,
    workflow_runs: workflowRuns.map((run) => ({
      ...run,
      source_message: maskWhatsAppContentPreview(run.source_message, settings.maskSensitivePreviews, "normal"),
      suggested_reply: maskWhatsAppContentPreview(run.suggested_reply, settings.maskSensitivePreviews, "normal"),
    })),
    history: maskedHistory,
    audit_log: auditLog,
  };
}

export async function deleteWhatsAppWorkspaceData(input: {
  userId: string;
  mode: WhatsAppPrivacyDeleteMode;
  contact?: string | null;
  retentionDays?: number;
  dryRun?: boolean;
}) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const settings = await getWhatsAppSettings(input.userId);
  const retentionDays = input.retentionDays ?? settings.retentionDays;
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  const countQuery = async (builder: any) => {
    const { count, error } = await builder.select("*", { count: "exact", head: true });
    if (error) {
      throw new Error(error.message);
    }
    return count ?? 0;
  };

  const buildContactFilter = (builder: any, fields: readonly string[]) => {
    const needle = String(input.contact ?? "").trim();
    if (!needle) {
      return builder;
    }

    const filters = fields.map((field) => `${field}.ilike.%${needle}%`).join(",");
    return builder.or(filters);
  };

  const tables = [
    { name: "whatsapp_messages", fields: ["remote_jid", "remote_phone", "contact_name"], timeField: "sent_at" },
    { name: "whatsapp_reply_approvals", fields: ["remote_jid", "remote_phone", "contact_name"], timeField: "created_at" },
    { name: "whatsapp_workflow_runs", fields: ["remote_jid", "remote_phone", "contact_name"], timeField: "created_at" },
    { name: "whatsapp_audit_log", fields: ["target_value", "summary"], timeField: "created_at" },
  ] as const;

  const deleted: Record<string, number> = {};

  for (const table of tables) {
    const applyFilters = (builder: any) => {
      let query = builder.eq("user_id", input.userId);

      if (input.mode === "retention") {
        query = query.lt(table.timeField, cutoff);
      } else if (input.mode === "contact") {
        query = buildContactFilter(query, table.fields);
      }

      return query;
    };

    deleted[table.name] = await countQuery(applyFilters(supabaseAdmin.from(table.name)));

    if (!input.dryRun && deleted[table.name] > 0) {
      await applyFilters(supabaseAdmin.from(table.name))
        .delete()
        .catch((error: { message?: string }) => {
        throw new Error(error?.message || `Failed to delete from ${table.name}.`);
      });
    }
  }

  if (!input.dryRun) {
    await writeWhatsAppAuditLog(input.userId, {
      eventType: "privacy_delete",
      actor: "user",
      targetType: "privacy",
      targetValue: input.contact ?? input.mode,
      summary: `Ran WhatsApp data deletion in ${input.mode} mode.`,
      metadata: {
        deleted,
        retention_days: retentionDays,
      },
    }).catch(() => null);
  }

  return {
    mode: input.mode,
    dryRun: Boolean(input.dryRun),
    retentionDays,
    deleted,
  };
}
