create table if not exists public.app_access_consents (
  user_id uuid primary key references public.users(id) on delete cascade,
  request jsonb not null default '{}'::jsonb,
  original_message text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_app_access_consents_expires_at
  on public.app_access_consents (expires_at desc);

drop trigger if exists app_access_consents_updated_at on public.app_access_consents;
create trigger app_access_consents_updated_at
  before update on public.app_access_consents
  for each row execute function public.set_updated_at();

alter table public.app_access_consents enable row level security;

drop policy if exists "App access consents: read own" on public.app_access_consents;
create policy "App access consents: read own"
  on public.app_access_consents
  for select
  using (auth.uid() = user_id);

drop policy if exists "App access consents: insert own" on public.app_access_consents;
create policy "App access consents: insert own"
  on public.app_access_consents
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "App access consents: update own" on public.app_access_consents;
create policy "App access consents: update own"
  on public.app_access_consents
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "App access consents: delete own" on public.app_access_consents;
create policy "App access consents: delete own"
  on public.app_access_consents
  for delete
  using (auth.uid() = user_id);
