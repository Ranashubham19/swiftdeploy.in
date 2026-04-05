import { normalizeRegionalQuestion } from "@/lib/clawcloud-region-context";
import { stripExplicitReplyLocaleRequestForContent } from "@/lib/clawcloud-i18n";

const CURRENT_AFFAIRS_ACTOR_PATTERN =
  /\b(us|u\.?\s*s\.?\s*a?\.?|united states|america|white house|washington|state department|pentagon|trump|president|iran|iranian|israel|china|taiwan|russia|ukraine|india|pakistan|hamas|hezbollah|houthi|houthis|cuba|cuban|venezuela|venezuelan|north korea|south korea|japan|nato|united nations|un|eu|european union|saudi|uae|emirates|gcc|tehran|beijing|moscow|kyiv|havana)\b/i;

const CURRENT_AFFAIRS_EVENT_PATTERN =
  /\b(ultimatum|deadline|warn(?:ed|ing|s)?|threat(?:en(?:ed|ing|s)?)?|ceasefire|truce|peace(?:\s+deal|\s+talks?)?|talks?|negotiat(?:e|ed|ing|ion|ions)|mediat(?:e|ed|ing|ion)|sanction(?:s|ed|ing)?|strike(?:s|n|ing)?|attack(?:s|ed|ing)?|bomb(?:ed|ing)?|missile(?:s)?|war|conflict|invad(?:e|ed|ing|es)|block(?:ade|ed|ing|s)?|clos(?:e|ed|ing|ure)|reopen(?:ed|ing|s)?|shut(?:ting|down)?|seiz(?:e|ed|ure|ing)|escort(?:s|ed|ing)?|drill(?:s|ing)?|demand(?:s|ed|ing)?|condition(?:s|al)?|term(?:s)?|stop(?:ping)?|end(?:ing)?|tanker(?:s)?|vessel(?:s)?|shipment(?:s)?|cargo|ship(?:s|ped|ping)?|fuel(?:\s+supply| supplies| supply)?|deliver(?:y|ies|ed|ing)?|dispatch(?:ed|es|ing)?|send(?:ing|s|sent)?|export(?:s|ed|ing)?|import(?:s|ed|ing)?|dock(?:ed|ing)|port\s+call(?:s)?)\b/i;

const CURRENT_AFFAIRS_ACTOR_EXTRACT_PATTERN =
  /\b(us|u\.?\s*s\.?\s*a?\.?|united states|america|white house|washington|state department|pentagon|trump|president|iran|iranian|israel|china|taiwan|russia|ukraine|india|pakistan|hamas|hezbollah|houthi|houthis|cuba|cuban|venezuela|venezuelan|north korea|south korea|japan|nato|united nations|un|eu|european union|saudi|uae|emirates|gcc|tehran|beijing|moscow|kyiv|havana)\b/gi;

const CURRENT_AFFAIRS_DEMAND_PATTERN =
  /\b(condition(?:s|al)?|demand(?:s|ed|ing)?|term(?:s)?|requirements?|shart(?:e|on)?|maang(?:e|on)?)\b/i;

const CURRENT_AFFAIRS_STOP_WAR_PATTERN =
  /\b(?:stop|end|ceasefire|truce|halt|rokne|rokna|khatam|band)\b.{0,30}\b(?:war|conflict)\b|\b(?:war|conflict)\b.{0,30}\b(?:stop|end|ceasefire|truce|halt|rokne|rokna|khatam|band)\b/i;

const CURRENT_AFFAIRS_STATUS_PATTERN =
  /\b(status|situation|open|opened|opening|closed|close|closure|reopen|reopened|reopening|blocked|block|blockade|shut|shutdown|safe|unsafe|stopped|stop|ended|ending|escalat(?:e|ed|ing|ion)|de-?escalat(?:e|ed|ing|ion)|resolved|ongoing)\b/i;

const CURRENT_AFFAIRS_LOCATION_PATTERN =
  /\b(strait of hormuz|hormuz|taiwan strait|red sea|suez canal|gaza|west bank|south china sea|black sea|caribbean|cuba|havana|border|shipping lane|shipping lanes|shipping route|shipping routes|nuclear deal)\b/i;

const CURRENT_AFFAIRS_LOGISTICS_PATTERN =
  /\b(tanker(?:s)?|vessel(?:s)?|shipment(?:s)?|cargo|ship(?:s|ped|ping)?|fuel(?:\s+supply| supplies| supply)?|deliver(?:y|ies|ed|ing)?|dispatch(?:ed|es|ing)?|send(?:ing|s|sent)?|export(?:s|ed|ing)?|import(?:s|ed|ing)?|dock(?:ed|ing)|port\s+call(?:s)?)\b/i;

