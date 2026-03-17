-- ClawCloud payments migration
-- Run this in Supabase after the base schema and global-features migration.

alter table public.subscriptions
  add column if not exists stripe_sub_id text unique,
  add column if not exists stripe_customer_id text;

alter table public.agent_tasks
  drop constraint if exists agent_tasks_task_type_check;

alter table public.agent_tasks
  add constraint agent_tasks_task_type_check
  check (task_type in (
    'morning_briefing',
    'draft_replies',
    'meeting_reminders',
    'email_search',
    'evening_summary',
    'custom_reminder',
    'weekly_spend',
    'user_contacts'
  ));

drop policy if exists "Service role bypass subs" on public.subscriptions;
create policy "Service role bypass subs"
  on public.subscriptions
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.seed_default_tasks(p_user_id uuid)
returns void as $$
begin
  insert into public.agent_tasks (user_id, task_type, is_enabled, schedule_time, schedule_days, config)
  values
    (p_user_id, 'morning_briefing', true,  '07:00', array['mon','tue','wed','thu','fri','sat','sun'], '{"max_emails":50,"tone":"concise"}'),
    (p_user_id, 'draft_replies',    true,  null,    null,                                             '{"tone":"professional","auto_send":false}'),
    (p_user_id, 'meeting_reminders',true,  null,    null,                                             '{"minutes_before":30,"include_context":true}'),
    (p_user_id, 'email_search',     false, null,    null,                                             '{}'::jsonb),
    (p_user_id, 'evening_summary',  false, '21:00', array['mon','tue','wed','thu','fri'],            '{}'::jsonb),
    (p_user_id, 'custom_reminder',  false, null,    null,                                             '{}'::jsonb),
    (p_user_id, 'weekly_spend',     false, '09:00', array['sun'],                                     '{}'::jsonb)
  on conflict (user_id, task_type) do nothing;
end;
$$ language plpgsql security definer;
