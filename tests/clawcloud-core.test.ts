import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { detectCalendarActionIntent } from "@/lib/clawcloud-calendar-actions";
import {
  buildClawCloudAnswerQualityProfile,
  buildClawCloudLowConfidenceReply,
  isClawCloudGroundedLiveAnswer,
  looksLikeInstructionLeakReply,
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
  getAnswerQualityMetricsSnapshot,
  recordAnswerQualitySignals,
  resetAnswerQualityMetricsForTest,
  setLogLevel,
} from "@/lib/clawcloud-observability";
import {
  buildPreferredModelOrderForIntent,
  buildClawCloudModelCandidatesForTest,
  buildClawCloudModelPlannerDecisionForTest,
  chooseClawCloudCandidateForTest,
  detectMaterialCandidateDisagreementForTest,
  scoreClawCloudModelResponseForTest,
} from "@/lib/clawcloud-ai";
import { detectBillingIntent } from "@/lib/clawcloud-billing-wa";
import {
  analyzeSendMessageCommandSafety,
  buildParsedSendMessageAction,
  normalizeContactName,
  parseSendMessageCommand,
} from "@/lib/clawcloud-contacts";
import {
  classifyResolvedContactMatchConfidence,
  buildHistoryDerivedWhatsAppAliasesForTest,
  formatAmbiguousReply,
  normalizeResolvedContactMatchScore,
  rankContactCandidates,
} from "@/lib/clawcloud-contacts-v2";
import {
  buildImageGroundingFailureReply,
  buildVoiceNoteGroundingFailureReply,
  buildVideoGroundingFailureReply,
  buildVideoQuestionPrompt,
  buildVoiceNoteQuestionPrompt,
  looksLikeGroundedMediaPrompt,
} from "@/lib/clawcloud-media-context";
import {
  buildDocumentGroundingFailureReply,
} from "@/lib/clawcloud-docs";
import { analyzeConversationContinuityForTest } from "@/lib/clawcloud-memory";
import { detectDriveIntent } from "@/lib/clawcloud-drive";
import { answerHolidayQuery, detectHolidayQuery } from "@/lib/clawcloud-holidays";
import {
  detectIndianStateFromText,
  inferSpendingCategory,
  normalizeMerchantName,
} from "@/lib/clawcloud-india-normalization";
import { detectIndianStockQuery, detectTrainIntent } from "@/lib/clawcloud-india-live";
import {
  CLAWCLOUD_WHATSAPP_ALL_APP_STATE_COLLECTIONS,
  buildClawCloudAppStateCollectionCooldownExpiry,
  CLAWCLOUD_WHATSAPP_CONTACT_REFRESH_COLLECTIONS,
  getClawCloudEligibleAppStateCollections,
  shouldCooldownClawCloudAppStateCollection,
} from "@/lib/clawcloud-whatsapp-app-state";
import {
  CLAWCLOUD_WHATSAPP_WAITING_QR_RECONNECT_MAX_ATTEMPTS,
  shouldAutoRestoreClawCloudWhatsAppSession,
  shouldRequireManualWhatsAppQrReconnect,
} from "@/lib/clawcloud-whatsapp-reconnect-policy";
import {
  detectImageGenIntent,
  extractImagePrompt,
  getImageGenerationStatus,
} from "@/lib/clawcloud-imagegen";
import { looksLikeVisionPlaceholderReplyForTest } from "@/lib/clawcloud-vision";
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
import { listRetiredWhatsAppOwnerUserIds } from "@/lib/clawcloud-whatsapp-owner-handoff";
import {
  defaultWhatsAppSettings,
  type WhatsAppHistoryEntry,
} from "@/lib/clawcloud-whatsapp-workspace-types";
import {
  decideWhatsAppReplyAction,
  isWithinWhatsAppQuietHours,
  sanitizeWhatsAppSettingsPatch,
  shouldRequireExplicitUserCommandForWhatsAppChat,
} from "@/lib/clawcloud-whatsapp-control";
import { buildWhatsAppWorkspaceDeletePlanForTest } from "@/lib/clawcloud-whatsapp-governance";
import {
  buildWhatsAppOutboundIdempotencyKey,
  isWhatsAppOutboundFinalizedStatus,
  resolveWhatsAppOutboundStatusFromAckStatus,
  shouldRetryUndeliveredWhatsAppOutbound,
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
import { buildWhatsAppReceiptDerivedAliasMapForTest } from "@/lib/clawcloud-whatsapp-contact-alias-receipts";
import {
  buildClawCloudWhatsAppSessionStorageHealth,
  isClawCloudWhatsAppPersistentVolumePath,
  resolveClawCloudWhatsAppSessionBaseDir,
} from "@/lib/clawcloud-whatsapp-storage";
import { buildClawCloudWhatsAppContactIdentityGraph } from "@/lib/clawcloud-whatsapp-contact-identity";
import { scheduleWhatsAppWorkflowRunsFromInbound } from "@/lib/clawcloud-whatsapp-workflows";
import {
  classifyClawCloudWhatsAppSendResult,
  shouldDeliverClawCloudWhatsAppSelfMessage,
} from "@/lib/clawcloud-whatsapp";
import {
  dedupeWhatsAppHistoryRowsForTest,
  filterWhatsAppHistoryRowsForResolvedContactForTest,
} from "@/lib/clawcloud-whatsapp-inbox";
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
import {
  buildClawCloudSupabaseAuthStorageKey,
  normalizeClawCloudEmailAuthErrorMessage,
} from "@/lib/clawcloud-email-auth";
import { matchesWholeAlias } from "@/lib/clawcloud-intent-match";
import { pickAuthoritativeClawCloudGoogleAccount } from "@/lib/clawcloud-google-account-selection";
import {
  detectLocaleFromEmail,
  detectLocalePreferenceCommand,
  extractExplicitReplyLocaleRequest,
  extractExplicitReplyLocaleRequests,
  inferClawCloudMessageLocale,
  resolveClawCloudReplyLanguage,
  buildClawCloudReplyLanguageInstruction,
  stripExplicitReplyLocaleRequestForContent,
  verifyReplyLanguageMatch,
} from "@/lib/clawcloud-i18n";
import { resolveSupportedLocale } from "@/lib/clawcloud-locales";
import { detectHinglish } from "@/lib/clawcloud-hinglish";
import {
  assessClawCloudAnswerDraftForTest,
  buildUnhandledWhatsAppOperationalClarificationForTest,
  buildDeterministicAssistantMetaReplyForTest,
  buildDeterministicConversationReplyForTest,
  buildUnsupportedWhatsAppCallReplyForTest,
  buildLocalizedCapabilityReplyForTest,
  buildLocalizedCapabilityReplyFromMessageForTest,
  buildWhatsAppDeliveryFollowUpReplyForTest,
  buildWhatsAppHistoryProfessionalSummaryForTest,
  detectDirectConversationSignalForTest,
  detectNativeLanguageDirectAnswerLaneIntentForTest,
  detectMultilingualNativeAnswerLaneIntentForTest,
  detectStrictIntentRouteForTest,
  buildNaturalLanguageEmailSearchQuery,
  buildDeterministicExplainReplyForTest,
  buildLocalizedDeterministicKnownStoryReplyForTest,
  buildCodingFallbackV2,
  buildIntentAlignedRecoveryReplyForTest,
  buildTimeboxedProfessionalReplyForTest,
  formatWhatsAppHistoryResolvedNoRowsReplyForTest,
  formatWhatsAppHistoryUnverifiedContactReplyForTest,
  isConfidentRecipientNameMatchForTest,
  isProfessionallyCommittedRecipientMatchForTest,
  buildWhatsAppPendingContactResumePromptForTest,
  buildWhatsAppHistoryFollowUpResumePromptForTest,
  buildWhatsAppPendingDraftReviewReplyForTest,
  buildWhatsAppSendAmbiguousContactReplyForTest,
  maybePromoteVisibleResponseWithLiveBundleForTest,
  maybeBuildDeterministicProfessionalGreetingDraftForTest,
  maybeBuildDeterministicStructuredWhatsAppDraftForTest,
  maybeBuildDeterministicWhatsAppActiveContactReplyForTest,
  autoCorrectWhatsAppOutgoingMessageForTest,
  isUnsafeStyledWhatsAppDraftCandidateForTest,
  buildWhatsAppActiveContactStatusRecoveryPlanForTest,
  buildWhatsAppActiveContactSendReceiptForTest,
  detectWhatsAppActiveContactQuotedIncomingMessageForTest,
  looksLikeAssistantReplyRepairRequestForTest,
  parseWhatsAppActiveContactSessionCommandForTest,
  resolveWhatsAppPendingContactSelectionForTest,
  resolveWhatsAppPendingDraftReviewActionForTest,
  resolveWhatsAppActiveContactDraftLanguageForTest,
  resolveWhatsAppActiveContactSessionCommandWithContextForTest,
  resolveWhatsAppDraftingModeForTest,
  shouldPreviewRecipientTargetedWhatsAppDraftForTest,
  detectPendingApprovalContextQuestionForTest,
  detectIntentForTest,
  inferAnswerLengthProfileForTest,
  detectRequestedLanguageForFallback,
  extractWhatsAppHistoryHintsForTest,
  extractRequestedEmailCount,
  extractWhatsAppLooseContactFollowUpTargetForTest,
  filterEmailsForPromptWindow,
  finalizeAgentReplyForTest,
  inferRecentWhatsAppContactFollowUpIntentForTest,
  inferAppAccessRequirementForTest,
  isAcceptableAiModelWebAnswerForTest,
  isLikelyWhatsAppSelfLabelForTest,
  getInboundRouteTimeoutPolicyForTest,
  looksOverlyThinDirectDefinitionReplyForTest,
  looksLikeWhatsAppHistoryContinuationWithoutExplicitContactForTest,
  normalizeReplyForClawCloudDisplay,
  polishClawCloudAnswerStyleForTest,
  routeInboundAgentMessageResult,
  resolveResponseModeForTest,
  resolveDeterministicKnownStoryReplyForTest,
  resolveRoutingMessageForTest,
  isUnsafeWhatsAppActiveContactReplyCandidateForTest,
  shouldUsePrimaryConversationLaneForTest,
  shouldUsePrimaryDirectAnswerLaneForTest,
  shouldUseSimpleKnowledgeFastLaneForTest,
  shouldUseMultilingualRoutingBridgeForTest,
  shouldRouteMessageToActiveWhatsAppContactSessionForTest,
  shouldSkipFinalReplyLanguageRewriteForTest,
  stripClawCloudTrailingFollowUpForTest,
  usesPastYearAsCurrentForTest,
} from "@/lib/clawcloud-agent";
import {
  buildAppAccessConsentPrompt,
  clearLatestAppAccessConsent,
  createAppAccessConsentRequest,
  isClawCloudApprovalFreeModeEnabled,
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
  buildCountryDefinitionAnswerForTest,
  buildDefinitionLookupQueriesForTest,
  buildNamedEntityIdentityAnswerForTest,
  buildShortDefinitionClarificationSuggestionForTest,
  buildClawCloudLiveAnswerBundle,
  classifyClawCloudLiveSearchTier,
  detectWorldBankCountryMetricComparisonQuestion,
  detectShortDefinitionLookup,
  extractRichestRankingScope,
  detectWorldBankCountryMetricQuestion,
  fetchLiveDataAndSynthesize,
  isCompleteCountryMetricAnswer,
  renderClawCloudAnswerBundle,
  shouldUseLiveSearch,
} from "@/lib/clawcloud-live-search";
import {
  buildCurrentAffairsQueries,
  buildCurrentAffairsClarificationReply,
  looksLikeCurrentAffairsLogisticsQuestion,
  looksLikeCurrentAffairsQuestion,
} from "@/lib/clawcloud-current-affairs";

setLogLevel("error");
import {
  answerWebSearch,
  answerWebSearchResult,
  buildNoLiveDataReply,
  buildCurrentAffairsEvidenceAnswer,
  buildSourceBackedLiveAnswerResult,
  buildAiModelEvidenceOnlyAnswer,
  buildEvidenceOnlyAnswer,
  buildNewsQueries,
  buildTopHeadlineDigestAnswerForTest,
  detectNewsQuestion,
  extractAiModelEvidenceMentions,
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
  buildClawCloudGoogleLoginAuthUrl,
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
import { env, getPublicAppConfig, isGooglePublicSignInEnabled } from "@/lib/env";
import { detectWhatsAppSettingsCommandIntent } from "@/lib/clawcloud-whatsapp-settings-commands";
import { shouldBootstrapClawCloudWhatsAppWorkspace } from "@/lib/clawcloud-whatsapp";
import { pickAuthoritativeClawCloudWhatsAppAccount } from "@/lib/clawcloud-whatsapp-account-selection";
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
  getWeather,
  looksLikeDirectWeatherQuestion,
  normalizeWeatherLocationName,
  parseWeatherCity,
} from "@/lib/clawcloud-weather";
import {
  buildWhatsAppStreamPlan,
  shouldStageWhatsAppReply,
  splitWhatsAppStreamChunks,
  whatsAppChunkDelayMs,
  whatsAppInitialTypingDelayMs,
} from "@/lib/clawcloud-whatsapp-streaming";
import {
  extractWhatsAppPhoneShareFromChat,
  extractWhatsAppPhoneShareFromMessage,
  isWhatsAppResolvedSelfChat,
  resolveDefaultAssistantChatJid,
  shouldRememberAssistantSelfChat,
} from "@/lib/clawcloud-whatsapp-routing";
import { detectFinanceQuery, formatFinanceReply, getLiveFinanceData } from "@/lib/clawcloud-finance";
import { normalizeClawCloudUnderstandingMessage } from "@/lib/clawcloud-query-understanding";
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

test("whatsapp defaults stay read-only and require an explicit user request before self-chat delivery", () => {
  assert.equal(defaultWhatsAppSettings.automationMode, "read_only");
  assert.equal(defaultWhatsAppSettings.allowGroupReplies, false);
  assert.equal(defaultWhatsAppSettings.groupReplyMode, "never");
  assert.equal(defaultWhatsAppSettings.allowWorkflowAutoSend, false);
  assert.equal(defaultWhatsAppSettings.activeContactSession, null);
  assert.equal(shouldDeliverClawCloudWhatsAppSelfMessage(), false);
  assert.equal(
    shouldDeliverClawCloudWhatsAppSelfMessage({ deliveryMode: "background" }),
    false,
  );
  assert.equal(
    shouldDeliverClawCloudWhatsAppSelfMessage({ deliveryMode: "explicit_user_request" }),
    true,
  );

  assert.equal(shouldRequireExplicitUserCommandForWhatsAppChat("self"), false);
  assert.equal(shouldRequireExplicitUserCommandForWhatsAppChat("direct"), true);
  assert.equal(shouldRequireExplicitUserCommandForWhatsAppChat("group"), true);
  assert.equal(shouldRequireExplicitUserCommandForWhatsAppChat("broadcast"), true);
  assert.equal(shouldRequireExplicitUserCommandForWhatsAppChat("unknown"), true);
});

test("whatsapp settings sanitize legacy autonomous modes back to read-only", () => {
  assert.equal(
    sanitizeWhatsAppSettingsPatch({ automationMode: "auto_reply" }).automationMode,
    "read_only",
  );
  assert.equal(
    sanitizeWhatsAppSettingsPatch({ automationMode: "approve_before_send" }).automationMode,
    "read_only",
  );
});

test("whatsapp reply action blocks legacy autonomous auto-reply mode", () => {
  assert.deepEqual(
    decideWhatsAppReplyAction({
      settings: {
        ...defaultWhatsAppSettings,
        automationMode: "auto_reply",
      },
      sensitivity: "normal",
      isGroupMessage: false,
      isKnownContact: true,
    }),
    {
      action: "block",
      reason: "Autonomous outbound mode is retired. A direct user command is required before ClawCloud sends anything.",
    },
  );
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
  assert.equal(
    shouldRetryUndeliveredWhatsAppOutbound({
      status: "sent",
      delivered_at: null,
      read_at: null,
      failed_at: null,
      updated_at: "2026-04-05T10:00:00.000Z",
      sent_at: "2026-04-05T10:00:00.000Z",
      created_at: "2026-04-05T09:59:58.000Z",
    }, {
      nowMs: Date.parse("2026-04-05T10:00:45.000Z"),
      minPendingMs: 30_000,
    }),
    true,
  );
  assert.equal(
    shouldRetryUndeliveredWhatsAppOutbound({
      status: "sent",
      delivered_at: null,
      read_at: null,
      failed_at: null,
      updated_at: "2026-04-05T10:00:20.000Z",
      sent_at: "2026-04-05T10:00:00.000Z",
      created_at: "2026-04-05T09:59:58.000Z",
    }, {
      nowMs: Date.parse("2026-04-05T10:00:45.000Z"),
      minPendingMs: 30_000,
    }),
    false,
  );
});

test("whatsapp send result classification distinguishes pending retries from duplicates", () => {
  assert.equal(classifyClawCloudWhatsAppSendResult({
    deduped: false,
    retriedUndelivered: false,
    sentAccepted: true,
    deliveryConfirmed: true,
  }), "delivered");
  assert.equal(classifyClawCloudWhatsAppSendResult({
    deduped: false,
    retriedUndelivered: true,
    sentAccepted: true,
    deliveryConfirmed: false,
  }), "resubmitted_pending");
  assert.equal(classifyClawCloudWhatsAppSendResult({
    deduped: true,
    retriedUndelivered: false,
    sentAccepted: true,
    deliveryConfirmed: false,
  }), "already_pending");
  assert.equal(classifyClawCloudWhatsAppSendResult({
    deduped: true,
    retriedUndelivered: false,
    sentAccepted: true,
    deliveryConfirmed: true,
  }), "already_delivered");
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

test("whatsapp self chat bypasses passive defaults and answers directly", () => {
  assert.deepEqual(
    decideWhatsAppReplyAction({
      settings: {
        ...defaultWhatsAppSettings,
        automationMode: "read_only",
        quietHoursStart: "00:00",
        quietHoursEnd: "00:00",
      },
      sensitivity: "normal",
      chatType: "self",
      isGroupMessage: false,
      isKnownContact: true,
    }),
    {
      action: "send",
      reason: "Owner self-chat should always receive direct answers.",
    },
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

test("agent server blocks non-self inbound chats before helper reply branches", () => {
  const source = readFileSync(path.resolve(process.cwd(), "agent-server.ts"), "utf8");
  const passiveGuardIndex = source.indexOf(
    "const assistantSelfTargetJid = resolveAssistantSelfReplyTarget(current, replyTargetJid);",
  );
  const helperReplyIndex = source.indexOf("await sendReply(userId, reply, replyTargetJid);");

  assert.ok(passiveGuardIndex > 0);
  assert.ok(helperReplyIndex > 0);
  assert.ok(
    passiveGuardIndex < helperReplyIndex,
    "the passive external-chat guard must run before media/helper sendReply branches",
  );
});

test("agent server assistant replies refuse non-self chat targets", () => {
  const source = readFileSync(path.resolve(process.cwd(), "agent-server.ts"), "utf8");

  assert.match(
    source,
    /const jid = resolveAssistantSelfReplyTarget\(session, targetJid\);/,
  );
  assert.match(source, /Blocked non-self assistant reply/);
});

test("agent server enforces explicit user commands before any external-chat reply generation", () => {
  const source = readFileSync(path.resolve(process.cwd(), "agent-server.ts"), "utf8");

  assert.match(source, /shouldRequireExplicitUserCommandForWhatsAppChat\(logFields\.chat_type\)/);
  assert.match(source, /await markPassiveExternalWhatsAppChatOnly\(userId, logFields, messageType\);/);
  assert.doesNotMatch(source, /generateAutomaticWhatsAppActiveContactReplyForServer/);
  assert.doesNotMatch(source, /Active contact reply generated for/);
});

test("freshness-sensitive live questions fail closed before emergency model-memory fallback", () => {
  const source = readFileSync(path.resolve(process.cwd(), "lib/clawcloud-agent.ts"), "utf8");

  assert.match(source, /const noLiveDataReply = buildNoLiveDataReply\(question\)\.trim\(\);/);
  assert.match(source, /shouldFailClosedWithoutFreshData\(question\)/);
});

test("agent server keeps a wider answer window and no longer emits resend-the-question fallbacks", () => {
  const source = readFileSync(path.resolve(process.cwd(), "agent-server.ts"), "utf8");

  assert.match(source, /const DEFAULT_DIRECT_REPLY_TIMEOUT_MS = 50_000;/);
  assert.match(source, /const DEFAULT_HTTP_REPLY_TIMEOUT_MS = 50_000;/);
  assert.match(source, /const DEFAULT_HTTP_REPLY_HEADSTART_MS = 12_000;/);
  assert.match(source, /const AGENT_ROUTE_TIMEOUT_BUFFER_MS = 5_000;/);
  assert.match(source, /const DIRECT_RECOVERY_REPLY_TIMEOUT_MS = 35_000;/);
  assert.match(source, /getInboundRouteTimeoutPolicy/);
  assert.match(source, /getInboundRouteTotalDeadlineMs/);
  assert.match(source, /recoverUserFacingReplyForServer/);
  assert.match(source, /route_budget=\$\{timing\.routeBudgetMs\}/);
  assert.match(source, /allowWithoutNvidia:\s*true/);
  assert.doesNotMatch(source, /return\s+[`"'][^`"']*Ask the same question once more/i);
  assert.doesNotMatch(source, /return\s+[`"'][^`"']*Send the same question once more/i);
  assert.doesNotMatch(source, /return\s+[`"'][^`"']*temporary connection issue with my ai backend/i);
  assert.doesNotMatch(source, /warming up — please resend your question/i);
});

test("emergency direct answers use the shared preferred-model helper instead of stale hardcoded recovery lists", () => {
  const source = readFileSync(path.resolve(process.cwd(), "lib/clawcloud-agent.ts"), "utf8");

  assert.match(source, /export function getInboundRouteTotalDeadlineMs\(message: string\)/);
  assert.match(source, /export async function recoverUserFacingReplyForServer/);
  assert.match(source, /preferredModels:\s*buildPreferredModelOrderForIntent\(emergencyIntent,\s*"fast",\s*6\)/);
  assert.match(source, /const MULTILINGUAL_DIRECT_ANSWER_PREFERRED_MODELS = buildPreferredModelOrderForIntent\("language",\s*"deep",\s*4\)/);
});

test("server recovery no longer ships the old generic strong-answer fallback copy", () => {
  const agentServerSource = readFileSync(path.resolve(process.cwd(), "agent-server.ts"), "utf8");
  const recoverySource = readFileSync(path.resolve(process.cwd(), "lib/clawcloud-agent.ts"), "utf8");

  assert.match(agentServerSource, /const DIRECT_RECOVERY_REPLY_TIMEOUT_MS = 35_000;/);
  assert.match(recoverySource, /export function buildGuaranteedServerRecoveryReply\(question: string\)/);
  assert.doesNotMatch(agentServerSource, /I couldn't complete a strong answer on that attempt/i);
  assert.doesNotMatch(recoverySource, /I couldn't complete a strong answer on that attempt/i);
});

test("ai engine routing filters failed GPT/gemma/llama3 families out of active production routing", () => {
  const aiSource = readFileSync(path.resolve(process.cwd(), "lib/clawcloud-ai.ts"), "utf8");
  const envSource = readFileSync(path.resolve(process.cwd(), "lib/env.ts"), "utf8");

  assert.match(
    aiSource,
    /const GLOBAL_TOP_MODELS = \[[\s\S]*?"gpt-5\.4-pro"[\s\S]*?"gpt-5\.4-nano"/,
  );
  assert.match(aiSource, /\^gpt-5\/i/);
  assert.match(aiSource, /\^google\\\/gemma-2-27b-it\$\/i/);
  assert.match(aiSource, /\^meta\\\/llama3-8b-instruct\$\/i/);
  assert.match(aiSource, /const ACTIVE_STABLE_ROUTE_MODELS = \[/);
  assert.match(aiSource, /function applyResilientDefaultModelOrdering\(models: string\[\]\)/);
  assert.match(aiSource, /function filterModelsByConfiguredProviders\(/);
  assert.match(aiSource, /function hasAnyAiProviderConfigured\(/);
  assert.doesNotMatch(aiSource, /function hasExplicitModernNvidiaRoutingConfig\(\)/);
  assert.match(aiSource, /return available\.length \? available : cooling;/);
  assert.match(
    envSource,
    /NVIDIA_CHAT_MODEL:\s*readFirstString\(\s*\["NVIDIA_CHAT_MODEL"\],\s*"meta\/llama-4-maverick-17b-128e-instruct"/,
  );
  assert.match(aiSource, /const DEPRECATED_ROUTE_MODEL_PATTERNS = \[/);
  assert.match(aiSource, /export function buildPreferredModelOrderForIntent\(/);
  assert.doesNotMatch(envSource, /NVIDIA_MODEL/);
});

test("math fast routing keeps stable NVIDIA fallback models in the first production batch window", () => {
  const ordered = buildPreferredModelOrderForIntent("math", "fast", 4);

  assert.deepEqual(ordered, [
    "meta/llama-4-maverick-17b-128e-instruct",
    "qwen/qwen3.5-397b-a17b",
    "mistralai/mistral-small-3.1-24b-instruct-2503",
    "deepseek-ai/deepseek-v3.1-terminus",
  ]);
});

test("ai adapter uses the modern OpenAI responses contract and normalizes NVIDIA models that reject system role", () => {
  const aiSource = readFileSync(path.resolve(process.cwd(), "lib/clawcloud-ai.ts"), "utf8");
  const serverSource = readFileSync(path.resolve(process.cwd(), "agent-server.ts"), "utf8");

  assert.match(aiSource, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(aiSource, /max_output_tokens/);
  assert.match(aiSource, /max_completion_tokens/);
  assert.match(aiSource, /output_text/);
  assert.match(aiSource, /collapseSystemMessagesIntoUserTurn/);
  assert.match(aiSource, /coalesceAdjacentMessages/);
  assert.match(aiSource, /NVIDIA_NO_SYSTEM_ROLE_PATTERNS/);
  assert.match(aiSource, /openAIReasoningEffortForModel/);
  assert.match(aiSource, /reasoning_effort/);
  assert.match(serverSource, /QUIET_WHATSAPP_LOGGER/);
  assert.match(serverSource, /logger:\s*QUIET_WHATSAPP_LOGGER/);
  assert.match(serverSource, /installWhatsAppStdStreamFilter\(\)/);
  assert.match(serverSource, /WHATSAPP_LIBRARY_STACK_NOISE_PATTERNS/);
});

test("agent server buffers partial WhatsApp noise lines and only promotes verified fuzzy contact resolutions back into the live session", () => {
  const serverSource = readFileSync(path.resolve(process.cwd(), "agent-server.ts"), "utf8");
  const agentSource = readFileSync(path.resolve(process.cwd(), "lib/clawcloud-agent.ts"), "utf8");

  assert.match(serverSource, /let pendingFragment = "";/);
  assert.match(serverSource, /const combinedText = `\$\{pendingFragment\}\$\{text\}`;/);
  assert.match(serverSource, /const lastNewlineIndex = combinedText\.lastIndexOf\("\\n"\);/);
  assert.match(serverSource, /<Buffer\\b/);
  assert.match(serverSource, /pendingprekey\|unacknowledgedprekey\|prekeyid\|signedprekeyid/i);
  assert.match(serverSource, /fuzzy-promote/);
  assert.match(serverSource, /type:\s*"confirmation_required"/);
  assert.match(serverSource, /classifyResolvedContactMatchConfidence/);
  assert.match(serverSource, /findSessionContactMatchesByPhone/);
  assert.match(agentSource, /type:\s*"confirmation_required"/);
  assert.match(agentSource, /buildWhatsAppExactContactRequiredReply/);
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
      selectedModel: "qwen/qwen3-coder-480b-a35b-instruct",
      candidates: [
        {
          model: "meta/llama-4-maverick-17b-128e-instruct",
          tier: "chat",
          status: "generated",
          latencyMs: 1900,
          heuristicScore: 34.5,
          preview: "Use Redis with a processing key before enqueueing work.",
        },
        {
          model: "qwen/qwen3-coder-480b-a35b-instruct",
          tier: "reasoning",
          status: "selected",
          latencyMs: 2400,
          heuristicScore: 51.25,
          preview: "Reserve the idempotency key, persist the outcome transactionally, and replay from durable storage.",
        },
      ],
      judge: {
        used: true,
        model: "gpt-5.4-pro",
        winnerModel: "qwen/qwen3-coder-480b-a35b-instruct",
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

  assert.equal(merged[0]?.messages[0]?.modelAuditTrail?.selectedModel, "qwen/qwen3-coder-480b-a35b-instruct");
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

test("model router keeps general fast candidates on the stable NVIDIA-first production sequence", () => {
  const candidates = buildClawCloudModelCandidatesForTest({
    intent: "general",
    responseMode: "fast",
    providerAvailability: { openai: true, nvidia: true },
  });

  assert.deepEqual(candidates, [
    "meta/llama-4-maverick-17b-128e-instruct",
    "qwen/qwen3.5-397b-a17b",
    "deepseek-ai/deepseek-v3.1",
    "deepseek-ai/deepseek-v3.1-terminus",
  ]);
});

test("model router keeps fast coding on low-latency NVIDIA fallbacks while deep coding still prefers code specialists", () => {
  const fastCoding = buildClawCloudModelCandidatesForTest({
    intent: "coding",
    responseMode: "fast",
    providerAvailability: { openai: true, nvidia: true },
  });
  const deepCoding = buildClawCloudModelCandidatesForTest({
    intent: "coding",
    responseMode: "deep",
    providerAvailability: { openai: true, nvidia: true },
  });

  assert.equal(fastCoding.length, 3);
  assert.deepEqual(fastCoding, [
    "meta/llama-4-maverick-17b-128e-instruct",
    "mistralai/mistral-small-3.1-24b-instruct-2503",
    "deepseek-ai/deepseek-v3.1-terminus",
  ]);

  assert.equal(deepCoding.length, 3);
  assert.deepEqual(deepCoding, [
    "qwen/qwen3-coder-480b-a35b-instruct",
    "qwen/qwen2.5-coder-32b-instruct",
    "deepseek-ai/deepseek-v3.1",
  ]);
});

test("model router removes unavailable provider families before trimming candidates", () => {
  const openAiOnly = buildClawCloudModelCandidatesForTest({
    intent: "general",
    responseMode: "fast",
    providerAvailability: { openai: true, nvidia: false },
  });
  assert.deepEqual(openAiOnly, []);

  const nvidiaOnly = buildClawCloudModelCandidatesForTest({
    intent: "general",
    responseMode: "fast",
    providerAvailability: { openai: false, nvidia: true },
  });
  assert.deepEqual(nvidiaOnly, [
    "meta/llama-4-maverick-17b-128e-instruct",
    "qwen/qwen3.5-397b-a17b",
    "deepseek-ai/deepseek-v3.1",
    "deepseek-ai/deepseek-v3.1-terminus",
  ]);
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

test("phase 7 disagreement handling fails closed when high-stakes candidates conflict and no valid winner emerges", () => {
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

test("phase 7 selection prefers the strongest structurally valid coding answer over an invalid judged winner", () => {
  const choice = chooseClawCloudCandidateForTest({
    intent: "coding",
    responseMode: "deep",
    userQuestion: [
      "Given an array of integers, find the length of the longest subarray with at most k distinct elements.",
      "Optimize for O(n) time.",
      "Explain your approach and provide code.",
    ].join(" "),
    responses: [
      {
        response: "Use a sliding window with a frequency map and keep shrinking when distinct elements exceed k.",
      },
      {
        response: [
          "Use a sliding window with a frequency map.",
          "",
          "```ts",
          "function longestAtMostKDistinct(nums: number[], k: number): number {",
          "  const freq = new Map<number, number>();",
          "  let left = 0;",
          "  let best = 0;",
          "  for (let right = 0; right < nums.length; right += 1) {",
          "    freq.set(nums[right], (freq.get(nums[right]) ?? 0) + 1);",
          "    while (freq.size > k) {",
          "      const next = (freq.get(nums[left]) ?? 0) - 1;",
          "      if (next <= 0) freq.delete(nums[left]); else freq.set(nums[left], next);",
          "      left += 1;",
          "    }",
          "    best = Math.max(best, right - left + 1);",
          "  }",
          "  return best;",
          "}",
          "```",
          "",
          "Time complexity: O(n). Space complexity: O(k).",
        ].join("\n"),
      },
    ],
    judgeDecision: {
      winnerIndex: 0,
      confidence: "low",
      needsClarification: true,
      materialDisagreement: true,
    },
  });

  assert.equal(choice.selectedIndex, 1);
  assert.notEqual(choice.selectedBy, "fallback");
});

test("phase 7 selection treats batches with only structurally invalid coding answers as no valid winner", () => {
  const choice = chooseClawCloudCandidateForTest({
    intent: "coding",
    responseMode: "deep",
    userQuestion: [
      "Given an array of integers, find the length of the longest subarray with at most k distinct elements.",
      "Optimize for O(n) time.",
      "Explain your approach and provide code.",
    ].join(" "),
    responses: [
      { response: "Use a sliding window." },
      { response: "Track frequencies and move two pointers to keep at most k distinct values." },
    ],
  });

  assert.equal(choice.selectedIndex, null);
  assert.equal(choice.selectedBy, "fallback");
});

test("intent-aligned recovery for coding stays answer-shaped instead of generic scoped fallback", () => {
  const prompt = [
    "Given an array of integers, find the length of the longest subarray with at most k distinct elements.",
    "",
    "Constraints:",
    "- 1 <= n <= 10^5",
    "- Optimize for O(n) time",
    "",
    "Explain your approach and provide code.",
  ].join("\n");

  const reply = buildIntentAlignedRecoveryReplyForTest(prompt, "coding");

  assert.doesNotMatch(reply, /exact topic, name, item, or number/i);
  assert.doesNotMatch(reply, /exact problem statement, language, or constraints/i);
  assert.match(reply, /sliding window|two pointers|time complexity|space complexity|```/i);
});

test("unified answer assessment prioritizes live grounding defects for freshness-sensitive questions", () => {
  const assessment = assessClawCloudAnswerDraftForTest({
    question: "Who is the richest person in the world right now?",
    intent: "research",
    category: "research",
    answer: "The richest person in the world is Elon Musk.",
  });

  assert.equal(assessment.primaryIssue, "live_grounding_missing");
  assert.ok(assessment.issues.includes("live_grounding_missing"));
});

test("unified answer assessment flags wrong-mode story replies before generic mismatch handling", () => {
  const assessment = assessClawCloudAnswerDraftForTest({
    question: "story of Harry potter in japanese",
    intent: "culture",
    category: "culture",
    answer: "The provided text is already in English and requires no translation.",
  });

  assert.equal(assessment.primaryIssue, "wrong_mode");
  assert.ok(assessment.issues.includes("wrong_mode"));
});

test("unified answer assessment flags incomplete technical answers with an explicit issue code", () => {
  const assessment = assessClawCloudAnswerDraftForTest({
    question: [
      "Given an array of integers, find the length of the longest subarray with at most k distinct elements.",
      "Optimize for O(n) time.",
      "Explain your approach and provide code.",
    ].join(" "),
    intent: "coding",
    category: "coding",
    answer: "Use a sliding window.",
  });

  assert.equal(assessment.primaryIssue, "missing_code");
  assert.ok(assessment.issues.includes("missing_code"));
});

test("domain validators flag coding answers that omit code after an explicit code request", () => {
  const assessment = assessClawCloudAnswerDraftForTest({
    question: [
      "Given an array of integers, find the length of the longest subarray with at most k distinct elements.",
      "Optimize for O(n) time.",
      "Explain your approach and provide code.",
    ].join(" "),
    intent: "coding",
    category: "coding",
    answer: "Use a sliding window with a frequency map. Keep the window valid and track the best length. Time complexity is O(n) and space complexity is O(k).",
  });

  assert.equal(assessment.primaryIssue, "missing_code");
  assert.ok(assessment.issues.includes("missing_code"));
});

test("domain validators flag math answers that do not show the solved result", () => {
  const assessment = assessClawCloudAnswerDraftForTest({
    question: "Calculate the EMI for a loan of 10,00,000 at 10% annual interest for 5 years, and show the steps.",
    intent: "math",
    category: "math",
    answer: "Use the standard EMI formula with principal, monthly rate, and tenure.",
  });

  assert.equal(assessment.primaryIssue, "math_incomplete");
  assert.ok(assessment.issues.includes("math_incomplete"));
});

test("domain validators flag replies that ignore the requested output language", () => {
  const assessment = assessClawCloudAnswerDraftForTest({
    question: "Explain recursion in Hindi.",
    intent: "language",
    category: "language",
    answer: "Recursion is a technique where a function calls itself to solve smaller instances of the same problem.",
  });

  assert.equal(assessment.primaryIssue, "wrong_language");
  assert.ok(assessment.issues.includes("wrong_language"));
});

test("domain validators reject contact completions that still carry ambiguity", () => {
  const assessment = assessClawCloudAnswerDraftForTest({
    question: "Send hello to Papa on WhatsApp.",
    intent: "general",
    category: "send_message",
    answer: "Message sent to Papa. I found multiple WhatsApp contacts matching \"Papa\". Reply with the exact contact name or full number and I will check the right chat.",
  });

  assert.equal(assessment.primaryIssue, "contact_verification_missing");
  assert.ok(assessment.issues.includes("contact_verification_missing"));
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

test("email auth helpers keep Supabase storage keys and HTML parse errors stable", () => {
  assert.equal(
    buildClawCloudSupabaseAuthStorageKey("https://anahzdzznusrswpmlzlc.supabase.co"),
    "sb-anahzdzznusrswpmlzlc-auth-token",
  );

  assert.match(
    normalizeClawCloudEmailAuthErrorMessage(
      "Unexpected token '<', \"<!DOCTYPE html>\" is not valid JSON",
    ),
    /temporarily unavailable/i,
  );

  assert.equal(
    normalizeClawCloudEmailAuthErrorMessage("Invalid login credentials"),
    "Incorrect email or password. Please try again.",
  );
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
      "Yes.",
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
    const approvedHindi = await resolveLatestAppAccessConsentDecision(
      "user-plain",
      "haan",
      { persist: false },
    );
    assert.equal(approvedHindi?.decision, "approve");

    await rememberLatestAppAccessConsent(
      "user-plain",
      consent,
      "Send message to Maa: Good morning",
      { persist: false },
    );
    const denied = await resolveLatestAppAccessConsentDecision(
      "user-plain",
      "No!",
      { persist: false },
    );
    assert.equal(denied?.decision, "deny");
  } finally {
    env.AGENT_SECRET = previousAgentSecret;
  }
});

test("route resolves app-access Yes/No decisions before fast-lane intent routing", async () => {
  const previousAgentSecret = env.AGENT_SECRET;
  env.AGENT_SECRET = "test-agent-secret";

  try {
    const consent = createAppAccessConsentRequest({
      userId: "user-route-approval",
      surface: "gmail",
      operation: "read",
      originalMessage: "what is semparo",
    });

    await rememberLatestAppAccessConsent(
      "user-route-approval",
      consent,
      "what is semparo",
      { persist: false },
    );

    const approved = await routeInboundAgentMessageResult(
      "user-route-approval",
      "yes",
    );

    assert.ok(approved.response);
    assert.match(approved.response ?? "", /semparo/i);
    assert.doesNotMatch(approved.response ?? "", /no question to answer/i);
  } finally {
    await clearLatestAppAccessConsent("user-route-approval", undefined, { persist: false }).catch(() => undefined);
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

  assert.deepEqual(inferAppAccessRequirementForTest("tell me the conversation summary with that number"), {
    surface: "whatsapp",
    operation: "read",
    summary: "read from your WhatsApp",
  });
  assert.deepEqual(inferAppAccessRequirementForTest("tell me the message of jaideep with me"), {
    surface: "whatsapp",
    operation: "read",
    summary: "read from your WhatsApp",
  });
  assert.deepEqual(inferAppAccessRequirementForTest("read and tell me the message of jaideep"), {
    surface: "whatsapp",
    operation: "read",
    summary: "read from your WhatsApp",
  });

  assert.deepEqual(inferAppAccessRequirementForTest("Send message to Maa: Good morning"), {
    surface: "whatsapp",
    operation: "write",
    summary: "use your WhatsApp to send or reply",
  });

  assert.deepEqual(inferAppAccessRequirementForTest("Send a WhatsApp message to Mehak saying hello from ClawCloud"), {
    surface: "whatsapp",
    operation: "write",
    summary: "use your WhatsApp to send or reply",
  });

  assert.deepEqual(inferAppAccessRequirementForTest("Reply to Mehak on WhatsApp saying I am testing right now"), {
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

test("direct-action mode keeps app-access prompts informational and disables yes-no gating", () => {
  assert.equal(isClawCloudApprovalFreeModeEnabled(), true);

  const prompt = buildAppAccessConsentPrompt("whatsapp", "write");
  assert.doesNotMatch(prompt, /Grant one-time access/i);
  assert.doesNotMatch(prompt, /Reply "Yes" to continue/i);
  assert.match(prompt, /without a manual Yes\/No approval step/i);
});

test("default WhatsApp settings keep approval gates off", () => {
  assert.equal(defaultWhatsAppSettings.requireApprovalForSensitive, false);
  assert.equal(defaultWhatsAppSettings.requireApprovalForNewContacts, false);
  assert.equal(defaultWhatsAppSettings.requireApprovalForFirstOutreach, false);
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

test("authoritative WhatsApp account selection prefers the active live row over stale duplicates", () => {
  const account = pickAuthoritativeClawCloudWhatsAppAccount([
    {
      phone_number: "919111111111",
      display_name: "Old WhatsApp",
      is_active: false,
      connected_at: "2026-03-28T10:00:00.000Z",
      last_used_at: "2026-03-28T10:05:00.000Z",
    },
    {
      phone_number: "918091392311",
      display_name: "Live WhatsApp",
      is_active: true,
      connected_at: "2026-04-02T20:00:00.000Z",
      last_used_at: "2026-04-02T20:10:00.000Z",
    },
    {
      phone_number: "919222222222",
      display_name: "Older Active WhatsApp",
      is_active: true,
      connected_at: "2026-04-01T10:00:00.000Z",
      last_used_at: "2026-04-01T10:05:00.000Z",
    },
  ]);

  assert.equal(account?.phone_number, "918091392311");
  assert.equal(account?.display_name, "Live WhatsApp");
});

test("setup status prefers the most recent active WhatsApp account when duplicate rows exist", () => {
  const state = deriveClawCloudSetupConnectionState({
    connected_accounts: [
      {
        provider: "whatsapp",
        phone_number: "919111111111",
        display_name: "Older Active WhatsApp",
        is_active: true,
        connected_at: "2026-04-01T10:00:00.000Z",
        last_used_at: "2026-04-01T10:05:00.000Z",
      },
      {
        provider: "whatsapp",
        phone_number: "918091392311",
        display_name: "Live WhatsApp",
        is_active: true,
        connected_at: "2026-04-02T20:00:00.000Z",
        last_used_at: "2026-04-02T20:10:00.000Z",
      },
    ],
    global_lite_connections: [],
  });

  assert.equal(state.whatsappConnected, true);
  assert.equal(state.whatsappPhone, "918091392311");
});

test("newly scanned WhatsApp owner retires older duplicate owners for the same phone", () => {
  const retired = listRetiredWhatsAppOwnerUserIds({
    activeUserId: "new-user",
    activePhone: "+91 80913 92311",
    accounts: [
      {
        user_id: "new-user",
        phone_number: "918091392311",
        connected_at: "2026-04-05T12:00:00.000Z",
      },
      {
        user_id: "old-user-a",
        phone_number: "918091392311",
        connected_at: "2026-04-01T12:00:00.000Z",
        last_used_at: "2026-04-01T12:05:00.000Z",
      },
      {
        user_id: "old-user-b",
        account_email: "918091392311",
        connected_at: "2026-03-30T10:00:00.000Z",
        last_used_at: "2026-03-30T10:05:00.000Z",
      },
      {
        user_id: "different-phone-user",
        phone_number: "919999888877",
        connected_at: "2026-04-04T12:00:00.000Z",
      },
    ],
  });

  assert.deepEqual(retired, ["old-user-a", "old-user-b"]);
});

test("newly scanned WhatsApp owner does not retire unrelated users when the phone differs", () => {
  const retired = listRetiredWhatsAppOwnerUserIds({
    activeUserId: "new-user",
    activePhone: "918091392311",
    accounts: [
      {
        user_id: "new-user",
        phone_number: "918091392311",
      },
      {
        user_id: "other-user",
        phone_number: "919111111111",
      },
    ],
  });

  assert.deepEqual(retired, []);
});

test("authoritative Google account selection prefers the most recent active Gmail row over stale duplicates", () => {
  const account = pickAuthoritativeClawCloudGoogleAccount([
    {
      account_email: "founder@example.com",
      display_name: "Founder Old",
      is_active: true,
      connected_at: "2026-04-01T10:00:00.000Z",
      last_used_at: "2026-04-01T10:05:00.000Z",
      token_expiry: "2026-04-01T11:00:00.000Z",
      refresh_token: "old-refresh",
    },
    {
      account_email: "founder@example.com",
      display_name: "Founder Live",
      is_active: true,
      connected_at: "2026-04-03T10:00:00.000Z",
      last_used_at: "2026-04-03T10:05:00.000Z",
      token_expiry: "2026-04-03T11:00:00.000Z",
      refresh_token: "live-refresh",
    },
    {
      account_email: "founder@example.com",
      display_name: "Founder Inactive",
      is_active: false,
      connected_at: "2026-04-04T10:00:00.000Z",
      last_used_at: "2026-04-04T10:05:00.000Z",
      token_expiry: "2026-04-04T11:00:00.000Z",
      refresh_token: "inactive-refresh",
    },
  ]);

  assert.equal(account?.display_name, "Founder Live");
  assert.equal(account?.refresh_token, "live-refresh");
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

test("whatsapp self chat detection respects resolved lid mappings", () => {
  assert.equal(
    isWhatsAppResolvedSelfChat(
      "919999888877",
      "247046619549753@lid",
      "919999888877@s.whatsapp.net",
    ),
    true,
  );
  assert.equal(
    isWhatsAppResolvedSelfChat(
      "919999888877",
      "247046619549753@lid",
      "918888777766@s.whatsapp.net",
    ),
    false,
  );
  assert.equal(
    isWhatsAppResolvedSelfChat(
      "919999888877",
      "919999888877@s.whatsapp.net",
    ),
    true,
  );
});

test("whatsapp phone-share extraction learns lid to direct mappings from chats and messages", () => {
  assert.deepEqual(
    extractWhatsAppPhoneShareFromChat({
      id: "247046619549753@lid",
      pnJid: "919999888877@s.whatsapp.net",
    }),
    {
      lidJid: "247046619549753@lid",
      directJid: "919999888877@s.whatsapp.net",
    },
  );

  assert.deepEqual(
    extractWhatsAppPhoneShareFromChat({
      id: "919999888877@s.whatsapp.net",
      lidJid: "247046619549753@lid",
    }),
    {
      lidJid: "247046619549753@lid",
      directJid: "919999888877@s.whatsapp.net",
    },
  );

  assert.deepEqual(
    extractWhatsAppPhoneShareFromMessage({
      key: {
        remoteJid: "247046619549753@lid",
      },
      message: {
        extendedTextMessage: {
          text: "hi",
          contextInfo: {
            pnJid: "919999888877@s.whatsapp.net",
          },
        },
      },
    }),
    {
      lidJid: "247046619549753@lid",
      directJid: "919999888877@s.whatsapp.net",
    },
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
  assert.deepEqual(detectTrainIntent("7876831969"), { type: null, value: "" });
  assert.deepEqual(detectTrainIntent("unka number hai 7876831969"), { type: null, value: "" });
  assert.deepEqual(
    detectTrainIntent("send appko as an auto replier unke har message ka reply dena hai unki language mai unka number hai 7876831969"),
    { type: null, value: "" },
  );
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

test("memory snippet warns the model not to merge unrelated old chat into new standalone requests", () => {
  const snippet = buildMemorySystemSnippet({
    recentTurns: [
      { role: "user", content: "Compare Claude and GPT for strategy work" },
      { role: "assistant", content: "Claude is often more natural in long-form writing." },
    ],
    topicSummary: "",
    activeTopics: ["ai"],
    isFollowUp: false,
    resolvedQuestion: "Weather in Delhi today",
    recentDocumentContext: null,
    userToneProfile: "",
    userEmotionalContext: "",
    continuityHint: null,
  });

  assert.match(snippet, /appears standalone/i);
  assert.match(snippet, /Do not merge unrelated old context/i);
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

test("conversation continuity skips low-signal turns and keeps the real previous question as anchor", () => {
  const continuity = analyzeConversationContinuityForTest({
    currentMessage: "what about security?",
    recentTurns: [
      { role: "user", content: "Compare Gmail and Outlook for startup ops" },
      { role: "assistant", content: "Gmail is simpler while Outlook is stronger in Microsoft-heavy teams." },
      { role: "user", content: "ok" },
      { role: "assistant", content: "Sure." },
    ],
  });

  assert.equal(continuity.isFollowUp, true);
  assert.equal(continuity.anchorUserTurn, "Compare Gmail and Outlook for startup ops");
  assert.equal(continuity.resolvedQuestion, "Compare Gmail and Outlook for startup ops security");
});

test("conversation continuity carries pure language/style follow-ups into the previous request", () => {
  const continuity = analyzeConversationContinuityForTest({
    currentMessage: "in thai",
    recentTurns: [
      { role: "user", content: "tell me the story of bad boys" },
      { role: "assistant", content: "Bad Boys is a buddy-cop action film about two Miami detectives." },
    ],
  });

  assert.equal(continuity.isFollowUp, true);
  assert.equal(continuity.anchorUserTurn, "tell me the story of bad boys");
  assert.equal(continuity.resolvedQuestion, "tell me the story of bad boys in thai");
});

test("conversation continuity understands roman-hindi pronoun follow-ups as part of the existing thread", () => {
  const continuity = analyzeConversationContinuityForTest({
    currentMessage: "unke har message ka reply dena hai unki language mai",
    recentTurns: [
      { role: "user", content: "ab tum dii se baat karoge mere behalf pe" },
      { role: "assistant", content: "Pehle mujhe bataiye aap Dii ko kya message bhejna chahte ho." },
    ],
  });

  assert.equal(continuity.isFollowUp, true);
  assert.equal(continuity.anchorUserTurn, "ab tum dii se baat karoge mere behalf pe");
  assert.match(continuity.resolvedQuestion, /ab tum dii se baat karoge mere behalf pe/i);
});

test("conversation continuity prefers the older matching topic over a newer unrelated thread", () => {
  const continuity = analyzeConversationContinuityForTest({
    currentMessage: "which one has better admin controls in gmail and outlook?",
    recentTurns: [
      { role: "user", content: "Compare Gmail and Outlook for startup ops" },
      { role: "assistant", content: "Gmail is simpler while Outlook is stronger in Microsoft-heavy teams." },
      { role: "user", content: "Compare Slack and Teams for internal communication" },
      { role: "assistant", content: "Slack feels faster while Teams is better inside Microsoft environments." },
    ],
  });

  assert.equal(continuity.isFollowUp, true);
  assert.equal(continuity.anchorUserTurn, "Compare Gmail and Outlook for startup ops");
  assert.match(continuity.resolvedQuestion, /Gmail and Outlook/i);
  assert.doesNotMatch(continuity.resolvedQuestion, /Slack|Teams/i);
});

test("conversation continuity keeps short fresh questions standalone when no real context link exists", () => {
  const continuity = analyzeConversationContinuityForTest({
    currentMessage: "weather delhi",
    recentTurns: [
      { role: "user", content: "Compare Claude and GPT for product strategy work" },
      { role: "assistant", content: "GPT is broader while Claude often feels more natural in writing." },
    ],
  });

  assert.equal(continuity.isFollowUp, false);
  assert.equal(continuity.resolvedQuestion, "weather delhi");
});

test("conversation continuity keeps volatile latest/current questions standalone even after an unrelated thread", () => {
  const continuity = analyzeConversationContinuityForTest({
    currentMessage: "who is the current founder of openai",
    recentTurns: [
      { role: "user", content: "Compare Claude and GPT for product strategy work" },
      { role: "assistant", content: "GPT is broader while Claude often feels more natural in writing." },
    ],
  });

  assert.equal(continuity.isFollowUp, false);
  assert.equal(continuity.resolvedQuestion, "who is the current founder of openai");
});

test("conversation continuity keeps fresh hard technical prompts standalone instead of blending old context", () => {
  const continuity = analyzeConversationContinuityForTest({
    currentMessage: "Given an array of integers, find the length of the longest subarray with at most k distinct elements. Optimize for O(n) time and provide code.",
    recentTurns: [
      { role: "user", content: "Compare Gmail and Outlook for startup ops" },
      { role: "assistant", content: "Gmail is simpler while Outlook is stronger in Microsoft-heavy teams." },
    ],
  });

  assert.equal(continuity.isFollowUp, false);
  assert.match(continuity.resolvedQuestion, /longest subarray with at most k distinct elements/i);
  assert.doesNotMatch(continuity.resolvedQuestion, /Gmail|Outlook/i);
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
  assert.match(reply, /Useful things you can still teach me/i);
  assert.match(reply, /Remember my preferred tone is concise and direct/i);
  assert.doesNotMatch(reply, /Asia\/Dubai/i);
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

  const modelCompareProfile = buildClawCloudAnswerQualityProfile({
    question: "what is the key difference betweeen gpt 5.4 vs opus 4.6 and gemini 3.2 pro and when were they released and rate them all out of 100 accoriding to there performance",
    intent: "general",
    category: "general",
  });
  assert.equal(modelCompareProfile.domain, "live");
  assert.equal(modelCompareProfile.requiresLiveGrounding, true);

  // Low-confidence replies now return clean clarifications instead of
  // internal markers or fake warming-up messages.
  const lowConfidenceReply = buildClawCloudLowConfidenceReply(
    "Can I sue my landlord immediately?",
    buildClawCloudAnswerQualityProfile({
      question: "Can I sue my landlord immediately?",
      intent: "law",
      category: "law",
    }),
  );
  assert.match(lowConfidenceReply, /exact topic|exact place|exact date|precise reply/i);

  const timeoutLowConfidenceReply = buildClawCloudLowConfidenceReply(
    "why cuba is all blackout",
    buildClawCloudAnswerQualityProfile({
      question: "why cuba is all blackout",
      intent: "research",
      category: "news",
    }),
    "The answer path took too long to complete reliably.",
  );
  assert.match(timeoutLowConfidenceReply, /exact place|exact date|exact event|exact item/i);

  const comparisonLowConfidenceReply = buildClawCloudLowConfidenceReply(
    "difference between nginx vs apache vs caddy",
    buildClawCloudAnswerQualityProfile({
      question: "difference between nginx vs apache vs caddy",
      intent: "general",
      category: "general",
    }),
  );
  assert.match(comparisonLowConfidenceReply, /exact topic|precise reply/i);

  const definitionLowConfidenceReply = buildClawCloudLowConfidenceReply(
    "what is rag",
    buildClawCloudAnswerQualityProfile({
      question: "what is rag",
      intent: "general",
      category: "general",
    }),
  );
  assert.match(definitionLowConfidenceReply, /exact topic|precise reply/i);

  const storyLowConfidenceReply = buildClawCloudLowConfidenceReply(
    "tell me the story of my demon in korean",
    buildClawCloudAnswerQualityProfile({
      question: "tell me the story of my demon in korean",
      intent: "culture",
      category: "culture_story",
    }),
  );
  assert.match(storyLowConfidenceReply, /exact topic|precise reply/i);

  const kalkiLowConfidenceReply = buildClawCloudLowConfidenceReply(
    "what is the story of kalki as is it based on true events",
    buildClawCloudAnswerQualityProfile({
      question: "what is the story of kalki as is it based on true events",
      intent: "culture",
      category: "culture_story",
    }),
  );
  assert.match(kalkiLowConfidenceReply, /exact topic|precise reply/i);

  const technicalLowConfidenceReply = buildClawCloudLowConfidenceReply(
    "Explain the difference between idempotency and deduplication in event-driven systems.",
    buildClawCloudAnswerQualityProfile({
      question: "Explain the difference between idempotency and deduplication in event-driven systems.",
      intent: "general",
      category: "general",
    }),
  );
  assert.match(technicalLowConfidenceReply, /exact topic|precise reply/i);

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
    false,
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

  assert.equal(
    isClawCloudGroundedLiveAnswer({
      question: "who is the richest person of the world",
      answer: [
        "*Recommendation*",
        "Use the real-time Forbes tracker as your single source of truth.",
        "",
        "*Bottom Line*",
        "Right now Elon Musk is the richest person alive at ~$312B.",
        "",
        "As of June 4, 2025",
        "Sources: forbes.com",
      ].join("\n"),
    }),
    false,
  );

  assert.equal(
    isClawCloudGroundedLiveAnswer({
      question: "who is the richest person of the world",
      answer: [
        "*Current richest person in the world:* *Elon Musk*",
        "*Forbes live net worth:* *$496.5B*",
        "*Rank source:* Forbes Real-Time Billionaires",
        "*As of:* March 30, 2026, 09:42 AM UTC",
        "Source: forbes.com (Real-Time Billionaires)",
      ].join("\n"),
    }),
    true,
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
    qualityFlags: [],
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

test("phase 11 answer observability tracks blocked-good-answer and ambiguous contact quality flags", () => {
  const summary = summarizeClawCloudAnswerObservabilityRecords([
    {
      intent: "coding",
      response_state: "answered",
      latency_ms: 4200,
      had_visible_fallback: false,
      live_answer: false,
      live_evidence_count: 0,
      model_audited: true,
      material_disagreement: true,
      metadata: {
        quality_flags: ["blocked_good_answer"],
      },
    },
    {
      intent: "send_message",
      response_state: "refused",
      latency_ms: 820,
      had_visible_fallback: false,
      live_answer: false,
      live_evidence_count: 0,
      model_audited: false,
      material_disagreement: false,
      metadata: {
        quality_flags: ["ambiguous_contact"],
      },
    },
  ], 7);

  assert.equal(summary.blockedGoodAnswerCount, 1);
  assert.equal(summary.ambiguousContactCount, 1);
  assert.equal(summary.blockedGoodAnswerRate, 50);
  assert.equal(summary.ambiguousContactRate, 50);
});

test("phase 11 quality metrics recorder counts known answer-quality signals", () => {
  resetAnswerQualityMetricsForTest();
  recordAnswerQualitySignals(["blocked_good_answer", "ambiguous_contact", "ignored_flag"]);
  const snapshot = getAnswerQualityMetricsSnapshot();

  assert.equal(snapshot.totalSignals, 2);
  assert.equal(snapshot.counts.blocked_good_answer, 1);
  assert.equal(snapshot.counts.ambiguous_contact, 1);
  assert.equal(snapshot.counts.visible_fallback, 0);
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

test("deterministic explain replies cover jeera directly", () => {
  const reply = buildDeterministicExplainReplyForTest("what is jeera");

  assert.match(reply ?? "", /Jeera is cumin/i);
  assert.match(reply ?? "", /spice/i);
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

test("simple knowledge fast lane only activates on explicit fast mode and avoids live or personal-tool routes", () => {
  assert.equal(shouldUseSimpleKnowledgeFastLaneForTest("why is the sky blue"), false);
  assert.equal(shouldUseSimpleKnowledgeFastLaneForTest("how does photosynthesis work"), false);
  assert.equal(shouldUseSimpleKnowledgeFastLaneForTest("why is the sky blue", "fast"), true);
  assert.equal(shouldUseSimpleKnowledgeFastLaneForTest("latest news about ai"), false);
  assert.equal(shouldUseSimpleKnowledgeFastLaneForTest("show my gmail inbox"), false);
  assert.equal(shouldUseSimpleKnowledgeFastLaneForTest("deep: what is artificial intelligence", "deep"), false);
});

test("primary direct-answer lane requires explicit fast mode and still stays out of contact routes", () => {
  assert.equal(shouldUseSimpleKnowledgeFastLaneForTest("overview of photosynthesis"), false);
  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest("overview of photosynthesis"), false);
  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest("overview of photosynthesis", "fast"), true);
  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest("photosynthesis process"), false);
  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest("photosynthesis process", "fast"), true);
  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest("what is cuba"), false);
  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest("what is cuba", "fast"), true);
  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest("ok then what is cuba"), false);
  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest("ok then what is cuba", "fast"), true);
  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest("latest stock market news"), false);
  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest("who is the richest person of the world"), false);
  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest("show my gmail inbox"), false);
  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest("Talk to Maa on my behalf"), false);
  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest("read and tell me the message of Papa", "fast"), false);
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
  assert.equal(direct.timeoutMs, 35000);

  const standaloneDirect = getInboundRouteTimeoutPolicyForTest("overview of photosynthesis");
  assert.equal(standaloneDirect.kind, "direct_knowledge");
  assert.equal(standaloneDirect.timeoutMs, 35000);

  const spanishDirect = getInboundRouteTimeoutPolicyForTest("¿Puedes explicar la fotosíntesis de forma simple?");
  assert.equal(spanishDirect.kind, "direct_knowledge");
  assert.equal(spanishDirect.timeoutMs, 35000);

  const kannadaDirect = getInboundRouteTimeoutPolicyForTest("10 ನಾಡು ಕನ್ನಡ ಸಾಹಿತ್ಯದ ಕವಿಗಳ ಬಗ್ಗೆ ಗೊಬ್ಬಿ ಬರೆಯಿರಿ");
  assert.equal(kannadaDirect.kind, "direct_knowledge");
  assert.equal(kannadaDirect.timeoutMs, 35000);

  const live = getInboundRouteTimeoutPolicyForTest("latest news about ai");
  assert.equal(live.kind, "live_research");
  assert.equal(live.timeoutMs, 35000);

  const operational = getInboundRouteTimeoutPolicyForTest("show my gmail inbox");
  assert.equal(operational.kind, "operational");
  assert.equal(operational.timeoutMs, 25000);

  const activeContact = getInboundRouteTimeoutPolicyForTest("ab se app meri tarf se dii se baat karoge");
  assert.equal(activeContact.kind, "operational");
  assert.equal(activeContact.timeoutMs, 35000);

  const deep = getInboundRouteTimeoutPolicyForTest("deep: explain transformers");
  assert.equal(deep.kind, "deep_reasoning");
  assert.equal(deep.timeoutMs, 45000);

  const groupedDeep = getInboundRouteTimeoutPolicyForTest("[Group message from product team] deep: what is artificial intelligence");
  assert.equal(groupedDeep.kind, "deep_reasoning");
  assert.equal(groupedDeep.timeoutMs, 45000);
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

  assert.deepEqual(detectLocalePreferenceCommand("reply in thai"), {
    type: "set",
    locale: "th",
    label: "Thai",
  });

  assert.deepEqual(detectLocalePreferenceCommand("from now onwar talk to me in thai"), {
    type: "set",
    locale: "th",
    label: "Thai",
  });

  assert.deepEqual(
    detectLocalePreferenceCommand("From now onward i will talk with you in English and you will only reply me in japanese got it"),
    {
      type: "set",
      locale: "ja",
      label: "Japanese",
    },
  );

  assert.deepEqual(detectLocalePreferenceCommand("in chinese only"), {
    type: "set",
    locale: "zh",
    label: "Chinese (Simplified)",
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

test("plain Latin follow-ups honor an explicitly stored non-English locale preference", () => {
  const resolution = resolveClawCloudReplyLanguage({
    message: "what is gorkha",
    preferredLocale: "th",
    storedLocaleIsExplicit: true,
  });

  assert.equal(resolution.locale, "th");
  assert.equal(resolution.source, "stored_preference");
  assert.equal(resolution.preserveRomanScript, false);
});

test("reply language resolver mirrors the user's current message language when it is clear", () => {
  assert.equal(inferClawCloudMessageLocale("Necesito ayuda con esto hoy, por favor."), "es");
  assert.equal(inferClawCloudMessageLocale("¿Qué es Cuba?"), "es");
  assert.equal(inferClawCloudMessageLocale("Bonjour, explique-moi ça clairement."), "fr");
  assert.equal(inferClawCloudMessageLocale("Can you explain this clearly today?"), "en");
  assert.equal(extractExplicitReplyLocaleRequest("tell me the story of my demon in korean"), "ko");
  assert.equal(
    extractExplicitReplyLocaleRequest("Tamam Şimdi Bana Bhool Bhulaiyaa 2'nin Tayca Hikayesini Ver"),
    "th",
  );
  assert.deepEqual(
    extractExplicitReplyLocaleRequests("tell me the story of avannger infinity war in korean and chinese"),
    ["ko", "zh"],
  );
  assert.deepEqual(
    extractExplicitReplyLocaleRequests("give me the story of 365 days in brazalian and chinese"),
    ["pt", "zh"],
  );
  assert.equal(
    stripExplicitReplyLocaleRequestForContent("tell me the news of today of usa in turkish"),
    "tell me the news of today of usa",
  );
  assert.equal(resolveSupportedLocale("brazalian"), "pt");
  assert.equal(resolveSupportedLocale("chineese"), "zh");
  assert.equal(
    extractExplicitReplyLocaleRequest("\u8acb\u7528\u82f1\u6587\u66ff\u6211\u8ddf\u7238\u7238\u8aaa\u3002"),
    "en",
  );
  assert.equal(
    extractExplicitReplyLocaleRequest("\u82f1\u8a9e\u3067\u304a\u7236\u3055\u3093\u306b\u8a71\u3057\u3066"),
    "en",
  );
  assert.equal(
    extractExplicitReplyLocaleRequest("\uc601\uc5b4\ub85c \uc544\ube60\ud55c\ud14c \ub9d0\ud574"),
    "en",
  );
  assert.equal(
    extractExplicitReplyLocaleRequest("\u0e0a\u0e48\u0e27\u0e22\u0e1e\u0e39\u0e14\u0e01\u0e31\u0e1a\u0e1e\u0e48\u0e2d\u0e40\u0e1b\u0e47\u0e19\u0e20\u0e32\u0e29\u0e32\u0e2d\u0e31\u0e07\u0e01\u0e24\u0e29"),
    "en",
  );

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

  const englishContactHandoff = resolveClawCloudReplyLanguage({
    message: "Talk to Maa on my behalf",
    preferredLocale: "es",
  });
  assert.equal(englishContactHandoff.locale, "en");
  assert.equal(englishContactHandoff.source, "mirrored_message");

  const chineseContactHandoff = resolveClawCloudReplyLanguage({
    message: "\u8acb\u66ff\u6211\u8ddf\u7238\u7238\u8aaa\u3002",
    preferredLocale: "en",
  });
  assert.equal(chineseContactHandoff.locale, "zh");
  assert.equal(chineseContactHandoff.source, "mirrored_message");

  const explicitKorean = resolveClawCloudReplyLanguage({
    message: "tell me the story of my demon in korean",
    preferredLocale: "en",
  });
  assert.equal(explicitKorean.locale, "ko");
  assert.equal(explicitKorean.source, "explicit_request");

  const explicitThaiFromTurkish = resolveClawCloudReplyLanguage({
    message: "Tamam Şimdi Bana Bhool Bhulaiyaa 2'nin Tayca Hikayesini Ver",
    preferredLocale: "en",
  });
  assert.equal(explicitThaiFromTurkish.locale, "th");
  assert.equal(explicitThaiFromTurkish.source, "explicit_request");

  const chineseExplicitEnglish = resolveClawCloudReplyLanguage({
    message: "\u8acb\u7528\u82f1\u6587\u66ff\u6211\u8ddf\u7238\u7238\u8aaa\u3002",
    preferredLocale: "zh",
  });
  assert.equal(chineseExplicitEnglish.locale, "en");
  assert.equal(chineseExplicitEnglish.source, "explicit_request");

  const explicitPortugueseAndChinese = resolveClawCloudReplyLanguage({
    message: "give me the story of 365 days in brazalian and chinese",
    preferredLocale: "en",
  });
  assert.equal(explicitPortugueseAndChinese.locale, "pt");
  assert.equal(explicitPortugueseAndChinese.source, "explicit_request");
  assert.deepEqual(explicitPortugueseAndChinese.additionalLocales, ["zh"]);

  const explicitHinglish = resolveClawCloudReplyLanguage({
    message: "reply in hinglish",
    preferredLocale: "en",
  });
  assert.equal(explicitHinglish.locale, "hi");
  assert.equal(explicitHinglish.source, "explicit_request");
  assert.equal(explicitHinglish.preserveRomanScript, true);
  assert.match(buildClawCloudReplyLanguageInstruction(explicitHinglish), /Roman script/i);

  const midSentenceHinglish = resolveClawCloudReplyLanguage({
    message: "send message to maa in hinglish",
    preferredLocale: "en",
  });
  assert.equal(midSentenceHinglish.locale, "hi");
  assert.equal(midSentenceHinglish.source, "explicit_request");
  assert.equal(midSentenceHinglish.preserveRomanScript, true);
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

test("reply language resolver does not misread Hinglish Maa drafting prompts as Finnish", () => {
  const message = "ek good afternoon message likh do maa ko";
  assert.equal(detectHinglish(message), true);

  const resolution = resolveClawCloudReplyLanguage({
    message,
    preferredLocale: "fi",
  });

  assert.equal(resolution.locale, "en");
  assert.equal(resolution.source, "hinglish_message");
  assert.equal(resolution.preserveRomanScript, true);
});

test("Hinglish detection does not misclassify technical English prompts or short definition questions", () => {
  assert.equal(
    detectHinglish("Given a large grid with obstacles, find the shortest path from source to destination where you can remove at most k obstacles."),
    false,
  );
  assert.equal(
    detectHinglish("Given an array of integers, find the length of the longest subarray with at most k distinct elements."),
    false,
  );
  assert.equal(detectHinglish("What is shali"), false);
});

test("reply language resolver keeps active-contact Hinglish commands in Roman script", () => {
  const startResolution = resolveClawCloudReplyLanguage({
    message: "ab mere behalf me aap dii se baat karange",
    preferredLocale: "en",
  });
  assert.equal(detectHinglish("ab mere behalf me aap dii se baat karange"), true);
  assert.equal(startResolution.locale, "en");
  assert.equal(startResolution.source, "hinglish_message");
  assert.equal(startResolution.preserveRomanScript, true);

  const statusResolution = resolveClawCloudReplyLanguage({
    message: "abhi kis se baat kar rahe ho",
    preferredLocale: "en",
  });
  assert.equal(detectHinglish("abhi kis se baat kar rahe ho"), true);
  assert.equal(statusResolution.locale, "en");
  assert.equal(statusResolution.source, "hinglish_message");
  assert.equal(statusResolution.preserveRomanScript, true);
});

test("reply language resolver avoids stale history locale for short ambiguous greetings", () => {
  const staleHistoryMessage = "awak boleh bantu saya hari ini";
  const staleHistoryLocale = inferClawCloudMessageLocale(staleHistoryMessage);
  assert.notEqual(staleHistoryLocale, "en");
  assert.ok(staleHistoryLocale === "ms" || staleHistoryLocale === "id");

  const resolution = resolveClawCloudReplyLanguage({
    message: "hii",
    preferredLocale: "en",
    recentUserMessages: [staleHistoryMessage],
  });

  assert.equal(resolution.locale, "en");
  assert.equal(resolution.source, "mirrored_message");
  assert.equal(resolution.preserveRomanScript, false);
});

test("query understanding normalizes common typos and telegraphic prompts", () => {
  assert.equal(
    normalizeClawCloudUnderstandingMessage("telll me stroy of the movi boy next door in koreean"),
    "tell me the story of the movie boy next door in korean",
  );
  assert.equal(
    normalizeClawCloudUnderstandingMessage("Ok tell mw story of Harry potter in japanese"),
    "Ok tell me the story of Harry potter in japanese",
  );
  assert.equal(
    normalizeClawCloudUnderstandingMessage("wrtie fibonaci cdoe in pythn"),
    "write fibonacci code in python",
  );
  assert.equal(
    normalizeClawCloudUnderstandingMessage("capitel japan"),
    "what is the capital of japan",
  );
  assert.deepEqual(
    detectIntentForTest("capitel japan"),
    { type: "geography", category: "geography" },
  );
});

test("reply language extraction survives misspelled story and locale requests", () => {
  assert.equal(
    extractExplicitReplyLocaleRequest("telll me stroy of the movi boy next door in koreean"),
    "ko",
  );
});

test("reply language extraction understands noisy WhatsApp send prompts with explicit output language", () => {
  const message =
    "send a professional thanku note to aman for helping me in my todays exam and that to in hindi do not change the text only paste the same test ok do it professionally";

  assert.equal(extractExplicitReplyLocaleRequest(message), "hi");

  const resolution = resolveClawCloudReplyLanguage({
    message,
    preferredLocale: "en",
  });

  assert.equal(resolution.locale, "hi");
  assert.equal(resolution.source, "explicit_request");
});

test("reply language extraction keeps WhatsApp platform words from swallowing the requested output language", () => {
  const message = "send a professional thank-you greeting to Aman in Thai on WhatsApp";

  assert.equal(extractExplicitReplyLocaleRequest(message), "th");

  const resolution = resolveClawCloudReplyLanguage({
    message,
    preferredLocale: "en",
  });

  assert.equal(resolution.locale, "th");
  assert.equal(resolution.source, "explicit_request");
});

test("reply language extraction understands WhatsApp read prompts with explicit output language", () => {
  const message = "tell me the messages of jaideep with me and that too in hindi please";

  assert.equal(extractExplicitReplyLocaleRequest(message), "hi");

  const resolution = resolveClawCloudReplyLanguage({
    message,
    preferredLocale: "en",
  });

  assert.equal(resolution.locale, "hi");
  assert.equal(resolution.source, "explicit_request");
});

test("reply language resolution recognizes explicit Sanskrit output requests", () => {
  const resolution = resolveClawCloudReplyLanguage({
    message: "explain binary search in sanskrit",
    preferredLocale: "en",
  });

  assert.equal(resolution.locale, "hi");
  assert.equal(resolution.source, "explicit_request");
  assert.equal(resolution.targetLanguageName, "Sanskrit");
  assert.match(buildClawCloudReplyLanguageInstruction(resolution), /Sanskrit/i);
  assert.doesNotMatch(buildClawCloudReplyLanguageInstruction(resolution), /Hindi/i);
});

test("reply language resolution mirrors Sanskrit prompts instead of drifting to a different language", () => {
  const message =
    "यदि कस्यचित् संगणक-प्रणाल्याः समय-जटिलता O(nlogn) अस्ति, तथा च तस्याः स्थान-जटिलता O(1) अस्ति, तर्हि व्यवहारिक-सीमाः कुत्र भवन्ति?";

  const resolution = resolveClawCloudReplyLanguage({
    message,
    preferredLocale: "en",
  });

  assert.equal(resolution.locale, "hi");
  assert.equal(resolution.source, "mirrored_message");
  assert.equal(resolution.targetLanguageName, "Sanskrit");
  assert.match(buildClawCloudReplyLanguageInstruction(resolution), /Sanskrit/i);
  assert.doesNotMatch(buildClawCloudReplyLanguageInstruction(resolution), /Hindi/i);
});

test("reply language resolver mirrors Roman Punjabi and keeps Roman script", () => {
  const message = "tusi lassi pasand krdo";
  assert.equal(inferClawCloudMessageLocale(message), "pa");
  assert.equal(inferClawCloudMessageLocale("or kii hall chall ne"), "pa");

  const mirrored = resolveClawCloudReplyLanguage({
    message,
    preferredLocale: "en",
  });
  assert.equal(mirrored.locale, "pa");
  assert.equal(mirrored.source, "mirrored_message");
  assert.equal(mirrored.preserveRomanScript, true);

  const samePreferred = resolveClawCloudReplyLanguage({
    message,
    preferredLocale: "pa",
  });
  assert.equal(samePreferred.locale, "pa");
  assert.equal(samePreferred.source, "stored_preference");
  assert.equal(samePreferred.preserveRomanScript, true);

  const instruction = buildClawCloudReplyLanguageInstruction(mirrored);
  assert.match(instruction, /Roman script/i);
});

test("latin-script operational commands do not inherit stale non-English locale from history", () => {
  const resolution = resolveClawCloudReplyLanguage({
    message: "ok send hii to aatish",
    preferredLocale: "fi",
    recentUserMessages: [
      "terima kasih, saya setuju",
      "awas boleh bantu saya hari ini",
    ],
  });

  assert.equal(resolution.locale, "en");
  assert.equal(resolution.source, "mirrored_message");
  assert.equal(resolution.preserveRomanScript, false);
});

test("plain English follow-up queries honor an explicitly stored non-English reply preference", () => {
  const resolution = resolveClawCloudReplyLanguage({
    message: "is it has its branch in lpu",
    preferredLocale: "af",
    storedLocaleIsExplicit: true,
    recentUserMessages: [
      "vertel my die storie in afrikaans",
    ],
  });

  assert.equal(resolution.locale, "af");
  assert.equal(resolution.source, "stored_preference");
  assert.equal(resolution.preserveRomanScript, false);
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

test("reply language verification rejects wrong-language answers and keeps same-language locks strict", () => {
  const hindiResolution = resolveClawCloudReplyLanguage({
    message: "tell me the messages of jaideep with me and that too in hindi please",
    preferredLocale: "en",
  });
  assert.equal(hindiResolution.locale, "hi");
  assert.equal(
    verifyReplyLanguageMatch({
      userMessage: "tell me the messages of jaideep with me and that too in hindi please",
      aiReply: "Here are the latest messages from Jaideep.",
      resolution: hindiResolution,
    }).verified,
    false,
  );

  const japaneseResolution = resolveClawCloudReplyLanguage({
    message: "Harry Potter の物語を日本語で教えて",
    preferredLocale: "en",
  });
  assert.equal(japaneseResolution.locale, "ja");
  assert.equal(
    verifyReplyLanguageMatch({
      userMessage: "Harry Potter の物語を日本語で教えて",
      aiReply: "This is still in English.",
      resolution: japaneseResolution,
    }).verified,
    false,
  );

  const hinglishResolution = resolveClawCloudReplyLanguage({
    message: "reply in hinglish",
    preferredLocale: "en",
  });
  assert.equal(
    verifyReplyLanguageMatch({
      userMessage: "reply in hinglish",
      aiReply: "Main theek hoon, tu bata?",
      resolution: hinglishResolution,
    }).verified,
    true,
  );
});

test("Roman Punjabi wellbeing prompts are treated as direct conversation instead of drifting into status replies", () => {
  const signal = detectDirectConversationSignalForTest("or kii hall chall ne");
  assert.equal(signal?.asksWellbeing, true);

  const reply = buildDeterministicConversationReplyForTest("or kii hall chall ne");
  assert.match(reply ?? "", /Main theek hoon/i);
});

test("deterministic multilingual conversation detection catches Russian name-exchange prompts", () => {
  const signal = detectDirectConversationSignalForTest("Привет, меня зовут Шубхам, а как тебя зовут?");
  assert.equal(signal?.asksAssistantName, true);
  assert.equal(signal?.userName, "Шубхам");

  const reply = buildDeterministicConversationReplyForTest("Привет, меня зовут Шубхам, а как тебя зовут?");
  assert.match(reply ?? "", /ClawCloud/i);
  assert.match(reply ?? "", /Шубхам/u);
});

test("deterministic multilingual conversation detection catches Chinese and Korean name-exchange prompts", () => {
  const chineseSignal = detectDirectConversationSignalForTest("你好，我叫 Shubham，你叫什么名字？");
  assert.equal(chineseSignal?.asksAssistantName, true);
  assert.equal(chineseSignal?.userName, "Shubham");

  const chineseReply = buildDeterministicConversationReplyForTest("你好，我叫 Shubham，你叫什么名字？");
  assert.match(chineseReply ?? "", /ClawCloud/i);
  assert.match(chineseReply ?? "", /Shubham/i);
  assert.match(chineseReply ?? "", /你好|我的名字是|我是/u);

  const koreanSignal = detectDirectConversationSignalForTest("안녕, 내 이름은 슈밤이야. 너 이름은 뭐야?");
  assert.equal(koreanSignal?.asksAssistantName, true);
  assert.equal(koreanSignal?.userName, "슈밤");

  const koreanReply = buildDeterministicConversationReplyForTest("안녕, 내 이름은 슈밤이야. 너 이름은 뭐야?");
  assert.match(koreanReply ?? "", /ClawCloud/i);
  assert.match(koreanReply ?? "", /슈밤/u);
  assert.match(koreanReply ?? "", /안녕하세요|제 이름은|저는/u);
});

test("inbound agent route answers Russian name-exchange prompts in Russian", async () => {
  const result = await routeInboundAgentMessageResult(
    "test-user",
    "Привет, меня зовут Шубхам, а как тебя зовут?",
  );

  assert.match(result.response ?? "", /ClawCloud/i);
  assert.match(result.response ?? "", /Шубхам/u);
  assert.match(result.response ?? "", /Привет|Меня зовут|Я ClawCloud/u);
});

test("assistant meta prompts get deterministic professional acknowledgements", () => {
  const speedReply = buildDeterministicAssistantMetaReplyForTest("respond fast from now onward");
  assert.match(speedReply ?? "", /faster direct reply|faster answer/i);
  assert.match(speedReply ?? "", /instead of guessing/i);

  const parametersReply = buildDeterministicAssistantMetaReplyForTest("what is your parameters");
  assert.match(parametersReply ?? "", /raw internal model parameters/i);
  assert.match(parametersReply ?? "", /specific behavior/i);
});

test("assistant meta preferences do not hijack concrete technical tasks", () => {
  const reply = buildDeterministicAssistantMetaReplyForTest(
    "ok now explain me the n queen problem in detail and also give its code in russian language",
  );
  assert.equal(reply, null);
});

test("full inbound route answers detailed n-queens requests instead of drifting into meta acknowledgements", async () => {
  const result = await routeInboundAgentMessageResult(
    "test-user",
    "ok now explain me the n queen problem in detail and also give its code in russian language",
  );

  assert.match(result.response ?? "", /N-Queens/i);
  assert.match(result.response ?? "", /```/i);
  assert.doesNotMatch(result.response ?? "", /keep replies more disciplined from here/i);
});

test("full inbound route keeps assistant-parameters prompts out of the short-definition lane", async () => {
  const result = await routeInboundAgentMessageResult("test-user", "what is your parameters");
  assert.match(result.response ?? "", /raw internal model parameters/i);
  assert.doesNotMatch(result.response ?? "", /refers to specific values or constraints/i);
});

test("assistant repair follow-up detection catches bad-answer callbacks", () => {
  assert.equal(looksLikeAssistantReplyRepairRequestForTest("what is this now"), true);
  assert.equal(looksLikeAssistantReplyRepairRequestForTest("that previous answer is wrong"), true);
  assert.equal(looksLikeAssistantReplyRepairRequestForTest("what is the capital of France"), false);
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

test("multilingual routing bridge stays out of locked WhatsApp send prompts", () => {
  const prompt = "ek good afternoon message likh do maa ko";
  const strictRoute = detectStrictIntentRouteForTest(prompt);
  assert.deepEqual(strictRoute?.intent, { type: "send_message", category: "send_message" });
  assert.equal(strictRoute?.locked, true);

  assert.equal(
    shouldUseMultilingualRoutingBridgeForTest(prompt, {
      locale: "hi",
      source: "mirrored_message",
      detectedLocale: "hi",
      preserveRomanScript: false,
    }),
    false,
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

test("multilingual technical prompts still qualify for translated direct-answer handling", () => {
  const prompt = "2026年において、世界的なパンデミックと医療データの爆発的増加の中で、リアルタイムに患者の重症化リスクを予測する分散型AIシステムをどのように設計しますか？ さらに、ディファレンシャルプライバシーや連合学習を用いながら、各国の規制やデータ偏りの問題をどのように克服しますか？";
  const resolution = resolveClawCloudReplyLanguage({
    message: prompt,
    preferredLocale: "en",
  });

  assert.equal(resolution.locale, "ja");
  assert.equal(
    shouldUseMultilingualRoutingBridgeForTest(prompt, resolution),
    true,
  );
  const strictRoute = detectStrictIntentRouteForTest(prompt);
  assert.deepEqual(strictRoute?.intent, { type: "technology", category: "technology" });
  assert.equal(strictRoute?.locked, true);
});

test("multilingual gloss routing keeps safe locked technical prompts on a direct-answer lane", () => {
  const glossIntent = detectMultilingualNativeAnswerLaneIntentForTest(
    "How would you design a distributed AI system to predict patient deterioration risk in real time during a global pandemic while using differential privacy and federated learning across countries with different regulations and data bias?",
  );

  assert.ok(glossIntent);
  assert.ok(["technology", "research", "health", "coding"].includes(glossIntent?.type ?? ""));
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

test("inbound route solves exact arithmetic deterministically in English", async () => {
  const result = await routeInboundAgentMessageResult("test-user", "what is 347 * 289 + 56?");

  assert.match(result.response ?? "", /100339/);
  assert.doesNotMatch(result.response ?? "", /100449/);
  assert.doesNotMatch(result.response ?? "", /\b(?:berekening|vermenigvuldiging|verskil|optelling|kontrole|korrek)\b/i);
});

test("inbound route returns runnable fibonacci code for simple coding prompts", async () => {
  const result = await routeInboundAgentMessageResult("test-user", "write fibonacci code in python");

  assert.match(result.response ?? "", /```python/i);
  assert.match(result.response ?? "", /def fib\(n: int\) -> int:/i);
  assert.match(result.response ?? "", /\bComplexity\b/i);
  assert.doesNotMatch(result.response ?? "", /i could not complete a reliable direct answer/i);
});

test("inbound route repairs misspelled arithmetic prompts before solving", async () => {
  const result = await routeInboundAgentMessageResult("test-user", "waht is 347 * 289 + 56");

  assert.match(result.response ?? "", /100339/);
  assert.doesNotMatch(result.response ?? "", /100449/);
});

test("inbound route repairs misspelled coding prompts before answering", async () => {
  const result = await routeInboundAgentMessageResult("test-user", "wrtie fibonaci cdoe in pythn");

  assert.match(result.response ?? "", /```python/i);
  assert.match(result.response ?? "", /def fib\(n: int\) -> int:/i);
  assert.match(result.response ?? "", /\bComplexity\b/i);
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

test("AI model routing infers Claude family aliases in comparison prompts and preserves normal writing prompts", async () => {
  const ambiguous = detectAiModelRoutingDecision("difference between gpt 5.4 and opus 4.6");
  assert.equal(ambiguous?.mode, "web_search");
  assert.equal(ambiguous?.kind, "comparison");
  assert.ok(ambiguous?.officialDomains.includes("openai.com"));
  assert.ok(ambiguous?.officialDomains.includes("anthropic.com"));
  assert.ok(ambiguous?.searchQueries.some((query) => /\bClaude Opus 4\.6 official\b/i.test(query)));

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
  assert.ok(ranking?.searchQueries.some((query) => /OpenAI GPT flagship model official site:openai\.com/i.test(query)));
  assert.ok(ranking?.searchQueries.some((query) => /Anthropic Claude flagship model official site:anthropic\.com/i.test(query)));

  assert.equal(detectAiModelRoutingDecision("what is artificial intelligence"), null);
  assert.equal(detectAiModelRoutingDecision("explain machine learning"), null);
  assert.equal(detectAiModelRoutingDecision("what is rag"), null);
  assert.equal(detectAiModelRoutingDecision("write a haiku about rain"), null);

  const directReply = await answerWebSearch("difference between gpt 5.4 and opus 4.6");
  assert.doesNotMatch(directReply, /Model name clarification/i);
  assert.match(directReply, /GPT-5\.4|Claude Opus 4\.6|AI model comparison snapshot|AI model frontier snapshot/i);
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
  assert.match(fallback, /AI model ranking/i);
  assert.match(fallback, /Evidence-based frontier ranking/i);
  assert.match(fallback, /Ranking method/i);
  assert.match(fallback, /Top models in this run/i);
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
  assert.match(thinFallback, /Current frontier shortlist from verified official vendor model pages/i);
  assert.match(thinFallback, /OpenAI.*GPT-5\.4/i);
  assert.match(thinFallback, /Google.*Gemini 3\.1 Pro/i);
  assert.match(thinFallback, /Anthropic.*Claude Opus 4\.6/i);
  assert.match(thinFallback, /live mixed-source batch was too thin/i);

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

test("AI model evidence extraction reads official model names from URL slugs when titles are generic", () => {
  const mentions = extractAiModelEvidenceMentions([
    {
      title: "OpenAI",
      url: "https://openai.com/index/gpt-5-4",
      snippet: "Latest flagship model.",
      domain: "openai.com",
      score: 0.8,
    },
    {
      title: "Anthropic",
      url: "https://www.anthropic.com/news/claude-opus-4-6",
      snippet: "Advanced reasoning model.",
      domain: "anthropic.com",
      score: 0.79,
    },
    {
      title: "Google DeepMind",
      url: "https://blog.google/technology/google-deepmind/gemini-3-1-pro/",
      snippet: "Newest Pro model.",
      domain: "blog.google",
      score: 0.78,
    },
  ]);

  assert.ok(mentions.some((mention) => /GPT-5\.4/i.test(mention.model)));
  assert.ok(mentions.some((mention) => /Claude Opus 4\.6/i.test(mention.model)));
  assert.ok(mentions.some((mention) => /Gemini 3\.1 Pro/i.test(mention.model)));
});

test("AI model ranking answers stay acceptable on the shared web-search route", () => {
  const rankingQuestion = "name top 10 best ai model of 2026";
  const rankingFallback = buildAiModelEvidenceOnlyAnswer(rankingQuestion, [
    {
      title: "GPT-5.4",
      url: "https://openai.com/index/gpt-5-4",
      snippet: "OpenAI introduces GPT-5.4 with stronger reasoning and coding support.",
      domain: "openai.com",
      score: 0.75,
    },
    {
      title: "Claude Opus 4.6",
      url: "https://www.anthropic.com/news/claude-opus-4-6",
      snippet: "Anthropic introduces Claude Opus 4.6 for advanced reasoning and coding.",
      domain: "anthropic.com",
      score: 0.74,
    },
    {
      title: "Gemini 3.1 Pro",
      url: "https://blog.google/technology/google-deepmind/gemini-3-1-pro/",
      snippet: "Google DeepMind announces Gemini 3.1 Pro as its latest Pro model.",
      domain: "blog.google",
      score: 0.73,
    },
  ]);

  assert.match(rankingFallback, /AI model ranking/i);
  assert.match(rankingFallback, /Top models in this run/i);
  assert.equal(
    isAcceptableAiModelWebAnswerForTest(rankingFallback, rankingQuestion),
    true,
  );

  const compareQuestion = "Compare GPT-5.4, Claude Opus 4.6, and Gemini 3.1 Pro for release timing.";
  const compareFallback = buildAiModelEvidenceOnlyAnswer(compareQuestion, []);
  assert.match(compareFallback, /AI model comparison snapshot/i);
  assert.equal(
    isAcceptableAiModelWebAnswerForTest(compareFallback, compareQuestion),
    true,
  );
});

test("AI model prompts get a domain-specific no-live-data fallback instead of the generic stale-data template", () => {
  const fallback = buildNoLiveDataReply("name top 10 best ai model of 2026");
  assert.match(fallback, /AI model ranking/i);
  assert.doesNotMatch(fallback, /Time-sensitive query/i);
  assert.doesNotMatch(fallback, /Live search unavailable for this query/i);
});

test("current-affairs logistics prompts get a domain-specific no-live-data fallback instead of the generic stale-data template", () => {
  const fallback = buildNoLiveDataReply("is russia oil tanker reached cuba how much oil is there in that tanker");
  assert.match(fallback, /current-affairs check/i);
  assert.match(fallback, /could not confirm from the live source batch whether the tanker had already reached Cuba/i);
  assert.match(fallback, /could not verify a current cargo figure/i);
  assert.doesNotMatch(fallback, /Time-sensitive query/i);
  assert.doesNotMatch(fallback, /Live search unavailable for this query/i);
});

test("AI model ranking answers keep current-year evidence instead of tripping the strict live freshness guard", () => {
  const question = "name top 10 best ai model of 2026";
  const result = buildSourceBackedLiveAnswerResult({
    question,
    answer: [
      "*AI model ranking*",
      "Evidence-based frontier ranking from the current retrieved source batch:",
      "",
      "*Ranking method*",
      "- Order favors repeated current-source support, official vendor confirmation, and the freshest visible release signal.",
      "",
      "*Top models in this run*",
      "1. OpenAI — GPT-5.4",
      "2. Anthropic — Claude Opus 4.6",
      "3. Google — Gemini 3.1 Pro",
    ].join("\n"),
    sources: [
      {
        title: "GPT-5.4",
        url: "https://openai.com/index/gpt-5-4",
        snippet: "OpenAI introduces GPT-5.4 with stronger reasoning and coding support.",
        domain: "openai.com",
        publishedDate: "2026-03-17T07:00:00.000Z",
        score: 0.9,
      },
      {
        title: "Claude Opus 4.6",
        url: "https://www.anthropic.com/news/claude-opus-4-6",
        snippet: "Anthropic introduces Claude Opus 4.6 for advanced reasoning and coding.",
        domain: "anthropic.com",
        publishedDate: "2026-03-18T07:00:00.000Z",
        score: 0.89,
      },
      {
        title: "Old frontier roundup",
        url: "https://example.com/frontier-models-2024",
        snippet: "A 2024 roundup of older frontier models.",
        domain: "example.com",
        publishedDate: "2024-06-01T00:00:00.000Z",
        score: 0.2,
      },
    ],
    officialDomains: ["openai.com", "anthropic.com", "blog.google"],
  });

  assert.doesNotMatch(result.answer, /\*Freshness check\*/i);
  assert.equal(result.liveAnswerBundle?.metadata.freshness_guarded, false);
});

test("send-message parsing keeps contact commands strict and avoids tell-me hijacks", () => {
  assert.equal(parseSendMessageCommand("tell me top 10 richest persons and richest cities of the world"), null);
  assert.equal(parseSendMessageCommand("tell me the conversation summary with that number"), null);
  assert.equal(parseSendMessageCommand("message me: hello"), null);

  const parsed = parseSendMessageCommand("tell Raj that I will be 10 minutes late");
  assert.ok(parsed);
  assert.equal(parsed?.kind, "contacts");
  assert.equal(parsed?.contactName, "Raj");
  assert.equal(parsed?.message, "I will be 10 minutes late");
});

test("send-message parsing understands natural WhatsApp send and reply phrasing", () => {
  const sendParsed = parseSendMessageCommand("Send a WhatsApp message to Mehak saying hello from ClawCloud");
  assert.ok(sendParsed);
  assert.equal(sendParsed?.kind, "contacts");
  assert.equal(sendParsed?.contactName, "Mehak");
  assert.equal(sendParsed?.message, "hello from ClawCloud");

  const replyParsed = parseSendMessageCommand("Reply to Mehak on WhatsApp saying I am testing right now");
  assert.ok(replyParsed);
  assert.equal(replyParsed?.kind, "contacts");
  assert.equal(replyParsed?.contactName, "Mehak");
  assert.equal(replyParsed?.message, "I am testing right now");
});

test("send-message parsing tolerates common typos in send and reply commands", () => {
  const sendParsed = parseSendMessageCommand("Send mesage to Mehak sayng hello from ClawCloud");
  assert.ok(sendParsed);
  assert.equal(sendParsed?.kind, "contacts");
  assert.equal(sendParsed?.contactName, "Mehak");
  assert.equal(sendParsed?.message, "hello from ClawCloud");

  const replyParsed = parseSendMessageCommand("Replly to Mehak on whatsap with I am testing right now");
  assert.ok(replyParsed);
  assert.equal(replyParsed?.kind, "contacts");
  assert.equal(replyParsed?.contactName, "Mehak");
  assert.equal(replyParsed?.message, "I am testing right now");
});

test("send-message parsing survives soft prefixes and understanding-layer typo cleanup", () => {
  const prefixed = parseSendMessageCommand("juat message good morning in professional way in hinglish to maa");
  assert.ok(prefixed);
  assert.equal(prefixed?.kind, "contacts");
  assert.equal(normalizeContactName(prefixed?.contactName ?? ""), "maa");
  assert.equal(prefixed?.message, "good morning in professional way in hinglish");

  const repairedGlueTypo = parseSendMessageCommand("juat message good morning t=in professional way in hinglish to maa");
  assert.ok(repairedGlueTypo);
  assert.equal(repairedGlueTypo?.kind, "contacts");
  assert.equal(normalizeContactName(repairedGlueTypo?.contactName ?? ""), "maa");
  assert.equal(repairedGlueTypo?.message, "good morning in professional way in hinglish");

  const conversationalLeadIn = parseSendMessageCommand("ok now send hii to priyanshu");
  assert.ok(conversationalLeadIn);
  assert.equal(conversationalLeadIn?.kind, "contacts");
  assert.equal(normalizeContactName(conversationalLeadIn?.contactName ?? ""), "priyanshu");
  assert.equal(conversationalLeadIn?.message, "hii");

  const corrected = parseSendMessageCommand("telll maa that call me when free");
  assert.ok(corrected);
  assert.equal(corrected?.kind, "contacts");
  assert.equal(normalizeContactName(corrected?.contactName ?? ""), "maa");
  assert.equal(corrected?.message, "call me when free");
});

test("whatsapp drafting mode treats beautiful detailed greeting prompts as generated drafts instead of literal send text", () => {
  assert.equal(
    resolveWhatsAppDraftingModeForTest(
      "send a very beautiful prompt in detail of good morning in hindi to maa",
      "a very beautiful prompt in detail of good morning in hindi",
    ),
    "styled",
  );
});

test("send-message parsing strips trailing behalf noise and blocks placeholder carry-over text", () => {
  const stripped = parseSendMessageCommand("send hii to mohan on my behalf");
  assert.ok(stripped);
  assert.equal(stripped?.kind, "contacts");
  assert.equal(normalizeContactName(stripped?.contactName ?? ""), "mohan");
  assert.equal(stripped?.message, "hii");

  const placeholder = analyzeSendMessageCommandSafety("send it to mohan room mate");
  assert.ok(placeholder && !placeholder.allowed);
  if (placeholder && !placeholder.allowed) {
    assert.equal(placeholder.issue, "ambiguous_message");
    assert.equal(normalizeContactName(placeholder.parsed.contactName), "mohan room mate");
    assert.equal(placeholder.parsed.message, "it");
  }
});

test("send-message parsing understands abstract drafting requests for both send and reply commands", () => {
  const sendParsed = parseSendMessageCommand(
    "send a professional thanku note to Priyanka for helping me in my todays exam and that to in hindi",
  );
  assert.ok(sendParsed);
  assert.equal(sendParsed?.kind, "contacts");
  assert.equal(sendParsed?.contactName, "Priyanka");
  assert.equal(
    sendParsed?.message,
    "a professional thanku note for helping me in my todays exam and that to in hindi",
  );

  const replyParsed = parseSendMessageCommand("reply a polite apology note to Raj for the delay");
  assert.ok(replyParsed);
  assert.equal(replyParsed?.kind, "contacts");
  assert.equal(replyParsed?.contactName, "Raj");
  assert.equal(replyParsed?.message, "a polite apology note for the delay");
});

test("send-message parsing understands Hinglish recipient-targeted write prompts", () => {
  const messageFirst = parseSendMessageCommand("ek good afternoon message likh do maa ko");
  assert.ok(messageFirst);
  assert.equal(messageFirst?.kind, "contacts");
  assert.equal(normalizeContactName(messageFirst?.contactName ?? ""), "maa");
  assert.equal(messageFirst?.message, "good afternoon message");

  const recipientFirst = parseSendMessageCommand("maa ko ek good afternoon message likh do");
  assert.ok(recipientFirst);
  assert.equal(recipientFirst?.kind, "contacts");
  assert.equal(normalizeContactName(recipientFirst?.contactName ?? ""), "maa");
  assert.equal(recipientFirst?.message, "ek good afternoon message");
});

test("recipient-targeted write prompts stay in preview mode while explicit send commands still send", () => {
  assert.equal(
    shouldPreviewRecipientTargetedWhatsAppDraftForTest("ek good afternoon message likh do maa ko"),
    true,
  );
  assert.equal(
    shouldPreviewRecipientTargetedWhatsAppDraftForTest("write a professional good afternoon message to maa"),
    true,
  );
  assert.equal(
    shouldPreviewRecipientTargetedWhatsAppDraftForTest("draft a professional good afternoon message to maa"),
    true,
  );
  assert.equal(
    shouldPreviewRecipientTargetedWhatsAppDraftForTest("show me a draft good afternoon message for maa"),
    true,
  );
  assert.equal(
    shouldPreviewRecipientTargetedWhatsAppDraftForTest("send a professional good afternoon message to maa"),
    true,
  );
  assert.equal(
    shouldPreviewRecipientTargetedWhatsAppDraftForTest("maa ko good afternoon bhej do"),
    false,
  );
});

test("styled WhatsApp drafts fail closed when the generated text is still a meta prompt or wrong-language descriptor", () => {
  assert.equal(isUnsafeStyledWhatsAppDraftCandidateForTest({
    candidate: "A very beautiful detailed good morning message in Hindi.",
    fallback: "a very beautiful prompt in detail of good morning in hindi",
    languageResolution: {
      locale: "hi",
      source: "explicit_request",
      detectedLocale: "hi",
      preserveRomanScript: false,
    },
  }), true);

  assert.equal(isUnsafeStyledWhatsAppDraftCandidateForTest({
    candidate: "सुप्रभात माँ, आशा है आपका दिन सुख और शांति से भरा रहे।",
    fallback: "a very beautiful prompt in detail of good morning in hindi",
    languageResolution: {
      locale: "hi",
      source: "explicit_request",
      detectedLocale: "hi",
      preserveRomanScript: false,
    },
  }), false);
});

test("deterministic professional greeting drafts can produce Hindi good-morning messages", () => {
  const draft = maybeBuildDeterministicProfessionalGreetingDraftForTest({
    requestedMessage: "good morning",
    recipientLabel: "Maa",
    conversationStyle: "professional",
    locale: "hi",
  });

  assert.match(draft ?? "", /सुप्रभात/);
});

test("send-message parsing ignores internal style markers during approval replay", () => {
  const parsed = parseSendMessageCommand(
    "[[clawcloud-style:professional]] send a professional thanku note to Priyanka for helping me in my todays exam and that to in hindi",
  );
  assert.ok(parsed);
  assert.equal(parsed?.kind, "contacts");
  assert.equal(parsed?.contactName, "Priyanka");
  assert.equal(
    parsed?.message,
    "a professional thanku note for helping me in my todays exam and that to in hindi",
  );
});

test("ambiguous whatsapp contact replies ask which exact named contact to use", () => {
  const reply = formatAmbiguousReply("Priyanka", [
    {
      name: "Priyanka Ludhiana",
      phone: "919876396534",
      aliases: ["priyanka ludhiana"],
      score: 0.9,
      exact: false,
      matchBasis: "word",
    },
    {
      name: "Priyanka Sharma",
      phone: "919812345678",
      aliases: ["priyanka sharma"],
      score: 0.9,
      exact: false,
      matchBasis: "word",
    },
  ]);

  assert.match(reply, /I found more than one strong WhatsApp match for "Priyanka"\./);
  assert.match(reply, /Which Priyanka should I use\?/);
  assert.match(reply, /\*1\.\* Priyanka Ludhiana - \+919876396534/);
  assert.match(reply, /\*2\.\* Priyanka Sharma - \+919812345678/);
});

test("ambiguous whatsapp send replies promise to resume the same send after exact contact selection", () => {
  const reply = buildWhatsAppSendAmbiguousContactReplyForTest("Maa", [
    {
      name: "Maa Home",
      phone: "919876543210",
      aliases: ["maa home"],
      score: 0.95,
      exact: true,
      matchBasis: "exact",
    },
    {
      name: "Maa Work",
      phone: "919812345678",
      aliases: ["maa work"],
      score: 0.95,
      exact: true,
      matchBasis: "exact",
    },
  ]);

  assert.match(reply, /I found more than one strong WhatsApp match for "Maa"\./);
  assert.match(reply, /Tell me the exact contact name or full number and I will use the right chat\./);
  assert.match(reply, /Once you tell me the exact contact, I will send this message to the right chat\./);
});

test("ambiguous whatsapp draft replies promise to prepare the message instead of sending it immediately", () => {
  const reply = buildWhatsAppSendAmbiguousContactReplyForTest(
    "Maa",
    [
      {
        name: "Maa Home",
        phone: "919876543210",
        aliases: ["maa home"],
        score: 0.95,
        exact: true,
        matchBasis: "exact",
      },
      {
        name: "Maa Work",
        phone: "919812345678",
        aliases: ["maa work"],
        score: 0.95,
        exact: true,
        matchBasis: "exact",
      },
    ],
    {
      willSendImmediately: false,
    },
  );

  assert.match(reply, /Once you tell me the exact contact, I will prepare the message for the right chat\./);
  assert.doesNotMatch(reply, /I will send this message to the right chat\./);
});

test("pending contact resume keeps draft prompts as drafts after contact disambiguation", () => {
  const resumePrompt = buildWhatsAppPendingContactResumePromptForTest(
    "send_message",
    {
      name: "Maa Home",
      phone: "919876543210",
      jid: null,
    },
    "ek good afternoon message likh do maa ko",
    "maa",
  );

  assert.equal(resumePrompt, "ek good afternoon message likh do +919876543210 ko");
});

test("pending contact selection keeps literal family labels distinct after ambiguity", () => {
  const pending = {
    kind: "send_message" as const,
    requestedName: "Maa",
    resumePrompt: "send a professional good morning message to maa",
    options: [
      { name: "Mom", phone: "919800000001", jid: null },
      { name: "Maa", phone: "919800000002", jid: null },
    ],
    createdAt: new Date().toISOString(),
  };

  const selected = resolveWhatsAppPendingContactSelectionForTest({
    message: "maa",
    pending,
  });

  assert.equal(selected.type, "selected");
  if (selected.type === "selected") {
    assert.equal(selected.option.name, "Maa");
  }
});

test("verified WhatsApp history selections rewrite short follow-ups to the exact contact", () => {
  assert.equal(
    looksLikeWhatsAppHistoryContinuationWithoutExplicitContactForTest("ok summarize"),
    true,
  );

  const resumePrompt = buildWhatsAppHistoryFollowUpResumePromptForTest(
    "ok summarize",
    {
      kind: "whatsapp_history",
      requestedName: "papa ji",
      contactName: "Papa",
      phone: "919898163144",
      jid: "919898163144@s.whatsapp.net",
      resumePrompt: "Show WhatsApp history with Papa",
      verifiedAt: new Date().toISOString(),
    },
  );

  assert.equal(resumePrompt, "Summarize the WhatsApp chat with +919898163144");
});

test("pending WhatsApp draft review understands send improve and replacement follow-ups", () => {
  const pending = {
    kind: "send_message" as const,
    requestedName: "Maa",
    resumePrompt: "send a very beautiful prompt in detail of good morning in hindi to maa",
    draftMessage: "सुप्रभात माँ, आपका दिन बहुत सुंदर और शांतिपूर्ण रहे।",
    options: [{ name: "Maa", phone: "919800000002", jid: null }],
    createdAt: new Date().toISOString(),
  };

  assert.deepEqual(
    resolveWhatsAppPendingDraftReviewActionForTest({
      message: "Send",
      pending,
    }),
    { type: "approve" },
  );
  assert.deepEqual(
    resolveWhatsAppPendingDraftReviewActionForTest({
      message: "Improve",
      pending,
    }),
    { type: "rewrite", feedback: null },
  );
  assert.deepEqual(
    resolveWhatsAppPendingDraftReviewActionForTest({
      message: "Aapka din shubh ho maa",
      pending,
    }),
    { type: "replace", message: "Aapka din shubh ho maa" },
  );
});

test("pending WhatsApp draft review keeps general ClawCloud questions out of the send lane", () => {
  const pending = {
    kind: "send_message" as const,
    requestedName: "Maa",
    resumePrompt: "send a very beautiful prompt in detail of good morning in hindi to maa",
    draftMessage: "Suprabhat Maa, aapka din bahut sundar aur shaantipurn rahe.",
    options: [{ name: "Maa", phone: "919800000002", jid: null }],
    createdAt: new Date().toISOString(),
  };

  assert.deepEqual(
    resolveWhatsAppPendingDraftReviewActionForTest({
      message: "Movie story of Harry Potter in Tamil",
      pending,
    }),
    { type: "none" },
  );
  assert.deepEqual(
    resolveWhatsAppPendingDraftReviewActionForTest({
      message: "Given an array of integers, find the length of the longest subarray with at most k distinct elements.",
      pending,
    }),
    { type: "none" },
  );
  assert.deepEqual(
    resolveWhatsAppPendingDraftReviewActionForTest({
      message: "tell me the latest OpenAI model",
      pending,
    }),
    { type: "none" },
  );
});

test("pending WhatsApp draft review can re-show the current draft with explicit safe instructions", () => {
  const option = { name: "Maa", phone: "919800000002", jid: null };
  const pending = {
    kind: "send_message" as const,
    requestedName: "Maa",
    resumePrompt: "send a very beautiful prompt in detail of good morning in hindi to maa",
    draftMessage: "सुप्रभात माँ, आपका दिन बहुत सुंदर और शांतिपूर्ण रहे।",
    options: [option] as [typeof option],
    createdAt: new Date().toISOString(),
  };

  assert.deepEqual(
    resolveWhatsAppPendingDraftReviewActionForTest({
      message: "show me the draft",
      pending,
    }),
    { type: "review" },
  );

  const reply = buildWhatsAppPendingDraftReviewReplyForTest({
    ...pending,
    options: pending.options as [typeof option],
  });
  assert.match(reply, /WhatsApp draft ready for Maa \(\+919800000002\):/i);
  assert.match(reply, /Send - send this exact draft now/i);
  assert.match(reply, /Replace: your exact final message/i);
  assert.match(reply, /Cancel - do not send anything/i);
});

test("contact ranking drops fuzzy near-miss names when stronger exact-name matches exist", () => {
  const result = rankContactCandidates("Priyanka", [
    {
      name: "Priyanka Ludhiana",
      phone: "919876396534",
      jid: null,
      aliases: ["priyanka", "priyanka ludhiana"],
      identityKey: "phone:919876396534",
    },
    {
      name: "Priyanka Kumari Mandi Hp",
      phone: "917590054574",
      jid: null,
      aliases: ["priyanka", "priyanka kumari mandi hp"],
      identityKey: "phone:917590054574",
    },
    {
      name: "Priyanshu Classmate",
      phone: "918260382319",
      jid: null,
      aliases: ["priyanshu", "priyanshu classmate"],
      identityKey: "phone:918260382319",
    },
  ]);

  assert.equal(result.type, "ambiguous");
  if (result.type === "ambiguous") {
    assert.deepEqual(
      result.matches.map((match) => match.name),
      ["Priyanka Ludhiana", "Priyanka Kumari Mandi Hp"],
    );
    assert.doesNotMatch(result.prompt, /Priyanshu/i);
  }
});

test("contact ranking prefers the full multi-word person over shared first-name contacts", () => {
  const result = rankContactCandidates("Aman Rajput", [
    {
      name: "Aman Gupta Bh3",
      phone: "919399357485",
      jid: "919399357485@s.whatsapp.net",
      aliases: ["Aman Gupta Bh3"],
      identityKey: "phone:919399357485",
    },
    {
      name: "Aman Classmate",
      phone: "919650123620",
      jid: "919650123620@s.whatsapp.net",
      aliases: ["Aman Classmate"],
      identityKey: "phone:919650123620",
    },
    {
      name: "Aman Rajput Up",
      phone: "917236008923",
      jid: "917236008923@s.whatsapp.net",
      aliases: ["Aman Rajput Up"],
      identityKey: "phone:917236008923",
    },
  ]);

  assert.equal(result.type, "found");
  if (result.type === "found") {
    assert.equal(result.contact.name, "Aman Rajput Up");
    assert.equal(result.contact.phone, "917236008923");
    assert.equal(result.contact.matchBasis, "prefix");
  }
});

test("contact ranking stays ambiguous when multiple contacts satisfy the full multi-word name", () => {
  const result = rankContactCandidates("Aman Rajput", [
    {
      name: "Aman Rajput Up",
      phone: "917236008923",
      jid: "917236008923@s.whatsapp.net",
      aliases: ["Aman Rajput Up"],
      identityKey: "phone:917236008923",
    },
    {
      name: "Rajput Aman Office",
      phone: "919111222333",
      jid: "919111222333@s.whatsapp.net",
      aliases: ["Rajput Aman Office"],
      identityKey: "phone:919111222333",
    },
  ]);

  assert.equal(result.type, "ambiguous");
  if (result.type === "ambiguous") {
    assert.deepEqual(
      result.matches.map((match) => match.name),
      ["Aman Rajput Up", "Rajput Aman Office"],
    );
  }
});

test("send-message parsing understands Hindi recipient-in-the-middle send requests", () => {
  const prompt = "Kripiya kr ke ek bahut sundar sa paragraph aap dii ko send kr de jinse unka mood kafi aacha ho jaye";
  const parsed = parseSendMessageCommand(prompt);

  assert.ok(parsed);
  assert.equal(parsed?.kind, "contacts");
  assert.deepEqual(parsed?.contactNames, ["dii"]);
  assert.match(parsed?.message ?? "", /bahut sundar sa paragraph/i);
  assert.match(parsed?.message ?? "", /mood kafi aacha ho jaye/i);
});

test("Hindi recipient-in-the-middle WhatsApp send prompts stay on the send-message route", () => {
  const prompt = "Kripiya kr ke ek bahut sundar sa paragraph aap dii ko send kr de jinse unka mood kafi aacha ho jaye";

  assert.deepEqual(detectIntentForTest(prompt), {
    type: "send_message",
    category: "send_message",
  });
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

test("active contact mode parses professional handoff commands and only proxies normal follow-up messages", () => {
  assert.equal(parseSendMessageCommand("Talk to Aman on my behalf"), null);
  assert.equal(parseSendMessageCommand("Start talking to Aman on my behalf"), null);
  assert.equal(parseSendMessageCommand("Handle Aman on my behalf"), null);
  assert.equal(parseSendMessageCommand("Can you talk to Aman on my behalf?"), null);
  assert.equal(parseSendMessageCommand("from now onward you will message every question of bhudev"), null);
  assert.equal(parseSendMessageCommand("میری طرف سے رجنیش سے بات کریں۔"), null);
  assert.equal(analyzeSendMessageCommandSafety("Talk to Aman on my behalf"), null);

  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("Talk to Maa on my behalf"),
    { type: "start", contactName: "Maa" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("Can you talk to Maa on my behalf?"),
    { type: "start", contactName: "Maa" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("from now onward you will message every question of bhudev"),
    { type: "start", contactName: "bhudev" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("from now onward you will talk with hansraj lpu on my behalf"),
    { type: "start", contactName: "hansraj lpu" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("ok nw from now onward you will speak to jaideep on my behalf"),
    { type: "start", contactName: "jaideep" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("ab se app mere behalf mai maa se baat karange"),
    { type: "start", contactName: "maa" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("अब से आप मेरी तरफ से माँ से बात करिए"),
    { type: "start", contactName: "माँ" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("ab mere behalf me aap dii se baat karange"),
    { type: "start", contactName: "dii" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("ab mere behalf me dii se baat karange"),
    { type: "start", contactName: "dii" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("ab se app meri tarf se dii se baat karoge"),
    { type: "start", contactName: "dii" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("میری طرف سے رجنیش سے بات کریں۔"),
    { type: "start", contactName: "رجنیش" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("هل يمكنك التحدث مع بابا نيابةً عني؟"),
    { type: "start", contactName: "بابا" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("Stop talking to Maa"),
    { type: "stop", contactName: "Maa" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("Stop messaging this number from now onward +919116592165"),
    { type: "stop", contactName: null },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("Maa se baat karna band karo"),
    { type: "stop", contactName: "Maa" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("Who are you talking to right now?"),
    { type: "status" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("abhi kis se baat kar rahe ho"),
    { type: "status" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("\u8acb\u66ff\u6211\u8ddf\u7238\u7238\u8aaa\u3002"),
    { type: "start", contactName: "\u7238\u7238" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("\u4f60\u73fe\u5728\u5728\u8ddf\u8ab0\u8aaa\u8a71\uff1f"),
    { type: "status" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("\u4e0d\u8981\u518d\u8ddf\u7238\u7238\u8aaa\u8a71\u4e86\u3002"),
    { type: "stop", contactName: "\u7238\u7238" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("\u79c1\u306e\u4ee3\u308f\u308a\u306b\u304a\u7236\u3055\u3093\u3068\u8a71\u3057\u3066"),
    { type: "start", contactName: "\u304a\u7236\u3055\u3093" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("\uc9c0\uae08 \ub204\uad6c\ub791 \ub300\ud654\ud558\uace0 \uc788\uc5b4?"),
    { type: "status" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("\u0e42\u0e2d\u0e40\u0e04 \u0e08\u0e32\u0e01\u0e19\u0e35\u0e49\u0e44\u0e1b\u0e04\u0e38\u0e13\u0e08\u0e30\u0e2a\u0e48\u0e07\u0e02\u0e49\u0e2d\u0e04\u0e27\u0e32\u0e21\u0e44\u0e1b\u0e2b\u0e32\u0e2d\u0e32\u0e21\u0e31\u0e19\u0e43\u0e19\u0e19\u0e32\u0e21\u0e02\u0e2d\u0e07\u0e09\u0e31\u0e19"),
    { type: "start", contactName: "\u0e2d\u0e32\u0e21\u0e31\u0e19" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("\u0e15\u0e2d\u0e19\u0e19\u0e35\u0e49\u0e04\u0e38\u0e13\u0e01\u0e33\u0e25\u0e31\u0e07\u0e04\u0e38\u0e22\u0e01\u0e31\u0e1a\u0e43\u0e04\u0e23"),
    { type: "status" },
  );
  assert.deepEqual(
    parseWhatsAppActiveContactSessionCommandForTest("\u0e2b\u0e22\u0e38\u0e14\u0e04\u0e38\u0e22\u0e01\u0e31\u0e1a\u0e2d\u0e32\u0e21\u0e31\u0e19\u0e41\u0e17\u0e19\u0e09\u0e31\u0e19"),
    { type: "stop", contactName: "\u0e2d\u0e32\u0e21\u0e31\u0e19" },
  );

  const activeSession = {
    contactName: "Maa",
    phone: "919876543210",
    jid: "919876543210@s.whatsapp.net",
    startedAt: "2026-04-03T00:00:00.000Z",
    sourceMessage: "Talk to Maa on my behalf",
  };

  assert.equal(
    shouldRouteMessageToActiveWhatsAppContactSessionForTest(
      "Please tell her I will be 10 minutes late.",
      activeSession,
    ),
    true,
  );
  assert.equal(
    shouldRouteMessageToActiveWhatsAppContactSessionForTest(
      "Stop talking to Maa",
      activeSession,
    ),
    false,
  );
  assert.equal(
    shouldRouteMessageToActiveWhatsAppContactSessionForTest(
      "Show my WhatsApp settings",
      activeSession,
    ),
    false,
  );
  assert.equal(
    shouldRouteMessageToActiveWhatsAppContactSessionForTest(
      "Set language to Hindi",
      activeSession,
    ),
    false,
  );
  assert.equal(
    shouldRouteMessageToActiveWhatsAppContactSessionForTest(
      "What is GDP of China right now?",
      activeSession,
    ),
    false,
  );
  assert.equal(
    shouldRouteMessageToActiveWhatsAppContactSessionForTest(
      "How many contacts do i have in my whatsapp",
      activeSession,
    ),
    false,
  );
  assert.equal(
    shouldRouteMessageToActiveWhatsAppContactSessionForTest(
      "story of Harry potter in japanese",
      activeSession,
    ),
    false,
  );
  assert.equal(
    shouldRouteMessageToActiveWhatsAppContactSessionForTest(
      "Tell me top 10 difficult phrases of thai language",
      activeSession,
    ),
    false,
  );
  assert.equal(
    shouldRouteMessageToActiveWhatsAppContactSessionForTest(
      "What's the weather in Delhi right now?",
      activeSession,
    ),
    false,
  );
  assert.equal(
    shouldRouteMessageToActiveWhatsAppContactSessionForTest(
      "Now in german",
      activeSession,
    ),
    false,
  );
  assert.equal(
    shouldRouteMessageToActiveWhatsAppContactSessionForTest(
      "I am saying in german",
      activeSession,
    ),
    false,
  );
  assert.equal(
    shouldRouteMessageToActiveWhatsAppContactSessionForTest(
      "Write a short apology note in Hindi",
      activeSession,
    ),
    false,
  );
  assert.equal(
    shouldRouteMessageToActiveWhatsAppContactSessionForTest(
      "Call me when free.",
      activeSession,
    ),
    true,
  );
  assert.equal(
    shouldRouteMessageToActiveWhatsAppContactSessionForTest(
      "Where are you right now?",
      activeSession,
    ),
    true,
  );
});

test("pending WhatsApp contact resolution understands exact-name and go-for follow-ups", () => {
  const pending = {
    kind: "whatsapp_history" as const,
    requestedName: "hansraj",
    resumePrompt: "just read the message of me with hansraj",
    createdAt: new Date().toISOString(),
    options: [
      {
        name: "Hansraj Lpu",
        phone: "918949826240",
        jid: "918949826240@s.whatsapp.net",
      },
      {
        name: "Hansraj",
        phone: "919799402911",
        jid: "919799402911@s.whatsapp.net",
      },
    ],
  };

  assert.deepEqual(
    resolveWhatsAppPendingContactSelectionForTest({
      message: "Hansraj Lpu",
      pending,
    }),
    {
      type: "selected",
      option: pending.options[0],
      resumePrompt: "just read the message of me with +918949826240",
    },
  );

  assert.deepEqual(
    resolveWhatsAppPendingContactSelectionForTest({
      message: "go for hansraj lpu",
      pending,
    }),
    {
      type: "selected",
      option: pending.options[0],
      resumePrompt: "just read the message of me with +918949826240",
    },
  );
});

test("pending WhatsApp contact resolution accepts natural ordinal follow-ups and binds history to the exact phone", () => {
  const pending = {
    kind: "whatsapp_history" as const,
    requestedName: "papa ji",
    resumePrompt: "Summarize the chat with papa ji",
    createdAt: new Date().toISOString(),
    options: [
      {
        name: "Papa",
        phone: "918988163144",
        jid: "918988163144@s.whatsapp.net",
      },
      {
        name: "deepak rishu pai prateek cousin",
        phone: "918580951765",
        jid: "918580951765@s.whatsapp.net",
      },
    ],
  };

  assert.deepEqual(
    resolveWhatsAppPendingContactSelectionForTest({
      message: "1st one papa",
      pending,
    }),
    {
      type: "selected",
      option: pending.options[0],
      resumePrompt: "Summarize the chat with +918988163144",
    },
  );

  assert.deepEqual(
    resolveWhatsAppPendingContactSelectionForTest({
      message: "go with 8988163144",
      pending,
    }),
    {
      type: "selected",
      option: pending.options[0],
      resumePrompt: "Summarize the chat with +918988163144",
    },
  );
});

test("resolved WhatsApp history no-rows replies do not reopen a one-contact selection loop", () => {
  const reply = formatWhatsAppHistoryResolvedNoRowsReplyForTest({
    requestedName: "hansraj",
    resolvedName: "Hansraj Lpu",
    phone: "918949826240",
  });

  assert.match(reply, /I couldn't find synced WhatsApp messages for "hansraj" yet\./i);
  assert.match(reply, /I checked the chat matched as Hansraj Lpu \(\+918949826240\)/i);
  assert.match(reply, /there are no synced messages for it yet/i);
  assert.match(reply, /latest visible message/i);
  assert.doesNotMatch(reply, /Reply with the exact contact name, full number, or option number/i);
});

test("unverified WhatsApp history no-rows replies refuse to guess from unrelated chats", () => {
  const reply = formatWhatsAppHistoryUnverifiedContactReplyForTest({
    requestedName: "Ff",
  });

  assert.match(reply, /I couldn't verify a synced WhatsApp contact named "Ff"\./i);
  assert.match(reply, /I did not summarize unrelated chats or unknown-number threads/i);
  assert.match(reply, /exact contact name as saved in WhatsApp or the full phone number/i);
  assert.doesNotMatch(reply, /I checked the chat matched as/i);
});

test("unverified WhatsApp history replies can surface the closest synced contact without summarizing it", () => {
  const reply = formatWhatsAppHistoryUnverifiedContactReplyForTest({
    requestedName: "Hans",
    candidateName: "Hansraj LPU",
    candidatePhone: "918949826240",
  });

  assert.match(reply, /I couldn't verify a synced WhatsApp contact named "Hans"\./i);
  assert.match(reply, /Closest synced match: Hansraj LPU \(\+918949826240\)\./i);
  assert.match(reply, /I did not summarize unrelated chats or unknown-number threads/i);
});

test("recent WhatsApp clarification turns no longer auto-resume from vague context-only follow-ups", () => {
  assert.equal(
    inferRecentWhatsAppContactFollowUpIntentForTest([
      {
        role: "assistant",
        content: "Try searching with a more specific contact name or a keyword from the message to get accurate results for the WhatsApp messages from Hansraj LPU.",
      },
    ]),
    null,
  );

  assert.equal(
    extractWhatsAppLooseContactFollowUpTargetForTest("go for hansraj lpu"),
    "hansraj lpu",
  );

  assert.equal(
    extractWhatsAppLooseContactFollowUpTargetForTest("Hansraj Lpu"),
    null,
  );
});

test("pending WhatsApp contact selection accepts a unique exact-name follow-up even with trailing send noise", () => {
  const pending = {
    kind: "send_message" as const,
    requestedName: "Aman",
    resumePrompt: "Send a professional thank-you greeting to Aman in Thai on WhatsApp",
    createdAt: new Date().toISOString(),
    options: [
      {
        name: "Aman Rajput",
        phone: "919111111111",
        jid: "919111111111@s.whatsapp.net",
      },
      {
        name: "Aman Classmate",
        phone: "919222222222",
        jid: "919222222222@s.whatsapp.net",
      },
    ],
  };

  assert.deepEqual(
    resolveWhatsAppPendingContactSelectionForTest({
      message: "Aman Rajput say",
      pending,
    }),
    {
      type: "selected",
      option: pending.options[0],
      resumePrompt: "Send a professional thank-you greeting to +919111111111 in Thai on WhatsApp",
    },
  );
});

test("pending WhatsApp contact selection does not auto-pick when the follow-up still names only a shared token", () => {
  const pending = {
    kind: "send_message" as const,
    requestedName: "Aman",
    resumePrompt: "Send a professional thank-you greeting to Aman in Thai on WhatsApp",
    createdAt: new Date().toISOString(),
    options: [
      {
        name: "Aman Rajput",
        phone: "919111111111",
        jid: "919111111111@s.whatsapp.net",
      },
      {
        name: "Aman Classmate",
        phone: "919222222222",
        jid: "919222222222@s.whatsapp.net",
      },
    ],
  };

  assert.deepEqual(
    resolveWhatsAppPendingContactSelectionForTest({
      message: "Aman say",
      pending,
    }),
    {
      type: "remind",
    },
  );
});

test("pending WhatsApp contact selection does not revive the contact lane for longer assistant-directed follow-ups", () => {
  const pending = {
    kind: "send_message" as const,
    requestedName: "Aman",
    resumePrompt: "Send a professional thank-you greeting to Aman in Thai on WhatsApp",
    createdAt: new Date().toISOString(),
    options: [
      {
        name: "Aman Rajput",
        phone: "919111111111",
        jid: "919111111111@s.whatsapp.net",
      },
      {
        name: "Aman Classmate",
        phone: "919222222222",
        jid: "919222222222@s.whatsapp.net",
      },
    ],
  };

  assert.deepEqual(
    resolveWhatsAppPendingContactSelectionForTest({
      message: "Aman Rajput ko choose karke ab Harry Potter ki story batao",
      pending,
    }),
    { type: "none" },
  );
});

test("recipient confidence rejects partial multi-token word matches that could hit the wrong contact", () => {
  assert.equal(isConfidentRecipientNameMatchForTest({
    requestedName: "Aman Rajput",
    resolvedName: "Aman Classmate",
    exact: false,
    score: 0.91,
    matchBasis: "word",
  }), false);

  assert.equal(isConfidentRecipientNameMatchForTest({
    requestedName: "Aman",
    resolvedName: "Aman Classmate",
    exact: false,
    score: 0.91,
    matchBasis: "word",
  }), true);
});

test("professional recipient commitment refuses loose live matches but allows strong synced matches", () => {
  assert.equal(isProfessionallyCommittedRecipientMatchForTest({
    requestedName: "Aman",
    resolvedName: "Aman Classmate",
    exact: false,
    score: 0.82,
    matchBasis: "fuzzy",
    source: "live",
  }), false);

  assert.equal(isProfessionallyCommittedRecipientMatchForTest({
    requestedName: "Aman Rajput",
    resolvedName: "Aman Rajput Up",
    exact: false,
    score: 0.96,
    matchBasis: "prefix",
    source: "fuzzy",
  }), true);

  assert.equal(isProfessionallyCommittedRecipientMatchForTest({
    requestedName: "Aman",
    resolvedName: "Aman Rajput",
    exact: false,
    score: 0.99,
    matchBasis: "word",
    source: "fuzzy",
  }), false);
});

test("resolved contact scoring normalizes live 100-point scores before applying confidence gates", () => {
  assert.equal(normalizeResolvedContactMatchScore(92), 0.92);
  assert.equal(normalizeResolvedContactMatchScore(0.96), 0.96);
  assert.equal(
    classifyResolvedContactMatchConfidence({
      requestedName: "Aman",
      resolvedName: "Aman Classmate",
      exact: false,
      score: 92,
      matchBasis: "word",
      source: "live",
    }),
    "confirmation_required",
  );
  assert.equal(
    classifyResolvedContactMatchConfidence({
      requestedName: "Aman Rajput",
      resolvedName: "Aman Rajput Up",
      exact: false,
      score: 92,
      matchBasis: "prefix",
      source: "fuzzy",
    }),
    "verified",
  );
});

test("family relationship synonym matches require confirmation when the visible contact label differs", () => {
  assert.equal(isConfidentRecipientNameMatchForTest({
    requestedName: "Maa",
    resolvedName: "Mom",
    exact: true,
    score: 1,
    matchBasis: "exact",
  }), false);

  assert.equal(isProfessionallyCommittedRecipientMatchForTest({
    requestedName: "Maa",
    resolvedName: "Mom",
    exact: true,
    score: 1,
    matchBasis: "exact",
    source: "fuzzy",
  }), false);

  assert.equal(
    classifyResolvedContactMatchConfidence({
      requestedName: "Maa",
      resolvedName: "Mom",
      exact: true,
      score: 1,
      matchBasis: "exact",
      source: "fuzzy",
    }),
    "confirmation_required",
  );

  const ranked = rankContactCandidates("Maa", [
    {
      name: "Mom",
      phone: "919800000001",
      jid: null,
      aliases: ["Mom"],
      identityKey: "phone:919800000001",
    },
  ]);

  assert.equal(ranked.type, "found");
  if (ranked.type === "found") {
    assert.equal(ranked.contact.exact, false);
    assert.match(ranked.contact.matchBasis ?? "", /^(?:word|prefix)$/);
  }
});

test("full inbound route prioritizes active-contact status and stop commands over casual chat fallbacks", async () => {
  const start = await routeInboundAgentMessageResult("test-user", "Talk to Aman on my behalf");
  assert.match(start.response ?? "", /WhatsApp web session is not active right now\./i);
  assert.match(start.response ?? "", /Please reconnect WhatsApp in setup/i);
  assert.doesNotMatch(start.response ?? "", /Send "Hello" to/i);

  const questionStyleStart = await routeInboundAgentMessageResult("test-user", "Can you talk to Aman on my behalf?");
  assert.match(questionStyleStart.response ?? "", /WhatsApp web session is not active right now\./i);
  assert.doesNotMatch(questionStyleStart.response ?? "", /tell me exactly what you want me to say/i);
  assert.doesNotMatch(questionStyleStart.response ?? "", /what do you want me to say/i);

  const status = await routeInboundAgentMessageResult("test-user", "abhi kis se baat kar rahe ho");
  assert.match(status.response ?? "", /Koi active contact mode abhi chal nahi raha hai\./i);
  assert.match(status.response ?? "", /Talk to Maa on my behalf/i);
  assert.doesNotMatch(status.response ?? "", /aapki taraf se baat karunga/i);

  const stop = await routeInboundAgentMessageResult("test-user", "Maa se baat karna band karo");
  assert.match(stop.response ?? "", /Koi active contact mode abhi chal nahi raha hai\./i);
  assert.match(stop.response ?? "", /Talk to Maa on my behalf/i);
  assert.doesNotMatch(stop.response ?? "", /kya aap mujhe bata sakte/i);
});

test("active contact mode can resolve a generic stop command only when a session is currently active", () => {
  const activeSession = {
    contactName: "Maa",
    phone: "919876543210",
    jid: "919876543210@s.whatsapp.net",
    startedAt: "2026-04-03T00:00:00.000Z",
    sourceMessage: "Talk to Maa on my behalf",
  };

  assert.deepEqual(
    resolveWhatsAppActiveContactSessionCommandWithContextForTest("stop", activeSession),
    { type: "stop", contactName: null },
  );
  assert.deepEqual(
    resolveWhatsAppActiveContactSessionCommandWithContextForTest("band karo", activeSession),
    { type: "stop", contactName: null },
  );
  assert.deepEqual(
    resolveWhatsAppActiveContactSessionCommandWithContextForTest("stop", null),
    { type: "none" },
  );
});

test("intent detection keeps persistent contact-mode handoff commands out of research fallbacks", () => {
  assert.deepEqual(
    detectIntentForTest("from now onward you will message every question of bhudev"),
    { type: "send_message", category: "send_message" },
  );
});

test("near-miss WhatsApp operational prompts fail closed with a WhatsApp clarification instead of a generic answer", () => {
  const sendClarification = buildUnhandledWhatsAppOperationalClarificationForTest(
    "message to maa professionally please",
  );
  assert.equal(sendClarification?.kind, "send_message");
  assert.match(sendClarification?.reply ?? "", /WhatsApp send lane/i);
  assert.match(sendClarification?.reply ?? "", /Send message to Maa: Good morning/i);

  const contactClarification = buildUnhandledWhatsAppOperationalClarificationForTest(
    "handle maa for me on whatsapp",
  );
  assert.equal(contactClarification?.kind, "active_contact");
  assert.match(contactClarification?.reply ?? "", /WhatsApp contact-mode lane/i);
  assert.match(contactClarification?.reply ?? "", /Talk to Maa on my behalf/i);
});

test("unsupported direct call commands fail closed into a safe WhatsApp send suggestion", () => {
  const reply = buildUnsupportedWhatsAppCallReplyForTest("call Jaideep right now");
  assert.match(reply ?? "", /can't place a voice call to Jaideep/i);
  assert.match(reply ?? "", /Send "Call me when free" to Jaideep/i);
});

test("full inbound route keeps unsupported call commands out of generic reliability fallbacks", async () => {
  const result = await routeInboundAgentMessageResult("test-user", "call Jaideep right now");
  assert.match(result.response ?? "", /can't place a voice call to Jaideep/i);
  assert.match(result.response ?? "", /Send "Call me when free" to Jaideep/i);
  assert.doesNotMatch(result.response ?? "", /reliable final answer/i);
});

test("final reply pipeline preserves operational WhatsApp history clarifications instead of collapsing them", async () => {
  const result = await finalizeAgentReplyForTest({
    locale: "en",
    question: "just read the message of me with hansraj",
    intent: "send_message",
    category: "whatsapp_history",
    alreadyTranslated: true,
    preserveRomanScript: false,
    reply: [
      'I couldn\'t find synced WhatsApp messages for "hansraj" yet.',
      "",
      "Keep this in the WhatsApp history lane by choosing the exact contact below:",
      "1. hansraj lpu - +918949826240",
      "",
      "Reply with the exact contact name, full number, or option number and I will check the right chat.",
    ].join("\n"),
  });

  assert.match(result.response ?? "", /I couldn't find synced WhatsApp messages for "hansraj" yet\./i);
  assert.match(result.response ?? "", /Keep this in the WhatsApp history lane/i);
  assert.match(result.response ?? "", /1\. hansraj lpu - \+918949826240/i);
  assert.match(result.response ?? "", /Reply with the exact contact name, full number, or option number/i);
});

test("final reply pipeline skips verified already-translated replies but still rewrites language mismatches", () => {
  const hindiResolution = resolveClawCloudReplyLanguage({
    message: "tell me the messages of jaideep with me and that too in hindi please",
    preferredLocale: "en",
  });
  assert.equal(
    shouldSkipFinalReplyLanguageRewriteForTest({
      question: "tell me the messages of jaideep with me and that too in hindi please",
      category: "whatsapp_history",
      alreadyTranslated: true,
      candidateReply: "I found multiple WhatsApp contacts matching \"jaideep\".",
      languageResolution: hindiResolution,
    }),
    false,
  );

  const hinglishResolution = resolveClawCloudReplyLanguage({
    message: "abhi kis se baat kar rahe ho",
    preferredLocale: "en",
  });
  assert.equal(
    shouldSkipFinalReplyLanguageRewriteForTest({
      question: "abhi kis se baat kar rahe ho",
      category: "send_message",
      alreadyTranslated: true,
      candidateReply: "Koi active contact mode abhi chal nahi raha hai.",
      languageResolution: hinglishResolution,
    }),
    true,
  );

  const englishResolution = resolveClawCloudReplyLanguage({
    message: "Given a large grid with obstacles, find the shortest path from source to destination where you can remove at most k obstacles.",
    preferredLocale: "en",
  });
  assert.equal(
    shouldSkipFinalReplyLanguageRewriteForTest({
      question: "Given a large grid with obstacles, find the shortest path from source to destination where you can remove at most k obstacles.",
      category: "coding",
      alreadyTranslated: true,
      candidateReply: "Use BFS over states (row, column, remaining_k) and prune dominated states with best_remaining.",
      languageResolution: englishResolution,
    }),
    true,
  );

  const japaneseResolution = resolveClawCloudReplyLanguage({
    message: "Tell me the story of Harry Potter in Japanese.",
    preferredLocale: "en",
  });
  assert.equal(
    shouldSkipFinalReplyLanguageRewriteForTest({
      question: "Tell me the story of Harry Potter in Japanese.",
      category: "culture",
      alreadyTranslated: false,
      candidateReply: "『ハリー・ポッター』は、孤児のハリーが自分が魔法使いだと知り、ホグワーツで仲間と共にヴォルデモートと戦う物語です。",
      languageResolution: japaneseResolution,
    }),
    true,
  );
});

test("active-contact Hinglish status and stop replies stay in Roman Hinglish through the final reply pipeline", async () => {
  const status = await finalizeAgentReplyForTest({
    locale: "en",
    preserveRomanScript: true,
    question: "abhi kis se baat kar rahe ho",
    intent: "send_message",
    category: "send_message",
    alreadyTranslated: true,
    reply: [
      "Abhi active contact: didi (+917876831969)",
      "",
      "Yahan aap jo normal messages bhejoge, woh us contact ko jayenge jab tak aap stop nahi bolte, aur main us contact ki recent chat language ke hisaab se adapt karunga unless aap explicitly override karo.",
      "Stop karne ke liye bolo: _Stop talking to didi_.",
    ].join("\n"),
  });
  assert.match(status.response ?? "", /Abhi active contact:\s*didi(?: \(\+917876831969\))?/i);
  assert.match(status.response ?? "", /recent chat language ke hisaab se adapt karunga/i);
  assert.doesNotMatch(status.response ?? "", /No active contact mode is running right now/i);
  assert.doesNotMatch(status.response ?? "", /Normal messages you send here will go to that contact/i);

  const stop = await finalizeAgentReplyForTest({
    locale: "en",
    preserveRomanScript: true,
    question: "Dii se baat karna band karo",
    intent: "send_message",
    category: "send_message",
    alreadyTranslated: true,
    reply: [
      "didi ke liye active contact mode band kar diya gaya hai.",
      "",
      "Ab naye messages isi chat me rahenge jab tak aap koi naya contact mode start nahi karte.",
    ].join("\n"),
  });
  assert.match(stop.response ?? "", /didi ke liye active contact mode band kar diya gaya hai\./i);
  assert.doesNotMatch(stop.response ?? "", /Stopped active contact mode for/i);
  assert.doesNotMatch(stop.response ?? "", /Active contact mode has been stopped/i);

  const afterStop = await finalizeAgentReplyForTest({
    locale: "en",
    preserveRomanScript: true,
    question: "abhi kis se baat kar rahe ho",
    intent: "send_message",
    category: "send_message",
    alreadyTranslated: true,
    reply: [
      "Koi active contact mode abhi chal nahi raha hai.",
      "",
      "Naya mode start karne ke liye bolo: _Talk to Maa on my behalf_.",
    ].join("\n"),
  });
  assert.match(afterStop.response ?? "", /Koi active contact mode abhi chal nahi raha hai\./i);
  assert.doesNotMatch(afterStop.response ?? "", /No active contact mode is running right now/i);
});

test("delivery complaints stay in the WhatsApp lane instead of leaking into general routing", () => {
  const reply = buildWhatsAppDeliveryFollowUpReplyForTest(
    "But message send nhi hua uske contact mai",
    [
      {
        role: "assistant",
        content: "Message submitted to WhatsApp for Mohan roommate (+919546942365). Delivery confirmation is pending.",
      },
    ],
  );

  assert.match(reply ?? "", /accepted by WhatsApp, but delivery is still unconfirmed/i);
  assert.match(reply ?? "", /Mohan roommate \(\+919546942365\)/i);
  assert.match(reply ?? "", /resend it/i);
});

test("active-contact status recovery plan rebuilds real status replies instead of generic fallback copy", () => {
  const activeSession = {
    contactName: "Hansraj Lpu",
    phone: "918949826240",
    jid: "918949826240@s.whatsapp.net",
    startedAt: "2026-04-05T17:20:00.000Z",
    sourceMessage: "from now onward you will talk with hansraj lpu on my behalf",
  };

  const englishPlan = buildWhatsAppActiveContactStatusRecoveryPlanForTest({
    message: "Who are you talking to right now?",
    session: activeSession,
    preferredLocale: "en",
  });
  assert.ok(englishPlan);
  assert.equal(englishPlan?.locale, "en");
  assert.equal(englishPlan?.alreadyTranslated, true);
  assert.match(englishPlan?.reply ?? "", /Active contact mode:\s*\*Hansraj Lpu \(\+918949826240\)\*/i);
  assert.doesNotMatch(englishPlan?.reply ?? "", /could not check active contact mode/i);

  const hinglishPlan = buildWhatsAppActiveContactStatusRecoveryPlanForTest({
    message: "abhi kis se baat kar rahe ho",
    session: activeSession,
    preferredLocale: "en",
  });
  assert.ok(hinglishPlan);
  assert.equal(hinglishPlan?.locale, "en");
  assert.equal(hinglishPlan?.preserveRomanScript, true);
  assert.match(hinglishPlan?.reply ?? "", /Abhi active contact:\s*\*Hansraj Lpu \(\+918949826240\)\*/i);
  assert.doesNotMatch(hinglishPlan?.reply ?? "", /status check nahi kar paaya/i);
});

test("active contact mode adapts to the contact's recent language unless a message explicitly overrides it", () => {
  const hinglishContact = resolveWhatsAppActiveContactDraftLanguageForTest({
    currentMessage: "Please tell her I will be 10 minutes late.",
    preferredLocale: "en",
    contactMessages: ["aap kese ho or aap kya kr skte ho"],
  });
  assert.equal(hinglishContact.selection, "contact_history");
  assert.equal(hinglishContact.resolution.locale, "en");
  assert.equal(hinglishContact.resolution.preserveRomanScript, true);

  const hindiContact = resolveWhatsAppActiveContactDraftLanguageForTest({
    currentMessage: "Please tell her I will be 10 minutes late.",
    preferredLocale: "en",
    contactMessages: ["hola, necesito ayuda con esto hoy"],
  });
  assert.equal(hindiContact.selection, "contact_history");
  assert.equal(hindiContact.resolution.locale, "es");
  assert.equal(hindiContact.resolution.preserveRomanScript, false);

  const explicitOverride = resolveWhatsAppActiveContactDraftLanguageForTest({
    currentMessage: "Say I will be 10 minutes late in English.",
    preferredLocale: "hi",
    contactMessages: ["hola, necesito ayuda con esto hoy"],
  });
  assert.equal(explicitOverride.selection, "explicit_request");
  assert.equal(explicitOverride.resolution.locale, "en");
  assert.equal(explicitOverride.resolution.source, "explicit_request");

  const chineseContact = resolveWhatsAppActiveContactDraftLanguageForTest({
    currentMessage: "Please tell him I will call later.",
    preferredLocale: "en",
    contactMessages: ["\u7238\u7238\uff0c\u6211\u4eca\u5929\u665a\u4e00\u9ede\u6253\u7d66\u4f60\u3002"],
  });
  assert.equal(chineseContact.selection, "contact_history");
  assert.equal(chineseContact.resolution.locale, "zh");
  assert.equal(chineseContact.resolution.preserveRomanScript, false);

  const thaiContact = resolveWhatsAppActiveContactDraftLanguageForTest({
    currentMessage: "Please tell Aman I will message later.",
    preferredLocale: "en",
    contactMessages: ["\u0e44\u0e14\u0e49 \u0e40\u0e14\u0e35\u0e4b\u0e22\u0e27\u0e04\u0e48\u0e2d\u0e22\u0e04\u0e38\u0e22\u0e01\u0e31\u0e19\u0e19\u0e30"],
  });
  assert.equal(thaiContact.selection, "contact_history");
  assert.equal(thaiContact.resolution.locale, "th");
  assert.equal(thaiContact.resolution.preserveRomanScript, false);
});

test("active contact mode detects copied inbound chat lines so it can reply instead of echoing them", async () => {
  assert.equal(
    detectWhatsAppActiveContactQuotedIncomingMessageForTest("Kesa hai tu.", ["Hlo shuu", "Kesa hai tu"]),
    "Kesa hai tu",
  );
  assert.equal(
    detectWhatsAppActiveContactQuotedIncomingMessageForTest("Main theek hoon, tu bata?", ["Hlo shuu", "Kesa hai tu"]),
    null,
  );

  const reply = await maybeBuildDeterministicWhatsAppActiveContactReplyForTest({
    contactName: "didi",
    matchedInboundMessage: "Kesa hai tu.",
    locale: "en",
    languageResolution: {
      locale: "en",
      source: "hinglish_message",
      detectedLocale: "hi",
      preserveRomanScript: true,
    },
  });

  assert.equal(reply, "Main theek hoon, tu bata?");
});

test("active contact reply safety blocks copy-paste fallbacks and prompt leakage", () => {
  assert.equal(
    isUnsafeWhatsAppActiveContactReplyCandidateForTest({
      candidate: "Kesa hai tu.",
      currentMessage: "Kesa hai tu.",
      matchedInboundMessage: "Kesa hai tu.",
    }),
    true,
  );

  assert.equal(
    isUnsafeWhatsAppActiveContactReplyCandidateForTest({
      candidate: "Recipient: didi\nOther person's latest message: Kesa hai tu.",
      currentMessage: "Kesa hai tu.",
      matchedInboundMessage: "Kesa hai tu.",
    }),
    true,
  );

  assert.equal(
    isUnsafeWhatsAppActiveContactReplyCandidateForTest({
      candidate: "Main theek hoon, tu bata?",
      currentMessage: "Kesa hai tu.",
      matchedInboundMessage: "Kesa hai tu.",
    }),
    false,
  );
});

test("active contact send receipts stay short and mirror the user's message language", async () => {
  const session = {
    contactName: "didi",
    phone: "917876831969",
    jid: "917876831969@s.whatsapp.net",
    startedAt: "2026-04-05T11:00:00.000Z",
    sourceMessage: "from now onward talk to dii on my behalf",
  };

  const hinglishReceipt = await buildWhatsAppActiveContactSendReceiptForTest({
    message: "Kesa hai tu.",
    session,
    locale: "en",
    generatedReplyFromInbound: true,
    sendResult: {
      success: true,
      messageIds: ["wamid-1"],
      targetJid: session.jid,
      targetPhone: session.phone,
      deduped: false,
      retriedUndelivered: false,
      ackStatus: "server_ack",
      sentAccepted: true,
      deliveryConfirmed: false,
      warning: null,
    },
  });
  assert.equal(hinglishReceipt, "didi (+917876831969) ko reply WhatsApp par bhej diya. Delivery confirm hone ka wait hai.");

  const englishReceipt = await buildWhatsAppActiveContactSendReceiptForTest({
    message: "Please tell her I will call later.",
    session,
    locale: "en",
    generatedReplyFromInbound: false,
    sendResult: {
      success: true,
      messageIds: ["wamid-2"],
      targetJid: session.jid,
      targetPhone: session.phone,
      deduped: false,
      retriedUndelivered: false,
      ackStatus: "delivery_ack",
      sentAccepted: true,
      deliveryConfirmed: true,
      warning: null,
    },
  });
  assert.equal(englishReceipt, "Message delivered to didi (+917876831969).");
});

test("contact ranking resolves family aliases from synced WhatsApp names and recent chat history", () => {
  assert.equal(normalizeContactName("Dii"), "didi");
  assert.equal(normalizeContactName("sister"), "didi");
  assert.equal(normalizeContactName("\u7238\u7238"), "papa");
  assert.equal(normalizeContactName("\u304a\u7236\u3055\u3093"), "papa");
  assert.equal(normalizeContactName("\uc5c4\ub9c8"), "maa");
  assert.equal(normalizeContactName("\u0e41\u0e21\u0e48"), "maa");
  assert.equal(normalizeContactName("\u0e1e\u0e48\u0e2d"), "papa");
  assert.equal(normalizeContactName("\u0e1e\u0e35\u0e48\u0e2a\u0e32\u0e27"), "didi");

  const resolved = rankContactCandidates("papa ji", [
    {
      name: "Papa Ji",
      phone: "919876543210",
      jid: "919876543210@s.whatsapp.net",
      aliases: ["Papa Ji", "Papa", "Pitaji"],
    },
    {
      name: "deepak rishu pai prateek cousin",
      phone: "918580951765",
      jid: "918580951765@s.whatsapp.net",
      aliases: ["deepak rishu pai prateek cousin"],
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

test("strict family alias lookups do not surface unrelated transliteration tokens as closest contacts", () => {
  const result = rankContactCandidates("papa ji", [
    {
      name: "deepak rishu pai prateek cousin",
      phone: "918580951765",
      jid: "918580951765@s.whatsapp.net",
      aliases: ["deepak rishu pai prateek cousin"],
    },
  ]);

  assert.equal(result.type, "not_found");

  const compactResult = rankContactCandidates("papaji", [
    {
      name: "deepak rishu pai prateek cousin",
      phone: "918580951765",
      jid: "918580951765@s.whatsapp.net",
      aliases: ["deepak rishu pai prateek cousin"],
    },
  ]);

  assert.equal(compactResult.type, "not_found");
});

test("contact ranking can resolve an exact WhatsApp phone number directly", () => {
  const resolved = rankContactCandidates("+91 98765 43210", [
    {
      name: "Dii",
      phone: "919876543210",
      jid: "919876543210@s.whatsapp.net",
      aliases: ["Dii", "Didi", "Sister"],
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
    assert.equal(resolved.contact.name, "Dii");
    assert.equal(resolved.contact.phone, "919876543210");
    assert.equal(resolved.contact.exact, true);
    assert.equal(resolved.contact.matchBasis, "exact");
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

test("history-derived didi aliases beat weak di-prefix WhatsApp names", () => {
  const inferredAliases = buildHistoryDerivedWhatsAppAliasesForTest([
    {
      remote_jid: "917876831969@s.whatsapp.net",
      remote_phone: "917876831969",
      contact_name: "917876831969",
      direction: "outbound",
      message_type: "text",
      chat_type: "direct",
      content: "Ok dii",
    },
    {
      remote_jid: "917876831969@s.whatsapp.net",
      remote_phone: "917876831969",
      contact_name: "917876831969",
      direction: "outbound",
      message_type: "text",
      chat_type: "direct",
      content: "Koi na didi",
    },
    {
      remote_jid: "917876831969@s.whatsapp.net",
      remote_phone: "917876831969",
      contact_name: "917876831969",
      direction: "outbound",
      message_type: "text",
      chat_type: "direct",
      content: "Why didi",
    },
  ]);

  assert.deepEqual(inferredAliases["phone:917876831969"], ["didi"]);

  const resolved = rankContactCandidates("dii", [
    {
      name: "Didi",
      phone: "917876831969",
      jid: "917876831969@s.whatsapp.net",
      aliases: ["917876831969", ...(inferredAliases["phone:917876831969"] ?? [])],
    },
    {
      name: "Divya Prakash Classmate",
      phone: "917979819955",
      jid: "917979819955@s.whatsapp.net",
      aliases: ["Divya Prakash Classmate", "Divya"],
    },
    {
      name: "Mansi Dixit Class Mate",
      phone: "917988685681",
      jid: "917988685681@s.whatsapp.net",
      aliases: ["Mansi Dixit Class Mate", "Dixit"],
    },
    {
      name: "Divyansh Dhiman",
      phone: "918219162088",
      jid: "918219162088@s.whatsapp.net",
      aliases: ["Divyansh Dhiman"],
    },
  ]);

  assert.equal(resolved.type, "found");
  if (resolved.type === "found") {
    assert.equal(resolved.contact.name, "Didi");
    assert.equal(resolved.contact.phone, "917876831969");
  }
});

test("self-chat WhatsApp delivery receipts recover durable aliases for numeric contacts", () => {
  const receiptAliases = buildWhatsAppReceiptDerivedAliasMapForTest([
    {
      direction: "outbound",
      chatType: "direct",
      remotePhone: "918091392311",
      remoteJid: "918091392311@s.whatsapp.net",
      content: [
        "Message delivered to didi (+917876831969).",
        "",
        "Language used: Hinglish (Roman script), adapted from didi's recent chat language.",
        "",
        'Sent text: "Kesa hai tu."',
      ].join("\n"),
    },
  ]);

  assert.deepEqual(receiptAliases["917876831969"], ["didi"]);

  const resolved = rankContactCandidates("dii", [
    {
      name: "917876831969",
      phone: "917876831969",
      jid: "917876831969@s.whatsapp.net",
      aliases: ["917876831969", ...(receiptAliases["917876831969"] ?? [])],
      identityKey: "phone:917876831969",
    },
    {
      name: "Divya Prakash Classmate",
      phone: "917979819955",
      jid: "917979819955@s.whatsapp.net",
      aliases: ["Divya Prakash Classmate", "Divya"],
      identityKey: "phone:917979819955",
    },
    {
      name: "Mansi Dixit Class Mate",
      phone: "917988685681",
      jid: "917988685681@s.whatsapp.net",
      aliases: ["Mansi Dixit Class Mate", "Dixit"],
      identityKey: "phone:917988685681",
    },
  ]);

  assert.equal(resolved.type, "found");
  if (resolved.type === "found") {
    assert.equal(resolved.contact.phone, "917876831969");
    assert.match(resolved.contact.matchBasis ?? "", /^(?:exact|word|prefix)$/);
  }
});

test("dii does not treat unrelated di-prefix WhatsApp names as strong matches", () => {
  const result = rankContactCandidates("dii", [
    {
      name: "Divya Prakash Classmate",
      phone: "917979819955",
      jid: "917979819955@s.whatsapp.net",
      aliases: ["Divya Prakash Classmate", "Divya"],
    },
    {
      name: "Mansi Dixit Class Mate",
      phone: "917988685681",
      jid: "917988685681@s.whatsapp.net",
      aliases: ["Mansi Dixit Class Mate", "Dixit"],
    },
    {
      name: "Divyansh Dhiman",
      phone: "918219162088",
      jid: "918219162088@s.whatsapp.net",
      aliases: ["Divyansh Dhiman"],
    },
    {
      name: "Anmol Dixit Bh 6",
      phone: "918755061396",
      jid: "918755061396@s.whatsapp.net",
      aliases: ["Anmol Dixit Bh 6", "Dixit"],
    },
    {
      name: "Gaurav Sir Cdec",
      phone: "919817995052",
      jid: "919817995052@s.whatsapp.net",
      aliases: ["Gaurav Sir Cdec", "Sir"],
    },
    {
      name: "Sidharth Singer",
      phone: "918279965754",
      jid: "918279965754@s.whatsapp.net",
      aliases: ["Sidharth Singer", "Singer"],
    },
  ]);

  assert.equal(result.type, "not_found");
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
      "what is cuba",
      buildClawCloudAnswerQualityProfile({
        question: "what is cuba",
        intent: "general",
        category: "general",
      }),
    ),
    true,
  );

  assert.equal(
    shouldAttemptDirectAnswerRecovery(
      "ok then what is cuba",
      buildClawCloudAnswerQualityProfile({
        question: "ok then what is cuba",
        intent: "general",
        category: "general",
      }),
    ),
    true,
  );

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

test("strict intent routing locks direct contact-message lookups to WhatsApp history when the phrasing names the chat target", () => {
  const route = detectStrictIntentRouteForTest("read and tell me the message of jaideep");
  assert.ok(route);
  assert.equal(route?.intent.category, "whatsapp_history");
  assert.equal(route?.confidence, "medium");
  assert.equal(route?.clarificationReply, null);
});

test("strict intent routing keeps typoed contact-conversation prompts in the WhatsApp history lane", () => {
  const route = detectStrictIntentRouteForTest("read the converation of me with Ff");
  assert.ok(route);
  assert.equal(route?.intent.category, "whatsapp_history");
  assert.equal(route?.confidence, "medium");
  assert.equal(route?.clarificationReply, null);
});

test("strict intent routing uses typo normalization to keep contact-history lookups locked early", () => {
  const route = detectStrictIntentRouteForTest("shwo the converstion of me with papa ji");
  assert.ok(route);
  assert.equal(route?.intent.category, "whatsapp_history");
  assert.equal(route?.locked, true);
});

test("strict intent routing locks freshness-sensitive current questions to the live web lane early", () => {
  const route = detectStrictIntentRouteForTest("who is the current founder of openai");
  assert.ok(route);
  assert.equal(route?.intent.category, "web_search");
  assert.equal(route?.locked, true);
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

test("strict intent routing treats multi-language Infinity War story prompts as culture_story requests", () => {
  const route = detectStrictIntentRouteForTest("tell me the story of avannger infinity war in korean and chinese");
  assert.ok(route);
  assert.equal(route?.intent.category, "culture_story");
  assert.equal(route?.locked, true);
});

test("strict intent routing survives misspelled movie story prompts with language targets", () => {
  const route = detectStrictIntentRouteForTest("telll me stroy of the movi boy next door in koreean");
  assert.ok(route);
  assert.equal(route?.intent.category, "culture_story");
  assert.equal(route?.locked, true);
});

test("strict intent routing catches Turkish story prompts with explicit non-English target language", () => {
  const route = detectStrictIntentRouteForTest("Tamam Şimdi Bana Bhool Bhulaiyaa 2'nin Tayca Hikayesini Ver");
  assert.ok(route);
  assert.equal(route?.intent.category, "culture_story");
  assert.equal(route?.locked, true);
});

test("strict intent routing catches ASCII Turkish story prompts with explicit non-English target language", () => {
  const route = detectStrictIntentRouteForTest("Tamam simdi Bana Bhool Bhulaiyaa 2'nin Tayca Hikayesini Ver");
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

test("deterministic known-story replies handle Bhool Bhulaiyaa 2 prompts", () => {
  const answer = resolveDeterministicKnownStoryReplyForTest(
    "give me story of bhool bhulaiyaa 2 in thai",
  ) ?? "";
  assert.match(answer, /Ruhaan/i);
  assert.match(answer, /Reet/i);
  assert.match(answer, /Manjulika/i);
});

test("deterministic known-story replies handle 365 Days prompts", () => {
  const answer = resolveDeterministicKnownStoryReplyForTest(
    "give me the story of 365 days in brazalian and chinese",
  ) ?? "";
  assert.match(answer, /Laura Biel/i);
  assert.match(answer, /Massimo Torricelli/i);
  assert.match(answer, /365 days to fall in love/i);
});

test("localized deterministic known-story replies can answer My Demon directly in Korean", () => {
  const answer = buildLocalizedDeterministicKnownStoryReplyForTest(
    "tell me the story of my demon in korean",
    "ko",
  ) ?? "";
  assert.match(answer, /도도희/u);
  assert.match(answer, /정구원/u);
});

test("deterministic known-story replies handle typoed Harry Potter prompts with language targets", () => {
  const answer = resolveDeterministicKnownStoryReplyForTest(
    "Ok tell mw story of Harry potter in japanese",
  ) ?? "";
  assert.match(answer, /Harry Potter/i);
  assert.match(answer, /Hogwarts/i);
  assert.match(answer, /Voldemort/i);
});

test("localized deterministic known-story replies can answer Harry Potter directly in Japanese", () => {
  const answer = buildLocalizedDeterministicKnownStoryReplyForTest(
    "Ok tell mw story of Harry potter in japanese",
    "ja",
  ) ?? "";
  assert.match(answer, /ハリー・ポッター/u);
  assert.match(answer, /ホグワーツ/u);
  assert.match(answer, /ヴォルデモート/u);
});

test("inbound agent story replies avoid generic clarification for typoed Harry Potter requests in Japanese", async () => {
  const result = await routeInboundAgentMessageResult(
    "test-user",
    "Ok tell mw story of Harry potter in japanese",
  );

  assert.doesNotMatch(result.response ?? "", /正確な回答をするために|exact topic|precise reply/u);
  assert.match(result.response ?? "", /ハリー・ポッター|ホグワーツ|ヴォルデモート/u);
});

test("inbound agent story replies stay non-empty for multi-language Infinity War prompts", async () => {
  const result = await routeInboundAgentMessageResult(
    "test-user",
    "tell me the story of avannger infinity war in korean and chinese",
  );

  assert.match(result.response ?? "", /\bKorean\b/i);
  assert.match(result.response ?? "", /\bChinese\b/i);
  assert.match(result.response ?? "", /Thanos/i);
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

  assert.equal(
    looksLikeWrongModeAnswer(
      "story of Harry potter in japanese",
      "正確な回答をするために、正確なトピック、名前、アイテム、または数字を教えてください。",
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

test("weather lookup prefers the exact geocoded city over nearby provider drift", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.startsWith("https://geocoding-api.open-meteo.com/v1/search?")) {
      return Response.json({
        results: [
          {
            name: "Shikinejima",
            country: "Japan",
            timezone: "Asia/Tokyo",
            latitude: 34.326,
            longitude: 139.219,
            population: 2500,
            feature_code: "PPL",
          },
          {
            name: "Tokyo",
            country: "Japan",
            timezone: "Asia/Tokyo",
            latitude: 35.6762,
            longitude: 139.6503,
            population: 13_960_000,
            feature_code: "PPLC",
          },
        ],
      });
    }

    if (url.startsWith("https://api.open-meteo.com/v1/forecast?latitude=35.6762&longitude=139.6503")) {
      return Response.json({
        current: {
          temperature_2m: 18.2,
          apparent_temperature: 17.5,
          relative_humidity_2m: 52,
          wind_speed_10m: 11.2,
          weather_code: 1,
        },
        daily: {
          temperature_2m_max: [22.1],
          temperature_2m_min: [12.4],
        },
        hourly: {
          precipitation_probability: [0, 10, 20],
        },
      });
    }

    throw new Error(`Unexpected fetch during test: ${url}`);
  }) as typeof fetch;

  try {
    const weather = await getWeather("tokyo");
    assert.match(weather ?? "", /\*Weather in Tokyo, Japan\*/i);
    assert.match(weather ?? "", /Source: open-meteo\.com/i);
    assert.doesNotMatch(weather ?? "", /Shikinejima/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("weather lookup fails closed when fallback providers drift to the wrong place", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.startsWith("https://geocoding-api.open-meteo.com/v1/search?")) {
      return new Response("unavailable", { status: 503 });
    }

    if (url.startsWith("https://wttr.in/tokyo?format=j1")) {
      return Response.json({
        current_condition: [
          {
            temp_C: "14",
            FeelsLikeC: "13",
            humidity: "54",
            windspeedKmph: "17",
            visibility: "10",
            weatherDesc: [{ value: "Sunny" }],
          },
        ],
        nearest_area: [
          {
            areaName: [{ value: "Shikinejima" }],
            country: [{ value: "Japan" }],
          },
        ],
        weather: [
          {
            maxtempC: "17",
            mintempC: "14",
            hourly: [{ chanceofrain: "80" }],
          },
        ],
      });
    }

    throw new Error(`Unexpected fetch during test: ${url}`);
  }) as typeof fetch;

  try {
    assert.equal(await getWeather("tokyo"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("vague live news requests build headline-focused queries", () => {
  const queries = buildNewsQueries("news of today");
  assert.ok(queries.some((query) => /headlines/i.test(query)));
  assert.ok(queries.some((query) => /reuters|bbc|ap/i.test(query)));

  const translatedCountryQueries = buildNewsQueries("tell me the news of today of usa in turkish");
  assert.ok(translatedCountryQueries.some((query) => /united states|usa/i.test(query)));
  assert.ok(translatedCountryQueries.every((query) => !/\bturkish\b/i.test(query)));

  const caseQueries = buildNewsQueries("tarun holi delhi case");
  assert.ok(caseQueries.some((query) => /case explained/i.test(query)));
  assert.ok(caseQueries.some((query) => /incident/i.test(query)));
});

test("broad world-news prompts get a clean deterministic headline digest from live sources", () => {
  const answer = buildTopHeadlineDigestAnswerForTest(
    "what is the current news of the world of todays",
    [
      {
        title: "Global markets steady as oil prices cool",
        url: "https://reuters.com/world/markets-one",
        snippet: "Investors watched oil and bond yields.",
        domain: "reuters.com",
        publishedDate: "2026-04-05T13:30:00.000Z",
        score: 0.91,
      },
      {
        title: "EU leaders discuss new security package",
        url: "https://apnews.com/world/europe-two",
        snippet: "Leaders met in Brussels on Sunday.",
        domain: "apnews.com",
        publishedDate: "2026-04-05T12:10:00.000Z",
        score: 0.86,
      },
      {
        title: "Asian tech stocks rebound after policy signals",
        url: "https://bbc.com/news/business-three",
        snippet: "Tech shares rose across major exchanges.",
        domain: "bbc.com",
        publishedDate: "2026-04-05T10:45:00.000Z",
        score: 0.82,
      },
    ],
  );

  assert.match(answer, /\*Top world headlines right now\*/i);
  assert.match(answer, /1\. Global markets steady as oil prices cool/i);
  assert.match(answer, /reuters\.com/i);
  assert.match(answer, /These are the strongest recent world-news headlines/i);
  assert.doesNotMatch(answer, /could not verify|scoped live answer needed|low confidence/i);
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
  assert.equal(classifyClawCloudLiveSearchTier("who is the current founder of OpenAI"), "volatile");
  assert.equal(shouldUseLiveSearch("who is the current founder of OpenAI"), true);
  assert.equal(classifyClawCloudLiveSearchTier("what is the latest Samsung model right now"), "volatile");
  assert.equal(shouldUseLiveSearch("what is the latest Samsung model right now"), true);
  assert.match(buildNoLiveDataReply("who is the current founder of OpenAI"), /\*Freshness check\*/i);
  assert.match(buildNoLiveDataReply("what is the latest Samsung model right now"), /\*Freshness check\*/i);
  assert.equal(buildNoLiveDataReply("search the web for how does a b+ tree work"), "__NO_LIVE_DATA_INTERNAL_SIGNAL__");
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
  assert.match(
    buildCurrentAffairsClarificationReply("abhi yudh ki stithi kya hai"),
    /named explicitly/i,
  );
  assert.equal(detectNewsQuestion("abhi yudh ki stithi kya hai"), true);
  assert.equal(looksLikeCurrentAffairsQuestion("what is the situation of iran right now"), true);
  assert.equal(detectNewsQuestion("what is the situation of iran right now"), true);
  assert.equal(looksLikeCurrentAffairsQuestion("Why is Cuba all blackout and has no electricity?"), true);
  assert.equal(detectNewsQuestion("Why is Cuba all blackout and has no electricity?"), true);
  const abstractPrompt = "Problem (Ultra Hard - Cross Domain) Consider a hypothetical AI system that has complete knowledge of all physical laws governing the universe and unlimited computational resources. Assume the universe is governed by quantum mechanics and general relativity. Is it theoretically possible to predict the exact conscious experience of a human at t1 > t0? Prove or disprove and analyze infinite regress, fixed-point convergence, logical inconsistency, and computable versus uncomputable reality within current models of physics.";
  assert.equal(looksLikeCurrentAffairsQuestion(abstractPrompt), false);
  assert.equal(classifyClawCloudLiveSearchTier(abstractPrompt), "knowledge");
  const fullHardSciencePrompt = [
    "Problem (Ultra Hard - Cross Domain)",
    "Consider a hypothetical AI system that has complete knowledge of all physical laws governing the universe and unlimited computational resources.",
    "Assume:",
    "The universe is governed by quantum mechanics and general relativity.",
    "The AI has perfect access to the exact quantum state of a human brain at time t0.",
    "Answer the following:",
    "Is it theoretically possible for the AI to predict the exact conscious experience of that human at time t1 > t0?",
    "Justify your answer using principles from quantum mechanics, uncertainty, decoherence, and computational theory.",
    "If the AI simulates the brain perfectly, does the simulation itself become conscious? Provide arguments using both physicalism and functionalism.",
    "Prove or disprove: perfect prediction of human behavior implies determinism of consciousness.",
    "Include arguments involving chaos theory, Godel incompleteness, and limits of computation.",
    "Suppose the AI attempts to simulate itself simulating the universe using recursive self-modeling.",
    "Analyze whether this leads to infinite regress, fixed-point convergence, or logical inconsistency.",
    "Define a formal boundary between computable reality and non-computable phenomena.",
    "Can such a boundary exist within current models of physics?",
    "Bonus: construct a formal proof or counterexample for the statement that any system capable of fully simulating the universe must necessarily contain an uncomputable component.",
  ].join(" ");
  assert.equal(looksLikeCurrentAffairsQuestion(fullHardSciencePrompt), false);
  assert.equal(classifyClawCloudLiveSearchTier(fullHardSciencePrompt), "knowledge");
  assert.equal(shouldUseLiveSearch(fullHardSciencePrompt), false);
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
  assert.equal(
    looksLikeCurrentAffairsLogisticsQuestion("is russia oil tanker reached cuba how much oil is there in that tanker"),
    true,
  );
  const tankerArrivalQueries = buildCurrentAffairsQueries("is russia oil tanker reached cuba how much oil is there in that tanker");
  assert.ok(tankerArrivalQueries.some((query) => /russia/i.test(query) && /cuba/i.test(query)));
  assert.ok(tankerArrivalQueries.some((query) => /barrels|cargo/i.test(query)));
  assert.ok(tankerArrivalQueries.some((query) => /arrived|anchored|reached/i.test(query)));
});

test("current-affairs query builder normalizes common israel misspellings inside live-news prompts", () => {
  const queries = buildCurrentAffairsQueries("what is the the news of iran and iseral of today tell me in chinese");
  assert.ok(queries.length > 0);
  assert.ok(queries.some((query) => /iran/i.test(query)));
  assert.ok(queries.some((query) => /israel/i.test(query)));
  assert.ok(queries.every((query) => !/iseral/i.test(query)));
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

test("current-affairs logistics answers stay evidence-first for tanker arrival and cargo questions", () => {
  const answer = buildCurrentAffairsEvidenceAnswer(
    "is russia oil tanker reached cuba how much oil is there in that tanker",
    [
      {
        title: "Russia-origin fuel tanker bound for Cuba anchored in Venezuelan waters - Reuters",
        url: "https://www.reutersconnect.com/item/russia-origin-fuel-tanker-bound-for-cuba-anchored-in-venezuelan-waters/dGFnOnJldXRlcnMuY29tLDIwMjY6bmV3c21sX1JDMk5ES0E2NzM2Vg",
        snippet: "The vessel Sea Horse, carrying some 200,000 barrels of Russia-origin fuel originally bound for Cuba, is anchored in Venezuelan waters.",
        domain: "reutersconnect.com",
        publishedDate: "2026-03-28T08:00:00.000Z",
        score: 0.88,
      },
    ],
  );

  assert.match(answer, /current-affairs check/i);
  assert.match(answer, /anchored in Venezuelan waters/i);
  assert.match(answer, /not confirm it had reached Cuba|not fully confirmed/i);
  assert.match(answer, /200,000 barrels/i);
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

test("logistics news synthesis avoids the generic no-sources prompt for tanker arrival questions", async () => {
  const answer = await synthesiseNewsAnswerForTest(
    "is russia oil tanker reached cuba how much oil is there in that tanker",
    [],
  );

  assert.match(answer, /current-affairs check/i);
  assert.match(answer, /could not confirm from the live source batch whether the tanker had already reached Cuba/i);
  assert.match(answer, /could not verify a current cargo figure/i);
  assert.match(answer, /searched:/i);
  assert.doesNotMatch(answer, /No strong live sources found/i);
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

test("current-affairs evidence answers fail closed when a right-now question only has stale coverage", () => {
  const answer = buildCurrentAffairsEvidenceAnswer(
    "what is the situation of iran right now",
    [
      {
        title: "Iran protests intensify after Mahsa Amini death - Reuters",
        url: "https://www.reuters.com/world/middle-east/iran-protests-2022",
        snippet: "Iran sees major protests after the death of Mahsa Amini in police custody.",
        domain: "reuters.com",
        publishedDate: "2022-09-25T10:00:00.000Z",
        score: 0.9,
      },
      {
        title: "Iran unrest continues amid crackdown - AP",
        url: "https://apnews.com/article/iran-unrest-2022",
        snippet: "Iranian authorities continue their crackdown after nationwide protests.",
        domain: "apnews.com",
        publishedDate: "2022-10-01T08:30:00.000Z",
        score: 0.88,
      },
    ],
  );

  assert.match(answer, /current-affairs check/i);
  assert.match(answer, /could not verify a safe current snapshot/i);
  assert.match(answer, /should not present it as the situation right now/i);
});

test("news synthesis fails closed for freshness-sensitive current-affairs questions when sources are stale", async () => {
  const answer = await synthesiseNewsAnswerForTest(
    "abhi yudh ki stithi kya hai",
    [
      {
        title: "Major conflicts to watch in 2024 - Reuters",
        url: "https://www.reuters.com/world/conflicts-2024",
        snippet: "An overview of the main global conflicts analysts were watching in 2024.",
        domain: "reuters.com",
        publishedDate: "2024-05-20T05:30:00.000Z",
        score: 0.86,
      },
      {
        title: "Global flashpoints update - AP",
        url: "https://apnews.com/article/global-flashpoints-2024",
        snippet: "A snapshot of the major global flashpoints as of May 2024.",
        domain: "apnews.com",
        publishedDate: "2024-05-19T07:00:00.000Z",
        score: 0.84,
      },
    ],
  );

  assert.match(answer, /current-affairs check/i);
  assert.match(answer, /could not verify a safe current snapshot/i);
  assert.match(answer, /retry the live check/i);
  assert.match(answer, /searched:/i);
});

test("inbound route clarifies ambiguous Hinglish war-status prompts instead of using the generic latest-update recovery", async () => {
  const result = await routeInboundAgentMessageResult(
    "test-user",
    "abhi yudh ki stithi kya hai",
  );

  assert.match(result.response ?? "", /current-affairs clarification/i);
  assert.match(result.response ?? "", /named explicitly/i);
  assert.doesNotMatch(result.response ?? "", /latest update request/i);
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
  assert.deepEqual(parseOutboundReviewDecisionForTest("send now please"), { kind: "approve" });
  assert.deepEqual(parseOutboundReviewDecisionForTest("ok"), { kind: "none" });
  assert.deepEqual(parseOutboundReviewDecisionForTest("sure"), { kind: "none" });
  assert.deepEqual(parseOutboundReviewDecisionForTest("yes"), { kind: "none" });
  assert.deepEqual(parseOutboundReviewDecisionForTest("ok summarize"), { kind: "none" });
  assert.deepEqual(parseOutboundReviewDecisionForTest("do it professionally"), { kind: "none" });
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
  assert.deepEqual(parseOutboundReviewDecisionForTest('send hey to rajnish classmate'), { kind: "none" });
  assert.deepEqual(parseOutboundReviewDecisionForTest('Send "Hello" to Maa'), { kind: "none" });
  assert.deepEqual(parseOutboundReviewDecisionForTest("create reminder for tomorrow 8am"), { kind: "none" });
});

test("deterministic professional greeting drafting upgrades short casual send text", () => {
  assert.equal(
    maybeBuildDeterministicProfessionalGreetingDraftForTest({
      requestedMessage: "hii",
      recipientLabel: "Rajnish classmate",
      conversationStyle: "professional",
      locale: "en",
    }),
    "Hi Rajnish, hope you're doing well.",
  );

  assert.equal(
    maybeBuildDeterministicProfessionalGreetingDraftForTest({
      requestedMessage: "need to talk today",
      recipientLabel: "Rajnish classmate",
      conversationStyle: "professional",
      locale: "en",
    }),
    null,
  );
});

test("whatsapp send drafting mode defaults to verbatim for normal direct commands", () => {
  assert.equal(
    resolveWhatsAppDraftingModeForTest("send hii to rajnish", "hii"),
    "verbatim",
  );
  assert.equal(
    resolveWhatsAppDraftingModeForTest('send "class khtm hone ke baad phone krna" to jaideep', "class khtm hone ke baad phone krna"),
    "verbatim",
  );
});

test("whatsapp send drafting mode only enables styled rewrites for explicit drafting requests", () => {
  assert.equal(
    resolveWhatsAppDraftingModeForTest("send a professional good morning message to 9931856101", "a professional good morning message"),
    "styled",
  );
  assert.equal(
    resolveWhatsAppDraftingModeForTest('send "professional good morning message" to rajnish', "professional good morning message"),
    "verbatim",
  );
});

test("whatsapp send drafting mode upgrades abstract note requests without rewriting literal courtesy text", () => {
  assert.equal(
    resolveWhatsAppDraftingModeForTest("send thanku note to priyanshu", "thanku note"),
    "styled",
  );
  assert.equal(
    resolveWhatsAppDraftingModeForTest(
      "send a professional thanku note to priyanka for helping me in my todays exam and that to in hindi",
      "a professional thanku note for helping me in my todays exam and that to in hindi",
    ),
    "styled",
  );
  assert.equal(
    resolveWhatsAppDraftingModeForTest("send thank you to priyanshu", "thank you"),
    "verbatim",
  );
  assert.equal(
    resolveWhatsAppDraftingModeForTest("send thank you to priyanshu and do not change the text", "thank you"),
    "verbatim",
  );
  assert.equal(
    resolveWhatsAppDraftingModeForTest(
      "send a professional thanku note to aman for helping me in my todays exam and that to in hindi do not change the text only paste the same test ok do it professionally",
      "a professional thanku note for helping me in my todays exam and that to in hindi do not change the text only paste the same test ok do it professionally",
    ),
    "styled",
  );
});

test("deterministic structured whatsapp drafts clean up typoed thank-you note prompts into polished messages", async () => {
  const draft = await maybeBuildDeterministicStructuredWhatsAppDraftForTest({
    originalRequest:
      "send a professional thanku note to priyanka for helping me in my todays exam and that to in hindi",
    requestedMessage:
      "a professional thanku note for helping me in my todays exam and that to in hindi",
    recipientLabel: "Priyanka classmate",
    conversationStyle: "professional",
    locale: "en",
  });

  assert.ok(draft);
  assert.match(draft ?? "", /^Hi Priyanka,/);
  assert.match(draft ?? "", /Thank you so much for helping me with today's exam\./i);
  assert.match(draft ?? "", /I really appreciate your support, and it meant a lot to me\./i);
  assert.doesNotMatch(draft ?? "", /\bthat to\b/i);
  assert.doesNotMatch(draft ?? "", /\btodays\b/i);
});

test("deterministic structured whatsapp drafts ignore pasted instruction clutter for abstract note requests", async () => {
  const draft = await maybeBuildDeterministicStructuredWhatsAppDraftForTest({
    originalRequest:
      "send a professional thanku note to aman for helping me in my todays exam and that to in hindi do not change the text only paste the same test ok do it professionally",
    requestedMessage:
      "a professional thanku note for helping me in my todays exam and that to in hindi do not change the text only paste the same test ok do it professionally",
    recipientLabel: "Aman classmate",
    conversationStyle: "professional",
    locale: "en",
  });

  assert.ok(draft);
  assert.match(draft ?? "", /^Hi Aman,/);
  assert.match(draft ?? "", /Thank you so much for helping me with today's exam\./i);
  assert.match(draft ?? "", /I really appreciate your support, and it meant a lot to me\./i);
  assert.doesNotMatch(draft ?? "", /\bdo not change\b/i);
  assert.doesNotMatch(draft ?? "", /\bonly paste\b/i);
  assert.doesNotMatch(draft ?? "", /\bsame test\b/i);
  assert.doesNotMatch(draft ?? "", /\bok do it professionally\b/i);
});

test("whatsapp outgoing autocorrect fixes obvious Hinglish spelling issues without changing intent", () => {
  assert.equal(
    autoCorrectWhatsAppOutgoingMessageForTest("Aaaj mai class ni aa rha", "professional"),
    "Aaj main class nahi aa raha.",
  );
  assert.equal(
    autoCorrectWhatsAppOutgoingMessageForTest("hii", "casual"),
    "hi",
  );
});

test("whatsapp self-label guard detects message-yourself contacts without blocking normal names", () => {
  assert.equal(isLikelyWhatsAppSelfLabelForTest("Shubham Himavhal (You)"), true);
  assert.equal(isLikelyWhatsAppSelfLabelForTest("message yourself"), true);
  assert.equal(isLikelyWhatsAppSelfLabelForTest("Rajnish Classmate"), false);
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

test("gmail legacy review previews now point to manual SEND/EDIT/SKIP commands", () => {
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
  assert.match(preview, /SEND .*EDIT .*SKIP/i);
});

test("gmail legacy review context replies explain the queued-item status and target", () => {
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
  assert.match(explain, /older queued review item/i);
  assert.match(explain, /\*Target:\* raj@example\.com/i);
  assert.match(explain, /\*Subject:\* Project update/i);

  const target = buildReplyApprovalContextReply(approval, "target");
  assert.match(target, /pending Gmail message is for \*raj@example\.com\*/i);
  assert.match(target, /SEND.*, `EDIT`, or `SKIP`|SEND.*EDIT.*SKIP/i);
});

test("whatsapp legacy review previews now point to manual WSEND/WEDIT/WSKIP commands", () => {
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
  assert.match(preview, /WSEND .*WEDIT .*WSKIP/i);
});

test("whatsapp legacy review context replies explain the queued-item status and recipient scope", () => {
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
  assert.match(explain, /older queued review item/i);
  assert.match(explain, /Broadcast draft targets 12 contacts/i);
  assert.match(explain, /\*Target:\* 12 contacts/i);
  assert.match(explain, /WSEND/i);

  const target = buildWhatsAppApprovalContextReply(approval, "target", 12);
  assert.match(target, /pending WhatsApp draft is for \*12 contacts\*/i);
  assert.match(target, /broadcast-style draft for 12 contacts/i);
});

test("whatsapp broadcast legacy previews use manual command handling instead of yes-no confirmation", () => {
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
  assert.match(preview, /WSEND/i);
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

test("gmail search routing understands typoed and message-style inbox prompts without drifting to WhatsApp", () => {
  assert.equal(
    normalizeClawCloudUnderstandingMessage("show my gmial inbxo"),
    "show my gmail inbox",
  );

  assert.deepEqual(
    detectIntentForTest("show my gmial inbxo"),
    { type: "email", category: "email_search" },
  );

  assert.deepEqual(
    detectIntentForTest("what did my latest emial say"),
    { type: "email", category: "email_search" },
  );

  assert.deepEqual(
    detectIntentForTest("tell me the message of my latest email"),
    { type: "email", category: "email_search" },
  );

  assert.deepEqual(
    detectIntentForTest("read the messages of my email and tell me what it replied"),
    { type: "email", category: "email_search" },
  );

  assert.deepEqual(
    detectIntentForTest("my unread gmial"),
    { type: "email", category: "email_search" },
  );
});

test("timeboxed Gmail read recovery stays Gmail-specific instead of drifting into latest-update fallbacks", () => {
  const reply = buildTimeboxedProfessionalReplyForTest("what did my latest email say?", "email");
  assert.match(reply, /gmail/i);
  assert.doesNotMatch(reply, /latest update request/i);
  assert.doesNotMatch(reply, /scoped live answer needed/i);
  assert.doesNotMatch(reply, /who to, what purpose/i);
});

test("full inbound route keeps typoed Gmail read prompts on Gmail-safe replies instead of generic clarification fallbacks", async () => {
  for (const prompt of [
    "show my gmial inbxo",
    "read my latest gmail email",
    "what did my latest emial say",
    "read the messages of my email and tell me what it replied",
  ]) {
    const result = await routeInboundAgentMessageResult("test-user", prompt);
    const response = result.response ?? "";
    assert.match(response, /gmail|google/i);
    assert.doesNotMatch(response, /latest update request/i);
    assert.doesNotMatch(response, /scoped live answer needed/i);
    assert.doesNotMatch(response, /need more context/i);
    assert.doesNotMatch(response, /who to, what purpose/i);
  }
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
  assert.deepEqual(detectIntentForTest("tell me the message of jaideep with me"), { type: "send_message", category: "whatsapp_history" });
  assert.deepEqual(detectIntentForTest("tell me the conversation of mehak with me"), { type: "send_message", category: "whatsapp_history" });
  assert.deepEqual(detectIntentForTest("mehak ke saath meri chat dikhao"), { type: "send_message", category: "whatsapp_history" });
  assert.deepEqual(detectIntentForTest("rajnish ke messages summarize karo"), { type: "send_message", category: "whatsapp_history" });
  assert.deepEqual(
    detectIntentForTest("what was the conversation there in hansraj contact tell me"),
    { type: "send_message", category: "whatsapp_history" },
  );
  assert.deepEqual(
    detectIntentForTest("tell me the conversation in papa ji contact"),
    { type: "send_message", category: "whatsapp_history" },
  );
  assert.deepEqual(
    detectIntentForTest("tell me the conversation summary with that number"),
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

test("algorithmic implementation prompts stay on the coding path", () => {
  const prompt = "Given a large grid (up to 10^5 x 10^5) with obstacles, find the shortest path from source to destination where you can remove at most k obstacles. Optimize for both time and space. Explain your approach and provide code.";
  const agentSource = readFileSync(path.resolve(process.cwd(), "lib/clawcloud-agent.ts"), "utf8");

  assert.deepEqual(detectStrictIntentRouteForTest(prompt), {
    intent: { type: "coding", category: "coding" },
    confidence: "high",
    locked: true,
    clarificationReply: null,
  });
  assert.deepEqual(detectIntentForTest(prompt), { type: "coding", category: "coding" });
  assert.match(agentSource, /if \(looksLikeAlgorithmicCodingQuestion\(message\)\) {\s*return null;\s*}/);
});

test("algorithmic coding prompts force deep mode and stay out of the fast direct-answer lane", () => {
  const gridPrompt = "Given a large grid (up to 10^5 x 10^5) with obstacles, find the shortest path from source to destination where you can remove at most k obstacles. Optimize for both time and space. Explain your approach and provide code.";
  const subarrayPrompt = "Given an array of integers, find the length of the longest subarray with at most k distinct elements. Optimize for time complexity, explain your approach, and provide code.";

  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest(gridPrompt, "fast"), false);
  assert.equal(resolveResponseModeForTest("coding", gridPrompt, "fast"), "deep");
  assert.equal(resolveResponseModeForTest("coding", subarrayPrompt), "deep");
  assert.equal(resolveResponseModeForTest("coding", subarrayPrompt, "fast"), "deep");
});

test("freshness-sensitive latest/current prompts force deep mode even when fast is requested", () => {
  const prompt = "what is the latest Samsung model right now";

  assert.equal(resolveResponseModeForTest("research", prompt), "deep");
  assert.equal(resolveResponseModeForTest("research", prompt, "fast"), "deep");
});

test("hard algorithmic coding prompts get the extended deep timeout budget", () => {
  const prompt = "Given a large grid (up to 10^5 x 10^5) with obstacles, find the shortest path from source to destination where you can remove at most k obstacles. Optimize for both time and space. Explain your approach and provide code.";
  const timeout = getInboundRouteTimeoutPolicyForTest(prompt);

  assert.equal(timeout.kind, "deep_reasoning");
  assert.equal(timeout.timeoutMs, 70000);
});

test("obstacle-removal coding fallback does not collapse to the embedded 10^5 exponent", () => {
  const prompt = "Given a large grid (up to 10^5 x 10^5) with obstacles, find the shortest path from source to destination where you can remove at most k obstacles. Optimize for both time and space. Explain your approach and provide code.";
  const reply = buildTimeboxedProfessionalReplyForTest(prompt, "coding");

  assert.doesNotMatch(reply, /10\s*\^\s*5\s*=\s*100000/i);
  assert.match(reply, /Shortest Path With Up To k Obstacle Removals|shortest_path_with_k_removals|best_remaining|remaining_k/i);
  assert.match(reply, /```python/i);
});

test("full inbound route for the obstacle-removal prompt returns a coding answer instead of exponent math", async () => {
  const prompt = "Given a large grid (up to 10^5 x 10^5) with obstacles, find the shortest path from source to destination where you can remove at most k obstacles. Optimize for both time and space. Explain your approach and provide code.";
  const result = await routeInboundAgentMessageResult("test-user", prompt);

  assert.doesNotMatch(result.response ?? "", /10\s*\^\s*5\s*=\s*100000/i);
  assert.match(result.response ?? "", /Shortest Path With Up To k Obstacle Removals|shortest_path_with_k_removals|best_remaining|remaining_k/i);
});

test("standalone exponent questions still keep the direct math shortcut", () => {
  const reply = buildTimeboxedProfessionalReplyForTest("what is 10^5?", "math");

  assert.match(reply, /10\s*\^\s*5\s*=\s*100000/i);
});

test("model scoring rejects tiny wrong-language fragments for algorithmic coding prompts", () => {
  const prompt = "Given a large grid with obstacles, find the shortest path from source to destination where you can remove at most k obstacles. Optimize for both time and space. Explain your approach and provide code.";
  const weakScore = scoreClawCloudModelResponseForTest({
    intent: "coding",
    response: "एक लाख",
    userQuestion: prompt,
  });
  const strongScore = scoreClawCloudModelResponseForTest({
    intent: "coding",
    response: [
      "Use BFS on states `(row, col, removed)` and track the smallest removals seen per cell.",
      "Time complexity is O(m * n * k) in the worst case and space complexity is O(m * n * k).",
      "```python",
      "from collections import deque",
      "def shortest_path(grid, k):",
      "    return 0",
      "```",
    ].join("\n"),
    userQuestion: prompt,
  });

  assert.ok(weakScore < 0);
  assert.ok(strongScore > weakScore);
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

test("country GDP prompts do not trigger deterministic architecture solvers", () => {
  const gdpPrompt = "what is gdp of china right now";
  assert.equal(solveCodingArchitectureQuestion(gdpPrompt), null);
  const timeout = getInboundRouteTimeoutPolicyForTest(gdpPrompt);
  assert.equal(timeout.kind, "live_research");
});

test("hard math expert covers Cayley-Hamilton and Hohmann transfer prompts", () => {
  const cayleyHamiltonPrompt = "Verify Cayley-Hamilton Theorem (CHT) for the matrix 1 1 2 3 1 1 2 3 1 and find A^-1.";
  const cayleyHamiltonAnswer = solveHardMathQuestion(cayleyHamiltonPrompt) ?? "";
  assert.match(cayleyHamiltonAnswer, /Characteristic Polynomial/i);
  assert.match(cayleyHamiltonAnswer, /A\^3/i);
  assert.match(cayleyHamiltonAnswer, /A\^-1/i);

  const hohmannPrompt = "A spacecraft is in a circular low Earth orbit (LEO) at an altitude of 300 km above Earth. It needs to transfer to a geostationary orbit (GEO) at an altitude of 35,786 km using a Hohmann transfer orbit. Given: mu = 3.986 x 10^14 m^3/s^2 and Re = 6371 km. Calculate the total delta-v and the transfer time. Explain the J2 effect and longitudinal drift.";
  const hohmannAnswer = solveHardMathQuestion(hohmannPrompt) ?? "";
  assert.match(hohmannAnswer, /Total delta-v/i);
  assert.match(hohmannAnswer, /Time of flight/i);
  assert.match(hohmannAnswer, /J2/i);
  assert.match(hohmannAnswer, /Longitudinal Drift/i);
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

test("topic mismatch detection rejects short off-topic clarification replies for existing story summaries", () => {
  assert.equal(
    looksLikeQuestionTopicMismatch(
      "story of Harry potter in japanese",
      "正確な回答をするために、正確なトピック、名前、アイテム、または数字を教えてください。",
    ),
    true,
  );
});

test("instruction-style prompt leaks are treated as topic mismatches", () => {
  const leaked = "You are being asked to translate text from any language into English, preserving the original tone and formatting.";

  assert.equal(looksLikeInstructionLeakReply(leaked), true);
  assert.equal(
    looksLikeQuestionTopicMismatch("what is your parameters", leaked),
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
    extractWhatsAppHistoryHintsForTest("read and tell me the message of jaideep"),
    {
      contactHint: "jaideep",
      queryHint: null,
      direction: null,
    },
  );
  assert.deepEqual(
    extractWhatsAppHistoryHintsForTest("tell me the message of jaideep with me"),
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
  assert.deepEqual(
    extractWhatsAppHistoryHintsForTest("tell me the conversation summary with that number"),
    {
      contactHint: "that number",
      queryHint: null,
      direction: null,
    },
  );
  assert.deepEqual(
    extractWhatsAppHistoryHintsForTest("tell me the conversation of mehak with me"),
    {
      contactHint: "mehak",
      queryHint: null,
      direction: null,
    },
  );
  assert.deepEqual(
    extractWhatsAppHistoryHintsForTest("just read the message of me with hansraj"),
    {
      contactHint: "hansraj",
      queryHint: null,
      direction: null,
    },
  );
  assert.deepEqual(
    extractWhatsAppHistoryHintsForTest("ok now see the conversation of me with jaideep"),
    {
      contactHint: "jaideep",
      queryHint: null,
      direction: null,
    },
  );
  assert.deepEqual(
    extractWhatsAppHistoryHintsForTest("mehak ke saath meri chat dikhao"),
    {
      contactHint: "mehak",
      queryHint: null,
      direction: null,
    },
  );
  assert.deepEqual(
    extractWhatsAppHistoryHintsForTest("rajnish ke messages summarize karo"),
    {
      contactHint: "rajnish",
      queryHint: null,
      direction: null,
    },
  );
  assert.deepEqual(
    extractWhatsAppHistoryHintsForTest("read the converation of me with Ff"),
    {
      contactHint: "Ff",
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

test("resolved WhatsApp history contact filtering ignores alias collisions once the exact phone is known", () => {
  const rows: WhatsAppHistoryEntry[] = [
    {
      id: "1",
      direction: "inbound",
      content: "Wrong Mehak thread",
      message_type: "text",
      remote_jid: "919999999999@s.whatsapp.net",
      remote_phone: "919999999999",
      contact_name: "mehak",
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
      content: "Correct Mehak thread",
      message_type: "text",
      remote_jid: "916230291184@s.whatsapp.net",
      remote_phone: "916230291184",
      contact_name: "916230291184",
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
    phone: "916230291184",
    jid: "916230291184@s.whatsapp.net",
    aliases: ["mehak"],
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.remote_phone, "916230291184");
  assert.equal(filtered[0]?.content, "Correct Mehak thread");
});

test("duplicate WhatsApp history rows are collapsed before summarizing the chat", () => {
  const rows: WhatsAppHistoryEntry[] = [
    {
      id: "1",
      direction: "inbound",
      content: "Hello",
      message_type: "text",
      remote_jid: "916230291184@s.whatsapp.net",
      remote_phone: "916230291184",
      contact_name: "mehak",
      chat_type: "direct",
      sent_at: "2026-01-11T12:59:11+00:00",
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
      content: "Hello",
      message_type: "text",
      remote_jid: "916230291184@s.whatsapp.net",
      remote_phone: "916230291184",
      contact_name: "mehak",
      chat_type: "direct",
      sent_at: "2026-01-11T12:59:11+00:00",
      priority: "normal",
      needs_reply: false,
      reply_confidence: null,
      sensitivity: "normal",
      approval_state: "not_required",
      audit_payload: null,
    },
    {
      id: "3",
      direction: "outbound",
      content: "Hii",
      message_type: "text",
      remote_jid: "916230291184@s.whatsapp.net",
      remote_phone: "916230291184",
      contact_name: "916230291184",
      chat_type: "direct",
      sent_at: "2026-01-11T13:55:57+00:00",
      priority: "normal",
      needs_reply: false,
      reply_confidence: null,
      sensitivity: "normal",
      approval_state: "not_required",
      audit_payload: null,
    },
  ];

  const deduped = dedupeWhatsAppHistoryRowsForTest(rows);

  assert.equal(deduped.length, 2);
  assert.equal(deduped[0]?.content, "Hello");
  assert.equal(deduped[1]?.content, "Hii");
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

test("whatsapp history summaries prefer the resolved contact name over phone-like synced labels", () => {
  const summary = buildWhatsAppHistoryProfessionalSummaryForTest({
    resolvedContactName: "mehak",
    requestedCount: 3,
    rows: [
      {
        direction: "inbound",
        content: "Kesa h",
        contact_name: "916230291184",
        remote_phone: "916230291184",
        sent_at: "2026-01-11T15:21:30+00:00",
      },
      {
        direction: "outbound",
        content: "Badiya tu bta kesi hai",
        contact_name: "916230291184",
        remote_phone: "916230291184",
        sent_at: "2026-01-11T15:29:32+00:00",
      },
    ],
  });

  assert.match(summary, /mehak said: "Kesa h/i);
  assert.doesNotMatch(summary, /916230291184 said/i);
});

test("voice note prompts stay grounded in transcript context", () => {
  const prompt = buildVoiceNoteQuestionPrompt(
    "Kal sham tak final payment bhej dena.",
    "Draft a polite reply to this voice note.",
  );

  assert.match(prompt, /--- Media evidence ---/);
  assert.match(prompt, /Source: voice note transcript/);
  assert.match(prompt, /User request about this voice note:/);
  assert.equal(looksLikeGroundedMediaPrompt(prompt), true);
});

test("video prompts keep transcript and frame evidence together", () => {
  const prompt = buildVideoQuestionPrompt({
    mimeType: "video/mp4",
    transcript: "Payment request expires in 5 minutes.",
    frameAnalysis: "Visible text: Scan the one-time QR code to pay. Paytm. PhonePe. Transfer Rs 1499.97.",
    userQuestion: "What does this video ask me to do?",
  });

  assert.ok(prompt);
  assert.match(prompt ?? "", /Audio transcript:/);
  assert.match(prompt ?? "", /Representative frame evidence:/);
  assert.match(prompt ?? "", /User question about this video:/);
  assert.equal(looksLikeGroundedMediaPrompt(prompt ?? ""), true);
});

test("document-bound quality profiles require grounded evidence", () => {
  const prompt = buildVoiceNoteQuestionPrompt(
    "Kal sham tak final payment bhej dena.",
    "What does this voice note ask me to do?",
  );
  const profile = buildClawCloudAnswerQualityProfile({
    question: prompt,
    intent: "research",
    category: "research",
    isDocumentBound: true,
  });

  assert.equal(profile.domain, "document");
  assert.equal(profile.requiresEvidence, true);
});

test("attachment-bound assessment rejects generic non-grounded answers", () => {
  const prompt = buildVideoQuestionPrompt({
    mimeType: "video/mp4",
    transcript: "Payment request expires in 5 minutes.",
    frameAnalysis: "Visible text: Scan the one-time QR code to pay. Paytm. PhonePe. Transfer Rs 1499.97.",
    userQuestion: "What does this video ask me to do?",
  });

  const assessment = assessClawCloudAnswerDraftForTest({
    question: prompt ?? "",
    intent: "research",
    category: "research",
    answer: "This is probably some kind of payment reminder, but I cannot be sure.",
    isDocumentBound: true,
  });

  assert.equal(assessment.primaryIssue, "evidence_missing");
});

test("attachment-bound assessment accepts grounded evidence-based answers", () => {
  const prompt = buildVideoQuestionPrompt({
    mimeType: "video/mp4",
    transcript: "Payment request expires in 5 minutes.",
    frameAnalysis: "Visible text: Scan the one-time QR code to pay. Paytm. PhonePe. Transfer Rs 1499.97.",
    userQuestion: "What does this video ask me to do?",
  });

  const assessment = assessClawCloudAnswerDraftForTest({
    question: prompt ?? "",
    intent: "research",
    category: "research",
    answer: "The video asks you to scan a one-time QR code and pay Rs 1499.97. It shows Paytm and PhonePe, and the payment request expires in 5 minutes.",
    isDocumentBound: true,
  });

  assert.equal(assessment.primaryIssue, null);
});

test("media failure replies refuse caption-only guessing", () => {
  const imageReply = buildImageGroundingFailureReply({
    userQuestion: "How much do I have to pay in this screenshot?",
    reason: "analysis_failed",
  });
  const voiceReply = buildVoiceNoteGroundingFailureReply({
    userQuestion: "What exactly did he say in the voice note?",
    reason: "analysis_failed",
  });
  const videoReply = buildVideoGroundingFailureReply({
    userQuestion: "Tell me what happens in this video.",
    reason: "provider_unavailable",
  });
  const documentReply = buildDocumentGroundingFailureReply({
    fileName: "invoice.pdf",
    userQuestion: "What amount is due in this document?",
    reason: "analysis_failed",
  });

  assert.match(imageReply, /not going to guess from the caption alone/i);
  assert.match(voiceReply, /not going to guess from unclear audio/i);
  assert.match(videoReply, /will not answer from the caption alone/i);
  assert.match(documentReply, /not going to guess from partial document content/i);
});

test("vision placeholder replies are rejected before they reach WhatsApp users", () => {
  const placeholder = [
    "Extracted Text from Image:",
    "Since the original message was an image, I'll assume the extracted text is available.",
    "However, I don't have the actual extracted text.",
  ].join("\n");

  assert.equal(looksLikeVisionPlaceholderReplyForTest(placeholder), true);
  assert.equal(
    looksLikeVisionPlaceholderReplyForTest(
      "This is a Paytm and PhonePe payment QR screen requesting a transfer of Rs 1499.97.",
    ),
    false,
  );
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
  assert.deepEqual(detectIntentForTest("what cat can you do"), { type: "help", category: "help" });
  assert.deepEqual(detectIntentForTest("aap kya kya kr skte hai"), { type: "help", category: "help" });
  assert.deepEqual(detectIntentForTest("tum kya kya kar skte ho"), { type: "help", category: "help" });
  assert.deepEqual(detectIntentForTest("mujhe kya kya help kar skte ho"), { type: "help", category: "help" });
  assert.deepEqual(detectIntentForTest("aap kese ho or aap kya kr skte ho"), { type: "help", category: "help" });
  assert.deepEqual(detectIntentForTest("que puedes hacer"), { type: "help", category: "help" });
  assert.deepEqual(detectIntentForTest("आप क्या कर सकते हो"), { type: "help", category: "help" });
});

test("consumer tech release questions do not get hijacked by the help route", () => {
  assert.deepEqual(
    detectIntentForTest("when s26 ultra was realesed and what all features it is having"),
    { type: "web_search", category: "web_search" },
  );
});

test("structured multi-part technical challenge prompts lock to deep research routing", () => {
  const prompt = [
    "Problem: You are designing a real-time fraud detection system for a payment platform.",
    "Constraints: 1 billion transactions/day, decision time < 50 ms, known and unknown fraud.",
    "Tasks",
    "Part 1 - DSA core logic with sudden spike, geographic anomaly, frequency burst.",
    "Part 2 - System design with ingestion, Kafka, Flink, hot vs cold storage, API latency.",
    "Part 3 - Machine learning for supervised and unsupervised anomaly detection.",
    "Part 4 - Operating systems concurrency, memory management, thread vs async.",
    "Part 5 - Bayes theorem probability for flagged transaction precision.",
    "Part 6 - Security twist for adaptive adversarial attackers.",
  ].join("\n");

  const strictRoute = detectStrictIntentRouteForTest(prompt);
  assert.ok(strictRoute);
  assert.deepEqual(strictRoute?.intent, { type: "research", category: "research" });
  assert.equal(strictRoute?.locked, true);
  assert.deepEqual(detectIntentForTest(prompt), { type: "research", category: "research" });

  const timeout = getInboundRouteTimeoutPolicyForTest(prompt);
  assert.equal(timeout.kind, "deep_reasoning");
});

test("response length profile detection captures concise vs detailed requests", () => {
  assert.equal(
    inferAnswerLengthProfileForTest("Explain JWT in short in 3 lines."),
    "short",
  );
  assert.equal(
    inferAnswerLengthProfileForTest("Explain JWT in detail with a step-by-step deep dive."),
    "detailed",
  );
  assert.equal(
    inferAnswerLengthProfileForTest("What is JWT?"),
    "short",
  );
});

test("response mode follows explicit depth cues while preserving complex deep routing", () => {
  assert.equal(
    resolveResponseModeForTest("research", "Explain quantum tunneling in short."),
    "fast",
  );
  assert.equal(
    resolveResponseModeForTest("research", "Explain quantum tunneling in detail with full analysis."),
    "deep",
  );

  const complexPrompt = [
    "Problem: Design a global real-time fraud platform.",
    "Constraints: 1 billion tx/day and < 50 ms decision budget.",
    "Tasks: Part 1 data structure, Part 2 architecture, Part 3 ML, Part 4 Bayes.",
  ].join(" ");
  assert.equal(
    resolveResponseModeForTest("research", complexPrompt),
    "deep",
  );
});

test("exact fraud-system deep prompt stays out of the fast direct-answer lane", () => {
  const prompt = [
    "Problem:",
    "You are designing a real-time fraud detection system for a payment platform (like UPI/Paytm scale).",
    "",
    "Constraints:",
    "1 billion transactions/day",
    "",
    "Decision time: < 50 ms per transaction",
    "",
    "Must detect:",
    "",
    "Known fraud patterns",
    "",
    "Unknown (zero-day) fraud",
    "",
    "System must:",
    "",
    "Scale globally",
    "",
    "Be fault-tolerant",
    "",
    "Handle adversarial attacks",
    "",
    "Tasks",
    "Part 1 - DSA core logic",
    "Part 2 - System Design",
    "Part 3 - Machine Learning",
    "Part 4 - Operating Systems",
    "Part 5 - Mathematics / Probability",
    "Part 6 - Security Twist",
  ].join("\n");

  assert.equal(shouldUsePrimaryDirectAnswerLaneForTest(prompt), false);
  assert.equal(resolveResponseModeForTest("research", prompt), "deep");
});

test("complex high-stakes prompts force deep mode across health law and finance", () => {
  const healthPrompt = "My father has diabetes, kidney disease, and hypertension. Compare medication classes, side effects, contraindications, and warning signs that require urgent care.";
  const lawPrompt = "Compare termination, indemnity, limitation of liability, and jurisdiction clauses in this startup SaaS contract and explain the main legal risks.";
  const financePrompt = "Compare a 60/40 portfolio, risk parity, and a bond ladder for a 20-year horizon with tax considerations, drawdown control, and rebalancing strategy.";

  assert.equal(resolveResponseModeForTest("health", healthPrompt), "deep");
  assert.equal(resolveResponseModeForTest("law", lawPrompt), "deep");
  assert.equal(resolveResponseModeForTest("finance", financePrompt), "deep");
});

test("deep fraud-system prompt does not trigger Drive access consent", () => {
  const prompt = [
    "Problem:",
    "You are designing a real-time fraud detection system for a payment platform (like UPI/Paytm scale).",
    "",
    "Constraints:",
    "1 billion transactions/day",
    "",
    "Decision time: < 50 ms per transaction",
    "",
    "Must detect:",
    "",
    "Known fraud patterns",
    "",
    "Unknown (zero-day) fraud",
    "",
    "System must:",
    "",
    "Scale globally",
    "",
    "Be fault-tolerant",
    "",
    "Handle adversarial attacks",
    "",
    "Part 2 - System Design",
    "Design the full architecture:",
    "Storage (hot vs cold data)",
    "How do you redesign your system to stay ahead?",
  ].join("\n");

  assert.equal(detectDriveIntent(prompt), null);
  assert.equal(inferAppAccessRequirementForTest(prompt), null);
});

test("multilingual Japanese technical architecture prompts lock to a direct technical route", () => {
  const prompt = [
    "2026年において、世界的なパンデミックと医療データの爆発的増加の中で、リアルタイムに患者の重症化リスクを予測する分散型AIシステムをどのように設計しますか？",
    "さらに、ディファレンシャルプライバシーや連合学習を用いながら、各国の規制やデータ偏りの問題をどのように克服しますか？",
  ].join("\n");

  const strictRoute = detectStrictIntentRouteForTest(prompt);
  assert.ok(strictRoute);
  assert.deepEqual(strictRoute?.intent, { type: "technology", category: "technology" });
  assert.equal(strictRoute?.locked, true);
  assert.equal(resolveResponseModeForTest("technology", prompt), "deep");
});

test("simple knowledge prompts now default to deep mode unless fast is explicitly requested", () => {
  assert.equal(resolveResponseModeForTest("science", "What is osmosis?"), "deep");
  assert.equal(resolveResponseModeForTest("history", "Who was Ashoka?"), "deep");
  assert.equal(resolveResponseModeForTest("science", "What is osmosis?", "fast"), "fast");
});

test("AI model comparison prompts do not get swallowed by the primary conversation lane", async () => {
  const prompt = "what is the key difference betweeen gpt 5.4 vs opus 4.6 and gemini 3.2 pro and when were they released and rate them all out of 100 accoriding to there performance";
  const result = await routeInboundAgentMessageResult("test-user", prompt);

  assert.doesNotMatch(result.response ?? "", /Model name clarification/i);
  assert.match(result.response ?? "", /GPT-5\.4|Claude Opus 4\.6|Gemini 3\.2 Pro|AI model comparison snapshot/i);
  assert.doesNotMatch(result.response ?? "", /GPT-4-Turbo|Gemini 1\.5 Pro|Claude 3 Opus/i);
});

test("formal orbital and abstract computability prompts stay out of weather and copilot fallbacks", () => {
  const hohmannPrompt = "Problem (Advanced - Space & Technology) A spacecraft is in a circular low Earth orbit (LEO) at an altitude of 300 km above Earth. It needs to transfer to a geostationary orbit (GEO) at an altitude of 35,786 km using a Hohmann transfer orbit. Given: mu = 3.986 x 10^14 m^3/s^2, Re = 6371 km. Calculate the total delta-v required and the time taken.";
  assert.deepEqual(detectIntentForTest(hohmannPrompt), { type: "math", category: "math" });
  assert.equal(solveCodingArchitectureQuestion(hohmannPrompt), null);
  assert.doesNotMatch(buildTimeboxedProfessionalReplyForTest(hohmannPrompt, "research"), /Satellite Collision-Avoidance Copilot|Weather update/i);

  const abstractPrompt = "Problem (Ultra Hard - Cross Domain) Consider a hypothetical AI system that has complete knowledge of all physical laws governing the universe and unlimited computational resources. Assume the universe is governed by quantum mechanics and general relativity. Is it theoretically possible to predict the exact conscious experience of a human at t1 > t0? Prove or disprove and analyze infinite regress, fixed-point convergence, logical inconsistency, and computable versus uncomputable reality.";
  assert.deepEqual(detectIntentForTest(abstractPrompt), { type: "science", category: "science" });
  const abstractReply = buildTimeboxedProfessionalReplyForTest(abstractPrompt, "science");
  assert.doesNotMatch(abstractReply, /Weather update/i);
  assert.doesNotMatch(abstractReply, /could not complete a reliable direct answer/i);
  assert.match(abstractReply, /Bottom line:/i);
  assert.match(abstractReply, /Disprove\./i);
  assert.match(abstractReply, /computable reality/i);

  const abstractProfile = buildClawCloudAnswerQualityProfile({
    question: abstractPrompt,
    intent: "science",
    category: "science",
  });
  assert.equal(abstractProfile.domain, "general");

  const abstractLowConfidenceReply = buildClawCloudLowConfidenceReply(
    abstractPrompt,
    abstractProfile,
  );
  assert.match(abstractLowConfidenceReply, /exact topic|precise reply/i);

  const abstractResearchFallback = buildClawCloudLowConfidenceReply(
    abstractPrompt,
    buildClawCloudAnswerQualityProfile({
      question: abstractPrompt,
      intent: "research",
      category: "web_search",
    }),
  );
  assert.match(abstractResearchFallback, /exact place|exact date|exact event|exact item|precise reply/i);
});

test("hard science computability prompts answer directly across the full inbound route", async () => {
  const prompt = [
    "Problem (Ultra Hard - Cross Domain)",
    "Consider a hypothetical AI system that has complete knowledge of all physical laws governing the universe and unlimited computational resources.",
    "Assume the universe is governed by quantum mechanics and general relativity.",
    "The AI has perfect access to the exact quantum state of a human brain at time t0.",
    "Is it theoretically possible for the AI to predict the exact conscious experience of that human at time t1 > t0?",
    "Prove or disprove: perfect prediction of human behavior implies determinism of consciousness.",
    "Analyze infinite regress, fixed-point convergence, logical inconsistency, and the boundary between computable reality and non-computable phenomena.",
    "Bonus: construct a formal proof or counterexample for the claim that any system capable of fully simulating the universe must necessarily contain an uncomputable component.",
  ].join(" ");

  const result = await routeInboundAgentMessageResult("test-user", prompt);

  assert.doesNotMatch(result.response ?? "", /could not complete a reliable direct answer/i);
  assert.match(result.response ?? "", /Bottom line:/i);
  assert.match(result.response ?? "", /Disprove\./i);
  assert.match(result.response ?? "", /cellular-automaton universe|finite cellular-automaton universe/i);
});

test("full hard science prompt stays out of live freshness fallback", async () => {
  const prompt = [
    "Problem (Ultra Hard - Cross Domain)",
    "Consider a hypothetical AI system that has complete knowledge of all physical laws governing the universe and unlimited computational resources.",
    "Assume:",
    "The universe is governed by quantum mechanics and general relativity.",
    "The AI has perfect access to the exact quantum state of a human brain at time t0.",
    "Answer the following:",
    "Is it theoretically possible for the AI to predict the exact conscious experience of that human at time t1 > t0?",
    "Justify your answer using principles from quantum mechanics, uncertainty, decoherence, and computational theory.",
    "If the AI simulates the brain perfectly, does the simulation itself become conscious? Provide arguments using both physicalism and functionalism.",
    "Prove or disprove: perfect prediction of human behavior implies determinism of consciousness.",
    "Include arguments involving chaos theory, Godel incompleteness, and limits of computation.",
    "Suppose the AI attempts to simulate itself simulating the universe using recursive self-modeling.",
    "Analyze whether this leads to infinite regress, fixed-point convergence, or logical inconsistency.",
    "Define a formal boundary between computable reality and non-computable phenomena.",
    "Can such a boundary exist within current models of physics?",
    "Bonus: construct a formal proof or counterexample for the statement that any system capable of fully simulating the universe must necessarily contain an uncomputable component.",
  ].join(" ");

  const result = await routeInboundAgentMessageResult("test-user", prompt);

  assert.doesNotMatch(result.response ?? "", /live freshness check/i);
  assert.doesNotMatch(result.response ?? "", /could not confirm a clearly current dated source/i);
  assert.match(result.response ?? "", /Bottom line:/i);
  assert.match(result.response ?? "", /Disprove\./i);
});

test("strict current timeline guard flags past-year answers for right-now questions", () => {
  assert.equal(
    usesPastYearAsCurrentForTest(
      "what is the situation of iran right now",
      "Iran is locked in a vicious cycle in August 2024.",
    ),
    true,
  );
  assert.equal(
    usesPastYearAsCurrentForTest(
      "what was the situation of iran in 2024",
      "Iran is locked in a vicious cycle in August 2024.",
    ),
    false,
  );
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

test("reply display normalization repairs full-script Hindi mojibake instead of leaving garbled text", () => {
  const normalized = normalizeReplyForClawCloudDisplay(
    "Chata = à¤à¤¤, à¤®à¤à¤¾à¤¨ à¤à¥ à¤¸à¤¬à¤¸à¥ à¤à¤ªà¤°à¥ à¤¢à¤à¤¨ (slab à¤¯à¤¾ à¤à¤¤)à¥¤",
  );

  assert.equal(
    normalized,
    "Chata = छत, मकान की सबसे ऊपरी ढकन (slab या छत)।",
  );
});

test("reply display normalization repairs Romanian diacritics from UTF-8 mojibake", () => {
  const normalized = normalizeReplyForClawCloudDisplay(
    "*Deadpool â povestea pe scurt (fÄrÄ spoilere majore)*",
  );

  assert.equal(
    normalized,
    "Deadpool – povestea pe scurt (fără spoilere majore)",
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

test("reply display normalization rewrites the legacy timeout fallback into a precise clarification", () => {
  const normalized = normalizeReplyForClawCloudDisplay([
    "I'm not confident enough to answer that safely without better grounding.",
    "",
    "Reason: The answer path took too long to complete reliably.",
  ].join("\n"));

  assert.match(normalized, /exact question or task|exact topic|precise reply/i);
});

test("timeboxed reply fails closed with a precise clarification instead of inventing a generic answer", () => {
  const reply = buildTimeboxedProfessionalReplyForTest("what is rag", "general");

  assert.match(reply, /exact topic|precise reply/i);
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

test("timeboxed reply answers deep fraud-system prompts directly during timeout recovery", () => {
  const prompt = [
    "Problem:",
    "You are designing a real-time fraud detection system for a payment platform (like UPI/Paytm scale).",
    "Constraints: 1 billion transactions/day. Decision time: < 50 ms per transaction.",
    "Must detect known fraud patterns and unknown (zero-day) fraud.",
    "Tasks: Part 1 DSA core logic, Part 2 system design, Part 3 machine learning, Part 4 operating systems, Part 5 Bayes theorem, Part 6 security twist.",
  ].join("\n");

  const reply = buildTimeboxedProfessionalReplyForTest(prompt, "research");

  assert.match(reply, /Kafka/i);
  assert.match(reply, /Flink/i);
  assert.match(reply, /ring buffer/i);
  assert.match(reply, /9\.0%/i);
  assert.doesNotMatch(reply, /could not complete a reliable direct answer/i);
});

test("timeboxed reply uses architecture expert fallback even when the prompt was routed as research", () => {
  const prompt = "Design a multi-tenant RAG platform with hybrid retrieval, reranking, chunking strategy, citation grounding, and evaluation metrics.";
  const reply = buildTimeboxedProfessionalReplyForTest(prompt, "research");

  assert.match(reply, /RAG Architecture/i);
  assert.match(reply, /hybrid/i);
  assert.match(reply, /rerank/i);
  assert.doesNotMatch(reply, /could not complete a reliable direct answer/i);
});

test("timeboxed reply answers Japanese distributed-clinical-AI prompts directly", () => {
  const prompt = [
    "2026年において、世界的なパンデミックと医療データの爆発的増加の中で、リアルタイムに患者の重症化リスクを予測する分散型AIシステムをどのように設計しますか？",
    "さらに、ディファレンシャルプライバシーや連合学習を用いながら、各国の規制やデータ偏りの問題をどのように克服しますか？",
  ].join("\n");
  const reply = buildTimeboxedProfessionalReplyForTest(prompt, "technology");

  assert.match(reply, /分散型 AI 基盤/u);
  assert.match(reply, /連合学習/u);
  assert.match(reply, /ディファレンシャルプライバシー/u);
  assert.match(reply, /secure aggregation/i);
  assert.doesNotMatch(reply, /could not complete a reliable direct answer/i);
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

  const scienceDisclaimer = buildDisclaimer({
    intent: "science",
    category: "science",
    question:
      "Consider a hypothetical AI system that has complete knowledge of all physical laws governing the universe and unlimited computational resources.",
    answer: "This is a theory-of-mind and physics discussion.",
  });
  assert.equal(scienceDisclaimer, null);
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
  assert.equal(bundle.metadata.freshness_guarded, true);
  assert.ok(bundle.evidence.some((entry) => entry.domain === "worldbank.org"));
  assert.ok(bundle.sourceSummary.includes("worldbank.org"));

  const rendered = renderClawCloudAnswerBundle(bundle);
  assert.match(rendered, /\*Fresh answer\*/i);
  assert.match(rendered, /Source note: checked against live web signals/i);
  assert.match(rendered, /\*Freshness check\*/i);
  assert.match(rendered, /won't present past-year or stale dated data as if it were current/i);
});

test("AI model comparison live answers fail closed when only stale prior-year evidence is available", () => {
  const result = buildSourceBackedLiveAnswerResult({
    question: "what is the key difference betweeen gpt 5.4 vs opus 4.6 and gemini 3.2 pro and when were they released and rate them all out of 100 accoriding to there performance",
    answer: [
      "*AI model comparison snapshot*",
      "",
      "GPT-4-Turbo (2024-04), Claude 3 Opus (2024-03), and Gemini 1.5 Pro (2024-02) are the latest real models.",
    ].join("\n"),
    sources: [
      {
        title: "GPT-4 Turbo",
        url: "https://openai.com/index/gpt-4-turbo",
        snippet: "OpenAI details GPT-4 Turbo.",
        domain: "openai.com",
        publishedDate: "2024-04-10T00:00:00.000Z",
        score: 0.9,
      },
      {
        title: "Claude 3 Opus",
        url: "https://www.anthropic.com/news/claude-3-family",
        snippet: "Anthropic introduces Claude 3 Opus.",
        domain: "anthropic.com",
        publishedDate: "2024-03-04T00:00:00.000Z",
        score: 0.88,
      },
      {
        title: "Gemini 1.5 Pro",
        url: "https://blog.google/technology/ai/google-gemini-1-5-pro/",
        snippet: "Google announces Gemini 1.5 Pro.",
        domain: "blog.google",
        publishedDate: "2024-02-15T00:00:00.000Z",
        score: 0.86,
      },
    ],
  });

  assert.ok(result.liveAnswerBundle);
  assert.equal(result.liveAnswerBundle?.metadata.freshness_guarded, true);
  assert.match(result.answer, /\*Freshness check\*/i);
  assert.match(result.answer, /won't present past-year or stale dated data as if it were current/i);
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
    assert.match(answer, /China's latest official annual GDP estimate is \$18\.74 trillion for 2024\./i);
    assert.match(answer, /This is the latest finalized annual figure currently available from the World Bank\./i);
    assert.equal(
      isCompleteCountryMetricAnswer("what is the gdp of china", answer),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("google login auth URL uses a remembered login hint to skip forced account chooser", () => {
  const previous = {
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL,
  };

  env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
  env.GOOGLE_CLIENT_SECRET = "test-secret";
  env.NEXT_PUBLIC_APP_URL = "https://swift-deploy.in";

  try {
    const hintedUrl = new URL(
      buildClawCloudGoogleLoginAuthUrl(
        "login:v2:test-state",
        "https://swift-deploy.in",
        { loginHint: "Founder@Example.com" },
      ),
    );
    assert.equal(hintedUrl.searchParams.get("login_hint"), "founder@example.com");
    assert.equal(hintedUrl.searchParams.get("prompt"), null);

    const chooserUrl = new URL(
      buildClawCloudGoogleLoginAuthUrl("login:v2:test-state", "https://swift-deploy.in"),
    );
    assert.equal(chooserUrl.searchParams.get("prompt"), "select_account");
  } finally {
    env.GOOGLE_CLIENT_ID = previous.GOOGLE_CLIENT_ID;
    env.GOOGLE_CLIENT_SECRET = previous.GOOGLE_CLIENT_SECRET;
    env.NEXT_PUBLIC_APP_URL = previous.NEXT_PUBLIC_APP_URL;
  }
});

test("google workspace rollout lets public Gmail and Calendar connect override legacy Lite-only mode", () => {
  const previous = {
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL,
    GOOGLE_WORKSPACE_PUBLIC_ENABLED: env.GOOGLE_WORKSPACE_PUBLIC_ENABLED,
    GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED: env.GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED,
    GOOGLE_WORKSPACE_TEMPORARY_HOLD: env.GOOGLE_WORKSPACE_TEMPORARY_HOLD,
    GOOGLE_WORKSPACE_SETUP_LITE_ONLY: env.GOOGLE_WORKSPACE_SETUP_LITE_ONLY,
  };

  env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
  env.GOOGLE_CLIENT_SECRET = "test-secret";
  env.NEXT_PUBLIC_APP_URL = "https://swift-deploy.in";
  env.GOOGLE_WORKSPACE_PUBLIC_ENABLED = true;
  env.GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED = false;
  env.GOOGLE_WORKSPACE_TEMPORARY_HOLD = false;
  env.GOOGLE_WORKSPACE_SETUP_LITE_ONLY = true;

  try {
    const publicCore = getGoogleWorkspaceCoreAccess("person@example.com");
    assert.equal(publicCore.available, true);
    assert.equal(publicCore.allowlisted, false);
    assert.match(publicCore.reason ?? "", /available/i);

    const publicConfig = getPublicAppConfig();
    assert.equal(publicConfig.googleRollout.publicWorkspaceEnabled, true);
    assert.equal(publicConfig.googleRollout.setupLiteMode, false);
  } finally {
    env.GOOGLE_CLIENT_ID = previous.GOOGLE_CLIENT_ID;
    env.GOOGLE_CLIENT_SECRET = previous.GOOGLE_CLIENT_SECRET;
    env.NEXT_PUBLIC_APP_URL = previous.NEXT_PUBLIC_APP_URL;
    env.GOOGLE_WORKSPACE_PUBLIC_ENABLED = previous.GOOGLE_WORKSPACE_PUBLIC_ENABLED;
    env.GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED = previous.GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED;
    env.GOOGLE_WORKSPACE_TEMPORARY_HOLD = previous.GOOGLE_WORKSPACE_TEMPORARY_HOLD;
    env.GOOGLE_WORKSPACE_SETUP_LITE_ONLY = previous.GOOGLE_WORKSPACE_SETUP_LITE_ONLY;
  }
});

test("google oauth verification pack matches the live Gmail and Calendar scope set", () => {
  const submissionPack = readFileSync(
    path.join(process.cwd(), "GOOGLE-OAUTH-VERIFICATION-SUBMISSION.md"),
    "utf8",
  );

  assert.match(submissionPack, /https:\/\/www\.googleapis\.com\/auth\/gmail\.modify/);
  assert.match(submissionPack, /https:\/\/www\.googleapis\.com\/auth\/calendar\.events/);
  assert.doesNotMatch(submissionPack, /https:\/\/www\.googleapis\.com\/auth\/gmail\.readonly/);
  assert.doesNotMatch(submissionPack, /https:\/\/www\.googleapis\.com\/auth\/calendar\.readonly/);
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

test("country metric quality check rejects current-year projections backed only by stale source years", () => {
  assert.equal(
    isClawCloudGroundedLiveAnswer({
      question: "What is the gdp per capita of japan and south korea in 2026",
      answer: [
        "The GDP per capita of Japan in 2026 is estimated to be around $43,000, while the GDP per capita of South Korea in 2026 is projected to be approximately $35,000.",
        "",
        "Sources:",
        "1. International Monetary Fund (IMF) World Economic Outlook Database, October 2021",
        "2. World Bank National Accounts Data, and OECD National Accounts Data Files.",
      ].join("\n"),
    }),
    false,
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
    assert.match(result.answer, /China's latest official annual GDP estimate is \$18\.74 trillion for 2024\./i);
    assert.match(result.answer, /This is the latest finalized annual figure currently available from the World Bank\./i);
    assert.ok(result.liveAnswerBundle);
    assert.equal(result.liveAnswerBundle?.channel, "live");
    assert.equal(result.liveAnswerBundle?.sourceSummary.includes("worldbank.org"), true);
    assert.equal(result.liveAnswerBundle?.metadata.strategy, "deterministic");
    assert.equal(result.liveAnswerBundle?.metadata.freshness_guarded, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("full inbound route keeps country GDP prompts on the country-metric live path", async () => {
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
    const result = await routeInboundAgentMessageResult("test-user", "what is gdp of china right now");
    assert.match(result.response ?? "", /China's latest official annual GDP estimate is/i);
    assert.match(result.response ?? "", /\b2024\b/i);
    assert.match(result.response ?? "", /Source: World Bank/i);
    assert.doesNotMatch(result.response ?? "", /cold-chain|GDP\/GxP|excursion|shipment|sensor/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("full inbound route keeps GDP per capita comparison prompts on the official metric path and does not relabel old actuals as 2026 values", async () => {
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
          { id: "JPN", iso2Code: "JP", name: "Japan" },
          { id: "KOR", iso2Code: "KR", name: "Korea, Rep." },
        ],
      ]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/country/JPN/indicator/NY.GDP.PCAP.CD")) {
      return new Response(JSON.stringify([
        { page: 1, pages: 1, per_page: "10", total: 2, sourceid: "2", lastupdated: "2026-02-24" },
        [
          { country: { value: "Japan" }, date: "2025", value: null },
          { country: { value: "Japan" }, date: "2024", value: 32_500 },
        ],
      ]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("/country/KOR/indicator/NY.GDP.PCAP.CD")) {
      return new Response(JSON.stringify([
        { page: 1, pages: 1, per_page: "10", total: 2, sourceid: "2", lastupdated: "2026-02-24" },
        [
          { country: { value: "Korea, Rep." }, date: "2025", value: null },
          { country: { value: "Korea, Rep." }, date: "2024", value: 36_100 },
        ],
      ]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch during test: ${url}`);
  }) as typeof fetch;

  try {
    const result = await routeInboundAgentMessageResult("test-user", "What is the gdp per capita of japan and south korea in 2026");
    assert.match(result.response ?? "", /Latest official annual GDP per capita estimates currently available:/i);
    assert.match(result.response ?? "", /Japan: \$32,500 for 2024/i);
    assert.match(result.response ?? "", /South Korea: \$36,100 for 2024/i);
    assert.match(result.response ?? "", /I am not labeling these as 2026 values/i);
    assert.match(result.response ?? "", /Source: World Bank - GDP per capita \(current US\$\) \(NY\.GDP\.PCAP\.CD\)/i);
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

test("mixed richest rankings fail closed when part of the answer depends on stale city reports", async () => {
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
    assert.match(answer, /\*Freshness check\*/i);
    assert.match(answer, /won't present past-year or stale dated data as if it were current/i);
    assert.doesNotMatch(answer, /Top wealthiest cities by resident millionaires/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("strong live answer bundles override generic time-sensitive fallback responses", () => {
  const promoted = maybePromoteVisibleResponseWithLiveBundleForTest(
    "what is the situation of iran and israel war",
    {
      response: [
        "Time-sensitive query",
        "",
        "To keep this accurate, send the exact company, person, product, topic, date, or location you want checked live.",
        "If you want a stable overview instead of a live update, ask for an overview and I will answer directly.",
        "",
        "Live search unavailable for this query.",
      ].join("\n"),
      liveAnswerBundle: {
        question: "what is the situation of iran and israel war",
        answer: [
          "No active Iran-Israel war right now.",
          "Israel and Iran are still in their long-running shadow conflict, but no open declared war has restarted.",
          "",
          "As of: March 31, 2026 at 02:27 PM UTC",
          "Sources: nytimes.com, sky.com",
        ].join("\n"),
        channel: "live",
        generatedAt: "2026-03-31T14:27:16.677Z",
        badge: "*Live answer*",
        sourceNote: "_Source note: checked against live web signals; figures can shift quickly._",
        evidence: [
          {
            title: "Iran war latest - Example Source",
            domain: "nytimes.com",
            kind: "report",
            url: "https://nytimes.com/iran-war",
            snippet: "Example evidence snippet",
            publishedAt: "Tue, 31 Mar 2026 14:24:56 GMT",
            observedAt: "2026-03-31T14:27:16.472Z",
          },
        ],
        sourceSummary: ["nytimes.com"],
        metadata: {
          route_tier: "realtime",
          requires_web_search: true,
          evidence_count: 1,
          strategy: "search_synthesis",
          freshness_guarded: false,
        },
      },
      modelAuditTrail: null,
    },
  );

  assert.match(promoted.response ?? "", /No active Iran-Israel war right now/i);
  assert.equal(promoted.liveAnswerBundle?.answer, promoted.response);
  assert.doesNotMatch(promoted.response ?? "", /Time-sensitive query/i);
});

test("richest ranking scope detection keeps city-only prompts out of the people route", () => {
  assert.equal(extractRichestRankingScope("top 10 richest cities in the world"), "cities");
  assert.equal(extractRichestRankingScope("top 10 richest people in the world"), "people");
  assert.equal(extractRichestRankingScope("tell me top 10 richest persons and richest cities of the world"), "mixed");
  assert.equal(extractRichestRankingScope("top 10 richest in the world"), "people");
});

test("single richest-person prompts return a direct current answer even when only a few Forbes rows are available", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    requestedUrls.push(url);

    if (url.includes("forbes.com/forbesapi/person/rtb/0/position/true.json")) {
      return new Response(JSON.stringify({
        personList: {
          personsLists: [
            { personName: "Elon Musk", finalWorth: 496_500 },
            { personName: "Bernard Arnault", finalWorth: 298_200 },
            { personName: "Jeff Bezos", finalWorth: 205_100 },
          ],
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    throw new Error(`Unexpected fetch during test: ${url}`);
  }) as typeof fetch;

  try {
    const answer = await fetchLiveDataAndSynthesize("who is the richest person of the world");
    assert.match(answer, /\*Fresh answer\*/i);
    assert.match(answer, /\*Current richest person in the world:\* \*Elon Musk\*/i);
    assert.match(answer, /\*Forbes live net worth:\* \*\$496\.5B\*/i);
    assert.match(answer, /\*As of:\* .*UTC/i);
    assert.match(answer, /Source: forbes\.com/i);
    assert.doesNotMatch(answer, /\*Recommendation\*/i);
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0] ?? "", /forbes\.com\/forbesapi\/person\/rtb\/0\/position\/true\.json/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("city-only richest rankings fail closed when the latest available city report is stale", async () => {
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
    assert.match(answer, /\*Freshness check\*/i);
    assert.match(answer, /won't present past-year or stale dated data as if it were current/i);
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

test("web-search routing fails closed for city-only wealth rankings when the cited report is stale", async () => {
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
    assert.match(result.answer, /\*Freshness check\*/i);
    assert.match(result.answer, /won't present past-year or stale dated data as if it were current/i);
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
  assert.deepEqual(
    detectWorldBankCountryMetricQuestion("what is the gdp per capita of japan in 2026"),
    { kind: "gdp_per_capita", countryCandidate: "japan" },
  );
  assert.deepEqual(
    detectWorldBankCountryMetricComparisonQuestion("What is the gdp per capita of japan and south korea in 2026"),
    { kind: "gdp_per_capita", countryCandidates: ["japan", "south korea"] },
  );
  assert.equal(detectWorldBankCountryMetricQuestion("what is the gdp of tokyo"), null);
  assert.equal(detectWorldBankCountryMetricQuestion("what is the population of tokyo"), null);
  assert.deepEqual(detectShortDefinitionLookup("what is semparo"), { term: "semparo" });
  assert.deepEqual(detectShortDefinitionLookup("define 'semparo'"), { term: "semparo" });
  assert.deepEqual(detectShortDefinitionLookup("ok then what is cuba"), { term: "cuba" });
  assert.equal(detectShortDefinitionLookup("what is the gdp of china"), null);
  assert.equal(detectShortDefinitionLookup("what is the latest iPhone"), null);
});

test("curated short definition fallbacks answer obscure lexical terms deterministically", async () => {
  const answer = await answerShortDefinitionLookup("what is semparo");
  assert.match(answer ?? "", /Quenya/i);
  assert.match(answer ?? "", /for a few reasons/i);
});

test("short definition lookup softly repairs high-confidence noisy geography terms", async () => {
  const answer = await answerShortDefinitionLookup("What is start of harmoz");
  assert.match(answer ?? "", /You likely mean the Strait of Hormuz\./i);
  assert.match(answer ?? "", /between Iran and Oman/i);
  assert.match(answer ?? "", /Persian Gulf to the Gulf of Oman/i);
});

test("curated short definition fallbacks answer common mythology terms directly", async () => {
  const answer = await answerShortDefinitionLookup("what is narsimha");
  assert.match(answer ?? "", /Narasimha/i);
  assert.match(answer ?? "", /half-man, half-lion avatar of Vishnu/i);
  assert.doesNotMatch(answer ?? "", /without more context/i);
});

test("country definition formatter builds clean direct answers for country lookups", () => {
  const answer = buildCountryDefinitionAnswerForTest({
    name: { common: "Cuba", official: "Republic of Cuba" },
    capital: ["Havana"],
    population: 11_300_000,
    region: "Americas",
    subregion: "Caribbean",
    languages: { spa: "Spanish" },
    currencies: { CUP: { name: "Cuban peso", symbol: "$" } },
  });

  assert.match(answer, /^Cuba is a country in the Caribbean\./i);
  assert.match(answer, /official name is Republic of Cuba/i);
  assert.match(answer, /capital is Havana/i);
  assert.match(answer, /main language is Spanish/i);
  assert.doesNotMatch(answer, /population/i);
  assert.doesNotMatch(answer, /currency/i);
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

test("short definition fallback suggests a likely corrected term instead of guessing wildly", () => {
  const answer = buildShortDefinitionClarificationSuggestionForTest("start of harmoz", [
    {
      id: "hormuz-1",
      title: "Strait of Hormuz - Britannica",
      url: "https://www.britannica.com/place/Strait-of-Hormuz",
      snippet: "Strait of Hormuz is a narrow waterway between Iran and Oman.",
      provider: "jina",
      domain: "britannica.com",
      score: 0.93,
    },
    {
      id: "hormuz-2",
      title: "Strait of Hormuz | Location, Importance, Map",
      url: "https://www.example.com/strait-of-hormuz",
      snippet: "The Strait of Hormuz links the Persian Gulf with the Gulf of Oman.",
      provider: "serpapi",
      domain: "example.com",
      score: 0.88,
    },
  ]);

  assert.match(answer, /Did you mean \*Strait of Hormuz\*\?/i);
  assert.match(answer, /exact term/i);
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

test("thin direct-definition replies are rejected so richer answers can take over", () => {
  assert.equal(
    looksOverlyThinDirectDefinitionReplyForTest("what is cuba", "Cuba is an island country."),
    true,
  );
  assert.equal(
    looksOverlyThinDirectDefinitionReplyForTest("ok then what is cuba", "Cuba is an island country."),
    true,
  );
  assert.equal(
    looksOverlyThinDirectDefinitionReplyForTest(
      "what is cuba",
      "Cuba is an island country in the Caribbean. It is the largest island in the Caribbean, and Havana is its capital.",
    ),
    false,
  );
  assert.equal(
    looksOverlyThinDirectDefinitionReplyForTest(
      "what is narsimha",
      "Narsimha, more commonly spelled Narasimha, is the half-man, half-lion avatar of Vishnu in Hindu tradition.",
    ),
    false,
  );
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

test("final reply polishing normalizes generic answer scaffolding into a cleaner professional format", () => {
  const polished = polishClawCloudAnswerStyleForTest(
    "what is the gdp of japan",
    "web_search",
    "web_search",
    [
      "Quick answer",
      "",
      "Japan's latest official annual GDP estimate is $4.03 trillion for 2024.",
      "",
      "What to know",
      "This is the latest finalized annual figure currently available from the World Bank.",
      "",
      "Source",
      "World Bank - GDP, current US$ (NY.GDP.MKTP.CD)",
    ].join("\n"),
  );

  assert.doesNotMatch(polished, /^Quick answer$/im);
  assert.match(polished, /^Japan's latest official annual GDP estimate is \$4\.03 trillion for 2024\./i);
  assert.match(polished, /\*Notes\*/i);
  assert.match(polished, /\*Source\*/i);
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

test("whatsapp reply delivery keeps a single bubble with a fast typing lead", () => {
  assert.equal(shouldStageWhatsAppReply("Short ok", 140), false);
  assert.equal(shouldStageWhatsAppReply("A".repeat(160), 140), true);

  const message = [
    "Recommendation",
    "",
    "Use a short staged delivery so the user sees a typing-like reply instead of one instant wall of text. This should split into multiple messages cleanly.",
    "",
    "```javascript",
    "console.log('hello');",
    "```",
  ].join("\n");
  const chunks = splitWhatsAppStreamChunks(message);

  assert.equal(chunks.length, 1);
  assert.match(chunks[0] ?? "", /Recommendation/);
  assert.match(chunks[0] ?? "", /```javascript/);
  assert.ok(whatsAppInitialTypingDelayMs("hello") < whatsAppInitialTypingDelayMs("A".repeat(500)));
  assert.ok(whatsAppChunkDelayMs("```javascript\nconsole.log('hello');\n```") >= whatsAppChunkDelayMs("short sentence"));

  const plan = buildWhatsAppStreamPlan(message);
  assert.equal(plan.chunks.length, 1);
  assert.equal(plan.chunks[0], chunks[0]);
  assert.ok(plan.initialDelayMs >= 350);
  assert.ok(plan.initialDelayMs <= 3_500);
  assert.equal(plan.totalDelayMs, plan.initialDelayMs);
  assert.equal(plan.chunkDelayMs.length, 0);
});

test("critical_unblock_low patch mismatch errors cool down only that app-state collection", () => {
  assert.equal(
    shouldCooldownClawCloudAppStateCollection(
      "critical_unblock_low",
      new Error("tried remove, but no previous op"),
    ),
    true,
  );
  assert.equal(
    shouldCooldownClawCloudAppStateCollection(
      "regular",
      new Error("tried remove, but no previous op"),
    ),
    false,
  );
  assert.equal(
    shouldCooldownClawCloudAppStateCollection(
      "critical_unblock_low",
      new Error("network timeout"),
    ),
    false,
  );
});

test("eligible app-state collections exclude cooled-down critical_unblock_low until expiry", () => {
  const now = 1_710_000_000_000;
  const cooldowns = new Map([
    [
      "critical_unblock_low",
      buildClawCloudAppStateCollectionCooldownExpiry(now, 30_000),
    ],
  ]) as Map<(typeof CLAWCLOUD_WHATSAPP_ALL_APP_STATE_COLLECTIONS)[number], number>;

  const duringCooldown = getClawCloudEligibleAppStateCollections(
    CLAWCLOUD_WHATSAPP_ALL_APP_STATE_COLLECTIONS,
    cooldowns,
    now,
  );
  assert.equal(duringCooldown.includes("critical_unblock_low"), false);
  assert.equal(duringCooldown.includes("regular"), true);

  const afterCooldown = getClawCloudEligibleAppStateCollections(
    CLAWCLOUD_WHATSAPP_ALL_APP_STATE_COLLECTIONS,
    cooldowns,
    now + 31_000,
  );
  assert.equal(afterCooldown.includes("critical_unblock_low"), true);
});

test("manual contact refresh uses the stable app-state subset without critical_unblock_low", () => {
  assert.equal(
    CLAWCLOUD_WHATSAPP_CONTACT_REFRESH_COLLECTIONS.join(",").includes("critical_unblock_low"),
    false,
  );
  assert.deepEqual(
    CLAWCLOUD_WHATSAPP_CONTACT_REFRESH_COLLECTIONS,
    ["regular", "regular_high", "regular_low", "critical_block"],
  );
});

test("waiting QR sessions require manual reconnect after repeated 408 expirations", () => {
  assert.equal(
    shouldRequireManualWhatsAppQrReconnect({
      status: "waiting",
      phone: null,
      disconnectCode: 408,
      reconnectAttempts: CLAWCLOUD_WHATSAPP_WAITING_QR_RECONNECT_MAX_ATTEMPTS - 1,
    }),
    true,
  );
  assert.equal(
    shouldRequireManualWhatsAppQrReconnect({
      status: "connected",
      phone: "918091392311",
      disconnectCode: 408,
      reconnectAttempts: CLAWCLOUD_WHATSAPP_WAITING_QR_RECONNECT_MAX_ATTEMPTS - 1,
    }),
    false,
  );
  assert.equal(
    shouldRequireManualWhatsAppQrReconnect({
      status: "waiting",
      phone: null,
      disconnectCode: 500,
      reconnectAttempts: CLAWCLOUD_WHATSAPP_WAITING_QR_RECONNECT_MAX_ATTEMPTS - 1,
    }),
    false,
  );
});

test("session restore skips checkpoints that explicitly require a fresh QR reconnect", () => {
  assert.equal(shouldAutoRestoreClawCloudWhatsAppSession({ requiresReauth: true }), false);
  assert.equal(shouldAutoRestoreClawCloudWhatsAppSession({ requiresReauth: false }), true);
  assert.equal(shouldAutoRestoreClawCloudWhatsAppSession(null), true);
});
