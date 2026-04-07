// lib/clawcloud-intent-confidence.ts
// -----------------------------------------------------------------------------
// INTENT CONFIDENCE SCORING — Multi-signal intent classification with
// confidence scores, overlap resolution, and disambiguation. Replaces the
// sequential regex cascade with a ranked, scored approach for 99%+ accuracy.
// -----------------------------------------------------------------------------

import type { IntentType } from "@/lib/clawcloud-ai";

export type IntentCandidate = {
  intent: IntentType;
  confidence: number; // 0.0 - 1.0
  signals: string[];
  tier: "exact" | "strong" | "moderate" | "weak";
};

export type IntentClassification = {
  primary: IntentCandidate;
  alternates: IntentCandidate[];
  isAmbiguous: boolean;
  disambiguationHint: string | null;
};

// ---------------------------------------------------------------------------
// SIGNAL PATTERNS — weighted patterns per intent
// ---------------------------------------------------------------------------

type SignalPattern = {
  pattern: RegExp;
  weight: number;
  signal: string;
};

const INTENT_SIGNALS: Record<string, SignalPattern[]> = {
  greeting: [
    { pattern: /^(?:hi|hello|hey|sup|yo|hii+|howdy|greetings|good (?:morning|afternoon|evening|night)|gm|namaste|namaskar)\b/i, weight: 0.95, signal: "greeting_opener" },
    { pattern: /^(?:what'?s up|how are you|how's it going)\b/i, weight: 0.85, signal: "casual_greeting" },
  ],
  help: [
    { pattern: /\b(?:what can you do|your capabilities|features|how can you help|help me|your functions)\b/i, weight: 0.90, signal: "capability_question" },
    { pattern: /\b(?:who are you|what are you|about yourself)\b/i, weight: 0.85, signal: "identity_question" },
  ],
  coding: [
    { pattern: /\b(?:write|create|build|implement|develop)\b.*\b(?:code|function|class|api|script|program|app|component|module|endpoint|service|server|client|database)\b/i, weight: 0.92, signal: "code_creation_request" },
    { pattern: /\b(?:debug|fix|error|bug|exception|traceback|stack trace|syntax error|runtime error|type error|segfault|segmentation fault|crash)\b/i, weight: 0.90, signal: "debugging_request" },
    { pattern: /\b(?:python|javascript|typescript|java|c\+\+|rust|golang|ruby|swift|kotlin|react|vue|angular|django|flask|express|nextjs|next\.js|node\.?js|sql|html|css)\b/i, weight: 0.80, signal: "programming_language" },
    { pattern: /\b(?:algorithm|data structure|binary tree|linked list|hash map|graph|dfs|bfs|dynamic programming|dp|recursion|sorting|searching|complexity|big o|o\(n\))\b/i, weight: 0.85, signal: "algorithm_topic" },
    { pattern: /\b(?:shortest path|dijkstra|bellman[- ]ford|floyd[- ]warshall|topological sort|union[- ]find|disjoint set|segment tree|fenwick tree|knapsack|state compression|grid)\b/i, weight: 0.88, signal: "algorithmic_challenge" },
    { pattern: /\b(?:api|rest|graphql|websocket|grpc|microservice|docker|kubernetes|k8s|ci\/cd|devops|git|deployment|terraform|aws|gcp|azure)\b/i, weight: 0.75, signal: "infrastructure_topic" },
    { pattern: /```[\s\S]*```/m, weight: 0.88, signal: "code_block_present" },
    { pattern: /\b(?:import|export|function|const|let|var|class|def|return|if|else|for|while|try|catch)\b\s*[\({]?/i, weight: 0.70, signal: "code_keywords" },
  ],
  math: [
    { pattern: /\b(?:calculate|compute|solve|find the value|evaluate|simplify|derive|integrate|differentiate)\b/i, weight: 0.90, signal: "math_verb" },
    { pattern: /\b(?:equation|integral|derivative|limit|matrix|determinant|eigenvalue|vector|polynomial|quadratic|factorial|permutation|combination|nCr|nPr)\b/i, weight: 0.88, signal: "math_concept" },
    { pattern: /\b(?:probability|statistics|standard deviation|variance|mean|median|mode|regression|correlation|hypothesis|confidence interval|p-value|z-score|t-test|chi-?square|anova)\b/i, weight: 0.85, signal: "statistics_topic" },
    { pattern: /[=+\-×÷∫∑∏√π∞≤≥≠∈∉⊂⊃∪∩]/, weight: 0.80, signal: "math_symbols" },
    { pattern: /\b\d+\s*[\+\-\*\/\^]\s*\d+\b/, weight: 0.75, signal: "arithmetic_expression" },
    { pattern: /\bx\s*[=<>]\s*[\d\-]|\by\s*=\s*\d*x/i, weight: 0.82, signal: "algebraic_expression" },
    { pattern: /\b(?:EMI|SIP|CAGR|NPV|IRR|compound interest|simple interest|amortization|annuity)\b/i, weight: 0.85, signal: "financial_math" },
  ],
  finance: [
    { pattern: /\b(?:stock|share|equity|nifty|sensex|nasdaq|s&p|dow jones|bse|nse|market cap|ipo|mutual fund|etf|index fund|sip|nav)\b/i, weight: 0.90, signal: "stock_market" },
    { pattern: /\b(?:invest|portfolio|return|dividend|p\/e ratio|eps|book value|face value|intrinsic value)\b/i, weight: 0.85, signal: "investment_topic" },
    { pattern: /\b(?:bitcoin|ethereum|crypto|blockchain|defi|nft|web3|solana|bnb|cardano)\b/i, weight: 0.88, signal: "crypto_topic" },
    { pattern: /\b(?:forex|currency|exchange rate|usd|eur|gbp|inr|jpy|yuan)\b/i, weight: 0.82, signal: "forex_topic" },
    { pattern: /\b(?:gold price|silver price|crude oil|commodity|futures|options)\b/i, weight: 0.80, signal: "commodity_topic" },
    { pattern: /\b(?:should i invest|where to invest|best stock|good investment|safe return|guaranteed return)\b/i, weight: 0.92, signal: "investment_advice" },
  ],
  health: [
    { pattern: /\b(?:symptom|symptoms|disease|illness|diagnosis|diagnose|condition|disorder|syndrome)\b/i, weight: 0.90, signal: "medical_condition" },
    { pattern: /\b(?:medicine|medication|tablet|capsule|drug|dose|dosage|side effect|contraindication|interaction)\b/i, weight: 0.88, signal: "medication_topic" },
    { pattern: /\b(?:treatment|therapy|surgery|procedure|operation|transplant|chemotherapy|radiation)\b/i, weight: 0.85, signal: "treatment_topic" },
    { pattern: /\b(?:fever|pain|headache|cough|cold|nausea|vomit|diarrhea|rash|swelling|bleeding|fatigue|dizziness|infection)\b/i, weight: 0.80, signal: "symptom_mention" },
    { pattern: /\b(?:blood pressure|cholesterol|diabetes|cancer|heart|kidney|liver|lung|brain|thyroid|anemia)\b/i, weight: 0.82, signal: "organ_condition" },
    { pattern: /\b(?:pregnant|pregnancy|prenatal|postnatal|fertility|ovulation|contraception)\b/i, weight: 0.88, signal: "reproductive_health" },
    { pattern: /\b(?:my (?:child|father|mother|wife|husband|son|daughter))\b.*\b(?:pain|fever|sick|ill|cough|rash|symptoms?)\b/i, weight: 0.92, signal: "personal_health_query" },
    { pattern: /\b(?:can i take|should i take|is it safe to|mix .* medicine)\b/i, weight: 0.90, signal: "medication_safety" },
    { pattern: /\b(?:anxiety|depression|panic|mental health|therapy|therapist|psychiatrist|burnout|trauma|grief|stress|insomnia)\b/i, weight: 0.82, signal: "mental_health" },
  ],
  law: [
    { pattern: /\b(?:legal|law|laws|legislation|statute|act|section|article|amendment|ordinance)\b/i, weight: 0.85, signal: "legal_term" },
    { pattern: /\b(?:court|judge|lawyer|attorney|advocate|solicitor|magistrate|tribunal|arbitration)\b/i, weight: 0.82, signal: "legal_entity" },
    { pattern: /\b(?:rights|contract|agreement|notice|fir|bail|appeal|verdict|judgment|petition|writ|habeas corpus)\b/i, weight: 0.80, signal: "legal_process" },
    { pattern: /\b(?:crime|criminal|civil|sue|lawsuit|divorce|custody|alimony|maintenance|tenant|eviction|rent)\b/i, weight: 0.82, signal: "legal_matter" },
    { pattern: /\b(?:trademark|copyright|patent|ip|intellectual property)\b/i, weight: 0.85, signal: "ip_law" },
    { pattern: /\b(?:is it legal|can i sue|what are my rights|am i liable|legal notice|file a case|file fir)\b/i, weight: 0.92, signal: "legal_question" },
    { pattern: /\b(?:ipc|crpc|cpc|indian penal code|code of criminal procedure|constitution of india|companies act|gst act|income tax act|ni act)\b/i, weight: 0.90, signal: "indian_law" },
  ],
  science: [
    { pattern: /\b(?:physics|chemistry|biology|astronomy|geology|ecology|zoology|botany|genetics|microbiology|biochemistry|neuroscience)\b/i, weight: 0.88, signal: "science_field" },
    { pattern: /\b(?:quantum|relativity|thermodynamics|electromagnetism|optics|nuclear|particle|wave|frequency|wavelength|photon|electron|proton|neutron)\b/i, weight: 0.85, signal: "physics_concept" },
    { pattern: /\b(?:molecule|atom|element|compound|reaction|acid|base|pH|organic|inorganic|polymer|catalyst|oxidation|reduction|bond)\b/i, weight: 0.82, signal: "chemistry_concept" },
    { pattern: /\b(?:cell|dna|rna|protein|gene|mutation|evolution|natural selection|ecosystem|photosynthesis|mitosis|meiosis)\b/i, weight: 0.82, signal: "biology_concept" },
    { pattern: /\b(?:experiment|hypothesis|theory|law of|principle of|equation of|formula for)\b/i, weight: 0.75, signal: "scientific_method" },
  ],
  history: [
    { pattern: /\b(?:history|historical|ancient|medieval|modern era|century|dynasty|empire|kingdom|civilization|war|battle|revolution|independence)\b/i, weight: 0.85, signal: "history_term" },
    { pattern: /\b(?:who was|who were|when did|when was|in which year|what happened in)\b.*\b(?:king|queen|emperor|president|prime minister|general|leader)\b/i, weight: 0.90, signal: "historical_figure_question" },
    { pattern: /\b(?:world war|cold war|civil war|partition|freedom|movement|mughal|british|roman|greek|ottoman|persian|ming|qing)\b/i, weight: 0.85, signal: "historical_period" },
    { pattern: /\b(?:1[0-9]{3}|20[0-2][0-9])\b.*\b(?:battle|war|treaty|event|revolution|assassination|independence|founded|established)\b/i, weight: 0.80, signal: "historical_date_event" },
  ],
  geography: [
    { pattern: /\b(?:capital of|largest|smallest|highest|longest|deepest|tallest|continent|country|state|city|river|mountain|ocean|sea|island|desert|lake)\b/i, weight: 0.85, signal: "geography_fact" },
    { pattern: /\b(?:population of|area of|located in|borders|neighboring|latitude|longitude|coordinates|elevation)\b/i, weight: 0.82, signal: "geographic_measurement" },
    { pattern: /\b(?:climate|monsoon|tropical|temperate|arid|tectonic|volcano|earthquake|tsunami|hurricane|typhoon)\b/i, weight: 0.78, signal: "physical_geography" },
    { pattern: /\b(?:gdp|hdi|demographic|urbanization|literacy rate|life expectancy)\b.*\b(?:country|nation|state|region)\b/i, weight: 0.75, signal: "human_geography" },
  ],
  economics: [
    { pattern: /\b(?:gdp|gnp|inflation|deflation|recession|depression|fiscal|monetary|supply|demand|equilibrium|elasticity|marginal|utility)\b/i, weight: 0.85, signal: "economics_concept" },
    { pattern: /\b(?:repo rate|reverse repo|crr|slr|rbi|federal reserve|ecb|imf|world bank|wto|opec)\b/i, weight: 0.88, signal: "economic_institution" },
    { pattern: /\b(?:trade deficit|current account|balance of payments|import|export|tariff|subsidy|tax policy|gst|income tax)\b/i, weight: 0.82, signal: "trade_policy" },
    { pattern: /\b(?:unemployment|poverty|inequality|gini|minimum wage|labor market|workforce)\b/i, weight: 0.78, signal: "social_economics" },
  ],
  technology: [
    { pattern: /\b(?:what is|how does|explain)\b.*\b(?:ai|artificial intelligence|machine learning|deep learning|neural network|transformer|gpt|llm|chatgpt|claude|gemini|copilot)\b/i, weight: 0.88, signal: "ai_technology" },
    { pattern: /\b(?:5g|6g|iot|blockchain|cloud computing|edge computing|quantum computing|ar|vr|metaverse)\b/i, weight: 0.82, signal: "emerging_tech" },
    { pattern: /\b(?:iphone|android|samsung|apple|google pixel|windows|macos|linux|ubuntu)\b/i, weight: 0.70, signal: "consumer_tech" },
    { pattern: /\b(?:cybersecurity|encryption|vpn|firewall|malware|phishing|zero-day|penetration test)\b/i, weight: 0.80, signal: "security_tech" },
    { pattern: /\b(?:best|top|recommend|comparison|vs|versus|which is better)\b.*\b(?:phone|laptop|tablet|headphone|camera|app|software|tool)\b/i, weight: 0.85, signal: "tech_comparison" },
  ],
  research: [
    { pattern: /\b(?:research|analyze|analysis|investigate|study|evaluate|assess|compare|benchmark|review)\b.*\b(?:strategy|approach|method|framework|model|system|solution|option)\b/i, weight: 0.82, signal: "research_request" },
    { pattern: /\b(?:pros and cons|advantages and disadvantages|trade-?offs|cost-?benefit|swot)\b/i, weight: 0.80, signal: "analysis_request" },
    { pattern: /\b(?:deep dive|in-depth|comprehensive|detailed analysis|full review)\b/i, weight: 0.75, signal: "depth_signal" },
  ],
  web_search: [
    { pattern: /\b(?:latest|current|today|recent|this week|this month|2024|2025|2026|live|real-?time|now|breaking)\b/i, weight: 0.70, signal: "recency_signal" },
    { pattern: /\b(?:latest|current|today'?s?|recent)\b.*\b(?:news|update|price|score|result|weather|forecast)\b/i, weight: 0.88, signal: "live_data_request" },
    { pattern: /\b(?:search for|look up|find out|google|search)\b/i, weight: 0.75, signal: "search_request" },
  ],
  email: [
    { pattern: /\b(?:write|draft|compose|send)\b.*\b(?:email|mail|letter|message|reply)\b/i, weight: 0.92, signal: "email_request" },
    { pattern: /\b(?:professional email|formal letter|business communication|cover letter|resignation)\b/i, weight: 0.88, signal: "email_type" },
  ],
  creative: [
    { pattern: /\b(?:write|create|compose|generate|draft)\b.*\b(?:story|poem|essay|article|speech|song|lyrics|script|dialogue|monologue|haiku|sonnet|limerick)\b/i, weight: 0.92, signal: "creative_request" },
    { pattern: /\b(?:write|create)\b.*\b(?:joke|pun|riddle|caption|tagline|slogan|bio|profile)\b/i, weight: 0.85, signal: "creative_short" },
    { pattern: /\b(?:rewrite|rephrase|paraphrase|summarize|translate into|make it more)\b/i, weight: 0.70, signal: "rewrite_request" },
  ],
  language: [
    { pattern: /\b(?:translate|translation|meaning of|means in|how to say|how do you say)\b/i, weight: 0.90, signal: "translation_request" },
    { pattern: /\b(?:grammar|tense|conjugation|plural|singular|noun|verb|adjective|adverb|preposition|pronoun)\b/i, weight: 0.82, signal: "grammar_topic" },
    { pattern: /\b(?:etymology|origin of the word|where does the word|root word)\b/i, weight: 0.85, signal: "etymology_request" },
    { pattern: /\b(?:hindi|urdu|tamil|telugu|kannada|bengali|marathi|gujarati|punjabi|malayalam|spanish|french|german|italian|portuguese|russian|japanese|chinese|korean|arabic)\b.*\b(?:translate|meaning|say|word for|phrase)\b/i, weight: 0.88, signal: "language_pair" },
  ],
  explain: [
    { pattern: /^(?:explain|describe|what is|what are|what does|how does|how do|why is|why does|why do|define)\b/i, weight: 0.65, signal: "explanation_opener" },
    { pattern: /\b(?:explain like|eli5|in simple terms|in layman|for beginners|simply put|break it down)\b/i, weight: 0.90, signal: "simplification_request" },
    { pattern: /\b(?:how does .* work|how is .* made|what happens when|mechanism of)\b/i, weight: 0.75, signal: "mechanism_question" },
  ],
  culture: [
    { pattern: /\b(?:painting|sculpture|art|museum|gallery|renaissance|baroque|impressionism|cubism|surrealism|abstract)\b/i, weight: 0.82, signal: "art_topic" },
    { pattern: /\b(?:philosophy|philosopher|existentialism|nihilism|stoicism|utilitarianism|ethics|metaphysics|epistemology)\b/i, weight: 0.85, signal: "philosophy_topic" },
    { pattern: /\b(?:religion|religious|hindu|islam|christian|buddhist|jewish|sikh|jain|temple|mosque|church|bible|quran|gita)\b/i, weight: 0.80, signal: "religion_topic" },
    { pattern: /\b(?:festival|celebration|tradition|custom|ritual|ceremony|folklore|mythology)\b/i, weight: 0.78, signal: "cultural_practice" },
  ],
  sports: [
    { pattern: /\b(?:cricket|ipl|odi|test match|t20|world cup|ashes|bcci|icc)\b/i, weight: 0.90, signal: "cricket_topic" },
    { pattern: /\b(?:football|soccer|premier league|la liga|champions league|fifa|goal|penalty|offside)\b/i, weight: 0.88, signal: "football_topic" },
    { pattern: /\b(?:nba|basketball|tennis|badminton|hockey|boxing|mma|ufc|wrestling|olympics|marathon|athletics)\b/i, weight: 0.85, signal: "sports_topic" },
    { pattern: /\b(?:score|match|tournament|championship|league|season|playoffs|final|semi-?final|quarter-?final)\b/i, weight: 0.70, signal: "sports_event" },
    { pattern: /\b(?:player|batsman|bowler|pitcher|striker|goalkeeper|coach|captain|team)\b.*\b(?:stats|record|career|average|centuries|wickets|goals|points)\b/i, weight: 0.82, signal: "player_stats" },
  ],
  spending: [
    { pattern: /\b(?:my spending|my expenses|how much.*spent|spending analysis|budget|expense tracker)\b/i, weight: 0.90, signal: "spending_query" },
    { pattern: /\b(?:monthly expenses|weekly expenses|daily expenses|spend report)\b/i, weight: 0.85, signal: "expense_report" },
  ],
  memory: [
    { pattern: /\b(?:remember|save|store|recall|forget|delete|my name is|i am|i live in|my age is)\b/i, weight: 0.75, signal: "memory_action" },
    { pattern: /\b(?:what do you know about me|my profile|my preferences|my details)\b/i, weight: 0.88, signal: "memory_recall" },
  ],
  reminder: [
    { pattern: /\b(?:remind me|set.*reminder|alarm|notification|alert me|wake me)\b/i, weight: 0.92, signal: "reminder_request" },
    { pattern: /\b(?:remind|reminder)\b.*\b(?:at|on|in|every|daily|weekly|tomorrow|tonight|morning|evening)\b/i, weight: 0.90, signal: "timed_reminder" },
  ],
  send_message: [
    { pattern: /\b(?:send|message|text|whatsapp|msg)\b.*\b(?:to|saying|that)\b/i, weight: 0.88, signal: "send_request" },
  ],
  save_contact: [
    { pattern: /\b(?:save|add|store)\b.*\b(?:contact|number|phone)\b/i, weight: 0.90, signal: "contact_save" },
  ],
  calendar: [
    { pattern: /\b(?:schedule|calendar|meeting|appointment|event|book|slot)\b/i, weight: 0.80, signal: "calendar_topic" },
    { pattern: /\b(?:my (?:schedule|calendar|meetings|appointments))\b/i, weight: 0.88, signal: "personal_calendar" },
  ],
};

// ---------------------------------------------------------------------------
// ANTI-PATTERNS — signals that REDUCE confidence for a given intent
// ---------------------------------------------------------------------------

const ANTI_PATTERNS: Partial<Record<string, Array<{ pattern: RegExp; penalty: number; reason: string }>>> = {
  coding: [
    { pattern: /\b(?:explain|what is|meaning of|define|history of)\b/i, penalty: -0.30, reason: "explanation_not_code" },
  ],
  greeting: [
    { pattern: /\b(?:explain|calculate|solve|write|code|help me with|how to)\b/i, penalty: -0.50, reason: "substantive_question" },
  ],
  web_search: [
    { pattern: /\b(?:explain|what is|define|calculate|write code)\b/i, penalty: -0.25, reason: "knowledge_question" },
  ],
  explain: [
    { pattern: /\b(?:write.*code|debug|fix.*error|calculate|solve.*equation)\b/i, penalty: -0.35, reason: "action_request" },
  ],
};

// ---------------------------------------------------------------------------
// CONTEXT BOOSTERS — boost certain intents based on conversational context
// ---------------------------------------------------------------------------

export function computeContextBoost(
  intent: string,
  conversationHistory?: Array<{ role: string; content: string }>,
): number {
  if (!conversationHistory?.length) return 0;

  const lastMsg = conversationHistory[conversationHistory.length - 1];
  if (!lastMsg || lastMsg.role !== "assistant") return 0;

  const lastContent = lastMsg.content.toLowerCase();

  // If last response had code, boost coding for follow-ups
  if (/```/.test(lastContent) && (intent === "coding" || intent === "technology")) return 0.15;

  // If last response was about health, boost health
  if (/consult.*doctor|⚕️/.test(lastContent) && intent === "health") return 0.12;

  // If last response was about finance, boost finance
  if (/📊|invest|stock|nifty/.test(lastContent) && intent === "finance") return 0.12;

  return 0;
}

// ---------------------------------------------------------------------------
// MAIN CLASSIFIER — score all intents and pick the best
// ---------------------------------------------------------------------------

export function classifyIntentWithConfidence(
  question: string,
  conversationHistory?: Array<{ role: string; content: string }>,
): IntentClassification {
  const normalized = question.trim();
  if (!normalized) {
    return {
      primary: { intent: "general", confidence: 0.5, signals: ["empty_input"], tier: "weak" },
      alternates: [],
      isAmbiguous: false,
      disambiguationHint: null,
    };
  }

  const scores = new Map<IntentType, { score: number; signals: string[] }>();

  // Score each intent
  for (const [intent, patterns] of Object.entries(INTENT_SIGNALS)) {
    let totalScore = 0;
    const matchedSignals: string[] = [];

    for (const { pattern, weight, signal } of patterns) {
      if (pattern.test(normalized)) {
        totalScore += weight;
        matchedSignals.push(signal);
      }
    }

    // Apply anti-patterns
    const antiPatterns = ANTI_PATTERNS[intent];
    if (antiPatterns) {
      for (const { pattern, penalty, reason } of antiPatterns) {
        if (pattern.test(normalized)) {
          totalScore += penalty;
          matchedSignals.push(`anti:${reason}`);
        }
      }
    }

    // Apply context boost
    const boost = computeContextBoost(intent, conversationHistory);
    if (boost > 0) {
      totalScore += boost;
      matchedSignals.push("context_boost");
    }

    if (totalScore > 0) {
      scores.set(intent as IntentType, { score: totalScore, signals: matchedSignals });
    }
  }

  // Normalize scores to 0-1 confidence range
  const maxRawScore = Math.max(...[...scores.values()].map((s) => s.score), 0.01);
  const candidates: IntentCandidate[] = [];

  for (const [intent, { score, signals }] of scores) {
    const confidence = Math.min(score / Math.max(maxRawScore, 1.5), 1.0);
    const tier: IntentCandidate["tier"] =
      confidence >= 0.85 ? "exact"
        : confidence >= 0.65 ? "strong"
          : confidence >= 0.45 ? "moderate"
            : "weak";

    candidates.push({ intent, confidence, signals, tier });
  }

  // Sort by confidence
  candidates.sort((a, b) => b.confidence - a.confidence);

  // Default to general if nothing matched
  if (!candidates.length) {
    return {
      primary: { intent: "general", confidence: 0.4, signals: ["no_match_fallback"], tier: "weak" },
      alternates: [],
      isAmbiguous: false,
      disambiguationHint: null,
    };
  }

  const primary = candidates[0];
  const alternates = candidates.slice(1, 4);

  // Detect ambiguity — top two are close in confidence
  const isAmbiguous = alternates.length > 0 && (primary.confidence - alternates[0].confidence) < 0.15;
  let disambiguationHint: string | null = null;

  if (isAmbiguous && alternates[0]) {
    disambiguationHint = `Question could be ${primary.intent} (${(primary.confidence * 100).toFixed(0)}%) or ${alternates[0].intent} (${(alternates[0].confidence * 100).toFixed(0)}%). Using ${primary.intent} as primary.`;
  }

  return { primary, alternates, isAmbiguous, disambiguationHint };
}

// ---------------------------------------------------------------------------
// OVERLAP RESOLUTION — for ambiguous cases, apply domain-specific rules
// ---------------------------------------------------------------------------

export function resolveIntentOverlap(
  classification: IntentClassification,
  question: string,
): IntentClassification {
  if (!classification.isAmbiguous || !classification.alternates.length) {
    return classification;
  }

  const primary = classification.primary.intent;
  const secondary = classification.alternates[0].intent;
  const text = question.toLowerCase();

  // Coding vs Explain: if asking "what is X" about a code concept, it's explain not coding
  if (primary === "coding" && secondary === "explain" && /^(?:what is|what are|explain|describe)\b/i.test(text)) {
    return { ...classification, primary: classification.alternates[0], alternates: [classification.primary, ...classification.alternates.slice(1)] };
  }

  // Finance vs Math: if contains specific calculation, prefer math
  if (primary === "finance" && secondary === "math" && /\b(?:calculate|compute|solve|find|EMI|SIP|CAGR|NPV|IRR)\b/i.test(text)) {
    return { ...classification, primary: classification.alternates[0], alternates: [classification.primary, ...classification.alternates.slice(1)] };
  }

  // Web_search vs anything else: only prefer web_search if explicitly about current/live data
  if (primary === "web_search" && !/\b(?:today|current|latest|live|now|this week|this month|2026|breaking|just happened)\b/i.test(text)) {
    return { ...classification, primary: classification.alternates[0], alternates: [classification.primary, ...classification.alternates.slice(1)] };
  }

  // Health vs Science: if about body mechanisms without personal context, prefer science
  if (primary === "health" && secondary === "science" && !/\b(?:my|i have|i feel|should i|can i take|is it safe)\b/i.test(text)) {
    return { ...classification, primary: classification.alternates[0], alternates: [classification.primary, ...classification.alternates.slice(1)] };
  }

  return classification;
}
