export type WhatsAppAutomationMode =
  | "read_only"
  | "suggest_only"
  | "approve_before_send";

export type WhatsAppReplyMode =
  | "balanced"
  | "professional"
  | "friendly"
  | "brief";

export type WhatsAppGroupReplyMode = "mention_only" | "allow" | "never";

export type WhatsAppContactPriority = "low" | "normal" | "high" | "vip";

export type WhatsAppSensitivity = "normal" | "sensitive" | "critical";

export type WhatsAppWorkflowType =
  | "missed_reply_follow_up"
  | "payment_follow_up"
  | "meeting_confirmation"
  | "lead_nurture"
  | "group_digest";

export type WhatsAppWorkflowScope = "direct" | "group" | "all";

export type WhatsAppWorkflowRunStatus =
  | "scheduled"
  | "pending_approval"
  | "sent"
  | "skipped"
  | "cancelled";

export type WhatsAppApprovalState =
  | "not_required"
  | "pending"
  | "approved"
  | "skipped"
  | "blocked";

export type WhatsAppReplyApprovalStatus = "pending" | "sent" | "skipped" | "edited";

export type WhatsAppOutboundSource =
  | "approval"
  | "workflow"
  | "direct_command"
  | "assistant_reply"
  | "system"
  | "api_send";

export type WhatsAppActiveContactSession = {
  contactName: string;
  phone: string | null;
  jid: string | null;
  startedAt: string;
  sourceMessage: string | null;
};

export type WhatsAppPendingContactOption = {
  name: string;
  phone: string | null;
  jid: string | null;
};

export type WhatsAppPendingContactResolutionKind =
  | "active_contact_start"
  | "whatsapp_history"
  | "send_message";

export type WhatsAppPendingContactResolution = {
  kind: WhatsAppPendingContactResolutionKind;
  requestedName: string;
  resumePrompt: string;
  options: WhatsAppPendingContactOption[];
  createdAt: string;
};

export type WhatsAppOutboundStatus =
  | "drafted"
  | "queued"
  | "approval_required"
  | "approved"
  | "retrying"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "skipped"
  | "cancelled";

export type WhatsAppSettings = {
  automationMode: WhatsAppAutomationMode;
  replyMode: WhatsAppReplyMode;
  groupReplyMode: WhatsAppGroupReplyMode;
  requireApprovalForSensitive: boolean;
  allowGroupReplies: boolean;
  allowDirectSendCommands: boolean;
  requireApprovalForNewContacts: boolean;
  requireApprovalForFirstOutreach: boolean;
  allowWorkflowAutoSend: boolean;
  maskSensitivePreviews: boolean;
  retentionDays: number;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  activeContactSession: WhatsAppActiveContactSession | null;
  pendingContactResolution: WhatsAppPendingContactResolution | null;
};

export type WhatsAppReplyApproval = {
  id: string;
  user_id: string;
  remote_jid: string | null;
  remote_phone: string | null;
  contact_name: string | null;
  source_message: string;
  draft_reply: string;
  status: WhatsAppReplyApprovalStatus;
  sensitivity: WhatsAppSensitivity;
  confidence: number | null;
  reason: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string | null;
};

export type WhatsAppWorkflow = {
  id: string;
  user_id: string;
  workflow_type: WhatsAppWorkflowType;
  title: string;
  description: string | null;
  is_enabled: boolean;
  approval_required: boolean;
  delay_minutes: number;
  scope: WhatsAppWorkflowScope;
  trigger_keywords: string[];
  template: string | null;
  config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
};

export type WhatsAppWorkflowRun = {
  id: string;
  user_id: string;
  workflow_id: string | null;
  workflow_type: WhatsAppWorkflowType;
  remote_jid: string | null;
  remote_phone: string | null;
  contact_name: string | null;
  source_message: string | null;
  suggested_reply: string | null;
  status: WhatsAppWorkflowRunStatus;
  approval_state: WhatsAppApprovalState;
  due_at: string | null;
  sent_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
};

export type WhatsAppOutboundMessage = {
  id: string;
  user_id: string;
  source: WhatsAppOutboundSource;
  approval_id: string | null;
  workflow_run_id: string | null;
  remote_jid: string | null;
  remote_phone: string | null;
  contact_name: string | null;
  message_text: string;
  idempotency_key: string;
  status: WhatsAppOutboundStatus;
  attempt_count: number;
  wa_message_ids: string[];
  queued_at: string;
  approved_at: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
  failed_at: string | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
};

export type WhatsAppAuditEntry = {
  id: string;
  event_type: string;
  actor: string;
  target_type: string;
  target_value: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type WhatsAppPrivacyDeleteMode = "retention" | "contact" | "all";

export type WhatsAppExportBundle = {
  exported_at: string;
  settings: WhatsAppSettings;
  contacts: WhatsAppInboxContact[];
  approvals: WhatsAppReplyApproval[];
  outbound_messages: WhatsAppOutboundMessage[];
  workflows: WhatsAppWorkflow[];
  workflow_runs: WhatsAppWorkflowRun[];
  history: WhatsAppHistoryEntry[];
  audit_log: WhatsAppAuditEntry[];
};

export type WhatsAppHistoryEntry = {
  id: string;
  direction: "inbound" | "outbound";
  content: string;
  message_type: string;
  remote_jid: string | null;
  remote_phone: string | null;
  contact_name: string | null;
  chat_type: "direct" | "group" | "self" | "broadcast" | "unknown";
  sent_at: string;
  priority: WhatsAppContactPriority;
  needs_reply: boolean;
  reply_confidence: number | null;
  sensitivity: WhatsAppSensitivity;
  approval_state: WhatsAppApprovalState;
  audit_payload: Record<string, unknown> | null;
};

export type WhatsAppHistoryInsights = {
  resultCount: number;
  awaitingReplyCount: number;
  sensitiveCount: number;
  blockedCount: number;
  groupCount: number;
  mediaCount: number;
};

export type WhatsAppGroupThreadInsight = {
  jid: string;
  display_name: string;
  message_count: number;
  pending_approval_count: number;
  sensitive_count: number;
  last_message_at: string | null;
  last_message_preview: string | null;
};

export type WhatsAppMediaSummary = {
  image: number;
  audio: number;
  document: number;
  video: number;
  other: number;
};

export type WhatsAppInboxContact = {
  jid: string;
  phone_number: string | null;
  display_name: string;
  aliases: string[];
  tags: string[];
  priority: WhatsAppContactPriority;
  last_seen_at: string | null;
  last_message_at: string | null;
  last_message_direction: "inbound" | "outbound" | null;
  last_message_preview: string | null;
  awaiting_reply: boolean;
};

export type WhatsAppInboxSummary = {
  connected: boolean;
  contactCount: number;
  pendingApprovalCount: number;
  awaitingReplyCount: number;
  highPriorityCount: number;
  recentMessageCount: number;
  groupThreadCount: number;
  mediaMessageCount: number;
  sensitiveMessageCount: number;
};

export const defaultWhatsAppSettings: WhatsAppSettings = {
  automationMode: "read_only",
  replyMode: "balanced",
  groupReplyMode: "never",
  requireApprovalForSensitive: false,
  allowGroupReplies: false,
  allowDirectSendCommands: true,
  requireApprovalForNewContacts: false,
  requireApprovalForFirstOutreach: false,
  allowWorkflowAutoSend: false,
  maskSensitivePreviews: true,
  retentionDays: 90,
  quietHoursStart: null,
  quietHoursEnd: null,
  activeContactSession: null,
  pendingContactResolution: null,
};
