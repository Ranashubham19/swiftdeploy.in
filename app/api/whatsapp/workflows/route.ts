import { NextRequest, NextResponse } from "next/server";

import { getClawCloudErrorMessage, requireClawCloudAuth } from "@/lib/clawcloud-supabase";
import { listWhatsAppWorkflowRuns, listWhatsAppWorkflows, updateWhatsAppWorkflow } from "@/lib/clawcloud-whatsapp-workflows";
import type { WhatsAppWorkflowType } from "@/lib/clawcloud-whatsapp-workspace-types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const [workflows, runs] = await Promise.all([
      listWhatsAppWorkflows(auth.user.id),
      listWhatsAppWorkflowRuns(auth.user.id, 120),
    ]);

    return NextResponse.json({ workflows, runs });
  } catch (error) {
    return NextResponse.json({ error: getClawCloudErrorMessage(error) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await request.json()) as {
      workflowType?: WhatsAppWorkflowType;
      patch?: Record<string, unknown>;
    };

    if (!body.workflowType) {
      return NextResponse.json({ error: "workflowType is required" }, { status: 400 });
    }

    const workflow = await updateWhatsAppWorkflow(auth.user.id, body.workflowType, body.patch ?? {});
    return NextResponse.json({ workflow });
  } catch (error) {
    return NextResponse.json({ error: getClawCloudErrorMessage(error) }, { status: 500 });
  }
}
