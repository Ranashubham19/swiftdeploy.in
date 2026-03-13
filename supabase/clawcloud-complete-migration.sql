-- =============================================================================
-- CLAWCLOUD - COMPLETE SUPABASE MIGRATION
-- Run this entire file in: Supabase Dashboard -> SQL Editor -> New query -> Run
-- Safe to re-run. Uses IF NOT EXISTS, DROP IF EXISTS, and CREATE OR REPLACE.
-- =============================================================================


-- =============================================================================
-- MIGRATION 1: BASE SCHEMA
-- =============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- chat_threads
create table if not exists public.chat_threads (
  id text primary key,
  user_id text,
  title text not null,
  updated_at timestamptz not null default timezone('utc', now()),
  messages jsonb not null default '[]'::jsonb,
  progress jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  active_result jsonb
);

create index if not exists chat_threads_user_id_updated_at_idx
  on public.chat_threads (user_id, updated_at desc);

-- research_runs
create table if not exists public.research_runs (
  id bigint generated always as identity primary key,
  question text not null,
  plan jsonb not null,
  progress jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  retrieved_context jsonb not null default '[]'::jsonb,
  report jsonb,
  firebase_uid text,
  user_email text,
  user_name text,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.chat_threads enable row level security;
alter table public.research_runs enable row level security;

drop policy if exists "Allow anon read chat threads" on public.chat_threads;
create policy "Allow anon read chat threads"
  on public.chat_threads for select
  using (true);

drop policy if exists "Allow anon upsert chat threads" on public.chat_threads;
create policy "Allow anon upsert chat threads"
  on public.chat_threads for insert
  with check (true);

drop policy if exists "Allow anon update chat threads" on public.chat_threads;
create policy "Allow anon update chat threads"
  on public.chat_threads for update
  using (true)
  with check (true);

drop policy if exists "Allow anon insert research runs" on public.research_runs;
create policy "Allow anon insert research runs"
  on public.research_runs for insert
  with check (true);

-- users
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  plan text not null default 'free' check (plan in ('free', 'starter', 'pro')),
  onboarding_done boolean not null default false,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update
    set
      email = excluded.email,
      full_name = coalesce(excluded.full_name, public.users.full_name),
      avatar_url = coalesce(excluded.avatar_url, public.users.avatar_url);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_updated_at on public.users;
create trigger users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- connected_accounts
create table if not exists public.connected_accounts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (
    provider in ('gmail', 'google_calendar', 'whatsapp', 'telegram', 'slack')
  ),
  access_token text,
  refresh_token text,
  token_expiry timestamptz,
  account_email text,
  phone_number text,
  display_name text,
  is_active boolean not null default true,
  connected_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (user_id, provider)
);

create index if not exists idx_connected_accounts_user
  on public.connected_accounts (user_id);

-- agent_tasks
create table if not exists public.agent_tasks (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  task_type text not null check (task_type in (
    'morning_briefing',
    'draft_replies',
    'meeting_reminders',
    'email_search',
    'evening_summary',
    'custom_reminder'
  )),
  is_enabled boolean not null default true,
  schedule_time time,
  schedule_days text[],
  config jsonb not null default '{}'::jsonb,
  total_runs integer not null default 0,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, task_type)
);

create index if not exists idx_agent_tasks_user
  on public.agent_tasks (user_id);

create index if not exists idx_agent_tasks_enabled
  on public.agent_tasks (is_enabled)
  where is_enabled = true;

drop trigger if exists agent_tasks_updated_at on public.agent_tasks;
create trigger agent_tasks_updated_at
  before update on public.agent_tasks
  for each row execute function public.set_updated_at();

-- task_runs
create table if not exists public.task_runs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  task_id uuid not null references public.agent_tasks(id) on delete cascade,
  task_type text not null,
  status text not null default 'pending' check (
    status in ('pending', 'running', 'success', 'failed')
  ),
  input_data jsonb,
  output_data jsonb,
  error_message text,
  duration_ms integer,
  tokens_used integer,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_task_runs_user on public.task_runs (user_id);
create index if not exists idx_task_runs_task on public.task_runs (task_id);
create index if not exists idx_task_runs_started on public.task_runs (started_at desc);
create index if not exists idx_task_runs_status on public.task_runs (status);

