import { NextRequest, NextResponse } from "next/server";

import { runDueClawCloudTasks } from "@/lib/clawcloud-agent-compat";
import {
  getClawCloudErrorMessage,
  isValidSharedSecret,
} from "@/lib/clawcloud-supabase";
import { processDueWhatsAppWorkflowRuns } from "@/lib/clawcloud-whatsapp-workflows";
import { env } from "@/lib/env";

export const runtime = "nodejs";

async function handleCronRequest(request: NextRequest) {
  if (!isValidSharedSecret(request, env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [result, workflowRuns] = await Promise.all([
      runDueClawCloudTasks(),
      processDueWhatsAppWorkflowRuns({ limit: 100 }).catch(() => []),
    ]);
    return NextResponse.json({
      success: true,
      timestamp: result.timestamp,
      fired: result.fired.length,
      errors: result.errors.length,
      whatsappWorkflowsProcessed: workflowRuns.length,
      details: result,
    });
  } catch (error) {
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
