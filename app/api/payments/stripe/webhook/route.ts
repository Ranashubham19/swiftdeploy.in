import { NextRequest, NextResponse } from "next/server";

import {
  beginBillingWebhookProcessing,
  markBillingWebhookFailed,
  markBillingWebhookProcessed,
  normalizeBillingWebhookUserId,
  resolveStripeWebhookEventId,
} from "@/lib/clawcloud-billing-webhook-inbox";
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
    const eventId = await resolveStripeWebhookEventId(event.id, rawBody);
    const userId = normalizeBillingWebhookUserId(event.data.object.metadata?.userId);
    const claim = await beginBillingWebhookProcessing({
      provider: "stripe",
      externalEventId: eventId,
      eventType: event.type,
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

    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncStripeSubscription(event);
        break;
      default:
        break;
    }

    await markBillingWebhookProcessed("stripe", eventId);
    return NextResponse.json({ received: true });
  } catch (error) {
    try {
      const parsedEvent = event as { id?: string; type?: string } | null;
      if (parsedEvent) {
        const eventId = await resolveStripeWebhookEventId(parsedEvent.id, rawBody);
        await markBillingWebhookFailed(
          "stripe",
          eventId,
          error instanceof Error ? error.message : "Webhook processing failed.",
        );
      }
    } catch {
      // Best-effort failure tracking only.
    }
    console.error("[stripe/webhook]", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
