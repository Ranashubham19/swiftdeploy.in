# Run The Complete Supabase Migration

## 1. Open Supabase SQL Editor

Go to your Supabase project dashboard, then open `SQL Editor` from the left sidebar.

## 2. Paste and run the combined file

Open `supabase/clawcloud-complete-migration.sql` from this repo, copy the full contents, paste it into a new SQL query, and click `Run`.

Expected result:
- `Success. No rows returned`

## 3. Verify the tables

Open `Table Editor` in Supabase and confirm these 16 tables exist:

- `users`
- `connected_accounts`
- `agent_tasks`
- `task_runs`
- `dashboard_journal_threads`
- `global_lite_connections`
- `whatsapp_messages`
- `analytics_daily`
- `subscriptions`
- `user_preferences`
- `reply_approvals`
- `chat_threads`
- `research_runs`
- `cron_log`
- `meeting_reminder_log`
- `cron_health`

If all 16 are present, the migration is complete.
