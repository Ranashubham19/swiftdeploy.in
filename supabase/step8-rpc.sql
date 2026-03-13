create or replace function public.increment_cron_health_total_runs()
returns void as $$
begin
  update public.cron_health
  set total_runs = total_runs + 1
  where id = 1;
end;
$$ language plpgsql security definer;
