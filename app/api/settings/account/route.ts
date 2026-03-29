import { NextRequest, NextResponse } from "next/server";

import { deleteClawCloudAccount } from "@/lib/clawcloud-privacy-lifecycle";
import {
  getClawCloudErrorMessage,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";

export const runtime = "nodejs";

function getDeletionConfirmationTarget(email?: string | null) {
  const normalizedEmail = String(email ?? "").trim();
  return normalizedEmail || "DELETE MY ACCOUNT";
}

function normalizeConfirmation(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function DELETE(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { confirmation?: string };
    const confirmation = normalizeConfirmation(body.confirmation);
    const target = getDeletionConfirmationTarget(auth.user.email ?? null);

    if (!confirmation) {
      return NextResponse.json(
        { error: "Type your account email to confirm deletion." },
        { status: 400 },
      );
    }

    if (confirmation !== target) {
      return NextResponse.json(
        { error: `Confirmation mismatch. Type ${target} to continue.` },
        { status: 400 },
      );
    }

    const result = await deleteClawCloudAccount(auth.user.id, auth.user.email ?? null);
    return NextResponse.json({
      success: true,
      result,
      redirect_to: "/auth",
    });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
