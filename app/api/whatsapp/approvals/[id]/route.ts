import { NextRequest, NextResponse } from "next/server";

import { updateWhatsAppReplyApproval } from "@/lib/clawcloud-whatsapp-approval";
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
      action?: "send" | "skip";
      draftReply?: string;
    };
    const { id } = await context.params;

    if (body.action !== "send" && body.action !== "skip") {
      return NextResponse.json(
        { error: "action must be send or skip" },
        { status: 400 },
      );
    }

    const result = await updateWhatsAppReplyApproval(auth.user.id, id, {
      action: body.action,
      draftReply: body.draftReply,
    });
    return NextResponse.json({
      approval: result.approval,
      sendResult: result.sendResult,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
