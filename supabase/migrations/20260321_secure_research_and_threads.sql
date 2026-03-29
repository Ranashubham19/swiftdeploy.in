alter table public.chat_threads enable row level security;
alter table public.research_runs enable row level security;

alter table public.research_runs
  add column if not exists search_diagnostics jsonb;

alter table public.research_runs
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create index if not exists research_runs_user_id_created_at_idx
  on public.research_runs (user_id, created_at desc);

drop policy if exists "Allow anon read chat threads" on public.chat_threads;
drop policy if exists "Allow anon upsert chat threads" on public.chat_threads;
drop policy if exists "Allow anon update chat threads" on public.chat_threads;
drop policy if exists "Allow anon insert research runs" on public.research_runs;

drop policy if exists "Users can read own chat threads" on public.chat_threads;
create policy "Users can read own chat threads"
  on public.chat_threads
  for select
  to authenticated
  using (auth.uid()::text = user_id);

drop policy if exists "Users can insert own chat threads" on public.chat_threads;
create policy "Users can insert own chat threads"
  on public.chat_threads
  for insert
  to authenticated
  with check (auth.uid()::text = user_id);

drop policy if exists "Users can update own chat threads" on public.chat_threads;
create policy "Users can update own chat threads"
  on public.chat_threads
  for update
  to authenticated
  using (auth.uid()::text = user_id)
  with check (auth.uid()::text = user_id);

drop policy if exists "Users can read own research runs" on public.research_runs;
create policy "Users can read own research runs"
  on public.research_runs
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own research runs" on public.research_runs;
create policy "Users can insert own research runs"
  on public.research_runs
  for insert
  to authenticated
  with check (auth.uid() = user_id);
