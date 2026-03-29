import { NextRequest, NextResponse } from "next/server";

import {
  listDashboardJournalThreads,
  upsertDashboardJournalThreads,
  validateDashboardJournalThreads,
} from "@/lib/clawcloud-dashboard-journal-store";
import {
  getClawCloudErrorMessage,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const threads = await listDashboardJournalThreads(auth.user.id);
    return NextResponse.json({ threads });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await request.json()) as { threads?: unknown };
    const threads = validateDashboardJournalThreads(body.threads ?? []);
    const syncedThreads = await upsertDashboardJournalThreads(auth.user.id, threads);

    return NextResponse.json({ threads: syncedThreads });
  } catch (error) {
    const message = getClawCloudErrorMessage(error);
    const status = /threads must be an array|sync up to/i.test(message) ? 400 : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
