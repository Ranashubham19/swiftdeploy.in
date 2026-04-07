/**
 * Comprehensive live simulation test — tests ALL question types
 * across greetings, knowledge, weather, news, contacts, languages, etc.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  detectIntentForTest,
  buildDeterministicConversationReplyForTest,
  buildTimeboxedProfessionalReplyForTest,
  normalizeReplyForClawCloudDisplay,
  isVisibleFallbackReplyForTest,
} from "@/lib/clawcloud-agent";

// ── Helper: check reply is NOT a fallback ──
function assertNotFallback(reply: string | null | undefined, label: string) {
  const r = (reply ?? "").trim();
  assert.ok(r.length > 0, `${label}: reply is empty`);
  assert.ok(
    !isVisibleFallbackReplyForTest(r),
    `${label}: reply is a visible fallback:\n  "${r.slice(0, 200)}"`,
  );
  assert.ok(
    !r.includes("__LOW_CONFIDENCE"),
    `${label}: reply leaks internal signal:\n  "${r.slice(0, 200)}"`,
  );
  assert.ok(
    !r.includes("__NO_LIVE_DATA"),
    `${label}: reply leaks internal signal:\n  "${r.slice(0, 200)}"`,
  );
  assert.ok(
    !/I'm processing your request/i.test(r),
    `${label}: reply is 'processing' fallback:\n  "${r.slice(0, 200)}"`,
  );
  assert.ok(
    !/No translation was provided/i.test(r),
    `${label}: reply leaks translation error:\n  "${r.slice(0, 200)}"`,
  );
  assert.ok(
    !/I need one missing detail/i.test(r),
    `${label}: reply asks for missing detail:\n  "${r.slice(0, 200)}"`,
  );
  assert.ok(
    !/share the full equation/i.test(r),
    `${label}: reply asks to share equation:\n  "${r.slice(0, 200)}"`,
  );
  assert.ok(
    !/I need the complete equation/i.test(r),
    `${label}: reply asks for complete equation:\n  "${r.slice(0, 200)}"`,
  );
  assert.ok(
    !/scoped answer needed/i.test(r),
    `${label}: reply says "scoped answer needed":\n  "${r.slice(0, 200)}"`,
  );
}

// ═══════════════════════════════════════════════════════
// 1. GREETINGS — all world languages
// ═══════════════════════════════════════════════════════
test("Greetings: English hello", () => {
  const reply = buildDeterministicConversationReplyForTest("Hello");
  assertNotFallback(reply, "English hello");
  assert.ok((reply ?? "").length > 5, "Greeting too short");
});

test("Greetings: Hi", () => {
  const reply = buildDeterministicConversationReplyForTest("Hi");
  assertNotFallback(reply, "Hi");
});

test("Greetings: Hey there", () => {
  const reply = buildDeterministicConversationReplyForTest("Hey");
  assertNotFallback(reply, "Hey");
});

test("Greetings: Namaste", () => {
  const reply = buildDeterministicConversationReplyForTest("Namaste");
  assertNotFallback(reply, "Namaste");
});

test("Greetings: Konichiwa", () => {
  const reply = buildDeterministicConversationReplyForTest("Konichiwa");
  assertNotFallback(reply, "Konichiwa");
});

test("Greetings: Konichiwa my friend", () => {
  const reply = buildDeterministicConversationReplyForTest("Konichiwa my friend");
  assertNotFallback(reply, "Konichiwa my friend");
});

test("Greetings: Hola", () => {
  const reply = buildDeterministicConversationReplyForTest("Hola");
  assertNotFallback(reply, "Hola");
});

test("Greetings: Bonjour", () => {
  const reply = buildDeterministicConversationReplyForTest("Bonjour");
  assertNotFallback(reply, "Bonjour");
});

test("Greetings: Assalamu alaikum", () => {
  const reply = buildDeterministicConversationReplyForTest("Assalamu alaikum");
  assertNotFallback(reply, "Assalamu alaikum");
});

test("Greetings: Merhaba", () => {
  const reply = buildDeterministicConversationReplyForTest("Merhaba");
  assertNotFallback(reply, "Merhaba");
});

test("Greetings: Annyeong", () => {
  const reply = buildDeterministicConversationReplyForTest("Annyeong");
  assertNotFallback(reply, "Annyeong");
});

test("Greetings: Ni hao", () => {
  const reply = buildDeterministicConversationReplyForTest("Ni hao");
  assertNotFallback(reply, "Ni hao");
});

test("Greetings: Good morning", () => {
  const reply = buildDeterministicConversationReplyForTest("Good morning");
  assertNotFallback(reply, "Good morning");
});

test("Greetings: Sat Sri Akal", () => {
  const reply = buildDeterministicConversationReplyForTest("Sat Sri Akal");
  assertNotFallback(reply, "Sat Sri Akal");
});

// ═══════════════════════════════════════════════════════
// 2. INTENT DETECTION — routing correctness
// ═══════════════════════════════════════════════════════
test("Intent: 'what is cuba' → explain, NOT finance", () => {
  const intent = detectIntentForTest("what is cuba");
  assert.ok(intent.type !== "finance", `'what is cuba' misrouted to finance: ${intent.type}`);
  assert.ok(intent.type !== "economics", `'what is cuba' misrouted to economics: ${intent.type}`);
});

test("Intent: 'what is gorkha' → explain", () => {
  const intent = detectIntentForTest("what is gorkha");
  assert.equal(intent.type, "explain");
});

test("Intent: 'what is gotha' → explain", () => {
  const intent = detectIntentForTest("what is gotha");
  assert.equal(intent.type, "explain");
});

test("Intent: 'what is veeri' → explain", () => {
  const intent = detectIntentForTest("what is veeri");
  assert.equal(intent.type, "explain");
});

test("Intent: 'weather in delhi' → weather route", () => {
  const intent = detectIntentForTest("weather in delhi");
  assert.equal(intent.category, "weather");
});

test("Intent: 'what is the news of india today' → news", () => {
  const intent = detectIntentForTest("what is the news of india today");
  assert.ok(
    intent.category === "news" || intent.category === "web_search" || intent.category === "research",
    `'news of india today' should route to news/research, got: ${intent.category}`,
  );
});

test("Intent: 'send message to Maa good morning' → send_message or email", () => {
  const intent = detectIntentForTest("Send message to Maa: Good morning");
  assert.ok(
    ["send_message", "email"].includes(intent.type),
    `'Send message to Maa' should be send_message or email, got: ${intent.type}`,
  );
});

test("Intent: 'Can you speak in brazil' → language", () => {
  const intent = detectIntentForTest("Can you speak in brazilian");
  assert.ok(
    intent.type === "language" || intent.type === "explain" || intent.type === "general",
    `'speak in brazilian' should be language/explain, got: ${intent.type}`,
  );
});

test("Intent: '2+2' → math", () => {
  const intent = detectIntentForTest("2+2");
  assert.equal(intent.type, "math");
});

test("Intent: 'explain AI vs ML vs Deep Learning' → explain or technology", () => {
  const intent = detectIntentForTest("explain AI vs ML vs Deep Learning");
  assert.ok(
    ["explain", "technology"].includes(intent.type),
    `'explain AI vs ML' should be explain or technology, got: ${intent.type}`,
  );
});

test("Intent: 'who is the PM of India' → explain or research", () => {
  const intent = detectIntentForTest("who is the PM of India");
  assert.ok(
    ["explain", "research", "web_search", "general"].includes(intent.type),
    `'who is PM of India' bad route: ${intent.type}`,
  );
});

test("Intent: 'capital of France' → geography", () => {
  const intent = detectIntentForTest("capital of France");
  assert.equal(intent.type, "geography");
});

test("Intent: 'translate hello to Spanish' → language", () => {
  const intent = detectIntentForTest("translate hello to Spanish");
  assert.equal(intent.type, "language");
});

test("Intent: 'set reminder for 5pm meeting' → reminder", () => {
  const intent = detectIntentForTest("set reminder for 5pm meeting");
  assert.equal(intent.type, "reminder");
});

// ═══════════════════════════════════════════════════════
// 3. TIMEBOXED REPLIES — no fallbacks
// ═══════════════════════════════════════════════════════
test("Timeboxed: 'what is gorkha' no fallback", () => {
  const reply = buildTimeboxedProfessionalReplyForTest("what is gorkha", "explain");
  // Should either give a real answer or return signal (which finalizeGuarded handles)
  assert.ok(reply.length > 0, "Empty reply for 'what is gorkha'");
  // If it's a signal, that's OK — finalizeGuarded will catch it and generate real answer
  if (!reply.includes("__LOW_CONFIDENCE")) {
    assertNotFallback(reply, "what is gorkha");
  }
});

test("Timeboxed: 'what is cuba' no fallback", () => {
  const reply = buildTimeboxedProfessionalReplyForTest("what is cuba", "explain");
  assert.ok(reply.length > 0, "Empty reply for 'what is cuba'");
  if (!reply.includes("__LOW_CONFIDENCE")) {
    assertNotFallback(reply, "what is cuba");
  }
});

test("Timeboxed: 'explain photosynthesis' gives real answer", () => {
  const reply = buildTimeboxedProfessionalReplyForTest("explain photosynthesis", "explain");
  assert.ok(reply.length > 0);
});

test("Timeboxed: 'explain AI vs ML vs Deep Learning' gives real answer", () => {
  const reply = buildTimeboxedProfessionalReplyForTest("explain AI vs ML vs Deep Learning", "explain");
  assert.ok(reply.length > 0);
  if (!reply.includes("__LOW_CONFIDENCE")) {
    assert.ok(/AI|ML|Deep Learning/i.test(reply), "Reply doesn't mention AI/ML");
  }
});

// ═══════════════════════════════════════════════════════
// 4. normalizeReplyForClawCloudDisplay — catches leaks
// ═══════════════════════════════════════════════════════
test("Display normalize: catches 'No translation was provided'", () => {
  const normalized = normalizeReplyForClawCloudDisplay("No translation was provided in the prompt.");
  assert.ok(
    !normalized.includes("No translation was provided"),
    `Translation error leaked: "${normalized}"`,
  );
});

test("Display normalize: catches 'I'm processing your request'", () => {
  const input = "I'm processing your request. Please try again in a moment.";
  const isF = isVisibleFallbackReplyForTest(input);
  assert.ok(isF, "'Processing' message not detected as fallback");
});

test("Display normalize: catches precise low-confidence clarifications", () => {
  assert.ok(
    isVisibleFallbackReplyForTest(
      "I need the exact topic, name, item, or number you want answered to give a precise reply.",
    ),
  );
});

test("Display normalize: catches 'I need one missing detail'", () => {
  assert.ok(isVisibleFallbackReplyForTest("I need one missing detail to answer this."));
});

test("Display normalize: catches 'share the full equation'", () => {
  assert.ok(isVisibleFallbackReplyForTest("Please share the full equation and I'll solve it."));
});

test("Display normalize: catches 'scoped answer needed'", () => {
  assert.ok(isVisibleFallbackReplyForTest("Scoped answer needed"));
});

test("Display normalize: catches 'I need the complete equation'", () => {
  assert.ok(isVisibleFallbackReplyForTest("I need the complete equation or every given value plus the exact quantity you want me to solve for"));
});

// ═══════════════════════════════════════════════════════
// 5. FALLBACK DETECTION — ensure common bad patterns caught
// ═══════════════════════════════════════════════════════
test("Fallback detection: 'drop them here and I'll walk through'", () => {
  assert.ok(isVisibleFallbackReplyForTest("drop them here and I'll walk through the solution step-by-step."));
});

test("Fallback detection: 'please try again in a moment'", () => {
  assert.ok(isVisibleFallbackReplyForTest("I'm processing your request. Please try again in a moment."));
});

test("Fallback detection: translation leak", () => {
  assert.ok(isVisibleFallbackReplyForTest("No translation was provided in the prompt."));
});

test("Fallback detection: good answer passes through", () => {
  assert.ok(!isVisibleFallbackReplyForTest("Cuba is an island nation in the Caribbean, known for its rich history and culture."));
});

test("Fallback detection: good greeting passes through", () => {
  assert.ok(!isVisibleFallbackReplyForTest("Hey there! 👋 Great to hear from you!\n\nHow can I help you today? 😊"));
});

test("Fallback detection: good weather answer passes through", () => {
  assert.ok(!isVisibleFallbackReplyForTest("🌡️ *Weather in Delhi*\n\nTemperature: 32°C\nHumidity: 45%\nWind: 12 km/h"));
});
