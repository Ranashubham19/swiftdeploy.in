import { NextRequest, NextResponse } from "next/server";

import { runClawCloudTask } from "@/lib/clawcloud-agent";
import {
  getClawCloudErrorMessage,
  isValidSharedSecret,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";
import type { ClawCloudTaskType } from "@/lib/clawcloud-types";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      userId?: string;
      taskType?: ClawCloudTaskType;
      userMessage?: string;
      _internal?: boolean;
    };

    if (!body.taskType) {
      return NextResponse.json({ error: "taskType is required" }, { status: 400 });
    }

    if (body._internal) {
      if (!isValidSharedSecret(request, env.CRON_SECRET, env.AGENT_SECRET)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      if (!body.userId) {
        return NextResponse.json({ error: "userId is required" }, { status: 400 });
      }

      const result = await runClawCloudTask({
        userId: body.userId,
        taskType: body.taskType,
        userMessage: body.userMessage ?? null,
        bypassEnabledCheck: true,
      });

      return NextResponse.json({ success: true, result });
    }

    const auth = await requireClawCloudAuth(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const userId = body.userId ?? auth.user.id;
    if (userId !== auth.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const result = await runClawCloudTask({
      userId,
      taskType: body.taskType,
      userMessage: body.userMessage ?? null,
    });

    return NextResponse.json({ success: true, result });
  } catch (error) {
    const message = getClawCloudErrorMessage(error);
    const status =
      /Unauthorized|Forbidden/.test(message) ? 401 : /limit/i.test(message) ? 429 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
