import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { listWhatsAppReplyApprovals } from "@/lib/clawcloud-whatsapp-approval";
import { getWhatsAppSettings, maskWhatsAppContentPreview, writeWhatsAppAuditLog } from "@/lib/clawcloud-whatsapp-control";
import { listWhatsAppHistory, listWhatsAppContacts } from "@/lib/clawcloud-whatsapp-inbox";
import { listWhatsAppOutboundMessages } from "@/lib/clawcloud-whatsapp-outbound";
import { listWhatsAppWorkflowRuns, listWhatsAppWorkflows } from "@/lib/clawcloud-whatsapp-workflows";
import type {
  WhatsAppAuditEntry,
  WhatsAppExportBundle,
  WhatsAppPrivacyDeleteMode,
} from "@/lib/clawcloud-whatsapp-workspace-types";
import { defaultWhatsAppSettings } from "@/lib/clawcloud-whatsapp-workspace-types";

type WhatsAppPrivacyDeleteTable = {
  name:
    | "whatsapp_messages"
    | "whatsapp_reply_approvals"
    | "whatsapp_outbound_messages"
    | "whatsapp_workflow_runs"
    | "whatsapp_audit_log"
    | "whatsapp_contacts"
    | "whatsapp_automation_workflows";
  fields: readonly string[];
  timeField?: "sent_at" | "created_at";
  modes: readonly WhatsAppPrivacyDeleteMode[];
};

const WHATSAPP_PRIVACY_DELETE_TABLES: readonly WhatsAppPrivacyDeleteTable[] = [
  {
    name: "whatsapp_messages",
    fields: ["remote_jid", "remote_phone", "contact_name"],
    timeField: "sent_at",
    modes: ["retention", "contact", "all"],
  },
  {
    name: "whatsapp_reply_approvals",
    fields: ["remote_jid", "remote_phone", "contact_name"],
    timeField: "created_at",
    modes: ["retention", "contact", "all"],
  },
  {
    name: "whatsapp_outbound_messages",
    fields: ["remote_jid", "remote_phone", "contact_name", "message_text"],
    timeField: "created_at",
    modes: ["retention", "contact", "all"],
  },
  {
    name: "whatsapp_workflow_runs",
    fields: ["remote_jid", "remote_phone", "contact_name"],
    timeField: "created_at",
    modes: ["retention", "contact", "all"],
  },
  {
    name: "whatsapp_audit_log",
    fields: ["target_value", "summary"],
    timeField: "created_at",
    modes: ["retention", "contact", "all"],
  },
  {
    name: "whatsapp_contacts",
    fields: ["jid", "phone_number", "contact_name", "notify_name", "verified_name"],
    modes: ["contact", "all"],
  },
  {
    name: "whatsapp_automation_workflows",
    fields: [],
    modes: ["all"],
  },
];

function buildWhatsAppWorkspaceDeletePlan(mode: WhatsAppPrivacyDeleteMode) {
  return {
    tables: WHATSAPP_PRIVACY_DELETE_TABLES.filter((table) => table.modes.includes(mode)),
    resetSettings: mode === "all",
    writeAuditLog: mode !== "all",
  };
}

export function buildWhatsAppWorkspaceDeletePlanForTest(mode: WhatsAppPrivacyDeleteMode) {
  const plan = buildWhatsAppWorkspaceDeletePlan(mode);
  return {
    tables: plan.tables.map((table) => table.name),
    resetSettings: plan.resetSettings,
    writeAuditLog: plan.writeAuditLog,
  };
}

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
  const [contacts, approvals, outboundMessages, workflows, workflowRuns, auditLog, historySnapshot] = await Promise.all([
    listWhatsAppContacts(userId),
    listWhatsAppReplyApprovals(userId, 500),
    listWhatsAppOutboundMessages(userId, 500),
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
    outbound_messages: outboundMessages.map((message) => ({
      ...message,
      message_text: maskWhatsAppContentPreview(
        message.message_text,
        settings.maskSensitivePreviews,
        message.metadata?.sensitivity === "critical"
          ? "critical"
          : message.metadata?.sensitivity === "sensitive"
            ? "sensitive"
            : "normal",
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
  const deletePlan = buildWhatsAppWorkspaceDeletePlan(input.mode);

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

  const deleted: Record<string, number> = {};

  for (const table of deletePlan.tables) {
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
      const { error } = await applyFilters(supabaseAdmin.from(table.name)).delete();
      if (error) {
        throw new Error(error.message || `Failed to delete from ${table.name}.`);
      }
    }
  }

  if (deletePlan.resetSettings) {
    deleted.whatsapp_settings = await countQuery(
      supabaseAdmin.from("user_preferences").eq("user_id", input.userId),
    );

    if (!input.dryRun && deleted.whatsapp_settings > 0) {
      const { error } = await supabaseAdmin
        .from("user_preferences")
        .update({
          whatsapp_settings: defaultWhatsAppSettings,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", input.userId);

      if (error) {
        throw new Error(error.message || "Failed to reset WhatsApp settings.");
      }
    }
  }

  if (!input.dryRun && deletePlan.writeAuditLog) {
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
