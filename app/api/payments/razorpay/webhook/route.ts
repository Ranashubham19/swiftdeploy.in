import { NextRequest, NextResponse } from "next/server";

import {
  beginBillingWebhookProcessing,
  markBillingWebhookFailed,
  markBillingWebhookProcessed,
  normalizeBillingWebhookUserId,
  resolveRazorpayWebhookEventId,
} from "@/lib/clawcloud-billing-webhook-inbox";
import {
  syncRazorpaySubscription,
  type RazorpayWebhookEvent,
  verifyRazorpayWebhookSignature,
} from "@/lib/clawcloud-razorpay";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature") || "";
  const headerEventId = request.headers.get("x-razorpay-event-id");
  const isValid = await verifyRazorpayWebhookSignature(rawBody, signature);

  if (!isValid) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const event = JSON.parse(rawBody) as RazorpayWebhookEvent;
    const eventId = await resolveRazorpayWebhookEventId(headerEventId, rawBody);
    const userId = normalizeBillingWebhookUserId(
      event.payload.subscription?.entity.notes?.userId,
    );
    const claim = await beginBillingWebhookProcessing({
      provider: "razorpay",
      externalEventId: eventId,
      eventType: event.event,
      userId,
      payload: event as unknown as Record<string, unknown>,
      signatureVerified: true,
    });

    if (claim.action === "duplicate") {
      return NextResponse.json({ received: true, duplicate: true });
    }

    if (claim.action === "in_progress") {
      return NextResponse.json({ received: true, processing: true });
    }

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

    await markBillingWebhookProcessed("razorpay", eventId);
    return NextResponse.json({ received: true });
  } catch (error) {
    try {
      const eventId = await resolveRazorpayWebhookEventId(headerEventId, rawBody);
      await markBillingWebhookFailed(
        "razorpay",
        eventId,
        error instanceof Error ? error.message : "Webhook processing failed.",
      );
    } catch {
      // Best-effort failure tracking only.
    }
    console.error("[razorpay/webhook]", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
