# Telegram ChatGPT-Style Bot (OpenRouter + Telegraf + Prisma)

Production-ready Telegram chatbot with:
- Multi-turn memory per chat/user context
- OpenRouter model routing and fallback
- Streaming responses with progressive Telegram edits
- Tool calling (`calculator`, `date_time`, `unit_convert`, text utilities)
- Basic safety moderation + prompt-injection hardening
- PostgreSQL persistence via Prisma
- Railway-ready webhook mode + `/health` endpoint

## Project Structure

```text
src/
  index.ts
  bot.ts
  openrouter/
    client.ts
    models.ts
    router.ts
    prompts.ts
  memory/
    store.ts
    summarizer.ts
  tools/
    tools.ts
    calculator.ts
    datetime.ts
    convert.ts
  db/
    prisma.ts
  utils/
    logger.ts
    markdown.ts
    rateLimit.ts
    locks.ts
    chunking.ts
    errors.ts
prisma/
  schema.prisma
  migrations/
```

## Setup (Local)

1. Install backend dependencies:
```bash
cd backend
npm install
```

2. Create env file:
```bash
cp .env.example .env
```

3. Set required env vars:
- `TELEGRAM_BOT_TOKEN`
- `OPENROUTER_API_KEY`
- `DATABASE_URL`

4. Run Prisma migrate and generate:
```bash
npm run prisma:migrate
npm run prisma:generate
```

5. Start in dev (long polling if `APP_URL` is empty):
```bash
npm run dev
```

## Railway Deployment

1. Set Railway variables:
- `TELEGRAM_BOT_TOKEN`
- `OPENROUTER_API_KEY`
- `DATABASE_URL` (Railway Postgres)
- `APP_URL` (your Railway public URL, e.g. `https://your-app.up.railway.app`)
- Optional tuning vars from `.env.example`
- For free-only mode, set:
  - `DEFAULT_MODEL=openrouter/free`
  - `FALLBACK_MODEL=openrouter/free`
  - `MODEL_FAST_ID=meta-llama/llama-3.2-3b-instruct:free`
  - `MODEL_SMART_ID=openrouter/free`
  - `MODEL_CODE_ID=qwen/qwen3-coder:free`
  - `MODEL_MATH_ID=deepseek/deepseek-r1-0528:free`
  - `MODEL_VISION_ID=nvidia/nemotron-nano-12b-v2-vl:free`

2. Deploy.

3. Runtime uses:
- `npm --prefix backend run start:railway:bot`
- This runs `prisma migrate deploy` and then starts:
  - bot runtime (`dist-bot/index.js`) with Telegram webhook handler on `/webhook`

4. Verify health:
- `GET https://<your-app>/health`
- Expected: `{ "ok": true }`

5. Open Telegram and send `/start`.

## Commands

- `/start` onboarding and quick actions
- `/help` command list and examples
- `/reset` clear chat memory/history for this chat context
- `/model` show current model and switch models
- `/settings` show/update temperature, verbosity, style
- `/export` export conversation as `txt` + `json`
- `/stop` abort active streaming response

Inline actions:
- `Reset chat`
- `Switch model`
- `Toggle concise/detailed`

## Environment Variables

