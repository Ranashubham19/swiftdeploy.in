# ClawCloud AI

ClawCloud AI is a WhatsApp-first personal assistant built with Next.js, Supabase, and a Railway-hosted messaging agent.

It combines general AI answers with practical workflows:

- WhatsApp and Telegram messaging flows
- Gmail, Calendar, Drive, Docs, and Sheets support
- reminders, memory, custom slash commands, and morning briefings
- document OCR, XLSX parsing, image understanding, and voice-note handling
- India-first features such as UPI SMS parsing, spending insights, trains, cricket, tax help, holidays, Hinglish, and regional languages

## Architecture

- `app/*`: Next.js product UI and API routes
- `agent-server.ts`: Railway-hosted WhatsApp agent
- `lib/clawcloud-agent.ts`: main routing, guardrails, and assistant orchestration
- `lib/clawcloud-*`: feature modules for finance, docs, billing, memory, Google, Telegram, India utilities, and safety

## Key product behavior

- Answers regular questions directly in chat
- Routes high-stakes questions through extra guardrails
- Reads uploaded files and answers from their contents
- Runs assistant workflows like reminders, draft replies, and spend summaries
- Keeps lightweight user memory for personalization
- Applies honest fallbacks when live data or external providers are not reliable enough

## Local development

1. Install dependencies

```bash
npm install
```

2. Add environment variables in `.env.local`

3. Start the web app

```bash
npm run dev
```

4. Start the WhatsApp agent when needed

```bash
npm run agent
```

## Verification

```bash
npm run typecheck
npm run build
```

## QA and evals

```bash
npm run test:unit
npm run qa:replay
npm run qa:benchmark
npm run qa:scorecard
npm run qa:canary -- --dry-run
```

- `npm run test:unit`: deterministic parser, safety, tax, and routing helper coverage
- `npm run qa:replay`: fixture-driven WhatsApp replay against `routeInboundAgentMessage`
- `npm run qa:benchmark`: deep benchmark with scored criteria and a JSON report
- `npm run qa:scorecard`: weighted readiness summary across replay and benchmark
- `npm run qa:canary`: production canary for `/api/health` plus a few live agent prompts

Generated reports are written to local `tmp-*.json` files and stay out of git.

For production environment details, see [PRODUCTION-SETUP.md](c:\Users\ranas\Downloads\swiftdeploy-ai%20(2)\PRODUCTION-SETUP.md).
