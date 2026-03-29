create table if not exists public.dashboard_journal_threads (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  thread_key text not null,
  date_key date not null,
  title text not null,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, thread_key)
);

create index if not exists idx_dashboard_journal_threads_user_date
  on public.dashboard_journal_threads (user_id, date_key desc);

drop trigger if exists dashboard_journal_threads_updated_at on public.dashboard_journal_threads;
create trigger dashboard_journal_threads_updated_at
  before update on public.dashboard_journal_threads
  for each row execute function public.set_updated_at();

alter table public.dashboard_journal_threads enable row level security;

drop policy if exists "Dashboard journal: read own" on public.dashboard_journal_threads;
create policy "Dashboard journal: read own"
  on public.dashboard_journal_threads
  for select
  using (auth.uid() = user_id);

drop policy if exists "Dashboard journal: insert own" on public.dashboard_journal_threads;
create policy "Dashboard journal: insert own"
  on public.dashboard_journal_threads
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Dashboard journal: update own" on public.dashboard_journal_threads;
create policy "Dashboard journal: update own"
  on public.dashboard_journal_threads
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Dashboard journal: delete own" on public.dashboard_journal_threads;
create policy "Dashboard journal: delete own"
  on public.dashboard_journal_threads
  for delete
  using (auth.uid() = user_id);
