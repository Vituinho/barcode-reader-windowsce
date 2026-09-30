"""Database entities.

String "enum" columns are plain VARCHARs so new business states can be added without
database enum migrations. Allowed values are listed as constants on each class.
"""
import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, CreatedAtMixin, new_uuid


class User(CreatedAtMixin, Base):
    __tablename__ = "users"
    ROLE_ADMIN = "ADMIN"
    ROLE_OPERATOR = "OPERATOR"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    username: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default=ROLE_OPERATOR)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)


class Device(CreatedAtMixin, Base):
    __tablename__ = "devices"
    STATUS_ACTIVE = "ACTIVE"
    STATUS_DISABLED = "DISABLED"

    # Business identifier configured on the handheld, e.g. GVT-CE-001
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=STATUS_ACTIVE)
    app_version: Mapped[str | None] = mapped_column(String(40))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_operator_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    last_ip: Mapped[str | None] = mapped_column(String(64))
    battery_level: Mapped[int | None] = mapped_column(Integer)
    pending_scans: Mapped[int | None] = mapped_column(Integer)
    clock_skew_seconds: Mapped[int | None] = mapped_column(Integer)
    # Per-device overrides; NULL means "use server default"
    sync_interval_seconds: Mapped[int | None] = mapped_column(Integer)
    duplicate_window_seconds: Mapped[int | None] = mapped_column(Integer)

    last_operator: Mapped[User | None] = relationship(lazy="joined")


class CollectionSession(CreatedAtMixin, Base):
    __tablename__ = "collection_sessions"
    STATUS_OPEN = "OPEN"
    STATUS_CLOSED = "CLOSED"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    # GENERAL, RECEIVING, LOADING, SHIPPING, INVENTORY... (free text for future modules)
    session_type: Mapped[str] = mapped_column(String(40), nullable=False, default="GENERAL")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=STATUS_OPEN, index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class Item(CreatedAtMixin, Base):
    __tablename__ = "items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    sku: Mapped[str | None] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)


class Barcode(CreatedAtMixin, Base):
    """Registry of every barcode value ever seen or registered. Values are opaque text."""

    __tablename__ = "barcodes"
    STATUS_KNOWN = "KNOWN"
    STATUS_UNKNOWN = "UNKNOWN"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    code: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    item_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("items.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=STATUS_UNKNOWN, index=True)
    first_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    item: Mapped[Item | None] = relationship(lazy="joined")


class Scan(Base):
    __tablename__ = "scans"
    # Barcode classification when the scan was received
    RESULT_KNOWN = "KNOWN"
    RESULT_UNKNOWN = "UNKNOWN"
    # Business state of the stored record
    STATE_ACCEPTED = "ACCEPTED"
    STATE_DUPLICATE = "DUPLICATE"
    STATE_SESSION_CLOSED = "SESSION_CLOSED"
    STATE_SESSION_NOT_FOUND = "SESSION_NOT_FOUND"
    STATE_REJECTED = "REJECTED"
    CONFLICT_STATES = (STATE_SESSION_CLOSED, STATE_SESSION_NOT_FOUND)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    client_scan_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id"), nullable=False)
    operator_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    session_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("collection_sessions.id"))
    # Session id exactly as sent by the device (kept even if it could not be resolved)
    requested_session_id: Mapped[str | None] = mapped_column(String(64))
    barcode_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("barcodes.id"), nullable=False)
    raw_barcode: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(30), nullable=False, default="WINDOWS_CE")
    scanned_at_device: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at_server: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    result: Mapped[str] = mapped_column(String(20), nullable=False)
    sync_state: Mapped[str] = mapped_column(String(30), nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    resolution_note: Mapped[str | None] = mapped_column(Text)

    barcode: Mapped[Barcode] = relationship(lazy="joined")
    operator: Mapped[User | None] = relationship(foreign_keys=[operator_id], lazy="joined")
    session: Mapped[CollectionSession | None] = relationship(lazy="joined")

    __table_args__ = (
        # Duplicate-window lookup
        Index("ix_scans_dup_lookup", "device_id", "barcode_id", "scanned_at_device"),
        Index("ix_scans_session", "session_id", "received_at_server"),
        Index("ix_scans_received", "received_at_server"),
        Index("ix_scans_sync_state", "sync_state"),
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    device_id: Mapped[str | None] = mapped_column(String(40))
    action: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    entity_type: Mapped[str | None] = mapped_column(String(40))
    entity_id: Mapped[str | None] = mapped_column(String(100))
    details: Mapped[dict | None] = mapped_column(JSON)
