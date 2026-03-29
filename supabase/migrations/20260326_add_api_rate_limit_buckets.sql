-- Phase 5: shared API rate limiting for multi-instance deployments.

create table if not exists public.api_rate_limit_buckets (
  bucket_key text primary key,
  scope text not null,
  identifier text not null,
  count integer not null default 0,
  reset_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_api_rate_limit_buckets_scope_identifier
  on public.api_rate_limit_buckets (scope, identifier);

create index if not exists idx_api_rate_limit_buckets_reset_at
  on public.api_rate_limit_buckets (reset_at);

alter table public.api_rate_limit_buckets enable row level security;

drop policy if exists "API rate limits: service role bypass" on public.api_rate_limit_buckets;
create policy "API rate limits: service role bypass"
  on public.api_rate_limit_buckets for all to service_role
  using (true)
  with check (true);

create or replace function public.take_clawcloud_rate_limit(
  p_scope text,
  p_identifier text,
  p_limit integer,
  p_window_seconds integer,
  p_now timestamptz default now()
)
returns table (
  ok boolean,
  "limit" integer,
  remaining integer,
  reset_at timestamptz,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket_key text := concat_ws(':', p_scope, p_identifier);
  v_next_reset_at timestamptz := p_now + make_interval(secs => greatest(p_window_seconds, 1));
  v_count integer := 0;
  v_reset_at timestamptz := p_now;
begin
  if coalesce(p_limit, 0) <= 0 or coalesce(p_window_seconds, 0) <= 0 then
    return query
    select true, greatest(coalesce(p_limit, 0), 0), greatest(coalesce(p_limit, 0), 0), p_now, 0;
    return;
  end if;

  delete from public.api_rate_limit_buckets as buckets
  where buckets.reset_at < p_now - interval '1 day';

  insert into public.api_rate_limit_buckets (
    bucket_key,
    scope,
    identifier,
    count,
    reset_at,
    updated_at
  )
  values (
    v_bucket_key,
    p_scope,
    p_identifier,
    1,
    v_next_reset_at,
    p_now
  )
  on conflict (bucket_key) do update
  set
    count = case
      when public.api_rate_limit_buckets.reset_at <= p_now then 1
      else public.api_rate_limit_buckets.count + 1
    end,
    reset_at = case
      when public.api_rate_limit_buckets.reset_at <= p_now then v_next_reset_at
      else public.api_rate_limit_buckets.reset_at
    end,
    updated_at = p_now
  returning public.api_rate_limit_buckets.count, public.api_rate_limit_buckets.reset_at
  into v_count, v_reset_at;

  return query
  select
    v_count <= p_limit,
    p_limit,
    greatest(p_limit - least(v_count, p_limit), 0),
    v_reset_at,
    case
      when v_count <= p_limit then 0
      else greatest(1, ceil(extract(epoch from (v_reset_at - p_now)))::integer)
    end;
end;
$$;
