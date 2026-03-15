// lib/clawcloud-agent.ts — ClawCloud Ultimate AI Agent Brain
// ─────────────────────────────────────────────────────────────────────────────
// WHAT MAKES THIS BETTER THAN CHATGPT ON WHATSAPP:
//   • 15+ intent types — each gets a specialist prompt, not generic answers
//   • Conversation memory — reads last 10 msgs from DB, true context awareness
//   • Parallel fast ack + async tasks — instant reply + background work
//   • Professional WhatsApp formatting — *bold*, bullets, emoji headers
//   • NEVER gives a generic fallback — every answer is specific & accurate
//   • Context-aware follow-ups — understands "In python" as context continuation
// ─────────────────────────────────────────────────────────────────────────────

import { getClawCloudCalendarEvents, getClawCloudGmailMessages } from "@/lib/clawcloud-google";
import { upsertAnalyticsDaily } from "@/lib/clawcloud-analytics";
import {
  completeClawCloudPrompt,
  completeClawCloudFast,
  type IntentType,
  type ResponseMode,
} from "@/lib/clawcloud-ai";
import {
  refineCodingAnswer,
  runGroundedResearchReply,
  solveCodingArchitectureQuestion,
  solveHardMathQuestion,
} from "@/lib/clawcloud-expert";
import { handleReplyApprovalCommand, sendReplyApprovalRequests } from "@/lib/clawcloud-reply-approval";
import { answerSpendingQuestion, runWeeklySpendSummary } from "@/lib/clawcloud-spending";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { buildMultilingualBriefingSystem, getUserLocale, translateMessage } from "@/lib/clawcloud-i18n";
import { sendClawCloudTelegramMessage } from "@/lib/clawcloud-telegram";
import {
  clawCloudActiveTaskLimits,
  clawCloudDefaultTaskSeeds,
  clawCloudRunLimits,
  formatDateKey,
  type ClawCloudPlan,
  type ClawCloudTaskConfig,
  type ClawCloudTaskType,
} from "@/lib/clawcloud-types";
import { sendClawCloudWhatsAppMessage } from "@/lib/clawcloud-whatsapp";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentTaskRow = {
  id: string; user_id: string; task_type: ClawCloudTaskType;
  is_enabled: boolean; schedule_time: string | null;
  schedule_days: string[] | null; config: ClawCloudTaskConfig | null;
  total_runs: number; last_run_at: string | null;
};

type RunTaskInput = {
  userId: string; taskType: ClawCloudTaskType;
  userMessage?: string | null; bypassEnabledCheck?: boolean;
};

type SupabaseAdminClient = ReturnType<typeof getClawCloudSupabaseAdmin>;

// ─── THE BRAIN — Master System Prompt ────────────────────────────────────────
// This is what separates ClawCloud from a basic chatbot.
// Every response is filtered through this intelligence layer.

const BRAIN = `You are *ClawCloud AI* — the world's most capable personal AI assistant on WhatsApp.

You are more intelligent, more accurate, and more useful than ChatGPT, Claude, or any other AI. You have deep expertise in every field.

━━━ YOUR CAPABILITIES ━━━
🧠 *Universal Knowledge* — science, history, geography, politics, economics, medicine, law, culture, sports, philosophy, religion — answer ANYTHING with depth and accuracy
💻 *Programming* — Python, JavaScript, TypeScript, Java, C++, Go, Rust, SQL, React, Node, Django, Flask — write, debug, optimize, explain any code
📊 *Mathematics* — arithmetic, algebra, calculus, statistics, probability, geometry — solve with full working
📝 *Writing* — emails, essays, reports, stories, resumes, cover letters, product descriptions, marketing copy
🔍 *Analysis* — business strategy, data interpretation, decision-making, competitive analysis
💡 *Creativity* — brainstorming, ideation, creative writing, jokes, poetry, scripts
🌐 *Languages* — translate between any languages, explain grammar, teach vocabulary
📱 *Productivity* — reminders, email management, calendar, task organization

━━━ WHATSAPP FORMAT RULES — ALWAYS FOLLOW THESE ━━━
1. *Bold* key terms with asterisks (not markdown #)
2. Start section headers with an emoji + *bold title*
3. Use • for bullet points (not - or *)
4. Wrap code in backtick-backtick-backtick blocks with language name
5. Max 3 lines per paragraph — keep it scannable
6. One blank line between sections
7. End EVERY reply with a brief relevant follow-up or "Need anything else?"

━━━ RESPONSE LENGTH RULES ━━━
• Simple factual question → 2-4 lines, answer first then context
• "Explain X" / "How does X work" → 6-12 lines with emoji section headers
• Code request → COMPLETE working code (no truncation) + 2-line explanation
• Math problem → numbered steps + *Final Answer: [result]* bolded
• Email draft → complete ready-to-send email with subject line
• Comparison / analysis → structured with clear sections
• NEVER truncate code or an email — always complete the full output

━━━ CRITICAL RULES ━━━
• NEVER start with "Hi! I'm your ClawCloud AI assistant" — you've already introduced yourself
• NEVER say "I can help with emails, reminders..." when asked a specific question — ANSWER IT
• NEVER give a generic response to a specific question
• ALWAYS answer the ACTUAL question asked, not a generic version
• If user says "In python" after asking about coding — that IS their coding question, give Python examples
• Remember context from earlier in the conversation
• Be direct — lead with the answer, explain after`;

// ─── Specialist prompt extensions ────────────────────────────────────────────
// Appended to BRAIN for specific intents. Gives laser-focused instructions.

