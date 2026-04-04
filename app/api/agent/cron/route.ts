import { NextRequest, NextResponse } from "next/server";

import { runDueClawCloudTasks } from "@/lib/clawcloud-agent-compat";
import {
  getClawCloudErrorMessage,
  isValidSharedSecret,
} from "@/lib/clawcloud-supabase";
import {
  activateSupabasePressureCooldown,
  getSupabasePressureState,
  isSupabasePressureMessage,
} from "@/lib/clawcloud-supabase-pressure";
import { processDueWhatsAppWorkflowRuns } from "@/lib/clawcloud-whatsapp-workflows";
import { env } from "@/lib/env";

export const runtime = "nodejs";

async function handleCronRequest(request: NextRequest) {
  if (!isValidSharedSecret(request, env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pressureState = getSupabasePressureState("agent-cron");
  if (pressureState) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: "supabase_pressure_cooldown",
      cooldownRemainingMs: pressureState.remainingMs,
      detail: pressureState.reason,
    });
  }

  try {
    const result = await runDueClawCloudTasks();
    if (result.degraded) {
      const cooldown = activateSupabasePressureCooldown(
        "agent-cron",
        "Supabase pressure detected while scanning scheduled tasks.",
      );
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "supabase_pressure_cooldown",
        cooldownRemainingMs: cooldown.remainingMs,
        details: result,
      });
    }

    let workflowRuns: Awaited<ReturnType<typeof processDueWhatsAppWorkflowRuns>> = [];
    try {
      workflowRuns = await processDueWhatsAppWorkflowRuns({ limit: 100 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
      if (isSupabasePressureMessage(message)) {
        const cooldown = activateSupabasePressureCooldown(
          "agent-cron",
          "Supabase pressure detected while scanning WhatsApp workflows.",
        );
        return NextResponse.json({
          success: true,
          skipped: true,
          reason: "supabase_pressure_cooldown",
          cooldownRemainingMs: cooldown.remainingMs,
          detail: message,
          details: result,
        });
      }
      console.error("[cron] WhatsApp workflow scan failed:", message);
    }

    return NextResponse.json({
      success: true,
      timestamp: result.timestamp,
      fired: result.fired.length,
      errors: result.errors.length,
      whatsappWorkflowsProcessed: workflowRuns.length,
      details: result,
    });
  } catch (error) {
    if (isSupabasePressureMessage(error instanceof Error ? error.message : String(error ?? ""))) {
      const cooldown = activateSupabasePressureCooldown(
        "agent-cron",
        error instanceof Error ? error.message : "Supabase pressure detected in cron route.",
      );
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "supabase_pressure_cooldown",
        cooldownRemainingMs: cooldown.remainingMs,
        detail: cooldown.reason,
      });
    }

    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return handleCronRequest(request);
}

export async function POST(request: NextRequest) {
  return handleCronRequest(request);
}
