import { NextRequest, NextResponse } from "next/server";

import {
  deleteClawCloudTask,
  updateClawCloudTask,
} from "@/lib/clawcloud-agent-compat";
import {
  getClawCloudErrorMessage,
  getClawCloudSupabaseAdmin,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";
import {
  clawCloudActiveTaskLimits,
  type ClawCloudPlan,
} from "@/lib/clawcloud-types";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await request.json()) as {
      is_enabled?: boolean;
      schedule_time?: string | null;
      schedule_days?: string[] | null;
      config?: Record<string, unknown>;
    };
    const { id } = await context.params;

    if (body.is_enabled === true) {
      const supabaseAdmin = getClawCloudSupabaseAdmin();
      const [planResult, activeResult] = await Promise.all([
        supabaseAdmin
          .from("users")
          .select("plan")
          .eq("id", auth.user.id)
          .maybeSingle(),
        supabaseAdmin
          .from("agent_tasks")
          .select("id")
          .eq("user_id", auth.user.id)
          .eq("is_enabled", true)
          .neq("id", id),
      ]);

      const plan = (planResult.data?.plan ?? "free") as ClawCloudPlan;
      const currentActiveCount = activeResult.data?.length ?? 0;
      const limit = clawCloudActiveTaskLimits[plan];

      if (currentActiveCount >= limit) {
        return NextResponse.json(
          {
            error: `Your ${plan} plan allows ${limit} active task${limit === 1 ? "" : "s"}. Upgrade to enable more.`,
            code: "TASK_LIMIT_REACHED",
            limit,
            plan,
          },
          { status: 403 },
        );
      }
    }

    const task = await updateClawCloudTask(auth.user.id, id, {
      ...(typeof body.is_enabled === "boolean"
        ? { is_enabled: body.is_enabled }
        : {}),
      ...(body.schedule_time !== undefined ? { schedule_time: body.schedule_time } : {}),
      ...(body.schedule_days !== undefined ? { schedule_days: body.schedule_days } : {}),
      ...(body.config !== undefined ? { config: body.config } : {}),
    });

    return NextResponse.json({ task });
  } catch (error) {
    const message = getClawCloudErrorMessage(error);
    const status = /not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await context.params;
    await deleteClawCloudTask(auth.user.id, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = getClawCloudErrorMessage(error);
    const status = /not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
