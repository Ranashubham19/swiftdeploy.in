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
import { answerNewsQuestion, detectNewsQuestion, hasNewsProviders } from "@/lib/clawcloud-news";
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
    || normalized.includes("professional answer")
    || normalized.includes("scope addressed:")
    || normalized.includes("as an ai")
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
        "🧠 *I got your message.*",
        "",
        `You asked about: _${compactQuestion}_.`,
        "",
        "Send me the exact task or question you want solved, and I’ll answer it directly.",
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
  if (/\brat\b/.test(text) && /\bmaze\b/.test(text) && /\b(c\+\+|cpp)\b/.test(text)) {
    return buildRatInMazeCppFallback();
  }

  const language = detectRequestedLanguageForFallback(message);
  const compactQuestion = message.trim().replace(/\s+/g, " ").slice(0, 220);

  const codeByLanguage: Record<string, string[]> = {
    cpp: [
      "```cpp",
      "#include <bits/stdc++.h>",
      "using namespace std;",
      "",
      "int main() {",
      "    ios::sync_with_stdio(false);",
      "    cin.tie(nullptr);",
      "    // TODO: parse input",
      "    // TODO: solve task",
      "    // TODO: print output",
      "    return 0;",
      "}",
      "```",
    ],
    python: [
      "```python",
      "def solve():",
      "    # TODO: parse input",
      "    # TODO: solve task",
      "    # TODO: print output",
      "    pass",
      "",
      "if __name__ == '__main__':",
      "    solve()",
      "```",
    ],
    javascript: [
      "```javascript",
      "function solve(input) {",
      "  // TODO: parse input",
      "  // TODO: solve task",
      "  return '';",
      "}",
      "",
      "process.stdin.resume();",
      "process.stdin.setEncoding('utf8');",
      "let data = '';",
      "process.stdin.on('data', (chunk) => data += chunk);",
      "process.stdin.on('end', () => process.stdout.write(solve(data)));",
      "```",
    ],
    typescript: [
      "```ts",
      "function solve(input: string): string {",
      "  // TODO: parse input",
      "  // TODO: solve task",
      "  return '';",
      "}",
      "",
      "process.stdin.resume();",
      "process.stdin.setEncoding('utf8');",
      "let data = '';",
      "process.stdin.on('data', (chunk) => data += chunk);",
      "process.stdin.on('end', () => process.stdout.write(solve(data)));",
      "```",
    ],
    java: [
      "```java",
      "import java.io.*;",
      "",
      "public class Main {",
      "    public static void main(String[] args) throws Exception {",
      "        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));",
      "        // TODO: parse input",
      "        // TODO: solve task",
      "        // TODO: print output",
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
      "    _ = in",
      "    // TODO: parse input",
      "    // TODO: solve task",
      "    fmt.Println()",
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
      "    // TODO: parse input",
      "    // TODO: solve task",
      "}",
      "```",
    ],
    text: [
      "I can code this directly.",
      "Send preferred language plus input and output format, and I will return complete runnable code.",
    ],
  };

  return [
    "*Coding Reply*",
    "",
    `I received: _${compactQuestion}_.`,
    "",
    "Here is a clean starter template in your requested language:",
    "",
    ...(codeByLanguage[language] ?? codeByLanguage.text),
    "",
    "Share constraints and sample input/output, and I will send the exact final solution immediately.",
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
        `I received: _${compactQuestion}_.`,
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
        "I got your message.",
        "",
        `You asked about: _${compactQuestion}_.`,
        "",
        "Send the exact task you want solved, and I will answer directly.",
      ].join("\n");
  }
}

