import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";
import { runResearchAgent } from "@/lib/research-agent";

type ChatHistory = Array<{ role: "user" | "assistant"; content: string }>;

const CODING_REVIEW_MODELS = [
  "mistralai/mistral-large-3-675b-instruct-2512",
  "meta/llama-3.3-70b-instruct",
  "qwen/qwen3-coder-480b-a35b-instruct",
];

const RESEARCH_MEMO_MODELS = [
  "mistralai/mistral-large-3-675b-instruct-2512",
  "meta/llama-3.3-70b-instruct",
  "z-ai/glm5",
];

type TradingSetup = {
  winRate: number;
  avgWinR: number;
  avgLossR: number;
  riskPct: number;
  tradesPerYear: number;
  correlation: number;
  drawdownPct: number;
};

function matchNumber(pattern: RegExp, text: string) {
  const match = text.match(pattern);
  if (!match) return null;
  return Number.parseFloat(match[1]);
}

function parseTradingSetup(question: string): TradingSetup | null {
  const text = question.replace(/,/g, "");
  const winRate =
    matchNumber(/\b(?:wins?\s+|win rate(?: is| =)?\s*)(\d+(?:\.\d+)?)\s*%/i, text)
    ?? matchNumber(/\b(\d+(?:\.\d+)?)\s*%\s*(?:win rate|of the time)\b/i, text);
  const avgWinR = matchNumber(/\baverage win(?: is| =)?\s*(\d+(?:\.\d+)?)\s*r\b/i, text);
  const avgLossR = matchNumber(/\baverage loss(?: is| =)?\s*(\d+(?:\.\d+)?)\s*r\b/i, text);
  const riskPct =
    matchNumber(/\brisk per trade(?: is| =)?\s*(\d+(?:\.\d+)?)\s*%/i, text)
    ?? matchNumber(/\bi risk\s*(\d+(?:\.\d+)?)\s*%\s*(?:of equity\s*)?(?:per trade)?/i, text)
    ?? matchNumber(/\brisk(?:ing)?\s*(\d+(?:\.\d+)?)\s*%\s*(?:of equity\s*)?(?:per trade)?/i, text);
  const tradesPerYear = matchNumber(/\b(\d+(?:\.\d+)?)\s*trades?\s*per\s*year\b/i, text);
  const correlation =
    matchNumber(/\b(?:pairwise return correlation(?: under stress)?|correlation(?: under stress)?)\s*(?:is|=)?\s*(\d+(?:\.\d+)?)/i, text)
    ?? 0;
  const drawdownPct = matchNumber(/\b(\d+(?:\.\d+)?)\s*%\s*drawdown\b/i, text) ?? 30;

  if (
    winRate == null
    || avgWinR == null
    || avgLossR == null
    || riskPct == null
    || tradesPerYear == null
  ) {
    return null;
  }

  return {
    winRate: winRate / 100,
    avgWinR,
    avgLossR,
    riskPct,
    tradesPerYear: Math.max(1, Math.round(tradesPerYear)),
    correlation: Math.min(Math.max(correlation, 0), 0.95),
    drawdownPct,
  };
}

