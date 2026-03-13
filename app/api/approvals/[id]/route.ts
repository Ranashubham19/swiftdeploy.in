import { NextRequest, NextResponse } from "next/server";

import { updateReplyApproval } from "@/lib/clawcloud-reply-approval";
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
      action?: string;
      draft_body?: string;
    };
    const { id } = await context.params;

    if (body.action !== "send" && body.action !== "skip") {
      return NextResponse.json(
        { error: "action must be 'send' or 'skip'" },
        { status: 400 },
      );
    }

    const approval = await updateReplyApproval(auth.user.id, id, {
      action: body.action,
      draftBody: body.draft_body,
    });

    return NextResponse.json({ success: true, approval });
  } catch (error) {
    const message = getClawCloudErrorMessage(error);
    const status = /not found/i.test(message) ? 404 : /already/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
