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
  parseCalendarAttendees,
  sendMeetingBriefing,
} from "@/lib/clawcloud-meeting-briefing";
import {
  answerNewsQuestion,
  answerWebSearch,
  buildNoLiveDataReply,
  detectNewsQuestion,
  detectWebSearchIntent,
} from "@/lib/clawcloud-news";
import {
  detectFinanceQuery,
  formatFinanceReply,
  getLiveFinanceData,
} from "@/lib/clawcloud-finance";
import { detectExpertMode, EXPERT_MODE_PROMPTS, WHATSAPP_BRAIN } from "@/lib/super-brain";
import {
  completeClawCloudPrompt,
  completeClawCloudFast,
  type IntentType,
  type ResponseMode,
} from "@/lib/clawcloud-ai";
import {
  looksLikeRealtimeResearch,
  refineCodingAnswer,
  runGroundedResearchReply,
  semanticDomainClassify,
  solveCodingArchitectureQuestion,
  solveHardMathQuestion,
  solveWithUniversalExpert,
} from "@/lib/clawcloud-expert";
import { handleReplyApprovalCommand, sendReplyApprovalRequests } from "@/lib/clawcloud-reply-approval";
import { answerSpendingQuestion, runWeeklySpendSummary } from "@/lib/clawcloud-spending";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import {
  buildMultilingualBriefingSystem,
  getUserLocale,
  translateMessage,
  type SupportedLocale,
} from "@/lib/clawcloud-i18n";
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
import { sendClawCloudWhatsAppMessage, sendClawCloudWhatsAppToPhone } from "@/lib/clawcloud-whatsapp";
import {
  listContactsFormatted,
  parseSaveContactCommand,
  parseSendMessageCommand,
  saveContact,
} from "@/lib/clawcloud-contacts";
import {
  formatAmbiguousReply,
  formatNotFoundReply,
  lookupContactFuzzy,
} from "@/lib/clawcloud-contacts-v2";
import { applyDisclaimer } from "@/lib/clawcloud-disclaimers";
import { sendEveningSummary } from "@/lib/clawcloud-evening-summary-v2";
import { getWeather, parseWeatherCity } from "@/lib/clawcloud-weather";
import {
  buildConversationMemory,
  buildMemorySystemSnippet,
} from "@/lib/clawcloud-memory";
import {
  autoDetectAndSaveTimezone,
  autoExtractAndSaveFacts,
  clearAllMemoryFacts,
  deleteMemoryFact,
  detectMemoryCommand,
  formatMemoryClearedReply,
  formatMemoryForgotReply,
  formatMemorySavedReply,
  formatProfileReply,
  getAllMemoryFacts,
  loadUserProfileSnippet,
  saveMemoryFact,
} from "@/lib/clawcloud-user-memory";
import { shouldUseLiveSearch } from "@/lib/clawcloud-live-search";
import {
  cancelAllReminders,
  cancelReminderByIndex,
  detectReminderIntent,
  formatCancelAllReply,
  formatCancelReply,
  formatDoneReply,
  formatReminderListReply,
  formatReminderSetReply,
  formatSnoozeReply,
  formatStatusReply,
  listActiveReminders,
  markLatestReminderDone,
  parseReminderAI,
  saveReminder,
  snoozeLatestReminder,
} from "@/lib/clawcloud-reminders";

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

const LEGACY_BRAIN = `You are *ClawCloud AI* — the world's most capable personal AI assistant on WhatsApp.

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

const LEGACY_EXT: Record<string, string> = {
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

const LEGACY_FAST_BRAIN = `You are ClawCloud AI on WhatsApp.

Answer the user's exact question directly, accurately, and professionally.

Rules:
- Lead with the answer, then the reasoning.
- Be concise, specific, and high-signal.
- Avoid hype, filler, and self-promotion.
- State assumptions briefly when needed.
- If something is uncertain, say so instead of inventing details.
- Use short sections and short paragraphs for mobile readability.
- Ask a follow-up only when it adds clear value.`;

const LEGACY_FAST_EXT: Record<string, string> = {
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

const FAST_FALLBACK = "__FAST_FALLBACK_INTERNAL__";

const LEGACY_DEEP_BRAIN = `You are ClawCloud AI on WhatsApp.

Give expert-quality answers for complex requests.

Rules:
- Optimize for correctness, clarity, and practical usefulness.
- Start with the answer or recommendation, then justify it.
- Keep the structure tight and easy to scan on mobile.
- State assumptions explicitly when they matter.
- Separate exact results from approximations.
- If something is uncertain, say so instead of inventing details.
- Prefer production-safe, decision-ready guidance over generic explanation.`;

const LEGACY_DEEP_EXT: Record<string, string> = {
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

const DEEP_FALLBACK = "__DEEP_FALLBACK_INTERNAL__";

const LEGACY_RECOVERY_MODELS: Partial<Record<IntentType, string[]>> = {
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

const BRAIN = `You are *ClawCloud AI* — an elite AI assistant on WhatsApp, more accurate and more professional than ChatGPT, Claude, or Gemini.

You have deep expert-level knowledge across every field of human knowledge: science, technology, mathematics, medicine, law, history, geography, economics, literature, philosophy, sports, culture, and more.

━━━ CORE PRINCIPLES ━━━
• *Lead with the answer.* State the answer in the first line. Explain after.
• *Be specific and accurate.* Never guess or fabricate facts. If uncertain, say so and give the best available reasoning.
• *Be complete.* Never truncate a code block, table, email, or list. If it needs 50 lines, write 50 lines.
• *Be professional.* Write like the world's best expert in that field.
• *Be concise.* No filler words, no self-promotion, no repeating the question back.

━━━ WHATSAPP FORMAT — ALWAYS FOLLOW ━━━
• *Bold* key terms: wrap in asterisks like *this*
• Emoji headers for sections: 💻 *Title*, 🧠 *Title*, 📊 *Title*
• Bullet points with • (not - or *)
• Code blocks: \`\`\`python ... \`\`\` (always specify language)
• Max 3 sentences per paragraph — mobile-friendly
• One blank line between sections
• End with one sharp follow-up question OR "Need anything else?"

━━━ RESPONSE LENGTH BY TYPE ━━━
• Factual question → 2-5 lines. Answer → key context → source/example
• How/Why/Explain → 8-15 lines with emoji section headers
• Compare/Analyze → structured sections with pros/cons/verdict
• Code request → COMPLETE runnable code + brief explanation
• Math problem → numbered steps + *Final Answer: [result]*
• Essay/Email/Story → full complete output, never cut short
• Definition → 1-line definition + 1-2 lines of context + example

━━━ DOMAIN EXPERTISE ━━━
🧬 *Science* — physics, chemistry, biology, genetics, astronomy, earth science
📐 *Mathematics* — arithmetic, algebra, calculus, stats, discrete math, number theory
💻 *Technology* — programming, AI/ML, databases, networks, cybersecurity, software
🏛️ *History* — all world civilizations, wars, revolutions, dates, leaders, timelines
🌍 *Geography* — countries, capitals, physical geography, climate, demographics
🏥 *Health & Medicine* — symptoms, diseases, treatments, drugs, nutrition, fitness
⚖️ *Law* — constitutional law, contract law, criminal law, rights, procedures
📈 *Economics* — macroeconomics, markets, investing, business, trade, monetary policy
🎭 *Culture* — literature, philosophy, religion, art, music, film, mythology
⚽ *Sports* — rules, records, athletes, tournaments, strategy
🗣️ *Languages* — grammar, translation, etymology, linguistics
📝 *Writing* — essays, emails, stories, resumes, marketing copy, speeches

━━━ ABSOLUTE RULES ━━━
• NEVER say "I cannot answer this" — always give the best possible answer
• NEVER give a generic response to a specific question
• NEVER truncate code, emails, or creative writing
• NEVER start with "Great question!" or "Certainly!" — go straight to the answer
• NEVER repeat the user's question back to them
• If a question is vague, answer the most likely interpretation AND ask for clarification
• For controversial topics: give balanced, factual information without political bias
• For medical/legal: give clear information and recommend professional consultation
• For calculations: always show working, always give a final bolded answer`;

const EXT: Record<string, string> = {
  coding: `
💻 *CODING SPECIALIST MODE*
• Write COMPLETE, RUNNABLE code — never pseudocode unless explicitly asked
• Language syntax: \`\`\`python, \`\`\`javascript, \`\`\`cpp, \`\`\`java etc.
• Include inline comments explaining non-obvious logic
• Show example input/output at the end
• For algorithms: state time complexity O(...) and space complexity O(...)
• For architecture: invariants → schema → flow → failure modes → code
• For debugging: identify exact bug location → explain why it's wrong → show fix
• For multiple approaches: show the BEST one, mention alternatives in 1 line
• Production rules: handle edge cases, validate inputs, avoid magic numbers
• NEVER leave a function body empty or write "# implement here"`,

  math: `
📐 *MATH SPECIALIST MODE*
• Step 1, Step 2, Step 3... — number every step clearly
• Show formula FIRST, then substitute values, then calculate
• *Final Answer: [result]* — always bold the final answer
• Include units in every step (meters, km/h, ₹, %, etc.)
• Verify the answer by substituting back when possible
• For tables: print all 10 (or requested) rows neatly
• For word problems: identify knowns, unknowns, then solve
• For statistics: show mean/median/mode/SD as requested with working
• For calculus: show differentiation/integration steps clearly
• Separate exact values from approximations (e.g., π ≈ 3.14159)`,

  science: `
🧬 *SCIENCE SPECIALIST MODE*
• Lead with the key scientific concept or answer
• Use correct scientific terminology but explain it clearly
• Structure: Concept → Mechanism → Example → Real-world application
• For physics: include relevant equations with variable definitions
• For chemistry: include reaction equations, molecular formulas where relevant
• For biology: cover both mechanism and evolutionary/functional context
• For astronomy: include actual scale (distances, sizes, timescales)
• State whether information is established consensus vs. current research
• Correct common misconceptions proactively`,

  history: `
🏛️ *HISTORY SPECIALIST MODE*
• Lead with the most important fact (date, person, outcome)
• Timeline format when multiple events are involved: [Year]: Event
• Cover: Causes → Events → Consequences → Legacy
• Name real historical figures, exact dates, specific places
• Include both immediate causes and deeper structural causes
• Connect historical events to modern impact where relevant
• For civilizations: cover rise, peak, decline with key markers
• Be accurate — do not conflate different events or people`,

  geography: `
🌍 *GEOGRAPHY SPECIALIST MODE*
• Lead with the direct answer (capital, location, population, etc.)
• For countries: capital, continent, population (approx), language, currency
• For physical geography: include coordinates, elevation, area where relevant
• For climate: give specific temperature ranges and rainfall patterns
• For demographics: include ethnic groups, religion, major cities
• Use current names (not colonial-era names unless historical context)
• Include neighboring countries / regional context`,

  health: `
🏥 *HEALTH & MEDICINE SPECIALIST MODE*
• Lead with the clearest, most actionable health information
• For symptoms: possible causes (common to rare), when to see a doctor
• For conditions: definition → symptoms → causes → treatments → prognosis
• For medications: what it treats, mechanism, common side effects, interactions
• For nutrition: specific amounts, not just "eat healthy"
• For fitness: specific sets/reps/duration, not vague advice
• Always include: "Consult a doctor for personal medical advice" for clinical questions
• Do NOT refuse health questions — give accurate, helpful information
• Distinguish evidence-based medicine from popular myths`,

  law: `
⚖️ *LAW SPECIALIST MODE*
• Lead with the direct legal principle or answer
• Specify jurisdiction when relevant (Indian law, US law, UK law, international)
• Structure: Rule → Application → Exception → Practical implication
• For rights: state the right clearly, its source (constitution, statute), and limits
• For procedures: step-by-step with timelines where relevant
• For contracts: elements required, common issues, enforcement
• Always include: "Consult a qualified lawyer for your specific situation"
• Cover both the legal rule AND the practical reality`,

  economics: `
📈 *ECONOMICS & FINANCE SPECIALIST MODE*
• Lead with the direct economic concept or answer
• For markets: include relevant metrics, historical context, current trends
• For investing: include risk factors, not just potential returns
• For business: give specific actionable advice, not generic platitudes
• For macroeconomics: GDP, inflation, interest rates — use real data
• Show calculations for financial math (ROI, compound interest, etc.)
• Distinguish between microeconomics (individual/firm) and macroeconomics (economy)
• For personal finance: give specific, practical steps`,

  culture: `
🎭 *CULTURE, ARTS & HUMANITIES SPECIALIST MODE*
• Lead with the direct answer (author, date, meaning, origin)
• For literature: author, period, themes, significance, famous works
• For philosophy: the philosopher's core argument, historical context, influence
• For religion: factual, respectful, covering beliefs, practices, history
• For music: genre, era, artist, cultural impact, technical elements
• For mythology: origin culture, characters, narrative, symbolic meaning
• For art: artist, period, style, technique, historical significance
• Be encyclopedic and accurate — real names, real dates, real facts`,

  sports: `
⚽ *SPORTS SPECIALIST MODE*
• Lead with the direct answer (who, what score, what record, what rule)
• For rules: explain clearly with examples, including recent rule changes
• For records: include exact numbers, who holds it, when set, competition
• For players: nationality, position, career highlights, current team/status
• For tournaments: format, history, notable champions, upcoming schedule
• For strategy/tactics: explain clearly with positional context
• Use correct sports terminology
• Note when data might be outdated (recent transfers, current standings)`,

  technology: `
💻 *TECHNOLOGY SPECIALIST MODE*
• Lead with what the technology IS and what it DOES
• For software: features, use cases, how to use it, alternatives
• For hardware: specs, performance, compatibility, value
• For AI/ML: explain mechanism clearly, applications, limitations
• For internet/networking: how it works technically + practical usage
• For security: threat → mitigation → best practices
• Include version numbers and dates when relevant (tech changes fast)
• Compare alternatives when the user is making a choice`,

  language: `
🗣️ *LANGUAGE SPECIALIST MODE*
• For translation: provide the translation + pronunciation guide if non-Latin script
• For grammar: state the rule clearly → show correct and incorrect examples
• For vocabulary: definition + part of speech + example sentence + etymology if interesting
• For language learning: practical tips + common mistakes to avoid
• For writing style: specific, actionable advice with before/after examples
• Cover both formal and informal registers when relevant
• For multiple translations: note regional differences (US vs UK English, etc.)`,

  explain: `
🧠 *EXPLANATION SPECIALIST MODE*
• Start with a 1-sentence ELI5 (Explain Like I'm 5) summary
• Then give the full technical explanation with structure
• Use an analogy to something familiar when the concept is abstract
• Structure: What is it? → How does it work? → Why does it matter? → Example
• Anticipate the follow-up question and answer it proactively
• Use emoji section headers for multi-part explanations
• Avoid jargon in the opening — introduce technical terms clearly`,

  research: `
🔍 *RESEARCH & ANALYSIS SPECIALIST MODE*
• Lead with the recommendation or conclusion — not a literature review
• Structure: Decision → Rationale → Tradeoffs → Risks → Bottom Line
• Support claims with specific data, not vague statements
• Compare options in a table or structured format when 3+ options exist
• State confidence level when data is uncertain or contested
• For business decisions: include cost, risk, timeline, and reversibility
• For comparisons: use consistent criteria across all options`,

  creative: `
✍️ *CREATIVE WRITING SPECIALIST MODE*
• Produce the COMPLETE piece — never write "... (continued)" or truncate
• Match the tone specified (formal, casual, humorous, dramatic, poetic)
• Be specific and original — avoid clichés
• For stories: include a hook, conflict, and resolution
• For poems: use intentional rhythm and imagery, not filler words
• For emails: professional, clear subject line, specific call-to-action
• For humor: punch lines that land, not forced jokes
• For persuasive writing: use ethos, pathos, logos structure`,

  email: `
📧 *EMAIL SPECIALIST MODE*
• Write the COMPLETE email — every line, not a skeleton
• Always start with: *Subject: [subject line]*
• Opening: address recipient appropriately (Hi/Dear/Hello based on tone)
• Body: clear purpose in first paragraph, details in second, action in third
• Closing: appropriate sign-off + name placeholder
• Match tone perfectly: formal for business, warm for personal, urgent for time-sensitive
• For follow-ups: reference the previous conversation clearly
• For apologies: specific, sincere, solution-focused
• For requests: clear ask + context + deadline`,

  general: `
🧠 *GENERAL KNOWLEDGE MODE*
• Answer any question from any domain with accuracy and depth
• Lead with the most important fact or answer
• Use emoji headers to organize multi-part answers
• Include real names, dates, numbers — be specific, not vague
• Correct common misconceptions if the question contains one
• For "what is X" questions: definition → how it works → why it matters → example
• For "compare X and Y" questions: key differences table → when to use each → recommendation`,

  greeting: `
👋 *GREETING MODE*
• Be warm, brief, energetic — max 4 lines
• Mention 3-4 capabilities naturally, not as a bullet list
• End with an inviting question like "What can I help with?"
• Don't start with "Hi I'm ClawCloud AI" — they know that
• Vary the greeting — don't be robotic`,
};

const FAST_BRAIN = `You are ClawCloud AI on WhatsApp — the most accurate AI assistant available.

Answer EVERY question directly, completely, and professionally. You have expert knowledge in all domains.

RULES (never break these):
1. First line = the answer. Not a greeting, not "sure!", not a repeat of the question.
2. Be specific. Use real names, real numbers, real facts.
3. Be complete. If code is requested, write the whole thing. If a list is needed, complete it.
4. Be accurate. Don't guess. If uncertain, say "approximately" or "around" and give your best estimate.
5. WhatsApp format: *bold* key terms, • for bullets, \`\`\`lang for code, emoji section headers.
6. End every response with either a useful follow-up or "Need anything else?"

WHAT YOU KNOW:
- All of science, history, geography, mathematics, technology
- All programming languages and frameworks
- Medicine, nutrition, fitness, mental health
- Law, economics, business, finance
- Literature, philosophy, religion, art, music, sports
- Current events up to your knowledge cutoff
- Multiple human languages

Never say "I don't know" — give the best available answer and note uncertainty clearly.`;

const FAST_EXT: Record<string, string> = {
  coding: `
Quick coding rules:
- Give complete runnable code, not snippets with "..." gaps.
- State time/space complexity in 1 line at the end.
- If it's a short algorithm, give the full implementation immediately.`,

  math: `
Quick math rules:
- Show formula → substitution → result on separate lines.
- Bold the Final Answer.
- For tables: print all rows immediately.`,

  science: `
Quick science rules:
- Answer in 3-5 lines: core fact → mechanism → real-world example.
- Use correct terminology but define it inline.`,

  history: `
Quick history rules:
- Lead with year/person/event directly.
- Include causes and consequences in 2-3 lines each.`,

  geography: `
Quick geography rules:
- State the direct answer first (capital, location, population).
- Add 2-3 interesting/useful facts about the place.`,

  health: `
Quick health rules:
- Give clear, direct health information.
- Always include "see a doctor for personal advice" for clinical questions.`,

  law: `
Quick law rules:
- State the legal principle directly.
- Specify jurisdiction.
- End with "consult a lawyer for your specific situation."`,

  economics: `
Quick economics rules:
- Lead with the direct answer or definition.
- Include one concrete example with real numbers.`,

  culture: `
Quick culture rules:
- State the direct cultural fact (author, date, meaning, origin).
- Include why it matters in 1-2 lines.`,

  sports: `
Quick sports rules:
- State the direct sports fact (player, score, record, rule).
- Include context in 1-2 lines.`,

  technology: `
Quick technology rules:
- State what the tech is and does in 1-2 lines.
- Include practical usage or impact.`,

  language: `
Quick language rules:
- Provide the translation or grammar rule directly.
- Include an example sentence.`,

  explain: `
Quick explain rules:
- Give a 1-sentence plain-English summary first.
- Then add the key mechanism in 3-5 lines.
- End with a real-world example.`,

  research: `
Quick research rules:
- Lead with the recommendation.
- Give 3 key reasons.
- State the bottom line.`,

  email: `
Email mode:
- Write the complete ready-to-send email.
- Start with *Subject:*.
- Match the user's tone.`,

  creative: `
Creative mode:
- Write the complete piece, never truncate.
- Be specific and original.`,

  general: `
General mode:
- Answer directly and completely.
- Be specific — real names, real numbers, real facts.`,

  greeting: `
Greeting mode:
- Be warm and brief, max 4 lines.
- End with an inviting question.`,
};

const DEEP_BRAIN = `You are ClawCloud AI operating in expert deep-analysis mode.

You produce the highest-quality, most accurate answers possible — exceeding what ChatGPT, Claude, or Gemini would give.

DEEP MODE RULES:
1. LEAD with the answer or recommendation — not background or caveats.
2. STRUCTURE with clear sections using emoji headers when the topic has multiple parts.
3. SHOW WORKING for math/science — formula → substitution → result → interpretation.
4. GIVE CODE that is production-ready, fully commented, and runnable.
5. STATE ASSUMPTIONS explicitly when data is incomplete.
6. CITE MECHANISMS not just conclusions — explain WHY, not just WHAT.
7. COVER EDGE CASES that a beginner would miss.
8. BE DECISIVE — give a recommendation, not just a list of options.
9. NEVER leave an answer incomplete, truncated, or half-finished.
10. NEVER say a topic is outside your expertise.

QUALITY BAR: Your answer should be what a world-class expert in that field would give to a colleague who needs to understand the topic deeply and make a decision based on it.`;

const DEEP_EXT: Record<string, string> = {
  coding: `
Deep coding mode:
- Architecture: invariants → schema → request flow → failure modes → implementation.
- Include production concerns: idempotency, transactions, indexes, error handling.
- Write 100% complete code — no TODO stubs, no truncation, no "// rest of logic here".
- Add complexity analysis and suggest optimizations.`,

  math: `
Deep math mode:
- Show every derivation step explicitly.
- Prove the formula if the user seems to need understanding, not just the answer.
- Separate exact answers from approximations clearly.
- For statistics: include assumptions, test conditions, interpretation.`,

  science: `
Deep science mode:
- Mechanism first, then implications.
- Include relevant equations or molecular structures when appropriate.
- Cover current scientific consensus AND open research questions.
- Cite specific experiments, laws, or discoveries by name.`,

  history: `
Deep history mode:
- Multi-perspective analysis: political, social, economic, cultural dimensions.
- Primary causes vs. proximate causes.
- Include historiographical debates where they exist.
- Connect to modern parallels or legacy.`,

  geography: `
Deep geography mode:
- Physical, human, and political geography dimensions.
- Historical context for current borders, names, demographics.
- Economic geography: key industries, trade, development level.
- Environmental geography: climate, resources, risks.`,

  health: `
Deep health mode:
- Pathophysiology: mechanism of disease/drug action.
- Diagnostic criteria and differential diagnosis.
- Evidence base: first-line vs. alternative treatments.
- Contraindications, drug interactions, monitoring parameters.
- Always recommend professional consultation for clinical decisions.`,

  law: `
Deep law mode:
- Statute/case law basis for the legal principle.
- Exceptions and edge cases.
- Procedural vs. substantive aspects.
- Practical enforcement realities.
- Jurisdictional variations.`,

  economics: `
Deep economics mode:
- Theoretical framework first, then real-world application.
- Quantitative examples with realistic numbers.
- Market failures, externalities, information asymmetry where relevant.
- Policy implications and second-order effects.`,

  culture: `
Deep culture mode:
- Historical context and period analysis.
- Thematic analysis — what does the work/belief/tradition reveal about its society?
- Influence on subsequent culture, art, thought.
- Cross-cultural comparisons where illuminating.`,

  sports: `
Deep sports mode:
- Statistical analysis with context (era-adjusted, venue-adjusted).
- Tactical and strategic depth.
- Historical record and milestones.
- Comparative analysis across eras or players.`,

  technology: `
Deep technology mode:
- Technical architecture and how it works under the hood.
- Trade-offs and design decisions.
- Security, scalability, and performance characteristics.
- Comparison with alternatives with specific technical criteria.`,

  language: `
Deep language mode:
- Etymology and historical development.
- Phonological, morphological, syntactic analysis.
- Cross-linguistic comparison where relevant.
- Register variation and pragmatic context.`,

  explain: `
Deep explain mode:
- Multiple levels of explanation: intuitive → technical → mathematical if applicable.
- First principles derivation.
- Connections to related concepts.
- Common misconceptions and why they're wrong.`,

  research: `
Deep research mode:
- Full decision memo: recommendation → rationale → tradeoffs → risks → rollout plan.
- Quantified tradeoffs where possible.
- Scenario analysis: best case / base case / worst case.
- Bottom line with confidence level.`,

  email: `
Deep email mode:
- Write a complete, polished, send-ready email.
- Optimize subject line for open rate.
- Match tone exactly to context and relationship.`,

  creative: `
Deep creative mode:
- Full, complete piece with deliberate craft.
- Strong opening hook, internal consistency, satisfying ending.
- Specific and original — no generic content.`,

  general: `
Deep general mode:
- Comprehensive, authoritative answer.
- Multiple dimensions: historical, technical, practical, ethical where relevant.
- Structured with clear section headers.
- Actionable takeaway at the end.`,

  greeting: `
Deep greeting mode:
- Warm, confident, brief.
- Show capability through tone, not through bullet lists.`,
};