const CURRENT_AFFAIRS_LOGISTICS_STATUS_CUE_PATTERN =
  /\b(reach(?:ed|es|ing)?|arriv(?:e|ed|es|ing)|dock(?:ed|ing|s)?|anchor(?:ed|ing|s)?|port|harbor|harbour|berth|where is|location|status)\b/i;

const CURRENT_AFFAIRS_LOGISTICS_QUANTITY_CUE_PATTERN =
  /\b(how much|how many|how large|quantity|amount|cargo size|cargo amount|barrels?|bbl|tons?|tonnes?|oil is there|fuel is there|load)\b/i;

const CURRENT_AFFAIRS_POWER_CRISIS_PATTERN =
  /\b(blackout(?:s)?|power outage(?:s)?|outage(?:s)?|power cuts?|load shedding|grid failure|grid failures|grid collapse|grid instability|grid emergency|power crisis|energy crisis|rolling blackout(?:s)?|rolling outage(?:s)?|nationwide blackout(?:s)?|nationwide outage(?:s)?|countrywide blackout(?:s)?|countrywide outage(?:s)?|no electricity|without electricity|electricity shortage|power shortage|generation shortfall)\b/i;

const CURRENT_AFFAIRS_POWER_INFRASTRUCTURE_PATTERN =
  /\b(power grid|national grid|thermal plant(?:s)?|power plant(?:s)?|generation capacity|fuel shortage(?:s)?)\b/i;

const CURRENT_AFFAIRS_DEADLINE_PATTERN =
  /\b\d+\s*(?:hour|hours|day|days|week|weeks|month|months)\b/i;

const CURRENT_AFFAIRS_QUESTION_PATTERN =
  /^(?:did|does|do|is|are|was|were|has|have|had|will|would|can|could)\b/i;

