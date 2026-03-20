import { NextRequest, NextResponse } from "next/server";

import {
  getClawCloudErrorMessage,
  getClawCloudSupabaseAdmin,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";
import { localeNames, type SupportedLocale, isSupportedLocale } from "@/lib/clawcloud-locales";
import { saveMemoryFact } from "@/lib/clawcloud-user-memory";

export const runtime = "nodejs";

function normalizeFullName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeTimezone(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLanguage(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
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
      language?: string;
    };

    const fullName = normalizeFullName(body.full_name);
    const timezone = normalizeTimezone(body.timezone);
    const requestedLanguage = normalizeLanguage(body.language);

    if (!fullName) {
      return NextResponse.json({ error: "Full name is required." }, { status: 400 });
    }

    if (!isValidTimezone(timezone)) {
      return NextResponse.json({ error: "Timezone is invalid." }, { status: 400 });
    }

    if (requestedLanguage && !isSupportedLocale(requestedLanguage)) {
      return NextResponse.json({ error: "Language is invalid." }, { status: 400 });
    }

    const supabaseAdmin = getClawCloudSupabaseAdmin();
    const { data: existingPreferences } = await supabaseAdmin
      .from("user_preferences")
      .select("language")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    const language = (requestedLanguage && isSupportedLocale(requestedLanguage)
      ? requestedLanguage
      : existingPreferences?.language && isSupportedLocale(existingPreferences.language)
        ? existingPreferences.language
        : "en") as SupportedLocale;

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

    const { error: preferencesError } = await supabaseAdmin
      .from("user_preferences")
      .upsert(
        {
          user_id: auth.user.id,
          language,
          timezone,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

    if (preferencesError) {
      throw new Error(preferencesError.message);
    }

    await Promise.all([
      saveMemoryFact(auth.user.id, "name", fullName, "explicit", 1.0),
      saveMemoryFact(auth.user.id, "timezone", timezone, "explicit", 1.0),
      saveMemoryFact(auth.user.id, "reply_language", localeNames[language], "explicit", 1.0),
    ]);

    return NextResponse.json({ user: { ...data, language } });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
