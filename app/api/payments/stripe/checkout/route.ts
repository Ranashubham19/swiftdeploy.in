import { NextRequest, NextResponse } from "next/server";

import { createStripeCheckoutSession } from "@/lib/clawcloud-stripe";
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
    const body = (await request.json()) as {
      plan?: string;
      period?: string;
      currency?: string;
    };

    const plan = body.plan === "pro" ? "pro" : "starter";
    const period = body.period === "annual" ? "annual" : "monthly";
    const currency = body.currency === "inr" ? "inr" : "usd";
    const appUrl = env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    const result = await createStripeCheckoutSession({
      userId: auth.user.id,
      userEmail: auth.user.email || "",
      plan,
      period,
      currency,
      successUrl: `${appUrl}/dashboard?upgraded=1`,
      cancelUrl: `${appUrl}/dashboard?upgrade_cancelled=1`,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
