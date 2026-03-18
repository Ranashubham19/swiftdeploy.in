-- Phase 3: persistent user memory and profile personalization.
-- Run this in the Supabase SQL Editor.

create table if not exists public.user_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  key text not null,
  value text not null,
  source text not null default 'extracted'
    check (source in ('explicit', 'extracted', 'inferred')),
  confidence numeric not null default 1.0
    check (confidence between 0 and 1),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, key)
);

create index if not exists idx_user_memory_user_id
  on public.user_memory (user_id);

create index if not exists idx_user_memory_user_key
  on public.user_memory (user_id, key);

drop trigger if exists user_memory_updated_at on public.user_memory;
create trigger user_memory_updated_at
  before update on public.user_memory
  for each row execute function public.set_updated_at();

alter table public.user_memory enable row level security;

drop policy if exists "Memory: read own" on public.user_memory;
drop policy if exists "Memory: insert own" on public.user_memory;
drop policy if exists "Memory: update own" on public.user_memory;
drop policy if exists "Memory: delete own" on public.user_memory;
drop policy if exists "Memory: service role bypass" on public.user_memory;

create policy "Memory: read own"
  on public.user_memory for select
  using (auth.uid() = user_id);

create policy "Memory: insert own"
  on public.user_memory for insert
  with check (auth.uid() = user_id);

create policy "Memory: update own"
  on public.user_memory for update
  using (auth.uid() = user_id);

create policy "Memory: delete own"
  on public.user_memory for delete
  using (auth.uid() = user_id);

create policy "Memory: service role bypass"
  on public.user_memory for all to service_role
  using (true)
  with check (true);

insert into public.user_memory (user_id, key, value, source, confidence)
select
  up.user_id,
  'language_preference',
  up.language,
  'inferred',
  0.8
from public.user_preferences up
where up.language is not null
  and up.language <> 'en'
on conflict (user_id, key) do nothing;

insert into public.user_memory (user_id, key, value, source, confidence)
select
  u.id,
  'timezone',
  u.timezone,
  'inferred',
  0.9
from public.users u
where u.timezone is not null
  and u.timezone <> 'UTC'
  and u.timezone <> 'Asia/Kolkata'
on conflict (user_id, key) do nothing;
