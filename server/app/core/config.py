from functools import lru_cache
from zoneinfo import ZoneInfo

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def normalize_database_url(url: str) -> str:
    """Railway/Heroku style URLs (postgres://, postgresql://) -> SQLAlchemy psycopg 3 driver URL."""
    url = url.strip()
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


class Settings(BaseSettings):
    """All configuration comes from environment variables (a local .env file is optional)."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = ""
    secret_key: str = ""
    access_token_expire_minutes: int = 720
    app_timezone: str = "America/Sao_Paulo"

    duplicate_window_seconds: int = 2
    device_sync_interval_seconds: int = 5
    device_online_threshold_seconds: int = 120
    auto_register_devices: bool = True

    # Exact origin(s) of the admin web panel, comma separated. Wildcards are refused.
    admin_web_origin: str = ""

    max_barcode_length: int = 512
    max_batch_size: int = 100

    seed_admin_password: str = ""
    seed_operator_password: str = ""

    @field_validator("database_url")
    @classmethod
    def _normalize_db(cls, v: str) -> str:
        return normalize_database_url(v)

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.app_timezone)

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [o.strip().rstrip("/") for o in self.admin_web_origin.split(",") if o.strip()]
        if any("*" in o for o in origins):
            raise RuntimeError("ADMIN_WEB_ORIGIN must list exact origins; wildcard CORS is not allowed")
        return origins


def load_database_url() -> str:
    """DATABASE_URL only (used by Alembic, which does not need SECRET_KEY)."""
    url = Settings().database_url
    if not url:
        raise RuntimeError("DATABASE_URL is not set. See server/.env.example")
    return url


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not set. See server/.env.example")
    if not settings.secret_key or len(settings.secret_key) < 16:
        raise RuntimeError("SECRET_KEY must be set (at least 16 characters). See server/.env.example")
    settings.cors_origin_list  # fail fast on wildcard origins
    return settings
