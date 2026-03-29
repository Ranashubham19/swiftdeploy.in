create table if not exists public.whatsapp_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source text not null
    check (source in ('approval', 'workflow', 'direct_command', 'assistant_reply', 'system', 'api_send')),
  approval_id uuid references public.whatsapp_reply_approvals(id) on delete set null,
  workflow_run_id uuid references public.whatsapp_workflow_runs(id) on delete set null,
  remote_jid text,
  remote_phone text,
  contact_name text,
  message_text text not null,
  idempotency_key text not null,
  status text not null default 'drafted'
    check (status in ('drafted', 'queued', 'approval_required', 'approved', 'retrying', 'sent', 'delivered', 'read', 'failed', 'skipped', 'cancelled')),
  attempt_count integer not null default 0,
  wa_message_ids text[] not null default '{}'::text[],
  queued_at timestamptz not null default now(),
  approved_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists idx_whatsapp_outbound_messages_user_status_created
  on public.whatsapp_outbound_messages (user_id, status, created_at desc);

create index if not exists idx_whatsapp_outbound_messages_approval
  on public.whatsapp_outbound_messages (approval_id);

create index if not exists idx_whatsapp_outbound_messages_workflow_run
  on public.whatsapp_outbound_messages (workflow_run_id);

create index if not exists idx_whatsapp_outbound_messages_queued
  on public.whatsapp_outbound_messages (user_id, queued_at desc);

create index if not exists idx_whatsapp_outbound_messages_wa_message_ids
  on public.whatsapp_outbound_messages using gin (wa_message_ids);

drop trigger if exists whatsapp_outbound_messages_updated_at on public.whatsapp_outbound_messages;
create trigger whatsapp_outbound_messages_updated_at
  before update on public.whatsapp_outbound_messages
  for each row execute function public.set_updated_at();

alter table public.whatsapp_outbound_messages enable row level security;

drop policy if exists "Users read own WhatsApp outbound messages" on public.whatsapp_outbound_messages;
create policy "Users read own WhatsApp outbound messages"
  on public.whatsapp_outbound_messages for select
  using (auth.uid() = user_id);

drop policy if exists "Users manage own WhatsApp outbound messages" on public.whatsapp_outbound_messages;
create policy "Users manage own WhatsApp outbound messages"
  on public.whatsapp_outbound_messages for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Service role bypass WhatsApp outbound messages" on public.whatsapp_outbound_messages;
create policy "Service role bypass WhatsApp outbound messages"
  on public.whatsapp_outbound_messages for all to service_role
  using (true)
  with check (true);
