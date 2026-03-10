import logging
import threading

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, health, tasks
from app.core.config import get_settings
from app.db.schema import prepare_database
from app.models import task as _task_models  # noqa: F401
from app.models import user as _user_models  # noqa: F401


settings = get_settings()
logging.basicConfig(
    level=getattr(logging, settings.app_log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)
app = FastAPI(title=settings.app_name)
_scheduler_stop = threading.Event()
_scheduler_thread: threading.Thread | None = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _scheduler_loop() -> None:
    from app.workers.tasks import dispatch_due_tasks

    interval_seconds = max(settings.inprocess_scheduler_interval_seconds, 15)
    while not _scheduler_stop.wait(interval_seconds):
        dispatch_due_tasks.delay()


@app.on_event("startup")
def on_startup() -> None:
    prepare_database()
    logger.info("Starting AI Internet Worker API with role=%s", settings.service_role)

    global _scheduler_thread
    if settings.inprocess_scheduler_enabled and _scheduler_thread is None:
        _scheduler_stop.clear()
        _scheduler_thread = threading.Thread(
            target=_scheduler_loop,
            name="ai-internet-worker-scheduler",
            daemon=True,
        )
        _scheduler_thread.start()
        logger.info("In-process scheduler enabled with %s second interval.", settings.inprocess_scheduler_interval_seconds)


@app.on_event("shutdown")
def on_shutdown() -> None:
    global _scheduler_thread
    _scheduler_stop.set()
    _scheduler_thread = None
    logger.info("AI Internet Worker API shutdown complete.")


app.include_router(health.router)
app.include_router(auth.router, prefix=settings.api_v1_prefix)
app.include_router(tasks.router, prefix=settings.api_v1_prefix)
