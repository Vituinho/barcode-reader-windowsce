"""NF-e import, loads, inventory and dispatch. Reads: any authenticated user. Writes: ADMIN only."""
import uuid

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import admin_auth, current_auth
from app.core.database import get_db
from app.core.errors import DomainError
from app.models import InventoryMovement
from app.schemas.logistics import (AdjustmentIn, AdjustmentOut, DispatchOut, ImportReportOut, InventoryMovementsOut,
                                   InventoryRowOut, InvoiceLineOut, InvoiceOut, LoadDetailOut, LoadRequirementOut,
                                   LoadSummaryOut, MovementOut, ResolveItemIn, UnknownCodeOut)
from app.services import admin_service, import_service, inventory_service, load_service, side_decoder
from app.services.auth_service import AuthContext
from app.services.load_service import LoadView

router = APIRouter()


def _summary(view: LoadView, stats: tuple[int, int, int] | None = None) -> dict:
    load = view.load
    required = view.required_total
    available = view.available_total
    n, customers, warned = stats or (0, 0, 0)
    return dict(
        id=load.id, external_code=load.external_code, status=view.status, needs_review=view.needs_review,
        required_volumes=required, available_volumes=available, covered_volumes=available,
        stock_volumes=view.stock_total, missing_volumes=view.missing_total, programming_id=load.programming_id,
        progress=100 if view.status == "DISPATCHED" else (int(available * 100 / required) if required else 0),
        product_lines=len(view.requirements), invoice_count=n, customer_count=customers, warning_invoices=warned,
        imported_at=load.imported_at, dispatched_at=load.dispatched_at,
        dispatched_by_name=load.dispatched_by.full_name if load.dispatched_by else None,
    )


def _movement(m: InventoryMovement) -> MovementOut:
    return MovementOut(id=m.id, product_code=m.product.sku, description=m.product.name, type=m.type,
                       quantity=m.quantity, reason=m.reason, device_id=m.device_id,
                       created_by_name=m.created_by.full_name if m.created_by else None, created_at=m.created_at,
                       load_id=m.load_id, scan_id=m.scan_id)


def _detail(db: Session, view: LoadView) -> LoadDetailOut:
    invoices = load_service.invoices_of(db, view.load.id)
    lines = load_service.invoice_lines(db, [i.id for i in invoices])
    stats = (len(invoices), len({i.customer_document for i in invoices}), sum(1 for i in invoices if i.warnings))
    return LoadDetailOut(
        **_summary(view, stats),
        requirements=[LoadRequirementOut(
            id=r.item.id, product_code=r.item.product.sku, description=r.item.product.name, unit=r.item.unit,
            required_quantity=r.required, commercial_quantity=float(r.item.commercial_quantity), stock=r.stock,
            available=r.available, missing=r.missing,
            needs_review=r.item.required_quantity is None or r.side_rule_pending,
            review_reason=side_decoder.SIDE_RULE_PENDING if r.side_rule_pending else r.item.review_reason,
            product_kind=r.item.product.product_kind, side_rule_pending=r.side_rule_pending, resolution_note=r.item.resolution_note,
            resolved_at=r.item.resolved_at) for r in view.requirements],
        invoices=[InvoiceOut(
            id=i.id, access_key=i.access_key, invoice_number=i.invoice_number, issued_at=i.issued_at,
            customer_name=i.customer_name, customer_document=i.customer_document, city=i.city, state=i.state,
            order_number=i.order_number, external_customer_code=i.external_customer_code,
            volume_count=float(i.volume_count) if i.volume_count is not None else None,
            volume_species=i.volume_species, source_file_name=i.source_file_name, warnings=i.warnings or [],
            lines=[InvoiceLineOut(line_number=l.line_number, product_code=l.product_code, description=l.description,
                                  ean=l.ean, unit=l.unit, quantity=float(l.quantity), discrete=l.discrete)
                   for l in lines[i.id]]) for i in invoices],
        dispatch_movements=[_movement(m) for m in load_service.dispatch_movements(db, view.load.id)],
    )


# ---- import -----------------------------------------------------------------------------------

