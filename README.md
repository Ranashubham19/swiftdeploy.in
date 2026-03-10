# AI Internet Worker

Production-oriented MVP service for natural-language internet automation.

## Included

- FastAPI API
- JWT auth
- PostgreSQL models
- Celery worker + beat
- Redis broker/backend
- Playwright automation engine
- Selector self-repair fallback
- Email and Telegram notification hooks

## API Endpoints

- `POST /api/v1/auth/signup`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `POST /api/v1/tasks/interpret`
- `GET /api/v1/tasks`
- `POST /api/v1/tasks`
- `PATCH /api/v1/tasks/{task_id}`
- `DELETE /api/v1/tasks/{task_id}`
- `POST /api/v1/tasks/{task_id}/run`
- `GET /api/v1/tasks/{task_id}/results`
- `GET /api/v1/tasks/{task_id}/logs`
- `GET /health`

## Local run

1. Copy `.env.example` to `.env`.
2. Start the stack:

```bash
docker compose -f docker-compose.ai-internet-worker.yml up --build
```

3. API docs:

```text
http://localhost:8080/docs
```

## Database migrations

Run the initial schema or future upgrades with Alembic:

```bash
alembic upgrade head
```

Generate a new revision after model changes:

```bash
alembic revision --autogenerate -m "describe change"
```

## Notes

- Alembic is now the primary schema path. `AUTO_APPLY_SCHEMA=true` applies migrations automatically on service startup, with a `create_all` fallback kept for compatibility.
- Celery Beat dispatches due tasks every 60 seconds.
- The interpreter uses an LLM if `OPENAI_API_KEY` is set, otherwise it falls back to deterministic rules with better URL, site, and keyword extraction.
- The Playwright executor includes a repair pass for selector failures using common semantic selector patterns.
- `SERVICE_ROLE=api|worker|beat` lets the same image run as the public API, a Celery worker, or the scheduler service.
