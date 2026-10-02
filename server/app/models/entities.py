"""Database entities.

String "enum" columns are plain VARCHARs so new business states can be added without
database enum migrations. Allowed values are listed as constants on each class.
"""
import uuid
from datetime import datetime

from datetime import date
from decimal import Decimal

from sqlalchemy import (JSON, BigInteger, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text,
                        UniqueConstraint, Uuid, func, text)
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
    """Product. `sku` is the product code (NF-e cProd) matched against the first 10 scanned characters.
    EAN is optional metadata only and never used for identification."""

    __tablename__ = "items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    sku: Mapped[str | None] = mapped_column(String(80), unique=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    unit: Mapped[str | None] = mapped_column(String(10))
    ean: Mapped[str | None] = mapped_column(String(14))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


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
    # Programming-scoped production scans
    STATE_PROGRAMMING_CLOSED = "PROGRAMMING_CLOSED"  # synced after the programming was closed: review
    STATE_PROGRAMMING_NOT_FOUND = "PROGRAMMING_NOT_FOUND"
    # Final production-rule refusals: stored for audit, never add stock, not resolvable into stock
    STATE_WRONG_BARCODE = "WRONG_BARCODE"  # EAN / small label code instead of the large production code
    STATE_NOT_IN_PROGRAM = "NOT_IN_PROGRAM"  # product not required by the selected programming
    CONFLICT_STATES = (STATE_SESSION_CLOSED, STATE_SESSION_NOT_FOUND, STATE_PROGRAMMING_CLOSED,
                       STATE_PROGRAMMING_NOT_FOUND)

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

    # First 10 characters of the scanned value (product code); NULL for scans older than this rule
    product_code: Mapped[str | None] = mapped_column(String(64), index=True)
    product_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("items.id"))
    # Programming selected on the collector when the label was read (kept even for rejected readings)
    programming_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("load_programmings.id"), index=True)

    barcode: Mapped[Barcode] = relationship(lazy="joined")
    operator: Mapped[User | None] = relationship(foreign_keys=[operator_id], lazy="joined")
    session: Mapped[CollectionSession | None] = relationship(lazy="joined")
    product: Mapped[Item | None] = relationship(lazy="joined")

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


class SoftwareRelease(Base):
    """Release manifest for downloadable collector software. Binaries are hosted externally (downloadUrl)."""

    __tablename__ = "software_releases"
    PLATFORM_WINDOWS_CE = "WINDOWS_CE"
    PLATFORM_WINDOWS_DESKTOP = "WINDOWS_DESKTOP"
    PLATFORMS = (PLATFORM_WINDOWS_CE, PLATFORM_WINDOWS_DESKTOP)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    platform: Mapped[str] = mapped_column(String(30), nullable=False)
    version: Mapped[str] = mapped_column(String(20), nullable=False)
    file_name: Mapped[str] = mapped_column(String(120), nullable=False)
    download_url: Mapped[str] = mapped_column(String(1000), nullable=False)
    sha256: Mapped[str | None] = mapped_column(String(64))
    file_size: Mapped[int | None] = mapped_column(BigInteger)
    release_notes: Mapped[str | None] = mapped_column(Text)
    released_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    active: Mapped[bool] = mapped_column(default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("platform", "version", name="uq_software_releases_platform_version"),
        # At most one current (active) release per platform.
        Index("uq_software_releases_active_platform", "platform", unique=True,
              postgresql_where=text("active")),
    )


