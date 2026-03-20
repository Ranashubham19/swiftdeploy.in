import { NextRequest, NextResponse } from "next/server";

import {
  getGoogleWorkspaceCoreAccess,
  getGoogleWorkspaceExtendedAccess,
} from "@/lib/google-workspace-rollout";
import {
  getClawCloudErrorMessage,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const core = getGoogleWorkspaceCoreAccess(auth.user.email ?? null);
    const extended = getGoogleWorkspaceExtendedAccess(auth.user.email ?? null);

    return NextResponse.json({
      core: {
        available: core.available,
        allowlisted: core.allowlisted,
        reason: core.reason,
      },
      extended: {
        available: extended.available,
        allowlisted: extended.allowlisted,
        reason: extended.reason,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
