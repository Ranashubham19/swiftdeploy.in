
export enum AIModel {
  OPENROUTER_FREE = 'openrouter/free'
}

export enum Platform {
  TELEGRAM = 'TELEGRAM',
  DISCORD = 'DISCORD',
  WHATSAPP = 'WHATSAPP',
  INSTAGRAM = 'INSTAGRAM'
}

export enum BotStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  ERROR = 'ERROR'
}

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Bot {
  id: string;
  name: string;
  platform: Platform;
  token: string;
  model: AIModel;
  status: BotStatus;
  messageCount: number;
  tokenUsage: number;
  lastActive: string;
  memoryEnabled: boolean;
  webhookUrl?: string;
  telegramUsername?: string;
  telegramLink?: string;
}

export type WorkerTaskType =
  | 'PRICE_TRACKER'
  | 'JOB_MONITOR'
  | 'NEWS_DIGEST'
  | 'PAGE_CHANGE'
  | 'WEBSITE_MONITOR';

export type WorkerSchedule = 'hourly' | 'daily' | 'weekly';
export type WorkerTaskStatus = 'ACTIVE' | 'PAUSED';
export type WorkerRunStatus = 'IDLE' | 'RUNNING' | 'SUCCESS' | 'ERROR';
export type WorkerDeliveryChannel = 'EMAIL' | 'TELEGRAM';
export type WorkerLogLevel = 'INFO' | 'SUCCESS' | 'ERROR' | 'REPAIR';

export interface WorkerAutomationStep {
  action: string;
  label?: string;
  url?: string;
  selector?: string;
  selectors?: string[];
  text?: string;
  value?: string;
  storeAs?: string;
  attribute?: string;
  key?: string;
  waitForSelector?: string;
  timeoutMs?: number;
  allMatches?: boolean;
  maxItems?: number;
  fallbackKeywords?: string[];
  extractRegex?: string;
}

export interface WorkerStructuredInstructions {
  taskType: WorkerTaskType;
  website: string;
  websiteUrl: string;
  action: string;
  keyword: string;
  extract: string;
  schedule: WorkerSchedule;
  deliveryChannel: WorkerDeliveryChannel;
  condition: string;
  preferredExtractor?: string;
  selectors?: string[];
  steps?: WorkerAutomationStep[];
  metadata?: Record<string, unknown>;
}

export interface WorkerTask {
  id: string;
  userEmail: string;
  title: string;
  taskDescription: string;
  structuredInstructions: WorkerStructuredInstructions;
  schedule: WorkerSchedule;
  status: WorkerTaskStatus;
  runStatus: WorkerRunStatus;
  createdAt: string;
  updatedAt: string;
  nextRunAt: string;
  lastRunAt?: string;
  lastSuccessfulRunAt?: string;
  runCount: number;
  successCount: number;
  failureCount: number;
  repairCount: number;
  lastSummary?: string;
  lastError?: string;
}

export interface WorkerTaskResult {
  id: string;
  taskId: string;
  summary: string;
  status: 'SUCCESS' | 'ERROR';
  executionTime: string;
  createdAt: string;
  detectedChange: boolean;
  resultData: Record<string, unknown>;
}

export interface WorkerExecutionLog {
  id: string;
  taskId: string;
  level: WorkerLogLevel;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface WorkerDashboardData {
  tasks: WorkerTask[];
  recentResults: WorkerTaskResult[];
  recentLogs: WorkerExecutionLog[];
  stats: {
    activeTasks: number;
    pausedTasks: number;
    totalRuns: number;
    successfulRuns: number;
    detectedChanges: number;
  };
}
