create table if not exists public.custom_commands (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  command text not null,
  prompt text not null,
  description text,
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, command)
);

create index if not exists idx_custom_commands_user
  on public.custom_commands (user_id, command);

alter table public.custom_commands enable row level security;

drop policy if exists "Custom commands: read own" on public.custom_commands;
create policy "Custom commands: read own"
  on public.custom_commands
  for select
  using (auth.uid() = user_id);

drop policy if exists "Custom commands: insert own" on public.custom_commands;
create policy "Custom commands: insert own"
  on public.custom_commands
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Custom commands: update own" on public.custom_commands;
create policy "Custom commands: update own"
  on public.custom_commands
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Custom commands: delete own" on public.custom_commands;
create policy "Custom commands: delete own"
  on public.custom_commands
  for delete
  using (auth.uid() = user_id);
