create table if not exists public.billing_webhook_events (
  id uuid primary key default uuid_generate_v4(),
  provider text not null check (provider in ('stripe', 'razorpay')),
  external_event_id text not null,
  event_type text not null,
  user_id uuid references public.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  signature_verified boolean not null default false,
  attempts integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  processed_at timestamptz,
  failure_reason text,
  updated_at timestamptz not null default now(),
  unique (provider, external_event_id)
);

create index if not exists idx_billing_webhook_events_provider_status_last_seen
  on public.billing_webhook_events (provider, status, last_seen_at desc);

create index if not exists idx_billing_webhook_events_user_last_seen
  on public.billing_webhook_events (user_id, last_seen_at desc);

drop trigger if exists billing_webhook_events_updated_at on public.billing_webhook_events;
create trigger billing_webhook_events_updated_at
  before update on public.billing_webhook_events
  for each row execute function public.set_updated_at();

alter table public.billing_webhook_events enable row level security;

drop policy if exists "billing_webhook_events: service role only" on public.billing_webhook_events;
create policy "billing_webhook_events: service role only"
  on public.billing_webhook_events
  for all to service_role
  using (true)
  with check (true);
