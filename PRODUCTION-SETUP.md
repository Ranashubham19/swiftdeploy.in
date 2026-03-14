# Production Setup Checklist

This file records the platform configuration needed to run ClawCloud in production.

## Public app domain

Use the public Next.js app domain:

```text
https://swift-deploy.in
```

Do not use:

- `https://swiftdeploy.in`
- the Railway agent URL
- `http://localhost:3000`

## Railway WhatsApp agent

Deploy `agent-server.ts` to Railway using the checked-in:

- `railway.json`
- `nixpacks.toml`

Required Railway service variables:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
AGENT_SECRET=the-same-secret-as-your-app
CRON_SECRET=the-same-cron-secret-as-your-app
NEXT_PUBLIC_APP_URL=https://swift-deploy.in
NEXTJS_URL=https://swift-deploy.in
WA_SESSION_DIR=/data/wa-sessions
```

Important:

- `NEXT_PUBLIC_APP_URL` and `NEXTJS_URL` must point to the public Next.js app.
- If they point to the Railway URL, inbound WhatsApp replies fail with `Cannot POST /api/agent/message`.
- `WA_SESSION_DIR` must live on a persistent Railway volume.

## Railway volume

Attach a volume to the Railway agent service and mount it at:

```text
/data/wa-sessions
```

Then keep:

```env
WA_SESSION_DIR=/data/wa-sessions
```

Without a persistent volume, the agent loses its WhatsApp auth state on restart and keeps generating new QR codes.

## Vercel app

Minimum production environment needed by the Next.js app:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
AGENT_SECRET=the-same-secret-as-your-railway-agent
CRON_SECRET=the-same-cron-secret-as-your-railway-agent
NEXT_PUBLIC_APP_URL=https://swift-deploy.in
NEXTJS_URL=https://swift-deploy.in
NVIDIA_API_KEY=your-nvidia-key
```

Notes:

- The app uses `AGENT_SERVER_URL` only in local development unless you also want a production UI to call a remote agent service directly.
- The WhatsApp reply route `/api/agent/message` needs Supabase and the shared secret to be present.

## Vercel cron note

This repo does not ship the minute-level Vercel cron anymore because Hobby plans reject `* * * * *`.

Current approach:

- use Railway `agent-server.ts` cron as the primary trigger path
- keep `vercel.json` deployable on Hobby

## Fresh WhatsApp reconnect flow

1. Open the app setup flow.
2. Go to Step 2, `Link your WhatsApp`.
3. Wait for a QR code.
4. In WhatsApp on your phone, open `Linked devices`.
5. Tap `Link a device`.
6. Scan the QR immediately.
7. Confirm Railway logs show:

```text
[agent] WhatsApp connected for ...
```

8. Send `Hello` in WhatsApp.

## Troubleshooting

If Railway logs show repeated QR generation and `code: 408`:

- the WhatsApp session is not logged in yet
- scan the QR again
- confirm the volume is attached and `WA_SESSION_DIR` matches the mount path

If Railway logs show:

```text
Cannot POST /api/agent/message
```

then `NEXT_PUBLIC_APP_URL` / `NEXTJS_URL` on Railway point to the wrong host.

If the dashboard says WhatsApp is connected but logs do not show:

```text
[agent] WhatsApp connected for ...
```

the UI is showing stale stored connection state, not a live WhatsApp socket.
