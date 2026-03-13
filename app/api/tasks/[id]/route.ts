import { NextRequest, NextResponse } from "next/server";

import {
  deleteClawCloudTask,
  updateClawCloudTask,
} from "@/lib/clawcloud-agent";
import {
  getClawCloudErrorMessage,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";

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
