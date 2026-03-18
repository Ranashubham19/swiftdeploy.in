-- UPI / bank SMS transaction storage
-- Run via Supabase SQL editor or your preferred migration flow.

create table if not exists upi_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(12,2) not null,
  currency text not null default 'INR',
  merchant text not null,
  upi_id text,
  bank text,
  transaction_type text not null check (transaction_type in ('debit', 'credit')),
  category text not null default 'other',
  raw_sms text,
  transacted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_upi_transactions_user_date
  on upi_transactions(user_id, transacted_at desc);

alter table upi_transactions enable row level security;

drop policy if exists "Users can manage own upi_transactions" on upi_transactions;

create policy "Users can manage own upi_transactions"
  on upi_transactions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