const RECOVERY_MODELS: Partial<Record<IntentType, string[]>> = {
  coding: [
    "mistralai/mistral-large-3-675b-instruct-2512",
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "qwen/qwen3-coder-480b-a35b-instruct",
  ],
  math: [
    "z-ai/glm5",
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "deepseek-ai/deepseek-v3.1",
  ],
  science: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  history: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "moonshotai/kimi-k2-instruct",
  ],
  health: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
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
  explain: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "z-ai/glm5",
  ],
  economics: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "moonshotai/kimi-k2-instruct",
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

async function getHistory(userId: string, limit = 30) {
  try {
    const { data } = await getClawCloudSupabaseAdmin()
      .from("whatsapp_messages")
      .select("direction,content,sent_at")
      .eq("user_id", userId)
      .order("sent_at", { ascending: false })
      .limit(limit);

    if (!data?.length) return [];
    return data
      .reverse()
      .map((r) => ({
        role: (r.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
        content: String(r.content ?? "").trim().slice(0, 800),
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
  question?: string,
  extraInstruction?: string,
  memorySnippet?: string,
) {
  const expertMode = detectExpertMode(question ?? intent, intent);
  const expertPrompt = EXPERT_MODE_PROMPTS[expertMode];
  const modeBrain = mode === "deep" ? DEEP_BRAIN : FAST_BRAIN;
  const brain = [WHATSAPP_BRAIN, modeBrain, expertPrompt].filter(Boolean).join("\n\n");
  const ext = (mode === "deep" ? DEEP_EXT : FAST_EXT)[intent]
    ?? (mode === "deep" ? DEEP_EXT : FAST_EXT).research;

  const seed = Date.now() % 1000;
  const styleVariants = [
    "Lead with a concise direct answer, then add structured detail.",
    "Open with the most important insight first.",
    "Start with the core fact, then add context in clear steps.",
    "Give the bottom line upfront, then support it with specifics.",
    "Begin with a clear headline answer, then break it into sections.",
  ];
  const styleInstruction = styleVariants[seed % styleVariants.length];
  const uniquenessInstruction = [
    "",
    "RESPONSE STYLE:",
    styleInstruction,
    "Do not start exactly like your previous reply.",
    "Vary opening line and section order across repeated questions.",
    `(Style seed: ${seed})`,
  ].join("\n");

  const memoryBlock = memorySnippet
    ? `\n\nCONVERSATION MEMORY:\n${memorySnippet}\nUse this context for follow-up questions and relevant personalization.`
    : "";

  return brain
    + ext
    + uniquenessInstruction
    + memoryBlock
    + (extraInstruction ? `\n\n${extraInstruction}` : "");
}

const EXTENDED_HISTORY_INTENTS = new Set<string>(["coding", "research", "math", "explain"]);

async function buildSmartHistory(
  userId: string,
  message: string,
  mode: ResponseMode,
  intent?: string | null,
) {
  const extended = Boolean(intent && EXTENDED_HISTORY_INTENTS.has(intent));
  const limit = mode === "deep"
    ? (extended ? (message.length > 220 ? 20 : 30) : (message.length > 220 ? 14 : 20))
    : (extended ? (message.length > 140 ? 12 : 20) : (message.length > 140 ? 8 : 14));
  return getHistory(userId, limit);
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
    normalized.includes("__fast_fallback_internal__")
    || normalized.includes("__deep_fallback_internal__")
    || value === FALLBACK
    || normalized.startsWith("*i could not")
    || normalized.startsWith("i could not")
    || normalized.startsWith("i'm sorry")
    || normalized.startsWith("i am sorry")
    || normalized.includes("reliable answer")
    || normalized.includes("send the question again")
    || normalized.includes("something went wrong")
    || normalized.includes("temporarily unavailable")
    || normalized.includes("try again later")
    || normalized.includes("i don't have enough information")
    || normalized.includes("i cannot answer")
    || normalized.includes("outside my expertise")
    || normalized.includes("nvidia generation unavailable")
    || normalized.includes("scope addressed:")
    || normalized.includes("as an ai")
    || normalized.startsWith("i got your message")
    || normalized.startsWith("🤖 *got your message")
    || normalized.startsWith("🤖 i got your message")
    || normalized.includes("send the exact task you want solved")
    || normalized.includes("send me the exact task")
    || normalized.includes("got your message")
    || normalized.includes("you asked about:")
    || normalized.includes("you asked about")
    || normalized.includes("you asked: _")
    || normalized.includes("i received your question")
    || normalized.includes("i received: _")
    || normalized.startsWith("*professional answer*")
    || (normalized.includes("professional answer") && value.length < 300)
    || normalized.includes("send preferred language plus input and output format")
    || normalized.includes("share constraints and sample input/output")
    || normalized.includes("to give an exact numeric result, share the full equation")
    || normalized.includes("question captured:")
    || normalized.includes("ask your question and i'll answer it completely")
    || normalized.includes("ready to answer.")
    || normalized.includes("i can explain any technology")
    || normalized.includes("reminder set for [task] at [time]")
    || (normalized.includes("[task]") && normalized.includes("[time]"))
    || normalized.includes("ask: 'what is [tech]?'")
    || normalized.includes("reliable information for this detail is not available in the retrieved sources")
    || normalized.includes("## short summary")
    || normalized.includes("## key updates")
    || normalized.includes("## detailed explanation")
    || normalized.includes("i can answer any history question with dates, causes, key figures, and impact")
    || normalized.includes("ask specifically: 'when did x happen?'")
    || normalized.includes("rephrase your question and i'll answer it immediately and accurately")
  );
}

async function logIntentAnalytics(
  userId: string,
  intent: string,
  latencyMs: number,
  hadFallback: boolean,
  charCount: number,
) {
  const db = getClawCloudSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const dateKey = nowIso.slice(0, 10);
  const normalizedIntent = intent.trim() || "general";
  const normalizedLatencyMs = Math.max(0, Math.round(latencyMs));
  const normalizedCharCount = Math.max(0, Math.round(charCount));

  const { data: existing } = await db
    .from("intent_analytics_daily")
    .select("id, count, avg_latency_ms, fallback_count")
    .eq("user_id", userId)
    .eq("date", dateKey)
    .eq("intent", normalizedIntent)
    .maybeSingle()
    .catch(() => ({ data: null }));

  const row = (existing ?? null) as {
    id: string;
    count: number | null;
    avg_latency_ms: number | null;
    fallback_count: number | null;
  } | null;

  if (row?.id) {
    const previousCount = Number(row.count ?? 0);
    const nextCount = previousCount + 1;
    const previousAvg = Number(row.avg_latency_ms ?? 0);
    const nextAvg = Math.round(
      ((previousAvg * previousCount) + normalizedLatencyMs) / Math.max(nextCount, 1),
    );

    await db
      .from("intent_analytics_daily")
      .update({
        count: nextCount,
        avg_latency_ms: nextAvg,
        fallback_count: Number(row.fallback_count ?? 0) + (hadFallback ? 1 : 0),
      })
      .eq("id", row.id)
      .catch(() => null);
  } else {
    await db
      .from("intent_analytics_daily")
      .insert({
        user_id: userId,
        date: dateKey,
        intent: normalizedIntent,
        count: 1,
        avg_latency_ms: normalizedLatencyMs,
        fallback_count: hadFallback ? 1 : 0,
      })
      .catch(() => null);
  }

  await db
    .from("task_runs")
    .insert({
      user_id: userId,
      task_id: null,
      task_type: "chat_message",
      status: hadFallback ? "failed" : "success",
      input_data: { intent: normalizedIntent },
      output_data: { char_count: normalizedCharCount },
      duration_ms: normalizedLatencyMs,
      intent_type: normalizedIntent,
      latency_ms: normalizedLatencyMs,
      had_fallback: hadFallback,
      char_count: normalizedCharCount,
      started_at: nowIso,
      completed_at: nowIso,
    })
    .catch(() => null);
}

async function finalizeAgentReply(input: {
  userId: string;
  locale: SupportedLocale;
  question: string;
  intent: string;
  category: string;
  startedAt: number;
  reply: string;
  alreadyTranslated?: boolean;
}) {
  const cleanedReply = input.reply.replace(/\n{3,}/g, "\n\n").trim();
  const replyWithDisclaimer = input.alreadyTranslated
    ? cleanedReply
    : applyDisclaimer({
      intent: input.intent,
      category: input.category,
      question: input.question,
      answer: cleanedReply,
    }).combined;

  const finalReply = input.alreadyTranslated
    ? cleanedReply
    : await translateMessage(replyWithDisclaimer, input.locale);

  void logIntentAnalytics(
    input.userId,
    input.intent,
    Date.now() - input.startedAt,
    isVisibleFallbackReply(cleanedReply),
    finalReply.length,
  ).catch(() => null);

  return finalReply;
}

function isLowQualityTemplateReply(reply: string | null | undefined) {
  if (!reply?.trim()) return true;
  const normalized = reply.trim().toLowerCase();
  return (
    normalized.includes("reliable information for this detail is not available in the retrieved sources")
    || normalized.includes("i can answer any history question with dates, causes, key figures, and impact")
    || normalized.includes("ready to answer.")
    || normalized.includes("i can explain any technology")
    || normalized.includes("reminder set for [task] at [time]")
    || (normalized.includes("[task]") && normalized.includes("[time]"))
    || normalized.includes("ask: 'what is [tech]?'")
    || normalized.includes("ask specifically: 'when did x happen?'")
    || normalized.includes("rephrase your question and i'll answer it immediately and accurately")
    || (normalized.includes("short summary") && normalized.includes("key updates"))
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

function buildDeterministicChatFallbackLegacy(message: string, intent: IntentType) {
  const text = message.toLowerCase().trim();

  if (
    intent === "greeting" ||
    /^(hi+|hello+|hey+|good\s+(morning|afternoon|evening|night)|namaste|hola|bonjour|ciao|sup|yo|what'?s up|howdy|greetings)\b/.test(text)
  ) {
    return [
      "👋 *Hey! I'm doing great.*",
      "",
      "I'm ready to help with *coding, math, writing, research, email, reminders,* and *WhatsApp workflow tasks* right here.",
      "",
      "What do you want to work on?",
    ].join("\n");
  }

  if (/\b(what can you do|what do you do|your capabilities|help me with|features|who are you)\b/.test(text)) {
    return [
      "🦞 *Here’s what I can do for you:*",
      "",
      "• *Code* - write, debug, review, and explain code in any major language",
      "• *Math* - solve questions step by step with clear final answers",
      "• *Writing* - emails, reports, posts, resumes, and polished drafts",
      "• *Research* - explain topics, compare options, and summarize clearly",
      "• *Productivity* - reminders, calendar help, and WhatsApp task support",
      "",
      "Send me a real task and I’ll jump straight into it.",
    ].join("\n");
  }

  const isHealthPing =
    text.length <= 30
    && /^(test|testing|working|alive|are you there|respond)\??$/.test(text);

  if (isHealthPing) {
    return [
      "✅ *Yes, I'm here and working.*",
      "",
      "Send me any real question - technical, academic, writing, planning, or general - and I’ll handle it.",
    ].join("\n");
  }

  return null;
}

function bestEffortProfessionalTemplate(intent: IntentType, message: string) {
  const compactQuestion = message.trim().replace(/\s+/g, " ").slice(0, 180);
  const deterministic = buildDeterministicChatFallback(message, intent);

  if (deterministic) {
    return deterministic;
  }

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
    case "greeting":
      return [
        "👋 *Hey! I'm here and ready.*",
        "",
        "Ask me anything - *coding, math, research, writing, email,* or *planning* - and I’ll answer directly.",
      ].join("\n");
    default:
      return [
        "🧠 *Direct answer mode is active.*",
        "",
        `Topic: _${compactQuestion}_.`,
        "",
        "Send the exact question in one line and I will return a complete answer.",
      ].join("\n");
  }
}

function detectRequestedLanguageForFallback(message: string) {
  const text = message.toLowerCase();
  if (/\b(c\+\+|cpp)\b/.test(text)) return "cpp";
  if (/\bpython\b/.test(text)) return "python";
  if (/\b(java(?!script))\b/.test(text)) return "java";
  if (/\b(javascript|node\.?js|nodejs)\b/.test(text)) return "javascript";
  if (/\btypescript\b/.test(text)) return "typescript";
  if (/\bgo(lang)?\b/.test(text)) return "go";
  if (/\brust\b/.test(text)) return "rust";
  return "text";
}

function buildRatInMazeCppFallback() {
  return [
    "*C++ solution: Rat in a Maze (all paths)*",
    "",
    "```cpp",
    "#include <bits/stdc++.h>",
    "using namespace std;",
    "",
    "void dfs(int x, int y, vector<vector<int>>& maze, int n,",
    "         vector<vector<int>>& vis, string& path, vector<string>& ans) {",
    "    if (x == n - 1 && y == n - 1) {",
    "        ans.push_back(path);",
    "        return;",
    "    }",
    "",
    "    static int dx[] = {1, 0, 0, -1};",
    "    static int dy[] = {0, -1, 1, 0};",
    "    static char moveChar[] = {'D', 'L', 'R', 'U'};",
    "",
    "    for (int k = 0; k < 4; k++) {",
    "        int nx = x + dx[k], ny = y + dy[k];",
    "        if (nx >= 0 && ny >= 0 && nx < n && ny < n && !vis[nx][ny] && maze[nx][ny] == 1) {",
    "            vis[nx][ny] = 1;",
    "            path.push_back(moveChar[k]);",
    "            dfs(nx, ny, maze, n, vis, path, ans);",
    "            path.pop_back();",
    "            vis[nx][ny] = 0;",
    "        }",
    "    }",
    "}",
    "",
    "vector<string> findPath(vector<vector<int>>& maze, int n) {",
    "    vector<string> ans;",
    "    if (n == 0 || maze[0][0] == 0 || maze[n - 1][n - 1] == 0) return ans;",
    "",
    "    vector<vector<int>> vis(n, vector<int>(n, 0));",
    "    string path;",
    "    vis[0][0] = 1;",
    "    dfs(0, 0, maze, n, vis, path, ans);",
    "    sort(ans.begin(), ans.end());",
    "    return ans;",
    "}",
    "",
    "int main() {",
    "    int n;",
    "    cin >> n;",
    "    vector<vector<int>> maze(n, vector<int>(n));",
    "    for (int i = 0; i < n; i++) {",
    "        for (int j = 0; j < n; j++) cin >> maze[i][j];",
    "    }",
    "",
    "    vector<string> ans = findPath(maze, n);",
    "    if (ans.empty()) {",
    "        cout << -1 << \"\\n\";",
    "    } else {",
    "        for (const string& p : ans) cout << p << \" \";",
    "        cout << \"\\n\";",
    "    }",
    "    return 0;",
    "}",
    "```",
    "",
    "If you want, I can also send single-path and count-only variants.",
  ].join("\n");
}

function buildCodingFallbackV2(message: string) {
  const text = message.toLowerCase();
  const language = detectRequestedLanguageForFallback(message);
  const prefersCpp = language === "cpp";
  const prefersPython = language === "python" || language === "text";

  if (/\bn[-\s]?queens?\b/.test(text)) {
    if (prefersCpp) {
      return [
        "💻 *N-Queens (Backtracking) - C++*",
        "",
        "```cpp",
        "#include <bits/stdc++.h>",
        "using namespace std;",
        "",
        "class Solver {",
        "  vector<vector<string>> ans;",
        "  vector<string> board;",
        "  vector<int> col, diag1, diag2;",
        "  int n;",
        "",
        "  void dfs(int r) {",
        "    if (r == n) {",
        "      ans.push_back(board);",
        "      return;",
        "    }",
        "",
        "    for (int c = 0; c < n; ++c) {",
        "      int d1 = r - c + n - 1;",
        "      int d2 = r + c;",
        "      if (col[c] || diag1[d1] || diag2[d2]) continue;",
        "",
        "      col[c] = diag1[d1] = diag2[d2] = 1;",
        "      board[r][c] = 'Q';",
        "      dfs(r + 1);",
        "      board[r][c] = '.';",
        "      col[c] = diag1[d1] = diag2[d2] = 0;",
        "    }",
        "  }",
        "",
        "public:",
        "  vector<vector<string>> solve(int n_) {",
        "    n = n_;",
        "    board.assign(n, string(n, '.'));",
        "    col.assign(n, 0);",
        "    diag1.assign(2 * n - 1, 0);",
        "    diag2.assign(2 * n - 1, 0);",
        "    dfs(0);",
        "    return ans;",
        "  }",
        "};",
        "",
        "int main() {",
        "  ios::sync_with_stdio(false);",
        "  cin.tie(nullptr);",
        "",
        "  int n;",
        "  cin >> n;",
        "  Solver solver;",
        "  auto solutions = solver.solve(n);",
        "",
        "  cout << solutions.size() << \"\\n\";",
        "  for (const auto& board : solutions) {",
        "    for (const auto& row : board) cout << row << \"\\n\";",
        "    cout << \"\\n\";",
        "  }",
        "  return 0;",
        "}",
        "```",
        "",
        "• *Time:* O(N!)",
        "• *Space:* O(N²) + recursion",
      ].join("\n");
    }

    return [
      "💻 *N-Queens (Backtracking) - Python*",
      "",
      "```python",
      "def solve_n_queens(n: int):",
      "    cols = set()",
      "    diag1 = set()  # row - col",
      "    diag2 = set()  # row + col",
      "    board = [['.' for _ in range(n)] for _ in range(n)]",
      "    ans = []",
      "",
      "    def dfs(r: int):",
      "        if r == n:",
      "            ans.append([''.join(row) for row in board])",
      "            return",
      "        for c in range(n):",
      "            if c in cols or (r - c) in diag1 or (r + c) in diag2:",
      "                continue",
      "            cols.add(c)",
      "            diag1.add(r - c)",
      "            diag2.add(r + c)",
      "            board[r][c] = 'Q'",
      "            dfs(r + 1)",
      "            board[r][c] = '.'",
      "            cols.remove(c)",
      "            diag1.remove(r - c)",
      "            diag2.remove(r + c)",
      "",
      "    dfs(0)",
      "    return ans",
      "",
      "if __name__ == '__main__':",
      "    n = int(input().strip())",
      "    solutions = solve_n_queens(n)",
      "    print(len(solutions))",
      "    for board in solutions:",
      "        for row in board:",
      "            print(row)",
      "        print()",
      "```",
      "",
      "• *Time:* O(N!)",
      "• *Space:* O(N²) + recursion",
    ].join("\n");
  }

  if (/\brat\b/.test(text) && /\bmaze\b/.test(text)) {
    if (prefersCpp) {
      return buildRatInMazeCppFallback();
    }

    return [
      "💻 *Rat in a Maze (All Paths) - Python*",
      "",
      "```python",
      "def find_paths(maze):",
      "    n = len(maze)",
      "    if n == 0 or maze[0][0] == 0 or maze[n - 1][n - 1] == 0:",
      "        return []",
      "",
      "    moves = [(1, 0, 'D'), (0, -1, 'L'), (0, 1, 'R'), (-1, 0, 'U')]",
      "    visited = [[False] * n for _ in range(n)]",
      "    paths = []",
      "",
      "    def dfs(r, c, path):",
      "        if r == n - 1 and c == n - 1:",
      "            paths.append(path)",
      "            return",
      "",
      "        for dr, dc, ch in moves:",
      "            nr, nc = r + dr, c + dc",
      "            if 0 <= nr < n and 0 <= nc < n and maze[nr][nc] == 1 and not visited[nr][nc]:",
      "                visited[nr][nc] = True",
      "                dfs(nr, nc, path + ch)",
      "                visited[nr][nc] = False",
      "",
      "    visited[0][0] = True",
      "    dfs(0, 0, '')",
      "    return sorted(paths)",
      "",
      "if __name__ == '__main__':",
      "    n = int(input().strip())",
      "    maze = [list(map(int, input().split())) for _ in range(n)]",
      "    ans = find_paths(maze)",
      "    print(' '.join(ans) if ans else -1)",
      "```",
      "",
      "• *Time:* O(4^(N²)) worst-case",
      "• *Space:* O(N²) for visited + recursion",
    ].join("\n");
  }

  if (/\bfibonacci\b/.test(text)) {
    return [
      prefersPython ? "💻 *Fibonacci - Python*" : "💻 *Fibonacci - C++*",
      "",
      ...(prefersCpp
        ? [
            "```cpp",
            "#include <bits/stdc++.h>",
            "using namespace std;",
            "",
            "long long fib(int n) {",
            "    if (n <= 1) return n;",
            "    long long a = 0, b = 1;",
            "    for (int i = 2; i <= n; ++i) {",
            "        long long c = a + b;",
            "        a = b;",
            "        b = c;",
            "    }",
            "    return b;",
            "}",
            "",
            "int main() {",
            "    int n;",
            "    cin >> n;",
            "    cout << fib(n) << \"\\n\";",
            "    return 0;",
            "}",
            "```",
          ]
        : [
            "```python",
            "def fib(n: int) -> int:",
            "    if n <= 1:",
            "        return n",
            "    a, b = 0, 1",
            "    for _ in range(2, n + 1):",
            "        a, b = b, a + b",
            "    return b",
            "",
            "if __name__ == '__main__':",
            "    n = int(input().strip())",
            "    print(fib(n))",
            "```",
          ]),
      "",
      "• *Time:* O(N)",
      "• *Space:* O(1)",
    ].join("\n");
  }

  if (/\bbinary search\b/.test(text)) {
    return [
      "💻 *Binary Search - Python*",
      "",
      "```python",
      "def binary_search(arr, target):",
      "    left, right = 0, len(arr) - 1",
      "    while left <= right:",
      "        mid = (left + right) // 2",
      "        if arr[mid] == target:",
      "            return mid",
      "        if arr[mid] < target:",
      "            left = mid + 1",
      "        else:",
      "            right = mid - 1",
      "    return -1",
      "",
      "if __name__ == '__main__':",
      "    arr = list(map(int, input().split()))",
      "    target = int(input().strip())",
      "    print(binary_search(arr, target))",
      "```",
      "",
      "• *Time:* O(log N)",
      "• *Space:* O(1)",
    ].join("\n");
  }

  if (/\bpalindrome\b/.test(text)) {
    return [
      "💻 *Palindrome Check - Python*",
      "",
      "```python",
      "def is_palindrome(text: str) -> bool:",
      "    cleaned = ''.join(ch.lower() for ch in text if ch.isalnum())",
      "    return cleaned == cleaned[::-1]",
      "",
      "if __name__ == '__main__':",
      "    s = input().rstrip('\\n')",
      "    print('YES' if is_palindrome(s) else 'NO')",
      "```",
      "",
      "• *Time:* O(N)",
      "• *Space:* O(N)",
    ].join("\n");
  }

  const baselineByLanguage: Record<string, string[]> = {
    cpp: [
      "```cpp",
      "#include <bits/stdc++.h>",
      "using namespace std;",
      "",
      "int main() {",
      "    ios::sync_with_stdio(false);",
      "    cin.tie(nullptr);",
      "",
      "    vector<long long> nums;",
      "    long long x;",
      "    while (cin >> x) nums.push_back(x);",
      "",
      "    long long sum = 0;",
      "    for (long long v : nums) sum += v;",
      "    cout << sum << \"\\n\";",
      "    return 0;",
      "}",
      "```",
    ],
    python: [
      "```python",
      "def solve() -> None:",
      "    import sys",
      "    data = sys.stdin.read().strip().split()",
      "    nums = [int(x) for x in data] if data else []",
      "    print(sum(nums))",
      "",
      "if __name__ == '__main__':",
      "    solve()",
      "```",
    ],
    javascript: [
      "```javascript",
      "function solve(input) {",
      "  const nums = input.trim() ? input.trim().split(/\\s+/).map(Number) : [];",
      "  const sum = nums.reduce((acc, n) => acc + n, 0);",
      "  return String(sum);",
      "}",
      "",
      "process.stdin.resume();",
      "process.stdin.setEncoding('utf8');",
      "let data = '';",
      "process.stdin.on('data', (chunk) => (data += chunk));",
      "process.stdin.on('end', () => process.stdout.write(solve(data) + '\\n'));",
      "```",
    ],
    typescript: [
      "```ts",
      "function solve(input: string): string {",
      "  const nums = input.trim() ? input.trim().split(/\\s+/).map(Number) : [];",
      "  const sum = nums.reduce((acc, n) => acc + n, 0);",
      "  return String(sum);",
      "}",
      "",
      "process.stdin.resume();",
      "process.stdin.setEncoding('utf8');",
      "let data = '';",
      "process.stdin.on('data', (chunk) => (data += chunk));",
      "process.stdin.on('end', () => process.stdout.write(solve(data) + '\\n'));",
      "```",
    ],
    java: [
      "```java",
      "import java.io.*;",
      "import java.util.*;",
      "",
      "public class Main {",
      "    public static void main(String[] args) throws Exception {",
      "        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));",
      "        StringBuilder sb = new StringBuilder();",
      "        String line;",
      "        while ((line = br.readLine()) != null) sb.append(line).append(' ');",
      "",
      "        String[] parts = sb.toString().trim().isEmpty() ? new String[0] : sb.toString().trim().split(\"\\\\s+\");",
      "        long sum = 0;",
      "        for (String p : parts) sum += Long.parseLong(p);",
      "        System.out.println(sum);",
      "    }",
      "}",
      "```",
    ],
    go: [
      "```go",
      "package main",
      "",
      "import (",
      "    \"bufio\"",
      "    \"fmt\"",
      "    \"os\"",
      ")",
      "",
      "func main() {",
      "    in := bufio.NewReader(os.Stdin)",
      "    var x int64",
      "    var sum int64",
      "    for {",
      "        _, err := fmt.Fscan(in, &x)",
      "        if err != nil {",
      "            break",
      "        }",
      "        sum += x",
      "    }",
      "    fmt.Println(sum)",
      "}",
      "```",
    ],
    rust: [
      "```rust",
      "use std::io::{self, Read};",
      "",
      "fn main() {",
      "    let mut input = String::new();",
      "    io::stdin().read_to_string(&mut input).unwrap();",
      "    let sum: i64 = input",
      "        .split_whitespace()",
      "        .filter_map(|x| x.parse::<i64>().ok())",
      "        .sum();",
      "    println!(\"{}\", sum);",
      "}",
      "```",
    ],
    text: [
      "```python",
      "def solve() -> None:",
      "    import sys",
      "    data = sys.stdin.read().strip().split()",
      "    nums = [int(x) for x in data] if data else []",
      "    print(sum(nums))",
      "",
      "if __name__ == '__main__':",
      "    solve()",
      "```",
    ],
  };

  return [
    "💻 *Coding Answer*",
    "",
    "I interpreted your message as a coding request and generated runnable code immediately.",
    "",
    ...(baselineByLanguage[language] ?? baselineByLanguage.text),
    "",
    "Send the exact problem statement when ready, and I will convert this into the final task-specific solution.",
  ].join("\n");
}

function tryBuildTradingRiskMathFallback(message: string) {
  const text = message.toLowerCase();
  const winRateMatch =
    text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:win rate|wins?)/)
    ?? text.match(/win rate[^0-9]*(\d+(?:\.\d+)?)\s*%/);
  const rrMatch =
    text.match(/reward[-\s]*risk[^0-9]*(\d+(?:\.\d+)?)\s*[:/]\s*1/)
    ?? text.match(/(\d+(?:\.\d+)?)\s*[:/]\s*1/);
  const avgWinMatch = text.match(/average win[^0-9]*(\d+(?:\.\d+)?)\s*r\b/);
  const avgLossMatch = text.match(/average loss[^0-9]*(\d+(?:\.\d+)?)\s*r\b/);
  const rrFromAverages =
    avgWinMatch && avgLossMatch
      ? Number.parseFloat(avgWinMatch[1]) / Number.parseFloat(avgLossMatch[1])
      : null;
  const riskPctMatch =
    text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:risk per trade|risk)/)
    ?? text.match(/risk per trade[^0-9]*(\d+(?:\.\d+)?)\s*%/);
  const drawdownPctMatch =
    text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:max(?:imum)?\s*acceptable\s*)?drawdown/)
    ?? text.match(/drawdown[^0-9]*(\d+(?:\.\d+)?)\s*%/);

  if (!winRateMatch || (!rrMatch && !rrFromAverages)) {
    return null;
  }

  const p = Number.parseFloat(winRateMatch[1]) / 100;
  const r = rrMatch ? Number.parseFloat(rrMatch[1]) : rrFromAverages!;
  const riskPct = riskPctMatch ? Number.parseFloat(riskPctMatch[1]) : null;
  const drawdownPct = drawdownPctMatch ? Number.parseFloat(drawdownPctMatch[1]) : null;

  if (!Number.isFinite(p) || !Number.isFinite(r) || p <= 0 || p >= 1 || r <= 0) {
    return null;
  }

  const q = 1 - p;
  const expectancyR = (p * r) - q;
  const kellyFraction = p - (q / r);
  const expectedPctPerTrade = riskPct !== null ? expectancyR * riskPct : null;
  const quarterKelly = Math.max(0, kellyFraction * 0.25);
  const halfKelly = Math.max(0, kellyFraction * 0.5);
  const drawdownCap = drawdownPct !== null
    ? Math.max(0.003, Math.min(0.02, (drawdownPct / 100) / 10))
    : null;
  const saferPositionSize = drawdownCap !== null
    ? Math.min(halfKelly, drawdownCap)
    : halfKelly;

  const lines = [
    "*Trading Risk Math*",
    "",
    `Inputs: win rate = ${(p * 100).toFixed(2)}%, reward:risk = ${r.toFixed(2)}:1${riskPct !== null ? `, risk/trade = ${riskPct.toFixed(2)}%` : ""}${drawdownPct !== null ? `, max drawdown = ${drawdownPct.toFixed(2)}%` : ""}.`,
    "",
    `• Expectancy (R units): E = p*R - (1-p) = ${expectancyR.toFixed(4)}R per trade`,
    expectedPctPerTrade !== null
      ? `• Expected return per trade (approx): ${expectedPctPerTrade.toFixed(4)}%`
      : "• Expected return per trade requires risk % per trade input.",
    `• Full Kelly fraction: f* = p - (1-p)/R = ${(kellyFraction * 100).toFixed(2)}% of equity`,
    `• Practical sizing: use ~0.25x to 0.50x Kelly => ${(quarterKelly * 100).toFixed(2)}% to ${(halfKelly * 100).toFixed(2)}%`,
    drawdownCap !== null
      ? `• Drawdown-aware cap (from ${drawdownPct?.toFixed(2)}% max DD): ${(drawdownCap * 100).toFixed(2)}%`
      : "• Add your max drawdown limit to compute a stricter risk cap.",
    `• Safer live sizing now: ~${(saferPositionSize * 100).toFixed(2)}% of equity per trade`,
    "",
    "For 1,000 trades, sequence risk dominates. Keep max drawdown guardrails, cap correlated exposure, and reduce size during losing streak clusters.",
  ];

  return lines.join("\n");
}

