from __future__ import annotations

import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app.core.config import get_settings


class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self.send_response(404)
            self.end_headers()
            return

        payload = b'{"status":"ok"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return


def _start_health_server(port: str) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer(("0.0.0.0", int(port)), _HealthHandler)
    thread = threading.Thread(target=server.serve_forever, name="role-health", daemon=True)
    thread.start()
    return server


def main() -> int:
    settings = get_settings()
    role = (settings.service_role or "api").strip().lower()
    port = os.getenv("PORT", "8080")
    health_server: ThreadingHTTPServer | None = None

    if role == "api":
        command = [
            "uvicorn",
            "app.main:app",
            "--host",
            "0.0.0.0",
            "--port",
            port,
        ]
    elif role == "worker":
        command = [
            "celery",
            "-A",
            "app.core.celery_app.celery_app",
            "worker",
            "-l",
            settings.celery_worker_log_level,
            "--concurrency",
            str(max(settings.celery_worker_concurrency, 1)),
        ]
        health_server = _start_health_server(port)
    elif role == "beat":
        command = [
            "celery",
            "-A",
            "app.core.celery_app.celery_app",
            "beat",
            "-l",
            settings.celery_worker_log_level,
        ]
        health_server = _start_health_server(port)
    else:
        raise RuntimeError(f"Unsupported SERVICE_ROLE '{role}'. Expected api, worker, or beat.")

    try:
        completed = subprocess.run(command, check=False)
        return int(completed.returncode)
    finally:
        if health_server is not None:
            health_server.shutdown()
            health_server.server_close()


if __name__ == "__main__":
    raise SystemExit(main())
