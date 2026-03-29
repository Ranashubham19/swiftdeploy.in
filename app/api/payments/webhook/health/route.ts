import { NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";
import {
  getClawCloudErrorMessage,
  getClawCloudSupabaseAdmin,
  isValidSharedSecret,
} from "@/lib/clawcloud-supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BillingWebhookHealthRow = {
  provider: "stripe" | "razorpay";
  status: "pending" | "processing" | "processed" | "failed";
  last_seen_at: string;
  processed_at: string | null;
  failure_reason: string | null;
};

export async function GET(request: NextRequest) {
  if (!isValidSharedSecret(request, env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabaseAdmin = getClawCloudSupabaseAdmin();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin
      .from("billing_webhook_events")
      .select("provider, status, last_seen_at, processed_at, failure_reason")
      .gte("last_seen_at", since)
      .order("last_seen_at", { ascending: false })
      .limit(250);

    if (error) {
      throw new Error(error.message);
    }

    const rows = (data ?? []) as BillingWebhookHealthRow[];
    const providers = ["stripe", "razorpay"] as const;
    const summary = Object.fromEntries(
      providers.map((provider) => {
        const providerRows = rows.filter((row) => row.provider === provider);
        const lastReceived = providerRows[0]?.last_seen_at ?? null;
        const lastProcessed =
          providerRows.find((row) => row.processed_at)?.processed_at ?? null;

        return [
          provider,
          {
            total: providerRows.length,
            pending: providerRows.filter((row) => row.status === "pending").length,
            processing: providerRows.filter((row) => row.status === "processing").length,
            processed: providerRows.filter((row) => row.status === "processed").length,
            failed: providerRows.filter((row) => row.status === "failed").length,
            last_received_at: lastReceived,
            last_processed_at: lastProcessed,
            recent_failures: providerRows
              .filter((row) => row.status === "failed" && row.failure_reason)
              .slice(0, 5)
              .map((row) => ({
                last_seen_at: row.last_seen_at,
                failure_reason: row.failure_reason,
              })),
          },
        ];
      }),
    );

    return NextResponse.json({
      ok: true,
      window_hours: 24,
      checked_at: new Date().toISOString(),
      summary,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: getClawCloudErrorMessage(error),
      },
      { status: 500 },
    );
  }
}
