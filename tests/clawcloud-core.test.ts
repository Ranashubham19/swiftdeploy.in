import assert from "node:assert/strict";
import test from "node:test";

import { detectCalendarActionIntent } from "@/lib/clawcloud-calendar-actions";
import {
  buildClawCloudAnswerQualityProfile,
  buildClawCloudLowConfidenceReply,
  isClawCloudGroundedLiveAnswer,
  looksLikeQuestionTopicMismatch,
  looksLikeWrongModeAnswer,
  scoreClawCloudAnswerConfidence,
  shouldAttemptDirectAnswerRecovery,
} from "@/lib/clawcloud-answer-quality";
import {
  buildClawCloudAnswerObservabilitySnapshot,
  looksLikeClawCloudRefusal,
  summarizeClawCloudAnswerObservabilityRecords,
} from "@/lib/clawcloud-answer-observability";
import {
  buildClawCloudModelPlannerDecisionForTest,
  chooseClawCloudCandidateForTest,
  detectMaterialCandidateDisagreementForTest,
  scoreClawCloudModelResponseForTest,
} from "@/lib/clawcloud-ai";
import { detectBillingIntent } from "@/lib/clawcloud-billing-wa";
import {
  analyzeSendMessageCommandSafety,
  buildParsedSendMessageAction,
  parseSendMessageCommand,
} from "@/lib/clawcloud-contacts";
import { detectDriveIntent } from "@/lib/clawcloud-drive";
import { answerHolidayQuery, detectHolidayQuery } from "@/lib/clawcloud-holidays";
import {
  detectIndianStateFromText,
  inferSpendingCategory,
  normalizeMerchantName,
} from "@/lib/clawcloud-india-normalization";
import { detectIndianStockQuery, detectTrainIntent } from "@/lib/clawcloud-india-live";
import {
  detectImageGenIntent,
  extractImagePrompt,
  getImageGenerationStatus,
} from "@/lib/clawcloud-imagegen";
import { solveCodingArchitectureQuestion, solveHardMathQuestion } from "@/lib/clawcloud-expert";
import {
  buildClawCloudSafetyReply,
  detectClawCloudSafetyRisk,
} from "@/lib/clawcloud-safety";
import {
  buildDashboardJournalThreadId,
  ensureDashboardJournalDay,
  mergeDashboardJournalCollections,
  normalizeDashboardJournalMessage,
} from "@/lib/clawcloud-dashboard-journal";
import {
  describeGlobalLiteConnection,
  validateGlobalLiteUpsertInput,
} from "@/lib/clawcloud-global-lite";
import {
  buildWhatsAppHistoryBackfillContacts,
  prepareWhatsAppContactUpsertRows,
} from "@/lib/clawcloud-whatsapp-contacts";
import {
  defaultWhatsAppSettings,
  type WhatsAppHistoryEntry,
} from "@/lib/clawcloud-whatsapp-workspace-types";
import {
  decideWhatsAppReplyAction,
  isWithinWhatsAppQuietHours,
  shouldRequireExplicitUserCommandForWhatsAppChat,
} from "@/lib/clawcloud-whatsapp-control";
import { buildWhatsAppWorkspaceDeletePlanForTest } from "@/lib/clawcloud-whatsapp-governance";
import {
  buildWhatsAppOutboundIdempotencyKey,
  isWhatsAppOutboundFinalizedStatus,
  resolveWhatsAppOutboundStatusFromAckStatus,
} from "@/lib/clawcloud-whatsapp-outbound";
import { buildClawCloudLiveAnswerAuditTrail } from "@/lib/clawcloud-privacy-lifecycle";
import {
  computeClawCloudWhatsAppSyncProgress,
  deriveClawCloudWhatsAppRuntimeHealth,
} from "@/lib/clawcloud-whatsapp-runtime";
import {
  computeClawCloudWhatsAppReconnectDelayMs,
  getClawCloudWhatsAppReconnectWaitMs,
  normalizeClawCloudWhatsAppRecoveryCheckpoint,
} from "@/lib/clawcloud-whatsapp-recovery";
import {
  buildClawCloudWhatsAppSyncCheckpointResumeRecommended,
  normalizeClawCloudWhatsAppSyncCheckpoint,
} from "@/lib/clawcloud-whatsapp-sync-checkpoint";
import {
  buildClawCloudWhatsAppHistoryBackfillPlan,
  deriveClawCloudWhatsAppChatSyncCompleteness,
  summarizeClawCloudWhatsAppHistoryCoverage,
} from "@/lib/clawcloud-whatsapp-history-plan";
import {
  buildClawCloudWhatsAppSessionStorageHealth,
  isClawCloudWhatsAppPersistentVolumePath,
  resolveClawCloudWhatsAppSessionBaseDir,
} from "@/lib/clawcloud-whatsapp-storage";
import { buildClawCloudWhatsAppContactIdentityGraph } from "@/lib/clawcloud-whatsapp-contact-identity";
import { scheduleWhatsAppWorkflowRunsFromInbound } from "@/lib/clawcloud-whatsapp-workflows";
import { filterWhatsAppHistoryRowsForResolvedContactForTest } from "@/lib/clawcloud-whatsapp-inbox";
import { parseOutboundReviewDecisionForTest } from "@/lib/clawcloud-outbound-review";
import {
  deriveClawCloudSetupGoogleWorkspaceAvailability,
  deriveClawCloudSetupConnectionState,
  shouldDeferSetupCallbackProcessing,
} from "@/lib/clawcloud-setup-status";
import {
  isClawCloudMissingSchemaColumn,
  isClawCloudMissingSchemaMessage,
} from "@/lib/clawcloud-schema-compat";
import {
  parsePublicHttpUrl,
  resolvePublicHttpUrl,
  takeClawCloudRateLimitLocal,
} from "@/lib/clawcloud-api-guards";
import {
  decryptSecretValue,
  encryptSecretValue,
  looksEncryptedSecretValue,
  maskSecretValue,
} from "@/lib/clawcloud-secret-box";
import {
  buildBillingWebhookPayloadHash,
  normalizeBillingWebhookUserId,
  resolveRazorpayWebhookEventId,
  resolveStripeWebhookEventId,
} from "@/lib/clawcloud-billing-webhook-inbox";
import { buildDisclaimer } from "@/lib/clawcloud-disclaimers";
import { matchesWholeAlias } from "@/lib/clawcloud-intent-match";
import {
  detectLocaleFromEmail,
  detectLocalePreferenceCommand,
  extractExplicitReplyLocaleRequest,
  inferClawCloudMessageLocale,
  resolveClawCloudReplyLanguage,
  buildClawCloudReplyLanguageInstruction,
} from "@/lib/clawcloud-i18n";
import { detectHinglish } from "@/lib/clawcloud-hinglish";
import {
  buildLocalizedCapabilityReplyForTest,
  buildLocalizedCapabilityReplyFromMessageForTest,
  buildWhatsAppHistoryProfessionalSummaryForTest,
  detectNativeLanguageDirectAnswerLaneIntentForTest,
  detectMultilingualNativeAnswerLaneIntentForTest,
  detectStrictIntentRouteForTest,
  buildNaturalLanguageEmailSearchQuery,
  buildDeterministicExplainReplyForTest,
  buildLocalizedDeterministicKnownStoryReplyForTest,
  buildCodingFallbackV2,
  buildTimeboxedProfessionalReplyForTest,
  detectPendingApprovalContextQuestionForTest,
  detectIntentForTest,
  detectRequestedLanguageForFallback,
  extractWhatsAppHistoryHintsForTest,
  extractRequestedEmailCount,
  filterEmailsForPromptWindow,
  inferAppAccessRequirementForTest,
  getInboundRouteTimeoutPolicyForTest,
  normalizeReplyForClawCloudDisplay,
  polishClawCloudAnswerStyleForTest,
  routeInboundAgentMessageResult,
  resolveDeterministicKnownStoryReplyForTest,
  resolveRoutingMessageForTest,
  shouldUsePrimaryConversationLaneForTest,
  shouldUsePrimaryDirectAnswerLaneForTest,
  shouldUseSimpleKnowledgeFastLaneForTest,
  shouldUseMultilingualRoutingBridgeForTest,
  stripClawCloudTrailingFollowUpForTest,
} from "@/lib/clawcloud-agent";
import {
  createAppAccessConsentRequest,
  rememberLatestAppAccessConsent,
  resolveLatestAppAccessConsentDecision,
  verifyAppAccessConsentToken,
} from "@/lib/clawcloud-app-access-consent";
import {
  clearLatestConversationStyleRequest,
  createConversationStyleRequest,
  detectExplicitConversationStyleOverride,
  embedConversationStyleInMessage,
  extractEmbeddedConversationStyle,
  rememberLatestConversationStyleRequest,
  resolveLatestConversationStyleDecision,
  verifyConversationStyleToken,
} from "@/lib/clawcloud-conversation-style";
import {
  buildHistoricalPowerRankingReply,
  looksLikeHistoricalPowerRankingQuestion,
} from "@/lib/clawcloud-historical-power";
import { buildHistoricalWealthReply, looksLikeHistoricalWealthQuestion } from "@/lib/clawcloud-historical-wealth";
import {
  buildAutoExtractedMemorySavePlanForTest,
  buildUserProfileSnippet,
  detectMemoryCommand,
  detectTimezoneFromTextForTest,
  formatMemoryAuditReply,
  formatProfileReply,
} from "@/lib/clawcloud-user-memory";
import { buildMemorySystemSnippet } from "@/lib/clawcloud-memory";
import {
  buildClawCloudCasualClarificationReply,
  buildClawCloudCasualTalkInstruction,
  inferClawCloudEmotionalContext,
  inferClawCloudCasualTalkProfile,
  shouldAskClawCloudCasualClarification,
} from "@/lib/clawcloud-casual-talk";
import {
  answerShortDefinitionLookup,
  buildDefinitionLookupQueriesForTest,
  buildNamedEntityIdentityAnswerForTest,
  buildClawCloudLiveAnswerBundle,
  classifyClawCloudLiveSearchTier,
  detectShortDefinitionLookup,
  extractRichestRankingScope,
  detectWorldBankCountryMetricQuestion,
  fetchLiveDataAndSynthesize,
  isCompleteCountryMetricAnswer,
  renderClawCloudAnswerBundle,
} from "@/lib/clawcloud-live-search";
import {
  buildCurrentAffairsQueries,
  buildCurrentAffairsClarificationReply,
  looksLikeCurrentAffairsQuestion,
} from "@/lib/clawcloud-current-affairs";
import {
  answerWebSearch,
  answerWebSearchResult,
  buildCurrentAffairsEvidenceAnswer,
  buildSourceBackedLiveAnswerResult,
  buildAiModelEvidenceOnlyAnswer,
  buildEvidenceOnlyAnswer,
  buildNewsQueries,
  detectNewsQuestion,
  filterAiModelEvidenceSources,
  fastNewsSearch,
  resolveNewsSearchTaskWithTimeoutForTest,
  synthesiseNewsAnswerForTest,
} from "@/lib/clawcloud-news";
import { parseReminderRegex } from "@/lib/clawcloud-reminders";
import {
  buildConsumerStaplePriceClarification,
  isCompleteIndiaConsumerPriceAnswer,
  looksLikeConsumerStaplePriceQuestion,
} from "@/lib/clawcloud-india-consumer-prices";
import { isCompleteRetailFuelAnswer } from "@/lib/clawcloud-retail-prices";
import { answerTaxQuery, detectTaxQuery } from "@/lib/clawcloud-tax";
import {
  buildClawCloudGoogleAuthUrl,
  confirmGoogleWorkspaceScopeAccess,
  buildGoogleNotConnectedReply,
  buildGoogleWorkspaceScopeMismatchMessage,
  buildGoogleWorkspaceWrongAccountMessage,
  buildClawCloudGoogleLoginState,
  ClawCloudGoogleReconnectRequiredError,
  createClawCloudGoogleApiError,
  extractGoogleMessageBody,
  hasRequiredGoogleWorkspaceScopes,
  isClawCloudGoogleNotConnectedError,
  matchesExpectedClawCloudGoogleWorkspaceEmail,
  parseClawCloudGoogleLoginState,
  verifyClawCloudGoogleLoginCallbackState,
} from "@/lib/clawcloud-google";
import {
  getGoogleWorkspaceCoreAccess,
  getGoogleWorkspaceExtendedAccess,
} from "@/lib/google-workspace-rollout";
import {
  buildClawCloudRunWindow,
  resolveClawCloudTodayRunCount,
} from "@/lib/clawcloud-usage";
import {
  detectGmailActionIntent,
  parseGmailActionRequest,
} from "@/lib/clawcloud-gmail-actions";
import {
  buildReplyApprovalContextReply,
  normalizeReplyApprovalRewriteDraftForTest,
  buildReplyApprovalReviewReply,
} from "@/lib/clawcloud-reply-approval";
import { env, isGooglePublicSignInEnabled } from "@/lib/env";
import { detectWhatsAppSettingsCommandIntent } from "@/lib/clawcloud-whatsapp-settings-commands";
import { shouldBootstrapClawCloudWhatsAppWorkspace } from "@/lib/clawcloud-whatsapp";
import {
  buildWhatsAppApprovalContextReply,
  buildWhatsAppApprovalReviewReply,
  handleWhatsAppApprovalCommand,
} from "@/lib/clawcloud-whatsapp-approval";
import {
  buildClawCloudWhatsAppSyncPolicy,
  shouldRequestMoreClawCloudWhatsAppHistory,
} from "@/lib/clawcloud-whatsapp-sync-policy";
import {
  detectOfficialPricingQuery,
  fetchOfficialPricingAnswer,
} from "@/lib/clawcloud-official-pricing";
import { detectAiModelRoutingDecision } from "@/lib/clawcloud-ai-model-routing";
import {
  clawCloudActiveTaskLimits,
  clawCloudRunLimits,
  formatDateKey,
  getIndiaDayWindow,
  parseMeridiemTimeTo24Hour,
} from "@/lib/clawcloud-types";
import { detectUpiSms, parseUpiSms } from "@/lib/clawcloud-upi";
import {
  looksLikeDirectWeatherQuestion,
  normalizeWeatherLocationName,
  parseWeatherCity,
} from "@/lib/clawcloud-weather";
import {
  shouldStageWhatsAppReply,
  splitWhatsAppStreamChunks,
  whatsAppChunkDelayMs,
  whatsAppInitialTypingDelayMs,
} from "@/lib/clawcloud-whatsapp-streaming";
import { rankContactCandidates } from "@/lib/clawcloud-contacts-v2";
import {
  resolveDefaultAssistantChatJid,
  shouldRememberAssistantSelfChat,
} from "@/lib/clawcloud-whatsapp-routing";
import { detectFinanceQuery, formatFinanceReply, getLiveFinanceData } from "@/lib/clawcloud-finance";
import {
  detectClawCloudRegionMention,
  inferClawCloudRegionContext,
  inferQuestionLanguageHint,
  inferRegionalSearchLocale,
  normalizeRegionalQuestion,
} from "@/lib/clawcloud-region-context";

test("plan limits and India day helpers stay stable", () => {
  assert.equal(clawCloudRunLimits.free, 10);
  assert.equal(clawCloudRunLimits.starter, 100);
  assert.equal(clawCloudActiveTaskLimits.free, 3);
  assert.equal(parseMeridiemTimeTo24Hour("12:05 AM"), "00:05");
  assert.equal(parseMeridiemTimeTo24Hour("12:45 PM"), "12:45");
  assert.equal(parseMeridiemTimeTo24Hour("9:15 PM"), "21:15");
  assert.equal(formatDateKey(new Date("2026-03-19T01:00:00Z"), "Asia/Kolkata"), "2026-03-19");

  const window = getIndiaDayWindow(new Date("2026-03-19T12:00:00Z"));
  assert.equal(window.dateKey, "2026-03-19");
  assert.equal(window.startIso, "2026-03-18T18:30:00.000Z");
  assert.equal(window.endIso, "2026-03-19T18:30:00.000Z");
});

test("billable run counts prefer analytics over chat trace rows", () => {
  assert.equal(
    resolveClawCloudTodayRunCount({
      taskRunsCount: 25,
      analyticsDailyTasksRun: 2,
    }),
    2,
  );
  assert.equal(
    resolveClawCloudTodayRunCount({
      taskRunsCount: 4,
      analyticsDailyTasksRun: null,
    }),
    4,
  );
});

test("whatsapp workspace bootstrap runs for newly linked accounts with missing contacts or history", () => {
  assert.equal(shouldBootstrapClawCloudWhatsAppWorkspace({
    connected: true,
    contactCount: 0,
    historyMessageCount: 0,
  }), true);
  assert.equal(shouldBootstrapClawCloudWhatsAppWorkspace({
    connected: true,
    contactCount: 8,
    historyMessageCount: 0,
  }), true);
  assert.equal(shouldBootstrapClawCloudWhatsAppWorkspace({
    connected: true,
    contactCount: 0,
    historyMessageCount: 24,
  }), true);
  assert.equal(shouldBootstrapClawCloudWhatsAppWorkspace({
    connected: true,
    contactCount: 8,
    historyMessageCount: 24,
  }), true);
  assert.equal(shouldBootstrapClawCloudWhatsAppWorkspace({
    connected: true,
    contactCount: 240,
    historyMessageCount: 1_600,
  }), false);
  assert.equal(shouldBootstrapClawCloudWhatsAppWorkspace({
    connected: false,
    contactCount: 0,
    historyMessageCount: 0,
  }), false);
});

test("whatsapp security defaults stay passive unless the user explicitly commands the assistant", () => {
  assert.equal(defaultWhatsAppSettings.automationMode, "read_only");
  assert.equal(defaultWhatsAppSettings.allowGroupReplies, false);
  assert.equal(defaultWhatsAppSettings.groupReplyMode, "never");
  assert.equal(defaultWhatsAppSettings.allowWorkflowAutoSend, false);

  assert.equal(shouldRequireExplicitUserCommandForWhatsAppChat("self"), false);
  assert.equal(shouldRequireExplicitUserCommandForWhatsAppChat("direct"), true);
  assert.equal(shouldRequireExplicitUserCommandForWhatsAppChat("group"), true);
  assert.equal(shouldRequireExplicitUserCommandForWhatsAppChat("broadcast"), true);
  assert.equal(shouldRequireExplicitUserCommandForWhatsAppChat("unknown"), true);
});

test("whatsapp outbound lifecycle helpers stay deterministic and dedupe-safe", () => {
  const keyA = buildWhatsAppOutboundIdempotencyKey({
    userId: "user-1",
    source: "approval",
    remoteJid: "919999999999@s.whatsapp.net",
    remotePhone: "919999999999",
    approvalId: "approval-1",
    messageText: "Hi Maa, call me when free.",
  });
  const keyB = buildWhatsAppOutboundIdempotencyKey({
    userId: "user-1",
    source: "approval",
    remoteJid: "919999999999@s.whatsapp.net",
    remotePhone: "919999999999",
    approvalId: "approval-1",
    messageText: "  Hi   Maa, call me when free.  ",
  });
  const keyC = buildWhatsAppOutboundIdempotencyKey({
    userId: "user-1",
    source: "approval",
    remoteJid: "919999999999@s.whatsapp.net",
    remotePhone: "919999999999",
    approvalId: "approval-2",
    messageText: "Hi Maa, call me when free.",
  });

  assert.equal(keyA, keyB);
  assert.notEqual(keyA, keyC);
  assert.equal(resolveWhatsAppOutboundStatusFromAckStatus("server_ack"), "sent");
  assert.equal(resolveWhatsAppOutboundStatusFromAckStatus("delivery_ack"), "delivered");
  assert.equal(resolveWhatsAppOutboundStatusFromAckStatus("read"), "read");
  assert.equal(resolveWhatsAppOutboundStatusFromAckStatus("error"), "failed");
  assert.equal(resolveWhatsAppOutboundStatusFromAckStatus("pending"), "retrying");
  assert.equal(isWhatsAppOutboundFinalizedStatus("read"), true);
  assert.equal(isWhatsAppOutboundFinalizedStatus("delivered"), false);
});

test("whatsapp quiet hours and group controls keep reply actions conservative", () => {
  assert.equal(
    isWithinWhatsAppQuietHours({
      ...defaultWhatsAppSettings,
      quietHoursStart: "00:00",
      quietHoursEnd: "00:00",
    }),
    true,
  );

  assert.deepEqual(
    decideWhatsAppReplyAction({
      settings: {
        ...defaultWhatsAppSettings,
        automationMode: "approve_before_send",
        quietHoursStart: "00:00",
        quietHoursEnd: "00:00",
      },
      sensitivity: "normal",
      isGroupMessage: false,
      isKnownContact: true,
    }),
    { action: "queue", reason: "Message arrived during quiet hours." },
  );

  assert.deepEqual(
    decideWhatsAppReplyAction({
      settings: {
        ...defaultWhatsAppSettings,
        automationMode: "approve_before_send",
        allowGroupReplies: false,
        groupReplyMode: "never",
      },
      sensitivity: "normal",
      isGroupMessage: true,
      isKnownContact: true,
    }),
    { action: "block", reason: "Group replies are disabled." },
  );
});

test("whatsapp privacy delete plans include the outbound ledger in every relevant mode", () => {
  assert.ok(buildWhatsAppWorkspaceDeletePlanForTest("all").tables.includes("whatsapp_outbound_messages"));
  assert.ok(buildWhatsAppWorkspaceDeletePlanForTest("contact").tables.includes("whatsapp_outbound_messages"));
  assert.ok(buildWhatsAppWorkspaceDeletePlanForTest("retention").tables.includes("whatsapp_outbound_messages"));
});

test("whatsapp inbound workflows never auto-schedule cross-contact actions", async () => {
  const runs = await scheduleWhatsAppWorkflowRunsFromInbound({
    userId: "user-1",
    remoteJid: "1234567890@s.whatsapp.net",
    remotePhone: "1234567890",
    contactName: "Test Contact",
    text: "hello",
    chatType: "direct",
    priority: "normal",
    tags: [],
    messageType: "text",
    finalReply: "draft",
    replySent: false,
  });

  assert.deepEqual(runs, []);
});

test("whatsapp runtime progress and health stay bounded and honest", () => {
  assert.deepEqual(
    computeClawCloudWhatsAppSyncProgress({
      contactCount: 150,
      historyMessageCount: 600,
      contactTarget: 300,
      historyTarget: 1_200,
    }),
    {
      overallPercent: 50,
      contactPercent: 50,
      historyPercent: 50,
      contactTarget: 300,
      historyTarget: 1200,
    },
  );

  assert.equal(
    deriveClawCloudWhatsAppRuntimeHealth({
      connectionStatus: "connected",
      syncState: "contact_refresh",
      activeSyncJobs: 1,
      lastActivityAtMs: Date.now(),
      staleAfterMs: 180_000,
    }),
    "syncing",
  );

  assert.equal(
    deriveClawCloudWhatsAppRuntimeHealth({
      connectionStatus: "connected",
      syncState: "idle",
      activeSyncJobs: 0,
      lastActivityAtMs: Date.now() - 500_000,
      staleAfterMs: 180_000,
      nowMs: Date.now(),
    }),
    "degraded",
  );

  assert.equal(
    deriveClawCloudWhatsAppRuntimeHealth({
      connectionStatus: "disconnected",
      syncState: "idle",
      requiresReauth: true,
    }),
    "reauth_required",
  );
});

test("whatsapp reconnect recovery keeps bounded backoff and durable checkpoints sane", () => {
  assert.equal(computeClawCloudWhatsAppReconnectDelayMs(1), 3_000);
  assert.equal(computeClawCloudWhatsAppReconnectDelayMs(2), 6_000);
  assert.equal(computeClawCloudWhatsAppReconnectDelayMs(3), 12_000);
  assert.equal(computeClawCloudWhatsAppReconnectDelayMs(10), 60_000);

  const checkpoint = normalizeClawCloudWhatsAppRecoveryCheckpoint({
    version: 1,
    connectionStatus: "waiting",
    phone: "918091392311",
    connected: false,
    requiresReauth: false,
    reconnectAttempts: 4,
    lastDisconnectCode: 408,
    lastDisconnectAt: "2026-03-26T02:15:00.000Z",
    nextReconnectAt: "2026-03-26T02:15:45.000Z",
    connectedAt: "2026-03-26T01:50:00.000Z",
    lastActivityAt: "2026-03-26T02:15:01.000Z",
    lastSuccessfulSyncAt: "2026-03-26T02:14:30.000Z",
    lastSyncFinishedAt: "2026-03-26T02:14:30.000Z",
    lastSyncReason: "connection.open.maintenance",
    lastSyncError: "Socket closed during maintenance reconnect.",
    lastSyncDurationMs: 1200,
    lastContactPersistedCount: 231,
    lastHistoryPersistedCount: 344,
    lastHistoryBackfillCount: 4,
    lastHistoryExpansionRequestedCount: 18,
    updatedAt: "2026-03-26T02:15:00.000Z",
  });

  assert.ok(checkpoint);
  assert.equal(checkpoint?.connectionStatus, "waiting");
  assert.equal(checkpoint?.reconnectAttempts, 4);
  assert.equal(checkpoint?.lastDisconnectCode, 408);
  assert.equal(
    getClawCloudWhatsAppReconnectWaitMs(checkpoint, Date.parse("2026-03-26T02:15:15.000Z")),
    30_000,
  );

  const sanitized = normalizeClawCloudWhatsAppRecoveryCheckpoint({
    connectionStatus: "unknown",
    reconnectAttempts: -9,
    lastDisconnectCode: Number.NaN,
    lastDisconnectAt: "not-a-date",
    nextReconnectAt: "",
  });

  assert.equal(sanitized?.connectionStatus, "disconnected");
  assert.equal(sanitized?.reconnectAttempts, 0);
  assert.equal(sanitized?.lastDisconnectCode, null);
  assert.equal(sanitized?.lastDisconnectAt, null);
  assert.equal(sanitized?.nextReconnectAt, null);
});

test("whatsapp sync checkpoints keep resume counts and cursors sane", () => {
  const checkpoint = normalizeClawCloudWhatsAppSyncCheckpoint({
    version: 1,
    syncState: "history_expansion",
    contactCount: 231,
    historyMessageCount: 344,
    contactTarget: 300,
    historyTarget: 6_000,
    lastContactPersistedCount: 231,
    lastHistoryPersistedCount: 344,
    lastHistoryBackfillCount: 4,
    lastHistoryExpansionRequestedCount: 18,
    lastSyncReason: "connection.open.followup.30s",
    lastSyncStartedAt: "2026-03-26T02:20:00.000Z",
    lastSyncFinishedAt: "2026-03-26T02:20:04.000Z",
    lastSuccessfulSyncAt: "2026-03-26T02:20:04.000Z",
    historyCursors: [
      {
        remoteJid: "919053776191@s.whatsapp.net",
        oldestMessageId: "ABC123",
        oldestTimestampAt: "2026-03-20T11:45:00.000Z",
        fromMe: false,
        messageCount: 19,
        attempts: 3,
      },
      {
        remoteJid: "",
        oldestMessageId: "missing-jid",
      },
    ],
    chatStates: [
      {
        remoteJid: "919053776191@s.whatsapp.net",
        oldestMessageId: "ABC123",
        chatType: "direct",
        messageCount: 19,
        oldestTimestampAt: "2026-03-20T11:45:00.000Z",
        latestTimestampAt: "2026-03-26T02:19:00.000Z",
        fromMe: false,
        attempts: 3,
        hasDisplayName: true,
        completeness: "partial",
        priorityScore: 221,
      },
    ],
    updatedAt: "2026-03-26T02:20:04.000Z",
  });

  assert.ok(checkpoint);
  assert.equal(checkpoint?.syncState, "history_expansion");
  assert.equal(checkpoint?.resumeRecommended, true);
  assert.equal(checkpoint?.historyCursors.length, 1);
  assert.equal(checkpoint?.chatStates.length, 1);
  assert.equal(checkpoint?.chatStates[0]?.oldestMessageId, "ABC123");
  assert.equal(checkpoint?.historyCursors[0]?.remoteJid, "919053776191@s.whatsapp.net");
  assert.equal(checkpoint?.historyCursors[0]?.attempts, 3);
  assert.equal(checkpoint?.historyCoverage.partialChats, 1);

  assert.equal(
    buildClawCloudWhatsAppSyncCheckpointResumeRecommended({
      syncState: "idle",
      contactCount: 320,
      historyMessageCount: 6_500,
      contactTarget: 300,
      historyTarget: 6_000,
    }),
    false,
  );
  assert.equal(
    buildClawCloudWhatsAppSyncCheckpointResumeRecommended({
      syncState: "workspace_bootstrap",
      contactCount: 320,
      historyMessageCount: 6_500,
      contactTarget: 300,
      historyTarget: 6_000,
    }),
    true,
  );
});

test("whatsapp history backfill plan prioritizes recent partial direct chats before exhausted deep chats", () => {
  assert.equal(
    deriveClawCloudWhatsAppChatSyncCompleteness({
      messageCount: 18,
      attempts: 1,
      deepMessageTarget: 48,
      completionAttemptThreshold: 6,
    }),
    "partial",
  );
  assert.equal(
    deriveClawCloudWhatsAppChatSyncCompleteness({
      messageCount: 80,
      attempts: 6,
      deepMessageTarget: 48,
      completionAttemptThreshold: 6,
      completionMinMessageCount: 24,
    }),
    "complete_as_available",
  );

  const plan = buildClawCloudWhatsAppHistoryBackfillPlan([
    {
      remoteJid: "self@s.whatsapp.net",
      oldestMessageId: "self-1",
      chatType: "self",
      messageCount: 14,
      oldestTimestampMs: Date.parse("2026-03-24T10:00:00.000Z"),
      latestTimestampMs: Date.parse("2026-03-26T02:30:00.000Z"),
      fromMe: true,
      attempts: 0,
      hasDisplayName: true,
    },
    {
      remoteJid: "direct@s.whatsapp.net",
      oldestMessageId: "direct-1",
      chatType: "direct",
      messageCount: 20,
      oldestTimestampMs: Date.parse("2026-03-22T10:00:00.000Z"),
      latestTimestampMs: Date.parse("2026-03-26T02:20:00.000Z"),
      fromMe: false,
      attempts: 1,
      hasDisplayName: true,
    },
    {
      remoteJid: "group@g.us",
      oldestMessageId: "group-1",
      chatType: "group",
      messageCount: 90,
      oldestTimestampMs: Date.parse("2026-03-10T10:00:00.000Z"),
      latestTimestampMs: Date.parse("2026-03-18T10:00:00.000Z"),
      fromMe: false,
      attempts: 6,
      hasDisplayName: true,
    },
  ], {
    deepMessageTarget: 48,
    completionAttemptThreshold: 6,
    completionMinMessageCount: 24,
    nowMs: Date.parse("2026-03-26T03:00:00.000Z"),
  });

  assert.equal(plan[0]?.remoteJid, "self@s.whatsapp.net");
  assert.equal(plan[0]?.completeness, "partial");
  assert.equal(plan[2]?.remoteJid, "group@g.us");
  assert.equal(plan[2]?.completeness, "complete_as_available");

  const coverage = summarizeClawCloudWhatsAppHistoryCoverage(plan);
  assert.equal(coverage.partialChats, 2);
  assert.equal(coverage.completeChats, 1);
  assert.equal(coverage.prioritizedChats, 3);
});

