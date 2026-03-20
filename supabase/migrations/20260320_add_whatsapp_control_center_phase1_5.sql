alter table public.user_preferences
  add column if not exists whatsapp_settings jsonb not null default '{
    "automation_mode":"auto_reply",
    "reply_mode":"balanced",
    "group_reply_mode":"mention_only",
    "require_approval_for_sensitive":true,
    "allow_group_replies":true,
    "allow_direct_send_commands":true,
    "quiet_hours_start":null,
    "quiet_hours_end":null
  }'::jsonb;

alter table public.whatsapp_contacts
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists priority text not null default 'normal';

alter table public.whatsapp_contacts
  drop constraint if exists whatsapp_contacts_priority_check;

alter table public.whatsapp_contacts
  add constraint whatsapp_contacts_priority_check
  check (priority in ('low', 'normal', 'high', 'vip'));

alter table public.whatsapp_messages
  add column if not exists priority text not null default 'normal',
  add column if not exists needs_reply boolean not null default false,
  add column if not exists reply_confidence double precision,
  add column if not exists sensitivity text not null default 'normal',
  add column if not exists approval_state text not null default 'not_required',
  add column if not exists audit_payload jsonb not null default '{}'::jsonb;

alter table public.whatsapp_messages
  drop constraint if exists whatsapp_messages_priority_check;

alter table public.whatsapp_messages
  add constraint whatsapp_messages_priority_check
  check (priority in ('low', 'normal', 'high', 'vip'));

alter table public.whatsapp_messages
  drop constraint if exists whatsapp_messages_sensitivity_check;

alter table public.whatsapp_messages
  add constraint whatsapp_messages_sensitivity_check
  check (sensitivity in ('normal', 'sensitive', 'critical'));

alter table public.whatsapp_messages
  drop constraint if exists whatsapp_messages_approval_state_check;

alter table public.whatsapp_messages
  add constraint whatsapp_messages_approval_state_check
  check (approval_state in ('not_required', 'pending', 'approved', 'skipped', 'blocked'));

create table if not exists public.whatsapp_reply_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  remote_jid text,
  remote_phone text,
  contact_name text,
  source_message text not null,
  draft_reply text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'skipped', 'edited')),
  sensitivity text not null default 'normal'
    check (sensitivity in ('normal', 'sensitive', 'critical')),
  confidence double precision,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_reply_approvals_user_status
  on public.whatsapp_reply_approvals (user_id, status, created_at desc);

drop trigger if exists whatsapp_reply_approvals_updated_at on public.whatsapp_reply_approvals;
create trigger whatsapp_reply_approvals_updated_at
  before update on public.whatsapp_reply_approvals
  for each row execute function public.set_updated_at();

create table if not exists public.whatsapp_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  event_type text not null,
  actor text not null,
  target_type text not null default 'chat',
  target_value text,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_audit_log_user_created
  on public.whatsapp_audit_log (user_id, created_at desc);

alter table public.whatsapp_reply_approvals enable row level security;
alter table public.whatsapp_audit_log enable row level security;

drop policy if exists "Users manage own WhatsApp approvals" on public.whatsapp_reply_approvals;
create policy "Users manage own WhatsApp approvals"
  on public.whatsapp_reply_approvals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Service role bypass WhatsApp approvals" on public.whatsapp_reply_approvals;
create policy "Service role bypass WhatsApp approvals"
  on public.whatsapp_reply_approvals for all to service_role
  using (true)
  with check (true);

drop policy if exists "Users read own WhatsApp audit" on public.whatsapp_audit_log;
create policy "Users read own WhatsApp audit"
  on public.whatsapp_audit_log for select
  using (auth.uid() = user_id);

drop policy if exists "Service role bypass WhatsApp audit" on public.whatsapp_audit_log;
create policy "Service role bypass WhatsApp audit"
  on public.whatsapp_audit_log for all to service_role
  using (true)
  with check (true);
