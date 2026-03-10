from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config

from app.core.config import get_settings
from app.db.base import Base
from app.db.session import engine


logger = logging.getLogger(__name__)


def _build_alembic_config() -> Config:
    service_root = Path(__file__).resolve().parents[2]
    config = Config(str(service_root / "alembic.ini"))
    config.set_main_option("script_location", str(service_root / "alembic"))
    config.set_main_option("sqlalchemy.url", get_settings().database_url)
    return config


def prepare_database() -> None:
    settings = get_settings()

    if settings.auto_apply_schema:
        try:
            command.upgrade(_build_alembic_config(), "head")
            logger.info("Database migrations applied successfully.")
            return
        except Exception as exc:  # pragma: no cover - fallback safety for production startup
            logger.warning("Alembic upgrade failed; falling back to create_all compatibility mode: %s", exc)

    Base.metadata.create_all(bind=engine)
    logger.info("Database schema ensured with SQLAlchemy create_all fallback.")
