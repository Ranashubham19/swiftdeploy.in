import { NextRequest, NextResponse } from "next/server";

import {
  syncRazorpaySubscription,
  type RazorpayWebhookEvent,
  verifyRazorpayWebhookSignature,
} from "@/lib/clawcloud-razorpay";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") || "";
  const isValid = await verifyRazorpayWebhookSignature(rawBody, signature);

  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const event = JSON.parse(rawBody) as RazorpayWebhookEvent;

    switch (event.event) {
      case "subscription.activated":
      case "subscription.charged":
      case "subscription.completed":
      case "subscription.cancelled":
      case "subscription.halted":
        await syncRazorpaySubscription(event);
        break;
      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[razorpay/webhook]", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