const CURRENT_AFFAIRS_AMBIGUOUS_FILLER =
  /\b(?:today|todays|today's|right now|latest|current|currently|as of now|news|update|updates)\b/gi;

const AMBIGUOUS_CURRENT_WAR_PATTERN =
  /\b(?:the\s+)?(?:current|ongoing|right now)\s+(?:war|conflict)\b|\b(?:war|conflict)\b.{0,24}\b(?:status|situation)\b|\b(?:status|situation)\b.{0,24}\b(?:war|conflict)\b/i;

const NAMED_CONFLICT_CUE_PATTERN =
  /\b(north korea|south korea|russia|ukraine|iran|israel|gaza|hamas|china|taiwan|india|pakistan|sudan|yemen|houthi|houthis|syria|lebanon|hormuz|red sea|venezuela)\b/gi;

const NAMED_CASE_EVENT_PATTERN =
  /\b(case|incident|murder|rape|assault|attack|stabbing|shooting|arrest|arrested|investigation|verdict|trial|court case|crime|criminal case|hearing|fir|bail|accused|victim)\b/i;

const NAMED_CASE_NOISE_PATTERN =
  /\b(use case|use-case|edge case|edge-case|test case|case study|best case|worst case|camelcase|switch case|uppercase|lowercase|title case|sentence case)\b/i;

const NAMED_CASE_LOCATION_PATTERN =
  /\b(delhi|goa|mumbai|kolkata|bengaluru|bangalore|noida|gurgaon|gurugram|hyderabad|chennai|india|court|police|station|hotel|campus|school|college)\b/i;

const CURRENT_AFFAIRS_SCIENCE_CUE_PATTERN =
  /\b(quantum mechanics|general relativity|conscious(?:ness| experience)?|decoherence|uncertainty(?: principle)?|g(?:o|ö)del|incompleteness|chaos theory|computable|uncomputable|fixed[- ]point|infinite regress|logical inconsistency|recursive self-?model(?:ing)?|physical laws governing the universe|current models of physics)\b/u;

const CURRENT_AFFAIRS_SCIENCE_ANALYSIS_PATTERN =
  /\b(theoretically possible|prove|disprove|justify|formal proof|counterexample|formal boundary|analy[sz]e|simulate itself|simulate the universe|exact quantum state)\b/i;

function normalizeCurrentAffairsQuestion(question: string) {
  return normalizeRegionalQuestion(stripExplicitReplyLocaleRequestForContent(question))
    .replace(/\babhi\b/gi, "right now")
    .replace(/\baaj\b/gi, "today")
    .replace(/\b(yudh|jang|jung|ladai|larai)\b/gi, "war")
    .replace(/\b(stithi|sthiti|halat|haalat)\b/gi, "status")
    .replace(/\bkyu+n\b/gi, "why")
    .replace(/\bmai\b/gi, "in")
    .replace(/\bapna\b/gi, "its")
    .replace(/\bbhej(?:\s+r(?:ha|hi|he|aha|ahi|ahe))?(?:\s+h(?:ai|e))?\b/gi, "sending")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHinglishCurrentAffairsSearchTopic(topic: string) {
  return topic
    .replace(/\bki\s+kya\s+conditions?\s+hai\b/gi, "conditions")
    .replace(/\bkya\s+conditions?\s+hai\b/gi, "conditions")
    .replace(/\bki\s+kya\s+demands?\s+hai\b/gi, "demands")
    .replace(/\bkya\s+demands?\s+hai\b/gi, "demands")
    .replace(/\bshartein?\b/gi, "conditions")
    .replace(/\bsharton\b/gi, "conditions")
    .replace(/\bmaange?\b/gi, "demands")
    .replace(/\biss?\s+war\s+ko\s+rokne\s+ke\s+liye\b/gi, "to stop the war")
    .replace(/\biss?\s+conflict\s+ko\s+rokne\s+ke\s+liye\b/gi, "to stop the conflict")
    .replace(/\bwar\s+ko\s+rokne\s+ke\s+liye\b/gi, "to stop the war")
    .replace(/\bconflict\s+ko\s+rokne\s+ke\s+liye\b/gi, "to stop the conflict")
    .replace(/\biss?\b/gi, "this")
    .replace(/\bkya\b/gi, "what")
    .replace(/\bse\b/gi, "with")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCurrentAffairsActors(text: string) {
  const normalized = normalizeActorAliases(normalizeCurrentAffairsQuestion(text));
  const matches = normalized.match(CURRENT_AFFAIRS_ACTOR_EXTRACT_PATTERN) ?? [];
  const unique = new Set<string>();

  for (const match of matches) {
    const actor = normalizeActorAliases(match).trim();
    if (!actor) {
      continue;
    }
    unique.add(actor);
  }

  return [...unique].slice(0, 4);
}

export function looksLikeCurrentAffairsDemandQuestion(question: string): boolean {
  const text = normalizeCurrentAffairsQuestion(question).toLowerCase();
  if (!looksLikeCurrentAffairsQuestion(text)) {
    return false;
  }

  return Boolean(
    CURRENT_AFFAIRS_DEMAND_PATTERN.test(text)
    || /\bkya\s+conditions?\s+hai\b/i.test(text)
    || /\bkya\s+demands?\s+hai\b/i.test(text)
    || CURRENT_AFFAIRS_STOP_WAR_PATTERN.test(text)
  );
}

export function looksLikeCurrentAffairsQuestion(question: string): boolean {
  const text = normalizeCurrentAffairsQuestion(question).toLowerCase();
  if (!text) {
    return false;
  }

  if (
    /\b(my|gmail|calendar|drive|whatsapp|email|inbox|meeting|meetings|schedule|agenda|appointment|appointments)\b/.test(text)
  ) {
    return false;
  }

  // Entertainment / fiction queries should not be routed to current affairs
  if (
    /\b(story|plot|storyline|synopsis|movie|film|series|anime|drama|novel|avenger|marvel|dc|star\s*wars?|harry\s*potter|game\s*of\s*thrones|naruto|one\s*piece|lord\s*of\s*the\s*rings|infinity\s*war|end\s*game|endgame|civil\s*war)\b/.test(text)
    && /\b(story|plot|tell\s*me|explain|summary|synopsis)\b/.test(text)
  ) {
    return false;
  }

  // Historical events/topics should not be routed to current affairs
  if (
    /\b(world\s*war\s*[12i]+|ww[12]|cold\s*war\s*(era)?|french\s*revolution|american\s*revolution|mughal|ottoman|roman\s*empire|british\s*raj|independence\s*movement|ancient|medieval|renaissance|baroque|victorian|industrial\s*revolution)\b/i.test(text)
    && /\b(detail|history|batao|btao|samjhao|explain|tell\s*me|describe|summary|baare|about|overview|itihas)\b/i.test(text)
  ) {
    return false;
  }

  if (
    CURRENT_AFFAIRS_SCIENCE_CUE_PATTERN.test(text)
    && CURRENT_AFFAIRS_SCIENCE_ANALYSIS_PATTERN.test(text)
  ) {
    return false;
  }

  const hasActor = CURRENT_AFFAIRS_ACTOR_PATTERN.test(text);
  const hasEvent = CURRENT_AFFAIRS_EVENT_PATTERN.test(text);
  const hasStatus = CURRENT_AFFAIRS_STATUS_PATTERN.test(text);
  const hasLocation = CURRENT_AFFAIRS_LOCATION_PATTERN.test(text);
  const hasDeadline = CURRENT_AFFAIRS_DEADLINE_PATTERN.test(text);
  const hasPowerCrisis = CURRENT_AFFAIRS_POWER_CRISIS_PATTERN.test(text);
  const hasPowerInfrastructure = CURRENT_AFFAIRS_POWER_INFRASTRUCTURE_PATTERN.test(text);
  const startsAsYesNo = CURRENT_AFFAIRS_QUESTION_PATTERN.test(text);

  // Explicit "right now" / "currently" + actor/location = always current affairs
  const hasRecencyMarker = /\b(right now|currently|at present|these days|nowadays|latest|today|abhi|filhal)\b/i.test(text);

  return Boolean(
    (hasActor && (hasEvent || hasStatus || hasDeadline || hasPowerCrisis))
    || (hasLocation && (hasEvent || hasStatus || hasDeadline || hasPowerCrisis))
    || (hasDeadline && hasEvent)
    || (startsAsYesNo && (hasActor || hasLocation) && (hasEvent || hasStatus || hasPowerCrisis))
    || (/^(?:why|how)\b/.test(text) && (hasActor || hasLocation) && (hasPowerCrisis || hasPowerInfrastructure))
    || (hasRecencyMarker && (hasActor || hasLocation))
  );
}

export function looksLikeCurrentAffairsPowerCrisisQuestion(question: string): boolean {
  const text = normalizeCurrentAffairsQuestion(question).toLowerCase();
  if (!text) {
    return false;
  }

  return looksLikeCurrentAffairsQuestion(text)
    && (CURRENT_AFFAIRS_POWER_CRISIS_PATTERN.test(text) || CURRENT_AFFAIRS_POWER_INFRASTRUCTURE_PATTERN.test(text));
}

export function looksLikeCurrentAffairsLogisticsQuestion(question: string): boolean {
  const text = normalizeCurrentAffairsQuestion(question).toLowerCase();
  if (!text) {
    return false;
  }

  return looksLikeCurrentAffairsQuestion(text) && CURRENT_AFFAIRS_LOGISTICS_PATTERN.test(text);
}

export function looksLikeNamedCaseQuestion(question: string): boolean {
  const text = normalizeCurrentAffairsQuestion(question).toLowerCase();
  if (!text || NAMED_CASE_NOISE_PATTERN.test(text)) {
    return false;
  }

  if (!NAMED_CASE_EVENT_PATTERN.test(text)) {
    return false;
  }

  const words = text.split(/\s+/).filter(Boolean);
  const hasPromptLead = /^(what|who|why|how|tell me|explain|describe|was|were|did)\b/.test(text);
  const hasLocation = NAMED_CASE_LOCATION_PATTERN.test(text);
  const hasNameLikeLead = words.length >= 2 && /^[a-z][a-z0-9'-]+$/.test(words[0] ?? "") && /^[a-z][a-z0-9'-]+$/.test(words[1] ?? "");

  return Boolean(
    hasPromptLead
    || hasLocation
    || (words.length <= 8 && hasNameLikeLead)
  );
}

export function buildNamedCaseQueries(question: string): string[] {
  const topic = normalizeCurrentAffairsQuestion(question)
    .replace(/[?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!looksLikeNamedCaseQuestion(topic)) {
    return [];
  }

  const cleaned = topic
    .replace(/^(what was|what is|who was|who is|tell me about|explain|describe)\s+/i, "")
    .trim();

  const queries = new Set<string>([
    `${cleaned} case explained`,
    `${cleaned} news`,
    `${cleaned} incident`,
  ]);

  if (!/\b(india|delhi|goa|mumbai|kolkata|bengaluru|bangalore|noida|gurgaon|gurugram|hyderabad|chennai)\b/i.test(cleaned)) {
    queries.add(`${cleaned} India case`);
  }

  return [...queries].slice(0, 4);
}

export function isYesNoCurrentAffairsQuestion(question: string): boolean {
  const text = normalizeCurrentAffairsQuestion(question).toLowerCase();
  return CURRENT_AFFAIRS_QUESTION_PATTERN.test(text) && looksLikeCurrentAffairsQuestion(text);
}

function countNamedConflictCues(text: string) {
  return new Set(text.match(NAMED_CONFLICT_CUE_PATTERN) ?? []).size;
}

function hasExplicitNamedConflictScope(text: string) {
  return (
    /\b(?:iran|israel|russia|ukraine|india|pakistan|china|taiwan|north korea|south korea|gaza|hamas)\b.{0,20}\b(?:and|vs\.?|versus|-)\b.{0,20}\b(?:iran|israel|russia|ukraine|india|pakistan|china|taiwan|north korea|south korea|gaza|hamas)\b/i.test(text)
    || /\b(?:current|ongoing)\s+(?:war|conflict)\s+of\s+.+\b(?:and|vs\.?|versus|-)\b.+/i.test(text)
    || /\b(?:war|conflict)\s+between\s+.+\b(?:and|vs\.?|versus|-)\b.+/i.test(text)
  );
}

export function looksLikeAmbiguousCurrentWarQuestion(_question: string): boolean {
  const text = normalizeCurrentAffairsQuestion(_question).toLowerCase();
  if (!text) {
    return false;
  }

  if (!AMBIGUOUS_CURRENT_WAR_PATTERN.test(text)) {
    return false;
  }

  if (hasExplicitNamedConflictScope(text)) {
    return false;
  }

  return countNamedConflictCues(text) < 2;
}

export function buildCurrentAffairsClarificationReply(question: string): string {
  if (!looksLikeAmbiguousCurrentWarQuestion(question)) {
    return "";
  }

  return [
    "*Current-affairs clarification*",
    "",
    "I can answer this, but I need the conflict named explicitly to avoid a misleading live update.",
    "",
    "For example:",
    "1. Russia-Ukraine",
    "2. Iran-Israel",
    "3. Israel-Gaza",
    "4. Another specific conflict",
  ].join("\n");
}

function normalizeDeadlinePhrase(text: string) {
  return text
    .replace(/\b(\d+)\s+hours?\b/gi, "$1-hour")
    .replace(/\b(\d+)\s+days?\b/gi, "$1-day")
    .replace(/\b(\d+)\s+weeks?\b/gi, "$1-week")
    .replace(/\b(\d+)\s+months?\b/gi, "$1-month");
}

function normalizeActorAliases(text: string) {
  return text
    .replace(/\bu\.?\s*s\.?\s*a?\.?\b/gi, "US")
    .replace(/\bamerica\b/gi, "US")
    .replace(/\bwhite house\b/gi, "US")
    .replace(/\bunited states\b/gi, "US");
}

function trimQuestionLead(text: string) {
  return text
    .replace(/^(?:did|does|do|is|are|was|were|has|have|had|will|would|can|could|why|how|what(?:'s| is| are)?|when|where)\s+/i, "")
    .replace(/[?]+$/g, "")
    .replace(/\btoopen\b/gi, "to open")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCurrentAffairsSearchTopic(question: string) {
  const normalized = normalizeCurrentAffairsQuestion(question);
  return normalizeHinglishCurrentAffairsSearchTopic(
    normalizeActorAliases(normalizeDeadlinePhrase(trimQuestionLead(normalized))),
  );
}

function extractDeadlineWindow(topic: string) {
  return topic.match(/\b\d+-(?:hour|day|week|month)\b/i)?.[0] ?? "";
}

function extractActorHint(topic: string) {
  const match = topic.match(CURRENT_AFFAIRS_ACTOR_PATTERN);
  return match?.[0] ? normalizeActorAliases(match[0]) : "";
}

function stripCurrentAffairsFiller(topic: string) {
  return topic
    .replace(CURRENT_AFFAIRS_AMBIGUOUS_FILLER, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildCurrentAffairsQueries(question: string): string[] {
  if (!looksLikeCurrentAffairsQuestion(question)) {
    return [];
  }

  const topic = buildCurrentAffairsSearchTopic(question);
  if (!topic) {
    return [];
  }

  const actors = extractCurrentAffairsActors(question);
  const actorHint = extractActorHint(topic);
  const deadlineWindow = extractDeadlineWindow(topic);
  const cleanedTopic = stripCurrentAffairsFiller(topic) || topic;
  const queries = new Set<string>();

  if (looksLikeCurrentAffairsDemandQuestion(question)) {
    const [primaryActor, secondaryActor] = actors;
    if (primaryActor && secondaryActor) {
      queries.add(`${primaryActor} demands ${secondaryActor} to stop the war latest Reuters AP BBC`);
      queries.add(`${primaryActor} conditions for ceasefire with ${secondaryActor} latest`);
      queries.add(`${primaryActor} terms to end war with ${secondaryActor} latest`);
      queries.add(`${primaryActor} ${secondaryActor} negotiations to stop war latest`);
    } else if (primaryActor) {
      queries.add(`${primaryActor} conditions to stop war latest Reuters AP BBC`);
      queries.add(`${primaryActor} demands latest ceasefire terms`);
    }
  }

  if (CURRENT_AFFAIRS_LOGISTICS_PATTERN.test(cleanedTopic)) {
    const [primaryActor, secondaryActor] = actors;
    const asksLogisticsStatus = CURRENT_AFFAIRS_LOGISTICS_STATUS_CUE_PATTERN.test(cleanedTopic);
    const asksCargoQuantity = CURRENT_AFFAIRS_LOGISTICS_QUANTITY_CUE_PATTERN.test(cleanedTopic);
    if (primaryActor && secondaryActor) {
      if (asksLogisticsStatus) {
        queries.add(`${primaryActor} ${secondaryActor} tanker arrived anchored latest Reuters AP BBC`);
      }
      if (asksCargoQuantity) {
        queries.add(`${primaryActor} ${secondaryActor} tanker cargo barrels latest Reuters AP BBC`);
      }
      queries.add(`${primaryActor} ${secondaryActor} tanker shipment latest Reuters AP BBC`);
      queries.add(`${primaryActor} ${secondaryActor} fuel supply latest Reuters AP BBC`);
      queries.add(`${primaryActor} ${secondaryActor} shipping latest Reuters AP BBC`);
    } else if (actorHint) {
      if (asksLogisticsStatus) {
        queries.add(`${actorHint} tanker arrived anchored latest Reuters AP BBC`);
      }
      if (asksCargoQuantity) {
        queries.add(`${actorHint} tanker cargo barrels latest Reuters AP BBC`);
      }
      queries.add(`${actorHint} tanker shipment latest Reuters AP BBC`);
      queries.add(`${actorHint} fuel supply latest Reuters AP BBC`);
    }
    if (asksLogisticsStatus) {
      queries.add(`${cleanedTopic} arrived reached anchored latest Reuters AP BBC`);
    }
    if (asksCargoQuantity) {
      queries.add(`${cleanedTopic} barrels cargo amount latest Reuters AP BBC`);
    }
    queries.add(`${cleanedTopic} explanation Reuters AP BBC`);
  }

  if (CURRENT_AFFAIRS_POWER_CRISIS_PATTERN.test(cleanedTopic) || CURRENT_AFFAIRS_POWER_INFRASTRUCTURE_PATTERN.test(cleanedTopic)) {
    const [primaryActor] = actors;
    const utilitySubject = primaryActor || actorHint;
    if (utilitySubject) {
      queries.add(`${utilitySubject} blackout electricity crisis latest Reuters AP BBC`);
      queries.add(`${utilitySubject} power outage explanation latest Reuters AP BBC`);
      queries.add(`${utilitySubject} power grid fuel shortage latest Reuters AP BBC`);
    }
    queries.add(`${cleanedTopic} blackout explanation Reuters AP BBC`);
    queries.add(`${cleanedTopic} power outage cause latest Reuters AP BBC`);
  }

  queries.add(`${cleanedTopic} latest Reuters AP BBC`);
  queries.add(`${cleanedTopic} fact check latest`);
  queries.add(`"${cleanedTopic}" latest`);

  if (deadlineWindow) {
    queries.add(`${actorHint ? `${actorHint} ` : ""}${deadlineWindow} ultimatum Reuters AP`);
    queries.add(`${cleanedTopic.replace(/\bultimatum\b/i, "ultimatum deadline")} latest`);
  }

  if (CURRENT_AFFAIRS_STATUS_PATTERN.test(cleanedTopic)) {
    queries.add(`${cleanedTopic} status latest Reuters AP`);
  }

  if (CURRENT_AFFAIRS_LOCATION_PATTERN.test(cleanedTopic) && !/\bstatus\b/i.test(cleanedTopic)) {
    queries.add(`${cleanedTopic} latest status Reuters AP`);
  }

  return [...queries].slice(0, 4);
}