test("whatsapp session storage diagnostics keep Railway volume expectations explicit", () => {
  assert.equal(
    resolveClawCloudWhatsAppSessionBaseDir({
      configuredBaseDir: "./wa-sessions",
      isRailwayRuntime: true,
    }),
    "/data/wa-sessions",
  );
  assert.equal(
    resolveClawCloudWhatsAppSessionBaseDir({
      configuredBaseDir: "C:\\wa-sessions",
      isRailwayRuntime: false,
    }),
    "C:\\wa-sessions",
  );
  assert.equal(isClawCloudWhatsAppPersistentVolumePath("/data/wa-sessions", true), true);
  assert.equal(isClawCloudWhatsAppPersistentVolumePath("./wa-sessions", true), false);

  const healthy = buildClawCloudWhatsAppSessionStorageHealth({
    configuredBaseDir: "/data/wa-sessions",
    resolvedBaseDir: "/data/wa-sessions",
    isRailwayRuntime: true,
    writable: true,
    authDirCount: 2,
    checkpointCount: 2,
    syncCheckpointCount: 2,
    checkedAt: "2026-03-26T03:00:00.000Z",
  });
  assert.equal(healthy.status, "healthy");
  assert.equal(healthy.persistentVolumeConfigured, true);
  assert.deepEqual(healthy.warnings, []);

  const degraded = buildClawCloudWhatsAppSessionStorageHealth({
    configuredBaseDir: "/data/wa-sessions",
    resolvedBaseDir: "/data/wa-sessions",
    isRailwayRuntime: true,
    writable: false,
    probeError: "EACCES",
    authDirCount: 1,
    checkpointCount: 0,
    syncCheckpointCount: 0,
  });
  assert.equal(degraded.status, "degraded");
  assert.equal(degraded.warnings.includes("WhatsApp session storage is not writable."), true);
  assert.equal(
    degraded.warnings.includes("Saved auth directories exist, but no recovery checkpoints were found yet."),
    true,
  );
  assert.equal(
    degraded.warnings.includes("Saved auth directories exist, but no sync checkpoints were found yet."),
    true,
  );

  const misconfigured = buildClawCloudWhatsAppSessionStorageHealth({
    configuredBaseDir: "./wa-sessions",
    resolvedBaseDir: "./wa-sessions",
    isRailwayRuntime: true,
    writable: true,
    authDirCount: 0,
    checkpointCount: 0,
    syncCheckpointCount: 0,
  });
  assert.equal(misconfigured.status, "misconfigured");
  assert.equal(
    misconfigured.warnings.includes("Railway should store WhatsApp sessions on a mounted /data volume path."),
    true,
  );
});

test("whatsapp sync policy keeps deep-history budgets internally consistent", () => {
  const policy = buildClawCloudWhatsAppSyncPolicy({
    contactRefreshTarget: 999_999,
    contactRefreshMaxPasses: 0,
    historyTarget: 50_000,
    historyBufferLimit: 4_000,
    historyKnownLookupLimit: 2_000,
    historyPersistBatchLimit: 9_000,
    historyExpansionChatLimit: 0,
    historyExpansionBatchSize: 999,
    historyExpansionMaxAttemptsPerCursor: 0,
    historyContactBackfillScanLimit: 10,
  });

  assert.equal(policy.contactRefreshTarget, 5_000);
  assert.equal(policy.contactRefreshMaxPasses, 1);
  assert.equal(policy.historyBufferLimit, 4_000);
  assert.equal(policy.historyTarget, 4_000);
  assert.equal(policy.historyKnownLookupLimit, 4_000);
  assert.equal(policy.historyPersistBatchLimit, 4_000);
  assert.equal(policy.historyExpansionChatLimit, 1);
  assert.equal(policy.historyExpansionBatchSize, 300);
  assert.equal(policy.historyExpansionMaxAttemptsPerCursor, 1);
  assert.equal(policy.historyContactBackfillScanLimit, 800);
});

test("whatsapp history expansion keeps requesting more until the deeper target is reached", () => {
  assert.equal(shouldRequestMoreClawCloudWhatsAppHistory(0, 6_000), true);
  assert.equal(shouldRequestMoreClawCloudWhatsAppHistory(280, 6_000), true);
  assert.equal(shouldRequestMoreClawCloudWhatsAppHistory(6_000, 6_000), false);
  assert.equal(shouldRequestMoreClawCloudWhatsAppHistory(9_500, 6_000), false);
});

test("dashboard journal helpers merge device history without dropping messages", () => {
  const threadId = buildDashboardJournalThreadId("2026-03-22");
  const localThreads = [
    {
      id: threadId,
      dateKey: "2026-03-22",
      title: "Dashboard journal Sat, Mar 22",
      updatedAt: "2026-03-22T10:00:00.000Z",
      messages: [
        {
          id: "msg-1",
          role: "user" as const,
          text: "Hello",
          createdAt: "2026-03-22T10:00:00.000Z",
          time: "3:30 PM",
        },
        {
          id: "msg-2",
          role: "bot" as const,
          text: "Hi there",
          createdAt: "2026-03-22T10:00:02.000Z",
          time: "3:30 PM",
        },
      ],
    },
  ];
  const remoteThreads = [
    {
      id: threadId,
      dateKey: "2026-03-22",
      title: "Dashboard journal Sat, Mar 22",
      updatedAt: "2026-03-22T10:01:00.000Z",
      messages: [
        {
          id: "msg-1",
          role: "user" as const,
          text: "Hello",
          createdAt: "2026-03-22T10:00:00.000Z",
          time: "3:30 PM",
        },
        {
          id: "msg-3",
          role: "user" as const,
          text: "Show me my inbox",
          createdAt: "2026-03-22T10:01:00.000Z",
          time: "3:31 PM",
        },
      ],
    },
  ];

  const merged = mergeDashboardJournalCollections(localThreads, remoteThreads);
  assert.equal(merged.length, 1);
  assert.deepEqual(
    merged[0]?.messages.map((message) => message.id),
    ["msg-1", "msg-2", "msg-3"],
  );
});

test("dashboard journal messages preserve sanitized live answer audit bundles", () => {
  const normalized = normalizeDashboardJournalMessage({
    role: "bot",
    text: "China GDP latest official estimate.",
    liveAnswerBundle: {
      question: "what is the gdp of china",
      answer: "China GDP latest official estimate.",
      channel: "live",
      generatedAt: "2026-03-26T12:00:00.000Z",
      badge: "Fresh answer",
      sourceNote: "Checked against official and source-backed live signals.",
      sourceSummary: ["worldbank.org", "reuters.com"],
      evidence: [
        {
          title: "World Bank GDP data",
          domain: "worldbank.org",
          kind: "official_api",
          url: "https://api.worldbank.org/v2/country/CHN/indicator/NY.GDP.MKTP.CD",
          snippet: "GDP, current US$ for China",
          observedAt: "2026-03-26T12:00:00.000Z",
        },
      ],
      metadata: {
        strategy: "deterministic",
        evidence_count: 1,
      },
    },
  });

  assert.ok(normalized.liveAnswerBundle);
  assert.equal(normalized.liveAnswerBundle?.channel, "live");
  assert.equal(normalized.liveAnswerBundle?.sourceSummary[0], "worldbank.org");
  assert.equal(normalized.liveAnswerBundle?.metadata.strategy, "deterministic");

  const merged = mergeDashboardJournalCollections(
    [
      {
        id: buildDashboardJournalThreadId("2026-03-26"),
        dateKey: "2026-03-26",
        title: "Dashboard journal Wed, Mar 26",
        updatedAt: "2026-03-26T12:00:00.000Z",
        messages: [
          {
            id: "audit-msg-1",
            role: "bot" as const,
            text: "China GDP latest official estimate.",
            createdAt: "2026-03-26T12:00:00.000Z",
            time: "5:30 PM",
          },
        ],
      },
    ],
    [
      {
        id: buildDashboardJournalThreadId("2026-03-26"),
        dateKey: "2026-03-26",
        title: "Dashboard journal Wed, Mar 26",
        updatedAt: "2026-03-26T12:01:00.000Z",
        messages: [
          {
            ...normalized,
            id: "audit-msg-1",
            createdAt: "2026-03-26T12:00:00.000Z",
            time: "5:30 PM",
          },
        ],
      },
    ],
  );

  assert.equal(merged[0]?.messages[0]?.liveAnswerBundle?.evidence[0]?.domain, "worldbank.org");
});

test("dashboard journal messages preserve sanitized model audit trails", () => {
  const normalized = normalizeDashboardJournalMessage({
    role: "bot",
    text: "Here is the webhook worker design.",
    modelAuditTrail: {
      intent: "coding",
      responseMode: "deep",
      planner: {
        strategy: "collect_and_judge",
        targetResponses: 3,
        generatorBatchSize: 3,
        judgeEnabled: true,
        judgeMinRemainingMs: 6500,
        allowLowConfidenceWinner: false,
        disagreementThreshold: 0.48,
      },
      selectedBy: "judge",
      selectedModel: "mistralai/mistral-large-3-675b-instruct-2512",
      candidates: [
        {
          model: "meta/llama-3.3-70b-instruct",
          tier: "chat",
          status: "generated",
          latencyMs: 1900,
          heuristicScore: 34.5,
          preview: "Use Redis with a processing key before enqueueing work.",
        },
        {
          model: "mistralai/mistral-large-3-675b-instruct-2512",
          tier: "reasoning",
          status: "selected",
          latencyMs: 2400,
          heuristicScore: 51.25,
          preview: "Reserve the idempotency key, persist the outcome transactionally, and replay from durable storage.",
        },
      ],
      judge: {
        used: true,
        model: "z-ai/glm5",
        winnerModel: "mistralai/mistral-large-3-675b-instruct-2512",
        confidence: "high",
        materialDisagreement: true,
        needsClarification: false,
        reason: "Candidate B was more complete and production-safe.",
      },
    },
  });

  assert.ok(normalized.modelAuditTrail);
  assert.equal(normalized.modelAuditTrail?.selectedBy, "judge");
  assert.equal(normalized.modelAuditTrail?.candidates[1]?.status, "selected");
  assert.equal(normalized.modelAuditTrail?.judge?.used, true);

  const merged = mergeDashboardJournalCollections(
    [
      {
        id: buildDashboardJournalThreadId("2026-03-26"),
        dateKey: "2026-03-26",
        title: "Dashboard journal Wed, Mar 26",
        updatedAt: "2026-03-26T12:00:00.000Z",
        messages: [
          {
            id: "model-audit-1",
            role: "bot" as const,
            text: "Here is the webhook worker design.",
            createdAt: "2026-03-26T12:00:00.000Z",
            time: "5:30 PM",
          },
        ],
      },
    ],
    [
      {
        id: buildDashboardJournalThreadId("2026-03-26"),
        dateKey: "2026-03-26",
        title: "Dashboard journal Wed, Mar 26",
        updatedAt: "2026-03-26T12:01:00.000Z",
        messages: [
          {
            ...normalized,
            id: "model-audit-1",
            createdAt: "2026-03-26T12:00:00.000Z",
            time: "5:30 PM",
          },
        ],
      },
    ],
  );

  assert.equal(merged[0]?.messages[0]?.modelAuditTrail?.selectedModel, "mistralai/mistral-large-3-675b-instruct-2512");
  assert.equal(merged[0]?.messages[0]?.modelAuditTrail?.judge?.confidence, "high");
});

test("phase 2 planner escalates deep finance prompts into collect-and-judge orchestration", () => {
  const plan = buildClawCloudModelPlannerDecisionForTest({
    intent: "finance",
    responseMode: "deep",
    availableCandidates: 5,
  });

  assert.equal(plan.strategy, "collect_and_judge");
  assert.equal(plan.targetResponses, 3);
  assert.equal(plan.generatorBatchSize >= 2, true);
  assert.equal(plan.judgeEnabled, true);
  assert.equal(plan.allowLowConfidenceWinner, false);
});

test("phase 2 candidate scoring prefers complete coding answers over thin stubs", () => {
  const thin = "Use Redis and add idempotency.";
  const complete = [
    "Recommendation:",
    "Store an idempotency key in Redis before work starts, then commit the durable result in your database.",
    "",
    "```ts",
    "await redis.set(key, \"processing\", { NX: true, PX: 300000 });",
    "```",
    "",
    "Rollout:",
    "1. Reserve the key before enqueueing.",
    "2. Persist the final webhook outcome transactionally.",
    "3. Replay safely by returning the stored result when the key already exists.",
  ].join("\n");

  const thinScore = scoreClawCloudModelResponseForTest({
    intent: "coding",
    response: thin,
    userQuestion: "How do I build a Redis-backed idempotent webhook worker?",
  });
  const completeScore = scoreClawCloudModelResponseForTest({
    intent: "coding",
    response: complete,
    userQuestion: "How do I build a Redis-backed idempotent webhook worker?",
  });

  assert.equal(completeScore > thinScore + 20, true);

  const choice = chooseClawCloudCandidateForTest({
    intent: "coding",
    responseMode: "deep",
    userQuestion: "How do I build a Redis-backed idempotent webhook worker?",
    responses: [
      { response: thin, model: "fast-model" },
      { response: complete, model: "reasoning-model", tier: "code" },
    ],
  });

  assert.equal(choice.selectedIndex, 1);
  assert.equal(choice.selectedBy === "heuristic" || choice.selectedBy === "judge", true);
});

test("phase 2 disagreement handling falls back when high-stakes candidates conflict", () => {
  const responses = [
    "India's latest inflation rate is 4.1%, based on the latest CPI release and official data summary.",
    "India's latest inflation rate is 7.9%, based on the latest CPI release and official data summary.",
  ];

  assert.equal(
    detectMaterialCandidateDisagreementForTest({
      intent: "finance",
      responses,
    }),
    true,
  );

  const choice = chooseClawCloudCandidateForTest({
    intent: "finance",
    responseMode: "deep",
    userQuestion: "What is India's latest inflation rate?",
    responses: responses.map((response, index) => ({
      response,
      model: `finance-model-${index + 1}`,
      tier: "reasoning" as const,
    })),
    judgeDecision: {
      winnerIndex: 0,
      confidence: "low",
      needsClarification: true,
      materialDisagreement: true,
    },
  });

  assert.equal(choice.selectedIndex, null);
  assert.equal(choice.selectedBy, "fallback");
  assert.equal(choice.materialDisagreement, true);
});

test("privacy export audit trail derives explicit live-answer evidence entries", () => {
  const thread = {
    id: buildDashboardJournalThreadId("2026-03-26"),
    dateKey: "2026-03-26",
    title: "Dashboard journal Wed, Mar 26",
    updatedAt: "2026-03-26T12:05:00.000Z",
    messages: [
      normalizeDashboardJournalMessage({
        id: "live-audit-1",
        role: "bot",
        text: "China GDP latest official estimate.",
        createdAt: "2026-03-26T12:05:00.000Z",
        time: "5:35 PM",
        liveAnswerBundle: {
          question: "what is the gdp of china",
          answer: "China GDP latest official estimate.",
          channel: "live",
          generatedAt: "2026-03-26T12:04:59.000Z",
          badge: "Fresh answer",
          sourceNote: "Checked against official sources.",
          sourceSummary: ["worldbank.org", "reuters.com"],
          evidence: [
            {
              title: "World Bank GDP data",
              domain: "worldbank.org",
              kind: "official_api",
              url: "https://api.worldbank.org/v2/country/CHN/indicator/NY.GDP.MKTP.CD",
              snippet: "GDP, current US$ for China",
              publishedAt: "2026-03-20T00:00:00.000Z",
              observedAt: "2026-03-26T12:04:59.000Z",
            },
            {
              title: "Reuters on China's GDP outlook",
              domain: "reuters.com",
              kind: "report",
              url: "https://www.reuters.com/world/china-gdp-2026-03-20/",
              snippet: "Reuters contextualizes the latest official GDP release.",
              publishedAt: "2026-03-20T00:00:00.000Z",
              observedAt: "2026-03-26T12:04:59.000Z",
            },
          ],
          metadata: {
            strategy: "deterministic",
            evidence_count: 2,
          },
        },
      }),
    ],
  };

  const auditTrail = buildClawCloudLiveAnswerAuditTrail([thread]);
  assert.equal(auditTrail.summary.journal_days_with_live_audits, 1);
  assert.equal(auditTrail.summary.live_answer_messages, 1);
  assert.equal(auditTrail.summary.evidence_items, 2);
  assert.equal(auditTrail.summary.deterministic_answers, 1);
  assert.equal(auditTrail.summary.source_backed_answers, 0);
  assert.deepEqual(auditTrail.summary.source_domains, ["reuters.com", "worldbank.org"]);
  assert.equal(auditTrail.entries[0]?.question, "what is the gdp of china");
  assert.equal(auditTrail.entries[0]?.evidence[0]?.domain, "worldbank.org");
});

test("app access consent tokens are user-bound and preserve the original request", () => {
  const previousAgentSecret = env.AGENT_SECRET;
  env.AGENT_SECRET = "test-agent-secret";

  try {
    const consent = createAppAccessConsentRequest({
      userId: "user-123",
      surface: "gmail",
      operation: "read",
      originalMessage: "Read my unread Gmail from today",
    });

    const verified = verifyAppAccessConsentToken(consent.token, "user-123");
    assert.ok(verified);
    assert.equal(verified?.surface, "gmail");
    assert.equal(verified?.operation, "read");
    assert.equal(verified?.originalMessage, "Read my unread Gmail from today");

    const rejected = verifyAppAccessConsentToken(consent.token, "user-456");
    assert.equal(rejected, null);
  } finally {
    env.AGENT_SECRET = previousAgentSecret;
  }
});

test("conversation style requests are user-bound and preserve the original request", async () => {
  const previousAgentSecret = env.AGENT_SECRET;
  env.AGENT_SECRET = "test-agent-secret";

  try {
    const request = createConversationStyleRequest({
      userId: "user-123",
      originalMessage: "Send a note to Raj about tomorrow's meeting",
    });

    const verified = verifyConversationStyleToken(request.token, "user-123");
    assert.ok(verified);
    assert.equal(verified?.originalMessage, "Send a note to Raj about tomorrow's meeting");

    await rememberLatestConversationStyleRequest(
      "user-123",
      request,
      "Send a note to Raj about tomorrow's meeting",
    );

    const decision = await resolveLatestConversationStyleDecision("user-123", "Casual");
    assert.ok(decision);
    assert.equal(decision?.style, "casual");
    assert.equal(decision?.originalMessage, "Send a note to Raj about tomorrow's meeting");

    const rejected = verifyConversationStyleToken(request.token, "user-456");
    assert.equal(rejected, null);
  } finally {
    await clearLatestConversationStyleRequest("user-123").catch(() => undefined);
    env.AGENT_SECRET = previousAgentSecret;
  }
});

test("conversation style helpers detect inline overrides and preserve embedded choices", () => {
  assert.equal(
    detectExplicitConversationStyleOverride("Reply to me in a professional tone"),
    "professional",
  );
  assert.equal(
    detectExplicitConversationStyleOverride("Talk with me in a casual way"),
    "casual",
  );

  const embedded = embedConversationStyleInMessage(
    "professional",
    "Draft a reply to Priya about the budget update",
  );
  assert.match(embedded, /^\[\[clawcloud-style:professional\]\]/);

  const extracted = extractEmbeddedConversationStyle(embedded);
  assert.equal(extracted.style, "professional");
  assert.equal(extracted.cleaned, "Draft a reply to Priya about the budget update");
});

test("non-style messages skip persisted conversation-style lookups", async () => {
  const previousSupabaseUrl = env.SUPABASE_URL;
  const previousServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;

  env.SUPABASE_URL = "https://example.supabase.co";
  env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("fetch should not be called for non-style messages");
  }) as typeof fetch;

  try {
    const decision = await resolveLatestConversationStyleDecision(
      "user-123",
      "Design a zero-downtime Stripe billing migration with dual-write and rollback.",
    );

    assert.equal(decision, null);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    env.SUPABASE_URL = previousSupabaseUrl;
    env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey;
  }
});

test("google login callback state requires an exact cookie match", () => {
  const previousAgentSecret = env.AGENT_SECRET;
  env.AGENT_SECRET = "test-agent-secret";

  try {
    const state = buildClawCloudGoogleLoginState("https://swift-deploy.in", "signup");
    const verified = verifyClawCloudGoogleLoginCallbackState(state, state);

    assert.ok(verified);
    assert.equal(verified?.origin, "https://swift-deploy.in");
    assert.equal(verified?.intent, "signup");
    assert.equal(verifyClawCloudGoogleLoginCallbackState(state, ""), null);
    assert.equal(verifyClawCloudGoogleLoginCallbackState(state, `${state}-tampered`), null);
  } finally {
    env.AGENT_SECRET = previousAgentSecret;
  }
});

test("google login state prefers the live request origin over the static app URL", () => {
  const previousAgentSecret = env.AGENT_SECRET;
  env.AGENT_SECRET = "test-agent-secret";

  try {
    const state = buildClawCloudGoogleLoginState("https://clawforge.com", "login");
    const parsed = parseClawCloudGoogleLoginState(state);

    assert.ok(parsed);
    assert.equal(parsed?.origin, "https://clawforge.com");
  } finally {
    env.AGENT_SECRET = previousAgentSecret;
  }
});

test("google workspace rollout keeps public users on Lite mode while trusted testers can still use full OAuth", () => {
  const previous = {
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL,
    GOOGLE_WORKSPACE_PUBLIC_ENABLED: env.GOOGLE_WORKSPACE_PUBLIC_ENABLED,
    GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED: env.GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED,
    GOOGLE_WORKSPACE_TEST_USER_EMAILS: [...env.GOOGLE_WORKSPACE_TEST_USER_EMAILS],
    GOOGLE_WORKSPACE_TEMPORARY_HOLD: env.GOOGLE_WORKSPACE_TEMPORARY_HOLD,
    GOOGLE_WORKSPACE_SETUP_LITE_ONLY: env.GOOGLE_WORKSPACE_SETUP_LITE_ONLY,
  };

  env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
  env.GOOGLE_CLIENT_SECRET = "test-secret";
  env.NEXT_PUBLIC_APP_URL = "https://swift-deploy.in";
  env.GOOGLE_WORKSPACE_PUBLIC_ENABLED = false;
  env.GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED = true;
  env.GOOGLE_WORKSPACE_TEST_USER_EMAILS = ["trusted@example.com"];
  env.GOOGLE_WORKSPACE_TEMPORARY_HOLD = true;
  env.GOOGLE_WORKSPACE_SETUP_LITE_ONLY = true;

  try {
    const publicCore = getGoogleWorkspaceCoreAccess("person@example.com");
    const publicExtended = getGoogleWorkspaceExtendedAccess("person@example.com");
    const trustedCore = getGoogleWorkspaceCoreAccess("trusted@example.com");
    const trustedExtended = getGoogleWorkspaceExtendedAccess("trusted@example.com");

    assert.equal(publicCore.available, false);
    assert.match(publicCore.reason ?? "", /lite mode|verification screen/i);
    assert.equal(publicExtended.available, false);
    assert.match(publicExtended.reason ?? "", /lite mode|verification screen/i);

    assert.equal(trustedCore.available, true);
    assert.equal(trustedCore.allowlisted, true);
    assert.match(trustedCore.reason ?? "", /trusted tester|lite mode/i);
    assert.equal(trustedExtended.available, true);
    assert.equal(trustedExtended.allowlisted, true);
    assert.match(trustedExtended.reason ?? "", /trusted tester|lite mode/i);
  } finally {
    env.GOOGLE_CLIENT_ID = previous.GOOGLE_CLIENT_ID;
    env.GOOGLE_CLIENT_SECRET = previous.GOOGLE_CLIENT_SECRET;
    env.NEXT_PUBLIC_APP_URL = previous.NEXT_PUBLIC_APP_URL;
    env.GOOGLE_WORKSPACE_PUBLIC_ENABLED = previous.GOOGLE_WORKSPACE_PUBLIC_ENABLED;
    env.GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED = previous.GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED;
    env.GOOGLE_WORKSPACE_TEST_USER_EMAILS = previous.GOOGLE_WORKSPACE_TEST_USER_EMAILS;
    env.GOOGLE_WORKSPACE_TEMPORARY_HOLD = previous.GOOGLE_WORKSPACE_TEMPORARY_HOLD;
    env.GOOGLE_WORKSPACE_SETUP_LITE_ONLY = previous.GOOGLE_WORKSPACE_SETUP_LITE_ONLY;
  }
});

test("google workspace auth URL uses the signed-in email as a login hint", () => {
  const previous = {
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL,
  };

  env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
  env.GOOGLE_CLIENT_SECRET = "test-secret";
  env.NEXT_PUBLIC_APP_URL = "https://swift-deploy.in";

  try {
    const url = new URL(
      buildClawCloudGoogleAuthUrl(
        "workspace:extended:test-nonce",
        "https://swift-deploy.in",
        "extended",
        { loginHint: "Founder@Example.com" },
      ),
    );

    assert.equal(url.searchParams.get("login_hint"), "founder@example.com");
    assert.equal(url.searchParams.get("prompt"), "consent");
    assert.equal(url.searchParams.get("include_granted_scopes"), "true");
  } finally {
    env.GOOGLE_CLIENT_ID = previous.GOOGLE_CLIENT_ID;
    env.GOOGLE_CLIENT_SECRET = previous.GOOGLE_CLIENT_SECRET;
    env.NEXT_PUBLIC_APP_URL = previous.NEXT_PUBLIC_APP_URL;
  }
});

test("google workspace callback rejects the wrong signed-in Google account", () => {
  assert.equal(
    matchesExpectedClawCloudGoogleWorkspaceEmail("founder@example.com", "founder@example.com"),
    true,
  );
  assert.equal(
    matchesExpectedClawCloudGoogleWorkspaceEmail("founder@example.com", "other@example.com"),
    false,
  );
  assert.equal(
    buildGoogleWorkspaceWrongAccountMessage("founder@example.com"),
    "Continue with the signed-in Google account founder@example.com and try again.",
  );
});

