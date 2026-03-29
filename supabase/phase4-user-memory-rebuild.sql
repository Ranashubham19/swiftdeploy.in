-- Phase 4: layered user memory with explicit audit metadata.
-- Run this after the Phase 3 user memory migration.

alter table public.user_memory
  add column if not exists scope text not null default 'profile'
    check (scope in ('profile', 'derived_preference'));

alter table public.user_memory
  add column if not exists confirmed boolean not null default false;

alter table public.user_memory
  add column if not exists created_by text;

alter table public.user_memory
  add column if not exists why_saved text;

alter table public.user_memory
  add column if not exists expires_at timestamptz;

update public.user_memory
set
  scope = case when source = 'explicit' then 'profile' else 'derived_preference' end,
  confirmed = case when source = 'explicit' then true else false end,
  created_by = coalesce(
    created_by,
    case
      when source = 'explicit' then 'legacy'
      when source = 'inferred' then 'legacy'
      else 'legacy'
    end
  ),
  why_saved = coalesce(
    why_saved,
    case
      when source = 'explicit' then 'Saved from an earlier explicit user profile or preference action.'
      when source = 'inferred' then 'Suggested from an earlier inferred preference before the Phase 4 memory rebuild.'
      else 'Suggested from an earlier extracted self-description before the Phase 4 memory rebuild.'
    end
  );

create index if not exists idx_user_memory_user_scope
  on public.user_memory (user_id, scope);

create index if not exists idx_user_memory_expires_at
  on public.user_memory (expires_at);
