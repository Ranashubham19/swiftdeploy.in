import { NextRequest, NextResponse } from "next/server";

import { runClawCloudMorningBriefing } from "@/lib/clawcloud-agent";
import {
  getClawCloudErrorMessage,
  isValidSharedSecret,
} from "@/lib/clawcloud-supabase";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isValidSharedSecret(request, env.CRON_SECRET, env.AGENT_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { userId?: string };
    if (!body.userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const result = await runClawCloudMorningBriefing(body.userId);
    return NextResponse.json({ success: true, result });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