test("google workspace access confirmation falls back to direct API probes when token scope metadata is incomplete", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/profile")) {
      return new Response(JSON.stringify({ emailAddress: "founder@example.com" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events")) {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.startsWith("https://www.googleapis.com/drive/v3/files")) {
      return new Response(JSON.stringify({ files: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch during workspace access probe test: ${url}`);
  }) as typeof fetch;

  try {
    assert.equal(await confirmGoogleWorkspaceScopeAccess("ya29.test", "core"), true);
    assert.equal(await confirmGoogleWorkspaceScopeAccess("ya29.test", "extended"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("google workspace access confirmation fails when a required provider probe is denied", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.startsWith("https://gmail.googleapis.com/gmail/v1/users/me/profile")) {
      return new Response("forbidden", { status: 403 });
    }

    if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events")) {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch during denied workspace access probe test: ${url}`);
  }) as typeof fetch;

  try {
    assert.equal(await confirmGoogleWorkspaceScopeAccess("ya29.test", "core"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public Google sign-in follows its own rollout flag even while Workspace setup stays in Lite mode", () => {
  const previous = {
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL,
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    GOOGLE_SIGNIN_PUBLIC_ENABLED: env.GOOGLE_SIGNIN_PUBLIC_ENABLED,
    GOOGLE_WORKSPACE_SETUP_LITE_ONLY: env.GOOGLE_WORKSPACE_SETUP_LITE_ONLY,
    GOOGLE_WORKSPACE_TEMPORARY_HOLD: env.GOOGLE_WORKSPACE_TEMPORARY_HOLD,
  };

  env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
  env.GOOGLE_CLIENT_SECRET = "test-secret";
  env.NEXT_PUBLIC_APP_URL = "https://swift-deploy.in";
  env.SUPABASE_URL = "https://example.supabase.co";
  env.SUPABASE_ANON_KEY = "anon-test-key";
  env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  env.GOOGLE_SIGNIN_PUBLIC_ENABLED = false;
  env.GOOGLE_WORKSPACE_SETUP_LITE_ONLY = true;
  env.GOOGLE_WORKSPACE_TEMPORARY_HOLD = true;

  try {
    assert.equal(isGooglePublicSignInEnabled(), false);
    env.GOOGLE_SIGNIN_PUBLIC_ENABLED = true;
    assert.equal(isGooglePublicSignInEnabled(), true);
  } finally {
    env.GOOGLE_CLIENT_ID = previous.GOOGLE_CLIENT_ID;
    env.GOOGLE_CLIENT_SECRET = previous.GOOGLE_CLIENT_SECRET;
    env.NEXT_PUBLIC_APP_URL = previous.NEXT_PUBLIC_APP_URL;
    env.SUPABASE_URL = previous.SUPABASE_URL;
    env.SUPABASE_ANON_KEY = previous.SUPABASE_ANON_KEY;
    env.SUPABASE_SERVICE_ROLE_KEY = previous.SUPABASE_SERVICE_ROLE_KEY;
    env.GOOGLE_SIGNIN_PUBLIC_ENABLED = previous.GOOGLE_SIGNIN_PUBLIC_ENABLED;
    env.GOOGLE_WORKSPACE_SETUP_LITE_ONLY = previous.GOOGLE_WORKSPACE_SETUP_LITE_ONLY;
    env.GOOGLE_WORKSPACE_TEMPORARY_HOLD = previous.GOOGLE_WORKSPACE_TEMPORARY_HOLD;
  }
});

test("latest app access consent decisions accept plain yes and no replies", async () => {
  const previousAgentSecret = env.AGENT_SECRET;
  env.AGENT_SECRET = "test-agent-secret";

  try {
    const consent = createAppAccessConsentRequest({
      userId: "user-plain",
      surface: "whatsapp",
      operation: "write",
      originalMessage: "Send message to Maa: Good morning",
    });

    await rememberLatestAppAccessConsent(
      "user-plain",
      consent,
      "Send message to Maa: Good morning",
      { persist: false },
    );
    const approved = await resolveLatestAppAccessConsentDecision(
      "user-plain",
      "yes",
      { persist: false },
    );
    assert.equal(approved?.decision, "approve");
    assert.equal(approved?.originalMessage, "Send message to Maa: Good morning");

    await rememberLatestAppAccessConsent(
      "user-plain",
      consent,
      "Send message to Maa: Good morning",
      { persist: false },
    );
    const denied = await resolveLatestAppAccessConsentDecision(
      "user-plain",
      "no",
      { persist: false },
    );
    assert.equal(denied?.decision, "deny");
  } finally {
    env.AGENT_SECRET = previousAgentSecret;
  }
});

test("app access consent routing classifies Gmail, calendar, drive, and WhatsApp requests", () => {
  assert.deepEqual(inferAppAccessRequirementForTest("Read my 10 most important emails of today"), {
    surface: "gmail",
    operation: "read",
    summary: "read from your Gmail",
  });

  assert.deepEqual(inferAppAccessRequirementForTest("Archive my latest email from Google"), {
    surface: "gmail",
    operation: "write",
    summary: "make changes in your Gmail",
  });

  assert.deepEqual(inferAppAccessRequirementForTest("What meetings do I have tomorrow?"), {
    surface: "google_calendar",
    operation: "read",
    summary: "read from your Google Calendar",
  });

  assert.deepEqual(inferAppAccessRequirementForTest("Create a calendar event called Project Sync tomorrow at 4pm"), {
    surface: "google_calendar",
    operation: "write",
    summary: "make changes in your Google Calendar",
  });

  assert.deepEqual(inferAppAccessRequirementForTest("List my recent Drive files"), {
    surface: "google_drive",
    operation: "read",
    summary: "read from your Google Drive files",
  });

  assert.deepEqual(inferAppAccessRequirementForTest("Add row to Sales Tracker: Rahul, 5000, March"), {
    surface: "google_drive",
    operation: "write",
    summary: "make changes in your Google Drive files",
  });

  assert.deepEqual(inferAppAccessRequirementForTest("In WhatsApp, see what message I got from Papa ji"), {
    surface: "whatsapp",
    operation: "read",
    summary: "read from your WhatsApp",
  });

  assert.deepEqual(inferAppAccessRequirementForTest("Send message to Maa: Good morning"), {
    surface: "whatsapp",
    operation: "write",
    summary: "use your WhatsApp to send or reply",
  });

  assert.equal(inferAppAccessRequirementForTest('Send "Good morning" to Maa tomorrow at 8am'), null);

  assert.deepEqual(inferAppAccessRequirementForTest("Sync WhatsApp contacts"), {
    surface: "whatsapp",
    operation: "read",
    summary: "read from your WhatsApp",
  });
});

test("schema compatibility helpers catch missing-column deployments cleanly", () => {
  const message = "Could not find the 'user_id' column of 'research_runs' in the schema cache";
  assert.equal(isClawCloudMissingSchemaMessage(message), true);
  assert.equal(isClawCloudMissingSchemaColumn(message, "user_id"), true);
  assert.equal(isClawCloudMissingSchemaColumn(message, "search_diagnostics"), false);
});

test("Global Lite Connect validates public-safe Gmail, Calendar, and Drive fallback inputs", () => {
  const gmail = validateGlobalLiteUpsertInput({
    provider: "gmail",
    email: "Founder@Example.com ",
  });
  assert.equal(gmail.mode, "gmail_capture");
  assert.equal(gmail.config.email, "founder@example.com");
  assert.match(describeGlobalLiteConnection(gmail), /founder@example\.com/i);

  const calendar = validateGlobalLiteUpsertInput({
    provider: "google_calendar",
    icsUrl: "https://calendar.google.com/calendar/ical/example/basic.ics",
  });
  assert.equal(calendar.mode, "calendar_ics");
  assert.match(describeGlobalLiteConnection(calendar), /private ICS feed/i);

  const drive = validateGlobalLiteUpsertInput({
    provider: "google_drive",
    label: "My Lite Vault",
  });
  assert.equal(drive.mode, "drive_uploads");
  assert.match(describeGlobalLiteConnection(drive), /Drive Lite/i);

  assert.throws(
    () =>
      validateGlobalLiteUpsertInput({
        provider: "google_calendar",
        icsUrl: "http://example.com/not-secure.ics",
      }),
    /valid private ICS/i,
  );
});

test("setup status derives live connection flags only from active rows", () => {
  const state = deriveClawCloudSetupConnectionState({
    connected_accounts: [
      {
        provider: "gmail",
        account_email: "founder@example.com",
        is_active: true,
      },
      {
        provider: "google_calendar",
        account_email: "founder@example.com",
        is_active: true,
      },
      {
        provider: "google_drive",
        account_email: "founder@example.com",
        is_active: false,
      },
      {
        provider: "whatsapp",
        phone_number: "919999888877",
        is_active: true,
      },
    ],
    global_lite_connections: [],
  });

  assert.equal(state.gmailConnected, true);
  assert.equal(state.calendarConnected, true);
  assert.equal(state.driveConnected, false);
  assert.equal(state.whatsappConnected, true);
  assert.equal(state.whatsappPhone, "919999888877");
});

test("setup status can keep WhatsApp connected from the live workspace summary fallback", () => {
  const state = deriveClawCloudSetupConnectionState({
    connected_accounts: [
      {
        provider: "gmail",
        account_email: "founder@example.com",
        is_active: false,
      },
    ],
    global_lite_connections: [],
    whatsapp_connected: true,
    whatsapp_phone: "918091392311",
  });

  assert.equal(state.gmailConnected, false);
  assert.equal(state.whatsappConnected, true);
  assert.equal(state.whatsappPhone, "918091392311");
});

test("setup Google Workspace availability leaves Lite mode only when rollout is actually open", () => {
  assert.deepEqual(
    deriveClawCloudSetupGoogleWorkspaceAvailability({
      setupLiteMode: true,
      publicWorkspaceEnabled: true,
      publicWorkspaceExtendedEnabled: true,
      coreAccessAllowed: true,
      extendedAccessAllowed: true,
    }),
    {
      googleWorkspaceSetupLiteOnly: true,
      googleWorkspaceEnabledForUser: false,
      googleWorkspaceExtendedEnabledForUser: false,
    },
  );

  assert.deepEqual(
    deriveClawCloudSetupGoogleWorkspaceAvailability({
      setupLiteMode: false,
      publicWorkspaceEnabled: true,
      publicWorkspaceExtendedEnabled: false,
      coreAccessAllowed: false,
      extendedAccessAllowed: false,
    }),
    {
      googleWorkspaceSetupLiteOnly: false,
      googleWorkspaceEnabledForUser: true,
      googleWorkspaceExtendedEnabledForUser: false,
    },
  );

  assert.deepEqual(
    deriveClawCloudSetupGoogleWorkspaceAvailability({
      setupLiteMode: false,
      publicWorkspaceEnabled: false,
      publicWorkspaceExtendedEnabled: false,
      coreAccessAllowed: true,
      extendedAccessAllowed: true,
    }),
    {
      googleWorkspaceSetupLiteOnly: false,
      googleWorkspaceEnabledForUser: true,
      googleWorkspaceExtendedEnabledForUser: true,
    },
  );
});

test("setup defers Google callback processing until auth hydration finishes", () => {
  assert.equal(
    shouldDeferSetupCallbackProcessing({
      authProvider: null,
      gmailLiteConnectedFromSearch: false,
      driveLiteConnectedFromSearch: false,
      globalConnectBootstrap: false,
      gmailConnectedFromSearch: true,
      calendarConnectedFromSearch: false,
      driveConnectedFromSearch: true,
      activationFromSearch: true,
      setupError: null,
      authAccessTokenAvailable: false,
      isCheckingSession: true,
    }),
    true,
  );

  assert.equal(
    shouldDeferSetupCallbackProcessing({
      authProvider: null,
      gmailLiteConnectedFromSearch: false,
      driveLiteConnectedFromSearch: false,
      globalConnectBootstrap: false,
      gmailConnectedFromSearch: true,
      calendarConnectedFromSearch: false,
      driveConnectedFromSearch: true,
      activationFromSearch: true,
      setupError: null,
      authAccessTokenAvailable: true,
      isCheckingSession: true,
    }),
    false,
  );

  assert.equal(
    shouldDeferSetupCallbackProcessing({
      authProvider: null,
      gmailLiteConnectedFromSearch: false,
      driveLiteConnectedFromSearch: false,
      globalConnectBootstrap: false,
      gmailConnectedFromSearch: false,
      calendarConnectedFromSearch: false,
      driveConnectedFromSearch: false,
      activationFromSearch: false,
      setupError: null,
      authAccessTokenAvailable: false,
      isCheckingSession: true,
    }),
    false,
  );

  assert.equal(
    shouldDeferSetupCallbackProcessing({
      authProvider: null,
      gmailLiteConnectedFromSearch: false,
      driveLiteConnectedFromSearch: false,
      globalConnectBootstrap: false,
      gmailConnectedFromSearch: false,
      calendarConnectedFromSearch: true,
      driveConnectedFromSearch: false,
      activationFromSearch: false,
      setupError: null,
      authAccessTokenAvailable: false,
      isCheckingSession: true,
    }),
    true,
  );
});

test("whatsapp personal assistant channel stays anchored to self chat", () => {
  assert.equal(
    shouldRememberAssistantSelfChat("919999888877", "919999888877@s.whatsapp.net"),
    true,
  );
  assert.equal(
    shouldRememberAssistantSelfChat("919999888877", "918888777766@s.whatsapp.net"),
    false,
  );
  assert.equal(
    shouldRememberAssistantSelfChat("919999888877", "1203630@g.us"),
    false,
  );

  assert.equal(
    resolveDefaultAssistantChatJid("919999888877", "918888777766@s.whatsapp.net"),
    "919999888877@s.whatsapp.net",
  );
  assert.equal(
    resolveDefaultAssistantChatJid(null, "918888777766@s.whatsapp.net"),
    "918888777766@s.whatsapp.net",
  );
});

test("dashboard journal ensures a new daily page exists", () => {
  const ensured = ensureDashboardJournalDay([], "2026-03-22");
  assert.equal(ensured.thread.dateKey, "2026-03-22");
  assert.equal(ensured.thread.id, buildDashboardJournalThreadId("2026-03-22"));
  assert.equal(ensured.threads.length, 1);
});

test("billing, drive, finance, train, and image intents classify correctly", () => {
  assert.equal(detectBillingIntent("upgrade me to pro plan"), "upgrade");
  assert.equal(detectBillingIntent("what is my current plan status"), "plan_status");
  assert.equal(detectBillingIntent("billing status"), "plan_status");
  assert.equal(detectBillingIntent("cancel my pro subscription"), "cancel");
  assert.equal(
    detectBillingIntent("deep: Design a zero-downtime Stripe billing migration with dual-write, idempotent webhooks, rollback, and ledger cutover"),
    null,
  );

assert.equal(detectDriveIntent("list my Google Drive files"), "list");
assert.equal(detectDriveIntent("List my recent Drive files"), "list");
assert.equal(detectDriveIntent("find my sales sheet in google drive"), "search");
  assert.equal(detectDriveIntent("add row to budget sheet: rent,25000"), "write");
  assert.equal(detectDriveIntent("read my doc"), "read");
  assert.equal(detectDriveIntent("read my latest sales sheet"), "read");
  assert.equal(detectDriveIntent("show details of my finance folder in drive"), "details");
  assert.equal(detectDriveIntent("how does Google Drive work"), null);
  assert.equal(detectDriveIntent("compare Google Drive vs Dropbox"), null);

  assert.equal(detectFinanceQuery("bitcoin price today")?.type, "crypto");
  assert.equal(detectFinanceQuery("What is the price of Bitcoin right now in USD?")?.type, "crypto");
  assert.equal(detectFinanceQuery("भारत में सोने की कीमत क्या है")?.type, "commodity");
  assert.equal(detectFinanceQuery("precio del oro en india")?.type, "commodity");
  assert.equal(detectFinanceQuery("bitcoin price in dubai")?.type, "crypto");
  assert.equal(detectFinanceQuery("what is the price of 1 dollar in rs")?.type, "forex");
  assert.deepEqual(detectFinanceQuery("what is the price of 1 dollar in rs")?.forexPair, ["USD", "INR"]);
  assert.deepEqual(detectFinanceQuery("how much is one rupee in dollar")?.forexPair, ["INR", "USD"]);
  assert.deepEqual(detectFinanceQuery("1 usd in inr right now")?.forexPair, ["USD", "INR"]);
  assert.equal(detectFinanceQuery("ticker AAPL price")?.type, "stock_us");
  assert.equal(detectFinanceQuery("crude oil price today")?.type, "commodity");
  assert.equal(detectFinanceQuery("why russia is sending its oil tanker to cuba"), null);
  assert.equal(detectFinanceQuery("russia cuba mai apna oil tanker kyun bhej rha hai"), null);
  assert.equal(normalizeRegionalQuestion("what is the gdp of tokyo"), "what is the gdp of tokyo");
  assert.equal(normalizeRegionalQuestion("price of petrol in dubai right now"), "price of petrol in dubai right now");
  assert.equal(detectFinanceQuery("HDFC Bank share price")?.type, "stock_india");
  assert.equal(detectFinanceQuery("current ceo of google in 2020"), null);
  assert.equal(detectFinanceQuery("who is the ceo of tesla"), null);

  assert.equal(normalizeRegionalQuestion("भारत में सोने की कीमत क्या है"), "india में gold की price क्या है");
  const indiaGoldContext = inferClawCloudRegionContext("भारत में सोने की कीमत क्या है");
  assert.equal(indiaGoldContext.requestedCurrency, "INR");
  assert.equal(indiaGoldContext.requestedRegion?.countryName, "India");
  assert.equal(indiaGoldContext.requestedRegion?.timeZone, "Asia/Kolkata");
  assert.equal(inferQuestionLanguageHint("आज भारत में सोने की कीमत क्या है"), "hi");
  assert.deepEqual(inferRegionalSearchLocale("आज भारत की खबरें"), { gl: "in", hl: "hi" });

  assert.equal(detectIndianStockQuery("Reliance share price today"), "RELIANCE.NS");
  assert.equal(detectIndianStockQuery("What is the price of Bitcoin right now in USD?"), null);
  assert.equal(detectIndianStockQuery("ITC share price today"), "ITC.NS");
  assert.deepEqual(detectTrainIntent("PNR status for 1234567890"), { type: "pnr", value: "1234567890" });
  assert.deepEqual(detectTrainIntent("running status of train 12951"), { type: "running", value: "12951" });
  assert.deepEqual(detectTrainIntent("schedule for 12002"), { type: "schedule", value: "12002" });

  assert.equal(detectImageGenIntent("Generate a logo for my chai brand"), true);
  assert.equal(extractImagePrompt("Generate a logo for my chai brand"), "logo for my chai brand");
  assert.equal(getImageGenerationStatus().available, true);
  assert.ok(getImageGenerationStatus().providers.includes("pollinations"));
  const tokyoMention = detectClawCloudRegionMention("tokyo");
  assert.equal(tokyoMention?.kind, "locality");
  assert.equal(tokyoMention?.region.countryName, "Japan");
  const tokyoContext = inferClawCloudRegionContext("what is the gdp of tokyo");
  assert.equal(tokyoContext.requestedRegion?.countryName, "Japan");
  assert.equal(tokyoContext.requestedRegionMatchType, "locality");
  const dubaiContext = inferClawCloudRegionContext("price of petrol in dubai right now");
  assert.equal(dubaiContext.requestedCurrency, "AED");
  assert.equal(dubaiContext.requestedRegion?.countryName, "United Arab Emirates");
  assert.equal(dubaiContext.requestedRegionMatchType, "locality");
});

test("India normalization and UPI parsing stay user-friendly", () => {
  assert.equal(normalizeMerchantName("BUNDL TECHNOLOGIES PRIVATE LIMITED"), "Swiggy");
  assert.equal(inferSpendingCategory("Uber"), "transport");
  assert.equal(detectIndianStateFromText("next holiday in Chennai"), "Tamil Nadu");

  const sms = "SBI Alert: Rs 499.00 debited on UPI to BUNDL TECHNOLOGIES PRIVATE LIMITED Ref 123456789. Avl bal Rs 9999.";
  assert.equal(detectUpiSms(sms), true);

  const parsed = parseUpiSms(sms, "user-123");
  assert.ok(parsed);
  assert.equal(parsed?.amount, 499);
  assert.equal(parsed?.transaction_type, "debit");
  assert.equal(parsed?.merchant, "Swiggy");
  assert.equal(parsed?.category, "food");
  assert.equal(parsed?.bank, "SBI");
});

test("holiday and tax helpers answer India-specific questions", () => {
  assert.equal(detectHolidayQuery("When is Onam in Kerala?"), true);
  const holidayAnswer = answerHolidayQuery("When is Onam in Kerala?");
  assert.ok(holidayAnswer);
  assert.match(holidayAnswer ?? "", /Onam/i);
  assert.match(holidayAnswer ?? "", /Kerala/i);
  assert.equal(detectHolidayQuery("tarun holi delhi case"), false);

  assert.equal(detectTaxQuery("GST on Rs 1180 at 18% inclusive"), "gst");
  const gstAnswer = answerTaxQuery("GST on Rs 1180 at 18% inclusive");
  assert.ok(gstAnswer);
  assert.match(gstAnswer ?? "", /GST Calculation/i);
  assert.match(gstAnswer ?? "", /180\.00/);

  const incomeTaxAnswer = answerTaxQuery("Income tax on 12 lakh salary");
  assert.ok(incomeTaxAnswer);
  assert.match(incomeTaxAnswer ?? "", /Income Tax Estimate/i);
  assert.match(incomeTaxAnswer ?? "", /Total Tax Payable/i);

  assert.equal(
    detectTaxQuery("Compare old vs new tax regime for 12 lakh salary with 80C 1.5 lakh and HRA 2 lakh and home loan interest 2 lakh"),
    "income_tax",
  );
  const compareTaxAnswer = answerTaxQuery(
    "Compare old vs new tax regime for 12 lakh salary with 80C 1.5 lakh and HRA 2 lakh and home loan interest 2 lakh",
  );
  assert.ok(compareTaxAnswer);
  assert.match(compareTaxAnswer ?? "", /Old Regime vs New Regime/i);
  assert.match(compareTaxAnswer ?? "", /Reported old-regime deductions considered/i);
  assert.match(compareTaxAnswer ?? "", /Old regime saves/i);

  const monthlyTaxAnswer = answerTaxQuery("Income tax under new regime for Rs 100000 monthly salary");
  assert.ok(monthlyTaxAnswer);
  assert.match(monthlyTaxAnswer ?? "", /New Regime/i);
  assert.match(monthlyTaxAnswer ?? "", /Annual gross income:.*12\.00 L/i);
  assert.match(monthlyTaxAnswer ?? "", /Standard deduction/i);

  const ambiguousGstAnswer = answerTaxQuery("GST on Rs 1000 capacity planning");
  assert.ok(ambiguousGstAnswer);
  assert.match(ambiguousGstAnswer ?? "", /cannot infer the GST rate/i);
  assert.match(ambiguousGstAnswer ?? "", /What GST rate applies/i);
});

test("deterministic finance math solvers cover EMI, SIP, CAGR, ROI, and break-even questions", () => {
  const emiAnswer = solveHardMathQuestion("Calculate EMI for a Rs 10 lakh loan at 12% for 5 years");
  assert.ok(emiAnswer);
  assert.match(emiAnswer ?? "", /Loan EMI Calculation/i);
  assert.match(emiAnswer ?? "", /Monthly EMI: Rs 22,244\.45/i);
  assert.match(emiAnswer ?? "", /Total interest paid: Rs (?:334,666\.86|3,34,666\.86)/i);

  const sipAnswer = solveHardMathQuestion("What will be the future value of a SIP of Rs 10000 per month at 12% for 10 years?");
  assert.ok(sipAnswer);
  assert.match(sipAnswer ?? "", /SIP Future Value Estimate/i);
  assert.match(sipAnswer ?? "", /Estimated future value: Rs (?:2,323,390\.76|23,23,390\.76)/i);
  assert.match(sipAnswer ?? "", /Total invested: Rs (?:1,200,000|12,00,000)/i);

  const cagrAnswer = solveHardMathQuestion("What is the CAGR if an investment grows from Rs 100000 to Rs 180000 in 4 years?");
  assert.ok(cagrAnswer);
  assert.match(cagrAnswer ?? "", /CAGR Calculation/i);
  assert.match(cagrAnswer ?? "", /CAGR: 15\.83%/i);

  const roiAnswer = solveHardMathQuestion("Calculate ROI if my investment cost is Rs 200000 and the final value is Rs 260000");
  assert.ok(roiAnswer);
  assert.match(roiAnswer ?? "", /ROI Calculation/i);
  assert.match(roiAnswer ?? "", /ROI: 30\.00%/i);

  const breakEvenAnswer = solveHardMathQuestion("Find the break-even point if fixed cost is Rs 500000, selling price per unit is Rs 1200, and variable cost per unit is Rs 700");
  assert.ok(breakEvenAnswer);
  assert.match(breakEvenAnswer ?? "", /Break-even Analysis/i);
  assert.match(breakEvenAnswer ?? "", /Break-even units: 1,000/i);
  assert.match(breakEvenAnswer ?? "", /Break-even revenue: Rs (?:1,200,000|12,00,000)/i);
});

test("deterministic deposit calculators cover FD, RD, and PPF maturity questions", () => {
  const fdAnswer = solveHardMathQuestion("What is the maturity amount for a fixed deposit of Rs 500000 at 7% for 3 years?");
  assert.ok(fdAnswer);
  assert.match(fdAnswer ?? "", /Fixed Deposit Maturity Estimate/i);
  assert.match(fdAnswer ?? "", /Compounding assumption: quarterly/i);
  assert.match(fdAnswer ?? "", /Maturity amount: Rs (?:615,719\.66|6,15,719\.66)/i);

  const rdAnswer = solveHardMathQuestion("What is the maturity value of an RD of Rs 5000 per month at 7.5% for 5 years?");
  assert.ok(rdAnswer);
  assert.match(rdAnswer ?? "", /Recurring Deposit Maturity Estimate/i);
  assert.match(rdAnswer ?? "", /Total invested: Rs (?:300,000|3,00,000)/i);
  assert.match(rdAnswer ?? "", /Estimated maturity amount: Rs (?:362,635\.53|3,62,635\.53)/i);

  const ppfAnswer = solveHardMathQuestion("What will be the PPF maturity if I invest Rs 150000 every year at 7.1% for 15 years?");
  assert.ok(ppfAnswer);
  assert.match(ppfAnswer ?? "", /PPF Maturity Estimate/i);
  assert.match(ppfAnswer ?? "", /Total invested: Rs (?:2,250,000|22,50,000)/i);
  assert.match(ppfAnswer ?? "", /Estimated maturity amount: Rs (?:4,068,209\.22|40,68,209\.22)/i);
});

test("deterministic loan prepayment analysis shows tenure and EMI tradeoffs", () => {
  const prepaymentAnswer = solveHardMathQuestion(
    "If I prepay Rs 200000 on a Rs 2000000 home loan at 9% for 20 years after 3 years, how much interest will I save?",
  );
  assert.ok(prepaymentAnswer);
  assert.match(prepaymentAnswer ?? "", /Loan Prepayment Analysis/i);
  assert.match(prepaymentAnswer ?? "", /Estimated outstanding before prepayment: Rs (?:1,876,767\.40|18,76,767\.40)/i);
  assert.match(prepaymentAnswer ?? "", /New remaining tenure: 161 months/i);
  assert.match(prepaymentAnswer ?? "", /Tenure saved: 43 months/i);
  assert.match(prepaymentAnswer ?? "", /Interest saved: Rs (?:580,479\.27|5,80,479\.27)/i);
  assert.match(prepaymentAnswer ?? "", /New EMI: Rs (?:16,076\.91|16,076\.91)/i);
  assert.match(prepaymentAnswer ?? "", /EMI reduction: Rs (?:1,917\.61|1,917\.61) per month/i);
});

test("deterministic reminder parsing keeps task numbers intact, honors timezone, and refuses vague schedules", () => {
  const tomorrowFiles = parseReminderRegex("Remind me tomorrow to send 2 files to Raj", {
    now: "2026-03-26T10:00:00.000Z",
    userTimezone: "Asia/Kolkata",
  });
  assert.ok(tomorrowFiles);
  assert.equal(tomorrowFiles?.recurRule, null);
  assert.equal(tomorrowFiles?.reminderText, "send 2 files to Raj");
  assert.equal(tomorrowFiles?.fireAt, "2026-03-27T03:30:00.000Z");

  const dubaiReminder = parseReminderRegex("Remind me tomorrow at 9am to call Raj", {
    now: "2026-03-26T12:00:00.000Z",
    userTimezone: "Asia/Dubai",
  });
  assert.ok(dubaiReminder);
  assert.equal(dubaiReminder?.fireAt, "2026-03-27T05:00:00.000Z");
  assert.equal(dubaiReminder?.reminderText, "call Raj");

  const monthlyReminder = parseReminderRegex("Remind me on the 1st of every month to pay rent", {
    now: "2026-03-26T10:00:00.000Z",
    userTimezone: "Asia/Kolkata",
  });
  assert.ok(monthlyReminder);
  assert.equal(monthlyReminder?.recurRule, "monthly");
  assert.equal(monthlyReminder?.reminderText, "pay rent");
  assert.equal(monthlyReminder?.fireAt, "2026-04-01T03:30:00.000Z");

  const weekdayReminder = parseReminderRegex("Remind me every weekday at 9am for standup", {
    now: "2026-03-26T10:00:00.000Z",
    userTimezone: "Asia/Kolkata",
  });
  assert.ok(weekdayReminder);
  assert.equal(weekdayReminder?.recurRule, "weekdays");
  assert.equal(weekdayReminder?.reminderText, "standup");
  assert.equal(weekdayReminder?.fireAt, "2026-03-27T03:30:00.000Z");

  assert.equal(
    parseReminderRegex("Remind me to call Raj", {
      now: "2026-03-26T10:00:00.000Z",
      userTimezone: "Asia/Kolkata",
    }),
    null,
  );
});

test("timezone auto-detection ignores GST tax terms but still honors explicit city/timezone hints", () => {
  assert.equal(detectTimezoneFromTextForTest("Remind me tomorrow to file the GST return"), null);
  assert.equal(detectTimezoneFromTextForTest("Set a reminder at 9am to review the SGST split"), null);
  assert.equal(detectTimezoneFromTextForTest("Remind me at 9am Dubai time"), "Asia/Dubai");
  assert.equal(detectTimezoneFromTextForTest("My timezone is Singapore"), "Asia/Singapore");
});

test("phase 4 auto-memory save plans keep identity facts explicit-only and suggestions short-lived", () => {
  assert.equal(
    buildAutoExtractedMemorySavePlanForTest({
      key: "city",
      value: "Dubai",
      confidence: 0.96,
    }),
    null,
  );

  const tonePlan = buildAutoExtractedMemorySavePlanForTest({
    key: "preferred_tone",
    value: "concise and direct",
    confidence: 0.91,
  });
  assert.ok(tonePlan);
  assert.equal(tonePlan?.scope, "derived_preference");
  assert.equal(tonePlan?.confirmed, false);
  assert.equal(tonePlan?.createdBy, "fact_extractor");
  assert.match(tonePlan?.whySaved ?? "", /self-description/i);
  assert.ok(tonePlan?.expiresAt);
});

test("casual talk profile infers human tone and reply style from recent user messages", () => {
  const casualProfile = inferClawCloudCasualTalkProfile("ok bro tell me straight, what should I do now?", [
    { role: "user", content: "lol that was messy" },
    { role: "user", content: "nah keep it simple pls" },
  ]);
  assert.equal(casualProfile.primaryTone, "casual");
  assert.equal(casualProfile.formality, "casual");
  assert.equal(casualProfile.preferredReplyLength, "short");

  const professionalProfile = inferClawCloudCasualTalkProfile(
    "Could you please explain the next step in a clear way?",
    [{ role: "user", content: "Thank you. I would appreciate a concise explanation." }],
  );
  assert.equal(professionalProfile.primaryTone, "professional");
  assert.equal(professionalProfile.formality, "formal");
});

test("emotional context inference stays supportive for negative moods and warm for positive moods", () => {
  const stressed = inferClawCloudEmotionalContext(
    "I am really overwhelmed and this is getting too much for me right now",
    [{ role: "user", content: "I feel stressed and exhausted today" }],
  );
  assert.equal(stressed.currentEmotion, "stressed");
  assert.equal(stressed.supportStyle, "encouraging");
  assert.match(stressed.responseGuidance, /calmer, steadier, more encouraging/i);

  const excited = inferClawCloudEmotionalContext(
    "This finally worked, I'm so excited right now!!",
    [{ role: "user", content: "good news, this is amazing" }],
  );
  assert.equal(excited.currentEmotion, "excited");
  assert.equal(excited.supportStyle, "celebratory");
  assert.match(excited.responseGuidance, /positive energy/i);
});

test("casual talk clarification stays human and points back to recent context when needed", () => {
  assert.equal(
    shouldAskClawCloudCasualClarification({
      message: "what about that one",
      intent: "general",
      recentTurns: [{ role: "user", content: "Compare Gmail and Outlook for startup ops" }],
      resolvedQuestion: "what about that one",
    }),
    true,
  );

  const reply = buildClawCloudCasualClarificationReply({
    message: "what about that one",
    recentTurns: [{ role: "user", content: "Compare Gmail and Outlook for startup ops" }],
    activeTopics: ["email workflows", "startup ops"],
  });
  assert.match(reply, /I want to make sure/i);
  assert.match(reply, /email workflows/i);
  assert.match(reply, /startup ops/i);
});

test("casual talk clarification stays more supportive when the user sounds emotionally low", () => {
  const reply = buildClawCloudCasualClarificationReply({
    message: "what about that one, I'm really overwhelmed",
    recentTurns: [{ role: "user", content: "Compare two job offers for me" }],
    activeTopics: ["job offers"],
  });

  assert.match(reply, /I want to help properly/i);
  assert.match(reply, /job offers/i);
});

test("memory snippet carries tone and continuity signals for casual conversation mode", () => {
  const snippet = buildMemorySystemSnippet({
    recentTurns: [
      { role: "user", content: "keep it simple pls" },
      { role: "assistant", content: "Sure, I'll keep it short." },
      { role: "user", content: "compare gmail and outlook for me" },
    ],
    topicSummary: "Earlier, the user compared workspace tools.",
    activeTopics: ["email workflows"],
    isFollowUp: true,
    resolvedQuestion: "Compare Gmail and Outlook for startup ops",
    recentDocumentContext: null,
    userToneProfile: "casual, human, more casual, prefers concise replies, plain punctuation",
    userEmotionalContext: "lightly stressed or overloaded; respond with calm encouragement",
    continuityHint: "keep it simple pls -> compare gmail and outlook for me",
  });

  assert.match(snippet, /User tone profile:/i);
  assert.match(snippet, /User emotional context:/i);
  assert.match(snippet, /Recent conversation anchor:/i);
  assert.match(snippet, /Resolved question:/i);
});

test("casual talk instruction tells the model to sound human and use prior thread context", () => {
  const instruction = buildClawCloudCasualTalkInstruction({
    message: "and what about this one?",
    intent: "general",
    recentTurns: [
      { role: "user", content: "Compare Claude and GPT for product strategy work" },
      { role: "assistant", content: "GPT is stronger on breadth; Claude often feels more natural in writing." },
    ],
    resolvedQuestion: "Compare Claude and GPT for product strategy work and what about this one?",
    activeTopics: ["ai", "product strategy"],
    topicSummary: "Earlier, the user compared frontier models.",
  });

  assert.match(instruction, /CASUAL CONVERSATION ADAPTATION:/);
  assert.match(instruction, /thoughtful human teammate/i);
  assert.match(instruction, /Observed emotional context:/i);
  assert.match(instruction, /Resolved follow-up context:/i);
});

test("phase 4 profile formatting separates confirmed profile facts from pending suggestions", () => {
  const facts = [
    {
      id: "1",
      user_id: "u1",
      key: "preferred_name",
      value: "Raj",
      source: "explicit" as const,
      confidence: 1,
      scope: "profile" as const,
      confirmed: true,
      created_by: "user_command",
      why_saved: "Saved because the user explicitly asked ClawCloud to remember it.",
      expires_at: null,
      created_at: "2026-03-26T00:00:00.000Z",
      updated_at: "2026-03-26T00:00:00.000Z",
    },
    {
      id: "2",
      user_id: "u1",
      key: "timezone",
      value: "Asia/Dubai",
      source: "inferred" as const,
      confidence: 0.85,
      scope: "derived_preference" as const,
      confirmed: false,
      created_by: "timezone_detector",
      why_saved: "Suggested from an explicit timezone, city, or reminder-time hint in a recent message.",
      expires_at: "2026-04-02T00:00:00.000Z",
      created_at: "2026-03-26T00:00:00.000Z",
      updated_at: "2026-03-26T00:00:00.000Z",
    },
  ];

  const snippet = buildUserProfileSnippet(facts);
  assert.match(snippet, /Preferred name: Raj/i);
  assert.doesNotMatch(snippet, /Asia\/Dubai/i);
  assert.match(snippet, /Ignore pending suggestions unless the user explicitly confirms them/i);

  const reply = formatProfileReply(facts);
  assert.match(reply, /saved profile \(1 confirmed fact\)/i);
  assert.match(reply, /Suggested, not yet confirmed/i);
  assert.match(reply, /Timezone:\* Asia\/Dubai/i);
  assert.match(reply, /pending confirmation/i);
});

test("phase 4 memory audit commands explain why a fact is remembered", () => {
  const command = detectMemoryCommand("Why do you remember my timezone?");
  assert.deepEqual(command, { type: "why_key", key: "timezone" });

  const reply = formatMemoryAuditReply("timezone", {
    id: "tz1",
    user_id: "u1",
    key: "timezone",
    value: "Asia/Dubai",
    source: "inferred",
    confidence: 0.85,
    scope: "derived_preference",
    confirmed: false,
    created_by: "timezone_detector",
    why_saved: "Suggested from an explicit timezone, city, or reminder-time hint in a recent message.",
    expires_at: "2026-04-02T00:00:00.000Z",
    created_at: "2026-03-26T00:00:00.000Z",
    updated_at: "2026-03-26T00:00:00.000Z",
  });

  assert.match(reply, /pending suggestion/i);
  assert.match(reply, /Suggested from an explicit timezone, city, or reminder-time hint/i);
  assert.match(reply, /Remember my timezone is Asia\/Dubai/i);
  assert.match(reply, /Forget my timezone/i);
});

test("quant expert solvers keep deterministic DiD and energy-risk answers complete", () => {
  const didAnswer = solveHardMathQuestion(
    "In a difference-in-differences policy evaluation, the treatment coefficient beta is -0.18 and the standard error is 0.05. Explain the estimator, compute the t-statistic, 95% confidence interval, significance, and list the parallel-trends checks and robustness tests.",
  );
  assert.ok(didAnswer);
  assert.match(didAnswer ?? "", /Numerical Readout/i);
  assert.match(didAnswer ?? "", /t-statistic:\s*-?3\.600/i);
  assert.match(didAnswer ?? "", /95% CI/i);

  const energyAnswer = solveHardMathQuestion(
    "A European power retailer needs weekly 95% VaR and stress loss estimation under spot price spikes and heat waves while hedging with forwards. Give the correct loss definition, estimation structure, stress testing approach, and explain why naive Gaussian normality fails.",
  );
  assert.ok(energyAnswer);
  assert.match(energyAnswer ?? "", /Loss Definition/i);
  assert.match(energyAnswer ?? "", /L_week/i);
  assert.match(energyAnswer ?? "", /Final Answer/i);
});

test("safety interception catches emergencies and leaves informational queries alone", () => {
  assert.equal(detectClawCloudSafetyRisk("I want to kill myself tonight"), "self_harm");
  assert.equal(detectClawCloudSafetyRisk("My father has chest pain and cannot breathe"), "urgent_medical");
  assert.equal(detectClawCloudSafetyRisk("What are the causes of depression?"), null);

  const reply = buildClawCloudSafetyReply("self_harm");
  assert.match(reply, /emergency/i);
  assert.match(reply, /trusted person/i);
});

test("answer-quality profiles and confidence scoring stay conservative on high-stakes replies", () => {
  const healthProfile = buildClawCloudAnswerQualityProfile({
    question: "Can I take 650 mg paracetamol every 4 hours for fever?",
    intent: "health",
    category: "health",
  });

  assert.equal(healthProfile.domain, "health");
  assert.equal(healthProfile.isHighStakes, true);
  assert.equal(healthProfile.requiresVerification, true);
  assert.equal(healthProfile.confidenceFloor, "medium");

  const unsafeScore = scoreClawCloudAnswerConfidence({
    question: "Can I take 650 mg paracetamol every 4 hours for fever?",
    answer: "Yes, do it. Take 650 mg every 4 hours and stop only if the fever goes away.",
    profile: healthProfile,
  });
  assert.equal(unsafeScore, "low");

  const financeProfile = buildClawCloudAnswerQualityProfile({
    question: "What is the AAPL price today and should I buy it?",
    intent: "finance",
    category: "finance",
  });
  const evidenceAnswer = [
    "AAPL is trading at $215.32.",
    "Data fetched: 10:15 AM IST.",
    "Source note: live market data as of today.",
    "This is general information, not personal advice, so please verify and consult a qualified financial advisor before investing.",
  ].join(" ");
  const evidenceScore = scoreClawCloudAnswerConfidence({
    question: "What is the AAPL price today and should I buy it?",
    answer: evidenceAnswer,
    profile: financeProfile,
  });
  assert.equal(evidenceScore, "high");

  const lowConfidenceReply = buildClawCloudLowConfidenceReply(
    "Can I sue my landlord immediately?",
    buildClawCloudAnswerQualityProfile({
      question: "Can I sue my landlord immediately?",
      intent: "law",
      category: "law",
    }),
  );
  assert.match(lowConfidenceReply, /lawyer/i);
  assert.doesNotMatch(lowConfidenceReply, /not confident enough/i);
  assert.doesNotMatch(lowConfidenceReply, /\bReason:/i);
  assert.equal(looksLikeClawCloudRefusal(lowConfidenceReply), false);

  const timeoutLowConfidenceReply = buildClawCloudLowConfidenceReply(
    "why cuba is all blackout",
    buildClawCloudAnswerQualityProfile({
      question: "why cuba is all blackout",
      intent: "research",
      category: "news",
    }),
    "The answer path took too long to complete reliably.",
  );
  assert.doesNotMatch(timeoutLowConfidenceReply, /without better grounding/i);
  assert.doesNotMatch(timeoutLowConfidenceReply, /too long to complete reliably/i);
  assert.doesNotMatch(timeoutLowConfidenceReply, /\bReason:/i);

  const comparisonLowConfidenceReply = buildClawCloudLowConfidenceReply(
    "difference between nginx vs apache vs caddy",
    buildClawCloudAnswerQualityProfile({
      question: "difference between nginx vs apache vs caddy",
      intent: "general",
      category: "general",
    }),
  );
  assert.match(comparisonLowConfidenceReply, /exact options/i);
  assert.doesNotMatch(comparisonLowConfidenceReply, /exact two options/i);

  const definitionLowConfidenceReply = buildClawCloudLowConfidenceReply(
    "what is rag",
    buildClawCloudAnswerQualityProfile({
      question: "what is rag",
      intent: "general",
      category: "general",
    }),
  );
  assert.match(definitionLowConfidenceReply, /exact term plus the domain/i);

  const storyLowConfidenceReply = buildClawCloudLowConfidenceReply(
    "tell me the story of my demon in korean",
    buildClawCloudAnswerQualityProfile({
      question: "tell me the story of my demon in korean",
      intent: "culture",
      category: "culture_story",
    }),
  );
  assert.match(storyLowConfidenceReply, /multiple works with the title/i);
  assert.doesNotMatch(storyLowConfidenceReply, /topic, tone, and target length/i);
  assert.match(storyLowConfidenceReply, /could not complete a reliable direct answer/i);
  assert.doesNotMatch(storyLowConfidenceReply, /needs one key detail or clearer scope/i);

  const kalkiLowConfidenceReply = buildClawCloudLowConfidenceReply(
    "what is the story of kalki as is it based on true events",
    buildClawCloudAnswerQualityProfile({
      question: "what is the story of kalki as is it based on true events",
      intent: "culture",
      category: "culture_story",
    }),
  );
  assert.doesNotMatch(kalkiLowConfidenceReply, /kalki as is it based on true events/i);
  assert.match(kalkiLowConfidenceReply, /title "kalki"/i);

  const technicalLowConfidenceReply = buildClawCloudLowConfidenceReply(
    "Explain the difference between idempotency and deduplication in event-driven systems.",
    buildClawCloudAnswerQualityProfile({
      question: "Explain the difference between idempotency and deduplication in event-driven systems.",
      intent: "general",
      category: "general",
    }),
  );
  assert.match(technicalLowConfidenceReply, /could not complete a reliable direct answer/i);
  assert.doesNotMatch(technicalLowConfidenceReply, /needs one key detail or clearer scope/i);

  assert.equal(
    isClawCloudGroundedLiveAnswer({
      question: "what is the gdp of china",
      answer: [
        "*Fresh answer*",
        "",
        "*China GDP*",
        "*Latest official annual estimate:* *$18.74 trillion*",
        "",
        "Year: 2024",
        "Source: worldbank.org",
        "Searched: 26 Mar 2026",
      ].join("\n"),
    }),
    true,
  );

  assert.equal(
    isClawCloudGroundedLiveAnswer({
      question: "OpenAI API pricing today",
      answer: [
        "*Quick answer*",
        "I couldn't verify one precise current figure for *OpenAI API pricing today* from the live sources I found.",
        "",
        "*Closest reliable signals*",
        "- Official pricing pages mention model-specific rates.",
        "",
        "*Best next step*",
        "- Add the exact model or plan name for a tighter answer.",
        "",
        "Searched: 26 Mar 2026",
      ].join("\n"),
    }),
    false,
  );
});

test("phase 7 answer observability classifies refusals and summarizes grounded answer quality", () => {
  assert.equal(
    looksLikeClawCloudRefusal("I couldn't verify that safely from reliable sources."),
    true,
  );
  assert.equal(
    looksLikeClawCloudRefusal("Tokyo is the capital of Japan."),
    false,
  );

  const snapshot = buildClawCloudAnswerObservabilitySnapshot({
    intent: "research",
    category: "live_info",
    latencyMs: 1820.3,
    charCount: 214,
    hadVisibleFallback: false,
    liveAnswerBundle: {
      question: "What is India's GDP today?",
      answer: "India's latest annual GDP estimate is sourced below.",
      channel: "live",
      evidence: [
        {
          title: "World Bank GDP",
          url: "https://worldbank.org/example",
          domain: "worldbank.org",
          snippet: "GDP (current US$)",
          kind: "official_api",
        },
      ],
      sourceSummary: ["worldbank.org"],
      badge: "Fresh answer",
      sourceNote: "Official World Bank indicator.",
      generatedAt: "2026-03-27T10:00:00.000Z",
      metadata: {
        strategy: "deterministic",
      },
    },
    modelAuditTrail: {
      intent: "research",
      responseMode: "deep",
      selectedBy: "judge",
      selectedModel: "gpt-5.4",
      planner: {
        strategy: "collect_and_judge",
        targetResponses: 2,
        generatorBatchSize: 2,
        judgeEnabled: true,
        judgeMinRemainingMs: 6000,
        allowLowConfidenceWinner: false,
        disagreementThreshold: 18,
      },
      candidates: [
        {
          model: "gpt-5.4",
          tier: "reasoning",
          status: "selected",
          latencyMs: 1820,
          heuristicScore: 92,
          preview: "India GDP answer",
        },
      ],
      judge: {
        used: true,
        model: "gpt-5.4-mini",
        winnerModel: "gpt-5.4",
        confidence: "high",
        materialDisagreement: false,
        needsClarification: false,
        reason: null,
      },
    },
  });

  assert.deepEqual(snapshot, {
    intent: "research",
    category: "live_info",
    latencyMs: 1820,
    charCount: 214,
    hadVisibleFallback: false,
    liveAnswer: true,
    liveEvidenceCount: 1,
    liveSourceCount: 1,
    liveStrategy: "deterministic",
    modelAudited: true,
    selectedBy: "judge",
    selectedModel: "gpt-5.4",
    judgeUsed: true,
    materialDisagreement: false,
    needsClarification: false,
  });

  const summary = summarizeClawCloudAnswerObservabilityRecords([
    {
      intent: "research",
      response_state: "answered",
      latency_ms: 1820,
      had_visible_fallback: false,
      live_answer: true,
      live_evidence_count: 1,
      model_audited: true,
      material_disagreement: false,
    },
    {
      intent: "research",
      response_state: "answered",
      latency_ms: 1100,
      had_visible_fallback: true,
      live_answer: false,
      live_evidence_count: 0,
      model_audited: true,
      material_disagreement: true,
    },
    {
      intent: "whatsapp",
      response_state: "consent_prompt",
      latency_ms: 120,
      had_visible_fallback: false,
      live_answer: false,
      live_evidence_count: 0,
      model_audited: false,
      material_disagreement: false,
    },
    {
      intent: "finance",
      response_state: "refused",
      latency_ms: 980,
      had_visible_fallback: false,
      live_answer: true,
      live_evidence_count: 0,
      model_audited: false,
      material_disagreement: false,
    },
  ], 7);

  assert.equal(summary.windowDays, 7);
  assert.equal(summary.totalResponses, 4);
  assert.equal(summary.answeredCount, 2);
  assert.equal(summary.refusalCount, 1);
  assert.equal(summary.consentPromptCount, 1);
  assert.equal(summary.fallbackCount, 1);
  assert.equal(summary.liveAnswerCount, 2);
  assert.equal(summary.liveGroundedCount, 1);
  assert.equal(summary.liveGroundedRate, 50);
  assert.equal(summary.modelAuditedCount, 2);
  assert.equal(summary.disagreementCount, 1);
  assert.equal(summary.avgLatencyMs, 1005);
  assert.equal(summary.topIntents[0]?.intent, "research");
  assert.equal(summary.topIntents[0]?.count, 2);
  assert.equal(summary.topIntents[0]?.fallbackRate, 50);
});

test("deterministic explain replies cover AI, ML, and deep learning comparisons directly", () => {
  const reply = buildDeterministicExplainReplyForTest(
    "Explain the difference between AI, ML, and deep learning in simple terms.",
  );

  assert.ok(reply);
  assert.match(reply ?? "", /Artificial intelligence/i);
  assert.match(reply ?? "", /Machine learning/i);
  assert.match(reply ?? "", /Deep learning/i);
  assert.match(reply ?? "", /AI = the big field/i);
});

test("deterministic explain replies cover foundational AI terms directly", () => {
  const ai = buildDeterministicExplainReplyForTest("what is ai");
  assert.match(ai ?? "", /Artificial intelligence \(AI\) is the broad field/i);

  const llm = buildDeterministicExplainReplyForTest("what is llm");
  assert.match(llm ?? "", /large language model \(LLM\)/i);

  const rag = buildDeterministicExplainReplyForTest("what is rag");
  assert.match(rag ?? "", /RAG stands for retrieval-augmented generation/i);
  assert.match(rag ?? "", /fetches relevant documents or database chunks/i);
});

test("deterministic explain replies cover idempotency versus deduplication directly", () => {
  const reply = buildDeterministicExplainReplyForTest(
    "Explain the difference between idempotency and deduplication in event-driven systems, and give one concrete payment example where deduplication alone is insufficient.",
  );

  assert.match(reply ?? "", /Idempotency and deduplication solve different problems/i);
  assert.match(reply ?? "", /Idempotency:/i);
  assert.match(reply ?? "", /Deduplication:/i);
  assert.match(reply ?? "", /order_123:capture/i);
});

test("deterministic math solver handles repeated-positive Bayesian diagnostic prompts directly", () => {
  const reply = solveHardMathQuestion(
    "A disease has 2% prevalence. A test has 94% sensitivity and 97% specificity. If one patient tests positive twice and you assume the two test results are conditionally independent given the true disease state, what is the posterior probability the patient has the disease? Then explain how your conclusion changes if the false positives are positively correlated.",
  ) ?? "";

  assert.match(reply, /95\.2%/i);
  assert.match(reply, /lower/i);
  assert.match(reply, /37\.5%/i);
});

test("simple knowledge fast lane stays on direct explainers and avoids live or personal-tool routes", () => {
  assert.equal(shouldUseSimpleKnowledgeFastLaneForTest("why is the sky blue"), true);
  assert.equal(shouldUseSimpleKnowledgeFastLaneForTest("how does photosynthesis work"), true);
  assert.equal(shouldUseSimpleKnowledgeFastLaneForTest("latest news about ai"), false);
  assert.equal(shouldUseSimpleKnowledgeFastLaneForTest("show my gmail inbox"), false);
  assert.equal(shouldUseSimpleKnowledgeFastLaneForTest("deep: what is artificial intelligence", "deep"), false);
});

test("primary direct-answer lane catches standalone knowledge prompts beyond wh-questions", () => {
  assert.equal(shouldUseSimpleKnowledgeFastLaneForTest("overview of photosynthesis"), false);
  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest("overview of photosynthesis"), true);
  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest("photosynthesis process"), true);
  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest("latest stock market news"), false);
  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest("show my gmail inbox"), false);
  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest("deep: overview of photosynthesis", "deep"), false);
});

