import { NextRequest, NextResponse } from "next/server";

import {
  deleteGlobalLiteConnection,
  isGlobalLiteProvider,
} from "@/lib/clawcloud-global-lite";
import {
  getClawCloudErrorMessage,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ provider: string }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { provider } = await context.params;
    if (!isGlobalLiteProvider(provider)) {
      return NextResponse.json({ error: "Unsupported provider." }, { status: 400 });
    }

    await deleteGlobalLiteConnection(auth.user.id, provider);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
