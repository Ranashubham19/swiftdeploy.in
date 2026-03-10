from celery import Celery

from app.core.config import get_settings


settings = get_settings()

celery_app = Celery(
    "ai_internet_worker",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    result_expires=settings.celery_result_expires_seconds,
    task_track_started=True,
    task_always_eager=settings.celery_task_always_eager,
    beat_schedule={
        "dispatch-due-tasks": {
            "task": "app.workers.tasks.dispatch_due_tasks",
            "schedule": 60.0,
        }
    },
)
