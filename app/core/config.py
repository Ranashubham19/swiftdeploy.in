from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "AI Internet Worker"
    environment: str = "development"
    api_v1_prefix: str = "/api/v1"
    service_role: str = "api"
    app_log_level: str = "INFO"

    secret_key: str = "change-this-secret-key"
    internal_service_token: str = "change-this-internal-token"
    access_token_expire_minutes: int = 60 * 24

    database_url: str = "postgresql+psycopg2://worker:worker@postgres:5432/ai_internet_worker"
    auto_apply_schema: bool = True
    redis_url: str = "redis://redis:6379/0"

    allowed_origins: str = (
        "http://localhost:3000,"
        "http://localhost:5173,"
        "https://swift-deploy.in"
    )

    openai_api_key: str | None = None
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4.1-mini"

    celery_task_always_eager: bool = False
    celery_result_expires_seconds: int = 3600
    inprocess_scheduler_enabled: bool = False
    inprocess_scheduler_interval_seconds: int = 60
    celery_worker_log_level: str = "info"
    celery_worker_concurrency: int = 2

    browser_headless: bool = True
    browser_timeout_ms: int = 20000
    browser_user_agent: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    )

    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_use_tls: bool = True
    notification_email_from: str | None = None

    telegram_bot_token: str | None = None
    telegram_default_chat_id: str | None = None

    @property
    def allowed_origins_list(self) -> list[str]:
        return [item.strip() for item in self.allowed_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
