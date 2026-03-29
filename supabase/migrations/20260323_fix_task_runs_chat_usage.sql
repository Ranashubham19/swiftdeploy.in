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