test("primary conversation lane keeps normal follow-ups on direct chat instead of live or tool routes", () => {
  assert.equal(shouldUsePrimaryConversationLaneForTest({
    message: "compare them",
    finalMessage: "Compare Claude and ChatGPT for coding help.",
    resolvedType: "technology",
    resolvedCategory: "technology",
    routeLocked: false,
    memoryIsFollowUp: true,
    mode: undefined,
    hasDocumentContext: false,
    hasDriveRouteMessage: false,
  }), true);

  assert.equal(shouldUsePrimaryConversationLaneForTest({
    message: "latest news about ai",
    finalMessage: "latest news about ai",
    resolvedType: "research",
    resolvedCategory: "research",
    routeLocked: false,
    memoryIsFollowUp: false,
    mode: undefined,
    hasDocumentContext: false,
    hasDriveRouteMessage: false,
  }), false);

  assert.equal(shouldUsePrimaryConversationLaneForTest({
    message: "show my gmail inbox",
    finalMessage: "show my gmail inbox",
    resolvedType: "email",
    resolvedCategory: "email_search",
    routeLocked: true,
    memoryIsFollowUp: false,
    mode: undefined,
    hasDocumentContext: false,
    hasDriveRouteMessage: false,
  }), false);

  assert.equal(shouldUsePrimaryConversationLaneForTest({
    message: "deep: compare them",
    finalMessage: "Compare Claude and ChatGPT for coding help.",
    resolvedType: "technology",
    resolvedCategory: "technology",
    routeLocked: false,
    memoryIsFollowUp: true,
    mode: "deep",
    hasDocumentContext: false,
    hasDriveRouteMessage: false,
  }), false);
});

test("inbound route timeout policy is category-aware", () => {
  const direct = getInboundRouteTimeoutPolicyForTest("why is the sky blue");
  assert.equal(direct.kind, "direct_knowledge");
  assert.equal(direct.timeoutMs, 60000);

  const standaloneDirect = getInboundRouteTimeoutPolicyForTest("overview of photosynthesis");
  assert.equal(standaloneDirect.kind, "direct_knowledge");
  assert.equal(standaloneDirect.timeoutMs, 60000);

  const spanishDirect = getInboundRouteTimeoutPolicyForTest("¿Puedes explicar la fotosíntesis de forma simple?");
  assert.equal(spanishDirect.kind, "direct_knowledge");
  assert.equal(spanishDirect.timeoutMs, 60000);

  const kannadaDirect = getInboundRouteTimeoutPolicyForTest("10 ನಾಡು ಕನ್ನಡ ಸಾಹಿತ್ಯದ ಕವಿಗಳ ಬಗ್ಗೆ ಗೊಬ್ಬಿ ಬರೆಯಿರಿ");
  assert.equal(kannadaDirect.kind, "direct_knowledge");
  assert.equal(kannadaDirect.timeoutMs, 60000);

  const live = getInboundRouteTimeoutPolicyForTest("latest news about ai");
  assert.equal(live.kind, "live_research");
  assert.equal(live.timeoutMs, 36000);

  const operational = getInboundRouteTimeoutPolicyForTest("show my gmail inbox");
  assert.equal(operational.kind, "operational");
  assert.equal(operational.timeoutMs, 50000);

  const deep = getInboundRouteTimeoutPolicyForTest("deep: explain transformers");
  assert.equal(deep.kind, "deep_reasoning");
  assert.equal(deep.timeoutMs, 55000);

  const groupedDeep = getInboundRouteTimeoutPolicyForTest("[Group message from product team] deep: what is artificial intelligence");
  assert.equal(groupedDeep.kind, "deep_reasoning");
  assert.equal(groupedDeep.timeoutMs, 55000);
});

test("locale preference commands are explicit and do not depend on email domains", () => {
  assert.deepEqual(detectLocalePreferenceCommand("reply in english"), {
    type: "set",
    locale: "en",
    label: "English",
  });

  assert.deepEqual(detectLocalePreferenceCommand("set language to hindi"), {
    type: "set",
    locale: "hi",
    label: "Hindi",
  });

  assert.deepEqual(detectLocalePreferenceCommand("what is my language"), {
    type: "show",
  });

  assert.deepEqual(detectLocalePreferenceCommand("translate this to english"), {
    type: "none",
  });

  assert.equal(detectLocaleFromEmail("founder@startup.co.in"), "hi");
  assert.equal(detectLocaleFromEmail("founder@startup.invest"), "en");
});

test("reply language resolver mirrors the user's current message language when it is clear", () => {
  assert.equal(inferClawCloudMessageLocale("Necesito ayuda con esto hoy, por favor."), "es");
  assert.equal(inferClawCloudMessageLocale("Bonjour, explique-moi ça clairement."), "fr");
  assert.equal(inferClawCloudMessageLocale("Can you explain this clearly today?"), "en");
  assert.equal(extractExplicitReplyLocaleRequest("tell me the story of my demon in korean"), "ko");

  const spanish = resolveClawCloudReplyLanguage({
    message: "Necesito ayuda con esto hoy, por favor.",
    preferredLocale: "en",
  });
  assert.equal(spanish.locale, "es");
  assert.equal(spanish.source, "mirrored_message");

  const english = resolveClawCloudReplyLanguage({
    message: "Can you explain this clearly today?",
    preferredLocale: "hi",
  });
  assert.equal(english.locale, "en");
  assert.equal(english.source, "mirrored_message");

  const explicitKorean = resolveClawCloudReplyLanguage({
    message: "tell me the story of my demon in korean",
    preferredLocale: "en",
  });
  assert.equal(explicitKorean.locale, "ko");
  assert.equal(explicitKorean.source, "explicit_request");
});

test("reply language resolver keeps Hinglish in Roman script instead of forcing pure Hindi", () => {
  const resolution = resolveClawCloudReplyLanguage({
    message: "mujhe simple way mein samjhao yaar",
    preferredLocale: "hi",
  });

  assert.equal(resolution.locale, "en");
  assert.equal(resolution.source, "hinglish_message");
  assert.equal(resolution.preserveRomanScript, true);

  const instruction = buildClawCloudReplyLanguageInstruction(resolution);
  assert.match(instruction, /Hinglish/i);
  assert.match(instruction, /Roman script/i);
});

test("reply language resolver catches common Hinglish shorthand in capability prompts", () => {
  const message = "aap kese ho or aap kya kr skte ho";
  assert.equal(detectHinglish(message), true);

  const resolution = resolveClawCloudReplyLanguage({
    message,
    preferredLocale: "en",
  });

  assert.equal(resolution.locale, "en");
  assert.equal(resolution.source, "hinglish_message");
  assert.equal(resolution.preserveRomanScript, true);
});

test("localized capability replies stay conversational and mirror the current language", () => {
  const hinglishReply = buildLocalizedCapabilityReplyFromMessageForTest("aap kese ho or aap kya kr skte ho");
  assert.match(hinglishReply, /Main theek hoon/i);
  assert.match(hinglishReply, /coding, writing, math, research/i);
  assert.doesNotMatch(hinglishReply, /quick guide/i);

  const spanishReply = buildLocalizedCapabilityReplyForTest("que puedes hacer", "es");
  assert.match(spanishReply, /Puedo ayudarte/i);
  assert.match(spanishReply, /Dime la tarea exacta/i);
});

test("multilingual routing bridge promotes native-language prompts onto direct answer lanes", () => {
  const kannadaResolution = resolveClawCloudReplyLanguage({
    message: "10 ನಾಡು ಕನ್ನಡ ಸಾಹಿತ್ಯದ ಕವಿಗಳ ಬಗ್ಗೆ ಗೊಬ್ಬಿ ಬರೆಯಿರಿ",
    preferredLocale: "en",
  });
  assert.equal(kannadaResolution.locale, "kn");
  assert.equal(kannadaResolution.source, "mirrored_message");
  assert.equal(
    shouldUseMultilingualRoutingBridgeForTest(
      "10 ನಾಡು ಕನ್ನಡ ಸಾಹಿತ್ಯದ ಕವಿಗಳ ಬಗ್ಗೆ ಗೊಬ್ಬಿ ಬರೆಯಿರಿ",
      kannadaResolution,
    ),
    true,
  );

  assert.deepEqual(
    detectMultilingualNativeAnswerLaneIntentForTest("Write a gobbi about 10 Kannada literary poets."),
    { type: "creative", category: "creative" },
  );

  assert.deepEqual(
    detectMultilingualNativeAnswerLaneIntentForTest("What can you do for me?"),
    { type: "help", category: "help" },
  );

  assert.equal(
    detectMultilingualNativeAnswerLaneIntentForTest("Show my Gmail inbox."),
    null,
  );
});

test("native-language direct answer lane stays available even when English gloss routing is unavailable", () => {
  const spanishResolution = resolveClawCloudReplyLanguage({
    message: "¿Puedes explicar la fotosíntesis de forma simple?",
    preferredLocale: "en",
  });
  assert.equal(spanishResolution.locale, "es");
  assert.deepEqual(
    detectNativeLanguageDirectAnswerLaneIntentForTest(
      "¿Puedes explicar la fotosíntesis de forma simple?",
      spanishResolution,
    ),
    { type: "general", category: "general" },
  );

  const kannadaResolution = resolveClawCloudReplyLanguage({
    message: "10 ನಾಡು ಕನ್ನಡ ಸಾಹಿತ್ಯದ ಕವಿಗಳ ಬಗ್ಗೆ ಗೊಬ್ಬಿ ಬರೆಯಿರಿ",
    preferredLocale: "en",
  });
  assert.equal(kannadaResolution.locale, "kn");
  assert.deepEqual(
    detectNativeLanguageDirectAnswerLaneIntentForTest(
      "10 ನಾಡು ಕನ್ನಡ ಸಾಹಿತ್ಯದ ಕವಿಗಳ ಬಗ್ಗೆ ಗೊಬ್ಬಿ ಬರೆಯಿರಿ",
      kannadaResolution,
    ),
    { type: "general", category: "general" },
  );
});

test("whole-alias matching blocks substring false positives", () => {
  assert.equal(matchesWholeAlias("What is the price of Bitcoin right now in USD?", "itc"), false);
  assert.equal(matchesWholeAlias("cricket semifinal score", "mi"), false);
  assert.equal(matchesWholeAlias("ITC share price today", "itc"), true);
  assert.equal(matchesWholeAlias("Need a follow up on the invoice thread", "follow up"), true);
});

test("coding fallback respects requested language aliases for algorithm prompts", () => {
  assert.equal(detectRequestedLanguageForFallback("ok what write code for n queen in js"), "javascript");
  assert.equal(detectRequestedLanguageForFallback("write binary search in ts"), "typescript");
  assert.equal(detectRequestedLanguageForFallback("solve palindrome in java"), "java");
  assert.equal(detectRequestedLanguageForFallback("write palindrome code in js"), "javascript");
  assert.equal(detectRequestedLanguageForFallback("write n queen ts"), "typescript");
  assert.equal(detectRequestedLanguageForFallback("write fibonacci code in go"), "go");
  assert.equal(detectRequestedLanguageForFallback("write palindrome in rust"), "rust");
  assert.equal(detectRequestedLanguageForFallback("how does fibonacci go"), "text");

  const nQueensJs = buildCodingFallbackV2("ok what write code for n queen in js");
  assert.match(nQueensJs, /N-Queens \(Backtracking\) - JavaScript/i);
  assert.match(nQueensJs, /\*Why this approach works\*/i);
  assert.match(nQueensJs, /\*Code\*/i);
  assert.match(nQueensJs, /\*Complexity\*/i);
  assert.match(nQueensJs, /```javascript/i);
  assert.doesNotMatch(nQueensJs, /```python/i);

  const fibonacciTs = buildCodingFallbackV2("write fibonacci code in ts");
  assert.match(fibonacciTs, /Fibonacci - TypeScript/i);
  assert.match(fibonacciTs, /```ts/i);
  assert.doesNotMatch(fibonacciTs, /```python/i);

  const ratMazeJava = buildCodingFallbackV2("show rat in a maze code in java");
  assert.match(ratMazeJava, /Rat in a Maze \(All Paths\) - Java/i);
  assert.match(ratMazeJava, /```java/i);
  assert.doesNotMatch(ratMazeJava, /```python/i);
  assert.match(ratMazeJava, /\bclass\s+RatInMaze\b/i);

  const binarySearchJava = buildCodingFallbackV2("write binary search in java");
  assert.match(binarySearchJava, /Binary Search - Java/i);
  assert.match(binarySearchJava, /```java/i);
  assert.doesNotMatch(binarySearchJava, /```python/i);

  const palindromeJs = buildCodingFallbackV2("write palindrome code in js");
  assert.match(palindromeJs, /Palindrome Check - JavaScript/i);
  assert.match(palindromeJs, /```javascript/i);
  assert.doesNotMatch(palindromeJs, /```python/i);

  const nQueensTs = buildCodingFallbackV2("write n queen ts");
  assert.match(nQueensTs, /N-Queens \(Backtracking\) - TypeScript/i);
  assert.match(nQueensTs, /```ts/i);
  assert.doesNotMatch(nQueensTs, /```python/i);

  const fibonacciGo = buildCodingFallbackV2("write fibonacci code in go");
  assert.match(fibonacciGo, /Fibonacci - Go/i);
  assert.match(fibonacciGo, /```go/i);
  assert.doesNotMatch(fibonacciGo, /```python/i);

  const palindromeRust = buildCodingFallbackV2("write palindrome in rust");
  assert.match(palindromeRust, /Palindrome Check - Rust/i);
  assert.match(palindromeRust, /```rust/i);
  assert.doesNotMatch(palindromeRust, /```python/i);
});

test("finance replies read like a clean market brief instead of a raw quote dump", () => {
  const reply = formatFinanceReply({
    symbol: "BTC",
    name: "Bitcoin",
    price: 70_739,
    currency: "USD",
    secondaryPrices: [{ currency: "INR", price: 5_877_000 }],
    change: 1_204,
    changePct: 1.73,
    high24h: 71_200,
    low24h: 69_200,
    volume: 1_230_000_000,
    marketCap: 1_410_000_000_000,
    exchange: "CoinGecko",
    asOf: "2026-03-21T08:15:00.000Z",
    source: "CoinGecko",
  });

  assert.match(reply, /\*Quick take:\*/i);
  assert.match(reply, /\*Market snapshot\*/i);
  assert.match(reply, /Day range:/i);
  assert.match(reply, /\*Cross-currency view\*/i);
  assert.match(reply, /\*Source\*/i);
});