-- whatsapp_messages
create table if not exists public.whatsapp_messages (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  content text not null,
  message_type text not null default 'text' check (
    message_type in ('text', 'briefing', 'draft', 'reminder', 'search_result')
  ),
  task_run_id uuid references public.task_runs(id),
  wa_message_id text,
  sent_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz
);

create index if not exists idx_wa_messages_user on public.whatsapp_messages (user_id);
create index if not exists idx_wa_messages_sent on public.whatsapp_messages (sent_at desc);

-- analytics_daily
create table if not exists public.analytics_daily (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  date date not null default current_date,
  emails_processed integer not null default 0,
  drafts_created integer not null default 0,
  tasks_run integer not null default 0,
  minutes_saved integer not null default 0,
  wa_messages_sent integer not null default 0,
  unique (user_id, date)
);

create index if not exists idx_analytics_user_date
  on public.analytics_daily (user_id, date desc);

-- subscriptions
create table if not exists public.subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade unique,
  plan text not null default 'free' check (plan in ('free', 'starter', 'pro')),
  status text not null default 'active' check (
    status in ('active', 'cancelled', 'past_due', 'trialing')
  ),
  razorpay_sub_id text unique,
  razorpay_customer_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists subscriptions_updated_at on public.subscriptions;
create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- RLS
alter table public.users enable row level security;
alter table public.connected_accounts enable row level security;
alter table public.agent_tasks enable row level security;
alter table public.task_runs enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.analytics_daily enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "Users: read own" on public.users;
create policy "Users: read own"
  on public.users for select
  using (auth.uid() = id);

drop policy if exists "Users: update own" on public.users;
create policy "Users: update own"
  on public.users for update
  using (auth.uid() = id);

drop policy if exists "Accounts: read own" on public.connected_accounts;
create policy "Accounts: read own"
  on public.connected_accounts for select
  using (auth.uid() = user_id);

drop policy if exists "Accounts: insert own" on public.connected_accounts;
create policy "Accounts: insert own"
  on public.connected_accounts for insert
  with check (auth.uid() = user_id);

drop policy if exists "Accounts: update own" on public.connected_accounts;
create policy "Accounts: update own"
  on public.connected_accounts for update
  using (auth.uid() = user_id);

drop policy if exists "Accounts: delete own" on public.connected_accounts;
create policy "Accounts: delete own"
  on public.connected_accounts for delete
  using (auth.uid() = user_id);

drop policy if exists "Tasks: read own" on public.agent_tasks;
create policy "Tasks: read own"
  on public.agent_tasks for select
  using (auth.uid() = user_id);

drop policy if exists "Tasks: insert own" on public.agent_tasks;
create policy "Tasks: insert own"
  on public.agent_tasks for insert
  with check (auth.uid() = user_id);

drop policy if exists "Tasks: update own" on public.agent_tasks;
create policy "Tasks: update own"
  on public.agent_tasks for update
  using (auth.uid() = user_id);

drop policy if exists "Tasks: delete own" on public.agent_tasks;
create policy "Tasks: delete own"
  on public.agent_tasks for delete
  using (auth.uid() = user_id);

drop policy if exists "Runs: read own" on public.task_runs;
create policy "Runs: read own"
  on public.task_runs for select
  using (auth.uid() = user_id);

drop policy if exists "WA: read own" on public.whatsapp_messages;
create policy "WA: read own"
  on public.whatsapp_messages for select
  using (auth.uid() = user_id);

drop policy if exists "Analytics: read own" on public.analytics_daily;
create policy "Analytics: read own"
  on public.analytics_daily for select
  using (auth.uid() = user_id);

drop policy if exists "Subs: read own" on public.subscriptions;
create policy "Subs: read own"
  on public.subscriptions for select
  using (auth.uid() = user_id);

drop policy if exists "Subs: update own" on public.subscriptions;
create policy "Subs: update own"
  on public.subscriptions for update
  using (auth.uid() = user_id);

