import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';

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
type WorkerExtractor =
  | 'structured_data_price'
  | 'keyword_price'
  | 'generic_price'
  | 'job_line_scan'
  | 'news_line_scan'
  | 'text_hash'
  | 'title_summary';
type WorkerRunTrigger = 'manual' | 'scheduled';

export type WorkerStructuredInstructions = {
  taskType: WorkerTaskType;
  website: string;
  websiteUrl: string;
  action: string;
  keyword: string;
  extract: string;
  schedule: WorkerSchedule;
  deliveryChannel: WorkerDeliveryChannel;
  condition: string;
  preferredExtractor?: WorkerExtractor;
};

export type WorkerTask = {
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
};

export type WorkerTaskResult = {
  id: string;
  taskId: string;
  summary: string;
  status: 'SUCCESS' | 'ERROR';
  executionTime: string;
  createdAt: string;
  detectedChange: boolean;
  resultData: Record<string, unknown>;
};

export type WorkerExecutionLog = {
  id: string;
  taskId: string;
  level: WorkerLogLevel;
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

type WorkerStore = {
  version: 1;
  tasks: WorkerTask[];
  results: WorkerTaskResult[];
  logs: WorkerExecutionLog[];
};

const WORKER_STATE_FILE = (process.env.WORKER_STATE_FILE || '').trim()
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'swiftdeploy-worker-store.json')
    : path.resolve(process.cwd(), 'runtime', 'swiftdeploy-worker-store.json'));

const DEFAULT_STORE: WorkerStore = {
  version: 1,
  tasks: [],
  results: [],
  logs: []
};

const knownWebsites: Array<{ match: RegExp; label: string; domain: string }> = [
  { match: /\bamazon\b/i, label: 'Amazon', domain: 'amazon.in' },
  { match: /\bflipkart\b/i, label: 'Flipkart', domain: 'flipkart.com' },
  { match: /\bindeed\b/i, label: 'Indeed', domain: 'indeed.com' },
  { match: /\blinkedin\b/i, label: 'LinkedIn', domain: 'linkedin.com' },
  { match: /\bgoogle news\b/i, label: 'Google News', domain: 'news.google.com' },
  { match: /\bhacker news\b|\bycombinator\b/i, label: 'Hacker News', domain: 'news.ycombinator.com' },
  { match: /\btechcrunch\b/i, label: 'TechCrunch', domain: 'techcrunch.com' }
];

let store = cloneStore(DEFAULT_STORE);
let loaded = false;
let persistTimer: NodeJS.Timeout | null = null;
let schedulerTimer: NodeJS.Timeout | null = null;
const activeRuns = new Set<string>();

function cloneStore(input: WorkerStore): WorkerStore {
  return {
    version: 1,
    tasks: input.tasks.map((task) => ({
      ...task,
      structuredInstructions: { ...task.structuredInstructions }
    })),
    results: input.results.map((result) => ({
      ...result,
      resultData: { ...result.resultData }
    })),
    logs: input.logs.map((log) => ({
      ...log,
      metadata: log.metadata ? { ...log.metadata } : undefined
    }))
  };
}

const normalizeEmailKey = (email: string): string => email.trim().toLowerCase();
const nowIso = (): string => new Date().toISOString();

const sanitizeText = (value: string): string =>
  value.replace(/\s+/g, ' ').replace(/[<>]/g, '').trim();

const decodeEntities = (value: string): string =>
  value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const stripHtml = (html: string): string =>
  decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();

const extractTitle = (html: string): string => {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? sanitizeText(stripHtml(match[1])).slice(0, 160) : 'Untitled page';
};

const extractLines = (text: string): string[] =>
  text
    .split(/(?<=[.?!])\s+|\n+/)
    .map((line) => sanitizeText(line))
    .filter((line) => line.length > 12);

const getResultItems = (result: WorkerTaskResult | undefined): string[] => {
  const rawItems = result?.resultData?.items;
  return Array.isArray(rawItems) ? rawItems.map((item) => String(item)) : [];
};

const firstUrlInText = (input: string): string => {
  const match = input.match(/https?:\/\/[^\s]+/i);
  return match ? match[0].replace(/[),.;]+$/, '') : '';
};

