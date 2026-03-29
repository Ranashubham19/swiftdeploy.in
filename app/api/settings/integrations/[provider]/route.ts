import { NextRequest, NextResponse } from "next/server";

import {
  disconnectClawCloudIntegration,
  type ClawCloudDisconnectProvider,
} from "@/lib/clawcloud-privacy-lifecycle";
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

    if (provider === "google" || provider === "whatsapp" || provider === "telegram") {
      const result = await disconnectClawCloudIntegration(
        auth.user.id,
        provider as ClawCloudDisconnectProvider,
      );
      return NextResponse.json({ success: true, result });
    }

    return NextResponse.json({ error: "Unsupported provider." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