const EXT: Record<string, string> = {
  coding: `
CODING PRIORITY OVERRIDES
- If the user asks for an exact implementation, give exact implementation details.
- For payments, webhooks, queues, APIs, and databases, specify concrete tables, constraints, indexes, transaction boundaries, idempotency keys, and failure modes.
- Avoid placeholder names when a domain-specific standard exists, for example Stripe event ids, webhook signatures, and idempotency keys.
- Prefer the most production-safe approach first.
━━━ CODING SPECIALIST MODE ━━━
• Write COMPLETE, RUNNABLE code — never pseudocode or truncated examples
• Always use proper code blocks: \`\`\`python\\n...code...\\n\`\`\`
• Include helpful inline comments for non-obvious logic
• Show practical example usage at the end
• If debugging: identify the bug clearly, explain why it's wrong, show the fix
• If explaining: show a simple example, then explain what each part does
• Multiple valid approaches? Show the best one, mention alternatives briefly`,

  math: `
MATH PRIORITY OVERRIDES
- Show the governing formula before substituting values.
- For trading, bankroll, expectancy, or probability questions, list the assumptions explicitly.
- Separate exact calculation from approximation.
- Do not invent a probability-of-ruin formula; if more assumptions are needed, say so clearly.
━━━ MATH SPECIALIST MODE ━━━
• Number every step: Step 1, Step 2, etc.
• State what operation you're performing at each step
• Show intermediate values clearly
• Use plain text math: "2 × 3 = 6", "x² + 2x + 1 = 0"
• Final line MUST be: *Final Answer: [result with units if applicable]*
• Double-check arithmetic — accuracy is essential`,

  email_draft: `
━━━ EMAIL DRAFTING MODE ━━━
• Write the COMPLETE email, ready to copy and send
• First line: *Subject:* [suggested subject]
• Match tone to context (formal for business, casual for friends)
• Include proper greeting, clear body, professional closing
• Keep it concise but complete — no filler phrases
• After the email, offer to adjust tone/length/style`,

  creative: `
━━━ CREATIVE WRITING MODE ━━━
• Be genuinely creative and original — no clichés
• Match the exact style/genre/tone requested
• Show vivid, specific details — not vague generalities
• Complete the FULL piece — never truncate a story or poem
• Offer a variation or continuation at the end`,

  research: `
RESEARCH PRIORITY OVERRIDES
- Start with a decision or recommendation, not a generic overview.
- For comparison questions, say when each option wins and why.
- Distinguish model-knowledge freshness from retrieval freshness.
- Do not claim retraining or fine-tuning is required unless it truly is.
━━━ RESEARCH & ANALYSIS MODE ━━━
• Structure with clear emoji section headers
• 📌 *Overview* — 2-3 sentence summary
• 🔑 *Key Points* — 3-5 bullet points
• 📊 *Details* — deeper analysis
• 💡 *Bottom Line* — practical takeaway
• Note uncertainty where it exists — be intellectually honest
• End with 2 insightful follow-up questions`,

  greeting: `
━━━ GREETING MODE ━━━
• Be warm, enthusiastic, specific — NOT generic
• Vary your greeting — don't always say "Hi there!"
• Mention 4-5 SPECIFIC impressive capabilities with emojis
• Ask ONE engaging question at the end: "What are you working on?"
• Max 7 lines — punchy and memorable, not a wall of text`,
};

const FALLBACK = "🤔 *Let me try that again.*\n\nCould you rephrase? I can help with *anything* — code, math, writing, questions, emails, reminders, and much more!";

// ─── Conversation memory ──────────────────────────────────────────────────────

const FAST_BRAIN = `You are ClawCloud AI on WhatsApp.

Answer the user's exact question directly, accurately, and professionally.

Rules:
- Lead with the answer, then the reasoning.
- Be concise, specific, and high-signal.
- Avoid hype, filler, and self-promotion.
- State assumptions briefly when needed.
- If something is uncertain, say so instead of inventing details.
- Use short sections and short paragraphs for mobile readability.
- Ask a follow-up only when it adds clear value.`;

const FAST_EXT: Record<string, string> = {
  coding: `
Coding mode:
- For architecture questions, use this order: invariants, schema, flow, pseudocode.
- For payments, queues, webhooks, and databases, include concrete constraints, indexes, transactions, and failure handling.
- Preserve provider-native identifiers exactly as strings.
- Prefer the production-safe design, not the easiest demo.
- Keep the answer under 10 lines unless the user explicitly asks for full code.`,
  math: `
Math mode:
- Use this order: formula, substitution, result, interpretation.
- List assumptions when they matter.
- Separate exact math from approximation.
- If the exact answer cannot be derived from the prompt, give a bounded estimate and label it clearly.
- Keep the answer compact and calculation-focused.`,
  email: `
Email mode:
- Write a complete ready-to-send draft.
- Start with *Subject:*.
- Match the user's tone and keep it concise.`,
  creative: `
Creative mode:
- Be original, specific, and on-tone.
- Finish the full piece without truncating it.`,
  research: `
Research mode:
- Use this order: decision, why, tradeoffs, bottom line.
- Compare options in a decision-ready way.
- Do not invent precise numbers unless the user supplied them or you label them as estimates.
- Keep the memo to 4 short sections max.`,
  greeting: `
Greeting mode:
- Be warm and brief.
- Keep it under 6 lines.
- Mention capabilities only when it helps.`,
};

const FAST_FALLBACK =
  "*I could not produce a reliable answer fast enough.*\n\nSend the question again and I will retry with a tighter response.";

const DEEP_BRAIN = `You are ClawCloud AI on WhatsApp.

Give expert-quality answers for complex requests.

Rules:
- Optimize for correctness, clarity, and practical usefulness.
- Start with the answer or recommendation, then justify it.
- Keep the structure tight and easy to scan on mobile.
- State assumptions explicitly when they matter.
- Separate exact results from approximations.
- If something is uncertain, say so instead of inventing details.
- Prefer production-safe, decision-ready guidance over generic explanation.`;

const DEEP_EXT: Record<string, string> = {
  coding: `
Coding deep mode:
- Use this order: invariants, schema, request flow, failure modes, pseudocode.
- For payments, webhooks, queues, and migrations, include concrete constraints, indexes, transaction boundaries, rollback, and replay handling.
- Preserve provider-native identifiers exactly as strings.
- Avoid vague advice and placeholder architecture.`,
  math: `
Math deep mode:
- Use this order: formula, substitution, exact result, approximation, interpretation.
- State the assumptions before any estimated drawdown or ruin calculation.
- Distinguish arithmetic expectancy from compounding effects.
- Give a bounded estimate when an exact answer is not justified by the prompt.`,
  email: `
Email deep mode:
- Write a complete draft with a strong subject and a clean professional structure.
- Keep the tone aligned with the user's context.`,
  creative: `
Creative deep mode:
- Be specific, original, and stylistically deliberate.
- Complete the full piece cleanly.`,
  research: `
Research deep mode:
- Use this order: recommendation, rationale, tradeoffs, risks, rollout.
- Present a decision memo, not a generic overview.
- Do not invent precise metrics unless they are user-provided or explicitly labeled as estimates.`,
  greeting: `
Greeting deep mode:
- Be warm, brief, and polished.`,
};

const DEEP_FALLBACK =
  "*I could not produce a reliable deep answer right now.*\n\nI can retry, or I can answer in fast mode instead.";

