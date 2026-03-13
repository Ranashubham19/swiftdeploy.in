import { NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";
import {
  getClawCloudErrorMessage,
  getClawCloudSupabaseAdmin,
  isValidSharedSecret,
} from "@/lib/clawcloud-supabase";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isValidSharedSecret(request, env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabaseAdmin = getClawCloudSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("cron_health")
      .select("last_run_at, last_fired, last_errors, total_runs")
      .eq("id", 1)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(
        {
          healthy: false,
          error: error?.message ?? "No cron health record found.",
        },
        { status: 503 },
      );
    }

    const lastRunAt = new Date(data.last_run_at);
    const secondsSinceLastRun = Math.floor((Date.now() - lastRunAt.getTime()) / 1000);
    const stale = secondsSinceLastRun > 5 * 60;

    return NextResponse.json({
      healthy: !stale,
      last_run_at: data.last_run_at,
      seconds_since_last_run: secondsSinceLastRun,
      last_fired: data.last_fired,
      last_errors: data.last_errors,
      total_runs: data.total_runs,
      stale,
    });
  } catch (error) {
    return NextResponse.json(
      {
        healthy: false,
        error: getClawCloudErrorMessage(error),
      },
      { status: 500 },
    );
  }
}
