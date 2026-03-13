import { NextRequest, NextResponse } from "next/server";

import { routeInboundAgentMessage } from "@/lib/clawcloud-agent";
import {
  getClawCloudErrorMessage,
  isValidSharedSecret,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      userId?: string;
      message?: string;
      _internal?: boolean;
    };

    if (!body.message?.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    if (body._internal) {
      if (!isValidSharedSecret(request, env.CRON_SECRET, env.AGENT_SECRET)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      if (!body.userId) {
        return NextResponse.json({ error: "userId is required" }, { status: 400 });
      }

      const response = await routeInboundAgentMessage(body.userId, body.message);
      return NextResponse.json({ success: true, response });
    }

    const auth = await requireClawCloudAuth(request);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const userId = body.userId ?? auth.user.id;
    if (userId !== auth.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const response = await routeInboundAgentMessage(userId, body.message);
    return NextResponse.json({ success: true, response });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