function buildDeterministicChatFallback(message: string, intent: IntentType): string | null {
  const t = message.toLowerCase().trim();

  if (
    intent === "greeting"
    || (
      /^(hi+|hello+|hey+|good\s*(morning|afternoon|evening|night)|namaste|hola|bonjour|ciao|sup|yo|what'?s up|howdy|greetings)\b/.test(t)
      && t.length < 40
    )
  ) {
    return [
      "👋 *Hey! I'm ready to help.*",
      "",
      "Ask me anything — *coding, math, science, history, health, law, economics,* sports, geography, writing, or any topic.",
      "",
      "What do you want to know?",
    ].join("\n");
  }

  if (/\b(what can you do|what do you do|your capabilities|help me with|features|who are you|what are you)\b/.test(t)) {
    return [
      "🤖 *ClawCloud AI — What I can do:*",
      "",
      "💻 *Code* — any language, any problem, complete solutions",
      "📐 *Math* — tables, equations, statistics, step-by-step working",
      "🧬 *Science* — physics, chemistry, biology, astronomy",
      "🏛️ *History* — world history, dates, events, civilizations",
      "🌍 *Geography* — countries, capitals, regions, demographics",
      "🏥 *Health* — symptoms, diseases, nutrition, fitness",
      "⚖️ *Law* — legal concepts, rights, procedures",
      "📈 *Economics* — markets, investing, business, finance",
      "🎭 *Culture* — literature, philosophy, art, religion, music",
      "⚽ *Sports* — rules, records, players, tournaments",
      "✍️ *Writing* — emails, essays, stories, resumes",
      "",
      "Ask me anything. I answer directly.",
    ].join("\n");
  }

  if (/\b(test|working|alive|are you there|respond|ping)\b/.test(t) && t.length < 30) {
    return [
      "✅ *Yes, I'm here and working.*",
      "",
      "Send me any question on any topic and I'll answer directly.",
    ].join("\n");
  }

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
      "💻 *Technology Question*",
      "",
      `Topic: _${q}_`,
      "",
      "I can explain AI, software, hardware, internet, cybersecurity, and tech concepts.",
      "Try: 'How does [technology] work?', 'What is [term]?', 'Compare [A] vs [B]'",
      "",
      "Ask your specific tech question and I'll answer completely.",
    ].join("\n"),
  };

  if (domainFallbacks[intent]) {
    return domainFallbacks[intent];
  }

  return [
    "🤖 *I received your question.*",
    "",
    `You asked: _${q}_`,
    "",
    "I can answer questions on *any topic* — just ask directly:",
    "• 'What is [topic]?'",
    "• 'Explain [concept]'",
    "• 'How does [thing] work?'",
    "• 'Write code for [problem]'",
    "• 'Solve [math problem]'",
    "",
    "Ask your question and I'll answer it completely.",
  ].join("\n");
}

function bestEffortProfessionalTemplateV2(intent: IntentType, message: string) {
  return buildUniversalDomainFallback(intent, message);
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
    if (input.intent === "coding" && /\b(rat|maze|dfs|bfs|dynamic programming|dp|graph|array|string|tree|linked list|recursion|backtracking)\b/i.test(input.message)) {
      return buildCodingFallbackV2(input.message);
    }

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

  if (forcedAnswer.trim()) {
    return forcedAnswer.trim();
  }

  return bestEffortProfessionalTemplateV2(input.intent, input.message);
}

async function smartReply(
  userId: string,
  message: string,
  intent: IntentType,
  mode: ResponseMode = "fast",
  explicitMode = false,
  extraInstruction?: string,
): Promise<string> {
  const deterministic = buildDeterministicChatFallback(message, intent);
  if (deterministic) {
    return deterministic;
  }

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
    || /\b(probability (of|that)|expected value|confidence interval|p-?value|standard deviation|variance of|mean of|standard error|t-?stat)\b/.test(normalized)
    || /\b(statistical(ly)?|regression|correlation|significance|hypothesis|distribution of|normal distribution|beta|coefficient|policy study|program evaluation)\b/.test(normalized)
    || /\b(if .{0,40}what (is|are|would|will)|given .{0,40}(find|calculate|compute|estimate|what))\b/.test(normalized)
    || /\b(\d+%.*\d+%|\d+\s*(out of|of)\s*\d+)\b/.test(normalized)
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
  );
}

