-- ClawCloud global feature migration
-- Run this in your Supabase SQL editor after the base schema.

create table if not exists public.user_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  language text not null default 'en',
  timezone text not null default 'UTC',
  briefing_time time not null default '07:00',
  auto_send boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.reply_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  email_id text not null,
  email_from text not null,
  email_subject text not null,
  draft_body text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'skipped', 'edit_requested')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reply_approvals_user_status_idx
  on public.reply_approvals (user_id, status);

alter table public.user_preferences enable row level security;
alter table public.reply_approvals enable row level security;

drop policy if exists "Users manage own preferences" on public.user_preferences;
create policy "Users manage own preferences"
  on public.user_preferences
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users see own reply approvals" on public.reply_approvals;
create policy "Users see own reply approvals"
  on public.reply_approvals
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Service role bypass preferences" on public.user_preferences;
create policy "Service role bypass preferences"
  on public.user_preferences
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "Service role bypass reply_approvals" on public.reply_approvals;
create policy "Service role bypass reply_approvals"
  on public.reply_approvals
  for all
  to service_role
  using (true)
  with check (true);

alter table public.agent_tasks drop constraint if exists agent_tasks_task_type_check;
alter table public.agent_tasks add constraint agent_tasks_task_type_check
  check (task_type in (
    'morning_briefing',
    'draft_replies',
    'meeting_reminders',
    'email_search',
    'evening_summary',
    'custom_reminder',
    'weekly_spend'
  ));
