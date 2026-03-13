-- ClawCloud Step 8 migration: cron dedup + scheduler health
-- Run in your Supabase SQL editor

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
  using (true) with check (true);

drop policy if exists "meeting_reminder_log: service role only" on public.meeting_reminder_log;
create policy "meeting_reminder_log: service role only"
  on public.meeting_reminder_log for all to service_role
  using (true) with check (true);

drop policy if exists "cron_health: service role only" on public.cron_health;
create policy "cron_health: service role only"
  on public.cron_health for all to service_role
  using (true) with check (true);

create or replace function public.cleanup_cron_logs()
returns void as $$
begin
  delete from public.cron_log
  where fired_at < now() - interval '48 hours';

  delete from public.meeting_reminder_log
  where reminded_at < now() - interval '25 hours';
end;
$$ language plpgsql security definer;
