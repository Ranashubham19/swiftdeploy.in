do $$
declare
  existing_constraint text;
begin
  select conname
  into existing_constraint
  from pg_constraint
  where conrelid = 'public.connected_accounts'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%provider%';

  if existing_constraint is not null then
    execute format(
      'alter table public.connected_accounts drop constraint %I',
      existing_constraint
    );
  end if;
end $$;

alter table public.connected_accounts
  add constraint connected_accounts_provider_check
  check (provider in ('gmail', 'google_calendar', 'google_drive', 'whatsapp', 'telegram', 'slack'));
