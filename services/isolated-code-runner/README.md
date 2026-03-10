# Isolated Code Runner Service

Runs JavaScript/Python snippets in a separate container and exposes an HTTP API used by the bot for code validation/fix loops.

## Run with Docker

```bash
docker build -t isolated-code-runner ./services/isolated-code-runner
docker run --rm -p 8081:8081 \
  -e RUNNER_API_KEY=change-me \
  isolated-code-runner
```

## Backend env

Set in your backend service:

- `ISOLATED_CODE_RUNNER_URL=http://localhost:8081`
- `ISOLATED_CODE_RUNNER_API_KEY=change-me`
- `ADVANCED_CODE_EXECUTION_ENABLED=true`

Optional:

- `ISOLATED_CODE_RUNNER_REQUIRED=true` (do not fall back to local subprocess)
- `ISOLATED_CODE_RUNNER_TIMEOUT_MS=2500`

## API

`POST /execute`

```json
{
  "language": "javascript",
  "code": "console.log(1+1)",
  "timeoutMs": 1000
}
```
