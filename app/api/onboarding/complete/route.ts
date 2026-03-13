import { NextRequest, NextResponse } from "next/server";

import { completeClawCloudOnboarding } from "@/lib/clawcloud-agent";
import {
  getClawCloudErrorMessage,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";
import {
  parseMeridiemTimeTo24Hour,
  type ClawCloudTaskType,
} from "@/lib/clawcloud-types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await request.json()) as {
      selectedTasks?: ClawCloudTaskType[];
      taskConfigs?: Partial<Record<ClawCloudTaskType, Record<string, unknown>>>;
    };

    const selectedTasks = body.selectedTasks ?? [];
    const taskConfigs = body.taskConfigs ?? {};
    const normalizedTaskConfigs = Object.fromEntries(
      Object.entries(taskConfigs).map(([taskType, config]) => {
        if (
          taskType === "morning_briefing" &&
          typeof config?.briefing_time === "string"
        ) {
          return [
            taskType,
            {
              ...config,
              briefing_time: config.briefing_time,
              schedule_time: parseMeridiemTimeTo24Hour(config.briefing_time),
            },
          ];
        }

        return [taskType, config ?? {}];
      }),
    ) as Partial<Record<ClawCloudTaskType, Record<string, unknown>>>;

    const result = await completeClawCloudOnboarding({
      userId: auth.user.id,
      selectedTasks,
      taskConfigs: normalizedTaskConfigs,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
