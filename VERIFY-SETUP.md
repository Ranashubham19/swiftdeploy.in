# Local Setup Verification

Use the local verifier after updating `.env.local` and starting the app.

## Run

1. Install dependencies if needed:

```bash
npm install
```

2. Start the app in one terminal:

```bash
npm run dev
```

3. Run the verifier in another terminal:

```bash
npm run verify:setup
```

## What it checks

- `.env.local` exists
- Required local environment variables are present
- The Next.js app responds at `/api/health`
- Provider configuration is visible through the app
- All 14 Supabase tables are available through Supabase REST
- The `/api/search` endpoint works
- The local agent server responds if `AGENT_SERVER_URL` is configured
- The cron health endpoint responds if `CRON_SECRET` is configured

## Current blocker guidance

If the verifier reports that the Supabase tables are missing from the REST schema cache, run the complete migration bundle in Supabase:

- [supabase/clawcloud-complete-migration.sql](c:\Users\ranas\Downloads\swiftdeploy-ai (2)\supabase\clawcloud-complete-migration.sql)

After running the migration, re-run:

```bash
npm run verify:setup
```