const ensureUrlProtocol = (candidate: string): string => {
  const trimmed = candidate.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

const slugToTitle = (value: string): string =>
  value
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .replace(/\./g, '.');

function ensureStoreLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(WORKER_STATE_FILE)) {
      store = cloneStore(DEFAULT_STORE);
      return;
    }
    const raw = fs.readFileSync(WORKER_STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<WorkerStore>;
    store = {
      version: 1,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      results: Array.isArray(parsed.results) ? parsed.results : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs : []
    };
  } catch (error) {
    console.warn('[WORKER_STORE] Failed to load persisted store:', (error as Error).message);
    store = cloneStore(DEFAULT_STORE);
  }
}

function persistStore(): void {
  ensureStoreLoaded();
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }

  try {
    fs.mkdirSync(path.dirname(WORKER_STATE_FILE), { recursive: true });
    fs.writeFileSync(WORKER_STATE_FILE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.warn('[WORKER_STORE] Failed to persist store:', (error as Error).message);
  }
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistStore();
  }, 250);
  persistTimer.unref();
}

const computeNextRunAt = (schedule: WorkerSchedule, fromIso = nowIso()): string => {
  const baseTime = new Date(fromIso).getTime();
  const offsets: Record<WorkerSchedule, number> = {
    hourly: 60 * 60 * 1000,
    daily: 24 * 60 * 60 * 1000,
    weekly: 7 * 24 * 60 * 60 * 1000
  };
  return new Date(baseTime + offsets[schedule]).toISOString();
};

const findKnownWebsite = (input: string): { label: string; domain: string } | null => {
  for (const website of knownWebsites) {
    if (website.match.test(input)) {
      return { label: website.label, domain: website.domain };
    }
  }
  const domainMatch = input.match(/\b([a-z0-9-]+\.(?:com|in|org|io|net|co))(?:\/|\b)/i);
  if (!domainMatch) return null;
  return {
    label: slugToTitle(domainMatch[1]),
    domain: domainMatch[1].toLowerCase()
  };
};

const extractSchedule = (input: string): WorkerSchedule => {
  if (/\bhour(?:ly)?\b|every hour|every 60 minutes/i.test(input)) return 'hourly';
  if (/\bweek(?:ly)?\b|every week/i.test(input)) return 'weekly';
  return 'daily';
};

const extractDeliveryChannel = (input: string): WorkerDeliveryChannel =>
  /\btelegram\b/i.test(input) ? 'TELEGRAM' : 'EMAIL';

const extractTaskType = (input: string): WorkerTaskType => {
  if (/\bprice\b|\bcost\b|\bdiscount\b|\bdeal\b|\bavailability\b/i.test(input)) return 'PRICE_TRACKER';
  if (/\bjob\b|\bjobs\b|\bhiring\b|\bvacanc(?:y|ies)\b|\bremote developer\b/i.test(input)) return 'JOB_MONITOR';
  if (/\bnews\b|\bheadlines\b|\bdigest\b/i.test(input)) return 'NEWS_DIGEST';
  if (/\bchange\b|\bchanges\b|\bupdated\b|\bmonitor page\b|\bwatch webpage\b/i.test(input)) return 'PAGE_CHANGE';
  return 'WEBSITE_MONITOR';
};

