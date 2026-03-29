import { NextRequest, NextResponse } from "next/server";

import { getClawCloudWhatsAppRuntimeStatus } from "@/lib/clawcloud-whatsapp";
import {
  getClawCloudErrorMessage,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function withNoStoreHeaders(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

export async function GET(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return withNoStoreHeaders(
      NextResponse.json({ error: auth.error }, { status: auth.status }),
    );
  }

  try {
    const runtimeStatus = await getClawCloudWhatsAppRuntimeStatus(auth.user.id).catch(() => null);
    return withNoStoreHeaders(NextResponse.json({ runtime: runtimeStatus }));
  } catch (error) {
    return withNoStoreHeaders(
      NextResponse.json(
        { error: getClawCloudErrorMessage(error) },
        { status: 500 },
      ),
    );
  }
}
