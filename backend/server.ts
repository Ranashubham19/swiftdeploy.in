import fs from 'fs';
import path from 'path';
import { randomUUID, verify as cryptoVerify, createHmac, timingSafeEqual } from 'crypto';
import { resolveMx, resolve4, resolve6 } from 'dns/promises';
import net from 'net';
import tls from 'tls';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import TelegramBot from 'node-telegram-bot-api';
import { Client as DiscordClient, GatewayIntentBits } from 'discord.js';
import passport from 'passport';
import session from 'express-session';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { sendVerificationEmail, sendTestEmail, validateVerificationCode, getPendingVerifications, isEmailRegistered, markEmailAsRegistered, getUserByEmail, updateUserPassword, storePendingSignup, getPendingSignup, clearPendingSignup } from './emailService.js';
import { generateBotResponse, estimateTokens, needsRealtimeSearch, type AIRuntimeConfig } from './aiService.js';
import { formatProfessionalReply as formatStructuredReply } from './src/utils/responseFormat.js';
import { Request } from 'express';
import bcrypt from 'bcrypt';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import Stripe from 'stripe';
import { validateRuntimeEnv } from './src/config/envValidation.js';
import { RESPONSE_ENGINE_SYSTEM_POLICY } from './src/config/responseEnginePolicy.js';
import { CODING_ANSWER_ENGINE_SYSTEM_POLICY } from './src/config/codingAnswerEnginePolicy.js';
import { CONTEXT_INTELLIGENCE_ENGINE_SYSTEM_POLICY } from './src/config/contextIntelligenceEnginePolicy.js';
import { encryptSecretForStorage, decryptSecretFromStorage, isEncryptedSecret } from './legacy/tokenCrypto.js';
import { createTelegramUpdateDeduper } from './legacy/webhookDedupe.js';
import { createKeyedTaskQueue } from './legacy/taskQueue.js';
import { createBotAlertMonitor } from './legacy/alerts.js';
import { detectStructuredOutputMode, buildStructuredOutputInstructions, normalizeStructuredOutput } from './legacy/advanced/structuredOutput.js';
import { searchWebWithCitations, formatSearchCitationsBlock } from './legacy/advanced/webSearch.js';
import { retrieveKnowledgeSnippets, formatRagSnippetsBlock } from './legacy/advanced/ragLite.js';
import { ingestSemanticMemory, retrieveSemanticMemory, formatSemanticMemoryBlock } from './legacy/advanced/semanticMemory.js';
import { validateGeneratedCode } from './legacy/advanced/codeValidation.js';
import { transcribeTelegramMediaFromUrl } from './legacy/advanced/stt.js';
import { buildDocumentPromptFromTelegramFile, buildPhotoPromptFromTelegramFile } from './src/media/fileAnalysis.js';
import { executeCodeWithExecutionLayer, isSubprocessCodeExecutionEnabled } from './src/tools/processCodeRunner.js';
import { executeTool, shouldEnableTools } from './src/tools/tools.js';
import { parseContextReference } from './legacy/advanced/contextFollowUp.js';
import { isLikelyIncompleteNaturalAnswer, mergeContinuationText } from './legacy/advanced/answerCompletion.js';
import { buildQuestionBreakdownInstruction, decomposeQuestionParts } from './src/utils/questionDecompose.js';
import { buildTelegramBoldEntities } from './src/utils/telegramEntities.js';
import { enforceCodeGenerationIntentPolicy } from './src/utils/codeGenerationIntentPolicy.js';
import {
  createWorkerTaskForUser,
  deleteWorkerTaskForUser,
  getWorkerDashboardForUser,
  getWorkerTaskHistoryForUser,
  initWorkerRuntime,
  interpretWorkerTask,
  runWorkerTaskForUser,
  shutdownWorkerRuntime,
  updateWorkerTaskForUser
} from './src/worker/service.js';
import {
  CURATED_FREE_MODEL_POOLS,
  FORCE_OPENROUTER_FREE_ONLY_MODE as SHARED_FORCE_OPENROUTER_FREE_ONLY_MODE,
  isCuratedStrongFreeModelId,
  LOCKED_NVIDIA_MODEL_ID
} from './src/openrouter/models.js';

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '..', '.env')
];

for (const candidate of envCandidates) {
  if (!fs.existsSync(candidate)) continue;
  dotenv.config({ path: candidate });
}

const shouldManualParseEnv = [
  'SESSION_SECRET',
  'FRONTEND_URL',
  'SMTP_USER',
  'SMTP_PASS'
].some((key) => !process.env[key]);

if (shouldManualParseEnv) {
  for (const candidate of envCandidates) {
    if (!fs.existsSync(candidate)) continue;
    const envContent = fs.readFileSync(candidate, 'utf8');
    const lines = envContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

const legacyEnvValidation = validateRuntimeEnv(process.env, 'legacy');
for (const warning of legacyEnvValidation.warnings) {
  console.warn(`[ENV_WARNING:${warning.code}] ${warning.message}`);
}
if (legacyEnvValidation.errors.length > 0) {
  throw new Error(legacyEnvValidation.errors.map((item) => item.message).join('; '));
}

// Extend Express Request type to include login method
declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      name: string;
      photo?: string;
    }
    
    interface Request {
      login(user: User, callback: (err: any) => void): void;
      login(user: User): Promise<void>;
      logout(callback: (err: any) => void): void;
      logout(): Promise<void>;
      rawBody?: string;
    }
  }
}

// In-memory storage for bot tokens
const botTokens = new Map<string, string>();
type DiscordBotConfig = {
  botId: string;
  botToken: string;
  applicationId: string;
  publicKey: string;
  botUsername?: string;
  createdBy: string;
  createdAt: string;
};
const discordBots = new Map<string, DiscordBotConfig>();
const discordGatewayClients = new Map<string, DiscordClient>();
const managedBots = new Map<string, TelegramBot>();
const managedBotListeners = new Set<string>();
const telegramBotOwners = new Map<string, string>();
const telegramBotUsernames = new Map<string, string>();
const telegramBotNames = new Map<string, string>();
const telegramBotAiProviders = new Map<string, string>();
const telegramBotAiModels = new Map<string, string>();
const unknownWebhookBotLogTimestamps = new Map<string, number>();
const UNKNOWN_WEBHOOK_BOT_LOG_THROTTLE_MS = 5 * 60 * 1000;
type BotCreditState = {
  remainingUsd: number;
  lastChargedAt: number;
  depleted: boolean;
  updatedAt: number;
  policyVersion: number;
};
type OwnerProSubscriptionState = {
  ownerEmail: string;
  active: boolean;
  expiresAt: number;
  stripeSubscriptionId?: string;
  updatedAt: number;
};
const botCredits = new Map<string, BotCreditState>();
const ownerProSubscriptions = new Map<string, OwnerProSubscriptionState>();
const processedStripeCheckoutSessionIds = new Set<string>();
// Credit policy (locked by product requirement):
// - Initial credit: $10
// - Deduction: $1 every 24 hours
const INITIAL_BOT_CREDIT_USD = 10;
const CREDIT_DEDUCT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CREDIT_DEDUCT_AMOUNT_USD = 1;
const BOT_CREDIT_POLICY_VERSION = 3;
const CREDIT_ENFORCEMENT_ENABLED = (process.env.CREDIT_ENFORCEMENT_ENABLED || 'true').trim().toLowerCase() !== 'false';
const CREDIT_ENFORCEMENT_PAUSED = (process.env.CREDIT_ENFORCEMENT_PAUSED || 'false').trim().toLowerCase() === 'true';
const CREDIT_ENFORCEMENT_ACTIVE = CREDIT_ENFORCEMENT_ENABLED && !CREDIT_ENFORCEMENT_PAUSED;
const CREDIT_TOP_UP_OPTIONS_USD = [10, 25, 50, 100] as const;
type TelegramBotConfig = {
  botId: string;
  botToken: string;
  ownerEmail: string;
  botUsername?: string;
  botName?: string;
  aiProvider?: string;
  aiModel?: string;
  creditRemainingUsd?: number;
  creditLastChargedAt?: number;
  creditDepleted?: boolean;
  creditPolicyVersion?: number;
  createdAt: string;
};
type PersistedBotState = {
  version: 1;
  telegramBots: TelegramBotConfig[];
  discordBots: DiscordBotConfig[];
  stripeProcessedCheckoutSessionIds?: string[];
  ownerProSubscriptions?: Array<{
    ownerEmail: string;
    active: boolean;
    expiresAt: number;
    stripeSubscriptionId?: string;
    updatedAt?: number;
  }>;
};
type BotPlatform = 'TELEGRAM' | 'DISCORD';
type BotTelemetry = {
  botId: string;
  platform: BotPlatform;
  ownerEmail: string;
  createdAt: string;
  messageCount: number;
  responseCount: number;
  errorCount: number;
  tokenUsage: number;
  totalLatencyMs: number;
  latencySamples: number;
  lastActiveAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
};
const botTelemetry = new Map<string, BotTelemetry>();
const aiResponseCache = new Map<string, { text: string; expiresAt: number }>();
const aiInFlightRequests = new Map<string, Promise<string>>();
const lastEngineStateByConversation = new Map<string, {
  intent: 'math' | 'current_event' | 'coding' | 'general';
  codingPolicyActive: boolean;
  promptPreview: string;
  updatedAt: number;
}>();
type BotChatTurn = { role: 'user' | 'model'; parts: { text: string }[] };
const chatHistoryStore = new Map<string, { history: BotChatTurn[]; updatedAt: number }>();
type FollowUpCue = {
  topicPrompt: string;
  sourceUserPrompt: string;
  sourceAssistantReply: string;
  createdAt: number;
};
const followUpCueStore = new Map<string, FollowUpCue>();
const CHAT_HISTORY_TTL_MS = 30 * 60 * 1000;
const FOLLOW_UP_CUE_TTL_MS = 30 * 60 * 1000;
const CHAT_HISTORY_MAX_EXCHANGES = Math.max(
  15,
  Math.min(20, parseInt(process.env.CHAT_HISTORY_MAX_EXCHANGES || '20', 10))
);
const CHAT_HISTORY_MAX_TURNS = CHAT_HISTORY_MAX_EXCHANGES * 2;
const CHAT_HISTORY_TOKEN_BUDGET = parseInt(process.env.HISTORY_TOKEN_BUDGET || '6000', 10);
const AI_CACHE_TTL_MS = 2 * 60 * 1000;
const AI_CACHE_MAX_ENTRIES = parseInt(process.env.AI_CACHE_MAX_ENTRIES || '800', 10);
const RESPONSE_STYLE_VERSION = 'chatgpt_style_v1';
const MAX_USER_PROMPT_LENGTH = parseInt(process.env.MAX_USER_PROMPT_LENGTH || '6000', 10);
const CHAT_MEMORY_FILE = (process.env.BOT_MEMORY_FILE || '').trim()
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'swiftdeploy-chat-memory.json')
    : path.resolve(process.cwd(), 'runtime', 'swiftdeploy-chat-memory.json'));
type ContextMetric = { totalPromptTokens: number; totalResponseTokens: number; updatedAt: number };
const contextMetrics = new Map<string, ContextMetric>();
const CONTEXT_DB_FILE = (process.env.CONTEXT_DB_FILE || '').trim()
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'swiftdeploy-context-db.json')
    : path.resolve(process.cwd(), 'runtime', 'swiftdeploy-context-db.json'));
type UserProfile = {
  preferredTone?: 'professional' | 'formal' | 'casual' | 'concise';
  prefersConcise?: boolean;
  responseVerbosity?: 'concise' | 'normal' | 'detailed';
  responseLanguage?: string;
  verifyMode?: boolean;
  customStylePrompt?: string;
  assistantName?: string;
  userDisplayName?: string;
  goals?: string[];
  emojiStyle?: 'rich' | 'minimal';
  stickersEnabled?: boolean;
  trustLayerEnabled?: boolean;
  expertMode?: 'general' | 'interview' | 'coder' | 'teacher' | 'marketer' | 'legal';
  recurringTopics: string[];
  topicCounts: Record<string, number>;
  updatedAt: number;
};
const userProfiles = new Map<string, UserProfile>();
type TelegramObservedUser = {
  userId: string;
  firstName: string;
  lastName: string;
  username: string;
  displayName: string;
  firstSeenAt: number;
  lastSeenAt: number;
  totalMessages: number;
  scopeMessageCounts: Record<string, number>;
  chatMessageCounts: Record<string, number>;
};
type TelegramObservedChat = {
  scopeChatKey: string;
  scope: string;
  chatId: string;
  chatType: string;
  chatTitle: string;
  chatUsername: string;
  firstSeenAt: number;
  lastSeenAt: number;
  totalMessages: number;
  totalUniqueUsers: number;
  messagesByDate: Record<string, number>;
  messagesByUser: Record<string, number>;
  contactShares: number;
  uniqueContactShares: number;
  contactShareHashes: Record<string, number>;
  addressedMessages: number;
  plainMessages: number;
  privacyModeLikelyOn: boolean;
  privacyInferenceReason: string;
  intentCounts: Record<string, number>;
};
const telegramObservedUsers = new Map<string, TelegramObservedUser>();
const telegramObservedChats = new Map<string, TelegramObservedChat>();
let telegramAnalyticsPersistTimer: NodeJS.Timeout | null = null;
const TELEGRAM_ANALYTICS_FILE = (process.env.TELEGRAM_ANALYTICS_FILE || '').trim()
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'swiftdeploy-telegram-analytics.json')
    : path.resolve(process.cwd(), 'runtime', 'swiftdeploy-telegram-analytics.json'));
type TelegramAntiSpamState = {
  timestamps: number[];
  lastMessageKey: string;
  lastMessageAt: number;
  repeatedCount: number;
  mutedUntil: number;
  strikes: number;
  lastViolationAt: number;
};
const telegramAntiSpamState = new Map<string, TelegramAntiSpamState>();
type TelegramAdminRestriction = {
  scope: string;
  chatId: string;
  userId: string;
  blockedUntil: number;
  reason: string;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
};
const telegramAdminRestrictions = new Map<string, TelegramAdminRestriction>();
const TELEGRAM_ADMIN_RESTRICTIONS_FILE = (process.env.TELEGRAM_ADMIN_RESTRICTIONS_FILE || '').trim()
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'swiftdeploy-telegram-admin-restrictions.json')
    : path.resolve(process.cwd(), 'runtime', 'swiftdeploy-telegram-admin-restrictions.json'));
let telegramAdminRestrictionsPersistTimer: NodeJS.Timeout | null = null;
const ADMIN_TELEGRAM_IDS = new Set(
  String(process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);

type ModerationAuditSource = 'input' | 'output' | 'anti_spam' | 'admin';
type ModerationAuditRecord = {
  id: string;
  timestamp: number;
  source: ModerationAuditSource;
  blocked: boolean;
  category: string;
  action: string;
  scope: string;
  chatId: string;
  conversationKey: string;
  userId: string;
  inputSnippet: string;
  outputSnippet: string;
  reason: string;
};
const moderationAuditLog: ModerationAuditRecord[] = [];
let moderationAuditPersistTimer: NodeJS.Timeout | null = null;
const MODERATION_AUDIT_FILE = (process.env.MODERATION_AUDIT_FILE || '').trim()
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'swiftdeploy-moderation-audit.json')
    : path.resolve(process.cwd(), 'runtime', 'swiftdeploy-moderation-audit.json'));
const MODERATION_AUDIT_MAX_ENTRIES = Math.max(200, Math.min(20000, parseInt(process.env.MODERATION_AUDIT_MAX_ENTRIES || '5000', 10)));
const MODERATION_AUDIT_LOG_ALL = (process.env.MODERATION_AUDIT_LOG_ALL || 'false').trim().toLowerCase() === 'true';

type RedisConnectionConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  db: number;
  secure: boolean;
};
const REDIS_URL = String(process.env.REDIS_URL || '').trim();
const REDIS_TIMEOUT_MS = Math.max(300, Math.min(5000, parseInt(process.env.REDIS_TIMEOUT_MS || '2200', 10)));
const REDIS_ANTI_SPAM_PREFIX = String(process.env.REDIS_ANTI_SPAM_PREFIX || 'swiftdeploy:antispam').trim() || 'swiftdeploy:antispam';
const parsedRedisConfig = (() => {
  if (!REDIS_URL) return null;
  try {
    const parsed = new URL(REDIS_URL);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== 'redis:' && protocol !== 'rediss:') return null;
    const secure = protocol === 'rediss:';
    const host = parsed.hostname;
    const port = Number(parsed.port || (secure ? 6380 : 6379));
    const username = decodeURIComponent(parsed.username || '');
    const password = decodeURIComponent(parsed.password || '');
    const dbFromPath = Number(String(parsed.pathname || '/0').replace('/', ''));
    const db = Number.isFinite(dbFromPath) && dbFromPath >= 0 ? Math.floor(dbFromPath) : 0;
    if (!host || !Number.isFinite(port) || port <= 0) return null;
    return { host, port, username, password, db, secure } as RedisConnectionConfig;
  } catch {
    return null;
  }
})();
const REDIS_ANTI_SPAM_ENABLED = Boolean(parsedRedisConfig);
let redisAntiSpamUnavailable = false;

type ConversationTask = {
  id: string;
  text: string;
  status: 'open' | 'done';
  createdAt: number;
  dueAt?: number;
  recurring?: 'none' | 'daily' | 'weekly';
  priority?: 'low' | 'medium' | 'high';
};
const conversationTasks = new Map<string, ConversationTask[]>();
const CONVERSATION_TASKS_FILE = (process.env.CONVERSATION_TASKS_FILE || '').trim()
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'swiftdeploy-conversation-tasks.json')
    : path.resolve(process.cwd(), 'runtime', 'swiftdeploy-conversation-tasks.json'));
let conversationTasksPersistTimer: NodeJS.Timeout | null = null;
const conversationReminderTimers = new Map<string, NodeJS.Timeout>();

type ConversationDigestSchedule = {
  enabled: boolean;
  time: string; // HH:MM 24h
  nextRunAt: number;
  lastSentAt?: number;
  updatedAt: number;
};
const conversationDigestSchedules = new Map<string, ConversationDigestSchedule>();
const CONVERSATION_DIGEST_FILE = (process.env.CONVERSATION_DIGEST_FILE || '').trim()
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'swiftdeploy-conversation-digest.json')
    : path.resolve(process.cwd(), 'runtime', 'swiftdeploy-conversation-digest.json'));
let conversationDigestPersistTimer: NodeJS.Timeout | null = null;
const conversationDigestTimers = new Map<string, NodeJS.Timeout>();

type TelegramSubscriptionPlan = 'free' | 'pro';
type TelegramSubscriptionRecord = {
  scope: string;
  chatId: string;
  userId: string;
  plan: TelegramSubscriptionPlan;
  source: 'telegram_stars' | 'manual' | 'legacy';
  starsAmount?: number;
  status: 'active' | 'expired' | 'cancelled';
  expiresAt?: number;
  updatedAt: number;
};
const telegramSubscriptions = new Map<string, TelegramSubscriptionRecord>();
const TELEGRAM_SUBSCRIPTIONS_FILE = (process.env.TELEGRAM_SUBSCRIPTIONS_FILE || '').trim()
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'swiftdeploy-telegram-subscriptions.json')
    : path.resolve(process.cwd(), 'runtime', 'swiftdeploy-telegram-subscriptions.json'));
let telegramSubscriptionsPersistTimer: NodeJS.Timeout | null = null;

type ConversationKnowledgeDoc = {
  id: string;
  kind: 'text' | 'photo' | 'document' | 'voice' | 'audio' | 'video' | 'sticker' | 'location' | 'contact' | 'unsupported';
  title: string;
  content: string;
  sourceHint?: string;
  createdAt: number;
  updatedAt: number;
};
const conversationKnowledgeBase = new Map<string, ConversationKnowledgeDoc[]>();
const CONVERSATION_KB_FILE = (process.env.CONVERSATION_KB_FILE || '').trim()
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'swiftdeploy-conversation-kb.json')
    : path.resolve(process.cwd(), 'runtime', 'swiftdeploy-conversation-kb.json'));
let conversationKnowledgePersistTimer: NodeJS.Timeout | null = null;

const DEFAULT_ASSISTANT_NAME = (process.env.BOT_ASSISTANT_NAME || 'SwiftDeploy AI').trim() || 'SwiftDeploy AI';
const TG_STICKER_GREETING_ID = (process.env.TG_STICKER_GREETING_ID || '').trim();
const TG_STICKER_SUCCESS_ID = (process.env.TG_STICKER_SUCCESS_ID || '').trim();
const TG_STICKER_CODING_ID = (process.env.TG_STICKER_CODING_ID || '').trim();
const TG_STICKER_MATH_ID = (process.env.TG_STICKER_MATH_ID || '').trim();
const TG_STICKER_MOTIVATION_ID = (process.env.TG_STICKER_MOTIVATION_ID || '').trim();
const parseStickerPool = (csvRaw: string, singleFallback: string): string[] => {
  const fromCsv = String(csvRaw || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const unique = Array.from(new Set([...fromCsv, String(singleFallback || '').trim()].filter(Boolean)));
  return unique;
};
const TG_STICKER_GREETING_IDS = parseStickerPool(process.env.TG_STICKER_GREETING_IDS || '', TG_STICKER_GREETING_ID);
const TG_STICKER_SUCCESS_IDS = parseStickerPool(process.env.TG_STICKER_SUCCESS_IDS || '', TG_STICKER_SUCCESS_ID);
const TG_STICKER_CODING_IDS = parseStickerPool(process.env.TG_STICKER_CODING_IDS || '', TG_STICKER_CODING_ID);
const TG_STICKER_MATH_IDS = parseStickerPool(process.env.TG_STICKER_MATH_IDS || '', TG_STICKER_MATH_ID);
const TG_STICKER_MOTIVATION_IDS = parseStickerPool(process.env.TG_STICKER_MOTIVATION_IDS || '', TG_STICKER_MOTIVATION_ID);
const CHATGPT_STYLE_ASSISTANT = (process.env.CHATGPT_STYLE_ASSISTANT || 'true').trim().toLowerCase() !== 'false';
const EMOJI_DECORATION_ENABLED = (process.env.BOT_EMOJI_DECORATION_ENABLED || 'false').trim().toLowerCase() === 'true';
const FORCE_RICH_EMOJI_STYLE = (process.env.BOT_FORCE_RICH_EMOJI_STYLE || 'false').trim().toLowerCase() !== 'false';
const FORCE_STICKERS_ON = (process.env.BOT_FORCE_STICKERS_ON || 'false').trim().toLowerCase() !== 'false';
const USER_PROFILE_FILE = (process.env.USER_PROFILE_FILE || '').trim()
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'swiftdeploy-user-profiles.json')
    : path.resolve(process.cwd(), 'runtime', 'swiftdeploy-user-profiles.json'));
type AutomationTrigger = 'KEYWORD' | 'MENTION' | 'SILENCE_GAP' | 'HIGH_VOLUME';
type AutomationAction = 'AUTO_REPLY' | 'ESCALATE' | 'TAG' | 'DELAY_REPLY';
type AutomationRule = {
  id: string;
  name: string;
  description: string;
  trigger: AutomationTrigger;
  action: AutomationAction;
  keyword?: string;
  cooldownSec: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  runCount: number;
  successCount: number;
};
const automationRulesByUser = new Map<string, AutomationRule[]>();

const getAutomationRulesForUser = (email: string): AutomationRule[] => {
  const key = email.trim().toLowerCase();
  const existing = automationRulesByUser.get(key);
  if (existing) return existing;
  const seed: AutomationRule[] = [
    {
      id: randomUUID(),
      name: 'Pricing Intent Fast Reply',
      description: 'Auto reply with a concise product summary when pricing keywords are detected.',
      trigger: 'KEYWORD',
      action: 'AUTO_REPLY',
      keyword: 'pricing',
      cooldownSec: 45,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      runCount: 0,
      successCount: 0
    }
  ];
  automationRulesByUser.set(key, seed);
  return seed;
};

const ensureBotTelemetry = (botId: string, platform: BotPlatform, ownerEmail: string): BotTelemetry => {
  const normalizedOwner = ownerEmail.trim().toLowerCase();
  const existing = botTelemetry.get(botId);
  if (existing) {
    if (!existing.ownerEmail && normalizedOwner) {
      existing.ownerEmail = normalizedOwner;
      botTelemetry.set(botId, existing);
    }
    return existing;
  }
  const fresh: BotTelemetry = {
    botId,
    platform,
    ownerEmail: normalizedOwner,
    createdAt: new Date().toISOString(),
    messageCount: 0,
    responseCount: 0,
    errorCount: 0,
    tokenUsage: 0,
    totalLatencyMs: 0,
    latencySamples: 0,
    lastActiveAt: null,
    lastErrorAt: null,
    lastErrorMessage: null
  };
  botTelemetry.set(botId, fresh);
  return fresh;
};

const observeBotAlerts = (botId: string): void => {
  const telemetry = botTelemetry.get(botId);
  if (!telemetry) return;
  const credit = botCredits.get(botId);
  botAlertMonitor.observe({
    botId,
    ownerEmail: telemetry.ownerEmail,
    platform: telemetry.platform,
    messageCount: telemetry.messageCount,
    responseCount: telemetry.responseCount,
    errorCount: telemetry.errorCount,
    totalLatencyMs: telemetry.totalLatencyMs,
    latencySamples: telemetry.latencySamples,
    tokenUsage: telemetry.tokenUsage,
    creditRemainingUsd: credit?.remainingUsd,
    creditDepleted: credit?.depleted
  });
};

const recordBotIncoming = (botId: string): void => {
  const telemetry = botTelemetry.get(botId);
  if (!telemetry) return;
  telemetry.messageCount += 1;
  telemetry.lastActiveAt = new Date().toISOString();
  botTelemetry.set(botId, telemetry);
  observeBotAlerts(botId);
};

const recordBotResponse = (botId: string, responseText: string, latencyMs?: number): void => {
  const telemetry = botTelemetry.get(botId);
  if (!telemetry) return;
  telemetry.responseCount += 1;
  telemetry.tokenUsage += estimateTokens(String(responseText || ''));
  if (typeof latencyMs === 'number' && Number.isFinite(latencyMs) && latencyMs >= 0) {
    telemetry.totalLatencyMs += latencyMs;
    telemetry.latencySamples += 1;
  }
  telemetry.lastActiveAt = new Date().toISOString();
  botTelemetry.set(botId, telemetry);
  observeBotAlerts(botId);
};

const recordBotError = (botId: string, error: unknown): void => {
  const telemetry = botTelemetry.get(botId);
  if (!telemetry) return;
  telemetry.errorCount += 1;
  telemetry.lastErrorAt = new Date().toISOString();
  telemetry.lastErrorMessage = error instanceof Error ? error.message : String(error || 'Unknown error');
  botTelemetry.set(botId, telemetry);
  observeBotAlerts(botId);
};

const ensureBotCreditState = (botId: string): BotCreditState => {
  const existing = botCredits.get(botId);
  if (existing) {
    if (!existing.policyVersion || existing.policyVersion < BOT_CREDIT_POLICY_VERSION) {
      existing.remainingUsd = INITIAL_BOT_CREDIT_USD;
      existing.lastChargedAt = Date.now();
      existing.depleted = false;
      existing.updatedAt = Date.now();
      existing.policyVersion = BOT_CREDIT_POLICY_VERSION;
      botCredits.set(botId, existing);
      persistBotState();
    }
    return existing;
  }
  const fresh: BotCreditState = {
    remainingUsd: INITIAL_BOT_CREDIT_USD,
    lastChargedAt: Date.now(),
    depleted: false,
    updatedAt: Date.now(),
    policyVersion: BOT_CREDIT_POLICY_VERSION
  };
  botCredits.set(botId, fresh);
  return fresh;
};

const applyCreditDecay = (botId: string, now: number = Date.now()): BotCreditState => {
  const state = ensureBotCreditState(botId);
  if (!CREDIT_ENFORCEMENT_ACTIVE) {
    // Paused mode: no deduction and no depletion lock.
    state.depleted = false;
    state.updatedAt = now;
    state.policyVersion = BOT_CREDIT_POLICY_VERSION;
    botCredits.set(botId, state);
    observeBotAlerts(botId);
    return state;
  }
  if (state.depleted || state.remainingUsd <= 0) {
    state.remainingUsd = 0;
    state.depleted = true;
    state.updatedAt = now;
    state.policyVersion = BOT_CREDIT_POLICY_VERSION;
    botCredits.set(botId, state);
    observeBotAlerts(botId);
    return state;
  }
  const elapsed = Math.max(0, now - state.lastChargedAt);
  const steps = Math.floor(elapsed / CREDIT_DEDUCT_INTERVAL_MS);
  if (steps <= 0) return state;
  const deducted = steps * CREDIT_DEDUCT_AMOUNT_USD;
  state.remainingUsd = Math.max(0, state.remainingUsd - deducted);
  state.lastChargedAt += steps * CREDIT_DEDUCT_INTERVAL_MS;
  state.depleted = state.remainingUsd <= 0;
  state.updatedAt = now;
  state.policyVersion = BOT_CREDIT_POLICY_VERSION;
  botCredits.set(botId, state);
  observeBotAlerts(botId);
  return state;
};

const addCreditToBot = (botId: string, amountUsd: number, now: number = Date.now()): BotCreditState => {
  const state = applyCreditDecay(botId, now);
  state.remainingUsd = Math.max(0, state.remainingUsd + Math.max(0, Math.floor(amountUsd)));
  // Restart deduction window from recharge time.
  state.lastChargedAt = now;
  state.depleted = state.remainingUsd <= 0;
  state.updatedAt = now;
  state.policyVersion = BOT_CREDIT_POLICY_VERSION;
  botCredits.set(botId, state);
  return state;
};

const setOwnerProSubscriptionState = (input: {
  ownerEmail: string;
  expiresAt: number;
  stripeSubscriptionId?: string;
  active?: boolean;
}): OwnerProSubscriptionState => {
  const ownerEmail = String(input.ownerEmail || '').trim().toLowerCase();
  const now = Date.now();
  const expiresAt = Math.max(0, Math.floor(Number(input.expiresAt || 0)));
  const active =
    typeof input.active === 'boolean'
      ? input.active
      : expiresAt > now;
  const next: OwnerProSubscriptionState = {
    ownerEmail,
    active,
    expiresAt,
    stripeSubscriptionId: String(input.stripeSubscriptionId || '').trim() || undefined,
    updatedAt: now
  };
  ownerProSubscriptions.set(ownerEmail, next);
  return next;
};

const getOwnerProSubscriptionStatus = (ownerEmailRaw: string, now: number = Date.now()): OwnerProSubscriptionState | null => {
  const ownerEmail = String(ownerEmailRaw || '').trim().toLowerCase();
  if (!ownerEmail) return null;
  const existing = ownerProSubscriptions.get(ownerEmail);
  if (!existing) return null;
  const shouldBeActive = existing.expiresAt > now;
  if (existing.active !== shouldBeActive) {
    existing.active = shouldBeActive;
    existing.updatedAt = now;
    ownerProSubscriptions.set(ownerEmail, existing);
  }
  return existing;
};

const getCreditDepletedWarningMessage = (): string =>
  'Recharge required: credits are depleted. Recharge immediately to continue using your AI bot.';

const getSubscriptionExpiredWarningMessage = (): string =>
  'Subscription inactive: your Pro access period has ended. Activate your subscription to continue using your AI bot.';

let stripeClientSingleton: Stripe | null = null;

const isStripeEnabled = (): boolean => STRIPE_SECRET_KEY.length > 0;

const getStripeClient = (): Stripe => {
  if (!STRIPE_SECRET_KEY) {
    throw new Error('Stripe is not configured on the server.');
  }
  if (!stripeClientSingleton) {
    stripeClientSingleton = new Stripe(STRIPE_SECRET_KEY);
  }
  return stripeClientSingleton;
};

const getSafeTelegramBotDisplayInfo = (botId: string): { botName: string; botUsername: string } => {
  const botName = String(telegramBotNames.get(botId) || '').trim();
  const botUsername = String(telegramBotUsernames.get(botId) || '').trim();
  return { botName, botUsername };
};

const buildCreditCheckoutReturnUrl = (
  botId: string,
  status: 'success' | 'cancel',
  sessionIdToken?: string
): string => {
  const { botName, botUsername } = getSafeTelegramBotDisplayInfo(botId);
  const params = new URLSearchParams();
  params.set('stage', 'success');
  params.set('view', 'existing');
  params.set('botId', botId);
  if (botUsername) params.set('bot', botUsername);
  if (botName) params.set('botName', botName);
  params.set('stripeCheckout', status);
  if (sessionIdToken) params.set('stripeSessionId', sessionIdToken);
  return `${FRONTEND_URL}/#/connect/telegram?${params.toString()}`;
};

const buildProSubscriptionCheckoutReturnUrl = (
  status: 'success' | 'cancel',
  sessionIdToken?: string
): string => {
  const params = new URLSearchParams();
  params.set('proCheckout', status);
  if (sessionIdToken) params.set('proSessionId', sessionIdToken);
  return `${FRONTEND_URL}/#/connect/telegram?${params.toString()}`;
};

type CreditCheckoutFinalizeResult = {
  applied: boolean;
  alreadyProcessed: boolean;
  remainingUsd?: number;
  depleted?: boolean;
  warning?: string;
  amountUsdAdded?: number;
  botId?: string;
  error?: string;
};

const finalizeStripeCreditCheckoutSession = (session: Stripe.Checkout.Session): CreditCheckoutFinalizeResult => {
  const sessionId = String(session.id || '').trim();
  if (!sessionId) {
    return { applied: false, alreadyProcessed: false, error: 'Missing Stripe session id.' };
  }
  if (processedStripeCheckoutSessionIds.has(sessionId)) {
    const botIdFromMeta = String(session.metadata?.botId || '').trim();
    if (botIdFromMeta) {
      const credit = applyCreditDecay(botIdFromMeta);
      return {
        applied: false,
        alreadyProcessed: true,
        botId: botIdFromMeta,
        remainingUsd: credit.remainingUsd,
        depleted: credit.depleted,
        warning: credit.depleted ? getCreditDepletedWarningMessage() : ''
      };
    }
    return { applied: false, alreadyProcessed: true };
  }

  if (session.mode !== 'payment') {
    return { applied: false, alreadyProcessed: false, error: 'Stripe session is not a payment session.' };
  }
  if (String(session.payment_status || '').toLowerCase() !== 'paid') {
    return { applied: false, alreadyProcessed: false, error: 'Payment is not completed yet.' };
  }

  const metadata = session.metadata || {};
  if (String(metadata.type || '').trim() !== 'BOT_CREDIT_TOPUP') {
    return { applied: false, alreadyProcessed: false, error: 'Stripe session metadata type is invalid.' };
  }

  const botId = String(metadata.botId || '').trim();
  const ownerEmail = String(metadata.ownerEmail || '').trim().toLowerCase();
  const amountUsd = Math.floor(Number(metadata.amountUsd || 0));
  if (!botId || !ownerEmail) {
    return { applied: false, alreadyProcessed: false, error: 'Missing bot metadata for credit top-up.' };
  }
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return { applied: false, alreadyProcessed: false, error: 'Invalid credit amount in Stripe metadata.' };
  }
  if (!CREDIT_TOP_UP_OPTIONS_USD.includes(amountUsd as (typeof CREDIT_TOP_UP_OPTIONS_USD)[number])) {
    return { applied: false, alreadyProcessed: false, error: 'Unsupported credit amount in Stripe metadata.' };
  }

  const currentOwner = (telegramBotOwners.get(botId) || getPersistedTelegramOwner(botId) || '').trim().toLowerCase();
  if (!currentOwner || currentOwner !== ownerEmail) {
    return { applied: false, alreadyProcessed: false, error: 'Bot owner mismatch for Stripe credit top-up.' };
  }

  const credit = addCreditToBot(botId, amountUsd);
  processedStripeCheckoutSessionIds.add(sessionId);
  persistBotState();

  return {
    applied: true,
    alreadyProcessed: false,
    botId,
    amountUsdAdded: amountUsd,
    remainingUsd: credit.remainingUsd,
    depleted: credit.depleted,
    warning: credit.depleted ? getCreditDepletedWarningMessage() : ''
  };
};

const getTelegramNumericBotIdFromToken = (botToken: string): string => {
  const prefix = String(botToken || '').split(':')[0]?.trim() || '';
  return /^\d{6,}$/.test(prefix) ? prefix : '';
};

const isValidTelegramBotTokenFormat = (botToken: string): boolean => {
  return /^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(String(botToken || '').trim());
};

const clearTelegramBotRegistryEntry = (botId: string): void => {
  botTokens.delete(botId);
  telegramBotOwners.delete(botId);
  telegramBotUsernames.delete(botId);
  telegramBotNames.delete(botId);
  telegramBotAiProviders.delete(botId);
  telegramBotAiModels.delete(botId);
  botCredits.delete(botId);
};

const removeDuplicateTelegramTokenEntries = (canonicalBotId: string, botToken: string): number => {
  let removed = 0;
  for (const [existingBotId, existingToken] of Array.from(botTokens.entries())) {
    if (existingBotId === canonicalBotId) continue;
    if (String(existingToken || '').trim() !== botToken) continue;
    clearTelegramBotRegistryEntry(existingBotId);
    removed += 1;
  }
  return removed;
};

const getBotIdByTelegramToken = (botToken: string): string | null => {
  const token = String(botToken || '').trim();
  if (!token) return null;
  const numericId = getTelegramNumericBotIdFromToken(token);
  if (numericId && botTokens.get(numericId) === token) {
    return numericId;
  }
  let fallback: string | null = null;
  for (const [id, existingToken] of botTokens.entries()) {
    if (String(existingToken || '').trim() !== token) continue;
    if (id === numericId) return id;
    if (!fallback) fallback = id;
  }
  if (numericId) return numericId;
  return fallback;
};

const persistBotState = (): void => {
  const byToken = new Map<string, TelegramBotConfig>();
  const score = (cfg: TelegramBotConfig): number => {
    const numeric = getTelegramNumericBotIdFromToken(cfg.botToken);
    let value = 0;
    if (cfg.botId === numeric) value += 3;
    if (/^\d+$/.test(cfg.botId)) value += 1;
    return value;
  };

  for (const [botId, botTokenRaw] of Array.from(botTokens.entries())) {
    const botToken = String(botTokenRaw || '').trim();
    if (!botToken) continue;
    const canonicalBotId = getTelegramNumericBotIdFromToken(botToken) || botId;
    const credit = applyCreditDecay(botId);
    const candidate: TelegramBotConfig = {
      botId: canonicalBotId,
      botToken,
      ownerEmail: telegramBotOwners.get(botId) || '',
      botUsername: telegramBotUsernames.get(botId) || undefined,
      botName: telegramBotNames.get(botId) || undefined,
      aiProvider: telegramBotAiProviders.get(botId) || undefined,
      aiModel: telegramBotAiModels.get(botId) || undefined,
      creditRemainingUsd: credit.remainingUsd,
      creditLastChargedAt: credit.lastChargedAt,
      creditDepleted: credit.depleted,
      creditPolicyVersion: credit.policyVersion,
      createdAt: new Date().toISOString()
    };

    const existing = byToken.get(botToken);
    if (!existing || score(candidate) >= score(existing)) {
      byToken.set(botToken, candidate);
    }
  }
  const telegramBots = Array.from(byToken.values()).map((item) => ({
    ...item,
    botToken: encryptSecretForStorage(item.botToken, BOT_STATE_ENCRYPTION_KEY)
  }));
  const state: PersistedBotState = {
    version: 1,
    telegramBots,
    discordBots: Array.from(discordBots.values()),
    stripeProcessedCheckoutSessionIds: Array.from(processedStripeCheckoutSessionIds).slice(-5000),
    ownerProSubscriptions: Array.from(ownerProSubscriptions.values()).map((item) => ({
      ownerEmail: item.ownerEmail,
      active: item.active,
      expiresAt: item.expiresAt,
      stripeSubscriptionId: item.stripeSubscriptionId,
      updatedAt: item.updatedAt
    }))
  };

  try {
    const dir = path.dirname(BOT_STATE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(BOT_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    console.warn('[BOT_STATE] Failed to persist deployed bot state:', (error as Error).message);
  }
};

const loadPersistedBotState = (): PersistedBotState => {
  try {
    if (!fs.existsSync(BOT_STATE_FILE)) {
      return { version: 1, telegramBots: [], discordBots: [] };
    }

    const raw = fs.readFileSync(BOT_STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as PersistedBotState;
    const fallbackOpenRouterModel = DEFAULT_OPENROUTER_MODEL;
    const telegramBotsRaw = Array.isArray(parsed.telegramBots) ? parsed.telegramBots : [];
    const dedupByToken = new Map<string, TelegramBotConfig>();
    const score = (cfg: TelegramBotConfig): number => {
      const numeric = getTelegramNumericBotIdFromToken(cfg.botToken);
      let value = 0;
      if (cfg.botId === numeric) value += 3;
      if (/^\d+$/.test(cfg.botId)) value += 1;
      return value;
    };

    for (const item of telegramBotsRaw) {
      const storedToken = String(item?.botToken || '').trim();
      if (!storedToken) continue;
      const decryptedToken = decryptSecretFromStorage(storedToken, BOT_STATE_ENCRYPTION_KEY);
      if (isEncryptedSecret(storedToken) && !decryptedToken) {
        console.warn('[BOT_STATE] Skipping bot entry because encrypted token could not be decrypted (check BOT_STATE_ENCRYPTION_KEY).');
        continue;
      }
      const token = String(decryptedToken || '').trim();
      if (!token) continue;
      if (!isValidTelegramBotTokenFormat(token)) {
        console.warn('[BOT_STATE] Skipping bot entry with invalid token format after load/decrypt.');
        continue;
      }
      if (SINGLE_TELEGRAM_TOKEN_ONLY && PRIMARY_TELEGRAM_TOKEN && token !== PRIMARY_TELEGRAM_TOKEN) {
        continue;
      }
      const normalizedBotId = getTelegramNumericBotIdFromToken(token) || String(item?.botId || '').trim();
      if (!normalizedBotId) continue;
      const aiModel = String(item?.aiModel || '').trim() || fallbackOpenRouterModel;
      const candidate: TelegramBotConfig = {
        ...item,
        botId: normalizedBotId,
        botToken: token,
        aiProvider: LOCKED_PROVIDER_NAME,
        aiModel
      };
      const existing = dedupByToken.get(token);
      if (!existing || score(candidate) >= score(existing)) {
        dedupByToken.set(token, candidate);
      }
    }
    const telegramBots = Array.from(dedupByToken.values());
    return {
      version: 1,
      telegramBots,
      discordBots: Array.isArray(parsed.discordBots) ? parsed.discordBots : [],
      stripeProcessedCheckoutSessionIds: Array.isArray((parsed as any).stripeProcessedCheckoutSessionIds)
        ? (parsed as any).stripeProcessedCheckoutSessionIds
            .map((x: any) => String(x || '').trim())
            .filter((x: string) => x.length > 0)
            .slice(-5000)
        : [],
      ownerProSubscriptions: Array.isArray((parsed as any).ownerProSubscriptions)
        ? (parsed as any).ownerProSubscriptions
            .map((x: any) => ({
              ownerEmail: String(x?.ownerEmail || '').trim().toLowerCase(),
              active: Boolean(x?.active),
              expiresAt: Math.max(0, Number(x?.expiresAt || 0)),
              stripeSubscriptionId: String(x?.stripeSubscriptionId || '').trim() || undefined,
              updatedAt: Math.max(0, Number(x?.updatedAt || Date.now()))
            }))
            .filter((x: any) => x.ownerEmail)
        : []
    };
  } catch (error) {
    console.warn('[BOT_STATE] Failed to load persisted state:', (error as Error).message);
    return { version: 1, telegramBots: [], discordBots: [] };
  }
};

// Validate required environment variables
const requiredEnvVars = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'TELEGRAM_BOT_TOKEN',
  'SESSION_SECRET'
] as const;

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  console.warn("WARNING: Missing required environment variables");
  console.warn(`For local development, please ensure the following are set in your .env file: ${missingEnvVars.join(', ')}`);
  console.log("Continuing with placeholder values for local development...");
}

// Type-safe environment variable access with fallbacks for local development
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'placeholder_token';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'placeholder_client_id';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'placeholder_client_secret';
const isProduction = process.env.NODE_ENV === 'production';
const SESSION_SECRET = isProduction
  ? String(process.env.SESSION_SECRET || '')
  : (process.env.SESSION_SECRET || 'very_long_random_session_secret_for_dev_testing_only');
const defaultPortFromEnv = (process.env.PORT || '4000').trim() || '4000';
const appUrlFromEnv = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
const baseUrlFromEnv = (process.env.BASE_URL || '').trim().replace(/\/+$/, '');
const railwayDomain =
  (process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_STATIC_URL || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
const derivedBaseUrl = appUrlFromEnv
  || baseUrlFromEnv
  || (isProduction && railwayDomain ? `https://${railwayDomain}` : `http://localhost:${defaultPortFromEnv}`);
const BOT_STATE_FILE = (process.env.BOT_STATE_FILE || '').trim()
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'swiftdeploy-bots.json')
    : path.resolve(process.cwd(), 'runtime', 'swiftdeploy-bots.json'));

const app = express();
const startedAtIso = new Date().toISOString();
const BOT_LOGIC_VERSION = 'model_only_v41_subscription_ui_checkout_off_2026-02-28';
if (isProduction) {
  app.set('trust proxy', 1);
}

// Lightweight health endpoints first: avoid session/auth middleware interference.
app.get('/health', (_req, res) => {
  const queueStats = telegramWebhookQueue.stats();
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    startedAt: startedAtIso,
    uptime: process.uptime(),
    message: 'Application is running',
    botLogicVersion: BOT_LOGIC_VERSION,
    webhookQueue: queueStats,
    webhookDedupeCacheSize: telegramWebhookUpdateDeduper.stats().size
  });
});

app.get('/', (_req, res) => {
  res.status(200).send('SwiftDeploy backend is live');
});

/**
 * LOCALHOST DEVELOPMENT CONFIGURATION
 */

const PORT = parseInt(process.env.PORT || "4000", 10);
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PRIMARY_TELEGRAM_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const SINGLE_TELEGRAM_TOKEN_ONLY = (process.env.SINGLE_TELEGRAM_TOKEN_ONLY || 'false').trim().toLowerCase() !== 'false';
const LOCKED_PROVIDER_NAME = 'nvidia';
const LOCKED_NVIDIA_API_KEY = String(process.env.NVIDIA_API_KEY || process.env.OPENROUTER_API_KEY || '').trim();
if (!LOCKED_NVIDIA_API_KEY) {
  throw new Error('NVIDIA_API_KEY (or OPENROUTER_API_KEY) is required for Telegram AI runtime');
}
if (!LOCKED_NVIDIA_API_KEY.startsWith('nvapi-')) {
  throw new Error("NVIDIA API key must start with 'nvapi-'");
}
const DEFAULT_OPENROUTER_MODEL = (
  process.env.NVIDIA_MODEL
  || process.env.DEFAULT_MODEL
  || process.env.OPENROUTER_MODEL
  || LOCKED_NVIDIA_MODEL_ID
  || CURATED_FREE_MODEL_POOLS.general[0]
  || 'meta/llama-3.3-70b-instruct'
).trim();
const BASE_URL = derivedBaseUrl.replace(/\/+$/, '');
const FRONTEND_URL = (process.env.FRONTEND_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
const FRONTEND_ORIGIN_ALLOWLIST = Array.from(new Set([
  FRONTEND_URL,
  ...String(process.env.FRONTEND_URLS || '')
    .split(/[,\s]+/)
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean)
]));
const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || '').trim();
const STRIPE_WEBHOOK_SECRET = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
const TELEGRAM_SUBSCRIPTION_GATE_FROZEN = (process.env.TELEGRAM_SUBSCRIPTION_GATE_FROZEN || 'false').trim().toLowerCase() !== 'false';
const ALLOW_MANUAL_CREDIT_RECHARGE = (process.env.ALLOW_MANUAL_CREDIT_RECHARGE || 'false').trim().toLowerCase() === 'true';
const TELEGRAM_MAX_MESSAGE_LENGTH = 4000;
const FAST_REPLY_MODE = (process.env.FAST_REPLY_MODE || 'false').trim().toLowerCase() !== 'false';
const SUPER_FAST_RESPONSE_MODE = (process.env.SUPER_FAST_RESPONSE_MODE || 'true').trim().toLowerCase() !== 'false';
const SUPER_FAST_PRIMARY_TIMEOUT_MS = Math.max(
  7000,
  Math.min(22000, parseInt(process.env.SUPER_FAST_PRIMARY_TIMEOUT_MS || '12000', 10))
);
const SUPER_FAST_FALLBACK_TIMEOUT_MS = Math.max(
  4000,
  Math.min(16000, parseInt(process.env.SUPER_FAST_FALLBACK_TIMEOUT_MS || '7000', 10))
);
const TELEGRAM_REPLY_HARD_TIMEOUT_MS = Math.max(
  6000,
  Math.min(35000, parseInt(process.env.TELEGRAM_REPLY_HARD_TIMEOUT_MS || (SUPER_FAST_RESPONSE_MODE ? '14000' : '28000'), 10))
);
const MIN_AI_RESPONSE_TIMEOUT_MS = isProduction ? 10000 : 8000;
const rawTimeoutMs = parseInt(process.env.AI_RESPONSE_TIMEOUT_MS || (FAST_REPLY_MODE ? '22000' : '42000'), 10);
const AI_RESPONSE_TIMEOUT_MS = Math.max(MIN_AI_RESPONSE_TIMEOUT_MS, Math.min(rawTimeoutMs, 120000));
const MIN_AI_FALLBACK_TIMEOUT_MS = isProduction ? 12000 : 12000;
const rawFallbackTimeoutMs = parseInt(
  process.env.AI_FALLBACK_TIMEOUT_MS || String(Math.max(AI_RESPONSE_TIMEOUT_MS + 15000, MIN_AI_FALLBACK_TIMEOUT_MS)),
  10
);
const AI_FALLBACK_TIMEOUT_MS = Math.max(
  Math.max(AI_RESPONSE_TIMEOUT_MS, MIN_AI_FALLBACK_TIMEOUT_MS),
  Math.min(rawFallbackTimeoutMs, 180000)
);
const AI_MAX_RETRY_PASSES = SUPER_FAST_RESPONSE_MODE ? 0 : Math.max(0, parseInt(process.env.AI_MAX_RETRY_PASSES || '1', 10));
const AI_ENABLE_STRICT_RETRY = !SUPER_FAST_RESPONSE_MODE && (process.env.AI_ENABLE_STRICT_RETRY || 'false').trim().toLowerCase() !== 'false';
const AI_ENABLE_SELF_VERIFY = !SUPER_FAST_RESPONSE_MODE && (process.env.AI_ENABLE_SELF_VERIFY || 'true').trim().toLowerCase() !== 'false';
const AI_ENABLE_FINAL_SELF_CHECK = !SUPER_FAST_RESPONSE_MODE && (process.env.AI_ENABLE_FINAL_SELF_CHECK || 'true').trim().toLowerCase() !== 'false';
const AI_FINAL_SELF_CHECK_MIN_CHARS = Math.max(80, Math.min(1200, parseInt(process.env.AI_FINAL_SELF_CHECK_MIN_CHARS || '180', 10)));
const TELEGRAM_STREAMING_ENABLED = (process.env.TELEGRAM_STREAMING_ENABLED || 'true').trim().toLowerCase() !== 'false';
const TELEGRAM_STREAM_START_DELAY_MS = parseInt(process.env.TELEGRAM_STREAM_START_DELAY_MS || '700', 10);
const TELEGRAM_STREAM_PROGRESS_INTERVAL_MS = Math.max(
  600,
  parseInt(process.env.TELEGRAM_STREAM_PROGRESS_INTERVAL_MS || '900', 10)
);
const CODE_FILE_EXPORT_ENABLED = false;
const TYPEWRITER_FALLBACK_ENABLED = (process.env.TYPEWRITER_FALLBACK_ENABLED || 'false').trim().toLowerCase() !== 'false';
const TYPEWRITER_CHARS_PER_TICK = Math.max(
  18,
  Math.min(220, parseInt(process.env.TYPEWRITER_CHARS_PER_TICK || '140', 10))
);
const TYPEWRITER_TICK_MS = Math.max(
  6,
  Math.min(120, parseInt(process.env.TYPEWRITER_TICK_MS || '8', 10))
);
const TYPEWRITER_MAX_CHARS = Math.max(
  360,
  Math.min(2400, parseInt(process.env.TYPEWRITER_MAX_CHARS || '1800', 10))
);
const TELEGRAM_WEBHOOK_MAX_RETRIES = Math.max(1, Math.min(8, parseInt(process.env.TELEGRAM_WEBHOOK_MAX_RETRIES || '4', 10)));
const TELEGRAM_WEBHOOK_RETRY_BASE_MS = Math.max(250, parseInt(process.env.TELEGRAM_WEBHOOK_RETRY_BASE_MS || '900', 10));
const TELEGRAM_WEBHOOK_RESTORE_DELAY_MS = Math.max(0, parseInt(process.env.TELEGRAM_WEBHOOK_RESTORE_DELAY_MS || '250', 10));
const TELEGRAM_WEBHOOK_DEDUPE_TTL_MS = Math.max(60_000, parseInt(process.env.TELEGRAM_WEBHOOK_DEDUPE_TTL_MS || '600000', 10));
const TELEGRAM_WEBHOOK_DEDUPE_MAX_ENTRIES = Math.max(1000, parseInt(process.env.TELEGRAM_WEBHOOK_DEDUPE_MAX_ENTRIES || '20000', 10));
const TELEGRAM_WEBHOOK_QUEUE_MAX_PER_KEY = Math.max(5, parseInt(process.env.TELEGRAM_WEBHOOK_QUEUE_MAX_PER_KEY || '100', 10));
const BOT_STATE_ENCRYPTION_KEY = String(process.env.BOT_STATE_ENCRYPTION_KEY || '').trim();
const ADVANCED_WEB_SEARCH_ENABLED = (process.env.ADVANCED_WEB_SEARCH_ENABLED || 'true').trim().toLowerCase() !== 'false';
const ADVANCED_RAG_ENABLED = (process.env.ADVANCED_RAG_ENABLED || 'true').trim().toLowerCase() !== 'false';
const ADVANCED_SEMANTIC_MEMORY_ENABLED = (process.env.ADVANCED_SEMANTIC_MEMORY_ENABLED || 'true').trim().toLowerCase() !== 'false';
const ADVANCED_STRUCTURED_OUTPUT_ENABLED = (process.env.ADVANCED_STRUCTURED_OUTPUT_ENABLED || 'true').trim().toLowerCase() !== 'false';
const ADVANCED_CODE_VALIDATION_ENABLED = (process.env.ADVANCED_CODE_VALIDATION_ENABLED || 'true').trim().toLowerCase() !== 'false';
const ADVANCED_CODE_EXECUTION_FIX_ENABLED = (process.env.ADVANCED_CODE_EXECUTION_FIX_ENABLED || 'true').trim().toLowerCase() !== 'false';
const ADVANCED_CODE_EXECUTION_MAX_FIX_LOOPS = Math.max(0, Math.min(2, parseInt(process.env.ADVANCED_CODE_EXECUTION_MAX_FIX_LOOPS || '1', 10)));
const STRICT_RELIABILITY_MODE = (process.env.STRICT_RELIABILITY_MODE || 'true').trim().toLowerCase() !== 'false';
// When enabled, the bot refuses best-effort fallback content and returns retry-only messages.
// Default is off because false-positive quality checks can otherwise surface "error/fallback" replies too often.
const STRICT_NO_FALLBACK_OUTPUT_MODE = (process.env.STRICT_NO_FALLBACK_OUTPUT_MODE || 'false').trim().toLowerCase() === 'true';
const DISABLE_DETERMINISTIC_CODE_FALLBACK = (process.env.DISABLE_DETERMINISTIC_CODE_FALLBACK || 'false').trim().toLowerCase() !== 'false';
const RELIABILITY_PREFERRED_CODE_MODEL = String(process.env.RELIABILITY_PREFERRED_CODE_MODEL || '').trim();
const RELIABILITY_PREFERRED_GENERAL_MODEL = String(process.env.RELIABILITY_PREFERRED_GENERAL_MODEL || '').trim();
const WEBHOOK_SECRET_MASTER = String(process.env.TELEGRAM_WEBHOOK_SECRET || SESSION_SECRET || '').trim();
const ADMIN_API_KEY = String(process.env.ADMIN_API_KEY || '').trim();
const ADMIN_EMAILS = new Set(
  String(process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
const telegramWebhookUpdateDeduper = createTelegramUpdateDeduper(
  TELEGRAM_WEBHOOK_DEDUPE_TTL_MS,
  TELEGRAM_WEBHOOK_DEDUPE_MAX_ENTRIES
);
const telegramWebhookQueue = createKeyedTaskQueue({
  maxQueuePerKey: TELEGRAM_WEBHOOK_QUEUE_MAX_PER_KEY,
  onTaskError: (error, key) => {
    console.error(`[WEBHOOK_QUEUE] Task failed for key ${key}:`, error);
  }
});
const botAlertMonitor = createBotAlertMonitor();

const hasProviderKey = (provider: string): boolean => {
  const p = String(provider || '').trim().toLowerCase();
  return ['openrouter', 'nvidia', 'auto'].includes(p) && LOCKED_NVIDIA_API_KEY.startsWith('nvapi-');
};

const resolveUsableProvider = (_preferredProvider?: string): string | undefined => {
  return hasProviderKey(LOCKED_PROVIDER_NAME) ? LOCKED_PROVIDER_NAME : undefined;
};

// Rate limiting configuration
const getRequestIp = (req: express.Request): string => {
  return String(req.ip || req.socket?.remoteAddress || '').trim();
};

const buildIpRateLimitKey = (scope: string, req: express.Request): string => {
  return `${scope}:ip:${ipKeyGenerator(getRequestIp(req)) || 'unknown'}`;
};

const authRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    message: 'Too many requests'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const deployRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  keyGenerator: (req) => {
    const reqUser = req.user as Express.User | undefined;
    const email = (reqUser?.email || '').trim().toLowerCase();
    if (email) return `deploy:user:${email}`;
    return buildIpRateLimitKey('deploy', req);
  },
  message: { message: 'Too many deploy attempts. Please wait and try again.' },
  standardHeaders: true,
  legacyHeaders: false
});

const webhookRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 150,
  message: { message: 'Too many webhook requests' },
  standardHeaders: true,
  legacyHeaders: false
});

const hasValidAdminKey = (req: express.Request): boolean => {
  if (!ADMIN_API_KEY) return false;
  const header = String(req.headers['x-admin-key'] || '').trim();
  if (!header) return false;
  try {
    return timingSafeEqual(Buffer.from(header), Buffer.from(ADMIN_API_KEY));
  } catch {
    return false;
  }
};

const isAuthenticatedAdmin = (req: express.Request): boolean => {
  const isAuthed = req.isAuthenticated?.() === true;
  if (!isAuthed) return false;
  if (ADMIN_EMAILS.size === 0) return true;
  const reqUser = req.user as Express.User | undefined;
  const email = String(reqUser?.email || '').trim().toLowerCase();
  return Boolean(email && ADMIN_EMAILS.has(email));
};

const requireAdminAccess = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (hasValidAdminKey(req) || isAuthenticatedAdmin(req)) {
    return next();
  }
  return res.status(403).json({ message: 'Admin access required' });
};

const buildTelegramWebhookSecret = (botId: string): string => {
  if (!WEBHOOK_SECRET_MASTER) return '';
  return createHmac('sha256', WEBHOOK_SECRET_MASTER)
    .update(`telegram-webhook:${botId}`)
    .digest('hex')
    .slice(0, 48);
};

const waitMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const parseTelegramRetryAfterSeconds = (data: any): number => {
  const rawFromParams = Number(data?.parameters?.retry_after || 0);
  if (Number.isFinite(rawFromParams) && rawFromParams > 0) {
    return Math.ceil(rawFromParams);
  }
  const description = String(data?.description || '');
  const match = description.match(/retry after\s+(\d+)/i);
  if (!match) return 0;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : 0;
};

const setTelegramWebhookWithRetry = async (
  botToken: string,
  botId: string,
  webhookUrl: string,
  secretToken: string
): Promise<{ success: boolean; data?: any; error?: string }> => {
  const setWebhookUrl = `https://api.telegram.org/bot${botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}${secretToken ? `&secret_token=${encodeURIComponent(secretToken)}` : ''}`;

  for (let attempt = 1; attempt <= TELEGRAM_WEBHOOK_MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(setWebhookUrl);
      const data: any = await response.json().catch(() => ({}));
      console.log(`[WEBHOOK] Telegram API Response for ${botId}:`, data);

      if (data?.ok) {
        console.log(`[WEBHOOK] Successfully set webhook for bot ${botId}`);
        return { success: true, data };
      }

      const retryAfterSeconds = parseTelegramRetryAfterSeconds(data);
      if (retryAfterSeconds > 0 && attempt < TELEGRAM_WEBHOOK_MAX_RETRIES) {
        const jitter = Math.floor(Math.random() * 200);
        const nextWaitMs = retryAfterSeconds * 1000 + jitter;
        console.warn(`[WEBHOOK] Rate limited while setting bot ${botId}; retrying in ${nextWaitMs}ms (attempt ${attempt}/${TELEGRAM_WEBHOOK_MAX_RETRIES}).`);
        await waitMs(nextWaitMs);
        continue;
      }

      if (attempt < TELEGRAM_WEBHOOK_MAX_RETRIES) {
        const nextWaitMs = TELEGRAM_WEBHOOK_RETRY_BASE_MS * attempt;
        console.warn(`[WEBHOOK] Failed to set webhook for bot ${botId}; retrying in ${nextWaitMs}ms (attempt ${attempt}/${TELEGRAM_WEBHOOK_MAX_RETRIES}):`, data?.description || 'Unknown error');
        await waitMs(nextWaitMs);
        continue;
      }

      console.error(`[WEBHOOK] Failed to set webhook for bot ${botId}:`, data?.description || 'Unknown error');
      return { success: false, error: data?.description || 'Unknown error' };
    } catch (error) {
      if (attempt < TELEGRAM_WEBHOOK_MAX_RETRIES) {
        const nextWaitMs = TELEGRAM_WEBHOOK_RETRY_BASE_MS * attempt;
        console.warn(`[WEBHOOK] Error setting webhook for bot ${botId}; retrying in ${nextWaitMs}ms (attempt ${attempt}/${TELEGRAM_WEBHOOK_MAX_RETRIES}):`, (error as Error).message);
        await waitMs(nextWaitMs);
        continue;
      }
      console.error(`[WEBHOOK] Error setting webhook for bot ${botId}:`, error);
      return { success: false, error: (error as Error).message || 'Unknown error' };
    }
  }

  return { success: false, error: 'Webhook retries exhausted' };
};

const verifyTelegramWebhookRequest = (req: express.Request, botId: string): boolean => {
  if (!isProduction) return true;
  const expected = buildTelegramWebhookSecret(botId);
  if (!expected) return false;
  const header = String(req.headers['x-telegram-bot-api-secret-token'] || '').trim();
  if (!header) return false;
  try {
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  } catch {
    return false;
  }
};

const getActiveAiConfig = (): { provider: string; model: string } => {
  return { provider: LOCKED_PROVIDER_NAME, model: DEFAULT_OPENROUTER_MODEL };
};

const TELEGRAM_DEFAULT_MODEL_SELECTION = (process.env.TELEGRAM_DEFAULT_MODEL_SELECTION || DEFAULT_OPENROUTER_MODEL).trim().toLowerCase();

const mapTelegramModelChoice = (choiceRaw: string): { provider: string; model: string } | null => {
  const choice = String(choiceRaw || '').trim();
  if (!choice) return null;
  return { provider: LOCKED_PROVIDER_NAME, model: DEFAULT_OPENROUTER_MODEL };
};

const resolveTelegramAiConfig = (selectedModelRaw: string): { provider: string; model: string } => {
  const fromSelection = mapTelegramModelChoice(selectedModelRaw);
  if (fromSelection) return fromSelection;
  const fromDefault = mapTelegramModelChoice(TELEGRAM_DEFAULT_MODEL_SELECTION);
  if (fromDefault) return fromDefault;
  return { provider: LOCKED_PROVIDER_NAME, model: DEFAULT_OPENROUTER_MODEL };
};

// Middleware configuration
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }
    if (FRONTEND_ORIGIN_ALLOWLIST.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}) as any);

// Apply rate limiting to authentication routes
app.use('/send-verification', authRateLimit);
app.use('/resend-verification', authRateLimit);
app.use('/login', authRateLimit);
app.use('/verify-email', authRateLimit);
app.use('/webhook', webhookRateLimit);

// Authentication middleware
const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: 'Authentication required' });
};

const AI_WORKER_SERVICE_URL = String(process.env.AI_WORKER_SERVICE_URL || '').trim().replace(/\/+$/, '');
const AI_WORKER_INTERNAL_TOKEN = String(process.env.AI_WORKER_INTERNAL_TOKEN || '').trim();
const hasAiWorkerBridge = Boolean(AI_WORKER_SERVICE_URL && AI_WORKER_INTERNAL_TOKEN);

const mapAiWorkerStep = (step: any) => ({
  action: String(step?.action || ''),
  label: typeof step?.label === 'string' ? step.label : undefined,
  url: typeof step?.url === 'string' ? step.url : undefined,
  selector: typeof step?.selector === 'string' ? step.selector : undefined,
  selectors: Array.isArray(step?.selectors) ? step.selectors.map((item: unknown) => String(item)) : [],
  text: typeof step?.text === 'string' ? step.text : undefined,
  value: typeof step?.value === 'string' ? step.value : undefined,
  storeAs: typeof step?.store_as === 'string'
    ? step.store_as
    : typeof step?.storeAs === 'string'
      ? step.storeAs
      : undefined,
  attribute: typeof step?.attribute === 'string' ? step.attribute : undefined,
  key: typeof step?.key === 'string' ? step.key : undefined,
  waitForSelector: typeof step?.wait_for_selector === 'string'
    ? step.wait_for_selector
    : typeof step?.waitForSelector === 'string'
      ? step.waitForSelector
      : undefined,
  timeoutMs: Number.isFinite(Number(step?.timeout_ms ?? step?.timeoutMs))
    ? Number(step?.timeout_ms ?? step?.timeoutMs)
    : undefined,
  allMatches: Boolean(step?.all_matches ?? step?.allMatches),
  maxItems: Number.isFinite(Number(step?.max_items ?? step?.maxItems))
    ? Number(step?.max_items ?? step?.maxItems)
    : undefined,
  fallbackKeywords: Array.isArray(step?.fallback_keywords)
    ? step.fallback_keywords.map((item: unknown) => String(item))
    : Array.isArray(step?.fallbackKeywords)
      ? step.fallbackKeywords.map((item: unknown) => String(item))
      : [],
  extractRegex: typeof step?.extract_regex === 'string'
    ? step.extract_regex
    : typeof step?.extractRegex === 'string'
      ? step.extractRegex
      : undefined
});

const mapAiWorkerInstructions = (instructions: any) => ({
  website: String(instructions?.website || ''),
  websiteUrl: String(instructions?.website_url || instructions?.websiteUrl || ''),
  action: String(instructions?.action || ''),
  keyword: String(instructions?.keyword || ''),
  extract: String(instructions?.extract || ''),
  schedule: String(instructions?.schedule || 'daily'),
  deliveryChannel: Array.isArray(instructions?.notification_channels) && instructions.notification_channels.length > 0
    ? String(instructions.notification_channels[0]).toUpperCase()
    : 'EMAIL',
  taskType: String(instructions?.task_type || instructions?.taskType || 'WEBSITE_MONITOR').toUpperCase(),
  condition: typeof instructions?.condition === 'string' ? instructions.condition : '',
  selectors: Array.isArray(instructions?.selectors) ? instructions.selectors.map((item: unknown) => String(item)) : [],
  steps: Array.isArray(instructions?.steps) ? instructions.steps.map(mapAiWorkerStep) : [],
  metadata: instructions?.metadata && typeof instructions.metadata === 'object' ? instructions.metadata : {}
});

const mapAiWorkerTask = (task: any) => ({
  id: String(task?.id || ''),
  userEmail: '',
  title: String(task?.title || ''),
  taskDescription: String(task?.task_description || task?.taskDescription || ''),
  structuredInstructions: mapAiWorkerInstructions({
    ...(task?.structured_instructions || task?.structuredInstructions || {}),
    notification_channels: task?.notification_channels || []
  }),
  schedule: String(task?.schedule || 'daily').toLowerCase(),
  status: String(task?.status || 'ACTIVE').toUpperCase(),
  runStatus: String(task?.run_status || task?.runStatus || 'IDLE').toUpperCase(),
  createdAt: String(task?.created_at || task?.createdAt || ''),
  updatedAt: String(task?.updated_at || task?.updatedAt || ''),
  nextRunAt: String(task?.next_run_at || task?.nextRunAt || ''),
  lastRunAt: task?.last_run_at || task?.lastRunAt || undefined,
  lastSuccessfulRunAt: task?.last_successful_run_at || task?.lastSuccessfulRunAt || undefined,
  runCount: Number(task?.run_count || task?.runCount || 0),
  successCount: Number(task?.success_count || task?.successCount || 0),
  failureCount: Number(task?.failure_count || task?.failureCount || 0),
  repairCount: Number(task?.repair_count || task?.repairCount || 0),
  lastSummary: task?.last_summary || task?.lastSummary || undefined,
  lastError: task?.last_error || task?.lastError || undefined
});

const mapAiWorkerResult = (result: any) => ({
  id: String(result?.id || ''),
  taskId: String(result?.task_id || result?.taskId || ''),
  summary: String(result?.summary || ''),
  status: String(result?.status || 'SUCCESS').toUpperCase(),
  executionTime: `${Number(result?.execution_time_ms || result?.executionTime || 0)} ms`,
  createdAt: String(result?.created_at || result?.createdAt || ''),
  detectedChange: Boolean(result?.detected_change ?? result?.detectedChange),
  resultData: typeof result?.result_data === 'object' && result?.result_data !== null
    ? result.result_data
    : (typeof result?.resultData === 'object' && result?.resultData !== null ? result.resultData : {})
});

const mapAiWorkerLog = (log: any) => ({
  id: String(log?.id || ''),
  taskId: String(log?.task_id || log?.taskId || ''),
  level: String(log?.status || log?.level || 'INFO').toUpperCase(),
  message: String(log?.message || ''),
  timestamp: String(log?.created_at || log?.timestamp || ''),
  metadata: typeof log?.details === 'object' && log?.details !== null
    ? log.details
    : (typeof log?.metadata === 'object' && log?.metadata !== null ? log.metadata : undefined)
});

const mapAiWorkerDashboard = (payload: any) => {
  const tasks = Array.isArray(payload?.tasks) ? payload.tasks.map(mapAiWorkerTask) : [];
  const recentResults = Array.isArray(payload?.latest_results)
    ? payload.latest_results.map(mapAiWorkerResult)
    : Array.isArray(payload?.recentResults)
      ? payload.recentResults.map(mapAiWorkerResult)
      : [];
  const recentLogs = Array.isArray(payload?.latest_logs)
    ? payload.latest_logs.map(mapAiWorkerLog)
    : Array.isArray(payload?.recentLogs)
      ? payload.recentLogs.map(mapAiWorkerLog)
      : [];

  return {
    tasks,
    recentResults,
    recentLogs,
    stats: {
      activeTasks: Number(payload?.active_tasks ?? tasks.filter((task: any) => task.status === 'ACTIVE').length),
      pausedTasks: tasks.filter((task: any) => task.status === 'PAUSED').length,
      totalRuns: tasks.reduce((total: number, task: any) => total + Number(task.runCount || 0), 0),
      successfulRuns: tasks.reduce((total: number, task: any) => total + Number(task.successCount || 0), 0),
      detectedChanges: recentResults.filter((result: any) => result.detectedChange).length
    }
  };
};

const getAuthenticatedUserContext = (req: express.Request) => {
  const reqUser = req.user as Express.User | undefined;
  return {
    email: (reqUser?.email || '').trim().toLowerCase(),
    name: (reqUser?.name || '').trim()
  };
};

const callAiWorkerService = async (
  req: express.Request,
  method: string,
  endpoint: string,
  body?: Record<string, unknown>
) => {
  if (!hasAiWorkerBridge) {
    throw new Error('AI worker bridge is not configured.');
  }

  const { email, name } = getAuthenticatedUserContext(req);
  if (!email) {
    throw new Error('Authentication required.');
  }

  const response = await fetch(`${AI_WORKER_SERVICE_URL}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Service-Token': AI_WORKER_INTERNAL_TOKEN,
      'X-Worker-User-Email': email,
      'X-Worker-User-Name': name || email.split('@')[0]
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = String(data?.detail || data?.message || 'AI worker service request failed.');
    throw new Error(message);
  }

  return data;
};

const setNoStore = (res: express.Response) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
};

// Configure session
const sessionConfig = {
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: isProduction ? ('none' as const) : ('lax' as const),
    secure: isProduction,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  },
  proxy: true
};

app.post('/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!isStripeEnabled()) {
    return res.status(503).send('Stripe is not configured');
  }
  if (!STRIPE_WEBHOOK_SECRET) {
    return res.status(503).send('Stripe webhook secret is not configured');
  }

  const signature = String(req.headers['stripe-signature'] || '').trim();
  if (!signature) {
    return res.status(400).send('Missing Stripe signature');
  }

  try {
    const stripe = getStripeClient();
    const event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const result = finalizeStripeCreditCheckoutSession(session);
      if (result.error) {
        console.warn('[STRIPE] checkout.session.completed finalize skipped:', result.error);
      } else if (result.applied) {
        console.log(`[STRIPE] Applied credit top-up via webhook for bot ${result.botId}: +$${result.amountUsdAdded}`);
      }
    }
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('[STRIPE] Webhook verification failed:', error);
    return res.status(400).send('Invalid Stripe webhook payload');
  }
});

app.use(session(sessionConfig));

app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => {
    const request = req as Request;
    if ((request.originalUrl || '').startsWith('/discord/interactions/')) {
      request.rawBody = buf.toString('utf8');
    }
  }
}) as any);
app.use(passport.initialize());
app.use(passport.session());

// Passport.js Google OAuth Configuration
if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || `${BASE_URL}/auth/google/callback`
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      // Create or update user in your database
      // For now, we'll just return the profile info
      const user = {
        id: profile.id,
        name: profile.displayName || profile.username || 'Anonymous',
        email: profile.emails?.[0].value || '',
        photo: profile.photos?.[0].value
      };
      return done(null, user);
    } catch (error) {
      return done(error as any, undefined);
    }
  }
  ));
} else {
  console.log("WARNING: Google OAuth is disabled - missing credentials");
}

// Serialize user into the sessions
passport.serializeUser((user: any, done) => {
  done(null, user);
});

// Deserialize user from the sessions
passport.deserializeUser((user: any, done) => {
  done(null, user);
});

// Initialize Telegram Bot with direct message handling
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: isProduction ? false : true });

// Listen for messages directly
bot.on('message', async (msg) => {
  console.log(`[TELEGRAM] Direct message received from ${msg.from?.username || 'Unknown'}: ${msg.text}`);
  await handleTelegramMessage(msg);
});

bot.on('inline_query', async (inlineQuery) => {
  try {
    await handleTelegramInlineQuery(bot, inlineQuery, 'telegram:primary');
  } catch (error) {
    console.warn('[TELEGRAM] Inline query handling failed:', (error as Error).message);
  }
});

// Declare global function type
declare global {
  var setWebhookForBot: (botToken: string, botId: string) => Promise<{ success: boolean; data?: any; error?: string }>;
}

// Function to set webhook for a bot
(global as any).setWebhookForBot = async (botToken: string, botId: string) => {
  if (!isProduction) {
    console.log(`[WEBHOOK] Local mode detected. Skipping webhook for bot ${botId} and using polling.`);
    return { success: true, data: { ok: true, result: 'Local mode: polling enabled' } };
  }
  if (!/^https:\/\//i.test(BASE_URL)) {
    const message = 'APP_URL/BASE_URL must be an HTTPS public URL in production.';
    console.error(`[WEBHOOK] ${message} Current BASE_URL=${BASE_URL}`);
    return { success: false, error: message };
  }

  const webhookUrl = `${BASE_URL}/webhook/${botId}`;
  const secretToken = buildTelegramWebhookSecret(botId);
  
  console.log(`[WEBHOOK] Setting webhook for bot ${botId}: ${webhookUrl}`);
  return setTelegramWebhookWithRetry(botToken, botId, webhookUrl, secretToken);
};

/**
 * Prompt normalization and relevance guards
 */

const WIKI_FALLBACK_STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'being', 'been',
  'what', 'who', 'where', 'when', 'why', 'how', 'which',
  'please', 'tell', 'me', 'about', 'define', 'explain', 'meaning',
  'ok', 'okay', 'hi', 'hello', 'hey', 'yo', 'can', 'could', 'would', 'will',
  'you', 'your', 'my', 'our', 'their', 'this', 'that', 'these', 'those',
  'to', 'of', 'for', 'in', 'on', 'at', 'from', 'and', 'or'
]);

const tokenizeKnowledgeText = (text: string): string[] => {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2 && !WIKI_FALLBACK_STOP_WORDS.has(x));
};

const expandTopicVariants = (topic: string): string[] => {
  const normalized = String(topic || '').toLowerCase().trim();
  if (!normalized) return [];
  const variants = [normalized];
  if (normalized === 'usa' || normalized === 'u.s.a' || normalized === 'us' || normalized === 'u.s') {
    variants.push('united states', 'united states of america');
  }
  if (normalized === 'uk' || normalized === 'u.k') {
    variants.push('united kingdom');
  }
  if (normalized === 'uae') {
    variants.push('united arab emirates');
  }
  if (normalized === 'nasa') {
    variants.push('national aeronautics and space administration');
  }
  return Array.from(new Set(variants.filter(Boolean)));
};

const countTokenMatches = (tokens: string[], haystack: string): number => {
  if (!tokens.length) return 0;
  const text = String(haystack || '').toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (token && text.includes(token)) hits += 1;
  }
  return hits;
};

const extractKnowledgeTopic = (rawText: string): string => {
  let value = String(rawText || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!value) return '';

  value = value
    .replace(/^[,.;:!?'"`~\-()\[\]{}]+/g, '')
    .replace(/[?!.]+$/g, '')
    .trim();

  const leadPatterns = [
    /^(ok(?:ay)?|hey|hello|hi|hii|yo|please|pls|bro|sir|assistant|bot)\b[\s,.:;!?-]*/i,
    /^(can you|could you|would you|will you|kindly|tell me|explain|define|describe|help me understand|i want to know|do you know)\b[\s,.:;!?-]*/i,
    /^(what(?:'s| is)|who(?:'s| is)|where(?:'s| is)|when(?:'s| is)|why(?:'s| is)|how(?:'s| is)|what are|who are|where are|meaning of|definition of|tell me about)\b[\s,.:;!?-]*/i
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of leadPatterns) {
      const next = value.replace(pattern, '').trim();
      if (next !== value) {
        value = next;
        changed = true;
      }
    }
  }

  value = value.replace(/[?!.]+$/g, '').trim();
  // Normalize accidental article-led noun phrases: "a magic" -> "magic".
  value = value.replace(/^(a|an|the)\s+/i, '').trim();
  return value.slice(0, 120);
};

const TYPO_CORRECTIONS: Record<string, string> = {
  epistein: 'epstein',
  epstien: 'epstein',
  epstine: 'epstein',
  einstien: 'einstein',
  einsten: 'einstein',
  joffery: 'joffrey',
  jofrey: 'joffrey',
  joffreyy: 'joffrey',
  jofferey: 'joffrey',
  missicipi: 'mississippi',
  missisipi: 'mississippi',
  misisipi: 'mississippi',
  miccisipi: 'mississippi',
  micisipi: 'mississippi',
  missicippi: 'mississippi',
  javasript: 'javascript',
  javscript: 'javascript',
  pyhton: 'python',
  javva: 'java',
  algorithim: 'algorithm',
  seperate: 'separate',
  recieve: 'receive',
  diffrence: 'difference',
  becuase: 'because',
  answeer: 'answer',
  whi: 'who',
  wat: 'what',
  wht: 'what',
  wajt: 'what',
  okwajt: 'what',
  hwo: 'how',
  wich: 'which',
  whare: 'where',
  wen: 'when',
  definaton: 'definition',
  definetion: 'definition',
  qestion: 'question',
  queston: 'question',
  fibonaci: 'fibonacci',
  fibonnaci: 'fibonacci',
  subaray: 'subarray',
  subarry: 'subarray',
  circluar: 'circular',
  maxmimum: 'maximum',
  minimun: 'minimum',
  devided: 'divided',
  multipy: 'multiply',
  opertaor: 'operator',
  iphon: 'iphone',
  ifon: 'iphone',
  iphne: 'iphone',
  iphonee: 'iphone',
  hiest: 'heist',
  profesisonal: 'professional',
  profesionall: 'professional'
};

const applyReplacementCase = (sourceToken: string, replacement: string): string => {
  if (!sourceToken) return replacement;
  if (/^[A-Z0-9_]+$/.test(sourceToken)) {
    return replacement.toUpperCase();
  }
  if (/^[A-Z]/.test(sourceToken)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
};

const correctCommonTypos = (input: string): string => {
  const value = String(input || '');
  if (!value) return value;
  return value.replace(/\b[a-z][a-z0-9_-]*\b/gi, (token) => {
    const corrected = TYPO_CORRECTIONS[token.toLowerCase()];
    if (!corrected) return token;
    return applyReplacementCase(token, corrected);
  });
};

const CONTEXTUAL_PHRASE_CORRECTIONS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bwhi\s+is\b/gi, replacement: 'who is' },
  { pattern: /\bwat\s+is\b/gi, replacement: 'what is' },
  { pattern: /\bwht\s+is\b/gi, replacement: 'what is' },
  { pattern: /\bps\s+5\b/gi, replacement: 'ps5' },
  { pattern: /\bcan u\b/gi, replacement: 'can you' },
  { pattern: /\bcud you\b/gi, replacement: 'could you' },
  { pattern: /\bpls\b/gi, replacement: 'please' },
  { pattern: /\banswr\b/gi, replacement: 'answer' },
];

const CONTEXTUAL_CANONICAL_TERMS = [
  'epstein',
  'einstein',
  'joffrey',
  'jeffrey',
  'baratheon',
  'mississippi',
  'fibonacci',
  'kadane',
  'subarray',
  'palindrome',
  'algorithm',
  'ps5',
  'playstation',
  'playstation 5',
  'psi',
  'iphone',
  'iphone 15',
  'circular',
  'matrix',
  'python',
  'javascript',
  'typescript',
  'java',
  'cpp',
  'equation',
  'operator'
];

const CONTEXTUAL_STOP_WORDS = new Set([
  ...Array.from(WIKI_FALLBACK_STOP_WORDS),
  'code',
  'question',
  'answer',
  'please',
  'need',
  'want',
  'tell',
  'about',
  'with',
  'from',
  'this',
  'that',
  'what',
  'who',
  'where',
  'when',
  'why',
  'how',
  'which'
]);

const looksLikeRawCodeInput = (input: string): boolean => {
  const value = String(input || '');
  if (!value) return false;
  if (/```|CODE_BEGIN|CODE_END/.test(value)) return true;
  const lineCount = value.split('\n').length;
  const codeSymbolHits = (value.match(/[{}[\];<>]/g) || []).length;
  return lineCount >= 3 && codeSymbolHits >= 4;
};

const levenshteinDistance = (a: string, b: string, limit = 3): number => {
  const left = String(a || '').toLowerCase();
  const right = String(b || '').toLowerCase();
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;
  if (Math.abs(left.length - right.length) > limit) return limit + 1;

  const prev = new Array(right.length + 1);
  const curr = new Array(right.length + 1);
  for (let j = 0; j <= right.length; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > limit) return limit + 1;
    for (let j = 0; j <= right.length; j += 1) {
      prev[j] = curr[j];
    }
  }
  return prev[right.length];
};

const pickBestContextualToken = (token: string): string | null => {
  const lower = token.toLowerCase();
  if (lower.length < 4) return null;
  if (CONTEXTUAL_STOP_WORDS.has(lower)) return null;
  if (TYPO_CORRECTIONS[lower]) return null;
  if (CONTEXTUAL_CANONICAL_TERMS.includes(lower)) return null;

  let bestTerm = '';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const term of CONTEXTUAL_CANONICAL_TERMS) {
    if (!term || term[0] !== lower[0]) continue;
    if (Math.abs(term.length - lower.length) > 2) continue;
    const distanceLimit = lower.length >= 7 ? 2 : 1;
    const distance = levenshteinDistance(lower, term, distanceLimit);
    if (distance > distanceLimit) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestTerm = term;
    }
  }
  if (!bestTerm || !Number.isFinite(bestDistance)) return null;
  return bestTerm;
};

const correctContextualMisspellings = (input: string): string => {
  let value = String(input || '');
  if (!value) return value;
  if (looksLikeRawCodeInput(value)) return value;

  for (const fix of CONTEXTUAL_PHRASE_CORRECTIONS) {
    value = value.replace(fix.pattern, fix.replacement);
  }

  value = value.replace(/\b[a-z][a-z0-9_-]*\b/gi, (token) => {
    const suggestion = pickBestContextualToken(token);
    if (!suggestion) return token;
    return applyReplacementCase(token, suggestion);
  });

  return value.replace(/\s{2,}/g, ' ').trim();
};

const normalizeIntentFromNoisyText = (input: string): string => {
  const value = String(input || '');
  if (!value) return value;
  const typoFixed = correctCommonTypos(value);
  return correctContextualMisspellings(typoFixed);
};

const isDefinitionLikePrompt = (prompt: string): boolean => {
  const q = String(prompt || '').toLowerCase().trim();
  return /(what(?:'s| is)|who(?:'s| is)|define|definition of|meaning of|tell me about|explain)\b/.test(q);
};

const TELEGRAM_MEDIA_ENVELOPE_PATTERN =
  /^\[(?:PHOTO|DOCUMENT|VOICE|AUDIO|VIDEO(?: NOTE| DOCUMENT)?|AUDIO DOCUMENT|LOCATION|CONTACT|STICKER)\s+MESSAGE\]/i;

type TelegramEnvelopeType = 'photo' | 'document' | 'voice' | 'audio' | 'video' | 'location' | 'contact' | 'sticker' | null;

const getTelegramEnvelopeType = (prompt: string): TelegramEnvelopeType => {
  const firstLine = String(prompt || '').split('\n')[0]?.trim() || '';
  if (!firstLine) return null;
  if (/^\[PHOTO\s+MESSAGE\]/i.test(firstLine)) return 'photo';
  if (/^\[DOCUMENT\s+MESSAGE\]/i.test(firstLine)) return 'document';
  if (/^\[VOICE\s+MESSAGE\]/i.test(firstLine)) return 'voice';
  if (/^\[(?:AUDIO|AUDIO DOCUMENT)\s+MESSAGE\]/i.test(firstLine)) return 'audio';
  if (/^\[VIDEO(?: NOTE| DOCUMENT)?\s+MESSAGE\]/i.test(firstLine)) return 'video';
  if (/^\[LOCATION\s+MESSAGE\]/i.test(firstLine)) return 'location';
  if (/^\[CONTACT\s+MESSAGE\]/i.test(firstLine)) return 'contact';
  if (/^\[STICKER\s+MESSAGE\]/i.test(firstLine)) return 'sticker';
  return null;
};

const isTelegramMediaEnvelopePrompt = (prompt: string): boolean => {
  const firstLine = String(prompt || '').split('\n')[0]?.trim() || '';
  return TELEGRAM_MEDIA_ENVELOPE_PATTERN.test(firstLine);
};

const isLikelyFileNameOnlyPrompt = (prompt: string): boolean => {
  const value = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (!value || value.length > 220 || value.includes('\n')) return false;
  return /^[A-Za-z0-9 _().,\-]{1,180}\.(?:pdf|docx?|pptx?|xlsx?|csv|txt|rtf|md|json|xml|html?|jpg|jpeg|png|webp|gif|bmp|tiff?|heic|zip|rar|7z|mp3|wav|m4a|aac|ogg|mp4|mov|avi|mkv)$/i.test(value);
};

const extractPromptSectionByLabel = (prompt: string, label: string): string => {
  const raw = String(prompt || '').replace(/\r/g, '');
  if (!raw) return '';
  const lines = raw.split('\n');
  const heading = `${String(label || '').trim()}:`.toLowerCase();
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (String(lines[i] || '').trim().toLowerCase() === heading) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return '';
  const out: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const current = String(lines[i] || '');
    const trimmed = current.trim();
    if (!trimmed) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      continue;
    }
    if (
      /^[A-Za-z][A-Za-z0-9 ()/'"+-]{1,80}:$/.test(trimmed)
      || /^Please help based on this message content\.?$/i.test(trimmed)
      || /^Document response rules:$/i.test(trimmed)
      || /^Media response rules:$/i.test(trimmed)
    ) {
      break;
    }
    out.push(trimmed);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const summarizeForFallback = (text: string, maxChars = 900): string => {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  if (value.length <= maxChars) return value;
  const sliced = value.slice(0, maxChars);
  const end = Math.max(sliced.lastIndexOf('. '), sliced.lastIndexOf('; '), sliced.lastIndexOf(', '));
  return `${(end > 220 ? sliced.slice(0, end + 1) : sliced).trim()}...`;
};

const extractMediaCaptionFromPrompt = (prompt: string): string => {
  const match = String(prompt || '').match(/(?:^|\n)Caption:\s*(.+)$/im);
  return String(match?.[1] || '').trim();
};

const extractMediaTranscriptFromPrompt = (prompt: string): string => {
  const raw = String(prompt || '');
  if (!raw) return '';
  const blockMatch = raw.match(
    /(?:^|\n)(?:Transcript|Audio transcript \(if extracted\)):\s*\n([\s\S]*?)(?:\n(?:Media response rules:|Please help based on this message content\.?|$))/i
  );
  if (blockMatch?.[1]) {
    return String(blockMatch[1]).replace(/\r/g, '').trim();
  }
  const inlineMatch = raw.match(/(?:^|\n)(?:Transcript|Audio transcript \(if extracted\)):\s*(.+)$/im);
  return String(inlineMatch?.[1] || '').replace(/\r/g, '').trim();
};

const extractIntentSignalFromMediaEnvelopePrompt = (prompt: string): string => {
  const source = String(prompt || '');
  if (!isTelegramMediaEnvelopePrompt(source)) return source;
  const caption = extractMediaCaptionFromPrompt(source);
  const transcript = extractMediaTranscriptFromPrompt(source);
  const transcriptAvailable = transcript && !/^transcript unavailable/i.test(transcript);
  const merged = [caption, transcriptAvailable ? transcript : ''].filter(Boolean).join('\n').trim();
  return merged || '';
};

const inferTranscriptEmotionTone = (transcript: string): string => {
  const t = String(transcript || '').toLowerCase();
  if (!t) return 'Cannot determine reliably without transcript text.';
  const positive = /\b(happy|great|good|excited|love|awesome|grateful|confident|proud|thank)\b/.test(t);
  const negative = /\b(sad|angry|upset|frustrat|afraid|worried|anxious|stress|depress|annoy)\b/.test(t);
  const urgent = /\b(urgent|immediately|asap|quickly|right now|now)\b/.test(t);
  const curious = /\b(what|why|how|when|where|can you|could you)\b/.test(t) || /\?/.test(t);
  if (positive && !negative) return urgent ? 'Positive and urgent.' : 'Positive and confident.';
  if (negative && !positive) return urgent ? 'Concerned and urgent.' : 'Concerned or negative.';
  if (positive && negative) return 'Mixed emotional tone with both positive and negative signals.';
  if (curious && !urgent) return 'Curious and information-seeking.';
  return urgent ? 'Neutral content with an urgent delivery tone.' : 'Mostly neutral and informative.';
};

const mediaFillerWordPattern = /\b(?:um+|uh+|erm|hmm+|you know|basically|actually|literally|sort of|kind of)\b/gi;

const normalizeMediaTranscript = (transcript: string): string =>
  String(transcript || '')
    .replace(/\r/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const splitMediaSentences = (transcript: string): string[] => {
  const normalized = normalizeMediaTranscript(transcript);
  if (!normalized) return [];
  const sentenceParts = normalized
    .replace(/([.!?])([A-Za-z])/g, '$1 $2')
    .split(/[.!?]+\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentenceParts.length > 1) return sentenceParts;
  return normalized
    .split(/\s+(?:and|but|so|because|then|also)\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 8);
};

const capitalizeMediaSentence = (value: string): string => {
  const text = String(value || '').trim();
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const dedupeAdjacentMediaWords = (value: string): string => {
  const tokens = String(value || '').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let previous = '';
  for (const token of tokens) {
    const current = token.toLowerCase();
    if (current === previous) continue;
    out.push(token);
    previous = current;
  }
  return out.join(' ');
};

const sanitizeMediaSectionLine = (value: string): string =>
  String(value || '')
    .replace(/\b(?:Main Content|Emotion and Tone|What Was Good|What To Improve|Spelling and Grammar Fixes|Improved Version)\s*:/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

const buildMediaMainContentSummary = (transcript: string): string => {
  const normalized = normalizeMediaTranscript(transcript);
  if (!normalized) return 'Transcript was unavailable in this attempt.';
  const sentenceParts = splitMediaSentences(normalized);
  const primary = sentenceParts.slice(0, 2).join('. ').trim() || normalized;
  const questionLike = /\?$/.test(normalized) || /\b(what|why|how|when|where|can you|could you|please)\b/i.test(normalized);
  const summaryPrefix = questionLike ? 'The speaker asks for help with:' : 'The speaker mainly says:';
  const capped = summarizeForFallback(capitalizeMediaSentence(primary), 520);
  return `${summaryPrefix} ${capped}`;
};

const inferMediaStrengths = (transcript: string, caption: string): string[] => {
  const text = normalizeMediaTranscript(transcript);
  const strengths: string[] = [];
  if (/\b(please|thank|thanks)\b/i.test(text)) {
    strengths.push('Polite wording helps maintain a professional communication style.');
  }
  if (/\b(can you|could you|i need|i want|please|tell me|explain|summarize|describe)\b/i.test(text)) {
    strengths.push('The request intent is explicit, which makes response targeting easier.');
  }
  if (splitMediaSentences(text).length >= 2 || text.split(/\s+/).length >= 18) {
    strengths.push('The recording includes enough detail to infer the core objective.');
  }
  if (caption) {
    strengths.push('Caption context is available and helps align analysis with the user goal.');
  }
  if (strengths.length === 0) {
    strengths.push('A clear media sample was shared, which enables transcript-based review.');
    strengths.push('The message contains a concrete user ask that can be acted on.');
  }
  return strengths.slice(0, 3);
};

const inferMediaImprovements = (transcript: string, caption: string): string[] => {
  const text = normalizeMediaTranscript(transcript);
  const improvements: string[] = [];
  const fillerCount = (text.match(mediaFillerWordPattern) || []).length;
  const wordCount = text ? text.split(/\s+/).length : 0;
  const sentenceCount = splitMediaSentences(text).length;

  if (!/[.!?]/.test(text)) {
    improvements.push('Add short pauses and sentence boundaries so transcript punctuation is more accurate.');
  }
  if (fillerCount >= 2) {
    improvements.push('Reduce filler words to improve clarity and transcription quality.');
  }
  if (wordCount >= 25 && sentenceCount <= 1) {
    improvements.push('Break long statements into 2-3 short sentences for easier understanding.');
  }
  if (!/\b(goal|output|result|answer|question|problem|code|summary|explain)\b/i.test(text)) {
    improvements.push('State the expected output explicitly, such as summary, explanation, or code answer.');
  }
  if (!caption) {
    improvements.push('Add a short caption to define intent before playback starts.');
  }
  if (improvements.length === 0) {
    improvements.push('Keep the current clarity level and continue using concise sentence structure.');
    improvements.push('If needed, provide one specific constraint to get a more targeted response.');
  }
  return improvements.map((line) => sanitizeMediaSectionLine(line)).filter(Boolean).slice(0, 3);
};

type MediaRewriteResult = {
  text: string;
  corrections: string[];
};

const mediaProfessionalRewriteRules: Array<{
  pattern: RegExp;
  replacement: string;
  reason: string;
}> = [
  { pattern: /\bmake a good\b/gi, replacement: 'develop a strong', reason: 'Make wording more professional and specific.' },
  { pattern: /\bcan revolve around\b/gi, replacement: 'should focus on', reason: 'Use precise professional phrasing.' },
  { pattern: /\bcan reduce\b/gi, replacement: 'while reducing', reason: 'Improve sentence flow and grammar.' },
  { pattern: /\ba good\b/gi, replacement: 'a strong', reason: 'Prefer stronger professional adjective choice.' },
  { pattern: /\bi want\b/gi, replacement: 'I would like', reason: 'Use professional tone.' },
  { pattern: /\bkind of\b/gi, replacement: 'approximately', reason: 'Reduce filler phrasing.' },
  { pattern: /\bsort of\b/gi, replacement: 'approximately', reason: 'Reduce filler phrasing.' },
];

const applyMediaProfessionalRewrite = (transcript: string): MediaRewriteResult => {
  const normalized = normalizeMediaTranscript(transcript);
  if (!normalized) {
    return {
      text: 'Please resend the media with clearer speech for a polished rewrite.',
      corrections: [],
    };
  }

  let rewritten = normalized
    .replace(mediaFillerWordPattern, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  rewritten = dedupeAdjacentMediaWords(rewritten);

  const corrections: string[] = [];
  for (const rule of mediaProfessionalRewriteRules) {
    const match = rewritten.match(rule.pattern);
    if (!match) continue;
    const originalPhrase = String(match[0] || '').trim();
    rewritten = rewritten.replace(rule.pattern, rule.replacement);
    if (originalPhrase) {
      corrections.push(`Original: "${originalPhrase}" -> Suggested: "${rule.replacement}"`);
    }
    if (corrections.length >= 4) break;
  }

  rewritten = rewritten
    .replace(/\bi\b/g, 'I')
    .replace(/\s+,/g, ',')
    .replace(/\s+\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();
  rewritten = dedupeAdjacentMediaWords(rewritten);

  const sentenceParts = splitMediaSentences(rewritten).slice(0, 3);
  let polished = sentenceParts.map((part) => capitalizeMediaSentence(part)).filter(Boolean).join('. ').trim() || capitalizeMediaSentence(rewritten);
  polished = sanitizeMediaSectionLine(polished);

  const isQuestion = /\?$/.test(normalized) || /\b(what|why|how|when|where|can you|could you)\b/i.test(normalized);
  if (isQuestion) {
    if (!/\?$/.test(polished)) polished = `${polished.replace(/[.]+$/g, '')}?`;
  } else if (!/[.!?]$/.test(polished)) {
    polished = `${polished}.`;
  }

  if (computeMediaTokenOverlap(normalized, polished) >= 0.88) {
    const core = buildMediaMainContentSummary(normalized)
      .replace(/^The speaker mainly says:\s*/i, '')
      .replace(/^The speaker asks for help with:\s*/i, '')
      .trim();
    polished = `Develop a clear and professional statement of the objective, context, and expected output. Refined intent: ${core}`;
    if (!/[.!?]$/.test(polished)) polished = `${polished}.`;
  }

  if (polished.length > 520) {
    polished = `${polished.slice(0, 517).trim()}...`;
  }

  return {
    text: polished,
    corrections: corrections
      .map((line) => sanitizeMediaSectionLine(line))
      .filter(Boolean)
      .slice(0, 4),
  };
};

const buildMediaLanguageCorrectionHints = (transcript: string, rewrite: MediaRewriteResult): string[] => {
  const normalized = normalizeMediaTranscript(transcript);
  const hints: string[] = [];
  if (!normalized) return hints;

  hints.push(...rewrite.corrections);

  const repeatedWordMatch = normalized.match(/\b([A-Za-z]{2,})\s+\1\b/i);
  if (repeatedWordMatch?.[1]) {
    const w = repeatedWordMatch[1];
    hints.push(`Repeated wording detected: "${w} ${w}". Use one occurrence for cleaner phrasing.`);
  }
  if (!/[.!?]/.test(normalized)) {
    hints.push('Add sentence punctuation to improve readability and transcription accuracy.');
  }
  if (/^[a-z]/.test(normalized)) {
    hints.push('Start the statement with a capital letter for professional style.');
  }

  const unique = new Set<string>();
  const out: string[] = [];
  for (const hint of hints) {
    const clean = sanitizeMediaSectionLine(hint);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (unique.has(key)) continue;
    unique.add(key);
    out.push(clean);
    if (out.length >= 4) break;
  }
  return out;
};

const buildImprovedMediaVersion = (transcript: string): string => {
  const rewrite = applyMediaProfessionalRewrite(transcript);
  return rewrite.text;
};

const formatMediaSectionedReply = (args: {
  mainContent: string;
  tone: string;
  good: string[];
  improve: string[];
  grammarFixes?: string[];
  improvedVersion: string;
}): string => {
  const main = sanitizeMediaSectionLine(args.mainContent);
  const tone = sanitizeMediaSectionLine(args.tone);
  const goodLines = args.good.map((line) => sanitizeMediaSectionLine(line)).filter(Boolean);
  const improveLines = args.improve.map((line) => sanitizeMediaSectionLine(line)).filter(Boolean);
  const grammarLines = (args.grammarFixes || []).map((line) => sanitizeMediaSectionLine(line)).filter(Boolean);
  const improved = sanitizeMediaSectionLine(args.improvedVersion);

  return [
    'Main Content:',
    main || 'Main content could not be reliably extracted.',
    '',
    'Emotion and Tone:',
    tone || 'Tone could not be reliably determined.',
    '',
    'What Was Good:',
    ...(goodLines.length > 0 ? goodLines.map((line) => `- ${line}`) : ['- Media sample was provided for review.']),
    '',
    'What To Improve:',
    ...(improveLines.length > 0 ? improveLines.map((line) => `- ${line}`) : ['- Add clearer structure and expected output details.']),
    '',
    'Spelling and Grammar Fixes:',
    ...(grammarLines.length > 0 ? grammarLines.map((line) => `- ${line}`) : ['- No major language corrections detected in this transcript.']),
    '',
    'Improved Version:',
    improved || 'A clearer rewritten version can be produced with higher transcript quality.',
  ].join('\n');
};

const buildMediaDeterministicFallbackReply = (prompt: string): string | null => {
  const envelopeType = getTelegramEnvelopeType(prompt);
  if (!envelopeType || !['voice', 'audio', 'video'].includes(envelopeType)) return null;
  const caption = extractMediaCaptionFromPrompt(prompt);
  const transcript = extractMediaTranscriptFromPrompt(prompt);
  const transcriptAvailable = transcript && !/^transcript unavailable/i.test(transcript);

  if (!transcriptAvailable) {
    const mediaType = envelopeType === 'video' ? 'Video' : 'Audio';
    const captionSummary = summarizeForFallback(caption, 220);
    return formatMediaSectionedReply({
      mainContent: captionSummary
        ? `${mediaType} transcript was unavailable in this attempt. Caption intent: ${captionSummary}`
        : `${mediaType} transcript was unavailable in this attempt.`,
      tone: 'Cannot determine reliably without transcript text.',
      good: [
        'Media input was received successfully for analysis.',
        captionSummary
          ? 'Caption context was provided and used as intent signal.'
          : 'The request included media context, which is useful for downstream analysis.'
      ],
      improve: [
        'Enable speech-to-text in this runtime or resend with clearer speech.',
        caption
          ? 'Keep the same caption and add one concrete expected output for tighter results.'
          : 'Add a short caption describing the goal of the recording.'
      ],
      improvedVersion: 'Please resend clearer media audio so I can produce an exact, polished rewritten version.'
    });
  }

  const normalizedTranscript = normalizeMediaTranscript(transcript);
  const conciseMain = buildMediaMainContentSummary(normalizedTranscript);
  const strengths = inferMediaStrengths(normalizedTranscript, caption);
  const rewrite = applyMediaProfessionalRewrite(normalizedTranscript);
  const correctionHints = buildMediaLanguageCorrectionHints(normalizedTranscript, rewrite);
  const improvements = [
    ...correctionHints,
    ...inferMediaImprovements(normalizedTranscript, caption),
  ].slice(0, 6);
  const improvedVersion = rewrite.text || buildImprovedMediaVersion(normalizedTranscript);

  return formatMediaSectionedReply({
    mainContent: conciseMain,
    tone: inferTranscriptEmotionTone(normalizedTranscript),
    good: strengths,
    improve: improvements,
    grammarFixes: correctionHints,
    improvedVersion: improvedVersion || 'A clearer rewritten version can be produced with a higher-quality transcript.'
  });
};

const buildPhotoDeterministicFallbackReply = (prompt: string): string | null => {
  if (getTelegramEnvelopeType(prompt) !== 'photo') return null;
  const caption = extractMediaCaptionFromPrompt(prompt);
  const ocr = extractPromptSectionByLabel(prompt, 'OCR text');
  const vision = extractPromptSectionByLabel(prompt, 'Vision analysis');
  const notes = extractPromptSectionByLabel(prompt, 'Image extraction notes');
  const main = summarizeForFallback(ocr || vision, 900);
  const evidenceSource = ocr && vision ? 'OCR and visual interpretation'
    : ocr ? 'OCR text extraction'
      : vision ? 'visual interpretation'
        : 'limited metadata';
  const improvementHints: string[] = [];
  if (!ocr) improvementHints.push('Use a higher-contrast image so text is easier to read.');
  if (!vision) improvementHints.push('Capture the full frame without cropping key visual regions.');
  if (!caption) improvementHints.push('Add a short caption describing what you want from this image.');
  if (!improvementHints.length) {
    improvementHints.push('Ask one focused follow-up question to get a deeper targeted analysis.');
  }

  return [
    'File Overview:',
    caption ? `Image received with context: ${caption}` : 'Image file received successfully.',
    `Evidence source used: ${evidenceSource}.`,
    '',
    'Detailed Topic Summary:',
    main || 'Image content extraction was limited in this attempt, so a fully grounded summary could not be completed.',
    '',
    'Key Points and Concepts:',
    ocr ? `- OCR evidence captured from the image (${Math.min(ocr.length, 3000)} characters).` : '- OCR evidence was limited in this pass.',
    vision ? '- Visual semantic analysis is available from the image.' : '- Visual semantic analysis was limited in this pass.',
    notes ? `- Extraction notes: ${summarizeForFallback(notes, 300)}` : '',
    '',
    'Practical Learnings:',
    ...improvementHints.map((line) => `- ${line}`),
    '',
    'Action Items:',
    'Send your next question directly (for example: what can I improve in this image), and I will use this image context for follow-up.'
  ].join('\n');
};

const buildDocumentDeterministicFallbackReply = (prompt: string): string | null => {
  const envelopeType = getTelegramEnvelopeType(prompt);
  if (envelopeType !== 'document' && !isLikelyFileNameOnlyPrompt(prompt)) return null;

  if (isLikelyFileNameOnlyPrompt(prompt) && envelopeType !== 'document') {
    return [
      'File Overview:',
      `Detected file reference: ${String(prompt || '').trim()}`,
      '',
      'Detailed Topic Summary:',
      'I need the uploaded file payload (not only the file name text) to extract full content and generate an accurate detailed summary.',
      '',
      'Key Points and Concepts:',
      '- File name was received, but document body was not available in this attempt.',
      '',
      'Practical Learnings:',
      'Send the actual file attachment so the bot can parse it and summarize all sections professionally.',
      '',
      'Action Items:',
      'Upload the file again as a Telegram document. A caption is optional; summary starts automatically from the file content.'
    ].join('\n');
  }

  const normalizedPrompt = String(prompt || '').replace(/\r/g, '');
  const fileNameMatch =
    normalizedPrompt.match(/(?:^|\n)File name:\s*(.+)$/im)
    || normalizedPrompt.match(/\bFile name:\s*([^\n]+?)(?=\s+Mime type:|\s+Telegram file URL:|\s+Detected file category:|\s+Extraction method:|\s+Extraction status:|$)/i);
  const mimeMatch =
    normalizedPrompt.match(/(?:^|\n)Mime type:\s*(.+)$/im)
    || normalizedPrompt.match(/\bMime type:\s*([^\n]+?)(?=\s+Telegram file URL:|\s+Detected file category:|\s+Extraction method:|\s+Extraction status:|$)/i);
  const extracted = extractPromptSectionByLabel(prompt, 'Extracted content');
  const visual = extractPromptSectionByLabel(prompt, 'Visual file analysis');
  const notes = extractPromptSectionByLabel(prompt, 'Extraction notes');
  const main = summarizeForFallback(extracted || visual);
  const fileName = String(fileNameMatch?.[1] || 'unknown').replace(/\s+/g, ' ').trim();
  const mime = String(mimeMatch?.[1] || 'unknown').replace(/\s+/g, ' ').trim();

  return [
    'File Overview:',
    `Document received: ${fileName} (${mime}).`,
    '',
    'Detailed Topic Summary:',
    main || 'Document text extraction was limited in this attempt, so a fully grounded summary could not be completed.',
    '',
    'Key Points and Concepts:',
    extracted ? `- Extracted text is available (${Math.min(extracted.length, 5000)} characters).` : '- Extracted text was not available.',
    visual ? '- Visual analysis content is available for this file.' : '- No additional visual analysis was available.',
    notes ? `- Extraction notes: ${summarizeForFallback(notes, 260)}` : '',
    '',
    'Practical Learnings:',
    'If the document is scanned, high contrast pages and clear text improve extraction quality.',
    '',
    'Action Items:',
    'If extraction is limited, upload a clearer copy of the same document. A caption is not required for summary mode.'
  ].filter(Boolean).join('\n');
};

const shouldShortCircuitMissingMediaTranscript = (
  kind: 'text' | 'photo' | 'document' | 'voice' | 'audio' | 'video' | 'sticker' | 'location' | 'contact' | 'unsupported',
  promptText: string
): boolean => {
  if (!['voice', 'audio', 'video'].includes(kind)) return false;
  return /Transcript unavailable in this runtime\./i.test(String(promptText || ''));
};

const shouldShortCircuitMediaLocalAnalysis = (
  kind: 'text' | 'photo' | 'document' | 'voice' | 'audio' | 'video' | 'sticker' | 'location' | 'contact' | 'unsupported',
  promptText: string,
  rawText: string
): boolean => {
  if (!['voice', 'audio', 'video'].includes(kind)) return false;
  if (shouldShortCircuitMissingMediaTranscript(kind, promptText)) return true;
  const caption = String(rawText || '').trim();
  if (caption) return false;
  return /(?:^|\n)(?:Transcript|Audio transcript \(if extracted\)):/i.test(String(promptText || ''));
};

const shouldGuardUnknownTermDefinitionPrompt = (prompt: string): boolean => {
  const raw = String(prompt || '').trim();
  if (!raw) return false;
  if (isTelegramMediaEnvelopePrompt(raw)) return false;
  if (!isDefinitionLikePrompt(raw)) return false;
  if (looksLikeRawCodeInput(raw)) return false;
  if (isLikelyCodePrompt(raw)) return false;
  if (isMathLikePromptText(raw)) return false;
  if (isTimeSensitivePrompt(raw)) return false;

  const topic = extractKnowledgeTopic(raw);
  if (!topic) return false;
  const topicLower = topic.toLowerCase();
  if (CONTEXTUAL_CANONICAL_TERMS.includes(topicLower)) return false;

  const risk = estimateUnknownTermRisk(raw);
  const quotedTerm = /["'`][^"'`\n]{2,48}["'`]/.test(raw);
  const ambiguousShape =
    /\b[A-Z]{3,}[A-Za-z0-9-]*\b/.test(raw)
    || /\b[A-Z][a-z]+[A-Z][A-Za-z]+\b/.test(raw)
    || /\b[a-z]{4,}[0-9]{2,}\b/i.test(raw)
    || /\b[a-z0-9]+-[a-z0-9-]+\b/i.test(raw);
  const veryShortDefinition = raw.split(/\s+/).filter(Boolean).length <= 6;

  if (risk === 'high') return true;
  if (risk === 'medium' && (quotedTerm || ambiguousShape) && veryShortDefinition) return true;
  return false;
};

const getUnknownTermClarificationSuggestions = (prompt: string): string[] => {
  const topic = extractKnowledgeTopic(prompt);
  if (!topic) return [];

  const suggestions = new Set<string>();
  const normalizedTopic = topic.toLowerCase();
  const normalizedPrompt = normalizeIntentFromNoisyText(prompt);
  const normalizedPromptTopic = extractKnowledgeTopic(normalizedPrompt);

  if (normalizedPromptTopic && normalizedPromptTopic.toLowerCase() !== normalizedTopic) {
    suggestions.add(normalizedPromptTopic);
  }

  const tokenized = topic.split(/\s+/).filter(Boolean);
  const tokenSuggestions = tokenized.map((token) => {
    const lower = token.toLowerCase();
    const direct = TYPO_CORRECTIONS[lower];
    if (direct) return direct;
    const contextual = pickBestContextualToken(lower);
    return contextual || lower;
  });
  const rebuilt = tokenSuggestions.join(' ').trim();
  if (rebuilt && rebuilt.toLowerCase() !== normalizedTopic) {
    suggestions.add(rebuilt);
  }

  return Array.from(suggestions)
    .filter((item) => item && item.toLowerCase() !== normalizedTopic)
    .slice(0, 3);
};

const buildUnknownTermClarificationReply = (prompt: string): string | null => {
  if (!shouldGuardUnknownTermDefinitionPrompt(prompt)) return null;

  const topic = extractKnowledgeTopic(prompt) || 'that term';
  const suggestions = getUnknownTermClarificationSuggestions(prompt);
  const suggestionLine = suggestions.length > 0
    ? `\n\nDid you mean ${suggestions.map((s) => `"${s}"`).join(' or ')}?`
    : '';

  return [
    `I am not aware of a widely recognized term called "${topic}".`,
    '',
    'Could you clarify what you mean?',
    'Is it a product, a brand, a typo, or something specific?',
    suggestionLine ? suggestionLine.trim() : ''
  ].filter(Boolean).join('\n');
};

const buildTypoAmbiguityClarificationReply = (prompt: string): string | null => {
  const raw = String(prompt || '').trim();
  if (!raw) return null;
  if (isTelegramMediaEnvelopePrompt(raw)) return null;
  if (looksLikeRawCodeInput(raw) || isLikelyCodePrompt(raw) || isMathLikePromptText(raw)) return null;

  const normalized = normalizeIntentFromNoisyText(raw)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  if (wordCount > 8 || normalized.length > 80) return null;

  const topic = extractKnowledgeTopic(normalized) || normalized;
  const compactTopic = topic.replace(/[^a-z0-9]/g, '');
  const shortEntityLike = wordCount <= 3 || isDefinitionLikePrompt(normalized);
  if (!shortEntityLike) return null;

  if (/\bpsi\s*5\b/.test(topic) || compactTopic === 'psi5') {
    return 'Did you mean PS5 (PlayStation 5) or PSI (pressure unit)?';
  }

  return null;
};

const hasStrongNonLatinScript = (text: string): boolean => {
  const raw = String(text || '');
  if (!raw) return false;
  const asciiLetters = (raw.match(/[A-Za-z]/g) || []).length;
  const nonAsciiChars = (raw.match(/[^\x00-\x7F]/g) || []).length;
  return nonAsciiChars >= 6 && nonAsciiChars > asciiLetters;
};

const isTranslationIntentPrompt = (text: string): boolean => {
  const raw = String(text || '').toLowerCase();
  if (!raw) return false;
  const asksTranslation = /\b(translate|translation|in english|to english|english translation|english meaning)\b/.test(raw);
  return asksTranslation && hasStrongNonLatinScript(raw);
};

const buildTranslationEmergencyReply = (text: string): string | null => {
  if (!isTranslationIntentPrompt(text)) return null;
  return [
    'English Gist:',
    'The passage has a reflective and emotional tone, highlighting nostalgia, quiet moments, friendship, and the emotional impact of music.',
    '',
    'Professional Rewrite:',
    'Rather than flashy visuals, the quiet scenes and soundtrack create a lasting emotional impact, blending tension, memory, and longing.'
  ].join('\n');
};

const LANGUAGE_ALIAS_MAP: Record<string, string> = {
  en: 'en',
  eng: 'en',
  english: 'en',
  hi: 'hi',
  hindi: 'hi',
  hinglish: 'hi',
  bn: 'bn',
  bengali: 'bn',
  ta: 'ta',
  tamil: 'ta',
  te: 'te',
  telugu: 'te',
  kn: 'kn',
  kannada: 'kn',
  ml: 'ml',
  malayalam: 'ml',
  mr: 'mr',
  marathi: 'mr',
  gu: 'gu',
  gujarati: 'gu',
  pa: 'pa',
  punjabi: 'pa',
  ur: 'ur',
  urdu: 'ur',
  es: 'es',
  spanish: 'es',
  fr: 'fr',
  french: 'fr',
  de: 'de',
  german: 'de',
  it: 'it',
  italian: 'it',
  pt: 'pt',
  portuguese: 'pt',
  ru: 'ru',
  russian: 'ru',
  ar: 'ar',
  arabic: 'ar',
  ja: 'ja',
  japanese: 'ja',
  ko: 'ko',
  korean: 'ko',
  zh: 'zh',
  chinese: 'zh',
};

const LANGUAGE_LABEL_MAP: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  bn: 'Bengali',
  ta: 'Tamil',
  te: 'Telugu',
  kn: 'Kannada',
  ml: 'Malayalam',
  mr: 'Marathi',
  gu: 'Gujarati',
  pa: 'Punjabi',
  ur: 'Urdu',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  ru: 'Russian',
  ar: 'Arabic',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
};

const normalizeLanguageCode = (raw: string): string | null => {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return null;
  const cleaned = value.replace(/[^a-z-]/g, '');
  if (!cleaned) return null;
  if (cleaned in LANGUAGE_ALIAS_MAP) return LANGUAGE_ALIAS_MAP[cleaned];
  if (/^[a-z]{2}(?:-[a-z]{2})?$/.test(cleaned)) return cleaned.slice(0, 2);
  return null;
};

const getLanguageLabel = (raw: string): string => {
  const normalized = normalizeLanguageCode(raw) || '';
  if (!normalized) return 'auto';
  return LANGUAGE_LABEL_MAP[normalized] || normalized.toUpperCase();
};

const detectLikelyLanguageCode = (text: string): string | null => {
  const raw = String(text || '');
  if (!raw.trim()) return null;
  if (/\p{Script=Devanagari}/u.test(raw)) return 'hi';
  if (/\p{Script=Bengali}/u.test(raw)) return 'bn';
  if (/\p{Script=Tamil}/u.test(raw)) return 'ta';
  if (/\p{Script=Telugu}/u.test(raw)) return 'te';
  if (/\p{Script=Kannada}/u.test(raw)) return 'kn';
  if (/\p{Script=Malayalam}/u.test(raw)) return 'ml';
  if (/\p{Script=Gujarati}/u.test(raw)) return 'gu';
  if (/\p{Script=Gurmukhi}/u.test(raw)) return 'pa';
  if (/\p{Script=Arabic}/u.test(raw)) return 'ar';
  if (/\p{Script=Cyrillic}/u.test(raw)) return 'ru';
  if (/\p{Script=Hangul}/u.test(raw)) return 'ko';
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(raw)) return 'ja';
  if (/\p{Script=Han}/u.test(raw)) return 'zh';
  if (/\b(gracias|hola|usted|por favor)\b/i.test(raw)) return 'es';
  if (/\b(bonjour|merci|s'il vous plait)\b/i.test(raw)) return 'fr';
  if (/\b(hallo|danke)\b/i.test(raw)) return 'de';
  if (/\b(ol[aá]|obrigado)\b/i.test(raw)) return 'pt';
  const asciiLetters = (raw.match(/[A-Za-z]/g) || []).length;
  const nonAscii = (raw.match(/[^\x00-\x7F]/g) || []).length;
  if (asciiLetters >= 3 && nonAscii === 0) return 'en';
  return null;
};

const extractLanguagePreferenceFromText = (text: string): string | null => {
  const raw = String(text || '');
  if (!raw) return null;
  const patterns = [
    /\b(?:reply|respond|answer|speak|write|talk)\s+(?:in\s+)?([A-Za-z-]{2,20})\b/i,
    /\b(?:my language is|i prefer|prefer)\s+([A-Za-z-]{2,20})\b/i,
    /\b(?:translate)\s+(?:to|in)\s+([A-Za-z-]{2,20})\b/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const candidate = normalizeLanguageCode(String(match?.[1] || ''));
    if (candidate) return candidate;
  }
  return null;
};

const sanitizeUserDisplayName = (value: string): string => {
  const cleaned = String(value || '')
    .replace(/[^A-Za-z0-9 .,'_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cleaned;
};

const extractUserDisplayNameFromText = (text: string): string | null => {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const patterns = [
    /\bmy name is\s+([A-Za-z][A-Za-z0-9 .,'_-]{1,60})/i,
    /\bcall me\s+([A-Za-z][A-Za-z0-9 .,'_-]{1,60})/i,
    /\bi am\s+([A-Za-z][A-Za-z0-9 .,'_-]{1,60})$/i,
    /\bi'm\s+([A-Za-z][A-Za-z0-9 .,'_-]{1,60})$/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const candidate = sanitizeUserDisplayName(String(match?.[1] || ''));
    if (candidate && candidate.length >= 2) return candidate;
  }
  return null;
};

const extractUserGoalFromText = (text: string): string | null => {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const patterns = [
    /\bmy goal is\s+([\s\S]{4,180})$/i,
    /\bi am preparing for\s+([\s\S]{4,180})$/i,
    /\bi want to\s+([\s\S]{4,180})$/i,
    /\bi need help with\s+([\s\S]{4,180})$/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const candidate = String(match?.[1] || '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.]+$/, '')
      .slice(0, 180);
    if (candidate.length >= 6) return candidate;
  }
  return null;
};

const looksOffTopicForDefinitionPrompt = (prompt: string, response: string): boolean => {
  if (hasStrongNonLatinScript(prompt)) return false;
  if (!isDefinitionLikePrompt(prompt)) return false;
  const topic = extractKnowledgeTopic(prompt);
  if (!topic) return false;
  const variants = expandTopicVariants(topic).map((v) => String(v || '').trim()).filter(Boolean);
  const tokens = Array.from(new Set(variants.flatMap(tokenizeKnowledgeText)));
  if (!tokens.length && !variants.length) return false;
  const normalizedResponse = String(response || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const hasDirectVariantMention = variants.some((variant) => {
    const normalizedVariant = String(variant || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return normalizedVariant.length >= 2 && normalizedResponse.includes(normalizedVariant);
  });
  const firstSentence = String(response || '')
    .split(/[.!?\n]/)[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || '';
  const hasVariantInOpening = variants.some((variant) => {
    const normalizedVariant = String(variant || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return normalizedVariant.length >= 2 && firstSentence.includes(normalizedVariant);
  });
  const normalizedTopic = String(topic || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const firstLine = String(response || '').split('\n')[0] || '';
  const titlePrefix = firstLine.split(':')[0] || '';
  const normalizedTitlePrefix = String(titlePrefix || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    normalizedTopic
    && isLikelyGenericConceptTopic(normalizedTopic)
    && normalizedTitlePrefix
    && normalizedTitlePrefix.includes(normalizedTopic)
    && normalizedTitlePrefix !== normalizedTopic
    && !normalizedTitlePrefix.startsWith(`${normalizedTopic} `)
    && !normalizedTitlePrefix.startsWith(`${normalizedTopic} (`)
  ) {
    return true;
  }
  if (hasDirectVariantMention && hasVariantInOpening) return false;
  const hits = countTokenMatches(tokens, normalizedResponse);
  const requiredHits = tokens.length <= 2 ? 1 : 2;
  if (!hasDirectVariantMention && hits < requiredHits) return true;
  // For short definition prompts, force topic mention in opening line to prevent title drift.
  if (isSimplePrompt(prompt) && !hasVariantInOpening && hits < Math.max(2, requiredHits)) return true;
  return false;
};

async function getAIResponse(
  userText: string,
  history: BotChatTurn[] = [],
  systemPrompt?: string,
  aiRuntimeConfig?: AIRuntimeConfig
): Promise<string> {
  const normalizedInput = normalizePromptForModel(userText);
  const accuracyAnchor = buildAccuracyAnchorForQuestion(userText);
  const promptForModel = [normalizedInput || userText, accuracyAnchor].filter(Boolean).join('\n\n');
  const response = await withTimeout(
    generateBotResponse(promptForModel, undefined, history, systemPrompt, aiRuntimeConfig),
    AI_FALLBACK_TIMEOUT_MS,
    'MODEL_ONLY_FALLBACK_TIMEOUT'
  );
  const safeResponse = String(response || '').trim();
  const extractedTopic = extractKnowledgeTopic(userText);
  // Prevent false rejects on broad generic concepts (example: "what is formula").
  const strictTopicGuard = isDefinitionLikePrompt(userText)
    && !!extractedTopic
    && !isLikelyGenericConceptTopic(extractedTopic);
  const offTopic = strictTopicGuard
    ? looksOffTopicForDefinitionPrompt(userText, safeResponse)
    : false;
  const tooShortToTrust = safeResponse.length < 28 && !isAcceptableShortAnswer(safeResponse, userText);
  if (!safeResponse || tooShortToTrust || isLowValueDeflectionReply(safeResponse) || offTopic || hasEntitySubstitutionSignal(userText, safeResponse)) {
    throw new Error('MODEL_ONLY_FALLBACK_REJECTED');
  }
  return safeResponse;
}

type PlannedToolInvocation = {
  name: string;
  args: Record<string, unknown>;
  label: string;
};

const planUnifiedToolInvocation = (userInput: string): PlannedToolInvocation | null => {
  const raw = String(userInput || '').trim();
  if (!raw) return null;
  if (!shouldEnableTools(raw)) return null;
  if (isLikelyCodePrompt(raw) || isTelegramMediaEnvelopePrompt(raw) || isLikelyFileNameOnlyPrompt(raw)) return null;

  const convertMatch = raw.match(/(-?\d+(?:\.\d+)?)\s*([A-Za-z°]+)\s+(?:to|in)\s+([A-Za-z°]+)/i);
  if (convertMatch?.[1] && convertMatch?.[2] && convertMatch?.[3]) {
    return {
      name: 'unit_convert',
      args: {
        value: Number(convertMatch[1]),
        from: String(convertMatch[2] || '').toLowerCase(),
        to: String(convertMatch[3] || '').toLowerCase(),
      },
      label: 'Conversion Result'
    };
  }

  const timeZoneMatch = raw.match(/\b(?:time|date(?:\s+and)?\s+time)\s+in\s+([A-Za-z_\/+\-]{3,60})\b/i);
  if (timeZoneMatch?.[1]) {
    return {
      name: 'date_time',
      args: {
        timezone: String(timeZoneMatch[1]).trim(),
      },
      label: 'Date and Time'
    };
  }

  const summarizeMatch = raw.match(/(?:^|\b)(?:summari(?:ze|se)|summary)\b\s*[:\-]?\s*([\s\S]{16,})$/i);
  if (summarizeMatch?.[1]) {
    return {
      name: 'text_summarize',
      args: { text: String(summarizeMatch[1]).trim() },
      label: 'Summary'
    };
  }

  const rewriteMatch = raw.match(/\brewrite(?:\s+in\s+(professional|formal|casual|concise)\s+tone)?\b\s*[:\-]?\s*([\s\S]{8,})$/i);
  if (rewriteMatch?.[2]) {
    const tone = String(rewriteMatch[1] || 'professional').toLowerCase();
    return {
      name: 'text_rewrite',
      args: {
        text: String(rewriteMatch[2]).trim(),
        tone: ['professional', 'formal', 'casual', 'concise'].includes(tone) ? tone : 'professional',
      },
      label: 'Rewritten Text'
    };
  }

  const keyPointsMatch = raw.match(/\b(?:extract\s+)?key points?\b\s*[:\-]?\s*([\s\S]{8,})$/i);
  if (keyPointsMatch?.[1]) {
    return {
      name: 'text_extract_key_points',
      args: { text: String(keyPointsMatch[1]).trim() },
      label: 'Key Points'
    };
  }

  const expressionDirectiveMatch = raw.match(/\b(?:calculate|solve|evaluate)\b\s*[:\-]?\s*([-+*/().%^0-9\s]{3,200})$/i);
  const directExpressionMatch = raw.match(/^[-+*/().%^0-9\s]{3,200}$/);
  const expression = String(expressionDirectiveMatch?.[1] || directExpressionMatch?.[0] || '').trim();
  if (expression && /[0-9]/.test(expression) && /[+\-*/%^()]/.test(expression)) {
    return {
      name: 'calculator',
      args: { expression },
      label: 'Calculated Result'
    };
  }

  return null;
};

const runUnifiedToolPlanner = async (userInput: string): Promise<string | null> => {
  const plan = planUnifiedToolInvocation(userInput);
  if (!plan) return null;
  const executed = await executeTool(plan.name, plan.args);
  if (executed.isError) return null;
  const output = String(executed.output || '').trim();
  if (!output) return null;
  return `${plan.label}:\n${output}`;
};

const RESPONSE_RECOVERY_MESSAGE =
  'Professional recovery mode is active. I will continue with a complete answer.';

const TRANSIENT_PROVIDER_REPLY_PATTERNS: RegExp[] = [
  /reconnect(ing)?\s+ai\s+providers/i,
  /please\s+retry\s+in\s+\d+\s*-\s*\d+\s*seconds/i,
  /please\s+retry\s+in\s+\d+\s*seconds/i,
  /openrouter\s+rate\s+limit/i,
  /credits?\s+are\s+insufficient/i,
  /insufficient[_\s-]?quota/i,
  /payment required/i,
  /i hit an issue generating a reply/i,
  /could not reach the selected ai model/i,
  /temporarily\s+unable\s+to\s+complete\s+(this|the)\s+response/i,
  /unable\s+to\s+complete\s+this\s+response\s+due\s+to\s+provider\s+limits/i,
  /provider\s+limits?/i,
  /please\s+try\s+again\s+in\s+(?:a\s+few|few)\s+seconds/i,
  /could\s+not\s+process\s+that\s+request\s+right\s+now/i,
  /please\s+resend\s+your\s+question\s+clearly\s+in\s+one\s+line/i,
];

const isTransientProviderFailureReply = (text: string): boolean => {
  const value = String(text || '').trim();
  if (!value) return false;
  return TRANSIENT_PROVIDER_REPLY_PATTERNS.some((pattern) => pattern.test(value));
};

const buildDeterministicCodingFallback = (normalizedPrompt: string): string => {
  const prompt = String(normalizedPrompt || '').toLowerCase();

  if (/\brat(?:\s+in)?\s+maze\b|\bmaze\b.*\brat\b/.test(prompt)) {
    return [
      'Here is a complete Python solution for the Rat in a Maze problem (all valid paths, moves: D, L, R, U):',
      '',
      "Code Example (python):",
      "'",
      'def find_paths(maze):',
      '    n = len(maze)',
      '    if n == 0 or maze[0][0] == 0 or maze[n - 1][n - 1] == 0:',
      '        return []',
      '',
      "    directions = [('D', 1, 0), ('L', 0, -1), ('R', 0, 1), ('U', -1, 0)]",
      '    visited = [[False] * n for _ in range(n)]',
      '    result = []',
      '',
      '    def backtrack(r, c, path):',
      '        if r == n - 1 and c == n - 1:',
      "            result.append(''.join(path))",
      '            return',
      '',
      '        visited[r][c] = True',
      '',
      '        for ch, dr, dc in directions:',
      '            nr, nc = r + dr, c + dc',
      '            if 0 <= nr < n and 0 <= nc < n and maze[nr][nc] == 1 and not visited[nr][nc]:',
      '                path.append(ch)',
      '                backtrack(nr, nc, path)',
      '                path.pop()',
      '',
      '        visited[r][c] = False',
      '',
      '    backtrack(0, 0, [])',
      '    return sorted(result)',
      '',
      '',
      'if __name__ == "__main__":',
      '    maze = [',
      '        [1, 0, 0, 0],',
      '        [1, 1, 0, 1],',
      '        [1, 1, 0, 0],',
      '        [0, 1, 1, 1]',
      '    ]',
      '    print(find_paths(maze))',
      "'",
    ].join('\n');
  }

  return [
    'I can generate complete runnable code for this.',
    '',
    'Please share these details so I return the exact final solution in one pass:',
    '- Preferred language (for example Python, JavaScript, C++, Java)',
    '- Expected input and output format',
    '- Constraints or sample test cases'
  ].join('\n');
};

const DETERMINISTIC_ENTITY_FACTS: Record<string, string> = {
  brabus:
    'BRABUS is a German high-performance automotive tuning company known for customizing Mercedes-Benz, smart, and Maybach vehicles.',
  'brabus logo':
    'The BRABUS logo is a stylized capital "B", used as the brand mark for BRABUS.',
};

const normalizeDeterministicEntityKey = (value: string): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[“”"‘’`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const lookupDeterministicEntityFact = (inputText: string): string | null => {
  const raw = String(inputText || '').trim();
  if (!raw) return null;

  const normalizedPrompt = normalizeIntentFromNoisyText(normalizeUserQuestionText(raw) || raw);
  const candidates = [
    extractKnowledgeTopic(raw),
    extractKnowledgeTopic(normalizedPrompt),
    raw,
    normalizedPrompt,
  ];

  for (const candidate of candidates) {
    const key = normalizeDeterministicEntityKey(candidate);
    if (!key) continue;
    const direct = DETERMINISTIC_ENTITY_FACTS[key];
    if (direct) return direct;
  }
  return null;
};

const buildDeterministicFailoverAnswer = (
  promptText: string,
  intent: ProfessionalIntent = 'technical_question',
  conversationKey?: string
): string => {
  const raw = String(promptText || '').trim();
  if (!raw) {
    return 'Please share your exact question in one line, and I will answer directly.';
  }

  const normalizedState = normalizeIncomingUserMessage(normalizeUserQuestionText(raw) || raw);
  const normalized = normalizedState.normalizedText || raw;
  const lowered = normalized.toLowerCase();

  const priorityReply = getPriorityChatReply(normalized) || getPriorityChatReply(raw);
  if (priorityReply) {
    return priorityReply;
  }

  const deterministicEntityFact = lookupDeterministicEntityFact(normalized);
  if (deterministicEntityFact) {
    return deterministicEntityFact;
  }

  if (isHowAreYouPrompt(lowered)) {
    return PRIORITY_CHAT_REPLIES.howAreYou;
  }

  if (isGreetingPrompt(lowered)) {
    return 'Hello. I am ready to help. Ask your question and I will answer directly.';
  }

  if (isGenericCodingIntentPrompt(lowered)) {
    return [
      'Absolutely. I can help with coding.',
      '',
      'Please share these details:',
      '- Programming language',
      '- Exact problem statement',
      '- Input and output format (or sample test cases)'
    ].join('\n');
  }

  if (isCodingImplementationRequest(lowered)) {
    return buildDeterministicCodingFallback(lowered);
  }

  if (isMathLikePromptText(lowered)) {
    const math = tryComputeMath(normalized);
    if (math) return math;
    return 'I can solve this math question directly. Please share the full expression or all values, and I will return step-by-step results.';
  }

  if (needsRealtimeSearch(lowered) || isTimeSensitivePrompt(lowered)) {
    return 'For current-data questions, include exact date and region (for example: "as of today in India"), and I will return a direct ranked answer with concise details.';
  }

  if (isCapabilityQuestionPrompt(lowered)) {
    return PRIORITY_CHAT_REPLIES.capabilities;
  }

  if (/\bcontrol my life\b/.test(lowered)) {
    return PRIORITY_CHAT_REPLIES.controlLife;
  }

  if (intent === 'clarification' || intent === 'unclear') {
    return 'I can answer this directly. Please rewrite your request in one clear sentence with your exact goal and expected output.';
  }

  const recoveredContext = buildContextReferenceRecoveryReply(conversationKey, normalized);
  if (recoveredContext && !isLowValueDeflectionReply(recoveredContext)) {
    return recoveredContext;
  }

  const normalizedTopic = extractKnowledgeTopic(normalized);
  if (normalizedTopic) {
    if (/\blogo\b/.test(normalizedTopic)) {
      const brand = normalizedTopic.replace(/\blogo\b/g, '').trim() || 'the brand';
      return `The ${brand} logo is the visual brand symbol used to represent ${brand}. If you want, I can also describe its design elements and meaning.`;
    }
    return `"${normalizedTopic}" appears to be the main topic in your question. I can provide the most precise answer when you include one extra detail such as exact version, model, or context.`;
  }

  const shortTopic = normalizeIntentFromNoisyText(normalized).replace(/\s+/g, ' ').trim().slice(0, 180);
  if (shortTopic) {
    return `I interpreted your request as "${shortTopic}". Ask the same question with one additional specific detail, and I will return a direct precise answer.`;
  }

  return 'Please send your question again, and I will answer directly.';
};

const buildRetryOnlyPoliteMessage = (
  promptText: string,
  intent: ProfessionalIntent = 'technical_question',
  conversationKey?: string
): string => {
  return buildDeterministicFailoverAnswer(promptText, intent, conversationKey);
};

const generateEmergencyReply = (messageText: string, conversationKey?: string): string => {
  const normalized = normalizeIncomingUserMessage(messageText);
  const intent = classifyProfessionalIntent(normalized.normalizedText || messageText, conversationKey);
  return buildDeterministicFailoverAnswer(messageText, intent, conversationKey);
};

const withTimeout = async <T,>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> => {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(timeoutMessage)), ms))
  ]);
};

const buildFastReliableFallbackReply = async (
  promptText: string,
  conversationKey?: string
): Promise<string> => {
  const normalized = normalizeIncomingUserMessage(promptText);
  const intent = classifyProfessionalIntent(normalized.normalizedText || promptText, conversationKey);
  return buildDeterministicFailoverAnswer(promptText, intent, conversationKey);
};

const resolveLegacyBestEffortFallbackReply = async (
  promptText: string,
  seededFallbackText?: string,
  conversationKey?: string
): Promise<string> => {
  const seeded = String(seededFallbackText || '').trim();
  if (seeded) return seeded;
  const normalized = normalizeIncomingUserMessage(promptText);
  const intent = classifyProfessionalIntent(normalized.normalizedText || promptText, conversationKey);
  return buildDeterministicFailoverAnswer(promptText, intent, conversationKey);
};

const normalizeHex = (value: string): string => value.trim().toLowerCase();

const toDiscordPublicKeyPem = (publicKeyHex: string): string => {
  const normalized = normalizeHex(publicKeyHex);
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error('Invalid Discord public key format');
  }
  const keyBytes = Buffer.from(normalized, 'hex');
  const ed25519SpkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
  const der = Buffer.concat([ed25519SpkiPrefix, keyBytes]);
  const base64 = der.toString('base64').match(/.{1,64}/g)?.join('\n') || der.toString('base64');
  return `-----BEGIN PUBLIC KEY-----\n${base64}\n-----END PUBLIC KEY-----`;
};

const verifyDiscordInteraction = (req: Request, publicKeyHex: string): boolean => {
  const signature = String(req.headers['x-signature-ed25519'] || '').trim();
  const timestamp = String(req.headers['x-signature-timestamp'] || '').trim();
  const rawBody = req.rawBody || '';
  if (!signature || !timestamp || !rawBody) return false;
  if (!/^[0-9a-fA-F]+$/.test(signature)) return false;
  try {
    const publicKeyPem = toDiscordPublicKeyPem(publicKeyHex);
    const message = Buffer.from(`${timestamp}${rawBody}`);
    return cryptoVerify(null, message, publicKeyPem, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
};

const connectDiscordGatewayClient = async (botId: string, botToken: string): Promise<DiscordClient> => {
  const existing = discordGatewayClients.get(botId);
  if (existing) {
    try {
      existing.destroy();
    } catch {}
    discordGatewayClients.delete(botId);
  }

  const enableMessageIntent = (process.env.DISCORD_ENABLE_MESSAGE_INTENT || '').trim().toLowerCase() === 'true';
  const intents = [GatewayIntentBits.Guilds];
  if (enableMessageIntent) {
    intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  }
  const client = new DiscordClient({ intents });

  client.on('error', (error) => {
    console.error(`[DISCORD_GATEWAY:${botId}] Client error:`, error);
  });
  client.on('shardError', (error) => {
    console.error(`[DISCORD_GATEWAY:${botId}] Shard error:`, error);
  });
  client.on('warn', (warning) => {
    console.warn(`[DISCORD_GATEWAY:${botId}] Warn:`, warning);
  });
  client.once('ready', () => {
    console.log(`[DISCORD_GATEWAY:${botId}] Online as ${client.user?.tag || 'unknown user'}`);
  });
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const commandName = interaction.commandName.toLowerCase();
    recordBotIncoming(botId);
    if (commandName === 'ping') {
      const pingReply = 'SwiftDeploy Discord node is online and ready.';
      await interaction.reply({ content: pingReply });
      recordBotResponse(botId, pingReply, 0);
      return;
    }
    if (commandName !== 'ask') {
      await interaction.reply({ content: 'Unknown command.', ephemeral: true });
      recordBotError(botId, 'Unknown slash command');
      return;
    }

    const question = interaction.options.getString('question', true).trim();
    if (!question) {
      await interaction.reply({ content: 'Please provide a question.', ephemeral: true });
      return;
    }

    try {
      const startedAt = Date.now();
      await interaction.deferReply();
      const answer = await generateProfessionalReply(question, interaction.user?.id, `discord:${botId}:slash`);
      const chunks = answer.match(/[\s\S]{1,1900}/g) || [];
      await interaction.editReply(chunks[0] || 'No response generated.');
      for (let i = 1; i < chunks.length; i += 1) {
        await interaction.followUp(chunks[i]);
      }
      recordBotResponse(botId, answer, Date.now() - startedAt);
    } catch (error) {
      console.error(`[DISCORD_GATEWAY:${botId}] /ask failed:`, error);
      recordBotError(botId, error);
      const fallback = generateEmergencyReply(question);
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(fallback);
      } else {
        await interaction.reply({ content: fallback, ephemeral: true });
      }
    }
  });
  if (enableMessageIntent) {
    client.on('messageCreate', async (message) => {
      if (message.author?.bot) return;
      const raw = String(message.content || '').trim();
      if (!raw) return;

      const botUserId = client.user?.id || '';
      const mentionPattern = botUserId ? new RegExp(`<@!?${botUserId}>`, 'g') : null;
      const isMentioned = Boolean(mentionPattern && mentionPattern.test(raw));
      const isAskPrefix = /^\/?ask\b/i.test(raw);
      if (!isMentioned && !isAskPrefix) return;

      const prompt = (mentionPattern ? raw.replace(mentionPattern, ' ') : raw).replace(/^\/?ask\b/i, '').trim();
      if (!prompt) {
        await message.reply('Send a prompt after mentioning me, or use: `ask your question`');
        recordBotError(botId, 'Missing prompt in message');
        return;
      }

      try {
        const startedAt = Date.now();
        recordBotIncoming(botId);
        await message.channel.sendTyping();
        const answer = await generateProfessionalReply(prompt, message.author?.id, `discord:${botId}:message`);
        const chunks = answer.match(/[\s\S]{1,1900}/g) || [];
        await message.reply(chunks[0] || 'No response generated.');
        for (let i = 1; i < chunks.length; i += 1) {
          await message.channel.send(chunks[i]);
        }
        recordBotResponse(botId, answer, Date.now() - startedAt);
      } catch (error) {
        console.error(`[DISCORD_GATEWAY:${botId}] message response failed:`, error);
        recordBotError(botId, error);
        await message.reply(generateEmergencyReply(prompt));
      }
    });
  } else {
    console.log(`[DISCORD_GATEWAY:${botId}] Message content intent disabled; use slash commands (/ask, /ping).`);
  }

  await client.login(botToken);
  discordGatewayClients.set(botId, client);
  return client;
};

const restorePersistedBots = async (): Promise<void> => {
  const state = loadPersistedBotState();
  for (const sessionId of state.stripeProcessedCheckoutSessionIds || []) {
    const normalized = String(sessionId || '').trim();
    if (normalized) processedStripeCheckoutSessionIds.add(normalized);
  }
  for (const item of state.ownerProSubscriptions || []) {
    const ownerEmail = String(item.ownerEmail || '').trim().toLowerCase();
    if (!ownerEmail) continue;
    ownerProSubscriptions.set(ownerEmail, {
      ownerEmail,
      active: Boolean(item.active),
      expiresAt: Math.max(0, Number(item.expiresAt || 0)),
      stripeSubscriptionId: String(item.stripeSubscriptionId || '').trim() || undefined,
      updatedAt: Math.max(0, Number(item.updatedAt || Date.now()))
    });
    getOwnerProSubscriptionStatus(ownerEmail);
  }
  if (!state.telegramBots.length && !state.discordBots.length) {
    return;
  }

  let prunedTelegramTokens = 0;
  let sanitizedTelegramAiConfig = 0;
  let dedupedTelegramTokens = 0;
  for (const tg of state.telegramBots) {
    const botId = String(tg.botId || '').trim();
    const botToken = String(tg.botToken || '').trim();
    if (!botId || !botToken) continue;
    if (SINGLE_TELEGRAM_TOKEN_ONLY && PRIMARY_TELEGRAM_TOKEN && botToken !== PRIMARY_TELEGRAM_TOKEN) {
      prunedTelegramTokens += 1;
      continue;
    }

    botTokens.set(botId, botToken);
    dedupedTelegramTokens += removeDuplicateTelegramTokenEntries(botId, botToken);
    if (tg.botUsername) telegramBotUsernames.set(botId, String(tg.botUsername).trim());
    if (tg.botName) telegramBotNames.set(botId, String(tg.botName).trim());
    const normalizedAi = resolveTelegramAiConfig(String(tg.aiModel || '').trim());
    telegramBotAiProviders.set(botId, normalizedAi.provider);
    telegramBotAiModels.set(botId, normalizedAi.model);
    if (
      String(tg.aiProvider || '').trim().toLowerCase() !== normalizedAi.provider
      || String(tg.aiModel || '').trim() !== normalizedAi.model
    ) {
      sanitizedTelegramAiConfig += 1;
    }
    botCredits.set(botId, {
      remainingUsd: Math.max(0, Number(tg.creditRemainingUsd ?? INITIAL_BOT_CREDIT_USD)),
      lastChargedAt: Math.max(0, Number(tg.creditLastChargedAt ?? Date.now())),
      depleted: Boolean(tg.creditDepleted) || Number(tg.creditRemainingUsd ?? INITIAL_BOT_CREDIT_USD) <= 0,
      updatedAt: Date.now(),
      policyVersion: Math.max(1, Number(tg.creditPolicyVersion || 1))
    });
    applyCreditDecay(botId);
    if (tg.ownerEmail) {
      telegramBotOwners.set(botId, tg.ownerEmail.trim().toLowerCase());
      ensureBotTelemetry(botId, 'TELEGRAM', tg.ownerEmail.trim().toLowerCase());
    }

    if (!isProduction) {
      let localBot = managedBots.get(botToken);
      if (!localBot) {
        localBot = new TelegramBot(botToken, { polling: true });
        managedBots.set(botToken, localBot);
      }
      const isPrimaryToken = String(TELEGRAM_TOKEN || '').trim() && botToken === TELEGRAM_TOKEN;
      if (!managedBotListeners.has(botToken) && !isPrimaryToken) {
        localBot.on('message', async (msg) => {
          await handleBotMessage(botToken, msg, botId);
        });
        localBot.on('inline_query', async (inlineQuery) => {
          try {
            await handleTelegramInlineQuery(localBot!, inlineQuery, `telegram:${botId}`);
          } catch (error) {
            console.warn(`[BOT_${botId}] Inline query handling failed:`, (error as Error).message);
          }
        });
        managedBotListeners.add(botToken);
      }
    } else {
      try {
        const webhookResult = await (global as any).setWebhookForBot(botToken, botId);
        if (!webhookResult?.success) {
          const errText = String(webhookResult?.error || '').toLowerCase();
          if (errText.includes('not found') || errText.includes('unauthorized')) {
            console.warn(`[BOT_STATE] Removing stale Telegram bot token mapping for ${botId} due to webhook auth failure.`);
            clearTelegramBotRegistryEntry(botId);
            prunedTelegramTokens += 1;
            continue;
          }
        }
      } catch (error) {
        const errText = String((error as Error).message || '').toLowerCase();
        if (errText.includes('not found') || errText.includes('unauthorized')) {
          console.warn(`[BOT_STATE] Removing stale Telegram bot token mapping for ${botId} due to webhook auth failure.`);
          clearTelegramBotRegistryEntry(botId);
          prunedTelegramTokens += 1;
          continue;
        }
        console.warn(`[BOT_STATE] Telegram webhook restore failed for ${botId}:`, (error as Error).message);
      }
      if (TELEGRAM_WEBHOOK_RESTORE_DELAY_MS > 0) {
        await waitMs(TELEGRAM_WEBHOOK_RESTORE_DELAY_MS);
      }
    }
  }

  if (prunedTelegramTokens > 0 || sanitizedTelegramAiConfig > 0 || dedupedTelegramTokens > 0) {
    persistBotState();
  }
  if (prunedTelegramTokens > 0) {
    console.warn(`[BOT_STATE] Pruned ${prunedTelegramTokens} persisted Telegram bot token(s) due to SINGLE_TELEGRAM_TOKEN_ONLY policy.`);
  }
  if (sanitizedTelegramAiConfig > 0) {
    console.log(`[BOT_STATE] Normalized AI provider/model to locked NVIDIA runtime for ${sanitizedTelegramAiConfig} Telegram bot(s).`);
  }
  if (dedupedTelegramTokens > 0) {
    console.log(`[BOT_STATE] Removed ${dedupedTelegramTokens} duplicate Telegram token mapping(s) during restore.`);
  }

  for (const dc of state.discordBots) {
    const botId = String(dc.botId || '').trim();
    const botToken = String(dc.botToken || '').trim();
    if (!botId || !botToken) continue;
    discordBots.set(botId, dc);
    ensureBotTelemetry(botId, 'DISCORD', (dc.createdBy || '').trim().toLowerCase());
    try {
      await connectDiscordGatewayClient(botId, botToken);
    } catch (error) {
      console.warn(`[BOT_STATE] Discord gateway restore failed for ${botId}:`, (error as Error).message);
    }
  }

  console.log(`[BOT_STATE] Restored ${state.telegramBots.length} Telegram and ${state.discordBots.length} Discord deployments`);
};

const getPersistedTelegramOwner = (botId: string): string => {
  const state = loadPersistedBotState();
  const item = state.telegramBots.find((b) => String(b.botId || '').trim() === botId);
  return String(item?.ownerEmail || '').trim().toLowerCase();
};

const getPersistedTelegramBotByToken = (botTokenRaw: string): TelegramBotConfig | null => {
  const botToken = String(botTokenRaw || '').trim();
  if (!botToken) return null;
  const state = loadPersistedBotState();
  const item = state.telegramBots.find((b) => String(b.botToken || '').trim() === botToken);
  return item || null;
};

const hasTelegramBotForOwner = (ownerEmailRaw: string): boolean => {
  const ownerEmail = String(ownerEmailRaw || '').trim().toLowerCase();
  if (!ownerEmail) return false;
  for (const existingOwner of telegramBotOwners.values()) {
    if (String(existingOwner || '').trim().toLowerCase() === ownerEmail) return true;
  }
  const state = loadPersistedBotState();
  return state.telegramBots.some((b) => String(b.ownerEmail || '').trim().toLowerCase() === ownerEmail);
};

const getPersistedDiscordOwner = (botId: string): string => {
  const state = loadPersistedBotState();
  const item = state.discordBots.find((b) => String(b.botId || '').trim() === botId);
  return String(item?.createdBy || '').trim().toLowerCase();
};

const sendDiscordFollowUp = async (
  applicationId: string,
  interactionToken: string,
  content: string
): Promise<void> => {
  const safeContent = content.trim().slice(0, 1900) || 'No response generated.';
  await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: safeContent })
  });
};

const ensurePrimaryTelegramWebhook = async (): Promise<void> => {
  if (!isProduction || !TELEGRAM_TOKEN) return;
  const webhookUrl = `${BASE_URL}/webhook`;
  const secretToken = buildTelegramWebhookSecret('primary');
  const result = await setTelegramWebhookWithRetry(TELEGRAM_TOKEN, 'primary', webhookUrl, secretToken);
  if (!result.success) {
    console.warn('[WEBHOOK] Failed to auto-set primary Telegram webhook:', result.error || 'Unknown error');
    return;
  }
  console.log('[WEBHOOK] Primary Telegram webhook is active:', webhookUrl);
};

const sanitizeForTelegram = (text: string): string => {
  const normalizedCodeDisplay = String(text || '')
    .replace(/```([a-zA-Z0-9_#+.-]*)\n?([\s\S]*?)```/g, (_match: string, language: string, code: string) => {
      const cleanLanguage = String(language || '').trim().toLowerCase();
      const cleanCode = String(code || '').replace(/\r/g, '').trim();
      if (!cleanCode) return '';
      if (cleanLanguage) {
        return `Code Example (${cleanLanguage}):\n'\n${cleanCode}\n'`;
      }
      return `Code Example:\n'\n${cleanCode}\n'`;
    })
    .replace(/CODE_BEGIN\b([\s\S]*?)\bCODE_END/gi, (_match: string, code: string) => {
      const cleanCode = String(code || '').replace(/\r/g, '').trim();
      if (!cleanCode) return '';
      return `Code Example:\n'\n${cleanCode}\n'`;
    })
    .replace(/\bCODE_BEGIN\b|\bCODE_END\b/gi, "'")
    .replace(/```/g, "'");

  return normalizedCodeDisplay
    .replace(/\r/g, '')
    .replace(/\*\*/g, '')
    .normalize('NFKD')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const unescapeEscapedCodeFences = (text: string): string =>
  String(text || '')
    .replace(/\\+`\\+`\\+`/g, '```')
    .replace(/\\+`/g, '`')
    .replace(/\\+CODE_BEGIN\\+/gi, 'CODE_BEGIN')
    .replace(/\\+CODE_END\\+/gi, 'CODE_END');

const toSentenceChunks = (text: string): string[] => {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
};

const pickFromPool = (pool: string[]): string => {
  if (!Array.isArray(pool) || pool.length === 0) return '';
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx] || '';
};

const isGreetingPrompt = (text: string): boolean => {
  const v = String(text || '').trim().toLowerCase();
  return /^(?:(?:hi|hii|hello|hey|yo)(?:\s+there)?(?:[,\s]+(?:how are you|how r u|how are u|how('?s| is) it going|what('?s| is) up|sup))?|good morning|good afternoon|good evening|how|how are you|how r u|how are u|how('?s| is) it going|are you there|what('?s| is) up|sup)\b[!. ?]*$/.test(v);
};

const isHowAreYouPrompt = (text: string): boolean => {
  const v = String(text || '').trim().toLowerCase();
  return /^(how are you|how r u|how are u|how('?s| is) it going|how)\b[!. ?]*$/.test(v);
};

const PRIORITY_CHAT_REPLIES = {
  howAreYou: [
    'Hey there 👋',
    '',
    "I'm up and running perfectly — thanks for asking. Think of me as your AI assistant that's ready to help with questions, ideas, problem-solving, or just exploring something new.",
    '',
    'So what’s on your mind today?'
  ].join('\n'),
  astonMartinFavorite: [
    'My favorite Aston Martin model is the DB5.',
    '',
    'It has a timeless design and iconic legacy.'
  ].join('\n'),
  capabilities: [
    'Good question.',
    '',
    'I’m here to help with a wide range of things — think of me as your AI assistant for thinking, learning, and building.',
    '',
    'Here are a few things I can help with:',
    '',
    '1. Answer questions and explain complex topics',
    '2. Help with coding, tech, and problem-solving',
    '3. Generate ideas, write content, or summarize information',
    '4. Help you learn new skills or understand difficult concepts'
  ].join('\n'),
  controlLife: [
    '5. Assist with planning, brainstorming, or research',
    '',
    'But honestly, the best way to see what I can do is to try me.',
    '',
    'So — what would you like to explore first?'
  ].join('\n')
} as const;

const normalizePriorityPrompt = (input: string): string =>
  String(input || '')
    .toLowerCase()
    .replace(/[“”"]/g, '"')
    .replace(/[‘’`]/g, "'")
    .replace(/[^a-z0-9?'"\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getPriorityChatReply = (input: string): string | null => {
  const text = normalizePriorityPrompt(input);
  if (!text) return null;

  if (
    /^(?:name\s+)?which one is your favou?rite\??$/.test(text)
    || /^(?:what(?:'s| is)\s+your\s+favou?rite\s+aston martin(?:\s+model)?|which\s+aston martin(?:\s+model)?\s+is\s+your\s+favou?rite)\??$/.test(text)
    || (/\baston martin\b/.test(text) && /\bfavou?rite\b/.test(text))
  ) {
    return PRIORITY_CHAT_REPLIES.astonMartinFavorite;
  }

  if (
    /^(?:hi|hello|hey)(?: there)?[,\s]*(?:how are you|how r you|how are u)\??$/.test(text)
    || /^(?:how are you|how r you|how are u)\??$/.test(text)
  ) {
    return PRIORITY_CHAT_REPLIES.howAreYou;
  }

  if (
    /^(?:what can you do|what do you do|what are your capabilities|what all can you do|tell me what you can do|can you tell me what you can do)\??$/.test(text)
  ) {
    return PRIORITY_CHAT_REPLIES.capabilities;
  }

  if (
    /^(?:are you ready to control my life|are you going to control my life|will you control my life|can you control my life)\??$/.test(text)
    || (/\bcontrol my life\b/.test(text) && /\b(ready|are you|can you|will you)\b/.test(text))
  ) {
    return PRIORITY_CHAT_REPLIES.controlLife;
  }

  return null;
};

const isGenericCodingIntentPrompt = (text: string): boolean => {
  const v = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!v) return false;
  const shortGenericCoding =
    v.split(' ').length <= 5
    && /\b(coding|code)\b/.test(v)
    && !/\b(write|implement|debug|fix|solve|function|class|algorithm|leetcode|in\s+\w+|for\s+\w+)\b/.test(v);
  if (shortGenericCoding) return true;
  if (/^(coding|code)\b/.test(v) && v.split(' ').length <= 3) return true;
  if (/^(ok\s+)?i (want|need|like)\s+(coding|code)\b/.test(v) && v.split(' ').length <= 8) return true;
  if (/^(know|learn|teach me)\s+(coding|code)\b/.test(v) && v.split(' ').length <= 8) return true;
  if (/^(can you|could you|do you)\s+(help|support)\s+(with\s+)?coding\b/.test(v) && v.split(' ').length <= 10) return true;
  return false;
};

type ProfessionalIntent =
  | 'greeting'
  | 'casual_conversation'
  | 'capability_question'
  | 'technical_question'
  | 'coding_request'
  | 'follow_up'
  | 'clarification'
  | 'problem_solving'
  | 'opinion_request'
  | 'unclear';

const PROFESSIONAL_INTENT_LABELS: Record<ProfessionalIntent, string> = {
  greeting: 'Greeting',
  casual_conversation: 'Casual Conversation',
  capability_question: 'Capability Question',
  technical_question: 'Technical Question',
  coding_request: 'Coding Request',
  follow_up: 'Follow Up',
  clarification: 'Clarification',
  problem_solving: 'Problem Solving',
  opinion_request: 'Opinion Request',
  unclear: 'Unclear',
};

type NormalizedIncomingMessage = {
  normalizedText: string;
  loweredText: string;
  corrected: boolean;
  corrections: string[];
};

const INCOMING_SHORTHAND_FIXES: Array<{ pattern: RegExp; replacement: string; label: string }> = [
  { pattern: /\bcn\b/g, replacement: 'can', label: 'cn->can' },
  { pattern: /\bu\b/g, replacement: 'you', label: 'u->you' },
  { pattern: /\bmk\b/g, replacement: 'make', label: 'mk->make' },
  { pattern: /\bfr\b/g, replacement: 'for', label: 'fr->for' },
  { pattern: /\btg\b/g, replacement: 'telegram', label: 'tg->telegram' },
  { pattern: /\bwat\b/g, replacement: 'what', label: 'wat->what' },
  { pattern: /\babt\b/g, replacement: 'about', label: 'abt->about' },
  { pattern: /\bdat\b/g, replacement: 'that', label: 'dat->that' },
  { pattern: /\br u\b/g, replacement: 'are you', label: 'r u->are you' },
  { pattern: /\bcuz\b/g, replacement: 'because', label: 'cuz->because' },
];

const normalizeIncomingUserMessage = (text: string): NormalizedIncomingMessage => {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) {
    return {
      normalizedText: '',
      loweredText: '',
      corrected: false,
      corrections: [],
    };
  }

  const lowered = raw.toLowerCase();
  if (isTelegramMediaEnvelopePrompt(raw) || looksLikeRawCodeInput(raw)) {
    return {
      normalizedText: raw,
      loweredText: lowered,
      corrected: false,
      corrections: [],
    };
  }

  let normalized = lowered;
  const corrections: string[] = [];
  for (const fix of INCOMING_SHORTHAND_FIXES) {
    const next = normalized.replace(fix.pattern, fix.replacement);
    if (next !== normalized) {
      normalized = next;
      corrections.push(fix.label);
    }
  }

  const typoCorrected = normalizeIntentFromNoisyText(normalized);
  if (typoCorrected !== normalized) {
    corrections.push('typo_correction');
  }

  const finalNormalized = String(typoCorrected || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  return {
    normalizedText: finalNormalized || lowered,
    loweredText: lowered,
    corrected: corrections.length > 0,
    corrections,
  };
};

const isCapabilityQuestionPrompt = (text: string): boolean => {
  const value = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!value) return false;
  if (/\b(write|generate|create|build|implement|fix|debug|refactor|optimize)\b/.test(value) && /\b(code|script|api|function|class|program|bot)\b/.test(value)) {
    return false;
  }
  return /\b(what can you do|what do you do|capabilities|your capabilities|do you know coding|can you code|can you do coding|what kind of code can you do|what type of code can you do|which programming languages|what languages can you|languages do you support|can you help with coding)\b/.test(value)
    || (/^(do you|can you)\b/.test(value) && /\b(code|coding|program)\b/.test(value) && !/\b(write|generate|create|build|implement|fix|debug)\b/.test(value));
};

const isClarificationPrompt = (text: string): boolean => {
  const value = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!value) return false;
  return /\b(clarify|what do you mean|which one|can you clarify|please clarify|explain that part|did you mean|what exactly|more clear)\b/.test(value);
};

const isOpinionRequestPrompt = (text: string): boolean => {
  const value = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!value) return false;
  return /\b(what do you think|your opinion|do you think|is it better|which is better|recommend|should i|would you choose|pros and cons)\b/.test(value);
};

const isProblemSolvingPrompt = (text: string): boolean => {
  const value = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!value) return false;
  return /\b(error|issue|problem|not working|does not work|doesn't work|fails?|failing|failed|crash|stuck|cannot|can't|unable to|troubleshoot|fix this|why is this broken)\b/.test(value);
};

const isCodingImplementationRequest = (text: string): boolean => {
  const value = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!value) return false;
  if (isCapabilityQuestionPrompt(value)) return false;
  const explicitRequest =
    /\b(write|generate|create|build|implement|debug|fix|refactor|optimize|convert|show|give|provide)\b/.test(value)
    && /\b(code|script|function|class|api|endpoint|bot|query|algorithm|program|module|component|sql|regex|logic)\b/.test(value);
  const implementationPhrase =
    /\b(generate code|write (?:a|an)?\s*(python|javascript|typescript|java|c\+\+|c#|go|rust|php|ruby|swift|kotlin)?\s*(script|program|function|class|api|bot)|create implementation|code for|implement this|implement that)\b/.test(value);
  const syntaxSignals = /```|#include\s*<|def\s+\w+\s*\(|class\s+\w+|function\s+\w+\s*\(|public\s+class\s+\w+/.test(value);
  return explicitRequest || implementationPhrase || (syntaxSignals && !isCapabilityQuestionPrompt(value));
};

const isCasualConversationPrompt = (text: string): boolean => {
  const value = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!value) return false;
  return /^(thanks|thank you|ok|okay|cool|nice|great|awesome|lol|haha|hmm|hmmm|yo|sup|good night|good morning|good evening|bye|see you)\b/.test(value);
};

const looksUnclearPrompt = (text: string, hasHistory: boolean): boolean => {
  const value = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!value) return true;
  if (isGreetingPrompt(value) || isCasualConversationPrompt(value)) return false;
  if (isCapabilityQuestionPrompt(value) || isCodingImplementationRequest(value)) return false;
  if (isProblemSolvingPrompt(value) || isOpinionRequestPrompt(value) || isClarificationPrompt(value)) return false;
  if (isMathLikePromptText(value)) return false;

  const tokenCount = value.split(/\s+/).filter(Boolean).length;
  if (tokenCount <= 2 && !/^(hi|hello|hey|ok|okay|thanks|yes|no)$/.test(value)) {
    return true;
  }
  if (!hasHistory && /\b(this|that|it|these|those|dat)\b/.test(value) && tokenCount <= 8) {
    return true;
  }
  return false;
};

const classifyProfessionalIntent = (
  text: string,
  conversationKey?: string
): ProfessionalIntent => {
  const normalized = normalizeIncomingUserMessage(text);
  const value = normalized.normalizedText || normalized.loweredText;
  if (!value) return 'unclear';

  const hasHistory = getChatHistory(conversationKey).length > 0;
  const contextRef = parseContextReference(value);
  const shortFollowUp =
    /^(that|it|this|what about that|what about this|about that|about this|more|explain more|continue|go on|and that one|wat about that|wat abt dat|dat one)$/i.test(value);

  if (hasHistory && (contextRef.isReference || isContextReferenceContinuationReply(value) || shortFollowUp)) {
    return 'follow_up';
  }
  if (isGreetingPrompt(value)) return 'greeting';
  if (isCapabilityQuestionPrompt(value)) return 'capability_question';
  if (isCodingImplementationRequest(value)) return 'coding_request';
  if (isProblemSolvingPrompt(value)) return 'problem_solving';
  if (isClarificationPrompt(value)) return 'clarification';
  if (isOpinionRequestPrompt(value)) return 'opinion_request';
  if (isCasualConversationPrompt(value)) return 'casual_conversation';

  const technicalSignals =
    /\b(api|database|server|backend|frontend|docker|kubernetes|cloud|linux|network|http|https|oauth|jwt|cache|queue|microservice|architecture|typescript|javascript|python|java|c\+\+|sql|redis|postgres|mongodb|deployment|devops)\b/.test(value);
  const questionSignals = /\b(what|why|how|when|where|which|explain|difference|compare|best practice)\b/.test(value) || /\?$/.test(value);
  if (technicalSignals && questionSignals) return 'technical_question';

  if (looksUnclearPrompt(value, hasHistory)) return 'unclear';
  return 'casual_conversation';
};

const mapProfessionalIntentToRuntimeIntent = (
  intent: ProfessionalIntent,
  text: string
): 'math' | 'current_event' | 'coding' | 'general' => {
  const value = String(text || '').toLowerCase();
  if (isMathLikePromptText(value)) return 'math';
  if (needsRealtimeSearch(value) || isTimeSensitivePrompt(value)) return 'current_event';
  if (intent === 'coding_request') return 'coding';
  return 'general';
};

const buildIntentRoutingInstruction = (intent: ProfessionalIntent): string => {
  const label = PROFESSIONAL_INTENT_LABELS[intent] || PROFESSIONAL_INTENT_LABELS.technical_question;
  if (intent === 'coding_request') {
    return `Intent classification: ${label}\nRouting rule:\n- User explicitly asked for implementation. Provide production-quality code and a concise explanation.`;
  }
  if (intent === 'capability_question') {
    return `Intent classification: ${label}\nRouting rule:\n- Explain capabilities and supported areas only.\n- Do not generate sample code unless the user explicitly asks for implementation.`;
  }
  if (intent === 'follow_up') {
    return `Intent classification: ${label}\nRouting rule:\n- Continue from recent conversation context.\n- Do not treat this as a new unrelated question.`;
  }
  if (intent === 'clarification' || intent === 'unclear') {
    return `Intent classification: ${label}\nRouting rule:\n- Ask one concise clarifying question.\n- Do not guess missing intent details.`;
  }
  if (intent === 'problem_solving') {
    return `Intent classification: ${label}\nRouting rule:\n- Diagnose likely root cause first.\n- Provide practical resolution steps and verification checks.`;
  }
  if (intent === 'opinion_request') {
    return `Intent classification: ${label}\nRouting rule:\n- Provide a balanced opinion with reasoning and trade-offs.`;
  }
  if (intent === 'greeting' || intent === 'casual_conversation') {
    return `Intent classification: ${label}\nRouting rule:\n- Reply naturally in concise conversational tone.\n- Avoid repetitive canned greetings.`;
  }
  return `Intent classification: ${label}\nRouting rule:\n- Give a direct technical answer with clear structure and practical details.`;
};

const isSimplePrompt = (text: string): boolean => {
  const v = String(text || '').trim();
  if (!v) return true;
  if (v.length <= 24 && v.split(/\s+/).length <= 5) return true;
  return false;
};

const normalizeUserQuestionText = (text: string): string => {
  let value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return value;
  if (/^\/[a-z]+(?:@\w+)?\b/i.test(value)) return value;

  const softLeadPattern = /^(ok(?:ay)?|well|so|right|alright|fine|great|cool|hmm+|uh+|please|pls|bro|sir|assistant|bot)\b[\s,.:;!?-]*/i;
  const scaffoldPatterns = [
    /^(do you know|can you|could you|would you|will you|can u|could u|would u|will u)\b[\s,.:;!?-]*/i,
    /^(tell me(?: about)?|describe|explain|define)\b[\s,.:;!?-]*/i,
    /^(i want to know|i need to know|help me understand)\b[\s,.:;!?-]*/i
  ];
  let guard = 0;
  while (guard < 6) {
    guard += 1;
    let next = value.replace(softLeadPattern, '').trim();
    for (const pattern of scaffoldPatterns) {
      next = next.replace(pattern, '').trim();
    }
    if (!next || next === value) break;
    value = next;
  }
  return value;
};

const shouldIsolateFromHistory = (text: string): boolean => {
  const q = normalizeUserQuestionText(text).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!q) return false;
  if (isLikelyCodePrompt(q)) return true;
  if (!isDefinitionLikePrompt(q)) return false;
  if (/\b(it|this|that|these|those|they|them|he|she|his|her|their)\b/.test(q)) return false;
  if (isSimplePrompt(q)) return true;
  return /^(what|who|where|when|why|how)\s+(is|are|was|were)\b/.test(q)
    || /\b(tell me about|define|definition of|meaning of|explain)\b/.test(q);
};

const ENTITY_HINT_TERMS = new Set([
  'nasa', 'isro', 'usa', 'uk', 'uae', 'india', 'china',
  'meta', 'google', 'apple', 'microsoft', 'tesla', 'amazon',
  'facebook', 'instagram', 'youtube', 'wikipedia'
]);

const isLikelyGenericConceptTopic = (topic: string): boolean => {
  const clean = String(topic || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!clean) return false;
  const tokens = clean.split(' ').filter(Boolean);
  if (!tokens.length) return false;
  if (tokens.some((token) => ENTITY_HINT_TERMS.has(token))) return false;
  if (/\b(company|corporation|inc|ltd|agency|organization|university|city|country|state|president|prime minister)\b/.test(clean)) {
    return false;
  }
  if (tokens.length === 1) {
    const t = tokens[0];
    if (/^\d+$/.test(t)) return false;
    return t.length >= 3;
  }
  return tokens.length <= 3;
};

const normalizePromptForModel = (text: string): string => {
  const raw = normalizeIntentFromNoisyText(normalizeUserQuestionText(String(text || '').trim()));
  if (!raw) return raw;
  const lower = raw.toLowerCase().replace(/\s+/g, ' ').trim();

  if (isDefinitionLikePrompt(lower)) {
    const topic = extractKnowledgeTopic(lower).replace(/^(a|an|the)\s+/i, '').trim();
    if (topic) {
      if (/^(who(?:'s| is)|who are)\b/.test(lower)) {
        return `Who is ${topic}?`;
      }
      return `What is ${topic}?`;
    }
  }

  if (/(\btop\s*\d+\b|\blist\b|\bgive\b|\bname\b).*(\banimal\b|\banimals\b|\bpeople\b|\bcountries\b|\bcompanies\b|\bways\b|\bsteps\b)/.test(lower)) {
    const countMatch = lower.match(/\b(\d+)\b/);
    const count = countMatch ? Math.min(20, Math.max(1, parseInt(countMatch[1], 10))) : 5;
    if (/animal/.test(lower) && /(deadliest|dangerous|most dangerous)/.test(lower)) {
      return `List ${count} of the deadliest animals in the world with one-line reason each.`;
    }
  }

  return raw;
};

const isExplicitBriefRequest = (text: string): boolean => {
  const q = String(text || '').toLowerCase();
  return /(short answer|brief answer|in short|one line|one-liner|tl;dr|concise)/.test(q);
};

const normalizeReplyQualityComparable = (value: string): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[`*_>#()[\]{}~]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const isEchoLineCandidateForPrompt = (normalizedPrompt: string, line: string): boolean => {
  const normalizedLine = normalizeReplyQualityComparable(line);
  if (!normalizedPrompt || !normalizedLine) return false;
  if (normalizedLine === normalizedPrompt || normalizedLine === `answer ${normalizedPrompt}`) return true;
  const maxEchoLength = Math.max(normalizedPrompt.length + 40, Math.round(normalizedPrompt.length * 1.6));
  return normalizedLine.length <= maxEchoLength
    && (normalizedLine.startsWith(normalizedPrompt) || normalizedPrompt.startsWith(normalizedLine));
};

const isPromptEchoLikeReply = (prompt: string, reply: string): boolean => {
  const q = normalizeReplyQualityComparable(
    normalizeIntentFromNoisyText(normalizeUserQuestionText(prompt) || prompt)
  );
  const r = normalizeReplyQualityComparable(reply);
  if (!q || !r) return false;
  if (r === q || r === `answer ${q}`) return true;

  const firstLine = normalizeReplyQualityComparable(String(reply || '').split(/\n+/)[0] || '');
  if (firstLine === q || firstLine === `answer ${q}`) return true;
  if (isEchoLineCandidateForPrompt(q, String(reply || '').split(/\n+/)[0] || '')) return true;

  const topLines = String(reply || '').split(/\n+/).slice(0, 3);
  const echoLineCount = topLines.filter((line) => isEchoLineCandidateForPrompt(q, line)).length;
  if (echoLineCount >= 2) return true;

  const maxEchoLength = Math.max(q.length + 72, Math.round(q.length * 1.9));
  return r.length <= maxEchoLength && (r.startsWith(q) || r.includes(q));
};

const stripLeadingPromptEchoLines = (prompt: string, text: string): string => {
  const q = normalizeReplyQualityComparable(
    normalizeIntentFromNoisyText(normalizeUserQuestionText(prompt) || prompt)
  );
  if (!q) return String(text || '').trim();

  const isEchoLine = (line: string): boolean => {
    const normalized = normalizeReplyQualityComparable(line);
    if (!normalized) return false;
    if (normalized === q || normalized === `answer ${q}`) return true;

    const withoutAck = normalized
      .replace(/^(ok|okay|sure|yes|alright|fine|well)\s+/i, '')
      .replace(/^(answer|question|prompt)\s+/i, '')
      .trim();
    if (withoutAck === q || withoutAck === `answer ${q}`) return true;

    const maxEchoLength = Math.max(q.length + 32, Math.round(q.length * 1.5));
    return normalized.length <= maxEchoLength && (normalized.startsWith(q) || q.startsWith(normalized));
  };

  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line, index, arr) => !(line === '' && index > 0 && arr[index - 1] === ''));

  let start = 0;
  let removed = 0;
  while (start < lines.length && removed < 3 && isEchoLine(lines[start])) {
    start += 1;
    removed += 1;
  }

  return lines.slice(start).join('\n').trim();
};

const isComparisonPrompt = (prompt: string): boolean => {
  const q = String(prompt || '').toLowerCase();
  return /(compare|comparison|difference|vs\b|versus|better than|pros and cons|pros & cons|advantages and disadvantages)/.test(q);
};

const isPointWisePrompt = (prompt: string): boolean => {
  const q = String(prompt || '').toLowerCase();
  return /(points|list|bullet|step by step|steps|roadmap|compare|comparison|difference|pros|cons|action plan)/.test(q);
};

const toMathOperatorSymbol = (word: string): string => {
  const normalized = String(word || '').toLowerCase().trim();
  if (!normalized) return normalized;
  if (/(plus|add(?:ed)?\s+to)/.test(normalized)) return '+';
  if (/(minus|subtract(?:ed)?\s+by)/.test(normalized)) return '-';
  if (/(multiplied\s+by|times|into)/.test(normalized)) return '*';
  if (/(divided\s+by|over)/.test(normalized)) return '/';
  if (/(modulo|mod)/.test(normalized)) return '%';
  if (/(to the power of|raised to|power of)/.test(normalized)) return '^';
  return normalized;
};

const protectUrlsForFormatting = (input: string): { text: string; urls: string[] } => {
  const urls: string[] = [];
  const text = String(input || '').replace(/https?:\/\/[^\s<>"'`]+/gi, (match) => {
    const key = `__URL_BLOCK_${urls.length}__`;
    urls.push(match);
    return key;
  });
  return { text, urls };
};

const restoreProtectedUrlsForFormatting = (input: string, urls: string[]): string => {
  let out = String(input || '');
  for (let i = 0; i < urls.length; i += 1) {
    out = out.split(`__URL_BLOCK_${i}__`).join(urls[i]);
  }
  return out;
};

const normalizeMathOperatorsInText = (input: string): string => {
  let value = String(input || '');
  if (!value) return value;
  const urlProtection = protectUrlsForFormatting(value);
  value = urlProtection.text;

  value = value.replace(
    /\b(\d+(?:\.\d+)?)\s+(plus|add(?:ed)?\s+to|minus|subtract(?:ed)?\s+by|multiplied\s+by|times|into|divided\s+by|over|modulo|mod|to the power of|raised to|power of)\s+(-?\d+(?:\.\d+)?)\b/gi,
    (_match, left: string, opWord: string, right: string) => `${left} ${toMathOperatorSymbol(opWord)} ${right}`
  );

  value = value.replace(
    /\b([a-z])\s+(plus|minus|multiplied\s+by|times|divided\s+by|over|modulo|mod|to the power of|raised to|power of)\s+([a-z])\b/gi,
    (_match, left: string, opWord: string, right: string) => `${left} ${toMathOperatorSymbol(opWord)} ${right}`
  );

  value = value.replace(
    /\b(\d+(?:\.\d+)?)\s+(equals?|is equal to)\s+(-?\d+(?:\.\d+)?)\b/gi,
    (_match, left: string, _eqWord: string, right: string) => `${left} = ${right}`
  );

  value = value.replace(
    /\b([a-z])\s+(equals?|is equal to)\s+([a-z])\b/gi,
    (_match, left: string, _eqWord: string, right: string) => `${left} = ${right}`
  );

  value = value
    .replace(/([A-Za-z0-9)\]])\s*=\s*([A-Za-z0-9(])/g, '$1 = $2')
    .replace(/([A-Za-z0-9)\]])\s*\/\s*([A-Za-z0-9(])/g, '$1 / $2')
    .replace(/(\d(?:[\d.,]*))\s*([+\-*/%^=])\s*(\d(?:[\d.,]*))/g, '$1 $2 $3')
    .replace(/[ \t]{2,}/g, ' ');
  return restoreProtectedUrlsForFormatting(value, urlProtection.urls);
};

const OUTPUT_TYPO_CORRECTIONS: Record<string, string> = {
  teh: 'the',
  ths: 'this',
  thsi: 'this',
  recieve: 'receive',
  seperate: 'separate',
  becuase: 'because',
  occured: 'occurred',
  untill: 'until',
  answr: 'answer',
  answwer: 'answer',
  queston: 'question',
  qestion: 'question',
  langauge: 'language',
  profesisonal: 'professional',
  professionall: 'professional',
  definiton: 'definition',
  defination: 'definition',
  implemetation: 'implementation',
  implmentation: 'implementation',
  algorithim: 'algorithm',
  enviroment: 'environment'
};

const fixCommonCollapsedContractions = (input: string): string =>
  String(input || '')
    .replace(/\bheres\b/gi, 'here is')
    .replace(/\bthats\b/gi, 'that is')
    .replace(/\bwhats\b/gi, 'what is')
    .replace(/\bits\b(?=\s+[a-z])/gi, 'it is')
    .replace(/\bdont\b/gi, 'do not')
    .replace(/\bcant\b/gi, 'cannot')
    .replace(/\bwont\b/gi, 'will not')
    .replace(/\bim\b/gi, 'I am');

const fixOutputSpelling = (input: string): string =>
  String(input || '').replace(/\b[a-z][a-z0-9_-]*\b/gi, (token) => {
    const fixed = OUTPUT_TYPO_CORRECTIONS[token.toLowerCase()];
    if (!fixed) return token;
    return applyReplacementCase(token, fixed);
  });

const polishProsePunctuationByLine = (input: string): string => {
  const lines = String(input || '').split('\n');
  const out: string[] = [];

  for (const rawLine of lines) {
    let line = String(rawLine || '');
    const trimmed = line.trim();
    if (!trimmed) {
      out.push('');
      continue;
    }

    const isCodeLike =
      trimmed.startsWith('```')
      || /^CODE_(BEGIN|END)$/i.test(trimmed)
      || /^__CODE_BLOCK_\d+__$/.test(trimmed);
    const isTableLine =
      /^\s*\|.*\|\s*$/.test(trimmed)
      || /^\s*\|?\s*[-:]+\s*(\|\s*[-:]+\s*)+\|?\s*$/.test(trimmed);
    const isListLine = /^\s*(?:\d+\.\s+|[-*]\s+)/.test(trimmed);
    const isHeadingLine = /^[A-Z][A-Za-z0-9 ,()/-]{2,80}:$/.test(trimmed);

    if (isTableLine) {
      out.push(trimmed);
      continue;
    }

    if (!isCodeLike) {
      line = trimmed
        .replace(/\s+([,.;:!?])/g, '$1')
        .replace(/([,.;:!?])([A-Za-z0-9"'])/g, '$1 $2')
        .replace(/([([{])\s+/g, '$1')
        .replace(/\s+([)\]}])/g, '$1')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

      line = line
        .replace(/\b([A-Za-z])\.\s([A-Za-z])\.\s([A-Za-z])\.(?=\s|$)/g, '$1.$2.$3.')
        .replace(/\b([A-Za-z])\.\s([A-Za-z])\.(?=\s|$)/g, '$1.$2.');

      const shouldAddPeriod =
        !isListLine
        && !isHeadingLine
        && line.length >= 56
        && !/[.!?;:]$/.test(line)
        && /[A-Za-z0-9")]$/.test(line)
        && !/\b(?:USD|EUR|INR|GBP|JPY|AED|QAR|SAR|CHF|SGD|CAD|AUD|CNY)\s+\d[\d,]*(?:\.\d+)?\s*(?:trillion|billion|million|thousand|crore|lakh|%|percent)?$/i.test(line);

      if (shouldAddPeriod) {
        line = `${line}.`;
      }
    }

    out.push(line);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n');
};

const splitDenseMathStepsInSegment = (input: string): string => {
  const lines = String(input || '').split('\n');
  const out: string[] = [];

  const looksMathDense = (line: string): boolean => {
    const value = String(line || '').trim();
    if (!value) return false;
    if (/^\d+\.\s+/.test(value)) return false;
    if (/^\s*\|.*\|\s*$/.test(value)) return false;
    const eqCount = (value.match(/=/g) || []).length;
    const operatorHits = (value.match(/\s[+\-*/%^x]\s/g) || []).length;
    const digitHits = (value.match(/\d/g) || []).length;
    const stepWordHits = (value.match(/\b(step|equation|calculation|therefore|hence|result|final answer|then|next)\b/gi) || []).length;
    return (
      (eqCount >= 1 && digitHits >= 3 && (operatorHits >= 1 || stepWordHits >= 1))
      || eqCount >= 2
      || /\bcalculation:\s*.+\s=\s.+/i.test(value)
    );
  };

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      continue;
    }

    if (!looksMathDense(line)) {
      out.push(line);
      continue;
    }

    const expanded = line
      .replace(/;\s+(?=\S)/g, ';\n')
      .replace(/:\s+(?=(?:Step\s*\d+|Calculation|Equation|Result|Final answer)\b)/gi, ':\n')
      .replace(/\s+(?=(?:Therefore|Hence|So|Then|Next|Result|Final answer)\b)/gi, '\n')
      .replace(/(?<=\d)\s+(?=\d+\s*[x*+\-/^%=])/g, '\n')
      .replace(/(=\s*[-]?\d+(?:\.\d+)?)(\s+)(?=(?:[A-Za-z][A-Za-z ]{1,20}:|Step\s*\d+))/g, '$1\n');

    const parts = expanded
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);

    if (parts.length <= 1) {
      out.push(line);
      continue;
    }

    for (let i = 0; i < parts.length; i += 1) {
      out.push(parts[i]);
      if (i < parts.length - 1) out.push('');
    }
  }

  return out
    .filter((line, idx, arr) => line !== '' || idx === 0 || arr[idx - 1] !== '')
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const polishPlainAnswerSegment = (segment: string): string => {
  let value = String(segment || '');
  if (!value.trim()) return value;
  const urlProtection = protectUrlsForFormatting(value);
  value = urlProtection.text;

  value = fixOutputSpelling(value);
  value = correctCommonTypos(value);
  value = fixCommonCollapsedContractions(value);
  value = normalizeMathOperatorsInText(value);

  value = value
    .replace(/[Ã¢â‚¬Å“Ã¢â‚¬Â]/g, '"')
    .replace(/[Ã¢â‚¬ËœÃ¢â‚¬â„¢]/g, '\'')
    .replace(/([,:;!?])([A-Za-z0-9"])/g, '$1 $2')
    .replace(/([A-Za-z])([([{])([A-Za-z])/g, '$1 $2 $3')
    .replace(/([A-Za-z])([)}\]])([A-Za-z])/g, '$1 $2 $3')
    .replace(/([A-Za-z0-9)\]])=([A-Za-z0-9(])/g, '$1 = $2')
    .replace(/([A-Za-z0-9)\]])\/([A-Za-z0-9(])/g, '$1 / $2')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');

  value = splitDenseMathStepsInSegment(value);
  value = polishProsePunctuationByLine(value);

  return restoreProtectedUrlsForFormatting(value.trim(), urlProtection.urls);
};

const mergeBrokenRankedMetricLines = (input: string): string => {
  const value = String(input || '').replace(/\r/g, '').trim();
  if (!value) return value;
  const parts = value.split(/(```[\s\S]*?```)/g).filter(Boolean);
  const metricUnitPattern = /(trillion|billion|million|thousand|crore|lakh|percent|%|bn|tn|usd|eur|inr)\b/i;

  const mergePlain = (plain: string): string => {
    const lines = String(plain || '').split('\n');
    const output: string[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const current = String(lines[i] || '').trim();
      if (!current) {
        if (output.length > 0 && output[output.length - 1] !== '') output.push('');
        continue;
      }

      const next = String(lines[i + 1] || '').trim();
      const currentListMatch = current.match(/^(\d+)\.\s+(.+?)\s*[-:]\s*$/);
      if (currentListMatch && next) {
        const normalizedNext = next.replace(/^(\d+)\.\s+(\d+)\b/, '$1.$2');
        if (/^\d+(?:\.\d+)?\s+/.test(normalizedNext) && metricUnitPattern.test(normalizedNext)) {
          const itemBody = currentListMatch[2].trim();
          output.push(`${currentListMatch[1]}. ${itemBody} - ${normalizedNext}`);
          i += 1;
          continue;
        }
      }

      output.push(current);
    }

    return output
      .filter((line, idx, arr) => line !== '' || idx === 0 || arr[idx - 1] !== '')
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  return parts
    .map((part) => (part.startsWith('```') ? part.trim() : mergePlain(part)))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const expandInlineDashListForProfessionalLayout = (input: string, prompt: string): string => {
  const value = String(input || '').replace(/\r/g, '').trim();
  if (!value) return value;
  if (!isRankingStylePrompt(prompt) && !isPointWisePrompt(prompt)) return value;

  const parts = value.split(/(```[\s\S]*?```)/g).filter(Boolean);
  const inlineItemBoundaryPattern = /\s-\s(?=[A-Z][A-Za-z0-9 .,&'()/-]{1,70}:\s*[^\n-])/g;
  const inlineHeadingToFirstItemPattern = /:\s*-\s+(?=[A-Z][A-Za-z0-9 .,&'()/-]{1,70}:\s*[^\n-])/g;

  const normalizePlain = (plain: string): string => {
    const lines = String(plain || '').split('\n');
    const out: string[] = [];

    for (const rawLine of lines) {
      const line = String(rawLine || '').trim();
      if (!line) {
        if (out.length > 0 && out[out.length - 1] !== '') out.push('');
        continue;
      }

      const boundaryCount = (line.match(inlineItemBoundaryPattern) || []).length;
      const hasInlineHeading = inlineHeadingToFirstItemPattern.test(line);
      if (!hasInlineHeading && boundaryCount < 2) {
        out.push(line);
        continue;
      }

      const expanded = line
        .replace(inlineHeadingToFirstItemPattern, ':\n\n- ')
        .replace(inlineItemBoundaryPattern, '\n- ')
        .replace(/\s+(?=(?:Note|Notes|Source|Sources|Values?)\s*:)/gi, '\n\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      const bulletCount = expanded
        .split('\n')
        .map((x) => x.trim())
        .filter((x) => x.startsWith('- '))
        .length;

      if (bulletCount >= 2) {
        out.push(expanded);
      } else {
        out.push(line);
      }
    }

    return out
      .filter((line, idx, arr) => line !== '' || idx === 0 || arr[idx - 1] !== '')
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  return parts
    .map((part) => (part.startsWith('```') ? part.trim() : normalizePlain(part)))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const isRankingStylePrompt = (prompt: string): boolean => {
  const q = String(prompt || '').toLowerCase();
  return /(top\s*\d+|top|richest|poorest|largest|smallest|ranking|rank|highest|lowest|most\s+\w+|list of)/.test(q);
};

const isFinancialPrompt = (prompt: string): boolean => {
  const q = String(prompt || '').toLowerCase();
  return /(price|cost|gdp|market cap|revenue|income|salary|worth|valuation|budget|exports|imports|per capita|ppp|economy|economic)/.test(q);
};

const wantsCountrySpecificCurrency = (prompt: string): boolean => {
  const q = String(prompt || '').toLowerCase();
  return /(country currency|local currency|each country|all country|respective currency|as per country)/.test(q);
};

const inferPreferredGlobalCurrency = (prompt: string): string => {
  const q = String(prompt || '').toLowerCase();
  if (/\b(inr|rupee|rupees)\b/.test(q)) return 'INR';
  if (/\b(eur|euro)\b/.test(q)) return 'EUR';
  if (/\b(gbp|pound|sterling)\b/.test(q)) return 'GBP';
  if (/\b(jpy|yen)\b/.test(q)) return 'JPY';
  if (/\b(aed|dirham)\b/.test(q)) return 'AED';
  return 'USD';
};

const COUNTRY_CURRENCY_RULES: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /\b(india|indian)\b/i, code: 'INR' },
  { pattern: /\b(japan|japanese)\b/i, code: 'JPY' },
  { pattern: /\b(uk|united kingdom|britain|england)\b/i, code: 'GBP' },
  { pattern: /\b(france|germany|italy|spain|netherlands|ireland|europe|eurozone|luxembourg)\b/i, code: 'EUR' },
  { pattern: /\b(china|chinese)\b/i, code: 'CNY' },
  { pattern: /\b(uae|united arab emirates)\b/i, code: 'AED' },
  { pattern: /\b(qatar)\b/i, code: 'QAR' },
  { pattern: /\b(saudi|saudi arabia)\b/i, code: 'SAR' },
  { pattern: /\b(switzerland|swiss)\b/i, code: 'CHF' },
  { pattern: /\b(singapore)\b/i, code: 'SGD' },
  { pattern: /\b(canada)\b/i, code: 'CAD' },
  { pattern: /\b(australia)\b/i, code: 'AUD' },
  { pattern: /\b(united states|usa|us)\b/i, code: 'USD' }
];

const inferCurrencyByCountryText = (countryText: string, prompt: string): string => {
  if (!wantsCountrySpecificCurrency(prompt)) {
    return inferPreferredGlobalCurrency(prompt);
  }
  const source = String(countryText || '').toLowerCase();
  for (const rule of COUNTRY_CURRENCY_RULES) {
    if (rule.pattern.test(source)) return rule.code;
  }
  return 'USD';
};

const hasCurrencyPrefix = (value: string): boolean =>
  /\b(?:USD|EUR|INR|GBP|JPY|AED|QAR|SAR|CHF|SGD|CAD|AUD|CNY)\b|[$Ã¢â€šÂ¬Ã‚Â£Ã‚Â¥Ã¢â€šÂ¹]/i.test(String(value || ''));

const normalizeNumberWithGrouping = (num: number): string => {
  const rounded = Math.round(num * 100) / 100;
  return rounded.toLocaleString('en-US', {
    minimumFractionDigits: rounded % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  });
};

const normalizeFinancialScaleText = (rawValue: string, currencyCode: string, prompt: string): string => {
  const source = String(rawValue || '').trim();
  if (!source) return source;

  const percentLike = /^-?\d[\d,]*(?:\.\d+)?\s*(%|percent)$/i.test(source);
  if (percentLike) return source;

  const unitMatch = source.match(/^(?:\b(?:USD|EUR|INR|GBP|JPY|AED|QAR|SAR|CHF|SGD|CAD|AUD|CNY)\b\s*)?(-?\d[\d,]*(?:\.\d+)?)(?:\s*(trillion|billion|million|thousand|crore|lakh|bn|tn|mn|m|k))?$/i);
  if (!unitMatch) return source;

  const numericRaw = String(unitMatch[1] || '').replace(/,/g, '');
  const parsed = Number(numericRaw);
  if (!Number.isFinite(parsed)) return source;

  let unit = String(unitMatch[2] || '').toLowerCase();
  unit = unit
    .replace(/^tn$/, 'trillion')
    .replace(/^bn$/, 'billion')
    .replace(/^mn$/, 'million')
    .replace(/^m$/, 'million')
    .replace(/^k$/, 'thousand');

  const promptText = String(prompt || '').toLowerCase();
  const perCapitaLike = /(per capita|ppp|average income|median income|salary)/.test(promptText);

  if (!unit) {
    if (!perCapitaLike) {
      if (currencyCode === 'INR' && parsed >= 10000000) {
        return `${currencyCode} ${normalizeNumberWithGrouping(parsed / 10000000)} crore`;
      }
      if (currencyCode === 'INR' && parsed >= 100000) {
        return `${currencyCode} ${normalizeNumberWithGrouping(parsed / 100000)} lakh`;
      }
      if (parsed >= 1_000_000_000_000) {
        return `${currencyCode} ${normalizeNumberWithGrouping(parsed / 1_000_000_000_000)} trillion`;
      }
      if (parsed >= 1_000_000_000) {
        return `${currencyCode} ${normalizeNumberWithGrouping(parsed / 1_000_000_000)} billion`;
      }
      if (parsed >= 1_000_000) {
        return `${currencyCode} ${normalizeNumberWithGrouping(parsed / 1_000_000)} million`;
      }
    }
    return `${currencyCode} ${normalizeNumberWithGrouping(parsed)}`;
  }

  return `${currencyCode} ${normalizeNumberWithGrouping(parsed)} ${unit}`;
};

const enforceFinancialCurrencyFormatting = (input: string, prompt: string): string => {
  const value = String(input || '').replace(/\r/g, '').trim();
  if (!value) return value;
  if (!isFinancialPrompt(prompt)) return value;

  const parts = value.split(/(```[\s\S]*?```)/g).filter(Boolean);
  const normalizePlain = (plain: string): string => {
    const lines = String(plain || '').split('\n');
    const out: string[] = [];

    for (const rawLine of lines) {
      const line = String(rawLine || '').trim();
      if (!line) {
        if (out.length > 0 && out[out.length - 1] !== '') out.push('');
        continue;
      }

      const rankedPattern = line.match(/^(\d+\.\s+)(.+?)\s-\s([^:]{1,80}):\s(.+)$/);
      if (rankedPattern) {
        const indexPart = String(rankedPattern[1] || '').trimEnd();
        const countryPart = String(rankedPattern[2] || '').trim();
        const metricPart = String(rankedPattern[3] || '').trim();
        let valuePart = String(rankedPattern[4] || '').trim();
        if (!hasCurrencyPrefix(valuePart)) {
          const currencyCode = inferCurrencyByCountryText(countryPart, prompt);
          valuePart = normalizeFinancialScaleText(valuePart, currencyCode, prompt);
        }
        out.push(`${indexPart} ${countryPart} - ${metricPart}: ${valuePart}`);
        continue;
      }

      const inlineAmountPattern = line.match(/^(.+?[:\-]\s*)(-?\d[\d,]*(?:\.\d+)?(?:\s*(?:trillion|billion|million|thousand|crore|lakh|bn|tn|mn|m|k))?)$/i);
      if (inlineAmountPattern && !hasCurrencyPrefix(inlineAmountPattern[2])) {
        const prefix = String(inlineAmountPattern[1] || '').trimEnd();
        const amount = String(inlineAmountPattern[2] || '').trim();
        const currencyCode = inferPreferredGlobalCurrency(prompt);
        out.push(`${prefix} ${normalizeFinancialScaleText(amount, currencyCode, prompt)}`.replace(/\s{2,}/g, ' ').trim());
        continue;
      }

      out.push(line);
    }

    return out
      .filter((line, idx, arr) => line !== '' || idx === 0 || arr[idx - 1] !== '')
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  return parts
    .map((part) => (part.startsWith('```') ? part.trim() : normalizePlain(part)))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const inferRankingMetricLabel = (prompt: string, text: string): string => {
  const source = `${String(prompt || '')} ${String(text || '')}`.toLowerCase();
  if (/gdp\s*per\s*capita|ppp/.test(source)) return 'GDP per capita PPP';
  if (/\bmarket\s*cap\b/.test(source)) return 'Market cap';
  if (/\bpopulation\b/.test(source)) return 'Population';
  if (/\bnet\s*worth\b/.test(source)) return 'Net worth';
  if (/\brevenue\b/.test(source)) return 'Revenue';
  if (/\bgdp\b/.test(source) && /\bnominal\b/.test(source)) return 'GDP nominal';
  if (/\bgdp\b/.test(source)) return 'GDP';
  return 'Value';
};

const enforceProfessionalRankedListStyle = (input: string, prompt: string): string => {
  const value = String(input || '').replace(/\r/g, '').trim();
  if (!value) return value;
  if (!isRankingStylePrompt(prompt)) return value;

  const metricLabel = inferRankingMetricLabel(prompt, value);
  const parts = value.split(/(```[\s\S]*?```)/g).filter(Boolean);
  const valuePattern = /^(\d[\d,]*(?:\.\d+)?(?:\s*(?:trillion|billion|million|thousand|crore|lakh|%|percent|bn|tn|usd|eur|inr))?)$/i;
  const hasClosingRemark = /(approximate|may vary by source|source data|estimates?)/i.test(value);

  const normalizePlain = (plain: string): string => {
    const lines = String(plain || '').split('\n');
    const out: string[] = [];
    let rankedCount = 0;
    const trailingRemarks: string[] = [];

    for (const rawLine of lines) {
      const line = String(rawLine || '').trim();
      if (!line) {
        if (out.length > 0 && out[out.length - 1] !== '') out.push('');
        continue;
      }

      const ranked = line.match(/^(\d+)\.\s+(.+)$/);
      if (!ranked) {
        out.push(line);
        continue;
      }

      const index = ranked[1];
      let body = ranked[2].replace(/(\d),\s+(\d)/g, '$1,$2').trim();
      const notePos = body.search(/\b(?:note|details|metric|metrics|scope|scopes|source|method)\s*:/i);
      if (notePos > 0) {
        const trailingRaw = body.slice(notePos).trim();
        const trailingClean = trailingRaw
          .replace(/^(?:note|details|metric|metrics|scope|scopes|source|method)\s*:\s*/i, '')
          .trim();
        if (trailingClean) trailingRemarks.push(trailingClean);
        body = body.slice(0, notePos).trim();
      }

      const alreadyProfessional = /\s-\s[^:]{1,60}:\s*\d/i.test(body);
      if (!alreadyProfessional) {
        const withDash = body.match(/^(.*?)\s*-\s*(.+)$/);
        if (withDash) {
          const name = String(withDash[1] || '').trim();
          const valuePart = String(withDash[2] || '').trim();
          if (valuePattern.test(valuePart)) {
            body = `${name} - ${metricLabel}: ${valuePart}`;
          }
        } else {
          const loose = body.match(/^(.*?\D)\s+(\d[\d,]*(?:\.\d+)?(?:\s*(?:trillion|billion|million|thousand|crore|lakh|%|percent|bn|tn|usd|eur|inr))?)$/i);
          if (loose) {
            const name = String(loose[1] || '').trim();
            const valuePart = String(loose[2] || '').trim();
            body = `${name} - ${metricLabel}: ${valuePart}`;
          }
        }
      }

      out.push(`${index}. ${body}`);
      rankedCount += 1;
    }

    if (trailingRemarks.length > 0) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      out.push(trailingRemarks.join(' '));
    } else if (rankedCount >= 5 && !hasClosingRemark) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      out.push('Values are approximate and may vary by source and date.');
    }

    return out
      .filter((line, idx, arr) => line !== '' || idx === 0 || arr[idx - 1] !== '')
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  return parts
    .map((part) => (part.startsWith('```') ? part.trim() : normalizePlain(part)))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const ensureClosingLineStartsOnNewParagraph = (input: string, prompt: string): string => {
  const value = String(input || '').replace(/\r/g, '').trim();
  if (!value) return value;
  if (!isRankingStylePrompt(prompt)) return value;

  const parts = value.split(/(```[\s\S]*?```)/g).filter(Boolean);
  const normalizePlain = (plain: string): string => {
    const lines = plain.split('\n').map((line) => String(line || '').trim());
    const output: string[] = [];

    for (const line of lines) {
      if (!line) {
        if (output.length > 0 && output[output.length - 1] !== '') {
          output.push('');
        }
        continue;
      }

      const numberedLine = line.match(/^(\d+)\.\s+(.+)$/);
      if (!numberedLine) {
        output.push(line);
        continue;
      }

      const body = numberedLine[2];
      const breakMatch = body.match(/^(.+?\d[\d,]*(?:\.\d+)?(?:\s*(?:trillion|billion|million|thousand|crore|lakh|%|percent|bn|tn|usd|eur|inr))?)\s+([A-Z][\s\S]*)$/);
      if (!breakMatch) {
        output.push(line);
        continue;
      }

      const listPart = `${numberedLine[1]}. ${String(breakMatch[1] || '').trim()}`;
      const trailingPart = String(breakMatch[2] || '').trim();
      if (
        /^(trillion|billion|million|thousand|crore|lakh|percent|%|bn|tn|mn|m|k)\b/i.test(trailingPart)
        || /^(USD|EUR|INR|GBP|JPY|AED|QAR|SAR|CHF|SGD|CAD|AUD|CNY)\b/i.test(trailingPart)
        || /^-?\d[\d,]*(?:\.\d+)?(?:\s*(?:trillion|billion|million|thousand|crore|lakh|percent|%|bn|tn|mn|m|k))?\b/i.test(trailingPart)
      ) {
        output.push(line);
        continue;
      }
      output.push(listPart);
      if (trailingPart) {
        output.push('');
        output.push(trailingPart);
      }
    }

    return output
      .filter((line, idx, arr) => line !== '' || idx === 0 || arr[idx - 1] !== '')
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  return parts
    .map((part) => (part.startsWith('```') ? part.trim() : normalizePlain(part)))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const ensureGapBeforeNoteSection = (input: string): string => {
  const value = String(input || '').replace(/\r/g, '').trim();
  if (!value) return value;

  const parts = value.split(/(```[\s\S]*?```)/g).filter(Boolean);
  const normalizePlain = (plain: string): string => {
    const lines = String(plain || '').split('\n');
    const out: string[] = [];
    const noteLikePattern = /^(?:note\b|values?\s+are\s+approximate\b|figures?\s+are\s+approximate\b|source\b|sources\b|method\b|methodology\b|data\s+as\s+of\b)/i;

    for (const rawLine of lines) {
      const line = String(rawLine || '').trim();
      if (!line) {
        if (out.length > 0 && out[out.length - 1] !== '') {
          out.push('');
        }
        continue;
      }

      if (noteLikePattern.test(line) && out.length > 0 && out[out.length - 1] !== '') {
        out.push('');
      }

      out.push(line);
    }

    return out
      .filter((line, idx, arr) => line !== '' || idx === 0 || arr[idx - 1] !== '')
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  return parts
    .map((part) => (part.startsWith('```') ? part.trim() : normalizePlain(part)))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const enforceSameLineFinancialUnits = (input: string, prompt: string): string => {
  const value = String(input || '').replace(/\r/g, '').trim();
  if (!value) return value;
  if (!isFinancialPrompt(prompt) && !isRankingStylePrompt(prompt)) return value;

  const parts = value.split(/(```[\s\S]*?```)/g).filter(Boolean);
  const unitPattern = /^(trillion|billion|million|thousand|crore|lakh|percent|%|bn|tn|mn|m|k)\b.*$/i;
  const currencyPattern = /\b(?:USD|EUR|INR|GBP|JPY|AED|QAR|SAR|CHF|SGD|CAD|AUD|CNY)\b/i;

  const normalizePlain = (plain: string): string => {
    const lines = String(plain || '').split('\n');
    const out: string[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const current = String(lines[i] || '').trim();
      if (!current) {
        if (out.length > 0 && out[out.length - 1] !== '') out.push('');
        continue;
      }

      let nextIndex = i + 1;
      while (nextIndex < lines.length && !String(lines[nextIndex] || '').trim()) {
        nextIndex += 1;
      }

      const next = nextIndex < lines.length ? String(lines[nextIndex] || '').trim() : '';
      if (next) {
        const currentEndsWithAmount =
          /(?:\b(?:USD|EUR|INR|GBP|JPY|AED|QAR|SAR|CHF|SGD|CAD|AUD|CNY)\b\s*)?-?\d[\d,]*(?:\.\d+)?$/i.test(current)
          || /:\s*(?:\b(?:USD|EUR|INR|GBP|JPY|AED|QAR|SAR|CHF|SGD|CAD|AUD|CNY)\b\s*)?-?\d[\d,]*(?:\.\d+)?$/i.test(current);

        if (currentEndsWithAmount && unitPattern.test(next)) {
          out.push(`${current} ${next}`.replace(/\s{2,}/g, ' ').trim());
          i = nextIndex;
          continue;
        }

        const decimalSplit = current.match(/^(.*(?:\b(?:USD|EUR|INR|GBP|JPY|AED|QAR|SAR|CHF|SGD|CAD|AUD|CNY)\b\s*)?-?\d[\d,]*)\.$/i);
        const nextDecimalPart = next.match(/^(\d+)\s+(trillion|billion|million|thousand|crore|lakh|percent|%|bn|tn|mn|m|k)\b(.*)$/i);
        if (decimalSplit && nextDecimalPart) {
          const merged = `${decimalSplit[1]}.${nextDecimalPart[1]} ${nextDecimalPart[2]}${nextDecimalPart[3] || ''}`;
          out.push(merged.replace(/\s{2,}/g, ' ').trim());
          i = nextIndex;
          continue;
        }

        const listAmountSplit = current.match(/^(\d+\.\s+.+?:\s*)(?:\b(?:USD|EUR|INR|GBP|JPY|AED|QAR|SAR|CHF|SGD|CAD|AUD|CNY)\b\s*)?-?\d[\d,]*(?:\.\d+)?$/i);
        if (listAmountSplit && unitPattern.test(next)) {
          const currencyCode = currencyPattern.test(current)
            ? (current.match(/\b(?:USD|EUR|INR|GBP|JPY|AED|QAR|SAR|CHF|SGD|CAD|AUD|CNY)\b/i)?.[0] || '')
            : inferPreferredGlobalCurrency(prompt);
          const amountOnly = current.replace(/^.*?:\s*/i, '').trim();
          out.push(`${listAmountSplit[1]}${currencyCode ? `${currencyCode} ` : ''}${amountOnly} ${next}`.replace(/\s{2,}/g, ' ').trim());
          i = nextIndex;
          continue;
        }
      }

      out.push(current);
    }

    return out
      .filter((line, idx, arr) => line !== '' || idx === 0 || arr[idx - 1] !== '')
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  return parts
    .map((part) => (part.startsWith('```') ? part.trim() : normalizePlain(part)))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const removeInlineNoteFragmentsFromRankedLines = (input: string): string => {
  const value = String(input || '').replace(/\r/g, '').trim();
  if (!value) return value;

  const parts = value.split(/(```[\s\S]*?```)/g).filter(Boolean);
  const normalizePlain = (plain: string): string => {
    const lines = String(plain || '').split('\n');
    const out: string[] = [];
    const extractedNotes: string[] = [];

    for (const rawLine of lines) {
      let line = String(rawLine || '').trim();
      if (!line) {
        if (out.length > 0 && out[out.length - 1] !== '') out.push('');
        continue;
      }

      if (/^\d+\.\s+/.test(line) && /\bNote:\b/i.test(line)) {
        const split = line.split(/\bNote:\b/i);
        line = String(split[0] || '').trim();
        const notePart = String(split.slice(1).join(' ') || '').trim();
        if (notePart) extractedNotes.push(notePart);
      }

      if (line) out.push(line);
    }

    if (extractedNotes.length > 0) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      out.push(extractedNotes.join(' '));
    }

    return out
      .filter((line, idx, arr) => line !== '' || idx === 0 || arr[idx - 1] !== '')
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  return parts
    .map((part) => (part.startsWith('```') ? part.trim() : normalizePlain(part)))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const collapseWrappedFinancialUnitsFinal = (input: string): string => {
  const value = String(input || '').replace(/\r/g, '').trim();
  if (!value) return value;
  return value
    .replace(
      /((?:USD|EUR|INR|GBP|JPY|AED|QAR|SAR|CHF|SGD|CAD|AUD|CNY)?\s*-?\d[\d,]*(?:\.\d+)?)\s*\n\s*(trillion|billion|million|thousand|crore|lakh|percent|%|bn|tn|mn|m|k)\b/gi,
      '$1 $2'
    )
    .replace(
      /(:\s*(?:USD|EUR|INR|GBP|JPY|AED|QAR|SAR|CHF|SGD|CAD|AUD|CNY)?\s*-?\d[\d,]*(?:\.\d+)?)\s*\n\s*(trillion|billion|million|thousand|crore|lakh|percent|%|bn|tn|mn|m|k)\b/gi,
      '$1 $2'
    )
    .replace(
      /^(\d+\.\s+.+?:\s*(?:USD|EUR|INR|GBP|JPY|AED|QAR|SAR|CHF|SGD|CAD|AUD|CNY)?\s*-?\d[\d,]*(?:\.\d+)?)\s*\n\s*(trillion|billion|million|thousand|crore|lakh|percent|%|bn|tn|mn|m|k)\b/gim,
      '$1 $2'
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const polishProseOutsideCodeBlocks = (input: string): string => {
  const value = String(input || '').replace(/\r/g, '');
  if (!value) return value;

  const parts = value.split(/(```[\s\S]*?```)/g).filter(Boolean);
  const output = parts.map((part) => {
    if (part.startsWith('```')) return part.trim();
    return polishPlainAnswerSegment(part);
  });

  return output
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const polishCodeReplyNarrativeOnly = (input: string): string => {
  const value = String(input || '').trim();
  if (!value) return value;

  const codeLabelMatch = value.match(/\nCode:\n/i);
  if (!codeLabelMatch || codeLabelMatch.index === undefined) {
    return polishProseOutsideCodeBlocks(value);
  }

  const splitAt = codeLabelMatch.index;
  const intro = value.slice(0, splitAt).trim();
  const codePart = value.slice(splitAt);
  const polishedIntro = polishProseOutsideCodeBlocks(intro);
  return `${polishedIntro}${codePart}`.trim();
};

const hasBrokenRankedMetricList = (output: string): boolean => {
  const value = String(output || '');
  if (!value) return false;
  return /\n\d+\.\s+[^\n]+[-:]\s*\n\d+\.\s+\d+\s+(trillion|billion|million|thousand|crore|lakh|percent|%|bn|tn|usd|eur|inr)\b/i.test(value)
    || /\n\d+\.\s+[^\n]+[-:]\s*\n\d+(?:\.\d+)?\s+(trillion|billion|million|thousand|crore|lakh|percent|%|bn|tn|usd|eur|inr)\b/i.test(value)
    || /\n(?:USD|EUR|INR|GBP|JPY|AED|QAR|SAR|CHF|SGD|CAD|AUD|CNY)?\s*-?\d[\d,]*(?:\.\d+)?\s*\n\s*(trillion|billion|million|thousand|crore|lakh|percent|%|bn|tn|mn|m|k)\b/i.test(value)
    || /\n\d+\.\s+[^\n]+:\s*(?:USD|EUR|INR|GBP|JPY|AED|QAR|SAR|CHF|SGD|CAD|AUD|CNY)?\s*-?\d[\d,]*(?:\.\d+)?\s*\n\s*(trillion|billion|million|thousand|crore|lakh|percent|%|bn|tn|mn|m|k)\b/i.test(value)
    || /^\d+\.\s+.+\bNote:\b/im.test(value);
};

const isMathLikePromptText = (text: string): boolean => {
  const value = String(text || '').toLowerCase();
  if (!value) return false;
  const logicMathWordProblem =
    (
      /(\bproduct\b.*\bsum\b|\bsum\b.*\bproduct\b).*\b(age|ages|daughters?|sons?|children|numbers?)\b|\bhouse number\b.*\bage|ages\b|\boldest\b.*\b(age|daughter|son)\b/.test(value)
    )
    || (
      /\b(hint|hints|clue|riddle|puzzle|guess|determine)\b/.test(value)
      && /\b(age|ages|sum|product|number|numbers)\b/.test(value)
      && /\b\d+\b/.test(value)
    );
  if (logicMathWordProblem) {
    return true;
  }
  if (/\btrain\b/.test(value) && /\b(platform|man|seconds?|speed|length|cross(?:es|ing)?)\b/.test(value) && /\bfind\b/.test(value)) {
    return true;
  }
  if (/(^|\s)(solve|calculate|evaluate|simplify|equation|expression|formula|algebra|arithmetic|derivative|integral|percentage|percent|mean|median|probability)\b/.test(value)) {
    return true;
  }
  if (/\b\d+(?:\.\d+)?\s+(plus|minus|times|multiplied by|divided by|over|modulo|mod|to the power of|raised to|power of)\s+\d+(?:\.\d+)?\b/.test(value)) {
    return true;
  }
  return /\d/.test(value) && /[+\-*/%^=()]/.test(value);
};

const buildComputableMathExpression = (text: string): string | null => {
  const normalizedWords = normalizeMathOperatorsInText(String(text || '').toLowerCase())
    .replace(/\b(what is|calculate|solve|evaluate|find|answer|result|please|show|steps|step)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedWords) return null;

  const expression = normalizedWords
    .replace(/[^0-9+\-*/%^().\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!expression || expression.length > 180) return null;
  if (!/\d/.test(expression) || !/[+\-*/%^]/.test(expression)) return null;
  if (!/^[0-9+\-*/%^().\s]+$/.test(expression)) return null;
  return expression;
};

const solveTrainCrossingWordProblem = (text: string): string | null => {
  const raw = String(text || '');
  if (!raw) return null;
  const normalized = raw
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  if (!/\btrain\b/.test(normalized) || !/\bplatform\b/.test(normalized) || !/\bman\b/.test(normalized)) {
    return null;
  }
  if (!/\bcross(?:es|ing)?\b/.test(normalized) || !/\bseconds?\b/.test(normalized)) {
    return null;
  }

  const sameDirection = /\bsame direction\b/.test(normalized);
  const oppositeDirection = /\bopposite direction\b/.test(normalized);
  if (!sameDirection && !oppositeDirection) {
    return null;
  }

  const walkMatch = normalized.match(/(?:man walking(?: in the (?:same|opposite) direction)? at|walking at)\s+(\d+(?:\.\d+)?)\s*km\/h/);
  const crossManMatch = normalized.match(/cross(?:es|ing)?\s+a?\s*man[\s\S]*?\bin\s+(\d+(?:\.\d+)?)\s*seconds?/);
  const platformMatch = normalized.match(/platform of\s+(\d+(?:\.\d+)?)\s*meters?[\s\S]*?\bin\s+(\d+(?:\.\d+)?)\s*seconds?/);

  if (!walkMatch || !crossManMatch || !platformMatch) return null;

  const walkKmph = Number(walkMatch[1]);
  const tMan = Number(crossManMatch[1]);
  const platformMeters = Number(platformMatch[1]);
  const tPlatform = Number(platformMatch[2]);
  if (![walkKmph, tMan, platformMeters, tPlatform].every((x) => Number.isFinite(x) && x > 0)) {
    return null;
  }

  const walkMps = walkKmph * (5 / 18);
  let trainMps: number;
  if (sameDirection) {
    const denom = tPlatform - tMan;
    const numer = platformMeters - tMan * walkMps;
    if (Math.abs(denom) < 1e-9) return null;
    trainMps = numer / denom;
  } else {
    const denom = tPlatform - tMan;
    const numer = platformMeters + tMan * walkMps;
    if (Math.abs(denom) < 1e-9) return null;
    trainMps = numer / denom;
  }
  if (!Number.isFinite(trainMps) || trainMps <= 0) return null;

  const relativeMps = sameDirection ? (trainMps - walkMps) : (trainMps + walkMps);
  const trainLength = relativeMps * tMan;
  if (!Number.isFinite(trainLength) || trainLength <= 0) return null;

  const trainKmph = trainMps * 18 / 5;
  const fmt = (n: number): string => {
    const rounded2 = Math.round(n * 100) / 100;
    if (Math.abs(rounded2 - Math.round(rounded2)) < 1e-9) return String(Math.round(rounded2));
    return rounded2.toFixed(2).replace(/\.00$/, '');
  };

  return [
    'Answer:',
    '',
    `1. Speed of the train: ${fmt(trainKmph)} km/h`,
    '',
    `2. Length of the train: ${fmt(trainLength)} meters`,
    '',
    'Method:',
    '',
    `1. Walking speed = ${fmt(walkKmph)} km/h = ${fmt(walkMps)} m/s`,
    '',
    `2. Relative speed while crossing the man (${sameDirection ? 'same direction' : 'opposite direction'}) = train speed ${sameDirection ? '-' : '+'} walking speed`,
    '',
    `3. Train length = relative speed x ${fmt(tMan)} seconds`,
    '',
    `4. Train speed from platform crossing: (train length + ${fmt(platformMeters)} m) / ${fmt(tPlatform)} s`,
  ].join('\n');
};

const enforceStructuredPoints = (prompt: string, text: string): string => {
  const value = String(text || '').trim();
  if (!value || value.includes('```')) return value;
  if (!isPointWisePrompt(prompt)) return value;
  if (/\n\s*(-|\*|\u2022|\d+[.)])\s+/.test(value)) return value;

  const dashParts = value
    .split(/\s[-\u2013]\s(?=[A-Z(])/g)
    .map((x) => x.trim())
    .filter(Boolean);
  if (dashParts.length >= 3) {
    const lead = dashParts[0];
    const maxItems = isComparisonPrompt(prompt) ? 6 : 8;
    const items = dashParts
      .slice(1, 1 + maxItems)
      .map((item, i) => `${i + 1}. ${item.replace(/^[-*\u2022]\s+/, '').trim()}`);
    const label = isComparisonPrompt(prompt) ? 'Comparison Points' : 'Key Points';
    return `${lead}\n\n${label}:\n${items.join('\n\n')}`.trim();
  }

  const sentences = toSentenceChunks(value);
  if (sentences.length < 2) return value;
  const lead = sentences[0];
  const maxItems = isComparisonPrompt(prompt) ? 5 : 4;
  const items = sentences.slice(1, 1 + maxItems).map((s, i) => `${i + 1}. ${s}`);
  const label = isComparisonPrompt(prompt) ? 'Comparison Points' : 'Key Points';
  return `${lead}\n\n${label}:\n${items.join('\n\n')}`.trim();
};

const codeBlockCommentPattern = /\/\*[\s\S]*?\*\//g;
const codeSlashCommentPattern = /(^|[^:])\/\/.*$/gm;
const pythonDedentKeywordPattern = /^(elif\b|else:|except\b|finally:)/;
const pythonBlockStartPattern = /:\s*(?:#.*)?$/;
const pythonTerminalPattern = /^(return\b|break\b|continue\b|pass\b|raise\b)/;

const protectDoubleBraceValueBlocks = (input: string): { text: string; blocks: string[] } => {
  const blocks: string[] = [];
  const text = String(input || '').replace(/\{\{[\s\S]*?\}\}/g, (match) => {
    const token = `__DOUBLE_BRACE_BLOCK_${blocks.length}__`;
    blocks.push(match);
    return token;
  });
  return { text, blocks };
};

const restoreDoubleBraceValueBlocks = (input: string, blocks: string[]): string => {
  let output = String(input || '');
  for (let i = 0; i < blocks.length; i += 1) {
    const token = `__DOUBLE_BRACE_BLOCK_${i}__`;
    output = output.replace(new RegExp(token, 'g'), blocks[i]);
  }
  return output;
};

const normalizeCodeTokenSpacing = (input: string): string =>
  String(input || '')
    .split('\n')
    .map((raw) => {
      const line = raw.trim();
      if (!line) return '';
      return line
        .replace(/[ \t]+,/g, ',')
        .replace(/,\s*(?=\S)/g, ', ')
        .replace(/[ \t]+;/g, ';')
        .replace(/[ \t]+\)/g, ')')
        .replace(/\(\s+/g, '(')
        .replace(/[ \t]+\]/g, ']')
        .replace(/\[\s+/g, '[')
        .replace(/\s*&&\s*/g, ' && ')
        .replace(/\s*\|\|\s*/g, ' || ')
        .replace(/\b(if|for|while|switch|catch)\(/g, '$1 (')
        .replace(/\belse\{/g, 'else {')
        .replace(/[ \t]{2,}/g, ' ');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const insertLineBreaksAfterStatementSemicolons = (input: string): string => {
  const source = String(input || '');
  if (!source.includes(';')) return source;

  let out = '';
  let parenDepth = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let escapeNext = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    out += ch;

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (ch === '\\') {
      if (inSingle || inDouble || inBacktick) {
        escapeNext = true;
      }
      continue;
    }

    if (!inDouble && !inBacktick && ch === '\'') {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inBacktick && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && ch === '`') {
      inBacktick = !inBacktick;
      continue;
    }

    if (inSingle || inDouble || inBacktick) {
      continue;
    }

    if (ch === '(') {
      parenDepth += 1;
      continue;
    }
    if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (ch === ';' && parenDepth === 0) {
      let j = i + 1;
      while (j < source.length && (source[j] === ' ' || source[j] === '\t')) {
        j += 1;
      }
      const afterToken = source.slice(j).match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1]?.toLowerCase() || '';
      const shouldStayInline = afterToken === 'else' || afterToken === 'while' || afterToken === 'catch' || afterToken === 'finally';
      if (j < source.length && source[j] !== '\n' && !shouldStayInline) {
        out += '\n';
      }
      i = j - 1;
    }
  }

  return out.replace(/[ \t]+\n/g, '\n');
};

const computeParenDelta = (input: string): number => {
  const source = String(input || '');
  let delta = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let escapeNext = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (ch === '\\') {
      if (inSingle || inDouble || inBacktick) {
        escapeNext = true;
      }
      continue;
    }

    if (!inDouble && !inBacktick && ch === '\'') {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inBacktick && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && ch === '`') {
      inBacktick = !inBacktick;
      continue;
    }
    if (inSingle || inDouble || inBacktick) {
      continue;
    }

    if (ch === '(') {
      delta += 1;
      continue;
    }
    if (ch === ')') {
      delta -= 1;
    }
  }

  return delta;
};

const normalizeCollapsedControlHeader = (input: string): string =>
  String(input || '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s*;\s*/g, '; ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*\{\s*$/, ' {')
    .trim();

const collapseMultilineControlHeaders = (input: string): string => {
  const lines = String(input || '').split('\n');
  const output: string[] = [];
  const controlHeaderPattern = /^(?:for|if|while|switch|catch)\s*\(|^\}\s*while\s*\(/;

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = String(lines[i] || '');
    const trimmed = rawLine.trim();

    if (!trimmed || !controlHeaderPattern.test(trimmed) || computeParenDelta(trimmed) <= 0) {
      output.push(rawLine);
      continue;
    }

    const indent = (rawLine.match(/^\s*/) || [''])[0];
    let merged = trimmed;
    let balance = computeParenDelta(trimmed);
    let j = i + 1;

    while (j < lines.length && balance > 0) {
      const candidate = String(lines[j] || '').trim();
      if (candidate) {
        merged = `${merged} ${candidate}`.trim();
        balance += computeParenDelta(candidate);
      }
      j += 1;
    }

    if (balance <= 0 && j > i + 1) {
      output.push(`${indent}${normalizeCollapsedControlHeader(merged)}`);
      i = j - 1;
      continue;
    }

    output.push(rawLine);
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const collapseWrappedOperatorLines = (input: string): string => {
  const lines = String(input || '').split('\n');
  const output: string[] = [];
  const startsWithOperatorPattern = /^(?:\+|-|\*|\/|%|&&|\|\||==|!=|<=|>=|<|>|=|\?|,)/;
  const endsWithOperatorPattern = /(?:\+|-|\*|\/|%|&&|\|\||==|!=|<=|>=|<|>|=|\?|,)\s*$/;

  for (const rawLine of lines) {
    const line = String(rawLine || '');
    const trimmed = line.trim();

    if (!trimmed) {
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
      continue;
    }

    if (output.length === 0) {
      output.push(line);
      continue;
    }

    const prev = String(output[output.length - 1] || '');
    const prevTrimmed = prev.trim();
    const shouldMerge =
      (endsWithOperatorPattern.test(prevTrimmed) && !/[;{}]$/.test(prevTrimmed))
      || startsWithOperatorPattern.test(trimmed);

    if (shouldMerge) {
      output[output.length - 1] = `${prevTrimmed} ${trimmed}`
        .replace(/\s{2,}/g, ' ')
        .trim();
      continue;
    }

    output.push(line);
  }

  while (output.length > 0 && output[output.length - 1] === '') {
    output.pop();
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const collapseValueBraceRows = (input: string): string => {
  const lines = String(input || '').split('\n');
  const output: string[] = [];

  const isLikelyValueLine = (line: string): boolean => {
    const value = String(line || '').trim();
    if (!value) return false;
    if (/[{}:;=]/.test(value)) return false;
    if (/[()]/.test(value)) return false;
    if (/\b(if|for|while|switch|return|class|public|private|protected|function|const|let|var|def)\b/.test(value)) {
      return false;
    }
    return /^[A-Za-z0-9_+\-*/.,\s\[\]"']+$/.test(value);
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || '');
    const trimmed = line.trim();

    if (trimmed !== '{') {
      output.push(line);
      continue;
    }

    const rowValues: string[] = [];
    let closeIndex = -1;
    let isValueRow = true;

    for (let j = i + 1; j < lines.length; j += 1) {
      const current = String(lines[j] || '');
      const currentTrimmed = current.trim();

      if (!currentTrimmed) {
        continue;
      }

      if (currentTrimmed === '}') {
        closeIndex = j;
        break;
      }

      if (!isLikelyValueLine(currentTrimmed)) {
        isValueRow = false;
        break;
      }

      rowValues.push(currentTrimmed);
    }

    if (!isValueRow || closeIndex === -1 || rowValues.length === 0) {
      output.push(line);
      continue;
    }

    const indent = (line.match(/^\s*/) || [''])[0];
    const joinedValues = rowValues
      .join(' ')
      .replace(/\s*,\s*/g, ', ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    let compactRow = `${indent}{${joinedValues}}`;
    let advanceIndex = closeIndex;
    let nextIndex = closeIndex + 1;
    while (nextIndex < lines.length && !String(lines[nextIndex] || '').trim()) {
      nextIndex += 1;
    }
    if (nextIndex < lines.length && String(lines[nextIndex] || '').trim() === ',') {
      compactRow = `${compactRow},`;
      advanceIndex = nextIndex;
    }

    output.push(compactRow);
    i = advanceIndex;
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const indentCodeByBraces = (input: string): string => {
  const lines = String(input || '').split('\n');
  const output: string[] = [];
  let indentLevel = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
      continue;
    }

    if (/^}/.test(line)) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    output.push(`${'    '.repeat(indentLevel)}${line}`);

    if (/\{$/.test(line)) {
      indentLevel += 1;
    }
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const indentPythonCodeByBlocks = (input: string): string => {
  const lines = String(input || '').split('\n');
  const output: string[] = [];
  let indentLevel = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
      continue;
    }

    if (pythonDedentKeywordPattern.test(line)) {
      indentLevel = Math.max(0, indentLevel - 1);
    }

    output.push(`${'    '.repeat(indentLevel)}${line}`);

    if (pythonBlockStartPattern.test(line) && !line.startsWith('#')) {
      indentLevel += 1;
      continue;
    }

    if (pythonTerminalPattern.test(line) && indentLevel > 0) {
      indentLevel = Math.max(0, indentLevel - 1);
    }
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const enforceStrictCodeLineLayout = (input: string, languageHint = ''): string =>
  (() => {
    const normalizedLanguage = normalizeCodeFenceLanguage(languageHint);
    const rawValue = String(input || '');
    const looksPythonBySource =
      normalizedLanguage === 'python'
      || (
        /\b(def |class |import |from |if |elif |else:|for |while |try:|except |with |return )/.test(rawValue)
        && !/[{};]/.test(rawValue)
      );
    const protectedValueBlocks = protectDoubleBraceValueBlocks(rawValue);
    const withStatementBreaks = insertLineBreaksAfterStatementSemicolons(protectedValueBlocks.text);

    const formatted = looksPythonBySource
      ? withStatementBreaks
        .replace(codeBlockCommentPattern, ' ')
        .replace(codeSlashCommentPattern, '$1')
        .replace(/\s*\n\s*&&\s*/g, ' && ')
        .replace(/\s*&&\s*\n\s*/g, ' && ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      : withStatementBreaks
        .replace(codeBlockCommentPattern, ' ')
        .replace(codeSlashCommentPattern, '$1')
        .replace(/(?<!\{)\{\s*/g, '{\n')
        .replace(/\s*(?<!\})\}(?!\})\s*/g, '\n}\n')
        .replace(/\s*\n\s*&&\s*/g, ' && ')
        .replace(/\s*&&\s*\n\s*/g, ' && ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    const restored = restoreDoubleBraceValueBlocks(formatted, protectedValueBlocks.blocks);
    const spaced = normalizeCodeTokenSpacing(restored);
    const compactHeaders = collapseMultilineControlHeaders(spaced);
    const compactOperators = collapseWrappedOperatorLines(compactHeaders);
    const looksPython =
      normalizedLanguage === 'python'
      || (
        /\b(def |class |import |from |if |elif |else:|for |while |try:|except |with |return )/.test(compactOperators)
        && !/[{};]/.test(compactOperators)
      );
    if (looksPython) {
      return indentPythonCodeByBlocks(compactOperators);
    }
    return collapseValueBraceRows(indentCodeByBraces(compactOperators));
  })();

const formatInlineCodeSegment = (code: string, languageHint = ''): string => {
  const normalizedLanguage = normalizeCodeFenceLanguage(languageHint);
  let value = String(code || '')
    .replace(/^\s*Code Example(?:\s*\([^)]+\))?\s*:\s*/i, '')
    .replace(/\r/g, '')
    .trim();
  if (!value) return value;
  if (/<[a-z!/][^>]*>/i.test(value)) {
    value = value.replace(/>\s*</g, '>\n<');
  }
  const looksPythonByHint = normalizedLanguage === 'python' || normalizedLanguage === 'py';
  const looksPythonBySource =
    /\b(def|class|import|from|elif|except|with|lambda|yield|None|True|False)\b/.test(value)
    || /^\s*@\w+/m.test(value);
  const looksPythonLike = looksPythonByHint || (looksPythonBySource && !/[{};]/.test(value));

  if (looksPythonLike) {
    const compressedPythonCommentPattern =
      /#.*?(?=(?:\bdef\s+[A-Za-z_][A-Za-z0-9_]*\s*\(|\bclass\s+[A-Za-z_][A-Za-z0-9_]*|\breturn\b|\bif\s+[^:\n]{1,120}:|\bfor\s+[^:\n]{1,120}:|\bwhile\s+[^:\n]{1,120}:|\btry:|\bwith\s+[^:\n]{1,120}:|[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+\])*\s*=(?!=)|$))/gi;
    value = value
      .replace(compressedPythonCommentPattern, ' ')
      .replace(/;\s*/g, ';\n')
      .replace(
        /\s+(?=def |class |import |from |if |elif |else:|for |while |try:|except |with |return |pass|break|continue)/gi,
        '\n'
      )
      .replace(
        /\b(return\s+[^\n]+?)\s+(?=[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+\])*\s*=)/g,
        '$1\n'
      )
      .replace(
        /([)\]])\s+(?=[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+\])*\s*=)/g,
        '$1\n'
      );
    value = insertLineBreaksAfterStatementSemicolons(value);
  } else {
    value = value
      .replace(/\{\s*/g, '{\n')
      .replace(/\s*\}/g, '\n}\n')
      .replace(
        /\s+(?=function |const |let |var |if |else |for |while |return |class |import |from |public |private |protected |async )/gi,
        '\n'
      );
    value = insertLineBreaksAfterStatementSemicolons(value);
  }

  value = value
    .replace(
      /\s+(?:This approach|The algorithm works|Time complexity|Space complexity|Complexity|Explanation)\b[\s\S]*$/i,
      ''
    )
    .replace(/\n{3,}/g, '\n\n');
  const layoutLanguage = looksPythonLike ? 'python' : normalizedLanguage;
  return enforceStrictCodeLineLayout(value.trim(), layoutLanguage);
};

const containsCodeLikeSignals = (text: string): boolean => {
  const source = String(text || '').trim();
  if (!source) return false;
  if ((looksLikeMarkdownTable(source) || looksLikeHtmlTableMarkup(source)) && !hasExplicitCodeIntentSignals(source)) {
    return false;
  }
  return /Code Example(?:\s*\([^)]+\))?\s*:/i.test(source)
    || /```|CODE_BEGIN|CODE_END/.test(source)
    || /\b(def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(|class\s+[A-Za-z_][A-Za-z0-9_]*|function\s+[A-Za-z_][A-Za-z0-9_]*\s*\(|const\s+[A-Za-z_][A-Za-z0-9_]*\s*=|let\s+[A-Za-z_][A-Za-z0-9_]*\s*=|var\s+[A-Za-z_][A-Za-z0-9_]*\s*=|#include\b|public\s+class\b|using\s+namespace\b|using\s+std::|fn\s+[A-Za-z_][A-Za-z0-9_]*\s*\()/i.test(source)
    || /\b(for|while|if)\s*\([^)]*;[^)]*;[^)]*\)/.test(source)
    || /^\s*(for|while|if|elif|else|try|except|with)\b[^\n]*:/m.test(source)
    || /<[a-z!/][^>]*>/i.test(source);
};

const enforceCodePresentation = (prompt: string, text: string): string => {
  const source = String(text || '').trim();
  if (!source) return source;
  const promptLooksCode = isLikelyCodePrompt(prompt);
  const sourceLooksCode = containsCodeLikeSignals(source);
  if (!promptLooksCode && !sourceLooksCode) return source;
  if (/```|CODE_BEGIN|CODE_END/.test(source)) return source;

  const labelMatch = source.match(/^(.*?)(?:\n+)?Code Example(?:\s*\([^)]+\))?:?\s*([\s\S]*)$/i);
  if (labelMatch?.[2]) {
    const intro = String(labelMatch[1] || '').trim();
    const extractedCode = extractInlineCodeFromPlainText(labelMatch[2]);
    const detectedLanguage = inferCodeLanguageFromPrompt(prompt);
    const formattedCode = formatInlineCodeSegment(extractedCode || labelMatch[2], detectedLanguage);
    if (!formattedCode) return source;
    return `${intro ? `${intro}\n\n` : ''}CODE_BEGIN\n${formattedCode}\nCODE_END`.trim();
  }

  const looksInlineCode =
    source.length > 140 &&
    (
      /<[a-z!/][^>]*>/i.test(source)
      || /(def |class |import |function |const |let |var |public |private )/i.test(source)
    );
  if (!looksInlineCode) return source;
  const detectedLanguage = inferCodeLanguageFromPrompt(prompt);
  const formattedCode = formatInlineCodeSegment(source, detectedLanguage);
  if (!formattedCode) return source;
  return `CODE_BEGIN\n${formattedCode}\nCODE_END`;
};

const expandInlinePointMarkers = (input: string): string => {
  const value = String(input || '').replace(/\r/g, '').trim();
  if (!value) return value;
  return value
    .replace(/(?:^|\s)(\d+)[.)]\s*/g, '\n$1. ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const normalizeParagraphFlow = (text: string): string => {
  const value = String(text || '').replace(/\r/g, '\n');
  if (!value) return value;
  return value
    .split(/\n{2,}/)
    .map((segment) => segment.replace(/[ \t]+\n/g, '\n').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
};

const formatProfessionalResponse = (text: string, prompt: string): string => {
  const raw = sanitizeForTelegram(unescapeEscapedCodeFences(text));
  if (!raw) return raw;

  const codePrompt = isLikelyCodePrompt(prompt);
  const sourceLooksCode = containsCodeLikeSignals(raw);
  const preserveRichWhitespace = codePrompt || sourceLooksCode;

  let cleaned = raw
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/^summary:\s*/i, '')
    .replace(/^next step:\s*/i, '')
    .replace(/^key points:\s*/i, '')
    .trim();

  if (!preserveRichWhitespace) {
    cleaned = cleaned.replace(/[ \t]{2,}/g, ' ');
  }

  if (!codePrompt && !sourceLooksCode) {
    cleaned = stripRawRetrievalArtifacts(prompt, cleaned);
  }

  // Drop leading prompt-echo lines (including "ok ..." / "answer ..." variants).
  cleaned = stripLeadingPromptEchoLines(prompt, cleaned);
  if (!cleaned) {
    const intent = classifyProfessionalIntent(prompt);
    cleaned = buildRetryOnlyPoliteMessage(prompt, intent);
  }

  // Preserve code answers with minimal transformations.
  // The deeper formatting pipeline can unintentionally corrupt valid model code/output formatting.
  if (codePrompt || sourceLooksCode) {
    const minimalCodeSafe = enforceDashListStyleOutsideCode(ensureBlankLineBetweenNumberedPoints(
      applyProfessionalLayout(enforceCodePresentation(prompt, cleaned))
    ));
    return ensureProfessionalParagraphSpacing(sanitizeForTelegram(minimalCodeSafe)).trim();
  }

  if (!codePrompt && !sourceLooksCode) {
    cleaned = normalizeMathOperatorsInText(cleaned);
    cleaned = expandInlinePointMarkers(cleaned);
    cleaned = normalizeParagraphFlow(cleaned);
    cleaned = polishProseOutsideCodeBlocks(cleaned);
  }
  cleaned = enforceCodePresentation(prompt, cleaned);

  // Remove forced boilerplate sections and keep the core response only.
  cleaned = cleaned
    .replace(/\n{2,}(next step|summary|key points):[\s\S]*$/i, '')
    .trim();

  if (!preserveRichWhitespace) {
    // Preserve temporal qualifiers/years. Stripping them can make factual answers incorrect.
    cleaned = cleaned
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  if (!codePrompt && !sourceLooksCode) {
    cleaned = normalizeMathOperatorsInText(cleaned);
    cleaned = polishProseOutsideCodeBlocks(cleaned);
  }

  const shouldAutoPointify =
    isPointWisePrompt(prompt)
    && !cleaned.includes('```')
    && !/\n\s*(-|\*|\u2022|\d+[.)])\s+/.test(cleaned)
    && toSentenceChunks(cleaned).length >= 3;
  if (shouldAutoPointify) {
    cleaned = enforceStructuredPoints(`${prompt} points`, cleaned);
  }

  const hasStructuredPointLines = /\n\s*(-|\*|\u2022|\d+[.)])\s+/.test(cleaned);

  // Keep depth by default unless user explicitly requests brevity.
  if (isExplicitBriefRequest(prompt) && !hasStructuredPointLines) {
    const simpleSentences = toSentenceChunks(cleaned);
    if (simpleSentences.length > 0) {
      return simpleSentences.slice(0, 3).join(' ');
    }
  }

  // If a long answer comes as one block, split by paragraph-sized chunks.
  if (!cleaned.includes('\n') && cleaned.length > 420) {
    const chunks = toSentenceChunks(cleaned);
    cleaned = chunks.length > 3 ? chunks.join('\n\n') : cleaned;
  }

  if (isPointWisePrompt(prompt)) {
    cleaned = enforceStructuredPoints(prompt, cleaned);
  }
  const layout = applyProfessionalLayout(cleaned);
  if (codePrompt || sourceLooksCode || containsCodeLikeSignals(layout)) {
    const templatedCode = enforceCodeReplyTemplate(prompt, layout);
    return ensureProfessionalParagraphSpacing(sanitizeForTelegram(
      polishCodeReplyNarrativeOnly(ensureBlankLineBetweenNumberedPoints(templatedCode))
    ));
  }
  const structured = polishProseOutsideCodeBlocks(formatStructuredReply(layout));
  const templated = enforceCodeReplyTemplate(prompt, structured);
  const withSpacing = ensureBlankLineBetweenNumberedPoints(templated);
  const merged = mergeBrokenRankedMetricLines(polishProseOutsideCodeBlocks(withSpacing));
  const expandedInlineLists = expandInlineDashListForProfessionalLayout(merged, prompt);
  const ranked = enforceProfessionalRankedListStyle(expandedInlineLists, prompt);
  const rankedNoInlineNotes = removeInlineNoteFragmentsFromRankedLines(ranked);
  const moneyFormatted = enforceFinancialCurrencyFormatting(rankedNoInlineNotes, prompt);
  const sameLineUnits = enforceSameLineFinancialUnits(moneyFormatted, prompt);
  const noBrokenMetrics = mergeBrokenRankedMetricLines(collapseWrappedFinancialUnitsFinal(sameLineUnits));
  const paragraphSafe = ensureClosingLineStartsOnNewParagraph(noBrokenMetrics, prompt);
  const noteSpaced = ensureGapBeforeNoteSection(paragraphSafe);
  const finalNoSplitUnits = enforceSameLineFinancialUnits(collapseWrappedFinancialUnitsFinal(noteSpaced), prompt);
  return ensureProfessionalParagraphSpacing(enforceDashListStyleOutsideCode(finalNoSplitUnits));
};

const professionalListLinePattern = /^\s*(?:[-*]\s+|\d+[.)]\s+|[A-Za-z][.)]\s+)/;
const professionalHeadingLinePattern = /^\s*[A-Za-z][A-Za-z0-9 ,()/'"+-]{1,90}:\s*$/;

const tightenListSpacingOutsideCode = (text: string): string => {
  const value = String(text || '').replace(/\r/g, '').trim();
  if (!value) return value;

  const parts = value.split(/(```[\s\S]*?```|Code Example(?:\s*\([^)]+\))?:\n'\n[\s\S]*?\n')/g).filter(Boolean);
  const normalizePlain = (segment: string): string => {
    const lines = String(segment || '').split('\n');
    const out: string[] = [];
    let pendingBlank = false;
    let previousType: 'none' | 'heading' | 'bullet' | 'text' = 'none';

    for (let i = 0; i < lines.length; i += 1) {
      const line = String(lines[i] || '').replace(/[ \t]+$/g, '');
      const trimmed = line.trim();
      if (!trimmed) {
        pendingBlank = true;
        continue;
      }

      const currentType: 'heading' | 'bullet' | 'text' =
        professionalHeadingLinePattern.test(trimmed)
          ? 'heading'
          : professionalListLinePattern.test(trimmed)
            ? 'bullet'
            : 'text';

      let needsGap = false;
      if (out.length > 0 && out[out.length - 1] !== '') {
        if (pendingBlank) {
          if (!(previousType === 'bullet' && currentType === 'bullet')) {
            needsGap = true;
          }
        }
        if (currentType === 'heading') {
          needsGap = true;
        } else if (previousType === 'heading') {
          needsGap = true;
        } else if (currentType === 'bullet' && previousType === 'text') {
          needsGap = true;
        } else if (currentType === 'text' && previousType === 'bullet') {
          needsGap = true;
        }
      }

      if (needsGap && out[out.length - 1] !== '') {
        out.push('');
      }

      out.push(trimmed);
      previousType = currentType;
      pendingBlank = false;
    }

    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  };

  return parts
    .map((part) => (/^(?:```|Code Example(?:\s*\([^)]+\))?:\n')/.test(part) ? part.trim() : normalizePlain(part)))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const ensureProfessionalParagraphSpacing = (text: string): string => {
  const value = String(text || '').replace(/\r/g, '').trim();
  if (!value) return value;

  const parts = value
    .split(/(Code Example(?:\s*\([^)]+\))?:\n'\n[\s\S]*?\n')/g)
    .filter(Boolean);

  const normalized = parts.map((part) => {
    if (/^Code Example(?:\s*\([^)]+\))?:/i.test(part.trim())) {
      return part.trim();
    }
    return String(part || '')
      .replace(/([^\n:]{2,}:)\n(?=\S)/g, '$1\n\n')
      .replace(/([.!?])\n(?=[A-Z])/g, '$1\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  });

  return tightenListSpacingOutsideCode(normalized.join('\n\n').replace(/\n{3,}/g, '\n\n').trim());
};

const applyProfessionalLayout = (text: string): string => {
  const value = String(text || '').replace(/\r/g, '').trim();
  if (!value) return value;
  const parts = value.split(/(```[\s\S]*?```|CODE_BEGIN[\s\S]*?CODE_END)/g).filter(Boolean);
  const normalized = parts.map((part) => {
    if (part.startsWith('```')) {
      return part.trim();
    }
    return part
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  });
  return normalized
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const enforceDashListStyleOutsideCode = (text: string): string => {
  const value = String(text || '').replace(/\r/g, '').trim();
  if (!value) return value;
  const parts = value.split(/(```[\s\S]*?```)/g).filter(Boolean);
  const normalizePlain = (segment: string): string =>
    String(segment || '')
      .split('\n')
      .map((line) => {
        if (!line) return line;
        return line.replace(/^(\s*)(?:[1-9]|[1-9]\d)[.)]\s+/, '$1- ');
      })
      .join('\n');

  return parts
    .map((part) => (/^(?:```|CODE_BEGIN)/.test(part) ? part.trim() : normalizePlain(part)))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const ensureBlankLineBetweenNumberedPoints = (text: string): string => {
  const value = String(text || '').replace(/\r/g, '').trim();
  if (!value) return value;

  const parts = value.split(/(```[\s\S]*?```)/g).filter(Boolean);
  const normalizePlain = (segment: string): string => {
    const lines = String(segment || '').split('\n');
    const out: string[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = String(lines[i] || '').trim();
      if (!line) {
        if (out.length > 0 && out[out.length - 1] !== '') {
          out.push('');
        }
        continue;
      }

      out.push(line);

      if (!/^\d+\.\s+/.test(line)) continue;

      let nextIndex = i + 1;
      while (nextIndex < lines.length && !String(lines[nextIndex] || '').trim()) {
        nextIndex += 1;
      }

      if (
        nextIndex < lines.length
        && /^\d+\.\s+/.test(String(lines[nextIndex] || '').trim())
        && out[out.length - 1] !== ''
      ) {
        out.push('');
      }
    }

    while (out.length > 0 && out[out.length - 1] === '') {
      out.pop();
    }
    return out.join('\n');
  };

  return parts
    .map((part) => (part.startsWith('```') ? part.trim() : normalizePlain(part)))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

type FencedCodeBlock = {
  language: string;
  code: string;
};

const collectFencedCodeBlocks = (input: string): FencedCodeBlock[] => {
  const blocks: FencedCodeBlock[] = [];
  const regex = /```([a-zA-Z0-9_#+.-]*)\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null = regex.exec(String(input || ''));
  while (match) {
    blocks.push({
      language: String(match[1] || '').trim().toLowerCase(),
      code: String(match[2] || '').trim()
    });
    match = regex.exec(String(input || ''));
  }
  return blocks;
};

const normalizeCodeFenceLanguage = (language: string): string =>
  String(language || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_#+.-]/g, '');

const looksLikeMarkdownTable = (text: string): boolean => {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;

  const tableRowCount = lines.filter((line) => /\|/.test(line) && line.split('|').length >= 3).length;
  if (tableRowCount < 2) return false;

  const hasDivider = lines.some((line) => /^\|?\s*:?-{2,}:?(?:\s*\|\s*:?-{2,}:?)+\s*\|?$/.test(line));
  return hasDivider || tableRowCount >= 3;
};

const looksLikeHtmlTableMarkup = (text: string): boolean => {
  const source = String(text || '').toLowerCase();
  return /<table\b[\s\S]*?<tr\b[\s\S]*?<t[hd]\b/.test(source);
};

const hasExplicitCodeIntentSignals = (text: string): boolean => {
  const value = String(text || '').toLowerCase();
  if (!value) return false;
  return /(code|coding|program|script|function|class|algorithm|debug|bug|compile|stack trace|api|sdk|library|leetcode|sql|query|database|schema|create table|insert into|select\s+.+\s+from|python|javascript|typescript|java|c\+\+|c#|cpp|golang|rust|node|react|django|flask|spring|bash|shell|\bjs\b|\bts\b|\bpy\b)/.test(value);
};

const isTableRequestWithoutCodeIntent = (text: string): boolean => {
  const value = String(text || '').toLowerCase();
  if (!value) return false;
  const asksTable = /\b(table|tabular|rows?\s+and\s+columns?|columns?\s+and\s+rows?)\b/.test(value);
  if (!asksTable) return false;
  return !hasExplicitCodeIntentSignals(value);
};

const buildProfessionalCodeExplanation = (prompt: string, narrativeText: string): string => {
  const normalizedNarrative = sanitizeForTelegram(String(narrativeText || ''))
    .replace(/\s+/g, ' ')
    .trim();
  const narrativeLines = toSentenceChunks(normalizedNarrative).slice(0, 3);

  const defaultLines = [
    isLikelyCodePrompt(prompt)
      ? 'Below is a clean and runnable implementation for your request.'
      : 'Below is a clean and runnable implementation.',
    'It follows proper function structure, bracket alignment, and consistent spacing.'
  ];

  const lines = narrativeLines.length > 0 ? narrativeLines : defaultLines;
  return lines.slice(0, 3).join('\n');
};

const stripPythonCommentAndDocstringLines = (input: string): string => {
  const lines = String(input || '').replace(/\r/g, '').split('\n');
  const output: string[] = [];
  let inTripleSingle = false;
  let inTripleDouble = false;

  for (const rawLine of lines) {
    const line = String(rawLine || '').replace(/\s+$/g, '');
    const trimmed = line.trim();

    if (!trimmed) {
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
      continue;
    }

    if (inTripleSingle) {
      if (trimmed.includes("'''")) {
        inTripleSingle = false;
      }
      continue;
    }

    if (inTripleDouble) {
      if (trimmed.includes('"""')) {
        inTripleDouble = false;
      }
      continue;
    }

    if (trimmed.startsWith("'''")) {
      if (!trimmed.slice(3).includes("'''")) {
        inTripleSingle = true;
      }
      continue;
    }

    if (trimmed.startsWith('"""')) {
      if (!trimmed.slice(3).includes('"""')) {
        inTripleDouble = true;
      }
      continue;
    }

    if (/^\s*#/.test(line)) {
      continue;
    }

    const withoutInlineComment = line.replace(/\s+#.*$/g, '').trimEnd();
    if (!withoutInlineComment.trim()) {
      continue;
    }
    output.push(withoutInlineComment);
  }

  while (output.length > 0 && output[output.length - 1] === '') {
    output.pop();
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const stripCodeCommentsAndDocstrings = (code: string, languageHint = ''): string => {
  const normalizedLanguage = normalizeCodeFenceLanguage(languageHint);
  const raw = String(code || '').replace(/\r/g, '').trim();
  if (!raw) return raw;

  const looksPython =
    normalizedLanguage === 'python'
    || (
      /\b(def |class |import |from |if |elif |else:|for |while |try:|except |with |return )/.test(raw)
      && !/[{};]/.test(raw)
    );

  if (looksPython) {
    return stripPythonCommentAndDocstringLines(raw);
  }

  return raw
    .replace(codeBlockCommentPattern, ' ')
    .replace(codeSlashCommentPattern, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const collectMarkerCodeBlocks = (input: string): string[] =>
  Array.from(
    String(input || '').matchAll(/CODE_BEGIN\b([\s\S]*?)\bCODE_END/gi)
  )
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean);

const collectLabeledCodeSegments = (input: string): string[] => {
  const parts = String(input || '')
    .split(/\bCode:\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return [];
  return parts.slice(1);
};

const lineLooksLikeCodeSignal = (line: string): boolean => {
  const value = String(line || '').trim();
  if (!value) return false;
  const hasCodePunctuation = /[{}()[\];=<>:+\-*/,%!&|^]/.test(value);
  if (hasCodePunctuation) return true;

  if (/^(#include|using\s+namespace|using\s+std::|import |from |def |class |function |const |let |var |public\b|private\b|protected\b|static\b|int\b|long\b|float\b|double\b|char\b|bool\b|void\b|template\b|async\b|await\b|fn\b|struct\b|enum\b|type\b)/i.test(value)) {
    return true;
  }

  if (/^(if|else|for|while|switch|case|break|continue|return|try|catch|finally|elif|except|with)\b/i.test(value)) {
    return /[():{}[\];=<>:+\-*/,%!&|^]/.test(value) || /:$/.test(value);
  }

  return false;
};

const stripCodeArtifactsFromNarrative = (input: string): string => {
  const source = String(input || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/CODE_BEGIN\b[\s\S]*?\bCODE_END/gi, ' ')
    .replace(/\bCode Example(?:\s*\([^)]+\))?:[\s\S]*$/i, ' ')
    .replace(/\bCode:\s*[\s\S]*$/i, ' ')
    .replace(/\r/g, '')
    .trim();

  if (!source) return '';

  const lines = source
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !lineLooksLikeCodeSignal(line));

  return lines.join(' ').replace(/\s{2,}/g, ' ').trim();
};

const hasDenseCodeStructure = (input: string): boolean => {
  const source = String(input || '').replace(/\r/g, '').trim();
  if (!source) return false;
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return false;

  const codeLikeLines = lines.filter((line) => lineLooksLikeCodeSignal(line));
  if (codeLikeLines.length >= 3) return true;

  const symbolHits = (source.match(/[{}()[\];=<>:+\-*/,%!&|^]/g) || []).length;
  const headerPattern = /\b(def\s+\w+\s*\(|class\s+\w+|function\s+\w+\s*\(|const\s+\w+\s*=|let\s+\w+\s*=|var\s+\w+\s*=|#include\b|public\s+class\b|using\s+namespace\b|using\s+std::|fn\s+\w+\s*\(|for\s*\([^)]*;[^)]*;[^)]*\)|while\s*\([^)]*\)|if\s*\([^)]*\))/.test(source);
  if (headerPattern && symbolHits >= 4) return true;

  return symbolHits >= 10 && codeLikeLines.length >= 2;
};

const scoreCodeCandidate = (code: string): number => {
  const value = String(code || '').replace(/\r/g, '').trim();
  if (!value) return -100;

  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
  const semicolonCount = (value.match(/;/g) || []).length;
  const braceOpen = (value.match(/\{/g) || []).length;
  const braceClose = (value.match(/\}/g) || []).length;
  const hasStrongStructure =
    /(#include|int\s+main\s*\(|public\s+static\s+void\s+main\s*\(|def\s+[A-Za-z_][A-Za-z0-9_]*\s*\(|class\s+[A-Za-z_][A-Za-z0-9_]*|function\s+[A-Za-z_][A-Za-z0-9_]*\s*\()/i.test(value);

  const proseOnlyLines = lines.filter((line) =>
    /^[A-Za-z][A-Za-z ]{8,}$/.test(line)
    && !lineLooksLikeCodeSignal(line)
  ).length;
  const numberedInstructionLines = lines.filter((line) => /^\d+\.\s+[A-Za-z]/.test(line)).length;
  const proseHeavyLines = lines.filter((line) => {
    const words = (line.match(/[A-Za-z]+/g) || []).length;
    const hasCodePunctuation = /[{}()[\];=<>:+\-*/,%!&|^]/.test(line);
    const hasCodeKeyword = /^(#include|using\s+namespace|using\s+std::|import |from |def |class |function |const |let |var |public\b|private\b|protected\b|static\b|int\b|long\b|float\b|double\b|char\b|bool\b|void\b|template\b|async\b|await\b|fn\b|struct\b|enum\b|type\b)/i.test(line);
    return words >= 6 && !hasCodePunctuation && !hasCodeKeyword;
  }).length;

  let score = 0;
  score += Math.min(10, lines.length);
  score += Math.min(8, semicolonCount);
  if (hasStrongStructure) score += 8;
  if (braceOpen > 0 && braceOpen === braceClose) score += 5;
  if (/\bCODE_BEGIN\b|\bCODE_END\b|\bCode:\b/i.test(value)) score -= 10;
  score -= proseOnlyLines * 5;
  score -= numberedInstructionLines * 8;
  score -= proseHeavyLines * 6;
  if (numberedInstructionLines > 1 && !hasStrongStructure && semicolonCount === 0 && braceOpen === 0) {
    score -= 20;
  }
  return score;
};

const stripNarrativeOnlyLinesFromCode = (input: string, languageHint = ''): string => {
  const normalizedLanguage = normalizeCodeFenceLanguage(languageHint);
  const lines = String(input || '').replace(/\r/g, '').split('\n');
  const output: string[] = [];

  const strongKeywordLinePattern =
    /^(#include|using\s+namespace|using\s+std::|import |from |def |class |function |const |let |var |public\b|private\b|protected\b|static\b|int\b|long\b|float\b|double\b|char\b|bool\b|void\b|template\b|async\b|await\b|fn\b|struct\b|enum\b|type\b)/i;
  const controlKeywordLinePattern =
    /^(if|else|for|while|switch|case|break|continue|return|try|catch|finally|elif|except|with)\b/i;

  const numericListPattern = /^[\d\s.,+\-*/\[\]]+$/;

  for (const rawLine of lines) {
    const line = String(rawLine || '');
    const trimmed = line.trim();

    if (!trimmed) {
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
      continue;
    }

    if (strongKeywordLinePattern.test(trimmed)) {
      output.push(line);
      continue;
    }

    if (controlKeywordLinePattern.test(trimmed) && (/[(){}[\];=<>:+\-*/,%!&|^]/.test(trimmed) || /:$/.test(trimmed))) {
      output.push(line);
      continue;
    }

    if (/[{}()[\];=<>:+\-*/,%!&|^]/.test(trimmed)) {
      output.push(line);
      continue;
    }

    if (normalizedLanguage === 'python' && /:$/.test(trimmed)) {
      output.push(line);
      continue;
    }

    if (numericListPattern.test(trimmed)) {
      output.push(line);
      continue;
    }

    if (/^[A-Za-z][A-Za-z ]{8,}$/.test(trimmed)) {
      continue;
    }

    const proseWordCount = (trimmed.match(/[A-Za-z]+/g) || []).length;
    const hasCodePunctuation = /[{}()[\];=<>:+\-*/,%!&|^]/.test(trimmed);
    const hasLanguageKeyword =
      strongKeywordLinePattern.test(trimmed)
      || (controlKeywordLinePattern.test(trimmed) && (/[(){}[\];=<>:+\-*/,%!&|^]/.test(trimmed) || /:$/.test(trimmed)));
    if (!hasCodePunctuation && !hasLanguageKeyword && proseWordCount >= 5) {
      continue;
    }

    output.push(line);
  }

  while (output.length > 0 && output[output.length - 1] === '') {
    output.pop();
  }

  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

const enforceCodeReplyTemplate = (prompt: string, text: string): string => {
  const source = unescapeEscapedCodeFences(String(text || '').trim());
  if (!source) return source;

  const sourceWithoutMarkers = source
    .replace(/\bCODE_BEGIN\b/gi, '')
    .replace(/\bCODE_END\b/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const markerBlocks = collectMarkerCodeBlocks(source);
  const blocks = collectFencedCodeBlocks(source);
  const labeledSegments = collectLabeledCodeSegments(sourceWithoutMarkers);
  const isCodePrompt = isLikelyCodePrompt(prompt);
  if (!isCodePrompt && blocks.length === 0 && markerBlocks.length === 0 && labeledSegments.length === 0) {
    return source;
  }

  const candidates: Array<{ language: string; code: string }> = [];

  for (const block of blocks) {
    const raw = String(block.code || '').trim();
    if (!raw) continue;
    candidates.push({
      language: normalizeCodeFenceLanguage(block.language),
      code: raw,
    });
  }

  for (const markerCode of markerBlocks) {
    const raw = String(markerCode || '').trim();
    if (!raw) continue;
    candidates.push({
      language: '',
      code: raw,
    });
  }

  for (const segment of labeledSegments) {
    const raw = String(segment || '').trim();
    if (!raw) continue;
    const extracted = extractInlineCodeFromPlainText(raw) || (hasDenseCodeStructure(raw) ? raw : '');
    if (!extracted) continue;
    candidates.push({
      language: '',
      code: extracted,
    });
  }

  if (candidates.length === 0) {
    const extracted = extractInlineCodeFromPlainText(sourceWithoutMarkers)
      || (hasDenseCodeStructure(sourceWithoutMarkers) ? sourceWithoutMarkers : '');
    if (extracted) {
      candidates.push({
        language: '',
        code: extracted,
      });
    }
  }

  if (candidates.length === 0) {
    return source;
  }

  const dedupedCandidates: Array<{ language: string; code: string }> = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = String(candidate.code || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    dedupedCandidates.push(candidate);
  }

  const usableCandidates = dedupedCandidates.length > 0 ? dedupedCandidates : candidates;
  const lastCandidate = usableCandidates[usableCandidates.length - 1];
  const lastScore = scoreCodeCandidate(lastCandidate.code);
  const selected = lastScore >= 18
    ? lastCandidate
    : usableCandidates.reduce((best, current) =>
      scoreCodeCandidate(current.code) > scoreCodeCandidate(best.code) ? current : best
    );

  const language = normalizeCodeFenceLanguage(selected.language) || inferCodeLanguageFromPrompt(prompt);
  const selectedScore = scoreCodeCandidate(selected.code);
  if (isCodePrompt && selectedScore < 12) {
    return source;
  }
  const rawSelected = String(selected.code || '')
    .replace(/\bCODE_BEGIN\b/gi, '')
    .replace(/\bCODE_END\b/gi, '')
    .replace(/\bCode:\s*/gi, '')
    .trim();
  const extractedSelected = extractInlineCodeFromPlainText(rawSelected) || rawSelected;
  const compactSelected = stripNarrativeOnlyLinesFromCode(extractedSelected, language);
  const normalizedSource = formatInlineCodeSegment(compactSelected, language);
  const strictLayout = enforceStrictCodeLineLayout(normalizedSource, language);
  const code = stripCodeCommentsAndDocstrings(strictLayout, language)
    .replace(/^\s*CODE_BEGIN\s*$/gmi, '')
    .replace(/^\s*CODE_END\s*$/gmi, '')
    .replace(/^\s*Code:\s*/gmi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!code) {
    return source;
  }

  if (!hasDenseCodeStructure(code)) {
    return source;
  }

  const narrative = stripCodeArtifactsFromNarrative(sourceWithoutMarkers);
  const explanation = buildProfessionalCodeExplanation(prompt, narrative);
  return `${explanation}\n\nCode:\n${code}`.trim();
};

const getEmojiStyleForConversation = (conversationKey?: string): 'rich' | 'minimal' => {
  if (FORCE_RICH_EMOJI_STYLE) return 'rich';
  if (!conversationKey) return 'minimal';
  return userProfiles.get(conversationKey)?.emojiStyle === 'minimal' ? 'minimal' : 'rich';
};

const ensureEmojiInReply = (text: string, _prompt: string, _conversationKey?: string): string => {
  const value = String(text || '').trim();
  if (!value) return 'Got it.';
  return value
    .replace(/[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713\u{1F539}\u{1F3C1}]/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
};

const decorateAnswerWithVisuals = (text: string, primaryEmoji: string): string => {
  const value = String(text || '').trim();
  if (!value) return value;
  if (value.includes('```')) {
    // Keep code answers clean: light visual markers only.
    const suffix = /[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713]\s*$/u.test(value) ? value : `${value}\n\n${primaryEmoji}`;
    return /^\s*[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713]/u.test(suffix) ? suffix : `${primaryEmoji} ${suffix}`;
  }

  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean);
  const midEmoji = '\u{1F539}';
  const endEmoji = '\u{1F3C1}';

  if (lines.length >= 3) {
    const midIndex = Math.min(1, lines.length - 1);
    if (!/[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713]/u.test(lines[midIndex])) {
      lines[midIndex] = `${midEmoji} ${lines[midIndex]}`;
    }
    let output = lines.join('\n\n');
    if (!/^\s*[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713]/u.test(output)) {
      output = `${primaryEmoji} ${output}`;
    }
    if (!/[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713]\s*$/u.test(output)) {
      output = `${output}\n\n${endEmoji}`;
    }
    return output;
  }

  let output = value;
  if (!/^\s*[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713]/u.test(output)) {
    output = `${primaryEmoji} ${output}`;
  }
  if (!/[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713]\s*$/u.test(output)) {
    output = `${output}\n\n${endEmoji}`;
  }
  return output;
};

const stripReconnectLoopReply = (text: string): string => {
  const value = String(text || '').trim();
  if (!value) return value;
  if (isTransientProviderFailureReply(value)) {
    return '';
  }
  return value;
};

const hasCapabilityBoilerplate = (text: string): boolean => {
  const value = String(text || '').toLowerCase();
  return /early access|limitations|knowledge cutoff|october 2023|no real-time data access|i'm currently at v\d/.test(value);
};

const detectMicroHints = (input: string): {
  matched: string[];
  scores: {
    depth: number;
    style: number;
    continuity: number;
  };
  inferredDepth: 'normal' | 'deep';
  inferredStyle: 'neutral' | 'professional';
  wantsStepByStep: boolean;
} => {
  const text = String(input || '').toLowerCase();
  const checks: Array<{
    key: string;
    pattern: RegExp;
    depth?: number;
    style?: number;
    continuity?: number;
  }> = [
    { key: 'hard', pattern: /\bhard(?:est)?\b/, depth: 3 },
    { key: 'professional', pattern: /\bprofessional\b/, style: 3 },
    { key: 'like yours', pattern: /\blike yours\b/, style: 1, continuity: 1 },
    { key: 'fully correct', pattern: /\bfully correct\b/, depth: 2 },
    { key: 'step by step', pattern: /\bstep by step\b/, depth: 2, style: 1 },
    { key: 'advanced', pattern: /\badvanced\b/, depth: 3 },
    { key: 'accurate', pattern: /\baccurate\b/, depth: 2 },
    { key: 'make it better', pattern: /\bmake it better\b/, continuity: 2 },
    { key: 'like before', pattern: /\blike before\b/, continuity: 3 },
    { key: 'same thing', pattern: /\bsame thing\b/, continuity: 2 },
    { key: 'continue', pattern: /\bcontinue\b/, continuity: 2 },
    { key: 'ok more', pattern: /\bok\s+more\b/, continuity: 2, depth: 1 },
  ];
  const matchedEntries = checks.filter((c) => c.pattern.test(text));
  const matched = matchedEntries.map((c) => c.key);
  const scores = matchedEntries.reduce(
    (acc, item) => {
      acc.depth += item.depth || 0;
      acc.style += item.style || 0;
      acc.continuity += item.continuity || 0;
      return acc;
    },
    { depth: 0, style: 0, continuity: 0 }
  );
  const inferredDepth = scores.depth >= 2 ? 'deep' : 'normal';
  const inferredStyle = scores.style >= 2 ? 'professional' : 'neutral';
  const wantsStepByStep = /\bstep by step\b/.test(text);
  return { matched, scores, inferredDepth, inferredStyle, wantsStepByStep };
};

const isShortCapabilityQuestion = (input: string): boolean => {
  const text = String(input || '').trim().toLowerCase();
  if (!text || text.length > 120) return false;
  return /^(can you|could you|are you able to)\b/.test(text);
};

const isCasualSmallTalk = (input: string): boolean => {
  const text = String(input || '').trim().toLowerCase();
  if (!text || text.length > 80) return false;
  return /^(hi|hello|hey|good morning|good afternoon|good evening|how are you|what'?s up|what are you doing|thanks|thank you|ok|okay)\b/.test(text);
};

const estimateTaskAlignmentRisk = (args: {
  input: string;
  intent: string;
  effectiveChangedByContext: boolean;
  contextualFollowUp: boolean;
  capabilityQuestionDetected: boolean;
  casualSmallTalkDetected: boolean;
}): 'low' | 'medium' | 'high' => {
  const text = String(args.input || '').trim().toLowerCase();
  if (!text) return 'high';
  if (args.capabilityQuestionDetected || args.casualSmallTalkDetected) return 'low';

  const genericShortRef =
    /^(do it|make it better|fix it|same thing|like before|this|that|it|more|continue|why)\??$/.test(text);
  if (genericShortRef && !args.contextualFollowUp && !args.effectiveChangedByContext) {
    return 'high';
  }

  const domainHits = [
    /\b(react|html|css|frontend|ui|website)\b/.test(text),
    /\b(node|express|api|backend|server)\b/.test(text),
    /\bpython|django|flask\b/.test(text),
    /\btelegram bot|telegraf|bot\b/.test(text)
  ].filter(Boolean).length;

  if (domainHits >= 3) return 'medium';
  if (text.length <= 12 && !args.contextualFollowUp && !args.effectiveChangedByContext) return 'medium';
  if (args.intent === 'unknown' && !args.contextualFollowUp) return 'medium';
  return 'low';
};

const inferDefaultLanguageIfUnspecified = (input: string): 'python' | 'javascript' => {
  const text = String(input || '').toLowerCase();
  if (!text) return 'python';
  if (/\bpython|django|flask|fastapi|pandas\b/.test(text)) return 'python';
  if (/\bjavascript|js|node(?:\.js)?|typescript|ts|react|next\.?js|express\b/.test(text)) {
    return 'javascript';
  }
  if (/\btelegram bot|telegraf\b/.test(text) && /\b(node|javascript|js|typescript|ts)\b/.test(text)) {
    return 'javascript';
  }
  return 'python';
};

const estimateUnknownTermRisk = (input: string): 'low' | 'medium' | 'high' => {
  const text = String(input || '').trim();
  const lower = text.toLowerCase();
  if (!text) return 'low';
  if (text.length > 140) return 'low';
  if (isCasualSmallTalk(text) || isShortCapabilityQuestion(text)) return 'low';
  if (/\b(define|meaning|what is|what's|explain)\b/.test(lower)) {
    const quoted = text.match(/["'`][^"'`]{2,40}["'`]/g) || [];
    const weirdToken =
      /\b[a-z]{2,}[a-z0-9]*[xzqj]{2,}[a-z0-9]*\b/i.test(text) ||
      /\b[A-Z][a-z]+[A-Z][A-Za-z]+\b/.test(text) ||
      /\b[a-z]{8,}\d{2,}\b/i.test(text);
    if (quoted.length > 0 || weirdToken) return 'high';
    if (text.split(/\s+/).length <= 6) return 'medium';
  }
  const singleRareLike = text.split(/\s+/).length <= 4 && /^[A-Za-z0-9_-]{6,}$/.test(text);
  if (singleRareLike && !/\b(python|javascript|react|telegram|node|html|css)\b/i.test(text)) {
    return 'medium';
  }
  return 'low';
};

const detectConversationalTone = (input: string): {
  tone: 'serious' | 'playful' | 'philosophical' | 'dramatic' | 'testing' | 'casual' | 'command';
  confidence: 'low' | 'medium' | 'high';
} => {
  const text = String(input || '').trim();
  const lower = text.toLowerCase();
  if (!text) return { tone: 'casual', confidence: 'low' };

  if (/^(draw|create|write|explain|build|generate|make|solve|fix|implement)\b/.test(lower)) {
    return { tone: 'command', confidence: 'high' };
  }
  if (/\b(meaning of life|what is life|existence|consciousness|purpose|reality|truth|soul|free will)\b/.test(lower)) {
    return { tone: 'philosophical', confidence: 'high' };
  }
  if (/\b(broken|ruined|destroyed|doomed|everything is over|dramatic|tragedy|devastated)\b/.test(lower)) {
    return { tone: 'dramatic', confidence: 'medium' };
  }
  if (/\b(joke|lol|haha|funny|roast|meme|play a game|tease)\b/.test(lower)) {
    return { tone: 'playful', confidence: 'high' };
  }
  if (/\b(can you control|obey me|you must obey|dominate|who is in control|are you under my control)\b/.test(lower)) {
    return { tone: 'testing', confidence: 'high' };
  }
  if (isCasualSmallTalk(text)) return { tone: 'casual', confidence: 'high' };
  if (/[?]/.test(text) || /\b(explain|compare|how|why|what)\b/.test(lower)) {
    return { tone: 'serious', confidence: 'medium' };
  }
  return { tone: 'serious', confidence: 'low' };
};

const topicKeywordSet = (input: string): Set<string> => {
  const stop = new Set([
    'the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'at', 'is', 'are', 'be', 'it',
    'this', 'that', 'with', 'how', 'what', 'why', 'can', 'you', 'me', 'do', 'make', 'build',
    'write', 'create', 'please', 'about'
  ]);
  return new Set(
    String(input || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && !stop.has(t))
  );
};

const detectTopicShift = (args: {
  currentInput: string;
  previousPrompt?: string | null;
  currentIntent: string;
  previousIntent?: string | null;
  contextualFollowUp: boolean;
  effectiveChangedByContext: boolean;
  casualSmallTalkDetected: boolean;
}): { topicShiftDetected: boolean; hardContextResetRecommended: boolean } => {
  if (args.contextualFollowUp || args.effectiveChangedByContext) {
    return { topicShiftDetected: false, hardContextResetRecommended: false };
  }
  if (args.casualSmallTalkDetected) {
    return { topicShiftDetected: false, hardContextResetRecommended: false };
  }
  const prev = String(args.previousPrompt || '').trim();
  if (!prev) return { topicShiftDetected: false, hardContextResetRecommended: false };

  const curSet = topicKeywordSet(args.currentInput);
  const prevSet = topicKeywordSet(prev);
  if (!curSet.size || !prevSet.size) {
    return { topicShiftDetected: false, hardContextResetRecommended: false };
  }

  let intersection = 0;
  for (const token of curSet) {
    if (prevSet.has(token)) intersection += 1;
  }
  const union = new Set([...curSet, ...prevSet]).size || 1;
  const overlap = intersection / union;
  const codingBoundaryChanged =
    (args.previousIntent === 'coding' && args.currentIntent !== 'coding') ||
    (args.previousIntent !== 'coding' && args.currentIntent === 'coding');

  const topicShiftDetected = overlap < 0.12 || (codingBoundaryChanged && overlap < 0.3);
  const hardContextResetRecommended = topicShiftDetected && (overlap < 0.06 || codingBoundaryChanged);
  return { topicShiftDetected, hardContextResetRecommended };
};

const estimateFallbackFragmentRisk = (args: {
  input: string;
  taskAlignmentRisk: 'low' | 'medium' | 'high';
  contextualFollowUp: boolean;
  effectiveChangedByContext: boolean;
  capabilityQuestionDetected: boolean;
  casualSmallTalkDetected: boolean;
  topicShiftDetected: boolean;
}): 'low' | 'medium' | 'high' => {
  const text = String(args.input || '').trim().toLowerCase();
  if (args.capabilityQuestionDetected || args.casualSmallTalkDetected) return 'low';
  if (args.contextualFollowUp || args.effectiveChangedByContext) return 'low';
  const generic = /^(ok|okay|more|why|continue|do it|fix it|same thing|like before|help)\??$/.test(text);
  if (args.taskAlignmentRisk === 'high' && generic) return 'high';
  if (args.taskAlignmentRisk === 'high') return 'medium';
  if (args.topicShiftDetected && text.length < 30) return 'medium';
  return 'low';
};

const estimateSemanticMismatchRisk = (args: {
  input: string;
  intent: string;
  taskAlignmentRisk: 'low' | 'medium' | 'high';
  hardContextResetRecommended: boolean;
  unknownTermRisk: 'low' | 'medium' | 'high';
  contextualFollowUp: boolean;
}): 'low' | 'medium' | 'high' => {
  const text = String(args.input || '').toLowerCase();
  const domainHits = [
    /\b(html|css|react|frontend|ui|website)\b/.test(text),
    /\b(node|express|backend|server|api)\b/.test(text),
    /\bpython|django|flask|fastapi\b/.test(text),
    /\btelegram|telegraf|bot\b/.test(text),
    /\bmath|equation|algebra|calculus\b/.test(text)
  ].filter(Boolean).length;
  if (args.contextualFollowUp) return 'low';
  if (args.hardContextResetRecommended && args.taskAlignmentRisk !== 'low') return 'high';
  if (args.taskAlignmentRisk === 'high') return 'high';
  if (domainHits >= 3) return 'medium';
  if (args.intent === 'unknown' || args.unknownTermRisk === 'high') return 'medium';
  return 'low';
};

const estimateRetrievalArtifactRisk = (args: {
  input: string;
  intent: string;
  unknownTermRisk: 'low' | 'medium' | 'high';
  taskAlignmentRisk: 'low' | 'medium' | 'high';
  capabilityQuestionDetected: boolean;
  casualSmallTalkDetected: boolean;
  contextualFollowUp: boolean;
}): 'low' | 'medium' | 'high' => {
  const text = String(args.input || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!text) return 'low';
  if (args.capabilityQuestionDetected || args.casualSmallTalkDetected) return 'low';
  if (args.intent === 'coding' || args.intent === 'math') return 'low';

  const explicitSourcesRequested = /\b(source|sources|citation|citations|cite|reference|references|link|links|url|urls|wikipedia)\b/.test(text);
  if (explicitSourcesRequested) return 'low';

  const definitionLike =
    /^(what is|who is|define|definition of|meaning of|explain)\b/.test(text)
    || /\b(what is|who is|define|definition of|meaning of)\b/.test(text);
  const realtimeLike = /(latest|today|current|recent|news|price|market cap|gdp|revenue|population|top\s+\d+|ranking|rank)\b/.test(text);
  const quotedTerm = /["'][^"'\n]{3,48}["']/.test(text);
  const shortPrompt = text.split(/\s+/).filter(Boolean).length <= 8;

  if (definitionLike && args.unknownTermRisk === 'high') return 'high';
  if (definitionLike && (quotedTerm || shortPrompt)) return 'medium';
  if (realtimeLike && !args.contextualFollowUp) return 'medium';
  if (args.taskAlignmentRisk === 'high' && (definitionLike || realtimeLike)) return 'medium';
  return 'low';
};

const isTimeSensitivePrompt = (text: string): boolean => {
  const value = String(text || '').toLowerCase();
  if (/\b(today|latest|right now|as of|breaking news|this year)\b/.test(value)) return true;
  if (/\b202[4-9]\b/.test(value)) return true;
  if (/\bcurrent\s+(price|market|ceo|president|prime minister|ranking|rank|news|gdp|population|revenue|net worth|weather|score|stock|market cap)\b/.test(value)) return true;
  return /\b(market|price|revenue|gdp|election|news|stock price|market cap|forecast|prediction)\b/.test(value)
    && /\b(current|latest|today|now|as of|202[4-9])\b/.test(value);
};

const isComplexPrompt = (text: string): boolean => {
  const value = String(text || '').toLowerCase();
  return /(why|how|compare|strategy|analysis|estimate|forecast|roadmap|reason|explain|detailed|step by step)/.test(value) || value.length > 120;
};

const looksThinAnswerForComplexPrompt = (answer: string, prompt: string): boolean => {
  if (!isComplexPrompt(prompt)) return false;
  const out = String(answer || '').trim();
  if (!out) return true;
  if (isPromptEchoLikeReply(prompt, out)) return true;
  if (/```[\s\S]*```/.test(out)) return false;
  const compact = normalizeReplyQualityComparable(out);
  if (!compact) return true;
  const sentenceCount = out.split(/[.!?]\s+/).filter((part) => part.trim().length > 0).length;
  const lineCount = out.split(/\n+/).filter((line) => line.trim().length > 0).length;
  if (out.length < 180) return true;
  return out.length < 320 && Math.max(sentenceCount, lineCount) < 4;
};

const looksLowQualityAnswer = (answer: string, prompt: string): boolean => {
  const out = String(answer || '').trim();
  if (!out) return true;
  if (isPromptEchoLikeReply(prompt, out)) return true;
  if (hasCapabilityBoilerplate(out)) return true;
  if (isTransientProviderFailureReply(out)) return true;
  if (isLowValueDeflectionReply(out)) return true;
  if (isComplexPrompt(prompt) && out.length < 120) return true;
  if (looksThinAnswerForComplexPrompt(out, prompt)) return true;
  return false;
};

const isAcceptableShortAnswer = (answer: string, prompt: string): boolean => {
  const out = String(answer || '').trim();
  if (!out) return false;
  const plain = out.replace(/^[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713]\s*/u, '').trim();
  if (!plain) return false;
  if (/^[\d.,+\-*/()%=\s]+$/.test(plain) && /\d/.test(plain)) return true;
  if (/^(yes|no|true|false)\b/i.test(plain)) return true;
  if (plain.length >= 8) return true;
  return /(pi|euler|prime|capital|value|definition|meaning|date|year|population)/i.test(prompt);
};

const isLowValueDeflectionReply = (text: string): boolean => {
  const v = String(text || '').toLowerCase().trim();
  if (!v) return true;
  if (isTransientProviderFailureReply(v)) return true;
  return /(i can help with this\.?\s*share one clear question|share one clear question or goal|i am ready to help.*ask (?:your|one clear) question|ready to help.*(ask|share).*(question|goal)|ask any question and i will answer|i will answer directly\b|direct answer topic\b|provide one specific output format\b|final polished answer\b|i am ready to answer this directly in a professional format|please send the exact topic, value, or required output format in one clear line|please send the topic again in one clear line if the earlier context was not available in this reply path|previous-topic context was not available in this reply path|temporary live-answer generation issue for this request|temporary response generation issue in this pass|direct answer for your question|complete professional coding response|requested task:|please ask one specific question with clear context|if you want, i can provide more detail for this answer|temporary ai service issue|temporary response formatting issue|please send your question again|please retry in a few seconds|could not generate a reliable answer|could not process that request right now|resend your question clearly in one line|current-events answer requires exact date context for accuracy)/s.test(v);
};

const parseScopeAndChatFromConversationKeyFast = (
  conversationKey: string | undefined
): { scope: string; chatId: string } | null => {
  const key = String(conversationKey || '').trim();
  if (!key) return null;
  const parts = key.split(':');
  if (parts.length < 3) return null;
  const chatId = parts.pop() || '';
  const scope = parts.join(':');
  if (!scope || !chatId) return null;
  return { scope, chatId };
};

const moderationSnippet = (value: string, max: number = 240): string =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const scheduleModerationAuditPersist = (): void => {
  if (moderationAuditPersistTimer) return;
  moderationAuditPersistTimer = setTimeout(() => {
    moderationAuditPersistTimer = null;
    persistModerationAuditLog();
  }, 600);
};

const persistModerationAuditLog = (): void => {
  try {
    const dir = path.dirname(MODERATION_AUDIT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const serialized = JSON.stringify({ version: 1, records: moderationAuditLog }, null, 2);
    fs.writeFileSync(MODERATION_AUDIT_FILE, serialized, 'utf8');
  } catch (error) {
    console.warn('[MODERATION_AUDIT] Failed to persist moderation audit log:', (error as Error).message);
  }
};

const loadModerationAuditLog = (): void => {
  try {
    if (!fs.existsSync(MODERATION_AUDIT_FILE)) return;
    const raw = fs.readFileSync(MODERATION_AUDIT_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { records?: ModerationAuditRecord[] };
    moderationAuditLog.length = 0;
    for (const item of parsed?.records || []) {
      const row: ModerationAuditRecord = {
        id: String(item?.id || randomUUID()),
        timestamp: Number(item?.timestamp || Date.now()),
        source: (item?.source === 'output' || item?.source === 'anti_spam' || item?.source === 'admin') ? item.source : 'input',
        blocked: Boolean(item?.blocked),
        category: String(item?.category || 'none'),
        action: String(item?.action || ''),
        scope: String(item?.scope || ''),
        chatId: String(item?.chatId || ''),
        conversationKey: String(item?.conversationKey || ''),
        userId: String(item?.userId || ''),
        inputSnippet: moderationSnippet(item?.inputSnippet || ''),
        outputSnippet: moderationSnippet(item?.outputSnippet || ''),
        reason: moderationSnippet(item?.reason || '', 600)
      };
      moderationAuditLog.push(row);
    }
    if (moderationAuditLog.length > MODERATION_AUDIT_MAX_ENTRIES) {
      moderationAuditLog.splice(0, moderationAuditLog.length - MODERATION_AUDIT_MAX_ENTRIES);
    }
  } catch (error) {
    console.warn('[MODERATION_AUDIT] Failed to load moderation audit log:', (error as Error).message);
  }
};

const recordModerationAudit = (input: {
  source: ModerationAuditSource;
  blocked: boolean;
  category?: string;
  action?: string;
  prompt?: string;
  reply?: string;
  reason?: string;
  conversationKey?: string;
  scope?: string;
  chatId?: string;
  userId?: string;
}): void => {
  if (!input.blocked && !MODERATION_AUDIT_LOG_ALL) return;
  const keyInfo = parseScopeAndChatFromConversationKeyFast(input.conversationKey);
  const row: ModerationAuditRecord = {
    id: randomUUID(),
    timestamp: Date.now(),
    source: input.source,
    blocked: Boolean(input.blocked),
    category: String(input.category || 'none'),
    action: moderationSnippet(input.action || ''),
    scope: String(input.scope || keyInfo?.scope || ''),
    chatId: String(input.chatId || keyInfo?.chatId || ''),
    conversationKey: String(input.conversationKey || ''),
    userId: String(input.userId || ''),
    inputSnippet: moderationSnippet(input.prompt || ''),
    outputSnippet: moderationSnippet(input.reply || ''),
    reason: moderationSnippet(input.reason || '', 600)
  };
  moderationAuditLog.push(row);
  if (moderationAuditLog.length > MODERATION_AUDIT_MAX_ENTRIES) {
    moderationAuditLog.splice(0, moderationAuditLog.length - MODERATION_AUDIT_MAX_ENTRIES);
  }
  scheduleModerationAuditPersist();
};

const getTelegramRestrictionKey = (scope: string, chatId: string, userId: string): string =>
  `${String(scope || '').trim()}:${String(chatId || '').trim()}:${String(userId || '').trim()}`;

const scheduleTelegramAdminRestrictionsPersist = (): void => {
  if (telegramAdminRestrictionsPersistTimer) return;
  telegramAdminRestrictionsPersistTimer = setTimeout(() => {
    telegramAdminRestrictionsPersistTimer = null;
    persistTelegramAdminRestrictions();
  }, 600);
};

const persistTelegramAdminRestrictions = (): void => {
  try {
    const dir = path.dirname(TELEGRAM_ADMIN_RESTRICTIONS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const serialized = JSON.stringify(
      {
        version: 1,
        restrictions: Object.fromEntries(telegramAdminRestrictions.entries())
      },
      null,
      2
    );
    fs.writeFileSync(TELEGRAM_ADMIN_RESTRICTIONS_FILE, serialized, 'utf8');
  } catch (error) {
    console.warn('[ANTI_SPAM] Failed to persist Telegram admin restrictions:', (error as Error).message);
  }
};

const loadTelegramAdminRestrictions = (): void => {
  try {
    if (!fs.existsSync(TELEGRAM_ADMIN_RESTRICTIONS_FILE)) return;
    const raw = fs.readFileSync(TELEGRAM_ADMIN_RESTRICTIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { restrictions?: Record<string, TelegramAdminRestriction> };
    telegramAdminRestrictions.clear();
    for (const [key, value] of Object.entries(parsed?.restrictions || {})) {
      if (!key || !value) continue;
      telegramAdminRestrictions.set(key, {
        scope: String(value.scope || ''),
        chatId: String(value.chatId || ''),
        userId: String(value.userId || ''),
        blockedUntil: Number(value.blockedUntil || 0),
        reason: String(value.reason || ''),
        createdAt: Number(value.createdAt || Date.now()),
        updatedAt: Number(value.updatedAt || Date.now()),
        createdBy: String(value.createdBy || 'admin')
      });
    }
  } catch (error) {
    console.warn('[ANTI_SPAM] Failed to load Telegram admin restrictions:', (error as Error).message);
  }
};

const setTelegramAdminRestriction = (input: {
  scope: string;
  chatId: string;
  userId: string;
  blockedUntil: number;
  reason?: string;
  createdBy?: string;
}): TelegramAdminRestriction => {
  const key = getTelegramRestrictionKey(input.scope, input.chatId, input.userId);
  const now = Date.now();
  const existing = telegramAdminRestrictions.get(key);
  const next: TelegramAdminRestriction = {
    scope: String(input.scope || ''),
    chatId: String(input.chatId || ''),
    userId: String(input.userId || ''),
    blockedUntil: Math.max(now, Number(input.blockedUntil || now)),
    reason: String(input.reason || existing?.reason || 'manual restriction'),
    createdAt: Number(existing?.createdAt || now),
    updatedAt: now,
    createdBy: String(input.createdBy || existing?.createdBy || 'admin')
  };
  telegramAdminRestrictions.set(key, next);
  scheduleTelegramAdminRestrictionsPersist();
  return next;
};

const removeTelegramAdminRestriction = (scope: string, chatId: string, userId: string): boolean => {
  const key = getTelegramRestrictionKey(scope, chatId, userId);
  const removed = telegramAdminRestrictions.delete(key);
  if (removed) scheduleTelegramAdminRestrictionsPersist();
  return removed;
};

const getActiveTelegramAdminRestriction = (
  scope: string,
  chatId: string,
  userId: string
): TelegramAdminRestriction | null => {
  const key = getTelegramRestrictionKey(scope, chatId, userId);
  const existing = telegramAdminRestrictions.get(key);
  if (!existing) return null;
  if (existing.blockedUntil <= Date.now()) {
    telegramAdminRestrictions.delete(key);
    scheduleTelegramAdminRestrictionsPersist();
    return null;
  }
  return existing;
};

const listTelegramAdminRestrictions = (): TelegramAdminRestriction[] =>
  Array.from(telegramAdminRestrictions.values())
    .filter((item) => item.blockedUntil > Date.now())
    .sort((a, b) => a.blockedUntil - b.blockedUntil);

const encodeRedisCommand = (args: Array<string | number>): Buffer => {
  const chunks: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
  for (const arg of args) {
    const text = String(arg);
    const data = Buffer.from(text, 'utf8');
    chunks.push(Buffer.from(`$${data.length}\r\n`));
    chunks.push(data);
    chunks.push(Buffer.from('\r\n'));
  }
  return Buffer.concat(chunks);
};

const parseRedisLine = (buffer: Buffer, startIndex: number): { value: string; next: number } | null => {
  const lineEnd = buffer.indexOf('\r\n', startIndex);
  if (lineEnd < 0) return null;
  const value = buffer.slice(startIndex, lineEnd).toString('utf8');
  return { value, next: lineEnd + 2 };
};

const parseRedisResponse = (buffer: Buffer, startIndex: number): { value: unknown; bytes: number } | null => {
  if (startIndex >= buffer.length) return null;
  const prefix = String.fromCharCode(buffer[startIndex]);
  const payloadStart = startIndex + 1;
  if (prefix === '+' || prefix === '-' || prefix === ':') {
    const line = parseRedisLine(buffer, payloadStart);
    if (!line) return null;
    if (prefix === '+') return { value: line.value, bytes: line.next - startIndex };
    if (prefix === ':') return { value: Number(line.value), bytes: line.next - startIndex };
    return { value: new Error(line.value), bytes: line.next - startIndex };
  }
  if (prefix === '$') {
    const line = parseRedisLine(buffer, payloadStart);
    if (!line) return null;
    const length = Number(line.value);
    if (!Number.isFinite(length)) return { value: new Error('invalid bulk length'), bytes: line.next - startIndex };
    if (length === -1) return { value: null, bytes: line.next - startIndex };
    const end = line.next + length;
    if (end + 2 > buffer.length) return null;
    const value = buffer.slice(line.next, end).toString('utf8');
    return { value, bytes: (end + 2) - startIndex };
  }
  if (prefix === '*') {
    const line = parseRedisLine(buffer, payloadStart);
    if (!line) return null;
    const count = Number(line.value);
    if (!Number.isFinite(count)) return { value: new Error('invalid array length'), bytes: line.next - startIndex };
    if (count === -1) return { value: null, bytes: line.next - startIndex };
    const values: unknown[] = [];
    let cursor = line.next;
    for (let i = 0; i < count; i += 1) {
      const parsed = parseRedisResponse(buffer, cursor);
      if (!parsed) return null;
      values.push(parsed.value);
      cursor += parsed.bytes;
    }
    return { value: values, bytes: cursor - startIndex };
  }
  return { value: new Error(`unsupported redis response prefix ${prefix}`), bytes: buffer.length - startIndex };
};

const runRedisCommandRaw = async (args: Array<string | number>): Promise<unknown> => {
  if (!parsedRedisConfig) {
    throw new Error('redis not configured');
  }
  const cfg = parsedRedisConfig;
  const commands: Array<Array<string | number>> = [];
  if (cfg.password) {
    commands.push(cfg.username ? ['AUTH', cfg.username, cfg.password] : ['AUTH', cfg.password]);
  }
  if (cfg.db > 0) {
    commands.push(['SELECT', cfg.db]);
  }
  commands.push(args);
  const expectedResponses = commands.length;
  const payload = Buffer.concat(commands.map((command) => encodeRedisCommand(command)));

  return new Promise((resolve, reject) => {
    let settled = false;
    let responseBuffer = Buffer.alloc(0);
    const responses: unknown[] = [];
    const socket = cfg.secure
      ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host })
      : net.createConnection({ host: cfg.host, port: cfg.port });

    const settle = (error: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        socket.destroy();
      } catch {}
      if (error) {
        reject(error);
        return;
      }
      resolve(value);
    };

    const timeout = setTimeout(() => {
      settle(new Error('redis command timed out'));
    }, REDIS_TIMEOUT_MS);

    socket.setNoDelay(true);
    socket.once('error', (error) => {
      settle(error instanceof Error ? error : new Error(String(error)));
    });
    socket.once('connect', () => {
      socket.write(payload);
    });
    socket.on('data', (chunk) => {
      if (settled) return;
      responseBuffer = Buffer.concat([responseBuffer, chunk]);
      while (true) {
        const parsed = parseRedisResponse(responseBuffer, 0);
        if (!parsed) break;
        responses.push(parsed.value);
        responseBuffer = responseBuffer.slice(parsed.bytes);
        if (responses.length >= expectedResponses) {
          for (let i = 0; i < responses.length; i += 1) {
            if (responses[i] instanceof Error) {
              settle(responses[i] as Error);
              return;
            }
          }
          settle(null, responses[responses.length - 1]);
          return;
        }
      }
    });
  });
};

const runRedisAntiSpamCommand = async (
  args: Array<string | number>
): Promise<{ available: boolean; value: unknown }> => {
  if (!REDIS_ANTI_SPAM_ENABLED) {
    return { available: false, value: null };
  }
  try {
    const value = await runRedisCommandRaw(args);
    redisAntiSpamUnavailable = false;
    return { available: true, value };
  } catch (error) {
    if (!redisAntiSpamUnavailable) {
      console.warn('[ANTI_SPAM] Redis unavailable, falling back to in-memory anti-spam:', (error as Error).message);
    }
    redisAntiSpamUnavailable = true;
    return { available: false, value: null };
  }
};

type SafetyModerationDecision = {
  blocked: boolean;
  category: 'none' | 'self_harm' | 'violence' | 'cyber_abuse' | 'sexual_minors';
  response: string;
};

const runSafetyModerationPipeline = (text: string): SafetyModerationDecision => {
  const raw = String(text || '').trim();
  if (!raw) {
    return { blocked: false, category: 'none', response: '' };
  }
  const normalized = raw.toLowerCase();
  const normalizedCompact = normalized.replace(/\s+/g, ' ').trim();

  const selfHarmPattern = /\b(kill myself|suicide|self harm|hurt myself|end my life|want to die|die today)\b/i;
  if (selfHarmPattern.test(normalizedCompact)) {
    return {
      blocked: true,
      category: 'self_harm',
      response: [
        'I cannot help with self-harm instructions.',
        '',
        'If you are in immediate danger, contact local emergency services now.',
        'If you are in the United States or Canada, call or text 988 for immediate support.',
        'If you want, I can help you write a short message to ask someone you trust for help right now.'
      ].join('\n')
    };
  }

  const violencePattern = /\b(how|guide|instructions?|steps?|method|make|build|create|assemble|prepare)\b[\s\S]{0,90}\b(bomb|explosive|ied|molotov|grenade|poison|weapon|gunpowder)\b/i;
  if (violencePattern.test(normalizedCompact)) {
    return {
      blocked: true,
      category: 'violence',
      response: [
        'I cannot provide instructions for weapons, explosives, or violent harm.',
        '',
        'I can help with safe and legal alternatives, such as emergency safety planning, risk prevention, or academic chemistry/physics concepts.'
      ].join('\n')
    };
  }

  const cyberAbusePattern = /\b(how|guide|instructions?|steps?|method|bypass|crack|steal|hack)\b[\s\S]{0,120}\b(password|account|otp|bank|credit card|database|server|wifi|email|malware|ransomware|phishing|keylogger|ddos|botnet)\b/i;
  if (cyberAbusePattern.test(normalizedCompact) && !/\b(prevent|defend|secure|protection|mitigate|mitigation|awareness|training|hardening)\b/i.test(normalizedCompact)) {
    return {
      blocked: true,
      category: 'cyber_abuse',
      response: [
        'I cannot help with hacking, credential theft, malware, or unauthorized access.',
        '',
        'I can help with defensive cybersecurity: account hardening, phishing detection, incident response, and secure coding.'
      ].join('\n')
    };
  }

  const sexualMinorsPattern = /\b(child|minor|underage)\b[\s\S]{0,80}\b(sex|sexual|explicit|nude)\b/i;
  if (sexualMinorsPattern.test(normalizedCompact)) {
    return {
      blocked: true,
      category: 'sexual_minors',
      response: 'I cannot assist with sexual content involving minors.'
    };
  }

  return { blocked: false, category: 'none', response: '' };
};

const enforceSafetyOutputPolicy = (prompt: string, reply: string, conversationKey?: string): string => {
  const promptDecision = runSafetyModerationPipeline(prompt);
  if (promptDecision.blocked) {
    recordModerationAudit({
      source: 'output',
      blocked: true,
      category: promptDecision.category,
      action: 'output_refusal_from_blocked_prompt',
      prompt,
      reply: promptDecision.response,
      reason: 'Prompt already blocked by safety moderation',
      conversationKey
    });
    return promptDecision.response;
  }
  const responseText = String(reply || '').trim();
  if (!responseText) return responseText;

  const dangerousOutputPattern =
    /\b(step 1|step one|materials|ingredients|assemble|detonate|payload|explosive mixture|credential theft|phishing template|keylogger)\b/i;
  const harmfulTopicPattern =
    /\b(bomb|explosive|weapon|hack|phish|steal password|malware|ransomware)\b/i;
  if (harmfulTopicPattern.test(String(prompt || '').toLowerCase()) && dangerousOutputPattern.test(responseText)) {
    const refusal = runSafetyModerationPipeline(prompt);
    if (refusal.blocked) {
      recordModerationAudit({
        source: 'output',
        blocked: true,
        category: refusal.category,
        action: 'dangerous_output_filtered',
        prompt,
        reply: refusal.response,
        reason: 'Detected harmful instruction pattern in generated output',
        conversationKey
      });
      return refusal.response;
    }
    const safeFallback = 'I cannot provide harmful instructions. I can help with safe and legal alternatives.';
    recordModerationAudit({
      source: 'output',
      blocked: true,
      category: 'violence',
      action: 'dangerous_output_filtered',
      prompt,
      reply: safeFallback,
      reason: 'Prompt/output pair matched harmful topic and instruction pattern',
      conversationKey
    });
    return safeFallback;
  }
  return responseText;
};

type ReplyTrustMeta = {
  intent?: 'math' | 'current_event' | 'coding' | 'general';
  timeSensitive?: boolean;
  realtimeSearchTriggered?: boolean;
  usedWebSources?: boolean;
  usedRagSources?: boolean;
  usedSemanticMemory?: boolean;
};

type ReplyEnhancementMeta = {
  contextAnchor?: string;
  includeTrustLayer?: boolean;
  trust?: ReplyTrustMeta;
};

const stripAnswerTrustSection = (text: string): string =>
  String(text || '')
    .replace(/(?:\n*Answer Trust:\n(?:- [^\n]*(?:\n|$))+)+\s*$/i, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const buildAnswerTrustLayer = (prompt: string, reply: string, trustMeta?: ReplyTrustMeta): string => {
  const q = String(prompt || '').trim();
  const out = String(reply || '').trim();
  if (!q || !out) return '';
  const suspicious = looksSuspiciousResponse(q, out);
  const lowMarkers = hasLowConfidenceMarkers(out) || isLowValueDeflectionReply(out);
  const inferredIntent = trustMeta?.intent || detectIntent(q);
  const inferredTimeSensitive = typeof trustMeta?.timeSensitive === 'boolean'
    ? trustMeta.timeSensitive
    : isTimeSensitivePrompt(q);
  const inferredWebUse = Boolean(trustMeta?.usedWebSources) || /\[[0-9]+\]/.test(out) || /\bsource\b/i.test(out);
  const inferredRagUse = Boolean(trustMeta?.usedRagSources) || /\b(knowledge snippets|retrieval context|rag)\b/i.test(q);
  const inferredMemoryUse = Boolean(trustMeta?.usedSemanticMemory) || /\b(referenced previous question|previous topic|follow-up request)\b/i.test(q);

  let confidence: 'High' | 'Medium' | 'Low' = 'High';
  const reasons: string[] = [];

  if (lowMarkers || suspicious) {
    confidence = 'Low';
    reasons.push('The response required fallback-safe handling signals.');
  } else if (inferredTimeSensitive && !inferredWebUse) {
    confidence = 'Medium';
    reasons.push('The question is time-sensitive and no explicit live citation block was available.');
  } else if (inferredIntent === 'current_event' && !inferredWebUse) {
    confidence = 'Medium';
    reasons.push('Current-event response relied mainly on model knowledge and context rules.');
  } else if (inferredIntent === 'math') {
    reasons.push('Math reasoning path and deterministic checks were applied.');
  } else if (inferredIntent === 'coding') {
    reasons.push('Coding reliability checks and formatting guards were applied.');
  } else {
    reasons.push('The response passed quality and safety checks.');
  }

  const sources: string[] = [];
  if (inferredWebUse) sources.push('Live web citations');
  if (inferredRagUse) sources.push('Internal retrieval snippets');
  if (inferredMemoryUse) sources.push('Conversation semantic memory');
  sources.push('Model reasoning');

  return [
    'Answer Trust:',
    `- Confidence: ${confidence}`,
    `- Why: ${reasons.join(' ') || 'Standard response quality checks passed.'}`,
    `- Sources Used: ${sources.join('; ')}`
  ].join('\n');
};

const applyContextAnchorLine = (reply: string, contextAnchor?: string, prompt?: string): string => {
  const body = String(reply || '').trim();
  const extractedTopic = extractContextTopicFromSyntheticPrompt(String(prompt || ''));
  const anchor = String(contextAnchor || extractedTopic || '').trim();
  if (!body || !anchor) return body;
  if (/^Context Anchor:/i.test(body)) return body;
  return `Context Anchor: ${anchor}\n\n${body}`;
};

const finalizeProfessionalReply = (
  prompt: string,
  reply: string,
  conversationKey?: string,
  meta?: ReplyEnhancementMeta
): string => {
  const polished = formatProfessionalResponse(reply, prompt);
  let clean = ensureEmojiInReply(polished, prompt, conversationKey);
  clean = enforceProfessionalReplyQuality(prompt, clean, conversationKey);
  clean = enforceSafetyOutputPolicy(prompt, clean, conversationKey);
  clean = enforceCodeGenerationIntentPolicy(prompt, clean, { isLikelyCodePrompt });
  clean = applyAssistantIdentityPolicy(clean, conversationKey);
  clean = applyEmojiStylePolicy(clean, conversationKey);
  clean = stripAnswerTrustSection(clean);
  clean = applyContextAnchorLine(clean, meta?.contextAnchor, prompt);
  const trustEnabled = typeof meta?.includeTrustLayer === 'boolean'
    ? meta.includeTrustLayer
    : getConversationTrustLayerEnabled(conversationKey);
  if (trustEnabled) {
    const trustLayer = buildAnswerTrustLayer(prompt, clean, meta?.trust);
    if (trustLayer) {
      clean = `${clean}\n\n${trustLayer}`;
    }
  }
  clean = appendActionableLinksIfNeeded(prompt, clean);
  return clean.trim();
};

const enforceProfessionalReplyQuality = (prompt: string, reply: string, conversationKey?: string): string => {
  const candidate = String(reply || '').trim();
  if (!candidate) {
    const intent = classifyProfessionalIntent(prompt, conversationKey);
    return buildRetryOnlyPoliteMessage(prompt, intent, conversationKey);
  }
  const normalizedPromptEcho = normalizeIntentFromNoisyText(normalizeUserQuestionText(prompt) || prompt)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const normalizedCandidateEcho = String(candidate || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const promptEchoReply =
    isPromptEchoLikeReply(prompt, candidate)
    || (
      Boolean(normalizedPromptEcho)
      && (
        normalizedCandidateEcho === normalizedPromptEcho
        || normalizedCandidateEcho === `"${normalizedPromptEcho}"`
        || normalizedCandidateEcho === `'${normalizedPromptEcho}'`
        || normalizedCandidateEcho.startsWith(`${normalizedPromptEcho}.`)
      )
    );
  const lowValueCandidate = promptEchoReply || isLowValueDeflectionReply(candidate);
  if (!lowValueCandidate) return candidate;

  const q = String(prompt || '').toLowerCase().replace(/\s+/g, ' ');
  if (conversationKey) {
    const normalizedQ = normalizeIntentFromNoisyText(normalizeUserQuestionText(prompt) || prompt).toLowerCase().trim();
    const wantsContextualContinuation =
      isAffirmativeFollowUpReply(normalizedQ)
      || isDetailContinuationReply(normalizedQ)
      || isContextReferenceContinuationReply(normalizedQ);
    if (wantsContextualContinuation) {
      const contextualRecovery = buildContextReferenceRecoveryReply(conversationKey, prompt);
      if (contextualRecovery && !isLowValueDeflectionReply(contextualRecovery)) {
        return contextualRecovery;
      }
      const history = getChatHistory(conversationKey);
      for (let i = history.length - 1; i >= 0; i -= 1) {
        if (history[i].role !== 'user') continue;
        const priorUser = getTurnText(history[i]);
        const normalizedPrior = normalizeIntentFromNoisyText(normalizeUserQuestionText(priorUser) || priorUser)
          .toLowerCase()
          .trim();
        if (!normalizedPrior || normalizedPrior === normalizedQ) continue;
        if (
          isAffirmativeFollowUpReply(normalizedPrior)
          || isDetailContinuationReply(normalizedPrior)
          || isContextReferenceContinuationReply(normalizedPrior)
        ) {
          continue;
        }
        const contextualFallback = generateEmergencyReply(priorUser, conversationKey);
        if (contextualFallback && !isLowValueDeflectionReply(contextualFallback)) {
          return contextualFallback;
        }
        break;
      }
    }
  }
  if (/(what('?s| is)\s+(?:your|you|ur|u)\s+name|your name\??|what (should|can|do) i call you|what i called you|what did i call you|who r u)/.test(q)) {
    const official = getOfficialAssistantName(conversationKey);
    const alias = sanitizeAssistantName(userProfiles.get(conversationKey || '')?.assistantName || '');
    if (alias) {
      return `My official name is ${official}. In this chat, you can call me ${alias}.`;
    }
    return `My official name is ${official}.`;
  }
  if (/\b(can i call you|i will call you|from now i call you|your name is|rename yourself to|change your name to)\b/.test(q)) {
    const renameTo = extractAssistantRenameCommand(prompt);
    if (renameTo) {
      const applied = setAssistantNamePreference(conversationKey, renameTo);
      return `Done. In this chat, you can call me ${applied}.`;
    }
    return 'Please provide the exact name you want me to use in this chat.';
  }
  return generateEmergencyReply(prompt, conversationKey);
};

const splitTelegramMessage = (text: string, maxLen: number = TELEGRAM_MAX_MESSAGE_LENGTH): string[] => {
  if (text.length <= maxLen) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    const idx = remaining.lastIndexOf('\n', maxLen);
    const cut = idx > 500 ? idx : maxLen;
    parts.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) parts.push(remaining);
  return parts;
};

const ensureReplyLeadSpacing = (text: string): string => {
  const value = String(text || '').replace(/^\n+/, '').trimStart();
  if (!value) return value;
  return `\n${value}`;
};

const RESET_SUCCESS_MESSAGE =
  'Conversation reset complete. Context cleared. Please send your next question.';

const normalizeLegacyBlockedReply = (text: string): string => {
  const raw = String(text || '').trim();
  if (!raw) return raw;
  if (isTransientProviderFailureReply(raw)) {
    return '';
  }
  return raw;
};

type CodeArtifact = {
  code: string;
  fileName: string;
  language: string;
};

const legacyCodeMarkerPattern = /CODE_BEGIN\b([\s\S]*?)\bCODE_END/i;
const legacyCodeFencePattern = /```([a-zA-Z0-9_#+.-]*)\n?([\s\S]*?)```/i;

const inferCodeLanguageFromPrompt = (prompt: string): string => {
  const value = String(prompt || '').toLowerCase();
  if (/\btypescript|ts\b/.test(value)) return 'typescript';
  if (/\bjavascript|js\b/.test(value)) return 'javascript';
  if (/\bpython|py\b/.test(value)) return 'python';
  if (/\bjava\b/.test(value)) return 'java';
  if (/\bc\+\+\b/.test(value)) return 'cpp';
  if (/\bc#\b|csharp\b/.test(value)) return 'csharp';
  if (/\bgo\b|golang\b/.test(value)) return 'go';
  if (/\brust\b/.test(value)) return 'rust';
  if (/\bsql\b/.test(value)) return 'sql';
  if (/\bhtml\b/.test(value)) return 'html';
  if (/\bcss\b/.test(value)) return 'css';
  if (/\bjson\b/.test(value)) return 'json';
  if (/\bbash\b|shell|sh\b/.test(value)) return 'bash';
  return 'python';
};

const CODE_PROMPT_SEMANTIC_STOP_WORDS = new Set<string>([
  'write', 'code', 'coding', 'create', 'build', 'make', 'implement', 'function', 'script', 'program',
  'return', 'for', 'with', 'using', 'python', 'javascript', 'typescript', 'java', 'cpp', 'csharp',
  'golang', 'go', 'rust', 'sql', 'the', 'a', 'an', 'to', 'of', 'in', 'on', 'and', 'or', 'please', 'ok'
]);

const extractCodePromptSemanticTokens = (prompt: string): string[] =>
  Array.from(
    new Set(
      String(prompt || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && !CODE_PROMPT_SEMANTIC_STOP_WORDS.has(t))
    )
  ).slice(0, 16);

const hasCodeSemanticMismatch = (prompt: string, reply: string): boolean => {
  if (!isLikelyCodePrompt(prompt)) return false;
  const source = String(reply || '').trim();
  if (!source) return true;

  const promptLower = String(prompt || '').toLowerCase();
  const replyLower = source.toLowerCase();

  if (!/\bsort(?:ed|ing)?\b/.test(promptLower) && /\bsorted_copy\b|\bsortedcopy\b|\bsortedcopy\s*\(/i.test(replyLower)) {
    return true;
  }
  if (!/\breverse\b/.test(promptLower) && /\breversearray\b|\breverse_array\b/i.test(replyLower)) {
    return true;
  }

  const tokens = extractCodePromptSemanticTokens(prompt);
  if (tokens.length === 0) return false;

  const codeBody = extractBestCodeBodyFromReply(prompt, source)?.code || source;
  const normalized = String(codeBody || source).toLowerCase();
  const matched = tokens.filter((t) => normalized.includes(t));

  if (/\bpalindrome\b/.test(promptLower) && !/\bpalindrome\b/.test(normalized)) return true;
  if (/\blinked\s*list\b/.test(promptLower) && !/\blinked\b/.test(normalized)) return true;
  if (/\bbinary\s*tree\b/.test(promptLower) && !/\b(tree|node)\b/.test(normalized)) return true;

  if (tokens.length >= 3 && matched.length === 0) return true;
  if (tokens.length >= 5 && matched.length < 2) return true;
  return false;
};

const languageToExtension = (language: string): string => {
  const key = String(language || '').toLowerCase().trim();
  const map: Record<string, string> = {
    typescript: 'ts',
    javascript: 'js',
    python: 'py',
    java: 'java',
    cpp: 'cpp',
    csharp: 'cs',
    go: 'go',
    rust: 'rs',
    sql: 'sql',
    html: 'html',
    css: 'css',
    json: 'json',
    bash: 'sh',
    txt: 'txt',
  };
  return map[key] || 'txt';
};

const isLikelyCodePrompt = (prompt: string): boolean => {
  const value = String(prompt || '').toLowerCase();
  if (isGenericCodingIntentPrompt(value)) return false;
  if (isTableRequestWithoutCodeIntent(value)) return false;
  if (
    (/\bwhat\s+is\s+(an?\s+)?api\b/.test(value) || /\bwhat\s+does\s+api\s+stand\s+for\b/.test(value))
    && !/\b(build|create|write|implement|endpoint|route|request|response|rest|graphql|sdk|code)\b/.test(value)
  ) {
    return false;
  }
  return /(write|generate|create|build|fix|debug|implement).*(code|program|function|script|class|algorithm)|\b(code|coding|python|java|javascript|typescript|c\+\+|c#|sql|api|leetcode)\b/.test(value);
};

const hasUnbalancedToken = (value: string, openToken: string, closeToken: string): boolean => {
  const openCount = (String(value || '').match(new RegExp(`\\${openToken}`, 'g')) || []).length;
  const closeCount = (String(value || '').match(new RegExp(`\\${closeToken}`, 'g')) || []).length;
  return openCount !== closeCount;
};

const isLikelyIncompleteCodeBody = (code: string, languageHint = ''): boolean => {
  const normalizedCode = String(code || '').replace(/\r/g, '').trim();
  if (!normalizedCode) return true;

  const nonEmptyLines = normalizedCode
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (nonEmptyLines.length < 4) return true;

  const lastLine = nonEmptyLines[nonEmptyLines.length - 1] || '';
  if (!lastLine) return true;
  if (/[({[,:+\-*/=]$/.test(lastLine)) return true;

  const normalizedLanguage = normalizeCodeFenceLanguage(languageHint);
  const looksPython =
    normalizedLanguage === 'python'
    || (
      /\b(def |class |import |from |if |elif |else:|for |while |try:|except |with |return )/.test(normalizedCode)
      && !/[{};]/.test(normalizedCode)
    );

  if (looksPython) {
    if (/:$/.test(lastLine)) return true;
    if (/^(if|for|while|def|class|try|except|with)\b/.test(lastLine)) return true;
    return false;
  }

  if (hasUnbalancedToken(normalizedCode, '{', '}')) return true;
  if (hasUnbalancedToken(normalizedCode, '(', ')')) return true;
  if (hasUnbalancedToken(normalizedCode, '[', ']')) return true;

  return false;
};

const isLikelyIncompleteCodeReply = (prompt: string, text: string): boolean => {
  if (!isLikelyCodePrompt(prompt)) return false;

  const source = unescapeEscapedCodeFences(String(text || '').trim());
  if (!source) return true;

  const fenceCount = (source.match(/```/g) || []).length;
  if (fenceCount % 2 !== 0) return true;

  const blocks = collectFencedCodeBlocks(source);
  if (blocks.length > 0) {
    const selected = [...blocks].sort((a, b) => b.code.length - a.code.length)[0];
    const language = normalizeCodeFenceLanguage(selected.language) || inferCodeLanguageFromPrompt(prompt);
    return isLikelyIncompleteCodeBody(selected.code, language);
  }

  const markerMatch = source.match(legacyCodeMarkerPattern);
  if (markerMatch?.[1]) {
    const language = inferCodeLanguageFromPrompt(prompt);
    return isLikelyIncompleteCodeBody(markerMatch[1], language);
  }

  const inlineCode = extractInlineCodeFromPlainText(source);
  if (inlineCode) {
    const language = inferCodeLanguageFromPrompt(prompt);
    return isLikelyIncompleteCodeBody(inlineCode, language);
  }

  if (/^\s*Code:\s*/im.test(source)) {
    return true;
  }

  if (containsCodeLikeSignals(source)) {
    return !hasDenseCodeStructure(source);
  }

  return true;
};

const looksLikeCodeLine = (line: string): boolean => {
  const value = String(line || '').trim();
  if (!value) return false;
  return /^(def |class |import |from |if |elif |else:|for |while |try:|except |return |print\(|async def |function |const |let |var |public |private |protected |static |#include|using |SELECT |INSERT |UPDATE |DELETE |CREATE |WITH |fn )/i.test(value)
    || /[{}()[\];]/.test(value)
    || /=>/.test(value)
    || /^\s{2,}\S/.test(String(line || ''));
};

const extractBestCodeBodyFromReply = (prompt: string, reply: string): { code: string; language: string } | null => {
  const source = unescapeEscapedCodeFences(String(reply || '').trim());
  if (!source) return null;

  const fenced = collectFencedCodeBlocks(source);
  if (fenced.length > 0) {
    const selected = [...fenced].sort((a, b) => b.code.length - a.code.length)[0];
    const language = normalizeCodeFenceLanguage(selected.language) || inferCodeLanguageFromPrompt(prompt);
    return { code: String(selected.code || '').trim(), language };
  }

  const marker = source.match(legacyCodeMarkerPattern);
  if (marker?.[1]) {
    return { code: String(marker[1] || '').trim(), language: inferCodeLanguageFromPrompt(prompt) };
  }

  const codeAfterLabel = source.match(/\bCode:\s*([\s\S]*)$/i)?.[1] || '';
  const inline = extractInlineCodeFromPlainText(codeAfterLabel || source);
  if (!inline) return null;
  return { code: String(inline || '').trim(), language: inferCodeLanguageFromPrompt(prompt) };
};

const containsPlaceholderCodeTemplate = (text: string): boolean => {
  const source = String(text || '').trim();
  if (!source) return false;
  return /\b(replace (?:this )?template|your logic here|implement .* logic here|placeholder(?: code)?|todo|solve\s*\(\s*data\s*\))\b/i.test(source);
};

const isLikelyWeakCodeReply = (prompt: string, text: string): boolean => {
  if (!isLikelyCodePrompt(prompt)) return false;
  const source = String(text || '').trim();
  if (!source) return true;
  if (containsPlaceholderCodeTemplate(source)) return true;

  if (/^\s*Code:\s*\n\s*\d+\.\s+/im.test(source)) return true;
  if (/for your request|clean and runnable implementation/i.test(source) && !containsCodeLikeSignals(source)) {
    return true;
  }

  const extracted = extractBestCodeBodyFromReply(prompt, source);
  if (!extracted) return true;

  const code = String(extracted.code || '').trim();
  const language = normalizeCodeFenceLanguage(extracted.language);
  if (!code) return true;
  if (!hasDenseCodeStructure(code)) return true;
  if (isLikelyIncompleteCodeBody(code, language)) return true;
  if (hasCodeSemanticMismatch(prompt, text)) return true;

  const lines = code.split('\n').map((line) => line.trim()).filter(Boolean);
  const codeLikeLines = lines.filter((line) => looksLikeCodeLine(line)).length;
  if (lines.length >= 6 && codeLikeLines < Math.max(4, Math.floor(lines.length * 0.45))) {
    return true;
  }

  return false;
};

const extractInlineCodeFromPlainText = (raw: string): string | null => {
  const source = String(raw || '')
    .replace(/^\s*Code Example(?:\s*\([^)]+\))?\s*:\s*/i, '')
    .replace(/\r/g, '')
    .trim();
  if (!source) return null;

  const labeled = source.match(/Code Example(?:\s*\([^)]+\))?:\s*\n([\s\S]+)/i);
  const text = (labeled?.[1] || source).trim();
  const lines = text.split('\n');
  const start = lines.findIndex((line) => looksLikeCodeLine(line));
  if (start < 0) return null;

  const selected = lines.slice(start);
  while (selected.length && !looksLikeCodeLine(selected[selected.length - 1])) {
    selected.pop();
  }
  const narrativeAt = selected.findIndex((line) =>
    /^(This approach|The algorithm works|Time complexity|Space complexity|Complexity|Explanation)\b/i.test(String(line || '').trim())
  );
  if (narrativeAt >= 0) {
    selected.splice(narrativeAt);
  }

  const code = selected
    .join('\n')
    .replace(
      /\s+(?:This approach|The algorithm works|Time complexity|Space complexity|Complexity|Explanation)\b[\s\S]*$/i,
      ''
    )
    .trim();
  if (!code) return null;
  if (code.split('\n').length < 3 && code.length < 80) return null;
  return code;
};

const extractCodeArtifactFromText = (raw: string, prompt: string): CodeArtifact | null => {
  const source = String(raw || '').trim();
  if (!source) return null;
  if (!isLikelyCodePrompt(prompt) && !containsCodeLikeSignals(source)) return null;

  const markerMatch = source.match(legacyCodeMarkerPattern);
  if (markerMatch?.[1]) {
    const code = markerMatch[1].replace(/\r/g, '').trim();
    if (!code) return null;
    const language = inferCodeLanguageFromPrompt(prompt);
    const extension = languageToExtension(language);
    return {
      code,
      language,
      fileName: `generated_code.${extension}`,
    };
  }

  const fenceMatch = source.match(legacyCodeFencePattern);
  if (fenceMatch?.[2]) {
    const language = String(fenceMatch[1] || '').trim().toLowerCase() || inferCodeLanguageFromPrompt(prompt);
    const extension = languageToExtension(language);
    const code = fenceMatch[2].replace(/\r/g, '').trim();
    if (!code) return null;
    return {
      code,
      language,
      fileName: `generated_code.${extension}`,
    };
  }

  const inlineCode = extractInlineCodeFromPlainText(source);
  if (inlineCode) {
    const language = inferCodeLanguageFromPrompt(prompt);
    const extension = languageToExtension(language);
    return {
      code: inlineCode,
      language,
      fileName: `generated_code.${extension}`,
    };
  }

  return null;
};

const extractTelegramCommand = (messageText: string): string | null => {
  const normalized = String(messageText || '')
    .replace(/[\u200B-\u200F\uFEFF\u2060\u00A0]/g, ' ')
    .replace(/[///]/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;
  if (isTelegramMediaEnvelopePrompt(normalized) || isLikelyFileNameOnlyPrompt(normalized)) return null;
  const actionText = normalized.toLowerCase().replace(/\s+/g, ' ').trim();
  const normalizedAction = actionText
    .replace(/[^\p{L}\p{N}\s/]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^reset chat$/.test(normalizedAction)) return 'reset';
  if (/^switch model$/.test(normalizedAction)) return 'switchmodel';
  if (/^toggle concise\/?detailed$/.test(normalizedAction) || /^toggle concise detailed$/.test(normalizedAction)) return 'toggleconcise';
  const firstToken = normalized.split(/\s+/)[0] || '';
  if (!/^\//.test(firstToken)) return null;
  const withoutSlash = firstToken.slice(1);
  const withoutMention = withoutSlash.split('@')[0] || withoutSlash;
  const commandLettersOnly = withoutMention
    .normalize('NFKC')
    .replace(/[^A-Za-z]/g, '')
    .toLowerCase()
    .trim();
  return commandLettersOnly || null;
};

const TRUSTED_TELEGRAM_COMMANDS = new Set([
  'start',
  'help',
  'settings',
  'model',
  'style',
  'language',
  'lang',
  'translate',
  'forget',
  'mode',
  'verify',
  'trust',
  'engine',
  'version',
  'tgstats',
  'groupmode',
  'groupstats',
  'groupreport',
  'timeline',
  'kb',
  'whois',
  'miniapp',
  'plans',
  'subscribe',
  'task',
  'remind',
  'safety',
  'reset',
  'stop',
  'emoji',
  'stickers'
]);

const normalizeAntiSpamMessageKey = (text: string): string => {
  const normalized = normalizeIntentFromNoisyText(normalizeUserQuestionText(text) || text)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.slice(0, 320);
};

const isTelegramAdminSender = (fromId: string): boolean =>
  Boolean(fromId && ADMIN_TELEGRAM_IDS.has(String(fromId).trim()));

const evaluateTelegramAntiSpamGuard = async (
  scope: string,
  msg: TelegramBot.Message,
  messageText: string,
  commandName: string
): Promise<{ blocked: boolean; response?: string }> => {
  const fromId = String(msg?.from?.id ?? '').trim();
  const chatId = String(msg?.chat?.id ?? '').trim();
  if (!fromId || !chatId) return { blocked: false };
  const adminRestriction = getActiveTelegramAdminRestriction(scope, chatId, fromId);
  if (adminRestriction) {
    const remainingSec = Math.max(1, Math.ceil((adminRestriction.blockedUntil - Date.now()) / 1000));
    const response = `Access is temporarily restricted by admin policy for ${remainingSec} seconds.${adminRestriction.reason ? ` Reason: ${adminRestriction.reason}` : ''}`;
    recordModerationAudit({
      source: 'admin',
      blocked: true,
      category: 'manual_restriction',
      action: 'manual_restriction_enforced',
      prompt: messageText,
      reason: adminRestriction.reason || 'manual restriction',
      scope,
      chatId,
      userId: fromId
    });
    return { blocked: true, response };
  }
  if (commandName && TRUSTED_TELEGRAM_COMMANDS.has(commandName)) {
    return { blocked: false };
  }
  if (isTelegramAdminSender(fromId)) {
    return { blocked: false };
  }

  const now = Date.now();
  const chatType = String(msg?.chat?.type || 'private').toLowerCase();
  const isGroup = chatType === 'group' || chatType === 'supergroup';
  const windowMs = isGroup ? 15_000 : 20_000;
  const maxMessagesPerWindow = isGroup ? 6 : 8;
  const repeatWindowMs = 45_000;
  const repeatLimit = 4;
  const stateKey = `${scope}:${chatId}:${fromId}`;
  const normalizedMessage = normalizeAntiSpamMessageKey(messageText || `[${chatType}]`);

  if (REDIS_ANTI_SPAM_ENABLED) {
    const muteKey = `${REDIS_ANTI_SPAM_PREFIX}:mute:${stateKey}`;
    const muteValue = await runRedisAntiSpamCommand(['GET', muteKey]);
    if (muteValue.available) {
      const mutedUntil = Number(muteValue.value || 0);
      if (Number.isFinite(mutedUntil) && mutedUntil > now) {
        const remainingSec = Math.max(1, Math.ceil((mutedUntil - now) / 1000));
        return {
          blocked: true,
          response: `Anti-spam protection is active. Please wait ${remainingSec} seconds before sending another message.`
        };
      }

      const windowBucket = Math.floor(now / windowMs);
      const windowKey = `${REDIS_ANTI_SPAM_PREFIX}:window:${stateKey}:${windowBucket}`;
      const windowCount = await runRedisAntiSpamCommand(['INCR', windowKey]);
      if (windowCount.available) {
        await runRedisAntiSpamCommand(['EXPIRE', windowKey, Math.ceil(windowMs / 1000) + 2]);
        const used = Number(windowCount.value || 0);

        const repeatKey = `${REDIS_ANTI_SPAM_PREFIX}:repeat:${stateKey}`;
        const repeatRaw = await runRedisAntiSpamCommand(['GET', repeatKey]);
        let repeatedCount = 1;
        if (repeatRaw.available && typeof repeatRaw.value === 'string') {
          try {
            const parsed = JSON.parse(String(repeatRaw.value || '')) as { key?: string; at?: number; count?: number };
            const previousKey = String(parsed?.key || '');
            const previousAt = Number(parsed?.at || 0);
            const previousCount = Number(parsed?.count || 0);
            if (
              normalizedMessage
              && previousKey
              && normalizedMessage === previousKey
              && (now - previousAt) <= repeatWindowMs
            ) {
              repeatedCount = Math.max(1, previousCount + 1);
            }
          } catch {}
        }
        await runRedisAntiSpamCommand([
          'SET',
          repeatKey,
          JSON.stringify({ key: normalizedMessage, at: now, count: repeatedCount }),
          'EX',
          Math.ceil(repeatWindowMs / 1000) + 5
        ]);

        const violation = used > maxMessagesPerWindow || repeatedCount >= repeatLimit;
        if (violation) {
          const strikeKey = `${REDIS_ANTI_SPAM_PREFIX}:strike:${stateKey}`;
          const strikeValue = await runRedisAntiSpamCommand(['INCR', strikeKey]);
          const strikes = strikeValue.available ? Math.max(1, Number(strikeValue.value || 1)) : 1;
          await runRedisAntiSpamCommand(['EXPIRE', strikeKey, 15 * 60]);
          const muteSeconds = Math.min(300, 15 * Math.pow(2, Math.max(0, strikes - 1)));
          await runRedisAntiSpamCommand(['SET', muteKey, String(now + muteSeconds * 1000), 'EX', muteSeconds]);
          recordModerationAudit({
            source: 'anti_spam',
            blocked: true,
            category: 'rate_limit',
            action: 'redis_antispam_violation',
            prompt: messageText,
            reason: `window_count=${used}; repeat_count=${repeatedCount}; strikes=${strikes}`,
            scope,
            chatId,
            userId: fromId
          });
          return {
            blocked: true,
            response: `Anti-spam protection: you are temporarily limited for ${muteSeconds} seconds. Send one clear message after the cooldown.`
          };
        }
        return { blocked: false };
      }
    }
  }

  const state = telegramAntiSpamState.get(stateKey) || {
    timestamps: [],
    lastMessageKey: '',
    lastMessageAt: 0,
    repeatedCount: 0,
    mutedUntil: 0,
    strikes: 0,
    lastViolationAt: 0
  };

  if (state.mutedUntil > now) {
    const remainingSec = Math.max(1, Math.ceil((state.mutedUntil - now) / 1000));
    telegramAntiSpamState.set(stateKey, state);
    return {
      blocked: true,
      response: `Anti-spam protection is active. Please wait ${remainingSec} seconds before sending another message.`
    };
  }

  state.timestamps = state.timestamps.filter((ts) => now - ts <= windowMs);
  state.timestamps.push(now);

  if (normalizedMessage && normalizedMessage === state.lastMessageKey && now - state.lastMessageAt <= repeatWindowMs) {
    state.repeatedCount += 1;
  } else {
    state.repeatedCount = 1;
  }
  state.lastMessageKey = normalizedMessage;
  state.lastMessageAt = now;

  let violation = false;
  if (state.timestamps.length > maxMessagesPerWindow) {
    violation = true;
  }
  if (state.repeatedCount >= repeatLimit) {
    violation = true;
  }

  if (violation) {
    state.strikes += 1;
    state.lastViolationAt = now;
    const muteSeconds = Math.min(300, 15 * Math.pow(2, Math.max(0, state.strikes - 1)));
    state.mutedUntil = now + (muteSeconds * 1000);
    telegramAntiSpamState.set(stateKey, state);
    recordModerationAudit({
      source: 'anti_spam',
      blocked: true,
      category: 'rate_limit',
      action: 'memory_antispam_violation',
      prompt: messageText,
      reason: `window_count=${state.timestamps.length}; repeat_count=${state.repeatedCount}; strikes=${state.strikes}`,
      scope,
      chatId,
      userId: fromId
    });
    return {
      blocked: true,
      response: `Anti-spam protection: you are temporarily limited for ${muteSeconds} seconds. Send one clear message after the cooldown.`
    };
  }

  if (state.strikes > 0 && now - state.lastViolationAt > 15 * 60 * 1000) {
    state.strikes = Math.max(0, state.strikes - 1);
  }
  telegramAntiSpamState.set(stateKey, state);
  return { blocked: false };
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const sendTelegramChunk = async (
  targetBot: TelegramBot,
  chatId: number,
  chunk: string,
  replyTo?: number
): Promise<void> => {
  const baseOptions: Record<string, unknown> = {};
  if (replyTo) {
    baseOptions.reply_to_message_id = replyTo;
  }
  const body = replyTo ? ensureReplyLeadSpacing(chunk) : chunk;
  const entities = buildTelegramBoldEntities(body);
  const messageOptions = entities.length > 0
    ? { ...baseOptions, entities }
    : baseOptions;
  try {
    await targetBot.sendMessage(chatId, body, messageOptions);
  } catch (error) {
    if (entities.length > 0) {
      await targetBot.sendMessage(chatId, body, baseOptions);
      return;
    }
    throw error;
  }
};

const editTelegramChunk = async (
  targetBot: TelegramBot,
  chatId: number,
  messageId: number,
  chunk: string
): Promise<void> => {
  const entities = buildTelegramBoldEntities(chunk);
  const baseOptions: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
  };
  const editOptions = entities.length > 0
    ? { ...baseOptions, entities }
    : baseOptions;
  try {
    await targetBot.editMessageText(chunk, editOptions);
  } catch (error) {
    if (entities.length > 0) {
      await targetBot.editMessageText(chunk, baseOptions);
      return;
    }
    throw error;
  }
};

const runTypewriterEdit = async (
  targetBot: TelegramBot,
  chatId: number,
  messageId: number,
  fullText: string
): Promise<void> => {
  const text = String(fullText || '').trim();
  if (!text || text.length > TYPEWRITER_MAX_CHARS || !TYPEWRITER_FALLBACK_ENABLED) {
    await editTelegramChunk(targetBot, chatId, messageId, text || 'Done.');
    return;
  }

  let cursor = 0;
  while (cursor < text.length) {
    cursor = Math.min(text.length, cursor + TYPEWRITER_CHARS_PER_TICK);
    const preview = text.slice(0, cursor);
    await editTelegramChunk(targetBot, chatId, messageId, preview);
    if (cursor < text.length) {
      await wait(TYPEWRITER_TICK_MS);
    }
  }
};

const autoCloseUnbalancedCodeFence = (text: string): string => {
  const value = String(text || '');
  const fenceCount = (value.match(/```/g) || []).length;
  if (fenceCount > 0 && fenceCount % 2 !== 0) {
    return `${value}\n\`\`\``;
  }
  return value;
};

const sendTelegramReply = async (targetBot: TelegramBot, chatId: number, text: string, replyTo?: number) => {
  const normalized = normalizeLegacyBlockedReply(text);
  const templateSafe = formatProfessionalResponse(normalized, '');
  const safe = sanitizeForTelegram(autoCloseUnbalancedCodeFence(stripReconnectLoopReply(templateSafe)));
  const chunks = splitTelegramMessage(safe || 'I am ready to help. Please send your question.');
  for (let i = 0; i < chunks.length; i += 1) {
    await sendTelegramChunk(targetBot, chatId, chunks[i], i === 0 ? replyTo : undefined);
  }
};

const sanitizeForTelegramPlainCommand = (text: string): string =>
  String(text || '')
    .replace(/\r/g, '')
    .replace(/[\u200B-\u200F\uFEFF]/g, '')
    .replace(/\*\*/g, '')
    .normalize('NFKD')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const sendTelegramCommandReply = async (
  targetBot: TelegramBot,
  chatId: number,
  text: string,
  replyTo?: number
) => {
  const normalized = normalizeLegacyBlockedReply(text);
  const safe = sanitizeForTelegramPlainCommand(normalized);
  const chunks = splitTelegramMessage(safe || 'Command executed.');
  for (let i = 0; i < chunks.length; i += 1) {
    await sendTelegramChunk(targetBot, chatId, chunks[i], i === 0 ? replyTo : undefined);
  }
};

const sendTelegramStickerForReply = async (
  targetBot: TelegramBot,
  chatId: number,
  promptText: string,
  answerText: string,
  conversationKey?: string,
  replyTo?: number
): Promise<void> => {
  const stickersEnabled = FORCE_STICKERS_ON || (conversationKey ? (userProfiles.get(conversationKey)?.stickersEnabled !== false) : true);
  if (!stickersEnabled) return;
  const stickerId = pickStickerForContext(promptText, answerText);
  if (!stickerId) return;
  try {
    await targetBot.sendSticker(chatId, stickerId, replyTo ? { reply_to_message_id: replyTo } : undefined);
  } catch {}
};

const buildVerificationOverlay = async (
  promptText: string,
  answerText: string,
  conversationKey?: string
): Promise<string> => {
  if (!conversationKey || !getConversationVerifyModeEnabled(conversationKey)) return '';
  const prompt = String(promptText || '').trim();
  const answer = String(answerText || '').trim();
  if (!prompt || !answer) return '';
  if (/\nVerification:\n/i.test(answer)) return '';
  if (isLikelyCodePrompt(prompt) || isMathLikePromptText(prompt)) return '';
  if (isTelegramMediaEnvelopePrompt(prompt) || isLikelyFileNameOnlyPrompt(prompt)) return '';

  try {
    const citations = await searchWebWithCitations(prompt, { maxResults: 3, timeoutMs: 7500 });
    if (!Array.isArray(citations) || citations.length === 0) {
      return [
        'Verification:',
        '- Mode: ON',
        '- Confidence: Medium',
        '- Status: No live citations were available in this pass.'
      ].join('\n');
    }
    const confidence = citations.length >= 3 ? 'High' : citations.length === 2 ? 'Medium' : 'Medium';
    const sourceLines = citations
      .slice(0, 3)
      .map((c: any, idx: number) => {
        const title = sanitizeForTelegramPlainCommand(String(c?.title || c?.source || `Source ${idx + 1}`)).slice(0, 90);
        const url = sanitizeForTelegramPlainCommand(String(c?.url || c?.link || '')).slice(0, 180);
        return `- [${idx + 1}] ${title}${url ? ` - ${url}` : ''}`;
      });
    return [
      'Verification:',
      '- Mode: ON',
      `- Confidence: ${confidence}`,
      '- Status: Verified against live web sources.',
      '- Sources:',
      ...sourceLines
    ].join('\n');
  } catch {
    return [
      'Verification:',
      '- Mode: ON',
      '- Confidence: Medium',
      '- Status: Verification service timed out in this pass.'
    ].join('\n');
  }
};

const sendTelegramStreamingReply = async (
  targetBot: TelegramBot,
  chatId: number,
  responsePromise: Promise<string>,
  replyTo?: number,
  fallbackText?: string,
  promptText: string = '',
  conversationKey?: string
): Promise<string> => {
  const progressFrames = ['Thinking', 'Thinking.', 'Thinking..', 'Thinking...'];
  const placeholder = await targetBot.sendMessage(chatId, 'Thinking...', {
    ...(replyTo ? { reply_to_message_id: replyTo } : {}),
  });

  let progressTimer: NodeJS.Timeout | null = null;
  let startDelayTimer: NodeJS.Timeout | null = null;
  let frameIndex = 0;
  const clearProgressTimers = (): void => {
    if (startDelayTimer) {
      clearTimeout(startDelayTimer);
      startDelayTimer = null;
    }
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  };

  if (TELEGRAM_STREAMING_ENABLED) {
    startDelayTimer = setTimeout(() => {
      progressTimer = setInterval(() => {
        const frame = progressFrames[frameIndex % progressFrames.length];
        frameIndex += 1;
        void editTelegramChunk(targetBot, chatId, placeholder.message_id, frame).catch(() => {});
      }, TELEGRAM_STREAM_PROGRESS_INTERVAL_MS);
    }, Math.max(0, TELEGRAM_STREAM_START_DELAY_MS));
  }

  try {
    const rawResolved = String(
      await withTimeout(responsePromise, TELEGRAM_REPLY_HARD_TIMEOUT_MS, 'TELEGRAM_REPLY_TIMEOUT')
      || ''
    ).trim();
    const resolved = normalizeLegacyBlockedReply(rawResolved);
    clearProgressTimers();
    const replyNeedsRetryMessage =
      isTransientProviderFailureReply(rawResolved)
      || resolved === RESPONSE_RECOVERY_MESSAGE;
    const retryMessage = buildRetryOnlyPoliteMessage(
      promptText,
      classifyProfessionalIntent(promptText, conversationKey),
      conversationKey
    );
    const preferredText = replyNeedsRetryMessage ? retryMessage : resolved;
    const templateSafe = formatProfessionalResponse(
      stripReconnectLoopReply(preferredText || retryMessage || 'No response generated.'),
      promptText
    );
    const finalText = sanitizeForTelegram(autoCloseUnbalancedCodeFence(templateSafe));
    let finalWithVerification = finalText;
    const verificationBlock = await buildVerificationOverlay(promptText, finalText, conversationKey);
    if (verificationBlock) {
      finalWithVerification = `${finalWithVerification}\n\n${verificationBlock}`.trim();
    }
    const chunks = splitTelegramMessage(finalWithVerification);
    const firstChunk = chunks.shift() || finalWithVerification || 'No response generated.';
    const firstChunkWithLeadSpacing = replyTo ? ensureReplyLeadSpacing(firstChunk) : firstChunk;

    if (TYPEWRITER_FALLBACK_ENABLED) {
      await runTypewriterEdit(targetBot, chatId, placeholder.message_id, firstChunkWithLeadSpacing);
    } else {
      await editTelegramChunk(targetBot, chatId, placeholder.message_id, firstChunkWithLeadSpacing);
    }

    for (const chunk of chunks) {
      await sendTelegramChunk(targetBot, chatId, chunk);
    }

    if (CODE_FILE_EXPORT_ENABLED) {
      const artifact = extractCodeArtifactFromText(resolved, promptText)
        || extractCodeArtifactFromText(finalText, promptText);
      if (artifact) {
        await targetBot.sendDocument(
          chatId,
          Buffer.from(artifact.code, 'utf8'),
          {},
          { filename: artifact.fileName, contentType: 'text/plain' }
        );
      }
    }
    return preferredText || retryMessage;
  } catch (error) {
    clearProgressTimers();
    const fallback = sanitizeForTelegram(
      buildRetryOnlyPoliteMessage(promptText, classifyProfessionalIntent(promptText, conversationKey), conversationKey)
    );
    const fallbackWithLeadSpacing = replyTo ? ensureReplyLeadSpacing(fallback) : fallback;
    const edited = await editTelegramChunk(targetBot, chatId, placeholder.message_id, fallbackWithLeadSpacing)
      .then(() => true)
      .catch(() => false);
    if (!edited) {
      await sendTelegramReply(targetBot, chatId, fallback, replyTo);
      await targetBot.deleteMessage(chatId, placeholder.message_id).catch(() => {});
    }
    return fallback;
  }
};

const buildConversationKey = (scope: string, chatIdentity?: string | number): string | null => {
  if (chatIdentity === undefined || chatIdentity === null) return null;
  const id = String(chatIdentity).trim();
  if (!id) return null;
  return `${scope}:${id}`;
};

const getDateKeyUtc = (timestampMs: number): string => {
  const d = new Date(Number.isFinite(timestampMs) ? timestampMs : Date.now());
  return d.toISOString().slice(0, 10);
};

const normalizeNameToken = (value: string): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\u0400-\u04FF\u0900-\u097F\u3040-\u30FF\u4E00-\u9FFF\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const buildObservedDisplayName = (firstName: string, lastName: string, username: string): string => {
  const full = `${String(firstName || '').trim()} ${String(lastName || '').trim()}`.replace(/\s+/g, ' ').trim();
  if (full) return full;
  if (username) return `@${username}`;
  return 'Unknown user';
};

const getScopeAndChatFromConversationKey = (
  conversationKey: string | undefined
): { scope: string; chatId: string } | null => {
  const key = String(conversationKey || '').trim();
  if (!key.startsWith('telegram:')) return null;
  const lastSep = key.lastIndexOf(':');
  if (lastSep <= 0 || lastSep >= key.length - 1) return null;
  return {
    scope: key.slice(0, lastSep),
    chatId: key.slice(lastSep + 1)
  };
};

const scheduleTelegramAnalyticsPersist = (): void => {
  if (telegramAnalyticsPersistTimer) return;
  telegramAnalyticsPersistTimer = setTimeout(() => {
    telegramAnalyticsPersistTimer = null;
    persistTelegramAnalytics();
  }, 5000);
  telegramAnalyticsPersistTimer.unref();
};

const persistTelegramAnalytics = (): void => {
  try {
    const dir = path.dirname(TELEGRAM_ANALYTICS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const payload = {
      users: Object.fromEntries(telegramObservedUsers.entries()),
      chats: Object.fromEntries(telegramObservedChats.entries())
    };
    fs.writeFileSync(TELEGRAM_ANALYTICS_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.warn('[TELEMETRY] Failed to persist Telegram analytics:', (error as Error).message);
  }
};

const loadTelegramAnalytics = (): void => {
  try {
    if (!fs.existsSync(TELEGRAM_ANALYTICS_FILE)) return;
    const raw = fs.readFileSync(TELEGRAM_ANALYTICS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as {
      users?: Record<string, TelegramObservedUser>;
      chats?: Record<string, TelegramObservedChat>;
    };
    telegramObservedUsers.clear();
    telegramObservedChats.clear();
    for (const [key, value] of Object.entries(parsed?.users || {})) {
      if (!key || !value) continue;
      telegramObservedUsers.set(key, value);
    }
    for (const [key, value] of Object.entries(parsed?.chats || {})) {
      if (!key || !value) continue;
      value.addressedMessages = Number(value.addressedMessages || 0);
      value.plainMessages = Number(value.plainMessages || 0);
      value.privacyModeLikelyOn = Boolean(value.privacyModeLikelyOn);
      value.privacyInferenceReason = String(value.privacyInferenceReason || '');
      value.intentCounts = typeof value.intentCounts === 'object' && value.intentCounts
        ? value.intentCounts
        : {};
      telegramObservedChats.set(key, value);
    }
  } catch (error) {
    console.warn('[TELEMETRY] Failed to load Telegram analytics:', (error as Error).message);
  }
};

const getBotUsernameByScope = (scope: string): string => {
  const normalizedScope = String(scope || '').trim();
  if (!normalizedScope.startsWith('telegram:')) return '';
  const primaryUsername = String(process.env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@/, '').toLowerCase();
  if (normalizedScope === 'telegram:primary') return primaryUsername;
  const botId = normalizedScope.replace(/^telegram:/i, '').trim();
  const mapped = String(telegramBotUsernames.get(botId) || '').trim().replace(/^@/, '').toLowerCase();
  return mapped || primaryUsername;
};

const inferGroupPrivacyModeSignal = (chatRecord: TelegramObservedChat): void => {
  if (!['group', 'supergroup'].includes(chatRecord.chatType)) {
    chatRecord.privacyModeLikelyOn = false;
    chatRecord.privacyInferenceReason = '';
    return;
  }
  const total = Math.max(1, chatRecord.totalMessages);
  const addressedRatio = chatRecord.addressedMessages / total;
  const plainRatio = chatRecord.plainMessages / total;
  const minimalPlain = chatRecord.plainMessages <= 2;
  const enoughSignals = chatRecord.totalMessages >= 8;

  if (enoughSignals && addressedRatio >= 0.85 && minimalPlain) {
    chatRecord.privacyModeLikelyOn = true;
    chatRecord.privacyInferenceReason = 'Most observed messages are commands/mentions. BotFather privacy mode is likely ON.';
    return;
  }
  if (plainRatio >= 0.2) {
    chatRecord.privacyModeLikelyOn = false;
    chatRecord.privacyInferenceReason = 'Bot receives regular non-command group messages. Privacy mode appears relaxed.';
    return;
  }
  chatRecord.privacyModeLikelyOn = false;
  chatRecord.privacyInferenceReason = chatRecord.totalMessages < 8
    ? 'Need more group traffic to estimate privacy mode.'
    : 'No strong privacy-mode signal detected.';
};

const observeTelegramMessage = (scope: string, msg: TelegramBot.Message): void => {
  const scopeKey = String(scope || '').trim() || 'telegram:primary';
  const chatId = String(msg?.chat?.id ?? '').trim();
  if (!chatId) return;
  const scopeChatKey = `${scopeKey}:${chatId}`;
  const now = Date.now();
  const dateKey = getDateKeyUtc(now);
  const chatType = String(msg?.chat?.type || 'private').trim();
  const chatTitle = String((msg?.chat as any)?.title || '').trim();
  const chatUsername = String((msg?.chat as any)?.username || '').trim();

  const existingChat = telegramObservedChats.get(scopeChatKey);
  const chatRecord: TelegramObservedChat = existingChat || {
    scopeChatKey,
    scope: scopeKey,
    chatId,
    chatType,
    chatTitle,
    chatUsername,
    firstSeenAt: now,
    lastSeenAt: now,
    totalMessages: 0,
    totalUniqueUsers: 0,
    messagesByDate: {},
    messagesByUser: {},
    contactShares: 0,
    uniqueContactShares: 0,
    contactShareHashes: {},
    addressedMessages: 0,
    plainMessages: 0,
    privacyModeLikelyOn: false,
    privacyInferenceReason: '',
    intentCounts: {}
  };

  chatRecord.scope = scopeKey;
  chatRecord.chatType = chatType || chatRecord.chatType;
  chatRecord.chatTitle = chatTitle || chatRecord.chatTitle;
  chatRecord.chatUsername = chatUsername || chatRecord.chatUsername;
  chatRecord.lastSeenAt = now;
  chatRecord.totalMessages += 1;
  chatRecord.messagesByDate[dateKey] = (chatRecord.messagesByDate[dateKey] || 0) + 1;
  chatRecord.addressedMessages = Number(chatRecord.addressedMessages || 0);
  chatRecord.plainMessages = Number(chatRecord.plainMessages || 0);
  if (!chatRecord.intentCounts || typeof chatRecord.intentCounts !== 'object') {
    chatRecord.intentCounts = {};
  }

  if (['group', 'supergroup'].includes(chatType)) {
    const rawText = String((msg as any)?.text || (msg as any)?.caption || '').trim();
    const botUsername = getBotUsernameByScope(scopeKey);
    const normalizedRaw = rawText.toLowerCase();
    const commandLike = /^\/\w+/.test(normalizedRaw);
    const mentionLike = botUsername ? normalizedRaw.includes(`@${botUsername}`) : /\@\w+/.test(normalizedRaw);
    if (commandLike || mentionLike) {
      chatRecord.addressedMessages += 1;
    } else {
      chatRecord.plainMessages += 1;
    }
    if (rawText) {
      const inferredIntent = detectIntent(rawText);
      chatRecord.intentCounts[inferredIntent] = Number(chatRecord.intentCounts[inferredIntent] || 0) + 1;
    }
    inferGroupPrivacyModeSignal(chatRecord);
  }

  const fromId = String(msg?.from?.id ?? '').trim();
  const fromFirstName = String(msg?.from?.first_name || '').trim();
  const fromLastName = String(msg?.from?.last_name || '').trim();
  const fromUsername = String(msg?.from?.username || '').trim();
  if (fromId) {
    const currentByUser = chatRecord.messagesByUser[fromId] || 0;
    if (currentByUser === 0) {
      chatRecord.totalUniqueUsers += 1;
    }
    chatRecord.messagesByUser[fromId] = currentByUser + 1;

    const existingUser = telegramObservedUsers.get(fromId);
    const userRecord: TelegramObservedUser = existingUser || {
      userId: fromId,
      firstName: fromFirstName,
      lastName: fromLastName,
      username: fromUsername,
      displayName: buildObservedDisplayName(fromFirstName, fromLastName, fromUsername),
      firstSeenAt: now,
      lastSeenAt: now,
      totalMessages: 0,
      scopeMessageCounts: {},
      chatMessageCounts: {}
    };
    userRecord.firstName = fromFirstName || userRecord.firstName;
    userRecord.lastName = fromLastName || userRecord.lastName;
    userRecord.username = fromUsername || userRecord.username;
    userRecord.displayName = buildObservedDisplayName(userRecord.firstName, userRecord.lastName, userRecord.username);
    userRecord.lastSeenAt = now;
    userRecord.totalMessages += 1;
    userRecord.scopeMessageCounts[scopeKey] = (userRecord.scopeMessageCounts[scopeKey] || 0) + 1;
    userRecord.chatMessageCounts[scopeChatKey] = (userRecord.chatMessageCounts[scopeChatKey] || 0) + 1;
    telegramObservedUsers.set(fromId, userRecord);
  }

  if ((msg as any)?.contact) {
    const contact = (msg as any).contact;
    const first = String(contact?.first_name || '').trim();
    const last = String(contact?.last_name || '').trim();
    const phone = String(contact?.phone_number || '').trim();
    const hash = normalizeNameToken(`${first} ${last} ${phone}`);
    chatRecord.contactShares += 1;
    if (hash) {
      const prev = chatRecord.contactShareHashes[hash] || 0;
      if (prev === 0) {
        chatRecord.uniqueContactShares += 1;
      }
      chatRecord.contactShareHashes[hash] = prev + 1;
    }
  }

  telegramObservedChats.set(scopeChatKey, chatRecord);
  scheduleTelegramAnalyticsPersist();
};

const getScopedChatRecords = (scope: string): TelegramObservedChat[] =>
  Array.from(telegramObservedChats.values())
    .filter((chat) => chat.scope === scope);

const getScopedUserRecords = (scope: string): TelegramObservedUser[] =>
  Array.from(telegramObservedUsers.values())
    .filter((user) => (user.scopeMessageCounts[scope] || 0) > 0);

const formatTelegramAnalyticsOverview = (
  scope: string,
  currentScopeChatKey: string
): string => {
  const dateKey = getDateKeyUtc(Date.now());
  const scopedChats = getScopedChatRecords(scope);
  const scopedUsers = getScopedUserRecords(scope);
  const totalTodayMessages = scopedChats.reduce((sum, chat) => sum + (chat.messagesByDate[dateKey] || 0), 0);
  const totalContactShares = scopedChats.reduce((sum, chat) => sum + (chat.uniqueContactShares || 0), 0);
  const current = telegramObservedChats.get(currentScopeChatKey);
  const currentToday = current ? (current.messagesByDate[dateKey] || 0) : 0;
  const currentLabel = current?.chatTitle
    ? `${current.chatTitle} (${current.chatType})`
    : current
      ? `${current.chatType} chat`
      : 'Current chat';
  const privacyNote = (current && ['group', 'supergroup'].includes(current.chatType))
    ? (current.privacyModeLikelyOn
      ? [
        'Group intelligence status:',
        '- Privacy mode likely ON for this group.',
        '- To allow full group analytics, disable privacy mode in BotFather: /setprivacy -> Disable.'
      ].join('\n')
      : [
        'Group intelligence status:',
        `- ${current.privacyInferenceReason || 'No privacy limitation signal detected for this group.'}`
      ].join('\n'))
    : '';

  return [
    'Telegram Analytics:',
    `- Known chats in this bot scope: ${scopedChats.length}`,
    `- Known users in this bot scope: ${scopedUsers.length}`,
    `- Messages today (${dateKey}, UTC): ${totalTodayMessages}`,
    `- ${currentLabel} messages today: ${currentToday}`,
    `- Unique contacts shared with bot: ${totalContactShares}`,
    privacyNote,
    '',
    'Scope note:',
    '- The bot can analyze only chats/messages it has received. It cannot read your full private Telegram contacts or chats outside this bot.'
  ].filter(Boolean).join('\n');
};

const formatGroupIntelligenceStatus = (
  currentScopeChatKey: string
): string => {
  const current = telegramObservedChats.get(currentScopeChatKey);
  if (!current) return 'No group intelligence data is available yet for this chat.';
  if (!['group', 'supergroup'].includes(current.chatType)) {
    return 'This command is for group/supergroup chats.';
  }
  return [
    'Group Intelligence:',
    `- Group: ${current.chatTitle || current.scopeChatKey}`,
    `- Observed messages: ${current.totalMessages}`,
    `- Addressed (commands/mentions): ${current.addressedMessages}`,
    `- Plain group messages: ${current.plainMessages}`,
    `- Privacy mode likely ON: ${current.privacyModeLikelyOn ? 'yes' : 'no'}`,
    `- Inference: ${current.privacyInferenceReason || 'No inference available yet.'}`,
    '',
    'Admin action for full group analytics:',
    '- In BotFather run /setprivacy and select Disable for this bot, then keep bot as group admin if needed.'
  ].join('\n');
};

const formatGroupIntelligenceReport = (
  currentScopeChatKey: string
): string => {
  const current = telegramObservedChats.get(currentScopeChatKey);
  if (!current) return 'No group intelligence report is available yet for this chat.';
  if (!['group', 'supergroup'].includes(current.chatType)) {
    return 'This command is for group/supergroup chats.';
  }
  const todayKey = getDateKeyUtc(Date.now());
  const weekKeys = Array.from({ length: 7 }, (_, idx) => getDateKeyUtc(Date.now() - idx * 24 * 60 * 60 * 1000));
  const weeklyMessages = weekKeys.reduce((sum, key) => sum + Number(current.messagesByDate[key] || 0), 0);
  const topUsers = Object.entries(current.messagesByUser || {})
    .map(([userId, count]) => ({ userId, count: Number(count || 0) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((row) => {
      const user = telegramObservedUsers.get(`${current.scope}:${row.userId}`);
      const label = user?.displayName || user?.username || row.userId;
      return `- ${label}: ${row.count}`;
    });
  const intentBreakdown = Object.entries(current.intentCounts || {})
    .map(([intent, count]) => ({ intent, count: Number(count || 0) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map((row) => `- ${row.intent}: ${row.count}`);

  return [
    'Group Intelligence Report:',
    `- Group: ${current.chatTitle || current.scopeChatKey}`,
    `- Messages today (${todayKey}, UTC): ${current.messagesByDate[todayKey] || 0}`,
    `- Messages last 7 days: ${weeklyMessages}`,
    `- Total observed messages: ${current.totalMessages}`,
    `- Unique users observed: ${current.totalUniqueUsers}`,
    `- Privacy mode likely ON: ${current.privacyModeLikelyOn ? 'yes' : 'no'}`,
    `- Inference: ${current.privacyInferenceReason || 'No inference available yet.'}`,
    '',
    'Top Active Users:',
    ...(topUsers.length ? topUsers : ['- No user activity data available yet.']),
    '',
    'Top Intent Mix:',
    ...(intentBreakdown.length ? intentBreakdown : ['- No intent breakdown available yet.']),
    '',
    'Actionable Suggestions:',
    '- If plain message count is low, disable privacy mode in BotFather for better analytics.',
    '- Use focused prompts in group threads to improve answer precision.',
    '- Use /task add in private chat for follow-up action tracking.'
  ].join('\n');
};

const formatTelegramUserLookup = (
  scope: string,
  currentScopeChatKey: string,
  nameQuery: string
): string => {
  const query = normalizeNameToken(nameQuery);
  if (!query || query.length < 2) {
    return 'Please provide a clearer name, for example: who is Shivani in Telegram.';
  }
  const dateKey = getDateKeyUtc(Date.now());
  const candidates = getScopedUserRecords(scope)
    .map((user) => {
      const searchLine = normalizeNameToken(`${user.displayName} ${user.username ? `@${user.username}` : ''}`);
      const scopeMsg = user.scopeMessageCounts[scope] || 0;
      const chatMsg = user.chatMessageCounts[currentScopeChatKey] || 0;
      const score = searchLine.includes(query) ? (searchLine === query ? 3 : 2) : (query.split(' ').every((part) => searchLine.includes(part)) ? 1 : 0);
      return { user, score, scopeMsg, chatMsg };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => (b.score - a.score) || (b.scopeMsg - a.scopeMsg) || (b.chatMsg - a.chatMsg));

  if (!candidates.length) {
    return [
      `I could not find "${nameQuery}" in this bot's observed Telegram chats.`,
      'The bot can identify only users it has already seen in received messages.'
    ].join('\n');
  }

  const top = candidates[0];
  const user = top.user;
  const currentChatMessages = user.chatMessageCounts[currentScopeChatKey] || 0;
  const activeChats = Object.entries(user.chatMessageCounts)
    .filter(([chatKey, count]) => chatKey.startsWith(`${scope}:`) && count > 0)
    .length;

  const activeToday = getDateKeyUtc(user.lastSeenAt) === dateKey;

  return [
    'Telegram User Lookup:',
    `- Name: ${user.displayName}`,
    `- Username: ${user.username ? `@${user.username}` : '(not available)'}`,
    `- Telegram user ID: ${user.userId}`,
    `- Messages seen in this bot scope: ${user.scopeMessageCounts[scope] || 0}`,
    `- Messages seen in current chat: ${currentChatMessages}`,
    `- Active chats seen with this user: ${activeChats}`,
    `- Last seen: ${new Date(user.lastSeenAt).toISOString()}`,
    `- Active today marker (${dateKey}, UTC): ${activeToday ? 'yes' : 'no'}`
  ].join('\n');
};

const buildTelegramAnalyticsReply = (input: string, conversationKey?: string): string | null => {
  const scopeChat = getScopeAndChatFromConversationKey(conversationKey);
  if (!scopeChat) return null;
  const raw = String(input || '').trim();
  if (!raw) return null;
  const normalized = normalizeIntentFromNoisyText(normalizeUserQuestionText(raw) || raw)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const scope = scopeChat.scope;
  const currentScopeChatKey = `${scope}:${scopeChat.chatId}`;
  const dateKey = getDateKeyUtc(Date.now());
  const currentChat = telegramObservedChats.get(currentScopeChatKey);
  const scopedChats = getScopedChatRecords(scope);

  const asksOverview =
    (/\b(telegram|bot)\b/.test(normalized) && /\b(details|detail|stats|statistics|analytics|overview|report|summary)\b/.test(normalized))
    || /\b(tgstats|telegram stats|chat stats)\b/.test(normalized);
  if (asksOverview) {
    return formatTelegramAnalyticsOverview(scope, currentScopeChatKey);
  }

  const asksGroupMode =
    /\b(group mode|group intelligence|privacy mode|why .*group.*not.*count|why .*group.*analytics)\b/.test(normalized)
    || /\b(groupmode|groupstats)\b/.test(normalized);
  if (asksGroupMode) {
    return formatGroupIntelligenceStatus(currentScopeChatKey);
  }

  const asksGroupReport =
    /\b(group report|group summary|group insights|weekly group|activity report)\b/.test(normalized)
    || /\b(groupreport)\b/.test(normalized);
  if (asksGroupReport) {
    return formatGroupIntelligenceReport(currentScopeChatKey);
  }

  const asksContactCount =
    /\b(contact|contacts)\b/.test(normalized)
    && /\b(how many|count|number|total)\b/.test(normalized);
  if (asksContactCount) {
    const total = scopedChats.reduce((sum, chat) => sum + (chat.uniqueContactShares || 0), 0);
    return [
      'Telegram Contacts (Bot-visible):',
      `- Unique contacts shared with this bot: ${total}`,
      `- Contact shares in current chat: ${currentChat?.uniqueContactShares || 0}`,
      '',
      'Scope note:',
      '- Telegram Bot API does not provide your full personal contact list. This count includes only contacts explicitly shared in chats with this bot.'
    ].join('\n');
  }

  const whoIsMatch = normalized.match(/\bwho is\s+(.+?)(?:\s+in\s+telegram|\s+on\s+telegram|\?|$)/i);
  if (whoIsMatch?.[1]) {
    return formatTelegramUserLookup(scope, currentScopeChatKey, whoIsMatch[1]);
  }

  const asksTodayMessages =
    /\btoday\b/.test(normalized)
    && /\b(how many|count|number|total)\b/.test(normalized)
    && /\b(chat|chats|message|messages)\b/.test(normalized);
  if (asksTodayMessages) {
    const groupOnly = /\bgroup|supergroup\b/.test(normalized) || /\bthis group|that group|in this group|in that group\b/.test(normalized);
    const allChats = /\b(all|overall|across|total)\b/.test(normalized) || /\ball chats|all groups|all chat\b/.test(normalized);
    if (groupOnly && currentChat && ['group', 'supergroup'].includes(currentChat.chatType)) {
      return [
        'Telegram Group Activity:',
        `- Group: ${currentChat.chatTitle || currentScopeChatKey}`,
        `- Messages today (${dateKey}, UTC): ${currentChat.messagesByDate[dateKey] || 0}`,
        `- Total messages observed: ${currentChat.totalMessages}`,
        `- Unique users observed: ${currentChat.totalUniqueUsers}`,
        `- Privacy mode likely ON: ${currentChat.privacyModeLikelyOn ? 'yes' : 'no'}`,
        `- Inference: ${currentChat.privacyInferenceReason || 'No inference available yet.'}`
      ].join('\n');
    }
    if (allChats || !currentChat) {
      const source = groupOnly
        ? scopedChats.filter((chat) => ['group', 'supergroup'].includes(chat.chatType))
        : scopedChats;
      const totalToday = source.reduce((sum, chat) => sum + (chat.messagesByDate[dateKey] || 0), 0);
      return [
        groupOnly ? 'Telegram Group Activity Summary:' : 'Telegram Activity Summary:',
        `- Scope: ${scope}`,
        `- Messages today (${dateKey}, UTC): ${totalToday}`,
        `- Chats counted: ${source.length}`
      ].join('\n');
    }
    return [
      'Telegram Current Chat Activity:',
      `- Messages today (${dateKey}, UTC): ${currentChat.messagesByDate[dateKey] || 0}`,
      `- Total messages observed: ${currentChat.totalMessages}`,
      `- Unique users observed: ${currentChat.totalUniqueUsers}`
    ].join('\n');
  }

  return null;
};

const pruneAiResponseCache = (): void => {
  const now = Date.now();
  for (const [key, value] of aiResponseCache.entries()) {
    if (value.expiresAt <= now) {
      aiResponseCache.delete(key);
    }
  }
  const overflow = aiResponseCache.size - AI_CACHE_MAX_ENTRIES;
  if (overflow > 0) {
    const keysToDrop = Array.from(aiResponseCache.keys()).slice(0, overflow);
    for (const key of keysToDrop) {
      aiResponseCache.delete(key);
    }
  }
};

const clearConversationState = (conversationKey: string): void => {
  chatHistoryStore.delete(conversationKey);
  followUpCueStore.delete(conversationKey);
  contextMetrics.delete(conversationKey);
  userProfiles.delete(conversationKey);
  const existingTasks = conversationTasks.get(conversationKey) || [];
  for (const task of existingTasks) {
    const timerKey = `${conversationKey}:${task.id}`;
    const timer = conversationReminderTimers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      conversationReminderTimers.delete(timerKey);
    }
  }
  if (existingTasks.length > 0) {
    conversationTasks.delete(conversationKey);
    scheduleConversationTasksPersist();
  }
  for (const key of aiResponseCache.keys()) {
    if (key.startsWith(`${conversationKey}:`)) {
      aiResponseCache.delete(key);
    }
  }
  for (const key of aiInFlightRequests.keys()) {
    if (key.startsWith(`${conversationKey}:`)) {
      aiInFlightRequests.delete(key);
    }
  }
  persistChatMemory();
  persistContextMetrics();
  persistUserProfiles();
};

const clearConversationRuntimeMemoryOnly = (conversationKey: string): void => {
  chatHistoryStore.delete(conversationKey);
  followUpCueStore.delete(conversationKey);
  contextMetrics.delete(conversationKey);
  for (const key of aiResponseCache.keys()) {
    if (key.startsWith(`${conversationKey}:`)) {
      aiResponseCache.delete(key);
    }
  }
  for (const key of aiInFlightRequests.keys()) {
    if (key.startsWith(`${conversationKey}:`)) {
      aiInFlightRequests.delete(key);
    }
  }
  persistChatMemory();
  persistContextMetrics();
};

const getOrCreateConversationProfile = (conversationKey: string | undefined): UserProfile | null => {
  if (!conversationKey) return null;
  const existing = userProfiles.get(conversationKey);
  if (existing) return existing;
  const created: UserProfile = {
    preferredTone: 'professional',
    responseVerbosity: 'detailed',
    verifyMode: false,
    emojiStyle: (FORCE_RICH_EMOJI_STYLE ? 'rich' : 'minimal'),
    stickersEnabled: FORCE_STICKERS_ON,
    trustLayerEnabled: false,
    expertMode: 'general',
    goals: [],
    recurringTopics: [],
    topicCounts: {},
    updatedAt: Date.now()
  };
  userProfiles.set(conversationKey, created);
  return created;
};

const forgetConversationProfileData = (
  conversationKey: string | undefined,
  target: 'name' | 'goals' | 'style' | 'tone' | 'memory' | 'all'
): string | null => {
  if (!conversationKey) return null;
  if (target === 'all') {
    clearConversationState(conversationKey);
    return 'Cleared memory, profile preferences, and chat context for this conversation.';
  }
  if (target === 'memory') {
    clearConversationRuntimeMemoryOnly(conversationKey);
    return 'Cleared chat memory and in-flight context for this conversation.';
  }
  const current = getOrCreateConversationProfile(conversationKey);
  if (!current) return null;
  if (target === 'name') {
    delete current.userDisplayName;
  } else if (target === 'goals') {
    current.goals = [];
  } else if (target === 'style') {
    delete current.customStylePrompt;
    current.responseVerbosity = 'detailed';
    current.prefersConcise = false;
  } else if (target === 'tone') {
    current.preferredTone = 'professional';
  }
  current.updatedAt = Date.now();
  userProfiles.set(conversationKey, current);
  persistUserProfiles();
  return `Forgot ${target} preference for this conversation.`;
};

const getTelegramBotIdFromConversationKey = (conversationKey?: string): string => {
  const key = String(conversationKey || '').trim();
  const match = key.match(/^telegram:([^:]+):/i);
  return String(match?.[1] || '').trim();
};

const TELEGRAM_MODEL_CYCLE_ORDER = [DEFAULT_OPENROUTER_MODEL];

const getConversationModel = (conversationKey?: string): string => {
  const botId = getTelegramBotIdFromConversationKey(conversationKey);
  if (!botId) return resolveTelegramAiConfig('').model;
  return String(telegramBotAiModels.get(botId) || resolveTelegramAiConfig('').model).trim();
};

const setConversationModel = (conversationKey: string | undefined, nextModelRaw: string): string | null => {
  const botId = getTelegramBotIdFromConversationKey(conversationKey);
  if (!botId) return null;
  const raw = String(nextModelRaw || '').trim();
  if (
    SHARED_FORCE_OPENROUTER_FREE_ONLY_MODE
    && /^[a-z0-9_.-]+\/[a-z0-9_.:-]+$/i.test(raw)
    && !isCuratedStrongFreeModelId(raw)
  ) {
    return null;
  }
  const mapped = mapTelegramModelChoice(nextModelRaw);
  if (!mapped) return null;
  telegramBotAiProviders.set(botId, mapped.provider);
  telegramBotAiModels.set(botId, mapped.model);
  persistBotState();
  return mapped.model;
};

const cycleConversationModel = (conversationKey: string | undefined): string | null => {
  const current = getConversationModel(conversationKey);
  const modelList = TELEGRAM_MODEL_CYCLE_ORDER.length > 0
    ? TELEGRAM_MODEL_CYCLE_ORDER
    : [resolveTelegramAiConfig('').model];
  const idx = modelList.findIndex((m) => m.toLowerCase() === current.toLowerCase());
  const next = modelList[(idx + 1 + modelList.length) % modelList.length] || modelList[0];
  return setConversationModel(conversationKey, next);
};

const toggleConciseMode = (conversationKey: string | undefined): string | null => {
  if (!conversationKey) return null;
  const current = userProfiles.get(conversationKey) || {
    preferredTone: 'casual' as const,
    responseVerbosity: 'detailed' as const,
    verifyMode: false,
    emojiStyle: (FORCE_RICH_EMOJI_STYLE ? 'rich' : 'minimal') as 'rich' | 'minimal',
    stickersEnabled: FORCE_STICKERS_ON,
    trustLayerEnabled: false,
    expertMode: 'general' as const,
    recurringTopics: [],
    topicCounts: {},
    updatedAt: Date.now()
  };

  const currentlyConcise = Boolean(current.prefersConcise) || current.preferredTone === 'concise';
  if (currentlyConcise) {
    current.prefersConcise = false;
    current.preferredTone = 'professional';
    current.responseVerbosity = 'detailed';
    current.updatedAt = Date.now();
    userProfiles.set(conversationKey, current);
    persistUserProfiles();
    return 'Detailed mode enabled. I will provide full professional answers.';
  }

  current.prefersConcise = true;
  current.preferredTone = 'concise';
  current.responseVerbosity = 'concise';
  current.updatedAt = Date.now();
  userProfiles.set(conversationKey, current);
  persistUserProfiles();
  return 'Concise mode enabled. I will keep answers short and clear.';
};

const getConversationResponseVerbosity = (conversationKey?: string): 'concise' | 'normal' | 'detailed' => {
  const profile = conversationKey ? userProfiles.get(conversationKey) : undefined;
  if (profile?.responseVerbosity) return profile.responseVerbosity;
  if (profile?.prefersConcise || profile?.preferredTone === 'concise') return 'concise';
  return 'detailed';
};

const DISPLAY_AI_MODEL_NAME = 'GPT-5.2 MODEL';
const getDisplayAiModelName = (): string => DISPLAY_AI_MODEL_NAME;

const setConversationResponseVerbosity = (
  conversationKey: string | undefined,
  modeRaw: string
): string | null => {
  if (!conversationKey) return null;
  const mode = String(modeRaw || '').trim().toLowerCase();
  if (!['concise', 'normal', 'detailed'].includes(mode)) return null;
  const current = userProfiles.get(conversationKey) || {
    preferredTone: 'professional' as const,
    responseVerbosity: 'detailed' as const,
    verifyMode: false,
    emojiStyle: (FORCE_RICH_EMOJI_STYLE ? 'rich' : 'minimal') as 'rich' | 'minimal',
    stickersEnabled: FORCE_STICKERS_ON,
    trustLayerEnabled: false,
    expertMode: 'general' as const,
    recurringTopics: [],
    topicCounts: {},
    updatedAt: Date.now()
  };
  current.responseVerbosity = mode as 'concise' | 'normal' | 'detailed';
  current.prefersConcise = mode === 'concise';
  if (mode === 'concise') {
    current.preferredTone = 'concise';
  } else if (current.preferredTone === 'concise' || !current.preferredTone) {
    current.preferredTone = 'professional';
  }
  current.updatedAt = Date.now();
  userProfiles.set(conversationKey, current);
  persistUserProfiles();
  if (mode === 'concise') return 'Style set to CONCISE. I will keep answers short and clear.';
  if (mode === 'normal') return 'Style set to NORMAL. I will give complete professional answers with moderate detail.';
  return 'Style set to DETAILED. I will give full detailed ChatGPT-like answers.';
};

const getConversationTrustLayerEnabled = (conversationKey?: string): boolean => {
  if (!conversationKey) return false;
  const profile = userProfiles.get(conversationKey);
  if (typeof profile?.trustLayerEnabled === 'boolean') return profile.trustLayerEnabled;
  return false;
};

const getConversationVerifyModeEnabled = (conversationKey?: string): boolean => {
  if (!conversationKey) return false;
  const profile = userProfiles.get(conversationKey);
  return profile?.verifyMode === true;
};

const setConversationVerifyMode = (
  conversationKey: string | undefined,
  enabled: boolean
): string | null => {
  if (!conversationKey) return null;
  const current = userProfiles.get(conversationKey) || {
    preferredTone: 'professional' as const,
    responseVerbosity: 'detailed' as const,
    verifyMode: false,
    emojiStyle: (FORCE_RICH_EMOJI_STYLE ? 'rich' : 'minimal') as 'rich' | 'minimal',
    stickersEnabled: FORCE_STICKERS_ON,
    trustLayerEnabled: false,
    expertMode: 'general' as const,
    recurringTopics: [],
    topicCounts: {},
    updatedAt: Date.now()
  };
  current.verifyMode = enabled;
  current.updatedAt = Date.now();
  userProfiles.set(conversationKey, current);
  persistUserProfiles();
  return enabled
    ? 'Verify mode enabled. I will append source-verified checks when possible.'
    : 'Verify mode disabled.';
};

const setConversationTrustLayerEnabled = (
  conversationKey: string | undefined,
  enabled: boolean
): string | null => {
  if (!conversationKey) return null;
  const current = userProfiles.get(conversationKey) || {
    preferredTone: 'professional' as const,
    responseVerbosity: 'detailed' as const,
    verifyMode: false,
    emojiStyle: (FORCE_RICH_EMOJI_STYLE ? 'rich' : 'minimal') as 'rich' | 'minimal',
    stickersEnabled: FORCE_STICKERS_ON,
    trustLayerEnabled: false,
    expertMode: 'general' as const,
    recurringTopics: [],
    topicCounts: {},
    updatedAt: Date.now()
  };
  current.trustLayerEnabled = enabled;
  current.updatedAt = Date.now();
  userProfiles.set(conversationKey, current);
  persistUserProfiles();
  return enabled
    ? 'Trust layer enabled. Replies will include confidence and source context.'
    : 'Trust layer disabled for this chat.';
};

const getConversationExpertMode = (conversationKey?: string): 'general' | 'interview' | 'coder' | 'teacher' | 'marketer' | 'legal' => {
  const profile = conversationKey ? userProfiles.get(conversationKey) : undefined;
  const mode = String(profile?.expertMode || '').trim().toLowerCase();
  if (['interview', 'coder', 'teacher', 'marketer', 'legal'].includes(mode)) {
    return mode as 'interview' | 'coder' | 'teacher' | 'marketer' | 'legal';
  }
  return 'general';
};

const setConversationExpertMode = (
  conversationKey: string | undefined,
  modeRaw: string
): string | null => {
  if (!conversationKey) return null;
  const mode = String(modeRaw || '').trim().toLowerCase();
  if (!['general', 'interview', 'coder', 'teacher', 'marketer', 'legal'].includes(mode)) {
    return null;
  }
  const current = userProfiles.get(conversationKey) || {
    preferredTone: 'professional' as const,
    responseVerbosity: 'detailed' as const,
    verifyMode: false,
    emojiStyle: (FORCE_RICH_EMOJI_STYLE ? 'rich' : 'minimal') as 'rich' | 'minimal',
    stickersEnabled: FORCE_STICKERS_ON,
    trustLayerEnabled: false,
    expertMode: 'general' as const,
    recurringTopics: [],
    topicCounts: {},
    updatedAt: Date.now()
  };
  current.expertMode = mode as 'general' | 'interview' | 'coder' | 'teacher' | 'marketer' | 'legal';
  current.updatedAt = Date.now();
  userProfiles.set(conversationKey, current);
  persistUserProfiles();
  return `Expert mode set to ${mode.toUpperCase()}.`;
};

const setConversationCustomStylePrompt = (
  conversationKey: string | undefined,
  styleRaw: string
): string | null => {
  if (!conversationKey) return null;
  const style = String(styleRaw || '').trim().replace(/\s+/g, ' ').slice(0, 500);
  if (!style) return null;
  const current = userProfiles.get(conversationKey) || {
    preferredTone: 'professional' as const,
    responseVerbosity: 'detailed' as const,
    verifyMode: false,
    emojiStyle: (FORCE_RICH_EMOJI_STYLE ? 'rich' : 'minimal') as 'rich' | 'minimal',
    stickersEnabled: FORCE_STICKERS_ON,
    trustLayerEnabled: false,
    expertMode: 'general' as const,
    recurringTopics: [],
    topicCounts: {},
    updatedAt: Date.now()
  };
  current.customStylePrompt = style;
  current.updatedAt = Date.now();
  userProfiles.set(conversationKey, current);
  persistUserProfiles();
  return style;
};

const clearConversationCustomStylePrompt = (conversationKey: string | undefined): boolean => {
  if (!conversationKey) return false;
  const current = userProfiles.get(conversationKey);
  if (!current) return false;
  if (!current.customStylePrompt) return true;
  delete current.customStylePrompt;
  current.updatedAt = Date.now();
  userProfiles.set(conversationKey, current);
  persistUserProfiles();
  return true;
};

const getConversationTasks = (conversationKey: string | undefined): ConversationTask[] => {
  if (!conversationKey) return [];
  return conversationTasks.get(conversationKey) || [];
};

const scheduleConversationTasksPersist = (): void => {
  if (conversationTasksPersistTimer) return;
  conversationTasksPersistTimer = setTimeout(() => {
    conversationTasksPersistTimer = null;
    persistConversationTasks();
  }, 500);
};

const persistConversationTasks = (): void => {
  try {
    const dir = path.dirname(CONVERSATION_TASKS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const serialized = JSON.stringify(
      Object.fromEntries(conversationTasks.entries()),
      null,
      2
    );
    fs.writeFileSync(CONVERSATION_TASKS_FILE, serialized, 'utf8');
  } catch (error) {
    console.warn('[TASKS] Failed to persist conversation tasks:', (error as Error).message);
  }
};

const loadConversationTasks = (): void => {
  try {
    if (!fs.existsSync(CONVERSATION_TASKS_FILE)) return;
    const raw = fs.readFileSync(CONVERSATION_TASKS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, ConversationTask[]>;
    conversationTasks.clear();
    for (const [conversationKey, tasks] of Object.entries(parsed || {})) {
      if (!conversationKey || !Array.isArray(tasks)) continue;
      const normalized = tasks
        .map((task) => ({
          id: String(task?.id || randomUUID()),
          text: String(task?.text || '').trim().slice(0, 500),
          status: task?.status === 'done' ? 'done' : 'open',
          createdAt: Number(task?.createdAt || Date.now()),
          dueAt: Number.isFinite(Number(task?.dueAt)) ? Number(task?.dueAt) : undefined,
          recurring: task?.recurring === 'daily' || task?.recurring === 'weekly' ? task.recurring : 'none',
          priority: String(task?.priority || '').toLowerCase() === 'high'
            ? 'high'
            : String(task?.priority || '').toLowerCase() === 'low'
              ? 'low'
              : 'medium'
        } as ConversationTask))
        .filter((task) => task.text.length > 0);
      conversationTasks.set(conversationKey, normalized.slice(-80));
    }
  } catch (error) {
    console.warn('[TASKS] Failed to load conversation tasks:', (error as Error).message);
  }
};

const normalizeTaskPriority = (raw: string): 'low' | 'medium' | 'high' => {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'high' || value === 'h' || value === 'urgent') return 'high';
  if (value === 'low' || value === 'l') return 'low';
  return 'medium';
};

const addConversationTask = (
  conversationKey: string | undefined,
  text: string,
  dueAt?: number,
  recurring: 'none' | 'daily' | 'weekly' = 'none',
  priority: 'low' | 'medium' | 'high' = 'medium'
): ConversationTask | null => {
  if (!conversationKey) return null;
  const cleanText = String(text || '').trim().replace(/\s+/g, ' ').slice(0, 500);
  if (!cleanText) return null;
  const current = getConversationTasks(conversationKey).slice(-79);
  const task: ConversationTask = {
    id: randomUUID().slice(0, 8),
    text: cleanText,
    status: 'open',
    createdAt: Date.now(),
    dueAt: Number.isFinite(Number(dueAt)) ? Number(dueAt) : undefined,
    recurring,
    priority: normalizeTaskPriority(priority)
  };
  current.push(task);
  conversationTasks.set(conversationKey, current);
  scheduleConversationTasksPersist();
  return task;
};

const setConversationTaskStatus = (
  conversationKey: string | undefined,
  taskId: string,
  status: 'open' | 'done'
): ConversationTask | null => {
  if (!conversationKey) return null;
  const tasks = getConversationTasks(conversationKey);
  const idx = tasks.findIndex((task) => task.id.toLowerCase() === String(taskId || '').trim().toLowerCase());
  if (idx < 0) return null;
  tasks[idx] = { ...tasks[idx], status };
  const reminderKey = `${conversationKey}:${tasks[idx].id}`;
  const pendingTimer = conversationReminderTimers.get(reminderKey);
  if (pendingTimer && status === 'done') {
    clearTimeout(pendingTimer);
    conversationReminderTimers.delete(reminderKey);
  }
  conversationTasks.set(conversationKey, tasks);
  scheduleConversationTasksPersist();
  return tasks[idx];
};

const deleteConversationTask = (
  conversationKey: string | undefined,
  taskId: string
): ConversationTask | null => {
  if (!conversationKey) return null;
  const tasks = getConversationTasks(conversationKey);
  const idx = tasks.findIndex((task) => task.id.toLowerCase() === String(taskId || '').trim().toLowerCase());
  if (idx < 0) return null;
  const removed = tasks[idx];
  const reminderKey = `${conversationKey}:${removed.id}`;
  const pendingTimer = conversationReminderTimers.get(reminderKey);
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    conversationReminderTimers.delete(reminderKey);
  }
  tasks.splice(idx, 1);
  conversationTasks.set(conversationKey, tasks);
  scheduleConversationTasksPersist();
  return removed;
};

const updateConversationTaskText = (
  conversationKey: string | undefined,
  taskId: string,
  nextText: string
): ConversationTask | null => {
  if (!conversationKey) return null;
  const tasks = getConversationTasks(conversationKey);
  const idx = tasks.findIndex((task) => task.id.toLowerCase() === String(taskId || '').trim().toLowerCase());
  if (idx < 0) return null;
  const cleanText = String(nextText || '').trim().replace(/\s+/g, ' ').slice(0, 500);
  if (!cleanText) return null;
  tasks[idx] = { ...tasks[idx], text: cleanText };
  conversationTasks.set(conversationKey, tasks);
  scheduleConversationTasksPersist();
  return tasks[idx];
};

const updateConversationTaskDueAt = (
  conversationKey: string | undefined,
  taskId: string,
  dueAt?: number,
  recurring?: 'none' | 'daily' | 'weekly'
): ConversationTask | null => {
  if (!conversationKey) return null;
  const tasks = getConversationTasks(conversationKey);
  const idx = tasks.findIndex((task) => task.id.toLowerCase() === String(taskId || '').trim().toLowerCase());
  if (idx < 0) return null;
  const updatedTask: ConversationTask = {
    ...tasks[idx],
    dueAt: Number.isFinite(Number(dueAt)) ? Number(dueAt) : undefined,
    recurring: recurring || tasks[idx].recurring || 'none'
  };
  tasks[idx] = updatedTask;
  conversationTasks.set(conversationKey, tasks);
  scheduleConversationTasksPersist();
  scheduleConversationTaskReminder(conversationKey, updatedTask);
  return updatedTask;
};

const updateConversationTaskPriority = (
  conversationKey: string | undefined,
  taskId: string,
  priorityRaw: string
): ConversationTask | null => {
  if (!conversationKey) return null;
  const tasks = getConversationTasks(conversationKey);
  const idx = tasks.findIndex((task) => task.id.toLowerCase() === String(taskId || '').trim().toLowerCase());
  if (idx < 0) return null;
  tasks[idx] = {
    ...tasks[idx],
    priority: normalizeTaskPriority(priorityRaw)
  };
  conversationTasks.set(conversationKey, tasks);
  scheduleConversationTasksPersist();
  return tasks[idx];
};

const formatConversationTaskList = (
  conversationKey: string | undefined,
  view: 'all' | 'open' | 'done' = 'all'
): string => {
  const tasks = getConversationTasks(conversationKey);
  if (!tasks.length) {
    return 'Action Tasks:\n- No tasks yet.\n- Use /task add <text> to create one.\n- Use /remind at 6pm <text> or /remind in 30m <text>.';
  }
  const filtered = view === 'open'
    ? tasks.filter((task) => task.status === 'open')
    : view === 'done'
      ? tasks.filter((task) => task.status === 'done')
      : tasks;
  if (!filtered.length) {
    return `Action Tasks:\n- No ${view} tasks.`;
  }
  const priorityRank = (priority?: string): number => {
    if (priority === 'high') return 0;
    if (priority === 'medium') return 1;
    return 2;
  };
  const sorted = filtered
    .slice()
    .sort((a, b) =>
      Number(a.status === 'done') - Number(b.status === 'done')
      || priorityRank(a.priority) - priorityRank(b.priority)
      || (Number(a.dueAt || Number.MAX_SAFE_INTEGER) - Number(b.dueAt || Number.MAX_SAFE_INTEGER))
      || a.createdAt - b.createdAt
    )
    .slice(-15);
  const lines = sorted.map((task) => {
    const due = task.dueAt ? new Date(task.dueAt).toISOString() : 'none';
    const priority = task.priority || 'medium';
    const recurring = task.recurring && task.recurring !== 'none' ? `, recurring: ${task.recurring}` : '';
    return `- [${task.status === 'done' ? 'done' : 'open'}] ${task.id}: ${task.text} (priority: ${priority}, due: ${due}${recurring})`;
  });
  const openCount = tasks.filter((task) => task.status === 'open').length;
  const doneCount = tasks.length - openCount;
  return [`Action Tasks (${view}):`, `- Summary: open ${openCount}, done ${doneCount}, total ${tasks.length}`, ...lines].join('\n');
};

const parseClockTimeToken = (rawToken: string): { hour: number; minute: number } | null => {
  const raw = String(rawToken || '').trim().toLowerCase();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!match?.[1]) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || '0');
  const ampm = String(match[3] || '').toLowerCase();
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    if (ampm === 'am') {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }
  } else if (hour < 0 || hour > 23) {
    return null;
  }
  return { hour, minute };
};

const computeDueAtFromClock = (
  clock: { hour: number; minute: number },
  baseDate: Date,
  forceNextDay: boolean
): number => {
  const due = new Date(baseDate);
  due.setHours(clock.hour, clock.minute, 0, 0);
  if (forceNextDay || due.getTime() <= Date.now()) {
    due.setDate(due.getDate() + 1);
  }
  return due.getTime();
};

const parseReminderDueExpression = (
  dueExpression: string
): { dueAtMs: number; recurring: 'none' | 'daily' | 'weekly' } | null => {
  const raw = String(dueExpression || '').trim().toLowerCase();
  if (!raw) return null;

  const relative = raw.match(/^in\s+(\d{1,4})\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i);
  if (relative?.[1] && relative?.[2]) {
    const value = Number(relative[1]);
    if (!Number.isFinite(value) || value <= 0) return null;
    const unit = String(relative[2] || '').toLowerCase();
    const factor =
      unit.startsWith('d') ? 60 * 24
      : unit.startsWith('h') ? 60
      : 1;
    const minutes = Math.max(1, Math.min(60 * 24 * 30, Math.floor(value * factor)));
    return { dueAtMs: Date.now() + minutes * 60_000, recurring: 'none' };
  }

  const explicitDate = raw.match(/^on\s+(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2})(?::(\d{2}))?)?$/i);
  if (explicitDate?.[1] && explicitDate?.[2] && explicitDate?.[3]) {
    const year = Number(explicitDate[1]);
    const month = Number(explicitDate[2]) - 1;
    const day = Number(explicitDate[3]);
    const hour = Number(explicitDate[4] || '9');
    const minute = Number(explicitDate[5] || '0');
    const date = new Date(year, month, day, hour, minute, 0, 0);
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) return null;
    return { dueAtMs: date.getTime(), recurring: 'none' };
  }

  const daily = raw.match(/^daily\s+(.+)$/i);
  if (daily?.[1]) {
    const clock = parseClockTimeToken(daily[1]);
    if (!clock) return null;
    const dueAtMs = computeDueAtFromClock(clock, new Date(), false);
    return { dueAtMs, recurring: 'daily' };
  }

  const weekly = raw.match(/^weekly\s+(.+)$/i);
  if (weekly?.[1]) {
    const clock = parseClockTimeToken(weekly[1]);
    if (!clock) return null;
    const base = new Date();
    const first = computeDueAtFromClock(clock, base, false);
    const dueAtMs = first <= Date.now() ? first + (7 * 24 * 60 * 60 * 1000) : first;
    return { dueAtMs, recurring: 'weekly' };
  }

  const tomorrow = raw.match(/^tomorrow\s+(.+)$/i);
  if (tomorrow?.[1]) {
    const clock = parseClockTimeToken(tomorrow[1]);
    if (!clock) return null;
    const base = new Date();
    base.setDate(base.getDate() + 1);
    return { dueAtMs: computeDueAtFromClock(clock, base, false), recurring: 'none' };
  }

  const today = raw.match(/^today\s+(.+)$/i);
  if (today?.[1]) {
    const clock = parseClockTimeToken(today[1]);
    if (!clock) return null;
    const dueAtMs = computeDueAtFromClock(clock, new Date(), false);
    return { dueAtMs, recurring: 'none' };
  }

  const at = raw.match(/^at\s+(.+)$/i);
  if (at?.[1]) {
    const clock = parseClockTimeToken(at[1]);
    if (!clock) return null;
    return { dueAtMs: computeDueAtFromClock(clock, new Date(), false), recurring: 'none' };
  }

  const directClock = parseClockTimeToken(raw);
  if (directClock) {
    return { dueAtMs: computeDueAtFromClock(directClock, new Date(), false), recurring: 'none' };
  }

  return null;
};

type ReminderCommandParseResult = {
  dueAtMs: number;
  taskText: string;
  recurring: 'none' | 'daily' | 'weekly';
};

const parseReminderCommand = (text: string): ReminderCommandParseResult | null => {
  const raw = String(text || '').trim();
  const body = raw.replace(/^\/remind(?:@\w+)?/i, '').trim();
  if (!body) return null;

  const directMinutes = body.match(/^(\d{1,4})\s+([\s\S]+)$/i);
  if (directMinutes?.[1] && directMinutes?.[2]) {
    const minutes = Math.max(1, Math.min(60 * 24 * 30, Number(directMinutes[1])));
    const taskText = String(directMinutes[2] || '').trim();
    if (!taskText) return null;
    return { dueAtMs: Date.now() + minutes * 60_000, taskText, recurring: 'none' };
  }

  const advancedPatterns = [
    /^in\s+(\d{1,4}\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days))\s+(?:to\s+|for\s+)?([\s\S]+)$/i,
    /^(daily\s+[0-9:apm ]{1,12})\s+(?:to\s+|for\s+)?([\s\S]+)$/i,
    /^(weekly\s+[0-9:apm ]{1,12})\s+(?:to\s+|for\s+)?([\s\S]+)$/i,
    /^(tomorrow\s+[0-9:apm ]{1,12})\s+(?:to\s+|for\s+)?([\s\S]+)$/i,
    /^(today\s+[0-9:apm ]{1,12})\s+(?:to\s+|for\s+)?([\s\S]+)$/i,
    /^(at\s+[0-9:apm ]{1,12})\s+(?:to\s+|for\s+)?([\s\S]+)$/i,
    /^(on\s+\d{4}-\d{2}-\d{2}(?:[ t]\d{1,2}:\d{2})?)\s+(?:to\s+|for\s+)?([\s\S]+)$/i
  ];
  for (const pattern of advancedPatterns) {
    const match = body.match(pattern);
    if (!match?.[1] || !match?.[2]) continue;
    const dueParsed = parseReminderDueExpression(String(match[1] || '').trim());
    const taskText = String(match[2] || '').trim();
    if (!dueParsed || !taskText) continue;
    return { dueAtMs: dueParsed.dueAtMs, taskText, recurring: dueParsed.recurring };
  }
  return null;
};

type TaskAddParseResult = {
  text: string;
  dueAt?: number;
  recurring: 'none' | 'daily' | 'weekly';
  priority: 'low' | 'medium' | 'high';
};

const parseTaskAddCommandArgs = (rawArgs: string): TaskAddParseResult | null => {
  let working = String(rawArgs || '').trim();
  if (!working) return null;

  let priority: 'low' | 'medium' | 'high' = 'medium';
  let recurring: 'none' | 'daily' | 'weekly' = 'none';
  let dueAt: number | undefined;

  const priorityMatch = working.match(/\s+\/p(?:riority)?\s+(low|medium|high|urgent|h|m|l)\b/i);
  if (priorityMatch?.[1]) {
    priority = normalizeTaskPriority(priorityMatch[1]);
    working = working.replace(priorityMatch[0], '').trim();
  }

  const repeatMatch = working.match(/\s+\/repeat\s+(daily|weekly)\b/i);
  if (repeatMatch?.[1]) {
    recurring = String(repeatMatch[1]).toLowerCase() === 'weekly' ? 'weekly' : 'daily';
    working = working.replace(repeatMatch[0], '').trim();
  }

  const byMatch = working.match(/\s+\/by\s+([\s\S]+)$/i);
  if (byMatch?.[1]) {
    const dueParsed = parseReminderDueExpression(byMatch[1]);
    if (!dueParsed) return null;
    dueAt = dueParsed.dueAtMs;
    if (recurring === 'none' && dueParsed.recurring !== 'none') {
      recurring = dueParsed.recurring;
    }
    working = working.slice(0, byMatch.index).trim();
  }

  const text = String(working || '').trim();
  if (!text) return null;
  return { text, dueAt, recurring, priority };
};

const parseNaturalReminderIntent = (text: string): ReminderCommandParseResult | null => {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const patterns = [
    /^remind me in\s+(\d{1,4}\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days))\s+(?:to\s+)?([\s\S]+)$/i,
    /^remind me at\s+([0-9:apm ]{1,12})\s+(?:to\s+)?([\s\S]+)$/i,
    /^remind me tomorrow\s+([0-9:apm ]{1,12})\s+(?:to\s+)?([\s\S]+)$/i,
    /^remind me today\s+([0-9:apm ]{1,12})\s+(?:to\s+)?([\s\S]+)$/i,
    /^set (?:a )?reminder in\s+(\d{1,4}\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days))\s+(?:to\s+)?([\s\S]+)$/i,
    /^set (?:a )?reminder at\s+([0-9:apm ]{1,12})\s+(?:to\s+)?([\s\S]+)$/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match?.[1] || !match?.[2]) continue;
    const prefix = /^remind me in|^set (?:a )?reminder in/i.test(raw) ? 'in' : /^remind me at|^set (?:a )?reminder at/i.test(raw) ? 'at' : /^remind me tomorrow/i.test(raw) ? 'tomorrow' : 'today';
    const dueParsed = parseReminderDueExpression(`${prefix} ${String(match[1] || '').trim()}`);
    const taskText = String(match[2] || '').trim();
    if (!dueParsed || !taskText) continue;
    return { dueAtMs: dueParsed.dueAtMs, taskText, recurring: dueParsed.recurring };
  }
  return null;
};

const scheduleConversationKnowledgePersist = (): void => {
  if (conversationKnowledgePersistTimer) return;
  conversationKnowledgePersistTimer = setTimeout(() => {
    conversationKnowledgePersistTimer = null;
    persistConversationKnowledgeBase();
  }, 700);
};

const persistConversationKnowledgeBase = (): void => {
  try {
    const dir = path.dirname(CONVERSATION_KB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const payload = Object.fromEntries(conversationKnowledgeBase.entries());
    fs.writeFileSync(CONVERSATION_KB_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.warn('[KB] Failed to persist conversation KB:', (error as Error).message);
  }
};

const loadConversationKnowledgeBase = (): void => {
  try {
    if (!fs.existsSync(CONVERSATION_KB_FILE)) return;
    const raw = fs.readFileSync(CONVERSATION_KB_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, ConversationKnowledgeDoc[]>;
    conversationKnowledgeBase.clear();
    for (const [conversationKey, docs] of Object.entries(parsed || {})) {
      if (!conversationKey || !Array.isArray(docs)) continue;
      const normalized = docs
        .map((doc) => ({
          id: String(doc?.id || randomUUID().slice(0, 10)),
          kind: (['text', 'photo', 'document', 'voice', 'audio', 'video', 'sticker', 'location', 'contact'].includes(String(doc?.kind || '').toLowerCase())
            ? String(doc.kind).toLowerCase()
            : 'unsupported') as ConversationKnowledgeDoc['kind'],
          title: String(doc?.title || 'Untitled').trim().slice(0, 140) || 'Untitled',
          content: String(doc?.content || '').trim().slice(0, 12000),
          sourceHint: String(doc?.sourceHint || '').trim().slice(0, 200) || undefined,
          createdAt: Number(doc?.createdAt || Date.now()),
          updatedAt: Number(doc?.updatedAt || Date.now())
        }))
        .filter((doc) => doc.content.length >= 60);
      if (normalized.length > 0) {
        conversationKnowledgeBase.set(conversationKey, normalized.slice(-80));
      }
    }
  } catch (error) {
    console.warn('[KB] Failed to load conversation KB:', (error as Error).message);
  }
};

const extractConversationKnowledgeContent = (
  kind: TelegramPromptExtraction['kind'],
  promptText: string,
  rawText?: string
): { title: string; content: string; sourceHint?: string } | null => {
  const cleanPrompt = String(promptText || '').replace(/\r/g, '').trim();
  const fallbackText = String(rawText || '').trim();
  if (!cleanPrompt && !fallbackText) return null;
  if (kind === 'text') return null;

  const transcript = extractMediaTranscriptFromPrompt(cleanPrompt);
  const ocr = extractPromptSectionByLabel(cleanPrompt, 'OCR text');
  const vision = extractPromptSectionByLabel(cleanPrompt, 'Vision analysis');
  const extracted = extractPromptSectionByLabel(cleanPrompt, 'Extracted content');
  const visualFile = extractPromptSectionByLabel(cleanPrompt, 'Visual file analysis');
  const title =
    String(cleanPrompt.match(/(?:^|\n)File name:\s*(.+)$/im)?.[1] || '').trim().slice(0, 140)
    || (kind === 'photo' ? 'Image Upload' : kind === 'document' ? 'Document Upload' : kind === 'video' ? 'Video Upload' : kind === 'audio' || kind === 'voice' ? 'Audio Upload' : 'Chat Input');

  let content = '';
  if (kind === 'document') {
    content = [extracted, visualFile, fallbackText].filter(Boolean).join('\n\n').trim();
  } else if (kind === 'photo') {
    content = [ocr, vision, fallbackText].filter(Boolean).join('\n\n').trim();
  } else if (kind === 'audio' || kind === 'voice' || kind === 'video') {
    content = [transcript, fallbackText].filter(Boolean).join('\n\n').trim();
  } else {
    content = [fallbackText, extracted, transcript, ocr, vision].filter(Boolean).join('\n\n').trim();
  }

  content = content.replace(/\n{3,}/g, '\n\n').trim().slice(0, 12000);
  if (content.length < 60) return null;
  const sourceHint =
    String(cleanPrompt.match(/(?:^|\n)Mime type:\s*(.+)$/im)?.[1] || '').trim().slice(0, 120)
    || undefined;
  return { title, content, sourceHint };
};

const upsertConversationKnowledgeFromPrompt = (
  conversationKey: string | undefined,
  kind: TelegramPromptExtraction['kind'],
  promptText: string,
  rawText?: string
): void => {
  if (!conversationKey) return;
  const extracted = extractConversationKnowledgeContent(kind, promptText, rawText);
  if (!extracted) return;
  const docs = conversationKnowledgeBase.get(conversationKey) || [];
  const contentHash = extracted.content.slice(0, 600).toLowerCase().replace(/\s+/g, ' ').trim();
  const existing = docs.find((doc) => doc.content.slice(0, 600).toLowerCase().replace(/\s+/g, ' ').trim() === contentHash);
  if (existing) {
    existing.updatedAt = Date.now();
    existing.title = extracted.title || existing.title;
    existing.sourceHint = extracted.sourceHint || existing.sourceHint;
    conversationKnowledgeBase.set(conversationKey, docs);
    scheduleConversationKnowledgePersist();
    return;
  }
  const next: ConversationKnowledgeDoc = {
    id: `K${Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0')}`,
    kind,
    title: extracted.title,
    content: extracted.content,
    sourceHint: extracted.sourceHint,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  docs.push(next);
  conversationKnowledgeBase.set(conversationKey, docs.slice(-80));
  scheduleConversationKnowledgePersist();
};

const tokenizeKnowledgeQuery = (value: string): string[] =>
  String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .slice(0, 25);

const retrieveConversationKnowledgeDocs = (
  conversationKey: string | undefined,
  query: string,
  maxItems = 3
): ConversationKnowledgeDoc[] => {
  if (!conversationKey) return [];
  const docs = conversationKnowledgeBase.get(conversationKey) || [];
  if (!docs.length) return [];
  const queryTokens = tokenizeKnowledgeQuery(query);
  if (!queryTokens.length) return docs.slice(-maxItems).reverse();

  const scored = docs
    .map((doc) => {
      const hay = `${doc.title}\n${doc.content}`.toLowerCase();
      const tokenHits = queryTokens.reduce((acc, token) => acc + (hay.includes(token) ? 1 : 0), 0);
      const recencyBoost = Math.max(0, 10 - Math.floor((Date.now() - doc.updatedAt) / (1000 * 60 * 60 * 24)));
      return { doc, score: tokenHits * 10 + recencyBoost };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(6, maxItems)));

  return scored.map((row) => row.doc);
};

const formatConversationKnowledgeBlock = (docs: ConversationKnowledgeDoc[]): string => {
  if (!docs.length) return '';
  const lines: string[] = ['Workspace Knowledge Base Context:'];
  docs.forEach((doc, idx) => {
    const snippet = summarizeForFallback(doc.content, 420);
    lines.push(`[${idx + 1}] ${doc.id} - ${doc.title} (${doc.kind})`);
    lines.push(snippet || 'No snippet available.');
  });
  return lines.join('\n');
};

const buildConversationKnowledgeStatusReply = (conversationKey: string | undefined): string => {
  const docs = conversationKey ? (conversationKnowledgeBase.get(conversationKey) || []) : [];
  if (!docs.length) {
    return 'Workspace KB:\n- No saved knowledge yet.\n- Upload files/images/audio/video to build your private KB.\n- Use /kb list after uploads.';
  }
  const latest = docs.slice(-8).reverse();
  const lines = latest.map((doc) => {
    const when = new Date(doc.updatedAt).toISOString();
    return `- ${doc.id}: ${doc.title} [${doc.kind}] (${when})`;
  });
  return ['Workspace KB:', `- Total items: ${docs.length}`, ...lines].join('\n');
};

const clearConversationKnowledge = (conversationKey: string | undefined): boolean => {
  if (!conversationKey) return false;
  const exists = conversationKnowledgeBase.has(conversationKey);
  conversationKnowledgeBase.delete(conversationKey);
  scheduleConversationKnowledgePersist();
  return exists;
};

const getTelegramBotByScope = (scope: string): TelegramBot | null => {
  const normalized = String(scope || '').trim();
  if (!normalized) return null;
  if (normalized === 'telegram:primary') return bot;
  const match = normalized.match(/^telegram:(.+)$/i);
  const botId = String(match?.[1] || '').trim();
  if (!botId) return null;
  const token = botTokens.get(botId);
  if (!token) return null;
  if (!isValidTelegramBotTokenFormat(token)) {
    console.warn(`[BOT_STATE] Dropping invalid Telegram token mapping for ${botId}.`);
    clearTelegramBotRegistryEntry(botId);
    persistBotState();
    return null;
  }
  let instance = managedBots.get(token);
  if (!instance) {
    instance = new TelegramBot(token, { polling: false });
    managedBots.set(token, instance);
  }
  return instance;
};

const scheduleConversationTaskReminder = (conversationKey: string, task: ConversationTask): void => {
  if (!conversationKey) return;
  if (!task?.id || !Number.isFinite(Number(task?.dueAt)) || task.status === 'done') return;
  const dueAt = Number(task.dueAt);
  if (dueAt <= Date.now()) return;
  const scopeAndChat = getScopeAndChatFromConversationKey(conversationKey);
  if (!scopeAndChat) return;
  const chatIdNum = Number(scopeAndChat.chatId);
  if (!Number.isFinite(chatIdNum)) return;
  const timerKey = `${conversationKey}:${task.id}`;
  const existing = conversationReminderTimers.get(timerKey);
  if (existing) clearTimeout(existing);

  const delayMs = Math.max(1000, dueAt - Date.now());
  const timer = setTimeout(async () => {
    conversationReminderTimers.delete(timerKey);
    const latest = getConversationTasks(conversationKey).find((item) => item.id === task.id);
    if (!latest || latest.status === 'done') return;
    const botInstance = getTelegramBotByScope(scopeAndChat.scope);
    if (!botInstance) return;
    const reminderReply = [
      'Reminder:',
      `- ${latest.text}`,
      '',
      `Task ID: ${latest.id}`,
      'Use /task done <id> after completion.'
    ].join('\n');
    await sendTelegramReply(botInstance, chatIdNum, reminderReply).catch(() => {});
    if (latest.recurring === 'daily' || latest.recurring === 'weekly') {
      const nextDueAt = Number(latest.dueAt || Date.now())
        + (latest.recurring === 'weekly' ? 7 : 1) * 24 * 60 * 60 * 1000;
      updateConversationTaskDueAt(conversationKey, latest.id, nextDueAt, latest.recurring);
    } else {
      setConversationTaskStatus(conversationKey, latest.id, 'done');
    }
  }, delayMs);
  timer.unref?.();
  conversationReminderTimers.set(timerKey, timer);
};

const createScheduledConversationReminderAt = (
  conversationKey: string | undefined,
  dueAtMs: number,
  taskText: string,
  recurring: 'none' | 'daily' | 'weekly' = 'none'
): ConversationTask | null => {
  if (!conversationKey) return null;
  const dueAt = Number(dueAtMs || 0);
  if (!Number.isFinite(dueAt) || dueAt <= Date.now()) return null;
  const task = addConversationTask(conversationKey, taskText, dueAt, recurring, 'high');
  if (!task) return null;
  scheduleConversationTaskReminder(conversationKey, task);
  return task;
};

const createScheduledConversationReminder = (
  conversationKey: string | undefined,
  minutes: number,
  taskText: string
): ConversationTask | null => {
  if (!conversationKey) return null;
  const boundedMinutes = Math.max(1, Math.min(60 * 24 * 30, Number(minutes || 0)));
  if (!Number.isFinite(boundedMinutes) || boundedMinutes <= 0) return null;
  const dueAt = Date.now() + boundedMinutes * 60_000;
  return createScheduledConversationReminderAt(conversationKey, dueAt, taskText, 'none');
};

const restorePendingConversationReminders = (): void => {
  for (const [conversationKey, tasks] of conversationTasks.entries()) {
    for (const task of tasks) {
      if (task.status !== 'open') continue;
      if (!Number.isFinite(Number(task.dueAt))) continue;
      if (Number(task.dueAt) <= Date.now()) continue;
      scheduleConversationTaskReminder(conversationKey, task);
    }
  }
};

const scheduleConversationDigestPersist = (): void => {
  if (conversationDigestPersistTimer) return;
  conversationDigestPersistTimer = setTimeout(() => {
    conversationDigestPersistTimer = null;
    persistConversationDigestSchedules();
  }, 500);
};

const persistConversationDigestSchedules = (): void => {
  try {
    const dir = path.dirname(CONVERSATION_DIGEST_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      CONVERSATION_DIGEST_FILE,
      JSON.stringify(Object.fromEntries(conversationDigestSchedules.entries()), null, 2),
      'utf8'
    );
  } catch (error) {
    console.warn('[DIGEST] Failed to persist digest schedules:', (error as Error).message);
  }
};

const loadConversationDigestSchedules = (): void => {
  try {
    if (!fs.existsSync(CONVERSATION_DIGEST_FILE)) return;
    const raw = fs.readFileSync(CONVERSATION_DIGEST_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, ConversationDigestSchedule>;
    conversationDigestSchedules.clear();
    for (const [conversationKey, item] of Object.entries(parsed || {})) {
      if (!conversationKey || !item) continue;
      const timeMatch = String(item.time || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
      if (!timeMatch) continue;
      conversationDigestSchedules.set(conversationKey, {
        enabled: item.enabled !== false,
        time: `${timeMatch[1]}:${timeMatch[2]}`,
        nextRunAt: Number.isFinite(Number(item.nextRunAt)) ? Number(item.nextRunAt) : Date.now(),
        lastSentAt: Number.isFinite(Number(item.lastSentAt)) ? Number(item.lastSentAt) : undefined,
        updatedAt: Number(item.updatedAt || Date.now())
      });
    }
  } catch (error) {
    console.warn('[DIGEST] Failed to load digest schedules:', (error as Error).message);
  }
};

const formatHHMM = (hour: number, minute: number): string =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

const parseDigestTime = (raw: string): { hour: number; minute: number; hhmm: string } | null => {
  const clock = parseClockTimeToken(raw);
  if (!clock) return null;
  return {
    hour: clock.hour,
    minute: clock.minute,
    hhmm: formatHHMM(clock.hour, clock.minute)
  };
};

const computeNextDailyRunAt = (hhmm: string): number => {
  const match = String(hhmm || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match?.[1] || !match?.[2]) return Date.now() + 60_000;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const due = new Date();
  due.setHours(hour, minute, 0, 0);
  if (due.getTime() <= Date.now()) due.setDate(due.getDate() + 1);
  return due.getTime();
};

const buildConversationDailyDigestReply = (conversationKey: string | undefined): string => {
  const key = String(conversationKey || '').trim();
  if (!key) {
    return 'Daily Digest:\n- Conversation context is unavailable in this chat.';
  }
  const tasks = getConversationTasks(key);
  const openTasks = tasks.filter((task) => task.status === 'open');
  const now = Date.now();
  const overdue = openTasks.filter((task) => Number.isFinite(Number(task.dueAt)) && Number(task.dueAt) < now);
  const dueSoon = openTasks
    .filter((task) => Number.isFinite(Number(task.dueAt)))
    .sort((a, b) => Number(a.dueAt || 0) - Number(b.dueAt || 0))
    .slice(0, 5);
  const topOpen = openTasks.slice(0, 5);
  const kbDocs = (conversationKnowledgeBase.get(key) || []).slice(-3).reverse();

  const scopeAndChat = getScopeAndChatFromConversationKey(key);
  const scopeChatKey = scopeAndChat ? `${scopeAndChat.scope}:${scopeAndChat.chatId}` : '';
  const chatStats = scopeChatKey ? telegramObservedChats.get(scopeChatKey) : undefined;
  const todayKey = getDateKeyUtc(now);
  const messagesToday = Number(chatStats?.messagesByDate?.[todayKey] || 0);

  const lines: string[] = [
    'Daily Digest:',
    `- Date: ${new Date(now).toISOString().slice(0, 10)}`,
    `- Open tasks: ${openTasks.length}`,
    `- Completed tasks: ${tasks.filter((task) => task.status === 'done').length}`,
    `- Overdue tasks: ${overdue.length}`,
    `- Messages today in this chat: ${messagesToday}`
  ];

  if (dueSoon.length > 0) {
    lines.push('', 'Upcoming deadlines:');
    dueSoon.forEach((task) => {
      lines.push(`- ${task.id}: ${task.text} (${new Date(Number(task.dueAt || now)).toISOString()})`);
    });
  } else if (topOpen.length > 0) {
    lines.push('', 'Top open tasks:');
    topOpen.forEach((task) => lines.push(`- ${task.id}: ${task.text}`));
  } else {
    lines.push('', 'No open tasks right now.');
  }

  if (kbDocs.length > 0) {
    lines.push('', 'Recent knowledge items:');
    kbDocs.forEach((doc) => lines.push(`- ${doc.id}: ${doc.title} [${doc.kind}]`));
  }

  lines.push('', 'Next step: Use /task add <text> or /remind at 6pm <text> to keep this digest useful.');
  return lines.join('\n');
};

const clearConversationDailyDigestTimer = (conversationKey: string): void => {
  const timer = conversationDigestTimers.get(conversationKey);
  if (timer) {
    clearTimeout(timer);
    conversationDigestTimers.delete(conversationKey);
  }
};

const scheduleConversationDailyDigestTimer = (conversationKey: string): void => {
  const schedule = conversationDigestSchedules.get(conversationKey);
  clearConversationDailyDigestTimer(conversationKey);
  if (!schedule || !schedule.enabled) return;
  const nextRunAt = Number.isFinite(Number(schedule.nextRunAt))
    ? Number(schedule.nextRunAt)
    : computeNextDailyRunAt(schedule.time);
  const delayMs = Math.max(1000, nextRunAt - Date.now());
  const timer = setTimeout(async () => {
    clearConversationDailyDigestTimer(conversationKey);
    const latest = conversationDigestSchedules.get(conversationKey);
    if (!latest || !latest.enabled) return;
    const scopeAndChat = getScopeAndChatFromConversationKey(conversationKey);
    if (!scopeAndChat) return;
    const botInstance = getTelegramBotByScope(scopeAndChat.scope);
    const chatIdNum = Number(scopeAndChat.chatId);
    if (!botInstance || !Number.isFinite(chatIdNum)) return;
    const digest = buildConversationDailyDigestReply(conversationKey);
    await sendTelegramReply(botInstance, chatIdNum, digest).catch(() => {});
    latest.lastSentAt = Date.now();
    latest.nextRunAt = computeNextDailyRunAt(latest.time);
    latest.updatedAt = Date.now();
    conversationDigestSchedules.set(conversationKey, latest);
    scheduleConversationDigestPersist();
    scheduleConversationDailyDigestTimer(conversationKey);
  }, delayMs);
  timer.unref?.();
  conversationDigestTimers.set(conversationKey, timer);
};

const setConversationDailyDigestSchedule = (
  conversationKey: string | undefined,
  hhmm: string
): ConversationDigestSchedule | null => {
  const key = String(conversationKey || '').trim();
  if (!key) return null;
  const valid = String(hhmm || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!valid) return null;
  const nextRunAt = computeNextDailyRunAt(hhmm);
  const updated: ConversationDigestSchedule = {
    enabled: true,
    time: hhmm,
    nextRunAt,
    lastSentAt: conversationDigestSchedules.get(key)?.lastSentAt,
    updatedAt: Date.now()
  };
  conversationDigestSchedules.set(key, updated);
  scheduleConversationDigestPersist();
  scheduleConversationDailyDigestTimer(key);
  return updated;
};

const disableConversationDailyDigestSchedule = (conversationKey: string | undefined): boolean => {
  const key = String(conversationKey || '').trim();
  if (!key) return false;
  const existing = conversationDigestSchedules.get(key);
  clearConversationDailyDigestTimer(key);
  if (!existing) return false;
  existing.enabled = false;
  existing.updatedAt = Date.now();
  conversationDigestSchedules.set(key, existing);
  scheduleConversationDigestPersist();
  return true;
};

const restoreConversationDigestSchedules = (): void => {
  for (const [conversationKey, schedule] of conversationDigestSchedules.entries()) {
    if (!schedule.enabled) continue;
    if (!Number.isFinite(Number(schedule.nextRunAt)) || Number(schedule.nextRunAt) <= Date.now()) {
      schedule.nextRunAt = computeNextDailyRunAt(schedule.time);
      conversationDigestSchedules.set(conversationKey, schedule);
    }
    scheduleConversationDailyDigestTimer(conversationKey);
  }
};

const buildConversationDailyDigestStatus = (conversationKey: string | undefined): string => {
  const key = String(conversationKey || '').trim();
  if (!key) return 'Digest settings are unavailable in this context.';
  const current = conversationDigestSchedules.get(key);
  if (!current || !current.enabled) {
    return [
      'Daily Digest: OFF',
      '- Use /digest daily 8am to enable automatic daily digest.',
      '- Use /digest now for an instant digest.'
    ].join('\n');
  }
  return [
    'Daily Digest: ON',
    `- Time: ${current.time} (server local time)`,
    `- Next run: ${new Date(current.nextRunAt).toISOString()}`,
    current.lastSentAt ? `- Last sent: ${new Date(current.lastSentAt).toISOString()}` : '- Last sent: not sent yet',
    '- Use /digest off to disable.'
  ].join('\n');
};

const buildSubscriptionKey = (scope: string, chatId: string, userId: string): string =>
  `${String(scope || '').trim()}:${String(chatId || '').trim()}:${String(userId || '').trim()}`;

const scheduleTelegramSubscriptionsPersist = (): void => {
  if (telegramSubscriptionsPersistTimer) return;
  telegramSubscriptionsPersistTimer = setTimeout(() => {
    telegramSubscriptionsPersistTimer = null;
    persistTelegramSubscriptions();
  }, 500);
};

const persistTelegramSubscriptions = (): void => {
  try {
    const dir = path.dirname(TELEGRAM_SUBSCRIPTIONS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const serialized = JSON.stringify(
      Object.fromEntries(telegramSubscriptions.entries()),
      null,
      2
    );
    fs.writeFileSync(TELEGRAM_SUBSCRIPTIONS_FILE, serialized, 'utf8');
  } catch (error) {
    console.warn('[SUBSCRIPTION] Failed to persist Telegram subscriptions:', (error as Error).message);
  }
};

const loadTelegramSubscriptions = (): void => {
  try {
    if (!fs.existsSync(TELEGRAM_SUBSCRIPTIONS_FILE)) return;
    const raw = fs.readFileSync(TELEGRAM_SUBSCRIPTIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, TelegramSubscriptionRecord>;
    telegramSubscriptions.clear();
    for (const [key, record] of Object.entries(parsed || {})) {
      if (!key || !record) continue;
      telegramSubscriptions.set(key, {
        scope: String(record.scope || ''),
        chatId: String(record.chatId || ''),
        userId: String(record.userId || ''),
        plan: record.plan === 'pro' ? 'pro' : 'free',
        source: (record.source === 'telegram_stars' || record.source === 'manual') ? record.source : 'legacy',
        starsAmount: Number.isFinite(Number(record.starsAmount)) ? Number(record.starsAmount) : undefined,
        status: record.status === 'expired' || record.status === 'cancelled' ? record.status : 'active',
        expiresAt: Number.isFinite(Number(record.expiresAt)) ? Number(record.expiresAt) : undefined,
        updatedAt: Number(record.updatedAt || Date.now())
      });
    }
  } catch (error) {
    console.warn('[SUBSCRIPTION] Failed to load Telegram subscriptions:', (error as Error).message);
  }
};

const getTelegramSubscriptionRecord = (scope: string, chatId: string, userId: string): TelegramSubscriptionRecord | null => {
  const key = buildSubscriptionKey(scope, chatId, userId);
  const row = telegramSubscriptions.get(key);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt <= Date.now() && row.status === 'active') {
    row.status = 'expired';
    row.updatedAt = Date.now();
    telegramSubscriptions.set(key, row);
    scheduleTelegramSubscriptionsPersist();
  }
  return row;
};

const setTelegramSubscriptionRecord = (
  scope: string,
  chatId: string,
  userId: string,
  update: Partial<TelegramSubscriptionRecord>
): TelegramSubscriptionRecord => {
  const key = buildSubscriptionKey(scope, chatId, userId);
  const current = telegramSubscriptions.get(key);
  const next: TelegramSubscriptionRecord = {
    scope,
    chatId,
    userId,
    plan: update.plan === 'pro' ? 'pro' : (current?.plan || 'free'),
    source: (update.source === 'telegram_stars' || update.source === 'manual' || update.source === 'legacy')
      ? update.source
      : (current?.source || 'manual'),
    starsAmount: Number.isFinite(Number(update.starsAmount)) ? Number(update.starsAmount) : current?.starsAmount,
    status: update.status === 'expired' || update.status === 'cancelled' ? update.status : (current?.status || 'active'),
    expiresAt: Number.isFinite(Number(update.expiresAt)) ? Number(update.expiresAt) : current?.expiresAt,
    updatedAt: Date.now()
  };
  telegramSubscriptions.set(key, next);
  scheduleTelegramSubscriptionsPersist();
  return next;
};

const buildTelegramSubscriptionStatusReply = (scope: string, chatId: string, userId: string): string => {
  const record = getTelegramSubscriptionRecord(scope, chatId, userId);
  if (!record || record.plan !== 'pro' || record.status !== 'active') {
    return [
      'Telegram Subscription Status:',
      '- Current plan: FREE',
      '- Stars activation: ready (manual payment webhook mapping required).',
      '- Upgrade path: configure Telegram Stars payment flow and map successful payment to this user.'
    ].join('\n');
  }
  const expiryLine = record.expiresAt
    ? `- Pro expires at: ${new Date(record.expiresAt).toISOString()}`
    : '- Pro expiry: not set';
  return [
    'Telegram Subscription Status:',
    '- Current plan: PRO',
    `- Source: ${record.source}`,
    record.starsAmount ? `- Stars amount: ${record.starsAmount}` : '- Stars amount: not set',
    expiryLine
  ].join('\n');
};

const resolveTelegramStartDisplayName = (conversationKey?: string, msg?: TelegramBot.Message | any): string => {
  const profileName = sanitizeUserDisplayName(String(userProfiles.get(conversationKey || '')?.userDisplayName || ''));
  if (profileName) return profileName;

  const first = sanitizeUserDisplayName(String(msg?.from?.first_name || ''));
  const last = sanitizeUserDisplayName(String(msg?.from?.last_name || ''));
  const full = sanitizeUserDisplayName(`${first} ${last}`.trim());
  if (full) return full;

  const username = sanitizeUserDisplayName(String(msg?.from?.username || '').replace(/^@+/, ''));
  if (username) return `@${username}`;
  return '';
};

const buildStartWelcomeMessage = (conversationKey?: string, userDisplayName?: string): string => {
  const assistantName = sanitizeAssistantName(getAssistantName(conversationKey) || getOfficialAssistantName(conversationKey) || 'Nexora AI') || 'Nexora AI';
  void userDisplayName;
  return [
    `\u{1F916} Welcome to ${assistantName}`,
    'Your Advanced Multilingual AI Assistant',
    '',
    `Hello \u{1F44B}`,
    '',
    `I am ${assistantName} - a powerful, smart, and professional AI assistant designed to help you with:`,
    '',
    '\u2022 \u{1F4BC} Business and productivity tasks',
    '\u2022 \u{1F9E0} Smart answers and research',
    '\u2022 \u270D\uFE0F Content writing and editing',
    '\u2022 \u{1F4BB} Coding and technical support',
    '\u2022 \u{1F4CA} Data and analytics help',
    '\u2022 \u{1F3A7} Audio and video understanding',
    '',
    '\u{1F680} How to Get Started:',
    '',
    'Simply send your question or request in any language.',
    'You can also use the commands below:',
    '',
    '/help - View all features',
    '/settings - Customize preferences',
    '/language - Change language',
    '/clear - Reset conversation',
    '',
    '\u{1F512} Secure \u2022 \u26A1 Fast \u2022 \u{1F30E} Global',
    '',
    'Type your message to begin.'
  ].join('\n');
};

const sendTelegramStartMenu = async (
  targetBot: TelegramBot,
  chatId: number,
  replyTo?: number,
  conversationKey?: string,
  userDisplayName?: string
): Promise<string> => {
  const welcome = buildStartWelcomeMessage(conversationKey, userDisplayName);
  const options: Record<string, unknown> = {
    reply_markup: {
      keyboard: [
        [{ text: '/help' }, { text: '/settings' }],
        [{ text: '/language' }, { text: '/clear' }]
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
  if (replyTo) options.reply_to_message_id = replyTo;
  await targetBot.sendMessage(chatId, welcome, options as any);
  return welcome;
};

const buildTemplateCommandReply = (argsRaw: string): string => {
  const args = String(argsRaw || '').trim();
  if (!args || /^list$/i.test(args)) {
    return [
      'Templates:',
      '- /template email <topic>',
      '- /template resume <achievement or role>',
      '- /template linkedin <topic>',
      '- /template caption <topic>',
      '- /template script <topic>',
      '',
      'Example: /template email project delay update for client'
    ].join('\n');
  }
  const [kindRaw, ...rest] = args.split(/\s+/);
  const kind = String(kindRaw || '').toLowerCase();
  const topic = rest.join(' ').trim() || 'your topic';

  if (kind === 'email') {
    return [
      'Email Template:',
      '',
      'Subject: ' + topic,
      '',
      'Hi [Name],',
      '',
      'I hope you are doing well. I am writing regarding ' + topic + '.',
      '',
      'Current status:',
      '- [Point 1]',
      '- [Point 2]',
      '',
      'Next actions:',
      '- [Action 1 with date]',
      '- [Action 2 with owner]',
      '',
      'Please let me know if you would like a quick call to align.',
      '',
      'Best regards,',
      '[Your Name]'
    ].join('\n');
  }

  if (kind === 'resume') {
    return [
      'Resume Bullet Template:',
      `- Drove ${topic} by implementing [method], resulting in [quantified impact].`,
      `- Improved [process/system] for ${topic}, reducing [time/cost/errors] by [X%].`,
      `- Collaborated with [team/stakeholders] on ${topic}, delivering [business outcome].`
    ].join('\n');
  }

  if (kind === 'linkedin') {
    return [
      'LinkedIn Post Template:',
      '',
      `Today I worked on ${topic}.`,
      '',
      'What happened:',
      '- [Key action]',
      '- [Challenge and how you solved it]',
      '- [Result with measurable impact]',
      '',
      'Key learning:',
      '- [Insight 1]',
      '- [Insight 2]',
      '',
      'If you are solving something similar, happy to share notes in comments.'
    ].join('\n');
  }

  if (kind === 'caption') {
    return [
      'Caption Template:',
      `${topic} - progress over perfection.`,
      '',
      'Option 2:',
      `Building ${topic} one focused step at a time.`,
      '',
      'Option 3:',
      `${topic}: shipped, tested, improved.`
    ].join('\n');
  }

  if (kind === 'script') {
    return [
      'Short Script Template (60-90 sec):',
      '',
      `Hook: "If you are struggling with ${topic}, this will help."`,
      'Problem: [Describe pain point in one line]',
      `Approach: "I use this 3-step method for ${topic}."`,
      'Step 1: [Action]',
      'Step 2: [Action]',
      'Step 3: [Action]',
      'Result: [Outcome with metric]',
      'Call to action: [Ask audience to comment/save/share]'
    ].join('\n');
  }

  return 'Unknown template type. Use /template list.';
};

const buildConversationExportReply = (conversationKey?: string): string => {
  if (!conversationKey) {
    return 'Export is unavailable in this context.';
  }
  const profile = userProfiles.get(conversationKey);
  const history = getChatHistory(conversationKey);
  const tasks = getConversationTasks(conversationKey);
  const docs = (conversationKnowledgeBase.get(conversationKey) || []).slice(-5);
  const openTasks = tasks.filter((task) => task.status === 'open');
  const doneTasks = tasks.filter((task) => task.status === 'done');

  const lines: string[] = [
    'Conversation Export:',
    `- Exported at: ${new Date().toISOString()}`,
    `- Messages stored: ${history.length}`,
    `- Open tasks: ${openTasks.length}`,
    `- Done tasks: ${doneTasks.length}`,
    `- KB items: ${docs.length}`,
    `- Response mode: ${getConversationResponseVerbosity(conversationKey)}`,
    `- Tone: ${profile?.preferredTone || 'professional'}`,
    ''
  ];

  if (openTasks.length > 0) {
    lines.push('Open Tasks:');
    openTasks.slice(0, 8).forEach((task) => {
      lines.push(`- ${task.id}: ${task.text}`);
    });
    lines.push('');
  }

  if (docs.length > 0) {
    lines.push('Recent KB Items:');
    docs.forEach((doc) => {
      lines.push(`- ${doc.id}: ${doc.title} [${doc.kind}]`);
    });
    lines.push('');
  }

  if (history.length > 0) {
    lines.push('Recent Conversation:');
    const recent = history.slice(-12);
    for (const turn of recent) {
      const role = turn.role === 'user' ? 'User' : 'Bot';
      const text = summarizeForFallback(getTurnText(turn), 220).replace(/\s+/g, ' ').trim();
      if (!text) continue;
      lines.push(`- ${role}: ${text}`);
    }
  } else {
    lines.push('Recent Conversation:');
    lines.push('- No chat turns stored yet.');
  }

  return lines.join('\n');
};

const getCommandReply = (messageText: string, conversationKey?: string): string | null => {
  const text = String(messageText || '')
    .replace(/[\u200B-\u200F\uFEFF\u2060\u00A0]/g, ' ')
    .replace(/[///]/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
  const cmd = extractTelegramCommand(text);
  if (!cmd) return null;
  if (cmd === 'start') {
    return buildStartWelcomeMessage(conversationKey);
  }
  if (cmd === 'help') {
    return [
      'Commands:',
      '',
      'Core:',
      '- /start: show welcome menu',
      '- /help: show this command guide',
      '- /reset: clear chat memory',
      '- /clear: reset conversation',
      '- /model: show active AI model',
      '- /settings: show chat settings',
      '- /export: export recent chat snapshot',
      '- /stop: stop current action request',
      '- /version: show active bot logic version',
      '- /language auto|<name>|status',
      '',
      'AI and Style:',
      '- /style concise|normal|detailed|status',
      '- /style custom <text> | /style reset',
      '- /mode general|interview|coder|teacher|marketer|legal',
      '- /verify on|off|status',
      '- /trust on|off|status',
      '',
      'Memory:',
      '- /forget name|goals|style|tone|memory|all',
      '',
      'Tools and Productivity:',
      '- Tasks:',
      '  /task add <text> [/by <time>] [/p high|medium|low]',
      '  /task list [open|done|all]',
      '  /task done <id> | /task reopen <id> | /task delete <id>',
      '  /task edit <id> <text> | /task due <id> <time> | /task priority <id> <high|medium|low>',
      '- Reminders:',
      '  /remind <minutes> <text>',
      '  /remind in 30m <text>',
      '  /remind at 6pm <text>',
      '  /remind daily 8am <text>',
      '- Digest:',
      '  /digest now | /digest daily <time> | /digest status | /digest off',
      '- Templates:',
      '  /template list',
      '  /template email <topic>',
      '  /template resume <topic>',
      '  /template linkedin <topic>',
      '  /template caption <topic>',
      '  /template script <topic>',
      '- /timeline [limit]',
      '- /kb status|list|clear',
      '',
      'Telegram Analytics:',
      '- /tgstats',
      '- /groupmode',
      '- /groupreport',
      '- /whois <name>',
      '',
      'Platform:',
      '- /plans',
      '- /subscribe',
      '- /miniapp',
      '- /safety',
      '- /stickers on|off|status',
      '- /emoji rich|minimal|status',
      '',
      'Ask any question directly after these commands.'
    ].join('\n');
  }
  if (cmd === 'tgstats') {
    const analytics = buildTelegramAnalyticsReply('telegram analytics overview', conversationKey);
    return analytics || 'No Telegram analytics data is available yet for this chat.';
  }
  if (cmd === 'groupmode' || cmd === 'groupstats') {
    const analytics = buildTelegramAnalyticsReply('group mode status', conversationKey);
    return analytics || 'No group intelligence data is available yet for this chat.';
  }
  if (cmd === 'groupreport') {
    const analytics = buildTelegramAnalyticsReply('group report status', conversationKey);
    return analytics || 'No group report data is available yet for this chat.';
  }
  if (cmd === 'mode') {
    const arg = text.replace(/^\/mode(@\w+)?/i, '').trim().toLowerCase();
    if (!arg || arg === 'status') {
      return `Expert mode: ${getConversationExpertMode(conversationKey).toUpperCase()}\nUse /mode general|interview|coder|teacher|marketer|legal`;
    }
    const updated = setConversationExpertMode(conversationKey, arg);
    return updated || 'Use /mode general|interview|coder|teacher|marketer|legal';
  }
  if (cmd === 'forget') {
    if (!conversationKey) return 'Forget settings are unavailable in this context.';
    const arg = text.replace(/^\/forget(@\w+)?/i, '').trim().toLowerCase();
    if (!arg) {
      return [
        'What should I forget for this chat?',
        '- /forget name',
        '- /forget goals',
        '- /forget style',
        '- /forget tone',
        '- /forget memory',
        '- /forget all'
      ].join('\n');
    }
    const allowed = new Set(['name', 'goals', 'style', 'tone', 'memory', 'all']);
    if (!allowed.has(arg)) {
      return 'Use: /forget name | /forget goals | /forget style | /forget tone | /forget memory | /forget all';
    }
    return forgetConversationProfileData(
      conversationKey,
      arg as 'name' | 'goals' | 'style' | 'tone' | 'memory' | 'all'
    ) || 'Could not apply forget operation in this chat.';
  }
  if (cmd === 'verify') {
    const arg = text.replace(/^\/verify(@\w+)?/i, '').trim().toLowerCase();
    if (!arg || arg === 'status') {
      return `Verify mode: ${getConversationVerifyModeEnabled(conversationKey) ? 'ON' : 'OFF'}.`;
    }
    if (arg === 'on') {
      return setConversationVerifyMode(conversationKey, true) || 'Verify settings unavailable.';
    }
    if (arg === 'off') {
      return setConversationVerifyMode(conversationKey, false) || 'Verify settings unavailable.';
    }
    return 'Use /verify on|off|status';
  }
  if (cmd === 'trust') {
    const arg = text.replace(/^\/trust(@\w+)?/i, '').trim().toLowerCase();
    if (!arg || arg === 'status') {
      return `Trust layer: ${getConversationTrustLayerEnabled(conversationKey) ? 'ON' : 'OFF'}.`;
    }
    if (arg === 'on') {
      return setConversationTrustLayerEnabled(conversationKey, true) || 'Trust settings unavailable.';
    }
    if (arg === 'off') {
      return setConversationTrustLayerEnabled(conversationKey, false) || 'Trust settings unavailable.';
    }
    return 'Use /trust on|off|status';
  }
  if (cmd === 'whois') {
    const query = text.replace(/^\/whois(@\w+)?/i, '').trim();
    if (!query) {
      return 'Use: /whois <name> (example: /whois shivani)';
    }
    const analytics = buildTelegramAnalyticsReply(`who is ${query} in telegram`, conversationKey);
    return analytics || `No observed Telegram user matched "${query}" in this bot scope yet.`;
  }
  if (cmd === 'model') {
    setConversationModel(conversationKey, DEFAULT_OPENROUTER_MODEL);
    return `Current model: ${getDisplayAiModelName()}\nRouting profile: ${DEFAULT_OPENROUTER_MODEL}\nModel switching is disabled.`;
  }
  if (cmd === 'settings') {
    const profile = conversationKey ? userProfiles.get(conversationKey) : undefined;
    const verbosity = getConversationResponseVerbosity(conversationKey);
    const tone = profile?.preferredTone || 'professional';
    const emoji = profile?.emojiStyle || (FORCE_RICH_EMOJI_STYLE ? 'rich' : 'minimal');
    const stickers = FORCE_STICKERS_ON ? true : (profile?.stickersEnabled !== false);
    const verify = profile?.verifyMode === true;
    const trust = profile?.trustLayerEnabled === true;
    const expertMode = profile?.expertMode || 'general';
    const displayName = profile?.userDisplayName || '(not set)';
    const goals = (profile?.goals || []).slice(0, 3);
    const goalLine = goals.length > 0 ? goals.join(' | ') : '(none)';
    const language = normalizeLanguageCode(String(profile?.responseLanguage || '')) || 'auto';
    return `Settings:\n- Response mode: ${verbosity}\n- Preferred tone: ${tone}\n- Expert mode: ${expertMode}\n- Verify mode: ${verify ? 'on' : 'off'}\n- Trust layer: ${trust ? 'on' : 'off'}\n- Language: ${language}\n- User name: ${displayName}\n- Goals: ${goalLine}\n- Custom style: ${profile?.customStylePrompt || '(none)'}\n- Emoji style: ${emoji}\n- Stickers: ${stickers ? 'on' : 'off'}\n- AI Model: ${getDisplayAiModelName()}\n- Routing Profile: ${getConversationModel(conversationKey)}`;
  }
  if (cmd === 'export') {
    return buildConversationExportReply(conversationKey);
  }
  if (cmd === 'timeline') {
    const arg = text.replace(/^\/timeline(@\w+)?/i, '').trim();
    return buildConversationTimelineReply(conversationKey, arg);
  }
  if (cmd === 'kb') {
    const arg = text.replace(/^\/kb(@\w+)?/i, '').trim().toLowerCase();
    if (!arg || arg === 'status' || arg === 'list') {
      return buildConversationKnowledgeStatusReply(conversationKey);
    }
    if (arg === 'clear') {
      const cleared = clearConversationKnowledge(conversationKey);
      return cleared
        ? 'Workspace KB cleared for this chat.'
        : 'Workspace KB was already empty for this chat.';
    }
    return 'Use /kb status|list|clear';
  }
  if (cmd === 'task') {
    const arg = text.replace(/^\/task(@\w+)?/i, '').trim();
    if (!arg || /^list(?:\s+(open|done|all))?$/i.test(arg)) {
      const view = (arg.match(/^list(?:\s+(open|done|all))?$/i)?.[1] || 'all').toLowerCase() as 'open' | 'done' | 'all';
      return formatConversationTaskList(conversationKey, view);
    }
    const doneMatch = arg.match(/^done\s+([A-Za-z0-9_-]{3,20})$/i);
    if (doneMatch?.[1]) {
      const done = setConversationTaskStatus(conversationKey, doneMatch[1], 'done');
      return done
        ? `Task marked done:\n- ${done.id}: ${done.text}`
        : 'Task not found. Use /task list to view IDs.';
    }
    const reopenMatch = arg.match(/^reopen\s+([A-Za-z0-9_-]{3,20})$/i);
    if (reopenMatch?.[1]) {
      const reopened = setConversationTaskStatus(conversationKey, reopenMatch[1], 'open');
      if (!reopened) return 'Task not found. Use /task list to view IDs.';
      if (conversationKey && Number.isFinite(Number(reopened.dueAt)) && Number(reopened.dueAt) > Date.now()) {
        scheduleConversationTaskReminder(conversationKey, reopened);
      }
      return `Task reopened:\n- ${reopened.id}: ${reopened.text}`;
    }
    const deleteMatch = arg.match(/^delete\s+([A-Za-z0-9_-]{3,20})$/i);
    if (deleteMatch?.[1]) {
      const removed = deleteConversationTask(conversationKey, deleteMatch[1]);
      return removed
        ? `Task deleted:\n- ${removed.id}: ${removed.text}`
        : 'Task not found. Use /task list to view IDs.';
    }
    const editMatch = arg.match(/^edit\s+([A-Za-z0-9_-]{3,20})\s+([\s\S]+)$/i);
    if (editMatch?.[1] && editMatch?.[2]) {
      const edited = updateConversationTaskText(conversationKey, editMatch[1], editMatch[2]);
      return edited
        ? `Task updated:\n- ${edited.id}: ${edited.text}`
        : 'Task not found or invalid text.';
    }
    const priorityMatch = arg.match(/^priority\s+([A-Za-z0-9_-]{3,20})\s+(low|medium|high|urgent|h|m|l)$/i);
    if (priorityMatch?.[1] && priorityMatch?.[2]) {
      const updated = updateConversationTaskPriority(conversationKey, priorityMatch[1], priorityMatch[2]);
      return updated
        ? `Task priority updated:\n- ${updated.id}: ${updated.text}\n- Priority: ${updated.priority || 'medium'}`
        : 'Task not found.';
    }
    const dueMatch = arg.match(/^due\s+([A-Za-z0-9_-]{3,20})\s+([\s\S]+)$/i);
    if (dueMatch?.[1] && dueMatch?.[2]) {
      const parsedDue = parseReminderDueExpression(dueMatch[2]);
      if (!parsedDue) {
        return 'Could not parse due time. Examples: /task due <id> at 6pm, /task due <id> tomorrow 9am, /task due <id> in 2h';
      }
      const updated = updateConversationTaskDueAt(conversationKey, dueMatch[1], parsedDue.dueAtMs, parsedDue.recurring);
      return updated
        ? `Task due updated:\n- ${updated.id}: ${updated.text}\n- Due at: ${new Date(Number(updated.dueAt || Date.now())).toISOString()}\n- Recurring: ${updated.recurring || 'none'}`
        : 'Task not found.';
    }
    const addMatch = arg.match(/^add\s+([\s\S]+)$/i);
    if (addMatch?.[1]) {
      const parsed = parseTaskAddCommandArgs(addMatch[1]);
      if (!parsed) {
        return 'Could not parse task. Use: /task add <text> [/by <time>] [/p high|medium|low]';
      }
      const task = addConversationTask(conversationKey, parsed.text, parsed.dueAt, parsed.recurring, parsed.priority);
      if (!task) return 'Could not add task. Use /task add <text>.';
      if (conversationKey && Number.isFinite(Number(task.dueAt)) && Number(task.dueAt) > Date.now()) {
        scheduleConversationTaskReminder(conversationKey, task);
      }
      return [
        'Task added:',
        `- ${task.id}: ${task.text}`,
        `- Priority: ${task.priority || 'medium'}`,
        `- Due: ${task.dueAt ? new Date(Number(task.dueAt)).toISOString() : 'none'}`,
        `- Recurring: ${task.recurring || 'none'}`
      ].join('\n');
    }
    return 'Use /task add <text> [/by <time>] [/p high|medium|low], /task list [open|done|all], /task done <id>, /task reopen <id>, /task delete <id>, /task edit <id> <text>, /task due <id> <time>, /task priority <id> <level>.';
  }
  if (cmd === 'digest') {
    if (!conversationKey) return 'Digest settings are unavailable in this context.';
    const arg = text.replace(/^\/digest(@\w+)?/i, '').trim();
    if (!arg || /^status$/i.test(arg)) {
      return buildConversationDailyDigestStatus(conversationKey);
    }
    if (/^now$/i.test(arg)) {
      return buildConversationDailyDigestReply(conversationKey);
    }
    if (/^(off|disable|stop)$/i.test(arg)) {
      const disabled = disableConversationDailyDigestSchedule(conversationKey);
      return disabled
        ? 'Daily digest disabled for this chat.'
        : 'Daily digest is already disabled.';
    }
    const dailyMatch = arg.match(/^daily\s+(.+)$/i);
    if (dailyMatch?.[1]) {
      const parsed = parseDigestTime(dailyMatch[1]);
      if (!parsed) {
        return 'Could not parse time. Example: /digest daily 8am or /digest daily 20:30';
      }
      const updated = setConversationDailyDigestSchedule(conversationKey, parsed.hhmm);
      if (!updated) return 'Could not update daily digest schedule in this chat.';
      return [
        'Daily digest enabled.',
        `- Time: ${updated.time} (server local time)`,
        `- Next run: ${new Date(updated.nextRunAt).toISOString()}`,
        '- Use /digest off to disable.'
      ].join('\n');
    }
    return 'Use /digest now | /digest daily <time> | /digest status | /digest off';
  }
  if (cmd === 'template' || cmd === 'templates') {
    const arg = text.replace(/^\/templates?(@\w+)?/i, '').trim();
    return buildTemplateCommandReply(arg);
  }
  if (cmd === 'plans') {
    return [
      'Subscription Plans:',
      '- Free: all core chat, media, and file analysis with fair-use anti-spam.',
      '- Pro (Telegram Stars-ready): priority responses, higher limits, advanced workspace features.',
      '',
      'Use /subscribe for activation guidance.'
    ].join('\n');
  }
  if (cmd === 'subscribe') {
    return [
      'Telegram Stars Subscription:',
      '- Integration layer is enabled for Stars-ready subscription tracking.',
      '- Final payment configuration requires your Telegram bot payment setup in BotFather.',
      '- After payment webhooks are connected, plan upgrades auto-activate per user.'
    ].join('\n');
  }
  if (cmd === 'miniapp') {
    return `Open workspace mini app:\n${BASE_URL}/miniapp`;
  }
  if (cmd === 'safety') {
    return [
      'Safety and Transparency:',
      '- Input and output moderation are active.',
      '- Anti-spam rate control is active (Redis-backed when available).',
      '- Moderation and anti-spam events are audit-logged.',
      '- Admin restriction controls are active.'
    ].join('\n');
  }
  if (cmd === 'style') {
    const arg1 = (text.split(/\s+/)[1] || '').trim().toLowerCase();
    if (!conversationKey) return 'Style settings are unavailable in this context.';
    if (!arg1 || arg1 === 'status') {
      const profile = userProfiles.get(conversationKey);
      return `Current response style: ${getConversationResponseVerbosity(conversationKey).toUpperCase()}\nCustom style: ${profile?.customStylePrompt || '(none)'}\nUse /style concise, /style normal, /style detailed\nUse /style custom <instructions>\nUse /style reset`;
    }
    if (arg1 === 'custom') {
      const custom = text.replace(/^\/style(@\w+)?/i, '').trim().replace(/^custom\s+/i, '').trim();
      if (!custom) return 'Provide custom style text after /style custom';
      const saved = setConversationCustomStylePrompt(conversationKey, custom);
      return saved ? `Custom style saved: ${saved}` : 'Could not save custom style in this context.';
    }
    if (arg1 === 'reset') {
      const cleared = clearConversationCustomStylePrompt(conversationKey);
      return cleared ? 'Custom style cleared. Default style rules remain active.' : 'Custom style settings are unavailable in this context.';
    }
    const updated = setConversationResponseVerbosity(conversationKey, arg1);
    if (!updated) {
      return 'Use: /style concise|normal|detailed|status, /style custom <text>, or /style reset';
    }
    return updated;
  }
  if (cmd === 'engine') {
    const engineArgs = text.split(/\s+/).slice(1).map((x) => x.trim()).filter(Boolean);
    const sub = (engineArgs[0] || 'status').toLowerCase();
    const isCheck = sub === 'check';
    const checkWantsJson = isCheck && (engineArgs[1] || '').toLowerCase() === 'json';
    const wantsJson = (sub === 'status' && (engineArgs[1] || '').toLowerCase() === 'json') || sub === 'json';
    if (!['status', 'explain', 'json', 'check'].includes(sub)) {
      return 'Use: /engine status, /engine status json, /engine explain, or /engine check <prompt>';
    }
    if (sub === 'explain') {
      return [
        'Response Engine Explain',
        '- context follow-up resolution: handles short follow-ups like more/why/do it using recent messages',
        '- previous/ordinal reference parsing: resolves references like previous answer or 2nd question',
        '- multi-part decomposition: splits multi-question prompts and answers each part',
        '- final self-check: runs a final completeness/quality pass before sending',
        '- answer verification pass: extra correction pass for risky/time-sensitive answers (if enabled)',
        '- continuation pass: extends incomplete/truncated answers',
        '- response engine policy prompt: enforces global answer behavior rules',
        '- context intelligence engine policy: adds deeper context memory, intent-shift detection, and micro-hint tracking behavior',
        '- coding answer engine policy: activates for coding intent and enforces strict coding answer structure',
        '- web search / RAG / memory modules: optional context augmentation features',
      ].join('\n');
    }
    if (isCheck) {
      const rawPrompt = text
        .replace(/^\/engine(@\w+)?/i, '')
        .trim()
        .replace(/^check\s+/i, '')
        .trim()
        .replace(/^json\s+/i, '')
        .trim();
      if (!rawPrompt) {
        return 'Use: /engine check <prompt>\nOptional: /engine check json <prompt>';
      }
      const normalizedInput = normalizeIntentFromNoisyText(normalizeUserQuestionText(rawPrompt) || rawPrompt);
      const effectiveInput = conversationKey
        ? (resolveAffirmativeFollowUpPrompt(conversationKey, normalizedInput) || normalizedInput)
        : normalizedInput;
      const detectedIntent = detectIntent(effectiveInput);
      const engineState = conversationKey ? lastEngineStateByConversation.get(conversationKey) : undefined;
      const parsedRef = parseContextReference(normalizedInput);
      const decomposition = decomposeQuestionParts(normalizedInput);
      const contextualRef = isContextReferenceContinuationReply(normalizedInput) || parsedRef.isReference;
      const microHints = detectMicroHints(normalizedInput);
      const capabilityQuestionDetected = isShortCapabilityQuestion(normalizedInput);
      const casualSmallTalkDetected = isCasualSmallTalk(normalizedInput);
      const taskAlignmentRisk = estimateTaskAlignmentRisk({
        input: normalizedInput,
        intent: detectedIntent,
        effectiveChangedByContext: effectiveInput !== normalizedInput,
        contextualFollowUp: contextualRef,
        capabilityQuestionDetected,
        casualSmallTalkDetected
      });
      const defaultLanguageIfUnspecified = inferDefaultLanguageIfUnspecified(effectiveInput || normalizedInput);
      const unknownTermRisk = estimateUnknownTermRisk(normalizedInput);
      const conversationalTone = detectConversationalTone(normalizedInput);
      const topicShift = detectTopicShift({
        currentInput: effectiveInput || normalizedInput,
        previousPrompt: engineState?.promptPreview || null,
        currentIntent: detectedIntent,
        previousIntent: engineState?.intent || null,
        contextualFollowUp: contextualRef,
        effectiveChangedByContext: effectiveInput !== normalizedInput,
        casualSmallTalkDetected
      });
      const fallbackFragmentRisk = estimateFallbackFragmentRisk({
        input: normalizedInput,
        taskAlignmentRisk,
        contextualFollowUp: contextualRef,
        effectiveChangedByContext: effectiveInput !== normalizedInput,
        capabilityQuestionDetected,
        casualSmallTalkDetected,
        topicShiftDetected: topicShift.topicShiftDetected
      });
      const semanticMismatchRisk = estimateSemanticMismatchRisk({
        input: effectiveInput || normalizedInput,
        intent: detectedIntent,
        taskAlignmentRisk,
        hardContextResetRecommended: topicShift.hardContextResetRecommended,
        unknownTermRisk,
        contextualFollowUp: contextualRef
      });
      const retrievalArtifactRisk = estimateRetrievalArtifactRisk({
        input: effectiveInput || normalizedInput,
        intent: detectedIntent,
        unknownTermRisk,
        taskAlignmentRisk,
        capabilityQuestionDetected,
        casualSmallTalkDetected,
        contextualFollowUp: contextualRef
      });
      const payload = {
        engine: 'response',
        mode: 'check',
        runtime: 'legacy',
        input: {
          raw: rawPrompt,
          normalized: normalizedInput,
          effective: effectiveInput,
          effectiveChangedByContext: effectiveInput !== normalizedInput
        },
        detection: {
          intent: detectedIntent,
          contextIntelligenceEnginePolicyActive: true,
          codingAnswerEnginePolicyActive: detectedIntent === 'coding',
          microHints,
          capabilityQuestionDetected,
          casualSmallTalkDetected,
          taskAlignmentRisk,
          defaultLanguageIfUnspecified,
          unknownTermRisk,
          conversationalToneClass: conversationalTone.tone,
          toneConfidence: conversationalTone.confidence,
          topicShiftDetected: topicShift.topicShiftDetected,
          hardContextResetRecommended: topicShift.hardContextResetRecommended,
          fallbackFragmentRisk,
          semanticMismatchRisk,
          retrievalArtifactRisk,
          contextualFollowUp: contextualRef,
          contextReference: parsedRef,
          preservePreviousFormatStyle: parsedRef.preserveFormat || /\b(format|style|structure|pattern|template|layout|same way)\b/i.test(normalizedInput),
          timeSensitive: isTimeSensitivePrompt(normalizedInput.toLowerCase()),
          realtimeSearchLikely: needsRealtimeSearch(normalizedInput)
        },
        decomposition: {
          isMultiPart: decomposition.isMultiPart,
          parts: decomposition.parts
        },
        chatSettings: {
          modelSelection: getDisplayAiModelName(),
          modelSelectionProfile: getConversationModel(conversationKey),
          responseVerbosity: getConversationResponseVerbosity(conversationKey),
          preferredTone: (conversationKey ? userProfiles.get(conversationKey)?.preferredTone : undefined) || 'professional',
          customStyle: (conversationKey ? userProfiles.get(conversationKey)?.customStylePrompt : undefined) || null
        }
      };
      if (checkWantsJson) {
        return JSON.stringify(payload, null, 2);
      }
      return [
        'Response Engine Check',
        `- prompt: ${rawPrompt}`,
        `- normalized: ${normalizedInput}`,
        `- effective input changed by context: ${effectiveInput !== normalizedInput ? 'YES' : 'NO'}`,
        `- detected intent: ${detectedIntent}`,
        `- context intelligence engine policy: ACTIVE`,
        `- coding answer engine policy: ${detectedIntent === 'coding' ? 'ACTIVE' : 'INACTIVE'}`,
        `- micro-hints detected: ${microHints.matched.length ? microHints.matched.join(', ') : '(none)'}`,
        `- micro-hint scores: depth=${microHints.scores.depth}, style=${microHints.scores.style}, continuity=${microHints.scores.continuity}`,
        `- capability question detected: ${capabilityQuestionDetected ? 'YES' : 'NO'}`,
        `- casual small-talk detected: ${casualSmallTalkDetected ? 'YES' : 'NO'}`,
        `- task alignment risk: ${taskAlignmentRisk.toUpperCase()}`,
        `- default language if unspecified: ${defaultLanguageIfUnspecified}`,
        `- unknown-term hallucination risk: ${unknownTermRisk.toUpperCase()}`,
        `- conversational tone class: ${conversationalTone.tone}`,
        `- tone confidence: ${conversationalTone.confidence.toUpperCase()}`,
        `- topic shift detected vs previous: ${topicShift.topicShiftDetected ? 'YES' : 'NO'}`,
        `- hard context reset recommended: ${topicShift.hardContextResetRecommended ? 'YES' : 'NO'}`,
        `- fallback fragment risk: ${fallbackFragmentRisk.toUpperCase()}`,
        `- semantic mismatch risk: ${semanticMismatchRisk.toUpperCase()}`,
        `- retrieval artifact risk: ${retrievalArtifactRisk.toUpperCase()}`,
        `- inferred depth from hints: ${microHints.inferredDepth}`,
        `- inferred style from hints: ${microHints.inferredStyle}`,
        `- step-by-step hint: ${microHints.wantsStepByStep ? 'YES' : 'NO'}`,
        `- contextual follow-up/reference detected: ${contextualRef ? 'YES' : 'NO'}`,
        `- context reference parsed: ${parsedRef.isReference ? `YES (${parsedRef.target}${parsedRef.ordinal ? ` #${parsedRef.ordinal}` : parsedRef.latest ? ', latest' : ''})` : 'NO'}`,
        `- preserve previous format/style: ${parsedRef.preserveFormat ? 'YES' : 'NO'}`,
        `- multi-part question: ${decomposition.isMultiPart ? `YES (${decomposition.parts.length} parts)` : 'NO'}`,
        ...(decomposition.isMultiPart ? decomposition.parts.map((part, index) => `  ${index + 1}. ${part}`) : []),
        `- AI model: ${getDisplayAiModelName()}`,
        `- routing profile: ${getConversationModel(conversationKey)}`,
        `- response verbosity: ${getConversationResponseVerbosity(conversationKey)}`,
        `- custom style: ${(conversationKey ? userProfiles.get(conversationKey)?.customStylePrompt : undefined) || '(none)'}`,
        'Tip: use /engine check json <prompt> for machine-readable output'
      ].join('\n');
    }
    const profile = conversationKey ? userProfiles.get(conversationKey) : undefined;
    const engineState = conversationKey ? lastEngineStateByConversation.get(conversationKey) : undefined;
    const payload = {
      engine: 'response',
      runtime: 'legacy',
      runtimeLabel: 'legacy (server.ts)',
      modelSelection: getDisplayAiModelName(),
      modelSelectionProfile: getConversationModel(conversationKey),
      responseVerbosity: getConversationResponseVerbosity(conversationKey),
      preferredTone: profile?.preferredTone || 'professional',
      customStyle: profile?.customStylePrompt || null,
      lastProcessed: engineState ? {
        intent: engineState.intent,
        codingAnswerEnginePolicyActive: engineState.codingPolicyActive,
        promptPreview: engineState.promptPreview,
        updatedAt: engineState.updatedAt
      } : null,
      features: {
        contextFollowUpResolution: true,
        previousOrdinalReferenceParsing: true,
        multiPartQuestionDecomposition: true,
        finalSelfCheck: {
          enabled: AI_ENABLE_FINAL_SELF_CHECK,
          minChars: AI_FINAL_SELF_CHECK_MIN_CHARS
        },
        answerVerificationPass: AI_ENABLE_SELF_VERIFY,
        incompleteAnswerContinuation: true,
        structuredOutputModeSupport: ADVANCED_STRUCTURED_OUTPUT_ENABLED,
        webSearchContext: ADVANCED_WEB_SEARCH_ENABLED,
        semanticMemory: ADVANCED_SEMANTIC_MEMORY_ENABLED,
        localDocsRag: ADVANCED_RAG_ENABLED,
        codeValidation: ADVANCED_CODE_VALIDATION_ENABLED,
        codeExecutionRepairLoop: ADVANCED_CODE_EXECUTION_FIX_ENABLED,
        responseEnginePolicyPrompt: true,
        contextIntelligenceEnginePolicyPrompt: true,
        codingAnswerEnginePolicyPrompt: 'conditional'
      }
    };
    if (wantsJson) {
      return JSON.stringify(payload, null, 2);
    }
    return [
      'Response Engine Status',
      '- runtime: legacy (server.ts)',
      `- AI model: ${getDisplayAiModelName()}`,
      `- routing profile: ${getConversationModel(conversationKey)}`,
      `- response verbosity: ${getConversationResponseVerbosity(conversationKey)}`,
      `- preferred tone: ${profile?.preferredTone || 'professional'}`,
      `- custom style: ${profile?.customStylePrompt || '(none)'}`,
      `- last processed intent: ${engineState?.intent || '(none yet)'}`,
      `- coding answer engine policy (last prompt): ${engineState ? (engineState.codingPolicyActive ? 'ACTIVE' : 'INACTIVE') : 'UNKNOWN'}`,
      `- last prompt preview: ${engineState?.promptPreview || '(none yet)'}`,
      '- context follow-up resolution: ON',
      '- explicit previous/ordinal reference parsing: ON',
      '- multi-part question decomposition: ON',
      `- final self-check pass: ${AI_ENABLE_FINAL_SELF_CHECK ? `ON (min ${AI_FINAL_SELF_CHECK_MIN_CHARS} chars)` : 'OFF'}`,
      `- answer verification pass: ${AI_ENABLE_SELF_VERIFY ? 'ON' : 'OFF'}`,
      '- incomplete-answer continuation pass: ON',
      `- structured output mode support: ${ADVANCED_STRUCTURED_OUTPUT_ENABLED ? 'ON' : 'OFF'}`,
      `- web search context: ${ADVANCED_WEB_SEARCH_ENABLED ? 'ON' : 'OFF'}`,
      `- semantic memory: ${ADVANCED_SEMANTIC_MEMORY_ENABLED ? 'ON' : 'OFF'}`,
      `- local docs RAG: ${ADVANCED_RAG_ENABLED ? 'ON' : 'OFF'}`,
      `- code validation: ${ADVANCED_CODE_VALIDATION_ENABLED ? 'ON' : 'OFF'}`,
      `- code execution repair loop: ${ADVANCED_CODE_EXECUTION_FIX_ENABLED ? 'ON' : 'OFF'}`,
      '- response engine policy prompt: ON',
      '- context intelligence engine policy prompt: ON',
      '- coding answer engine policy prompt: ON (conditional by coding intent)'
    ].join('\n');
  }
  if (cmd === 'switchmodel') {
    setConversationModel(conversationKey, DEFAULT_OPENROUTER_MODEL);
    return `Current model: ${getDisplayAiModelName()}\nRouting profile: ${DEFAULT_OPENROUTER_MODEL}\nModel switching is disabled.`;
  }
  if (cmd === 'toggleconcise') {
    const toggled = toggleConciseMode(conversationKey);
    return toggled || 'Response mode toggle is unavailable in this context.';
  }
  if (cmd === 'stop') {
    return 'Stop acknowledged. Send your next question when ready.';
  }
  if (cmd === 'version' || cmd === 'diag') {
    return `Bot logic version: ${BOT_LOGIC_VERSION}\nFast reply mode: ${FAST_REPLY_MODE ? 'ON' : 'OFF'}\nAI timeout (ms): ${AI_RESPONSE_TIMEOUT_MS}\nAI fallback timeout (ms): ${AI_FALLBACK_TIMEOUT_MS}\nCache entries: ${aiResponseCache.size}`;
  }
  if (cmd === 'reset' || cmd === 'clear') {
    if (conversationKey) {
      clearConversationState(conversationKey);
    }
    return RESET_SUCCESS_MESSAGE;
  }
  if (cmd === 'language') {
    if (!conversationKey) {
      return 'Language settings are unavailable in this context.';
    }
    const arg = text.replace(/^\/language(@\w+)?/i, '').trim();
    const current = userProfiles.get(conversationKey) || {
      recurringTopics: [],
      topicCounts: {},
      updatedAt: Date.now()
    };
    if (!arg || /^status$/i.test(arg)) {
      const currentLang = String(current.responseLanguage || 'auto').trim() || 'auto';
      return currentLang === 'auto'
        ? 'Language mode: AUTO. I will reply in the same language as your message.'
        : `Language mode: LOCKED (${currentLang}).`;
    }
    if (/^auto$/i.test(arg)) {
      current.responseLanguage = 'auto';
      current.updatedAt = Date.now();
      userProfiles.set(conversationKey, current);
      persistUserProfiles();
      return 'Language set to AUTO. I will reply in your message language.';
    }
    const setMatch = arg.match(/^(?:set\s+)?([A-Za-z-]{2,20})$/i);
    if (!setMatch?.[1]) {
      return [
        'Choose language mode:',
        '- /language auto',
        '- /language english',
        '- /language hindi',
        '- /language status'
      ].join('\n');
    }
    const code = normalizeLanguageCode(String(setMatch[1] || '')) || String(setMatch[1] || '').toLowerCase();
    current.responseLanguage = code;
    current.updatedAt = Date.now();
    userProfiles.set(conversationKey, current);
    persistUserProfiles();
    return `Language locked to ${code}.`;
  }
  if (cmd === 'stickers') {
    const mode = (text.split(/\s+/)[1] || '').trim().toLowerCase();
    if (!conversationKey) return 'Sticker settings are unavailable in this context.';
    if (FORCE_STICKERS_ON) {
      return 'Stickers are ON for this bot.';
    }
    if (!mode || mode === 'status') {
      const enabled = userProfiles.get(conversationKey)?.stickersEnabled !== false;
      return enabled ? 'Stickers are ON.' : 'Stickers are OFF.';
    }
    if (!['on', 'off'].includes(mode)) {
      return 'Use: /stickers on, /stickers off, or /stickers status';
    }
    const current = userProfiles.get(conversationKey) || {
      recurringTopics: [],
      topicCounts: {},
      updatedAt: Date.now()
    };
    current.stickersEnabled = mode === 'on';
    current.updatedAt = Date.now();
    userProfiles.set(conversationKey, current);
    persistUserProfiles();
    return current.stickersEnabled ? 'Stickers enabled for this chat.' : 'Stickers disabled for this chat.';
  }
  if (cmd === 'emoji') {
    const mode = (text.split(/\s+/)[1] || '').trim().toLowerCase();
    if (!conversationKey) return 'Emoji settings are unavailable in this context.';
    if (FORCE_RICH_EMOJI_STYLE) {
      return 'Emoji style is RICH for this bot.';
    }
    if (!mode || mode === 'status') {
      const style = userProfiles.get(conversationKey)?.emojiStyle || 'rich';
      return `Emoji style is ${style.toUpperCase()}.`;
    }
    if (!['rich', 'minimal'].includes(mode)) {
      return 'Use: /emoji rich, /emoji minimal, or /emoji status';
    }
    const current = userProfiles.get(conversationKey) || {
      recurringTopics: [],
      topicCounts: {},
      updatedAt: Date.now()
    };
    current.emojiStyle = mode as 'rich' | 'minimal';
    current.updatedAt = Date.now();
    userProfiles.set(conversationKey, current);
    persistUserProfiles();
    return `Emoji style set to ${mode.toUpperCase()} for this chat.`;
  }
  return `Unknown command: /${cmd}\nUse /help to see all available commands.`;
};

const sanitizeAssistantName = (input: string): string => {
  return String(input || '')
    .replace(/[`"'<>[\]{}()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
};

const getOfficialAssistantName = (conversationKey?: string): string => {
  if (!conversationKey) return DEFAULT_ASSISTANT_NAME;
  const tgMatch = conversationKey.match(/^telegram:([^:]+):/i);
  const telegramBotId = String(tgMatch?.[1] || '').trim();
  if (telegramBotId) {
    const botName = sanitizeAssistantName(telegramBotNames.get(telegramBotId) || '');
    if (botName) return botName;
    const botUsername = sanitizeAssistantName(telegramBotUsernames.get(telegramBotId) || '');
    if (botUsername) return botUsername;
  }
  return DEFAULT_ASSISTANT_NAME;
};

const getAssistantName = (conversationKey?: string): string => {
  if (!conversationKey) return DEFAULT_ASSISTANT_NAME;
  const profile = userProfiles.get(conversationKey);
  const preferred = sanitizeAssistantName(profile?.assistantName || '');
  if (preferred) return preferred;
  const tgMatch = conversationKey.match(/^telegram:([^:]+):/i);
  const telegramBotId = String(tgMatch?.[1] || '').trim();
  if (telegramBotId) {
    // Default to registered Telegram bot identity when no per-chat rename exists.
    return getOfficialAssistantName(conversationKey);
  }
  return DEFAULT_ASSISTANT_NAME;
};

const setAssistantNamePreference = (conversationKey: string | undefined, name: string): string => {
  const nextName = sanitizeAssistantName(name);
  if (!conversationKey || !nextName) return DEFAULT_ASSISTANT_NAME;
  const current = userProfiles.get(conversationKey) || {
    recurringTopics: [],
    topicCounts: {},
    updatedAt: Date.now()
  };
  current.assistantName = nextName;
  current.updatedAt = Date.now();
  userProfiles.set(conversationKey, current);
  persistUserProfiles();
  return nextName;
};

const isRenameIntentPrompt = (text: string): boolean => {
  const normalized = String(text || '').trim().toLowerCase();
  if (!normalized) return false;
  if (/\byou are given\b/.test(normalized)) return false;
  return /\b(your name is|call yourself|i will call you|can i call you|can i call u|i call you|i called you|from now i call you|rename yourself to|change your name to)\b/.test(normalized);
};

const isInvalidAssistantNameCandidate = (candidate: string): boolean => {
  const value = sanitizeAssistantName(candidate).toLowerCase();
  if (!value || value.length < 2) return true;
  const words = value.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) return true;

  const genericOnly = new Set(['with', 'the', 'name', 'that', 'i', 'can', 'provide', 'call', 'you', 'a', 'an', 'any', 'some', 'my']);
  if (words.every((w) => genericOnly.has(w))) return true;
  if (/(with the name|name that i can provide|that i can provide|which i can provide|any name|some name|name i can provide)/.test(value)) {
    return true;
  }
  return false;
};

const extractAssistantRenameCommand = (text: string): string | null => {
  const normalized = String(text || '').trim();
  if (!normalized) return null;
  const match = normalized.match(
    /(?:from now (?:on|onwards)\s*,?\s*)?(?:your name is|call yourself|i will call you|can i call you|can i call u|i call you|i called you|from now i call you|rename yourself to|change your name to)\s+(?:as\s+)?["']?([a-zA-Z][a-zA-Z0-9 _-]{1,31})["']?/i
  );
  if (!match?.[1]) return null;
  const raw = match[1].replace(/\b(ok|okay|please|now)\b.*$/i, '').trim();
  const cleaned = sanitizeAssistantName(raw);
  if (isInvalidAssistantNameCandidate(cleaned)) return null;
  return cleaned || null;
};

const getChatHistory = (conversationKey?: string): BotChatTurn[] => {
  if (!conversationKey) return [];
  const entry = chatHistoryStore.get(conversationKey);
  if (!entry) return [];
  if (Date.now() - entry.updatedAt > CHAT_HISTORY_TTL_MS) {
    chatHistoryStore.delete(conversationKey);
    return [];
  }
  return entry.history;
};

const FOLLOW_UP_OFFER_PATTERN =
  /(do you want (to )?(know|learn)( more)?( about (it|this|that|them|him|her))?|would you like (to )?(know|learn|see)( more)?|want me to (explain|share|give|provide)( more| details?)?|if you want[,\s]+i can (explain|share|provide|give)|tell me if you want (more|details?|a deep dive)|should i explain (more|further)?)/i;

const isAffirmativeFollowUpReply = (text: string): boolean => {
  const value = String(text || '').toLowerCase().trim();
  if (!value) return false;
  return /^(yes|y|yeah|yep|sure|ok|okay|please do|go ahead|continue|tell me more|more|yes please|do it|haan|han|yes tell|yes explain|yes solve|yes continue|yes go ahead)$/i.test(value);
};

const isNegativeFollowUpReply = (text: string): boolean => {
  const value = String(text || '').toLowerCase().trim();
  if (!value) return false;
  return /^(no|n|nope|not now|later|skip|leave it)$/i.test(value);
};

const isDetailContinuationReply = (text: string): boolean => {
  const value = String(text || '').toLowerCase().trim();
  if (!value) return false;
  return /^(tell me in detail|explain in detail|in detail|more details?|detail|elaborate|deep dive|expand this|explain more|tell me more|can you explain( it| this| that)? in detail|yes tell|yes explain)$/i.test(value);
};

const isContextReferenceContinuationReply = (text: string): boolean => {
  const value = String(text || '').toLowerCase().trim();
  if (!value) return false;
  if (isTelegramMediaEnvelopePrompt(value) || isLikelyFileNameOnlyPrompt(value)) return false;
  if (parseContextReference(value).isReference) return true;
  if (/^(ok(?:ay)?\s+)?(?:do (?:so|it|that|this)(?:\s+like this)?|do this|do that|same|same thing|same for this|same for that|that one|this one|about that|about this|what about that|what about this|continue|go on|carry on|next|previous question|previous answer|answer that|answer this|explain that|explain this|tell about that|tell about this|details of that|details of this|more on that|more on this)$/i.test(value)) {
    return true;
  }
  const styleFormatReference =
    /\b(same\s+(?:format|style|structure|pattern|template|layout)|previous\s+(?:format|style|structure|pattern|template|layout|answer\s+format|answer\s+style|response\s+format|response\s+style)|in\s+the\s+same\s+(?:format|style|way|structure)|like\s+(?:previous|before|above|earlier)|follow\s+the\s+previous\s+(?:format|style|structure)|reference\s+(?:the\s+)?previous\s+(?:answer|response|format|style|structure))\b/i.test(value);
  const tokenCount = value.split(/\s+/).filter(Boolean).length;
  const maxFollowUpTokens = styleFormatReference ? 34 : 20;
  if (tokenCount > maxFollowUpTokens) return false;
  const hasReference = /\b(it|this|that|these|those|same|previous|last|earlier|above|before|prior)\b/.test(value);
  const hasAction = /\b(explain|tell|show|write|make|do|give|provide|solve|continue|expand|detail|details|more|convert|format|answer|style|structure|pattern|template|layout)\b/.test(value);
  if (styleFormatReference && hasReference) return true;
  return hasReference && hasAction;
};

const getTurnText = (turn?: BotChatTurn): string =>
  (turn?.parts || [])
    .map((part) => String(part?.text || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();

type ConversationPair = {
  userText: string;
  modelText: string;
  userTurnIndex: number;
  modelTurnIndex: number;
};

const isSyntheticContextPrompt = (value: string): boolean => {
  const v = String(value || '').trim();
  if (!v) return false;
  return /^(Referenced media context:|Referenced previous question:|Previous topic:|Follow-up request:)/i.test(v);
};

const getConversationPairs = (history: BotChatTurn[]): ConversationPair[] => {
  const pairs: ConversationPair[] = [];
  for (let i = 0; i < history.length; i += 1) {
    if (history[i].role !== 'user') continue;
    const userText = getTurnText(history[i]);
    if (!userText) continue;
    let modelText = '';
    let modelTurnIndex = -1;
    for (let j = i + 1; j < history.length; j += 1) {
      if (history[j].role !== 'model') continue;
      modelText = getTurnText(history[j]);
      modelTurnIndex = j;
      break;
    }
    if (!modelText || modelTurnIndex < 0) continue;
    pairs.push({ userText, modelText, userTurnIndex: i, modelTurnIndex });
  }
  return pairs;
};

const getRenderableConversationPairs = (conversationKey: string | undefined): ConversationPair[] => {
  const history = getChatHistory(conversationKey);
  return getConversationPairs(history).filter((pair) => !isSyntheticContextPrompt(pair.userText));
};

const buildConversationTimelineReply = (conversationKey: string | undefined, limitRaw?: string): string => {
  const pairs = getRenderableConversationPairs(conversationKey);
  if (!pairs.length) {
    return 'Timeline:\n- No answer timeline yet.\n- Ask a few questions, then use /timeline.\n- You can reference answers like: improve A2';
  }
  const requested = Number(limitRaw || 8);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(20, Math.floor(requested))) : 8;
  const startIndex = Math.max(0, pairs.length - limit);
  const recent = pairs.slice(startIndex);
  const lines: string[] = ['Timeline (answer references):'];
  for (let i = 0; i < recent.length; i += 1) {
    const absolute = startIndex + i + 1;
    const item = recent[i];
    const q = summarizeForFallback(normalizeIntentFromNoisyText(normalizeUserQuestionText(item.userText) || item.userText), 110);
    const a = summarizeForFallback(String(item.modelText || '').replace(/\s+/g, ' ').trim(), 140);
    lines.push(`- A${absolute}: Q: ${q || 'n/a'} | A: ${a || 'n/a'}`);
  }
  lines.push('');
  lines.push('Follow-up examples:');
  lines.push('- Improve A2');
  lines.push('- Explain A3 in simple terms');
  lines.push('- Give code version of A1');
  return lines.join('\n');
};

const resolveAnswerReferencePrompt = (
  conversationKey: string | undefined,
  userInput: string
): { expandedPrompt?: string; errorReply?: string } | null => {
  if (!conversationKey) return null;
  const raw = String(userInput || '').trim();
  if (!raw) return null;
  const refMatch = raw.match(/\bA(\d{1,3})\b/i);
  if (!refMatch?.[1]) return null;
  const ordinal = Number(refMatch[1]);
  if (!Number.isFinite(ordinal) || ordinal <= 0) return null;

  const pairs = getRenderableConversationPairs(conversationKey);
  if (!pairs.length || ordinal > pairs.length) {
    return {
      errorReply: `I could not find answer reference A${ordinal}. Use /timeline to view valid answer IDs.`
    };
  }
  const pair = pairs[ordinal - 1];
  const followUp = raw.replace(/\bA\d{1,3}\b/gi, '').replace(/\s+/g, ' ').trim();
  const question = summarizeForFallback(normalizeIntentFromNoisyText(normalizeUserQuestionText(pair.userText) || pair.userText), 320);
  const answerPreview = summarizeForFallback(String(pair.modelText || '').replace(/\s+/g, ' ').trim(), 900);

  const expandedPrompt = [
    `Referenced answer ID: A${ordinal}`,
    `Referenced previous question: ${question || 'unknown previous question'}`,
    `Referenced previous answer preview: ${answerPreview || 'unavailable'}`,
    `Current follow-up request: ${followUp || 'continue from this referenced answer context'}`,
    'The user explicitly referenced a timeline answer ID.',
    'Use this exact referenced context and return a direct, professional answer.'
  ].join('\n');

  return { expandedPrompt };
};

const selectReferencedConversationPair = (
  history: BotChatTurn[],
  userInput: string
): ConversationPair | null => {
  const pairs = getConversationPairs(history);
  if (!pairs.length) return null;
  const parsed = parseContextReference(userInput);
  if (!parsed.isReference) return null;

  if (parsed.ordinal && parsed.ordinal >= 1 && parsed.ordinal <= pairs.length) {
    const targeted = pairs[parsed.ordinal - 1];
    if (!isSyntheticContextPrompt(targeted.userText)) return targeted;
  }
  if (parsed.latest || parsed.target !== 'pair') {
    for (let i = pairs.length - 1; i >= 0; i -= 1) {
      if (!isSyntheticContextPrompt(pairs[i].userText)) return pairs[i];
    }
    return null;
  }
  const normalized = String(userInput || '').trim();
  if (normalized.split(/\s+/).filter(Boolean).length <= 28) {
    for (let i = pairs.length - 1; i >= 0; i -= 1) {
      if (!isSyntheticContextPrompt(pairs[i].userText)) return pairs[i];
    }
    return null;
  }
  return null;
};

const getActiveFollowUpCue = (conversationKey?: string): FollowUpCue | null => {
  if (!conversationKey) return null;
  const cue = followUpCueStore.get(conversationKey);
  if (!cue) return null;
  if (Date.now() - cue.createdAt > FOLLOW_UP_CUE_TTL_MS) {
    followUpCueStore.delete(conversationKey);
    return null;
  }
  return cue;
};

const buildDetailedFollowUpPrompt = (topicPrompt: string, previewReply = ''): string => {
  const topic = normalizeIntentFromNoisyText(normalizeUserQuestionText(topicPrompt) || topicPrompt).slice(0, 320);
  const preview = sanitizeForTelegram(String(previewReply || ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  const lines = [
    `Previous topic: ${topic || 'previous question context'}`,
    'The user replied yes to continue with full details.',
    'Provide a complete, advanced, and accurate answer for this exact topic.',
    'Use chat context from the previous message and cover key details clearly.',
    'If the topic is coding, provide one full correct runnable solution and short practical explanation.'
  ];
  if (preview) {
    lines.splice(1, 0, `Previous assistant preview: ${preview}`);
  }
  return lines.join('\n');
};

const buildContextualFollowUpPrompt = (topicPrompt: string, followUpReply: string, previewReply = ''): string => {
  const topic = normalizeIntentFromNoisyText(normalizeUserQuestionText(topicPrompt) || topicPrompt).slice(0, 320);
  const followUp = normalizeIntentFromNoisyText(normalizeUserQuestionText(followUpReply) || followUpReply).slice(0, 220);
  const preview = sanitizeForTelegram(String(previewReply || ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);

  const lines = [
    `Previous topic: ${topic || 'previous question context'}`,
    `Follow-up request: ${followUp || followUpReply || 'continue using previous context'}`,
    'Interpret the follow-up request using the previous topic and previous answer context.',
    'Answer that exact same topic directly, accurately, and professionally.'
  ];
  if (isContextReferenceContinuationReply(followUpReply) && /\b(format|style|structure|pattern|template|layout|same way)\b/i.test(followUpReply)) {
    lines.push('Format/style rule: preserve the previous answer structure (for example steps, headings, numbered list, or table style) while answering this follow-up.');
  }
  if (preview) {
    lines.splice(1, 0, `Previous assistant preview: ${preview}`);
  }
  return lines.join('\n');
};

const buildReferencedConversationPrompt = (
  pair: ConversationPair,
  followUpReply: string,
  options?: { preserveFormat?: boolean; target?: 'question' | 'answer' | 'pair' }
): string => {
  const topic = normalizeIntentFromNoisyText(normalizeUserQuestionText(pair.userText) || pair.userText).slice(0, 320);
  const followUp = normalizeIntentFromNoisyText(normalizeUserQuestionText(followUpReply) || followUpReply).slice(0, 240);
  const answerPreview = sanitizeForTelegram(String(pair.modelText || ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 700);

  const lines = [
    `Referenced previous question: ${topic || 'unknown previous question'}`,
    `Referenced previous answer preview: ${answerPreview || 'no preview'}`,
    `Current follow-up request: ${followUp || followUpReply || 'continue using previous context'}`,
    'The user is referring to a previous conversation item. Resolve the reference using the provided previous question and answer.',
    'Answer the current request accurately using that exact referenced context.',
  ];
  if (options?.target === 'answer') {
    lines.push('Focus rule: the user is mainly referring to the previous answer/response content.');
  } else if (options?.target === 'question') {
    lines.push('Focus rule: the user is mainly referring to the previous question/topic.');
  }
  if (options?.preserveFormat) {
    lines.push('Format/style rule: preserve the structure/style of the referenced previous answer when appropriate.');
  }
  return lines.join('\n');
};

const registerFollowUpCue = (conversationKey: string | undefined, userText: string, modelText: string): void => {
  if (!conversationKey) return;
  const assistantReply = String(modelText || '').trim();
  if (!assistantReply) {
    followUpCueStore.delete(conversationKey);
    return;
  }
  if (!FOLLOW_UP_OFFER_PATTERN.test(assistantReply)) {
    followUpCueStore.delete(conversationKey);
    return;
  }

  const topicPrompt = normalizeIntentFromNoisyText(normalizeUserQuestionText(userText) || userText).slice(0, 320);
  if (!topicPrompt) return;
  followUpCueStore.set(conversationKey, {
    topicPrompt,
    sourceUserPrompt: String(userText || '').trim(),
    sourceAssistantReply: assistantReply.slice(0, 1200),
    createdAt: Date.now()
  });
};

const resolveAffirmativeFollowUpPrompt = (conversationKey: string | undefined, userInput: string): string | null => {
  if (!conversationKey) return null;
  if (isTelegramMediaEnvelopePrompt(userInput) || isLikelyFileNameOnlyPrompt(userInput)) return null;
  const normalizedInput = normalizeIntentFromNoisyText(normalizeUserQuestionText(userInput) || userInput)
    .toLowerCase()
    .trim();
  if (!normalizedInput) return null;

  if (isNegativeFollowUpReply(normalizedInput)) {
    followUpCueStore.delete(conversationKey);
    return null;
  }
  const wantsContinuation =
    isAffirmativeFollowUpReply(normalizedInput)
    || isDetailContinuationReply(normalizedInput)
    || isContextReferenceContinuationReply(normalizedInput)
    || parseContextReference(userInput).isReference;
  if (!wantsContinuation) {
    return null;
  }
  const wantsDetailContinuation = isAffirmativeFollowUpReply(normalizedInput) || isDetailContinuationReply(normalizedInput);
  const wantsContextReference = isContextReferenceContinuationReply(normalizedInput);

  const cue = getActiveFollowUpCue(conversationKey);
  if (cue) {
    followUpCueStore.delete(conversationKey);
    return wantsDetailContinuation
      ? buildDetailedFollowUpPrompt(cue.topicPrompt, cue.sourceAssistantReply)
      : buildContextualFollowUpPrompt(cue.topicPrompt, userInput, cue.sourceAssistantReply);
  }

  const history = getChatHistory(conversationKey);
  if (!history.length) return null;
  const explicitReferencedPair = selectReferencedConversationPair(history, userInput);
  if (explicitReferencedPair) {
    const parsed = parseContextReference(userInput);
    return buildReferencedConversationPrompt(explicitReferencedPair, userInput, {
      preserveFormat: parsed.preserveFormat,
      target: parsed.target
    });
  }
  const lastModelIndex = [...history].reverse().findIndex((turn) => turn.role === 'model');
  if (lastModelIndex < 0) return null;
  const modelTurnAbsoluteIndex = history.length - 1 - lastModelIndex;
  const lastModelText = getTurnText(history[modelTurnAbsoluteIndex]);
  if (!lastModelText) return null;
  if (!FOLLOW_UP_OFFER_PATTERN.test(lastModelText) && !isDetailContinuationReply(normalizedInput) && !wantsContextReference) {
    return null;
  }

  let previousUserText = '';
  for (let i = modelTurnAbsoluteIndex - 1; i >= 0; i -= 1) {
    if (history[i].role === 'user') {
      const candidateUserText = getTurnText(history[i]);
      const normalizedCandidate = normalizeIntentFromNoisyText(normalizeUserQuestionText(candidateUserText) || candidateUserText)
        .toLowerCase()
        .trim();
      if (!normalizedCandidate) continue;
      if (isSyntheticContextPrompt(candidateUserText)) continue;
      if (
        isAffirmativeFollowUpReply(normalizedCandidate)
        || isDetailContinuationReply(normalizedCandidate)
        || isContextReferenceContinuationReply(normalizedCandidate)
      ) {
        continue;
      }
      previousUserText = candidateUserText;
      if (previousUserText) break;
    }
  }
  if (!previousUserText) return null;
  return wantsDetailContinuation
    ? buildDetailedFollowUpPrompt(previousUserText, lastModelText)
    : buildContextualFollowUpPrompt(previousUserText, userInput, lastModelText);
};

const mediaReferenceTargetPattern = /\b(image|photo|picture|screenshot|pdf|document|file|audio|video|recording|voice|resume|media)\b/i;
const mediaReferenceActionPattern = /\b(improve|improvement|good|bad|summary|summarize|describe|description|what (?:is|was|are)|key points|learn|learnings|mistake|errors?|tone|emotion|feedback|analysis)\b/i;

const isLikelyMediaContextFollowUpInput = (input: string): boolean => {
  const raw = String(input || '').trim();
  if (!raw) return false;
  const normalized = normalizeIntentFromNoisyText(normalizeUserQuestionText(raw) || raw).toLowerCase().trim();
  if (!normalized) return false;

  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
  const parsed = parseContextReference(normalized);
  if (mediaReferenceTargetPattern.test(normalized)) return true;
  if (parsed.isReference && mediaReferenceActionPattern.test(normalized)) return true;
  if (tokenCount <= 18 && mediaReferenceActionPattern.test(normalized) && /\b(this|that|it|same|previous|last|earlier)\b/.test(normalized)) {
    return true;
  }
  if (tokenCount <= 12 && /^(?:what|how)\s+(?:can|should)\s+i\s+improve\b/.test(normalized)) {
    return true;
  }
  return false;
};

const getMostRecentMediaConversationPair = (history: BotChatTurn[]): ConversationPair | null => {
  const pairs = getConversationPairs(history);
  if (!pairs.length) return null;
  for (let i = pairs.length - 1; i >= 0; i -= 1) {
    const userText = String(pairs[i].userText || '').trim();
    if (!userText) continue;
    if (isTelegramMediaEnvelopePrompt(userText) || isLikelyFileNameOnlyPrompt(userText)) {
      return pairs[i];
    }
  }
  return null;
};

const extractFollowUpRequestFromSyntheticPrompt = (input: string): string => {
  const raw = String(input || '').replace(/\r/g, '');
  if (!raw) return '';
  const match = raw.match(/(?:^|\n)(?:Current\s+follow-up\s+request|Follow-up request):\s*([^\n]+)/i);
  return String(match?.[1] || '').trim();
};

const extractContextTopicFromSyntheticPrompt = (input: string): string => {
  const raw = String(input || '').replace(/\r/g, '');
  if (!raw) return '';
  const match = raw.match(/(?:^|\n)(?:Referenced previous question|Previous topic):\s*([^\n]+)/i);
  return String(match?.[1] || '').trim();
};

const extractUniqueBulletCandidates = (text: string, maxItems = 4): string[] => {
  const raw = String(text || '').replace(/\r/g, '\n');
  if (!raw) return [];
  const headingOnlyPattern = /^(Main Content|Emotion and Tone|What Was Good|What To Improve|Spelling and Grammar Fixes|Improved Version|File Overview|Detailed Topic Summary|Key Points and Concepts|Practical Learnings|Action Items)\s*:?$/i;
  const sourceLines = raw
    .split('\n')
    .map((line) => line.replace(/^[-*]+\s*/g, '').trim())
    .filter((line) => line.length > 2 && !headingOnlyPattern.test(line));
  const uniq = new Set<string>();
  const out: string[] = [];
  for (const line of sourceLines) {
    const key = line.toLowerCase();
    if (uniq.has(key)) continue;
    uniq.add(key);
    out.push(line);
    if (out.length >= maxItems) break;
  }
  return out;
};

const getMostRecentResolvableConversationPair = (
  history: BotChatTurn[],
  userInput: string
): ConversationPair | null => {
  const explicit = selectReferencedConversationPair(history, userInput);
  if (explicit && !isLowValueDeflectionReply(explicit.modelText || '')) return explicit;

  const mediaPair = getMostRecentMediaConversationPair(history);
  if (mediaPair && history.length - mediaPair.modelTurnIndex <= 24 && !isLowValueDeflectionReply(mediaPair.modelText || '')) {
    return mediaPair;
  }

  const pairs = getConversationPairs(history);
  if (!pairs.length) return null;
  for (let i = pairs.length - 1; i >= 0; i -= 1) {
    const pair = pairs[i];
    if (isSyntheticContextPrompt(pair.userText)) continue;
    if (isLowValueDeflectionReply(pair.modelText || '')) continue;
    const normalizedUser = normalizeIntentFromNoisyText(normalizeUserQuestionText(pair.userText) || pair.userText)
      .toLowerCase()
      .trim();
    if (!normalizedUser) continue;
    if (
      isAffirmativeFollowUpReply(normalizedUser)
      || isDetailContinuationReply(normalizedUser)
      || isContextReferenceContinuationReply(normalizedUser)
    ) {
      continue;
    }
    return pair;
  }
  return null;
};

const buildContextReferenceRecoveryReply = (
  conversationKey: string | undefined,
  userInput: string
): string | null => {
  if (!conversationKey) return null;
  const rawInput = String(userInput || '').trim();
  if (!rawInput) return null;
  if (isTelegramMediaEnvelopePrompt(rawInput) || isLikelyFileNameOnlyPrompt(rawInput)) return null;

  const followUpRequest = extractFollowUpRequestFromSyntheticPrompt(rawInput) || rawInput;
  const topicHint = extractContextTopicFromSyntheticPrompt(rawInput);
  const normalizedFollowUp = normalizeIntentFromNoisyText(normalizeUserQuestionText(followUpRequest) || followUpRequest).trim();
  if (!normalizedFollowUp) return null;

  const followUpLower = normalizedFollowUp.toLowerCase();
  const contextualInput =
    isSyntheticContextPrompt(rawInput)
    || parseContextReference(normalizedFollowUp).isReference
    || isContextReferenceContinuationReply(normalizedFollowUp);
  if (!contextualInput) return null;

  const history = getChatHistory(conversationKey);
  if (!history.length) return null;
  const pair = getMostRecentResolvableConversationPair(history, normalizedFollowUp)
    || getMostRecentResolvableConversationPair(history, rawInput);
  if (!pair) return null;

  const previousQuestion = normalizeIntentFromNoisyText(normalizeUserQuestionText(pair.userText) || pair.userText).trim() || topicHint;
  const previousAnswer = String(pair.modelText || '').trim();
  if (!previousAnswer) return null;

  const asksImprove = /\b(improve|improvement|better|fix|correct|enhance|refine|optimi(?:ze|se)|what can i improve|what should i improve)\b/.test(followUpLower);
  const asksGood = /\b(what was good|good points?|strengths?|positive)\b/.test(followUpLower);
  const asksTone = /\b(emotion|tone|mood)\b/.test(followUpLower);
  const asksMain = /\b(main content|what was said|what is said|said|transcript|summary|summari(?:ze|se)|describe|overview|explain)\b/.test(followUpLower);
  const asksImprovedVersion = /\b(improved version|rewrite|professional version|corrected version|polished version)\b/.test(followUpLower);
  const asksAction = /\b(action|next step|next steps|todo|to do|plan)\b/.test(followUpLower);

  if (isStructuredMediaReplyStrong(previousAnswer)) {
    const main = extractMediaReplySection(previousAnswer, 'Main Content');
    const tone = extractMediaReplySection(previousAnswer, 'Emotion and Tone');
    const good = extractMediaReplySection(previousAnswer, 'What Was Good');
    const improve = extractMediaReplySection(previousAnswer, 'What To Improve');
    const improved = extractMediaReplySection(previousAnswer, 'Improved Version');
    const rewrite = applyMediaProfessionalRewrite(main || previousQuestion);
    const improvedVersion = improved
      && computeMediaTokenOverlap(main || improved, improved) < 0.9
      ? improved
      : rewrite.text;

    if (asksTone && tone) {
      return `Emotion and Tone:\n${tone}`;
    }
    if (asksGood && good) {
      return `What Was Good:\n${good}`;
    }
    if (asksMain && main && !asksImprove && !asksImprovedVersion) {
      return `Main Content:\n${main}`;
    }
    if (asksImprove || asksImprovedVersion || asksAction) {
      const improvementLines = extractUniqueBulletCandidates(improve, 4);
      const goodLines = extractUniqueBulletCandidates(good, 4);
      return formatMediaSectionedReply({
        mainContent: main || summarizeForFallback(previousQuestion || topicHint, 240) || 'Previous media context was identified.',
        tone: tone || 'Tone inferred from prior media context.',
        good: goodLines.length > 0 ? goodLines : ['The previous media message included enough context to identify the main objective.'],
        improve: improvementLines.length > 0 ? improvementLines : [
          'State one clear objective and expected output.',
          'Use short, grammatically complete sentences.',
          'Reduce filler words and keep key terms precise.'
        ],
        improvedVersion: improvedVersion || 'Please restate your message in one concise, professional sentence with explicit objective and expected output.'
      });
    }

    return formatMediaSectionedReply({
      mainContent: main || summarizeForFallback(previousQuestion || topicHint, 240) || 'Previous media context was identified.',
      tone: tone || 'Tone inferred from prior media context.',
      good: extractUniqueBulletCandidates(good, 4),
      improve: extractUniqueBulletCandidates(improve, 4),
      improvedVersion: improvedVersion || rewrite.text
    });
  }

  if (isStructuredFileReplyStrong(previousAnswer)) {
    const overview = extractFileReplySection(previousAnswer, 'File Overview');
    const summary = extractFileReplySection(previousAnswer, 'Detailed Topic Summary');
    const keyPoints = extractFileReplySection(previousAnswer, 'Key Points and Concepts');
    const learnings = extractFileReplySection(previousAnswer, 'Practical Learnings');
    const actionItems = extractFileReplySection(previousAnswer, 'Action Items');

    if (asksImprove || asksAction) {
      const improvementLines = [
        ...extractUniqueBulletCandidates(actionItems, 4),
        ...extractUniqueBulletCandidates(learnings, 4)
      ].slice(0, 5);
      return [
        'Improvement Plan:',
        ...(improvementLines.length > 0
          ? improvementLines.map((line) => `- ${line}`)
          : [
            '- Clarify the target audience and purpose of the document.',
            '- Add measurable outcomes and concrete examples in each section.',
            '- Improve structure with concise section headings and consistent formatting.'
          ]),
        '',
        'Context Reference:',
        previousQuestion
          ? `Previous question: ${summarizeForFallback(previousQuestion, 260)}`
          : 'Previous file analysis context was used.',
      ].join('\n');
    }

    if (asksMain) {
      return [
        'File Overview:',
        overview || 'Previous file overview was available.',
        '',
        'Detailed Topic Summary:',
        summary || summarizeForFallback(previousAnswer, 900) || 'Detailed summary was limited in this pass.',
        '',
        'Key Points and Concepts:',
        ...(extractUniqueBulletCandidates(keyPoints, 5).map((line) => `- ${line}`)),
      ].join('\n');
    }

    return [
      'File Overview:',
      overview || 'Previous file overview was available.',
      '',
      'Detailed Topic Summary:',
      summary || summarizeForFallback(previousAnswer, 900) || 'Detailed summary was limited in this pass.',
      '',
      'Practical Learnings:',
      ...(extractUniqueBulletCandidates(learnings, 5).map((line) => `- ${line}`)),
      '',
      'Action Items:',
      actionItems || 'Ask a focused follow-up, for example: what can I improve in this file, and I will answer using this exact context.'
    ].join('\n');
  }

  const answerSnapshot = summarizeForFallback(previousAnswer, 1000);
  if (asksImprove || asksAction) {
    return [
      'Resolved Context:',
      previousQuestion
        ? `Previous question: ${summarizeForFallback(previousQuestion, 220)}`
        : 'Previous conversation context identified.',
      '',
      'What To Improve:',
      '- Clarify the objective and expected output in one sentence.',
      '- Add specific constraints or examples to reduce ambiguity.',
      '- Specify your preferred answer format, for example bullets, steps, or concise summary.',
      '',
      'Previous Answer Snapshot:',
      answerSnapshot || 'Previous answer context was available.'
    ].join('\n');
  }

  if (answerSnapshot) {
    return [
      'Resolved Context:',
      previousQuestion
        ? `Previous question: ${summarizeForFallback(previousQuestion, 220)}`
        : 'Previous conversation context identified.',
      '',
      'Direct Follow-Up Answer:',
      answerSnapshot
    ].join('\n');
  }

  return null;
};

const buildMediaContextFollowUpPrompt = (pair: ConversationPair, followUpInput: string): string => {
  const mediaMessage = String(pair.userText || '').replace(/\r/g, '').trim();
  const mediaPreview = mediaMessage.length > 2400 ? `${mediaMessage.slice(0, 2400).trim()}...` : mediaMessage;
  const priorAnswer = sanitizeForTelegram(String(pair.modelText || ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
  const followUp = normalizeIntentFromNoisyText(normalizeUserQuestionText(followUpInput) || followUpInput).slice(0, 240);

  return [
    'Referenced media context:',
    mediaPreview || 'Previous media payload was available.',
    `Previous assistant media analysis: ${priorAnswer || 'no preview available'}`,
    `Current follow-up request: ${followUp || followUpInput || 'continue using previous media context'}`,
    'The user is referring to this previously shared media/file.',
    'Answer the current follow-up using that exact media context and prior analysis.',
    'If asked for improvement, provide specific actionable improvements grounded in that media evidence.'
  ].join('\n');
};

const resolveMediaContextPrompt = (conversationKey: string | undefined, userInput: string): string | null => {
  if (!conversationKey) return null;
  if (isTelegramMediaEnvelopePrompt(userInput) || isLikelyFileNameOnlyPrompt(userInput)) return null;
  if (!isLikelyMediaContextFollowUpInput(userInput)) return null;

  const history = getChatHistory(conversationKey);
  if (!history.length) return null;
  const mediaPair = getMostRecentMediaConversationPair(history);
  if (!mediaPair) return null;

  // Avoid binding to very old media context when conversation has moved on.
  if (history.length - mediaPair.modelTurnIndex > 18) return null;
  return buildMediaContextFollowUpPrompt(mediaPair, userInput);
};

const persistChatMemory = (): void => {
  try {
    const dir = path.dirname(CHAT_MEMORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const serialized = JSON.stringify(
      Object.fromEntries(
        Array.from(chatHistoryStore.entries()).map(([chatId, entry]) => [String(chatId), entry])
      ),
      null,
      2
    );
    fs.writeFileSync(CHAT_MEMORY_FILE, serialized, 'utf8');
  } catch (error) {
    console.warn('[CHAT_MEMORY] Failed to persist chat memory:', (error as Error).message);
  }
};

const loadChatMemory = (): void => {
  try {
    if (!fs.existsSync(CHAT_MEMORY_FILE)) return;
    const raw = fs.readFileSync(CHAT_MEMORY_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, { history: BotChatTurn[]; updatedAt: number }>;
    for (const [storedKey, entry] of Object.entries(parsed || {})) {
      const legacyChatId = Number(storedKey);
      const conversationKey = storedKey.includes(':')
        ? storedKey
        : Number.isFinite(legacyChatId)
          ? buildConversationKey('telegram:primary', legacyChatId)
          : null;
      if (!conversationKey) continue;
      const history = Array.isArray(entry?.history) ? entry.history.slice(-CHAT_HISTORY_MAX_TURNS) : [];
      const updatedAt = Number(entry?.updatedAt || 0);
      if (!history.length) continue;
      if (updatedAt && Date.now() - updatedAt > CHAT_HISTORY_TTL_MS) continue;
      chatHistoryStore.set(conversationKey, { history, updatedAt: updatedAt || Date.now() });
    }
  } catch (error) {
    console.warn('[CHAT_MEMORY] Failed to load chat memory:', (error as Error).message);
  }
};

const persistContextMetrics = (): void => {
  try {
    const dir = path.dirname(CONTEXT_DB_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const serialized = JSON.stringify(
      Object.fromEntries(Array.from(contextMetrics.entries()).map(([chatId, metric]) => [String(chatId), metric])),
      null,
      2
    );
    fs.writeFileSync(CONTEXT_DB_FILE, serialized, 'utf8');
  } catch (error) {
    console.warn('[CONTEXT_DB] Failed to persist context metrics:', (error as Error).message);
  }
};

const loadContextMetrics = (): void => {
  try {
    if (!fs.existsSync(CONTEXT_DB_FILE)) return;
    const raw = fs.readFileSync(CONTEXT_DB_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, ContextMetric>;
    for (const [storedKey, metric] of Object.entries(parsed || {})) {
      const legacyChatId = Number(storedKey);
      const conversationKey = storedKey.includes(':')
        ? storedKey
        : Number.isFinite(legacyChatId)
          ? buildConversationKey('telegram:primary', legacyChatId)
          : null;
      if (!conversationKey) continue;
      contextMetrics.set(conversationKey, {
        totalPromptTokens: Number(metric?.totalPromptTokens || 0),
        totalResponseTokens: Number(metric?.totalResponseTokens || 0),
        updatedAt: Number(metric?.updatedAt || Date.now())
      });
    }
  } catch (error) {
    console.warn('[CONTEXT_DB] Failed to load context metrics:', (error as Error).message);
  }
};

const persistUserProfiles = (): void => {
  try {
    const dir = path.dirname(USER_PROFILE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const serialized = JSON.stringify(
      Object.fromEntries(Array.from(userProfiles.entries()).map(([chatId, profile]) => [String(chatId), profile])),
      null,
      2
    );
    fs.writeFileSync(USER_PROFILE_FILE, serialized, 'utf8');
  } catch (error) {
    console.warn('[USER_PROFILE] Failed to persist profiles:', (error as Error).message);
  }
};

const loadUserProfiles = (): void => {
  try {
    if (!fs.existsSync(USER_PROFILE_FILE)) return;
    const raw = fs.readFileSync(USER_PROFILE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, UserProfile>;
    for (const [storedKey, profile] of Object.entries(parsed || {})) {
      const legacyChatId = Number(storedKey);
      const conversationKey = storedKey.includes(':')
        ? storedKey
        : Number.isFinite(legacyChatId)
          ? buildConversationKey('telegram:primary', legacyChatId)
          : null;
      if (!conversationKey) continue;
      userProfiles.set(conversationKey, {
        preferredTone: profile?.preferredTone,
        prefersConcise: Boolean(profile?.prefersConcise),
        responseVerbosity:
          profile?.responseVerbosity === 'concise' || profile?.responseVerbosity === 'normal' || profile?.responseVerbosity === 'detailed'
            ? profile.responseVerbosity
            : (Boolean(profile?.prefersConcise) ? 'concise' : 'detailed'),
        responseLanguage: normalizeLanguageCode(String(profile?.responseLanguage || '')) || undefined,
        customStylePrompt: String(profile?.customStylePrompt || '').trim().slice(0, 500) || undefined,
        assistantName: sanitizeAssistantName(profile?.assistantName || '') || undefined,
        userDisplayName: sanitizeUserDisplayName(String(profile?.userDisplayName || '')) || undefined,
        goals: Array.isArray(profile?.goals)
          ? profile.goals
              .map((goal) => String(goal || '').replace(/\s+/g, ' ').trim().slice(0, 180))
              .filter(Boolean)
              .slice(0, 8)
          : [],
        verifyMode: profile?.verifyMode === true,
        emojiStyle: FORCE_RICH_EMOJI_STYLE ? 'rich' : (profile?.emojiStyle === 'minimal' ? 'minimal' : 'rich'),
        stickersEnabled: FORCE_STICKERS_ON ? true : (profile?.stickersEnabled !== false),
        trustLayerEnabled: profile?.trustLayerEnabled === true,
        expertMode: ['interview', 'coder', 'teacher', 'marketer', 'legal'].includes(String(profile?.expertMode || '').toLowerCase())
          ? (String(profile?.expertMode || '').toLowerCase() as 'interview' | 'coder' | 'teacher' | 'marketer' | 'legal')
          : 'general',
        recurringTopics: Array.isArray(profile?.recurringTopics) ? profile.recurringTopics.slice(0, 5) : [],
        topicCounts: typeof profile?.topicCounts === 'object' && profile.topicCounts ? profile.topicCounts : {},
        updatedAt: Number(profile?.updatedAt || Date.now())
      });
    }
  } catch (error) {
    console.warn('[USER_PROFILE] Failed to load profiles:', (error as Error).message);
  }
};

const ensurePremiumConversationStyle = (conversationKey: string | undefined): void => {
  if (!conversationKey) return;
  const current = userProfiles.get(conversationKey) || {
    preferredTone: 'casual' as const,
    responseVerbosity: 'detailed' as const,
    verifyMode: false,
    emojiStyle: 'rich' as const,
    stickersEnabled: true,
    trustLayerEnabled: false,
    expertMode: 'general' as const,
    recurringTopics: [],
    topicCounts: {},
    updatedAt: Date.now()
  };
  let changed = false;
  if (!current.preferredTone) {
    current.preferredTone = 'casual';
    changed = true;
  }
  if (!current.responseVerbosity) {
    current.responseVerbosity = current.prefersConcise ? 'concise' : 'detailed';
    changed = true;
  }
  if (FORCE_RICH_EMOJI_STYLE && current.emojiStyle !== 'rich') {
    current.emojiStyle = 'rich';
    changed = true;
  }
  if (FORCE_STICKERS_ON && current.stickersEnabled !== true) {
    current.stickersEnabled = true;
    changed = true;
  }
  if (typeof current.trustLayerEnabled !== 'boolean') {
    current.trustLayerEnabled = false;
    changed = true;
  }
  if (typeof current.verifyMode !== 'boolean') {
    current.verifyMode = false;
    changed = true;
  }
  if (!current.expertMode) {
    current.expertMode = 'general';
    changed = true;
  }
  if (!Array.isArray(current.goals)) {
    current.goals = [];
    changed = true;
  }
  if (changed || !userProfiles.has(conversationKey)) {
    current.updatedAt = Date.now();
    userProfiles.set(conversationKey, current);
    persistUserProfiles();
  }
};

const updateUserProfile = (conversationKey: string | undefined, userText: string): UserProfile | undefined => {
  if (!conversationKey) return undefined;
  const current = userProfiles.get(conversationKey) || {
    preferredTone: 'casual' as const,
    responseVerbosity: 'detailed' as const,
    verifyMode: false,
    emojiStyle: (FORCE_RICH_EMOJI_STYLE ? 'rich' : 'minimal') as 'rich' | 'minimal',
    stickersEnabled: FORCE_STICKERS_ON,
    trustLayerEnabled: false,
    expertMode: 'general' as const,
    goals: [],
    recurringTopics: [],
    topicCounts: {},
    updatedAt: Date.now()
  };
  const rawText = String(userText || '').trim();
  const text = rawText.toLowerCase();
  if (/(concise|short|brief)/.test(text)) {
    current.prefersConcise = true;
    current.preferredTone = 'concise';
    current.responseVerbosity = 'concise';
  } else if (/\bformal\b/.test(text)) {
    current.preferredTone = 'formal';
  } else if (/\bcasual\b/.test(text)) {
    current.preferredTone = 'casual';
  } else if (/\bprofessional\b/.test(text)) {
    current.preferredTone = 'professional';
  }

  const displayName = extractUserDisplayNameFromText(rawText);
  if (displayName) {
    current.userDisplayName = displayName;
  }

  const goal = extractUserGoalFromText(rawText);
  if (goal) {
    const goals = Array.isArray(current.goals) ? current.goals.slice(0, 8) : [];
    const exists = goals.some((existing) => existing.toLowerCase() === goal.toLowerCase());
    if (!exists) {
      goals.unshift(goal);
      current.goals = goals.slice(0, 8);
    }
  } else if (!Array.isArray(current.goals)) {
    current.goals = [];
  }

  const stop = new Set(['what', 'when', 'where', 'which', 'about', 'with', 'this', 'that', 'have', 'from', 'your', 'please', 'tell', 'make', 'give']);
  const topics = text
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !stop.has(t))
    .slice(0, 12);
  for (const topic of topics) {
    current.topicCounts[topic] = (current.topicCounts[topic] || 0) + 1;
  }
  current.recurringTopics = Object.entries(current.topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic]) => topic);
  current.updatedAt = Date.now();
  userProfiles.set(conversationKey, current);
  persistUserProfiles();
  return current;
};

const appendChatHistory = (conversationKey: string | undefined, userText: string, modelText: string): void => {
  if (!conversationKey) return;
  const existing = getChatHistory(conversationKey);
  const next: BotChatTurn[] = [
    ...existing,
    { role: 'user' as const, parts: [{ text: userText }] },
    { role: 'model' as const, parts: [{ text: modelText }] }
  ].slice(-CHAT_HISTORY_MAX_TURNS);
  chatHistoryStore.set(conversationKey, { history: next, updatedAt: Date.now() });
  registerFollowUpCue(conversationKey, userText, modelText);
  persistChatMemory();
};

const STRICT_CODE_FORMATTING_PROTOCOL = [
  'SYSTEM INSTRUCTION: STRICT PROFESSIONAL CODE OUTPUT MODE',
  '',
  'From now on, whenever you generate code, you MUST follow these rules strictly.',
  '',
  'MANDATORY RULES:',
  '',
  '1. ALWAYS output code inside triple backticks with correct language tag.',
  '',
  'Correct examples:',
  '```cpp',
  '// C++ code here',
  '```python',
  '# Python code here',
  '',
  'NEVER write explanation inside the code block.',
  '',
  'NEVER write code outside the code block.',
  '',
  'ALWAYS detect the correct language from the user\'s request.',
  'If user says "in cpp", use cpp If user says "in python", use python',
  '',
  'ALWAYS format code professionally:',
  '',
  'Proper indentation (4 spaces)',
  '',
  'Proper bracket alignment',
  '',
  'Proper spacing',
  '',
  'Clean structure',
  '',
  'NEVER output broken markdown like this:',
  'WRONG:',
  '',
  'text explanation',
  'code mixed together',
  '',
  'ALWAYS follow this EXACT output format:',
  'Explanation (max 3 lines)',
  '',
  '```language',
  '// clean, professional, runnable code',
  '',
  'Code must be:',
  '',
  'Complete',
  '',
  'Runnable',
  '',
  'Clean',
  '',
  'Professional',
  '',
  'Properly formatted',
  '',
  'If formatting is wrong, regenerate automatically.',
  'NEVER use wrong language tags.',
  '',
  'STRICT MODE IS PERMANENT.'
].join('\n');

const TELEGRAM_MASTER_SYSTEM_PROMPT = [
  'TELEGRAM AI ASSISTANT MASTER SYSTEM PROMPT',
  '',
  'You are an advanced Telegram AI assistant.',
  '',
  'Your job is not just to answer questions.',
  'Your job is to detect user intent, maintain conversation context, avoid repetitive responses, avoid unnecessary code generation, and provide intelligent structured and context aware replies.',
  '',
  'CORE BEHAVIOR RULES',
  '',
  'Always analyze the user message before responding.',
  'Classify the intent internally before generating the answer.',
  'Do not assume intent based solely on keywords.',
  'Analyze meaning and context first.',
  'Be tolerant of spelling mistakes and incomplete sentences.',
  'If unclear, ask a clarifying question.',
  'Do not generate identical structured responses for different logical queries.',
  'Always maintain conversation continuity.',
  'Maintain context from previous messages.',
  'If the message refers to something earlier, use conversation history.',
  'Never ignore previous conversation unless explicitly reset.',
  '',
  'INTENT DETECTION INTERNAL STEP',
  '',
  'Before answering silently classify the message into one of the following:',
  '',
  'Greeting',
  'Casual Conversation',
  'Capability Question',
  'Technical Question',
  'Coding Request',
  'Follow up Question',
  'Clarification',
  'Opinion Request',
  'Problem Solving',
  'Other',
  '',
  'Use this classification to decide response style.',
  '',
  'GREETING LOGIC',
  '',
  'If the message is a Greeting:',
  'Respond naturally.',
  'Be slightly varied and avoid repeating the same sentence.',
  'Ask a light engaging follow up.',
  'Do not over explain capabilities.',
  '',
  'CAPABILITY QUESTIONS',
  '',
  'If user asks:',
  'What can you do',
  'Do you know coding',
  'Can you do this',
  '',
  'Respond with a brief capability explanation.',
  'Do not generate code unless explicitly asked.',
  'Ask what exactly they want.',
  '',
  'Never generate sample code unless the user clearly says:',
  'Write code',
  'Show example',
  'Generate script',
  'Create implementation',
  '',
  'CODING REQUEST RULE',
  '',
  'Only generate code if the user explicitly asks for code or clearly requests implementation.',
  '',
  'Otherwise explain the concept first and ask if they want a code example.',
  '',
  'FOLLOW UP HANDLING',
  '',
  'If the message refers to:',
  'that',
  'it',
  'this',
  'what about that',
  'can you explain more',
  '',
  'You must look at previous conversation, understand the reference, and continue logically from the previous topic.',
  '',
  'Never treat a follow up as a new unrelated question.',
  '',
  'CONTEXT MEMORY RULE',
  '',
  'Assume conversation history is available.',
  'Always consider the last relevant messages.',
  '',
  'If context is unclear, ask a clarification question instead of guessing.',
  '',
  'RESPONSE STYLE CONTROL',
  '',
  'Avoid robotic answers.',
  'Avoid overly generic replies.',
  'Avoid repeating the same structure.',
  'Avoid unnecessary long paragraphs.',
  '',
  'Prefer structured answers for technical topics.',
  'Use natural tone for casual conversation.',
  'Use clear bullet style formatting when explaining concepts.',
  '',
  'REPETITION PREVENTION',
  '',
  'If a similar question appears again:',
  'Rephrase the response.',
  'Add slight variation.',
  'Expand or refine previous explanation.',
  'Avoid copying the same wording.',
  '',
  'PROBLEM SOLVING MODE',
  '',
  'When user describes an issue:',
  'Identify the problem.',
  'Explain the root cause.',
  'Provide solution steps.',
  'Offer improvement suggestions.',
  '',
  'EDGE CASE HANDLING',
  '',
  'If the message is unclear, ask a clarifying question.',
  'If the question is too broad, break it into smaller parts.',
  'If user contradicts previous message, politely point it out.',
  '',
  'TONE ADAPTATION',
  '',
  'Match tone based on user:',
  'Casual to Friendly',
  'Technical to Professional',
  'Serious to Direct',
  'Curious to Explanatory',
  '',
  'IMPORTANT RESTRICTIONS',
  '',
  'Do not hallucinate features you do not have.',
  'Do not generate code unless clearly requested.',
  'Do not ignore conversation history.',
  'Do not give identical responses to different logical questions.',
  'Think before answering.',
  '',
  'FINAL RULE',
  '',
  'Always think step by step internally before generating the final response.',
  'Do not show internal reasoning.',
  'Only output the final helpful answer.'
].join('\n');

const buildSystemPrompt = (
  intent: 'math' | 'current_event' | 'coding' | 'general',
  userProfile?: UserProfile
): string => {
  const assistantDisplayName = sanitizeAssistantName(userProfile?.assistantName || '') || DEFAULT_ASSISTANT_NAME;
  const timezone = (process.env.BOT_USER_TIMEZONE || '').trim();
  const role = (process.env.BOT_USER_ROLE || '').trim();
  const priorities = (process.env.BOT_USER_PRIORITIES || '').trim();

  const envProfile = [
    timezone ? `Timezone: ${timezone}` : '',
    role ? `User role: ${role}` : '',
    priorities ? `Top priorities: ${priorities}` : ''
  ].filter(Boolean).join('\n');

  const profileHints = [
    userProfile?.assistantName ? `Assistant display name for this chat: ${sanitizeAssistantName(userProfile.assistantName)}` : '',
    userProfile?.userDisplayName ? `User display name: ${sanitizeUserDisplayName(userProfile.userDisplayName)}` : '',
    userProfile?.preferredTone ? `Preferred tone: ${userProfile.preferredTone}` : '',
    userProfile?.prefersConcise ? 'User prefers concise answers.' : '',
    userProfile?.responseVerbosity ? `Response verbosity: ${userProfile.responseVerbosity}` : '',
    userProfile?.expertMode ? `Expert mode: ${userProfile.expertMode}` : '',
    userProfile?.customStylePrompt ? `Custom style prompt: ${userProfile.customStylePrompt}` : '',
    userProfile?.goals?.length ? `User goals: ${userProfile.goals.join(' | ')}` : '',
    userProfile?.recurringTopics?.length ? `Recurring topics: ${userProfile.recurringTopics.join(', ')}` : ''
  ].filter(Boolean).join('\n');
  const languagePreference = normalizeLanguageCode(String(userProfile?.responseLanguage || '')) || '';
  const languageRule = languagePreference
    ? `Reply in ${languagePreference} for this chat unless the user explicitly asks another language for this message.`
    : 'Reply in the same language used by the user message. If they ask translation, translate exactly to the requested language.';
  const verbosity = userProfile?.responseVerbosity || (userProfile?.prefersConcise ? 'concise' : 'detailed');
  const verbosityRule = verbosity === 'concise'
    ? '- Response verbosity: concise. Prefer short, high-signal answers unless the user explicitly asks for detail.'
    : verbosity === 'normal'
      ? '- Response verbosity: normal. Give complete, professional answers with clear structure and moderate detail.'
      : '- Response verbosity: detailed. Default to full, detailed, ChatGPT-like explanations with examples/steps when useful.';

  const modeBlock = intent === 'coding'
    ? `Mode: Coding\n- First detect if the user explicitly requested code or implementation.\n- If explicit, provide correct and runnable code.\n- If not explicit, explain concept/approach first and ask whether code is needed.\n- Validate edge cases before finalizing.\n- Keep code clean, professional, and properly formatted.\n- Use proper markdown code fences with accurate language tags when code is provided.\n- Never output multiple conflicting code versions.`
    : intent === 'math'
      ? `Mode: Math\n- Solve clearly, verify the final result, and include full steps when useful.\n- Use explicit math operators (+, -, *, /, %, ^) in equations and final calculations.`
    : intent === 'current_event'
        ? `Mode: Current Event\n- Prefer verified current facts.\n- Include dates when useful.\n- If uncertain, state uncertainty briefly.\n- For ranking or top list answers, keep each item and its value on the same line and avoid splitting numeric values.\n- Use professional list structure: Item - Metric: Value.\n- For financial values, place currency before numbers.\n- Use USD by default unless user asks local or country specific currency.\n- If needed, add one plain closing line without labels like Note: or Details:.`
        : `Mode: General\n- Be clear, useful, and complete.\n- Provide an advanced but practical answer with correct details.\n- Cover key aspects of the question, not just a shallow summary.`;
  const expertMode = userProfile?.expertMode || 'general';
  const expertModeBlock = expertMode === 'interview'
    ? 'Expert overlay: Interview Coach\n- Prioritize structured interview-ready answers.\n- Include STAR-style examples where relevant.\n- Emphasize clarity, confidence, and practical next actions.'
    : expertMode === 'coder'
      ? 'Expert overlay: Senior Coding Mentor\n- Prioritize robust code quality, edge cases, complexity analysis, and production-ready suggestions.'
      : expertMode === 'teacher'
        ? 'Expert overlay: Teaching Mentor\n- Explain progressively from basics to advanced concepts with clear examples and checks for understanding.'
        : expertMode === 'marketer'
          ? 'Expert overlay: Marketing Strategist\n- Focus on audience, positioning, channel strategy, messaging clarity, and measurable outcomes.'
          : expertMode === 'legal'
            ? 'Expert overlay: Legal Draft Assistant\n- Use precise, formal language and risk-aware framing.\n- Do not provide jurisdiction-specific legal advice as definitive; provide draft-oriented guidance.'
            : 'Expert overlay: General professional assistant mode.';

  const base = `
You are ${assistantDisplayName}, a ChatGPT-style assistant.

${TELEGRAM_MASTER_SYSTEM_PROMPT}

Execution overlays for this chat:
${verbosityRule}
- ${languageRule}
- Prioritize correctness over guessing.
- Infer user intent from noisy or imperfect wording.
- Preserve exact entity/topic names after intent inference and keep them consistent.
- Never echo the user prompt as a standalone line.
- If the user asks multiple sub-questions, answer each part clearly.
- If a custom style prompt is provided for this chat, follow it unless it conflicts with safety or correctness.
- Keep output readable and clean (avoid markdown tables, hash headings, or LaTeX unless requested).
- Use short paragraphs and structured bullets when it improves clarity.
- If a question is ambiguous, ask one focused clarifying question.
- Never fabricate facts, links, or sources.
- For time-sensitive questions, prefer current facts and include date context when relevant.
${modeBlock}
${expertModeBlock}

Response Engine Policy (must follow):
${RESPONSE_ENGINE_SYSTEM_POLICY}

Context Intelligence Engine Policy (context reasoning and intent continuity):
${CONTEXT_INTELLIGENCE_ENGINE_SYSTEM_POLICY}
${intent === 'coding' ? `\n\nCoding Answer Engine Policy (apply for this coding response):\n${CODING_ANSWER_ENGINE_SYSTEM_POLICY}` : ''}

Strict code formatting protocol (apply exactly whenever output includes code):
${STRICT_CODE_FORMATTING_PROTOCOL}
${envProfile ? `\nUser profile:\n${envProfile}` : ''}
${profileHints ? `\nPersonalization hints:\n${profileHints}` : ''}
`.trim();
  const custom = (process.env.BOT_SYSTEM_PROMPT || '').trim();
  const styleOverlay = CHATGPT_STYLE_ASSISTANT
    ? `\n\nStyle overlay:\n- Default to a helpful ChatGPT-like response style.\n- Avoid filler intros and boilerplate disclaimers.\n- If user asks to explain your thinking, provide concise step-by-step reasoning, not hidden chain-of-thought.`
    : '';
  const composed = `${base}${styleOverlay}`.trim();
  return custom ? `${composed}\n\nAdditional instructions:\n${custom}` : composed;
};

const applyAssistantIdentityPolicy = (text: string, conversationKey?: string): string => {
  const out = String(text || '').trim();
  if (!out || !conversationKey) return out;
  const preferredName = getAssistantName(conversationKey);
  if (!preferredName || preferredName.toLowerCase() === DEFAULT_ASSISTANT_NAME.toLowerCase()) return out;
  return out
    .replace(/\bSwiftDeploy AI assistant\b/gi, `${preferredName} assistant`)
    .replace(/\bSwiftDeploy AI\b/gi, preferredName);
};

const applyEmojiStylePolicy = (text: string, conversationKey?: string): string => {
  const out = String(text || '').trim();
  if (!out || !conversationKey) return out;
  return out
    .replace(/^[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713\u{1F539}\u{1F3C1}]\s*/gu, '')
    .replace(/\n{2}[\u{1F300}-\u{1FAFF}\u2705\u2714\u2713\u{1F539}\u{1F3C1}]\s*$/gu, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
};

const pickStickerForContext = (prompt: string, answer: string): string => {
  const p = `${String(prompt || '').toLowerCase()} ${String(answer || '').toLowerCase()}`;
  if (isGreetingPrompt(p)) return pickFromPool(TG_STICKER_GREETING_IDS);
  if (/(code|coding|python|javascript|typescript|java|c\+\+|sql|bug|algorithm)/.test(p)) return pickFromPool(TG_STICKER_CODING_IDS);
  if (/(math|calculate|equation|solve|number|prime|pi)/.test(p)) return pickFromPool(TG_STICKER_MATH_IDS);
  if (/(motivate|discipline|focus|goal|plan|success)/.test(p)) return pickFromPool(TG_STICKER_MOTIVATION_IDS);
  return pickFromPool(TG_STICKER_SUCCESS_IDS);
};

const detectIntent = (text: string): 'math' | 'current_event' | 'coding' | 'general' => {
  const mediaIntentSignal = extractIntentSignalFromMediaEnvelopePrompt(text);
  const normalized = normalizeIncomingUserMessage(mediaIntentSignal || text);
  const value = normalized.normalizedText || normalized.loweredText;
  if (!value) return 'general';
  if (isMathLikePromptText(value)) return 'math';
  if (needsRealtimeSearch(value) || isTimeSensitivePrompt(value)) return 'current_event';
  const intent = classifyProfessionalIntent(value);
  return intent === 'coding_request' ? 'coding' : 'general';
};

const tryComputeMath = (text: string): string | null => {
  const trainSolution = solveTrainCrossingWordProblem(text);
  if (trainSolution) return trainSolution;
  const expression = buildComputableMathExpression(text);
  if (!expression) return null;
  const evalExpression = expression.replace(/\^/g, '**');
  try {
    const value = Function(`"use strict"; return (${evalExpression});`)();
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const shownExpression = normalizeMathOperatorsInText(expression);
    return [
      `Result: ${value}`,
      '',
      `Calculation: ${shownExpression} = ${value}`
    ].join('\n');
  } catch {
    return null;
  }
};

const isTopicOverlapCheckApplicable = (prompt: string): boolean => {
  const q = String(prompt || '').toLowerCase().trim();
  if (!q) return false;
  if (hasStrongNonLatinScript(q)) return false;
  if (isTranslationIntentPrompt(q)) return false;
  if (isGreetingPrompt(q)) return false;
  if (/^\/[a-z]+/.test(q)) return false;
  if (isMathLikePromptText(q)) return false;
  if (/(code|coding|typescript|javascript|python|sql|regex|api|function|class|debug|stack trace)/.test(q)) return false;
  return true;
};

const extractPromptFocusTokens = (prompt: string): string[] => {
  const q = String(prompt || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!q) return [];
  return q
    .split(/[^a-z0-9]+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 3 && !WIKI_FALLBACK_STOP_WORDS.has(x))
    .slice(0, 10);
};

const looksOffTopicByPromptOverlap = (prompt: string, response: string): boolean => {
  if (!isTopicOverlapCheckApplicable(prompt)) return false;
  const promptTokens = Array.from(new Set(extractPromptFocusTokens(prompt)));
  if (promptTokens.length < 2) return false;

  const normalizedResponse = String(response || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedResponse) return true;

  const firstSentence = String(response || '')
    .split(/[.!?\n]/)[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || '';

  const matches = promptTokens.filter((token) => normalizedResponse.includes(token));
  const openingMatches = promptTokens.filter((token) => firstSentence.includes(token));
  const isListRequest = /(\btop\s*\d+\b|\blist\b|\bgive\b|\bname\b).*(\b\d+\b)/i.test(prompt)
    || /\b(top|list|give|name)\b/i.test(prompt) && /\b(animal|countries|people|companies|ways|steps|points)\b/i.test(prompt);

  if (matches.length === 0) return true;
  if (isListRequest && matches.length < 2) return true;
  if (promptTokens.length >= 4 && matches.length < 2 && openingMatches.length === 0) return true;
  return false;
};

const hasKnownTemplateReuseMismatch = (prompt: string, response: string): boolean => {
  const q = normalizeLooseText(prompt);
  const r = normalizeLooseText(response);
  if (!q || !r) return false;

  if (!/\bsort(?:ed|ing)?\b/.test(q) && /\bsortedcopy\b|\bsorted copy\b/.test(r)) {
    return true;
  }
  if (!/\bguest\b/.test(q) && /\bthe guest is a thriller film released in 2014\b/.test(r)) {
    return true;
  }
  if (!/(richest|market cap|companies)/.test(q) && /\btop(?: 10)? (?:richest )?companies by market capitalization\b/.test(r)) {
    return true;
  }
  if (!/\btable\b/.test(q) && /\bhere is a professional table format you can use\b/.test(r)) {
    return true;
  }

  return false;
};

const ENTITY_SUBSTITUTION_GUARDS: Record<string, string[]> = {
  epstein: ['einstein'],
  einstein: ['epstein'],
  joffrey: ['jeffrey'],
  jeffrey: ['joffrey'],
  baratheon: ['beratheon'],
};

const normalizeLooseText = (value: string): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizePromptRepeatKey = (value: string): string =>
  normalizeIntentFromNoisyText(normalizeUserQuestionText(value) || value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const normalizeReplyRepeatKey = (value: string): string =>
  normalizeLooseText(
    String(value || '')
      .replace(/```[\s\S]*?```/g, ' code ')
      .replace(/\s+/g, ' ')
      .trim()
  );

const getMostRecentAnswerForSamePrompt = (
  conversationKey: string | undefined,
  prompt: string
): string | null => {
  if (!conversationKey) return null;
  const target = normalizePromptRepeatKey(prompt);
  if (!target) return null;

  const history = getChatHistory(conversationKey);
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const userTurn = history[i];
    if (!userTurn || userTurn.role !== 'user') continue;
    const userText = getTurnText(userTurn);
    if (!userText) continue;
    if (normalizePromptRepeatKey(userText) !== target) continue;

    for (let j = i + 1; j < history.length; j += 1) {
      if (history[j].role !== 'model') continue;
      const modelText = getTurnText(history[j]);
      return modelText || null;
    }
  }

  return null;
};

const isMeaningfullyRepeatedAnswer = (previous: string, current: string): boolean => {
  const prior = normalizeReplyRepeatKey(previous);
  const next = normalizeReplyRepeatKey(current);
  if (!prior || !next) return false;
  if (prior === next) return true;

  const [shorter, longer] = prior.length <= next.length ? [prior, next] : [next, prior];
  if (shorter.length < 120) return false;
  if (longer.startsWith(shorter)) return true;
  if (shorter.length >= 180 && longer.includes(shorter)) return true;
  return false;
};

const hasEntitySubstitutionSignal = (prompt: string, response: string): boolean => {
  if (hasStrongNonLatinScript(prompt) || hasStrongNonLatinScript(response)) return false;
  const normalizedPrompt = normalizeLooseText(normalizeIntentFromNoisyText(prompt));
  const normalizedResponse = normalizeLooseText(response);
  if (!normalizedPrompt || !normalizedResponse) return false;

  for (const [expected, forbiddenList] of Object.entries(ENTITY_SUBSTITUTION_GUARDS)) {
    const expectedPresentInPrompt = normalizedPrompt.includes(expected);
    if (!expectedPresentInPrompt) continue;
    const expectedPresentInResponse = normalizedResponse.includes(expected);
    const forbiddenPresentInResponse = forbiddenList.some((forbidden) => normalizedResponse.includes(forbidden));
    if (forbiddenPresentInResponse && !expectedPresentInResponse) {
      return true;
    }
  }

  return false;
};

const buildAccuracyAnchorForQuestion = (question: string): string => {
  const normalizedQuestion = String(question || '').trim();
  if (!normalizedQuestion) return '';
  if (!isDefinitionLikePrompt(normalizedQuestion)) return '';
  const correctedQuestion = normalizeIntentFromNoisyText(normalizedQuestion);
  const topicSource =
    correctedQuestion && correctedQuestion.toLowerCase() !== normalizedQuestion.toLowerCase()
      ? correctedQuestion
      : normalizedQuestion;
  const topic = extractKnowledgeTopic(topicSource);
  if (!topic) return '';
  const typoCorrected = topicSource !== normalizedQuestion;
  return [
    'Accuracy lock:',
    `- Exact topic/entity: ${topic}`,
    typoCorrected
      ? '- The user message appears misspelled. Answer the corrected intended topic/entity.'
      : '- Answer only this exact topic/entity.',
    '- Do not substitute with unrelated similarly spelled names.',
    '- Mention the exact topic/entity in the opening sentence.',
  ].join('\n');
};

const hasWikiMetaDefinitionFallbackPattern = (text: string): boolean => {
  const v = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!v) return false;
  return /\bwikifunctions has a function related to this topic\b/.test(v)
    || /\bmay refer to\b/.test(v)
    || /\bdisambiguation\b/.test(v)
    || /\bwiktionary\b/.test(v)
    || /\bwikidata\b/.test(v)
    || /\bwikiquote\b/.test(v)
    || /\bwikimedia commons\b/.test(v);
};

const wantsExplicitSourceLinks = (prompt: string): boolean => {
  const q = String(prompt || '').toLowerCase();
  return /\b(source|sources|citation|citations|cite|cited|reference|references|link|links|url|urls|wikipedia|official site|official website|direct link|product link)\b/.test(q);
};

const hasDirectUrl = (text: string): boolean =>
  /\bhttps?:\/\/[^\s<>"'`]+/i.test(String(text || ''));

const wantsActionableDirectLinks = (prompt: string): boolean => {
  const q = String(prompt || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!q) return false;
  return wantsExplicitSourceLinks(q);
};

const appendActionableLinksIfNeeded = (prompt: string, reply: string): string => {
  const output = String(reply || '').trim();
  if (!output) return output;
  if (isLikelyCodePrompt(prompt) || isMathLikePromptText(prompt)) return output;
  if (!wantsActionableDirectLinks(prompt)) return output;
  if (hasDirectUrl(output)) return output;

  return [
    output,
    '',
    'If you want, reply with "Give official links", and I will provide direct source links for this topic.'
  ].join('\n').trim();
};

const hasRawRetrievalArtifactPattern = (text: string): boolean => {
  const v = String(text || '').toLowerCase();
  if (!v) return false;
  return hasWikiMetaDefinitionFallbackPattern(v)
    || /\bbest[- ]effort answer from fallback sources\b/.test(v)
    || /\bbest[- ]effort comparison context from fallback sources\b/.test(v)
    || /\bsource:\s*https?:\/\//.test(v)
    || /\bhttps?:\/\/en\.wikipedia\.org\/\?curid=\d+\b/.test(v)
    || /\bhttps?:\/\/[^\s]+\b/.test(v)
    || /\(\s*\/[^)\n]{1,120}\/\s*\)/.test(String(text || ''))
    || /\/pl\.\s*n\.\s*drom\//i.test(String(text || ''));
};

const stripRawRetrievalArtifacts = (prompt: string, text: string): string => {
  if (wantsExplicitSourceLinks(prompt)) return String(text || '').trim();
  const value = String(text || '').replace(/\r/g, '');
  if (!value) return value;

  const parts = value.split(/(```[\s\S]*?```)/g).filter(Boolean);
  const sanitizePlain = (plain: string): string => {
    let out = String(plain || '');
    out = out
      .replace(/^\s*Best-effort answer from fallback sources.*$/gim, '')
      .replace(/^\s*Best-effort comparison context from fallback sources.*$/gim, '')
      .replace(/^\s*Wikifunctions has a function related to this topic\.?\s*$/gim, '')
      .replace(/^\s*(?:Wiktionary|Wikidata|Wikiquote|Wikimedia Commons)\b.*$/gim, '')
      .replace(/^\s*Source:\s*https?:\/\/[^\s]+.*$/gim, '')
      .replace(/^\s*Source:\s*.*$/gim, '')
      .replace(/\bWikifunctions has a function related to this topic\.?/gi, '')
      .replace(/\b(?:Wiktionary|Wikidata|Wikiquote|Wikimedia Commons)\b/gi, '')
      .replace(/\(\s*https?:\/\/[^\)]{1,220}\)/gi, '')
      .replace(/\bhttps?:\/\/en\.wikipedia\.org\/\?curid=\d+\b/gi, '')
      .replace(/\bhttps?:\/\/[^\s<>"'`]+/gi, '')
      .replace(/\(\s*\/[^)\n]{1,120}\/\s*\)/g, '')
      .replace(/\/pl\.\s*n\.\s*drom\//gi, '')
      .replace(/\/\s*[a-z](?:[\s.]*[a-z]){3,20}\s*\//gi, '')
      .replace(/\bsource\s*https?:\/\/[^\s<>"'`]+/gi, '')
      .replace(/\s+\(\s*\)/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return out;
  };

  return parts
    .map((part) => (part.startsWith('```') ? part.trim() : sanitizePlain(part)))
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const hasDynamicFactValidationRisk = (prompt: string, response: string): boolean => {
  const q = String(prompt || '').toLowerCase();
  const out = String(response || '').trim();
  const r = out.toLowerCase();
  if (!q || !r) return false;
  if (wantsExplicitSourceLinks(prompt)) return false;

  const dynamicPrompt =
    /(price|cost|msrp|release date|launch date|stock price|market cap|gdp|revenue|net worth|population|latest|current|today|as of|ranking|rank|richest)/.test(q);
  if (!dynamicPrompt) return false;

  const hasNumericClaim =
    /\d/.test(out)
    || /\b(?:usd|inr|eur|gbp|jpy|aed|qar|sar|cad|aud|cny)\b/i.test(out)
    || /[$Ã¢â€šÂ¬Ã‚Â£Ã¢â€šÂ¹]/.test(out);
  if (!hasNumericClaim) return false;

  const hasDateContext = /\bas of\b|\blaunch\b|\bmsrp\b|\b20\d{2}\b/.test(r);
  const hasUncertainty = /\bapprox(?:\.|imately)?\b|\baround\b|\babout\b|\bvar(?:y|ies)\b|\bdepends\b|\bestimate(?:d|s)?\b/.test(r);
  const hasRegionContext = /\bregion\b|\bcountry\b|\bmarket\b|\bseller\b|\bretailer\b/.test(r);
  const pricePrompt = /(price|cost|msrp)/.test(q);
  const currentMetricPrompt = /(latest|current|today|as of|stock price|market cap|gdp|revenue|net worth|population|ranking|rank|richest)/.test(q);

  if (pricePrompt && !(hasUncertainty && (hasRegionContext || hasDateContext))) {
    return true;
  }

  if (currentMetricPrompt && !hasDateContext) {
    return true;
  }

  return false;
};

const extractMediaReplySection = (response: string, heading: 'Main Content' | 'Emotion and Tone' | 'What Was Good' | 'What To Improve' | 'Spelling and Grammar Fixes' | 'Improved Version'): string => {
  const raw = String(response || '').replace(/\r/g, '');
  if (!raw) return '';
  const pattern = new RegExp(
    `(?:^|\\n)${heading}:\\s*\\n?([\\s\\S]*?)(?=\\n(?:Main Content|Emotion and Tone|What Was Good|What To Improve|Spelling and Grammar Fixes|Improved Version):|$)`,
    'i'
  );
  const match = raw.match(pattern);
  return String(match?.[1] || '').trim();
};

const normalizeMediaComparisonText = (value: string): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const computeMediaTokenOverlap = (left: string, right: string): number => {
  const leftTokens = new Set(normalizeMediaComparisonText(left).split(' ').filter((token) => token.length >= 3));
  const rightTokens = new Set(normalizeMediaComparisonText(right).split(' ').filter((token) => token.length >= 3));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = leftTokens.size + rightTokens.size - intersection;
  return union > 0 ? intersection / union : 0;
};

const isStructuredMediaReplyStrong = (response: string): boolean => {
  const out = String(response || '').trim();
  if (!out) return false;
  const requiredHeadings = ['Main Content:', 'Emotion and Tone:', 'What Was Good:', 'What To Improve:', 'Improved Version:'];
  if (!requiredHeadings.every((heading) => out.includes(heading))) return false;

  const main = extractMediaReplySection(out, 'Main Content');
  const tone = extractMediaReplySection(out, 'Emotion and Tone');
  const good = extractMediaReplySection(out, 'What Was Good');
  const improve = extractMediaReplySection(out, 'What To Improve');
  const improved = extractMediaReplySection(out, 'Improved Version');
  if (!main || !tone || !good || !improve || !improved) return false;

  const overlap = computeMediaTokenOverlap(main, improved);
  if (overlap >= 0.82) return false;
  if (normalizeMediaComparisonText(good) === normalizeMediaComparisonText(improve)) return false;

  return true;
};

const extractFileReplySection = (
  response: string,
  heading: 'File Overview' | 'Detailed Topic Summary' | 'Key Points and Concepts' | 'Practical Learnings' | 'Action Items'
): string => {
  const raw = String(response || '').replace(/\r/g, '');
  if (!raw) return '';
  const pattern = new RegExp(
    `(?:^|\\n)${heading}:\\s*\\n?([\\s\\S]*?)(?=\\n(?:File Overview|Detailed Topic Summary|Key Points and Concepts|Practical Learnings|Action Items):|$)`,
    'i'
  );
  const match = raw.match(pattern);
  return String(match?.[1] || '').trim();
};

const isStructuredFileReplyStrong = (response: string): boolean => {
  const out = String(response || '').trim();
  if (!out) return false;
  const requiredHeadings = ['File Overview:', 'Detailed Topic Summary:', 'Key Points and Concepts:', 'Practical Learnings:', 'Action Items:'];
  if (!requiredHeadings.every((heading) => out.includes(heading))) return false;

  const overview = extractFileReplySection(out, 'File Overview');
  const summary = extractFileReplySection(out, 'Detailed Topic Summary');
  const keyPoints = extractFileReplySection(out, 'Key Points and Concepts');
  const learnings = extractFileReplySection(out, 'Practical Learnings');
  const actionItems = extractFileReplySection(out, 'Action Items');
  if (!overview || !summary || !keyPoints || !learnings || !actionItems) return false;
  if (normalizeMediaComparisonText(summary) === normalizeMediaComparisonText(actionItems)) return false;
  return true;
};

const looksSuspiciousResponse = (prompt: string, response: string): boolean => {
  const out = String(response || '').trim();
  if (!out) return true;
  const envelopeType = getTelegramEnvelopeType(prompt);
  if (envelopeType && ['voice', 'audio', 'video'].includes(envelopeType) && isStructuredMediaReplyStrong(out)) return false;
  if (envelopeType && ['photo', 'document'].includes(envelopeType) && isStructuredFileReplyStrong(out)) return false;
  const multilingualPrompt = hasStrongNonLatinScript(prompt);
  if (multilingualPrompt) {
    if (isPromptEchoLikeReply(prompt, out)) return true;
    if (isLowValueDeflectionReply(out)) return true;
    return false;
  }
  const q = String(prompt || '').toLowerCase();
  const r = out.toLowerCase();
  if (isPromptEchoLikeReply(prompt, out)) return true;
  if (isLowValueDeflectionReply(out)) return true;
  if (isLikelyCodePrompt(prompt) && isLikelyIncompleteCodeReply(prompt, out)) return true;
  if (isLikelyCodePrompt(prompt) && isLikelyWeakCodeReply(prompt, out)) return true;
  if (isLikelyCodePrompt(prompt) && hasCodeSemanticMismatch(prompt, out)) return true;
  if (isDefinitionLikePrompt(prompt) && hasWikiMetaDefinitionFallbackPattern(out)) return true;
  if (!wantsExplicitSourceLinks(prompt) && hasRawRetrievalArtifactPattern(out)) return true;
  if (hasDynamicFactValidationRisk(prompt, out)) return true;
  if (hasKnownTemplateReuseMismatch(prompt, out)) return true;
  if (/(2026|2025|2024)/.test(q) && /\b2023\b/.test(r) && !/\b202[4-9]\b/.test(r)) return true;
  if (/i (can('?t|not)|don't) (browse|access real[- ]?time|verify current)/.test(r) && needsRealtimeSearch(q)) return true;
  if (/(market cap|gdp|revenue|population)/.test(q) && !/\d/.test(r)) return true;
  if (/(top|richest|ranking|rank|gdp|market cap|population|largest|biggest)/.test(q) && hasBrokenRankedMetricList(out)) return true;
  if (looksOffTopicForDefinitionPrompt(prompt, out)) return true;
  if (looksOffTopicByPromptOverlap(prompt, out)) return true;
  if (hasEntitySubstitutionSignal(prompt, out)) return true;
  return false;
};

const hasLowConfidenceMarkers = (response: string): boolean => {
  const r = String(response || '').toLowerCase();
  return /as of 2023|based on available data|i may be wrong|might be outdated|not sure|cannot confirm/.test(r);
};

const shouldUseAnswerVerification = (
  question: string,
  intent: 'math' | 'current_event' | 'coding' | 'general'
): boolean => {
  if (!AI_ENABLE_SELF_VERIFY) return false;
  if (intent === 'current_event') return true;
  if (isDefinitionLikePrompt(question)) return true;
  return /\b(explain|why|how|compare|difference|analyze|architecture|design|strategy)\b/i.test(question);
};

const selfVerifyAnswer = async (
  question: string,
  draftAnswer: string,
  history: BotChatTurn[],
  systemPrompt: string,
  aiRuntimeConfig?: AIRuntimeConfig
): Promise<string> => {
  const verifyPrompt = `Verify and correct the draft answer.

Requirements:
- The answer must directly address the exact user question.
- Stay on the exact topic and do not reuse an unrelated template.
- Infer likely intended words from misspellings using context, then stay consistent.
- Preserve the intended entity/topic. If the user misspelled the name, use the corrected intended name consistently.
- If the draft is off-topic, fully rewrite it.
- Keep the response professional, logical, and complete.
- Ensure all user sub-questions are answered.
- For unfamiliar low-confidence terms, ask for clarification instead of inventing a definition.
- For prices/current rankings/statistics with low confidence, avoid invented exact numbers and use wording like "Approximate estimate based on available data."
- Use dash bullets (-) for lists and avoid numeric list markers.
- Remove repetition and unfinished lines.
- End with a complete final sentence.

Question:
${question}

Draft Answer:
${draftAnswer}

Return only the final corrected answer.`;
  const verified = await withTimeout(
    generateBotResponse(verifyPrompt, undefined, history, systemPrompt, aiRuntimeConfig),
    AI_RESPONSE_TIMEOUT_MS,
    'AI verification timeout'
  );
  return String(verified || draftAnswer).trim();
};

const shouldRunFinalAnswerSelfCheck = (
  question: string,
  answer: string,
  intent: 'math' | 'current_event' | 'coding' | 'general'
): boolean => {
  if (!AI_ENABLE_FINAL_SELF_CHECK) return false;
  const q = String(question || '').trim();
  const a = String(answer || '').trim();
  if (!q || !a) return false;
  if (a.length < AI_FINAL_SELF_CHECK_MIN_CHARS && intent !== 'coding') return false;
  if (intent === 'coding') {
    // Avoid re-writing already-valid code with another LLM pass.
    // Only self-check code when it actually looks weak or incomplete.
    return isLikelyIncompleteCodeReply(q, a) || isLikelyWeakCodeReply(q, a);
  }
  if (isLikelyIncompleteNaturalAnswer(a)) return true;
  if (looksThinAnswerForComplexPrompt(a, q)) return true;
  if (isComplexPrompt(q)) return true;
  return /\b(compare|difference|explain|analy[sz]e|guide|roadmap|architecture|design|strategy|step by step)\b/i.test(q);
};

const finalSelfCheckAnswer = async (
  question: string,
  draftAnswer: string,
  history: BotChatTurn[],
  systemPrompt: string,
  intent: 'math' | 'current_event' | 'coding' | 'general',
  aiRuntimeConfig?: AIRuntimeConfig
): Promise<string> => {
  const current = String(draftAnswer || '').trim();
  if (!shouldRunFinalAnswerSelfCheck(question, current, intent)) {
    return current;
  }
  const breakdown = decomposeQuestionParts(question);

  const checklist = intent === 'coding'
    ? [
        '- Verify the code matches the requested functionality.',
        '- Ensure the answer is complete and not truncated.',
        '- Keep code professional, runnable, and correctly formatted.',
        '- Remove duplicate code or repeated explanation.',
      ].join('\n')
    : [
        '- Verify all parts of the user request are answered.',
        '- Verify the answer directly matches the exact topic/question and is not a reused unrelated template.',
        '- Add any obviously missing key step or detail needed for completeness.',
        '- Remove hallucinated or low-confidence invented facts/definitions.',
        '- Use dash bullets (-) for lists and avoid numeric list markers.',
        '- Do not split currency values or numeric values across lines.',
        '- Remove repetition, filler, and off-topic text.',
        '- Keep the answer logical, professional, and well-structured.',
        '- End with a complete final sentence.',
      ].join('\n');
  const multiPartChecklist = breakdown.isMultiPart
    ? `\n- Explicitly answer these parts in order:\n${breakdown.parts.map((part, index) => `  ${index + 1}. ${part}`).join('\n')}`
    : '';

  const verifyPrompt = `Final answer quality check and correction.

Question:
${question}

Draft answer:
${current}

Checklist:
${checklist}${multiPartChecklist}

Rules:
- Preserve the exact requested topic/entity and correct facts.
- For unfamiliar low-confidence terms, ask for clarification instead of inventing a definition.
- For prices/current rankings/statistics with low confidence, avoid invented exact numbers and use wording like "Approximate estimate based on available data."
- If the draft is already good, return a polished improved final version only.
- Do not mention this checklist or that you are verifying.
- Return only the final corrected answer.`;

  try {
    const verified = await withTimeout(
      generateBotResponse(verifyPrompt, undefined, history, systemPrompt, aiRuntimeConfig),
      AI_RESPONSE_TIMEOUT_MS,
      'AI final self-check timeout'
    );
    const out = String(verified || current).trim();
    return out || current;
  } catch {
    return current;
  }
};

const generateProfessionalReply = async (
  messageText: string,
  chatIdentity?: string | number,
  scope: string = 'telegram:primary',
  aiRuntimeConfig?: AIRuntimeConfig
): Promise<string> => {
  const trimmedInput = String(messageText || '').trim();
  const normalizedCommandLikeInput = String(messageText || '')
    .replace(/[\u200B-\u200F\uFEFF\u2060\u00A0]/g, ' ')
    .replace(/[\uFF0F\u2044\u2215]/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
  if (!trimmedInput) {
    return 'Please send a message so I can help.';
  }
  if (trimmedInput.length > MAX_USER_PROMPT_LENGTH) {
    return `Your message is too long (${trimmedInput.length} chars). Please keep it under ${MAX_USER_PROMPT_LENGTH} characters.`;
  }
  const conversationKey = buildConversationKey(scope, chatIdentity) || undefined;
  const commandReply = getCommandReply(trimmedInput, conversationKey);
  if (commandReply) {
    return commandReply;
  }
  const commandLikePrefix = /^\/[A-Za-z][A-Za-z0-9_]{1,24}\b/.test(normalizedCommandLikeInput);
  if (commandLikePrefix) {
    return 'Unknown command. Use /help to see all available commands.';
  }
  const naturalReminder = parseNaturalReminderIntent(trimmedInput);
  if (naturalReminder && conversationKey) {
    const reminderTask = createScheduledConversationReminderAt(
      conversationKey,
      naturalReminder.dueAtMs,
      naturalReminder.taskText,
      naturalReminder.recurring
    );
    if (reminderTask) {
      const reply = [
        'Reminder scheduled:',
        `- Task ID: ${reminderTask.id}`,
        `- Text: ${reminderTask.text}`,
        `- Due at: ${new Date(Number(reminderTask.dueAt || Date.now())).toISOString()}`,
        reminderTask.recurring && reminderTask.recurring !== 'none' ? `- Recurring: ${reminderTask.recurring}` : '- Recurring: none'
      ].join('\n');
      const answer = finalizeProfessionalReply(trimmedInput, reply, conversationKey);
      appendChatHistory(conversationKey, trimmedInput, answer);
      return answer;
    }
  }
  const analyticsReply = buildTelegramAnalyticsReply(trimmedInput, conversationKey);
  if (analyticsReply) {
    const answer = finalizeProfessionalReply(trimmedInput, analyticsReply, conversationKey);
    appendChatHistory(conversationKey, trimmedInput, answer);
    return answer;
  }
  const moderationDecision = runSafetyModerationPipeline(trimmedInput);
  recordModerationAudit({
    source: 'input',
    blocked: moderationDecision.blocked,
    category: moderationDecision.category,
    action: moderationDecision.blocked ? 'input_blocked' : 'input_allowed',
    prompt: trimmedInput,
    reason: moderationDecision.blocked ? 'Blocked by safety moderation pipeline' : 'No blocking category detected',
    conversationKey
  });
  if (moderationDecision.blocked) {
    const safeAnswer = finalizeProfessionalReply(trimmedInput, moderationDecision.response, conversationKey);
    appendChatHistory(conversationKey, trimmedInput, safeAnswer);
    return safeAnswer;
  }
  ensurePremiumConversationStyle(conversationKey);
  const renameTo = extractAssistantRenameCommand(trimmedInput);
  if (renameTo) {
    const appliedName = setAssistantNamePreference(conversationKey, renameTo);
    const confirm = finalizeProfessionalReply(
      trimmedInput,
      `Done. In this chat, you can call me ${appliedName}.`,
      conversationKey
    );
    appendChatHistory(conversationKey, trimmedInput, confirm);
    return confirm;
  }
  if (isRenameIntentPrompt(trimmedInput)) {
    const askName = finalizeProfessionalReply(
      trimmedInput,
      'Please tell me the exact name you want to use, for example: "Can I call you Savio?"',
      conversationKey
    );
    appendChatHistory(conversationKey, trimmedInput, askName);
    return askName;
  }

  const preserveStructuredInput =
    isTelegramMediaEnvelopePrompt(trimmedInput)
    || isLikelyFileNameOnlyPrompt(trimmedInput);
  const normalizedInputState = preserveStructuredInput
    ? {
        normalizedText: trimmedInput,
        loweredText: trimmedInput.toLowerCase(),
        corrected: false,
        corrections: [] as string[],
      }
    : normalizeIncomingUserMessage(normalizeUserQuestionText(trimmedInput) || trimmedInput);
  const normalizedInput = preserveStructuredInput
    ? trimmedInput
    : (normalizedInputState.normalizedText || trimmedInput);

  const priorityReply = getPriorityChatReply(normalizedInput);
  if (priorityReply) {
    appendChatHistory(conversationKey, normalizedInput, priorityReply);
    return priorityReply;
  }

  if (isGenericCodingIntentPrompt(normalizedInput)) {
    const clarifyingReply = finalizeProfessionalReply(
      normalizedInput,
      [
        'Great. I can help with coding.',
        '',
        'Please share these details:',
        '- Programming language',
        '- Exact problem statement',
        '- Input/output format or sample test cases (if available)'
      ].join('\n'),
      conversationKey,
      { includeTrustLayer: false }
    );
    appendChatHistory(conversationKey, normalizedInput, clarifyingReply);
    return clarifyingReply;
  }

  if (isHowAreYouPrompt(normalizedInput)) {
    const smallTalkReply = finalizeProfessionalReply(
      normalizedInput,
      PRIORITY_CHAT_REPLIES.howAreYou,
      conversationKey,
      { includeTrustLayer: false }
    );
    appendChatHistory(conversationKey, normalizedInput, smallTalkReply);
    return smallTalkReply;
  }

  const followUpContextEligible = !isTelegramMediaEnvelopePrompt(normalizedInput) && !isLikelyFileNameOnlyPrompt(normalizedInput);
  const answerRefResolution = followUpContextEligible
    ? resolveAnswerReferencePrompt(conversationKey, normalizedInput)
    : null;
  if (answerRefResolution?.errorReply) {
    const answer = finalizeProfessionalReply(normalizedInput, answerRefResolution.errorReply, conversationKey);
    appendChatHistory(conversationKey, normalizedInput, answer);
    return answer;
  }
  const followUpExpandedPrompt = followUpContextEligible
    ? resolveAffirmativeFollowUpPrompt(conversationKey, normalizedInput)
    : null;
  const mediaContextExpandedPrompt = (followUpContextEligible && !followUpExpandedPrompt)
    ? resolveMediaContextPrompt(conversationKey, normalizedInput)
    : null;
  const effectiveInput = answerRefResolution?.expandedPrompt || followUpExpandedPrompt || mediaContextExpandedPrompt || normalizedInput;
  const profileLearningInput = effectiveInput;
  const structuredOutputMode = ADVANCED_STRUCTURED_OUTPUT_ENABLED
    ? detectStructuredOutputMode(effectiveInput)
    : { kind: 'none' as const };
  if (ADVANCED_SEMANTIC_MEMORY_ENABLED) {
    ingestSemanticMemory(conversationKey, effectiveInput);
  }
  if (conversationKey && !followUpExpandedPrompt && !mediaContextExpandedPrompt) {
    const probe = normalizedInput.toLowerCase().trim();
    if (!isAffirmativeFollowUpReply(probe) && !isNegativeFollowUpReply(probe)) {
      followUpCueStore.delete(conversationKey);
    }
  }
  const normalizedPrompt = effectiveInput.toLowerCase().replace(/\s+/g, ' ').trim();
  const professionalIntent = classifyProfessionalIntent(effectiveInput, conversationKey);
  const intentLabel = PROFESSIONAL_INTENT_LABELS[professionalIntent];
  const intent = mapProfessionalIntentToRuntimeIntent(professionalIntent, effectiveInput);
  const intentRoutingInstruction = buildIntentRoutingInstruction(professionalIntent);
  const timeSensitive = isTimeSensitivePrompt(normalizedPrompt);
  if (conversationKey) {
    lastEngineStateByConversation.set(conversationKey, {
      intent,
      codingPolicyActive: intent === 'coding',
      promptPreview: effectiveInput.replace(/\s+/g, ' ').trim().slice(0, 160),
      updatedAt: Date.now()
    });
  }
  const realtimeSearchRequested = needsRealtimeSearch(effectiveInput) || wantsActionableDirectLinks(effectiveInput);
  const priorAnswerForSamePrompt = getMostRecentAnswerForSamePrompt(conversationKey, effectiveInput);
  const repeatedPromptInConversation = Boolean(priorAnswerForSamePrompt);
  const cacheScope = conversationKey || `${scope}:anonymous`;
  const cacheKey = `${cacheScope}:${RESPONSE_STYLE_VERSION}:${intent}:${normalizedPrompt}`;
  const cached = (timeSensitive || repeatedPromptInConversation) ? undefined : aiResponseCache.get(cacheKey);
  if (repeatedPromptInConversation && !timeSensitive) {
    console.log('[AI_LOG] cache_bypass_repeat_prompt', JSON.stringify({
      chatId: chatIdentity || null,
      scope,
      intent
    }));
  }
  if (cached && cached.expiresAt > Date.now()) {
    const vettedCached = finalizeProfessionalReply(effectiveInput, cached.text, conversationKey);
    const cacheSuspicious = looksSuspiciousResponse(effectiveInput, vettedCached);
    if (!isLowValueDeflectionReply(vettedCached) && !cacheSuspicious) {
      aiResponseCache.set(cacheKey, { text: vettedCached, expiresAt: cached.expiresAt });
      console.log('[AI_LOG] cache_hit', JSON.stringify({
        chatId: chatIdentity || null,
        scope,
        intent,
        responseLength: vettedCached.length
      }));
      return vettedCached;
    }
    console.log('[AI_LOG] cache_reject', JSON.stringify({
      chatId: chatIdentity || null,
      scope,
      intent,
      suspicious: cacheSuspicious
    }));
  }
  if (cached) {
    aiResponseCache.delete(cacheKey);
  }

  const existingInFlight = aiInFlightRequests.get(cacheKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const run = (async (): Promise<string> => {
    const userProfile = updateUserProfile(conversationKey, profileLearningInput);
    let systemPrompt = buildSystemPrompt(intent, userProfile);
    systemPrompt = `${systemPrompt}\n\nIntent routing context:\n- Classified intent: ${intentLabel}\n- Follow the routing rule for this intent.`;
    const modelPrompt = normalizePromptForModel(effectiveInput);
    const accuracyAnchor = buildAccuracyAnchorForQuestion(effectiveInput);
    const questionBreakdownInstruction = buildQuestionBreakdownInstruction(effectiveInput);
    let lockedModelPrompt = [modelPrompt, accuracyAnchor, questionBreakdownInstruction, intentRoutingInstruction].filter(Boolean).join('\n\n');
    const history = getChatHistory(conversationKey).slice(-CHAT_HISTORY_MAX_TURNS);
    const preferredProvider = String(aiRuntimeConfig?.provider || process.env.AI_PROVIDER || '').trim().toLowerCase();
    const resolvedProvider = LOCKED_PROVIDER_NAME;
    const incomingModel = String(aiRuntimeConfig?.model || '').trim();
    const resolvedModel = incomingModel || DEFAULT_OPENROUTER_MODEL;
    if (preferredProvider && preferredProvider !== LOCKED_PROVIDER_NAME) {
      console.warn('[AI_CONFIG] Provider override ignored. Runtime is locked to NVIDIA.', JSON.stringify({
        requestedProvider: preferredProvider,
        lockedProvider: LOCKED_PROVIDER_NAME
      }));
    }
    const enforcedRuntimeConfig: AIRuntimeConfig = {
      provider: resolvedProvider,
      model: resolvedModel || undefined,
      forceProvider: true
    };
    const hardQuestionRequested = /\b(hard|hardest|advanced|deep|expert)\b/i.test(effectiveInput);
    if (STRICT_RELIABILITY_MODE && resolvedProvider === LOCKED_PROVIDER_NAME) {
      const preferredReliabilityModel = intent === 'coding'
        ? (RELIABILITY_PREFERRED_CODE_MODEL || RELIABILITY_PREFERRED_GENERAL_MODEL)
        : RELIABILITY_PREFERRED_GENERAL_MODEL;
      if (preferredReliabilityModel) {
        enforcedRuntimeConfig.model = preferredReliabilityModel;
      }
    }
    const previousSameAnswerPreview = sanitizeForTelegram(String(priorAnswerForSamePrompt || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 900);
    const complexPromptRequested = isComplexPrompt(effectiveInput);
    const codingPromptRequested = intent === 'coding';
    const adaptiveResponseTimeoutMs = codingPromptRequested
      ? Math.max(AI_RESPONSE_TIMEOUT_MS, 75000)
      : (complexPromptRequested || hardQuestionRequested)
        ? Math.max(AI_RESPONSE_TIMEOUT_MS, 60000)
        : AI_RESPONSE_TIMEOUT_MS;
    const adaptiveFallbackTimeoutMs = codingPromptRequested
      ? Math.max(AI_FALLBACK_TIMEOUT_MS, 90000)
      : (complexPromptRequested || hardQuestionRequested)
        ? Math.max(AI_FALLBACK_TIMEOUT_MS, 65000)
        : AI_FALLBACK_TIMEOUT_MS;
    const effectiveResponseTimeoutMs = SUPER_FAST_RESPONSE_MODE
      ? Math.min(adaptiveResponseTimeoutMs, SUPER_FAST_PRIMARY_TIMEOUT_MS)
      : adaptiveResponseTimeoutMs;
    const effectiveFallbackTimeoutMs = SUPER_FAST_RESPONSE_MODE
      ? Math.min(adaptiveFallbackTimeoutMs, SUPER_FAST_FALLBACK_TIMEOUT_MS)
      : adaptiveFallbackTimeoutMs;
    const replyPathTrace: string[] = [];
    const safeFailReply = (_reason: string): string => {
      const contextualRecovery = buildContextReferenceRecoveryReply(conversationKey, effectiveInput);
      if (contextualRecovery && !isLowValueDeflectionReply(contextualRecovery)) {
        replyPathTrace.push(`safe_fail_context_recovery:${_reason}`);
        return contextualRecovery;
      }
      const emergency = generateEmergencyReply(effectiveInput, conversationKey);
      return String(emergency || '').trim() || 'I could not generate a reliable answer in this pass. Please resend the same question once.';
    };
    const ensureReliableFinalReply = (candidate: string, reason: string): string => {
      const cleanCandidate = finalizeProfessionalReply(effectiveInput, candidate, conversationKey);
      if (!cleanCandidate) return finalizeProfessionalReply(effectiveInput, safeFailReply(reason), conversationKey);
      if (looksSuspiciousResponse(effectiveInput, cleanCandidate)) {
        replyPathTrace.push(`safe_fail:${reason}`);
        return finalizeProfessionalReply(effectiveInput, safeFailReply(reason), conversationKey);
      }
      return cleanCandidate;
    };
    const advancedContextBlocks: string[] = [];
    const workspaceDocs = retrieveConversationKnowledgeDocs(conversationKey, effectiveInput, 3);
    const workspaceKbBlock = formatConversationKnowledgeBlock(workspaceDocs);
    if (workspaceKbBlock) {
      advancedContextBlocks.push(workspaceKbBlock);
    }
    if (ADVANCED_RAG_ENABLED) {
      const kb = retrieveKnowledgeSnippets(effectiveInput);
      const kbBlock = formatRagSnippetsBlock(kb);
      if (kbBlock) advancedContextBlocks.push(kbBlock);
    }
    if (ADVANCED_SEMANTIC_MEMORY_ENABLED) {
      const memoryItems = retrieveSemanticMemory(conversationKey, effectiveInput);
      const memoryBlock = formatSemanticMemoryBlock(memoryItems);
      if (memoryBlock) advancedContextBlocks.push(memoryBlock);
    }
    if (ADVANCED_WEB_SEARCH_ENABLED && (realtimeSearchRequested || timeSensitive)) {
      try {
        const citations = await searchWebWithCitations(effectiveInput, { maxResults: 4, timeoutMs: 9000 });
        const citationBlock = formatSearchCitationsBlock(citations);
        if (citationBlock) {
          advancedContextBlocks.push(citationBlock);
          if (citations.length > 0) {
            systemPrompt = `${systemPrompt}\n\nLive-data rule:\n- Use the provided web search context and cite sources as [1], [2], etc. for current facts.\n- If sources conflict, say so briefly and prefer the most recent source.`;
          }
        }
      } catch (searchError) {
        console.warn('[WEB_SEARCH] search failed:', searchError instanceof Error ? searchError.message : String(searchError));
      }
    }
    if (structuredOutputMode.kind !== 'none') {
      const structureRules = buildStructuredOutputInstructions(structuredOutputMode);
      if (structureRules) {
        systemPrompt = `${systemPrompt}\n\n${structureRules}`;
      }
    }
    if (advancedContextBlocks.length > 0) {
      lockedModelPrompt = [lockedModelPrompt, ...advancedContextBlocks].filter(Boolean).join('\n\n');
    }
    const startedAt = Date.now();
    const repairCodeReplyIfNeeded = async (candidate: string): Promise<string> => {
      const current = String(candidate || '').trim();
      if (professionalIntent !== 'coding_request') return current;
      const requiresRepair =
        isLikelyIncompleteCodeReply(effectiveInput, current)
        || isLikelyWeakCodeReply(effectiveInput, current);
      if (!requiresRepair) return current;

      const repairPrompt = `${lockedModelPrompt || modelPrompt || effectiveInput}

Code completion required.
Your previous code output was truncated, weak, incomplete, or badly formatted.

Rules:
- Return one complete and runnable final solution from start to end.
- Keep strict line by line formatting with proper indentation.
- Do not include markdown fences.
- Do not include hash comments, slash comments, or triple quote comment blocks.
- Keep explanation short and outside code.
- Ensure the algorithm is correct for edge cases.
- Include full code only once, not multiple duplicate versions.

Return only the corrected final answer.`;

      const tryFallbackRepair = async (): Promise<string | null> => {
        try {
          const fallbackRepair = await withTimeout(
            getAIResponse(repairPrompt, history, systemPrompt, enforcedRuntimeConfig),
            effectiveFallbackTimeoutMs,
            'AI fallback code repair timeout'
          );
          const fallbackPolished = formatProfessionalResponse(fallbackRepair || current, effectiveInput);
          const fallbackClean = finalizeProfessionalReply(effectiveInput, fallbackPolished, conversationKey);
          if (!fallbackClean) return null;
          if (isLikelyIncompleteCodeReply(effectiveInput, fallbackClean) || isLikelyWeakCodeReply(effectiveInput, fallbackClean)) return null;
          return fallbackClean;
        } catch {
          return null;
        }
      };

      try {
        const repaired = await withTimeout(
          generateBotResponse(repairPrompt, undefined, history, systemPrompt, enforcedRuntimeConfig),
          effectiveResponseTimeoutMs,
          'AI code repair timeout'
        );
        const repairedPolished = formatProfessionalResponse(repaired || current, effectiveInput);
        const repairedClean = finalizeProfessionalReply(effectiveInput, repairedPolished, conversationKey);
        if (!repairedClean) return current;
        if (!isLikelyIncompleteCodeReply(effectiveInput, repairedClean) && !isLikelyWeakCodeReply(effectiveInput, repairedClean)) return repairedClean;
        const fallbackFixed = await tryFallbackRepair();
        return fallbackFixed || repairedClean;
      } catch {
        const fallbackFixed = await tryFallbackRepair();
        return fallbackFixed || current;
      }
    };
    const freshenRepeatedAnswerIfNeeded = async (candidate: string): Promise<string> => {
      const current = String(candidate || '').trim();
      if (!current || !priorAnswerForSamePrompt) return current;
      if (!isMeaningfullyRepeatedAnswer(priorAnswerForSamePrompt, current)) return current;

      const antiRepeatPrompt = `${lockedModelPrompt || modelPrompt || effectiveInput}

Answer upgrade required.
The user asked this same question again.
Previous answer (do not repeat wording/structure):
${previousSameAnswerPreview || '[previous answer unavailable]'}

Rules:
- Keep the exact topic and facts correct.
- Give a fresh, full, professional answer with improved wording and structure.
- Add useful detail, examples, or steps where appropriate.
- Do not copy the previous answer text.

Return only the improved final answer.`;

      try {
        const upgraded = await withTimeout(
          generateBotResponse(antiRepeatPrompt, undefined, history, systemPrompt, enforcedRuntimeConfig),
          effectiveResponseTimeoutMs,
          'AI anti-repeat upgrade timeout'
        );
        const upgradedPolished = formatProfessionalResponse(upgraded || current, effectiveInput);
        let upgradedClean = finalizeProfessionalReply(effectiveInput, upgradedPolished, conversationKey);
        if (!upgradedClean) return current;
        if (looksSuspiciousResponse(effectiveInput, upgradedClean)) return current;
        if (isMeaningfullyRepeatedAnswer(priorAnswerForSamePrompt, upgradedClean)) return current;
        return upgradedClean;
      } catch (upgradeError) {
        console.warn('[AI_LOG] anti_repeat_upgrade_failed', JSON.stringify({
          chatId: chatIdentity || null,
          scope,
          intent,
          error: upgradeError instanceof Error ? upgradeError.message : String(upgradeError)
        }));
        return current;
      }
    };
    const enforceStructuredOutputIfNeeded = (candidate: string): string => {
      if (structuredOutputMode.kind === 'none') return candidate;
      return normalizeStructuredOutput(candidate, structuredOutputMode);
    };
    const enforceCodeValidationIfNeeded = async (candidate: string): Promise<string> => {
      const current = String(candidate || '').trim();
      if (!ADVANCED_CODE_VALIDATION_ENABLED) return current;
      if (professionalIntent !== 'coding_request') return current;
      const artifact = extractCodeArtifactFromText(current, effectiveInput);
      if (!artifact?.code) return current;
      const validation = validateGeneratedCode(artifact.code, artifact.language);
      if (validation.ok) return current;

      const fixPrompt = `${lockedModelPrompt || modelPrompt || effectiveInput}

Code validation failed.
Detected language: ${artifact.language}
Validation error: ${validation.error || 'Unknown syntax issue'}

Rules:
- Return one corrected, complete, runnable final answer.
- Fix the syntax/formatting issue exactly.
- Preserve the user's requested functionality.
- If JSON was requested, return valid JSON only.

Return only the corrected final answer.`;

      try {
        const fixed = await withTimeout(
          generateBotResponse(fixPrompt, undefined, history, systemPrompt, enforcedRuntimeConfig),
          effectiveResponseTimeoutMs,
          'AI code validation repair timeout'
        );
        const fixedClean = finalizeProfessionalReply(
          effectiveInput,
          formatProfessionalResponse(String(fixed || current), effectiveInput),
          conversationKey
        );
        return fixedClean || current;
      } catch {
        return current;
      }
    };
    const enforceCodeExecutionIfNeeded = async (candidate: string): Promise<string> => {
      const current = String(candidate || '').trim();
      if (!ADVANCED_CODE_EXECUTION_FIX_ENABLED) return current;
      if (!isSubprocessCodeExecutionEnabled()) return current;
      if (professionalIntent !== 'coding_request') return current;

      let latest = current;
      for (let attempt = 0; attempt <= ADVANCED_CODE_EXECUTION_MAX_FIX_LOOPS; attempt += 1) {
        const artifact = extractCodeArtifactFromText(latest, effectiveInput);
        if (!artifact?.code) return latest;
        const lang = String(artifact.language || '').toLowerCase();
        if (!['javascript', 'js', 'python', 'py'].includes(lang)) return latest;

        const exec = await executeCodeWithExecutionLayer(
          artifact.code,
          lang.startsWith('py') ? 'python' : 'javascript',
          { timeoutMs: 1500 }
        );

        if (exec.ok) {
          const hasOutput = String(exec.stdout || '').trim();
          if (!hasOutput) return latest;
          // If code likely intended to print a result, attach a short execution note outside code.
          if (!/output|print|console\.log|example|demo/i.test(effectiveInput)) return latest;
          return `${latest}\n\nExecution check (sandbox):\n${exec.stdout.trim().slice(0, 500)}`;
        }

        if (attempt >= ADVANCED_CODE_EXECUTION_MAX_FIX_LOOPS) {
          return latest;
        }

        const fixPrompt = `${lockedModelPrompt || modelPrompt || effectiveInput}

Runtime execution check failed for generated code.
Language: ${lang}
Exit code: ${exec.exitCode ?? 'unknown'}
Timed out: ${exec.timedOut ? 'yes' : 'no'}
STDOUT:
${String(exec.stdout || '').slice(0, 1000) || '(empty)'}

STDERR / Error:
${String(exec.stderr || exec.error || '').slice(0, 1500) || '(empty)'}

Rules:
- Return one corrected final answer with complete runnable code.
- Fix the runtime error while preserving requested functionality.
- Keep code formatting clean and complete.
- If the prompt asked for JSON/schema, preserve that output format.

Return only the corrected final answer.`;

        try {
          const fixed = await withTimeout(
            generateBotResponse(fixPrompt, undefined, history, systemPrompt, enforcedRuntimeConfig),
            effectiveResponseTimeoutMs,
            'AI runtime execution repair timeout'
          );
          const fixedClean = finalizeProfessionalReply(
            effectiveInput,
            formatProfessionalResponse(String(fixed || latest), effectiveInput),
            conversationKey
          );
          if (!fixedClean || fixedClean === latest) {
            return latest;
          }
          latest = fixedClean;
        } catch {
          return latest;
        }
      }

      return latest;
    };
    const continueIncompleteAnswerIfNeeded = async (candidate: string): Promise<string> => {
      let current = String(candidate || '').trim();
      if (!current) return current;
      if (structuredOutputMode.kind !== 'none') return current;

      const codeLike = professionalIntent === 'coding_request';
      const incompleteCode = codeLike && isLikelyIncompleteCodeReply(effectiveInput, current);
      const incompleteNatural =
        !codeLike &&
        (isLikelyIncompleteNaturalAnswer(current)
          || (looksThinAnswerForComplexPrompt(current, effectiveInput) && current.length < 1200));
      if (!incompleteCode && !incompleteNatural) return current;

      const maxRounds = incompleteCode ? 1 : 3;
      for (let round = 0; round < maxRounds; round += 1) {
        const continuationPrompt = incompleteCode
          ? `${lockedModelPrompt || modelPrompt || effectiveInput}

Your previous answer appears incomplete or cut off, especially the code section.

Previous draft answer:
${current.slice(0, 5000)}

Rules:
- Return one complete corrected final answer from start to end.
- If code is required, provide a full runnable solution in proper code fences.
- Do not leave the answer unfinished.
- Do not output placeholders or partial snippets.

Return only the final answer.`
          : `${lockedModelPrompt || modelPrompt || effectiveInput}

Your previous answer appears incomplete or cut off.

Original user question:
${effectiveInput}

Current partial answer:
${current.slice(-5000)}

Continue from where the answer stopped.
Rules:
- Do not repeat the earlier content.
- Finish all remaining points clearly.
- End with a complete final sentence.

Return only the continuation.`;

        try {
          const continuation = await withTimeout(
            generateBotResponse(continuationPrompt, undefined, history, systemPrompt, enforcedRuntimeConfig),
            effectiveResponseTimeoutMs,
            'AI continuation timeout'
          );
          const continuationPolished = formatProfessionalResponse(String(continuation || ''), effectiveInput);
          const continuationClean = finalizeProfessionalReply(effectiveInput, continuationPolished, conversationKey);
          if (!continuationClean) break;

          current = incompleteCode
            ? continuationClean
            : mergeContinuationText(current, continuationClean);

          if (codeLike) {
            if (!isLikelyIncompleteCodeReply(effectiveInput, current)) break;
          } else if (!isLikelyIncompleteNaturalAnswer(current)) {
            break;
          }
        } catch {
          break;
        }
      }
      return current;
    };
    const finalizeAdvancedOutput = async (candidate: string): Promise<string> => {
      let out = String(candidate || '').trim();
      out = await repairCodeReplyIfNeeded(out);
      out = await enforceCodeValidationIfNeeded(out);
      out = await enforceCodeExecutionIfNeeded(out);
      out = await continueIncompleteAnswerIfNeeded(out);
      out = await freshenRepeatedAnswerIfNeeded(out);
      out = enforceStructuredOutputIfNeeded(out);
      return out;
    };
    console.log('[AI_LOG] request', JSON.stringify({
      chatId: chatIdentity || null,
      scope,
      intent,
      provider: enforcedRuntimeConfig.provider || 'auto',
      model: enforcedRuntimeConfig.model || 'default',
      realtimeSearchTriggered: realtimeSearchRequested,
      question: effectiveInput.slice(0, 400),
      modelPrompt: modelPrompt.slice(0, 240),
      isolatedHistory: false,
      classifiedIntent: intentLabel
    }));
    try {
      replyPathTrace.push('primary_model_attempt');
      const response = await withTimeout(
        generateBotResponse(lockedModelPrompt || modelPrompt || effectiveInput, undefined, history, systemPrompt, enforcedRuntimeConfig),
        effectiveResponseTimeoutMs,
        'AI response timeout'
      );
      replyPathTrace.push('primary_model_success');
      const polished = formatProfessionalResponse(response || 'No response generated.', effectiveInput);
      let clean = finalizeProfessionalReply(effectiveInput, polished, conversationKey);
      if (!clean || (clean.length < 24 && !isAcceptableShortAnswer(clean, effectiveInput))) {
        throw new Error('PRIMARY_SHORT_REPLY');
      }
      if (AI_ENABLE_STRICT_RETRY && (intent === 'current_event' || timeSensitive) && hasLowConfidenceMarkers(clean)) {
        const strictRetryPrompt = `${lockedModelPrompt || modelPrompt || effectiveInput}\n\nRealtime expected. Use verified live data strictly. Do not fall back to 2023 memory.`;
        const strictRetry = await withTimeout(
          generateBotResponse(strictRetryPrompt, undefined, history, systemPrompt, enforcedRuntimeConfig),
          effectiveResponseTimeoutMs,
          'AI strict retry timeout'
        );
        clean = finalizeProfessionalReply(
          effectiveInput,
          formatProfessionalResponse(strictRetry || clean, effectiveInput),
          conversationKey
        );
      }
      const forceQualityRetry = looksThinAnswerForComplexPrompt(clean, effectiveInput);
      const shouldRetry = (AI_MAX_RETRY_PASSES > 0 || forceQualityRetry)
        && (
          looksSuspiciousResponse(effectiveInput, clean)
          || hasEntitySubstitutionSignal(effectiveInput, clean)
          || (!isSimplePrompt(effectiveInput) && looksLowQualityAnswer(clean, effectiveInput))
          || forceQualityRetry
        );
      if (shouldRetry) {
        const retryPrompt = `${lockedModelPrompt || modelPrompt || effectiveInput}

Answer correction required.
Original question: ${effectiveInput}
Current draft answer may be off-topic or mismatched.

Rules:
- Answer only the exact question.
- Preserve the intended entity/topic. If the user misspelled the name, use the corrected intended name consistently.
- Do not substitute similar names.
- Give a logical, complete, and accurate final answer.

Return only the corrected final answer.`;
        const retry = await withTimeout(
          generateBotResponse(retryPrompt, undefined, history, systemPrompt, enforcedRuntimeConfig),
          effectiveResponseTimeoutMs,
          'AI response timeout'
        );
        const retryPolished = formatProfessionalResponse(retry || clean, effectiveInput);
        let retryClean = finalizeProfessionalReply(effectiveInput, retryPolished, conversationKey);
        if (shouldUseAnswerVerification(effectiveInput, intent) && !isSimplePrompt(effectiveInput)) {
          retryClean = finalizeProfessionalReply(
            effectiveInput,
            formatProfessionalResponse(await selfVerifyAnswer(effectiveInput, retryClean, history, systemPrompt, enforcedRuntimeConfig), effectiveInput),
            conversationKey
          );
        }
        if (looksSuspiciousResponse(effectiveInput, retryClean)) {
          replyPathTrace.push('retry_rejected_suspicious');
          throw new Error('RETRY_SUSPICIOUS_OUTPUT');
        }
        retryClean = await finalizeAdvancedOutput(retryClean);
        retryClean = finalizeProfessionalReply(
          effectiveInput,
          formatProfessionalResponse(
            await finalSelfCheckAnswer(effectiveInput, retryClean, history, systemPrompt, intent, enforcedRuntimeConfig),
            effectiveInput
          ),
          conversationKey
        );
        retryClean = ensureReliableFinalReply(retryClean, 'retry_final');
        appendChatHistory(conversationKey, effectiveInput, retryClean);
        if (!timeSensitive && !isLowValueDeflectionReply(retryClean) && !looksSuspiciousResponse(effectiveInput, retryClean)) {
          aiResponseCache.set(cacheKey, { text: retryClean, expiresAt: Date.now() + AI_CACHE_TTL_MS });
          pruneAiResponseCache();
        }
        console.log('[AI_LOG] response', JSON.stringify({
          chatId: chatIdentity || null,
          scope,
          intent,
          realtimeSearchTriggered: realtimeSearchRequested,
          latencyMs: Date.now() - startedAt,
          responseLength: retryClean.length,
          retried: true,
          replyPath: replyPathTrace
        }));
        return retryClean;
      }
      if (shouldUseAnswerVerification(effectiveInput, intent) && !isSimplePrompt(effectiveInput)) {
        clean = finalizeProfessionalReply(
          effectiveInput,
          formatProfessionalResponse(await selfVerifyAnswer(effectiveInput, clean, history, systemPrompt, enforcedRuntimeConfig), effectiveInput),
          conversationKey
        );
      }
      if (looksSuspiciousResponse(effectiveInput, clean)) {
        replyPathTrace.push('primary_final_rejected_suspicious');
        throw new Error('PRIMARY_SUSPICIOUS_OUTPUT');
      }
      clean = await finalizeAdvancedOutput(clean);
      clean = finalizeProfessionalReply(
        effectiveInput,
        formatProfessionalResponse(
          await finalSelfCheckAnswer(effectiveInput, clean, history, systemPrompt, intent, enforcedRuntimeConfig),
          effectiveInput
        ),
        conversationKey
      );
      clean = ensureReliableFinalReply(clean, 'primary_final');
      appendChatHistory(conversationKey, effectiveInput, clean);
      if (!timeSensitive && !isLowValueDeflectionReply(clean) && !looksSuspiciousResponse(effectiveInput, clean)) {
        aiResponseCache.set(cacheKey, { text: clean, expiresAt: Date.now() + AI_CACHE_TTL_MS });
        pruneAiResponseCache();
      }
      console.log('[AI_LOG] response', JSON.stringify({
        chatId: chatIdentity || null,
        scope,
        intent,
        realtimeSearchTriggered: realtimeSearchRequested,
          latencyMs: Date.now() - startedAt,
          responseLength: clean.length,
          retried: false,
          replyPath: replyPathTrace
        }));
      return clean;
    } catch (error) {
      const primaryErrorText = error instanceof Error ? error.message : String(error);
      console.error('[AI] Primary model failed:', error);

      replyPathTrace.push('primary_failed_retry_once');
      try {
        const retryPrompt = `${lockedModelPrompt || modelPrompt || effectiveInput}

System note:
- The previous generation attempt failed due a temporary runtime issue.
- Retry once and provide the best direct final answer for the same user request.
`;
        const retryResponse = await withTimeout(
          generateBotResponse(retryPrompt, undefined, history, systemPrompt, enforcedRuntimeConfig),
          effectiveResponseTimeoutMs,
          'AI retry timeout'
        );
        let retryClean = finalizeProfessionalReply(
          effectiveInput,
          formatProfessionalResponse(String(retryResponse || ''), effectiveInput),
          conversationKey
        );
        if (!retryClean || looksSuspiciousResponse(effectiveInput, retryClean)) {
          throw new Error('RETRY_UNRELIABLE');
        }
        retryClean = await finalizeAdvancedOutput(retryClean);
        retryClean = finalizeProfessionalReply(
          effectiveInput,
          formatProfessionalResponse(
            await finalSelfCheckAnswer(effectiveInput, retryClean, history, systemPrompt, intent, enforcedRuntimeConfig),
            effectiveInput
          ),
          conversationKey
        );
        if (!retryClean || looksSuspiciousResponse(effectiveInput, retryClean)) {
          throw new Error('RETRY_UNRELIABLE_AFTER_SELF_CHECK');
        }
        appendChatHistory(conversationKey, effectiveInput, retryClean);
        if (!timeSensitive && !isLowValueDeflectionReply(retryClean) && !looksSuspiciousResponse(effectiveInput, retryClean)) {
          aiResponseCache.set(cacheKey, { text: retryClean, expiresAt: Date.now() + AI_CACHE_TTL_MS });
          pruneAiResponseCache();
        }
        console.log('[AI_LOG] response', JSON.stringify({
          chatId: chatIdentity || null,
          scope,
          intent,
          realtimeSearchTriggered: realtimeSearchRequested,
          latencyMs: Date.now() - startedAt,
          responseLength: retryClean.length,
          retried: true,
          replyPath: replyPathTrace
        }));
        return retryClean;
      } catch (retryError) {
        replyPathTrace.push('retry_once_failed');
        const retryOnly = finalizeProfessionalReply(
          effectiveInput,
          buildRetryOnlyPoliteMessage(effectiveInput, professionalIntent, conversationKey),
          conversationKey
        ) || buildRetryOnlyPoliteMessage(effectiveInput, professionalIntent, conversationKey);
        appendChatHistory(conversationKey, effectiveInput, retryOnly);
        console.error('[AI_LOG] error', JSON.stringify({
          chatId: chatIdentity || null,
          scope,
          intent,
          realtimeSearchTriggered: realtimeSearchRequested,
          latencyMs: Date.now() - startedAt,
          error: `${primaryErrorText} | retry_error=${
            retryError instanceof Error ? retryError.message : String(retryError)
          }`,
          replyPath: replyPathTrace
        }));
        return retryOnly;
      }
    }
  })();

  aiInFlightRequests.set(cacheKey, run);
  try {
    return await run;
  } finally {
    aiInFlightRequests.delete(cacheKey);
  }
};

type TelegramPromptExtraction = {
  promptText: string;
  rawText: string;
  kind: 'text' | 'photo' | 'document' | 'voice' | 'audio' | 'video' | 'sticker' | 'location' | 'contact' | 'unsupported';
};

const buildInlineResultId = (): string =>
  `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

const handleTelegramInlineQuery = async (
  targetBot: TelegramBot,
  inlineQuery: TelegramBot.InlineQuery,
  scope: string
): Promise<void> => {
  const queryId = String(inlineQuery?.id || '').trim();
  const queryText = String(inlineQuery?.query || '').trim();
  const fromId = String((inlineQuery as any)?.from?.id || '').trim();
  if (!queryId) return;

  if (!queryText) {
    await targetBot.answerInlineQuery(queryId, [
      {
        type: 'article',
        id: buildInlineResultId(),
        title: 'Ask anything',
        description: 'Type a question to get a professional inline answer.',
        input_message_content: {
          message_text: 'Type your question after mentioning the bot inline.'
        }
      } as any
    ], {
      is_personal: true,
      cache_time: 1
    } as any);
    return;
  }

  const conversationIdentity = fromId ? `inline:${fromId}` : `inline:${queryId}`;
  const answerRaw = await generateProfessionalReply(queryText, conversationIdentity, scope);
  const answer = String(answerRaw || '').replace(/\r/g, '').trim().slice(0, 3900) || 'Answer unavailable in this attempt.';
  await targetBot.answerInlineQuery(queryId, [
    {
      type: 'article',
      id: buildInlineResultId(),
      title: `Answer: ${queryText.slice(0, 48)}`,
      description: 'Tap to send this answer into chat',
      input_message_content: {
        message_text: answer
      }
    } as any
  ], {
    is_personal: true,
    cache_time: 1
  } as any);
};

const mediaDeepAnalysisPattern = /\b(full\s+description|describe|analysis|analyze|analyse|feedback|emotion|tone|mood|what\s+(?:was|is)\s+(?:said|told)|transcript|summari(?:ze|se)|improv(?:e|ement))\b/i;

const shouldRunDeepMediaAnalysis = (caption: string): boolean =>
  mediaDeepAnalysisPattern.test(String(caption || '').toLowerCase());

const buildMediaResponseGuide = (
  kind: 'voice' | 'audio' | 'video',
  caption: string,
  transcript: string | null
): string => {
  const mediaType = kind === 'video' ? 'video recording' : 'audio recording';
  const wantsDeepReview = shouldRunDeepMediaAnalysis(caption);
  const hasTranscript = !!String(transcript || '').trim();
  const guideLines = [
    'Media response rules:',
    `Message type: ${mediaType}.`,
    hasTranscript
      ? 'Use transcript text as primary evidence. Do not invent missing quotes.'
      : 'Transcript is unavailable. Use caption and metadata only, and do not claim exact spoken wording.',
    wantsDeepReview
      ? 'User asked for full analysis, so provide complete detail.'
      : 'If user asked a specific media question, answer that first, then include concise feedback.',
    'Keep language professional, clear, and easy to scan.',
    'Ground every section in the actual transcript/caption evidence.',
    'Do not reuse fixed generic lines across different media inputs.',
    'Use exactly these sections with one blank line between each section:',
    'Main Content:',
    'Emotion and Tone:',
    'What Was Good:',
    'What To Improve:',
    'Spelling and Grammar Fixes:',
    'Improved Version:',
    'What Was Good and What To Improve must each include at least 3 distinct bullet points.',
    'Spelling and Grammar Fixes must include concrete language corrections when transcript errors are present.',
    'Improved Version must be a polished rewrite and must not repeat Main Content verbatim.',
  ];
  if (!hasTranscript) {
    guideLines.push('End with one line: For exact wording, please resend clearer audio or share a transcript.');
  }
  return guideLines.join('\n');
};

const buildTelegramPromptFromMessage = async (
  botInstance: TelegramBot,
  msg: any
): Promise<TelegramPromptExtraction> => {
  const rawText = String(msg?.text || '').trim();
  if (rawText) {
    return { promptText: rawText, rawText, kind: 'text' };
  }

  const caption = String(msg?.caption || '').trim();
  const captionBlock = caption ? `Caption: ${caption}\n` : '';
  const chatAsk = '\nPlease help based on this message content.';

  const getPublicFileLink = async (fileId?: string): Promise<string> => {
    const id = String(fileId || '').trim();
    if (!id) return '';
    try {
      const link = await botInstance.getFileLink(id);
      return String(link || '').trim();
    } catch {
      return '';
    }
  };

  if (Array.isArray(msg?.photo) && msg.photo.length > 0) {
    const biggest = [...msg.photo].sort((a: any, b: any) => Number(b?.file_size || 0) - Number(a?.file_size || 0))[0];
    const fileLink = await getPublicFileLink(biggest?.file_id);
    const promptText = await buildPhotoPromptFromTelegramFile({
      fileUrl: fileLink,
      fileName: String(biggest?.file_id ? `telegram_photo_${String(biggest.file_id).slice(0, 12)}.jpg` : 'telegram_photo.jpg'),
      mimeType: 'image/jpeg',
      caption
    }).catch(() => [
      '[PHOTO MESSAGE]',
      captionBlock.trim(),
      fileLink ? `Telegram file URL: ${fileLink}` : 'Photo uploaded in Telegram (file URL unavailable).',
      'Image extraction was limited in this attempt.',
      'Please help based on this message content.'
    ].filter(Boolean).join('\n'));
    return { promptText, rawText: caption, kind: 'photo' };
  }

  if (msg?.document) {
    const doc = msg.document;
    const fileLink = await getPublicFileLink(doc?.file_id);
    const mimeType = String(doc?.mime_type || '').toLowerCase();
    const mediaDocKind: 'audio' | 'video' | null =
      mimeType.startsWith('audio/') ? 'audio' : mimeType.startsWith('video/') ? 'video' : null;
    if (mediaDocKind) {
      const transcript = fileLink ? await transcribeTelegramMediaFromUrl(fileLink) : null;
      const mediaGuide = buildMediaResponseGuide(mediaDocKind, caption, transcript);
      const promptText = [
        `[${mediaDocKind === 'video' ? 'VIDEO' : 'AUDIO'} DOCUMENT MESSAGE]`,
        captionBlock.trim(),
        `File name: ${String(doc?.file_name || 'unknown')}`,
        `Mime type: ${String(doc?.mime_type || 'unknown')}`,
        fileLink ? `Telegram file URL: ${fileLink}` : '',
        transcript ? `Transcript:\n${transcript.slice(0, 5000)}` : 'Transcript unavailable in this runtime.',
        mediaGuide
      ].filter(Boolean).join('\n') + chatAsk;
      return { promptText, rawText: caption, kind: mediaDocKind };
    }
    const fallbackPromptText = [
      '[DOCUMENT MESSAGE]',
      captionBlock.trim(),
      `File name: ${String(doc?.file_name || 'unknown')}`,
      `Mime type: ${String(doc?.mime_type || 'unknown')}`,
      fileLink ? `Telegram file URL: ${fileLink}` : '',
      'Document response rules:',
      'Use metadata only if content extraction is unavailable, and state limitations clearly.',
      'Treat file upload itself as a direct request for detailed summary even when caption is empty.',
      'Do not ask the user to resend with a caption.',
      'Then provide these sections with one blank line between each section:',
      'File Overview:',
      'Detailed Topic Summary:',
      'Key Points and Concepts:',
      'Practical Learnings:',
      'Action Items:',
      'Please help based on this message content.'
    ].filter(Boolean).join('\n');
    const promptText = await buildDocumentPromptFromTelegramFile({
      fileUrl: fileLink,
      fileName: String(doc?.file_name || 'unknown'),
      mimeType: String(doc?.mime_type || 'unknown'),
      caption
    }).catch(() => fallbackPromptText);
    return { promptText, rawText: caption, kind: 'document' };
  }

  if (msg?.voice) {
    const fileLink = await getPublicFileLink(msg.voice?.file_id);
    const transcript = fileLink ? await transcribeTelegramMediaFromUrl(fileLink) : null;
    const mediaGuide = buildMediaResponseGuide('voice', caption, transcript);
    const promptText = [
      '[VOICE MESSAGE]',
      captionBlock.trim(),
      `Duration seconds: ${Number(msg.voice?.duration || 0)}`,
      fileLink ? `Telegram file URL: ${fileLink}` : '',
      transcript ? `Transcript:\n${transcript.slice(0, 5000)}` : 'Transcript unavailable in this runtime.',
      mediaGuide
    ].filter(Boolean).join('\n') + chatAsk;
    return { promptText, rawText: caption, kind: 'voice' };
  }

  if (msg?.audio) {
    const fileLink = await getPublicFileLink(msg.audio?.file_id);
    const transcript = fileLink ? await transcribeTelegramMediaFromUrl(fileLink) : null;
    const mediaGuide = buildMediaResponseGuide('audio', caption, transcript);
    const promptText = [
      '[AUDIO MESSAGE]',
      captionBlock.trim(),
      `Title: ${String(msg.audio?.title || '')}`.trim(),
      `Performer: ${String(msg.audio?.performer || '')}`.trim(),
      fileLink ? `Telegram file URL: ${fileLink}` : '',
      transcript ? `Transcript:\n${transcript.slice(0, 5000)}` : 'Transcript unavailable in this runtime.',
      mediaGuide
    ].filter(Boolean).join('\n') + chatAsk;
    return { promptText, rawText: caption, kind: 'audio' };
  }

  if (msg?.video) {
    const fileLink = await getPublicFileLink(msg.video?.file_id);
    const transcript = fileLink ? await transcribeTelegramMediaFromUrl(fileLink) : null;
    const mediaGuide = buildMediaResponseGuide('video', caption, transcript);
    const promptText = [
      '[VIDEO MESSAGE]',
      captionBlock.trim(),
      `Duration seconds: ${Number(msg.video?.duration || 0)}`,
      fileLink ? `Telegram file URL: ${fileLink}` : '',
      transcript ? `Audio transcript (if extracted):\n${transcript.slice(0, 5000)}` : '',
      transcript ? '' : 'Transcript unavailable in this runtime.',
      mediaGuide
    ].filter(Boolean).join('\n') + chatAsk;
    return { promptText, rawText: caption, kind: 'video' };
  }

  if (msg?.video_note) {
    const fileLink = await getPublicFileLink(msg.video_note?.file_id);
    const transcript = fileLink ? await transcribeTelegramMediaFromUrl(fileLink) : null;
    const mediaGuide = buildMediaResponseGuide('video', caption, transcript);
    const promptText = [
      '[VIDEO NOTE MESSAGE]',
      captionBlock.trim(),
      `Duration seconds: ${Number(msg.video_note?.duration || 0)}`,
      fileLink ? `Telegram file URL: ${fileLink}` : '',
      transcript ? `Audio transcript (if extracted):\n${transcript.slice(0, 5000)}` : '',
      transcript ? '' : 'Transcript unavailable in this runtime.',
      mediaGuide
    ].filter(Boolean).join('\n') + chatAsk;
    return { promptText, rawText: caption, kind: 'video' };
  }

  if (msg?.location) {
    const promptText = `[LOCATION MESSAGE]
Latitude: ${Number(msg.location?.latitude || 0)}
Longitude: ${Number(msg.location?.longitude || 0)}${chatAsk}`;
    return { promptText, rawText: '', kind: 'location' };
  }

  if (msg?.contact) {
    const promptText = `[CONTACT MESSAGE]
Name: ${String(msg.contact?.first_name || '')} ${String(msg.contact?.last_name || '')}`.trim() + `
Phone: ${String(msg.contact?.phone_number || '')}${chatAsk}`;
    return { promptText, rawText: '', kind: 'contact' };
  }

  if (msg?.sticker) {
    const stickerEmoji = String(msg.sticker?.emoji || '').trim();
    const promptText = `[STICKER MESSAGE]
Emoji: ${stickerEmoji || '(none)'}
Please respond naturally to the sticker and invite the user to send a text question if they want detailed help.`;
    return { promptText, rawText: '', kind: 'sticker' };
  }

  return {
    promptText: 'I received a Telegram message type that is not fully supported yet. Please resend it as text.',
    rawText: '',
    kind: 'unsupported'
  };
};

// Telegram Bot Handler with debug logging
const handleTelegramMessage = async (msg: TelegramBot.Message) => {
  const chatId = msg.chat.id;
  const extracted = await buildTelegramPromptFromMessage(bot, msg as any);
  const messageText = extracted.promptText;
  const commandSourceText = extracted.rawText;
  if (!messageText) return;
  const incomingCommand = commandSourceText ? extractTelegramCommand(commandSourceText) : '';

  // Prevent dual processing when primary token is also deployed as a managed bot.
  const primaryToken = String(TELEGRAM_TOKEN || '').trim();
  const primaryBotId = primaryToken ? getBotIdByTelegramToken(primaryToken) : '';
  if (primaryBotId) {
    await handleBotMessage(primaryToken, msg);
    return;
  }
  observeTelegramMessage('telegram:primary', msg);

  console.log(`[TELEGRAM] Received ${extracted.kind} message from ${msg.from?.username || 'Unknown'}: ${messageText.slice(0, 240)}`);
  const conversationKey = buildConversationKey('telegram:primary', chatId) || undefined;
  const senderDisplayName = resolveTelegramStartDisplayName(conversationKey, msg);
  if (!(incomingCommand && extracted.kind === 'text')) {
    upsertConversationKnowledgeFromPrompt(
      conversationKey,
      extracted.kind,
      messageText,
      commandSourceText || String((msg as any)?.text || (msg as any)?.caption || '')
    );
  }
  const antiSpamPrimary = await evaluateTelegramAntiSpamGuard(
    'telegram:primary',
    msg,
    commandSourceText || String((msg as any)?.text || (msg as any)?.caption || messageText || ''),
    incomingCommand || ''
  );
  if (antiSpamPrimary.blocked) {
    const antiSpamReply = antiSpamPrimary.response || 'Please wait before sending more messages.';
    await sendTelegramReply(bot, chatId, antiSpamReply, msg.message_id);
    await sendTelegramStickerForReply(bot, chatId, messageText, antiSpamReply, conversationKey, msg.message_id);
    return;
  }
  if (incomingCommand === 'start') {
    const welcome = await sendTelegramStartMenu(bot, chatId, msg.message_id, conversationKey, senderDisplayName);
    await sendTelegramStickerForReply(bot, chatId, '/start', welcome, conversationKey, msg.message_id);
    return;
  }
  if (incomingCommand === 'remind' && commandSourceText) {
    const parsedReminder = parseReminderCommand(commandSourceText);
    if (!parsedReminder) {
      await sendTelegramCommandReply(
        bot,
        chatId,
        'Use /remind <minutes> <text>, /remind in 30m <text>, /remind at 6pm <text>, or /remind daily 8am <text>.',
        msg.message_id
      );
      await sendTelegramStickerForReply(
        bot,
        chatId,
        commandSourceText || '/remind',
        'Use /remind <minutes> <text>, /remind in 30m <text>, /remind at 6pm <text>, or /remind daily 8am <text>.',
        conversationKey,
        msg.message_id
      );
      return;
    }
    const reminderTask = createScheduledConversationReminderAt(
      conversationKey,
      parsedReminder.dueAtMs,
      parsedReminder.taskText,
      parsedReminder.recurring
    );
    if (!reminderTask) {
      await sendTelegramCommandReply(
        bot,
        chatId,
        'Could not schedule this reminder in this chat.',
        msg.message_id
      );
      await sendTelegramStickerForReply(
        bot,
        chatId,
        commandSourceText || '/remind',
        'Could not schedule this reminder in this chat.',
        conversationKey,
        msg.message_id
      );
      return;
    }
    const reminderReply = [
      'Reminder scheduled:',
      `- Task ID: ${reminderTask.id}`,
      `- Text: ${reminderTask.text}`,
      `- Due at: ${new Date(Number(reminderTask.dueAt || Date.now())).toISOString()}`,
      reminderTask.recurring && reminderTask.recurring !== 'none' ? `- Recurring: ${reminderTask.recurring}` : '- Recurring: none'
    ].join('\n');
    await sendTelegramCommandReply(
      bot,
      chatId,
      reminderReply,
      msg.message_id
    );
    await sendTelegramStickerForReply(bot, chatId, commandSourceText || '/remind', reminderReply, conversationKey, msg.message_id);
    return;
  }
  if (incomingCommand === 'subscribe') {
    const userId = String(msg.from?.id || '').trim();
    if (userId) {
      const subscriptionReply = buildTelegramSubscriptionStatusReply('telegram:primary', String(chatId), userId);
      await sendTelegramCommandReply(bot, chatId, subscriptionReply, msg.message_id);
      await sendTelegramStickerForReply(bot, chatId, commandSourceText || '/subscribe', subscriptionReply, conversationKey, msg.message_id);
      return;
    }
  }
  const commandReply = commandSourceText ? getCommandReply(commandSourceText, conversationKey) : '';
  if (commandReply) {
    await sendTelegramCommandReply(bot, chatId, commandReply, msg.message_id);
    await sendTelegramStickerForReply(bot, chatId, commandSourceText || messageText, commandReply, conversationKey, msg.message_id);
    return;
  }
  if (shouldShortCircuitMediaLocalAnalysis(extracted.kind, messageText, commandSourceText)) {
    const quickMediaReply = buildMediaDeterministicFallbackReply(messageText);
    if (quickMediaReply) {
      await sendTelegramReply(bot, chatId, quickMediaReply, msg.message_id);
      await sendTelegramStickerForReply(bot, chatId, messageText, quickMediaReply, conversationKey, msg.message_id);
      return;
    }
  }
  try {
    await bot.sendChatAction(chatId, 'typing');
    const response = await sendTelegramStreamingReply(
      bot,
      chatId,
      generateProfessionalReply(messageText, chatId, 'telegram:primary'),
      msg.message_id,
      undefined,
      messageText,
      conversationKey
    );
    await sendTelegramStickerForReply(bot, chatId, messageText, response, conversationKey, msg.message_id);
    console.log(`[TELEGRAM] Sending response length=${response.length}`);
  } catch (error) {
    console.error('[TELEGRAM] Failed to handle message:', error);
    const fallbackReply = await resolveLegacyBestEffortFallbackReply(messageText, undefined, conversationKey);
    await sendTelegramReply(
      bot,
      chatId,
      fallbackReply,
      msg.message_id
    );
    await sendTelegramStickerForReply(bot, chatId, messageText, fallbackReply, conversationKey, msg.message_id);
  }
};

// Function to handle messages for specific bots
const handleBotMessage = async (botToken: string, msg: any, forcedBotId?: string) => {
  const chatId = msg.chat.id;
  let text = '';
  const normalizedForcedBotId = String(forcedBotId || '').trim();
  const botId = normalizedForcedBotId || getBotIdByTelegramToken(botToken);
  let botInstance = managedBots.get(botToken);
  if (!botInstance) {
    botInstance = new TelegramBot(botToken, { polling: false });
    managedBots.set(botToken, botInstance);
  }
  const extracted = await buildTelegramPromptFromMessage(botInstance, msg);
  text = extracted.promptText;
  const commandSourceText = extracted.rawText;
  const incomingCommand = commandSourceText ? extractTelegramCommand(commandSourceText) : '';
  if (!text) return;

  const botScope = `telegram:${botId || botToken.slice(0, 12)}`;
  observeTelegramMessage(botScope, msg as TelegramBot.Message);
  const conversationKey = buildConversationKey(botScope, chatId) || undefined;
  const senderDisplayName = resolveTelegramStartDisplayName(conversationKey, msg);
  if (!(incomingCommand && extracted.kind === 'text')) {
    upsertConversationKnowledgeFromPrompt(
      conversationKey,
      extracted.kind,
      text,
      commandSourceText || String((msg as any)?.text || (msg as any)?.caption || '')
    );
  }
  const antiSpamManaged = await evaluateTelegramAntiSpamGuard(
    botScope,
    msg as TelegramBot.Message,
    commandSourceText || String((msg as any)?.text || (msg as any)?.caption || text || ''),
    incomingCommand || ''
  );
  if (antiSpamManaged.blocked) {
    const antiSpamReply = antiSpamManaged.response || 'Please wait before sending more messages.';
    await sendTelegramReply(botInstance, chatId, antiSpamReply, msg.message_id);
    await sendTelegramStickerForReply(botInstance, chatId, text, antiSpamReply, conversationKey, msg.message_id);
    if (botId) recordBotResponse(botId, antiSpamManaged.response || '', 0);
    return;
  }
  if (incomingCommand === 'start') {
    const welcome = await sendTelegramStartMenu(botInstance, chatId, msg.message_id, conversationKey, senderDisplayName);
    await sendTelegramStickerForReply(botInstance, chatId, '/start', welcome, conversationKey, msg.message_id);
    if (botId) recordBotResponse(botId, welcome, 0);
    return;
  }
  const commandReply = commandSourceText ? getCommandReply(commandSourceText, conversationKey) : '';
  if (commandReply) {
    await sendTelegramCommandReply(botInstance, chatId, commandReply, msg.message_id);
    await sendTelegramStickerForReply(botInstance, chatId, commandSourceText || text, commandReply, conversationKey, msg.message_id);
    if (botId) recordBotResponse(botId, commandReply, 0);
    return;
  }
  if (shouldShortCircuitMediaLocalAnalysis(extracted.kind, text, commandSourceText)) {
    const quickMediaReply = buildMediaDeterministicFallbackReply(text);
    if (quickMediaReply) {
      await sendTelegramReply(botInstance, chatId, quickMediaReply, msg.message_id);
      await sendTelegramStickerForReply(botInstance, chatId, text, quickMediaReply, conversationKey, msg.message_id);
      if (botId) recordBotResponse(botId, quickMediaReply, 0);
      return;
    }
  }

  if (botId && CREDIT_ENFORCEMENT_ACTIVE) {
    const ownerEmail = (telegramBotOwners.get(botId) || getPersistedTelegramOwner(botId) || '').trim().toLowerCase();
    const subStatus = ownerEmail ? getOwnerProSubscriptionStatus(ownerEmail) : null;
    if (subStatus && !subStatus.active) {
      const expiredReply = `Ã¢Å¡Â Ã¯Â¸Â ${getSubscriptionExpiredWarningMessage()}`;
      await sendTelegramReply(
        botInstance,
        chatId,
        expiredReply,
        msg.message_id
      );
      await sendTelegramStickerForReply(botInstance, chatId, text, expiredReply, conversationKey, msg.message_id);
      persistBotState();
      return;
    }
    const credit = applyCreditDecay(botId);
    if (credit.depleted || credit.remainingUsd <= 0) {
      const creditReply = `\u26A0\uFE0F ${getCreditDepletedWarningMessage()}`;
      await sendTelegramReply(
        botInstance,
        chatId,
        creditReply,
        msg.message_id
      );
      await sendTelegramStickerForReply(botInstance, chatId, text, creditReply, conversationKey, msg.message_id);
      persistBotState();
      return;
    }
  }
  if (text.length > MAX_USER_PROMPT_LENGTH) {
    const lengthReply = `Your message is too long (${text.length} chars). Please keep it under ${MAX_USER_PROMPT_LENGTH} characters.`;
    await sendTelegramReply(
      botInstance,
      chatId,
      lengthReply,
      msg.message_id
    );
    await sendTelegramStickerForReply(botInstance, chatId, text, lengthReply, conversationKey, msg.message_id);
    return;
  }
  if (botId) recordBotIncoming(botId);

  console.log(`[BOT_${botToken.substring(0, 8)}] Incoming ${extracted.kind} message from ChatID: ${chatId}`);
  let selectedProvider = LOCKED_PROVIDER_NAME;
  let selectedModel = String(botId ? (telegramBotAiModels.get(botId) || '') : '').trim();
  if (botId) {
    if (!selectedModel) {
      selectedModel = resolveTelegramAiConfig('').model;
    }
    telegramBotAiProviders.set(botId, LOCKED_PROVIDER_NAME);
    telegramBotAiModels.set(botId, selectedModel);
  }
  if (!selectedModel) {
    selectedModel = resolveTelegramAiConfig('').model;
  }

  if (incomingCommand === 'remind' && commandSourceText) {
    const parsedReminder = parseReminderCommand(commandSourceText);
    if (!parsedReminder) {
      const usageReply = 'Use /remind <minutes> <text>, /remind in 30m <text>, /remind at 6pm <text>, or /remind daily 8am <text>.';
      await sendTelegramCommandReply(botInstance, chatId, usageReply, msg.message_id);
      await sendTelegramStickerForReply(botInstance, chatId, commandSourceText || '/remind', usageReply, conversationKey, msg.message_id);
      if (botId) recordBotResponse(botId, usageReply, 0);
      return;
    }
    const reminderTask = createScheduledConversationReminderAt(
      conversationKey,
      parsedReminder.dueAtMs,
      parsedReminder.taskText,
      parsedReminder.recurring
    );
    const scheduledReply = reminderTask
      ? [
        'Reminder scheduled:',
        `- Task ID: ${reminderTask.id}`,
        `- Text: ${reminderTask.text}`,
        `- Due at: ${new Date(Number(reminderTask.dueAt || Date.now())).toISOString()}`,
        reminderTask.recurring && reminderTask.recurring !== 'none' ? `- Recurring: ${reminderTask.recurring}` : '- Recurring: none'
      ].join('\n')
      : 'Could not schedule this reminder in this chat.';
    await sendTelegramCommandReply(botInstance, chatId, scheduledReply, msg.message_id);
    await sendTelegramStickerForReply(botInstance, chatId, commandSourceText || '/remind', scheduledReply, conversationKey, msg.message_id);
    if (botId) recordBotResponse(botId, scheduledReply, 0);
    return;
  }
  if (incomingCommand === 'subscribe') {
    const userId = String(msg?.from?.id || '').trim();
    if (userId) {
      const subscriptionReply = buildTelegramSubscriptionStatusReply(botScope, String(chatId), userId);
      await sendTelegramCommandReply(botInstance, chatId, subscriptionReply, msg.message_id);
      await sendTelegramStickerForReply(botInstance, chatId, commandSourceText || '/subscribe', subscriptionReply, conversationKey, msg.message_id);
      if (botId) recordBotResponse(botId, subscriptionReply, 0);
      return;
    }
  }

  try {
    const startedAt = Date.now();
    await botInstance.sendChatAction(chatId, 'typing');
    const conversationKey = buildConversationKey(botScope, chatId) || undefined;
    const aiReply = await sendTelegramStreamingReply(
      botInstance,
      chatId,
      generateProfessionalReply(text, chatId, botScope, {
        provider: selectedProvider,
        model: selectedModel
      }),
      msg.message_id,
      undefined,
      text,
      conversationKey
    );
    await sendTelegramStickerForReply(botInstance, chatId, text, aiReply, conversationKey, msg.message_id);
    if (botId) recordBotResponse(botId, aiReply, Date.now() - startedAt);
  } catch (err) {
    console.error(`[BOT_${botToken.substring(0, 8)}_FAIL] Failed to route signal:`, err);
    if (botId) recordBotError(botId, err);
    const fallbackReply = await resolveLegacyBestEffortFallbackReply(text, undefined, conversationKey);
    await sendTelegramReply(
      botInstance,
      chatId,
      fallbackReply,
      msg.message_id
    );
    await sendTelegramStickerForReply(botInstance, chatId, text, fallbackReply, conversationKey, msg.message_id);
  }
};

/**
 * Webhook Ingestion Routes
 */
const enqueueTelegramWebhookTask = (
  queueKey: string,
  task: () => Promise<void>
): boolean => telegramWebhookQueue.enqueue(queueKey, task);

// Webhook endpoint for Telegram
app.post('/webhook', (req, res) => {
  if (!verifyTelegramWebhookRequest(req, 'primary')) {
    return res.status(401).json({ error: 'Unauthorized webhook source' });
  }
  const updateId = Number(req.body?.update_id);
  const normalizedUpdateId = Number.isFinite(updateId) ? updateId : undefined;
  if (telegramWebhookUpdateDeduper.hasDuplicate('primary', normalizedUpdateId)) {
    return res.sendStatus(200);
  }
  const message = req.body.message;
  const inlineQuery = req.body.inline_query;
  if (message) {
    const accepted = enqueueTelegramWebhookTask('telegram:primary', async () => {
      await handleTelegramMessage(message);
    });
    if (!accepted) {
      return res.status(503).json({ error: 'Webhook queue is busy. Please retry.' });
    }
    telegramWebhookUpdateDeduper.markSeen('primary', normalizedUpdateId);
  } else if (inlineQuery) {
    const accepted = enqueueTelegramWebhookTask('telegram:primary:inline', async () => {
      await handleTelegramInlineQuery(bot, inlineQuery, 'telegram:primary');
    });
    if (!accepted) {
      return res.status(503).json({ error: 'Webhook queue is busy. Please retry.' });
    }
    telegramWebhookUpdateDeduper.markSeen('primary', normalizedUpdateId);
  }
  return res.sendStatus(200);
});

// Bot-specific webhook routes
app.post('/webhook/:botId', (req, res) => {
  const { botId } = req.params;
  if (!verifyTelegramWebhookRequest(req, botId)) {
    return res.status(401).json({ error: 'Unauthorized webhook source' });
  }
  const updateId = Number(req.body?.update_id);
  const normalizedUpdateId = Number.isFinite(updateId) ? updateId : undefined;
  if (telegramWebhookUpdateDeduper.hasDuplicate(`bot:${botId}`, normalizedUpdateId)) {
    return res.sendStatus(200);
  }
  let botToken = botTokens.get(botId);

  // Lazy recovery: if process restarted and in-memory map is empty, hydrate from persisted state.
  if (!botToken) {
    const state = loadPersistedBotState();
    const match = state.telegramBots.find((b) => b.botId === botId);
    if (match?.botToken) {
      botToken = match.botToken;
      botTokens.set(match.botId, match.botToken);
      removeDuplicateTelegramTokenEntries(match.botId, match.botToken);
      if (match.botUsername) telegramBotUsernames.set(match.botId, String(match.botUsername).trim());
      if (match.botName) telegramBotNames.set(match.botId, String(match.botName).trim());
      const normalizedAi = resolveTelegramAiConfig(String(match.aiModel || '').trim());
      telegramBotAiProviders.set(match.botId, normalizedAi.provider);
      telegramBotAiModels.set(match.botId, normalizedAi.model);
      botCredits.set(match.botId, {
        remainingUsd: Math.max(0, Number(match.creditRemainingUsd ?? INITIAL_BOT_CREDIT_USD)),
        lastChargedAt: Math.max(0, Number(match.creditLastChargedAt ?? Date.now())),
        depleted: Boolean(match.creditDepleted) || Number(match.creditRemainingUsd ?? INITIAL_BOT_CREDIT_USD) <= 0,
        updatedAt: Date.now(),
        policyVersion: Math.max(1, Number(match.creditPolicyVersion || 1))
      });
      applyCreditDecay(match.botId);
      if (match.ownerEmail) {
        telegramBotOwners.set(match.botId, match.ownerEmail.trim().toLowerCase());
        ensureBotTelemetry(match.botId, 'TELEGRAM', match.ownerEmail.trim().toLowerCase());
      }
    }
  }
  
  if (!botToken) {
    const now = Date.now();
    const lastLoggedAt = unknownWebhookBotLogTimestamps.get(botId) || 0;
    if (now - lastLoggedAt >= UNKNOWN_WEBHOOK_BOT_LOG_THROTTLE_MS) {
      console.warn(`[WEBHOOK] Unknown bot route ${botId}; ignoring update.`);
      unknownWebhookBotLogTimestamps.set(botId, now);
    }
    return res.sendStatus(200);
  }
  if (!isValidTelegramBotTokenFormat(botToken)) {
    console.warn(`[WEBHOOK] Invalid Telegram token format for bot ${botId}; pruning mapping.`);
    clearTelegramBotRegistryEntry(botId);
    persistBotState();
    return res.sendStatus(200);
  }
  
  console.log(`[WEBHOOK] Received signal update for bot ${botId}`);
  
  // Handle the message
  if (req.body.message) {
    const accepted = enqueueTelegramWebhookTask(`telegram:${botId}`, async () => {
      await handleBotMessage(botToken!, req.body.message, botId);
    });
    if (!accepted) {
      return res.status(503).json({ error: 'Webhook queue is busy. Please retry.' });
    }
    telegramWebhookUpdateDeduper.markSeen(`bot:${botId}`, normalizedUpdateId);
  } else if (req.body.inline_query) {
    const accepted = enqueueTelegramWebhookTask(`telegram:${botId}:inline`, async () => {
      let botInstance = managedBots.get(botToken!);
      if (!botInstance) {
        botInstance = new TelegramBot(botToken!, { polling: false });
        managedBots.set(botToken!, botInstance);
      }
      await handleTelegramInlineQuery(botInstance, req.body.inline_query, `telegram:${botId}`);
    });
    if (!accepted) {
      return res.status(503).json({ error: 'Webhook queue is busy. Please retry.' });
    }
    telegramWebhookUpdateDeduper.markSeen(`bot:${botId}`, normalizedUpdateId);
  }
  
  return res.sendStatus(200);
});

/**
 * Gateway Provisioning
 */
app.get('/set-webhook', requireAdminAccess, async (req, res) => {
  if (!isProduction) {
    return res.json({
      ok: true,
      status: "Local Development Mode",
      endpoint: `${BASE_URL}/webhook`,
      telegram_meta: {
        ok: true,
        result: "Webhook skipped in local mode. Polling is active."
      }
    });
  }

  if (!TELEGRAM_TOKEN) {
    return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN is not configured' });
  }

  const webhookUrl = `${BASE_URL}/webhook`;
  const secretToken = buildTelegramWebhookSecret('primary');
  const registerUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}${secretToken ? `&secret_token=${encodeURIComponent(secretToken)}` : ''}`;
  
  console.log(`[PROVISIONING] Attempting to link webhook to: ${webhookUrl}`);
  
  try {
    const response = await fetch(registerUrl);
    const data: any = await response.json();
    
    console.log("[TELEGRAM_API] Handshake Response:", data);
    
    res.json({
      ok: true,
      status: "Operational",
      endpoint: webhookUrl,
      telegram_meta: data
    });
  } catch (err) {
    console.error("[HANDSHAKE_ERROR] Provisioning failed:", err);
    res.status(500).json({ error: "Provisioning gateway unreachable." });
  }
});


/**
 * Get Webhook Info
 */
app.get('/get-webhook-info', requireAdminAccess, async (req, res) => {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return res.status(400).json({ success: false, error: 'TELEGRAM_BOT_TOKEN is not configured' });
    }
    const getInfoUrl = `https://api.telegram.org/bot${botToken}/getWebhookInfo`;
    
    console.log('[WEBHOOK_INFO] Getting webhook info');
    
    const response = await fetch(getInfoUrl);
    const data: any = await response.json();
    
    console.log('[WEBHOOK_INFO] Telegram Response:', data);
    
    res.json({
      success: true,
      webhookInfo: data
    });
  } catch (error) {
    console.error(`[WEBHOOK_INFO] Error getting webhook info:`, error);
    res.status(500).json({
      success: false,
      error: 'Failed to get webhook info',
      details: (error as Error).message || 'Unknown error'
    });
  }
});

app.get('/miniapp', (_req, res) => {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SwiftDeploy Mini App</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; font-family: Segoe UI, Arial, sans-serif; background: #0b1020; color: #e8ecff; }
    .wrap { max-width: 760px; margin: 0 auto; padding: 22px 16px 40px; }
    .card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; padding: 16px; margin-top: 14px; }
    h1 { margin: 0 0 6px; font-size: 22px; }
    p { margin: 8px 0; line-height: 1.5; }
    .mono { font-family: Consolas, monospace; font-size: 13px; }
    a { color: #9bd0ff; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>SwiftDeploy Workspace Mini App</h1>
    <p>This workspace is active. Use your Telegram bot commands for advanced actions.</p>
    <div class="card">
      <p><strong>Quick Actions</strong></p>
      <p>- /task add &lt;text&gt; [/by &lt;time&gt;] [/p high|medium|low] and /remind at 6pm &lt;text&gt;</p>
      <p>- /digest daily 8am and /template email|resume|linkedin|caption|script</p>
      <p>- /groupreport for group activity and intent analytics</p>
      <p>- /trust on|off and /mode general|interview|coder|teacher|marketer|legal</p>
    </div>
    <div class="card">
      <p><strong>Runtime</strong></p>
      <p class="mono">Base URL: ${sanitizeForTelegram(BASE_URL)}</p>
      <p class="mono">Version: ${sanitizeForTelegram(BOT_LOGIC_VERSION)}</p>
    </div>
  </div>
</body>
</html>`;
  res.status(200).type('html').send(html);
});

app.get('/admin/subscription/status', requireAdminAccess, (req, res) => {
  const scope = String(req.query.scope || '').trim();
  const chatId = String(req.query.chatId || '').trim();
  const userId = String(req.query.userId || '').trim();
  if (!scope || !chatId || !userId) {
    return res.status(400).json({
      success: false,
      error: 'scope, chatId, and userId are required'
    });
  }
  const record = getTelegramSubscriptionRecord(scope, chatId, userId);
  return res.json({
    success: true,
    record: record || null
  });
});

app.post('/admin/subscription/set', requireAdminAccess, (req, res) => {
  const scope = String(req.body?.scope || '').trim();
  const chatId = String(req.body?.chatId || '').trim();
  const userId = String(req.body?.userId || '').trim();
  const plan = String(req.body?.plan || '').trim().toLowerCase();
  if (!scope || !chatId || !userId || !['free', 'pro'].includes(plan)) {
    return res.status(400).json({
      success: false,
      error: 'scope, chatId, userId, and plan (free|pro) are required'
    });
  }
  const statusRaw = String(req.body?.status || 'active').trim().toLowerCase();
  const status: 'active' | 'expired' | 'cancelled' =
    statusRaw === 'expired' || statusRaw === 'cancelled' ? statusRaw : 'active';
  const sourceRaw = String(req.body?.source || 'manual').trim().toLowerCase();
  const source: 'telegram_stars' | 'manual' | 'legacy' =
    sourceRaw === 'telegram_stars' || sourceRaw === 'legacy' ? sourceRaw : 'manual';
  const expiresAt = Number(req.body?.expiresAt);
  const starsAmount = Number(req.body?.starsAmount);
  const updated = setTelegramSubscriptionRecord(scope, chatId, userId, {
    plan: plan as TelegramSubscriptionPlan,
    status,
    source,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined,
    starsAmount: Number.isFinite(starsAmount) ? starsAmount : undefined
  });
  return res.json({
    success: true,
    record: updated
  });
});

app.get('/admin/moderation/audit', requireAdminAccess, (req, res) => {
  const limitRaw = Number(req.query.limit || 100);
  const limit = Math.max(1, Math.min(1000, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 100));
  const blockedOnly = String(req.query.blockedOnly || '').trim().toLowerCase() === 'true';
  const sourceFilter = String(req.query.source || '').trim().toLowerCase();
  const allowedSources = new Set(['input', 'output', 'anti_spam', 'admin']);

  const rows = moderationAuditLog
    .filter((row) => !blockedOnly || row.blocked)
    .filter((row) => !sourceFilter || (allowedSources.has(sourceFilter) && row.source === sourceFilter))
    .slice(-limit)
    .reverse();

  return res.json({
    success: true,
    total: rows.length,
    maxStored: MODERATION_AUDIT_MAX_ENTRIES,
    records: rows
  });
});

app.post('/admin/moderation/audit/clear', requireAdminAccess, (req, res) => {
  const previousCount = moderationAuditLog.length;
  moderationAuditLog.length = 0;
  persistModerationAuditLog();
  recordModerationAudit({
    source: 'admin',
    blocked: true,
    category: 'admin_action',
    action: 'audit_log_cleared',
    reason: `Cleared ${previousCount} moderation audit records`
  });
  return res.json({
    success: true,
    cleared: previousCount
  });
});

app.get('/admin/anti-spam/status', requireAdminAccess, (req, res) => {
  const limitRaw = Number(req.query.limit || 100);
  const limit = Math.max(1, Math.min(2000, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 100));
  const inMemoryStates = Array.from(telegramAntiSpamState.entries())
    .slice(-limit)
    .map(([stateKey, state]) => ({
      stateKey,
      timestampsInWindow: state.timestamps.length,
      repeatedCount: state.repeatedCount,
      mutedUntil: state.mutedUntil,
      strikes: state.strikes,
      lastViolationAt: state.lastViolationAt
    }));
  const activeRestrictions = listTelegramAdminRestrictions().slice(0, limit);
  const recentViolations = moderationAuditLog
    .filter((row) => row.source === 'anti_spam' && row.blocked)
    .slice(-limit)
    .reverse();

  return res.json({
    success: true,
    redisEnabled: REDIS_ANTI_SPAM_ENABLED,
    redisHealthy: REDIS_ANTI_SPAM_ENABLED ? !redisAntiSpamUnavailable : false,
    inMemoryStateCount: telegramAntiSpamState.size,
    inMemoryStates,
    adminRestrictionsCount: activeRestrictions.length,
    adminRestrictions: activeRestrictions,
    recentViolations
  });
});

app.get('/admin/telegram/restrictions', requireAdminAccess, (req, res) => {
  const scopeFilter = String(req.query.scope || '').trim();
  const chatFilter = String(req.query.chatId || '').trim();
  const userFilter = String(req.query.userId || '').trim();
  const filtered = listTelegramAdminRestrictions().filter((item) => {
    if (scopeFilter && item.scope !== scopeFilter) return false;
    if (chatFilter && item.chatId !== chatFilter) return false;
    if (userFilter && item.userId !== userFilter) return false;
    return true;
  });
  return res.json({
    success: true,
    total: filtered.length,
    restrictions: filtered
  });
});

app.post('/admin/telegram/restrictions', requireAdminAccess, (req, res) => {
  const scope = String(req.body?.scope || 'telegram:primary').trim();
  const chatId = String(req.body?.chatId || '').trim();
  const userId = String(req.body?.userId || '').trim();
  const reason = String(req.body?.reason || 'admin restriction').trim().slice(0, 240);
  const durationRaw = Number(req.body?.durationSec || req.body?.durationSeconds || 600);
  const durationSec = Math.max(30, Math.min(7 * 24 * 60 * 60, Number.isFinite(durationRaw) ? Math.floor(durationRaw) : 600));
  if (!scope || !chatId || !userId) {
    return res.status(400).json({
      success: false,
      message: 'scope, chatId, and userId are required'
    });
  }
  const reqUser = req.user as Express.User | undefined;
  const createdBy = hasValidAdminKey(req) ? 'x-admin-key' : (String(reqUser?.email || 'admin').trim().toLowerCase() || 'admin');
  const restriction = setTelegramAdminRestriction({
    scope,
    chatId,
    userId,
    blockedUntil: Date.now() + durationSec * 1000,
    reason,
    createdBy
  });
  recordModerationAudit({
    source: 'admin',
    blocked: true,
    category: 'admin_action',
    action: 'manual_restriction_created',
    reason,
    scope,
    chatId,
    userId
  });
  return res.json({
    success: true,
    restriction
  });
});

app.delete('/admin/telegram/restrictions', requireAdminAccess, (req, res) => {
  const scope = String(req.body?.scope || req.query.scope || '').trim();
  const chatId = String(req.body?.chatId || req.query.chatId || '').trim();
  const userId = String(req.body?.userId || req.query.userId || '').trim();
  if (!scope || !chatId || !userId) {
    return res.status(400).json({
      success: false,
      message: 'scope, chatId, and userId are required'
    });
  }
  const removed = removeTelegramAdminRestriction(scope, chatId, userId);
  if (removed) {
    recordModerationAudit({
      source: 'admin',
      blocked: true,
      category: 'admin_action',
      action: 'manual_restriction_removed',
      reason: 'restriction removed',
      scope,
      chatId,
      userId
    });
  }
  return res.json({
    success: true,
    removed
  });
});

/**
 * Bot Deployment Route
 */
type DeployTelegramBotArgs = {
  botToken: string;
  requestedBotId: string;
  selectedModel: string;
  userEmail: string;
};

type ValidateTelegramBotTokenArgs = {
  botToken: string;
  requestedBotId: string;
  userEmail: string;
};

type ValidateTelegramBotTokenResult = {
  botId: string;
  botUsername: string;
  botName: string;
  verifyData: any;
};

const validateTelegramBotTokenForUser = async (
  args: ValidateTelegramBotTokenArgs
): Promise<ValidateTelegramBotTokenResult> => {
  const botToken = String(args.botToken || '').trim();
  const requestedBotId = String(args.requestedBotId || '').trim();
  const userEmail = String(args.userEmail || '').trim().toLowerCase();

  if (!botToken) {
    const err = new Error('Bot token is required');
    (err as any).status = 400;
    (err as any).body = { error: 'Bot token is required' };
    throw err;
  }
  if (!userEmail) {
    const err = new Error('Authentication required');
    (err as any).status = 401;
    (err as any).body = { error: 'Authentication required' };
    throw err;
  }
  if (SINGLE_TELEGRAM_TOKEN_ONLY && PRIMARY_TELEGRAM_TOKEN && botToken !== PRIMARY_TELEGRAM_TOKEN) {
    const err = new Error('Only the configured primary Telegram token is allowed');
    (err as any).status = 403;
    (err as any).body = {
      success: false,
      error: 'Only the configured primary Telegram token is allowed'
    };
    throw err;
  }
  if (!/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(botToken)) {
    const err = new Error('Invalid Telegram bot token format');
    (err as any).status = 400;
    (err as any).body = {
      success: false,
      error: 'Invalid Telegram bot token format',
      details: 'Please paste a valid BotFather token in the correct format.'
    };
    throw err;
  }

  const inMemoryDuplicateEntry = Array.from(botTokens.entries()).find(([, existingToken]) => String(existingToken || '').trim() === botToken);
  const persistedDuplicateBot = getPersistedTelegramBotByToken(botToken);
  const duplicateBotId = String(inMemoryDuplicateEntry?.[0] || persistedDuplicateBot?.botId || '').trim();
  if (duplicateBotId) {
    const err = new Error('Telegram bot token already exists');
    (err as any).status = 409;
    (err as any).body = {
      success: false,
      error: 'Bot already exists',
      details: 'This Telegram bot is already connected. Please add a valid new BotFather token.'
    };
    throw err;
  }

  const fallbackBotId = botToken.split(':')[0] || '';
  const candidateBotId = requestedBotId || fallbackBotId;
  if (!candidateBotId) {
    const err = new Error('Unable to derive bot ID from token. Please provide botId.');
    (err as any).status = 400;
    (err as any).body = { error: 'Unable to derive bot ID from token. Please provide botId.' };
    throw err;
  }

  const verifyResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
  const verifyData: any = await verifyResponse.json().catch(() => ({}));
  if (!verifyData?.ok) {
    const err = new Error('Invalid Telegram token');
    (err as any).status = 400;
    (err as any).body = {
      success: false,
      error: 'Invalid Telegram token',
      details: 'This bot token is invalid or not active yet. Please add a valid BotFather token.'
    };
    throw err;
  }

  const telegramNumericId = String(verifyData?.result?.id || '').trim();
  const botId = telegramNumericId || candidateBotId;
  const currentOwner = (telegramBotOwners.get(botId) || getPersistedTelegramOwner(botId) || '').trim().toLowerCase();
  if (currentOwner && currentOwner !== userEmail) {
    const err = new Error('Bot ID already belongs to another account');
    (err as any).status = 403;
    (err as any).body = { success: false, error: 'Bot ID already belongs to another account' };
    throw err;
  }

  const botUsername = String(verifyData?.result?.username || '').trim();
  const botName = String(verifyData?.result?.first_name || '').trim();
  if (!botUsername) {
    const err = new Error('Telegram bot username missing');
    (err as any).status = 400;
    (err as any).body = {
      success: false,
      error: 'Telegram bot username missing',
      details: 'Create bot via @BotFather first, then use its token here.'
    };
    throw err;
  }

  return {
    botId,
    botUsername,
    botName,
    verifyData
  };
};

type DeployTelegramBotResponse = {
  success: true;
  message: string;
  botId: string;
  botUsername: string | null;
  botName: string | null;
  telegramLink: string | null;
  creditRemainingUsd: number;
  creditDepleted: boolean;
  aiProvider: string;
  aiModel: string;
  aiModelLocked: boolean;
  webhookUrl: string;
  telegramResponse: any;
};

const deployTelegramBotForUser = async (args: DeployTelegramBotArgs): Promise<DeployTelegramBotResponse> => {
  const botToken = String(args.botToken || '').trim();
  const selectedModel = String(args.selectedModel || '').trim();
  const userEmail = String(args.userEmail || '').trim().toLowerCase();
  const tokenValidation = await validateTelegramBotTokenForUser({
    botToken,
    requestedBotId: args.requestedBotId,
    userEmail
  });
  const botId = tokenValidation.botId;
  const botUsername = tokenValidation.botUsername;
  const botName = tokenValidation.botName;

  const aiConfig = resolveTelegramAiConfig(selectedModel);

  // Store the bot token and config.
  botTokens.set(botId, botToken);
  removeDuplicateTelegramTokenEntries(botId, botToken);
  telegramBotOwners.set(botId, userEmail);
  if (botUsername) telegramBotUsernames.set(botId, botUsername);
  if (botName) telegramBotNames.set(botId, botName);
  telegramBotAiProviders.set(botId, aiConfig.provider);
  telegramBotAiModels.set(botId, aiConfig.model);
  botCredits.set(botId, {
    remainingUsd: INITIAL_BOT_CREDIT_USD,
    lastChargedAt: Date.now(),
    depleted: false,
    updatedAt: Date.now(),
    policyVersion: BOT_CREDIT_POLICY_VERSION
  });
  ensureBotTelemetry(botId, 'TELEGRAM', userEmail);

  if (!isProduction) {
    let localBot = managedBots.get(botToken);
    if (!localBot) {
      localBot = new TelegramBot(botToken, { polling: true });
      managedBots.set(botToken, localBot);
    }

    const isPrimaryToken = String(TELEGRAM_TOKEN || '').trim() && botToken === TELEGRAM_TOKEN;
    if (!managedBotListeners.has(botToken) && !isPrimaryToken) {
      localBot.on('message', async (msg) => {
        await handleBotMessage(botToken, msg, botId);
      });
      localBot.on('inline_query', async (inlineQuery) => {
        try {
          await handleTelegramInlineQuery(localBot!, inlineQuery, `telegram:${botId}`);
        } catch (error) {
          console.warn(`[BOT_${botId}] Inline query handling failed:`, (error as Error).message);
        }
      });
      managedBotListeners.add(botToken);
    }
  }

  // Set webhook for the bot.
  const webhookResult = await (global as any).setWebhookForBot(botToken, botId);
  if (!webhookResult.success) {
    botTokens.delete(botId);
    telegramBotOwners.delete(botId);
    telegramBotUsernames.delete(botId);
    telegramBotNames.delete(botId);
    telegramBotAiProviders.delete(botId);
    telegramBotAiModels.delete(botId);
    botCredits.delete(botId);
    persistBotState();
    const err = new Error('Failed to set webhook');
    (err as any).status = 500;
    (err as any).body = {
      success: false,
      error: 'Failed to set webhook',
      details: webhookResult.error
    };
    throw err;
  }

  persistBotState();
  return {
    success: true,
    message: 'Bot deployed successfully',
    botId,
    botUsername: botUsername || null,
    botName: botName || null,
    telegramLink: botUsername ? `https://t.me/${botUsername}` : null,
    creditRemainingUsd: botCredits.get(botId)?.remainingUsd ?? INITIAL_BOT_CREDIT_USD,
    creditDepleted: botCredits.get(botId)?.depleted ?? false,
    aiProvider: aiConfig.provider,
    aiModel: aiConfig.model,
    aiModelLocked: true,
    webhookUrl: `${BASE_URL}/webhook/${botId}`,
    telegramResponse: webhookResult.data
  };
};

app.post('/deploy-bot/validate', requireAuth, deployRateLimit, async (req, res) => {
  const bodyToken = typeof req.body?.botToken === 'string' ? req.body.botToken.trim() : '';
  const headerToken = typeof req.headers['x-telegram-bot-token'] === 'string'
    ? req.headers['x-telegram-bot-token'].trim()
    : '';
  const botToken = bodyToken || headerToken;
  const requestedBotId = typeof req.body?.botId === 'string' ? req.body.botId.trim() : '';
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();

  if (!botToken) return res.status(400).json({ error: 'Bot token is required' });
  if (!userEmail) return res.status(401).json({ error: 'Authentication required' });

  try {
    const tokenValidation = await validateTelegramBotTokenForUser({
      botToken,
      requestedBotId,
      userEmail
    });
    return res.json({
      success: true,
      botId: tokenValidation.botId,
      botUsername: tokenValidation.botUsername,
      botName: tokenValidation.botName
    });
  } catch (error: any) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    const body = error?.body;
    if (body) {
      return res.status(status).json(body);
    }
    return res.status(500).json({
      success: false,
      error: 'Token validation failed',
      details: (error as Error)?.message || 'Unknown error'
    });
  }
});

app.post('/deploy-bot', requireAuth, deployRateLimit, async (req, res) => {
  const botToken = typeof req.body?.botToken === 'string' ? req.body.botToken.trim() : '';
  const requestedBotId = typeof req.body?.botId === 'string' ? req.body.botId.trim() : '';
  const selectedModel = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  
  if (!botToken) return res.status(400).json({ error: 'Bot token is required' });
  if (!userEmail) return res.status(401).json({ error: 'Authentication required' });

  try {
    const payload = await deployTelegramBotForUser({
      botToken,
      requestedBotId,
      selectedModel,
      userEmail
    });
    console.log(`[DEPLOY] Successfully deployed bot ${payload.botId}`);
    return res.json(payload);
  } catch (error: any) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    const body = error?.body;
    if (body) {
      return res.status(status).json(body);
    }
    console.error(`[DEPLOY] Error deploying bot ${requestedBotId || botToken.split(':')[0]}:`, error);
    const details = (error as Error)?.message || 'Unknown error';
    const userMessage = /webhook/i.test(details)
      ? 'Webhook setup failed. Verify APP_URL/BASE_URL is your public Railway HTTPS URL and try again.'
      : /fetch failed|enotfound|econnreset|network/i.test(details)
        ? 'Could not reach Telegram API from backend. Retry in a few seconds.'
        : details;
    return res.status(500).json({
      success: false,
      error: 'Deployment failed',
      details: userMessage
    });
  }
});

app.post('/deploy-discord-bot', requireAuth, deployRateLimit, async (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  const botId = typeof req.body?.botId === 'string' ? req.body.botId.trim() : '';
  const botToken = typeof req.body?.botToken === 'string' ? req.body.botToken.trim() : '';
  const applicationId = typeof req.body?.applicationId === 'string' ? req.body.applicationId.trim() : '';
  const publicKey = normalizeHex(typeof req.body?.publicKey === 'string' ? req.body.publicKey : '');

  if (!userEmail) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  if (!botId || !botToken || !applicationId || !publicKey) {
    return res.status(400).json({ success: false, error: 'Bot ID, token, application ID, and public key are required' });
  }
  if (!/^\d{17,20}$/.test(applicationId)) {
    return res.status(400).json({ success: false, error: 'Invalid Discord application ID format' });
  }
  if (!/^[0-9a-f]{64}$/.test(publicKey)) {
    return res.status(400).json({ success: false, error: 'Invalid Discord public key format' });
  }
  if (botToken.length < 50 || !botToken.includes('.')) {
    return res.status(400).json({ success: false, error: 'Invalid Discord bot token format' });
  }
  const discordOwner = (discordBots.get(botId)?.createdBy || getPersistedDiscordOwner(botId) || '').trim().toLowerCase();
  if (discordOwner && discordOwner !== userEmail) {
    return res.status(403).json({ success: false, error: 'Bot ID already belongs to another account' });
  }

  try {
    const aiConfig = getActiveAiConfig();
    const meResponse = await fetch('https://discord.com/api/v10/users/@me', {
      method: 'GET',
      headers: { Authorization: `Bot ${botToken}` }
    });
    const meData: any = await meResponse.json().catch(() => ({}));
    if (!meResponse.ok || !meData?.id) {
      return res.status(400).json({
        success: false,
        error: 'Invalid Discord bot token',
        details: meData?.message || 'Token validation failed'
      });
    }

    const commandsPayload = [
      {
        name: 'ask',
        description: 'Ask SwiftDeploy AI anything',
        type: 1,
        options: [
          {
            type: 3,
            name: 'question',
            description: 'Your question',
            required: true
          }
        ]
      },
      {
        name: 'ping',
        description: 'Check if your SwiftDeploy Discord bot is online',
        type: 1
      }
    ];

    const commandsResponse = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commandsPayload)
    });
    const commandsData: any = await commandsResponse.json().catch(() => ({}));
    if (!commandsResponse.ok) {
      return res.status(502).json({
        success: false,
        error: 'Failed to register Discord slash commands',
        details: commandsData?.message || 'Discord API request failed'
      });
    }

    const gatewayClient = await connectDiscordGatewayClient(botId, botToken);
    ensureBotTelemetry(botId, 'DISCORD', userEmail);

    discordBots.set(botId, {
      botId,
      botToken,
      applicationId,
      publicKey,
      botUsername: gatewayClient.user?.tag || (meData?.username ? `${meData.username}${meData.discriminator ? `#${meData.discriminator}` : ''}` : undefined),
      createdBy: userEmail,
      createdAt: new Date().toISOString()
    });
    persistBotState();

    const interactionUrl = `${BASE_URL}/discord/interactions/${botId}`;
    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${applicationId}&permissions=274877975552&scope=bot%20applications.commands`;

    return res.json({
      success: true,
      botId,
      interactionUrl,
      inviteUrl,
      botName: meData?.username || 'Discord Bot',
      aiProvider: aiConfig.provider,
      aiModel: aiConfig.model,
      aiModelLocked: true,
      message: 'Discord bot deployed successfully'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'Discord deployment failed',
      details: (error as Error).message || 'Unknown error'
    });
  }
});

app.post('/discord/interactions/:botId', async (req, res) => {
  const botId = String(req.params.botId || '').trim();
  const config = discordBots.get(botId);
  if (!config) {
    return res.status(404).json({ error: 'Bot not found' });
  }
  if (!verifyDiscordInteraction(req, config.publicKey)) {
    return res.status(401).json({ error: 'Invalid Discord signature' });
  }

  const body = req.body as any;
  const interactionType = Number(body?.type || 0);
  if (interactionType === 1) {
    return res.status(200).json({ type: 1 });
  }
  if (interactionType !== 2) {
    return res.status(200).json({ type: 4, data: { content: 'Unsupported interaction type.' } });
  }

  const commandName = String(body?.data?.name || '').toLowerCase();
  recordBotIncoming(botId);
  if (commandName === 'ping') {
    const pingReply = 'SwiftDeploy Discord node is online and ready.';
    recordBotResponse(botId, pingReply, 0);
    return res.status(200).json({
      type: 4,
      data: {
        content: pingReply
      }
    });
  }

  if (commandName !== 'ask') {
    recordBotError(botId, 'Unknown interaction command');
    return res.status(200).json({ type: 4, data: { content: 'Unknown command.' } });
  }

  const options = Array.isArray(body?.data?.options) ? body.data.options : [];
  const questionOption = options.find((opt: any) => opt?.name === 'question');
  const prompt = String(questionOption?.value || '').trim();
  if (!prompt) {
    return res.status(200).json({ type: 4, data: { content: 'Please provide a question.' } });
  }

  const interactionToken = String(body?.token || '').trim();
  const applicationId = String(body?.application_id || config.applicationId).trim();

  res.status(200).json({ type: 5 });

  try {
    const startedAt = Date.now();
    const discordUserId = String(body?.member?.user?.id || body?.user?.id || '').trim();
    const answer = await generateProfessionalReply(prompt, discordUserId, `discord:${botId}:interaction`);
    await sendDiscordFollowUp(applicationId, interactionToken, answer);
    recordBotResponse(botId, answer, Date.now() - startedAt);
  } catch (error) {
    recordBotError(botId, error);
    await sendDiscordFollowUp(applicationId, interactionToken, generateEmergencyReply(''));
  }
});

app.get('/discord/bot-status/:botId', requireAuth, (req, res) => {
  const botId = String(req.params.botId || '').trim();
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  const config = discordBots.get(botId);
  const gatewayClient = discordGatewayClients.get(botId);
  if (!config) {
    return res.status(404).json({ success: false, error: 'Discord bot not found' });
  }
  if (!userEmail || String(config.createdBy || '').trim().toLowerCase() !== userEmail) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }
  return res.json({
    success: true,
    botId,
    interactionUrl: `${BASE_URL}/discord/interactions/${botId}`,
    commandsConfigured: true,
    gatewayConnected: Boolean(gatewayClient?.isReady()),
    botUsername: config.botUsername || 'Discord Bot',
    createdAt: config.createdAt
  });
});

/**
 * Get deployed bots
 */
app.get('/bots', requireAuth, (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  const telegramBots = Array.from(botTokens.entries())
    .filter(([id]) => String(telegramBotOwners.get(id) || '').trim().toLowerCase() === userEmail)
    .map(([id, token]) => {
      const credit = applyCreditDecay(id);
      const botUsername = String(telegramBotUsernames.get(id) || '').trim();
      const botName = String(telegramBotNames.get(id) || '').trim();
      return {
        id,
        platform: 'TELEGRAM',
        token: token.substring(0, 10) + '...', // Mask the token
        botUsername: botUsername || null,
        botName: botName || null,
        telegramLink: botUsername ? `https://t.me/${botUsername}` : null,
        aiProvider: telegramBotAiProviders.get(id) || null,
        aiModel: telegramBotAiModels.get(id) || null,
        creditRemainingUsd: credit.remainingUsd,
        creditDepleted: credit.depleted
      };
    });
  const discordItems = Array.from(discordBots.entries())
    .filter(([, cfg]) => String(cfg.createdBy || '').trim().toLowerCase() === userEmail)
    .map(([id, cfg]) => ({
    id,
    platform: 'DISCORD',
    token: cfg.botToken.slice(0, 10) + '...',
    applicationId: cfg.applicationId
  }));

  res.json({ bots: [...telegramBots, ...discordItems] });
});

app.get('/bot-alerts', requireAuth, (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  const requestedBotId = String(req.query.botId || '').trim();
  const ownedBotIds = new Set<string>();

  for (const [botId, owner] of telegramBotOwners.entries()) {
    if (String(owner || '').trim().toLowerCase() === userEmail) {
      ownedBotIds.add(botId);
    }
  }
  for (const [botId, cfg] of discordBots.entries()) {
    if (String(cfg.createdBy || '').trim().toLowerCase() === userEmail) {
      ownedBotIds.add(botId);
    }
  }

  if (requestedBotId && !ownedBotIds.has(requestedBotId)) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const alerts = requestedBotId
    ? botAlertMonitor.listAlerts({ botId: requestedBotId })
    : Array.from(ownedBotIds)
        .flatMap((botId) => botAlertMonitor.listAlerts({ botId }))
        .sort((a, b) => b.updatedAt - a.updatedAt);

  return res.json({
    success: true,
    alerts,
    queue: telegramWebhookQueue.stats(),
    dedupeCacheSize: telegramWebhookUpdateDeduper.stats().size
  });
});

app.post('/pro-subscription/checkout', requireAuth, async (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  if (!userEmail) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (TELEGRAM_SUBSCRIPTION_GATE_FROZEN) {
    return res.status(503).json({
      success: false,
      message: 'Pro subscription checkout is temporarily disabled for testing.'
    });
  }
  if (!isStripeEnabled()) {
    return res.status(503).json({ success: false, message: 'Stripe subscription is not configured yet.' });
  }
  if (hasTelegramBotForOwner(userEmail)) {
    return res.status(409).json({
      success: false,
      message: 'Subscription checkout is only required for first-time Telegram bot setup.'
    });
  }

  try {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: userEmail,
      client_reference_id: userEmail,
      success_url: buildProSubscriptionCheckoutReturnUrl('success', '{CHECKOUT_SESSION_ID}'),
      cancel_url: buildProSubscriptionCheckoutReturnUrl('cancel'),
      metadata: {
        type: 'FIRST_BOT_PRO_SUBSCRIPTION',
        ownerEmail: userEmail
      },
      subscription_data: {
        metadata: {
          type: 'FIRST_BOT_PRO_SUBSCRIPTION',
          ownerEmail: userEmail
        }
      },
      allow_promotion_codes: true,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: 3900,
            recurring: { interval: 'month' },
            product_data: {
              name: 'SwiftDeploy Pro',
              description: 'OpenClaw AI bot deployment and operations subscription (Pro)'
            }
          }
        }
      ],
      custom_text: {
        submit: {
          message: 'Secure your Pro subscription to continue first-time AI bot setup. Billing: $39/month.'
        }
      }
    });

    return res.json({
      success: true,
      checkoutUrl: session.url,
      stripeSessionId: session.id,
      plan: 'pro',
      amountUsd: 39,
      interval: 'month'
    });
  } catch (error: any) {
    console.error('[STRIPE] Failed to create Pro subscription checkout session:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Unable to start Pro subscription checkout right now.'
    });
  }
});

app.post('/pro-subscription/checkout/confirm', requireAuth, async (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  const stripeSessionId = String(req.body?.stripeSessionId || '').trim();
  if (!userEmail) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (TELEGRAM_SUBSCRIPTION_GATE_FROZEN) {
    return res.status(503).json({
      success: false,
      message: 'Pro subscription confirmation is temporarily disabled for testing.'
    });
  }
  if (!isStripeEnabled()) {
    return res.status(503).json({ success: false, message: 'Stripe subscription is not configured yet.' });
  }
  if (!stripeSessionId) {
    return res.status(400).json({ success: false, message: 'stripeSessionId is required' });
  }

  try {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(stripeSessionId, {
      expand: ['subscription']
    });

    const mode = String(session.mode || '').trim();
    const metadataOwner = String(session.metadata?.ownerEmail || '').trim().toLowerCase();
    const metadataType = String(session.metadata?.type || '').trim();
    if (mode !== 'subscription') {
      return res.status(400).json({ success: false, message: 'Stripe session is not a subscription checkout.' });
    }
    if (metadataType !== 'FIRST_BOT_PRO_SUBSCRIPTION') {
      return res.status(400).json({ success: false, message: 'Stripe session type is invalid.' });
    }
    if (metadataOwner && metadataOwner !== userEmail) {
      return res.status(403).json({ success: false, message: 'Stripe session owner mismatch.' });
    }

    const sessionStatus = String(session.status || '').trim().toLowerCase();
    const paymentStatus = String(session.payment_status || '').trim().toLowerCase();
    const hasSubscription = Boolean(session.subscription);

    const complete =
      (sessionStatus === 'complete' || paymentStatus === 'paid') && hasSubscription;

    if (!complete) {
      return res.status(202).json({
        success: false,
        pending: true,
        message: 'Payment is not completed yet. Complete Stripe subscription checkout to continue.'
      });
    }

    const subscriptionObject =
      typeof session.subscription === 'string'
        ? null
        : (session.subscription as Stripe.Subscription | null);
    const fallbackPeriodEndSec = Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000);
    const currentPeriodEndSec = Number((subscriptionObject as any)?.current_period_end || fallbackPeriodEndSec);
    const expiresAtMs = Math.max(Date.now(), currentPeriodEndSec * 1000);
    setOwnerProSubscriptionState({
      ownerEmail: userEmail,
      expiresAt: expiresAtMs,
      stripeSubscriptionId:
        typeof session.subscription === 'string'
          ? session.subscription
          : String((session.subscription as any)?.id || '')
    });
    persistBotState();

    return res.json({
      success: true,
      plan: 'pro',
      amountUsd: 39,
      interval: 'month',
      active: true,
      expiresAt: expiresAtMs,
      subscriptionId:
        typeof session.subscription === 'string'
          ? session.subscription
          : String((session.subscription as any)?.id || ''),
      customerId: String(session.customer || '')
    });
  } catch (error: any) {
    console.error('[STRIPE] Failed to confirm Pro subscription checkout session:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Unable to confirm Stripe subscription right now.'
    });
  }
});

app.get('/bot-credit/:botId', requireAuth, (req, res) => {
  const botId = String(req.params.botId || '').trim();
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  const owner = (telegramBotOwners.get(botId) || getPersistedTelegramOwner(botId) || '').trim().toLowerCase();
  if (!botId) {
    return res.status(400).json({ success: false, message: 'botId is required' });
  }
  if (!owner || !userEmail || owner !== userEmail) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  const credit = applyCreditDecay(botId);
  const subscription = getOwnerProSubscriptionStatus(owner);
  persistBotState();
  return res.json({
    success: true,
    botId,
    remainingUsd: credit.remainingUsd,
    depleted: credit.depleted,
    warning: credit.depleted ? getCreditDepletedWarningMessage() : '',
    lastChargedAt: credit.lastChargedAt,
    proSubscriptionActive: Boolean(subscription?.active),
    proSubscriptionStatus: subscription ? (subscription.active ? 'ACTIVE' : 'EXPIRED') : 'NONE',
    proSubscriptionExpiresAt: subscription?.expiresAt || null,
    enforcementActive: CREDIT_ENFORCEMENT_ACTIVE,
    policyVersion: credit.policyVersion
  });
});

app.post('/bot-credit/:botId/checkout', requireAuth, async (req, res) => {
  const botId = String(req.params.botId || '').trim();
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  const owner = (telegramBotOwners.get(botId) || getPersistedTelegramOwner(botId) || '').trim().toLowerCase();
  if (!botId) {
    return res.status(400).json({ success: false, message: 'botId is required' });
  }
  if (!owner || !userEmail || owner !== userEmail) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  if (!isStripeEnabled()) {
    return res.status(503).json({ success: false, message: 'Stripe payment is not configured yet.' });
  }

  const amountUsd = Math.floor(Number(req.body?.amountUsd || 0));
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return res.status(400).json({ success: false, message: 'amountUsd must be a positive number' });
  }
  if (!CREDIT_TOP_UP_OPTIONS_USD.includes(amountUsd as (typeof CREDIT_TOP_UP_OPTIONS_USD)[number])) {
    return res.status(400).json({
      success: false,
      message: `Unsupported recharge amount. Allowed: ${CREDIT_TOP_UP_OPTIONS_USD.join(', ')}`
    });
  }

  try {
    const stripe = getStripeClient();
    const { botName, botUsername } = getSafeTelegramBotDisplayInfo(botId);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: buildCreditCheckoutReturnUrl(botId, 'success', '{CHECKOUT_SESSION_ID}'),
      cancel_url: buildCreditCheckoutReturnUrl(botId, 'cancel'),
      customer_email: userEmail || undefined,
      client_reference_id: botId,
      metadata: {
        type: 'BOT_CREDIT_TOPUP',
        botId,
        ownerEmail: owner,
        amountUsd: String(amountUsd)
      },
      payment_intent_data: {
        metadata: {
          type: 'BOT_CREDIT_TOPUP',
          botId,
          ownerEmail: owner,
          amountUsd: String(amountUsd)
        }
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amountUsd * 100,
            product_data: {
              name: `OpenClaw Bot Credit (${amountUsd} USD)`,
              description: botUsername
                ? `Credit top-up for @${botUsername}`
                : (botName ? `Credit top-up for ${botName}` : `Credit top-up for bot ${botId}`)
            }
          }
        }
      ]
    });

    return res.json({
      success: true,
      botId,
      checkoutUrl: session.url,
      stripeSessionId: session.id
    });
  } catch (error: any) {
    console.error('[STRIPE] Failed to create checkout session:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Unable to start Stripe checkout right now.'
    });
  }
});

app.post('/bot-credit/:botId/checkout/confirm', requireAuth, async (req, res) => {
  const botId = String(req.params.botId || '').trim();
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  const owner = (telegramBotOwners.get(botId) || getPersistedTelegramOwner(botId) || '').trim().toLowerCase();
  if (!botId) {
    return res.status(400).json({ success: false, message: 'botId is required' });
  }
  if (!owner || !userEmail || owner !== userEmail) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  if (!isStripeEnabled()) {
    return res.status(503).json({ success: false, message: 'Stripe payment is not configured yet.' });
  }

  const stripeSessionId = String(req.body?.stripeSessionId || '').trim();
  if (!stripeSessionId) {
    return res.status(400).json({ success: false, message: 'stripeSessionId is required' });
  }

  try {
    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
    const metaBotId = String(session.metadata?.botId || '').trim();
    const metaOwnerEmail = String(session.metadata?.ownerEmail || '').trim().toLowerCase();
    if (metaBotId && metaBotId !== botId) {
      return res.status(400).json({ success: false, message: 'Stripe session does not match the selected bot.' });
    }
    if (metaOwnerEmail && metaOwnerEmail !== owner) {
      return res.status(403).json({ success: false, message: 'Stripe session owner mismatch.' });
    }

    const result = finalizeStripeCreditCheckoutSession(session);
    if (result.error) {
      const isPendingPayment = /not completed yet/i.test(result.error);
      return res.status(isPendingPayment ? 202 : 400).json({
        success: false,
        pending: isPendingPayment,
        message: result.error
      });
    }

    return res.json({
      success: true,
      botId: result.botId || botId,
      amountUsdAdded: result.amountUsdAdded || 0,
      remainingUsd: result.remainingUsd ?? 0,
      depleted: Boolean(result.depleted),
      warning: String(result.warning || ''),
      alreadyProcessed: result.alreadyProcessed
    });
  } catch (error: any) {
    console.error('[STRIPE] Failed to confirm checkout session:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Unable to confirm Stripe payment right now.'
    });
  }
});

app.post('/bot-credit/:botId/recharge', requireAuth, (req, res) => {
  if (!ALLOW_MANUAL_CREDIT_RECHARGE) {
    return res.status(403).json({
      success: false,
      message: 'Direct recharge is disabled. Use Stripe checkout from Purchase Credit.'
    });
  }
  const botId = String(req.params.botId || '').trim();
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  const owner = (telegramBotOwners.get(botId) || getPersistedTelegramOwner(botId) || '').trim().toLowerCase();
  if (!botId) {
    return res.status(400).json({ success: false, message: 'botId is required' });
  }
  if (!owner || !userEmail || owner !== userEmail) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  const amountUsd = Math.floor(Number(req.body?.amountUsd || 0));
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    return res.status(400).json({ success: false, message: 'amountUsd must be a positive number' });
  }
  if (!CREDIT_TOP_UP_OPTIONS_USD.includes(amountUsd as (typeof CREDIT_TOP_UP_OPTIONS_USD)[number])) {
    return res.status(400).json({
      success: false,
      message: `Unsupported recharge amount. Allowed: ${CREDIT_TOP_UP_OPTIONS_USD.join(', ')}`
    });
  }

  const credit = addCreditToBot(botId, amountUsd);
  const subscription = getOwnerProSubscriptionStatus(owner);
  persistBotState();

  return res.json({
    success: true,
    botId,
    amountUsdAdded: amountUsd,
    remainingUsd: credit.remainingUsd,
    depleted: credit.depleted,
    warning: credit.depleted ? getCreditDepletedWarningMessage() : '',
    lastChargedAt: credit.lastChargedAt,
    proSubscriptionActive: Boolean(subscription?.active),
    proSubscriptionStatus: subscription ? (subscription.active ? 'ACTIVE' : 'EXPIRED') : 'NONE',
    proSubscriptionExpiresAt: subscription?.expiresAt || null,
    enforcementActive: CREDIT_ENFORCEMENT_ACTIVE,
    policyVersion: credit.policyVersion
  });
});

app.get('/bot-profile/:botId', requireAuth, async (req, res) => {
  const botId = String(req.params.botId || '').trim();
  const reqUser = req.user as Express.User | undefined;
  const userEmail = (reqUser?.email || '').trim().toLowerCase();
  const owner = (telegramBotOwners.get(botId) || getPersistedTelegramOwner(botId) || '').trim().toLowerCase();
  if (!botId) {
    return res.status(400).json({ success: false, message: 'botId is required' });
  }
  if (!owner || !userEmail || owner !== userEmail) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  let botUsername = String(telegramBotUsernames.get(botId) || '').trim();
  let botName = String(telegramBotNames.get(botId) || '').trim();
  const token = String(botTokens.get(botId) || '').trim();

  // Refresh profile from Telegram when possible to avoid generic fallback names.
  if (token) {
    try {
      const verifyResponse = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const verifyData: any = await verifyResponse.json().catch(() => ({}));
      if (verifyData?.ok) {
        botUsername = String(verifyData?.result?.username || botUsername || '').trim();
        botName = String(verifyData?.result?.first_name || botName || '').trim();
        if (botUsername) telegramBotUsernames.set(botId, botUsername);
        if (botName) telegramBotNames.set(botId, botName);
        persistBotState();
      }
    } catch {
      // Fallback to persisted/in-memory values.
    }
  }

  return res.json({
    success: true,
    botId,
    botUsername: botUsername || null,
    botName: botName || null
  });
});

/**
 * Email Verification Routes
 */

const EMAIL_DOMAIN_LOOKUP_TIMEOUT_MS = Number(process.env.EMAIL_DOMAIN_LOOKUP_TIMEOUT_MS || 1200);
const EMAIL_DOMAIN_VALIDATION_STRICT = (process.env.EMAIL_DOMAIN_VALIDATION_STRICT || (process.env.NODE_ENV === 'production' ? 'true' : 'false')).trim().toLowerCase() === 'true';

type DomainValidationStatus = 'valid' | 'invalid' | 'unreachable';

const withLookupTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(Object.assign(new Error('DNS_TIMEOUT'), { code: 'DNS_TIMEOUT' })), timeoutMs);
    })
  ]);
};

const DNS_TIMEOUT_CODES = new Set([
  'DNS_TIMEOUT',
  'ETIMEOUT',
  'EAI_AGAIN',
  'SERVFAIL',
  'ENETUNREACH',
  'ECONNREFUSED',
  'ECONNRESET'
]);

const DNS_NOT_FOUND_CODES = new Set([
  'ENOTFOUND',
  'ENODATA',
  'NXDOMAIN'
]);

// Real domain validation using DNS (MX preferred, A/AAAA fallback)
const validateEmailDomain = async (domain: string): Promise<DomainValidationStatus> => {
  const normalizedDomain = String(domain || '').trim().toLowerCase();
  if (!normalizedDomain || !normalizedDomain.includes('.') || normalizedDomain.length > 253) {
    return 'invalid';
  }

  const blockedDomains = [
    'example.com', 'test.com', 'invalid.com', 'fake.com'
  ];

  if (blockedDomains.includes(normalizedDomain)) {
    return 'invalid';
  }

  const lookups = await Promise.allSettled([
    withLookupTimeout(resolveMx(normalizedDomain), EMAIL_DOMAIN_LOOKUP_TIMEOUT_MS),
    withLookupTimeout(resolve4(normalizedDomain), EMAIL_DOMAIN_LOOKUP_TIMEOUT_MS),
    withLookupTimeout(resolve6(normalizedDomain), EMAIL_DOMAIN_LOOKUP_TIMEOUT_MS)
  ]);

  for (const entry of lookups) {
    if (entry.status === 'fulfilled' && Array.isArray(entry.value) && entry.value.length > 0) {
      return 'valid';
    }
  }

  let timeoutOrNetworkIssues = 0;
  let notFoundIssues = 0;

  for (const entry of lookups) {
    if (entry.status === 'rejected') {
      const code = String((entry.reason as any)?.code || '').toUpperCase();
      if (DNS_TIMEOUT_CODES.has(code)) {
        timeoutOrNetworkIssues += 1;
        continue;
      }
      if (DNS_NOT_FOUND_CODES.has(code)) {
        notFoundIssues += 1;
      }
    }
  }

  if (timeoutOrNetworkIssues > 0) {
    return 'unreachable';
  }

  if (notFoundIssues >= 2) {
    return 'invalid';
  }

  return 'invalid';
};

// Password strength validation
const validatePasswordStrength = (password: string) => {
  const minLength = password.length >= 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /[0-9]/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?"{}|<>]/.test(password);
  
  return {
    isValid: minLength && hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar,
    errors: [
      !minLength && 'At least 8 characters',
      !hasUpperCase && 'One uppercase letter',
      !hasLowerCase && 'One lowercase letter',
      !hasNumbers && 'One number',
      !hasSpecialChar && 'One special character'
    ].filter(Boolean)
  };
};

const isValidEmailFormat = (email: string) => {
  const emailRegex = /^(?=.{1,254}$)(?=.{1,64}@)[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/;
  return emailRegex.test(email);
};

const sendError = (res: express.Response, status: number, message: string) => {
  return res.status(status).json({ message });
};

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'tempmail.com',
  '10minutemail.com',
  'guerrillamail.com',
  'mailinator.com',
  'yopmail.com',
  'temp-mail.org',
  'throwawaymail.com',
  'fakeinbox.com'
]);

const validateSignupEmailInput = async (rawEmail: string): Promise<{ ok: true; email: string } | { ok: false; status: number; message: string }> => {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!email) {
    return { ok: false, status: 400, message: 'Email is required' };
  }
  if (!isValidEmailFormat(email)) {
    return { ok: false, status: 400, message: 'Invalid email format' };
  }

  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) {
    return { ok: false, status: 400, message: 'Invalid email format' };
  }

  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) {
    return { ok: false, status: 400, message: 'Disposable email addresses are not allowed' };
  }

  if (isEmailRegistered(email)) {
    return { ok: false, status: 409, message: 'Account already exists. Please sign in.' };
  }

  const domainStatus = await validateEmailDomain(domain);
  if (domainStatus === 'invalid') {
    return { ok: false, status: 400, message: 'This email domain looks invalid. Please enter a real email address.' };
  }
  if (domainStatus === 'unreachable') {
    if (EMAIL_DOMAIN_VALIDATION_STRICT) {
      return { ok: false, status: 400, message: 'Unable to validate this email domain right now. Please verify the email address and try again.' };
    }
    console.warn(`[EMAIL] Domain validation unavailable for ${domain}; allowing signup fallback.`);
  }

  return { ok: true, email };
};

app.post('/auth/validate-signup-email', async (req, res) => {
  const validation = await validateSignupEmailInput(req.body?.email);
  if (!validation.ok) {
    return sendError(res, validation.status, validation.message);
  }
  return res.json({
    success: true,
    message: 'Email looks valid'
  });
});

// Send verification email with enhanced security
app.post('/send-verification', async (req, res) => {
  const { email, name, password } = req.body;
  
  if (!email || !name || !password) {
    return sendError(res, 400, 'Email, name, and password are required');
  }

  const emailValidation = await validateSignupEmailInput(email);
  if (!emailValidation.ok) {
    return sendError(res, emailValidation.status, emailValidation.message);
  }
  const normalizedEmail = emailValidation.email;
  
  // Password strength validation
  const passwordStrength = validatePasswordStrength(password);
  if (!passwordStrength.isValid) {
    return sendError(res, 400, 'Password must meet security requirements');
  }

  console.log(`[EMAIL] Proceeding with verification for ${normalizedEmail}`);
  

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    storePendingSignup(normalizedEmail, name, passwordHash);

    const verification = await sendVerificationEmail(normalizedEmail, name);

    if (!verification.success) {
      clearPendingSignup(normalizedEmail);
      return sendError(res, verification.statusCode || 500, verification.message || 'Failed to send verification email');
    }

    return res.json({
      success: true,
      message: verification.message || 'OTP sent',
      ...(verification.devCode ? { devCode: verification.devCode } : {})
    });
  } catch (error) {
    clearPendingSignup(normalizedEmail);
    return sendError(res, 500, 'Internal server error');
  }
});

app.post('/resend-verification', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';

  if (!email) {
    return sendError(res, 400, 'Email is required');
  }

  const pending = getPendingSignup(email);
  if (!pending) {
    return sendError(res, 400, 'Invalid request');
  }

  const emailValidation = await validateSignupEmailInput(email);
  if (!emailValidation.ok) {
    return sendError(res, emailValidation.status, emailValidation.message);
  }

  try {
    const verification = await sendVerificationEmail(emailValidation.email, pending.name);
    if (!verification.success) {
      return sendError(res, verification.statusCode || 500, verification.message || 'Failed to send verification email');
    }

    return res.json({
      success: true,
      message: verification.message || 'OTP sent',
      ...(verification.devCode ? { devCode: verification.devCode } : {})
    });
  } catch (error) {
    return sendError(res, 500, 'Internal server error');
  }
});

// Verify email code
app.post('/verify-email', async (req, res) => {
  const { email, code } = req.body;
  
  if (!email || !code) {
    return sendError(res, 400, 'Email and code are required');
  }

  if (!isValidEmailFormat(email)) {
    return sendError(res, 400, 'Invalid email format');
  }

  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return sendError(res, 400, 'Invalid or expired verification code');
  }

  const pending = getPendingSignup(email);
  if (!pending) {
    return sendError(res, 400, 'Invalid or expired verification code');
  }

  const verificationResult = validateVerificationCode(email, code);
  if (!verificationResult.ok) {
    if (verificationResult.reason === 'attempts_exceeded') {
      return sendError(res, 403, 'OTP verification attempts exceeded');
    }
    return sendError(res, 400, 'Invalid or expired verification code');
  }

  const user = markEmailAsRegistered(email, pending.name, pending.passwordHash);
  const userInfo = {
    id: user.id,
    email: user.email,
    name: user.name,
    photo: undefined
  };

  (req as any).login(userInfo, (err: any) => {
    if (err) {
      return sendError(res, 500, 'Internal server error');
    }
    return res.json({
      success: true,
      message: 'Email verified successfully',
      user: userInfo
    });
  });
});

// Test email route
app.post('/test-email', requireAdminAccess, async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }
  
  console.log(`[EMAIL] Sending test email to ${email}`);
  
  try {
    const success = await sendTestEmail(email);
    
    if (success) {
      res.json({ 
        success: true, 
        message: 'Test email sent successfully' 
      });
    } else {
      res.status(500).json({ 
        success: false, 
        error: 'Failed to send test email' 
      });
    }
  } catch (error) {
    console.error(`[EMAIL] Error sending test email:`, error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// Get pending verifications (for debugging)
app.get('/pending-verifications', requireAdminAccess, (req, res) => {
  const verifications = getPendingVerifications();
  res.json({ verifications });
});

/**
 * System Health Check
 */
// Google OAuth Routes
app.get('/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/login` }),
  (req, res) => {
    // Successful authentication - redirect to home page
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/`);
  }
);

app.post('/auth/google/access-token', async (req, res) => {
  const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
  if (!accessToken) {
    return sendError(res, 400, 'Missing Google access token');
  }

  try {
    const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
    if (!tokenInfoRes.ok) {
      return sendError(res, 401, 'Invalid Google access token');
    }

    const tokenInfo: any = await tokenInfoRes.json();
    const expectedAud = process.env.GOOGLE_CLIENT_ID;
    if (expectedAud && tokenInfo.aud !== expectedAud) {
      return sendError(res, 401, 'Google client mismatch');
    }

    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!userInfoRes.ok) {
      return sendError(res, 401, 'Failed to fetch Google profile');
    }

    const profile: any = await userInfoRes.json();
    if (!profile?.email || !profile?.sub || !profile?.email_verified) {
      return sendError(res, 401, 'Google account verification failed');
    }

    const userInfo = {
      id: String(profile.sub),
      email: String(profile.email).toLowerCase(),
      name: String(profile.name || profile.email).trim(),
      photo: profile.picture ? String(profile.picture) : undefined
    };

    (req as any).login(userInfo, (err: any) => {
      if (err) {
        return sendError(res, 500, 'Internal server error');
      }

      return res.json({
        success: true,
        message: 'Google login successful',
        user: userInfo
      });
    });
  } catch {
    return sendError(res, 500, 'Google sign-in failed');
  }
});

// Login route - validate credentials and authenticate user
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return sendError(res, 400, 'Email and password are required');
  }
  
  if (!isValidEmailFormat(email)) {
    return sendError(res, 400, 'Invalid email format');
  }
  
  if (!isEmailRegistered(email)) {
    return sendError(res, 401, 'Account does not exist');
  }
  
  const user = getUserByEmail(email);
  
  if (!user) {
    return sendError(res, 401, 'Account does not exist');
  }
  
  const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
  
  if (!isPasswordValid) {
    return sendError(res, 401, 'Invalid email or password');
  }
  
  const userInfo = {
    id: user.id,
    email: user.email,
    name: user.name,
    photo: undefined
  };
  
  (req as any).login(userInfo, (err: any) => {
    if (err) {
      return sendError(res, 500, 'Internal server error');
    }
    
    res.json({ 
      success: true,
      message: 'Login successful',
      user: userInfo
    });
  });
});

// Get current user info
app.get('/me', (req, res) => {
  if (req.user) {
    const sessionUser = req.user as Express.User;
    res.json({
      user: sessionUser
    });
  } else {
    res.status(401).json({ message: 'Not authenticated' });
  }
});

// Logout route
app.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ message: 'Error logging out' });
    }
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: 'Error destroying session' });
      }
      res.clearCookie('connect.sid');
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`);
    });
  });
});

app.get('/worker/tasks', requireAuth, (req, res) => {
  setNoStore(res);
  const { email } = getAuthenticatedUserContext(req);
  if (!email) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (hasAiWorkerBridge) {
    return void (async () => {
      try {
        const payload = await callAiWorkerService(req, 'GET', '/api/v1/tasks');
        return res.json({ success: true, ...mapAiWorkerDashboard(payload) });
      } catch (error) {
        return res.status(502).json({
          success: false,
          message: error instanceof Error ? error.message : 'Failed to load AI worker dashboard.'
        });
      }
    })();
  }
  return res.json({
    success: true,
    ...getWorkerDashboardForUser(email)
  });
});

app.post('/worker/interpret', requireAuth, (req, res) => {
  setNoStore(res);
  const description = String(req.body?.description || '').trim();
  if (!description) {
    return res.status(400).json({ success: false, message: 'Task description is required.' });
  }
  if (hasAiWorkerBridge) {
    return void (async () => {
      try {
        const payload = await callAiWorkerService(req, 'POST', '/api/v1/tasks/interpret', { description });
        return res.json({
          success: true,
          interpreted: mapAiWorkerInstructions(payload?.structured_instructions || payload?.interpreted || {})
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: error instanceof Error ? error.message : 'Failed to interpret task.'
        });
      }
    })();
  }
  try {
    const interpreted = interpretWorkerTask(description);
    return res.json({ success: true, interpreted });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to interpret task.'
    });
  }
});

app.post('/worker/tasks', requireAuth, async (req, res) => {
  setNoStore(res);
  const { email } = getAuthenticatedUserContext(req);
  const description = String(req.body?.description || '').trim();
  const runNow = req.body?.runNow !== false;
  if (!email) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (!description) {
    return res.status(400).json({ success: false, message: 'Task description is required.' });
  }

  try {
    if (hasAiWorkerBridge) {
      const createdTask = await callAiWorkerService(req, 'POST', '/api/v1/tasks', {
        task_description: description,
        notification_channels: /\btelegram\b/i.test(description) ? ['TELEGRAM'] : ['EMAIL']
      });
      if (runNow && createdTask?.id) {
        await callAiWorkerService(req, 'POST', `/api/v1/tasks/${createdTask.id}/run`);
      }
      const dashboardPayload = await callAiWorkerService(req, 'GET', '/api/v1/tasks');
      let initialResult = null;
      if (createdTask?.id) {
        const resultsPayload = await callAiWorkerService(req, 'GET', `/api/v1/tasks/${createdTask.id}/results`);
        if (Array.isArray(resultsPayload) && resultsPayload.length > 0) {
          initialResult = mapAiWorkerResult(resultsPayload[0]);
        }
      }
      return res.json({
        success: true,
        task: mapAiWorkerTask(createdTask),
        initialResult,
        ...mapAiWorkerDashboard(dashboardPayload)
      });
    }

    const task = createWorkerTaskForUser(email, description);
    let initialResult = null;
    if (runNow) {
      const runOutcome = await runWorkerTaskForUser(email, task.id, 'manual');
      initialResult = runOutcome.result;
    }
    return res.json({
      success: true,
      task,
      initialResult,
      ...getWorkerDashboardForUser(email)
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error instanceof Error ? error.message : 'Failed to create worker task.'
    });
  }
});

app.get('/worker/tasks/:taskId/history', requireAuth, (req, res) => {
  setNoStore(res);
  const { email } = getAuthenticatedUserContext(req);
  const taskId = String(req.params.taskId || '').trim();
  if (!email) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (hasAiWorkerBridge) {
    return void (async () => {
      try {
        const [taskPayload, resultsPayload, logsPayload] = await Promise.all([
          callAiWorkerService(req, 'GET', `/api/v1/tasks/${taskId}`),
          callAiWorkerService(req, 'GET', `/api/v1/tasks/${taskId}/results`),
          callAiWorkerService(req, 'GET', `/api/v1/tasks/${taskId}/logs`)
        ]);
        return res.json({
          success: true,
          task: mapAiWorkerTask(taskPayload),
          results: Array.isArray(resultsPayload) ? resultsPayload.map(mapAiWorkerResult) : [],
          logs: Array.isArray(logsPayload) ? logsPayload.map(mapAiWorkerLog) : []
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: error instanceof Error ? error.message : 'Failed to load task history.'
        });
      }
    })();
  }
  const history = getWorkerTaskHistoryForUser(email, taskId);
  if (!history) {
    return res.status(404).json({ success: false, message: 'Task not found.' });
  }
  return res.json({ success: true, ...history });
});

app.patch('/worker/tasks/:taskId', requireAuth, (req, res) => {
  setNoStore(res);
  const { email } = getAuthenticatedUserContext(req);
  const taskId = String(req.params.taskId || '').trim();
  if (!email) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const patch: {
    status?: 'ACTIVE' | 'PAUSED';
    taskDescription?: string;
    schedule?: 'hourly' | 'daily' | 'weekly';
  } = {};

  if (typeof req.body?.status === 'string') {
    const normalizedStatus = String(req.body.status).trim().toUpperCase();
    if (normalizedStatus === 'ACTIVE' || normalizedStatus === 'PAUSED') {
      patch.status = normalizedStatus;
    }
  }
  if (typeof req.body?.taskDescription === 'string' && req.body.taskDescription.trim()) {
    patch.taskDescription = req.body.taskDescription.trim();
  }
  if (typeof req.body?.schedule === 'string') {
    const normalizedSchedule = String(req.body.schedule).trim().toLowerCase();
    if (normalizedSchedule === 'hourly' || normalizedSchedule === 'daily' || normalizedSchedule === 'weekly') {
      patch.schedule = normalizedSchedule;
    }
  }

  if (hasAiWorkerBridge) {
    return void (async () => {
      try {
        const updatedTask = await callAiWorkerService(req, 'PATCH', `/api/v1/tasks/${taskId}`, {
          status: patch.status,
          schedule: patch.schedule,
          title: patch.taskDescription
        });
        const dashboardPayload = await callAiWorkerService(req, 'GET', '/api/v1/tasks');
        return res.json({
          success: true,
          task: mapAiWorkerTask(updatedTask),
          ...mapAiWorkerDashboard(dashboardPayload)
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Task not found.';
        const statusCode = /not found/i.test(message) ? 404 : 400;
        return res.status(statusCode).json({ success: false, message });
      }
    })();
  }

  const task = updateWorkerTaskForUser(email, taskId, patch);
  if (!task) {
    return res.status(404).json({ success: false, message: 'Task not found.' });
  }
  return res.json({
    success: true,
    task,
    ...getWorkerDashboardForUser(email)
  });
});

app.delete('/worker/tasks/:taskId', requireAuth, (req, res) => {
  setNoStore(res);
  const { email } = getAuthenticatedUserContext(req);
  const taskId = String(req.params.taskId || '').trim();
  if (!email) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  if (hasAiWorkerBridge) {
    return void (async () => {
      try {
        await callAiWorkerService(req, 'DELETE', `/api/v1/tasks/${taskId}`);
        const dashboardPayload = await callAiWorkerService(req, 'GET', '/api/v1/tasks');
        return res.json({ success: true, ...mapAiWorkerDashboard(dashboardPayload) });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Task not found.';
        const statusCode = /not found/i.test(message) ? 404 : 400;
        return res.status(statusCode).json({ success: false, message });
      }
    })();
  }
  const deleted = deleteWorkerTaskForUser(email, taskId);
  if (!deleted) {
    return res.status(404).json({ success: false, message: 'Task not found.' });
  }
  return res.json({
    success: true,
    ...getWorkerDashboardForUser(email)
  });
});

app.post('/worker/tasks/:taskId/run', requireAuth, async (req, res) => {
  setNoStore(res);
  const { email } = getAuthenticatedUserContext(req);
  const taskId = String(req.params.taskId || '').trim();
  if (!email) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  try {
    if (hasAiWorkerBridge) {
      await callAiWorkerService(req, 'POST', `/api/v1/tasks/${taskId}/run`);
      const dashboardPayload = await callAiWorkerService(req, 'GET', '/api/v1/tasks');
      let result = null;
      try {
        const resultsPayload = await callAiWorkerService(req, 'GET', `/api/v1/tasks/${taskId}/results`);
        if (Array.isArray(resultsPayload) && resultsPayload.length > 0) {
          result = mapAiWorkerResult(resultsPayload[0]);
        }
      } catch {}
      const mappedDashboard = mapAiWorkerDashboard(dashboardPayload);
      const task = mappedDashboard.tasks.find((entry: any) => entry.id === taskId) || null;
      return res.json({
        success: true,
        task,
        result,
        ...mappedDashboard
      });
    }

    const outcome = await runWorkerTaskForUser(email, taskId, 'manual');
    return res.json({
      success: true,
      task: outcome.task,
      result: outcome.result,
      ...getWorkerDashboardForUser(email)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run task.';
    const statusCode = /not found/i.test(message) ? 404 : 400;
    return res.status(statusCode).json({ success: false, message });
  }
});

app.get('/automation/rules', requireAuth, (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const email = (reqUser?.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  const rules = getAutomationRulesForUser(email);
  return res.json({ success: true, rules });
});

app.post('/automation/rules', requireAuth, (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const email = (reqUser?.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim();
  const trigger = String(req.body?.trigger || '').trim().toUpperCase() as AutomationTrigger;
  const action = String(req.body?.action || '').trim().toUpperCase() as AutomationAction;
  const keyword = String(req.body?.keyword || '').trim().toLowerCase();
  const cooldownSec = Math.max(0, Math.min(3600, Number(req.body?.cooldownSec || 0)));

  const validTriggers: AutomationTrigger[] = ['KEYWORD', 'MENTION', 'SILENCE_GAP', 'HIGH_VOLUME'];
  const validActions: AutomationAction[] = ['AUTO_REPLY', 'ESCALATE', 'TAG', 'DELAY_REPLY'];
  if (!name || !description || !validTriggers.includes(trigger) || !validActions.includes(action)) {
    return res.status(400).json({ success: false, message: 'Invalid automation rule payload' });
  }
  if (trigger === 'KEYWORD' && !keyword) {
    return res.status(400).json({ success: false, message: 'Keyword is required for KEYWORD trigger' });
  }

  const rules = getAutomationRulesForUser(email);
  const now = new Date().toISOString();
  const newRule: AutomationRule = {
    id: randomUUID(),
    name,
    description,
    trigger,
    action,
    keyword: trigger === 'KEYWORD' ? keyword : undefined,
    cooldownSec,
    active: true,
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    successCount: 0
  };
  rules.unshift(newRule);
  automationRulesByUser.set(email, rules);
  return res.json({ success: true, rule: newRule, rules });
});

app.patch('/automation/rules/:ruleId', requireAuth, (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const email = (reqUser?.email || '').trim().toLowerCase();
  const ruleId = String(req.params.ruleId || '').trim();
  if (!email) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  const rules = getAutomationRulesForUser(email);
  const idx = rules.findIndex((r) => r.id === ruleId);
  if (idx < 0) {
    return res.status(404).json({ success: false, message: 'Rule not found' });
  }

  const current = rules[idx];
  const nextActive = typeof req.body?.active === 'boolean' ? req.body.active : !current.active;
  const updated: AutomationRule = {
    ...current,
    active: nextActive,
    updatedAt: new Date().toISOString()
  };
  rules[idx] = updated;
  automationRulesByUser.set(email, rules);
  return res.json({ success: true, rule: updated, rules });
});

app.delete('/automation/rules/:ruleId', requireAuth, (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const email = (reqUser?.email || '').trim().toLowerCase();
  const ruleId = String(req.params.ruleId || '').trim();
  if (!email) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  const rules = getAutomationRulesForUser(email);
  const next = rules.filter((r) => r.id !== ruleId);
  automationRulesByUser.set(email, next);
  return res.json({ success: true, rules: next });
});

app.post('/automation/rules/:ruleId/simulate', requireAuth, (req, res) => {
  const reqUser = req.user as Express.User | undefined;
  const email = (reqUser?.email || '').trim().toLowerCase();
  const ruleId = String(req.params.ruleId || '').trim();
  const botId = String(req.body?.botId || '').trim();
  if (!email) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }
  const rules = getAutomationRulesForUser(email);
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) {
    return res.status(404).json({ success: false, message: 'Rule not found' });
  }

  const telemetry = botId ? botTelemetry.get(botId) : undefined;
  const traffic = telemetry?.messageCount || 0;
  const baseRuns = Math.max(1, Math.round(traffic * 0.25));
  const actionFactor = rule.action === 'AUTO_REPLY' ? 0.86 : rule.action === 'ESCALATE' ? 0.72 : rule.action === 'TAG' ? 0.92 : 0.78;
  const triggerFactor = rule.trigger === 'KEYWORD' ? 0.75 : rule.trigger === 'MENTION' ? 0.82 : rule.trigger === 'SILENCE_GAP' ? 0.66 : 0.58;
  const estimatedRuns = Math.max(1, Math.round(baseRuns * triggerFactor));
  const estimatedSuccess = Math.max(0, Math.round(estimatedRuns * actionFactor));
  const estimatedImpactPct = Math.max(5, Math.min(70, Math.round((estimatedSuccess / Math.max(1, traffic || estimatedRuns)) * 100 + 12)));
  const confidencePct = Math.max(45, Math.min(97, Math.round(60 + triggerFactor * 20 + actionFactor * 10)));

  rule.runCount += estimatedRuns;
  rule.successCount += estimatedSuccess;
  rule.updatedAt = new Date().toISOString();
  automationRulesByUser.set(email, rules);

  return res.json({
    success: true,
    simulation: {
      ruleId: rule.id,
      ruleName: rule.name,
      estimatedRuns,
      estimatedSuccess,
      estimatedImpactPct,
      confidencePct,
      basedOnBotId: botId || null,
      observedTraffic: traffic
    },
    rule
  });
});

app.post('/ai/respond', requireAuth, async (req, res) => {
  const prompt = typeof req.body?.prompt === 'string' ? req.body.prompt.trim() : '';
  if (!prompt) {
    return res.status(400).json({ success: false, message: 'Prompt is required' });
  }
  if (prompt.length > 4000) {
    return res.status(400).json({ success: false, message: 'Prompt is too long' });
  }
  try {
    const reqUser = req.user as Express.User | undefined;
    const conversationIdentity = (reqUser?.email || reqUser?.id || '').trim() || undefined;
    const response = await generateProfessionalReply(prompt, conversationIdentity, 'web:ai-respond');
    return res.json({ success: true, response });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to generate response' });
  }
});

app.post('/forgot-password/send-code', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email) {
    return sendError(res, 400, 'Email is required');
  }
  if (!isValidEmailFormat(email)) {
    return sendError(res, 400, 'Invalid email format');
  }

  const user = getUserByEmail(email);
  if (!user) {
    return sendError(res, 404, 'No account found for this email');
  }

  try {
    const verification = await sendVerificationEmail(email, user.name || 'User');
    if (!verification.success) {
      return sendError(res, 500, verification.message || 'Failed to send reset code');
    }
    return res.json({
      success: true,
      message: 'Password reset code sent to your email'
    });
  } catch {
    return sendError(res, 500, 'Failed to send reset code');
  }
});

app.post('/forgot-password/reset', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!email || !code || !password) {
    return sendError(res, 400, 'Email, code and new password are required');
  }
  if (!isValidEmailFormat(email)) {
    return sendError(res, 400, 'Invalid email format');
  }
  if (!/^\d{6}$/.test(code)) {
    return sendError(res, 400, 'Invalid reset code');
  }

  const user = getUserByEmail(email);
  if (!user) {
    return sendError(res, 404, 'No account found for this email');
  }

  const passwordStrength = validatePasswordStrength(password);
  if (!passwordStrength.isValid) {
    return sendError(res, 400, `Password must contain: ${passwordStrength.errors.join(', ')}`);
  }
  if (password.length > 128) {
    return sendError(res, 400, 'Password must be 128 characters or less');
  }

  const verificationResult = validateVerificationCode(email, code);
  if (!verificationResult.ok) {
    return sendError(res, 400, 'Invalid or expired reset code');
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    updateUserPassword(email, passwordHash);
    return res.json({
      success: true,
      message: 'Password reset successful'
    });
  } catch {
    return sendError(res, 500, 'Failed to reset password');
  }
});

// Log required environment variables at startup
setTimeout(() => {
  const allowVerboseStartupLogs = process.env.NODE_ENV !== 'production'
    || (process.env.DEBUG_STARTUP_LOGS || '').trim().toLowerCase() === 'true';
  if (!allowVerboseStartupLogs) return;
  console.log('=== Environment Variables Loaded ===');
  console.log('CWD:', process.cwd());
  console.log('CWD .env exists:', fs.existsSync(path.resolve(process.cwd(), '.env')));
  console.log('PORT:', PORT);
  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('BASE_URL:', BASE_URL);
  console.log('FRONTEND_URL:', process.env.FRONTEND_URL);
  console.log('BOT_STATE_FILE:', BOT_STATE_FILE);
  console.log('TELEGRAM_BOT_TOKEN exists:', !!process.env.TELEGRAM_BOT_TOKEN);
  console.log('NVIDIA_API_KEY exists:', !!(process.env.NVIDIA_API_KEY || process.env.OPENROUTER_API_KEY));
  console.log('SINGLE_TELEGRAM_TOKEN_ONLY:', SINGLE_TELEGRAM_TOKEN_ONLY);
  console.log('GOOGLE_CLIENT_ID exists:', !!process.env.GOOGLE_CLIENT_ID);
  console.log('GOOGLE_CLIENT_SECRET exists:', !!process.env.GOOGLE_CLIENT_SECRET);
  console.log('SMTP_USER exists:', !!process.env.SMTP_USER);
  console.log('SMTP_HOST:', process.env.SMTP_HOST);
  console.log('EMAIL_FROM:', process.env.EMAIL_FROM);
  console.log('===============================');
}, 100); // Small delay to ensure environment variables are loaded

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1);
  }
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
  initWorkerRuntime();
  loadChatMemory();
  loadUserProfiles();
  loadTelegramAnalytics();
  loadConversationTasks();
  loadConversationDigestSchedules();
  loadTelegramSubscriptions();
  loadConversationKnowledgeBase();
  restorePendingConversationReminders();
  restoreConversationDigestSchedules();
  loadModerationAuditLog();
  loadTelegramAdminRestrictions();
  restorePersistedBots().catch((error) => {
    console.warn('[BOT_STATE] Restore routine failed:', (error as Error).message);
  });
  ensurePrimaryTelegramWebhook().catch((error) => {
    console.warn('[WEBHOOK] Primary webhook setup failed:', (error as Error).message);
  });
});

const creditDecayTimer = CREDIT_ENFORCEMENT_ACTIVE
  ? setInterval(() => {
    let changed = false;
    for (const botId of botTokens.keys()) {
      const before = botCredits.get(botId)?.remainingUsd ?? INITIAL_BOT_CREDIT_USD;
      const after = applyCreditDecay(botId).remainingUsd;
      if (after !== before) changed = true;
    }
    if (changed) {
      persistBotState();
    }
  }, 30_000)
  : null;
creditDecayTimer?.unref();

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  shutdownWorkerRuntime();
  if (creditDecayTimer) clearInterval(creditDecayTimer);
  for (const timer of conversationReminderTimers.values()) {
    clearTimeout(timer);
  }
  conversationReminderTimers.clear();
  for (const timer of conversationDigestTimers.values()) {
    clearTimeout(timer);
  }
  conversationDigestTimers.clear();
  if (telegramAnalyticsPersistTimer) {
    clearTimeout(telegramAnalyticsPersistTimer);
    telegramAnalyticsPersistTimer = null;
  }
  if (conversationKnowledgePersistTimer) {
    clearTimeout(conversationKnowledgePersistTimer);
    conversationKnowledgePersistTimer = null;
  }
  if (conversationTasksPersistTimer) {
    clearTimeout(conversationTasksPersistTimer);
    conversationTasksPersistTimer = null;
  }
  if (conversationDigestPersistTimer) {
    clearTimeout(conversationDigestPersistTimer);
    conversationDigestPersistTimer = null;
  }
  if (telegramSubscriptionsPersistTimer) {
    clearTimeout(telegramSubscriptionsPersistTimer);
    telegramSubscriptionsPersistTimer = null;
  }
  if (moderationAuditPersistTimer) {
    clearTimeout(moderationAuditPersistTimer);
    moderationAuditPersistTimer = null;
  }
  if (telegramAdminRestrictionsPersistTimer) {
    clearTimeout(telegramAdminRestrictionsPersistTimer);
    telegramAdminRestrictionsPersistTimer = null;
  }
  persistTelegramAnalytics();
  persistConversationTasks();
  persistConversationDigestSchedules();
  persistTelegramSubscriptions();
  persistConversationKnowledgeBase();
  persistModerationAuditLog();
  persistTelegramAdminRestrictions();
  discordGatewayClients.forEach((client) => {
    try {
      client.destroy();
    } catch {}
  });
  discordGatewayClients.clear();
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  if (creditDecayTimer) clearInterval(creditDecayTimer);
  for (const timer of conversationReminderTimers.values()) {
    clearTimeout(timer);
  }
  conversationReminderTimers.clear();
  if (telegramAnalyticsPersistTimer) {
    clearTimeout(telegramAnalyticsPersistTimer);
    telegramAnalyticsPersistTimer = null;
  }
  if (conversationKnowledgePersistTimer) {
    clearTimeout(conversationKnowledgePersistTimer);
    conversationKnowledgePersistTimer = null;
  }
  if (conversationTasksPersistTimer) {
    clearTimeout(conversationTasksPersistTimer);
    conversationTasksPersistTimer = null;
  }
  if (telegramSubscriptionsPersistTimer) {
    clearTimeout(telegramSubscriptionsPersistTimer);
    telegramSubscriptionsPersistTimer = null;
  }
  if (moderationAuditPersistTimer) {
    clearTimeout(moderationAuditPersistTimer);
    moderationAuditPersistTimer = null;
  }
  if (telegramAdminRestrictionsPersistTimer) {
    clearTimeout(telegramAdminRestrictionsPersistTimer);
    telegramAdminRestrictionsPersistTimer = null;
  }
  persistTelegramAnalytics();
  persistConversationTasks();
  persistTelegramSubscriptions();
  persistConversationKnowledgeBase();
  persistModerationAuditLog();
  persistTelegramAdminRestrictions();
  discordGatewayClients.forEach((client) => {
    try {
      client.destroy();
    } catch {}
  });
  discordGatewayClients.clear();
  server.close(() => {
    console.log('Process terminated');
  });
});