const extractKeyword = (input: string, taskType: WorkerTaskType): string => {
  const cleaned = sanitizeText(input);
  const website = findKnownWebsite(cleaned);
  const withoutUrl = cleaned.replace(/https?:\/\/[^\s]+/gi, ' ');
  const withoutSchedule = withoutUrl.replace(/\b(hourly|daily|weekly|every day|every hour|every week)\b/gi, ' ');
  const withoutDelivery = withoutSchedule.replace(/\b(telegram|email|notify me|alert me)\b/gi, ' ');

  const patterns: Array<RegExp> = [
    /(?:track|monitor|watch|find|send|notify me about|alert me about)\s+(.+?)\s+(?:on|from|at)\s+[a-z0-9.-]+/i,
    /(?:track|monitor|watch|find|send)\s+(.+?)\s+(?:every|daily|weekly|hourly)\b/i,
    /(?:track|monitor|watch|find|send)\s+(.+)/i
  ];

  for (const pattern of patterns) {
    const match = withoutDelivery.match(pattern);
    if (match?.[1]) {
      const raw = sanitizeText(match[1])
        .replace(/\b(price|prices|jobs|news|headlines|changes?)\b/gi, '')
        .trim();
      if (raw) return raw.slice(0, 140);
    }
  }

  if (taskType === 'NEWS_DIGEST') {
    const topicMatch = withoutDelivery.match(/\b(top|latest)\s+(.+?)\s+news/i);
    if (topicMatch?.[2]) return sanitizeText(topicMatch[2]).slice(0, 140);
    return 'AI';
  }

  if (website?.label) return website.label;
  return cleaned.slice(0, 140);
};

