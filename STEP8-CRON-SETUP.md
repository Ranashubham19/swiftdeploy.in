# ClawCloud Scheduler - Step 8 Setup Guide

## How it works

The task scheduler has two parallel trigger paths so tasks fire reliably in all deployment configurations.

Path A: Vercel Cron (every minute)
- `vercel.json` -> `GET /api/agent/cron` -> `runDueClawCloudTasks()`

Path B: `agent-server.ts` (`node-cron`, every minute)
- `cron.schedule("* * * * *")` -> `POST /api/agent/cron` -> `runDueClawCloudTasks()`

`runDueClawCloudTasks()` uses the `cron_log` table to deduplicate. Even if both paths fire at the same time, each task only runs once per minute per user.

## What runs when

| Task | Trigger | Logic |
|---|---|---|
| `morning_briefing` | `schedule_time = "07:00"` in user's timezone | Fires once at the user's local 7am |
| `evening_summary` | `schedule_time = "21:00"` in user's timezone | Fires once at the user's local 9pm |
| `meeting_reminders` | Every cron tick | Checks calendar for events in the next 30 minute window; deduped by `meeting_reminder_log` |
| `custom_reminder` | Every cron tick | Fires when `config.fire_at` is within the last 60 seconds |
| `draft_replies`, `email_search` | On-demand only | Triggered by inbound messages |

## Environment variables required

```bash
CRON_SECRET=your-random-secret-here
AGENT_SECRET=your-agent-secret
NEXT_PUBLIC_APP_URL=https://your-domain.com
```

## Vercel deployment tiers

| Tier | Cron frequency | Action |
|---|---|---|
| Hobby | Daily only | Use `agent-server.ts` cron as the primary trigger |
| Pro | Every minute | `vercel.json` cron handles everything |

## Running agent-server.ts

```bash
npx tsx agent-server.ts
pm2 start agent-server.ts --name clawcloud-agent --interpreter tsx
```

## Monitoring cron health

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-domain.com/api/agent/cron/health
```

`stale: true` means cron has not fired in over 5 minutes.

## Timezone support

`schedule_time` in `agent_tasks` is matched against the user's local time stored in `users.timezone`. The default fallback is `Asia/Kolkata`.

## Database migration

Run these in Supabase SQL editor in order:

1. `supabase/step8-scheduler-migration.sql`
2. `supabase/step8-rpc.sql`
