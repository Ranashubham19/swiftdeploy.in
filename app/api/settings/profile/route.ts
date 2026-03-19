import { NextRequest, NextResponse } from "next/server";

import {
  getClawCloudErrorMessage,
  getClawCloudSupabaseAdmin,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";

export const runtime = "nodejs";

function normalizeFullName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeTimezone(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidTimezone(value: string) {
  if (!value) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await request.json()) as {
      full_name?: string;
      timezone?: string;
    };

    const fullName = normalizeFullName(body.full_name);
    const timezone = normalizeTimezone(body.timezone);

    if (!fullName) {
      return NextResponse.json({ error: "Full name is required." }, { status: 400 });
    }

    if (!isValidTimezone(timezone)) {
      return NextResponse.json({ error: "Timezone is invalid." }, { status: 400 });
    }

    const supabaseAdmin = getClawCloudSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("users")
      .update({
        full_name: fullName,
        timezone,
      })
      .eq("id", auth.user.id)
      .select("id, email, full_name, timezone, plan")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ user: data });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