const buildWebsiteUrl = (input: string, keyword: string, taskType: WorkerTaskType): { website: string; websiteUrl: string } => {
  const directUrl = firstUrlInText(input);
  if (directUrl) {
    const normalized = ensureUrlProtocol(directUrl);
    const domain = normalized.replace(/^https?:\/\//i, '').split('/')[0];
    return {
      website: slugToTitle(domain),
      websiteUrl: normalized
    };
  }

  const knownWebsite = findKnownWebsite(input);
  if (knownWebsite) {
    const query = encodeURIComponent(keyword);
    if (/amazon/i.test(knownWebsite.domain)) {
      return {
        website: knownWebsite.label,
        websiteUrl: `https://${knownWebsite.domain}/s?k=${query}`
      };
    }
    if (/indeed/i.test(knownWebsite.domain)) {
      return {
        website: knownWebsite.label,
        websiteUrl: `https://${knownWebsite.domain}/jobs?q=${query}`
      };
    }
    if (/linkedin/i.test(knownWebsite.domain)) {
      return {
        website: knownWebsite.label,
        websiteUrl: `https://${knownWebsite.domain}/jobs/search/?keywords=${query}`
      };
    }
    if (/news\.google/i.test(knownWebsite.domain)) {
      return {
        website: knownWebsite.label,
        websiteUrl: `https://${knownWebsite.domain}/search?q=${query}`
      };
    }
    if (/news\.ycombinator/i.test(knownWebsite.domain)) {
      return {
        website: knownWebsite.label,
        websiteUrl: `https://${knownWebsite.domain}/`
      };
    }
    return {
      website: knownWebsite.label,
      websiteUrl: `https://${knownWebsite.domain}/search?q=${query}`
    };
  }

  const fallbackUrl =
    taskType === 'NEWS_DIGEST'
      ? `https://news.google.com/search?q=${encodeURIComponent(keyword || 'AI')}`
      : `https://www.google.com/search?q=${encodeURIComponent(keyword)}`;

  return {
    website: taskType === 'NEWS_DIGEST' ? 'Google News' : 'Google',
    websiteUrl: fallbackUrl
  };
};

const buildTaskTitle = (taskType: WorkerTaskType, keyword: string, website: string): string => {
  const suffix = keyword || website || 'Internet task';
  const normalizedSuffix = suffix.replace(/\s+/g, ' ').trim();
  switch (taskType) {
    case 'PRICE_TRACKER':
      return `Track price: ${normalizedSuffix}`;
    case 'JOB_MONITOR':
      return `Watch jobs: ${normalizedSuffix}`;
    case 'NEWS_DIGEST':
      return `News digest: ${normalizedSuffix}`;
    case 'PAGE_CHANGE':
      return `Watch page changes: ${normalizedSuffix}`;
    default:
      return `Monitor website: ${normalizedSuffix}`;
  }
};

const buildCondition = (taskType: WorkerTaskType): string => {
  switch (taskType) {
    case 'PRICE_TRACKER':
      return 'Notify when the detected price changes or drops';
    case 'JOB_MONITOR':
      return 'Notify when new matching roles appear';
    case 'NEWS_DIGEST':
      return 'Notify when fresh matching headlines are collected';
    case 'PAGE_CHANGE':
      return 'Notify when the watched page content changes';
    default:
      return 'Notify when important page content changes';
  }
};

export const interpretWorkerTask = (description: string): { title: string; instructions: WorkerStructuredInstructions } => {
  const cleaned = sanitizeText(description);
  if (!cleaned || cleaned.length < 8) {
    throw new Error('Describe the task in more detail.');
  }

  const taskType = extractTaskType(cleaned);
  const schedule = extractSchedule(cleaned);
  const keyword = extractKeyword(cleaned, taskType);
  const deliveryChannel = extractDeliveryChannel(cleaned);
  const { website, websiteUrl } = buildWebsiteUrl(cleaned, keyword, taskType);

  const instructions: WorkerStructuredInstructions = {
    taskType,
    website,
    websiteUrl,
    action:
      taskType === 'PRICE_TRACKER'
        ? 'search_product'
        : taskType === 'JOB_MONITOR'
          ? 'collect_job_listings'
          : taskType === 'NEWS_DIGEST'
            ? 'collect_headlines'
            : taskType === 'PAGE_CHANGE'
              ? 'capture_page_snapshot'
              : 'monitor_page',
    keyword,
    extract:
      taskType === 'PRICE_TRACKER'
        ? 'price'
        : taskType === 'JOB_MONITOR'
          ? 'job_titles'
          : taskType === 'NEWS_DIGEST'
            ? 'headlines'
            : taskType === 'PAGE_CHANGE'
              ? 'content_hash'
              : 'key_content',
    schedule,
    deliveryChannel,
    condition: buildCondition(taskType)
  };

  return {
    title: buildTaskTitle(taskType, keyword, website),
    instructions
  };
};

const findTaskIndex = (email: string, taskId: string): number =>
  store.tasks.findIndex((task) => task.userEmail === normalizeEmailKey(email) && task.id === taskId);

const getRecentResultsForTask = (taskId: string): WorkerTaskResult[] =>
  store.results.filter((result) => result.taskId === taskId).slice(0, 8);

const getRecentLogsForTask = (taskId: string): WorkerExecutionLog[] =>
  store.logs.filter((log) => log.taskId === taskId).slice(0, 12);

const appendLog = (
  taskId: string,
  level: WorkerLogLevel,
  message: string,
  metadata?: Record<string, unknown>
): WorkerExecutionLog => {
  const log: WorkerExecutionLog = {
    id: randomUUID(),
    taskId,
    level,
    message,
    timestamp: nowIso(),
    metadata
  };
  store.logs.unshift(log);
  store.logs = store.logs.slice(0, 600);
  schedulePersist();
  return log;
};

const appendResult = (
  taskId: string,
  status: 'SUCCESS' | 'ERROR',
  summary: string,
  resultData: Record<string, unknown>,
  detectedChange: boolean
): WorkerTaskResult => {
  const timestamp = nowIso();
  const result: WorkerTaskResult = {
    id: randomUUID(),
    taskId,
    status,
    summary,
    resultData,
    executionTime: timestamp,
    createdAt: timestamp,
    detectedChange
  };
  store.results.unshift(result);
  store.results = store.results.slice(0, 400);
  schedulePersist();
  return result;
};

const extractPriceCandidates = (text: string): Array<{ raw: string; value: number | null }> => {
  const matches = text.match(/(?:₹|Rs\.?|USD|INR|\$|€|£)\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|INR|EUR|GBP)/g) || [];
  return matches.map((raw) => {
    const numericMatch = raw.replace(/[^\d.]/g, '');
    const value = numericMatch ? Number(numericMatch.replace(/,/g, '')) : Number.NaN;
    return {
      raw: sanitizeText(raw),
      value: Number.isFinite(value) ? value : null
    };
  });
};

