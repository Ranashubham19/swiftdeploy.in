import { NextRequest, NextResponse } from "next/server";

import {
  getClawCloudErrorMessage,
  isValidSharedSecret,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";
import { env } from "@/lib/env";
import { sendClawCloudWhatsAppToPhone } from "@/lib/clawcloud-whatsapp";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    let resolvedUserId: string | null = null;
    const body = (await request.json()) as {
      phone?: string;
      jid?: string;
      message?: string;
      contactName?: string;
      source?: "approval" | "workflow" | "direct_command" | "assistant_reply" | "system" | "api_send";
      approvalId?: string;
      workflowRunId?: string;
      idempotencyKey?: string;
      metadata?: Record<string, unknown> | null;
      _internal?: boolean;
    };

    if ((!body.phone && !body.jid) || !body.message) {
      return NextResponse.json(
        { error: "phone or jid, plus message, are required" },
        { status: 400 },
      );
    }

    if (body._internal) {
      if (!isValidSharedSecret(request, env.AGENT_SECRET, env.CRON_SECRET)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } else {
      const auth = await requireClawCloudAuth(request);
      if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
      }
      resolvedUserId = auth.user.id;
    }

    const result = await sendClawCloudWhatsAppToPhone(body.phone ?? null, body.message, {
      userId: resolvedUserId ?? undefined,
      contactName: body.contactName ?? null,
      jid: body.jid ?? null,
      source: body.source ?? null,
      approvalId: body.approvalId ?? null,
      workflowRunId: body.workflowRunId ?? null,
      idempotencyKey: body.idempotencyKey ?? null,
      metadata: body.metadata ?? null,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
