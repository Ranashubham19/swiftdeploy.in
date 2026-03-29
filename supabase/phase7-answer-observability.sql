create table if not exists public.intent_analytics_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  date date not null default current_date,
  intent text not null,
  count integer not null default 0,
  avg_latency_ms integer not null default 0,
  fallback_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date, intent)
);

create index if not exists idx_intent_analytics_user_date
  on public.intent_analytics_daily (user_id, date desc);

create index if not exists idx_intent_analytics_user_intent_date
  on public.intent_analytics_daily (user_id, intent, date desc);

drop trigger if exists intent_analytics_daily_updated_at on public.intent_analytics_daily;
create trigger intent_analytics_daily_updated_at
  before update on public.intent_analytics_daily
  for each row execute function public.set_updated_at();

create table if not exists public.answer_observability_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  input_kind text not null default 'api_inbound_message',
  question_preview text,
  response_preview text,
  intent text not null default 'general',
  category text not null default 'general',
  response_state text not null default 'answered'
    check (response_state in ('answered', 'refused', 'consent_prompt', 'failed')),
  latency_ms integer,
  char_count integer not null default 0,
  had_visible_fallback boolean not null default false,
  live_answer boolean not null default false,
  live_evidence_count integer not null default 0,
  live_source_count integer not null default 0,
  live_strategy text,
  model_audited boolean not null default false,
  selected_by text,
  selected_model text,
  judge_used boolean not null default false,
  material_disagreement boolean not null default false,
  needs_clarification boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_answer_observability_user_created
  on public.answer_observability_events (user_id, created_at desc);

create index if not exists idx_answer_observability_user_state_created
  on public.answer_observability_events (user_id, response_state, created_at desc);

create index if not exists idx_answer_observability_user_intent_created
  on public.answer_observability_events (user_id, intent, created_at desc);

alter table public.intent_analytics_daily enable row level security;
alter table public.answer_observability_events enable row level security;

drop policy if exists "Intent analytics: read own" on public.intent_analytics_daily;
create policy "Intent analytics: read own"
  on public.intent_analytics_daily
  for select
  using (auth.uid() = user_id);

drop policy if exists "Intent analytics: service role bypass" on public.intent_analytics_daily;
create policy "Intent analytics: service role bypass"
  on public.intent_analytics_daily
  for all to service_role
  using (true)
  with check (true);

drop policy if exists "Answer observability: read own" on public.answer_observability_events;
create policy "Answer observability: read own"
  on public.answer_observability_events
  for select
  using (auth.uid() = user_id);

drop policy if exists "Answer observability: service role bypass" on public.answer_observability_events;
create policy "Answer observability: service role bypass"
  on public.answer_observability_events
  for all to service_role
  using (true)
  with check (true);
