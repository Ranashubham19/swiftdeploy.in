import { NextRequest, NextResponse } from "next/server";

import { getClawCloudActivityData } from "@/lib/clawcloud-agent-compat";
import {
  getClawCloudErrorMessage,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? "100");
  const days = Number(searchParams.get("days") ?? "30");

  try {
    const data = await getClawCloudActivityData({
      userId: auth.user.id,
      limit,
      days,
    });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
