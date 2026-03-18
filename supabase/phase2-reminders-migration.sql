-- Phase 2 reminder system migration.
-- Run this in Supabase SQL Editor before deploying the code changes.

create table if not exists public.user_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  reminder_text text not null,
  fire_at timestamptz not null,
  recur_rule text null check (recur_rule in ('daily', 'weekdays', 'weekends', 'weekly', 'monthly')),
  is_active boolean not null default true,
  fired_at timestamptz null,
  source_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_reminders_due
  on public.user_reminders (fire_at)
  where is_active = true;

create index if not exists idx_user_reminders_user
  on public.user_reminders (user_id, is_active, fire_at);

create index if not exists idx_user_reminders_fired
  on public.user_reminders (user_id, fired_at desc)
  where fired_at is not null;

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists user_reminders_updated_at on public.user_reminders;
create trigger user_reminders_updated_at
  before update on public.user_reminders
  for each row execute function public.set_updated_at();

alter table public.user_reminders enable row level security;

drop policy if exists "Reminders: read own" on public.user_reminders;
create policy "Reminders: read own"
  on public.user_reminders for select
  using (auth.uid() = user_id);

drop policy if exists "Reminders: insert own" on public.user_reminders;
create policy "Reminders: insert own"
  on public.user_reminders for insert
  with check (auth.uid() = user_id);

drop policy if exists "Reminders: update own" on public.user_reminders;
create policy "Reminders: update own"
  on public.user_reminders for update
  using (auth.uid() = user_id);

drop policy if exists "Reminders: delete own" on public.user_reminders;
create policy "Reminders: delete own"
  on public.user_reminders for delete
  using (auth.uid() = user_id);

drop policy if exists "Reminders: service role bypass" on public.user_reminders;
create policy "Reminders: service role bypass"
  on public.user_reminders for all to service_role
  using (true)
  with check (true);

alter table public.cron_log
  add column if not exists reminder_id uuid references public.user_reminders(id) on delete cascade;

alter table public.cron_log
  alter column task_id drop not null;

alter table public.cron_log
  drop constraint if exists cron_log_task_id_minute_bucket_key;

drop index if exists idx_cron_log_task_minute_unique;
create unique index if not exists idx_cron_log_task_minute_unique
  on public.cron_log (task_id, minute_bucket)
  where task_id is not null and reminder_id is null;

drop index if exists idx_cron_log_reminder_minute_unique;
create unique index if not exists idx_cron_log_reminder_minute_unique
  on public.cron_log (reminder_id, minute_bucket)
  where reminder_id is not null;

create index if not exists idx_cron_log_reminder_minute
  on public.cron_log (reminder_id, minute_bucket)
  where reminder_id is not null;

do $$
declare
  task_row record;
  fire_at_val text;
  reminder_text_val text;
  already_exists integer;
begin
  for task_row in
    select id, user_id, config
    from public.agent_tasks
    where task_type = 'custom_reminder'
      and config->>'fire_at' is not null
  loop
    fire_at_val := task_row.config->>'fire_at';
    reminder_text_val := coalesce(task_row.config->>'reminder_text', 'Reminder');

    if fire_at_val::timestamptz < now() then
      continue;
    end if;

    select count(*) into already_exists
    from public.user_reminders
    where user_id = task_row.user_id
      and fire_at = fire_at_val::timestamptz
      and reminder_text = reminder_text_val;

    if already_exists > 0 then
      continue;
    end if;

    insert into public.user_reminders (
      user_id,
      reminder_text,
      fire_at,
      recur_rule,
      is_active,
      source_message
    )
    values (
      task_row.user_id,
      reminder_text_val,
      fire_at_val::timestamptz,
      null,
      true,
      task_row.config->>'source_message'
    );
  end loop;
end;
$$;
