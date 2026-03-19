import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClawCloudAnswerQualityProfile,
  buildClawCloudLowConfidenceReply,
  scoreClawCloudAnswerConfidence,
} from "@/lib/clawcloud-answer-quality";
import { detectBillingIntent } from "@/lib/clawcloud-billing-wa";
import { detectDriveIntent } from "@/lib/clawcloud-drive";
import { answerHolidayQuery, detectHolidayQuery } from "@/lib/clawcloud-holidays";
import {
  detectIndianStateFromText,
  inferSpendingCategory,
  normalizeMerchantName,
} from "@/lib/clawcloud-india-normalization";
import { detectIndianStockQuery, detectTrainIntent } from "@/lib/clawcloud-india-live";
import {
  detectImageGenIntent,
  extractImagePrompt,
  getImageGenerationStatus,
} from "@/lib/clawcloud-imagegen";
import { solveHardMathQuestion } from "@/lib/clawcloud-expert";
import {
  buildClawCloudSafetyReply,
  detectClawCloudSafetyRisk,
} from "@/lib/clawcloud-safety";
import { answerTaxQuery, detectTaxQuery } from "@/lib/clawcloud-tax";
import {
  clawCloudActiveTaskLimits,
  clawCloudRunLimits,
  formatDateKey,
  getIndiaDayWindow,
  parseMeridiemTimeTo24Hour,
} from "@/lib/clawcloud-types";
import { detectUpiSms, parseUpiSms } from "@/lib/clawcloud-upi";
import { detectFinanceQuery } from "@/lib/clawcloud-finance";

test("plan limits and India day helpers stay stable", () => {
  assert.equal(clawCloudRunLimits.free, 10);
  assert.equal(clawCloudRunLimits.starter, 100);
  assert.equal(clawCloudActiveTaskLimits.free, 3);
  assert.equal(parseMeridiemTimeTo24Hour("12:05 AM"), "00:05");
  assert.equal(parseMeridiemTimeTo24Hour("12:45 PM"), "12:45");
  assert.equal(parseMeridiemTimeTo24Hour("9:15 PM"), "21:15");
  assert.equal(formatDateKey(new Date("2026-03-19T01:00:00Z"), "Asia/Kolkata"), "2026-03-19");

  const window = getIndiaDayWindow(new Date("2026-03-19T12:00:00Z"));
  assert.equal(window.dateKey, "2026-03-19");
  assert.equal(window.startIso, "2026-03-18T18:30:00.000Z");
  assert.equal(window.endIso, "2026-03-19T18:30:00.000Z");
});

test("billing, drive, finance, train, and image intents classify correctly", () => {
  assert.equal(detectBillingIntent("upgrade me to pro plan"), "upgrade");
  assert.equal(detectBillingIntent("what is my current plan status"), "plan_status");
  assert.equal(detectBillingIntent("billing status"), "plan_status");
  assert.equal(detectBillingIntent("cancel my pro subscription"), "cancel");
  assert.equal(
    detectBillingIntent("deep: Design a zero-downtime Stripe billing migration with dual-write, idempotent webhooks, rollback, and ledger cutover"),
    null,
  );

  assert.equal(detectDriveIntent("list my Google Drive files"), "list");
  assert.equal(detectDriveIntent("find my sales sheet in google drive"), "search");
  assert.equal(detectDriveIntent("add row to budget sheet: rent,25000"), "write");
  assert.equal(detectDriveIntent("read my doc"), "read");

  assert.equal(detectFinanceQuery("bitcoin price today")?.type, "crypto");
  assert.equal(detectFinanceQuery("ticker AAPL price")?.type, "stock_us");
  assert.equal(detectFinanceQuery("HDFC Bank share price")?.type, "stock_india");

  assert.equal(detectIndianStockQuery("Reliance share price today"), "RELIANCE.NS");
  assert.deepEqual(detectTrainIntent("PNR status for 1234567890"), { type: "pnr", value: "1234567890" });
  assert.deepEqual(detectTrainIntent("running status of train 12951"), { type: "running", value: "12951" });
  assert.deepEqual(detectTrainIntent("schedule for 12002"), { type: "schedule", value: "12002" });

  assert.equal(detectImageGenIntent("Generate a logo for my chai brand"), true);
  assert.equal(extractImagePrompt("Generate a logo for my chai brand"), "logo for my chai brand");
  assert.equal(getImageGenerationStatus().available, true);
  assert.ok(getImageGenerationStatus().providers.includes("pollinations"));
});

test("India normalization and UPI parsing stay user-friendly", () => {
  assert.equal(normalizeMerchantName("BUNDL TECHNOLOGIES PRIVATE LIMITED"), "Swiggy");
  assert.equal(inferSpendingCategory("Uber"), "transport");
  assert.equal(detectIndianStateFromText("next holiday in Chennai"), "Tamil Nadu");

  const sms = "SBI Alert: Rs 499.00 debited on UPI to BUNDL TECHNOLOGIES PRIVATE LIMITED Ref 123456789. Avl bal Rs 9999.";
  assert.equal(detectUpiSms(sms), true);

  const parsed = parseUpiSms(sms, "user-123");
  assert.ok(parsed);
  assert.equal(parsed?.amount, 499);
  assert.equal(parsed?.transaction_type, "debit");
  assert.equal(parsed?.merchant, "Swiggy");
  assert.equal(parsed?.category, "food");
  assert.equal(parsed?.bank, "SBI");
});

