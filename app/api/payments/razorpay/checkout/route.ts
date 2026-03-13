import { NextRequest, NextResponse } from "next/server";

import { createRazorpaySubscription } from "@/lib/clawcloud-razorpay";
import {
  getClawCloudErrorMessage,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await request.json()) as {
      plan?: string;
      period?: string;
    };

    const plan = body.plan === "pro" ? "pro" : "starter";
    const period = body.period === "annual" ? "annual" : "monthly";

    const result = await createRazorpaySubscription({
      userId: auth.user.id,
      userEmail: auth.user.email || "",
      plan,
      period,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
