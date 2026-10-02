"""Schemas for NF-e import, loads, inventory and dispatch."""
import uuid
from datetime import date, datetime

from pydantic import Field, field_validator

from app.schemas.common import ApiModel


class ImportIssue(ApiModel):
    file: str
    code: str
    message: str


class ImportWarning(ImportIssue):
    access_key: str | None = None
    load: str | None = None


class ImportReportOut(ApiModel):
    files_processed: int
    xml_accepted: int
    duplicates_skipped: int
    invoices_imported: int
    products_created: int
    products_updated: int
    loads_created: list[str]
    loads_updated: list[str]
    ignored_files: list[str]
    invalid: list[ImportIssue]
    warnings: list[ImportWarning]


class LoadSummaryOut(ApiModel):
    id: uuid.UUID
    external_code: str
    # PENDING | READY | DISPATCHED (READY is computed from current stock)
    status: str
    needs_review: bool
    # PREVISTO / COBERTO (= available_volumes, kept for compatibility) / DISPONÍVEL (shared stock) / FALTA
    required_volumes: int
    available_volumes: int
    covered_volumes: int = 0
    stock_volumes: int = 0
    missing_volumes: int
    progress: int
    product_lines: int
    programming_id: uuid.UUID | None = None
    invoice_count: int = 0
    customer_count: int = 0
    warning_invoices: int = 0
    imported_at: datetime
    dispatched_at: datetime | None = None
    dispatched_by_name: str | None = None


class LoadRequirementOut(ApiModel):
    id: uuid.UUID
    product_code: str | None
    description: str
    unit: str | None
    required_quantity: int | None
    commercial_quantity: float
    stock: int
    available: int
    missing: int
    needs_review: bool
    review_reason: str | None = None
    resolution_note: str | None = None
    resolved_at: datetime | None = None


class InvoiceLineOut(ApiModel):
    line_number: int
    product_code: str
    description: str | None
    ean: str | None
    unit: str | None
    quantity: float
    discrete: bool


class InvoiceOut(ApiModel):
    id: uuid.UUID
    access_key: str
    invoice_number: str | None
    issued_at: datetime | None
    customer_name: str | None
    customer_document: str | None
    city: str | None
    state: str | None
    order_number: str | None
    external_customer_code: str | None
    volume_count: float | None
    volume_species: str | None
    source_file_name: str | None
    warnings: list[dict] = []
    lines: list[InvoiceLineOut] = []


class MovementOut(ApiModel):
    id: uuid.UUID
    product_code: str | None
    description: str
    type: str
    quantity: int
    reason: str | None
    device_id: str | None
    created_by_name: str | None
    created_at: datetime
    load_id: uuid.UUID | None
    scan_id: uuid.UUID | None


class LoadDetailOut(LoadSummaryOut):
    requirements: list[LoadRequirementOut]
    invoices: list[InvoiceOut]
    dispatch_movements: list[MovementOut]


class ResolveItemIn(ApiModel):
    required_quantity: int = Field(ge=1, le=100_000)
    note: str | None = Field(default=None, max_length=500)


class InventoryRowOut(ApiModel):
    product_code: str
    description: str
    unit: str | None
    ean: str | None
    quantity: int
    last_in_at: datetime | None
    last_out_at: datetime | None


class InventoryMovementsOut(ApiModel):
    product_code: str
    description: str
    quantity: int
    movements: list[MovementOut]


class AdjustmentIn(ApiModel):
    product_code: str = Field(min_length=1, max_length=80)
    quantity: int = Field(ge=-100_000, le=100_000)
    reason: str = Field(min_length=3, max_length=500)
    # Production stock bucket to adjust (None = legacy global stock)
    programming_id: uuid.UUID | None = None

    @field_validator("quantity")
    @classmethod
    def _nonzero(cls, v: int) -> int:
        if v == 0:
            raise ValueError("quantity must not be zero")
        return v


class AdjustmentOut(ApiModel):
    product_code: str
    quantity: int


class DispatchOut(ApiModel):
    load_id: uuid.UUID
    external_code: str
    dispatched_at: datetime | None
    dispatched_by_name: str | None
    volumes: int
    product_lines: int


class UnknownCodeOut(ApiModel):
    product_code: str
    occurrences: int
    first_seen_at: datetime
    last_seen_at: datetime
    last_raw_barcode: str | None
    last_device_id: str | None
    last_operator_name: str | None


class ProgrammingIn(ApiModel):
    scheduled_date: date
    name: str | None = Field(default=None, max_length=150)


class ProgrammingOut(ApiModel):
    id: uuid.UUID
    scheduled_date: date
    name: str | None
    status: str
    created_at: datetime
    closed_at: datetime | None = None
    load_count: int = 0
    ready_count: int = 0
    pending_count: int = 0
    review_count: int = 0
    dispatched_count: int = 0
    volumes_registered: int = 0
    warning_invoices: int = 0
    # Loads still to dispatch: PREVISTO / COBERTO / FALTA and coverage %
    required_volumes: int = 0
    covered_volumes: int = 0
    missing_volumes: int = 0
    progress: int = 0
    stock_volumes: int = 0


class ProductCoverageOut(ApiModel):
    product_code: str | None
    description: str
    required: int
    covered: int
    stock: int
    missing: int
    dispatched: int
    open_loads: int
    needs_review: bool
