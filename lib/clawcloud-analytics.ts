import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { formatDateKey } from "@/lib/clawcloud-types";

export async function upsertAnalyticsDaily(
  userId: string,
  updates: Partial<{
    emails_processed: number;
    drafts_created: number;
    tasks_run: number;
    minutes_saved: number;
    wa_messages_sent: number;
  }>,
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const date = formatDateKey();

  const { data: current } = await supabaseAdmin
    .from("analytics_daily")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();

  const nextRecord = {
    user_id: userId,
    date,
    emails_processed: (current?.emails_processed ?? 0) + (updates.emails_processed ?? 0),
    drafts_created: (current?.drafts_created ?? 0) + (updates.drafts_created ?? 0),
    tasks_run: (current?.tasks_run ?? 0) + (updates.tasks_run ?? 0),
    minutes_saved: (current?.minutes_saved ?? 0) + (updates.minutes_saved ?? 0),
    wa_messages_sent: (current?.wa_messages_sent ?? 0) + (updates.wa_messages_sent ?? 0),
  };

  await supabaseAdmin.from("analytics_daily").upsert(nextRecord, {
    onConflict: "user_id,date",
  });
}
