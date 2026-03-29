export type ConversationRole = "user" | "assistant";

export interface ConversationMessage {
  id: string;
  role: ConversationRole;
  content: string;
  createdAt: string;
  status?: "streaming" | "done" | "error";
  answerMode?: ResearchRunResult["classification"]["mode"];
}

export interface PersistenceState {
  mode: "local" | "supabase";
  synced: boolean;
  reason?: string;
  updatedAt?: string;
}

export interface ConversationThread {
  id: string;
  title: string;
  userId: string | null;
  updatedAt: string;
  messages: ConversationMessage[];
  progress: ResearchProgressStep[];
  sources: ResearchSource[];
  activeResult: ResearchRunResult | null;
  persistence: PersistenceState;
}

export interface ConversationMemory {
  summary: string;
  activeTopic: string;
  lastUserQuestion: string;
  lastAssistantAnswer: string;
  lastResolvedQuestion: string;
  openQuestions: string[];
  entities: string[];
  locations: string[];
}

export type ResearchPhase =
  | "memory"
  | "classification"
  | "analysis"
  | "planning"
  | "rewrite"
  | "search"
  | "crawl"
  | "rerank"
  | "embedding"
  | "retrieval"
  | "reasoning"
  | "report"
  | "error";

export type QueryType =
  | "greeting"
  | "general_knowledge"
  | "realtime_search"
  | "comparison"
  | "coding"
  | "research"
  | "website_analysis";

export type AnswerMode =
  | "chat"
  | "search"
  | "research"
  | "code"
  | "website"
  | "document";

export type AnswerFormat =
  | "greeting"
  | "general"
  | "source"
  | "research"
  | "coding"
  | "website_analysis"
  | "document";

export interface QueryClassification {
  type: QueryType;
  mode: AnswerMode;
  reasoning: string;
  confidence: "high" | "medium";
}

export interface ResearchProgressStep {
  id: string;
  phase: ResearchPhase;
  label: string;
  detail?: string;
  status: "completed" | "error";
  timestamp: string;
}

export interface ResearchSource {
  id: string;
  title: string;
  url: string;
  snippet: string;
  provider:
    | "tavily"
    | "serpapi"
    | "firecrawl"
    | "apify"
    | "brightdata"
    | "scraperapi"
    | "jina"
    | "weaviate";
  domain: string;
  score: number;
  publishedDate?: string;
}

export type ClawCloudEvidenceKind =
  | "search_result"
  | "official_api"
  | "official_page"
  | "weather_provider"
  | "market_data"
  | "report"
  | "inferred";

export interface ClawCloudEvidenceItem {
  title: string;
  domain: string;
  kind: ClawCloudEvidenceKind;
  url?: string | null;
  snippet?: string | null;
  publishedAt?: string | null;
  observedAt?: string | null;
}

export interface ClawCloudAnswerBundle {
  question: string;
  answer: string;
  channel: "live";
  generatedAt: string;
  badge: string | null;
  sourceNote: string | null;
  evidence: ClawCloudEvidenceItem[];
  sourceSummary: string[];
  metadata: Record<string, string | number | boolean | null>;
}

export interface ClawCloudTextAnswerResult {
  answer: string;
  liveAnswerBundle?: ClawCloudAnswerBundle | null;
}

export type ClawCloudModelAuditStrategy = "single_pass" | "collect_and_judge";
export type ClawCloudModelAuditSelectedBy = "single_success" | "heuristic" | "judge" | "fallback";
export type ClawCloudModelAuditTier = "fast" | "chat" | "reasoning" | "code";
export type ClawCloudModelAuditJudgeConfidence = "high" | "medium" | "low";

export interface ClawCloudModelAuditPlanner {
  strategy: ClawCloudModelAuditStrategy;
  targetResponses: number;
  generatorBatchSize: number;
  judgeEnabled: boolean;
  judgeMinRemainingMs: number;
  allowLowConfidenceWinner: boolean;
  disagreementThreshold: number;
}

export interface ClawCloudModelAuditCandidate {
  model: string;
  tier: ClawCloudModelAuditTier;
  status: "selected" | "generated" | "failed";
  latencyMs: number;
  heuristicScore: number | null;
  preview: string | null;
}

