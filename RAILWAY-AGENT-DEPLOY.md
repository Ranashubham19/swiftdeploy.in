# Railway Agent Deployment

Use Railway to run `agent-server.ts` as the always-on ClawCloud agent service.

## Recommended setup

1. Create a new Railway project from this GitHub repo.
2. Deploy the repo root.
3. Let Railway use the checked-in deployment config:
   - `railway.json`
   - `nixpacks.toml`

The service will:
- install dependencies with `npm ci`
- start with `npm run agent`
- expose `/health` as the healthcheck route
- bind to Railway's injected `PORT` automatically

## Required Railway variables

Add these in Railway -> Service -> Variables:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
AGENT_SECRET=the-same-secret-as-your-app
CRON_SECRET=the-same-cron-secret-as-your-app
NEXT_PUBLIC_APP_URL=https://your-public-app-domain
WA_SESSION_DIR=/data/wa-sessions
```

## Important notes

- Do not set `NEXT_PUBLIC_APP_URL` to `http://localhost:3000` on Railway.
  The Railway service must call a public app URL that it can actually reach.
- Railway provides `PORT` automatically. You do not need to hardcode `AGENT_PORT`.
- WhatsApp session files should live on a persistent Railway volume.
  Mount a volume and point `WA_SESSION_DIR` to that mounted path, for example `/data/wa-sessions`.

## After deploy

1. Copy the Railway public URL.
2. Update your local app:

```env
AGENT_SERVER_URL=https://your-agent-service.up.railway.app
```

3. Restart the app and rerun:

```bash
npm run verify:setup
```

4. Smoke test the agent service directly:

```bash
curl https://your-agent-service.up.railway.app/health
```

Expected response:

```json
{"status":"ok","connections":0}
```
