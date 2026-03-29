import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { env } from "@/lib/env";

export type BillingCurrency = "usd" | "inr";
export type BillingPeriod = "monthly" | "annual";
export type PaidPlan = "starter" | "pro";

type StripePriceId = string;
type StripeCheckoutSession = { id: string; url: string };
type StripePortalSession = { url: string };
type StripeSubscription = {
  id: string;
  customer: string;
  status: string;
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end: boolean;
  metadata?: { userId?: string; plan?: string };
  items?: { data?: Array<{ price?: { id?: string } }> };
};

export type StripeEvent = {
  id?: string;
  type: string;
  data: { object: StripeSubscription };
};

const stripePrices: Record<
  PaidPlan,
  Record<BillingPeriod, Record<BillingCurrency, StripePriceId>>
> = {
  starter: {
    monthly: {
      usd: env.STRIPE_PRICE_STARTER_MONTHLY_USD || "price_REPLACE_STARTER_MONTHLY_USD",
      inr: env.STRIPE_PRICE_STARTER_MONTHLY_INR || "price_REPLACE_STARTER_MONTHLY_INR",
    },
    annual: {
      usd: env.STRIPE_PRICE_STARTER_ANNUAL_USD || "price_REPLACE_STARTER_ANNUAL_USD",
      inr: env.STRIPE_PRICE_STARTER_ANNUAL_INR || "price_REPLACE_STARTER_ANNUAL_INR",
    },
  },
  pro: {
    monthly: {
      usd: env.STRIPE_PRICE_PRO_MONTHLY_USD || "price_REPLACE_PRO_MONTHLY_USD",
      inr: env.STRIPE_PRICE_PRO_MONTHLY_INR || "price_REPLACE_PRO_MONTHLY_INR",
    },
    annual: {
      usd: env.STRIPE_PRICE_PRO_ANNUAL_USD || "price_REPLACE_PRO_ANNUAL_USD",
      inr: env.STRIPE_PRICE_PRO_ANNUAL_INR || "price_REPLACE_PRO_ANNUAL_INR",
    },
  },
};

function getStripeSecretKey() {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set.");
  }

  return env.STRIPE_SECRET_KEY;
}

function stripeHeaders() {
  return {
    Authorization: `Bearer ${getStripeSecretKey()}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
}

function encodeForm(data: Record<string, string>) {
  return Object.entries(data)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

async function stripePost<T>(path: string, data: Record<string, string>): Promise<T> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: stripeHeaders(),
    body: encodeForm(data),
  });

  const json = (await response.json().catch(() => ({}))) as T & {
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(json.error?.message || `Stripe ${path} failed.`);
  }

  return json;
}

export async function createStripeCheckoutSession(input: {
  userId: string;
  userEmail: string;
  plan: PaidPlan;
  period: BillingPeriod;
  currency: BillingCurrency;
  successUrl: string;
  cancelUrl: string;
}) {
  const priceId = stripePrices[input.plan][input.period][input.currency];
  const session = await stripePost<StripeCheckoutSession>("checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    customer_email: input.userEmail,
    "subscription_data[metadata][userId]": input.userId,
    "subscription_data[metadata][plan]": input.plan,
    "subscription_data[metadata][currency]": input.currency,
    "metadata[userId]": input.userId,
    "metadata[plan]": input.plan,
    success_url: `${input.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: input.cancelUrl,
    allow_promotion_codes: "true",
  });

  return { sessionId: session.id, url: session.url };
}

export async function createStripePortalSession(userId: string, returnUrl: string) {
  const supabase = getClawCloudSupabaseAdmin();
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!subscription?.stripe_customer_id) {
    throw new Error("No active Stripe customer was found for this user.");
  }

  return stripePost<StripePortalSession>("billing_portal/sessions", {
    customer: subscription.stripe_customer_id,
    return_url: returnUrl,
  });
}

function parseStripeSignature(signature: string) {
  const parts = Object.fromEntries(
    signature
      .split(",")
      .map((segment) => segment.trim())
      .map((segment) => {
        const [key, value] = segment.split("=");
        return [key, value];
      }),
  );

  return {
    timestamp: parts.t || "",
    v1: parts.v1 || "",
  };
}

export async function parseStripeWebhookEvent(rawBody: string, signature: string) {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return JSON.parse(rawBody) as StripeEvent;
  }

  const { timestamp, v1 } = parseStripeSignature(signature);
  if (!timestamp || !v1) {
    return null;
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const computed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload),
  );
  const computedHex = Array.from(new Uint8Array(computed))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  if (computedHex !== v1) {
    return null;
  }

  return JSON.parse(rawBody) as StripeEvent;
}

function planFromPriceId(priceId: string): PaidPlan {
  const proIds = Object.values(stripePrices.pro).flatMap((group) => Object.values(group));
  return proIds.includes(priceId) ? "pro" : "starter";
}

export async function syncStripeSubscription(event: StripeEvent) {
  const subscription = event.data.object;
  const userId = subscription.metadata?.userId;
  if (!userId) {
    return;
  }

  const supabase = getClawCloudSupabaseAdmin();
  const priceId = subscription.items?.data?.[0]?.price?.id || "";
  const plan = planFromPriceId(priceId);
  const isActive =
    event.type !== "customer.subscription.deleted" &&
    ["active", "trialing"].includes(subscription.status);

  const subscriptionPlan = isActive ? plan : "free";
  const subscriptionStatus = isActive ? subscription.status : "cancelled";

  await supabase.from("subscriptions").upsert(
    {
      user_id: userId,
      plan: subscriptionPlan,
      status: subscriptionStatus,
      stripe_sub_id: subscription.id,
      stripe_customer_id: subscription.customer,
      current_period_start: subscription.current_period_start
        ? new Date(subscription.current_period_start * 1000).toISOString()
        : null,
      current_period_end: subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000).toISOString()
        : null,
      cancel_at_period_end: subscription.cancel_at_period_end ?? false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  await supabase.from("users").update({ plan: subscriptionPlan }).eq("id", userId);
}
