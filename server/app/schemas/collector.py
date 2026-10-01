"""Schemas used by the Windows CE collector (and any future client, e.g. Android)."""
import uuid
from datetime import datetime

from pydantic import Field, field_validator

from app.schemas.common import ApiModel


class LoginRequest(ApiModel):
    username: str = Field(min_length=1, max_length=150)
    password: str = Field(min_length=1, max_length=200)
    device_id: str | None = Field(default=None, max_length=40)


class LoginResponse(ApiModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user_id: uuid.UUID
    username: str
    full_name: str
    role: str
    device_id: str | None = None


class SessionOut(ApiModel):
    id: uuid.UUID
    name: str
    session_type: str
    status: str
    created_at: datetime
    closed_at: datetime | None = None


class ScanIn(ApiModel):
    client_scan_id: str = Field(min_length=8, max_length=100)
    device_id: str = Field(min_length=1, max_length=40)
    operator_id: uuid.UUID | None = None
    session_id: str | None = Field(default=None, max_length=64)
    barcode: str = Field(min_length=1)
    raw_barcode: str | None = None
    source: str = Field(default="WINDOWS_CE", max_length=30)
    scanned_at_device: datetime

    @field_validator("barcode")
    @classmethod
    def barcode_not_blank(cls, v: str) -> str:
        # Opaque value: never trimmed or normalized here, only rejected when blank.
        if not v.strip():
            raise ValueError("barcode must not be blank")
        return v


class ScanResult(ApiModel):
    accepted: bool
    # KNOWN | UNKNOWN | DUPLICATE | SESSION_CLOSED | SESSION_NOT_FOUND | REJECTED | ERROR
    result: str
    client_scan_id: str
    server_scan_id: uuid.UUID | None = None
    barcode: str | None = None
    barcode_status: str | None = None
    # Product identity = first 10 characters of the reading
    product_code: str | None = None
    item_name: str | None = None
    # Stock of this product after the scan (known products only)
    current_stock: int | None = None
    # Loads that became READY because of this scan
    newly_ready_loads: int | None = None
    sync_state: str | None = None
    server_timestamp: datetime | None = None
    # True when this clientScanId had already been stored (idempotent resend)
    replayed: bool = False
    error: str | None = None
    message: str | None = None


class ScanBatchIn(ApiModel):
    scans: list[ScanIn] = Field(min_length=1)


class ScanBatchOut(ApiModel):
    results: list[ScanResult]


class ItemLookupOut(ApiModel):
    barcode: str
    status: str
    item_id: uuid.UUID | None = None
    item_name: str | None = None
    sku: str | None = None


class DeviceConfigOut(ApiModel):
    device_id: str
    device_name: str
    status: str
    sync_interval_seconds: int
    duplicate_window_seconds: int
    server_time: datetime


class HeartbeatIn(ApiModel):
    device_id: str = Field(min_length=1, max_length=40)
    app_version: str | None = Field(default=None, max_length=40)
    operator_id: uuid.UUID | None = None
    battery_level: int | None = Field(default=None, ge=0, le=100)
    pending_scans: int | None = Field(default=None, ge=0)
    timestamp: datetime | None = None


class HeartbeatOut(ApiModel):
    ok: bool
    server_time: datetime
    device_status: str
