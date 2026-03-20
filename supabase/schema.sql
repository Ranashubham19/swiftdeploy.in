create table if not exists public.chat_threads (
  id text primary key,
  user_id text,
  title text not null,
  updated_at timestamptz not null default timezone('utc', now()),
  messages jsonb not null default '[]'::jsonb,
  progress jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  active_result jsonb
);

create index if not exists chat_threads_user_id_updated_at_idx
  on public.chat_threads (user_id, updated_at desc);

create table if not exists public.research_runs (
  id bigint generated always as identity primary key,
  question text not null,
  plan jsonb not null,
  progress jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  retrieved_context jsonb not null default '[]'::jsonb,
  report jsonb,
  firebase_uid text,
  user_email text,
  user_name text,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.chat_threads enable row level security;
alter table public.research_runs enable row level security;

create policy if not exists "Allow anon read chat threads"
  on public.chat_threads
  for select
  using (true);

create policy if not exists "Allow anon upsert chat threads"
  on public.chat_threads
  for insert
  with check (true);

create policy if not exists "Allow anon update chat threads"
  on public.chat_threads
  for update
  using (true)
  with check (true);

create policy if not exists "Allow anon insert research runs"
  on public.research_runs
  for insert
  with check (true);

create extension if not exists "uuid-ossp";

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  plan text not null default 'free' check (plan in ('free', 'starter', 'pro')),
  onboarding_done boolean not null default false,
  timezone text not null default 'Asia/Kolkata',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.users.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.users.avatar_url);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists users_updated_at on public.users;
create trigger users_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

create table if not exists public.connected_accounts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('gmail', 'google_calendar', 'google_drive', 'whatsapp', 'telegram', 'slack')),
  access_token text,
  refresh_token text,
  token_expiry timestamptz,
  account_email text,
  phone_number text,
  display_name text,
  is_active boolean not null default true,
  connected_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (user_id, provider)
);

create index if not exists idx_connected_accounts_user
  on public.connected_accounts (user_id);

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

create table if not exists public.agent_tasks (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  task_type text not null check (task_type in (
    'morning_briefing',
    'draft_replies',
    'meeting_reminders',
    'email_search',
    'evening_summary',
    'custom_reminder',
    'user_contacts'
  )),
  is_enabled boolean not null default true,
  schedule_time time,
  schedule_days text[],
  config jsonb not null default '{}'::jsonb,
  total_runs integer not null default 0,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, task_type)
);

create index if not exists idx_agent_tasks_user
  on public.agent_tasks (user_id);

create index if not exists idx_agent_tasks_enabled
  on public.agent_tasks (is_enabled)
  where is_enabled = true;

drop trigger if exists agent_tasks_updated_at on public.agent_tasks;
create trigger agent_tasks_updated_at
  before update on public.agent_tasks
  for each row execute function public.set_updated_at();

create table if not exists public.task_runs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  task_id uuid not null references public.agent_tasks(id) on delete cascade,
  task_type text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'success', 'failed')),
  input_data jsonb,
  output_data jsonb,
  error_message text,
  duration_ms integer,
  tokens_used integer,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_task_runs_user
  on public.task_runs (user_id);

create index if not exists idx_task_runs_task
  on public.task_runs (task_id);

create index if not exists idx_task_runs_started
  on public.task_runs (started_at desc);

create index if not exists idx_task_runs_status
  on public.task_runs (status);

create table if not exists public.whatsapp_contacts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  jid text not null,
  phone_number text,
  contact_name text,
  notify_name text,
  verified_name text,
  source text not null default 'session' check (source in ('session', 'history', 'message')),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, jid)
);

create index if not exists idx_whatsapp_contacts_user_seen
  on public.whatsapp_contacts (user_id, last_seen_at desc);

create index if not exists idx_whatsapp_contacts_user_phone
  on public.whatsapp_contacts (user_id, phone_number);

