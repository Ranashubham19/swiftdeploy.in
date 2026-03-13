import { NextRequest, NextResponse } from "next/server";

import { buildClawCloudGoogleAuthUrl } from "@/lib/clawcloud-google";
import { getClawCloudErrorMessage } from "@/lib/clawcloud-supabase";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")?.trim();

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  try {
    const url = buildClawCloudGoogleAuthUrl(userId);
    return NextResponse.redirect(url);
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
