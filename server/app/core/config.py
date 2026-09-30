from functools import lru_cache
from zoneinfo import ZoneInfo

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://givova:change-me@localhost:5432/givova"
    secret_key: str = ""
    access_token_expire_minutes: int = 720
    app_timezone: str = "America/Sao_Paulo"

    duplicate_window_seconds: int = 2
    device_sync_interval_seconds: int = 5
    device_online_threshold_seconds: int = 120
    auto_register_devices: bool = True

    cors_origins: str = "http://localhost:3000"

    max_barcode_length: int = 512
    max_batch_size: int = 100

    seed_admin_password: str = ""
    seed_operator_password: str = ""

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.app_timezone)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if not settings.secret_key or len(settings.secret_key) < 16:
        raise RuntimeError("SECRET_KEY must be set (at least 16 characters). See server/.env.example")
    return settings