function detectIntentLegacy(text: string): DetectedIntent {
  const t = text.toLowerCase().trim();
  const words = t.split(/\s+/);

  if (looksLikeResearchMemoQuestion(t)) {
    return { type: "research", category: "research" };
  }

  // === NEWS ===
  if (detectNewsQuestion(t)) {
    return { type: "research", category: "news" };
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

function detectIntent(text: string): DetectedIntent {
  const t = text.toLowerCase().trim();
  const words = t.split(/\s+/);

  if (looksLikeResearchMemoQuestion(t)) {
    return { type: "research", category: "research" };
  }

  if (detectNewsQuestion(t)) {
    return { type: "research", category: "news" };
  }

  if (
    /\b(remind me|set (a\s+)?reminder|alert me|notify me|don'?t (let me )?forget)\b/.test(t)
    || /\bremind (me\s+)?(at|in|on|by|tomorrow|tonight|this evening|next)\b/.test(t)
  ) {
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
    /\b(python|javascript|js|typescript|ts|java\b|c\+\+|cpp|golang|go\b|rust|php|swift|kotlin|ruby|scala|bash|shell|sql|html|css|react|node|django|flask|spring|express)\b/.test(t)
    || /\b(write|create|build|code|program|implement|fix|debug|optimize|refactor|review)\s+(a\s+|the\s+|my\s+)?(code|function|script|program|class|component|api|endpoint|query|algorithm|app|bot|tool|hook|module)\b/.test(t)
    || /\b(rat in maze|fibonacci|binary search|bubble sort|merge sort|quicksort|linked list|binary tree|graph|dynamic programming|recursion|backtracking|two sum|palindrome|anagram|prime|factorial)\b/.test(t)
    || /\b(time complexity|space complexity|big o|algorithm|data structure|oop|object oriented|polymorphism|inheritance|interface|abstract class)\b/.test(t)
    || (words.length <= 4 && /\b(in\s+(python|js|java|typescript|golang|rust|c\+\+|php|ruby))\b/.test(t))
  ) {
    return { type: "coding", category: "coding" };
  }

  if (
    /\b(table of|multiplication table|times table|solve|calculate|compute|find the value|what is \d|how much is \d)\b/.test(t)
    || /\b(equation|formula|derivative|integral|matrix|vector|probability|statistics|mean|median|mode|standard deviation|variance|hypothesis|algebra|calculus|geometry|trigonometry)\b/.test(t)
    || /\b(sqrt|square root|cube root|log|logarithm|exponent|factorial|permutation|combination|binomial)\b/.test(t)
    || /^\s*[\d\s\+\-\*\/\(\)\^\%\.=]+\s*$/.test(t)
    || /\b\d+\s*[\+\-\*\/\^]\s*\d+\b/.test(t)
  ) {
    return { type: "math", category: "math" };
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
    /\b(artificial intelligence|ai|machine learning|neural network|chatgpt|gpt|llm|deep learning|computer vision|nlp|internet|wifi|5g|blockchain|cloud computing|cybersecurity|hacking|vpn|router|smartphone|laptop|processor|gpu|ram|ssd|operating system|windows|linux|macos|android|ios|app|software|saas)\b/.test(t)
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
    /\b(write a|write me|create a|compose a|generate a)\s+(story|poem|essay|letter|speech|article|blog|script|song|caption|tagline|slogan|joke|riddle|limerick)\b/.test(t)
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
  const requested = extractModeOverride(message);
  const trimmed = requested.cleaned;
  if (!trimmed) return null;

  // 1. Approval commands (SEND/EDIT/SKIP)
  const approval = await handleReplyApprovalCommand(userId, trimmed);
  if (approval.handled) return approval.response;

  const locale = await getUserLocale(userId);
  const detected = detectIntent(trimmed);
  let resolvedType = detected.type;
  let resolvedCategory = detected.category;

  if (resolvedCategory !== "math" && isMathOrStatisticsQuestion(trimmed)) {
    resolvedType = "math";
    resolvedCategory = "math";
  } else if (resolvedCategory !== "coding" && isArchitectureOrDesignQuestion(trimmed)) {
    resolvedType = "coding";
    resolvedCategory = "coding";
  } else if (
    resolvedCategory === "research"
    && !looksLikeRealtimeResearch(trimmed)
    && trimmed.length > 70
  ) {
    const domain = await semanticDomainClassify(trimmed).catch(() => "GENERAL");

    if (domain === "FINANCE_MATH" || domain === "CAUSAL_STATS" || domain === "CLINICAL_BIO") {
      resolvedType = "math";
      resolvedCategory = "math";
    } else if (domain === "ML_SYSTEMS" || domain === "SYS_ARCH" || domain === "REGULATED_AI") {
      resolvedType = "coding";
      resolvedCategory = "coding";
    }
  }

  const responseMode = resolveResponseMode(resolvedType, trimmed, requested.mode);
  const explicitMode = requested.explicit;

  switch (resolvedCategory) {

    case "spending": {
      const ans = await answerSpendingQuestion(userId, trimmed);
      if (ans) return ans;
      return smartReply(userId, trimmed, "spending", responseMode, explicitMode);
    }

    case "draft_email": {
      const count = /all|every|each/i.test(trimmed) ? 3 : 1;
      const ack = await fastAckQuick(
        `User message: "${trimmed}". They want email help. Acknowledge you're checking their inbox and drafting ${count} reply${count === 1 ? "" : "s"}. 1-2 lines max.`
      );
      runReplyApprovalsFireAndForget(userId, count, locale);
      return translateMessage(ack, locale);
    }

    case "email_search": {
      const ack = await fastAckQuick(
        `User message: "${trimmed}". They want to search email. Acknowledge you're searching their inbox. 1 line max.`
      );
      runTaskFireAndForget(userId, "email_search", trimmed, locale, "Email search");
      return translateMessage(ack, locale);
    }

    case "reminder": {
      const ack = await fastAckQuick(
        `User message: "${trimmed}". They want a reminder set. Confirm you're setting it with the task and time in *bold*. 1-2 lines.`
      );
      runTaskFireAndForget(userId, "custom_reminder", trimmed, locale, "Reminder");
      return translateMessage(ack, locale);
    }

    case "calendar": {
      const ack = await fastAckQuick("User wants calendar info. 1 line: checking schedule.");
      runTaskFireAndForget(userId, "meeting_reminders", null, locale, "Calendar check");
      return translateMessage(ack, locale);
    }

    case "news": {
      if (hasNewsProviders()) {
        const answer = await answerNewsQuestion(trimmed).catch(() => "");
        if (answer.trim()) {
          return translateMessage(answer, locale);
        }
      }

      const history = await buildSmartHistory(userId, trimmed, "deep");
      const fallback = await runGroundedResearchReply({
        userId,
        question: trimmed,
        history,
      }).catch(() => "");

      const normalizedFallback = fallback?.trim() ?? "";
      if (normalizedFallback) {
        return translateMessage(normalizedFallback, locale);
      }

      const reply = await smartReply(userId, trimmed, "research", responseMode, explicitMode);
      return translateMessage(reply, locale);
    }

    case "coding": {
      const deterministic = solveCodingArchitectureQuestion(trimmed);
      if (deterministic) {
        return translateMessage(deterministic, locale);
      }

      const reply =
        responseMode === "deep"
          ? (await expertReply(userId, trimmed, "coding"))
            ?? await smartReply(userId, trimmed, "coding", responseMode, explicitMode)
          : await smartReply(userId, trimmed, "coding", responseMode, explicitMode);
      return translateMessage(reply, locale);
    }

    case "math": {
      const mathExpert = await expertReply(userId, trimmed, "math");
      if (mathExpert) {
        return translateMessage(mathExpert, locale);
      }

      const mathDomain = await semanticDomainClassify(trimmed).catch(() => "GENERAL");
      if (mathDomain === "FINANCE_MATH" || mathDomain === "CAUSAL_STATS" || mathDomain === "CLINICAL_BIO") {
        const semanticAnswer = await solveWithUniversalExpert({
          question: trimmed,
          intent: "math",
        }).catch(() => "");

        if (semanticAnswer.trim()) {
          return translateMessage(semanticAnswer, locale);
        }
      }

      const reply = await smartReply(userId, trimmed, "math", responseMode, explicitMode);
      return translateMessage(reply, locale);
    }

    case "creative": {
      const reply = await smartReply(userId, trimmed, "creative", responseMode, explicitMode);
      return translateMessage(reply, locale);
    }

    case "research": {
      const expertAnswer = await expertReply(userId, trimmed, "research");
      if (expertAnswer) {
        return translateMessage(expertAnswer, locale);
      }

      const reply = await smartReply(userId, trimmed, "research", responseMode, explicitMode);
      return translateMessage(reply, locale);
    }

    case "greeting": {
      const reply = await smartReply(userId, trimmed, "greeting", responseMode, explicitMode);
      return translateMessage(reply, locale);
    }

    default: {
      const reply = await smartReply(userId, trimmed, resolvedType, responseMode, explicitMode);
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