- `TELEGRAM_BOT_TOKEN`: Telegram bot token
- `OPENROUTER_API_KEY`: OpenRouter API key
- `OPENROUTER_BASE_URL`: default `https://openrouter.ai/api/v1`
- `OPENROUTER_TIMEOUT_MS`: request timeout in ms
- `OPENROUTER_MAX_RETRIES`: retries for `429/5xx`
- `OPENROUTER_RETRY_BASE_DELAY_MS`: base retry backoff in ms
- `APP_URL`: public URL for webhook mode
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: optional Redis URL for distributed Telegram anti-spam state (`redis://` or `rediss://`)
- `REDIS_TIMEOUT_MS`: Redis command timeout (ms)
- `REDIS_ANTI_SPAM_PREFIX`: Redis key prefix for anti-spam keys
- `ADMIN_EMAILS`: optional CSV of dashboard admin emails (if set, only these authenticated emails are admin)
- `ADMIN_TELEGRAM_IDS`: optional CSV for admin-only behavior
- `MODERATION_AUDIT_FILE`: optional JSON path for moderation/anti-spam/admin audit records
- `MODERATION_AUDIT_MAX_ENTRIES`: maximum stored audit records
- `MODERATION_AUDIT_LOG_ALL`: if `true`, stores allowed moderation events too; default logs only blocked/critical actions
- `TELEGRAM_ADMIN_RESTRICTIONS_FILE`: optional JSON path for persisted manual Telegram restrictions
- `DEFAULT_MODEL`: default model key/id
- `FALLBACK_MODEL`: model fallback ID
- `OPENROUTER_FALLBACK_MODELS`: optional CSV of extra model IDs to try automatically on failure
- `MAX_INPUT_CHARS`: max message input length
- `MAX_OUTPUT_TOKENS`: max generated tokens
- `STREAM_EDIT_INTERVAL_MS`: Telegram edit throttle
- `STREAM_PREVIEW_MAX_CHARS`: max live preview size while streaming (keeps speed stable on long answers)
- `MAX_CONTINUATION_ROUNDS`: auto-continuation rounds when model stops due token length
- `FAST_RECENT_CONTEXT_MESSAGES`: smaller recent history window for short prompts
- `MAX_MODEL_ATTEMPTS`: limit fallback model attempts per request
- `MAX_TOOL_ROUNDS`: limit tool-call planning rounds for faster first reply
- `TG_STICKER_REPLY_IDS`: optional comma-separated sticker file IDs for professional reply stickers
- `TG_STICKER_REPLY_PROBABILITY`: sticker send probability from 0 to 1 (default 1)
- `TYPEWRITER_FALLBACK_ENABLED`: if true, non-stream providers are rendered with a typewriter effect
- `TYPEWRITER_CHARS_PER_TICK`: characters revealed per typewriter update
- `TYPEWRITER_TICK_MS`: delay between typewriter updates
- `SIMULATED_STREAM_CHUNK_SIZE`: fallback stream chunk size when provider has no token deltas
- `SIMULATED_STREAM_DELAY_MS`: fallback stream delay in ms
- `CODE_FILE_EXPORT_ENABLED`: if true, coding replies can include downloadable code files
- `CODE_FAST_PATH_ENABLED`: if true, pure code-generation prompts use fast-code settings
- `MODEL_CODE_FAST_ID`: optional fast model override for direct code generation
- `OPENAI_API_KEY`: optional Whisper STT key for Telegram voice/audio/video transcription
- `STT_BASE_URL`: optional OpenAI-compatible transcription endpoint override
- `STT_API_KEY`: optional key used with `STT_BASE_URL`
- `STT_MODEL`: transcription model id (default `whisper-1`)
- `ASSEMBLYAI_API_KEY`: AssemblyAI key for robust audio/video transcription
- `ASSEMBLYAI_BASE_URL`: AssemblyAI API base (default `https://api.assemblyai.com/v2`)
- `ASSEMBLYAI_SPEECH_MODEL`: speech model (for example `universal-2` or `universal-3-pro`)
- `ASSEMBLYAI_STT_ENABLED`: enable/disable AssemblyAI STT provider
- `ASSEMBLYAI_STT_TIMEOUT_MS`: end-to-end transcription timeout for AssemblyAI polling
- `ASSEMBLYAI_POLL_INTERVAL_MS`: poll interval while waiting for transcription completion
- `NVIDIA_STT_ENABLED`: set `true` to try NVIDIA/OpenRouter key for STT endpoint
- `NVIDIA_STT_BASE_URL`: optional NVIDIA STT base/endpoint override
- `NVIDIA_STT_MODEL`: model id to use for NVIDIA STT attempts

## Model Routing

If current model is `auto`, heuristic routing selects:
- `coding/debugging` -> `code` model
- `math` -> `math` model
- `general` -> `fast` model
- `current events` -> response includes no-live-browsing disclaimer

Special Python disambiguation:
- If message includes `python` + coding words (`learn`, `code`, `function`, `error`, `install`, `pip`, `syntax`) -> programming intent.
- Otherwise bot asks quick clarification (programming vs Monty Python).

## Memory Strategy

- Persists messages in DB (`Chat`, `Message`, `Memory`)
- Keeps recent turns verbatim (last `N`)
- Maintains running summary (`summaryText`) via summarizer model call
- Supports pinned memory on messages like:
  - `remember this: my preferred format is bullet points`

## Safety + Reliability

- Input moderation blocks obvious harmful categories
- System prompt blocks prompt injection and secret leakage
- Moderation audit logging persists blocked safety events, anti-spam violations, and admin actions
- Per-chat DB lock prevents concurrency races
- Per-user rate limit: 20 messages / 10 min
- Telegram anti-spam supports distributed Redis state when `REDIS_URL` is configured, with in-memory fallback if Redis is unavailable
- Robust errors for users, full server logging with `pino`
- Response formatter enforces readable plain text with clean spacing and numbered lists
- If a model stops due token limit, bot automatically requests continuation to complete the answer
- If no sticker IDs are configured, bot uses an animated Telegram dice sticker fallback
- For faster responses, use lower `OPENROUTER_MAX_RETRIES`, lower `MAX_MODEL_ATTEMPTS`, `MAX_TOOL_ROUNDS=1`, and tune `STREAM_EDIT_INTERVAL_MS`
- For coding prompts, bot can attach a code file (editor-like document) for clean copy/paste

## Troubleshooting

### 429 / provider overload
- Bot retries with exponential backoff on `429` and `5xx`.
- If persistent, reduce request rate or switch to a cheaper/faster model.

### OpenRouter auth/credits errors
- `401/403`: invalid or revoked `OPENROUTER_API_KEY`.
- `402`: insufficient OpenRouter credits.
- The bot returns a user-friendly recovery prompt in Telegram and auto-tries configured fallback models.

### Telegram markdown parse errors
- Markdown is escaped before send/edit.
- If parsing still fails, bot falls back to plain text automatically.

### Webhook issues on Railway
- Ensure `APP_URL` is set to exact public URL.
- Confirm `/health` is reachable.
- Check Railway logs for `Webhook mode enabled`.

### Admin operations
- `GET /admin/moderation/audit?limit=200&blockedOnly=true`
- `POST /admin/moderation/audit/clear`
- `GET /admin/anti-spam/status`
- `GET /admin/telegram/restrictions`
- `POST /admin/telegram/restrictions` with body `{ scope, chatId, userId, durationSec, reason }`
- `DELETE /admin/telegram/restrictions` with query/body `{ scope, chatId, userId }`
- Auth: dashboard admin session or `x-admin-key` header (`ADMIN_API_KEY`)

### DB errors
- Verify `DATABASE_URL` is valid.
- Run `npm run prisma:deploy` after schema updates.