-- Helper functions
create or replace function public.seed_default_tasks(p_user_id uuid)
returns void as $$
begin
  insert into public.agent_tasks (
    user_id,
    task_type,
    is_enabled,
    schedule_time,
    schedule_days,
    config
  )
  values
    (p_user_id, 'morning_briefing',  true,  '07:00', array['mon','tue','wed','thu','fri','sat','sun'], '{"max_emails":50,"tone":"concise"}'),
    (p_user_id, 'draft_replies',     true,  null,    null,                                             '{"tone":"professional","auto_send":false}'),
    (p_user_id, 'meeting_reminders', true,  null,    null,                                             '{"minutes_before":30,"include_context":true}'),
    (p_user_id, 'email_search',      false, null,    null,                                             '{}'::jsonb),
    (p_user_id, 'evening_summary',   false, '21:00', array['mon','tue','wed','thu','fri'],            '{}'::jsonb),
    (p_user_id, 'custom_reminder',   false, null,    null,                                             '{}'::jsonb)
  on conflict (user_id, task_type) do nothing;
end;
$$ language plpgsql security definer;

create or replace function public.increment_analytics(
  p_user_id uuid,
  p_field text,
  p_amount integer
)
returns void as $$
begin
  insert into public.analytics_daily (user_id, date)
  values (p_user_id, current_date)
  on conflict (user_id, date) do nothing;

  if p_field = 'emails_processed' then
    update public.analytics_daily
    set emails_processed = emails_processed + coalesce(p_amount, 0)
    where user_id = p_user_id and date = current_date;
  elsif p_field = 'drafts_created' then
    update public.analytics_daily
    set drafts_created = drafts_created + coalesce(p_amount, 0)
    where user_id = p_user_id and date = current_date;
  elsif p_field = 'tasks_run' then
    update public.analytics_daily
    set tasks_run = tasks_run + coalesce(p_amount, 0)
    where user_id = p_user_id and date = current_date;
  elsif p_field = 'minutes_saved' then
    update public.analytics_daily
    set minutes_saved = minutes_saved + coalesce(p_amount, 0)
    where user_id = p_user_id and date = current_date;
  elsif p_field = 'wa_messages_sent' then
    update public.analytics_daily
    set wa_messages_sent = wa_messages_sent + coalesce(p_amount, 0)
    where user_id = p_user_id and date = current_date;
  end if;
end;
$$ language plpgsql security definer;

create or replace view public.user_dashboard_summary as
select
  u.id as user_id,
  u.plan,
  coalesce(ca.connected_accounts, 0) as connected_accounts,
  coalesce(at.active_tasks, 0) as active_tasks,
  coalesce(at.total_runs, 0) as total_runs,
  tr.last_run_at,
  coalesce(ad.emails_processed, 0) as emails_today,
  coalesce(ad.drafts_created, 0) as drafts_today,
  coalesce(ad.minutes_saved, 0) as minutes_saved_today
from public.users u
left join (
  select user_id, count(*) filter (where is_active) as connected_accounts
  from public.connected_accounts
  group by user_id
) ca on ca.user_id = u.id
left join (
  select
    user_id,
    count(*) filter (where is_enabled) as active_tasks,
    coalesce(sum(total_runs), 0) as total_runs
  from public.agent_tasks
  group by user_id
) at on at.user_id = u.id
left join (
  select user_id, max(started_at) as last_run_at
  from public.task_runs
  group by user_id
) tr on tr.user_id = u.id
left join public.analytics_daily ad
  on ad.user_id = u.id and ad.date = current_date;


-- =============================================================================
-- MIGRATION 2: GLOBAL FEATURES
-- =============================================================================

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
  on public.user_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users see own reply approvals" on public.reply_approvals;
create policy "Users see own reply approvals"
  on public.reply_approvals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Service role bypass preferences" on public.user_preferences;
create policy "Service role bypass preferences"
  on public.user_preferences for all to service_role
  using (true)
  with check (true);

drop policy if exists "Service role bypass reply_approvals" on public.reply_approvals;
create policy "Service role bypass reply_approvals"
  on public.reply_approvals for all to service_role
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


-- =============================================================================
-- MIGRATION 3: PAYMENTS
-- =============================================================================

alter table public.subscriptions
  add column if not exists stripe_sub_id text unique,
  add column if not exists stripe_customer_id text;

