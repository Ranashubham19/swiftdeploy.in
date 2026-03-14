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
- use Node `22`
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
NEXT_PUBLIC_APP_URL=https://swift-deploy.in
NEXTJS_URL=https://swift-deploy.in
WA_SESSION_DIR=/data/wa-sessions
```

## Important notes

- Do not set `NEXT_PUBLIC_APP_URL` to `http://localhost:3000` on Railway.
  The Railway service must call a public app URL that it can actually reach.
- Do not point `NEXT_PUBLIC_APP_URL` / `NEXTJS_URL` at the Railway agent URL.
  They must point to the public Next.js app so inbound WhatsApp messages can reach
  `/api/agent/message`.
- In this project the public app domain is `https://swift-deploy.in`.
- Do not use `https://swiftdeploy.in` without the hyphen; that hostname does not resolve.
- Railway provides `PORT` automatically. You do not need to hardcode `AGENT_PORT`.
- WhatsApp session files should live on a persistent Railway volume.
  Attach a volume to the agent service and point `WA_SESSION_DIR` to the mounted path,
  for example `/data/wa-sessions`.

## Attach the volume

1. Open the Railway project canvas.
2. Right-click the agent service tile.
3. Click `Attach volume`.
4. Create or attach a volume.
5. Set the mount path to `/data/wa-sessions`.
6. Save and redeploy the service.

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

## If replies still do not send

Check Railway logs:

- If you see repeated `QR generated` lines and `code: 408`, the agent is not logged into WhatsApp yet.
- If you see `Cannot POST /api/agent/message`, your Railway app URL variables point to the wrong host.
- The success line is:

```text
[agent] WhatsApp connected for ...
```