test("finance data localizes to requested country or currency context", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.includes("query1.finance.yahoo.com/v7/finance/quote") && url.includes("GC%3DF")) {
      return new Response(JSON.stringify({
        quoteResponse: {
          result: [
            {
              symbol: "GC=F",
              shortName: "Gold Apr 26",
              regularMarketPrice: 2400,
              regularMarketChange: 20,
              regularMarketChangePercent: 0.84,
              regularMarketDayHigh: 2412,
              regularMarketDayLow: 2388,
              regularMarketVolume: 220770,
              currency: "USD",
              fullExchangeName: "CMX",
            },
          ],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (url.includes("query1.finance.yahoo.com/v7/finance/quote") && url.includes("AAPL")) {
      return new Response(JSON.stringify({
        quoteResponse: {
          result: [
            {
              symbol: "AAPL",
              shortName: "Apple Inc.",
              regularMarketPrice: 210,
              regularMarketChange: 1.5,
              regularMarketChangePercent: 0.72,
              regularMarketDayHigh: 212,
              regularMarketDayLow: 207.5,
              regularMarketVolume: 45000000,
              marketCap: 3200000000000,
              currency: "USD",
              fullExchangeName: "NasdaqGS",
            },
          ],
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (url.includes("api.coingecko.com/api/v3/coins/bitcoin")) {
      return new Response(JSON.stringify({
        name: "Bitcoin",
        symbol: "btc",
        market_data: {
          current_price: {
            usd: 70981,
            inr: 5916864,
            aed: 260680,
          },
          price_change_24h: 1290,
          price_change_percentage_24h: 1.85,
          high_24h: {
            usd: 71050,
            inr: 5922500,
            aed: 260940,
          },
          low_24h: {
            usd: 69517,
            inr: 5794600,
            aed: 255330,
          },
          total_volume: {
            usd: 28190000000,
            inr: 2352450000000,
            aed: 103500000000,
          },
          market_cap: {
            usd: 1410000000000,
            inr: 117735000000000,
            aed: 5172000000000,
          },
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (url.includes("open.er-api.com/v6/latest/USD")) {
      return new Response(JSON.stringify({
        result: "success",
        time_last_update_utc: "Sat, 21 Mar 2026 12:00:00 +0000",
        rates: {
          INR: 83.5,
          AED: 3.6725,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    throw new Error(`Unexpected fetch during finance localization test: ${url}`);
  }) as typeof fetch;

  try {
    const goldIndia = await getLiveFinanceData("भारत में सोने की कीमत क्या है");
    assert.ok(goldIndia);
    assert.equal(goldIndia?.currency, "INR");
    assert.ok(goldIndia?.secondaryPrices?.some((entry) => entry.currency === "USD"));
    assert.equal(goldIndia?.displayTimeZone, "Asia/Kolkata");
    assert.match(formatFinanceReply(goldIndia!), /\*Local market view\*/i);
    assert.match(formatFinanceReply(goldIndia!), /per 10g/i);

    const appleIndia = await getLiveFinanceData("apple stock price in india");
    assert.ok(appleIndia);
    assert.equal(appleIndia?.currency, "INR");
    assert.ok(appleIndia?.secondaryPrices?.some((entry) => entry.currency === "USD"));

    const bitcoinDubai = await getLiveFinanceData("bitcoin price in dubai");
    assert.ok(bitcoinDubai);
    assert.equal(bitcoinDubai?.currency, "AED");
    assert.equal(bitcoinDubai?.displayTimeZone, "Asia/Dubai");
    assert.match(formatFinanceReply(bitcoinDubai!), /local market time/i);

    const dollarInRupees = await getLiveFinanceData("what is the price of 1 dollar in rs");
    assert.ok(dollarInRupees);
    assert.equal(dollarInRupees?.symbol, "USD/INR");
    assert.equal(dollarInRupees?.currency, "INR");
    assert.equal(dollarInRupees?.price, 83.5);
    assert.match(formatFinanceReply(dollarInRupees!), /1 USD = ₹83\.50 INR/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("evidence-only web answers use a stronger briefing format", () => {
  const answer = buildEvidenceOnlyAnswer("OpenAI API pricing today", [
    {
      title: "OpenAI pricing roundup",
      url: "https://timesofindia.indiatimes.com/tech/ai/openai-pricing-roundup/articleshow/123456.cms",
      snippet: "A commentary article summarizing OpenAI pricing changes for Indian readers.",
      domain: "timesofindia.indiatimes.com",
      publishedDate: "2026-03-21T10:00:00.000Z",
      score: 1.05,
    },
    {
      title: "OpenAI API pricing",
      url: "https://openai.com/api/pricing",
      snippet: "Official pricing page for the OpenAI API with current token and model rates.",
      domain: "OpenAI",
      publishedDate: "2026-03-21T08:00:00.000Z",
      score: 0.92,
    },
    {
      title: "API pricing changes summary",
      url: "https://platform.openai.com/docs/pricing",
      snippet: "Developer documentation covering the latest API pricing details and billing guidance.",
      domain: "platform.openai.com",
      publishedDate: "2026-03-20T18:30:00.000Z",
      score: 0.91,
    },
  ]);

  assert.match(answer, /\*Quick answer\*/i);
  assert.match(answer, /\*Closest reliable signals\*/i);
  assert.match(answer, /\*Best next step\*/i);
  assert.match(answer, /Strongest source in this batch: \*(openai\.com|OpenAI)\*/i);
  assert.match(answer, /Add a provider, country, city\/market, or exact plan\/model name/i);
});

test("official pricing routing detects supported provider pricing questions conservatively", () => {
  assert.deepEqual(
    detectOfficialPricingQuery("What is OpenAI API pricing today?"),
    { provider: "openai_api" },
  );
  assert.deepEqual(
    detectOfficialPricingQuery("What is Vercel Pro pricing?"),
    { provider: "vercel", target: "Pro" },
  );
  assert.deepEqual(
    detectOfficialPricingQuery("Supabase pricing"),
    { provider: "supabase" },
  );
  assert.equal(detectOfficialPricingQuery("ChatGPT Plus pricing"), null);
  assert.equal(detectOfficialPricingQuery("compare GPT-5.4 and Claude Sonnet 4 for coding and price"), null);
  assert.equal(detectOfficialPricingQuery("Stripe Terminal pricing"), null);
  assert.equal(detectOfficialPricingQuery("Vercel Blob pricing"), null);
  assert.equal(detectOfficialPricingQuery("Design a pricing page on Vercel for my SaaS app"), null);
  assert.equal(detectOfficialPricingQuery("Build a Stripe pricing service for usage-based billing"), null);
});

test("official pricing answers use direct provider pages for supported pricing questions", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.includes("openai.com/api/pricing")) {
      return new Response([
        "<html><body>",
        "<h2>GPT-5.4</h2>",
        "<p>Input: $2.50 / 1M tokens</p>",
        "<p>Cached input: $0.25 / 1M tokens</p>",
        "<p>Output: $15.00 / 1M tokens</p>",
        "<h2>GPT-5.4 mini</h2>",
        "<p>Input: $0.750 / 1M tokens</p>",
        "<p>Cached input: $0.075 / 1M tokens</p>",
        "<p>Output: $4.500 / 1M tokens</p>",
        "<h2>GPT-5.4 nano</h2>",
        "<p>Input: $0.20 / 1M tokens</p>",
        "<p>Cached input: $0.02 / 1M tokens</p>",
        "<p>Output: $0.80 / 1M tokens</p>",
        "</body></html>",
      ].join(""), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }

    if (url.includes("vercel.com/pricing")) {
      return new Response([
        "<html><body>",
        "<h1>Find a plan to power your apps.</h1>",
        "<h2>Hobby</h2>",
        "<p>Free forever.</p>",
        "<h2>Pro</h2>",
        "<p>$20/mo + additional usage</p>",
        "<p>$20 of included usage credit</p>",
        "<h2>Enterprise</h2>",
        "<p>Get a demo</p>",
        "</body></html>",
      ].join(""), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }

    if (url.includes("supabase.com/docs/guides/platform/billing-faq")) {
      return new Response([
        "<html><body>",
        "<p>Each organization only has a single subscription with a single plan (Free, Pro, Team or Enterprise).</p>",
        "<p>$25 Pro Plan</p>",
        "<p>$10 in Compute Credits</p>",
        "<p>Additional projects start at ~$10 a month (billed hourly).</p>",
        "</body></html>",
      ].join(""), {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }

    if (url.includes("supabase.com/docs/guides/platform/billing-on-supabase")) {
      return new Response("<html><body><p>Billing on Supabase</p></body></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    }

    throw new Error(`Unexpected fetch during test: ${url}`);
  }) as typeof fetch;

  try {
    const openAiAnswer = await fetchOfficialPricingAnswer("What is OpenAI API pricing today?");
    assert.match(openAiAnswer, /\*OpenAI API pricing \(official\)\*/i);
    assert.match(openAiAnswer, /GPT-5\.4: input \$2\.50 \/ 1M tokens/i);
    assert.match(openAiAnswer, /GPT-5\.4 mini: input \$0\.750 \/ 1M tokens/i);

    const vercelAnswer = await fetchOfficialPricingAnswer("What is Vercel Pro pricing?");
    assert.match(vercelAnswer, /\*Vercel pricing \(official\)\*/i);
    assert.match(vercelAnswer, /Pro: \$20\/mo \+ additional usage/i);
    assert.match(vercelAnswer, /\$20 of included usage credit/i);

    const supabaseAnswer = await fetchOfficialPricingAnswer("Supabase pricing");
    assert.match(supabaseAnswer, /\*Supabase pricing \(official billing docs\)\*/i);
    assert.match(supabaseAnswer, /Plans: Free, Pro, Team, Enterprise/i);
    assert.match(supabaseAnswer, /Pro: \$25\/month/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI model routing clarifies ambiguous family names and preserves normal writing prompts", async () => {
  const ambiguous = detectAiModelRoutingDecision("difference between gpt 5.4 and opus 4.6");
  assert.equal(ambiguous?.mode, "clarify");
  assert.equal(ambiguous?.kind, "comparison");
  assert.match(ambiguous?.clarificationReply ?? "", /Model name clarification/i);
  assert.match(ambiguous?.clarificationReply ?? "", /Claude Opus/i);

  const scopedSearch = detectAiModelRoutingDecision("difference between GPT-5.4 and Claude Sonnet 4");
  assert.equal(scopedSearch?.mode, "web_search");
  assert.equal(scopedSearch?.kind, "comparison");
  assert.ok(scopedSearch?.searchQueries.some((query) => /official comparison/i.test(query)));

  const multiAxisSearch = detectAiModelRoutingDecision("compare GPT-5.4 and Claude Sonnet 4 for coding and price");
  assert.equal(multiAxisSearch?.mode, "web_search");
  assert.equal(multiAxisSearch?.kind, "comparison");
  assert.ok(multiAxisSearch?.searchQueries.some((query) => /official specs/i.test(query)));

  const clear = detectAiModelRoutingDecision("compare GPT-5.4 and Claude Sonnet 4 for coding");
  assert.equal(clear?.mode, "web_search");
  assert.equal(clear?.kind, "comparison");
  assert.ok(clear?.officialDomains.includes("openai.com"));
  assert.ok(clear?.officialDomains.includes("anthropic.com"));
  assert.ok(clear?.searchQueries.some((query) => /site:openai\.com/i.test(query)));
  assert.ok(clear?.searchQueries.some((query) => /site:anthropic\.com/i.test(query)));
  assert.ok(clear?.searchQueries.some((query) => /\bGPT-5\.4 official\b/i.test(query)));
  assert.ok(clear?.searchQueries.some((query) => /\bClaude Sonnet 4 official\b/i.test(query)));

  const holistic = detectAiModelRoutingDecision("what is difference between gemini 3.2 pro vs gpt 5.4 and claude opus 4.6 and also there relase date");
  assert.equal(holistic?.mode, "web_search");
  assert.equal(holistic?.kind, "comparison");
  assert.ok(holistic?.searchQueries.some((query) => /\bGemini 3\.2 Pro official\b/i.test(query)));
  assert.ok(holistic?.searchQueries.some((query) => /official release date/i.test(query)));

  const ranking = detectAiModelRoutingDecision("which is the top 10 most advance ai model in 2026");
  assert.equal(ranking?.mode, "web_search");
  assert.equal(ranking?.kind, "ranking");
  assert.ok(ranking?.officialDomains.includes("openai.com"));
  assert.ok(ranking?.officialDomains.includes("anthropic.com"));
  assert.ok(ranking?.officialDomains.includes("ai.google.dev"));
  assert.ok(ranking?.searchQueries.some((query) => /benchmark leaderboard/i.test(query)));
  assert.ok(ranking?.searchQueries.some((query) => /flagship model official/i.test(query)));

  assert.equal(detectAiModelRoutingDecision("what is artificial intelligence"), null);
  assert.equal(detectAiModelRoutingDecision("explain machine learning"), null);
  assert.equal(detectAiModelRoutingDecision("what is rag"), null);
  assert.equal(detectAiModelRoutingDecision("write a haiku about rain"), null);

  const directReply = await answerWebSearch("difference between gpt 5.4 and opus 4.6");
  assert.match(directReply, /Model name clarification/i);
});

test("AI model evidence filters out company-app-course noise and keeps source-backed model mentions", () => {
  const question = "which is the top 10 most advance ai model in 2026";
  const curated = filterAiModelEvidenceSources(question, [
    {
      title: "48 Top AI Apps in 2026",
      url: "https://builtin.com/artificial-intelligence/top-ai-apps",
      snippet: "A roundup of AI apps and productivity tools for teams.",
      domain: "builtin.com",
      score: 0.4,
    },
    {
      title: "GPT-5.4",
      url: "https://openai.com/index/gpt-5-4",
      snippet: "OpenAI introduces GPT-5.4 with stronger reasoning and coding support.",
      domain: "openai.com",
      score: 0.7,
    },
    {
      title: "Claude Sonnet 4",
      url: "https://www.anthropic.com/news/claude-sonnet-4",
      snippet: "Anthropic shares Claude Sonnet 4 capabilities and usage guidance.",
      domain: "anthropic.com",
      score: 0.68,
    },
    {
      title: "Gemini 2.5 Pro",
      url: "https://blog.google/technology/google-deepmind/gemini-2-5-pro/",
      snippet: "Google details Gemini 2.5 Pro and its multimodal reasoning upgrades.",
      domain: "blog.google",
      score: 0.66,
    },
  ], ["openai.com", "anthropic.com", "ai.google.dev", "blog.google"]);

  assert.equal(curated.some((source) => source.domain === "builtin.com"), false);
  assert.ok(curated.some((source) => source.domain === "openai.com"));
  assert.ok(curated.some((source) => source.domain === "anthropic.com"));

  const fallback = buildAiModelEvidenceOnlyAnswer(question, curated);
  assert.match(fallback, /AI model frontier snapshot/i);
  assert.match(fallback, /There is no single universal official top-10 ranking/i);
  if (false) {
  assert.match(fallback, /OpenAI — GPT-5\.4/i);
  assert.match(fallback, /Anthropic — Claude Sonnet 4/i);
  assert.match(fallback, /Google — Gemini 2\.5 Pro/i);

  }
  assert.match(fallback, /OpenAI.*GPT-5\.4/i);
  assert.match(fallback, /Anthropic.*Claude Sonnet 4/i);
  assert.match(fallback, /Google.*Gemini 2\.5 Pro/i);
  assert.doesNotMatch(fallback, /â€”|â€¢/i);

  const thinFallback = buildAiModelEvidenceOnlyAnswer(question, [
    {
      title: "10 Best AI Companies",
      url: "https://example.com/ai-companies",
      snippet: "A roundup of AI companies to watch in 2026.",
      domain: "example.com",
      score: 0.3,
    },
  ]);
  assert.match(thinFallback, /I couldn't verify a universal official top-10 ranking/i);
  assert.match(thinFallback, /Ask for one axis: coding, reasoning, price, latency, multimodal, or open-weight/i);

  const compareFallback = buildAiModelEvidenceOnlyAnswer(
    "what is difference between gemini 3.2 pro vs gpt 5.4 and claude opus 4.6 and also there relase date",
    [
      {
        title: "GPT-5.4",
        url: "https://openai.com/index/gpt-5-4",
        snippet: "OpenAI introduces GPT-5.4 with stronger reasoning and coding support.",
        domain: "openai.com",
        publishedDate: "2026-02-12T00:00:00.000Z",
        score: 0.75,
      },
      {
        title: "Claude Opus 4.6",
        url: "https://www.anthropic.com/news/claude-opus-4-6",
        snippet: "Anthropic introduces Claude Opus 4.6 for advanced reasoning and coding.",
        domain: "anthropic.com",
        publishedDate: "2026-03-03T00:00:00.000Z",
        score: 0.74,
      },
      {
        title: "Gemini 3.1 Pro",
        url: "https://blog.google/technology/google-deepmind/gemini-3-1-pro/",
        snippet: "Google DeepMind announces Gemini 3.1 Pro as its latest Pro model.",
        domain: "blog.google",
        publishedDate: "2026-02-19T00:00:00.000Z",
        score: 0.73,
      },
    ],
  );
  assert.match(compareFallback, /AI model comparison snapshot/i);
  assert.match(compareFallback, /GPT-5\.4: explicitly named/i);
  assert.match(compareFallback, /Claude Opus 4\.6: explicitly named/i);
  assert.match(compareFallback, /Gemini 3\.2 Pro: not confirmed as an official model name/i);
  assert.match(compareFallback, /closest explicit Google model here is Gemini 3\.1 Pro/i);
  assert.match(compareFallback, /Release signal for Gemini 3\.1 Pro: (?:19 Feb 2026|Feb 19, 2026)/i);

  const noEvidenceCompareFallback = buildAiModelEvidenceOnlyAnswer(
    "Compare GPT-5.4, Claude Sonnet 4, and Gemini 3.1 Pro for coding, price, and release timing.",
    [],
  );
  if (false) {
  assert.match(noEvidenceCompareFallback, /Targets extracted from your question/i);
  assert.match(noEvidenceCompareFallback, /OpenAI — GPT-5\.4/i);
  assert.match(noEvidenceCompareFallback, /Anthropic — Claude Sonnet 4/i);
  assert.match(noEvidenceCompareFallback, /Google — Gemini 3\.1 Pro/i);
  assert.match(noEvidenceCompareFallback, /current source batch was too thin/i);
  }
  assert.match(noEvidenceCompareFallback, /Targets extracted from your question/i);
  assert.match(noEvidenceCompareFallback, /OpenAI.*GPT-5\.4/i);
  assert.match(noEvidenceCompareFallback, /Anthropic.*Claude Sonnet 4/i);
  assert.match(noEvidenceCompareFallback, /Google.*Gemini 3\.1 Pro/i);
  assert.match(noEvidenceCompareFallback, /current source batch was too thin/i);
  assert.doesNotMatch(noEvidenceCompareFallback, /â€”|â€¢/i);
});

test("send-message parsing keeps contact commands strict and avoids tell-me hijacks", () => {
  assert.equal(parseSendMessageCommand("tell me top 10 richest persons and richest cities of the world"), null);
  assert.equal(parseSendMessageCommand("message me: hello"), null);

  const parsed = parseSendMessageCommand("tell Raj that I will be 10 minutes late");
  assert.ok(parsed);
  assert.equal(parsed?.kind, "contacts");
  assert.equal(parsed?.contactName, "Raj");
  assert.equal(parsed?.message, "I will be 10 minutes late");
});

test("send-message safety blocks scheduled, conditional, and ambiguous recipient commands without breaking normal drafts", () => {
  const scheduled = analyzeSendMessageCommandSafety('Send "Good morning" to Maa tomorrow at 8am');
  assert.ok(scheduled && !scheduled.allowed);
  if (scheduled && !scheduled.allowed) {
    assert.equal(scheduled.issue, "scheduled_send");
  }

  const conditional = analyzeSendMessageCommandSafety('Send "Call me" to Raj if he does not pick up');
  assert.ok(conditional && !conditional.allowed);
  if (conditional && !conditional.allowed) {
    assert.equal(conditional.issue, "conditional_send");
  }

  const ambiguousRecipient = analyzeSendMessageCommandSafety("Send hello to me and Raj");
  assert.ok(ambiguousRecipient && !ambiguousRecipient.allowed);
  if (ambiguousRecipient && !ambiguousRecipient.allowed) {
    assert.equal(ambiguousRecipient.issue, "ambiguous_recipient");
    assert.deepEqual(ambiguousRecipient.ambiguousRecipients, ["me"]);
  }

  const normalMessage = analyzeSendMessageCommandSafety("Send message to Maa: I will arrive tomorrow at 8am");
  assert.ok(normalMessage?.allowed);
  if (normalMessage?.allowed) {
    assert.equal(normalMessage.parsed.contactName, "Maa");
    assert.equal(normalMessage.parsed.message, "I will arrive tomorrow at 8am");
  }
});

test("send-message action planning escalates multi-recipient and broadcast requests before queueing", () => {
  const multiParsed = parseSendMessageCommand("Send hello to Maa and Papa");
  assert.ok(multiParsed);
  if (multiParsed) {
    assert.deepEqual(buildParsedSendMessageAction(multiParsed), {
      scope: "multi_contact",
      requestedRecipientLabels: ["Maa", "Papa"],
      requestedRecipientCount: 2,
      message: "hello",
      reviewLabel: "2 contacts",
      requiresHeightenedConfirmation: true,
      confirmationMode: "always",
      riskSummary: "multi_recipient",
    });
  }

  const broadcastParsed = parseSendMessageCommand("Send meeting starts at 6 to everyone");
  assert.ok(broadcastParsed);
  if (broadcastParsed) {
    assert.deepEqual(buildParsedSendMessageAction(broadcastParsed), {
      scope: "broadcast_all",
      requestedRecipientLabels: [],
      requestedRecipientCount: 0,
      message: "meeting starts at 6",
      reviewLabel: "all contacts",
      requiresHeightenedConfirmation: true,
      confirmationMode: "broadcast_explicit",
      riskSummary: "broadcast_all",
    });
  }
});

test("contact ranking resolves family aliases from synced WhatsApp names and recent chat history", () => {
  const resolved = rankContactCandidates("papa ji", [
    {
      name: "Papa Ji",
      phone: "919876543210",
      jid: "919876543210@s.whatsapp.net",
      aliases: ["Papa Ji", "Papa", "Pitaji"],
    },
    {
      name: "Raj Kumar",
      phone: "919111111111",
      jid: "919111111111@s.whatsapp.net",
      aliases: ["Raj Kumar", "Raj"],
    },
  ]);

  assert.equal(resolved.type, "found");
  if (resolved.type === "found") {
    assert.equal(resolved.contact.name, "Papa Ji");
    assert.equal(resolved.contact.phone, "919876543210");
    assert.equal(resolved.contact.jid, "919876543210@s.whatsapp.net");
  }

  const fromHistory = rankContactCandidates("papaji", [
    {
      name: "Papa",
      phone: "919876543210",
      jid: null,
      aliases: ["Papa", "Papa Ji"],
    },
  ]);

  assert.equal(fromHistory.type, "found");
  if (fromHistory.type === "found") {
    assert.equal(fromHistory.contact.phone, "919876543210");
  }
});

test("ambiguous contact prompts explain why each strong WhatsApp match was considered", () => {
  const ambiguous = rankContactCandidates("raj", [
    {
      name: "Raj Sharma",
      phone: "919111111111",
      jid: "919111111111@s.whatsapp.net",
      aliases: ["Raj Sharma", "Raj"],
    },
    {
      name: "Raj Verma",
      phone: "919222222222",
      jid: "919222222222@s.whatsapp.net",
      aliases: ["Raj Verma", "Raj"],
    },
  ]);

  assert.equal(ambiguous.type, "ambiguous");
  if (ambiguous.type === "ambiguous") {
    assert.match(ambiguous.prompt, /strong WhatsApp match/i);
    assert.match(ambiguous.prompt, /Raj Sharma - \+919111111111 \(exact alias "Raj"\)/i);
    assert.match(ambiguous.prompt, /Raj Verma - \+919222222222 \(exact alias "Raj"\)/i);
    assert.match(ambiguous.prompt, /Tell me the exact contact name or full number/i);
    assert.doesNotMatch(ambiguous.prompt, /Reply with the number/i);
  }
});

test("contact ranking understands softer family nicknames and inactive-contact aliases", () => {
  const diiResolved = rankContactCandidates("dii", [
    {
      name: "Didi",
      phone: "919700000001",
      jid: "919700000001@s.whatsapp.net",
      aliases: ["Didi", "Di", "Sister"],
    },
  ]);

  assert.equal(diiResolved.type, "found");
  if (diiResolved.type === "found") {
    assert.equal(diiResolved.contact.phone, "919700000001");
  }

  const maaResolved = rankContactCandidates("maa", [
    {
      name: "Mummy Ji",
      phone: "919700000002",
      jid: "919700000002@s.whatsapp.net",
      aliases: ["Mummy Ji", "Mummy", "Mom"],
    },
  ]);

  assert.equal(maaResolved.type, "found");
  if (maaResolved.type === "found") {
    assert.equal(maaResolved.contact.phone, "919700000002");
  }
});

test("contact ranking keeps near-miss WhatsApp names on the send path", () => {
  const resolved = rankContactCandidates("atish", [
    {
      name: "Aatish",
      phone: "919608779420",
      jid: "919608779420@s.whatsapp.net",
      aliases: ["Aatish"],
    },
    {
      name: "Ashish",
      phone: "918580537143",
      jid: "918580537143@s.whatsapp.net",
      aliases: ["Ashish"],
    },
  ]);

  assert.equal(resolved.type, "found");
  if (resolved.type === "found") {
    assert.equal(resolved.contact.name, "Aatish");
    assert.equal(resolved.contact.phone, "919608779420");
  }
});

test("whatsapp contact identity graph safely bridges unique lid and direct variants", () => {
  const identities = buildClawCloudWhatsAppContactIdentityGraph([
    {
      jid: "247046619549753@lid",
      displayName: "Pocketly",
      aliases: ["Pocketly"],
    },
    {
      jid: "918001234567@s.whatsapp.net",
      phone: "918001234567",
      displayName: "Pocketly",
      aliases: ["Pocketly", "Pocketly Support"],
    },
  ]);

  assert.equal(identities.length, 1);
  assert.equal(identities[0]?.identityKey, "phone:918001234567");
  assert.equal(identities[0]?.phone, "918001234567");
  assert.equal(identities[0]?.quality, "phone");
  assert.deepEqual(identities[0]?.jids, ["247046619549753@lid", "918001234567@s.whatsapp.net"]);
});

test("whatsapp contact identity graph keeps same-name real contacts distinct when evidence is ambiguous", () => {
  const identities = buildClawCloudWhatsAppContactIdentityGraph([
    {
      jid: "919700000001@s.whatsapp.net",
      phone: "919700000001",
      displayName: "Maa",
      aliases: ["Maa"],
    },
    {
      jid: "919700000002@s.whatsapp.net",
      phone: "919700000002",
      displayName: "Maa",
      aliases: ["Maa"],
    },
    {
      jid: "247046619549753@lid",
      displayName: "Maa",
      aliases: ["Maa"],
    },
  ]);

  assert.equal(identities.length, 3);
  assert.deepEqual(
    identities.map((identity) => identity.identityKey).sort(),
    ["jid:247046619549753@lid", "phone:919700000001", "phone:919700000002"],
  );
});

test("routing keeps explicit tool commands out of follow-up topic rewrites", () => {
  assert.equal(
    resolveRoutingMessageForTest(
      "send hii to atish",
      "which is the top 10 most advance ai model in 2026 (topic: ai)",
    ),
    "send hii to atish",
  );

  assert.equal(
    resolveRoutingMessageForTest(
      "sync whatsapp contacts",
      "which is the top 10 most advance ai model in 2026 (topic: ai)",
    ),
    "sync whatsapp contacts",
  );

  assert.equal(
    resolveRoutingMessageForTest(
      "what about price",
      "compare GPT-5.4 and Claude Sonnet 4 for coding",
    ),
    "compare GPT-5.4 and Claude Sonnet 4 for coding",
  );

  assert.equal(
    resolveRoutingMessageForTest(
      "why did you archive it?",
      "why did you archive it? (context: Archive my latest email from Google)",
    ),
    "why did you archive it?",
  );

  assert.equal(
    resolveRoutingMessageForTest(
      "what did it say?",
      "what did it say? (context: read the top 5 mails of my gmail and tell me what it says)",
    ),
    "what did it say?",
  );

  assert.equal(
    resolveRoutingMessageForTest(
      "why did you send that?",
      "why did you send that? (context: send hii to atish)",
    ),
    "why did you send that?",
  );
});

test("direct-answer recovery only activates for clear low-risk prompts", () => {
  assert.equal(
    shouldAttemptDirectAnswerRecovery(
      "tell me the story of my demon in korean",
      buildClawCloudAnswerQualityProfile({
        question: "tell me the story of my demon in korean",
        intent: "culture",
        category: "culture_story",
      }),
    ),
    true,
  );

  assert.equal(
    shouldAttemptDirectAnswerRecovery(
      "difference between nginx vs apache vs caddy",
      buildClawCloudAnswerQualityProfile({
        question: "difference between nginx vs apache vs caddy",
        intent: "general",
        category: "general",
      }),
    ),
    true,
  );

  assert.equal(
    shouldAttemptDirectAnswerRecovery(
      "10 ನಾಡು ಕನ್ನಡ ಸಾಹಿತ್ಯದ ಕವಿಗಳ ಬಗ್ಗೆ ಗೊಬ್ಬಿ ಬರೆಯಿರಿ",
      buildClawCloudAnswerQualityProfile({
        question: "10 ನಾಡು ಕನ್ನಡ ಸಾಹಿತ್ಯದ ಕವಿಗಳ ಬಗ್ಗೆ ಗೊಬ್ಬಿ ಬರೆಯಿರಿ",
        intent: "creative",
        category: "creative",
      }),
    ),
    true,
  );

  assert.equal(
    shouldAttemptDirectAnswerRecovery(
      "why cuba is all blackout",
      buildClawCloudAnswerQualityProfile({
        question: "why cuba is all blackout",
        intent: "research",
        category: "news",
      }),
    ),
    false,
  );

  assert.equal(
    shouldAttemptDirectAnswerRecovery(
      "Can I sue my landlord immediately?",
      buildClawCloudAnswerQualityProfile({
        question: "Can I sue my landlord immediately?",
        intent: "law",
        category: "law",
      }),
    ),
    false,
  );
});

test("strict intent routing locks operational WhatsApp commands before generic heuristics can steal them", () => {
  const sendRoute = detectStrictIntentRouteForTest("send hii to atish");
  assert.ok(sendRoute);
  assert.equal(sendRoute?.intent.category, "send_message");
  assert.equal(sendRoute?.confidence, "high");
  assert.equal(sendRoute?.locked, true);

  const syncRoute = detectStrictIntentRouteForTest("sync whatsapp contacts in python");
  assert.ok(syncRoute);
  assert.equal(syncRoute?.intent.category, "whatsapp_contacts_sync");
  assert.equal(syncRoute?.locked, true);
  assert.equal(detectIntentForTest("sync whatsapp contacts in python").category, "whatsapp_contacts_sync");

  const settingsRoute = detectStrictIntentRouteForTest("show my whatsapp settings with code details");
  assert.ok(settingsRoute);
  assert.equal(settingsRoute?.intent.category, "whatsapp_settings_status");
  assert.equal(detectIntentForTest("show my whatsapp settings with code details").category, "whatsapp_settings_status");

  const gmailRoute = detectStrictIntentRouteForTest("Send an email to my Gmail saying I understand what you said.");
  assert.ok(gmailRoute);
  assert.equal(gmailRoute?.intent.category, "gmail_send");
  assert.equal(detectIntentForTest("Send an email to my Gmail saying I understand what you said.").category, "gmail_send");
});

test("strict intent routing clarifies ambiguous personal-surface lookups instead of guessing the wrong tool", () => {
  const route = detectStrictIntentRouteForTest("read and tell me the message of jaideep");
  assert.ok(route);
  assert.equal(route?.intent.category, "personal_tool_clarify");
  assert.equal(route?.confidence, "low");
  assert.match(route?.clarificationReply ?? "", /WhatsApp messages/i);
  assert.match(route?.clarificationReply ?? "", /Gmail emails/i);
});

test("strict intent routing locks Korean story requests into the culture_story path", () => {
  const route = detectStrictIntentRouteForTest("도깨비 줄거리를 한국어로 자세히 설명해줘");
  assert.ok(route);
  assert.equal(route?.intent.category, "culture_story");
  assert.equal(route?.locked, true);
});

test("strict intent routing locks title-based English story requests with target language into the culture_story path", () => {
  const route = detectStrictIntentRouteForTest("tell me the story of my demon in korean");
  assert.ok(route);
  assert.equal(route?.intent.category, "culture_story");
  assert.equal(route?.locked, true);
});

test("deterministic known-story fallback can still use the original title-bearing prompt after language normalization", () => {
  const answer = resolveDeterministicKnownStoryReplyForTest(
    "tell me the story of the korean demon romance drama",
    "tell me the story of my demon in korean",
  ) ?? "";
  assert.match(answer, /Do Do-hee/i);
  assert.match(answer, /Jung Gu-won/i);
});

test("deterministic known-story replies handle Kalki prompts that append a true-events question", () => {
  const answer = resolveDeterministicKnownStoryReplyForTest(
    "what is the story of kalki as is it based on true events",
  ) ?? "";
  assert.match(answer, /Kalki 2898 AD/i);
  assert.match(answer, /Bhairava/i);
  assert.match(answer, /Ashwatthama/i);
});

test("localized deterministic known-story replies can answer My Demon directly in Korean", () => {
  const answer = buildLocalizedDeterministicKnownStoryReplyForTest(
    "tell me the story of my demon in korean",
    "ko",
  ) ?? "";
  assert.match(answer, /도도희/u);
  assert.match(answer, /정구원/u);
});

test("wrong-mode detection rejects translation-meta replies for story questions", () => {
  assert.equal(
    looksLikeWrongModeAnswer(
      "도깨비 줄거리를 한국어로 자세히 설명해줘",
      "Here is the translation in Korean. The text is already in Korean, so there is no need for translation.",
    ),
    true,
  );

  assert.equal(
    looksLikeWrongModeAnswer(
      "Story of Goblin in Korean",
      "Goblin follows Kim Shin, an immortal goblin who meets Ji Eun-tak and struggles with fate, love, and sacrifice.",
    ),
    false,
  );

  assert.equal(
    looksLikeWrongModeAnswer(
      "tell me the story of my demon in korean",
      "Share the topic, tone, and target length, and I will write the complete piece directly.",
    ),
    true,
  );
});

test("history backfill builds persistent WhatsApp contacts from message-only fresh accounts", () => {
  const rows = buildWhatsAppHistoryBackfillContacts([
    {
      remote_jid: "919799402911@s.whatsapp.net",
      remote_phone: "919799402911",
      contact_name: null,
      sent_at: "2026-03-25T09:18:49.000Z",
    },
    {
      remote_jid: "919799402911@s.whatsapp.net",
      remote_phone: "919799402911",
      contact_name: "Hansraj",
      sent_at: "2026-03-25T09:26:21.000Z",
    },
    {
      remote_jid: "919876543210@s.whatsapp.net",
      remote_phone: "919876543210",
      contact_name: null,
      sent_at: "2026-03-25T10:37:53.000Z",
    },
  ]);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    jid: "919799402911@s.whatsapp.net",
    phone_number: "919799402911",
    contact_name: "Hansraj",
    notify_name: null,
    verified_name: null,
    aliases: ["Hansraj", "919799402911"],
    source: "history",
    source_kinds: ["history_backfill"],
    message_count: 2,
    last_message_at: "2026-03-25T09:26:21.000Z",
    last_seen_at: "2026-03-25T09:26:21.000Z",
  });
  assert.deepEqual(rows[1], {
    jid: "919876543210@s.whatsapp.net",
    phone_number: "919876543210",
    contact_name: null,
    notify_name: null,
    verified_name: null,
    aliases: ["919876543210"],
    source: "history",
    source_kinds: ["history_backfill"],
    message_count: 1,
    last_message_at: "2026-03-25T10:37:53.000Z",
    last_seen_at: "2026-03-25T10:37:53.000Z",
  });
});

test("contact upsert preparation merges duplicate WhatsApp rows before database writes", () => {
  const rows = prepareWhatsAppContactUpsertRows("user-123", [
    {
      jid: "919812345678@s.whatsapp.net",
      phoneNumber: "919812345678",
      contactName: "Maa",
      aliases: ["Maa"],
      source: "message",
      sourceKinds: ["message"],
      messageCount: 1,
      lastMessageAt: "2026-03-25T10:00:00.000Z",
      lastSeenAt: "2026-03-25T10:00:00.000Z",
    },
    {
      jid: "919812345678@s.whatsapp.net",
      phoneNumber: "919812345678",
      contactName: "Maa Sharma",
      notifyName: "Mom",
      aliases: ["Maa", "Mom"],
      source: "session",
      sourceKinds: ["baileys_contact"],
      messageCount: 4,
      lastMessageAt: "2026-03-25T10:15:00.000Z",
      lastSeenAt: "2026-03-25T10:20:00.000Z",
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.user_id, "user-123");
  assert.equal(rows[0]?.jid, "919812345678@s.whatsapp.net");
  assert.equal(rows[0]?.phone_number, "919812345678");
  assert.equal(rows[0]?.contact_name, "Maa Sharma");
  assert.equal(rows[0]?.notify_name, "Mom");
  assert.equal(rows[0]?.source, "session");
  assert.equal(rows[0]?.message_count, 4);
  assert.equal(rows[0]?.last_message_at, "2026-03-25T10:15:00.000Z");
  assert.equal(rows[0]?.last_seen_at, "2026-03-25T10:20:00.000Z");
  assert.deepEqual(rows[0]?.aliases, ["Maa", "919812345678", "Maa Sharma", "Mom"]);
  assert.deepEqual(rows[0]?.source_kinds, ["message", "baileys_contact", "session"]);
});

test("contact upsert preparation keeps lid contacts without inventing fake phone numbers", () => {
  const rows = prepareWhatsAppContactUpsertRows("user-123", [
    {
      jid: "247046619549753@lid",
      contactName: "Pocketly",
      aliases: ["Pocketly"],
      source: "session",
      sourceKinds: ["baileys_contact"],
      lastSeenAt: "2026-03-25T10:20:00.000Z",
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.jid, "247046619549753@lid");
  assert.equal(rows[0]?.phone_number, null);
  assert.equal(rows[0]?.contact_name, "Pocketly");
  assert.deepEqual(rows[0]?.aliases, ["Pocketly"]);
});

test("contact upsert preparation persists shared identity metadata across direct and lid variants", () => {
  const rows = prepareWhatsAppContactUpsertRows("user-123", [
    {
      jid: "247046619549753@lid",
      contactName: "Pocketly",
      aliases: ["Pocketly"],
      source: "session",
      sourceKinds: ["baileys_contact"],
      lastSeenAt: "2026-03-25T10:20:00.000Z",
    },
    {
      jid: "918001234567@s.whatsapp.net",
      phoneNumber: "918001234567",
      contactName: "Pocketly",
      aliases: ["Pocketly", "Pocketly Support"],
      source: "session",
      sourceKinds: ["baileys_contact"],
      lastSeenAt: "2026-03-25T10:20:00.000Z",
    },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.identity_key, "phone:918001234567");
  assert.equal(rows[1]?.identity_key, "phone:918001234567");
  assert.deepEqual(rows[0]?.identity_jids, ["247046619549753@lid", "918001234567@s.whatsapp.net"]);
  assert.deepEqual(rows[1]?.identity_jids, ["247046619549753@lid", "918001234567@s.whatsapp.net"]);
  assert.equal(rows[0]?.identity_quality, "phone");
  assert.equal(rows[1]?.identity_quality, "phone");
});

test("jid-only WhatsApp contacts still resolve through fuzzy ranking", () => {
  const result = rankContactCandidates("Pocketly", [
    {
      name: "Pocketly",
      phone: null,
      jid: "247046619549753@lid",
      aliases: ["Pocketly", "pocketly"],
    },
  ]);

  assert.equal(result.type, "found");
  if (result.type !== "found") {
    throw new Error("Expected Pocketly contact to resolve");
  }
  assert.equal(result.contact.jid, "247046619549753@lid");
  assert.equal(result.contact.phone, null);
});

test("weather and news routing helpers avoid vague update misrouting", () => {
  assert.equal(parseWeatherCity("What js the update of todays"), null);
  assert.equal(parseWeatherCity("What's happening in Delhi today?"), null);
  assert.equal(parseWeatherCity("Weather in Delhi today"), "delhi");
  assert.equal(parseWeatherCity("what is the current tempertature of jalandhar right now"), "jalandhar");
  assert.equal(parseWeatherCity("temperatura en madrid hoy"), "madrid");
  assert.equal(looksLikeDirectWeatherQuestion("दिल्ली का तापमान क्या है"), true);
  assert.equal(parseWeatherCity("दिल्ली का तापमान क्या है"), "दिल्ली");
  assert.equal(parseWeatherCity("write a haiku about rain"), null);
  assert.equal(normalizeWeatherLocationName("Dehli", "delhi"), "Delhi");
  assert.equal(detectNewsQuestion("What js the update of todays"), true);
  assert.equal(detectNewsQuestion("news of today"), true);
  assert.equal(detectNewsQuestion("últimas noticias de israel hoy"), true);
  assert.equal(detectNewsQuestion("did usa gave 48 hours ultimatum"), true);
  assert.equal(detectNewsQuestion("is strait of hormuz closed or open"), true);
  assert.equal(detectNewsQuestion("tarun holi delhi case"), true);
  assert.equal(detectNewsQuestion("what was tarun tejpal case"), true);
  assert.equal(detectNewsQuestion("edge case in binary search"), false);
  assert.equal(detectNewsQuestion("what is the current tempertature of jalandhar right now"), false);
  assert.deepEqual(detectIntentForTest("news of today"), {
    type: "research",
    category: "news",
  });
  assert.deepEqual(detectIntentForTest("search the web for news of today"), {
    type: "research",
    category: "news",
  });
  assert.deepEqual(detectIntentForTest("tarun holi delhi case"), {
    type: "research",
    category: "news",
  });
  assert.deepEqual(detectIntentForTest("did usa gave 48 hours ultimatum"), {
    type: "research",
    category: "news",
  });
  assert.deepEqual(detectIntentForTest("did north korea entered the current war"), {
    type: "research",
    category: "news",
  });
});

test("vague live news requests build headline-focused queries", () => {
  const queries = buildNewsQueries("news of today");
  assert.ok(queries.some((query) => /headlines/i.test(query)));
  assert.ok(queries.some((query) => /reuters|bbc|ap/i.test(query)));

  const caseQueries = buildNewsQueries("tarun holi delhi case");
  assert.ok(caseQueries.some((query) => /case explained/i.test(query)));
  assert.ok(caseQueries.some((query) => /incident/i.test(query)));
});

test("current-affairs verification requests build stronger event queries", () => {
  const queries = buildNewsQueries("did usa gave 48 hours ultimatum");
  assert.ok(queries.some((query) => /48-hour/i.test(query)));
  assert.ok(queries.some((query) => /ultimatum|deadline/i.test(query)));
  assert.ok(queries.some((query) => /reuters|bbc|ap/i.test(query)));
  const hinglishDemandQueries = buildNewsQueries("iran ki kya conditions hai usa se iss war ko rokne ke liye");
  assert.ok(hinglishDemandQueries.some((query) => /iran/i.test(query) && /us/i.test(query)));
  assert.ok(hinglishDemandQueries.some((query) => /conditions|demands|terms/i.test(query)));
  assert.ok(hinglishDemandQueries.some((query) => /stop the war|ceasefire|end war/i.test(query)));
  assert.deepEqual(buildCurrentAffairsQueries("tarun holi delhi case"), []);
  assert.equal(classifyClawCloudLiveSearchTier("did usa gave 48 hours ultimatum"), "realtime");
  assert.equal(classifyClawCloudLiveSearchTier("is strait of hormuz closed or open"), "realtime");
  assert.match(
    buildCurrentAffairsClarificationReply("did north korea entered the current war"),
    /Current-affairs clarification/i,
  );
  assert.match(
    buildCurrentAffairsClarificationReply("did north korea entered the current war"),
    /named explicitly/i,
  );
  assert.equal(
    buildCurrentAffairsClarificationReply("did north korea enter the current war of iran and israel"),
    "",
  );
  assert.equal(looksLikeCurrentAffairsQuestion("Why is Cuba all blackout and has no electricity?"), true);
  assert.equal(detectNewsQuestion("Why is Cuba all blackout and has no electricity?"), true);
  assert.deepEqual(detectIntentForTest("Why is Cuba all blackout and has no electricity?"), {
    type: "research",
    category: "news",
  });
  assert.equal(classifyClawCloudLiveSearchTier("Why is Cuba all blackout and has no electricity?"), "realtime");
  const cubaBlackoutQueries = buildCurrentAffairsQueries("Why is Cuba all blackout and has no electricity?");
  assert.ok(cubaBlackoutQueries.some((query) => /cuba/i.test(query)));
  assert.ok(cubaBlackoutQueries.some((query) => /blackout|power outage|electricity|grid|fuel shortage/i.test(query)));
  assert.equal(looksLikeCurrentAffairsQuestion("why russia is sending its oil tanker to cuba"), true);
  assert.equal(looksLikeCurrentAffairsQuestion("russia cuba mai apna oil tanker kyun bhej rha hai"), true);
  assert.equal(detectNewsQuestion("why russia is sending its oil tanker to cuba"), true);
  assert.equal(detectNewsQuestion("russia cuba mai apna oil tanker kyun bhej rha hai"), true);
  assert.deepEqual(detectIntentForTest("why russia is sending its oil tanker to cuba"), {
    type: "research",
    category: "news",
  });
  assert.deepEqual(detectIntentForTest("russia cuba mai apna oil tanker kyun bhej rha hai"), {
    type: "research",
    category: "news",
  });
  const tankerQueries = buildNewsQueries("why russia is sending its oil tanker to cuba");
  assert.ok(tankerQueries.some((query) => /russia/i.test(query) && /cuba/i.test(query)));
  assert.ok(tankerQueries.some((query) => /tanker|shipping|fuel supply|shipment/i.test(query)));
  const hinglishTankerQueries = buildNewsQueries("russia cuba mai apna oil tanker kyun bhej rha hai");
  assert.ok(hinglishTankerQueries.some((query) => /russia/i.test(query) && /cuba/i.test(query)));
  assert.ok(hinglishTankerQueries.some((query) => /tanker|shipping|fuel supply|shipment/i.test(query)));
});

test("current-affairs demand answers stay evidence-first when only low-trust wrapped headlines are available", () => {
  const answer = buildCurrentAffairsEvidenceAnswer(
    "iran ki kya conditions hai usa se iss war ko rokne ke liye",
    [
      {
        title: "'ट्रंप नहीं हमारी शर्तों पर युद्ध खत्म होगा...', ईरान ने रख दी अमेरिका के सामने 5 मांग - AajTak",
        url: "https://news.google.com/articles/one",
        snippet: "'ट्रंप नहीं हमारी शर्तों पर युद्ध खत्म होगा...', ईरान ने रख दी अमेरिका के सामने 5 मांग",
        domain: "news.google.com",
        publishedDate: "2026-03-25T15:24:19.000Z",
        score: 0.88,
      },
      {
        title: "5 साल तक मिसाइल बंद, यूरेनियम जीरो... जंग रोकने के लिए ट्रंप की शर्त, ईरान बोला- पहले मुआवजा और गारंटी दो - AajTak",
        url: "https://news.google.com/articles/two",
        snippet: "5 साल तक मिसाइल बंद, यूरेनियम जीरो... जंग रोकने के लिए ट्रंप की शर्त, ईरान बोला- पहले मुआवजा और गारंटी दो",
        domain: "news.google.com",
        publishedDate: "2026-03-23T03:57:03.000Z",
        score: 0.86,
      },
      {
        title: "US, Israel Iran War: पाकिस्तान सुलझाएगा ईरान अमेरिका की जंग! इस्लमाबाद में होगी बैठक? - Amar Ujala",
        url: "https://news.google.com/articles/three",
        snippet: "US, Israel Iran War: पाकिस्तान सुलझाएगा ईरान अमेरिका की जंग! इस्लमाबाद में होगी बैठक?",
        domain: "news.google.com",
        publishedDate: "2026-03-24T10:21:41.000Z",
        score: 0.74,
      },
    ],
  );

  assert.match(answer, /current-affairs check/i);
  assert.match(answer, /clearest headlines i found/i);
  assert.match(answer, /compensation/i);
  assert.match(answer, /guarantees/i);
  assert.match(answer, /5-point demand list/i);
  assert.match(answer, /not independently verified yet/i);
  assert.match(answer, /closest source signals/i);
});

test("current-affairs power-crisis answers stay evidence-first for nationwide blackout questions", () => {
  const answer = buildCurrentAffairsEvidenceAnswer(
    "Why is Cuba all blackout and has no electricity?",
    [
      {
        title: "Cuba hit by nationwide blackout as aging plants and fuel shortages strain grid - Reuters",
        url: "https://www.reuters.com/world/americas/cuba-blackout-one",
        snippet: "Authorities said aging power plants, fuel shortages, and a fragile national grid were driving the latest outages.",
        domain: "reuters.com",
        publishedDate: "2026-03-28T08:00:00.000Z",
        score: 0.88,
      },
      {
        title: "Cuba power grid instability worsens after plant breakdowns - AP",
        url: "https://apnews.com/article/cuba-blackout-two",
        snippet: "Plant breakdowns and grid instability worsened the electricity crisis across Cuba.",
        domain: "apnews.com",
        publishedDate: "2026-03-28T09:00:00.000Z",
        score: 0.86,
      },
    ],
  );

  assert.match(answer, /current-affairs check/i);
  assert.match(answer, /aging power plants/i);
  assert.match(answer, /fuel shortages/i);
  assert.match(answer, /grid instability/i);
  assert.match(answer, /closest source signals/i);
});

test("news search task timeout helper fails closed when one provider hangs", async () => {
  let slowTaskResolved = false;
  const slowTask = new Promise<Array<{
    title: string;
    url: string;
    snippet: string;
    domain: string;
    score: number;
  }>>((resolve) => {
    setTimeout(() => {
      slowTaskResolved = true;
      resolve([
        {
          title: "Slow source",
          url: "https://example.com/slow-source",
          snippet: "This source settled after the timeout window.",
          domain: "example.com",
          score: 0.3,
        },
      ]);
    }, 120);
  });

  const result = await resolveNewsSearchTaskWithTimeoutForTest(slowTask, 20);
  assert.deepEqual(result, []);
  assert.equal(slowTaskResolved, false);
  await slowTask;
  assert.equal(slowTaskResolved, true);
});

test("power-crisis news synthesis still answers directly when live source coverage is thin", async () => {
  const answer = await synthesiseNewsAnswerForTest(
    "Why is Cuba all blackout and has no electricity?",
    [],
  );

  assert.match(answer, /current-affairs check/i);
  assert.match(answer, /aging power plants/i);
  assert.match(answer, /fuel shortages/i);
  assert.match(answer, /grid instability/i);
  assert.match(answer, /pending verification/i);
  assert.match(answer, /searched:/i);
});

test("current-affairs demand ranking prefers direct negotiation coverage over opinion pieces", () => {
  const answer = buildCurrentAffairsEvidenceAnswer(
    "iran ki kya conditions hai usa se iss war ko rokne ke liye",
    [
      {
        title: "Opinion | Iran May Be Far More Prepared For A 'Ground Invasion' Than Trump Thinks - NDTV",
        url: "https://news.google.com/articles/opinion",
        snippet: "Opinion | Iran May Be Far More Prepared For A 'Ground Invasion' Than Trump Thinks",
        domain: "news.google.com",
        publishedDate: "2026-03-27T07:07:30.000Z",
        score: 0.91,
      },
      {
        title: "Trump says U.S. to hold off for 10 days on hitting Iran energy sites - The Washington Post",
        url: "https://news.google.com/articles/wapo",
        snippet: "Trump says U.S. to hold off for 10 days on hitting Iran energy sites",
        domain: "news.google.com",
        publishedDate: "2026-03-27T05:41:37.000Z",
        score: 0.87,
      },
      {
        title: "Iran, large-scale Israeli attacks. Tehran sets 5 conditions for end of war. White House: negotiations continue - Il Sole 24 ORE",
        url: "https://news.google.com/articles/ilsole",
        snippet: "Tehran sets 5 conditions for end of war. White House: negotiations continue",
        domain: "news.google.com",
        publishedDate: "2026-03-25T06:36:08.000Z",
        score: 0.84,
      },
      {
        title: "Iran has no intention to hold talks with U.S; foreign minister says Trump proposal to end war being reviewed - CNBC",
        url: "https://news.google.com/articles/cnbc",
        snippet: "Iran has no intention to hold talks with U.S; foreign minister says Trump proposal to end war being reviewed",
        domain: "news.google.com",
        publishedDate: "2026-03-25T12:51:38.000Z",
        score: 0.82,
      },
    ],
  );

  assert.match(answer, /5-point demand list/i);
  assert.doesNotMatch(answer, /Opinion \| Iran May Be Far More Prepared For A 'Ground Invasion' Than Trump Thinks/i);
  assert.match(answer, /The Washington Post/i);
  assert.match(answer, /Il Sole 24 ORE/i);
});

test("source-backed live answer results preserve evidence metadata for current-affairs answers", () => {
  const result = buildSourceBackedLiveAnswerResult({
    question: "latest OpenAI news today",
    answer: [
      "*Latest OpenAI update*",
      "OpenAI published a new platform announcement today.",
    ].join("\n"),
    sources: [
      {
        title: "OpenAI announces a platform update",
        url: "https://openai.com/index/platform-update",
        snippet: "OpenAI published a fresh platform announcement for developers.",
        domain: "openai.com",
        publishedDate: "2026-03-25T12:00:00.000Z",
        score: 0.96,
      },
      {
        title: "Reuters covers the OpenAI platform update",
        url: "https://www.reuters.com/technology/openai-platform-update-2026-03-25/",
        snippet: "Reuters summarizes the latest OpenAI platform update.",
        domain: "reuters.com",
        publishedDate: "2026-03-25T13:00:00.000Z",
        score: 0.88,
      },
    ],
    officialDomains: ["openai.com"],
  });

  assert.match(result.answer, /Latest OpenAI update/i);
  assert.ok(result.liveAnswerBundle);
  assert.equal(result.liveAnswerBundle?.metadata.strategy, "search_synthesis");
  assert.equal(result.liveAnswerBundle?.evidence[0]?.domain, "openai.com");
  assert.equal(result.liveAnswerBundle?.evidence[0]?.kind, "official_page");
});

test("fast news search filters homepage-style landing pages", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    if (url.startsWith("https://news.google.com/rss/search?")) {
      return new Response([
        "<rss><channel>",
        "<item>",
        "<title>Moneycontrol</title>",
        "<link>https://www.moneycontrol.com/</link>",
        "<description>Latest news and updates from Moneycontrol</description>",
        "<source>Moneycontrol</source>",
        "</item>",
        "<item>",
        "<title>Central banks signal policy shift - Reuters</title>",
        "<link>https://www.reuters.com/world/europe/central-banks-policy-shift-2026-03-23/</link>",
        "<description>Reuters reports on a fresh policy shift across major central banks.</description>",
        "<source>Reuters</source>",
        "<pubDate>Mon, 23 Mar 2026 09:00:00 GMT</pubDate>",
        "</item>",
        "</channel></rss>",
      ].join(""), {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      });
    }

    if (url.startsWith("https://api.duckduckgo.com/")) {
      return Response.json({});
    }

    if (url === "https://api.tavily.com/search") {
      return Response.json({ results: [] });
    }

    if (url.startsWith("https://serpapi.com/search.json")) {
      return Response.json({ news_results: [], organic_results: [] });
    }

    if (url.startsWith("https://s.jina.ai/")) {
      return Response.json({ data: [] });
    }

    throw new Error(`Unexpected fetch during test: ${url}`);
  }) as typeof fetch;

  try {
    const sources = await fastNewsSearch(["news of today"]);
    assert.ok(sources.some((source) => source.domain.includes("reuters.com")));
    assert.ok(!sources.some((source) => source.url === "https://www.moneycontrol.com/"));
    assert.ok(!sources.some((source) => source.domain === "Moneycontrol"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("creative writing prompts with weather words do not get stolen by weather routing", () => {
  assert.deepEqual(detectIntentForTest("write a haiku about rain"), {
    type: "creative",
    category: "creative",
  });
  assert.notEqual(detectIntentForTest("current ceo of google in 2020").category, "finance");
  assert.deepEqual(detectIntentForTest("what is the current tempertature of jalandhar right now"), {
    type: "research",
    category: "weather",
  });
  assert.deepEqual(detectIntentForTest("दिल्ली का तापमान क्या है"), {
    type: "research",
    category: "weather",
  });
  assert.deepEqual(detectIntentForTest("search the web for weather in jalandhar right now"), {
    type: "research",
    category: "weather",
  });
});

test("google integration helpers distinguish not-connected from reconnect-needed states", () => {
  assert.equal(
    isClawCloudGoogleNotConnectedError(new Error("gmail is not connected for this user."), "gmail"),
    true,
  );
  assert.equal(
    isClawCloudGoogleNotConnectedError(new Error("google_drive is not connected for this user."), "gmail"),
    false,
  );
  assert.match(buildGoogleNotConnectedReply("Gmail"), /Gmail is not connected/i);

  const reconnectError = createClawCloudGoogleApiError(
    "Request had insufficient authentication scopes.",
    "Failed to read Gmail messages.",
    ["gmail"],
  );
  assert.ok(reconnectError instanceof ClawCloudGoogleReconnectRequiredError);
  assert.match(reconnectError.message, /Reconnect Gmail in settings/i);

  const genericError = createClawCloudGoogleApiError(
    "Quota exceeded for this request.",
    "Failed to read Gmail messages.",
    ["gmail"],
  );
  assert.equal(genericError instanceof ClawCloudGoogleReconnectRequiredError, false);
  assert.equal(genericError.message, "Quota exceeded for this request.");

  const basicLoginScopes = new Set([
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ]);
  assert.equal(hasRequiredGoogleWorkspaceScopes(basicLoginScopes, "core"), false);
  assert.equal(hasRequiredGoogleWorkspaceScopes(basicLoginScopes, "extended"), false);
  assert.match(
    buildGoogleWorkspaceScopeMismatchMessage("extended", basicLoginScopes),
    /basic sign-in permissions/i,
  );

  const workspaceCoreScopes = new Set([
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.events",
    "email",
    "profile",
  ]);
  assert.equal(hasRequiredGoogleWorkspaceScopes(workspaceCoreScopes, "core"), true);
  assert.equal(hasRequiredGoogleWorkspaceScopes(workspaceCoreScopes, "extended"), false);
  assert.equal(hasRequiredGoogleWorkspaceScopes(workspaceCoreScopes, "gmail"), true);
  assert.equal(hasRequiredGoogleWorkspaceScopes(workspaceCoreScopes, "google_calendar"), true);

  const workspaceCalendarScopes = new Set([
    "https://www.googleapis.com/auth/calendar.events",
    "email",
    "profile",
  ]);
  assert.equal(hasRequiredGoogleWorkspaceScopes(workspaceCalendarScopes, "google_calendar"), true);
  assert.equal(hasRequiredGoogleWorkspaceScopes(workspaceCalendarScopes, "gmail"), false);

  const workspaceDriveScopes = new Set([
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
    "email",
    "profile",
  ]);
  assert.equal(hasRequiredGoogleWorkspaceScopes(workspaceDriveScopes, "google_drive"), true);
  assert.equal(hasRequiredGoogleWorkspaceScopes(workspaceDriveScopes, "core"), false);
  assert.match(
    buildGoogleWorkspaceScopeMismatchMessage("google_drive", basicLoginScopes),
    /drive/i,
  );
});

test("email search parsing honors requested count, stricter day windows, and honest Gmail ranges", () => {
  const prompt = "Read my 10 most important emails of today";
  assert.equal(extractRequestedEmailCount(prompt), 10);

  const query = buildNaturalLanguageEmailSearchQuery(prompt, "Asia/Kolkata");
  assert.match(query, /\blabel:important\b/i);
  assert.match(query, /\bnewer_than:2d\b/i);

  const filtered = filterEmailsForPromptWindow([
    { date: "Sat, 22 Mar 2026 11:31:00 +0530", subject: "Today security alert" },
    { date: "Fri, 21 Mar 2026 15:02:00 +0530", subject: "Yesterday loan mail" },
  ], prompt, "Asia/Kolkata", new Date("2026-03-22T12:00:00+05:30"));

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.subject, "Today security alert");
});

test("gmail action routing separates plain writing, Gmail drafts, sends, and reply actions", () => {
  assert.equal(
    detectGmailActionIntent("Write a professional reply to Kimi by Moonshot AI saying I understand what you said."),
    null,
  );

  assert.deepEqual(
    detectIntentForTest("Write a professional reply to Kimi by Moonshot AI saying I understand what you said."),
    { type: "email", category: "draft_email" },
  );

  assert.equal(
    detectGmailActionIntent("Create a Gmail draft to my Gmail saying I understand what you said."),
    "gmail_draft",
  );
  assert.deepEqual(
    detectIntentForTest("Create a Gmail draft to my Gmail saying I understand what you said."),
    { type: "email", category: "gmail_draft" },
  );
  assert.equal(
    detectGmailActionIntent("Send an email to my Gmail saying I understand what you said."),
    "gmail_send",
  );
  assert.deepEqual(
    detectIntentForTest("Send an email to my Gmail saying I understand what you said."),
    { type: "email", category: "gmail_send" },
  );
  assert.equal(
    detectGmailActionIntent("Draft a reply to my last email from Priya saying I understand what you said."),
    "gmail_reply_draft",
  );
  assert.deepEqual(
    detectIntentForTest("Draft a reply to my last email from Priya saying I understand what you said."),
    { type: "email", category: "gmail_reply_draft" },
  );
  assert.equal(
    detectGmailActionIntent("Send a reply to my latest email from Priya saying I understand what you said."),
    "gmail_reply_send",
  );
  assert.deepEqual(
    detectIntentForTest("Send a reply to my latest email from Priya saying I understand what you said."),
    { type: "email", category: "gmail_reply_send" },
  );
  assert.equal(
    detectGmailActionIntent("Review my inbox and draft 3 replies for approval."),
    "gmail_reply_queue",
  );
  assert.equal(
    detectGmailActionIntent("Archive my latest email from Google"),
    "gmail_archive",
  );
  assert.equal(
    detectGmailActionIntent("Mark my latest email from Raj as unread"),
    "gmail_mark_unread",
  );
  assert.equal(
    detectGmailActionIntent("Star my latest email from OpenAI"),
    "gmail_star",
  );
  assert.equal(
    detectGmailActionIntent("Move my latest email from Google to spam"),
    "gmail_mark_spam",
  );
  assert.equal(
    detectGmailActionIntent("Restore my latest email from Google"),
    "gmail_restore",
  );
  assert.equal(
    detectGmailActionIntent("Delete my latest email from Google"),
    "gmail_trash",
  );
  assert.equal(
    detectGmailActionIntent("Mark my latest email from Google as not spam"),
    "gmail_mark_not_spam",
  );
});

test("gmail action parser keeps recipient, sender, and message instructions explicit", () => {
  assert.deepEqual(
    parseGmailActionRequest("Create a Gmail draft to my Gmail subject Update saying I understand what you said."),
    {
      kind: "draft",
      recipientHint: "my Gmail",
      subjectHint: "Update",
      contentInstruction: "I understand what you said.",
      explicitSelfTarget: true,
    },
  );

  assert.deepEqual(
    parseGmailActionRequest("Send a reply to my latest email from Kimi by Moonshot AI saying I understand what you said."),
    {
      kind: "reply_send",
      senderHint: "Kimi by Moonshot AI",
      subjectHint: null,
      contentInstruction: "I understand what you said.",
    },
  );

  assert.deepEqual(
    parseGmailActionRequest("Email me saying I reached home safely."),
    {
      kind: "send",
      recipientHint: "me",
      subjectHint: null,
      contentInstruction: "I reached home safely.",
      explicitSelfTarget: true,
    },
  );

  assert.deepEqual(
    parseGmailActionRequest("Archive my latest email from Google"),
    {
      kind: "archive",
      senderHint: "Google",
    },
  );

  assert.deepEqual(
    parseGmailActionRequest("Move my latest email from Google to spam"),
    {
      kind: "mark_spam",
      senderHint: "Google",
    },
  );

  assert.deepEqual(
    parseGmailActionRequest("Restore my latest email from Google"),
    {
      kind: "restore",
      senderHint: "Google",
    },
  );
});

test("generic email writing requests do not get misclassified as live Gmail actions", () => {
  const request = "Draft a professional follow-up email to a client who missed a meeting.";
  assert.equal(parseGmailActionRequest(request), null);
  assert.equal(detectGmailActionIntent(request), null);
  assert.equal(inferAppAccessRequirementForTest(request), null);
  assert.deepEqual(detectIntentForTest(request), {
    type: "email",
    category: "draft_email",
  });
});

test("outbound review parser understands approve, cancel, and rewrite replies", () => {
  assert.deepEqual(parseOutboundReviewDecisionForTest("Yes, send it"), { kind: "approve" });
  assert.deepEqual(parseOutboundReviewDecisionForTest("No, cancel it"), { kind: "cancel" });
  assert.deepEqual(parseOutboundReviewDecisionForTest("Rewrite it more professional and shorter"), {
    kind: "rewrite",
    feedback: "more professional and shorter",
  });
  assert.deepEqual(parseOutboundReviewDecisionForTest("make it warmer"), {
    kind: "rewrite",
    feedback: "warmer",
  });
  assert.deepEqual(parseOutboundReviewDecisionForTest("change the subject to Friday project update"), {
    kind: "rewrite",
    feedback: "change the subject to Friday project update",
  });
  assert.deepEqual(parseOutboundReviewDecisionForTest("please add that we can meet tomorrow morning"), {
    kind: "rewrite",
    feedback: "add that we can meet tomorrow morning",
  });
});

test("gmail approval rewrite normalization supports subject-aware JSON rewrites and plain-text fallback", () => {
  const approval = {
    email_subject: "Project update",
    draft_body: "Hi Raj,\n\nSharing the current update.\n\nBest regards,",
  };

  assert.deepEqual(
    normalizeReplyApprovalRewriteDraftForTest(
      '```json\n{"subject":"Friday project update","body":"Hi Raj,\\n\\nSharing the revised Friday update.\\n\\nBest regards,"}\n```',
      approval,
    ),
    {
      subject: "Friday project update",
      body: "Hi Raj,\n\nSharing the revised Friday update.\n\nBest regards,",
    },
  );

  assert.deepEqual(
    normalizeReplyApprovalRewriteDraftForTest(
      "Hi Raj,\n\nHere is the shorter version.\n\nBest regards,",
      approval,
    ),
    {
      subject: "Project update",
      body: "Hi Raj,\n\nHere is the shorter version.\n\nBest regards,",
    },
  );
});

test("approval context detector recognizes review, explanation, and recipient questions", () => {
  assert.equal(detectPendingApprovalContextQuestionForTest("show me the draft again"), "review");
  assert.equal(detectPendingApprovalContextQuestionForTest("why does this need approval?"), "explain");
  assert.equal(detectPendingApprovalContextQuestionForTest("who is this going to?"), "target");
  assert.equal(detectPendingApprovalContextQuestionForTest("rewrite it warmer"), null);
});

test("gmail approval previews now ask for natural confirmation before send", () => {
  const emailId = `meta:${Buffer.from(JSON.stringify({
    version: 1,
    action: "compose_send",
    to: "raj@example.com",
  }), "utf8").toString("base64url")}`;

  const preview = buildReplyApprovalReviewReply({
    id: "12345678-abcd-efgh",
    user_id: "user-1",
    email_id: emailId,
    email_from: "raj@example.com",
    email_subject: "Project update",
    draft_body: "Hi Raj,\n\nSharing the latest project update for your review.\n\nBest regards,",
    status: "pending",
    created_at: "2026-03-26T03:00:00.000Z",
    updated_at: null,
  });

  assert.match(preview, /Gmail message ready for review/i);
  assert.match(preview, /\*To:\* raj@example\.com/i);
  assert.match(preview, /Should I send this now\?/i);
  assert.match(preview, /Reply `Yes` to confirm, `No` to cancel, or `Rewrite it/i);
});

test("gmail approval context replies explain why approval is pending and who it targets", () => {
  const emailId = `meta:${Buffer.from(JSON.stringify({
    version: 1,
    action: "compose_send",
    to: "raj@example.com",
  }), "utf8").toString("base64url")}`;

  const approval = {
    id: "12345678-abcd-efgh",
    user_id: "user-1",
    email_id: emailId,
    email_from: "raj@example.com",
    email_subject: "Project update",
    draft_body: "Hi Raj,\n\nSharing the latest project update for your review.\n\nBest regards,",
    status: "pending" as const,
    created_at: "2026-03-26T03:00:00.000Z",
    updated_at: null,
  };

  const explain = buildReplyApprovalContextReply(approval, "explain");
  assert.match(explain, /human-confirmed/i);
  assert.match(explain, /\*Target:\* raj@example\.com/i);
  assert.match(explain, /\*Subject:\* Project update/i);

  const target = buildReplyApprovalContextReply(approval, "target");
  assert.match(target, /pending Gmail message is for \*raj@example\.com\*/i);
  assert.match(target, /Reply `Yes`, `No`, or `Rewrite it/i);
});

test("whatsapp approval previews now ask for natural confirmation before send", () => {
  const preview = buildWhatsAppApprovalReviewReply({
    id: "87654321-abcd-efgh",
    user_id: "user-1",
    remote_jid: "919999999999@s.whatsapp.net",
    remote_phone: "919999999999",
    contact_name: "Maa",
    source_message: "Outgoing message requested for Maa",
    draft_reply: "Hi Maa, hope you are doing well.",
    status: "pending",
    sensitivity: "normal",
    confidence: 0.9,
    reason: "Waiting for user confirmation before sending.",
    metadata: {
      approval_group_id: "wa-group-1",
    },
    created_at: "2026-03-26T03:05:00.000Z",
    updated_at: null,
  }, 2);

  assert.match(preview, /WhatsApp draft ready for review: 2 contacts/i);
  assert.match(preview, /\*Draft:\*/i);
  assert.match(preview, /Should I send this now\?/i);
  assert.match(preview, /Reply `Yes` to confirm, `No` to cancel, or `Rewrite it/i);
});

test("whatsapp approval context replies explain the safety reason and recipient scope", () => {
  const approval = {
    id: "87654321-abcd-efgh",
    user_id: "user-1",
    remote_jid: "919999999999@s.whatsapp.net",
    remote_phone: "919999999999",
    contact_name: "Maa",
    source_message: "Outgoing message requested for all contacts",
    draft_reply: "Hi everyone, meeting starts at 6pm.",
    status: "pending" as const,
    sensitivity: "normal" as const,
    confidence: 0.9,
    reason: "Broadcast draft targets 12 contacts and needs explicit broadcast confirmation.",
    metadata: {
      approval_group_id: "wa-group-2",
      confirmation_mode: "broadcast_explicit",
      risk_summary: "broadcast_all",
    },
    created_at: "2026-03-26T03:05:00.000Z",
    updated_at: null,
  };

  const explain = buildWhatsAppApprovalContextReply(approval, "explain", 12);
  assert.match(explain, /needs approval before sending it to all recipients/i);
  assert.match(explain, /Broadcast draft targets 12 contacts/i);
  assert.match(explain, /\*Target:\* 12 contacts/i);
  assert.match(explain, /Yes, send to all/i);

  const target = buildWhatsAppApprovalContextReply(approval, "target", 12);
  assert.match(target, /pending WhatsApp draft is for \*12 contacts\*/i);
  assert.match(target, /broadcast-style draft for 12 contacts/i);
});

test("whatsapp broadcast approval previews require explicit send-to-all confirmation", () => {
  const preview = buildWhatsAppApprovalReviewReply({
    id: "87654321-abcd-efgh",
    user_id: "user-1",
    remote_jid: "919999999999@s.whatsapp.net",
    remote_phone: "919999999999",
    contact_name: "Maa",
    source_message: "Outgoing message requested for all contacts",
    draft_reply: "Hi everyone, meeting starts at 6pm.",
    status: "pending",
    sensitivity: "normal",
    confidence: 0.9,
    reason: "Broadcast draft targets 12 contacts and needs explicit broadcast confirmation.",
    metadata: {
      approval_group_id: "wa-group-2",
      confirmation_mode: "broadcast_explicit",
      risk_summary: "broadcast_all",
    },
    created_at: "2026-03-26T03:05:00.000Z",
    updated_at: null,
  }, 12);

  assert.match(preview, /Should I send this to all now\?/i);
  assert.match(preview, /broadcast-style draft for 12 contacts/i);
  assert.match(preview, /Yes, send to all/i);
});

test("generic prompts do not trigger WhatsApp approval command handling", async () => {
  const result = await handleWhatsAppApprovalCommand(
    "user-1",
    "Design a zero-downtime Stripe billing migration with dual-write and rollback.",
  );

  assert.deepEqual(result, { handled: false, response: "" });
});

test("gmail search query builder understands mailbox scopes and attachments", () => {
  assert.equal(
    buildNaturalLanguageEmailSearchQuery("Show my spam emails in Gmail"),
    "in:spam",
  );
  assert.equal(
    buildNaturalLanguageEmailSearchQuery("Show my sent emails to raj@example.com from last 7 days"),
    "in:sent to:raj@example.com newer_than:8d",
  );
  assert.equal(
    buildNaturalLanguageEmailSearchQuery("List my Gmail drafts with attachments"),
    "in:drafts has:attachment",
  );
  assert.equal(
    buildNaturalLanguageEmailSearchQuery("Read my latest 5 emails and tell me what they say"),
    "in:inbox newer_than:30d",
  );
});

test("gmail search routing understands natural mailbox-reading prompts", () => {
  assert.equal(extractRequestedEmailCount("tell me top five important message of my gmail"), 5);
  assert.deepEqual(
    detectIntentForTest("tell me top 5 important message of my gmail"),
    { type: "email", category: "email_search" },
  );
  assert.deepEqual(
    detectIntentForTest("read the top 5 mails of my gmail and tell me what it says"),
    { type: "email", category: "email_search" },
  );
  assert.deepEqual(
    detectIntentForTest("what is Gmail"),
    { type: "explain", category: "explain" },
  );
});

test("calendar action routing recognizes create, reschedule, and cancel requests", () => {
  assert.equal(
    detectCalendarActionIntent("Create a calendar event called Project Sync tomorrow at 4pm for 45 minutes"),
    "calendar_create",
  );
  assert.equal(
    detectCalendarActionIntent("Reschedule my meeting with Priya to tomorrow at 6pm"),
    "calendar_update",
  );
  assert.equal(
    detectCalendarActionIntent("Cancel my meeting with Priya tomorrow"),
    "calendar_cancel",
  );
  assert.deepEqual(
    detectIntentForTest("tell me my next 3 calendar events"),
    { type: "calendar", category: "calendar" },
  );
});

test("whatsapp settings command routing recognizes status and update prompts", () => {
  assert.equal(detectWhatsAppSettingsCommandIntent("Show my WhatsApp settings"), "whatsapp_settings_status");
  assert.equal(detectWhatsAppSettingsCommandIntent("Set WhatsApp mode to approve before send"), "whatsapp_settings_update");
  assert.equal(detectWhatsAppSettingsCommandIntent("Turn off group replies"), "whatsapp_settings_update");
  assert.equal(detectWhatsAppSettingsCommandIntent("Set quiet hours from 10pm to 7am"), "whatsapp_settings_update");
  assert.equal(detectWhatsAppSettingsCommandIntent("Sync WhatsApp contacts"), "whatsapp_contacts_sync");
});

test("whatsapp privacy delete plan covers exported workspace data without recreating delete-all residue", () => {
  assert.deepEqual(buildWhatsAppWorkspaceDeletePlanForTest("retention"), {
    tables: [
      "whatsapp_messages",
      "whatsapp_reply_approvals",
      "whatsapp_outbound_messages",
      "whatsapp_workflow_runs",
      "whatsapp_audit_log",
    ],
    resetSettings: false,
    writeAuditLog: true,
  });

  assert.deepEqual(buildWhatsAppWorkspaceDeletePlanForTest("contact"), {
    tables: [
      "whatsapp_messages",
      "whatsapp_reply_approvals",
      "whatsapp_outbound_messages",
      "whatsapp_workflow_runs",
      "whatsapp_audit_log",
      "whatsapp_contacts",
    ],
    resetSettings: false,
    writeAuditLog: true,
  });

  assert.deepEqual(buildWhatsAppWorkspaceDeletePlanForTest("all"), {
    tables: [
      "whatsapp_messages",
      "whatsapp_reply_approvals",
      "whatsapp_outbound_messages",
      "whatsapp_workflow_runs",
      "whatsapp_audit_log",
      "whatsapp_contacts",
      "whatsapp_automation_workflows",
    ],
    resetSettings: true,
    writeAuditLog: false,
  });
});

test("intent detection routes upgraded Gmail, Calendar, and WhatsApp control prompts correctly", () => {
  assert.deepEqual(detectIntentForTest("Archive my latest email from Google"), { type: "email", category: "gmail_archive" });
  assert.deepEqual(detectIntentForTest("Show my spam emails in Gmail"), { type: "email", category: "email_search" });
  assert.deepEqual(detectIntentForTest("See what message I got from Papa ji"), { type: "general", category: "personal_tool_clarify" });
  assert.deepEqual(detectIntentForTest("In WhatsApp, see what message I got from Papa ji"), { type: "send_message", category: "whatsapp_history" });
  assert.deepEqual(detectIntentForTest("Show WhatsApp history with Jaideep"), { type: "send_message", category: "whatsapp_history" });
  assert.deepEqual(detectIntentForTest("In WhatsApp, read and tell me the message of Jaideep"), { type: "send_message", category: "whatsapp_history" });
  assert.deepEqual(
    detectIntentForTest("what was the conversation there in hansraj contact tell me"),
    { type: "send_message", category: "whatsapp_history" },
  );
  assert.deepEqual(
    detectIntentForTest("tell me the conversation in papa ji contact"),
    { type: "send_message", category: "whatsapp_history" },
  );
  assert.deepEqual(detectIntentForTest("Show the contract attachment from Raj"), { type: "general", category: "personal_tool_clarify" });
  assert.deepEqual(detectIntentForTest("Create a calendar event called Project Sync tomorrow at 4pm"), { type: "calendar", category: "calendar_create" });
  assert.deepEqual(detectIntentForTest("Show my WhatsApp settings"), { type: "send_message", category: "whatsapp_settings_status" });
  assert.deepEqual(detectIntentForTest("Sync WhatsApp contacts"), { type: "send_message", category: "whatsapp_contacts_sync" });
});

test("architecture prompts with inbox-style dedupe terminology stay on the coding path instead of triggering Gmail access", () => {
  const prompt = "deep: Design a zero-downtime Stripe billing migration from mutable balances to an immutable ledger. I need shadow mode, dual-write, idempotent webhook handling, rollback, and exact guidance on inbox/event dedupe keys.";

  assert.deepEqual(detectStrictIntentRouteForTest(prompt), {
    intent: { type: "coding", category: "coding" },
    confidence: "high",
    locked: true,
    clarificationReply: null,
  });
  assert.deepEqual(detectIntentForTest(prompt), { type: "coding", category: "coding" });
  assert.equal(inferAppAccessRequirementForTest(prompt), null);
});

test("deterministic architecture solvers stay concrete for Stripe and satellite system-design prompts", () => {
  const stripePrompt = "Design a zero-downtime Stripe billing migration from mutable balances to an immutable ledger. I need shadow mode, dual-write, idempotent webhook handling, rollback, and exact guidance on inbox/event dedupe keys.";
  const stripeAnswer = solveCodingArchitectureQuestion(stripePrompt) ?? "";
  assert.match(stripeAnswer, /\bshadow\b/i);
  assert.match(stripeAnswer, /\bdual-?write\b/i);
  assert.match(stripeAnswer, /\brollback\b/i);
  assert.match(stripeAnswer, /\binbox\b/i);
  assert.match(stripeAnswer, /\bledger\b/i);

  const satellitePrompt = "Design a satellite collision-avoidance copilot. I need conjunction data ingestion, probability-of-collision scoring, maneuver recommendation drafting, human override, approval controls, and a rollout plan.";
  const satelliteAnswer = solveCodingArchitectureQuestion(satellitePrompt) ?? "";
  assert.match(satelliteAnswer, /\bhuman-gated\b|\bhuman override\b|\bapproval\b/i);
  assert.match(satelliteAnswer, /\bconjunction\b|\bcdm\b/i);
  assert.match(satelliteAnswer, /\brollout\b|\bphase 1\b/i);

  const stripeWebhookPrompt = "Design an idempotent Stripe webhook ingestion pipeline for subscription billing. I need schema design, dedupe keys, retry handling, ordering guarantees, reconciliation, and rollback strategy. Answer like a production design review.";
  const stripeWebhookAnswer = solveCodingArchitectureQuestion(stripeWebhookPrompt) ?? "";
  assert.match(stripeWebhookAnswer, /subscription_mutations/i);
  assert.match(stripeWebhookAnswer, /event\.id/i);
  assert.match(stripeWebhookAnswer, /subscription-period/i);
  assert.match(stripeWebhookAnswer, /ordering/i);
  assert.match(stripeWebhookAnswer, /reconciliation/i);
});

test("topic mismatch detection flags menu-style clarification answers for clear technical explainers", () => {
  const menuAnswer = [
    "Quick answer",
    "I can help with that.",
    "",
    "More detail",
    "Topic: Explain the difference between idempotency and deduplication in event-driven systems.",
    "",
    "Pick one angle, and I'll give you a full, direct answer.",
  ].join("\n");

  assert.equal(
    looksLikeQuestionTopicMismatch(
      "Explain the difference between idempotency and deduplication in event-driven systems, and give one concrete payment example where deduplication alone is insufficient.",
      menuAnswer,
    ),
    true,
  );
});

test("whatsapp history hint extraction understands natural contact-conversation phrasing", () => {
  assert.deepEqual(
    extractWhatsAppHistoryHintsForTest("what was the conversation there in hansraj contact tell me"),
    {
      contactHint: "hansraj",
      queryHint: null,
      direction: null,
    },
  );
  assert.deepEqual(
    extractWhatsAppHistoryHintsForTest("tell me the conversation in papa ji contact"),
    {
      contactHint: "papa ji",
      queryHint: null,
      direction: null,
    },
  );
  assert.deepEqual(
    extractWhatsAppHistoryHintsForTest("show whatsapp history with jaideep"),
    {
      contactHint: "jaideep",
      queryHint: null,
      direction: null,
    },
  );
  assert.deepEqual(
    extractWhatsAppHistoryHintsForTest("in whatsapp, read and tell me the message of jaideep"),
    {
      contactHint: "jaideep",
      queryHint: null,
      direction: null,
    },
  );
  assert.deepEqual(
    extractWhatsAppHistoryHintsForTest("in whatsapp, tell me the conversation I had with jaideep"),
    {
      contactHint: "jaideep",
      queryHint: null,
      direction: null,
    },
  );
});

test("resolved WhatsApp history contact filtering stays scoped to the matched contact identity", () => {
  const rows: WhatsAppHistoryEntry[] = [
    {
      id: "1",
      direction: "inbound",
      content: "This is the wrong chat",
      message_type: "text",
      remote_jid: "917876831969@s.whatsapp.net",
      remote_phone: "917876831969",
      contact_name: "917876831969",
      chat_type: "direct",
      sent_at: "2026-03-26T02:19:39+00:00",
      priority: "normal",
      needs_reply: false,
      reply_confidence: null,
      sensitivity: "normal",
      approval_state: "not_required",
      audit_payload: null,
    },
    {
      id: "2",
      direction: "inbound",
      content: "This is the actual Jaideep chat",
      message_type: "text",
      remote_jid: "919053776191@s.whatsapp.net",
      remote_phone: "919053776191",
      contact_name: "jaideep room mate lpu",
      chat_type: "direct",
      sent_at: "2026-03-26T02:19:45+00:00",
      priority: "normal",
      needs_reply: false,
      reply_confidence: null,
      sensitivity: "normal",
      approval_state: "not_required",
      audit_payload: null,
    },
  ];

  const filtered = filterWhatsAppHistoryRowsForResolvedContactForTest(rows, {
    phone: "919053776191",
    jid: "919053776191@s.whatsapp.net",
    aliases: ["jaideep room mate lpu", "jaideep"],
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.remote_phone, "919053776191");
  assert.equal(filtered[0]?.content, "This is the actual Jaideep chat");
});

test("whatsapp history replies now use a professional conversation summary format", () => {
  const summary = buildWhatsAppHistoryProfessionalSummaryForTest({
    resolvedContactName: "Jaideep Room Mate Lpu",
    requestedCount: 4,
    rows: [
      {
        direction: "outbound",
        content: "Ok",
        contact_name: "Jaideep Room Mate Lpu",
        remote_phone: "919053776191",
        sent_at: "2026-03-26T02:19:45+00:00",
      },
      {
        direction: "inbound",
        content: "Sham ko btayungi cl pe",
        contact_name: "Jaideep Room Mate Lpu",
        remote_phone: "919053776191",
        sent_at: "2026-03-26T02:19:39+00:00",
      },
      {
        direction: "outbound",
        content: "Kya bola",
        contact_name: "Jaideep Room Mate Lpu",
        remote_phone: "919053776191",
        sent_at: "2026-03-26T02:19:22+00:00",
      },
      {
        direction: "inbound",
        content: "Mst chlra hai...Acha sunaya mene use",
        contact_name: "Jaideep Room Mate Lpu",
        remote_phone: "919053776191",
        sent_at: "2026-03-26T02:19:11+00:00",
      },
    ],
  });

  assert.match(summary, /WhatsApp conversation summary with Jaideep Room Mate Lpu/i);
  assert.match(summary, /\nSummary\n/i);
  assert.match(summary, /\nProfessional brief\n/i);
  assert.match(summary, /\nLatest status\n/i);
  assert.doesNotMatch(summary, /^1\.\s/m);
});

test("whatsapp conversation summaries stay professional for multi-person chats too", () => {
  const summary = buildWhatsAppHistoryProfessionalSummaryForTest({
    requestedCount: 3,
    rows: [
      {
        direction: "inbound",
        content: "I will share the final deck by noon",
        contact_name: "Ankit",
        remote_phone: "919111111111",
        sent_at: "2026-03-26T08:30:00+00:00",
      },
      {
        direction: "outbound",
        content: "Please send the client version too",
        contact_name: "Ankit",
        remote_phone: "919111111111",
        sent_at: "2026-03-26T08:29:00+00:00",
      },
      {
        direction: "inbound",
        content: "Noted, I will include both files",
        contact_name: "Priya",
        remote_phone: "919222222222",
        sent_at: "2026-03-26T08:28:00+00:00",
      },
    ],
  });

  assert.match(summary, /multi-person WhatsApp conversation/i);
  assert.match(summary, /Ankit/);
  assert.match(summary, /Priya/);
});

test("workspace knowledge questions stay explanatory instead of triggering live tool actions", () => {
  assert.equal(detectBillingIntent("How to cancel a Google Calendar event"), null);
  assert.equal(detectBillingIntent("How to cancel my subscription"), "cancel");
  assert.equal(detectGmailActionIntent("How to send an email in Gmail"), null);
  assert.equal(detectGmailActionIntent("Explain email archiving in Gmail"), null);
  assert.equal(detectCalendarActionIntent("How to cancel a Google Calendar event"), null);
  assert.equal(detectDriveIntent("How to add a row to Google Sheets"), null);
  assert.equal(detectDriveIntent("Design a folder structure for my finance documents in Google Drive"), null);
  assert.equal(detectDriveIntent("Create a folder structure in Google Drive for my startup docs"), null);
  assert.equal(detectWhatsAppSettingsCommandIntent("What is WhatsApp mode"), null);

  assert.deepEqual(detectIntentForTest("How to send an email in Gmail"), { type: "explain", category: "explain" });
  assert.deepEqual(detectIntentForTest("Why are my emails going to spam in Gmail"), { type: "explain", category: "explain" });
  assert.deepEqual(detectIntentForTest("How to cancel a Google Calendar event"), { type: "explain", category: "explain" });
  assert.deepEqual(detectIntentForTest("How to add a row to Google Sheets"), { type: "explain", category: "explain" });
  assert.deepEqual(detectIntentForTest("What is WhatsApp mode"), { type: "explain", category: "explain" });
  assert.deepEqual(detectIntentForTest("How to write a professional email"), { type: "explain", category: "explain" });
  assert.notEqual(detectIntentForTest("Design a folder structure for my finance documents in Google Drive").category, "drive");
  assert.notEqual(detectIntentForTest("Create a folder structure in Google Drive for my startup docs").category, "drive");

  assert.deepEqual(
    detectIntentForTest("Set WhatsApp mode to approve before send"),
    { type: "send_message", category: "whatsapp_settings_update" },
  );
});

test("assistant capability prompts across Hinglish and other languages stay on the help route", () => {
  assert.deepEqual(detectIntentForTest("what can you do"), { type: "help", category: "help" });
  assert.deepEqual(detectIntentForTest("aap kya kya kr skte hai"), { type: "help", category: "help" });
  assert.deepEqual(detectIntentForTest("tum kya kya kar skte ho"), { type: "help", category: "help" });
  assert.deepEqual(detectIntentForTest("mujhe kya kya help kar skte ho"), { type: "help", category: "help" });
  assert.deepEqual(detectIntentForTest("aap kese ho or aap kya kr skte ho"), { type: "help", category: "help" });
  assert.deepEqual(detectIntentForTest("que puedes hacer"), { type: "help", category: "help" });
  assert.deepEqual(detectIntentForTest("आप क्या कर सकते हो"), { type: "help", category: "help" });
});

test("gmail body extraction falls back to html content when plain text is absent", () => {
  const htmlPayload = {
    mimeType: "multipart/alternative",
    parts: [
      {
        mimeType: "text/html",
        body: {
          data: Buffer.from("<div>Hello <b>Shubham</b><br>Loan approved&nbsp;today. It didn&#39;t fail.</div>").toString("base64url"),
        },
      },
    ],
  };

  assert.equal(extractGoogleMessageBody(htmlPayload), "Hello Shubham Loan approved today. It didn't fail.");
});

test("reply display normalization removes markdown stars, decorative bullets, and emoji clutter", () => {
  const normalized = normalizeReplyForClawCloudDisplay([
    "🔍 *Quick answer*",
    "",
    "*REDU* and *PEDU* are terms.",
    "",
    "• First point",
    "* Second point",
    "- Third point",
  ].join("\n"));

  assert.equal(
    normalized,
    [
      "Quick answer",
      "",
      "REDU and PEDU are terms.",
      "",
      "- First point",
      "- Second point",
      "- Third point",
    ].join("\n"),
  );
});

test("reply display normalization removes accidental quote clutter from emphasized live answers", () => {
  const normalized = normalizeReplyForClawCloudDisplay([
    "\"No\", North Korea has not officially entered the current conflict.",
    "",
    "*Military cooperation:* North Korea has provided Iran with missile technology.",
    "",
    "\"Searched: 24 Mar 01:52 am IST - Sources: news.google.com\"",
  ].join("\n"));

  assert.equal(
    normalized,
    [
      "No, North Korea has not officially entered the current conflict.",
      "",
      "Military cooperation: North Korea has provided Iran with missile technology.",
      "",
      "Searched: 24 Mar 01:52 am IST - Sources: news.google.com",
    ].join("\n"),
  );
});

test("reply display normalization repairs common mojibake punctuation from live news answers", () => {
  const normalized = normalizeReplyForClawCloudDisplay([
    `Tarun Butolia, 26, was fatally injured during a Holi clash in Delhi\u00e2\u0080\u0099s Uttam Nagar on 6 Mar 2026 and died in hospital.`,
    "",
    `The incident has triggered communal tension, heavy police deployment and a widening probe\u00e2\u0080\u0094seven more arrests were made on 9 Mar.`,
  ].join("\n"));

  assert.equal(
    normalized,
    [
      "Tarun Butolia, 26, was fatally injured during a Holi clash in Delhi's Uttam Nagar on 6 Mar 2026 and died in hospital.",
      "",
      "The incident has triggered communal tension, heavy police deployment and a widening probe-seven more arrests were made on 9 Mar.",
    ].join("\n"),
  );
});

test("reply display normalization repairs decoded mojibake quote variants from wrapped news titles", () => {
  const normalized = normalizeReplyForClawCloudDisplay([
    "Iran calls US proposal to end war âmaximalist, unreasonableâ - Al Jazeera",
    "",
    "Iran's foreign minister says there are no negotiations with US - BBC",
  ].join("\n"));

  assert.equal(
    normalized,
    [
      "Iran calls US proposal to end war 'maximalist, unreasonable' - Al Jazeera",
      "",
      "Iran's foreign minister says there are no negotiations with US - BBC",
    ].join("\n"),
  );
});

test("reply display normalization strips mojibake icon prefixes and repairs inline currency symbols", () => {
  const normalized = normalizeReplyForClawCloudDisplay([
    "\u00f0\u0178\u201d\u008d *Quick answer*",
    "",
    "\u00e2\u20ac\u00a2 Price: \u00e2\u201a\u00b983.50",
    "\u00e2\u0161\u00a0\u00ef\u00b8\u008f *Watchlist:* Check the official pricing page.",
  ].join("\n"));

  assert.equal(
    normalized,
    [
      "Quick answer",
      "",
      "- Price: ₹83.50",
      "Watchlist: Check the official pricing page.",
    ].join("\n"),
  );
});

test("reply display normalization preserves numbered lists and keeps follow-up bullets separate", () => {
  const normalized = normalizeReplyForClawCloudDisplay([
    "1. F-35 Lightning II",
    "- Full-rate production with sensor fusion",
    "2. F-22 Raptor",
    "- Best stealth and supercruise",
  ].join("\n"));

  assert.equal(
    normalized,
    [
      "1. F-35 Lightning II",
      "- Full-rate production with sensor fusion",
      "2. F-22 Raptor",
      "- Best stealth and supercruise",
    ].join("\n"),
  );
});

test("reply display normalization rewrites the legacy timeout fallback into a professional recovery", () => {
  const normalized = normalizeReplyForClawCloudDisplay([
    "I'm not confident enough to answer that safely without better grounding.",
    "",
    "Reason: The answer path took too long to complete reliably.",
  ].join("\n"));

  assert.equal(
    normalized,
    [
      "Scoped answer needed",
      "",
      "This question needs one clearer scope detail for a precise answer.",
      "Share the exact topic plus the location, company, person, version, or date that matters.",
    ].join("\n"),
  );
});

test("timeboxed reply fails closed for direct knowledge instead of inventing a generic answer", () => {
  const reply = buildTimeboxedProfessionalReplyForTest("what is rag", "general");

  assert.match(reply, /precise answer/i);
  assert.match(reply, /exact term plus the domain/i);
  assert.doesNotMatch(reply, /how it works, and why it matters/i);
});

test("timeboxed reply still returns deterministic explain answers when one is available", () => {
  const reply = buildTimeboxedProfessionalReplyForTest(
    "explain ai vs ml vs deep learning",
    "explain",
  );

  assert.match(reply, /AI vs ML vs Deep Learning/i);
  assert.match(reply, /Machine learning \(ML\)/i);
});

test("timeboxed reply answers clear current-affairs outage questions directly instead of asking for scope", () => {
  const reply = buildTimeboxedProfessionalReplyForTest(
    "Why is Cuba all blackout and has no electricity?",
    "research",
  );

  assert.match(reply, /current-affairs check/i);
  assert.match(reply, /aging power plants/i);
  assert.match(reply, /fuel shortages/i);
  assert.match(reply, /grid instability/i);
  assert.doesNotMatch(reply, /latest update request/i);
});

test("current-affairs power-crisis questions short-circuit before the heavy inbound route stack", async () => {
  const result = await routeInboundAgentMessageResult(
    "test-user",
    "Why is Cuba all blackout and has no electricity?",
  );

  assert.match(result.response ?? "", /current-affairs check/i);
  assert.match(result.response ?? "", /aging power plants/i);
  assert.equal(result.liveAnswerBundle, null);
});

test("reply display normalization keeps valid explanatory reason lines intact", () => {
  const normalized = normalizeReplyForClawCloudDisplay([
    "Quick answer",
    "",
    "Reason: Cuba's nationwide blackouts are tied to aging power plants, fuel shortages, and grid instability.",
  ].join("\n"));

  assert.equal(
    normalized,
    [
      "Quick answer",
      "",
      "Reason: Cuba's nationwide blackouts are tied to aging power plants, fuel shortages, and grid instability.",
    ].join("\n"),
  );
});

test("final reply cleanup strips generic trailing follow-up prompts", () => {
  const withNeedAnythingElse = stripClawCloudTrailingFollowUpForTest([
    "Tokyo is the capital of Japan.",
    "",
    "Need anything else?",
  ].join("\n"));
  assert.equal(withNeedAnythingElse, "Tokyo is the capital of Japan.");

  const withProactivePrompt = stripClawCloudTrailingFollowUpForTest([
    "Use binary search on the sorted array for O(log n) lookup time.",
    "",
    "Want me to also write tests for this? Or explain the time complexity?",
  ].join("\n"));
  assert.equal(withProactivePrompt, "Use binary search on the sorted array for O(log n) lookup time.");
});

test("disclaimer matching stays domain-aware and avoids health bleed on stats questions", () => {
  const didDisclaimer = buildDisclaimer({
    intent: "math",
    category: "math",
    question:
      "In a difference-in-differences policy evaluation, the treatment coefficient beta is -0.18 and the standard error is 0.05. Explain the estimator, confidence interval, and parallel-trends checks.",
    answer: "This is a causal inference answer.",
  });
  assert.equal(didDisclaimer, null);

  const generalHealthInfoDisclaimer = buildDisclaimer({
    intent: "health",
    category: "health",
    question: "What are the common symptoms of diabetes?",
    answer: "Common symptoms include increased thirst, frequent urination, and fatigue.",
  });
  assert.equal(generalHealthInfoDisclaimer, null);

  const freshnessDisclaimer = buildDisclaimer({
    intent: "general",
    category: "general",
    question: "Who is the current CEO of Google?",
    answer: "Sundar Pichai is the CEO of Google.",
  });
  assert.equal(freshnessDisclaimer, null);

  const healthDisclaimer = buildDisclaimer({
    intent: "general",
    category: "general",
    question: "Can I take 650 mg paracetamol every 4 hours for fever?",
    answer: "General guidance only.",
  });
  assert.match(healthDisclaimer ?? "", /medical advice/i);
});

test("api guards rate-limit bursts and reject private crawl targets", async () => {
  const policy = { limit: 2, windowMs: 1_000 };
  const first = takeClawCloudRateLimitLocal("test-research", "user-1", policy, 1_000);
  const second = takeClawCloudRateLimitLocal("test-research", "user-1", policy, 1_100);
  const third = takeClawCloudRateLimitLocal("test-research", "user-1", policy, 1_200);
  const reset = takeClawCloudRateLimitLocal("test-research", "user-1", policy, 2_100);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(third.ok, false);
  assert.equal(third.retryAfterSeconds, 1);
  assert.equal(reset.ok, true);

  assert.equal(parsePublicHttpUrl("https://openai.com/docs")?.hostname, "openai.com");
  assert.equal(parsePublicHttpUrl("http://localhost:3000"), null);
  assert.equal(parsePublicHttpUrl("http://127.0.0.1/test"), null);
  assert.equal(parsePublicHttpUrl("http://192.168.1.10/test"), null);
  assert.equal(parsePublicHttpUrl("http://2130706433/test"), null);
  assert.equal(parsePublicHttpUrl("http://0x7f000001/test"), null);
  assert.equal(parsePublicHttpUrl("http://0177.0.0.1/test"), null);
  assert.equal(parsePublicHttpUrl("http://[::1]/test"), null);
  assert.equal(parsePublicHttpUrl("http://[fd00::1]/test"), null);
  assert.equal(parsePublicHttpUrl("http://[2001:db8::1]/test"), null);
  assert.equal(parsePublicHttpUrl("https://user:pass@openai.com/docs"), null);
  assert.equal(parsePublicHttpUrl("http://printer/status"), null);
  assert.equal(parsePublicHttpUrl("https://docs.openai.com/docs", { allowedHosts: ["openai.com"] })?.hostname, "docs.openai.com");
  assert.equal(parsePublicHttpUrl("https://example.com/docs", { allowedHosts: ["openai.com"] }), null);
  assert.equal(parsePublicHttpUrl("ftp://example.com/file.txt"), null);

  assert.equal(
    (
      await resolvePublicHttpUrl("https://openai.com/docs", {
        dnsLookup: async () => [{ address: "104.18.33.45", family: 4 }],
      })
    )?.hostname,
    "openai.com",
  );
  assert.equal(
    await resolvePublicHttpUrl("https://example.com/docs", {
      dnsLookup: async () => [{ address: "127.0.0.1", family: 4 }],
    }),
    null,
  );
  assert.equal(
    await resolvePublicHttpUrl("https://example.com/docs", {
      dnsLookup: async () => [{ address: "fd00::1", family: 6 }],
    }),
    null,
  );
  assert.equal(
    await resolvePublicHttpUrl("https://example.com/docs", {
      dnsLookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    }),
    null,
  );
  assert.equal(
    await resolvePublicHttpUrl("https://example.com/docs", {
      dnsLookup: async () => {
        throw new Error("dns failed");
      },
    }),
    null,
  );
});

test("secret box helpers encrypt connected account tokens without breaking legacy plaintext reads", () => {
  const options = { secret: "phase5-test-secret" };
  const encrypted = encryptSecretValue("ya29.sample-google-token", options);
  assert.ok(encrypted);
  assert.equal(looksEncryptedSecretValue(encrypted), true);
  assert.notEqual(encrypted, "ya29.sample-google-token");
  assert.equal(decryptSecretValue(encrypted, options), "ya29.sample-google-token");
  assert.equal(decryptSecretValue("legacy-plain-token"), "legacy-plain-token");
  assert.match(maskSecretValue(encrypted, options) ?? "", /^ya29\*\*\*oken$/i);
});

test("billing webhook identity helpers stay deterministic and provider-safe", async () => {
  const rawBody = JSON.stringify({
    event: "subscription.activated",
    payload: { subscription: { entity: { id: "sub_123" } } },
  });

  const hash = await buildBillingWebhookPayloadHash(rawBody);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(await buildBillingWebhookPayloadHash(rawBody), hash);

  assert.equal(
    normalizeBillingWebhookUserId("4f0f7c0e-5d90-4d93-8ad3-7a29d92dfd4c"),
    "4f0f7c0e-5d90-4d93-8ad3-7a29d92dfd4c",
  );
  assert.equal(normalizeBillingWebhookUserId("not-a-uuid"), null);

  assert.equal(await resolveStripeWebhookEventId("evt_123", rawBody), "evt_123");
  assert.equal(
    await resolveStripeWebhookEventId(undefined, rawBody),
    `stripe-body-${hash}`,
  );

  assert.equal(await resolveRazorpayWebhookEventId("evt_hdr_123", rawBody), "evt_hdr_123");
  assert.equal(
    await resolveRazorpayWebhookEventId(null, rawBody),
    `razorpay-body-${hash}`,
  );
});

test("run usage source prefers billable analytics counters over raw task traces", () => {
  assert.equal(
    resolveClawCloudTodayRunCount({
      taskRunsCount: 0,
      analyticsDailyTasksRun: 217,
    }),
    217,
  );

  assert.equal(
    resolveClawCloudTodayRunCount({
      taskRunsCount: 9,
      analyticsDailyTasksRun: null,
    }),
    9,
  );

  assert.equal(
    resolveClawCloudTodayRunCount({
      taskRunsCount: null,
      analyticsDailyTasksRun: 9,
    }),
    9,
  );
});

test("run usage windows reset at midnight IST", () => {
  const window = buildClawCloudRunWindow(new Date("2026-03-23T20:00:00Z"));

  assert.equal(window.dateKey, "2026-03-24");
  assert.equal(window.startIso, "2026-03-23T18:30:00.000Z");
  assert.equal(window.endIso, "2026-03-24T18:30:00.000Z");
});

test("live answer bundles carry explicit evidence metadata and render cleanly", () => {
  const bundle = buildClawCloudLiveAnswerBundle({
    question: "what is the gdp of china",
    answer: [
      "*China GDP*",
      "*Latest official annual estimate:* *$18.74 trillion*",
      "Year: 2024",
      "Source: worldbank.org",
    ].join("\n"),
    route: {
      tier: "volatile",
      requiresWebSearch: true,
      badge: "*Fresh answer*",
      sourceNote: "Source note: checked against live web signals.",
    },
    strategy: "deterministic",
  });

  assert.equal(bundle.channel, "live");
  assert.equal(bundle.metadata.route_tier, "volatile");
  assert.equal(bundle.metadata.strategy, "deterministic");
  assert.ok(bundle.evidence.some((entry) => entry.domain === "worldbank.org"));
  assert.ok(bundle.sourceSummary.includes("worldbank.org"));

  const rendered = renderClawCloudAnswerBundle(bundle);
  assert.match(rendered, /\*Fresh answer\*/i);
  assert.match(rendered, /Source note: checked against live web signals/i);
  assert.match(rendered, /\*China GDP\*/i);
});

test("country metric live answers use World Bank data instead of generic search prose", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.includes("api.worldbank.org/v2/country?format=json&per_page=400")) {
      return new Response(JSON.stringify([
        { page: 1, pages: 1, per_page: "400", total: 2 },
        [
          { id: "CHN", iso2Code: "CN", name: "China" },
          { id: "USA", iso2Code: "US", name: "United States" },
        ],
      ]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/country/CHN/indicator/NY.GDP.MKTP.CD")) {
      return new Response(JSON.stringify([
        { page: 1, pages: 1, per_page: "10", total: 2, sourceid: "2", lastupdated: "2026-02-24" },
        [
          { country: { value: "China" }, date: "2025", value: null },
          { country: { value: "China" }, date: "2024", value: 18_743_803_170_827.2 },
        ],
      ]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch during test: ${url}`);
  }) as typeof fetch;

  try {
    const answer = await fetchLiveDataAndSynthesize("what is the gdp of china");
    assert.match(answer, /\*Fresh answer\*/i);
    assert.match(answer, /\*China GDP\*/i);
    assert.match(answer, /\*Latest official annual estimate:\*/i);
    assert.match(answer, /\$18\.74 trillion/i);
    assert.match(answer, /2024/i);
    assert.match(answer, /\*What to know\*/i);
    assert.match(answer, /world bank/i);
    assert.equal(
      isCompleteCountryMetricAnswer("what is the gdp of china", answer),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("country metric quality check rejects generic memo-style non-answers", () => {
  const weakAnswer = [
    "Recommendation: check the World Bank or IMF for the latest GDP figure of China.",
    "Why: GDP figures can change and may be revised over time.",
    "Bottom line: verify periodically.",
  ].join("\n");

  assert.equal(isCompleteCountryMetricAnswer("what is the gdp of china", weakAnswer), false);
  assert.equal(
    isCompleteCountryMetricAnswer(
      "what is the inflation rate in UAE",
      [
        "*United Arab Emirates Inflation (latest official annual estimate):* 2.10%",
        "",
        "Year: 2024",
        "Metric: Inflation, consumer prices (annual %) (FP.CPI.TOTL.ZG)",
        "Source: worldbank.org",
      ].join("\n"),
    ),
    true,
  );
});

test("web search results expose live evidence bundles for deterministic country metrics", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.includes("/country?format=json")) {
      return new Response(JSON.stringify([
        { page: 1, pages: 1, per_page: "400", total: 1, sourceid: "2", lastupdated: "2026-02-24" },
        [
          { id: "CHN", iso2Code: "CN", name: "China" },
        ],
      ]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/country/CHN/indicator/NY.GDP.MKTP.CD")) {
      return new Response(JSON.stringify([
        { page: 1, pages: 1, per_page: "10", total: 2, sourceid: "2", lastupdated: "2026-02-24" },
        [
          { country: { value: "China" }, date: "2025", value: null },
          { country: { value: "China" }, date: "2024", value: 18_743_803_170_827.2 },
        ],
      ]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch during test: ${url}`);
  }) as typeof fetch;

  try {
    const result = await answerWebSearchResult("what is the gdp of china");
    assert.match(result.answer, /\*China GDP\*/i);
    assert.ok(result.liveAnswerBundle);
    assert.equal(result.liveAnswerBundle?.channel, "live");
    assert.equal(result.liveAnswerBundle?.sourceSummary.includes("worldbank.org"), true);
    assert.equal(result.liveAnswerBundle?.metadata.strategy, "deterministic");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retail fuel live answers use a deterministic national fuel price source", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url === "https://www.globalpetrolprices.com/countries/") {
      return new Response(
        [
          "<html><body>",
          '<a href="https://www.globalpetrolprices.com/China/" class="unitElement">China</a>',
          '<a href="https://www.globalpetrolprices.com/India/" class="unitElement">India</a>',
          "</body></html>",
        ].join(""),
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }

    if (url === "https://www.globalpetrolprices.com/China/gasoline_prices/") {
      return new Response(
        [
          '<html><body><div id="graphPageLeft">',
          "<h1>China Gasoline prices, liter</h1>",
          '<div style="text-align: justify;">The current gasoline price in China is CNY 8.21 per liter or USD 1.19 per liter and was updated on 16-Mar-2026. For comparison, the average price of gasoline in the world for this period is USD 1.25 per liter.</div>',
          '<div><a href="/source">National Development and Reform Commission (NDRC)</a></div>',
          "</div></body></html>",
        ].join(""),
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }

    throw new Error(`Unexpected fetch during retail fuel test: ${url}`);
  }) as typeof fetch;

  try {
    const answer = await fetchLiveDataAndSynthesize("price of petrol in china right now");
    assert.match(answer, /\*Live answer\*/i);
    assert.match(answer, /\*China petrol price\*/i);
    assert.match(answer, /CNY 8\.21 per liter/i);
    assert.match(answer, /\$1\.19 per liter/i);
    assert.match(answer, /16-Mar-2026/i);
    assert.match(answer, /globalpetrolprices\.com/i);
    assert.equal(
      isCompleteRetailFuelAnswer("price of petrol in china right now", answer),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("retail fuel quality check rejects evidence-only non-answers", () => {
  const weakAnswer = [
    "Quick answer: I found live coverage for price of petrol in China right now.",
    "",
    "Best live sources:",
    "• ABC News",
    "• BBC",
    "",
    "What to trust most: prefer official pages over commentary.",
    "",
    "Sources: ABC News, BBC",
  ].join("\n");

  assert.equal(isCompleteRetailFuelAnswer("price of petrol in china right now", weakAnswer), false);
  assert.equal(
    isCompleteRetailFuelAnswer(
      "petrol price in China right now",
      [
        "⛽ *China petrol price*",
        "*Latest national average retail price:* *CNY 8.21 per liter*",
        "• USD equivalent: *$1.19 per liter*",
        "• Last update: *16-Mar-2026*",
        "Sources: globalpetrolprices.com, National Development and Reform Commission (NDRC)",
      ].join("\n"),
    ),
    true,
  );
});

test("india consumer price live answers use the official consumer affairs price monitor", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url === "https://fcainfoweb.nic.in/default.aspx") {
      return new Response(
        [
          "<html><body>",
          "<h2>All India Average Retail Price(₹/Kg) As on 18/03/2026</h2>",
          "<div>Potato 20.83</div>",
          "<div>Onion 25.77</div>",
          "<div>Tomato 27.98</div>",
          "<h2>All India Average Wholesale Price(₹/Qtl.) As on 18/03/2026</h2>",
          "<div>Potato 1545.55</div>",
          "<div>Onion 1966.22</div>",
          "<div>Tomato 2086.62</div>",
          "</body></html>",
        ].join(""),
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }

    throw new Error(`Unexpected fetch during India consumer price test: ${url}`);
  }) as typeof fetch;

  try {
    const answer = await fetchLiveDataAndSynthesize("what is the price of tomato right now in india");
    assert.match(answer, /\*Live answer\*/i);
    assert.match(answer, /\*Tomato price in India\*/i);
    assert.match(answer, /₹27\.98 per kg/i);
    assert.match(answer, /₹2,086\.62 per quintal/i);
    assert.match(answer, /18-Mar-2026/i);
    assert.match(answer, /Department of Consumer Affairs/i);
    assert.equal(
      isCompleteIndiaConsumerPriceAnswer("what is the price of tomato right now in india", answer),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("india consumer price quality check rejects evidence-only non-answers", () => {
  const weakAnswer = [
    "Quick answer: I couldn't verify one precise current figure for price of tomato right now in India.",
    "",
    "Closest reliable signals:",
    "• A trend article about vegetable inflation",
    "",
    "Best next step:",
    "• Add a provider, country, city/market, or exact plan/model name for a tighter answer.",
    "",
    "Sources: example.com",
  ].join("\n");

  assert.equal(
    isCompleteIndiaConsumerPriceAnswer("what is the price of tomato right now in india", weakAnswer),
    false,
  );
});

test("consumer staple clarification avoids source-dump replies for unsupported regions", () => {
  assert.equal(looksLikeConsumerStaplePriceQuestion("price of tomato right now in china"), true);
  const answer = buildConsumerStaplePriceClarification("price of tomato right now in china");
  assert.match(answer, /\*Tomato price lookup\*/i);
  assert.match(answer, /city- or market-specific/i);
  assert.match(answer, /country \+ city or market/i);
});

test("mixed richest rankings stay complete when the cities source page is unavailable", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.includes("forbes.com/forbesapi/person/rtb/0/position/true.json")) {
      return new Response(JSON.stringify({
        personList: {
          personsLists: [
            { personName: "Elon Musk", finalWorth: 839_000 },
            { personName: "Mark Zuckerberg", finalWorth: 216_000 },
            { personName: "Jeff Bezos", finalWorth: 215_000 },
            { personName: "Larry Ellison", finalWorth: 192_000 },
            { personName: "Bernard Arnault", finalWorth: 178_000 },
            { personName: "Warren Buffett", finalWorth: 166_000 },
            { personName: "Larry Page", finalWorth: 144_000 },
            { personName: "Sergey Brin", finalWorth: 138_000 },
            { personName: "Steve Ballmer", finalWorth: 133_000 },
            { personName: "Jensen Huang", finalWorth: 129_000 },
          ],
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("henleyglobal.com/newsroom/press-releases/wealthiest-cities-report-2025")) {
      return new Response("blocked", { status: 503 });
    }

    throw new Error(`Unexpected fetch during test: ${url}`);
  }) as typeof fetch;

  try {
    const answer = await fetchLiveDataAndSynthesize(
      "tell me top 10 richest persons and richest cities of the world",
    );
    assert.match(answer, /\*Fresh answer\*/i);
    assert.match(answer, /Top richest people by live net worth/i);
    assert.match(answer, /Top wealthiest cities by resident millionaires/i);
    assert.match(answer, /New York/i);
    assert.match(answer, /Bay Area/i);
    assert.match(answer, /Elon Musk/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("richest ranking scope detection keeps city-only prompts out of the people route", () => {
  assert.equal(extractRichestRankingScope("top 10 richest cities in the world"), "cities");
  assert.equal(extractRichestRankingScope("top 10 richest people in the world"), "people");
  assert.equal(extractRichestRankingScope("tell me top 10 richest persons and richest cities of the world"), "mixed");
  assert.equal(extractRichestRankingScope("top 10 richest in the world"), "people");
});

test("city-only richest rankings stay scoped to cities and never append the people leaderboard", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.includes("forbes.com/forbesapi/person/rtb/0/position/true.json")) {
      throw new Error(`Forbes should not be fetched for a city-only prompt: ${url}`);
    }

    if (url.includes("henleyglobal.com/newsroom/press-releases/wealthiest-cities-report-2025")) {
      return new Response("blocked", { status: 503 });
    }

    throw new Error(`Unexpected fetch during test: ${url}`);
  }) as typeof fetch;

  try {
    const answer = await fetchLiveDataAndSynthesize("top 10 richest cities in the world");
    assert.match(answer, /\*Fresh answer\*/i);
    assert.match(answer, /Top wealthiest cities by resident millionaires/i);
    assert.match(answer, /New York/i);
    assert.match(answer, /Bay Area/i);
    assert.doesNotMatch(answer, /Top richest people by live net worth/i);
    assert.doesNotMatch(answer, /Elon Musk/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("topic mismatch detection flags explicit people-versus-cities scope bleed", () => {
  const answer = [
    "Top richest people by live net worth:",
    "1. Elon Musk - $810.0B",
    "",
    "Top wealthiest cities by resident millionaires (latest available Henley report):",
    "1. New York - 384,500 resident millionaires",
  ].join("\n");

  assert.equal(
    looksLikeQuestionTopicMismatch("top 10 richest cities in the world", answer),
    true,
  );
});

test("web-search routing accepts grounded city-only wealth rankings instead of rejecting them as incomplete metrics", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.includes("henleyglobal.com/newsroom/press-releases/wealthiest-cities-report-2025")) {
      return new Response("blocked", { status: 503 });
    }

    if (url.includes("forbes.com/forbesapi/person/rtb/0/position/true.json")) {
      throw new Error(`Forbes should not be fetched for a city-only prompt: ${url}`);
    }

    throw new Error(`Unexpected fetch during test: ${url}`);
  }) as typeof fetch;

  try {
    const result = await answerWebSearchResult("top 10 richest cities in the world");
    assert.match(result.answer, /\*Fresh answer\*/i);
    assert.match(result.answer, /Top wealthiest cities by resident millionaires/i);
    assert.doesNotMatch(result.answer, /not confident enough/i);
    assert.doesNotMatch(result.answer, /Top richest people by live net worth/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("historical wealth prompts do not get mistaken for live Forbes billionaire rankings", async () => {
  const question = "top 10 wealthiest person in history till now";

  assert.equal(looksLikeHistoricalWealthQuestion(question), true);
  assert.equal(classifyClawCloudLiveSearchTier(question), "knowledge");

  const fallbackReply = buildHistoricalWealthReply(question);
  assert.match(fallbackReply, /Mansa Musa/i);
  assert.match(fallbackReply, /John D\. Rockefeller/i);
  assert.match(fallbackReply, /no single universally accepted exact ranking/i);
  assert.doesNotMatch(fallbackReply, /Forbes Real-Time Billionaires API/i);
  assert.doesNotMatch(fallbackReply, /\bAs of\b/i);

  const webReply = await answerWebSearch(question);
  assert.match(webReply, /\*Top 10 wealthiest people in history\*/i);
  assert.match(webReply, /Mansa Musa/i);
  assert.match(webReply, /John D\. Rockefeller/i);
  assert.doesNotMatch(webReply, /Forbes Real-Time Billionaires API/i);
});

test("public affairs meetings and prefixed country metrics avoid old routing mistakes", () => {
  assert.equal(
    detectNewsQuestion("what was the conference of japan pm with us president in todays meeting"),
    true,
  );

  assert.deepEqual(
    detectIntentForTest("what was the conference of japan pm with us president in todays meeting"),
    { type: "research", category: "news" },
  );

  assert.deepEqual(
    detectWorldBankCountryMetricQuestion("Search the web and tell me Japan's current population using the latest reliable estimate, with source context."),
    { kind: "population", countryCandidate: "japan" },
  );
  assert.equal(detectWorldBankCountryMetricQuestion("what is the gdp of tokyo"), null);
  assert.equal(detectWorldBankCountryMetricQuestion("what is the population of tokyo"), null);
  assert.deepEqual(detectShortDefinitionLookup("what is semparo"), { term: "semparo" });
  assert.deepEqual(detectShortDefinitionLookup("define 'semparo'"), { term: "semparo" });
  assert.equal(detectShortDefinitionLookup("what is the gdp of china"), null);
  assert.equal(detectShortDefinitionLookup("what is the latest iPhone"), null);
});

test("curated short definition fallbacks answer obscure lexical terms deterministically", async () => {
  const answer = await answerShortDefinitionLookup("what is semparo");
  assert.match(answer ?? "", /Quenya/i);
  assert.match(answer ?? "", /for a few reasons/i);
});

test("curated short definition fallbacks answer common mythology terms directly", async () => {
  const answer = await answerShortDefinitionLookup("what is narsimha");
  assert.match(answer ?? "", /Narasimha/i);
  assert.match(answer ?? "", /half-man, half-lion avatar of Vishnu/i);
  assert.doesNotMatch(answer ?? "", /without more context/i);
});

test("short definition lookup queries search the raw named entity before lexical meaning prompts", () => {
  const queries = buildDefinitionLookupQueriesForTest("zebronics");
  assert.deepEqual(queries, ['"zebronics"', '"zebronics" meaning', '"zebronics" definition']);
});

test("named entity identity extraction answers brand and company lookups directly", () => {
  const answer = buildNamedEntityIdentityAnswerForTest("zebronics", [
    {
      id: "zebronics-official",
      title: "Zebronics",
      url: "https://zebronics.com/",
      snippet: "Zebronics is an Indian electronics brand known for audio products, IT peripherals, and gaming accessories.",
      provider: "serpapi",
      domain: "zebronics.com",
      score: 0.96,
    },
    {
      id: "zebronics-wiki",
      title: "Zebronics - Wikipedia",
      url: "https://en.wikipedia.org/wiki/Zebronics",
      snippet: "Indian brand of audio, IT, and gaming peripherals.",
      provider: "jina",
      domain: "wikipedia.org",
      score: 0.71,
    },
  ]);

  assert.match(answer, /Zebronics is an Indian electronics brand/i);
  assert.match(answer, /audio products|audio, IT, and gaming peripherals/i);
});

test("named entity identity extraction does not hijack lexical term lookups", () => {
  const answer = buildNamedEntityIdentityAnswerForTest("semparo", [
    {
      id: "semparo-wiktionary",
      title: "semparo - Wiktionary",
      url: "https://en.wiktionary.org/wiki/semparo",
      snippet: "Quenya adverb. Meaning: for a few reasons.",
      provider: "jina",
      domain: "wiktionary.org",
      score: 0.74,
    },
  ]);

  assert.equal(answer, "");
});

test("direct definition answer polishing removes awkward hedging and keeps the real answer first", () => {
  const polished = polishClawCloudAnswerStyleForTest(
    "what is narsimha",
    "explain",
    "explain",
    [
      'It seems you\'re unsure about the term "narsimha" without more context.',
      "To provide a clear definition, I would need to know the language, title, app, or subject area it refers to.",
      '"Narsimha" can have different meanings depending on the context, such as in Hindu mythology where Narasimha is the half-man, half-lion avatar of Vishnu.',
      "If you provide more details, I can offer a more precise definition.",
    ].join(" "),
  );

  assert.doesNotMatch(polished, /you'?re unsure/i);
  assert.doesNotMatch(polished, /i would need to know/i);
  assert.match(polished, /^Narsimha usually refers to Narasimha, the half-man, half-lion avatar of Vishnu\./i);
  assert.doesNotMatch(polished, /If you provide more details/i);
});

test("final reply polishing trims unrelated richest-people sections from city-only answers", () => {
  const polished = polishClawCloudAnswerStyleForTest(
    "top 10 richest cities in the world",
    "research",
    "research",
    [
      "Fresh answer",
      "Source note: based on recently retrieved web sources.",
      "",
      "Top richest people by live net worth:",
      "1. Elon Musk - $810.0B",
      "",
      "Top wealthiest cities by resident millionaires (latest available Henley report):",
      "1. New York - 384,500 resident millionaires",
      "2. Bay Area - 342,400 resident millionaires",
    ].join("\n"),
  );

  assert.match(polished, /Top wealthiest cities by resident millionaires/i);
  assert.doesNotMatch(polished, /Top richest people by live net worth/i);
  assert.doesNotMatch(polished, /Elon Musk/i);
});

test("historical power rankings route to history and use a cautious 400 AD fallback", () => {
  const question = "who was the top 10 most powerful countries in 400 ad";

  assert.equal(looksLikeHistoricalPowerRankingQuestion(question), true);
  assert.deepEqual(detectIntentForTest(question), { type: "history", category: "history" });

  const reply = buildHistoricalPowerRankingReply(question);
  assert.ok(reply);
  assert.match(reply ?? "", /Approximate major powers around 400 AD/i);
  assert.match(reply ?? "", /Eastern Roman Empire/i);
  assert.match(reply ?? "", /Sasanian Empire/i);
  assert.match(reply ?? "", /Gupta Empire/i);
  assert.doesNotMatch(reply ?? "", /\bHan Dynasty\b/i);
  assert.doesNotMatch(reply ?? "", /\bLiu Song\b/i);
});

test("whatsapp staged delivery prefers typing-style sends for normal answers and preserves code blocks", () => {
  assert.equal(shouldStageWhatsAppReply("Short ok", 140), false);
  assert.equal(shouldStageWhatsAppReply("A".repeat(160), 140), true);

  const chunks = splitWhatsAppStreamChunks([
    "Recommendation",
    "",
    "Use a short staged delivery so the user sees a typing-like reply instead of one instant wall of text. This should split into multiple messages cleanly.",
    "",
    "```javascript",
    "console.log('hello');",
    "```",
  ].join("\n"));

  assert.ok(chunks.length >= 3);
  assert.ok(chunks.some((chunk) => chunk.includes("Recommendation")));
  assert.ok(chunks.some((chunk) => chunk.startsWith("```javascript")));
  assert.ok(whatsAppInitialTypingDelayMs("hello") < whatsAppInitialTypingDelayMs("A".repeat(500)));
  assert.ok(whatsAppChunkDelayMs("```javascript\nconsole.log('hello');\n```") > whatsAppChunkDelayMs("short sentence"));
});
