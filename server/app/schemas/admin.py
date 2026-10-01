"""Schemas used by the admin web panel."""
import uuid
from datetime import datetime

from pydantic import Field

from app.schemas.common import ApiModel


class UserOut(ApiModel):
    id: uuid.UUID
    username: str
    full_name: str
    role: str
    is_active: bool
    created_at: datetime


class UserCreate(ApiModel):
    username: str = Field(min_length=1, max_length=150)
    full_name: str = Field(min_length=1, max_length=150)
    password: str = Field(min_length=6, max_length=200)
    role: str = Field(default="OPERATOR", pattern="^(ADMIN|OPERATOR)$")


class UserUpdate(ApiModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=150)
    password: str | None = Field(default=None, min_length=6, max_length=200)
    role: str | None = Field(default=None, pattern="^(ADMIN|OPERATOR)$")
    is_active: bool | None = None


class DeviceOut(ApiModel):
    id: str
    name: str
    status: str
    # ONLINE | OFFLINE | DISABLED, derived from the last heartbeat age
    connectivity: str
    app_version: str | None = None
    last_seen_at: datetime | None = None
    last_seen_age_seconds: int | None = None
    last_operator_name: str | None = None
    last_ip: str | None = None
    battery_level: int | None = None
    pending_scans: int | None = None
    clock_skew_seconds: int | None = None
    sync_interval_seconds: int | None = None
    duplicate_window_seconds: int | None = None
    created_at: datetime


class DeviceCreate(ApiModel):
    id: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9._-]+$")
    name: str = Field(min_length=1, max_length=100)


class DeviceUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    status: str | None = Field(default=None, pattern="^(ACTIVE|DISABLED)$")
    sync_interval_seconds: int | None = Field(default=None, ge=1, le=3600)
    duplicate_window_seconds: int | None = Field(default=None, ge=0, le=3600)


class SessionAdminOut(ApiModel):
    id: uuid.UUID
    name: str
    session_type: str
    status: str
    notes: str | None = None
    created_at: datetime
    closed_at: datetime | None = None
    scan_count: int = 0
    conflict_count: int = 0


class SessionCreate(ApiModel):
    name: str = Field(min_length=1, max_length=150)
    session_type: str = Field(default="GENERAL", max_length=40)
    notes: str | None = None


class ItemOut(ApiModel):
    id: uuid.UUID
    sku: str | None = None
    name: str
    description: str | None = None
    is_active: bool
    created_at: datetime
    barcodes: list[str] = []


class ItemCreate(ApiModel):
    sku: str | None = Field(default=None, max_length=80)
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    barcodes: list[str] = []


class ItemUpdate(ApiModel):
    sku: str | None = Field(default=None, max_length=80)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    is_active: bool | None = None


class BarcodeOut(ApiModel):
    id: uuid.UUID
    code: str
    status: str
    item_id: uuid.UUID | None = None
    item_name: str | None = None
    first_seen_at: datetime | None = None
    last_seen_at: datetime | None = None
    scan_count: int = 0


class BarcodeAssign(ApiModel):
    item_id: uuid.UUID | None = None


class ScanOut(ApiModel):
    id: uuid.UUID
    client_scan_id: str
    device_id: str
    operator_id: uuid.UUID | None = None
    operator_name: str | None = None
    session_id: uuid.UUID | None = None
    session_name: str | None = None
    requested_session_id: str | None = None
    barcode: str
    raw_barcode: str
    barcode_status: str
    product_code: str | None = None
    item_name: str | None = None
    result: str
    sync_state: str
    source: str
    scanned_at_device: datetime
    received_at_server: datetime
    resolved_at: datetime | None = None
    resolution_note: str | None = None


class ScanPage(ApiModel):
    total: int
    items: list[ScanOut]


class ScanResolve(ApiModel):
    action: str = Field(pattern="^(ACCEPT|REJECT)$")
    note: str | None = Field(default=None, max_length=1000)


class ReadyLoad(ApiModel):
    id: uuid.UUID
    external_code: str
    volumes: int


class DashboardOut(ApiModel):
    scans_today: int
    unknown_scans_today: int
    unknown_barcodes: int
    conflicts_open: int
    open_sessions: int
    devices_online: int
    devices_offline: int
    devices_disabled: int
    stock_total: int = 0
    loads_pending: int = 0
    loads_ready: int = 0
    loads_review: int = 0
    loads_dispatched_today: int = 0
    ready_loads: list[ReadyLoad] = []
    server_time: datetime