drop trigger if exists whatsapp_contacts_updated_at on public.whatsapp_contacts;
create trigger whatsapp_contacts_updated_at
  before update on public.whatsapp_contacts
  for each row execute function public.set_updated_at();

create table if not exists public.whatsapp_messages (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  content text not null,
  message_type text not null default 'text' check (message_type in ('text', 'briefing', 'draft', 'reminder', 'search_result')),
  task_run_id uuid references public.task_runs(id),
  wa_message_id text,
  remote_jid text,
  remote_phone text,
  contact_name text,
  chat_type text not null default 'direct' check (chat_type in ('direct', 'group', 'self', 'broadcast', 'unknown')),
  sent_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz
);

create index if not exists idx_wa_messages_user
  on public.whatsapp_messages (user_id);

create index if not exists idx_wa_messages_sent
  on public.whatsapp_messages (sent_at desc);

create index if not exists idx_wa_messages_user_remote_sent
  on public.whatsapp_messages (user_id, remote_phone, sent_at desc);

create table if not exists public.analytics_daily (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  date date not null default current_date,
  emails_processed integer not null default 0,
  drafts_created integer not null default 0,
  tasks_run integer not null default 0,
  minutes_saved integer not null default 0,
  wa_messages_sent integer not null default 0,
  unique (user_id, date)
);

create index if not exists idx_analytics_user_date
  on public.analytics_daily (user_id, date desc);

create table if not exists public.subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade unique,
  plan text not null default 'free' check (plan in ('free', 'starter', 'pro')),
  status text not null default 'active' check (status in ('active', 'cancelled', 'past_due', 'trialing')),
  razorpay_sub_id text unique,
  razorpay_customer_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists subscriptions_updated_at on public.subscriptions;
create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.users enable row level security;
alter table public.connected_accounts enable row level security;
alter table public.custom_commands enable row level security;
alter table public.agent_tasks enable row level security;
alter table public.task_runs enable row level security;
alter table public.whatsapp_contacts enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.analytics_daily enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "Users: read own" on public.users;
create policy "Users: read own"
  on public.users
  for select
  using (auth.uid() = id);

drop policy if exists "Users: update own" on public.users;
create policy "Users: update own"
  on public.users
  for update
  using (auth.uid() = id);

drop policy if exists "Accounts: read own" on public.connected_accounts;
create policy "Accounts: read own"
  on public.connected_accounts
  for select
  using (auth.uid() = user_id);

drop policy if exists "Accounts: insert own" on public.connected_accounts;
create policy "Accounts: insert own"
  on public.connected_accounts
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Accounts: update own" on public.connected_accounts;
create policy "Accounts: update own"
  on public.connected_accounts
  for update
  using (auth.uid() = user_id);

drop policy if exists "Accounts: delete own" on public.connected_accounts;
create policy "Accounts: delete own"
  on public.connected_accounts
  for delete
  using (auth.uid() = user_id);

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

drop policy if exists "Tasks: read own" on public.agent_tasks;
create policy "Tasks: read own"
  on public.agent_tasks
  for select
  using (auth.uid() = user_id);

drop policy if exists "Tasks: insert own" on public.agent_tasks;
create policy "Tasks: insert own"
  on public.agent_tasks
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Tasks: update own" on public.agent_tasks;
create policy "Tasks: update own"
  on public.agent_tasks
  for update
  using (auth.uid() = user_id);

drop policy if exists "Tasks: delete own" on public.agent_tasks;
create policy "Tasks: delete own"
  on public.agent_tasks
  for delete
  using (auth.uid() = user_id);

drop policy if exists "Runs: read own" on public.task_runs;
create policy "Runs: read own"
  on public.task_runs
  for select
  using (auth.uid() = user_id);

drop policy if exists "WA: read own" on public.whatsapp_messages;
create policy "WA: read own"
  on public.whatsapp_messages
  for select
  using (auth.uid() = user_id);