const detectRelevantLines = (lines: string[], keyword: string, fallbackPattern: RegExp, limit = 5): string[] => {
  const keywordTerms = keyword
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  const scored = lines
    .map((line) => {
      const lower = line.toLowerCase();
      const keywordScore = keywordTerms.reduce((score, term) => score + (lower.includes(term) ? 1 : 0), 0);
      const fallbackScore = fallbackPattern.test(lower) ? 1 : 0;
      return {
        line,
        score: keywordScore * 2 + fallbackScore
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((item) => item.line);
};

const parsePriceTask = (
  html: string,
  text: string,
  instructions: WorkerStructuredInstructions
): {
  summary: string;
  data: Record<string, unknown>;
  extractor: WorkerExtractor;
  repaired: boolean;
} => {
  const lines = extractLines(text).slice(0, 120);
  const extractorOrder: WorkerExtractor[] = instructions.preferredExtractor
    ? [
        instructions.preferredExtractor,
        'structured_data_price',
        'keyword_price',
        'generic_price'
      ]
    : ['structured_data_price', 'keyword_price', 'generic_price'];
  const uniqueOrder = Array.from(new Set(extractorOrder));

  for (const extractor of uniqueOrder) {
    if (extractor === 'structured_data_price') {
      const match = html.match(/"price"\s*:\s*"?(?<price>\d[\d,.]*)"?/i);
      if (match?.groups?.price) {
        const value = Number(match.groups.price.replace(/,/g, ''));
        if (Number.isFinite(value)) {
          return {
            summary: `Detected ${match.groups.price} on ${instructions.website}.`,
            data: {
              website: instructions.website,
              websiteUrl: instructions.websiteUrl,
              matchedPrice: match.groups.price,
              numericPrice: value,
              extractor
            },
            extractor,
            repaired: Boolean(instructions.preferredExtractor && instructions.preferredExtractor !== extractor)
          };
        }
      }
    }

    if (extractor === 'keyword_price') {
      const relevantLines = detectRelevantLines(lines, instructions.keyword, /price|deal|offer|sale/i, 6);
      const candidates = extractPriceCandidates(relevantLines.join(' '));
      if (candidates.length > 0) {
        return {
          summary: `Tracked ${instructions.keyword} on ${instructions.website} and found ${candidates[0].raw}.`,
          data: {
            website: instructions.website,
            websiteUrl: instructions.websiteUrl,
            matchedPrice: candidates[0].raw,
            numericPrice: candidates[0].value,
            supportingLines: relevantLines,
            extractor
          },
          extractor,
          repaired: Boolean(instructions.preferredExtractor && instructions.preferredExtractor !== extractor)
        };
      }
    }

    if (extractor === 'generic_price') {
      const candidates = extractPriceCandidates(text.slice(0, 5000));
      if (candidates.length > 0) {
        return {
          summary: `Scanned ${instructions.website} and extracted ${candidates[0].raw}.`,
          data: {
            website: instructions.website,
            websiteUrl: instructions.websiteUrl,
            matchedPrice: candidates[0].raw,
            numericPrice: candidates[0].value,
            extractor
          },
          extractor,
          repaired: Boolean(instructions.preferredExtractor && instructions.preferredExtractor !== extractor)
        };
      }
    }
  }

  throw new Error('No price-like value was found on the page.');
};

const buildStableHash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const executeTaskInstructions = async (task: WorkerTask): Promise<{
  summary: string;
  detectedChange: boolean;
  data: Record<string, unknown>;
  extractor: WorkerExtractor;
  repaired: boolean;
}> => {
  const response = await fetch(task.structuredInstructions.websiteUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
      'accept-language': 'en-US,en;q=0.9'
    }
  });

  if (!response.ok) {
    throw new Error(`Target website returned ${response.status}.`);
  }

  const html = await response.text();
  const pageTitle = extractTitle(html);
  const text = stripHtml(html);
  const lines = extractLines(text).slice(0, 160);
  const previousResult = store.results.find((result) => result.taskId === task.id && result.status === 'SUCCESS');

  if (task.structuredInstructions.taskType === 'PRICE_TRACKER') {
    const priceOutcome = parsePriceTask(html, text, task.structuredInstructions);
    const previousNumericPrice = Number(previousResult?.resultData?.numericPrice || 0);
    const currentNumericPrice = Number(priceOutcome.data.numericPrice || 0);
    const priceDrop = Number.isFinite(previousNumericPrice) && previousNumericPrice > 0
      ? Number.isFinite(currentNumericPrice) && currentNumericPrice > 0 && currentNumericPrice < previousNumericPrice
      : false;

    return {
      summary: priceDrop
        ? `${task.structuredInstructions.keyword} dropped from ${previousResult?.resultData?.matchedPrice || previousNumericPrice} to ${priceOutcome.data.matchedPrice}.`
        : priceOutcome.summary,
      detectedChange: priceDrop || (
        Boolean(previousResult?.resultData?.matchedPrice)
        && previousResult?.resultData?.matchedPrice !== priceOutcome.data.matchedPrice
      ),
      data: {
        ...priceOutcome.data,
        title: pageTitle
      },
      extractor: priceOutcome.extractor,
      repaired: priceOutcome.repaired
    };
  }

  if (task.structuredInstructions.taskType === 'JOB_MONITOR') {
    const roles = detectRelevantLines(lines, task.structuredInstructions.keyword, /remote|engineer|developer|manager|designer|analyst/i, 6);
    if (roles.length === 0) {
      throw new Error('No matching job titles were detected on the page.');
    }
    const previousTopRole = getResultItems(previousResult)[0] || '';
    const detectedChange = previousTopRole ? previousTopRole !== roles[0] : true;
    return {
      summary: `Collected ${roles.length} matching role signals from ${task.structuredInstructions.website}.`,
      detectedChange,
      data: {
        title: pageTitle,
        website: task.structuredInstructions.website,
        websiteUrl: task.structuredInstructions.websiteUrl,
        items: roles,
        extractor: 'job_line_scan'
      },
      extractor: 'job_line_scan',
      repaired: false
    };
  }

  if (task.structuredInstructions.taskType === 'NEWS_DIGEST') {
    const headlines = detectRelevantLines(lines, task.structuredInstructions.keyword || 'AI', /ai|launch|funding|research|model|openai|anthropic/i, 6);
    if (headlines.length === 0) {
      throw new Error('No matching headlines were detected on the page.');
    }
    const previousHeadline = getResultItems(previousResult)[0] || '';
    const detectedChange = previousHeadline ? previousHeadline !== headlines[0] : true;
    return {
      summary: `Collected ${headlines.length} headline matches from ${task.structuredInstructions.website}.`,
      detectedChange,
      data: {
        title: pageTitle,
        website: task.structuredInstructions.website,
        websiteUrl: task.structuredInstructions.websiteUrl,
        items: headlines,
        extractor: 'news_line_scan'
      },
      extractor: 'news_line_scan',
      repaired: false
    };
  }

  const contentFingerprint = buildStableHash(text.slice(0, 9000));
  const previousFingerprint = String(previousResult?.resultData?.contentFingerprint || '');
  const detectedChange = previousFingerprint ? previousFingerprint !== contentFingerprint : false;
  const snippet = lines.slice(0, 5);

  return {
    summary: detectedChange
      ? `${task.structuredInstructions.website} changed since the previous run.`
      : `Captured the latest snapshot from ${task.structuredInstructions.website}.`,
    detectedChange,
    data: {
      title: pageTitle,
      website: task.structuredInstructions.website,
      websiteUrl: task.structuredInstructions.websiteUrl,
      snippet,
      contentFingerprint,
      extractor: task.structuredInstructions.taskType === 'PAGE_CHANGE' ? 'text_hash' : 'title_summary'
    },
    extractor: task.structuredInstructions.taskType === 'PAGE_CHANGE' ? 'text_hash' : 'title_summary',
    repaired: false
  };
};

const trimTaskArtifacts = (taskId: string): void => {
  const taskResults = store.results.filter((result) => result.taskId === taskId);
  if (taskResults.length > 16) {
    const keepIds = new Set(taskResults.slice(0, 16).map((result) => result.id));
    store.results = store.results.filter((result) => result.taskId !== taskId || keepIds.has(result.id));
  }
  const taskLogs = store.logs.filter((log) => log.taskId === taskId);
  if (taskLogs.length > 30) {
    const keepIds = new Set(taskLogs.slice(0, 30).map((log) => log.id));
    store.logs = store.logs.filter((log) => log.taskId !== taskId || keepIds.has(log.id));
  }
};

export const createWorkerTaskForUser = (email: string, description: string): WorkerTask => {
  ensureStoreLoaded();
  const normalizedEmail = normalizeEmailKey(email);
  const interpreted = interpretWorkerTask(description);
  const createdAt = nowIso();
  const task: WorkerTask = {
    id: randomUUID(),
    userEmail: normalizedEmail,
    title: interpreted.title,
    taskDescription: sanitizeText(description),
    structuredInstructions: interpreted.instructions,
    schedule: interpreted.instructions.schedule,
    status: 'ACTIVE',
    runStatus: 'IDLE',
    createdAt,
    updatedAt: createdAt,
    nextRunAt: computeNextRunAt(interpreted.instructions.schedule, createdAt),
    runCount: 0,
    successCount: 0,
    failureCount: 0,
    repairCount: 0
  };

  store.tasks.unshift(task);
  schedulePersist();
  appendLog(task.id, 'INFO', 'Task created from natural-language prompt.', {
    taskType: task.structuredInstructions.taskType,
    website: task.structuredInstructions.website
  });
  return task;
};

export const getWorkerDashboardForUser = (email: string): {
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
} => {
  ensureStoreLoaded();
  const normalizedEmail = normalizeEmailKey(email);
  const tasks = store.tasks
    .filter((task) => task.userEmail === normalizedEmail)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const taskIds = new Set(tasks.map((task) => task.id));
  const recentResults = store.results.filter((result) => taskIds.has(result.taskId)).slice(0, 25);
  const recentLogs = store.logs.filter((log) => taskIds.has(log.taskId)).slice(0, 40);

  return {
    tasks,
    recentResults,
    recentLogs,
    stats: {
      activeTasks: tasks.filter((task) => task.status === 'ACTIVE').length,
      pausedTasks: tasks.filter((task) => task.status === 'PAUSED').length,
      totalRuns: tasks.reduce((total, task) => total + task.runCount, 0),
      successfulRuns: tasks.reduce((total, task) => total + task.successCount, 0),
      detectedChanges: recentResults.filter((result) => result.detectedChange).length
    }
  };
};

export const getWorkerTaskHistoryForUser = (
  email: string,
  taskId: string
): { task: WorkerTask; results: WorkerTaskResult[]; logs: WorkerExecutionLog[] } | null => {
  ensureStoreLoaded();
  const idx = findTaskIndex(email, taskId);
  if (idx < 0) return null;
  return {
    task: store.tasks[idx],
    results: getRecentResultsForTask(taskId),
    logs: getRecentLogsForTask(taskId)
  };
};

export const updateWorkerTaskForUser = (
  email: string,
  taskId: string,
  patch: Partial<Pick<WorkerTask, 'status' | 'taskDescription' | 'schedule'>>
): WorkerTask | null => {
  ensureStoreLoaded();
  const idx = findTaskIndex(email, taskId);
  if (idx < 0) return null;
  const current = store.tasks[idx];
  let nextTask = current;

  if (patch.taskDescription && sanitizeText(patch.taskDescription) !== current.taskDescription) {
    const interpreted = interpretWorkerTask(patch.taskDescription);
    nextTask = {
      ...nextTask,
      title: interpreted.title,
      taskDescription: sanitizeText(patch.taskDescription),
      structuredInstructions: {
        ...interpreted.instructions,
        preferredExtractor: current.structuredInstructions.preferredExtractor
      },
      schedule: interpreted.instructions.schedule,
      nextRunAt: computeNextRunAt(interpreted.instructions.schedule),
      lastError: undefined
    };
  }

  if (patch.schedule) {
    nextTask = {
      ...nextTask,
      schedule: patch.schedule,
      structuredInstructions: {
        ...nextTask.structuredInstructions,
        schedule: patch.schedule
      },
      nextRunAt: computeNextRunAt(patch.schedule)
    };
  }

  if (patch.status) {
    nextTask = {
      ...nextTask,
      status: patch.status
    };
  }

  nextTask = {
    ...nextTask,
    updatedAt: nowIso()
  };
  store.tasks[idx] = nextTask;
  schedulePersist();
  appendLog(taskId, 'INFO', `Task updated: ${patch.status ? `status ${patch.status.toLowerCase()}` : 'configuration changed'}.`);
  return nextTask;
};

export const deleteWorkerTaskForUser = (email: string, taskId: string): boolean => {
  ensureStoreLoaded();
  const idx = findTaskIndex(email, taskId);
  if (idx < 0) return false;
  store.tasks.splice(idx, 1);
  store.results = store.results.filter((result) => result.taskId !== taskId);
  store.logs = store.logs.filter((log) => log.taskId !== taskId);
  schedulePersist();
  return true;
};

export const runWorkerTaskForUser = async (
  email: string,
  taskId: string,
  trigger: WorkerRunTrigger = 'manual'
): Promise<{ task: WorkerTask; result: WorkerTaskResult }> => {
  ensureStoreLoaded();
  const idx = findTaskIndex(email, taskId);
  if (idx < 0) {
    throw new Error('Task not found.');
  }

  const task = store.tasks[idx];
  if (activeRuns.has(task.id)) {
    throw new Error('This task is already running.');
  }

  activeRuns.add(task.id);
  task.runStatus = 'RUNNING';
  task.updatedAt = nowIso();
  appendLog(task.id, 'INFO', `Run started (${trigger}).`, {
    websiteUrl: task.structuredInstructions.websiteUrl,
    taskType: task.structuredInstructions.taskType
  });

  try {
    const outcome = await executeTaskInstructions(task);
    const executionTimestamp = nowIso();
    task.runCount += 1;
    task.successCount += 1;
    task.runStatus = 'SUCCESS';
    task.lastRunAt = executionTimestamp;
    task.lastSuccessfulRunAt = executionTimestamp;
    task.lastError = undefined;
    task.lastSummary = outcome.summary;
    task.updatedAt = executionTimestamp;
    task.nextRunAt = computeNextRunAt(task.schedule, executionTimestamp);
    task.structuredInstructions.preferredExtractor = outcome.extractor;
    if (outcome.repaired) {
      task.repairCount += 1;
      appendLog(task.id, 'REPAIR', 'Fallback extractor succeeded and the task repaired itself.', {
        newExtractor: outcome.extractor
      });
    }
    appendLog(task.id, 'SUCCESS', outcome.summary, {
      detectedChange: outcome.detectedChange,
      extractor: outcome.extractor
    });
    const result = appendResult(task.id, 'SUCCESS', outcome.summary, outcome.data, outcome.detectedChange);
    trimTaskArtifacts(task.id);
    schedulePersist();
    return { task, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Task execution failed.';
    const executionTimestamp = nowIso();
    task.runCount += 1;
    task.failureCount += 1;
    task.runStatus = 'ERROR';
    task.lastRunAt = executionTimestamp;
    task.lastError = message;
    task.updatedAt = executionTimestamp;
    task.nextRunAt = computeNextRunAt(task.schedule, executionTimestamp);
    appendLog(task.id, 'ERROR', message);
    const result = appendResult(task.id, 'ERROR', message, { error: message }, false);
    trimTaskArtifacts(task.id);
    schedulePersist();
    return { task, result };
  } finally {
    activeRuns.delete(task.id);
  }
};

const runDueTasks = async (): Promise<void> => {
  ensureStoreLoaded();
  const now = Date.now();
  const dueTasks = store.tasks.filter((task) =>
    task.status === 'ACTIVE'
    && task.runStatus !== 'RUNNING'
    && new Date(task.nextRunAt).getTime() <= now
  );

  for (const task of dueTasks) {
    try {
      await runWorkerTaskForUser(task.userEmail, task.id, 'scheduled');
    } catch (error) {
      console.warn('[WORKER_SCHEDULER] Task run failed:', (error as Error).message);
    }
  }
};

export const initWorkerRuntime = (): void => {
  ensureStoreLoaded();
  if (schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    void runDueTasks();
  }, 60_000);
  schedulerTimer.unref();
};

export const shutdownWorkerRuntime = (): void => {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  persistStore();
};