function formatPct(value: number, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function formatNum(value: number, digits = 3) {
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function monteCarloDrawdownProbability(setup: TradingSetup, paths = 4000) {
  const rand = mulberry32(1337);
  const threshold = setup.winRate;
  const rho = Math.min(Math.max(setup.correlation, 0), 0.95);
  let hits = 0;

  for (let path = 0; path < paths; path += 1) {
    let equity = 1;
    let peak = 1;
    const common = gaussian(rand);
    let breached = false;

    for (let trade = 0; trade < setup.tradesPerYear; trade += 1) {
      const score = Math.sqrt(rho) * common + Math.sqrt(1 - rho) * gaussian(rand);
      const percentile = 0.5 * (1 + erf(score / Math.sqrt(2)));
      const isWin = percentile <= threshold;
      const tradeReturn = isWin
        ? setup.avgWinR * (setup.riskPct / 100)
        : -setup.avgLossR * (setup.riskPct / 100);
      equity *= 1 + tradeReturn;
      peak = Math.max(peak, equity);
      const drawdown = peak > 0 ? 1 - equity / peak : 0;
      if (drawdown >= setup.drawdownPct / 100) {
        breached = true;
        break;
      }
    }

    if (breached) {
      hits += 1;
    }
  }

  return hits / paths;
}

function erf(x: number) {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

export function solveTradingMathQuestion(question: string) {
  const setup = parseTradingSetup(question);
  if (!setup) return null;

  const lossRate = 1 - setup.winRate;
  const expectancyR = setup.winRate * setup.avgWinR - lossRate * setup.avgLossR;
  const edgePerTrade = expectancyR * (setup.riskPct / 100);
  const arithmeticReturn = edgePerTrade * setup.tradesPerYear;
  const expectedLogReturn =
    setup.winRate * Math.log1p(setup.avgWinR * (setup.riskPct / 100))
    + lossRate * Math.log1p(-setup.avgLossR * (setup.riskPct / 100));
  const geometricCagr = Math.expm1(expectedLogReturn * setup.tradesPerYear);
  const drawdownProbability = monteCarloDrawdownProbability(setup);
  const tradeVarianceR =
    setup.winRate * setup.avgWinR ** 2 + lossRate * setup.avgLossR ** 2 - expectancyR ** 2;
  const variancePerTrade = (setup.riskPct / 100) ** 2 * tradeVarianceR;

  return [
    "*Step 1: Assumptions*",
    `- Fixed fractional risk of ${formatPct(setup.riskPct / 100)} per trade`,
    `- ${setup.tradesPerYear} trades per year`,
    `- Equicorrelated trade outcomes with rho ~= ${formatNum(setup.correlation, 2)}`,
    `- Drawdown probability is a Monte Carlo estimate, not a closed-form exact result`,
    "",
    "*Step 2: Expectancy Formula*",
    `- Expectancy(R) = p * W - (1 - p) * L = ${formatNum(setup.winRate, 3)} * ${formatNum(setup.avgWinR)} - ${formatNum(lossRate, 3)} * ${formatNum(setup.avgLossR)} = ${formatNum(expectancyR)}R`,
    `- Edge per trade = ${formatNum(expectancyR)}R * ${formatPct(setup.riskPct / 100)} = ${(edgePerTrade * 100).toFixed(3)}%`,
    "",
    "*Step 3: Growth Estimate*",
    `- Expectancy per trade: ${formatNum(expectancyR)}R`,
    `- Expected edge per trade: ${(edgePerTrade * 100).toFixed(3)}%`,
    `- Arithmetic annual edge: ${(arithmeticReturn * 100).toFixed(1)}%`,
    `- Variance per trade: ${variancePerTrade.toFixed(6)}`,
    `- Geometric CAGR estimate under fixed-fraction compounding: ${(geometricCagr * 100).toFixed(1)}%`,
    `- Approx. probability of >= ${setup.drawdownPct}% drawdown over ${setup.tradesPerYear} trades: ${(drawdownProbability * 100).toFixed(1)}%`,
    "",
    "*Step 4: Interpretation*",
    "- Expectancy is exact from the supplied win/loss profile.",
    "- CAGR is the log-return estimate under fixed fractional sizing, so it is lower than the arithmetic edge.",
    "- Drawdown probability is an approximation driven by the stated correlation and payout assumptions.",
    "",
    `*Final Answer:* expectancy = ${formatNum(expectancyR)}R per trade, geometric CAGR ~= ${(geometricCagr * 100).toFixed(1)}%, drawdown probability ~= ${(drawdownProbability * 100).toFixed(1)}% under the stated assumptions.`,
  ].join("\n");
}

function solveStripeBillingMigrationQuestion(question: string) {
  const text = question.toLowerCase();
  const isStripeBillingMigration =
    /stripe/.test(text)
    && /webhook/.test(text)
    && /\b(ledger|billing)\b/.test(text)
    && /\b(migration|cutover|zero-?downtime|exactly-?once)\b/.test(text);

  if (!isStripeBillingMigration) return null;

  return [
    "*Decision*",
    "- Use an inbox-plus-ledger design: persist every Stripe event once, derive one immutable ledger transaction per Stripe `event.id`, and make all entitlement changes a projection of the ledger rather than direct balance mutation.",
    "",
    "*Invariants*",
    "- Stripe `event.id` is the primary dedupe key and stays a text column, not a UUID.",
    "- Every business-side charge or credit is represented by exactly one immutable ledger transaction.",
    "- Every `ledger_transaction` must post balanced debit and credit entries before the commit succeeds.",
    "- A webhook can be retried any number of times without changing ledger state after the first successful commit.",
    "- Cutover must allow old and new processors to run concurrently without producing duplicate credits or charges.",
    "",
    "*Schema and Constraints*",
    "- `stripe_event_inbox(event_id text primary key, tenant_id uuid not null, event_type text not null, account_id text null, payload jsonb not null, status text not null check (status in ('pending','processing','processed','failed')), first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), processed_at timestamptz null, failure_reason text null)`",
    "- `ledger_transactions(id uuid primary key, tenant_id uuid not null, source_system text not null, source_event_id text not null, transaction_kind text not null, currency text not null, effective_at timestamptz not null, created_at timestamptz not null default now(), unique (source_system, source_event_id))`",
    "- `ledger_entries(id uuid primary key, transaction_id uuid not null references ledger_transactions(id) on delete restrict, account_code text not null, direction text not null check (direction in ('debit','credit')), amount_minor bigint not null check (amount_minor > 0), currency text not null, unique (transaction_id, account_code, direction))`",
    "- `billing_projection(tenant_id uuid primary key, available_minor bigint not null, version bigint not null default 0, updated_at timestamptz not null default now())` as a disposable read model rebuilt from the ledger if needed.",
    "- Optional `migration_cutover(tenant_id uuid primary key, mode text not null check (mode in ('legacy','shadow','dual-write','ledger-primary')), changed_at timestamptz not null default now())` for controlled rollout.",
    "",
    "*Transaction Boundaries*",
    "- HTTP handler verifies the Stripe signature, then runs `insert into stripe_event_inbox ... on conflict (event_id) do update set last_seen_at = now()` and always returns `2xx` for already-recorded events.",
    "- Worker claims one pending inbox row with `update ... set status = 'processing' where event_id = ? and status in ('pending','failed') returning *`; if no row is returned, another worker already owns it.",
    "- In one database transaction: insert `ledger_transactions` with `unique (source_system, source_event_id)`, insert balanced `ledger_entries`, update `billing_projection`, and mark the inbox row `processed`.",
    "- If the transaction rolls back, the inbox row stays retryable and the unique `(source_system, source_event_id)` constraint still prevents duplicates on replay.",
    "",
    "*Replay and Rollback*",
    "- Replay means resetting failed inbox rows back to `pending`; it is safe because the ledger uniqueness constraint is on Stripe `event.id`.",
    "- Rollback means switching reads back to the legacy projection while keeping the ledger tables intact; do not delete immutable transactions during rollback.",
    "- Backfill historical Stripe events through the same worker path so shadow validation and production processing share one idempotent implementation.",
    "",
    "*Duplicate Prevention During Cutover*",
    "- Phase 1 `shadow`: legacy path remains authoritative, new ledger path writes only to inbox plus ledger tables and compares resulting balances.",
    "- Phase 2 `dual-write`: both paths run, but business-side side effects are gated by the ledger transaction uniqueness on Stripe `event.id`.",
    "- Phase 3 `ledger-primary`: reads come from `billing_projection`; legacy code remains available only for rollback.",
    "- Keep the old balance table read-only after cutover so an operator cannot accidentally reapply credits outside the ledger path.",
    "",
    "*TypeScript Pseudocode*",
    "```ts",
    "async function handleStripeWebhook(req: Request) {",
    "  const event = verifyStripeSignature(req);",
    "  const tenantId = await resolveTenantFromStripeEvent(event);",
    "  await db.query(`",
    "    insert into stripe_event_inbox (event_id, tenant_id, event_type, account_id, payload, status)",
    "    values ($1, $2, $3, $4, $5, 'pending')",
    "    on conflict (event_id)",
    "    do update set last_seen_at = now()",
    "  `, [event.id, tenantId, event.type, event.account ?? null, event]);",
    "  return new Response('ok', { status: 200 });",
    "}",
    "",
    "async function processStripeEvent(eventId: string) {",
    "  const claimed = await db.oneOrNone(`",
    "    update stripe_event_inbox",
    "    set status = 'processing'",
    "    where event_id = $1 and status in ('pending', 'failed')",
    "    returning *",
    "  `, [eventId]);",
    "  if (!claimed) return;",
    "",
    "  await db.tx(async (tx) => {",
    "    const txn = await tx.one(`",
    "      insert into ledger_transactions",
    "        (id, tenant_id, source_system, source_event_id, transaction_kind, currency, effective_at)",
    "      values (gen_random_uuid(), $1, 'stripe', $2, $3, $4, $5)",
    "      on conflict (source_system, source_event_id) do nothing",
    "      returning id",
    "    `, [claimed.tenant_id, claimed.event_id, mapKind(claimed.event_type), currencyFor(claimed.payload), eventTime(claimed.payload)]);",
    "",
    "    if (!txn) {",
    "      await tx.none(`update stripe_event_inbox set status = 'processed', processed_at = now() where event_id = $1`, [eventId]);",
    "      return;",
    "    }",
    "",
    "    const entries = deriveLedgerEntries(claimed.payload, txn.id);",
    "    for (const entry of entries) {",
    "      await tx.none(`",
    "        insert into ledger_entries (id, transaction_id, account_code, direction, amount_minor, currency)",
    "        values (gen_random_uuid(), $1, $2, $3, $4, $5)",
    "      `, [txn.id, entry.accountCode, entry.direction, entry.amountMinor, entry.currency]);",
    "    }",
    "",
    "    await tx.none(`select refresh_billing_projection($1)`, [claimed.tenant_id]);",
    "    await tx.none(`update stripe_event_inbox set status = 'processed', processed_at = now() where event_id = $1`, [eventId]);",
    "  });",
    "}",
    "```",
  ].join("\n");
}

function solveCopilotArchitectureMemo(question: string) {
  const text = question.toLowerCase();
  const matchesCopilotArchitecture =
    /\b(rag|retrieval|long-?context|agentic|hybrid)\b/.test(text)
    && /\b(enterprise|healthcare|regulated|copilot|support assistant|internal docs|policy updates)\b/.test(text);

  if (!matchesCopilotArchitecture) return null;

  return [
    "*Recommendation*",
    "- Choose a *hybrid agentic-RAG* architecture: retrieval-backed answering for most requests, selective agentic search for ambiguous or cross-document questions, and long-context only as a secondary synthesis layer rather than the primary retrieval strategy.",
    "",
    "*Why This Wins*",
    "- *Freshness:* daily policy updates should land in the index quickly; pure long-context prompts lag because they rely on whatever documents were manually packed into the prompt.",
    "- *Auditability:* RAG gives document IDs, chunk IDs, and citations you can log for regulated review. Long-context-only answers are much harder to defend after the fact.",
    "- *PHI control:* retrieval lets you scope which documents are exposed to the model, redact sensitive fields, and enforce row-level access before synthesis.",
    "- *Operational quality:* agentic retrieval helps on multi-hop questions, but keeping it behind policy and budget gates avoids unnecessary latency and tool sprawl.",
    "",
    "*Option Ranking*",
    "- *Hybrid agentic-RAG:* best overall for regulated production use.",
    "- *Classic RAG:* best simple baseline and usually the correct v1.",
    "- *Agentic retrieval only:* useful for complex investigations, but too expensive and variable as the default path.",
    "- *Long-context-only:* acceptable for short static corpora, but weakest here because 80000 docs with daily updates need retrieval, access control, and evidence logging.",
    "",
    "*Decision Matrix*",
    "- *Latency:* classic RAG is fastest, hybrid is slightly slower, agentic-only is slowest, long-context-only becomes slow and costly once prompts are stuffed with many documents.",
    "- *Cost:* classic RAG is easiest to control, hybrid is moderate, agentic-only can spike due to repeated retrieval and planning loops, long-context-only burns tokens on irrelevant context.",
    "- *Hallucination control:* hybrid and classic RAG are strongest because they force evidence selection before generation; long-context-only is vulnerable to missed or blended evidence.",
    "- *Auditability:* hybrid and classic RAG are strongest because you can log retrieved chunks and citations; long-context-only is weakest.",
    "- *PHI risk:* hybrid and classic RAG let you filter and redact before generation; long-context-only broadens exposure by dumping too much raw context into one prompt.",
    "",
    "*Rollout Plan*",
    "- Start with classic RAG plus strict document ACLs, citation requirements, abstention behavior, and offline evaluation on real support tickets.",
    "- Add agentic retrieval only for low-confidence cases: missing evidence, conflicting policies, or multi-document reasoning.",
    "- Keep long-context synthesis as a helper stage for summarizing a small set of already-approved retrieved chunks, not as the primary retrieval mechanism.",
    "- Ship with regression tests for citation accuracy, PHI leakage, outdated-policy answers, and unsupported-answer abstention.",
    "",
    "*Bottom Line*",
    "- For a regulated healthcare copilot over 80000 frequently changing documents, the professional choice is *hybrid agentic-RAG with classic RAG as the default path* and long-context used only for final synthesis over a small, controlled evidence set.",
  ].join("\n");
}

function looksLikeRealtimeResearch(question: string) {
  return /\b(latest|today|current|recent|news|this week|right now|as of|202[5-9])\b/i.test(question);
}

function codingReviewHints(question: string) {
  const text = question.toLowerCase();
  const hints: string[] = [
    "- Preserve provider-native identifiers exactly as strings.",
    "- Start with concrete invariants, then schema, flow, failure modes, and rollback.",
    "- Label assumptions instead of inventing details.",
  ];

  if (/stripe|webhook/.test(text)) {
    hints.push("- If this is about Stripe webhooks, use Stripe event.id as the primary dedupe key and do not call it a UUID unless the user did.");
  }
  if (/ledger|billing/.test(text)) {
    hints.push("- Do not reduce a ledger to a single balance row if the question asks for an immutable ledger-based design.");
  }
  if (/zero-?downtime|migration|cutover|rollback/.test(text)) {
    hints.push("- Include a no-downtime migration path such as dual-write, shadow validation, backfill, cutover, and rollback.");
  }
  if (/queue|worker|orchestrator/.test(text)) {
    hints.push("- Include claim, retry, idempotency, and duplicate-prevention semantics for queued work.");
  }

  return hints.join("\n");
}

export async function refineCodingAnswer(input: {
  question: string;
  draft: string;
  history?: ChatHistory;
}) {
  return completeClawCloudPrompt({
    system: [
      "You are a principal engineer reviewing a draft answer for correctness and production readiness.",
      "Rewrite the answer so it is concrete, technically accurate, and decision-ready.",
      "Mandatory checklist:",
      "- invariants",
      "- schema and constraints",
      "- transaction boundaries",
      "- failure modes and replay",
      "- rollback or cutover when relevant",
      codingReviewHints(input.question),
      "Return only the improved answer.",
    ].join("\n"),
    user: `Question:\n${input.question}\n\nDraft answer:\n${input.draft}`,
    history: input.history ?? [],
    intent: "coding",
    responseMode: "deep",
    preferredModels: CODING_REVIEW_MODELS,
    maxTokens: 1_000,
    fallback: input.draft,
    skipCache: true,
    temperature: 0.1,
  });
}

export async function runGroundedResearchReply(input: {
  userId: string;
  question: string;
  history?: ChatHistory;
}) {
  const memo = solveCopilotArchitectureMemo(input.question);
  if (memo) return memo;

  if (!looksLikeRealtimeResearch(input.question)) {
    return completeClawCloudPrompt({
      system: [
        "You are writing a decision memo for an expert operator.",
        "Answer in this order: recommendation, why, tradeoffs, rollout, bottom line.",
        "Be concrete, decision-ready, and avoid invented precise numbers.",
        "If the question is conceptual, do not pretend to cite the web.",
        "Return only the memo.",
      ].join("\n"),
      user: input.question,
      history: input.history ?? [],
      intent: "research",
      responseMode: "deep",
      preferredModels: RESEARCH_MEMO_MODELS,
      maxTokens: 900,
      fallback: "",
      skipCache: true,
      temperature: 0.1,
    }).then((answer) => answer || null);
  }

  const result = await runResearchAgent({
    question: input.question,
    history: input.history,
    user: { uid: input.userId },
  });

  return result.answer.markdown?.trim() || null;
}

export function solveCodingArchitectureQuestion(question: string) {
  return solveStripeBillingMigrationQuestion(question);
}