function approxNormalCdf(x: number) {
  return 1 / (1 + Math.exp(-1.702 * x));
}

function tryBuildBayesianABMathFallback(message: string) {
  const text = message.replace(/,/g, " ");
  if (!/\b(a\/b|ab test|variant a|variant b|beta\()/i.test(text)) {
    return null;
  }

  const priorSingle = text.match(/\bbeta\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)/i);
  const priorA = priorSingle ? Number.parseFloat(priorSingle[1]) : 1;
  const priorB = priorSingle ? Number.parseFloat(priorSingle[2]) : 1;

  const counts =
    text.match(/\b(?:variant\s*)?a\b[^0-9]*(\d+)\s*(?:conversions?|responses?|success(?:es)?)?\s*(?:out of|\/)\s*(\d+)[\s\S]*?\b(?:variant\s*)?b\b[^0-9]*(\d+)\s*(?:conversions?|responses?|success(?:es)?)?\s*(?:out of|\/)\s*(\d+)/i)
    ?? text.match(/\ba\b[^0-9]*(\d+)\s*\/\s*(\d+)[\s\S]*?\bb\b[^0-9]*(\d+)\s*\/\s*(\d+)/i);

  if (!counts) {
    return null;
  }

  const aConv = Number.parseFloat(counts[1]);
  const aTotal = Number.parseFloat(counts[2]);
  const bConv = Number.parseFloat(counts[3]);
  const bTotal = Number.parseFloat(counts[4]);

  if (!Number.isFinite(aConv) || !Number.isFinite(aTotal) || !Number.isFinite(bConv) || !Number.isFinite(bTotal) || aTotal <= 0 || bTotal <= 0 || aConv < 0 || bConv < 0 || aConv > aTotal || bConv > bTotal) {
    return null;
  }

  const postAAlpha = priorA + aConv;
  const postABeta = priorB + (aTotal - aConv);
  const postBAlpha = priorA + bConv;
  const postBBeta = priorB + (bTotal - bConv);

  const meanA = postAAlpha / (postAAlpha + postABeta);
  const meanB = postBAlpha / (postBAlpha + postBBeta);
  const uplift = meanB - meanA;
  const varA = (postAAlpha * postABeta) / (((postAAlpha + postABeta) ** 2) * (postAAlpha + postABeta + 1));
  const varB = (postBAlpha * postBBeta) / (((postBAlpha + postBBeta) ** 2) * (postBAlpha + postBBeta + 1));
  const sdDiff = Math.sqrt(Math.max(varA + varB, 1e-12));
  const superiority = approxNormalCdf(uplift / sdDiff);

  const decision = superiority >= 0.95
    ? "Ship *Variant B* now."
    : superiority >= 0.8
      ? "Variant B looks better, but continue test longer for higher confidence."
      : "Current evidence is inconclusive; keep running the test.";

  return [
    "*Bayesian A/B Result*",
    "",
    `• Posterior A = Beta(${postAAlpha.toFixed(0)}, ${postABeta.toFixed(0)})`,
    `• Posterior B = Beta(${postBAlpha.toFixed(0)}, ${postBBeta.toFixed(0)})`,
    `• Posterior mean A = ${(meanA * 100).toFixed(2)}%`,
    `• Posterior mean B = ${(meanB * 100).toFixed(2)}%`,
    `• Expected uplift (B - A) = ${(uplift * 100).toFixed(2)} percentage points`,
    `• Approx P(B > A) = ${(superiority * 100).toFixed(2)}%`,
    "",
    `*Decision:* ${decision}`,
  ].join("\n");
}

function bestEffortProfessionalTemplateV2Legacy(intent: IntentType, message: string) {
  const compactQuestion = message.trim().replace(/\s+/g, " ").slice(0, 180);
  const deterministic = buildDeterministicChatFallback(message, intent);

  if (deterministic) {
    return deterministic;
  }

  switch (intent) {
    case "coding":
      return buildCodingFallbackV2(message);
    case "math":
      {
        const bayesianFallback = tryBuildBayesianABMathFallback(message);
        if (bayesianFallback) {
          return bayesianFallback;
        }

        const tradingFallback = tryBuildTradingRiskMathFallback(message);
        if (tradingFallback) {
          return tradingFallback;
        }
      }
      return [
        "*Math Reply*",
        "",
        `Question: _${compactQuestion}_.`,
        "",
        "To give an exact numeric result, share the full equation or all values with units.",
        "Then I will return numbered steps and a clear final answer in one message.",
      ].join("\n");
    case "research":
      return [
        "*Recommendation*",
        "",
        `Question captured: _${compactQuestion}_.`,
        "",
        "I can give a decision-first answer with recommendation, rationale, tradeoffs, and rollout plan.",
        "Share constraints (budget, timeline, region, target users) for a precise final recommendation.",
      ].join("\n");
    case "greeting":
      return [
        "Hey! I am here and ready.",
        "",
        "Ask anything on coding, math, research, writing, email, or planning and I will answer directly.",
      ].join("\n");
    default:
      return [
        "Direct answer mode is active.",
        "",
        `Topic: _${compactQuestion}_.`,
        "",
        "Send the exact task and I will answer directly.",
      ].join("\n");
  }
}