export interface ClawCloudModelAuditJudge {
  used: boolean;
  model: string | null;
  winnerModel: string | null;
  confidence: ClawCloudModelAuditJudgeConfidence | null;
  materialDisagreement: boolean;
  needsClarification: boolean;
  reason: string | null;
}

export interface ClawCloudModelAuditTrail {
  intent: string;
  responseMode: "fast" | "deep";
  planner: ClawCloudModelAuditPlanner;
  selectedBy: ClawCloudModelAuditSelectedBy | null;
  selectedModel: string | null;
  candidates: ClawCloudModelAuditCandidate[];
  judge: ClawCloudModelAuditJudge | null;
}

export type SearchProvider = "tavily" | "serpapi" | "jina";

export interface SearchProviderQueryDiagnostic {
  provider: SearchProvider;
  query: string;
  attempted: boolean;
  ok: boolean;
  durationMs: number;
  resultCount: number;
  error?: string;
}

export interface SearchProviderSummaryDiagnostic {
  provider: SearchProvider;
  attemptedQueries: number;
  successfulQueries: number;
  failedQueries: number;
  totalResults: number;
  averageDurationMs: number;
  maxDurationMs: number;
  lastError?: string;
}

export interface SearchDiagnostics {
  queries: string[];
  rawResultCount: number;
  dedupedResultCount: number;
  providerQueries: SearchProviderQueryDiagnostic[];
  providerSummary: SearchProviderSummaryDiagnostic[];
  retryCount: number;
  retryReason?: string;
  retryQueries?: string[];
}

export interface ResearchDocument {
  id: string;
  title: string;
  url: string;
  content: string;
  provider:
    | "firecrawl"
    | "jina"
    | "apify"
    | "brightdata"
    | "scraperapi"
    | "search-fallback";
  excerpt: string;
}

export interface ResearchPlan {
  objective: string;
  tasks: string[];
  queries: string[];
  deliverable: string;
}

export interface AnswerSection {
  title: string;
  content: string;
  kind?: "markdown" | "code";
  language?: string;
}

export interface AssistantAnswer {
  format: AnswerFormat;
  title: string;
  summary: string;
  keyInsights: string[];
  sections: AnswerSection[];
  followUps: string[];
  markdown: string;
}

export interface RetrievedChunk {
  id: string;
  title: string;
  url: string;
  content: string;
  sourceProvider: string;
  chunkIndex: number;
  score: number;
}

export interface ResearchReport {
  title: string;
  executiveSummary: string;
  keyFindings: string[];
  detailedAnalysis: string;
  sourceHighlights: string[];
  sources: ResearchSource[];
  plan: ResearchPlan;
  retrievalContext: RetrievedChunk[];
}

export interface ProviderSnapshot {
  tavily: boolean;
  serpapi: boolean;
  firecrawl: boolean;
  apify: boolean;
  brightdata: boolean;
  scraperapi: boolean;
  weaviate: boolean;
  jina: boolean;
  cohere: boolean;
  voyage: boolean;
  pinecone: boolean;
  nvidia: boolean;
  supabase: boolean;
  firebase: boolean;
  langsmith: boolean;
}

export interface ResearchRunResult {
  question: string;
  resolvedQuestion: string;
  classification: QueryClassification;
  plan: ResearchPlan;
  progress: ResearchProgressStep[];
  sources: ResearchSource[];
  retrievedContext: RetrievedChunk[];
  answer: AssistantAnswer;
  report: ResearchReport | null;
  memory: ConversationMemory;
  rewrittenQueries: string[];
  usedConversationContext: boolean;
  providerSnapshot: ProviderSnapshot;
  searchDiagnostics?: SearchDiagnostics | null;
}

export interface AuthenticatedUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL?: string | null;
}

export interface ResearchRequestBody {
  question: string;
  threadId?: string;
  history?: Array<{
    role: ConversationRole;
    content: string;
  }>;
  memory?: Partial<ConversationMemory> | null;
  user?: {
    uid?: string | null;
    email?: string | null;
    displayName?: string | null;
  } | null;
}

export interface PublicAppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  appUrl: string;
  telegramBotUsername?: string;
  googleRollout: {
    publicSignInEnabled: boolean;
    publicWorkspaceEnabled: boolean;
    publicWorkspaceExtendedEnabled: boolean;
    setupLiteMode: boolean;
  };
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
    measurementId: string;
  };
  providerSnapshot: ProviderSnapshot;
}
