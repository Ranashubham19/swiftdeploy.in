alter table public.whatsapp_reply_approvals
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.whatsapp_automation_workflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  workflow_type text not null
    check (workflow_type in (
      'missed_reply_follow_up',
      'payment_follow_up',
      'meeting_confirmation',
      'lead_nurture',
      'group_digest'
    )),
  title text not null,
  description text,
  is_enabled boolean not null default false,
  approval_required boolean not null default true,
  delay_minutes integer not null default 120 check (delay_minutes between 5 and 10080),
  scope text not null default 'direct'
    check (scope in ('direct', 'group', 'all')),
  trigger_keywords text[] not null default '{}'::text[],
  template text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, workflow_type)
);

create table if not exists public.whatsapp_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  workflow_id uuid references public.whatsapp_automation_workflows(id) on delete set null,
  workflow_type text not null
    check (workflow_type in (
      'missed_reply_follow_up',
      'payment_follow_up',
      'meeting_confirmation',
      'lead_nurture',
      'group_digest'
    )),
  remote_jid text,
  remote_phone text,
  contact_name text,
  source_message text,
  suggested_reply text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'pending_approval', 'sent', 'skipped', 'cancelled')),
  approval_state text not null default 'not_required'
    check (approval_state in ('not_required', 'pending', 'approved', 'skipped', 'blocked')),
  due_at timestamptz,
  sent_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_automation_workflows_user_type
  on public.whatsapp_automation_workflows (user_id, workflow_type);

create index if not exists idx_whatsapp_workflow_runs_due
  on public.whatsapp_workflow_runs (user_id, status, due_at);

create index if not exists idx_whatsapp_workflow_runs_target
  on public.whatsapp_workflow_runs (user_id, remote_jid, workflow_type, created_at desc);

drop trigger if exists whatsapp_automation_workflows_updated_at on public.whatsapp_automation_workflows;
create trigger whatsapp_automation_workflows_updated_at
  before update on public.whatsapp_automation_workflows
  for each row execute function public.set_updated_at();

drop trigger if exists whatsapp_workflow_runs_updated_at on public.whatsapp_workflow_runs;
create trigger whatsapp_workflow_runs_updated_at
  before update on public.whatsapp_workflow_runs
  for each row execute function public.set_updated_at();

alter table public.whatsapp_automation_workflows enable row level security;
alter table public.whatsapp_workflow_runs enable row level security;

drop policy if exists "Users manage own WhatsApp workflows" on public.whatsapp_automation_workflows;
create policy "Users manage own WhatsApp workflows"
  on public.whatsapp_automation_workflows for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Service role bypass WhatsApp workflows" on public.whatsapp_automation_workflows;
create policy "Service role bypass WhatsApp workflows"
  on public.whatsapp_automation_workflows for all to service_role
  using (true)
  with check (true);

drop policy if exists "Users manage own WhatsApp workflow runs" on public.whatsapp_workflow_runs;
create policy "Users manage own WhatsApp workflow runs"
  on public.whatsapp_workflow_runs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Service role bypass WhatsApp workflow runs" on public.whatsapp_workflow_runs;
create policy "Service role bypass WhatsApp workflow runs"
  on public.whatsapp_workflow_runs for all to service_role
  using (true)
  with check (true);
