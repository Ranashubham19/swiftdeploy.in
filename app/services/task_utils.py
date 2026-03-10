from datetime import datetime, timedelta, timezone


VALID_SCHEDULES = {"hourly", "daily", "weekly"}


def normalize_schedule(value: str | None) -> str:
    schedule = (value or "daily").strip().lower()
    if schedule not in VALID_SCHEDULES:
        return "daily"
    return schedule


def compute_next_run_at(schedule: str, from_time: datetime | None = None) -> datetime:
    base = from_time or datetime.now(timezone.utc)
    offsets = {
        "hourly": timedelta(hours=1),
        "daily": timedelta(days=1),
        "weekly": timedelta(days=7),
    }
    return base + offsets.get(normalize_schedule(schedule), timedelta(days=1))