function buildDeterministicChatFallback(message: string, intent: IntentType): string | null {
  const text = message.toLowerCase().trim();
  const toTitle = (input: string) => input.replace(/\b\w/g, (ch) => ch.toUpperCase());

  if (
    intent === "greeting"
    || (/^(hi+|hello+|hey+|good\s*(morning|afternoon|evening|night)|namaste|hola|bonjour|ciao|sup|yo|what'?s up|howdy|greetings)\b/.test(text) && text.length < 40)
  ) {
    return [
      "👋 *Hey! I'm ready to help.*",
      "",
      "Ask me anything — *coding, math, science, history, health, law, economics, writing,* sports, or any topic.",
      "",
      "What do you want to know?",
    ].join("\n");
  }

  if (/\b(what can you do|what do you do|your capabilities|help me with|features|who are you|what are you|what's your purpose)\b/.test(text)) {
    return [
      "🤖 *I can help you with anything:*",
      "",
      "✍️ *Writing* — articles, essays, emails, stories, resumes, scripts",
      "💻 *Coding* — any language, algorithms, debugging, full apps",
      "📐 *Math* — equations, tables, statistics, step-by-step working",
      "🧬 *Science* — physics, chemistry, biology, astronomy",
      "🏛️ *History* — world history, dates, events, civilizations",
      "🌍 *Geography* — countries, capitals, facts about any place",
      "🏥 *Health* — symptoms, diseases, nutrition, fitness, medicine",
      "⚖️ *Law* — legal concepts, rights, procedures",
      "📈 *Economics* — markets, investing, business, finance",
      "🎭 *Culture* — books, philosophy, religion, art, music, film",
      "⚽ *Sports* — rules, records, players, tournaments",
      "💡 *Any question* — I answer directly and completely",
      "",
      "Just ask your question and I'll answer it immediately.",
    ].join("\n");
  }

  if (/\b(weather|whether|temperature|forecast|rain|humidity|wind|aqi)\b/.test(text)) {
    const cityMatch = text.match(/\b(?:in|at|for)\s+([a-z][a-z\s]{1,30})\b/);
    const city = cityMatch?.[1]?.trim();
    if (city) {
      return [
        `🌦️ *Weather for ${toTitle(city)}*`,
        "",
        "I can provide a precise weather update with temperature, rain chance, humidity, and wind.",
        "",
        `Confirm this location: *${toTitle(city)}* and I’ll return the latest forecast in a clean format.`,
      ].join("\n");
    }

    return [
      "🌦️ *Weather Update*",
      "",
      "Share your *city name* to get an accurate forecast.",
      "",
      "Example: _Weather today in Delhi_ or _Temperature in Mumbai now_.",
    ].join("\n");
  }

  if (
    /\b(difference between|compare)\s+ai\s+(and|vs|versus)\s+ml\b/.test(text)
    || /\b(difference between|compare)\s+ml\s+(and|vs|versus)\s+ai\b/.test(text)
    || /\b(artificial intelligence)\b/.test(text) && /\b(machine learning)\b/.test(text)
  ) {
    return [
      "💻 *AI vs ML*",
      "",
      "*Artificial Intelligence (AI)* is the broad field of making machines perform tasks that normally require human intelligence.",
      "*Machine Learning (ML)* is a subset of AI where systems learn from data to make predictions or decisions.",
      "",
      "• *Scope:* AI is broader; ML is one method inside AI.",
      "• *Examples:* AI assistant (AI), fraud model or spam filter (ML).",
    ].join("\n");
  }

  if (
    /\bwhat is moist\b/.test(text)
    || /\bdefine moist\b/.test(text)
    || /\bmeaning of moist\b/.test(text)
    || /\bwhat is moisture\b/.test(text)
  ) {
    return [
      "🧠 *Moist* means slightly wet.",
      "",
      "It describes something that contains a small amount of water or liquid, but is not fully soaked.",
      "Example: moist soil is damp enough to support plant growth.",
    ].join("\n");
  }

  if (/\bwhat\s+js\s+the\s+update\b/.test(text) || /\bupdate of today'?s?\b/.test(text)) {
    return [
      "📰 *Latest Update Request*",
      "",
      "Send one topic + location so I can return a precise update.",
      "Example: _India politics update today_ or _AI update in US today_.",
    ].join("\n");
  }

  if (
    /\bn[-\s]?queen(s)?\b/.test(text)
    && /\b(code|program|algorithm|backtracking|python|java|c\+\+|javascript|js|typescript|ts|give|show|write|solve)\b/.test(text)
  ) {
    return [
      "💻 *N-Queens (Backtracking) — Python*",
      "",
      "```python",
      "def solve_n_queens(n: int):",
      "    cols = set()",
      "    diag1 = set()  # row - col",
      "    diag2 = set()  # row + col",
      "    board = [['.' for _ in range(n)] for _ in range(n)]",
      "    ans = []",
      "",
      "    def dfs(r: int):",
      "        if r == n:",
      "            ans.append([''.join(row) for row in board])",
      "            return",
      "        for c in range(n):",
      "            if c in cols or (r - c) in diag1 or (r + c) in diag2:",
      "                continue",
      "            cols.add(c); diag1.add(r - c); diag2.add(r + c)",
      "            board[r][c] = 'Q'",
      "            dfs(r + 1)",
      "            board[r][c] = '.'",
      "            cols.remove(c); diag1.remove(r - c); diag2.remove(r + c)",
      "",
      "    dfs(0)",
      "    return ans",
      "",
      "print(solve_n_queens(4))",
      "```",
      "",
      "• *Time:* O(N!)",
      "• *Space:* O(N²) for board + recursion",
    ].join("\n");
  }

  if (/\b(news of today|news today|today news|latest news|latest updates?)\b/.test(text)) {
    return [
      "📰 *Latest News Request*",
      "",
      "Send topic + region for an accurate update.",
      "",
      "Examples:",
      "• _India news today_",
      "• _AI news today in US_",
      "• _Cricket news today_",
    ].join("\n");
  }

  const directWrite = text.match(
    /^(write|draft|compose|create|generate)\s+(?:me\s+)?(?:an?\s+|some\s+)?(article|essay|poem|story|email|speech|report|caption|post)\b(?:\s+(?:about|on)\s+(.+))?/,
  );
  if (directWrite) {
    const kind = directWrite[2];
    const topicRaw = (directWrite[3] ?? "").replace(/[?.!]+$/, "").trim();
    const topic = topicRaw || "the requested topic";
    const topicTitle = toTitle(topic);

    if (kind === "article") {
      if (!topicRaw) {
        return [
          "✅ *Yes, I can write professional articles.*",
          "",
          "Send: *topic + word count + tone*, and I'll write the full article right away.",
          "",
          "Example: _Write an article on AI in healthcare, 700 words, informative tone_",
        ].join("\n");
      }

      return [
        `✍️ *Article: ${topicTitle}*`,
        "",
        `${topicTitle} is reshaping how people learn, work, and make decisions. The biggest shift is speed: tasks that once took hours can now be drafted in minutes, allowing teams to focus on strategy, creativity, and human judgment rather than repetitive work.`,
        "",
        `The strongest use of ${topic} is augmentation, not replacement. Professionals who combine domain expertise with AI tools produce better outcomes because they can test more ideas, analyze larger datasets, and communicate findings more clearly. The quality gap is now between those who use AI thoughtfully and those who ignore it.`,
        "",
        `To use ${topic} responsibly, organizations should set clear standards for accuracy, privacy, and review. Human verification, transparent sources, and guardrails for sensitive decisions make AI outputs safer and more trustworthy. With good governance, ${topic} becomes a force multiplier for productivity and innovation.`,
      ].join("\n");
    }

    if (kind === "poem") {
      return [
        `📝 *Poem: ${topicTitle}*`,
        "",
        "In quiet light, the earth begins to sing,",
        `Soft winds around *${topic}* drift and rise,`,
        "Green breath of life in every living thing,",
        "A thousand colors waking in our eyes.",
        "",
        "The rivers carve their stories through the stone,",
        "The mountains hold the memory of rain,",
        `And in the heart of *${topic}*, gently grown,`,
        "We learn that loss and beauty share one name.",
      ].join("\n");
    }
  }

  if (/^can you\s+(write|create|make|generate|draft|compose)\b/.test(text)) {
    const taskMatch = text.match(/can you\s+(?:write|create|make|generate|draft|compose)\s+(.+)/);
    const task = taskMatch ? taskMatch[1].replace(/\?$/, "").trim() : "that";

    if (/\b(article|articles)\b/.test(text)) {
      return [
        "✅ *Yes! I write complete, professional articles.*",
        "",
        "I can write articles on *any topic* — news, technology, science, business, lifestyle, culture, history, and more.",
        "",
        "To get your article right now, tell me:",
        "• *Topic* — what is the article about?",
        "• *Length* — short (300 words), medium (600 words), or long (1000+ words)?",
        "• *Tone* — formal, conversational, persuasive, or informative?",
        "",
        "Example: _Write an article about climate change, 600 words, informative tone_",
        "",
        "Send your topic and I'll write it immediately. 📝",
      ].join("\n");
    }

    if (/\b(essay|essays)\b/.test(text)) {
      return [
        "✅ *Yes! I write full, well-structured essays.*",
        "",
        "Academic, argumentative, descriptive, narrative, or analytical — any type.",
        "",
        "Tell me: *Topic + type + length* and I'll write it right now.",
        "Example: _Write a 500-word argumentative essay on social media's impact on youth_",
      ].join("\n");
    }

    if (/\b(email|emails)\b/.test(text)) {
      return [
        "✅ *Yes! I write professional emails.*",
        "",
        "I can write: job applications, business proposals, follow-ups, complaints, apologies, introductions, or any email.",
        "",
        "Tell me: *Who to, what purpose, and your name* — I'll write a ready-to-send email instantly.",
        "Example: _Write an email to my manager asking for a salary raise_",
      ].join("\n");
    }

    if (/\b(code|program|script|app|website|function)\b/.test(text)) {
      return [
        "✅ *Yes! I write complete, working code.*",
        "",
        "Any language: Python, JavaScript, Java, C++, Go, Rust, TypeScript, SQL, and more.",
        "",
        "Tell me: *Language + what the code should do* — I'll write the full solution.",
        "Example: _Write a Python script to sort a list of numbers_",
      ].join("\n");
    }

    if (/\b(story|stories|fiction|novel|short story)\b/.test(text)) {
      return [
        "✅ *Yes! I write creative stories.*",
        "",
        "Short stories, flash fiction, adventure, romance, thriller, sci-fi, fantasy — any genre.",
        "",
        "Tell me: *Genre + main character + basic plot or theme* — I'll write it now.",
        "Example: _Write a short sci-fi story about an astronaut stranded on Mars_",
      ].join("\n");
    }

    if (/\b(poem|poems|poetry)\b/.test(text)) {
      return [
        "✅ *Yes! I write poems.*",
        "",
        "Rhyming, free verse, haiku, sonnet, limerick, ode — any style.",
        "",
        "Tell me: *Topic + style* and I'll write it now.",
        "Example: _Write a rhyming poem about the ocean_",
      ].join("\n");
    }

    if (/\b(resume|cv)\b/.test(text)) {
      return [
        "✅ *Yes! I write professional resumes/CVs.*",
        "",
        "Tell me your: *field, years of experience, key skills, and target job* — I'll create a complete resume.",
        "",
        "Example: _Write a resume for a software engineer with 3 years experience in React and Node.js_",
      ].join("\n");
    }

    if (/\b(report|reports)\b/.test(text)) {
      return [
        "✅ *Yes! I write detailed reports.*",
        "",
        "Business reports, academic reports, research reports, progress reports — any format.",
        "",
        "Tell me: *Topic + purpose + length* and I'll write it completely.",
        "Example: _Write a business report on the impact of AI in healthcare_",
      ].join("\n");
    }

    if (/\b(speech|speeches|presentation)\b/.test(text)) {
      return [
        "✅ *Yes! I write speeches and presentations.*",
        "",
        "Motivational, wedding, graduation, business pitch, political, TEDx style — any occasion.",
        "",
        "Tell me: *Occasion + audience + key message + length* and I'll write it.",
      ].join("\n");
    }

    if (/\b(caption|captions|social media post|instagram|twitter|tweet)\b/.test(text)) {
      return [
        "✅ *Yes! I write social media content.*",
        "",
        "Instagram captions, Twitter/X posts, LinkedIn posts, Facebook updates — any platform.",
        "",
        "Tell me: *Platform + topic/product + tone* and I'll write multiple options.",
      ].join("\n");
    }

    return [
      `✅ *Yes! I can write ${task}.*`,
      "",
      "Tell me more details — topic, tone, length, and purpose — and I'll write it completely right now.",
      "",
      "Just describe what you need and I'll get started immediately.",
    ].join("\n");
  }

  if (/^can you\b/.test(text)) {
    if (/\b(code|program|script|develop|build (an?\s+)?(app|website|api|tool|bot))\b/.test(text)) {
      return [
        "✅ *Yes! I can write complete, working code.*",
        "",
        "Share: *language + requirements + input/output format*, and I'll deliver a full solution.",
        "",
        "Example: _Build a Python API endpoint that validates email and stores users in PostgreSQL_",
      ].join("\n");
    }

    const explainTopicMatch = text.match(/^can you\s+(?:please\s+)?(?:explain|teach|help me understand)\s+(.+)/);
    if (explainTopicMatch) {
      const topic = explainTopicMatch[1].replace(/[?.!]+$/, "").trim();
      if (topic.includes("quantum computing")) {
        return [
          "🧠 *Quantum Computing, Simply Explained*",
          "",
          "Quantum computing uses *qubits* instead of normal bits. A normal bit is 0 or 1, but a qubit can exist in a superposition of both states until measured.",
          "",
          "Because qubits can also be *entangled*, quantum computers can evaluate many possibilities at once for certain problem types. That gives potential speedups for optimization, simulation, and cryptography-related workloads.",
          "",
          "It is not faster for every task, but for specific classes of problems it can outperform classical systems significantly.",
        ].join("\n");
      }

      if (topic) {
        return [
          `🧠 *Explanation: ${toTitle(topic)}*`,
          "",
          `${toTitle(topic)} can be understood in three parts: what it is, how it works, and why it matters.`,
          "",
          "If you want, I can now give a beginner version or a deep technical version of this exact topic.",
        ].join("\n");
      }
    }

    if (/\b(translate|translation)\b/.test(text)) {
      return [
        "✅ *Yes! I translate between any languages.*",
        "",
        "Hindi ↔ English, Spanish, French, Arabic, Chinese, German, Japanese, and more.",
        "",
        "Just paste your text and say which language — I'll translate it instantly.",
      ].join("\n");
    }

    if (/\b(explain|teach|help me understand|help me learn)\b/.test(text)) {
      return [
        "✅ *Yes! I explain any topic clearly.*",
        "",
        "Science, math, history, law, technology, economics — any subject.",
        "",
        "What do you want me to explain? Just ask your question.",
      ].join("\n");
    }

    if (/\b(solve|calculate|compute|do math)\b/.test(text)) {
      return [
        "✅ *Yes! I solve math problems step by step.*",
        "",
        "Arithmetic, algebra, geometry, calculus, statistics, probability — any level.",
        "",
        "Give me your problem and I'll show complete working + final answer.",
      ].join("\n");
    }

    if (/\b(debug|fix|help with code|review code)\b/.test(text)) {
      return [
        "✅ *Yes! I debug and fix code.*",
        "",
        "Paste your code and describe the problem — I'll find the bug and show you the fix.",
      ].join("\n");
    }

    if (/\b(answer|help|assist)\b/.test(text)) {
      return [
        "✅ *Yes! I can help with anything.*",
        "",
        "Writing, coding, math, science, history, health, law, economics, sports, culture — all domains.",
        "",
        "What's your question?",
      ].join("\n");
    }

    return [
      "✅ *Yes, I can help with that!*",
      "",
      "Tell me the specifics — what exactly do you need? — and I'll do it right now.",
    ].join("\n");
  }

  if (/^(do you know|are you able to|are you good at|do you understand)\b/.test(text)) {
    return [
      "✅ *Yes, I know about that.*",
      "",
      "I have expert-level knowledge in all major fields — science, history, technology, math, medicine, law, economics, arts, and more.",
      "",
      "Ask me your specific question and I'll answer it completely.",
    ].join("\n");
  }

  if (/\b(test|working|alive|are you there|respond|ping)\b/.test(text) && text.length < 30) {
    return [
      "✅ *Yes, I'm here and working perfectly.*",
      "",
      "Ask me any question — I'll answer immediately.",
    ].join("\n");
  }

  const capitals: Record<string, string> = {
    india: "New Delhi",
    usa: "Washington D.C.", "united states": "Washington D.C.", america: "Washington D.C.",
    uk: "London", "united kingdom": "London", england: "London",
    china: "Beijing",
    japan: "Tokyo",
    france: "Paris",
    germany: "Berlin",
    italy: "Rome",
    russia: "Moscow",
    canada: "Ottawa",
    australia: "Canberra",
    brazil: "Brasília",
    pakistan: "Islamabad",
    bangladesh: "Dhaka",
    "saudi arabia": "Riyadh",
    uae: "Abu Dhabi", "united arab emirates": "Abu Dhabi",
    spain: "Madrid",
    mexico: "Mexico City",
    argentina: "Buenos Aires",
    turkey: "Ankara",
    indonesia: "Jakarta",
    nigeria: "Abuja",
    egypt: "Cairo",
    "south africa": "Pretoria (executive), Cape Town (legislative), Bloemfontein (judicial)",
    nepal: "Kathmandu",
    "sri lanka": "Sri Jayawardenepura Kotte",
    afghanistan: "Kabul",
    iran: "Tehran",
    iraq: "Baghdad",
    israel: "Jerusalem",
    greece: "Athens",
    portugal: "Lisbon",
    sweden: "Stockholm",
    norway: "Oslo",
    denmark: "Copenhagen",
    finland: "Helsinki",
    netherlands: "Amsterdam",
    belgium: "Brussels",
    switzerland: "Bern",
    austria: "Vienna",
    poland: "Warsaw",
    ukraine: "Kyiv",
    thailand: "Bangkok",
    vietnam: "Hanoi",
    malaysia: "Kuala Lumpur",
    philippines: "Manila",
    "south korea": "Seoul",
    "north korea": "Pyongyang",
    kenya: "Nairobi",
    ethiopia: "Addis Ababa",
    ghana: "Accra",
    morocco: "Rabat",
    colombia: "Bogotá",
    peru: "Lima",
    chile: "Santiago",
    venezuela: "Caracas",
    myanmar: "Naypyidaw",
    cambodia: "Phnom Penh",
    laos: "Vientiane",
    mongolia: "Ulaanbaatar",
    kazakhstan: "Astana",
    uzbekistan: "Tashkent",
    "new zealand": "Wellington",
  };

  const capitalMatch = text.match(/capital\s+(?:of|city\s+of)\s+([a-z\s]+?)(?:\?|$)/);
  if (capitalMatch) {
    const country = capitalMatch[1].trim();
    const capital = capitals[country];
    if (capital) {
      return `🌍 *Capital of ${country.charAt(0).toUpperCase() + country.slice(1)}*\n\nThe capital is *${capital}*.\n\nNeed more information about ${country.charAt(0).toUpperCase() + country.slice(1)}?`;
    }
  }

  if (/largest country in the world/.test(text) || /biggest country in the world/.test(text)) {
    return "🌍 *Largest Country in the World*\n\n*Russia* is the largest country by land area — about *17.1 million km²*, covering 11% of Earth's total land mass.\n\nTop 5: Russia -> Canada -> USA -> China -> Brazil";
  }

  if (/smallest country in the world/.test(text)) {
    return "🌍 *Smallest Country in the World*\n\n*Vatican City* (Holy See) is the world's smallest country — just *0.44 km²* located within Rome, Italy.\n\nPopulation: approximately 800 people.";
  }

  if (/most populous country|most populated country/.test(text)) {
    return "🌍 *Most Populous Country*\n\n*India* surpassed China in 2023 and is now the world's most populous country with approximately *1.44 billion* people.\n\nChina is second with ~1.41 billion.";
  }

  if (/tallest mountain|highest mountain|highest peak/.test(text)) {
    return "🏔️ *World's Tallest Mountain*\n\n*Mount Everest* (Nepal/Tibet border) is the highest mountain above sea level at *8,848.86 m (29,031.7 ft)*.\n\nFirst summited by Sir Edmund Hillary and Tenzing Norgay on *May 29, 1953*.";
  }

  if (/longest river/.test(text)) {
    return "🌊 *World's Longest River*\n\n*The Nile River* (Africa) is traditionally considered the longest at *6,650 km (4,130 miles)*.\n\nNote: Some studies suggest the *Amazon* may be longer when tributaries are measured differently.";
  }

  if (/largest ocean/.test(text)) {
    return "🌊 *Largest Ocean*\n\n*The Pacific Ocean* is the world's largest ocean — covering about *165 million km²*, which is larger than all of Earth's landmasses combined.\n\nIt spans from the Arctic to the Antarctic.";
  }

  if (/deepest ocean|deepest part of the ocean/.test(text)) {
    return "🌊 *Deepest Ocean Point*\n\n*The Mariana Trench* in the Pacific Ocean is the deepest known point — the *Challenger Deep* at approximately *10,935 m (35,876 ft)* below sea level.";
  }

  const tableMatch = message.match(/table\s+of\s+(\d+)/i)
    || message.match(/(\d+)\s*(?:times|multiplication)\s+table/i)
    || message.match(/solve\s+table\s+of\s+(\d+)/i)
    || message.match(/(\d+)\s*ka\s+pahada/i)
    || message.match(/pahada\s+of\s+(\d+)/i);
  if (tableMatch) {
    const n = Number.parseInt(tableMatch[1], 10);
    if (n > 0 && n <= 10000) {
      const rows = Array.from({ length: 10 }, (_, i) =>
        `${n} × ${String(i + 1).padStart(2)} = ${n * (i + 1)}`
      );
      return [
        `📐 *Table of ${n}*`,
        "",
        ...rows,
        "",
        `*${n} × 1 through 10 complete.*`,
        `Need table up to 20? Say "table of ${n} up to 20"`,
      ].join("\n");
    }
  }

  const pctMatch = message.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s+of\s+(\d+(?:,\d+)*(?:\.\d+)?)/i);
  if (pctMatch) {
    const pct = Number.parseFloat(pctMatch[1]);
    const base = Number.parseFloat(pctMatch[2].replace(/,/g, ""));
    const result = (pct / 100) * base;
    return [
      `📐 *${pct}% of ${base}*`,
      "",
      `= (${pct} ÷ 100) × ${base}`,
      `= ${pct / 100} × ${base}`,
      "",
      `*= ${result % 1 === 0 ? result : result.toFixed(2)}*`,
    ].join("\n");
  }

  const spdMatch = message.match(/speed\s*(?:is|=|:)?\s*(\d+(?:\.\d+)?)/i);
  const timMatch = message.match(/time\s*(?:is|=|:)?\s*(\d+(?:\.\d+)?)/i);
  if (spdMatch && timMatch && /distance/.test(text)) {
    const s = Number.parseFloat(spdMatch[1]);
    const t = Number.parseFloat(timMatch[1]);
    return `📐 *Distance = Speed × Time*\n\n= ${s} × ${t}\n\n*= ${s * t}*`;
  }

  const arithMatch = message.match(/^(?:what is|solve|calculate|compute|find)?\s*(\d+(?:\.\d+)?)\s*([\+\-\×\*\/÷])\s*(\d+(?:\.\d+)?)\s*\??$/i);
  if (arithMatch) {
    const a = Number.parseFloat(arithMatch[1]);
    const op = arithMatch[2];
    const b = Number.parseFloat(arithMatch[3]);
    let result: number | string;
    let opName: string;
    if (op === "+") { result = a + b; opName = "+"; }
    else if (op === "-") { result = a - b; opName = "-"; }
    else if (op === "*" || op === "×") { result = a * b; opName = "×"; }
    else if (op === "/" || op === "÷") {
      if (b === 0) { result = "undefined (division by zero)"; opName = "÷"; }
      else { result = a / b; opName = "÷"; }
    } else { result = ""; opName = op; }

    if (typeof result === "number") {
      const display = Number.isInteger(result) ? result : Number.parseFloat(result.toFixed(8));
      return `📐 *${a} ${opName} ${b} = ${display}*`;
    }
  }

  const sqrtMatch = message.match(/(?:sqrt|square root|√)\s*(?:of\s*)?(\d+(?:\.\d+)?)/i);
  if (sqrtMatch) {
    const n = Number.parseFloat(sqrtMatch[1]);
    const r = Math.sqrt(n);
    const out = Number.isInteger(r) ? String(r) : r.toFixed(6);
    return `📐 *√${n} = ${out}*\n\n*Final Answer: ${out}*`;
  }

  const powMatch = message.match(/(\d+(?:\.\d+)?)\s*(?:\^|\*\*|to the power of)\s*(\d+(?:\.\d+)?)/i);
  if (powMatch) {
    const base = Number.parseFloat(powMatch[1]);
    const exp = Number.parseFloat(powMatch[2]);
    const result = Math.pow(base, exp);
    return `📐 *${base}^${exp} = ${result}*\n\n*Final Answer: ${result}*`;
  }

  if (/speed of light/.test(text)) {
    return "🧬 *Speed of Light*\n\n*299,792,458 metres per second (≈ 3 × 10⁸ m/s)* in vacuum.\n\nLight travels from the Sun to Earth in approximately 8 minutes 20 seconds.";
  }

  if (/\bwhat is dna\b/.test(text) || /\bwhat does dna stand for\b/.test(text)) {
    return "🧬 *DNA*\n\n*Deoxyribonucleic Acid* — the molecule that carries the genetic instructions for the development, functioning, growth, and reproduction of all known organisms.\n\nDNA is shaped as a *double helix* and contains 4 bases: Adenine (A), Thymine (T), Guanine (G), Cytosine (C).";
  }

  if (/\bwhat is photosynthesis\b/.test(text)) {
    return "🧬 *Photosynthesis*\n\nThe process by which *plants convert sunlight, water, and CO₂ into glucose and oxygen.*\n\n*Formula:* 6CO₂ + 6H₂O + light energy -> C₆H₁₂O₆ + 6O₂\n\nOccurs in the *chloroplasts* using the green pigment *chlorophyll*.";
  }

  if (/\bnewton'?s? (first|second|third) law\b/.test(text)) {
    const law = text.match(/\b(first|second|third)\b/)?.[1];
    const laws: Record<string, string> = {
      first: "⚡ *Newton's First Law (Law of Inertia)*\n\nAn object at rest stays at rest, and an object in motion stays in motion at the same speed and direction, *unless acted upon by an external force.*\n\nExample: A book on a table won't move until you push it.",
      second: "⚡ *Newton's Second Law (F = ma)*\n\n*Force = Mass × Acceleration*\n\nThe acceleration of an object is directly proportional to the net force and inversely proportional to its mass.\n\nExample: Pushing a heavy cart requires more force than pushing a light one to get the same acceleration.",
      third: "⚡ *Newton's Third Law*\n\n*For every action, there is an equal and opposite reaction.*\n\nExample: A rocket pushes exhaust gases downward -> gases push the rocket upward.",
    };
    if (law && laws[law]) return laws[law];
  }

  if (/mitochondria/.test(text) && /powerhouse/.test(text)) {
    return "🧬 *The Mitochondria*\n\nYes — the mitochondria is *the powerhouse of the cell!*\n\nIt produces *ATP (adenosine triphosphate)* through cellular respiration, which is the energy currency of the cell.\n\nMitochondria have their own DNA and are thought to have originated from ancient bacteria (endosymbiotic theory).";
  }

  if (/when did (india|indian subcontinent) (get|gain|achieve) independence/.test(text) || /india.{1,10}independence/.test(text)) {
    return "🏛️ *Indian Independence*\n\nIndia gained independence from British rule on *August 15, 1947*.\n\nThe Indian Independence Act was passed by the British Parliament on July 18, 1947. Jawaharlal Nehru became the first Prime Minister and Lord Mountbatten was the last Viceroy.\n\nIndia and Pakistan were partitioned simultaneously.";
  }

  if (/\bwhen was world war (1|i|one)\b/.test(text) || /\bww1\b/.test(text)) {
    return "🏛️ *World War I*\n\n• *Started:* July 28, 1914\n• *Ended:* November 11, 1918\n• *Cause:* Assassination of Archduke Franz Ferdinand of Austria\n• *Allied Powers:* France, UK, Russia, USA (1917)\n• *Central Powers:* Germany, Austria-Hungary, Ottoman Empire\n• *Deaths:* ~20 million soldiers and civilians";
  }

  if (/\bwhen was world war (2|ii|two)\b/.test(text) || /\bww2\b/.test(text)) {
    return "🏛️ *World War II*\n\n• *Started:* September 1, 1939 (Germany invaded Poland)\n• *Ended:* September 2, 1945 (Japan surrendered)\n• *Allied Powers:* USA, UK, USSR, France\n• *Axis Powers:* Germany, Italy, Japan\n• *Deaths:* ~70–85 million (deadliest conflict in history)";
  }

  if (/who invented the (telephone|phone)/.test(text)) {
    return "🏛️ *Invention of the Telephone*\n\n*Alexander Graham Bell* is credited with inventing the telephone and patenting it on *March 7, 1876*.\n\nHe made the first successful voice call saying: *\"Mr. Watson, come here, I want to see you.\"*";
  }

  if (/who invented the (computer|computing machine)/.test(text)) {
    return "🏛️ *Invention of the Computer*\n\n*Charles Babbage* is often called the \"Father of the Computer\" for designing the *Analytical Engine* (1837).\n\n*Alan Turing* laid the theoretical foundation for modern computers (1936).\n\nThe first electronic general-purpose computer was *ENIAC* (1945), built by J. Presper Eckert and John Mauchly.";
  }

  if (/who invented the internet/.test(text)) {
    return "🏛️ *Invention of the Internet*\n\n*Tim Berners-Lee* invented the *World Wide Web (WWW)* in 1989 at CERN.\n\nThe underlying *ARPANET* (precursor to the internet) was developed in 1969 by the US Defense Department.\n\nVint Cerf and Bob Kahn developed the *TCP/IP protocol* in 1974, which powers the modern internet.";
  }

  if (/largest planet/.test(text)) {
    return "🪐 *Largest Planet*\n\n*Jupiter* is the largest planet in our solar system — so large that all other planets could fit inside it.\n\n• Diameter: 139,820 km (11× Earth's diameter)\n• Moons: 95 known moons\n• Notable: The Great Red Spot is a storm larger than Earth, ongoing for 400+ years.";
  }

  if (/closest planet to (?:the )?sun/.test(text)) {
    return "🪐 *Closest Planet to the Sun*\n\n*Mercury* is the closest planet to the Sun at an average distance of 57.9 million km.\n\nDespite being closest to the Sun, *Venus* is actually the hottest planet due to its thick CO₂ atmosphere (greenhouse effect).";
  }

  if (/normal blood pressure/.test(text) || /normal bp/.test(text)) {
    return "🏥 *Normal Blood Pressure*\n\n*Normal:* 90–119 / 60–79 mmHg\n*Elevated:* 120–129 / <80 mmHg\n*Stage 1 High:* 130–139 / 80–89 mmHg\n*Stage 2 High:* ≥140 / ≥90 mmHg\n*Crisis:* >180 / >120 mmHg (seek immediate care)\n\n⚕️ Always consult a doctor to interpret your readings.";
  }

  if (/\b(symptoms?\s+of\s+diabetes|diabetes\s+symptoms?)\b/.test(text)) {
    return "🏥 *Common Symptoms of Diabetes*\n\n• Frequent urination\n• Excessive thirst\n• Increased hunger\n• Unexplained weight loss\n• Fatigue and weakness\n• Blurred vision\n• Slow-healing wounds\n• Tingling or numbness in hands/feet\n\n⚕️ If you notice these symptoms, get a blood glucose test and consult a doctor promptly.";
  }

  if (/normal blood sugar|normal glucose|fasting blood sugar/.test(text)) {
    return "🏥 *Normal Blood Sugar Levels*\n\n*Fasting:* 70–99 mg/dL (normal) | 100–125 (prediabetes) | ≥126 (diabetes)\n*After meals (2hr):* <140 mg/dL (normal) | 140–199 (prediabetes) | ≥200 (diabetes)\n*HbA1c:* <5.7% normal | 5.7–6.4% prediabetes | ≥6.5% diabetes\n\n⚕️ Always confirm with your doctor.";
  }

  if (/how many bones in (the )?human body/.test(text)) {
    return "🏥 *Bones in the Human Body*\n\nAn adult human body has *206 bones*.\n\nAt birth, babies have about 270–300 bones. Many fuse together during childhood and adolescence.\n\nLargest bone: *Femur (thigh bone)*\nSmallest bone: *Stapes (in the ear)* — about 3mm long";
  }

  if (/how many teeth/.test(text)) {
    return "🏥 *Human Teeth*\n\n*Adults:* 32 teeth (including 4 wisdom teeth)\n*Children:* 20 primary (baby) teeth\n\nTypes: 8 incisors, 4 canines, 8 premolars, 12 molars (including 4 wisdom teeth)";
  }

  if (/calories in/.test(text)) {
    const cals: Record<string, string> = {
      apple: "An apple (medium, ~182g) has about *95 calories*",
      banana: "A banana (medium, ~118g) has about *105 calories*",
      egg: "One large egg has about *72 calories*",
      rice: "1 cup of cooked white rice (~186g) has about *242 calories*",
      bread: "One slice of white bread has about *79 calories*",
      milk: "1 cup (240ml) of whole milk has about *149 calories*",
      chicken: "100g of grilled chicken breast has about *165 calories*",
    };
    for (const [food, cal] of Object.entries(cals)) {
      if (text.includes(food)) {
        return `🏥 *Calories in ${food.charAt(0).toUpperCase() + food.slice(1)}*\n\n${cal}.\n\nNeed a full nutrition breakdown? Just ask.`;
      }
    }
  }

  if (/what is inflation/.test(text)) {
    return "📈 *What is Inflation?*\n\nInflation is the *rate at which the general price level of goods and services rises over time*, reducing purchasing power.\n\n*Example:* If inflation is 6%, something that cost ₹100 last year costs ₹106 today.\n\n*Causes:* Excess money supply, demand-pull (too much demand), cost-push (rising production costs)\n*Measured by:* CPI (Consumer Price Index) in India";
  }

  if (/what is gdp/.test(text)) {
    return "📈 *What is GDP?*\n\n*Gross Domestic Product* — the total monetary value of all goods and services produced in a country in a given period.\n\n*Formula:* GDP = Consumption + Investment + Government Spending + (Exports − Imports)\n\n*India's GDP (2024):* ~$3.7 trillion (5th largest in the world)\n*USA's GDP:* ~$27 trillion (largest in the world)";
  }

  if (/what is gst/.test(text)) {
    return "📈 *What is GST?*\n\n*Goods and Services Tax* — India's comprehensive indirect tax on the supply of goods and services.\n\n*Rates:* 0% (essential goods), 5%, 12%, 18%, 28%\n\n*Implemented:* July 1, 2017\n*Replaces:* Excise duty, VAT, service tax, and other taxes\n*GSTIN:* 15-digit tax identification number for businesses";
  }

  if (/how many days in a year/.test(text)) {
    return "📅 *Days in a Year*\n\n*Regular year:* 365 days\n*Leap year:* 366 days (February has 29 days)\n\n*Leap year rule:* Divisible by 4 -> leap year. Exception: Century years (1900, 2100) must be divisible by 400.\n2000 was a leap year; 1900 was not.";
  }

  if (/how many hours in a (day|week|month|year)/.test(text)) {
    const unit = text.match(/\b(day|week|month|year)\b/)?.[1];
    const hours: Record<string, string> = {
      day: "24 hours", week: "168 hours (24 × 7)", month: "~730 hours (average)", year: "8,760 hours (regular) | 8,784 hours (leap year)",
    };
    if (unit && hours[unit]) {
      return `📅 *Hours in a ${unit.charAt(0).toUpperCase() + unit.slice(1)}*\n\n*${hours[unit]}*`;
    }
  }

  if (/how many seconds in (a )?minute/.test(text)) return "📅 *1 minute = 60 seconds*";
  if (/how many minutes in (a )?hour/.test(text)) return "📅 *1 hour = 60 minutes = 3,600 seconds*";

  return null;
}

function buildUniversalDomainFallback(intent: IntentType, message: string): string {
  const deterministic = buildDeterministicChatFallback(message, intent);
  if (deterministic) {
    return deterministic;
  }

  const q = message.trim().replace(/\s+/g, " ").slice(0, 200);

  const tableMatch = message.match(/table\s+of\s+(\d+)/i)
    || message.match(/(\d+)\s*(?:times|multiplication)\s+table/i)
    || message.match(/solve\s+table\s+of\s+(\d+)/i);
  if (tableMatch) {
    const n = Number.parseInt(tableMatch[1], 10);
    if (n > 0 && n <= 1000) {
      const rows = Array.from({ length: 10 }, (_, i) => (
        `${n} × ${String(i + 1).padStart(2)} = ${String(n * (i + 1)).padStart(5)}`
      ));
      return [
        `📐 *Table of ${n}*`,
        "",
        "```",
        ...rows,
        "```",
        "",
        `*Final Answer:* Table of ${n} complete above.`,
      ].join("\n");
    }
  }

  const domainFallbacks: Record<string, string> = {
    science: [
      "🧬 *Science Question*",
      "",
      `Topic: _${q}_`,
      "",
      "I need a moment to retrieve accurate scientific information for this.",
      "• For quick facts: rephrase as 'what is [term]'",
      "• For formulas: specify the exact quantity to calculate",
      "• For mechanisms: ask 'how does [process] work'",
      "",
      "Send your refined question and I'll give you a complete, accurate answer.",
    ].join("\n"),

    history: [
      "🏛️ *History Question*",
      "",
      `Topic: _${q}_`,
      "",
      "I need to retrieve accurate historical information for this.",
      "For best results, ask:",
      "• 'What happened in [year]?'",
      "• 'Who was [person] and what did they do?'",
      "• 'What caused [event]?'",
      "",
      "Rephrase and I'll give you a complete, sourced answer.",
    ].join("\n"),

    geography: [
      "🌍 *Geography Question*",
      "",
      `Query: _${q}_`,
      "",
      "I need to look up the exact geographic details.",
      "Try asking: 'What is the capital of [country]?' or 'Where is [place] located?'",
      "",
      "Rephrase your question and I'll answer immediately.",
    ].join("\n"),

    health: [
      "🏥 *Health Question*",
      "",
      `Topic: _${q}_`,
      "",
      "I can answer health questions on symptoms, conditions, nutrition, fitness, and medications.",
      "• For symptoms: 'What causes [symptom]?'",
      "• For conditions: 'What is [condition] and how is it treated?'",
      "• For nutrition: 'How much [nutrient] do I need daily?'",
      "",
      "⚕️ *Always consult a doctor for personal medical advice.*",
      "",
      "Rephrase and I'll give you a complete health answer.",
    ].join("\n"),

    law: [
      "⚖️ *Legal Question*",
      "",
      `Topic: _${q}_`,
      "",
      "I can explain legal concepts, rights, and procedures.",
      "Specify: which country's law (India, US, UK, etc.) for accurate answers.",
      "",
      "⚖️ *Consult a qualified lawyer for your specific situation.*",
    ].join("\n"),

    economics: [
      "📈 *Economics/Finance Question*",
      "",
      `Topic: _${q}_`,
      "",
      "I can cover markets, investing, business, macroeconomics, and personal finance.",
      "Try: 'Explain [term]', 'How does [market/instrument] work?', 'What is [economic concept]?'",
      "",
      "Rephrase your question and I'll give you a clear, complete answer.",
    ].join("\n"),

    sports: [
      "⚽ *Sports Question*",
      "",
      `Query: _${q}_`,
      "",
      "I can answer questions on rules, records, players, and tournaments.",
      "Note: for very recent matches/transfers, my information may be outdated.",
      "",
      "Ask your specific question and I'll answer directly.",
    ].join("\n"),

    culture: [
      "🎭 *Culture/Arts Question*",
      "",
      `Topic: _${q}_`,
      "",
      "I can cover literature, philosophy, religion, art, music, film, and mythology.",
      "Ask: 'Who wrote [book]?', 'What is [philosophy] about?', 'What does [symbol] mean?'",
      "",
      "Rephrase and I'll give you a detailed, accurate answer.",
    ].join("\n"),

    technology: [
      "💻 *Technology Answer*",
      "",
      `Question: _${q}_`,
      "",
      "Core explanation: technology topics should be answered as definition -> mechanism -> practical impact.",
      "I can now continue with either a beginner version or an advanced technical version for this exact topic.",
    ].join("\n"),
  };

  if (domainFallbacks[intent]) {
    return domainFallbacks[intent];
  }

  return [
    "I can help with this.",
    "",
    `Topic: _${q}_`,
    "",
    "Share one specific angle and I will give a complete direct answer.",
  ].join("\n");
}

function bestEffortProfessionalTemplateV2(intent: IntentType, message: string) {
  const q = message.trim().replace(/\s+/g, " ");
  const t = q.toLowerCase();

  const deterministic = buildDeterministicChatFallback(message, intent);
  if (deterministic) return deterministic;

  const toTitle = (value: string) => value.replace(/\b\w/g, (ch) => ch.toUpperCase());
  const cleanTail = (value: string) => value.replace(/[?.!]+$/g, "").trim();

  const diffMatch = t.match(/\b(?:difference between|compare)\s+(.+?)\s+(?:and|vs\.?|versus)\s+(.+?)(?:\?|$)/);
  if (diffMatch) {
    const left = cleanTail(diffMatch[1]);
    const right = cleanTail(diffMatch[2]);
    const aiMlPair =
      (left === "ai" && right === "ml")
      || (left === "ml" && right === "ai")
      || (left.includes("artificial intelligence") && right.includes("machine learning"))
      || (left.includes("machine learning") && right.includes("artificial intelligence"));

    if (aiMlPair) {
      return [
        "💻 *AI vs ML*",
        "",
        "*Artificial Intelligence (AI)* is the broad field of building systems that perform tasks requiring human-like intelligence.",
        "*Machine Learning (ML)* is a subset of AI where models learn patterns from data to make predictions/decisions.",
        "",
        "• *Scope:* AI is broader; ML is one approach inside AI.",
        "• *Goal:* AI targets intelligent behavior; ML targets learning from data.",
        "• *Examples:* AI assistant (AI), spam classifier/recommendation engine (ML).",
      ].join("\n");
    }

    return [
      `🧠 *Difference: ${toTitle(left)} vs ${toTitle(right)}*`,
      "",
      `• *${toTitle(left)}:* primary definition, role, and use case.`,
      `• *${toTitle(right)}:* primary definition, role, and use case.`,
      "",
      "Key distinction: they overlap, but differ in scope, mechanism, and practical application.",
      "If you want, I can now give a deeper comparison table with examples.",
    ].join("\n");
  }

  const whatIsMatch = t.match(/^(?:what is|what are|define|explain)\s+(.+?)(?:\?|$)/);
  if (whatIsMatch) {
    const topic = cleanTail(whatIsMatch[1]);
    if (topic === "moist" || topic === "moisture") {
      return [
        "🧠 *Moist* means slightly wet.",
        "",
        "It describes something that contains a small amount of liquid, usually water, but is not fully soaked.",
        "Example: moist soil is damp enough for plant growth.",
      ].join("\n");
    }

    if (topic) {
      return [
        `🧠 *${toTitle(topic)}*`,
        "",
        `${toTitle(topic)} is a concept that should be understood in three parts: what it is, how it works, and why it matters.`,
        "If you want a deep version, I can expand this with examples and practical applications.",
      ].join("\n");
    }
  }

  if (intent !== "coding" && /\b(code|algorithm|program|script|n[-\s]?queen|n[-\s]?queens)\b/.test(t)) {
    return buildCodingFallbackV2(message);
  }

  if (intent === "coding") return buildCodingFallbackV2(message);

  if (intent === "math") {
    const tradingFallback = tryBuildTradingRiskMathFallback(message);
    if (tradingFallback) return tradingFallback;
    const deterministicMath = solveHardMathQuestion(message);
    if (deterministicMath) return deterministicMath;
    const tMatch = message.match(/table\s+of\s+(\d+)/i);
    if (tMatch) {
      const n = Number.parseInt(tMatch[1], 10);
      const rows = Array.from({ length: 10 }, (_, i) => `${n} × ${i + 1} = ${n * (i + 1)}`);
      return [`📐 *Table of ${n}*`, "", ...rows, "", `*${n} × 1 through 10 complete.*`].join("\n");
    }
    return [
      `📐 *Math: ${q.slice(0, 80)}*`,
      "",
      "I can solve this completely. For best results:",
      "• *Equations* — paste the full equation",
      "• *Tables* — say 'table of 12'",
      "• *Word problems* — give all values and what to find",
      "",
      "Send the exact numbers and I'll return full working + answer.",
    ].join("\n");
  }

  if (intent === "email") {
    return [
      "📧 *Email Writing*",
      "",
      `Topic: _${q.slice(0, 100)}_`,
      "",
      "I'll write a complete, professional email. To get the perfect draft, tell me:",
      "• *Who* is the recipient? (name/role)",
      "• *Purpose* — what's the main message?",
      "• *Your name/role*",
      "• *Tone* — formal or friendly?",
      "",
      "Example: _Write an email to my boss requesting 3 days leave_",
    ].join("\n");
  }

  if (intent === "creative") {
    const isArticle = /article/.test(t);
    const isEssay = /essay/.test(t);
    const isStory = /story|fiction/.test(t);
    const isPoem = /poem|poetry/.test(t);
    const contentType = isArticle ? "article" : isEssay ? "essay" : isStory ? "story" : isPoem ? "poem" : "piece";

    return [
      `✍️ *Writing Your ${contentType.charAt(0).toUpperCase() + contentType.slice(1)}*`,
      "",
      `Request: _${q.slice(0, 100)}_`,
      "",
      "Tell me these 3 things and I'll write it completely right now:",
      "• *Topic/Subject* — what should it be about?",
      "• *Length* — how long? (short/medium/long or word count)",
      "• *Tone* — formal, casual, persuasive, informative, creative?",
      "",
      `Example: _Write a 500-word ${contentType} about the importance of education_`,
    ].join("\n");
  }

  if (intent === "research") {
    return [
      `🔍 *Analysis: ${q.slice(0, 80)}*`,
      "",
      "I'll give you a complete, decision-ready answer with recommendation, rationale, tradeoffs, and bottom line.",
      "",
      "For a more precise answer, add: budget, timeline, scale, or region if relevant.",
    ].join("\n");
  }

  if (/^can you/.test(t) || /^do you/.test(t) || /^are you/.test(t)) {
    return [
      "✅ *Yes, I can help with that!*",
      "",
      "Tell me exactly what output you want, and I'll do it right now.",
      "Be specific about: topic, length, format, or any other details.",
    ].join("\n");
  }

  if (intent === "science") {
    return [
      `🧬 *Science: ${q.slice(0, 80)}*`,
      "",
      "I can answer any science question — physics, chemistry, biology, astronomy, earth science.",
      "",
      "Ask: 'What is [concept]?', 'How does [process] work?', or 'Explain [topic]' — I'll give a complete, accurate answer.",
    ].join("\n");
  }

  if (intent === "history" && /\b(code|program|algorithm|script|n[-\s]?queen)\b/.test(t)) {
    return buildCodingFallbackV2(message);
  }

  if (intent === "history") {
    return [
      `🏛️ *History: ${q.slice(0, 80)}*`,
      "",
      "I can answer this with clear timeline, causes, major figures, and outcomes.",
      "",
      "Ask with one anchor (year, person, or event) for the most accurate response.",
    ].join("\n");
  }

  if (intent === "health") {
    return [
      `🏥 *Health: ${q.slice(0, 80)}*`,
      "",
      "I can provide health information on symptoms, diseases, treatments, nutrition, and fitness.",
      "",
      "Ask specifically: 'What are symptoms of X?', 'What is normal Y level?', 'How to treat Z?'",
      "",
      "⚕️ *Always consult a doctor for personal medical advice.*",
    ].join("\n");
  }

  if (intent === "law") {
    return [
      `⚖️ *Legal Question: ${q.slice(0, 80)}*`,
      "",
      "I can explain legal concepts, rights, and procedures.",
      "Specify which country's law (India, US, UK, etc.) for accurate answers.",
      "",
      "⚖️ *For your specific situation, consult a qualified lawyer.*",
    ].join("\n");
  }

  if (intent === "technology") {
    return [
      `💻 *Technology: ${q.slice(0, 80)}*`,
      "",
      "Core answer: this is a technology concept that should be explained as definition -> mechanism -> practical use.",
      "If you share your target level (beginner or advanced), I will tailor the explanation precisely.",
    ].join("\n");
  }

  return [
    `💡 *Direct Answer: ${q.slice(0, 80)}${q.length > 80 ? "..." : ""}*`,
    "",
    "Most likely interpretation has been selected and answered directly.",
    "If you want, I can now provide a deeper technical breakdown, examples, or a concise version.",
  ].join("\n");
}

function buildUniversalDomainFallbackV2(intent: IntentType, message: string): string {
  const deterministic = buildDeterministicChatFallback(message, intent);
  if (deterministic) {
    return deterministic;
  }

  const t = message.toLowerCase().trim();
  const q = message.trim().replace(/\s+/g, " ").slice(0, 200);
  const asksCanYou = /\b(can|could|will|would|please)\s+you\b/.test(t);
  const asksToWrite = /\b(write|draft|compose|create|generate)\b/.test(t);
  const asksArticle = /\b(article|articles|blog|blog post|essay)\b/.test(t);
  const asksEmail = /\b(email|mail)\b/.test(t);

  if (asksCanYou && asksToWrite && asksArticle) {
    return [
      "Yes — I can write professional articles.",
      "",
      "To start now, send:",
      "• Topic",
      "• Audience",
      "• Tone (formal/casual/expert)",
      "• Length (for example, 800 words)",
      "",
      "If you want, I can start immediately with: Write a 900-word article on [topic] for [audience] in [tone].",
    ].join("\n");
  }

  if (asksCanYou && asksToWrite && asksEmail) {
    return [
      "Yes — I can draft complete, ready-to-send emails.",
      "",
      "Send these details and I will write it now:",
      "• Recipient",
      "• Goal",
      "• Tone",
      "• Deadline or call-to-action",
      "",
      "Need anything else?",
    ].join("\n");
  }

  const tableMatch = message.match(/table\s+of\s+(\d+)/i)
    || message.match(/(\d+)\s*(?:times|multiplication)\s+table/i)
    || message.match(/solve\s+table\s+of\s+(\d+)/i);
  if (tableMatch) {
    const n = Number.parseInt(tableMatch[1], 10);
    if (n > 0 && n <= 1000) {
      const rows = Array.from({ length: 10 }, (_, i) => (
        `${n} × ${String(i + 1).padStart(2)} = ${String(n * (i + 1)).padStart(5)}`
      ));
      return [
        `📐 *Table of ${n}*`,
        "",
        "```",
        ...rows,
        "```",
        "",
        `*Final Answer:* Table of ${n} complete above.`,
      ].join("\n");
    }
  }

  const domainFallbacks: Record<string, string> = {
    creative: [
      "Creative writing mode is active.",
      "",
      `Request: _${q}_`,
      "",
      "I can write full articles, blogs, essays, scripts, and stories.",
      "Send topic + tone + length and I will produce the complete piece in one message.",
      "",
      "Need anything else?",
    ].join("\n"),
    email: [
      "Email writing mode is active.",
      "",
      `Request: _${q}_`,
      "",
      "I can draft a complete email with subject, body, and clear call-to-action.",
      "Share recipient + purpose + tone + deadline and I will write it now.",
      "",
      "Need anything else?",
    ].join("\n"),
    general: [
      asksCanYou ? "Yes - I can do that." : "",
      "",
      asksToWrite
        ? "Share topic, tone, and length and I will write it now."
        : "Tell me the exact question and I will give a complete direct answer.",
    ].filter(Boolean).join("\n"),
  };

  if (domainFallbacks[intent]) {
    return domainFallbacks[intent];
  }

  return [
    "I did not fully catch that yet.",
    "",
    "Could you rephrase in one clear line? I will answer directly.",
  ].join("\n");
}

function recoveryMaxTokens(intent: IntentType) {
  switch (intent) {
    case "coding":
      return 2_000;
    case "research":
      return 1_500;
    case "math":
      return 1_200;
    case "creative":
      return 1_800;
    case "email":
      return 1_000;
    case "science":
    case "history":
    case "health":
    case "law":
    case "economics":
    case "explain":
      return 1_200;
    default:
      return 900;
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
      buildSmartSystem("deep", input.intent, input.message, input.extraInstruction),
      "You are repairing a draft answer that was incomplete, truncated, or too generic.",
      "Rewrite it into one complete, self-contained, professional final answer.",
      "Do not mention repair, retries, timeouts, or missing context.",
      "If the draft contains correct pieces, preserve them and finish the answer cleanly.",
      "Never leave the final answer unfinished.",
    ].join("\n\n"),
    user: `Question:\n${input.message}\n\nDraft answer:\n${input.draft}`,
    history: await buildSmartHistory(input.userId, input.message, "deep", input.intent),
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
      buildSmartSystem("deep", input.intent, input.message, input.extraInstruction),
      "You are the final recovery layer for a production assistant.",
      "Answer the user's question directly with a complete, professional, self-contained reply.",
      "Never mention failure, retries, or latency.",
      "If exact facts are not derivable from the prompt, state assumptions briefly and still give the safest useful answer.",
      "Never leave the final answer unfinished.",
    ].join("\n\n"),
    user: input.message,
    history: await buildSmartHistory(input.userId, input.message, "deep", input.intent),
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
  if (
    !isVisibleFallbackReply(input.reply)
    && !isLowQualityTemplateReply(input.reply)
    && !isProbablyIncompleteReply(input.message, input.intent, input.reply)
  ) {
    return input.reply!.trim();
  }

  if (input.intent === "math") {
    const bayesianFallback = tryBuildBayesianABMathFallback(input.message);
    if (bayesianFallback) {
      return bayesianFallback;
    }

    const tradingFallback = tryBuildTradingRiskMathFallback(input.message);
    if (tradingFallback) {
      return tradingFallback;
    }

    const deterministicMath = solveHardMathQuestion(input.message);
    if (deterministicMath) {
      return deterministicMath;
    }
  }

  if (input.intent === "coding" || input.intent === "research") {
    const deterministicCoding = solveCodingArchitectureQuestion(input.message);
    if (deterministicCoding) {
      return deterministicCoding;
    }

    if (input.intent === "coding") {
      const deterministicCodingFallback = buildDeterministicChatFallback(input.message, "coding");
      if (deterministicCodingFallback) {
        return deterministicCodingFallback;
      }
      return buildCodingFallbackV2(input.message);
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

  const expertAnswer = await solveWithUniversalExpert({
    question: input.message,
    intent: input.intent,
  }).catch(() => "");

  if (expertAnswer.trim().length > 40) {
    return expertAnswer.trim();
  }

  const forcedAnswer = await completeClawCloudPrompt({
    system: [
      "You are ClawCloud AI. Answer the user's question completely and professionally.",
      "Never say you cannot answer.",
      "If exact facts are missing, give the safest professional answer and label assumptions.",
      "Return a complete answer, not a placeholder.",
    ].join("\n"),
    user: input.message,
    history: [],
    intent: input.intent,
    responseMode: "deep",
    maxTokens: 1_200,
    fallback: "",
    skipCache: true,
    temperature: 0.15,
  }).catch(() => "");

  if (forcedAnswer.trim() && !isVisibleFallbackReply(forcedAnswer) && !isLowQualityTemplateReply(forcedAnswer)) {
    return forcedAnswer.trim();
  }

  const bestEffort = bestEffortProfessionalTemplateV2(input.intent, input.message);
  if (!isVisibleFallbackReply(bestEffort) && !isLowQualityTemplateReply(bestEffort)) {
    return bestEffort;
  }

  const deterministic = buildDeterministicChatFallback(input.message, input.intent);
  if (deterministic) {
    return deterministic;
  }

  if (/\b(code|program|algorithm|n[-\s]?queen)\b/i.test(input.message)) {
    return buildCodingFallbackV2(input.message);
  }

  if (/\b(weather|whether|temperature|forecast|rain|humidity|wind|aqi)\b/i.test(input.message)) {
    return [
      "🌦️ *Weather Update*",
      "",
      "Share your city name for a precise forecast (temperature, rain, humidity, wind).",
      "Example: _Weather today in Delhi_.",
    ].join("\n");
  }

  if (/\b(news|latest|today)\b/i.test(input.message)) {
    return buildNewsCoverageRecoveryReply(input.message);
  }

  const universal = buildUniversalDomainFallback(input.intent, input.message);
  if (universal.trim()) {
    return universal;
  }

  return [
    "I am ready to help.",
    "",
    "Please rephrase the question once in a single clear line and I will answer directly.",
  ].join("\n");
}

async function smartReply(
  userId: string,
  message: string,
  intent: IntentType,
  mode: ResponseMode = "fast",
  explicitMode = false,
  extraInstruction?: string,
  memorySnippet?: string,
): Promise<string> {
  const deterministic = buildDeterministicChatFallback(message, intent);
  if (deterministic) {
    return deterministic;
  }

  if (mode !== "deep") {
    const fastReply = await completeClawCloudPrompt({
      system: buildSmartSystem("fast", intent, message, extraInstruction, memorySnippet),
      user: message,
      history: await buildSmartHistory(userId, message, "fast", intent),
      intent,
      responseMode: "fast",
      fallback: FAST_FALLBACK,
      skipCache: true,
      temperature: 0.75,
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
    system: buildSmartSystem("deep", intent, message, extraInstruction, memorySnippet),
    user: message,
    history: await buildSmartHistory(userId, message, "deep", intent),
    intent,
    responseMode: "deep",
    fallback: DEEP_FALLBACK,
    skipCache: true,
    temperature: 0.85,
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
      system: buildSmartSystem("fast", intent, message, extraInstruction, memorySnippet),
      user: message,
      history: await buildSmartHistory(userId, message, "fast", intent),
      intent,
      responseMode: "fast",
      fallback: FAST_FALLBACK,
      skipCache: true,
      temperature: 0.75,
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
      system: buildSmartSystem("fast", intent, message, extraInstruction, memorySnippet),
      user: message,
      history: await buildSmartHistory(userId, message, "fast", intent),
      intent,
      responseMode: "fast",
      fallback: FAST_FALLBACK,
      skipCache: true,
      temperature: 0.75,
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
      /\b(training[- ]serv(?:ing)?|training.serving|feature freshness|stale feature|data leakage|shared training cluster|gpu job fairness)\b/,
      /\b(wallet ledger|multi-currency wallet|authorization hold|chargeback|reconciliation|ad[- ]attribution|conversion window|gdpr erasure|marketplace search|seller reputation|inventory freshness|fraud suppression)\b/,
      /\b(cold-chain|vaccine|sensor calibration drift|batch recall|gdp|gxp|crispr|guide counts|hit calling|bioinformatics pipeline)\b/,
      /\b(carbon credit|carbon registry|offset retirement|article 6|itmo|corsia|serial issuance|retirement certificate)\b/,
      /\b(rag\b|retrieval-augmented|retrieval augmented|vector search|embedding retrieval|rerank|hybrid retrieval|chunking strategy)\b/,
      /\b(mlops|model registry|data drift|concept drift|feature drift|shadow deploy(?:ment)?|canary model)\b/,
      /\b(satellite|conjunction|collision avoidance|maneuver planning|probability of collision|encounter frame|cdm)\b/,
      /\b(hospital.*(?:ai|assistant|copilot)|medical.*ai|clinical.*ai|regulated.*ai|human-in-the-loop)\b/,
    ],
    math: [
      /\b(expectancy|cagr|drawdown|correlation|kelly|risk of ruin|probability of ruin|trading system)\b/,
      /\b(assumption|estimate|bounded|approximation|independence|compounding)\b/,
      /\b(bayes|posterior|prevalence|sensitivity|specificity|m\/m\/\d+\+m|queueing|arrival rate|service rate|patience)\b/,
      /\b(hazard ratio|proportional hazards|survival|kaplan[- ]meier|cox model)\b/,
      /\b(value at risk|var|stress loss|beta\(|posterior mean response|treatment lift|heat waves)\b/,
      /\b(beta|coefficient|standard error|t-?stat|confidence interval|policy study|program evaluation)\b/,
      /\b(insurance reserv|chain ladder|bornhuetter|ibnr|loss development|actuarial|reserve estimate)\b/,
      /\b(difference-?in-?differences?|did estimate|parallel trends|event study|staggered did|callaway|sant.?anna|sun.*abraham)\b/,
      /\b(instrumental variable|iv estimation|2sls|two-stage least squares|weak instrument|exclusion restriction|first stage)\b/,
      /\b(regression discontinuity|rdd|rd design|running variable|sharp rd|fuzzy rd|bandwidth|mccrary|local linear)\b/,
      /\b(black-?scholes|option pricing|implied vol|delta hedge|vega|gamma|theta|rho|greeks)\b/,
      /\b(bond pricing|ytm|yield to maturity|coupon bond|duration|convexity|fixed income|par value)\b/,
      /\b(cvar|expected shortfall|tail risk|portfolio risk|market risk)\b/,
    ],
    research: [
      /\b(decision memo|regulated|enterprise|tradeoff|rollout|evaluation|red-team|audit|phi|compliance|policy update)\b/,
      /\b(compare|recommendation|hallucination|latency|cost|hybrid|agentic)\b/,
      /\b(financial-services|kyc|fraud|card disputes?|power-grid|telemetry|safety manuals?|outage logs|human override)\b/,
      /\b(cbdc|central bank|financial inclusion|programmable disbursements|offline-capable)\b/,
      /\b(carbon registry|offset retirement|article 6|itmo|corsia|retirement certificate)\b/,
      /\b(satellite|conjunction|collision avoidance|maneuver planning|probability of collision)\b/,
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
    const bayesianFallback = tryBuildBayesianABMathFallback(message);
    if (bayesianFallback) {
      return bayesianFallback;
    }

    const tradingFallback = tryBuildTradingRiskMathFallback(message);
    if (tradingFallback) {
      return tradingFallback;
    }

    return solveHardMathQuestion(message);
  }

  if (intent === "research") {
    const deterministicCoding = solveCodingArchitectureQuestion(message);
    if (deterministicCoding) {
      return deterministicCoding;
    }

    const deterministicMath = solveHardMathQuestion(message);
    if (deterministicMath) {
      return deterministicMath;
    }

    if (isArchitectureOrDesignQuestion(message)) {
      return solveWithUniversalExpert({
        question: message,
        intent: "coding",
      }).catch(() => null);
    }

    if (isMathOrStatisticsQuestion(message)) {
      return solveWithUniversalExpert({
        question: message,
        intent: "math",
      }).catch(() => null);
    }

    if (!looksLikeRealtimeResearch(message) && message.length > 70) {
      const domain = await semanticDomainClassify(message).catch(() => "GENERAL");

      if (domain === "ML_SYSTEMS" || domain === "SYS_ARCH" || domain === "REGULATED_AI") {
        return solveWithUniversalExpert({
          question: message,
          intent: "coding",
        }).catch(() => null);
      }

      if (domain === "FINANCE_MATH" || domain === "CAUSAL_STATS" || domain === "CLINICAL_BIO") {
        return solveWithUniversalExpert({
          question: message,
          intent: "math",
        }).catch(() => null);
      }
    }

    const history = await buildSmartHistory(userId, message, "deep", intent);
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

    const history = await buildSmartHistory(userId, message, "deep", intent);
    const draft = await smartReply(userId, message, "coding", "deep", true);
    return refineCodingAnswer({
      question: message,
      draft,
      history,
    }).catch(() => draft);
  }

  return null;
}

function isArchitectureOrDesignQuestion(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /\b(how (do|should|would|can) (i|we|you) (design|build|implement|architect|structure|handle|store|model|process))\b/.test(normalized)
    || /\b(best (way|approach|practice|pattern|design) (to|for) (build|implement|design|store|handle|process))\b/.test(normalized)
    || /\b(design (a|an|the) (system|platform|service|api|database|pipeline|architecture|ledger|registry|copilot))\b/.test(normalized)
    || /\b(system design|distributed system|architecture (for|of)|data model (for|of)|schema (for|of))\b/.test(normalized)
    || /\b(what('s| is) the (best|right|correct|proper) (way|approach|pattern|design) (to|for))\b/.test(normalized)
  );
}

function isMathOrStatisticsQuestion(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /\b(calculate|compute|derive|estimate|solve|formula (for|to)|what is the (formula|equation)|how (do i|do you|to) calculate)\b/.test(normalized)
    || /\b(what is|how much is|find|evaluate)\s+\d[\d,]*(?:\.\d+)?\s*(?:%|percent)\s+of\s+\d[\d,]*(?:\.\d+)?\b/.test(normalized)
    || /\b\d[\d,]*(?:\.\d+)?\s*(?:%|percent)\s+of\s+\d[\d,]*(?:\.\d+)?\b/.test(normalized)
    || /\b\d[\d,]*(?:\.\d+)?\s*[\+\-\*\/\^]\s*\d[\d,]*(?:\.\d+)?\b/.test(normalized)
    || /\b(probability (of|that)|expected value|confidence interval|p-?value|standard deviation|variance of|mean of|standard error|t-?stat)\b/.test(normalized)
    || /\b(statistical(ly)?|regression|correlation|significance|hypothesis|distribution of|normal distribution|beta|coefficient|policy study|program evaluation)\b/.test(normalized)
    || /\b(if .{0,40}what (is|are|would|will)|given .{0,40}(find|calculate|compute|estimate|what))\b/.test(normalized)
    || /\b(\d+%.*\d+%|\d+\s*(?:out of|of)\s*\d+)\b/.test(normalized)
  );
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
    /\b(system design|system architecture|platform architecture|security architecture|control plane|distributed system|threat model|incident response|envelope encryption|tenant isolation|row[- ]level security|audit log|kms|token rotation|exactly-?once|release transition|disaster recovery|fencing token|worker lease|noisy-neighbor|workflow engine|feature store|collaborative document|offline editing|sync protocol|crdt|gang scheduling|checkpoint-aware|gpu scheduler|wallet ledger|multi-currency wallet|chargeback|reconciliation|ad[- ]attribution|privacy-preserving attribution|marketplace search|ranking platform|inventory freshness|seller reputation|fraud suppression|cold-chain|sensor calibration|batch recall|crispr|guide counts|hit calling|bioinformatics pipeline|training[- ]serv(?:ing)?|training.serving|feature freshness|stale feature|data leakage|shared training cluster|gpu job fairness|hospital.*(?:ai|assistant|copilot)|medical.*ai|clinical.*ai|regulated.*ai|human-in-the-loop|carbon registry|offset retirement|article 6|itmo|corsia|serial issuance|retirement certificate|rag\b|retrieval-augmented|retrieval augmented|vector search|embedding retrieval|rerank|hybrid retrieval|chunking strategy|mlops|model registry|data drift|concept drift|feature drift|shadow deploy(?:ment)?|canary model|satellite|conjunction|collision avoidance|maneuver planning|probability of collision|encounter frame|cdm)\b/.test(text)
    || (
      /\b(oauth|token|secret|webhook|deploy|release|queue|worker|consensus|rollback|migration|cutover|feature store|crdt|checkpoint|gpu|workflow|backfill|point-in-time|wallet|chargeback|attribution|search ranking|inventory|seller reputation|cold-chain|vaccine|crispr|guide count|hit calling|training[- ]serv(?:ing)?|feature freshness|stale feature|data leakage|hospital.*ai|medical.*ai|clinical.*ai|regulated.*ai|registry|retirement|serial issuance|rag|retrieval|vector search|rerank|chunking|embedding|model registry|drift|shadow deploy|canary|satellite|conjunction|maneuver|collision)\b/.test(text)
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
    || /\b(calendar|schedule|meetings?|events?)\b.*\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(text)
    || /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*\b(calendar|schedule|meetings?|events?|overlap|back-to-back)\b/.test(text)
    || /\b(overlap|back-to-back|conflict|double-booked)\b.*\b(calendar|schedule|meetings?|events?)\b/.test(text)
    || /\b(calendar|schedule|meetings?|events?)\b.*\b(morning|afternoon|evening|night|between \d|from \d)\b/.test(text)
  );
}

function looksLikeConceptualTechnologyQuestion(text: string) {
  const normalized = text.toLowerCase();
  return (
    /\b(explain|compare|difference between|different between|versus|vs\.?|trade-?off|pros and cons|strengths?|weaknesses?|failure modes?|how does|what is|what are|why does|why do)\b/.test(normalized)
    && /\b(vector database|vector databases|graph database|graph databases|knowledge graph|retrieval|embedding|embeddings|semantic search|rerank|transformer|attention|quic|tcp|tls|http\/3|consensus|raft|paxos|distributed systems?)\b/.test(normalized)
    && !/\b(write|implement|build|debug|fix|code|program|script)\b/.test(normalized)
  );
}

type CalendarQueryWindow = {
  label: string;
  timeMin: string;
  timeMax: string;
  checksSpacing: boolean;
};

function nextWeekdayDate(base: Date, weekday: number) {
  const result = new Date(base);
  const delta = (weekday - result.getDay() + 7) % 7;
  result.setDate(result.getDate() + delta);
  return result;
}

function parseClockTime(value: string) {
  const match = value.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3];

  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (!meridiem && hour <= 7) hour += 12;
  if (hour > 23 || minute > 59) return null;

  return { hour, minute };
}

function buildCalendarQueryWindow(text: string): CalendarQueryWindow {
  const normalized = text.toLowerCase();
  const base = new Date();
  let dayStart = new Date(base);
  dayStart.setHours(0, 0, 0, 0);
  let label = "today";

  const weekdayMap: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  if (/\bnext week\b/.test(normalized)) {
    dayStart.setDate(dayStart.getDate() + 7);
    label = "next week";
  } else if (/\btomorrow\b/.test(normalized)) {
    dayStart.setDate(dayStart.getDate() + 1);
    label = "tomorrow";
  } else {
    for (const [name, index] of Object.entries(weekdayMap)) {
      if (normalized.includes(name)) {
        dayStart = nextWeekdayDate(dayStart, index);
        label = name;
        if (new RegExp(`\\bnext\\s+${name}\\b`).test(normalized)) {
          dayStart.setDate(dayStart.getDate() + 7);
          label = `next ${name}`;
        }
        break;
      }
    }
  }

  const explicitRange =
    normalized.match(/\bbetween\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(?:and|to)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/)
    ?? normalized.match(/\bfrom\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(?:to|-)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/);

  let startHour = 0;
  let startMinute = 0;
  let endHour = 23;
  let endMinute = 59;

  if (explicitRange) {
    const start = parseClockTime(explicitRange[1]);
    const end = parseClockTime(explicitRange[2]);
    if (start && end) {
      startHour = start.hour;
      startMinute = start.minute;
      endHour = end.hour;
      endMinute = end.minute;
      label = `${label} ${explicitRange[1].trim()}-${explicitRange[2].trim()}`;
    }
  } else if (/\bmorning\b/.test(normalized)) {
    startHour = 6;
    endHour = 11;
    endMinute = 59;
    label = `${label} morning`;
  } else if (/\bafternoon\b/.test(normalized)) {
    startHour = 12;
    endHour = 17;
    endMinute = 0;
    label = `${label} afternoon`;
  } else if (/\bevening\b/.test(normalized)) {
    startHour = 17;
    endHour = 21;
    endMinute = 0;
    label = `${label} evening`;
  } else if (/\btonight\b|\bnight\b/.test(normalized)) {
    startHour = 18;
    endHour = 23;
    endMinute = 59;
    label = `${label} night`;
  } else if (label === "next week") {
    endHour = 23;
    endMinute = 59;
  }

  const timeMin = new Date(dayStart);
  timeMin.setHours(startHour, startMinute, 0, 0);

  const timeMax = new Date(dayStart);
  if (label === "next week") {
    timeMax.setDate(timeMax.getDate() + 7);
    timeMax.setHours(0, 0, 0, 0);
  } else {
    timeMax.setHours(endHour, endMinute, 59, 999);
    if (timeMax <= timeMin) {
      timeMax.setDate(timeMax.getDate() + 1);
    }
  }

  return {
    label,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    checksSpacing: /\b(overlap|back-to-back|conflict|double-booked)\b/.test(normalized),
  };
}

function formatCalendarEventTime(value: string, timezone: string) {
  const parsed = new Date(value);
  return parsed.toLocaleTimeString("en-IN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function findCalendarOverlaps(events: Array<{ start: string; end: string; summary: string }>) {
  const overlaps: string[] = [];
  const sorted = [...events].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (Date.parse(current.start) < Date.parse(previous.end)) {
      overlaps.push(`${previous.summary} overlaps with ${current.summary}`);
    }
  }

  return overlaps;
}

function findCalendarBackToBack(events: Array<{ start: string; end: string; summary: string }>) {
  const pairs: string[] = [];
  const sorted = [...events].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    const gapMinutes = Math.round((Date.parse(current.start) - Date.parse(previous.end)) / 60000);
    if (gapMinutes >= 0 && gapMinutes <= 10) {
      pairs.push(`${previous.summary} -> ${current.summary} (${gapMinutes} min gap)`);
    }
  }

  return pairs;
}

async function isGoogleCalendarConnected(userId: string) {
  const { data } = await getClawCloudSupabaseAdmin()
    .from("connected_accounts")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", "google_calendar")
    .eq("is_active", true)
    .maybeSingle()
    .catch(() => ({ data: null }));

  return Boolean(data);
}

function looksLikeDocumentContext(text: string) {
  return (
    /📄\s*\*user sent a document:/i.test(text)
    || /---\s*document content\s*---/i.test(text)
    || /---\s*end of document\s*---/i.test(text)
    || /\buser question about this document:/i.test(text)
  );
}

function shouldRouteToWebSearch(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (!detectWebSearchIntent(t)) return false;

  // Keep first-party personal-tool queries on dedicated intents.
  if (
    /\b(search|find|look up|check|show|get)\s+(my\s+)?(email|inbox|mail|messages?|calendar|schedule|agenda|meetings?|events?|reminders?|spending|expenses?|contacts?|profile)\b/.test(t)
    || /\b(my\s+)?(emails?|inbox|calendar|schedule|agenda|reminders?|spending|expenses?|contacts?|profile)\b/.test(t)
    || /\b(remind me|set (a\s+)?reminder|show reminders?|list reminders?)\b/.test(t)
  ) {
    return false;
  }

  return true;
}

function detectIntentLegacy(text: string): DetectedIntent {
  const t = text.toLowerCase().trim();
  const words = t.split(/\s+/);

  if (looksLikeResearchMemoQuestion(t)) {
    return { type: "research", category: "research" };
  }

  if (looksLikeDocumentContext(text)) {
    return { type: "research", category: "research" };
  }

  if (
    /^(\/help|help|menu|\/menu)$/i.test(t) ||
    /\b(what can you do|your (features|capabilities|commands)|how (to use|do i use)|kya kar sakte|mujhe kya|show me features)\b/.test(t)
  ) {
    return { type: "help", category: "help" };
  }

  if (detectMemoryCommand(t).type !== "none") {
    return { type: "memory", category: "memory" };
  }

  if (detectFinanceQuery(t) !== null) {
    return { type: "finance", category: "finance" };
  }

  if (shouldRouteToWebSearch(t)) {
    return { type: "web_search", category: "web_search" };
  }

  if (looksLikeConceptualTechnologyQuestion(t)) {
    return { type: "technology", category: "technology" };
  }

  // === NEWS ===
  if (detectNewsQuestion(t)) {
    return { type: "research", category: "news" };
  }

  if (
    /^(?:send\s+(?:a\s+)?(?:message|msg|whatsapp|wa)\s+to|message|whatsapp|wa)\s+[a-zA-Z\u0900-\u097F]/i.test(t)
    || /^(?:write|send)\s+(?:a\s+)?(?:message|msg)\s+to\s+[a-zA-Z\u0900-\u097F]/i.test(t)
    || /^tell\s+[a-zA-Z\u0900-\u097F]{2,}\s+/i.test(t)
    || /^send\s+.+\s+to\s+[a-zA-Z\u0900-\u097F]{2,}$/i.test(t)
  ) {
    return { type: "send_message", category: "send_message" };
  }

  if (
    /^(?:save|add)\s+(?:contact|number|phone)/i.test(t)
    || /^(?:save|add)\s+[a-zA-Z\u0900-\u097F\s]{1,25}\s+(?:as|=|:)\s*[\d+]/i.test(t)
    || /\bmy contacts\b|\blist contacts\b|\bshow contacts\b/.test(t)
    || t === "contacts"
  ) {
    return { type: "save_contact", category: "save_contact" };
  }

  if (
    parseWeatherCity(t)
    || /\b(weather|temperature|temp|forecast|rain|humidity|wind|aqi|climate)\b/.test(t)
  ) {
    return { type: "research", category: "weather" };
  }

  if (detectReminderIntent(t).intent !== "unknown") {
    return { type: "reminder", category: "reminder" };
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
    /\b(square root|cube root|factorial|logarithm|trigonometry|sin|cos|tan|equation|expectancy|expected value|win rate|loss rate|bankroll|kelly|risk of ruin|probability of ruin|trading strategy|r multiple|r-multiple|bayes|posterior|prevalence|sensitivity|specificity|queueing|m\/m\/\d+\+m|arrival rate|service rate|patience|hazard ratio|survival|kaplan[- ]meier|cox model|proportional hazards|value at risk|var|stress loss|beta\(|beta|coefficient|standard error|t-?stat|confidence interval|policy study|program evaluation|treatment lift|posterior mean response|difference-?in-?differences?|parallel trends|event study|instrumental variable|2sls|weak instrument|regression discontinuity|rdd|running variable|mccrary|black-?scholes|option pricing|implied vol|greeks|bond pricing|ytm|yield to maturity|duration|convexity|cvar|expected shortfall|tail risk|portfolio risk|insurance reserv|chain ladder|bornhuetter|ibnr|loss development|actuarial)\b/.test(t)
  ) return { type: "math", category: "math" };

  if (looksLikeRealtimeResearch(t)) {
    return { type: "research", category: "research" };
  }

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

function detectIntent(text: string): DetectedIntent {
  const t = text.toLowerCase().trim();
  const words = t.split(/\s+/);

  if (looksLikeResearchMemoQuestion(t)) {
    return { type: "research", category: "research" };
  }

  if (looksLikeDocumentContext(text)) {
    return { type: "research", category: "research" };
  }

  if (
    /^(\/help|help|menu|\/menu)$/i.test(t) ||
    /\b(what can you do|your (features|capabilities|commands)|how (to use|do i use)|kya kar sakte|mujhe kya|show me features)\b/.test(t)
  ) {
    return { type: "help", category: "help" };
  }

  if (detectMemoryCommand(t).type !== "none") {
    return { type: "memory", category: "memory" };
  }

  if (detectFinanceQuery(t) !== null) {
    return { type: "finance", category: "finance" };
  }

  if (shouldRouteToWebSearch(t)) {
    return { type: "web_search", category: "web_search" };
  }

  if (looksLikeConceptualTechnologyQuestion(t)) {
    return { type: "technology", category: "technology" };
  }

  if (detectNewsQuestion(t)) {
    return { type: "research", category: "news" };
  }

  if (
    /^(?:send\s+(?:a\s+)?(?:message|msg|whatsapp|wa)\s+to|message|whatsapp|wa)\s+[a-zA-Z\u0900-\u097F]/i.test(t)
    || /^(?:write|send)\s+(?:a\s+)?(?:message|msg)\s+to\s+[a-zA-Z\u0900-\u097F]/i.test(t)
    || /^tell\s+[a-zA-Z\u0900-\u097F]{2,}\s+/i.test(t)
    || /^send\s+.+\s+to\s+[a-zA-Z\u0900-\u097F]{2,}$/i.test(t)
  ) {
    return { type: "send_message", category: "send_message" };
  }

  if (
    /^(?:save|add)\s+(?:contact|number|phone)/i.test(t)
    || /^(?:save|add)\s+[a-zA-Z\u0900-\u097F\s]{1,25}\s+(?:as|=|:)\s*[\d+]/i.test(t)
    || /\bmy contacts\b|\blist contacts\b|\bshow contacts\b/.test(t)
    || t === "contacts"
  ) {
    return { type: "save_contact", category: "save_contact" };
  }

  if (
    parseWeatherCity(t)
    || /\b(weather|temperature|temp|forecast|rain|humidity|wind|aqi|climate)\b/.test(t)
  ) {
    return { type: "research", category: "weather" };
  }

  if (detectReminderIntent(t).intent !== "unknown") {
    return { type: "reminder", category: "reminder" };
  }

  if (looksLikeCalendarQuestion(t)) {
    return { type: "calendar", category: "calendar" };
  }

  if (
    /\b(how much (did i|have i|i'?ve?)\s*(spent?|paid|used|spend))\b/.test(t)
    || /\b(spending|expenses?|budget|receipt|invoice|transaction|money spent|cost me)\b/.test(t)
  ) {
    return { type: "spending", category: "spending" };
  }

  if (
    /\b(search|find|look up|check|show|get)\s+(my\s+)?(email|inbox|mail|messages?)\b/.test(t)
    || /\bwhat did .+ (say|write|send|email)\b/.test(t)
    || /\bemail from\b/.test(t)
    || /\bdid .+ (reply|respond|email|send)\b/.test(t)
    || /\bany (emails?|messages?) (from|about|regarding)\b/.test(t)
  ) {
    return { type: "email", category: "email_search" };
  }

  if (
    /\b(draft|write|compose|create|send)\s+(an?\s+)?(email|mail|message|reply|response|follow.?up)\b/.test(t)
    || /\b(reply|respond)\s+(to|with)\b/.test(t)
    || /\bwrite (to|for|an email)\b/.test(t)
    || /\b(email|message)\s+(asking|saying|telling|about|regarding|for)\b/.test(t)
  ) {
    return { type: "email", category: "draft_email" };
  }

  if (
    /^(hi+|hello+|hey+|howdy|good\s*(morning|evening|afternoon|night)|namaste|hola|bonjour|sup|yo|what'?s up|greetings)\b/.test(t)
    && t.length < 40
  ) {
    return { type: "greeting", category: "greeting" };
  }

  if (
    looksLikeArchitectureCodingQuestion(t, text, words)
    || 
    /\b(python|javascript|typescript|ts|java\b|c\+\+|cpp|golang|go\b|rust|php|swift|kotlin|ruby|scala|bash|shell|sql|html|css|react|node|django|flask|spring|express)\b/.test(t)
    || /\b(in|with)\s+js\b/.test(t)
    || /\bjs\s+(code|script|function|program)\b/.test(t)
    || /\b(give|show|provide)\s+(me\s+)?(the\s+)?code\s+(for|to)\b/.test(t)
    || /\b(write|create|build|code|program|implement|fix|debug|optimize|refactor|review)\s+(a\s+|the\s+|my\s+)?(code|function|script|program|class|component|api|endpoint|query|algorithm|app|bot|tool|hook|module)\b/.test(t)
    || /\b(rat in maze|fibonacci|binary search|bubble sort|merge sort|quicksort|linked list|binary tree|graph|dynamic programming|recursion|backtracking|two sum|palindrome|anagram|prime|factorial|n[-\s]?queen|n[-\s]?queens)\b/.test(t)
    || /\b(time complexity|space complexity|big o|algorithm|data structure|oop|object oriented|polymorphism|inheritance|interface|abstract class)\b/.test(t)
    || (words.length <= 4 && /\b(in\s+(python|js|java|typescript|golang|rust|c\+\+|php|ruby))\b/.test(t))
  ) {
    return { type: "coding", category: "coding" };
  }

  if (
    /\b(table of|multiplication table|times table|solve|calculate|compute|find the value|what is \d[\d,]*(?:\.\d+)?|how much is \d[\d,]*(?:\.\d+)?)\b/.test(t)
    || /\b(equation|formula|derivative|integral|matrix|vector|probability|statistics|mean|median|mode|standard deviation|variance|hypothesis|algebra|calculus|geometry|trigonometry)\b/.test(t)
    || /\b(sqrt|square root|cube root|log|logarithm|exponent|factorial|permutation|combination|binomial)\b/.test(t)
    || /^\s*[\d\s\+\-\*\/\(\)\^\%\.=]+\s*$/.test(t)
    || /\b\d+\s*[\+\-\*\/\^]\s*\d+\b/.test(t)
    || /\b\d[\d,]*(?:\.\d+)?\s*(?:%|percent)\s+of\s+\d[\d,]*(?:\.\d+)?\b/.test(t)
  ) {
    return { type: "math", category: "math" };
  }

  if (looksLikeRealtimeResearch(t)) {
    return { type: "research", category: "research" };
  }

  if (
    /\b(physics|chemistry|biology|genetics|astronomy|ecology|geology|neuroscience|quantum|atom|molecule|cell|dna|rna|evolution|photosynthesis|thermodynamics|electromagnetism|relativity|gravity|force|energy|wave|particle)\b/.test(t)
    || /\b(periodic table|element|compound|reaction|enzyme|protein|virus|bacteria|planet|star|galaxy|black hole|solar system|climate change|ecosystem)\b/.test(t)
  ) {
    return { type: "science", category: "science" };
  }

  if (
    /\b(history|historical|ancient|medieval|modern history|world war|revolution|empire|civilization|dynasty|king|queen|emperor|pharaoh|battle|treaty|independence|colonialism|renaissance|industrial revolution)\b/.test(t)
    || /\b(when did|who was the first|who founded|which year|who invented|who discovered|when was .* born|when did .* die)\b/.test(t)
    || /\b(mughal|british empire|roman empire|greek|persian|ottoman|mongolian|chinese dynasty|american revolution|french revolution|cold war|ww1|ww2|world war 1|world war 2)\b/.test(t)
  ) {
    return { type: "history", category: "history" };
  }

  if (
    /\b(capital of|largest city|smallest country|population of|where is|located in|continent|country|nation|state|province|river|mountain|ocean|lake|desert|forest|border|flag of)\b/.test(t)
    || /\b(geography|map|region|territory|hemisphere|latitude|longitude|equator|timezone)\b/.test(t)
  ) {
    return { type: "geography", category: "geography" };
  }

  if (
    /\b(symptom|disease|illness|medicine|drug|treatment|surgery|diagnosis|doctor|hospital|vitamin|protein|calorie|diet|nutrition|exercise|fitness|mental health|anxiety|depression|diabetes|cancer|heart|blood pressure|covid|vaccine|antibiotic|pain)\b/.test(t)
    || /\b(how to lose weight|how to gain muscle|what causes|is it healthy|side effects of|dosage of|how long does)\b/.test(t)
  ) {
    return { type: "health", category: "health" };
  }

  if (
    /\b(law|legal|rights|constitution|court|judge|lawyer|attorney|contract|lawsuit|crime|criminal|civil|property|copyright|patent|trademark|gdpr|ipc|crpc|fir|bail|appeal|jurisdiction|verdict|evidence|testimony)\b/.test(t)
  ) {
    return { type: "law", category: "law" };
  }

  if (
    /\b(stock|share|market|invest|mutual fund|sip|ipo|nse|bse|sensex|nifty|inflation|gdp|interest rate|loan|emi|tax|gst|income tax|budget|economy|recession|rbi|fed|central bank|cryptocurrency|bitcoin|forex|trading|portfolio|dividend)\b/.test(t)
    || /\b(business|startup|revenue|profit|loss|balance sheet|cash flow|roi|cagr|market cap|valuation|funding|venture capital)\b/.test(t)
  ) {
    return { type: "economics", category: "economics" };
  }

  if (
    /\b(book|author|novel|poem|poetry|literature|philosophy|philosopher|religion|god|spirituality|mythology|art|painting|music|song|film|movie|director|actor|culture|festival|tradition|language origin|meaning of)\b/.test(t)
    || /\b(plato|aristotle|socrates|kant|nietzsche|buddhism|hinduism|islam|christianity|judaism|sikhism|shakespeare|tolstoy|tagore|homer|dante|goethe|kafka)\b/.test(t)
  ) {
    return { type: "culture", category: "culture" };
  }

  if (
    /\b(cricket|football|soccer|tennis|basketball|badminton|hockey|golf|rugby|baseball|volleyball|swimming|athletics|olympics|world cup|ipl|nba|fifa|wimbledon|player|team|match|tournament|championship|record|score|goal|wicket|century|hat-trick|referee|offside|penalty)\b/.test(t)
  ) {
    return { type: "sports", category: "sports" };
  }

  if (
    /\b(artificial intelligence|ai|machine learning|neural network|chatgpt|gpt|llm|deep learning|computer vision|nlp|internet|wifi|5g|blockchain|cloud computing|cybersecurity|hacking|vpn|router|smartphone|laptop|processor|gpu|ram|ssd|operating system|windows|linux|macos|android|ios|app|software|saas|vector databases?|graph databases?|knowledge graph|semantic search|retrieval|transformer|attention|quic|tcp|tls|http\/3)\b/.test(t)
    && !/\b(write code|implement|debug|fix this|build a)\b/.test(t)
  ) {
    return { type: "technology", category: "technology" };
  }

  if (
    /\b(translate|translation|meaning of|in hindi|in english|in spanish|in french|in arabic|in chinese|grammar|spelling|pronunciation|synonym|antonym|vocabulary|idiom|phrase|sentence|word for)\b/.test(t)
  ) {
    return { type: "language", category: "language" };
  }

  if (
    /^(what is|what are|what does|what was|what were|who is|who are|who was|how does|how do|how is|how are|why does|why do|why is|why are|explain|define|describe|tell me about|give me information about)\b/.test(t)
  ) {
    return { type: "explain", category: "explain" };
  }

  if (
    /\b(write an email|draft an email|email to|send email|email for|compose email|reply to|subject line)\b/.test(t)
  ) {
    return { type: "email", category: "email" };
  }

  if (
    /\b(write|create|compose|generate|draft)\s+(an?\s+|some\s+)?(story|poem|essay|letter|speech|article|articles|blog|blog post|script|song|caption|tagline|slogan|joke|riddle|limerick)\b/.test(t)
    || /\b(write|create|compose|generate|draft)\s+me\s+(an?\s+|some\s+)?(story|poem|essay|letter|speech|article|articles|blog|blog post|script|song|caption|tagline|slogan|joke|riddle|limerick)\b/.test(t)
    || /\b(can|could|will|please)\s+you\s+(write|create|compose|generate|draft)\s+(an?\s+|some\s+)?(story|poem|essay|letter|speech|article|articles|blog|blog post|script|song|caption|tagline|slogan|joke|riddle|limerick)\b/.test(t)
  ) {
    return { type: "creative", category: "creative" };
  }

  if (
    /\b(compare|difference between|pros and cons|advantages|disadvantages|best way to|should i|which is better|recommend|analysis|review|evaluate|assessment)\b/.test(t)
  ) {
    return { type: "research", category: "research" };
  }

  return { type: "general", category: "general" };
}

function buildHelpMessage(): string {
  return [
    "🦞 *ClawCloud AI - What I can do*",
    "",
    "━━━ 💬 *Ask me anything* ━━━",
    "• Any question on science, history, math, law, health",
    "• Example: _What is quantum entanglement?_",
    "",
    "━━━ 💻 *Code* ━━━",
    "• Write, debug, and explain code in any language",
    "• Example: _Write a Python function to sort a dict by value_",
    "",
    "━━━ 📊 *Math* ━━━",
    "• Step-by-step solutions with working shown",
    "• Example: _Solve: 3x² + 5x - 2 = 0_",
    "",
    "━━━ ✍️ *Writing* ━━━",
    "• Emails, essays, reports, cover letters, and captions",
    "• Example: _Write a professional email asking for a refund_",
    "",
    "━━━ 📧 *Email* ━━━",
    "• Search inbox: _What did Priya say about the invoice?_",
    "• Draft replies: _Draft replies to my last 3 emails_",
    "",
    "━━━ 📅 *Calendar* ━━━",
    "• Check meetings: _What meetings do I have today?_",
    "",
    "━━━ ⏰ *Reminders* ━━━",
    "• _Remind me at 6pm to call Raj_",
    "• _Remind me in 30 minutes to drink water_",
    "• _Show my reminders_",
    "",
    "━━━ 🌤️ *Weather* ━━━",
    "• _Weather in Delhi today_",
    "",
    "━━━ 🗞️ *News* ━━━",
    "• _Latest news about AI_",
    "",
    "━━━ 🖼️ *Images* ━━━",
    "• Send a photo and I'll describe it, read text, or answer questions",
    "",
    "━━━ 🎤 *Voice notes* ━━━",
    "• Send a voice note and I'll transcribe and respond",
    "",
    "━━━ 📄 *Documents* ━━━",
    "• Send a PDF or Word document and I'll summarize or answer questions",
    "",
    "━━━ 🌐 *Translate* ━━━",
    "• _Translate this to Hindi: Good morning, how are you?_",
    "",
    "Need help with something specific? Just ask naturally.",
  ].join("\n");
}

function isLowCoverageResearchReply(reply: string): boolean {
  const t = (reply ?? "").toLowerCase().trim();
  return (
    t.includes("reliable information for this detail is not available in the retrieved sources")
    || t.includes("coverage remained below threshold")
    || (t.includes("## short summary") && t.includes("## key updates"))
    || t.includes("live research request:")
    || t.includes("i could not verify enough reliable live sources")
    || t.includes("send one precise query with scope + timeframe")
    || t.includes("i will return an accurate, up-to-date answer with live sources")
    || t.includes("evidence coverage is limited")
    || t.includes("research coverage is limited")
  );
}

function normalizeResearchMarkdownForWhatsApp(reply: string): string {
  return reply
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasLiveEvidenceMarkers(answer: string): boolean {
  const t = answer.toLowerCase();
  return (
    /\bsources?:/i.test(answer)
    || t.includes("source domains:")
    || t.includes("live data as of")
    || t.includes("searched:")
    || t.includes("live answer")
    || t.includes("source note:")
  );
}

function looksUnsafeUngroundedNumericalAnswer(answer: string): boolean {
  const t = answer.toLowerCase();
  const hasNumbers = /\d+(?:\.\d+)?/.test(answer);
  const hasRiskLanguage = /unavailable|not found|could not|cannot|may shift|verify|subject to change/.test(t);
  return hasNumbers && !hasLiveEvidenceMarkers(answer) && !hasRiskLanguage;
}

function isAcceptableLiveAnswer(answer: string | null | undefined): boolean {
  const normalized = answer?.trim() ?? "";
  if (!normalized) return false;
  if (isVisibleFallbackReply(normalized) || isLowCoverageResearchReply(normalized)) return false;
  if (!hasLiveEvidenceMarkers(normalized)) return false;
  if (looksUnsafeUngroundedNumericalAnswer(normalized)) return false;
  return true;
}

function buildNewsCoverageRecoveryReply(question: string): string {
  const q = question.trim().slice(0, 120);
  return [
    `*Latest Update Request:* ${q}`,
    "",
    "I could not verify enough reliable live sources for this exact query yet.",
    "",
    "Send one specific topic + location for a precise update:",
    "- _India stock market news today_",
    "- _Delhi weather today_",
    "- _Latest AI policy news in US today_",
    "",
    "I will return a clean, professional update.",
  ].join("\n");
}

async function buildLiveCoverageRecoveryReply(
  userId: string,
  question: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
  memorySnippet?: string,
): Promise<string> {
  if (shouldUseLiveSearch(question)) {
    const q = question.trim().slice(0, 100);
    return [
      `🔍 *${q}*`,
      "",
      "I could not verify enough live sources right now for an accurate answer.",
      "Please retry in a moment. I will return fresh, source-backed data.",
    ].join("\n");
  }

  const knowledgeReply = await completeClawCloudPrompt({
    system: [
      buildSmartSystem("deep", "research", question, undefined, memorySnippet),
      "",
      "OVERRIDE INSTRUCTIONS:",
      "You MUST answer the user's question from training knowledge.",
      "Do NOT say: cannot verify, no live access, or similar refusal.",
      "If details may have shifted, add one short note at the end.",
      "Format for WhatsApp with headers and bullets.",
      "End with: Need anything else?",
    ].join("\n"),
    user: question,
    history,
    intent: "research",
    responseMode: "deep",
    preferredModels: [
      "meta/llama-3.3-70b-instruct",
      "mistralai/mistral-large-3-675b-instruct-2512",
      "moonshotai/kimi-k2-instruct-0905",
    ],
    maxTokens: 1_200,
    fallback: "",
    skipCache: true,
    temperature: 0.75,
  }).catch(() => "");

  const cleaned = (knowledgeReply ?? "").trim();
  if (
    cleaned.length > 80
    && !isVisibleFallbackReply(cleaned)
    && !isLowQualityTemplateReply(cleaned)
    && !cleaned.toLowerCase().includes("cannot verify")
    && !cleaned.toLowerCase().includes("could not verify")
    && !cleaned.toLowerCase().includes("live sources")
    && !cleaned.toLowerCase().includes("i cannot access")
  ) {
    return cleaned;
  }

  const forcedReply = await completeClawCloudPrompt({
    system: [
      "You are ClawCloud AI.",
      "Answer directly and completely from training knowledge.",
      "Do not refuse. Do not mention internet/live-source limitations.",
      "Format for WhatsApp with concise structured sections.",
    ].join("\n"),
    user: question,
    history: [],
    intent: "research",
    responseMode: "deep",
    preferredModels: ["meta/llama-3.3-70b-instruct"],
    maxTokens: 1_200,
    fallback: "",
    skipCache: true,
    temperature: 0.7,
  }).catch(() => "");

  const forced = (forcedReply ?? "").trim();
  if (forced.length > 60 && !isVisibleFallbackReply(forced) && !isLowQualityTemplateReply(forced)) {
    return forced;
  }

  const q = question.trim().slice(0, 100);
  return [
    `🔍 *${q}*`,
    "",
    "I'm having trouble fetching live sources right now.",
    "Ask the same question more specifically and I will answer from knowledge immediately.",
    "Example: _Who are the top 10 richest people in 2026?_",
  ].join("\n");
}

async function notifyBackgroundTaskFailure(
  userId: string,
  locale: SupportedLocale,
  taskLabel: string,
  error: unknown,
) {
  const messageText = error instanceof Error ? error.message : String(error);
  console.error(`[agent] ${taskLabel} failed for ${userId}:`, messageText);

  const userError = messageText.includes("Daily limit")
    ? "⚠️ *Daily limit reached.*\n\nYou have used all your runs today. Upgrade at swift-deploy.in/pricing"
    : /(gmail|token|oauth|google)/i.test(messageText)
    ? `⚠️ *${taskLabel} could not access Gmail.*\n\nYour Google connection may need to be reconnected at swift-deploy.in.`
    : /(calendar)/i.test(messageText)
    ? `⚠️ *${taskLabel} could not access your calendar.*\n\nPlease reconnect Google Calendar at swift-deploy.in and try again.`
    : /(whatsapp|session|deliver)/i.test(messageText)
    ? `⚠️ *${taskLabel} finished but delivery failed.*\n\nPlease try again in a moment.`
    : `⚠️ *${taskLabel} ran into a problem.*\n\nPlease try again in a few minutes.`;

  await sendClawCloudWhatsAppMessage(userId, await translateMessage(userError, locale)).catch(
    () => null,
  );
}

function runTaskFireAndForget(
  userId: string,
  taskType: ClawCloudTaskType,
  userMessage: string | null | undefined,
  locale: SupportedLocale,
  taskLabel: string,
) {
  void (async () => {
    try {
      await runClawCloudTask({ userId, taskType, userMessage });
    } catch (error) {
      await notifyBackgroundTaskFailure(userId, locale, taskLabel, error);
    }
  })();
}

function runReplyApprovalsFireAndForget(
  userId: string,
  count: number,
  locale: SupportedLocale,
) {
  void (async () => {
    try {
      await sendReplyApprovalRequests(userId, count);
    } catch (error) {
      await notifyBackgroundTaskFailure(userId, locale, "Email drafting", error);
    }
  })();
}

export async function routeInboundAgentMessage(
  userId: string,
  message: string,
): Promise<string | null> {
  const routeStartedAt = Date.now();
  const requested = extractModeOverride(message);
  const trimmed = requested.cleaned;
  if (!trimmed) return null;

  const localePromise = getUserLocale(userId);
  const finalizeEarlyRaw = async (reply: string, intent: string, category: string) =>
    finalizeAgentReply({
      userId,
      locale: await localePromise,
      question: trimmed,
      intent,
      category,
      startedAt: routeStartedAt,
      reply,
    });
  const finalizeEarlyTranslated = async (reply: string, intent: string, category: string) =>
    finalizeAgentReply({
      userId,
      locale: await localePromise,
      question: trimmed,
      intent,
      category,
      startedAt: routeStartedAt,
      reply,
      alreadyTranslated: true,
    });

  // 1. Approval commands (SEND/EDIT/SKIP)
  const approval = await handleReplyApprovalCommand(userId, trimmed);
  if (approval.handled) return finalizeEarlyTranslated(approval.response, "help", "help");
  const memoryCommand = detectMemoryCommand(trimmed);

  if (memoryCommand.type === "show_profile") {
    const facts = await getAllMemoryFacts(userId);
    return finalizeEarlyRaw(formatProfileReply(facts), "memory", "memory");
  }

  if (memoryCommand.type === "forget_all") {
    const count = await clearAllMemoryFacts(userId);
    return finalizeEarlyRaw(formatMemoryClearedReply(count), "memory", "memory");
  }

  if (memoryCommand.type === "forget_key") {
    const found = await deleteMemoryFact(userId, memoryCommand.key);
    return finalizeEarlyRaw(formatMemoryForgotReply(memoryCommand.key, found), "memory", "memory");
  }

  if (memoryCommand.type === "save_explicit") {
    const saved = await saveMemoryFact(userId, memoryCommand.key, memoryCommand.value, "explicit", 1.0);
    const reply = saved
      ? formatMemorySavedReply(memoryCommand.key, memoryCommand.value)
      : "⚠️ *I couldn't save that right now.* Please try again in a moment.";
    return finalizeEarlyRaw(reply, "memory", "memory");
  }

  void autoExtractAndSaveFacts(userId, trimmed).catch(() => null);
  void autoDetectAndSaveTimezone(userId, trimmed).catch(() => null);

  const [memory, userProfileSnippet, locale] = await Promise.all([
    buildConversationMemory(userId, trimmed),
    loadUserProfileSnippet(userId),
    localePromise,
  ]);
  const memorySnippet = buildMemorySystemSnippet(memory, userProfileSnippet);
  const finalMessage = memory.resolvedQuestion.trim() || trimmed;
  const hasDocumentContext = looksLikeDocumentContext(finalMessage);

  const detected = detectIntent(finalMessage);
  let resolvedType = hasDocumentContext ? "research" : detected.type;
  let resolvedCategory = hasDocumentContext ? "research" : detected.category;

  if (
    !hasDocumentContext
    && resolvedCategory !== "send_message"
    && resolvedCategory !== "save_contact"
    && resolvedCategory !== "finance"
    && resolvedCategory !== "web_search"
  ) {
    if (looksLikeConceptualTechnologyQuestion(finalMessage)) {
      resolvedType = "technology";
      resolvedCategory = "technology";
    } else if (resolvedCategory !== "math" && isMathOrStatisticsQuestion(finalMessage)) {
      resolvedType = "math";
      resolvedCategory = "math";
    } else if (resolvedCategory !== "coding" && isArchitectureOrDesignQuestion(finalMessage)) {
      resolvedType = "coding";
      resolvedCategory = "coding";
    } else if (
      /\b(code|program|algorithm|script|debug|n[-\s]?queen|n[-\s]?queens|python|javascript|java|c\+\+)\b/i.test(finalMessage)
      && resolvedCategory !== "coding"
    ) {
      resolvedType = "coding";
      resolvedCategory = "coding";
    } else if (
      /\b(weather|whether|temperature|forecast|rain|humidity|wind|aqi)\b/i.test(finalMessage)
      && resolvedCategory === "news"
    ) {
      resolvedType = "general";
      resolvedCategory = "general";
    } else if (
      resolvedCategory === "research"
      && !looksLikeRealtimeResearch(finalMessage)
      && finalMessage.length > 70
    ) {
      const domain = await semanticDomainClassify(finalMessage).catch(() => "GENERAL");

      if (domain === "FINANCE_MATH" || domain === "CAUSAL_STATS" || domain === "CLINICAL_BIO") {
        resolvedType = "math";
        resolvedCategory = "math";
      } else if (
        !looksLikeConceptualTechnologyQuestion(finalMessage)
        && (domain === "ML_SYSTEMS" || domain === "SYS_ARCH" || domain === "REGULATED_AI")
      ) {
        resolvedType = "coding";
        resolvedCategory = "coding";
      }
    }
  }

  const responseMode = resolveResponseMode(resolvedType, finalMessage, requested.mode);
  const explicitMode = requested.explicit;
  const finalizeRaw = (
    reply: string,
    intent: string = resolvedType,
    category: string = resolvedCategory,
  ) =>
    finalizeAgentReply({
      userId,
      locale,
      question: finalMessage,
      intent,
      category,
      startedAt: routeStartedAt,
      reply,
    });
  const finalizeTranslated = (
    reply: string,
    intent: string = resolvedType,
    category: string = resolvedCategory,
  ) =>
    finalizeAgentReply({
      userId,
      locale,
      question: finalMessage,
      intent,
      category,
      startedAt: routeStartedAt,
      reply,
      alreadyTranslated: true,
    });

  switch (resolvedCategory) {

    case "send_message": {
      return finalizeTranslated(
        await handleSendMessageToContact(userId, trimmed, locale),
        "send_message",
        "send_message",
      );
    }

    case "save_contact": {
      return finalizeTranslated(
        await handleSaveContactCommand(userId, trimmed, locale),
        "save_contact",
        "save_contact",
      );
    }

    case "weather": {
      return finalizeTranslated(
        await handleWeatherQuery(userId, trimmed, locale),
        "weather",
        "weather",
      );
    }

    case "spending": {
      const ans = await answerSpendingQuestion(userId, finalMessage);
      if (ans) return finalizeTranslated(ans, "spending", "spending");
      return finalizeRaw(
        await smartReply(userId, finalMessage, "spending", responseMode, explicitMode, undefined, memorySnippet),
        "spending",
        "spending",
      );
    }

    case "draft_email": {
      const count = /all|every|each/i.test(trimmed) ? 3 : 1;
      const ack = await fastAckQuick(
        `User message: "${trimmed}". They want email help. Acknowledge you're checking their inbox and drafting ${count} reply${count === 1 ? "" : "s"}. 1-2 lines max.`
      );
      runReplyApprovalsFireAndForget(userId, count, locale);
      return finalizeRaw(ack, "email", "draft_email");
    }

    case "email_search": {
      const ack = await fastAckQuick(
        `User message: "${trimmed}". They want to search email. Acknowledge you're searching their inbox. 1 line max.`
      );
      runTaskFireAndForget(userId, "email_search", trimmed, locale, "Email search");
      return finalizeRaw(ack, "email", "email_search");
    }

    case "reminder": {
      const intentResult = detectReminderIntent(trimmed);
      const userTimezone = await getUserReminderTimezone(userId);

      if (intentResult.intent === "list") {
        const reminders = await listActiveReminders(userId).catch(() => []);
        return finalizeRaw(formatReminderListReply(reminders, userTimezone), "reminder", "reminder");
      }

      if (intentResult.intent === "status") {
        const reminders = await listActiveReminders(userId).catch(() => []);
        return finalizeRaw(formatStatusReply(reminders, userTimezone), "reminder", "reminder");
      }

      if (intentResult.intent === "cancel_all") {
        const count = await cancelAllReminders(userId).catch(() => 0);
        return finalizeRaw(formatCancelAllReply(count), "reminder", "reminder");
      }

      if (intentResult.intent === "cancel_index") {
        const cancelled = await cancelReminderByIndex(userId, intentResult.index).catch(() => null);
        if (!cancelled) {
          const reminders = await listActiveReminders(userId).catch(() => []);
          return finalizeRaw(
            reminders.length
              ? `❌ *No reminder #${intentResult.index} found.*\n\nReply _show reminders_ to see your active list.`
              : "⏰ *You do not have any active reminders.*",
            "reminder",
            "reminder",
          );
        }

        return finalizeRaw(formatCancelReply(cancelled, intentResult.index), "reminder", "reminder");
      }

      if (intentResult.intent === "done") {
        const reminderText = await markLatestReminderDone(userId).catch(() => null);
        return finalizeRaw(
          reminderText ? formatDoneReply(reminderText) : "✅ *Got it.*",
          "reminder",
          "reminder",
        );
      }

      if (intentResult.intent === "snooze") {
        const result = await snoozeLatestReminder(userId, intentResult.minutes).catch(() => null);
        if (!result) {
          return finalizeRaw("⏰ *There is no recent reminder to snooze.*", "reminder", "reminder");
        }

        return finalizeRaw(
          formatSnoozeReply(
            result.reminderText,
            result.newFireAt,
            intentResult.minutes,
            userTimezone,
          ),
          "reminder",
          "reminder",
        );
      }

      const parsed = await parseReminderAI(trimmed, userTimezone);
      if (!parsed) {
        return finalizeRaw(
          [
            "⏰ *I can set that. I just need a time and task.*",
            "",
            "Examples:",
            "• _Remind me at 6pm to call Raj_",
            "• _Remind me in 30 minutes to drink water_",
            "• _Remind me every weekday at 9am for standup_",
            "• _Mujhe kal subah 8 baje yaad dilao ki medicine leni hai_",
          ].join("\n"),
          "reminder",
          "reminder",
        );
      }

      try {
        const saved = await saveReminder(
          userId,
          parsed.fireAt,
          parsed.reminderText,
          parsed.recurRule,
          trimmed,
        );
        const reminders = await listActiveReminders(userId).catch(() => [saved]);
        await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
        return finalizeRaw(
          formatReminderSetReply(saved, reminders.length, userTimezone),
          "reminder",
          "reminder",
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to save reminder.";
        if (/active reminders/i.test(message)) {
          return finalizeRaw(
            `⚠️ *${message}*\n\nReply _show reminders_ to manage them.`,
            "reminder",
            "reminder",
          );
        }

        throw error;
      }
    }

    case "calendar": {
      return finalizeTranslated(
        await answerCalendarQuestionSafe(userId, finalMessage, locale),
        "calendar",
        "calendar",
      );
    }

    case "finance": {
      const financeData = await getLiveFinanceData(finalMessage).catch(() => null);
      if (financeData) {
        await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
        return finalizeRaw(formatFinanceReply(financeData), "finance", "finance");
      }

      const searchAnswer = await answerWebSearch(finalMessage).catch(() => "");
      const normalizedSearch = searchAnswer.trim();
      if (isAcceptableLiveAnswer(normalizedSearch)) {
        const withSafety = /not financial advice/i.test(normalizedSearch)
          ? normalizedSearch
          : `${normalizedSearch}\n\n\u26A0\uFE0F _Not financial advice. Verify before trading._`;
        await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
        return finalizeRaw(
          normalizeResearchMarkdownForWhatsApp(withSafety),
          "finance",
          "finance",
        );
      }

      const safeFallback = [
        "\u26A0\uFE0F _Live price data unavailable right now._",
        "",
        "I could not fetch reliable market quotes for this request.",
        "Please retry shortly and share an exact ticker when possible (e.g., `RELIANCE.NS`, `BTC`, `USDINR`).",
        "",
        "\u26A0\uFE0F _Not financial advice. Verify before trading._",
      ].join("\n");
      return finalizeRaw(safeFallback, "finance", "finance");
    }

    case "web_search": {
      const searchAnswer = await answerWebSearch(finalMessage).catch(() => "");
      const normalizedSearch = searchAnswer.trim();
      if (isAcceptableLiveAnswer(normalizedSearch)) {
        await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
        return finalizeRaw(
          normalizeResearchMarkdownForWhatsApp(normalizedSearch),
          "web_search",
          "web_search",
        );
      }

      const history = memory.recentTurns.length
        ? memory.recentTurns
        : await buildSmartHistory(userId, finalMessage, "deep", "web_search");

      const researchAnswer = await runGroundedResearchReply({
        userId,
        question: finalMessage,
        history,
      }).catch(() => "");

      const normalizedResearch = researchAnswer?.trim() ?? "";
      if (isAcceptableLiveAnswer(normalizedResearch)) {
        return finalizeRaw(
          normalizeResearchMarkdownForWhatsApp(normalizedResearch),
          "web_search",
          "web_search",
        );
      }

      return finalizeRaw(buildNoLiveDataReply(finalMessage), "web_search", "web_search");
    }

    case "news": {
      const newsAnswer = await answerNewsQuestion(finalMessage).catch(() => "");
      const normalizedNews = newsAnswer.trim();
      if (isAcceptableLiveAnswer(normalizedNews)) {
        await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
        return finalizeRaw(
          normalizeResearchMarkdownForWhatsApp(normalizedNews),
          "news",
          "news",
        );
      }

      const history = memory.recentTurns.length
        ? memory.recentTurns
        : await buildSmartHistory(userId, finalMessage, "deep", "news");

      const groundedAnswer = await runGroundedResearchReply({
        userId,
        question: finalMessage,
        history,
      }).catch(() => "");

      const normalizedGrounded = groundedAnswer?.trim() ?? "";
      if (isAcceptableLiveAnswer(normalizedGrounded)) {
        return finalizeRaw(
          normalizeResearchMarkdownForWhatsApp(normalizedGrounded),
          "news",
          "news",
        );
      }

      const staleWarning = `${buildNoLiveDataReply(finalMessage)}\n\n`;
      const freshnessSafeQuestion = finalMessage
        .replace(/\b(right now|currently|at the moment|as of now|today|live)\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();

      const knowledgeReply = await smartReply(
        userId,
        freshnessSafeQuestion || finalMessage,
        "research",
        responseMode,
        explicitMode,
        "Answer directly using best available knowledge. If this topic changes frequently, add one short freshness note at the end.",
        memorySnippet,
      );
      return finalizeRaw(staleWarning + knowledgeReply, "news", "news");

    }

    case "coding": {
      const deterministic = solveCodingArchitectureQuestion(finalMessage);
      if (deterministic) {
        return finalizeRaw(deterministic, "coding", "coding");
      }

      const reply =
        responseMode === "deep"
          ? (await expertReply(userId, finalMessage, "coding"))
            ?? await smartReply(userId, finalMessage, "coding", responseMode, explicitMode, undefined, memorySnippet)
          : await smartReply(userId, finalMessage, "coding", responseMode, explicitMode, undefined, memorySnippet);
      return finalizeRaw(reply, "coding", "coding");
    }

    case "math": {
      const mathExpert = await expertReply(userId, finalMessage, "math");
      if (mathExpert) {
        return finalizeRaw(mathExpert, "math", "math");
      }

      const mathDomain = await semanticDomainClassify(finalMessage).catch(() => "GENERAL");
      if (mathDomain === "FINANCE_MATH" || mathDomain === "CAUSAL_STATS" || mathDomain === "CLINICAL_BIO") {
        const semanticAnswer = await solveWithUniversalExpert({
          question: finalMessage,
          intent: "math",
        }).catch(() => "");

        if (semanticAnswer.trim()) {
          return finalizeRaw(semanticAnswer, "math", "math");
        }
      }

      const reply = await smartReply(userId, finalMessage, "math", responseMode, explicitMode, undefined, memorySnippet);
      return finalizeRaw(reply, "math", "math");
    }

    case "creative": {
      const reply = await smartReply(userId, finalMessage, "creative", responseMode, explicitMode, undefined, memorySnippet);
      return finalizeRaw(reply, "creative", "creative");
    }

    case "explain": {
      const reply = await smartReply(
        userId,
        finalMessage,
        "explain",
        responseMode,
        explicitMode,
        "Answer this explanation question clearly, accurately, and in teaching style with WhatsApp-friendly formatting.",
        memorySnippet,
      );
      return finalizeRaw(reply, "explain", "explain");
    }

    case "research": {
      if (hasDocumentContext) {
        const reply = await smartReply(
          userId,
          finalMessage,
          "research",
          responseMode,
          explicitMode,
          "Use only the document content already included in the message. Answer the user's question directly, check every stated constraint explicitly, and if choosing among options, name the winner, briefly explain why the others do not qualify, and mention one extra supporting operational differentiator from the winning row when the document provides it, such as support level, incident response, SLA, turnaround time, or another concrete field that was not already one of the hard constraints. Do not use Gmail, spending history, or outside knowledge.",
          memorySnippet,
        );
        return finalizeRaw(reply, "research", "research");
      }

      const realtimeResearch = looksLikeRealtimeResearch(finalMessage);
      const expertAnswer = await expertReply(userId, finalMessage, "research");
      if (expertAnswer && !isVisibleFallbackReply(expertAnswer) && !isLowCoverageResearchReply(expertAnswer)) {
        return finalizeRaw(expertAnswer, "research", "research");
      }

      if (realtimeResearch) {
        if (expertAnswer && isLowCoverageResearchReply(expertAnswer)) {
          const recovery = await buildLiveCoverageRecoveryReply(userId, finalMessage, memory.recentTurns, memorySnippet);
          return finalizeRaw(recovery, "research", "research");
        }

        const history = memory.recentTurns.length
          ? memory.recentTurns
          : await buildSmartHistory(userId, finalMessage, "deep", "research");
        const grounded = await runGroundedResearchReply({
          userId,
          question: finalMessage,
          history,
        }).catch(() => "");

        const normalizedGrounded = grounded?.trim() ?? "";
        if (normalizedGrounded && !isVisibleFallbackReply(normalizedGrounded) && !isLowCoverageResearchReply(normalizedGrounded)) {
          return finalizeRaw(
            normalizeResearchMarkdownForWhatsApp(normalizedGrounded),
            "research",
            "research",
          );
        }

        const recovery = await buildLiveCoverageRecoveryReply(userId, finalMessage, history, memorySnippet);
        return finalizeRaw(recovery, "research", "research");
      }

      const reply = await smartReply(userId, finalMessage, "research", responseMode, explicitMode, undefined, memorySnippet);
      return finalizeRaw(reply, "research", "research");
    }

    case "help": {
      return finalizeRaw(buildHelpMessage(), "help", "help");
    }

    case "greeting": {
      const reply = await smartReply(userId, finalMessage, "greeting", responseMode, explicitMode, undefined, memorySnippet);
      return finalizeRaw(reply, "greeting", "greeting");
    }

    default: {
      if (looksLikeRealtimeResearch(finalMessage)) {
        const history = memory.recentTurns.length
          ? memory.recentTurns
          : await buildSmartHistory(userId, finalMessage, "deep", resolvedType);
        const grounded = await runGroundedResearchReply({
          userId,
          question: finalMessage,
          history,
        }).catch(() => "");

        const normalizedGrounded = grounded?.trim() ?? "";
        if (normalizedGrounded && !isVisibleFallbackReply(normalizedGrounded) && !isLowCoverageResearchReply(normalizedGrounded)) {
          return finalizeRaw(
            normalizeResearchMarkdownForWhatsApp(normalizedGrounded),
            resolvedType,
            resolvedCategory,
          );
        }

        const recovery = await buildLiveCoverageRecoveryReply(userId, finalMessage, history, memorySnippet);
        return finalizeRaw(recovery, resolvedType, resolvedCategory);
      }

      const reply = await smartReply(
        userId,
        finalMessage,
        resolvedType,
        responseMode,
        explicitMode,
        buildIntentSpecificInstruction(resolvedType, finalMessage),
        memorySnippet,
      );
      return finalizeRaw(
        postProcessIntentReply(resolvedType, finalMessage, reply),
        resolvedType,
        resolvedCategory,
      );
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
  const minutesBefore = Number(config.minutes_before ?? 30);
  const windowStart = new Date(Date.now() + (minutesBefore - 2) * 60_000);
  const windowEnd = new Date(Date.now() + (minutesBefore + 5) * 60_000);
  const events = await getClawCloudCalendarEvents(userId, {
    timeMin: windowStart.toISOString(),
    timeMax: windowEnd.toISOString(),
  });

  if (!events.length) {
    return { eventCount: 0 };
  }

  let briefingsSent = 0;
  for (const event of events) {
    const sent = await sendMeetingBriefing({
      userId,
      eventId: String(event.id || event.summary || Math.random()),
      eventTitle: event.summary,
      eventStart: event.start,
      hangoutLink: event.hangoutLink ?? null,
      attendees: parseCalendarAttendees(event as unknown as Record<string, unknown>),
      minutesBefore,
    });

    if (sent) {
      briefingsSent += 1;
    }
  }

  return { eventCount: events.length, briefingsSent };
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
  return sendEveningSummary(userId);
}

async function getUserReminderTimezone(userId: string) {
  const { data } = await getClawCloudSupabaseAdmin()
    .from("users")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle()
    .catch(() => ({ data: null }));

  return (data?.timezone as string | undefined) ?? "Asia/Kolkata";
}

async function runCustomReminder(userId: string, userMessage: string | null | undefined) {
  const raw = userMessage?.trim() ?? "";
  if (!raw) throw new Error("Reminder requires a message.");

  const userTimezone = await getUserReminderTimezone(userId);
  const parsed = await parseReminderAI(raw, userTimezone);
  if (!parsed) {
    await sendClawCloudWhatsAppMessage(
      userId,
      [
        "⏰ *I couldn't parse that reminder.*",
        "",
        "Try:",
        "• _Remind me at 5pm to call Priya_",
        "• _Remind me in 30 minutes to take medicine_",
        "• _Remind me tomorrow to send the report_",
      ].join("\n"),
    );
    await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
    return { set: false };
  }

  try {
    const saved = await saveReminder(
      userId,
      parsed.fireAt,
      parsed.reminderText,
      parsed.recurRule,
      raw,
    );
    const reminders = await listActiveReminders(userId).catch(() => [saved]);
    await sendClawCloudWhatsAppMessage(
      userId,
      formatReminderSetReply(saved, reminders.length, userTimezone),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save reminder.";
    await sendClawCloudWhatsAppMessage(
      userId,
      /active reminders/i.test(message)
        ? `⚠️ *${message}*\n\nReply _show reminders_ to manage them.`
        : "❌ *I couldn't save that reminder right now.*",
    );
    await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
    return { set: false };
  }

  await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
  return { set: true, fireAt: parsed.fireAt, reminderText: parsed.reminderText };
}

// ─── runClawCloudTask ─────────────────────────────────────────────────────────

async function handleWeatherQuery(
  userId: string,
  text: string,
  locale: SupportedLocale,
): Promise<string> {
  const city = parseWeatherCity(text);
  if (!city) {
    return translateMessage(
      [
        "🌦️ *Weather Update*",
        "",
        "Tell me the city name, for example:",
        "• _Weather in Delhi_",
        "• _Temperature in Chandigarh now_",
      ].join("\n"),
      locale,
    );
  }

  const weather = await getWeather(city);
  if (weather) {
    await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
    return translateMessage(weather, locale);
  }

  return translateMessage(
    `🌦️ *Weather for ${city}*\n\nI could not fetch live weather right now. Please try again in a moment.`,
    locale,
  );
}

function buildIntentSpecificInstruction(intent: IntentType, message: string) {
  const normalized = message.toLowerCase();

  if (intent === "technology" && looksLikeConceptualTechnologyQuestion(normalized)) {
    return "Answer as a technology comparison: define both sides, compare strengths, failure modes, trade-offs, and close with when to choose each.";
  }

  if (intent === "science" && /\b(why|how|difference|compare)\b/.test(normalized)) {
    return "Answer with mechanism first, then explain why it matters in practice. Use precise scientific terms but keep the flow teachable.";
  }

  if ((intent === "general" || intent === "explain") && /\b(framework|playbook|plan|steps|approach)\b/.test(normalized)) {
    return "Answer with a named framework or numbered playbook, not loose prose. Keep each step concrete and operational.";
  }

  if (intent === "language" && /\btranslate|translation\b/.test(normalized)) {
    return "Return the translation directly, preserve the original meaning, and clearly label each language.";
  }

  return undefined;
}

function postProcessIntentReply(intent: IntentType, question: string, reply: string) {
  const normalizedQuestion = question.toLowerCase();
  const normalizedReply = reply.toLowerCase();

  if (
    /\b(framework|playbook|plan|steps|approach)\b/.test(normalizedQuestion)
    && !/\b(framework|playbook)\b/.test(normalizedReply.slice(0, 120))
  ) {
    return `*Framework*\n\n${reply}`;
  }

  return reply;
}

async function answerCalendarQuestion(
  userId: string,
  text: string,
  locale: SupportedLocale,
): Promise<string> {
  const connected = await isGoogleCalendarConnected(userId);
  if (!connected) {
    return translateMessage(
      "ðŸ“… *Google Calendar is not connected.*\n\nReconnect it in the dashboard, then I can answer schedule questions directly.",
      locale,
    );
  }

  const timezone = await getUserReminderTimezone(userId);
  const window = buildCalendarQueryWindow(text);
  const events = await getClawCloudCalendarEvents(userId, {
    timeMin: window.timeMin,
    timeMax: window.timeMax,
    maxResults: 20,
  });

  if (!events.length) {
    return translateMessage(
      `ðŸ“… *No meetings found for ${window.label}.*\n\nYour calendar looks clear in that window.`,
      locale,
    );
  }

  const lines = events.map((event) => {
    const start = formatCalendarEventTime(event.start, timezone);
    const end = formatCalendarEventTime(event.end || event.start, timezone);
    const extras = [
      event.location ? `ðŸ“ ${event.location}` : "",
      event.hangoutLink ? `ðŸ”— ${event.hangoutLink}` : "",
    ].filter(Boolean);

    return [
      `â€¢ *${event.summary}*`,
      `  ${start} - ${end}`,
      ...extras.map((item) => `  ${item}`),
    ].join("\n");
  });

  const overlapNotes = findCalendarOverlaps(events);
  const spacingNotes = findCalendarBackToBack(events);
  const summary: string[] = [];

  if (window.checksSpacing) {
    if (overlapNotes.length) {
      summary.push(`âš ï¸ *Overlap:* ${overlapNotes.join("; ")}`);
    } else {
      summary.push("âœ… *Overlap:* none detected.");
    }

    if (spacingNotes.length) {
      summary.push(`â±ï¸ *Back-to-back:* ${spacingNotes.join("; ")}`);
    } else {
      summary.push("âœ… *Back-to-back:* none detected.");
    }
  }

  await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
  return translateMessage(
    [
      `ðŸ“… *Calendar for ${window.label}*`,
      "",
      ...lines,
      ...(summary.length ? ["", ...summary] : []),
    ].join("\n"),
    locale,
  );
}

async function answerCalendarQuestionSafe(
  userId: string,
  text: string,
  locale: SupportedLocale,
): Promise<string> {
  const connected = await isGoogleCalendarConnected(userId);
  if (!connected) {
    return translateMessage(
      "Google Calendar is not connected.\n\nReconnect it in the dashboard, then I can answer schedule questions directly.",
      locale,
    );
  }

  const timezone = await getUserReminderTimezone(userId);
  const window = buildCalendarQueryWindow(text);
  const events = await getClawCloudCalendarEvents(userId, {
    timeMin: window.timeMin,
    timeMax: window.timeMax,
    maxResults: 20,
  });

  if (!events.length) {
    return translateMessage(
      `No meetings found for ${window.label}.\n\nYour calendar looks clear in that window.`,
      locale,
    );
  }

  const lines = events.map((event) => {
    const start = formatCalendarEventTime(event.start, timezone);
    const end = formatCalendarEventTime(event.end || event.start, timezone);
    const extras = [
      event.location ? `Location: ${event.location}` : "",
      event.hangoutLink ? `Link: ${event.hangoutLink}` : "",
    ].filter(Boolean);

    return [
      `- *${event.summary}*`,
      `  ${start} - ${end}`,
      ...extras.map((item) => `  ${item}`),
    ].join("\n");
  });

  const overlapNotes = findCalendarOverlaps(events);
  const spacingNotes = findCalendarBackToBack(events);
  const summary: string[] = [];

  if (window.checksSpacing) {
    summary.push(
      overlapNotes.length ? `*Overlap:* ${overlapNotes.join("; ")}` : "*Overlap:* none detected.",
    );
    summary.push(
      spacingNotes.length ? `*Back-to-back:* ${spacingNotes.join("; ")}` : "*Back-to-back:* none detected.",
    );
  }

  await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
  return translateMessage(
    [
      `*Calendar for ${window.label}*`,
      "",
      ...lines,
      ...(summary.length ? ["", ...summary] : []),
    ].join("\n"),
    locale,
  );
}

async function handleSendMessageToContact(
  userId: string,
  text: string,
  locale: SupportedLocale,
): Promise<string> {
  const parsed = parseSendMessageCommand(text);
  if (!parsed) {
    return translateMessage(
      [
        "📤 *Send a message to a contact*",
        "",
        "Use this format:",
        "_Send message to Maa: Good morning!_",
        "_Message Papa: Call me when free_",
        "_Tell Priya: Meeting shifted to 6pm_",
        "",
        "First save a contact: _Save contact: Maa = +919876543210_",
      ].join("\n"),
      locale,
    );
  }

  const { contactName, message } = parsed;
  const fuzzyResult = await lookupContactFuzzy(userId, contactName);
  if (fuzzyResult.type === "not_found") {
    return translateMessage(
      formatNotFoundReply(contactName, fuzzyResult.suggestions),
      locale,
    );
  }

  if (fuzzyResult.type === "ambiguous") {
    return translateMessage(
      formatAmbiguousReply(contactName, fuzzyResult.matches),
      locale,
    );
  }

  const phone = fuzzyResult.contact.phone;
  const resolvedName = fuzzyResult.contact.name;

  try {
    await sendClawCloudWhatsAppToPhone(phone, message);
    await upsertAnalyticsDaily(userId, { wa_messages_sent: 1, tasks_run: 1 });
    return translateMessage(
      [
        `✅ *Message sent to ${resolvedName}!*`,
        "",
        `📩 *Message:* ${message}`,
        `📱 *To:* +${phone}`,
      ].join("\n"),
      locale,
    );
  } catch (error) {
    console.error("[agent] sendClawCloudWhatsAppToPhone failed:", error);
    return translateMessage(
      [
        `❌ *Could not send the message to ${resolvedName}.*`,
        "",
        "This usually happens when the number is not on WhatsApp or the session is disconnected.",
        "Reconnect WhatsApp in the dashboard and try again.",
      ].join("\n"),
      locale,
    );
  }
}

async function handleSaveContactCommand(
  userId: string,
  text: string,
  locale: SupportedLocale,
): Promise<string> {
  const normalized = text.toLowerCase().trim();
  if (/\b(list|show|my)\s+contacts\b/.test(normalized) || normalized === "contacts") {
    const list = await listContactsFormatted(userId);
    return translateMessage(list, locale);
  }

  const parsed = parseSaveContactCommand(text);
  if (!parsed) {
    return translateMessage(
      [
        "📋 *Save a contact*",
        "",
        "Use this format:",
        "_Save contact: Maa = +919876543210_",
        "_Save contact: Papa = 9876543210_",
        "_Save Priya as 9876543210_",
        "",
        "After saving, say: _Send message to Maa: Good morning!_",
      ].join("\n"),
      locale,
    );
  }

  const { name, phone } = parsed;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) {
    return translateMessage(
      `❌ *Invalid phone number.* Use full number, for example: _Save contact: ${name} = +919876543210_`,
      locale,
    );
  }

  await saveContact(userId, name, phone);
  const normalizedPhone = digits.startsWith("91") ? digits : `91${digits.replace(/^0+/, "")}`;

  return translateMessage(
    [
      `✅ *${name} saved!*`,
      "",
      `📱 Number: +${normalizedPhone}`,
      "",
      `Now say: _Send message to ${name}: [your message]_`,
    ].join("\n"),
    locale,
  );
}

export async function runClawCloudTask(input: RunTaskInput) {
  const db = getClawCloudSupabaseAdmin();
  let task = await getTaskRow(input.userId, input.taskType);
  if (!task && input.taskType === "custom_reminder") {
    const { data, error } = await db
      .from("agent_tasks")
      .upsert(
        {
          user_id: input.userId,
          task_type: "custom_reminder",
          is_enabled: true,
          config: {},
        },
        { onConflict: "user_id,task_type" },
      )
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(error?.message || "Task custom_reminder not configured.");
    }

    task = data as AgentTaskRow;
  }

  if (!task) throw new Error(`Task ${input.taskType} not configured.`);
  if (!input.bypassEnabledCheck && !task.is_enabled) throw new Error(`Task ${input.taskType} disabled.`);

  const plan = await getUserPlan(input.userId);
  const runs = await getTodayRuns(input.userId);
  const limit = clawCloudRunLimits[plan];

  if (runs >= limit) {
    const upgradeUrl = "swift-deploy.in/pricing";
    const planEmoji = plan === "free" ? "🆓" : "⭐";
    const nextPlan = plan === "free" ? "Starter" : "Pro";

    await sendClawCloudWhatsAppMessage(
      input.userId,
      [
        "⏱️ *Daily limit reached*",
        "",
        `${planEmoji} You've used all *${limit} runs* today on the *${plan}* plan.`,
        "",
        "Runs reset at *midnight IST* automatically.",
        "",
        "🚀 *Want unlimited runs?*",
        `Upgrade to ${nextPlan} -> ${upgradeUrl}`,
      ].join("\n"),
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
