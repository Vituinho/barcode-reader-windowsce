"""Software release manifest schemas. Metadata is validated/sanitized because it is shown to every user."""
import re
import uuid
from datetime import datetime
from urllib.parse import urlsplit

from pydantic import Field, field_validator

from app.schemas.common import ApiModel

SEMVER = r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$"
PLATFORM = r"^(WINDOWS_CE|WINDOWS_DESKTOP)$"
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def validate_download_url(url: str) -> str:
    url = url.strip()
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        raise ValueError("downloadUrl must be an absolute https:// URL")
    if parts.username or parts.password:
        raise ValueError("downloadUrl must not contain credentials")
    if any(c.isspace() for c in url):
        raise ValueError("downloadUrl must not contain spaces")
    return url


def validate_file_name(name: str) -> str:
    name = name.strip()
    # Plain file name only: never a filesystem path.
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,119}", name) or ".." in name:
        raise ValueError("fileName must be a plain file name (letters, digits, . _ -)")
    return name


def sanitize_notes(notes: str | None) -> str | None:
    if notes is None:
        return None
    notes = _CONTROL_CHARS.sub("", notes).strip()
    return notes or None


def normalize_sha256(value: str | None) -> str | None:
    if value is None or not value.strip():
        return None
    value = value.strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("sha256 must be 64 hexadecimal characters")
    return value


class ReleaseOut(ApiModel):
    id: uuid.UUID
    platform: str
    version: str
    file_name: str
    download_url: str
    sha256: str | None = None
    file_size: int | None = None
    release_notes: str | None = None
    released_at: datetime
    active: bool
    created_at: datetime
    updated_at: datetime


class LatestReleaseOut(ReleaseOut):
    # Filled when the caller passes ?currentVersion=x.y.z (future collector update check)
    update_available: bool | None = None


class ReleaseCreate(ApiModel):
    platform: str = Field(pattern=PLATFORM)
    version: str = Field(pattern=SEMVER, max_length=20)
    file_name: str = Field(max_length=120)
    download_url: str = Field(max_length=1000)
    sha256: str | None = None
    file_size: int | None = Field(default=None, ge=0, le=2_000_000_000)
    release_notes: str | None = Field(default=None, max_length=4000)
    released_at: datetime | None = None
    active: bool = False

    @field_validator("download_url")
    @classmethod
    def _url(cls, v: str) -> str:
        return validate_download_url(v)

    @field_validator("file_name")
    @classmethod
    def _name(cls, v: str) -> str:
        return validate_file_name(v)

    @field_validator("sha256")
    @classmethod
    def _sha(cls, v: str | None) -> str | None:
        return normalize_sha256(v)

    @field_validator("release_notes")
    @classmethod
    def _notes(cls, v: str | None) -> str | None:
        return sanitize_notes(v)


class ReleaseUpdate(ApiModel):
    version: str | None = Field(default=None, pattern=SEMVER, max_length=20)
    file_name: str | None = Field(default=None, max_length=120)
    download_url: str | None = Field(default=None, max_length=1000)
    sha256: str | None = None
    file_size: int | None = Field(default=None, ge=0, le=2_000_000_000)
    release_notes: str | None = Field(default=None, max_length=4000)
    released_at: datetime | None = None

    @field_validator("download_url")
    @classmethod
    def _url(cls, v: str | None) -> str | None:
        return None if v is None else validate_download_url(v)

    @field_validator("file_name")
    @classmethod
    def _name(cls, v: str | None) -> str | None:
        return None if v is None else validate_file_name(v)

    @field_validator("sha256")
    @classmethod
    def _sha(cls, v: str | None) -> str | None:
        return normalize_sha256(v)

    @field_validator("release_notes")
    @classmethod
    def _notes(cls, v: str | None) -> str | None:
        return sanitize_notes(v)
