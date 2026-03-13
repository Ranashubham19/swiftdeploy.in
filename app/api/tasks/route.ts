import { NextRequest, NextResponse } from "next/server";

import { createClawCloudTask } from "@/lib/clawcloud-agent";
import {
  getClawCloudErrorMessage,
  getClawCloudSupabaseAdmin,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";
import type { ClawCloudTaskType } from "@/lib/clawcloud-types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const supabaseAdmin = getClawCloudSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("agent_tasks")
      .select("*")
      .eq("user_id", auth.user.id)
      .order("created_at");

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ tasks: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await request.json()) as {
      task_type?: ClawCloudTaskType;
      schedule_time?: string | null;
      schedule_days?: string[] | null;
      config?: Record<string, unknown>;
    };

    if (!body.task_type) {
      return NextResponse.json({ error: "task_type is required" }, { status: 400 });
    }

    const task = await createClawCloudTask({
      userId: auth.user.id,
      taskType: body.task_type,
      scheduleTime: body.schedule_time ?? null,
      scheduleDays: body.schedule_days ?? null,
      config: body.config ?? {},
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    const message = getClawCloudErrorMessage(error);
    const status = /limit/i.test(message) ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
