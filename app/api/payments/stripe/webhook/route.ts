import { NextRequest, NextResponse } from "next/server";

import {
  parseStripeWebhookEvent,
  syncStripeSubscription,
} from "@/lib/clawcloud-stripe";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature") || "";
  const event = await parseStripeWebhookEvent(rawBody, signature);

  if (!event) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncStripeSubscription(event);
        break;
      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[stripe/webhook]", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
