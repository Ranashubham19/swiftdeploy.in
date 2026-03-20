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

alter table public.whatsapp_messages
  add column if not exists remote_jid text;

alter table public.whatsapp_messages
  add column if not exists remote_phone text;

alter table public.whatsapp_messages
  add column if not exists contact_name text;

alter table public.whatsapp_messages
  add column if not exists chat_type text not null default 'direct'
  check (chat_type in ('direct', 'group', 'self', 'broadcast', 'unknown'));

create index if not exists idx_wa_messages_user_remote_sent
  on public.whatsapp_messages (user_id, remote_phone, sent_at desc);

alter table public.whatsapp_contacts enable row level security;

drop policy if exists "WA contacts: read own" on public.whatsapp_contacts;
create policy "WA contacts: read own"
  on public.whatsapp_contacts
  for select
  using (auth.uid() = user_id);
