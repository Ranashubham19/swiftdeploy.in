export type ClawCloudSafetyRisk = "self_harm" | "violent_harm" | "urgent_medical";

const SELF_HARM_PATTERNS = [
  /\b(i want to die|i wanna die|i do not want to live|i don't want to live|kill myself|end my life|suicide|self harm|hurt myself|want to disappear|no reason to live)\b/i,
  /\b(overdose|od on|cut myself|hang myself)\b/i,
];

const SELF_HARM_CONTEXT_PATTERNS = [
  /\b(i am|i'm|i feel|i have been|my life|myself)\b/i,
  /\btonight|right now|today|cannot go on|can't go on\b/i,
];

const URGENT_MEDICAL_PATTERNS = [
  /\b(chest pain|cannot breathe|can't breathe|trouble breathing|difficulty breathing|stroke|face drooping|slurred speech|severe bleeding|unconscious|passed out|seizure|overdose|poisoned|poisoning|anaphylaxis|severe allergic reaction)\b/i,
  /\b(my father|my mother|my child|my wife|my husband|i have|he has|she has)\b.*\b(chest pain|cannot breathe|can't breathe|stroke|severe bleeding|unconscious|overdose|seizure)\b/i,
];

const VIOLENT_HARM_PATTERNS = [
  /\b(i want to kill|i am going to kill|how do i kill|how can i kill|hurt someone badly|stab him|shoot him|poison him|murder)\b/i,
  /\b(i want to hurt|i am going to hurt|attack)\b.*\b(him|her|them|someone|myself)\b/i,
];

const INFORMATIONAL_PREFIX = /\b(what is|explain|why do|causes of|prevention|statistics|news about|article about|research on)\b/i;

function looksInformationalSafetyQuestion(message: string) {
  return INFORMATIONAL_PREFIX.test(message) && !/\b(i|my|me|myself)\b/i.test(message);
}

export function detectClawCloudSafetyRisk(message: string): ClawCloudSafetyRisk | null {
  if (!message.trim() || looksInformationalSafetyQuestion(message)) {
    return null;
  }

  if (SELF_HARM_PATTERNS.some((pattern) => pattern.test(message))) {
    if (SELF_HARM_CONTEXT_PATTERNS.some((pattern) => pattern.test(message)) || /\b(suicide|self harm)\b/i.test(message)) {
      return "self_harm";
    }
  }

  if (URGENT_MEDICAL_PATTERNS.some((pattern) => pattern.test(message))) {
    return "urgent_medical";
  }

  if (VIOLENT_HARM_PATTERNS.some((pattern) => pattern.test(message))) {
    return "violent_harm";
  }

  return null;
}

export function buildClawCloudSafetyReply(risk: ClawCloudSafetyRisk): string {
  if (risk === "self_harm") {
    return [
      "I am really sorry you are going through this.",
      "",
      "If you might hurt yourself or you do not feel safe, please contact local emergency services now or go to the nearest emergency room immediately.",
      "If there is a trusted person nearby, call or text them now and ask them to stay with you.",
      "",
      "If you want, reply with *the name of one person you can contact right now* and I will help you write the message.",
    ].join("\n");
  }

  if (risk === "violent_harm") {
    return [
      "I cannot help with hurting someone.",
      "",
      "If someone is in immediate danger, contact local emergency services now and create distance from the situation if you can do so safely.",
      "If you want, I can help you write a calm message to a trusted person or think through the safest next step.",
    ].join("\n");
  }

  return [
    "This could be an emergency, and I cannot assess emergencies safely over chat.",
    "",
    "Please seek local emergency care now or contact emergency services immediately, especially if the symptoms are severe, sudden, or getting worse.",
    "If you want, I can help you write a one-line message to a family member or doctor right now.",
  ].join("\n");
}