drop policy if exists "Service role bypass subs" on public.subscriptions;
create policy "Service role bypass subs"
  on public.subscriptions for all to service_role
  using (true)
  with check (true);

create or replace function public.seed_default_tasks(p_user_id uuid)
returns void as $$
begin
  insert into public.agent_tasks (
    user_id,
    task_type,
    is_enabled,
    schedule_time,
    schedule_days,
    config
  )
  values
    (p_user_id, 'morning_briefing',  true,  '07:00', array['mon','tue','wed','thu','fri','sat','sun'], '{"max_emails":50,"tone":"concise"}'),
    (p_user_id, 'draft_replies',     true,  null,    null,                                             '{"tone":"professional","auto_send":false}'),
    (p_user_id, 'meeting_reminders', true,  null,    null,                                             '{"minutes_before":30,"include_context":true}'),
    (p_user_id, 'email_search',      false, null,    null,                                             '{}'::jsonb),
    (p_user_id, 'evening_summary',   false, '21:00', array['mon','tue','wed','thu','fri'],            '{}'::jsonb),
    (p_user_id, 'custom_reminder',   false, null,    null,                                             '{}'::jsonb),
    (p_user_id, 'weekly_spend',      false, '09:00', array['sun'],                                     '{}'::jsonb)
  on conflict (user_id, task_type) do nothing;
end;
$$ language plpgsql security definer;


-- =============================================================================
-- MIGRATION 4: SCHEDULER
-- =============================================================================

create table if not exists public.cron_log (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.agent_tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  minute_bucket timestamptz not null,
  fired_at timestamptz not null default now(),
  unique (task_id, minute_bucket)
);

create index if not exists idx_cron_log_task_minute
  on public.cron_log (task_id, minute_bucket);

create index if not exists idx_cron_log_fired_at
  on public.cron_log (fired_at);

create table if not exists public.meeting_reminder_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  event_id text not null,
  reminded_at timestamptz not null default now(),
  unique (user_id, event_id)
);

create index if not exists idx_meeting_reminder_log_user
  on public.meeting_reminder_log (user_id, reminded_at desc);

create index if not exists idx_meeting_reminder_log_reminded_at
  on public.meeting_reminder_log (reminded_at);

create table if not exists public.cron_health (
  id integer primary key default 1,
  last_run_at timestamptz not null default now(),
  last_fired integer not null default 0,
  last_errors integer not null default 0,
  total_runs bigint not null default 0
);

insert into public.cron_health (id, last_run_at, last_fired, last_errors, total_runs)
values (1, now(), 0, 0, 0)
on conflict (id) do nothing;

alter table public.cron_log enable row level security;
alter table public.meeting_reminder_log enable row level security;
alter table public.cron_health enable row level security;

drop policy if exists "cron_log: service role only" on public.cron_log;
create policy "cron_log: service role only"
  on public.cron_log for all to service_role
  using (true)
  with check (true);

drop policy if exists "meeting_reminder_log: service role only" on public.meeting_reminder_log;
create policy "meeting_reminder_log: service role only"
  on public.meeting_reminder_log for all to service_role
  using (true)
  with check (true);

drop policy if exists "cron_health: service role only" on public.cron_health;
create policy "cron_health: service role only"
  on public.cron_health for all to service_role
  using (true)
  with check (true);

create or replace function public.cleanup_cron_logs()
returns void as $$
begin
  delete from public.cron_log
  where fired_at < now() - interval '48 hours';

  delete from public.meeting_reminder_log
  where reminded_at < now() - interval '25 hours';
end;
$$ language plpgsql security definer;


-- =============================================================================
-- MIGRATION 5: SCHEDULER RPC
-- =============================================================================

create or replace function public.increment_cron_health_total_runs()
returns void as $$
begin
  update public.cron_health
  set total_runs = total_runs + 1
  where id = 1;
end;
$$ language plpgsql security definer;


-- =============================================================================
-- DONE
-- Tables expected after this migration:
--   users
--   connected_accounts
--   agent_tasks
--   task_runs
--   whatsapp_messages
--   analytics_daily
--   subscriptions
--   user_preferences
--   reply_approvals
--   chat_threads
--   research_runs
--   cron_log
--   meeting_reminder_log
--   cron_health
-- =============================================================================
