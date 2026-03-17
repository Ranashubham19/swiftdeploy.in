-- Allow contact storage rows in agent_tasks (used by lib/clawcloud-contacts.ts).
alter table public.agent_tasks
  drop constraint if exists agent_tasks_task_type_check;

alter table public.agent_tasks
  add constraint agent_tasks_task_type_check
  check (task_type in (
    'morning_briefing',
    'draft_replies',
    'meeting_reminders',
    'email_search',
    'evening_summary',
    'custom_reminder',
    'weekly_spend',
    'user_contacts'
  ));
