create table if not exists public.global_lite_connections (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('gmail', 'google_calendar', 'google_drive')),
  mode text not null check (mode in ('gmail_capture', 'calendar_ics', 'drive_uploads')),
  label text,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists idx_global_lite_connections_user_provider
  on public.global_lite_connections (user_id, provider);

drop trigger if exists global_lite_connections_updated_at on public.global_lite_connections;
create trigger global_lite_connections_updated_at
  before update on public.global_lite_connections
  for each row execute function public.set_updated_at();

alter table public.global_lite_connections enable row level security;

drop policy if exists "Global Lite: read own" on public.global_lite_connections;
create policy "Global Lite: read own"
  on public.global_lite_connections
  for select
  using (auth.uid() = user_id);

drop policy if exists "Global Lite: insert own" on public.global_lite_connections;
create policy "Global Lite: insert own"
  on public.global_lite_connections
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Global Lite: update own" on public.global_lite_connections;
create policy "Global Lite: update own"
  on public.global_lite_connections
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Global Lite: delete own" on public.global_lite_connections;
create policy "Global Lite: delete own"
  on public.global_lite_connections
  for delete
  using (auth.uid() = user_id);
