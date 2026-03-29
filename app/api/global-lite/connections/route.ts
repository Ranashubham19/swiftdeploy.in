import { NextRequest, NextResponse } from "next/server";

import {
  getClawCloudErrorMessage,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";
import {
  listGlobalLiteConnections,
  upsertGlobalLiteConnection,
  type GlobalLiteUpsertInput,
} from "@/lib/clawcloud-global-lite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const connections = await listGlobalLiteConnections(auth.user.id);
    return NextResponse.json({ connections });
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
    const body = (await request.json()) as GlobalLiteUpsertInput;
    const connection = await upsertGlobalLiteConnection(auth.user.id, body);
    return NextResponse.json({ success: true, connection });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 400 },
    );
  }
}
