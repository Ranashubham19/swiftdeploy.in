create table if not exists public.meeting_reminder_log (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  event_id text not null,
  reminded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, event_id)
);

create index if not exists idx_meeting_reminder_log_user
  on public.meeting_reminder_log (user_id);

create index if not exists idx_meeting_reminder_log_reminded_at
  on public.meeting_reminder_log (reminded_at desc);

alter table public.meeting_reminder_log enable row level security;

drop policy if exists "Meeting reminders: read own" on public.meeting_reminder_log;
create policy "Meeting reminders: read own"
  on public.meeting_reminder_log
  for select
  using (auth.uid() = user_id);
