alter table public.task_runs
  alter column task_id drop not null;

alter table public.task_runs
  add column if not exists intent_type text null,
  add column if not exists model_used text null,
  add column if not exists latency_ms integer null,
  add column if not exists had_fallback boolean not null default false,
  add column if not exists char_count integer null;

create index if not exists idx_task_runs_intent_type
  on public.task_runs (intent_type);

create index if not exists idx_task_runs_latency_ms
  on public.task_runs (latency_ms);

create table if not exists public.intent_analytics_daily (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  date date not null default current_date,
  intent text not null,
  count integer not null default 1,
  avg_latency_ms integer not null default 0,
  fallback_count integer not null default 0,
  unique (user_id, date, intent)
);

create index if not exists idx_intent_analytics_daily_user_date
  on public.intent_analytics_daily (user_id, date desc);

alter table public.intent_analytics_daily enable row level security;

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

create table if not exists public.delivery_failures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  jid text not null,
  message_excerpt text null,
  error_message text null,
  retry_count integer not null default 0,
  final_status text not null default 'failed'
    check (final_status in ('delivered', 'failed', 'retrying')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz null
);

create index if not exists idx_delivery_failures_user_created
  on public.delivery_failures (user_id, created_at desc);

create index if not exists idx_delivery_failures_status
  on public.delivery_failures (final_status);

alter table public.delivery_failures enable row level security;

drop policy if exists "Delivery failures: service role bypass" on public.delivery_failures;
create policy "Delivery failures: service role bypass"
  on public.delivery_failures
  for all to service_role
  using (true)
  with check (true);