class LoadProgramming(Base):
    """Programação de cargas: a production day. NF-e archives are imported into it, production scans are
    collected for it, and its production stock only covers loads of the same programming."""

    __tablename__ = "load_programmings"
    STATUS_OPEN = "OPEN"
    STATUS_CLOSED = "CLOSED"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    scheduled_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(150))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=STATUS_OPEN, index=True)
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Load(Base):
    """Load / route (Carga) defined by imported NF-e XMLs. READY is computed from stock, never stored."""

    __tablename__ = "loads"
    STATUS_PENDING = "PENDING"
    STATUS_READY = "READY"  # computed only
    STATUS_DISPATCHED = "DISPATCHED"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    external_code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    # NULL only for loads imported before programmings existed (legacy global stock)
    programming_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("load_programmings.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=STATUS_PENDING, index=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    dispatched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dispatched_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    dispatched_by: Mapped[User | None] = relationship(lazy="joined")


class Invoice(Base):
    """Imported NF-e. The access key (chave de acesso) makes imports idempotent."""

    __tablename__ = "invoices"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    access_key: Mapped[str] = mapped_column(String(44), unique=True, nullable=False)
    invoice_number: Mapped[str | None] = mapped_column(String(20))
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    load_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("loads.id"), nullable=False, index=True)
    customer_name: Mapped[str | None] = mapped_column(String(200))
    customer_document: Mapped[str | None] = mapped_column(String(20))
    city: Mapped[str | None] = mapped_column(String(100))
    state: Mapped[str | None] = mapped_column(String(2))
    order_number: Mapped[str | None] = mapped_column(String(40))
    external_customer_code: Mapped[str | None] = mapped_column(String(40))
    volume_count: Mapped[Decimal | None] = mapped_column(Numeric(15, 4))
    volume_species: Mapped[str | None] = mapped_column(String(60))
    source_file_name: Mapped[str | None] = mapped_column(String(255))
    # Import warnings (list of {code, message}), e.g. NON_DISCRETE_UNIT, QVOL_MISMATCH
    warnings: Mapped[list | None] = mapped_column(JSON(none_as_null=True))
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    imported_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class InvoiceItem(Base):
    """NF-e product line exactly as in the XML (audit): qCom/uCom are never converted."""

    __tablename__ = "invoice_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    invoice_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("invoices.id"), nullable=False, index=True)
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("items.id"), nullable=False)
    product_code: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str | None] = mapped_column(String(200))
    ean: Mapped[str | None] = mapped_column(String(14))
    unit: Mapped[str | None] = mapped_column(String(10))
    quantity: Mapped[Decimal] = mapped_column(Numeric(15, 4), nullable=False)
    # True when quantity counts discrete units that match scanned volumes 1:1
    discrete: Mapped[bool] = mapped_column(nullable=False)


class LoadItem(Base):
    """Aggregated requirement of one product for one load. required_quantity is NULL while it cannot be
    derived safely (non-discrete unit / qVol mismatch) until an admin sets the physical volume count."""

    __tablename__ = "load_items"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    load_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("loads.id"), nullable=False, index=True)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("items.id"), nullable=False)
    required_quantity: Mapped[int | None] = mapped_column(Integer)
    commercial_quantity: Mapped[Decimal] = mapped_column(Numeric(15, 4), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(10))
    needs_review: Mapped[bool] = mapped_column(default=False, nullable=False)
    review_reason: Mapped[str | None] = mapped_column(String(200))
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    resolution_note: Mapped[str | None] = mapped_column(Text)

    product: Mapped[Item] = relationship(lazy="joined")

    __table_args__ = (
        UniqueConstraint("load_id", "product_id", name="uq_load_items_load_product"),
        CheckConstraint("required_quantity IS NULL OR required_quantity > 0", name="required_positive"),
    )


class InventoryMovement(Base):
    """Append-only stock ledger. quantity is signed (+in / -out)."""

    __tablename__ = "inventory_movements"
    SCAN_IN = "SCAN_IN"
    DISPATCH_OUT = "DISPATCH_OUT"
    ADJUSTMENT_IN = "ADJUSTMENT_IN"
    ADJUSTMENT_OUT = "ADJUSTMENT_OUT"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("items.id"), nullable=False)
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    # One scan produces at most one stock entry: offline retries never add stock twice
    scan_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("scans.id"), unique=True)
    # Production stock bucket (NULL = legacy global stock)
    programming_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("load_programmings.id"), index=True)
    load_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("loads.id"), index=True)
    reason: Mapped[str | None] = mapped_column(Text)
    device_id: Mapped[str | None] = mapped_column(String(40))
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    product: Mapped[Item] = relationship(lazy="joined")
    created_by: Mapped[User | None] = relationship(lazy="joined")

    __table_args__ = (
        Index("ix_inventory_movements_product_created", "product_id", "created_at"),
        CheckConstraint("quantity <> 0", name="quantity_nonzero"),
    )


class InventoryBalance(Base):
    """Current stock per (programming, product), updated in the same transaction as each movement. Rows are
    locked (SELECT ... FOR UPDATE) during dispatch; the CHECK makes negative stock impossible.
    programming_id NULL is the legacy global bucket."""

    __tablename__ = "inventory_balances"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=new_uuid)
    programming_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("load_programmings.id"))
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("items.id"), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_in_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_out_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint("quantity >= 0", name="non_negative"),
        # One row per product in the legacy bucket, one per (programming, product) otherwise
        Index("uq_inventory_balances_legacy_product", "product_id", unique=True,
              postgresql_where=text("programming_id IS NULL")),
        Index("uq_inventory_balances_programming_product", "programming_id", "product_id", unique=True,
              postgresql_where=text("programming_id IS NOT NULL")),
    )
