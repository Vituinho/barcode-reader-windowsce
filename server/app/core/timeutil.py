from datetime import datetime, timezone

from app.core.config import get_settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def device_time_to_utc(value: datetime) -> datetime:
    """Collectors send local wall-clock time without offset; interpret it in APP_TIMEZONE."""
    if value.tzinfo is None:
        value = value.replace(tzinfo=get_settings().tz)
    return value.astimezone(timezone.utc)


def local_day_start_utc() -> datetime:
    tz = get_settings().tz
    now_local = datetime.now(tz)
    return now_local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