@router.post("/api/import/xml", response_model=ImportReportOut)
def import_xml(files: list[UploadFile] = File(...), db: Session = Depends(get_db),
               auth: AuthContext = Depends(admin_auth)):
    uploads: list[tuple[str, bytes]] = []
    total = 0
    for f in files:
        data = f.file.read(import_service.MAX_REQUEST_BYTES + 1)
        total += len(data)
        if total > import_service.MAX_REQUEST_BYTES:
            raise DomainError("UPLOAD_TOO_LARGE", "Envio maior que 60 MB; divida em partes", status_code=413)
        uploads.append((f.filename or "arquivo", data))
    report = import_service.import_files(db, uploads, auth)
    return ImportReportOut(**report.__dict__)


# ---- loads ------------------------------------------------------------------------------------

@router.get("/api/loads", response_model=list[LoadSummaryOut])
def loads(status: str | None = Query(default=None, pattern="^(PENDING|READY|DISPATCHED|REVIEW)$"),
          q: str | None = None, programming_id: uuid.UUID | None = Query(default=None, alias="programmingId"),
          db: Session = Depends(get_db), _: AuthContext = Depends(current_auth)):
    views = load_service.list_views(db, status, q, programming_id=programming_id)
    stats = load_service.invoice_stats(db, [v.load.id for v in views])
    return [_summary(v, stats.get(v.load.id)) for v in views]


@router.get("/api/loads/{load_id}", response_model=LoadDetailOut)
def load_detail(load_id: uuid.UUID, db: Session = Depends(get_db), _: AuthContext = Depends(current_auth)):
    return _detail(db, load_service.get_view(db, load_id))


@router.post("/api/loads/{load_id}/dispatch", response_model=LoadDetailOut)
def dispatch_load(load_id: uuid.UUID, db: Session = Depends(get_db), auth: AuthContext = Depends(admin_auth)):
    load_service.dispatch(db, load_id, auth)
    return _detail(db, load_service.get_view(db, load_id))


@router.patch("/api/loads/{load_id}/items/{item_id}", response_model=LoadDetailOut)
def resolve_load_item(load_id: uuid.UUID, item_id: uuid.UUID, data: ResolveItemIn, db: Session = Depends(get_db),
                      auth: AuthContext = Depends(admin_auth)):
    view = load_service.resolve_item(db, load_id, item_id, data.required_quantity, data.note, auth)
    return _detail(db, view)


@router.get("/api/dispatches", response_model=list[DispatchOut])
def dispatches(db: Session = Depends(get_db), _: AuthContext = Depends(current_auth)):
    return [DispatchOut(load_id=load.id, external_code=load.external_code, dispatched_at=load.dispatched_at,
                        dispatched_by_name=load.dispatched_by.full_name if load.dispatched_by else None,
                        volumes=volumes, product_lines=lines)
            for load, volumes, lines in load_service.list_dispatches(db)]


# ---- inventory --------------------------------------------------------------------------------

@router.get("/api/inventory", response_model=list[InventoryRowOut])
def inventory(q: str | None = None, in_stock: bool = Query(default=False, alias="inStock"),
              programming_id: uuid.UUID | None = Query(default=None, alias="programmingId"),
              db: Session = Depends(get_db), _: AuthContext = Depends(current_auth)):
    return inventory_service.list_inventory(db, q, in_stock, programming_id=programming_id)


@router.get("/api/inventory/{product_code}/movements", response_model=InventoryMovementsOut)
def inventory_movements(product_code: str,
                        programming_id: uuid.UUID | None = Query(default=None, alias="programmingId"),
                        db: Session = Depends(get_db), _: AuthContext = Depends(admin_auth)):
    product, rows = inventory_service.movements(db, product_code, programming_id=programming_id)
    return InventoryMovementsOut(product_code=product.sku, description=product.name,
                                 quantity=inventory_service.total_of(db, product.id, programming_id),
                                 movements=[_movement(m) for m in rows])


@router.post("/api/inventory/adjustments", response_model=AdjustmentOut)
def inventory_adjustment(data: AdjustmentIn, db: Session = Depends(get_db), auth: AuthContext = Depends(admin_auth)):
    balance = inventory_service.adjust(db, data.product_code.strip(), data.quantity, data.reason, auth,
                                       programming_id=data.programming_id)
    return AdjustmentOut(product_code=data.product_code.strip(), quantity=balance)


@router.get("/api/admin/unknown-codes", response_model=list[UnknownCodeOut])
def unknown_codes(q: str | None = None, db: Session = Depends(get_db), _: AuthContext = Depends(admin_auth)):
    return admin_service.unknown_codes(db, q)