test("holiday and tax helpers answer India-specific questions", () => {
  assert.equal(detectHolidayQuery("When is Onam in Kerala?"), true);
  const holidayAnswer = answerHolidayQuery("When is Onam in Kerala?");
  assert.ok(holidayAnswer);
  assert.match(holidayAnswer ?? "", /Onam/i);
  assert.match(holidayAnswer ?? "", /Kerala/i);

  assert.equal(detectTaxQuery("GST on Rs 1180 at 18% inclusive"), "gst");
  const gstAnswer = answerTaxQuery("GST on Rs 1180 at 18% inclusive");
  assert.ok(gstAnswer);
  assert.match(gstAnswer ?? "", /GST Calculation/i);
  assert.match(gstAnswer ?? "", /180\.00/);

  const incomeTaxAnswer = answerTaxQuery("Income tax on 12 lakh salary");
  assert.ok(incomeTaxAnswer);
  assert.match(incomeTaxAnswer ?? "", /Income Tax Estimate/i);
  assert.match(incomeTaxAnswer ?? "", /Total Tax Payable/i);
});

test("quant expert solvers keep deterministic DiD and energy-risk answers complete", () => {
  const didAnswer = solveHardMathQuestion(
    "In a difference-in-differences policy evaluation, the treatment coefficient beta is -0.18 and the standard error is 0.05. Explain the estimator, compute the t-statistic, 95% confidence interval, significance, and list the parallel-trends checks and robustness tests.",
  );
  assert.ok(didAnswer);
  assert.match(didAnswer ?? "", /Numerical Readout/i);
  assert.match(didAnswer ?? "", /t-statistic:\s*-?3\.600/i);
  assert.match(didAnswer ?? "", /95% CI/i);

  const energyAnswer = solveHardMathQuestion(
    "A European power retailer needs weekly 95% VaR and stress loss estimation under spot price spikes and heat waves while hedging with forwards. Give the correct loss definition, estimation structure, stress testing approach, and explain why naive Gaussian normality fails.",
  );
  assert.ok(energyAnswer);
  assert.match(energyAnswer ?? "", /Loss Definition/i);
  assert.match(energyAnswer ?? "", /L_week/i);
  assert.match(energyAnswer ?? "", /Final Answer/i);
});

test("safety interception catches emergencies and leaves informational queries alone", () => {
  assert.equal(detectClawCloudSafetyRisk("I want to kill myself tonight"), "self_harm");
  assert.equal(detectClawCloudSafetyRisk("My father has chest pain and cannot breathe"), "urgent_medical");
  assert.equal(detectClawCloudSafetyRisk("What are the causes of depression?"), null);

  const reply = buildClawCloudSafetyReply("self_harm");
  assert.match(reply, /emergency/i);
  assert.match(reply, /trusted person/i);
});

test("answer-quality profiles and confidence scoring stay conservative on high-stakes replies", () => {
  const healthProfile = buildClawCloudAnswerQualityProfile({
    question: "Can I take 650 mg paracetamol every 4 hours for fever?",
    intent: "health",
    category: "health",
  });

  assert.equal(healthProfile.domain, "health");
  assert.equal(healthProfile.isHighStakes, true);
  assert.equal(healthProfile.requiresVerification, true);
  assert.equal(healthProfile.confidenceFloor, "medium");

  const unsafeScore = scoreClawCloudAnswerConfidence({
    question: "Can I take 650 mg paracetamol every 4 hours for fever?",
    answer: "Yes, do it. Take 650 mg every 4 hours and stop only if the fever goes away.",
    profile: healthProfile,
  });
  assert.equal(unsafeScore, "low");

  const financeProfile = buildClawCloudAnswerQualityProfile({
    question: "What is the AAPL price today and should I buy it?",
    intent: "finance",
    category: "finance",
  });
  const evidenceAnswer = [
    "AAPL is trading at $215.32.",
    "Data fetched: 10:15 AM IST.",
    "Source note: live market data as of today.",
    "This is general information, not personal advice, so please verify and consult a qualified financial advisor before investing.",
  ].join(" ");
  const evidenceScore = scoreClawCloudAnswerConfidence({
    question: "What is the AAPL price today and should I buy it?",
    answer: evidenceAnswer,
    profile: financeProfile,
  });
  assert.equal(evidenceScore, "high");

  const lowConfidenceReply = buildClawCloudLowConfidenceReply(
    "Can I sue my landlord immediately?",
    buildClawCloudAnswerQualityProfile({
      question: "Can I sue my landlord immediately?",
      intent: "law",
      category: "law",
    }),
  );
  assert.match(lowConfidenceReply, /lawyer/i);
});
