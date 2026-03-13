import { NextRequest, NextResponse } from "next/server";

import { createStripePortalSession } from "@/lib/clawcloud-stripe";
import {
  getClawCloudErrorMessage,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const appUrl = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const result = await createStripePortalSession(auth.user.id, `${appUrl}/dashboard`);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