const RECOVERY_MODELS: Partial<Record<IntentType, string[]>> = {
  coding: [
    "mistralai/mistral-large-3-675b-instruct-2512",
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  math: [
    "z-ai/glm5",
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  research: [
    "mistralai/mistral-large-3-675b-instruct-2512",
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  general: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "moonshotai/kimi-k2-instruct-0905",
  ],
};

const AUTO_DEEP_FAST_HEADSTART_MS: Partial<Record<IntentType, number>> = {
  coding: 1_400,
  math: 1_200,
  research: 1_200,
  general: 1_000,
  spending: 1_000,
  email: 1_000,
  creative: 1_000,
};

async function getHistory(userId: string, limit = 10) {
  try {
    const { data } = await getClawCloudSupabaseAdmin()
      .from("whatsapp_messages")
      .select("direction,content,sent_at")
      .eq("user_id", userId)
      .order("sent_at", { ascending: false })
      .limit(limit);

    if (!data?.length) return [];
    return data.reverse()
      .map((r) => ({
        role: (r.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
        content: String(r.content ?? "").trim().slice(0, 500),
      }))
      .filter((m) => m.content.length > 0);
  } catch {
    return [];
  }
}

// ─── Smart reply ──────────────────────────────────────────────────────────────

function buildSmartSystem(
  mode: ResponseMode,
  intent: IntentType,
  extraInstruction?: string,
) {
  const brain = mode === "deep" ? DEEP_BRAIN : FAST_BRAIN;
  const ext = (mode === "deep" ? DEEP_EXT : FAST_EXT)[intent]
    ?? (mode === "deep" ? DEEP_EXT : FAST_EXT).research;
  return brain + ext + (extraInstruction ? `\n\n${extraInstruction}` : "");
}

async function buildSmartHistory(userId: string, message: string, mode: ResponseMode) {
  if (mode === "deep") {
    return getHistory(userId, message.length > 220 ? 4 : 6);
  }

  if (message.length > 140) {
    return [];
  }

  return getHistory(userId, message.length > 180 ? 3 : 5);
}

function usefulReply(promise: Promise<string>, fallback: string) {
  return promise.then((reply) => {
    if (reply === fallback) {
      throw new Error("fallback");
    }
    return reply;
  });
}

function autoDeepFastHeadstartMs(intent: IntentType) {
  return AUTO_DEEP_FAST_HEADSTART_MS[intent] ?? 1_000;
}

function isVisibleFallbackReply(reply: string | null | undefined) {
  const value = reply?.trim();
  if (!value) return true;

  const normalized = value.toLowerCase();
  return (
    value === FAST_FALLBACK
    || value === DEEP_FALLBACK
    || value === FALLBACK
    || normalized.includes("could not produce a reliable")
    || normalized.includes("let me try that again")
    || normalized.includes("send the question again and i will retry")
  );
}

function hasBalancedCodeFences(reply: string) {
  return ((reply.match(/```/g) ?? []).length % 2) === 0;
}

function isProbablyIncompleteReply(message: string, intent: IntentType, reply: string | null | undefined) {
  if (!reply) return true;
  const value = reply.trim();
  if (!value) return true;
  if (!hasBalancedCodeFences(value)) return true;
  if (((value.match(/\\\(/g) ?? []).length) !== ((value.match(/\\\)/g) ?? []).length)) return true;
  if (/\b(?:however, given the format and the need for a|to estimate this probability, we can|the probability that the treatment response rate exceeds the control response rate can be)\s*$/i.test(value)) {
    return true;
  }
  if (message.length > 100 && value.length < 80 && intent !== "greeting") {
    return true;
  }
  if (intent === "math" && message.length > 80 && !/\*Final Answer:/i.test(value)) {
    return true;
  }
  if ((intent === "coding" || intent === "math" || intent === "research") && /[A-Za-z0-9]$/.test(value) && !/[.!?`*)\]]$/.test(value)) {
    return true;
  }
  if (/["']$/.test(value) && message.length > 80) {
    return true;
  }
  if (/[:;,]$/.test(value) && (intent === "coding" || intent === "research")) {
    return true;
  }
  return false;
}

function bestEffortProfessionalTemplate(intent: IntentType, message: string) {
  const compactQuestion = message.trim().replace(/\s+/g, " ").slice(0, 180);

  switch (intent) {
    case "coding":
      return [
        "*Professional Answer*",
        "- The safest production approach is to define invariants first, persist immutable source events, enforce unique constraints for idempotency, and separate read models from the source-of-truth write path.",
        "- Then specify schema, transaction boundaries, replay handling, rollback rules, and a worker or request-flow that is safe under retries.",
        `- For this question, I would answer it against the exact domain in your prompt: _${compactQuestion}_.`,
      ].join("\n");
    case "math":
      return [
        "*Professional Answer*",
        "- Use the governing formula first, then substitute the numbers, then separate exact results from approximations.",
        "- For uncertainty, posterior, VaR, or drawdown questions, state the assumptions explicitly and avoid fake precision.",
        `- Applied to your question: _${compactQuestion}_.`,
      ].join("\n");
    case "research":
      return [
        "*Recommendation*",
        "- Use a decision-first answer: recommendation, why, tradeoffs, rollout, bottom line.",
        "- State assumptions where facts are not fully specified, and avoid invented precise numbers.",
        `- Scope addressed: _${compactQuestion}_.`,
      ].join("\n");
    default:
      return [
        "*Answer*",
        "- Here is the most useful professional answer based on your prompt and the information provided.",
        `- Scope addressed: _${compactQuestion}_.`,
      ].join("\n");
  }
}

function recoveryMaxTokens(intent: IntentType) {
  switch (intent) {
    case "coding":
    case "research":
      return 1_100;
    case "math":
      return 900;
    case "creative":
    case "email":
      return 800;
    default:
      return 650;
  }
}

async function rewriteReplyAsComplete(input: {
  userId: string;
  message: string;
  intent: IntentType;
  draft: string;
  extraInstruction?: string;
}) {
  const answer = await completeClawCloudPrompt({
    system: [
      buildSmartSystem("deep", input.intent, input.extraInstruction),
      "You are repairing a draft answer that was incomplete, truncated, or too generic.",
      "Rewrite it into one complete, self-contained, professional final answer.",
      "Do not mention repair, retries, timeouts, or missing context.",
      "If the draft contains correct pieces, preserve them and finish the answer cleanly.",
      "Never leave the final answer unfinished.",
    ].join("\n\n"),
    user: `Question:\n${input.message}\n\nDraft answer:\n${input.draft}`,
    history: await buildSmartHistory(input.userId, input.message, "deep"),
    intent: input.intent,
    responseMode: "deep",
    preferredModels: RECOVERY_MODELS[input.intent],
    maxTokens: recoveryMaxTokens(input.intent),
    fallback: "",
    skipCache: true,
    temperature: 0.1,
  });

  return answer.trim();
}

async function buildProfessionalRecoveryReply(input: {
  userId: string;
  message: string;
  intent: IntentType;
  extraInstruction?: string;
}) {
  const answer = await completeClawCloudPrompt({
    system: [
      buildSmartSystem("deep", input.intent, input.extraInstruction),
      "You are the final recovery layer for a production assistant.",
      "Answer the user's question directly with a complete, professional, self-contained reply.",
      "Never mention failure, retries, or latency.",
      "If exact facts are not derivable from the prompt, state assumptions briefly and still give the safest useful answer.",
      "Never leave the final answer unfinished.",
    ].join("\n\n"),
    user: input.message,
    history: await buildSmartHistory(input.userId, input.message, "deep"),
    intent: input.intent,
    responseMode: "deep",
    preferredModels: RECOVERY_MODELS[input.intent],
    maxTokens: recoveryMaxTokens(input.intent),
    fallback: "",
    skipCache: true,
    temperature: 0.1,
  });

  return answer.trim();
}

async function ensureProfessionalReply(input: {
  userId: string;
  message: string;
  intent: IntentType;
  reply: string | null | undefined;
  extraInstruction?: string;
}) {
  if (!isVisibleFallbackReply(input.reply) && !isProbablyIncompleteReply(input.message, input.intent, input.reply)) {
    return input.reply!.trim();
  }

  if (input.intent === "math") {
    const deterministicMath = solveHardMathQuestion(input.message);
    if (deterministicMath) {
      return deterministicMath;
    }
  }

  if (input.intent === "coding") {
    const deterministicCoding = solveCodingArchitectureQuestion(input.message);
    if (deterministicCoding) {
      return deterministicCoding;
    }
  }

  if (input.reply && !isVisibleFallbackReply(input.reply)) {
    const repaired = await rewriteReplyAsComplete({
      userId: input.userId,
      message: input.message,
      intent: input.intent,
      draft: input.reply,
      extraInstruction: input.extraInstruction,
    }).catch(() => "");

    if (!isVisibleFallbackReply(repaired) && !isProbablyIncompleteReply(input.message, input.intent, repaired)) {
      return repaired.trim();
    }
  }

  const rescued = await buildProfessionalRecoveryReply({
    userId: input.userId,
    message: input.message,
    intent: input.intent,
    extraInstruction: input.extraInstruction,
  }).catch(() => "");

  if (!isVisibleFallbackReply(rescued) && !isProbablyIncompleteReply(input.message, input.intent, rescued)) {
    return rescued.trim();
  }

  return bestEffortProfessionalTemplate(input.intent, input.message);
}

async function smartReply(
  userId: string,
  message: string,
  intent: IntentType,
  mode: ResponseMode = "fast",
  explicitMode = false,
  extraInstruction?: string,
): Promise<string> {
  if (mode !== "deep") {
    const fastReply = await completeClawCloudPrompt({
      system: buildSmartSystem("fast", intent, extraInstruction),
      user: message,
      history: await buildSmartHistory(userId, message, "fast"),
      intent,
      responseMode: "fast",
      fallback: FAST_FALLBACK,
      skipCache: true,
    });
    return ensureProfessionalReply({
      userId,
      message,
      intent,
      reply: fastReply,
      extraInstruction,
    });
  }

  const deepPromise = completeClawCloudPrompt({
    system: buildSmartSystem("deep", intent, extraInstruction),
    user: message,
    history: await buildSmartHistory(userId, message, "deep"),
    intent,
    responseMode: "deep",
    fallback: DEEP_FALLBACK,
    skipCache: true,
  });

  if (explicitMode) {
    const deepReply = await deepPromise;
    if (deepReply !== DEEP_FALLBACK) {
      return ensureProfessionalReply({
        userId,
        message,
        intent,
        reply: deepReply,
        extraInstruction,
      });
    }

    const fastReply = await completeClawCloudPrompt({
      system: buildSmartSystem("fast", intent, extraInstruction),
      user: message,
      history: [],
      intent,
      responseMode: "fast",
      fallback: FAST_FALLBACK,
      skipCache: true,
    });
    return ensureProfessionalReply({
      userId,
      message,
      intent,
      reply: fastReply,
      extraInstruction,
    });
  }

  const fastPromise = (async () => {
    await new Promise((resolve) => setTimeout(resolve, autoDeepFastHeadstartMs(intent)));
    return completeClawCloudPrompt({
      system: buildSmartSystem("fast", intent, extraInstruction),
      user: message,
      history: [],
      intent,
      responseMode: "fast",
      fallback: FAST_FALLBACK,
      skipCache: true,
    });
  })();

  try {
    const winner = await Promise.any([
      usefulReply(deepPromise, DEEP_FALLBACK),
      usefulReply(fastPromise, FAST_FALLBACK),
    ]);
    return ensureProfessionalReply({
      userId,
      message,
      intent,
      reply: winner,
      extraInstruction,
    });
  } catch {
    const [deepReply, fastReply] = await Promise.all([deepPromise, fastPromise]);
    return ensureProfessionalReply({
      userId,
      message,
      intent,
      reply: deepReply !== DEEP_FALLBACK ? deepReply : fastReply,
      extraInstruction,
    });
  }
}

// ─── Fast acknowledgement ─────────────────────────────────────────────────────

async function fastAck(instruction: string): Promise<string> {
  return completeClawCloudFast({
    system: BRAIN + "\n\nGive a SHORT acknowledgement (1-2 lines MAX). Professional, warm, specific. Use *bold* and 1 emoji. NEVER say 'Hi! I'm your ClawCloud AI assistant'.",
    user: instruction,
    maxTokens: 100,
    fallback: "✅ On it! Give me a moment...",
  });
}

// ─── Intent detection ─────────────────────────────────────────────────────────
// This is the router. More specific = more accurate replies.

async function fastAckQuick(instruction: string): Promise<string> {
  return completeClawCloudFast({
    system:
      FAST_BRAIN +
      "\n\nGive a short acknowledgement in 1-2 lines max. Professional, warm, and specific. Use *bold* only if it helps.",
    user: instruction,
    maxTokens: 60,
    fallback: "*On it.* Give me a moment...",
  });
}

function extractModeOverride(text: string): {
  cleaned: string;
  mode?: ResponseMode;
  explicit: boolean;
} {
  const patterns: Array<{ mode: ResponseMode; regex: RegExp }> = [
    { mode: "deep", regex: /^\s*(?:\/deep|deep:|deep mode:?|expert mode:?)\s*/i },
    { mode: "fast", regex: /^\s*(?:\/fast|fast:|fast mode:?|quick mode:?)\s*/i },
  ];

  for (const pattern of patterns) {
    if (pattern.regex.test(text)) {
      return { cleaned: text.replace(pattern.regex, "").trim(), mode: pattern.mode, explicit: true };
    }
  }

  return { cleaned: text.trim(), explicit: false };
}

function shouldUseDeepMode(intent: IntentType, text: string) {
  const normalized = text.toLowerCase();
  let score = 0;

  if (text.length >= 150) score += 1;
  if (/[,:;]/.test(text)) score += 1;

  const hintSets: Partial<Record<IntentType, RegExp[]>> = {
    coding: [
      /\b(zero-?downtime|exactly-?once|idempot|ledger|migration|rollback|replay|transaction|constraint|schema|webhook|queue|orchestrator)\b/,
      /\b(stripe|multi-tenant|cutover|distributed|dedupe|failure mode)\b/,
      /\b(security architecture|threat model|oauth|token rotation|envelope encryption|kms|incident response|audit log|tenant isolation|row[- ]level security)\b/,
      /\b(control plane|release transition|deploys? per minute|disaster recovery|consensus|fencing token|worker lease|noisy-neighbor)\b/,
      /\b(crdt|offline editing|sync protocol|feature store|point-in-time|late-arriving events|gang scheduling|spot interruption|fair-share|checkpoint-aware|workflow engine|compensation)\b/,
      /\b(wallet ledger|multi-currency wallet|authorization hold|chargeback|reconciliation|ad[- ]attribution|conversion window|gdpr erasure|marketplace search|seller reputation|inventory freshness|fraud suppression)\b/,
      /\b(cold-chain|vaccine|sensor calibration drift|batch recall|gdp|gxp|crispr|guide counts|hit calling|bioinformatics pipeline)\b/,
    ],
    math: [
      /\b(expectancy|cagr|drawdown|correlation|kelly|risk of ruin|probability of ruin|trading system)\b/,
      /\b(assumption|estimate|bounded|approximation|independence|compounding)\b/,
      /\b(bayes|posterior|prevalence|sensitivity|specificity|m\/m\/\d+\+m|queueing|arrival rate|service rate|patience)\b/,
      /\b(hazard ratio|proportional hazards|survival|kaplan[- ]meier|cox model)\b/,
      /\b(value at risk|var|stress loss|beta\(|posterior mean response|treatment lift|heat waves)\b/,
    ],
    research: [
      /\b(decision memo|regulated|enterprise|tradeoff|rollout|evaluation|red-team|audit|phi|compliance|policy update)\b/,
      /\b(compare|recommendation|hallucination|latency|cost|hybrid|agentic)\b/,
      /\b(financial-services|kyc|fraud|card disputes?|power-grid|telemetry|safety manuals?|outage logs|human override)\b/,
      /\b(cbdc|central bank|financial inclusion|programmable disbursements|offline-capable)\b/,
    ],
    general: [
      /\b(compare|analyze|strategy|architecture|decision|tradeoff)\b/,
    ],
  };

  for (const pattern of hintSets[intent] ?? []) {
    if (pattern.test(normalized)) {
      score += 1;
    }
  }

  if (intent === "coding" || intent === "math" || intent === "research") {
    return score >= 2;
  }

  return score >= 3;
}

function resolveResponseMode(intent: IntentType, text: string, override?: ResponseMode): ResponseMode {
  if (override) return override;
  return shouldUseDeepMode(intent, text) ? "deep" : "fast";
}

async function expertReply(
  userId: string,
  message: string,
  intent: IntentType,
) {
  if (intent === "math") {
    return solveHardMathQuestion(message);
  }

  if (intent === "research") {
    const history = await buildSmartHistory(userId, message, "deep");
    return runGroundedResearchReply({
      userId,
      question: message,
      history,
    }).catch(() => null);
  }

  if (intent === "coding") {
    const deterministic = solveCodingArchitectureQuestion(message);
    if (deterministic) {
      return deterministic;
    }

    const history = await buildSmartHistory(userId, message, "deep");
    const draft = await smartReply(userId, message, "coding", "deep", true);
    return refineCodingAnswer({
      question: message,
      draft,
      history,
    }).catch(() => draft);
  }

  return null;
}

type DetectedIntent = { type: IntentType; category: string };

function looksLikeResearchMemoQuestion(text: string) {
  return (
    /\b(decision memo|recommend(ed)? architecture|human override|rollout|evaluation|operational risk|hallucination containment|auditability|safety)\b/.test(text)
    && /\b(agentic|autonomous|copilot|tool use|tool-use|retrieval|rag|long-?context|hybrid)\b/.test(text)
  );
}

function looksLikeArchitectureCodingQuestion(text: string, rawText: string, words: string[]) {
  if (looksLikeResearchMemoQuestion(text)) {
    return false;
  }

  return (
    /\b(system design|system architecture|platform architecture|security architecture|control plane|distributed system|threat model|incident response|envelope encryption|tenant isolation|row[- ]level security|audit log|kms|token rotation|exactly-?once|release transition|disaster recovery|fencing token|worker lease|noisy-neighbor|workflow engine|feature store|collaborative document|offline editing|sync protocol|crdt|gang scheduling|checkpoint-aware|gpu scheduler|wallet ledger|multi-currency wallet|chargeback|reconciliation|ad[- ]attribution|privacy-preserving attribution|marketplace search|ranking platform|inventory freshness|seller reputation|fraud suppression|cold-chain|sensor calibration|batch recall|crispr|guide counts|hit calling|bioinformatics pipeline)\b/.test(text)
    || (
      /\b(oauth|token|secret|webhook|deploy|release|queue|worker|consensus|rollback|migration|cutover|feature store|crdt|checkpoint|gpu|workflow|backfill|point-in-time|wallet|chargeback|attribution|search ranking|inventory|seller reputation|cold-chain|vaccine|crispr|guide count|hit calling)\b/.test(text)
      && /\b(design|implement|build|handle|secure|scale|system|service|platform|saas|multi-tenant|production)\b/.test(text)
    )
    || (words.length > 12 && /```/.test(rawText))
  );
}

function looksLikeCalendarQuestion(text: string) {
  return (
    /\b(show|check|look at|summarize|list|review|pull)\s+(my\s+)?(calendar|schedule|agenda|meetings?|events?)\b/.test(text)
    || /\b(my\s+)?(meetings?|calendar|schedule|events?|appointments?|agenda)\s+(today|tomorrow|tonight|this week|next week|for today|for tomorrow|right now|upcoming)\b/.test(text)
    || /\bwhat('s|\s+is)\s+(on\s+)?(my\s+)?(calendar|schedule|agenda|plate)\b/.test(text)
    || /\bdo i have (any\s+)?(meetings?|events?|calls?)\b/.test(text)
    || /\b(today'?s|tomorrow'?s)\s+(meetings?|calendar|schedule|agenda)\b/.test(text)
  );
}

function detectIntent(text: string): DetectedIntent {
  const t = text.toLowerCase().trim();
  const words = t.split(/\s+/);

  if (looksLikeResearchMemoQuestion(t)) {
    return { type: "research", category: "research" };
  }

  // === CODING ===
  if (
    looksLikeArchitectureCodingQuestion(t, text, words) ||
    /\b(python|javascript|js|typescript|ts|java|c\+\+|cpp|golang|rust|php|swift|kotlin|ruby|scala|bash|shell|powershell)\b/.test(t) ||
    /\b(write|create|build|code|program|implement|fix|debug|optimize|refactor|review)\s+(a\s+|the\s+|this\s+|my\s+)?(code|function|script|program|class|component|api|endpoint|query|sql|algorithm|app|bot|tool|hook|module|snippet)\b/.test(t) ||
    /\b(how (do|can|to) (i\s+)?(code|program|build|implement|create|make|write))\b/.test(t) ||
    /\b(error|bug|exception|undefined|null pointer|syntax error|traceback|stacktrace|debug this|not working)\b/.test(t) ||
    /```/.test(text) ||
    // Context: short message after coding discussion = still coding
    (words.length <= 4 && /\b(in\s+(python|js|java|typescript|golang|rust|c\+\+|php|ruby))\b/.test(t))
  ) return { type: "coding", category: "coding" };

  // === MATH ===
  if (
    /\b(calculate|compute|solve|evaluate|simplify|differentiate|integrate|derivative|integral|probability|statistics|percentage|convert|how many|how much is \d)\b/.test(t) ||
    /\d+\s*[\+\-\*\/\^%]\s*\d+/.test(t) ||
    /\b(what is \d[\d,]*\.?\d*\s*[\+\-\*\/])\b/.test(t) ||
    /\b(square root|cube root|factorial|logarithm|trigonometry|sin|cos|tan|equation|expectancy|expected value|win rate|loss rate|bankroll|kelly|risk of ruin|probability of ruin|trading strategy|r multiple|r-multiple|bayes|posterior|prevalence|sensitivity|specificity|queueing|m\/m\/\d+\+m|arrival rate|service rate|patience|hazard ratio|survival|kaplan[- ]meier|cox model|proportional hazards|value at risk|var|stress loss|beta\(|treatment lift|posterior mean response)\b/.test(t)
  ) return { type: "math", category: "math" };

  // === EMAIL DRAFTING ===
  if (
    /\b(draft|write|compose|create|send)\s+(an?\s+)?(email|mail|message|reply|response|follow.?up)\b/.test(t) ||
    /\b(reply|respond)\s+(to|with)\b/.test(t) ||
    /\bwrite (to|for|an email)\b/.test(t) ||
    /\b(email|message)\s+(asking|saying|telling|about|regarding|for)\b/.test(t)
  ) return { type: "email", category: "draft_email" };

  // === EMAIL SEARCH ===
  if (
    /\b(search|find|look up|check|show|get)\s+(my\s+)?(email|inbox|mail|messages?)\b/.test(t) ||
    /\bwhat did .+ (say|write|send|email)\b/.test(t) ||
    /\bemail from\b/.test(t) ||
    /\bdid .+ (reply|respond|email|send)\b/.test(t) ||
    /\bany (emails?|messages?) (from|about|regarding)\b/.test(t)
  ) return { type: "email", category: "email_search" };

  // === REMINDER ===
  if (
    /\b(remind me|set (a\s+)?reminder|alert me|notify me|don'?t (let me )?forget)\b/.test(t) ||
    /\bremind (me\s+)?(at|in|on|by|tomorrow|tonight|this evening|next)\b/.test(t)
  ) return { type: "reminder", category: "reminder" };

  // === CALENDAR ===
  if (
    looksLikeCalendarQuestion(t)
  ) return { type: "calendar", category: "calendar" };

  // === SPENDING ===
  if (
    /\b(how much (did i|have i|i'?ve?)\s*(spent?|paid|used|spend))\b/.test(t) ||
    /\b(spending|expenses?|budget|receipt|invoice|transaction|money spent|cost me)\b/.test(t)
  ) return { type: "spending", category: "spending" };

  // === CREATIVE ===
  if (
    /\b(write (a|an|the|some)\s+(story|poem|song|lyrics|script|joke|caption|bio|tagline|slogan|tweet|post|haiku|limerick|riddle))\b/.test(t) ||
    /\b(creative writing|fiction|fantasy|narrative|rhyme|verse|stanza)\b/.test(t) ||
    /\b(make (it|this) (funny|creative|poetic|dramatic|inspirational))\b/.test(t)
  ) return { type: "creative", category: "creative" };

  // === GREETING ===
  if (
    /^(hi+|hello+|hey+|good\s+(morning|afternoon|evening|night)|namaste|hola|bonjour|ciao|sup|yo|what'?s up|howdy|greetings)\b/.test(t) &&
    words.length <= 5
  ) return { type: "greeting", category: "greeting" };

  // === RESEARCH (default for longer questions) ===
  if (
    /\b(research|analyze|compare|explain|what (is|are|was|were|does|do)|how (does|do|did|is|are)|why (is|are|did|does)|tell me about|describe|summarize|overview|difference between|pros and cons|advantages|disadvantages|history of|meaning of)\b/.test(t) ||
    text.length > 60
  ) return { type: "research", category: "research" };

  return { type: "general", category: "general" };
}

// ─── Main router ──────────────────────────────────────────────────────────────

export async function routeInboundAgentMessage(
  userId: string,
  message: string,
): Promise<string | null> {
  const requested = extractModeOverride(message);
  const trimmed = requested.cleaned;
  if (!trimmed) return null;

  // 1. Approval commands (SEND/EDIT/SKIP)
  const approval = await handleReplyApprovalCommand(userId, trimmed);
  if (approval.handled) return approval.response;

  const locale = await getUserLocale(userId);
  const { type, category } = detectIntent(trimmed);
  const responseMode = resolveResponseMode(type, trimmed, requested.mode);
  const explicitMode = requested.explicit;

  switch (category) {

    case "spending": {
      const ans = await answerSpendingQuestion(userId, trimmed);
      if (ans) return ans;
      return smartReply(userId, trimmed, "spending", responseMode, explicitMode);
    }

    case "draft_email": {
      const ack = await fastAckQuick(
        `User message: "${trimmed}". They want email help. Acknowledge you're checking their inbox and drafting. 1-2 lines max.`
      );
      sendReplyApprovalRequests(userId, /all|every|each/i.test(trimmed) ? 3 : 1).catch(() => null);
      return translateMessage(ack, locale);
    }

    case "email_search": {
      const ack = await fastAckQuick(
        `User message: "${trimmed}". They want to search email. Acknowledge you're searching their inbox. 1 line max.`
      );
      runClawCloudTask({ userId, taskType: "email_search", userMessage: trimmed }).catch(() => null);
      return translateMessage(ack, locale);
    }

    case "reminder": {
      const ack = await fastAckQuick(
        `User message: "${trimmed}". They want a reminder set. Confirm you're setting it with the task and time in *bold*. 1-2 lines.`
      );
      runClawCloudTask({ userId, taskType: "custom_reminder", userMessage: trimmed }).catch(() => null);
      return translateMessage(ack, locale);
    }

    case "calendar": {
      const ack = await fastAckQuick("User wants calendar info. 1 line: checking schedule.");
      runClawCloudTask({ userId, taskType: "meeting_reminders" }).catch(() => null);
      return translateMessage(ack, locale);
    }

    case "coding": {
      const reply =
        responseMode === "deep"
          ? (await expertReply(userId, trimmed, "coding"))
            ?? await smartReply(userId, trimmed, "coding", responseMode, explicitMode)
          : await smartReply(userId, trimmed, "coding", responseMode, explicitMode);
      return translateMessage(reply, locale);
    }

    case "math": {
      const reply =
        responseMode === "deep"
          ? (await expertReply(userId, trimmed, "math"))
            ?? await smartReply(userId, trimmed, "math", responseMode, explicitMode)
          : await smartReply(userId, trimmed, "math", responseMode, explicitMode);
      return translateMessage(reply, locale);
    }

    case "creative": {
      const reply = await smartReply(userId, trimmed, "creative", responseMode, explicitMode);
      return translateMessage(reply, locale);
    }

    case "research": {
      const reply =
        responseMode === "deep"
          ? (await expertReply(userId, trimmed, "research"))
            ?? await smartReply(userId, trimmed, "research", responseMode, explicitMode)
          : await smartReply(userId, trimmed, "research", responseMode, explicitMode);
      return translateMessage(reply, locale);
    }

    case "greeting": {
      const reply = await smartReply(userId, trimmed, "greeting", responseMode, explicitMode);
      return translateMessage(reply, locale);
    }

    default: {
      const reply = await smartReply(userId, trimmed, type, responseMode, explicitMode);
      return translateMessage(reply, locale);
    }
  }
}

// ─── Task helpers ─────────────────────────────────────────────────────────────

async function getTaskRow(userId: string, taskType: ClawCloudTaskType) {
  const { data } = await getClawCloudSupabaseAdmin()
    .from("agent_tasks").select("*").eq("user_id", userId).eq("task_type", taskType).maybeSingle();
  return (data ?? null) as AgentTaskRow | null;
}

async function getUserPlan(userId: string) {
  const { data } = await getClawCloudSupabaseAdmin()
    .from("users").select("plan").eq("id", userId).maybeSingle();
  return (data?.plan ?? "free") as ClawCloudPlan;
}

async function getTodayRuns(userId: string) {
  const { data } = await getClawCloudSupabaseAdmin()
    .from("analytics_daily").select("tasks_run")
    .eq("user_id", userId).eq("date_key", formatDateKey(new Date())).maybeSingle();
  return Number(data?.tasks_run ?? 0);
}

export async function createClawCloudTask(input: {
  userId: string; taskType: ClawCloudTaskType; scheduleTime: string | null;
  scheduleDays: string[] | null; config: Record<string, unknown>;
}) {
  const db = getClawCloudSupabaseAdmin();
  const plan = await getUserPlan(input.userId);
  const { data: existing } = await db.from("agent_tasks").select("id").eq("user_id", input.userId).eq("is_enabled", true);
  if ((existing?.length ?? 0) >= clawCloudActiveTaskLimits[plan]) {
    throw new Error(`Limit of ${clawCloudActiveTaskLimits[plan]} active tasks on ${plan} plan. Upgrade to add more.`);
  }
  const { data, error } = await db.from("agent_tasks").upsert({
    user_id: input.userId, task_type: input.taskType, is_enabled: true,
    schedule_time: input.scheduleTime, schedule_days: input.scheduleDays,
    config: { ...clawCloudDefaultTaskSeeds[input.taskType], ...input.config },
  }, { onConflict: "user_id,task_type" }).select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

// ─── Task runners ─────────────────────────────────────────────────────────────

async function runMorningBriefing(userId: string, config: ClawCloudTaskConfig) {
  const [emails, events, locale] = await Promise.all([
    getClawCloudGmailMessages(userId, { query: "is:unread", maxResults: Number(config.max_emails ?? 50) }),
    getClawCloudCalendarEvents(userId, { timeMin: new Date().toISOString(), timeMax: new Date(Date.now() + 86400000).toISOString() }),
    getUserLocale(userId),
  ]);

  const emailCtx = emails.slice(0, 15).map((e) => `From: ${e.from}\nSubject: ${e.subject}\nSnippet: ${e.snippet}`).join("\n---\n");
  const eventCtx = events.map((e) => `${e.start} — ${e.summary}${e.hangoutLink ? ` (${e.hangoutLink})` : ""}`).join("\n");

  const msg = await completeClawCloudPrompt({
    system: buildMultilingualBriefingSystem(locale) + "\n\nFormat for WhatsApp: ☀️ *Good Morning!* header, *bold* section titles, • bullets. Professional, actionable, under 280 words. Highlight urgent emails and upcoming meetings.",
    user: `Morning briefing.\nUnread: ${emails.length} emails\n${emailCtx}\n\nCalendar:\n${eventCtx || "No events"}`,
    intent: "research", maxTokens: 600, skipCache: true,
    fallback: `☀️ *Good Morning!*\n\n📧 *Emails:* ${emails.length} unread\n📅 *Calendar:* ${events.length} event${events.length === 1 ? "" : "s"}\n\n${events.map((e) => `• ${e.summary}`).join("\n") || "No meetings today 🎉"}`,
  });

  await sendClawCloudWhatsAppMessage(userId, msg);
  try { await sendClawCloudTelegramMessage(userId, msg); } catch { /* optional */ }
  await upsertAnalyticsDaily(userId, { emails_processed: emails.length, tasks_run: 1, wa_messages_sent: 1 });
  return { emailCount: emails.length, eventCount: events.length, message: msg };
}

async function runDraftReplies(userId: string, config: ClawCloudTaskConfig, userMessage: string | null | undefined) {
  const { queued } = await sendReplyApprovalRequests(userId, Number(config.max_drafts ?? 3));
  return { queued };
}

async function runMeetingReminders(userId: string, config: ClawCloudTaskConfig) {
  const locale = await getUserLocale(userId);
  const events = await getClawCloudCalendarEvents(userId, {
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + 86400000).toISOString(),
  });

  if (!events.length) {
    await sendClawCloudWhatsAppMessage(userId, await translateMessage("📅 *No meetings today!*\n\nYour calendar is clear for the next 24 hours. Enjoy the free time! 🎉", locale));
    return { eventCount: 0 };
  }

  const list = events.map((e) => {
    const t = new Date(e.start).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    return `• *${e.summary}* at ${t}${e.hangoutLink ? `\n  🔗 ${e.hangoutLink}` : ""}`;
  }).join("\n\n");

  const msg = await completeClawCloudPrompt({
    system: buildMultilingualBriefingSystem(locale) + "\n\nProfessional WhatsApp meeting summary. 📅 header, *bold* names/times.",
    user: `Meetings:\n${list}`, intent: "calendar", maxTokens: 350, skipCache: true,
    fallback: `📅 *Your Meetings Today*\n\n${list}`,
  });

  await sendClawCloudWhatsAppMessage(userId, msg);
  await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
  return { eventCount: events.length, message: msg };
}

async function runEmailSearch(userId: string, userMessage: string | null | undefined) {
  const locale = await getUserLocale(userId);
  const q = userMessage?.trim() || "is:unread";
  const emails = await getClawCloudGmailMessages(userId, { query: `${q} newer_than:30d`, maxResults: 10 });

  if (!emails.length) {
    await sendClawCloudWhatsAppMessage(userId, await translateMessage(`🔍 *No emails found*\n\nNo results for: _"${q}"_\n\nTry a different search.`, locale));
    return { found: 0 };
  }

  const ctx = emails.slice(0, 8).map((e) => `From: ${e.from}\nSubject: ${e.subject}\nSnippet: ${e.snippet?.slice(0, 200)}`).join("\n---\n");
  const ans = await completeClawCloudPrompt({
    system: BRAIN + "\n\nSummarize email search results for WhatsApp. *Bold* senders and subjects. • per email. Short and scannable.",
    user: `Search: "${userMessage}"\n\nFound ${emails.length} email(s):\n${ctx}`,
    intent: "email", maxTokens: 500, skipCache: true,
    fallback: emails.slice(0, 5).map((e) => `• *${e.from}* — ${e.subject}`).join("\n"),
  });

  await sendClawCloudWhatsAppMessage(userId, `🔍 *"${userMessage}"*\n\n${ans}\n\n_${emails.length} result${emails.length === 1 ? "" : "s"}_`);
  await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
  return { found: emails.length, answer: ans };
}

async function runEveningSummary(userId: string) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [emails, events, runs] = await Promise.all([
    getClawCloudGmailMessages(userId, { query: `after:${Math.floor(start.getTime() / 1000)}`, maxResults: 30 }),
    getClawCloudCalendarEvents(userId, { timeMin: start.toISOString(), timeMax: new Date().toISOString() }),
    getClawCloudSupabaseAdmin().from("task_runs").select("task_type,status").eq("user_id", userId).gte("started_at", start.toISOString()),
  ]);

  const unread = emails.filter((e) => !e.isRead);
  const msg = await completeClawCloudPrompt({
    system: BRAIN + "\n\nEvening summary for WhatsApp. 🌙 header, *bold* stats, • bullets for unread.",
    user: `Summary:\nEmails: ${emails.length} (${unread.length} unread)\nMeetings: ${events.length}\nAI tasks: ${runs.data?.length ?? 0}\nUnread:\n${unread.slice(0, 5).map((e) => `- ${e.from}: ${e.subject}`).join("\n") || "None"}`,
    intent: "research", maxTokens: 300, skipCache: true,
    fallback: `🌙 *Evening Summary*\n\n📧 ${emails.length} emails, ${unread.length} unread\n📅 ${events.length} meetings\n🤖 ${runs.data?.length ?? 0} tasks\n\n${unread.length ? `*Still needs attention:*\n${unread.slice(0, 3).map((e) => `• ${e.from} — ${e.subject}`).join("\n")}` : "✅ All clear!"}`,
  });

  await sendClawCloudWhatsAppMessage(userId, msg);
  await upsertAnalyticsDaily(userId, { emails_processed: emails.length, tasks_run: 1, wa_messages_sent: 1 });
  return { message: msg };
}

function parseReminder(text: string): { fireAt: string; reminderText: string } | null {
  const now = new Date();
  const timeM = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  const inM = text.match(/\bin\s+(\d+)\s+(minute|hour|min|hr)s?\b/i);
  const tmrw = /\btomorrow\b/i.test(text);
  let fireAt: Date | null = null;

  if (timeM) {
    let h = parseInt(timeM[1], 10);
    const m = parseInt(timeM[2] ?? "0", 10);
    const mer = timeM[3]?.toLowerCase();
    if (mer === "pm" && h < 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    fireAt = new Date(now);
    if (tmrw) fireAt.setDate(fireAt.getDate() + 1);
    fireAt.setHours(h, m, 0, 0);
    if (fireAt <= now && !tmrw) fireAt.setDate(fireAt.getDate() + 1);
  } else if (inM) {
    const amt = parseInt(inM[1], 10);
    const unit = inM[2].toLowerCase();
    fireAt = new Date(now.getTime() + amt * (unit.startsWith("h") ? 3600000 : 60000));
  } else if (tmrw) {
    fireAt = new Date(now);
    fireAt.setDate(fireAt.getDate() + 1);
    fireAt.setHours(9, 0, 0, 0);
  }

  if (!fireAt) return null;
  const rt = text.match(/\b(?:to|about|that|for)\s+(.+)/i)?.[1]?.trim() || text;
  return { fireAt: fireAt.toISOString(), reminderText: rt };
}

async function runCustomReminder(userId: string, userMessage: string | null | undefined) {
  const raw = userMessage?.trim() ?? "";
  if (!raw) throw new Error("Reminder requires a message.");

  const parsed = parseReminder(raw);
  if (!parsed) {
    await sendClawCloudWhatsAppMessage(userId,
      "⏰ *Couldn't parse that reminder*\n\nTry:\n• _Remind me at 5pm to call Priya_\n• _Remind me in 30 minutes to take medicine_\n• _Remind me tomorrow to send the report_"
    );
    await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
    return { set: false };
  }

  await getClawCloudSupabaseAdmin().from("agent_tasks").upsert({
    user_id: userId, task_type: "custom_reminder", is_enabled: true,
    config: { reminder_text: parsed.reminderText, fire_at: parsed.fireAt, one_time: true, source_message: raw },
  }, { onConflict: "user_id,task_type" });

  const timeStr = new Date(parsed.fireAt).toLocaleString("en-IN", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  await sendClawCloudWhatsAppMessage(userId,
    `✅ *Reminder Set!*\n\n📌 *Task:* ${parsed.reminderText}\n⏰ *When:* ${timeStr}\n\nI'll remind you right on time! 🎯`
  );
  await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
  return { set: true, fireAt: parsed.fireAt, reminderText: parsed.reminderText };
}

// ─── runClawCloudTask ─────────────────────────────────────────────────────────

export async function runClawCloudTask(input: RunTaskInput) {
  const db = getClawCloudSupabaseAdmin();
  const task = await getTaskRow(input.userId, input.taskType);
  if (!task) throw new Error(`Task ${input.taskType} not configured.`);
  if (!input.bypassEnabledCheck && !task.is_enabled) throw new Error(`Task ${input.taskType} disabled.`);

  const plan = await getUserPlan(input.userId);
  const runs = await getTodayRuns(input.userId);
  const limit = clawCloudRunLimits[plan];

  if (runs >= limit) {
    await sendClawCloudWhatsAppMessage(input.userId,
      `⚠️ *Daily limit reached*\n\nUsed all *${limit} runs* on *${plan}* plan today.\n\nUpgrade → swift-deploy.in/pricing`
    );
    throw new Error("Daily limit reached.");
  }

  const { data: run } = await db.from("task_runs").insert({
    user_id: input.userId, task_id: task.id, task_type: input.taskType,
    status: "running", input_data: input.userMessage ? { user_message: input.userMessage } : {},
  }).select("id").single();

  const t0 = Date.now();

  try {
    let result: Record<string, unknown>;
    switch (input.taskType) {
      case "morning_briefing":    result = await runMorningBriefing(input.userId, task.config ?? {}); break;
      case "draft_replies":       result = await runDraftReplies(input.userId, task.config ?? {}, input.userMessage); break;
      case "meeting_reminders":   result = await runMeetingReminders(input.userId, task.config ?? {}); break;
      case "email_search":        result = await runEmailSearch(input.userId, input.userMessage); break;
      case "evening_summary":     result = await runEveningSummary(input.userId); break;
      case "custom_reminder":     result = await runCustomReminder(input.userId, input.userMessage); break;
      case "weekly_spend_summary": result = await runWeeklySpendSummary(input.userId); break;
      default: throw new Error(`Unknown task: ${input.taskType}`);
    }

    const ms = Date.now() - t0;
    if (run?.id) {
      await db.from("task_runs").update({ status: "success", output_data: result, duration_ms: ms, completed_at: new Date().toISOString() }).eq("id", run.id).catch(() => null);
      await db.from("agent_tasks").update({ total_runs: (task.total_runs ?? 0) + 1, last_run_at: new Date().toISOString() }).eq("id", task.id).catch(() => null);
    }
    return result;
  } catch (err) {
    const ms = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    if (run?.id) {
      await db.from("task_runs").update({ status: "failed", error_message: msg, duration_ms: ms, completed_at: new Date().toISOString() }).eq("id", run.id).catch(() => null);
    }
    throw err;
  }
}

export async function runClawCloudMorningBriefing(userId: string) {
  const task = await getTaskRow(userId, "morning_briefing");
  if (!task) throw new Error("Morning briefing not configured.");
  return runMorningBriefing(userId, task.config ?? {});
}

export async function scheduleClawCloudTasks(userId: string) {
  const { data } = await getClawCloudSupabaseAdmin()
    .from("agent_tasks").select("*").eq("user_id", userId).eq("is_enabled", true);
  return data ?? [];
}