drop policy if exists "WA contacts: read own" on public.whatsapp_contacts;
create policy "WA contacts: read own"
  on public.whatsapp_contacts
  for select
  using (auth.uid() = user_id);

drop policy if exists "Analytics: read own" on public.analytics_daily;
create policy "Analytics: read own"
  on public.analytics_daily
  for select
  using (auth.uid() = user_id);

drop policy if exists "Subs: read own" on public.subscriptions;
create policy "Subs: read own"
  on public.subscriptions
  for select
  using (auth.uid() = user_id);

drop policy if exists "Subs: update own" on public.subscriptions;
create policy "Subs: update own"
  on public.subscriptions
  for update
  using (auth.uid() = user_id);

create or replace function public.seed_default_tasks(p_user_id uuid)
returns void as $$
begin
  insert into public.agent_tasks (user_id, task_type, is_enabled, schedule_time, schedule_days, config)
  values
    (p_user_id, 'morning_briefing', true, '07:00', array['mon','tue','wed','thu','fri','sat','sun'], '{"max_emails":50,"tone":"concise"}'),
    (p_user_id, 'draft_replies', true, null, null, '{"tone":"professional","auto_send":false}'),
    (p_user_id, 'meeting_reminders', true, null, null, '{"minutes_before":30,"include_context":true}'),
    (p_user_id, 'email_search', false, null, null, '{}'::jsonb),
    (p_user_id, 'evening_summary', false, '21:00', array['mon','tue','wed','thu','fri'], '{}'::jsonb),
    (p_user_id, 'custom_reminder', false, null, null, '{}'::jsonb)
  on conflict (user_id, task_type) do nothing;
end;
$$ language plpgsql security definer;

create or replace function public.increment_analytics(
  p_user_id uuid,
  p_field text,
  p_amount integer
)
returns void as $$
begin
  insert into public.analytics_daily (user_id, date)
  values (p_user_id, current_date)
  on conflict (user_id, date) do nothing;

  if p_field = 'emails_processed' then
    update public.analytics_daily
    set emails_processed = emails_processed + coalesce(p_amount, 0)
    where user_id = p_user_id and date = current_date;
  elsif p_field = 'drafts_created' then
    update public.analytics_daily
    set drafts_created = drafts_created + coalesce(p_amount, 0)
    where user_id = p_user_id and date = current_date;
  elsif p_field = 'tasks_run' then
    update public.analytics_daily
    set tasks_run = tasks_run + coalesce(p_amount, 0)
    where user_id = p_user_id and date = current_date;
  elsif p_field = 'minutes_saved' then
    update public.analytics_daily
    set minutes_saved = minutes_saved + coalesce(p_amount, 0)
    where user_id = p_user_id and date = current_date;
  elsif p_field = 'wa_messages_sent' then
    update public.analytics_daily
    set wa_messages_sent = wa_messages_sent + coalesce(p_amount, 0)
    where user_id = p_user_id and date = current_date;
  end if;
end;
$$ language plpgsql security definer;

create or replace view public.user_dashboard_summary as
select
  u.id as user_id,
  u.plan,
  count(distinct ca.id) filter (where ca.is_active) as connected_accounts,
  count(distinct at2.id) filter (where at2.is_enabled) as active_tasks,
  coalesce(sum(tr.total_runs), 0) as total_runs,
  max(tr2.started_at) as last_run_at,
  coalesce(ad.emails_processed, 0) as emails_today,
  coalesce(ad.drafts_created, 0) as drafts_today,
  coalesce(ad.minutes_saved, 0) as minutes_saved_today
from public.users u
left join public.connected_accounts ca on ca.user_id = u.id
left join public.agent_tasks at2 on at2.user_id = u.id
left join public.agent_tasks tr on tr.user_id = u.id
left join public.task_runs tr2 on tr2.user_id = u.id
left join public.analytics_daily ad on ad.user_id = u.id and ad.date = current_date
group by u.id, u.plan, ad.emails_processed, ad.drafts_created, ad.minutes_saved;
