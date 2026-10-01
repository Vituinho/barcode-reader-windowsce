"""Load readiness and dispatch.

Stock is shared and never reserved: every non-dispatched load is compared independently against current
stock, so several loads can be READY at once. Dispatch re-validates under row locks and consumes stock in
one transaction; the first dispatch wins and the others become PENDING again on the next read.
"""
import uuid
from dataclasses import dataclass, field

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, lazyload

from app.core.errors import Conflict, DomainError, NotFound
from app.core.timeutil import local_day_start_utc, utcnow
from app.models import InventoryBalance, InventoryMovement, Invoice, InvoiceItem, Load, LoadItem
from app.repositories.repos import AuditRepo
from app.services import inventory_service
from app.services.auth_service import AuthContext


@dataclass
class RequirementView:
    item: LoadItem
    stock: int

    @property
    def required(self) -> int | None:
        return self.item.required_quantity

    @property
    def available(self) -> int:
        return 0 if self.required is None else min(self.required, self.stock)

    @property
    def missing(self) -> int:
        return 0 if self.required is None else max(0, self.required - self.stock)


@dataclass
class LoadView:
    load: Load
    requirements: list[RequirementView] = field(default_factory=list)

    @property
    def needs_review(self) -> bool:
        return any(r.item.required_quantity is None for r in self.requirements)

    @property
    def required_total(self) -> int:
        return sum(r.required or 0 for r in self.requirements)

    @property
    def available_total(self) -> int:
        if self.load.status == Load.STATUS_DISPATCHED:
            return self.required_total
        return sum(r.available for r in self.requirements)

    @property
    def missing_total(self) -> int:
        return 0 if self.load.status == Load.STATUS_DISPATCHED else sum(r.missing for r in self.requirements)

    @property
    def status(self) -> str:
        if self.load.status == Load.STATUS_DISPATCHED:
            return Load.STATUS_DISPATCHED
        if self.requirements and not self.needs_review and self.missing_total == 0:
            return Load.STATUS_READY
        return Load.STATUS_PENDING


def build_views(db: Session, loads: list[Load]) -> list[LoadView]:
    if not loads:
        return []
    items = db.scalars(select(LoadItem).where(LoadItem.load_id.in_([l.id for l in loads]))).unique().all()
    product_ids = {i.product_id for i in items}
    stock = dict(db.execute(select(InventoryBalance.product_id, InventoryBalance.quantity)
                            .where(InventoryBalance.product_id.in_(product_ids))).all()) if product_ids else {}
    views = {l.id: LoadView(l) for l in loads}
    for item in items:
        views[item.load_id].requirements.append(RequirementView(item, stock.get(item.product_id, 0)))
    for v in views.values():
        v.requirements.sort(key=lambda r: (r.missing == 0, r.item.product.sku or ""))
    return [views[l.id] for l in loads]


def list_views(db: Session, status: str | None = None, q: str | None = None, limit: int = 500) -> list[LoadView]:
    stmt = select(Load).order_by(Load.status != Load.STATUS_PENDING, Load.external_code).limit(limit)
    if status == Load.STATUS_DISPATCHED:
        stmt = stmt.where(Load.status == Load.STATUS_DISPATCHED)
    elif status in (Load.STATUS_PENDING, Load.STATUS_READY, "REVIEW"):
        stmt = stmt.where(Load.status != Load.STATUS_DISPATCHED)
    if q:
        like = f"%{q.strip()}%"
        matching = select(Invoice.load_id).where(or_(Invoice.customer_name.ilike(like), Invoice.order_number.ilike(like),
                                                     Invoice.invoice_number.ilike(like), Invoice.city.ilike(like)))
        stmt = stmt.where(or_(Load.external_code.ilike(like), Load.id.in_(matching)))
    views = build_views(db, list(db.scalars(stmt).unique()))
    if status == "REVIEW":
        return [v for v in views if v.needs_review and v.load.status != Load.STATUS_DISPATCHED]
    if status in (Load.STATUS_PENDING, Load.STATUS_READY):
        return [v for v in views if v.status == status]
    return views


def invoice_stats(db: Session, load_ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[int, int, int]]:
    """load_id -> (invoices, customers, invoices with warnings)."""
    if not load_ids:
        return {}
    rows = db.execute(
        select(Invoice.load_id, func.count(), func.count(func.distinct(Invoice.customer_document)),
               func.count().filter(func.json_typeof(Invoice.warnings) == "array"))
        .where(Invoice.load_id.in_(load_ids)).group_by(Invoice.load_id)
    )
    return {lid: (n, c, w) for lid, n, c, w in rows}


def get_view(db: Session, load_id: uuid.UUID) -> LoadView:
    load = db.get(Load, load_id)
    if load is None:
        raise NotFound("LOAD_NOT_FOUND", "Carga não encontrada")
    return build_views(db, [load])[0]


def invoices_of(db: Session, load_id: uuid.UUID) -> list[Invoice]:
    return list(db.scalars(select(Invoice).where(Invoice.load_id == load_id).order_by(Invoice.invoice_number)))


def invoice_lines(db: Session, invoice_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[InvoiceItem]]:
    out: dict[uuid.UUID, list[InvoiceItem]] = {i: [] for i in invoice_ids}
    if invoice_ids:
        for line in db.scalars(select(InvoiceItem).where(InvoiceItem.invoice_id.in_(invoice_ids))
                               .order_by(InvoiceItem.line_number)):
            out[line.invoice_id].append(line)
    return out


def dispatch_movements(db: Session, load_id: uuid.UUID) -> list[InventoryMovement]:
    return list(db.scalars(select(InventoryMovement).where(InventoryMovement.load_id == load_id,
                                                           InventoryMovement.type == InventoryMovement.DISPATCH_OUT)
                           .order_by(InventoryMovement.created_at)).unique())


def newly_ready_count(db: Session, product_id: uuid.UUID, stock_after: int) -> int:
    """Loads that just became READY because this product's stock reached exactly what they need."""
    candidates = db.scalars(
        select(Load).join(LoadItem, LoadItem.load_id == Load.id)
        .where(Load.status == Load.STATUS_PENDING, LoadItem.product_id == product_id,
               LoadItem.required_quantity == stock_after)
    ).unique().all()
    return sum(1 for v in build_views(db, list(candidates)) if v.status == Load.STATUS_READY)


def dashboard_counts(db: Session) -> dict:
    open_views = list_views(db)
    open_views = [v for v in open_views if v.load.status != Load.STATUS_DISPATCHED]
    ready = [v for v in open_views if v.status == Load.STATUS_READY]
    dispatched_today = db.scalar(select(func.count()).select_from(Load).where(
        Load.status == Load.STATUS_DISPATCHED, Load.dispatched_at >= local_day_start_utc())) or 0
    stock_total = db.scalar(select(func.coalesce(func.sum(InventoryBalance.quantity), 0))) or 0
    return {
        "stock_total": int(stock_total),
        "loads_pending": len(open_views) - len(ready),
        "loads_ready": len(ready),
        "loads_review": sum(1 for v in open_views if v.needs_review),
        "loads_dispatched_today": dispatched_today,
        "ready_loads": [{"id": v.load.id, "external_code": v.load.external_code, "volumes": v.required_total}
                        for v in ready[:20]],
    }


def resolve_item(db: Session, load_id: uuid.UUID, item_id: uuid.UUID, required: int, note: str | None,
                 auth: AuthContext) -> LoadView:
    """ADMIN sets the physical volume count for a requirement whose quantity could not be derived from the XML."""
    item = db.get(LoadItem, item_id)
    if item is None or item.load_id != load_id:
        raise NotFound("LOAD_ITEM_NOT_FOUND")
    load = db.get(Load, load_id)
    if load.status == Load.STATUS_DISPATCHED:
        raise Conflict("LOAD_ALREADY_DISPATCHED", "Carga já expedida")
    if required <= 0:
        raise DomainError("INVALID_QUANTITY", "Quantidade de volumes deve ser maior que zero", status_code=422)
    previous = item.required_quantity
    item.required_quantity = required
    item.needs_review = False
    item.resolved_by_id = auth.user.id
    item.resolved_at = utcnow()
    item.resolution_note = (note or "").strip() or None
    AuditRepo(db).add("LOAD_ITEM_RESOLVED", actor_user_id=auth.user.id, entity_type="load_item", entity_id=str(item.id),
                      details={"load": load.external_code, "product": item.product.sku, "from": previous,
                               "to": required, "commercial": str(item.commercial_quantity), "unit": item.unit,
                               "note": item.resolution_note})
    db.commit()
    return get_view(db, load_id)


def dispatch(db: Session, load_id: uuid.UUID, auth: AuthContext) -> Load:
    """One transaction: lock load + balances (fixed order), re-validate, move stock out, mark dispatched."""
    load = db.scalars(select(Load).options(lazyload(Load.dispatched_by)).where(Load.id == load_id)
                      .with_for_update().execution_options(populate_existing=True)).first()
    if load is None:
        raise NotFound("LOAD_NOT_FOUND", "Carga não encontrada")
    try:
        if load.status == Load.STATUS_DISPATCHED:
            raise Conflict("LOAD_ALREADY_DISPATCHED", f"Carga {load.external_code} já foi expedida")
        items = list(db.scalars(select(LoadItem).where(LoadItem.load_id == load.id)).unique())
        if not items:
            raise Conflict("LOAD_EMPTY", "Carga sem produtos")
        if any(i.required_quantity is None for i in items):
            raise Conflict("LOAD_NEEDS_REVIEW", "Carga com quantidades a revisar (unidade não discreta)")

        product_ids = sorted({i.product_id for i in items}, key=str)
        balances = {b.product_id: b for b in db.scalars(
            select(InventoryBalance).where(InventoryBalance.product_id.in_(product_ids))
            .order_by(InventoryBalance.product_id).with_for_update().execution_options(populate_existing=True))}
        shortages = [f"{i.product.sku} (falta {i.required_quantity - (balances[i.product_id].quantity if i.product_id in balances else 0)})"
                     for i in items
                     if (balances[i.product_id].quantity if i.product_id in balances else 0) < i.required_quantity]
        if shortages:
            raise Conflict("LOAD_NO_LONGER_READY",
                           "Estoque mudou: carga não está mais pronta. Faltam: " + ", ".join(shortages[:10]))

        now = utcnow()
        for item in items:
            inventory_service.apply_movement(db, item.product_id, InventoryMovement.DISPATCH_OUT,
                                             -item.required_quantity, load_id=load.id, user_id=auth.user.id, now=now)
        load.status = Load.STATUS_DISPATCHED
        load.dispatched_at = now
        load.dispatched_by_id = auth.user.id
        AuditRepo(db).add("LOAD_DISPATCHED", actor_user_id=auth.user.id, entity_type="load", entity_id=str(load.id),
                          details={"load": load.external_code, "volumes": sum(i.required_quantity for i in items)})
        db.commit()
    except IntegrityError:
        # CHECK (quantity >= 0) fired: never leave a partial dispatch.
        db.rollback()
        raise Conflict("STOCK_CHANGED", "Estoque mudou durante a expedição; tente novamente")
    except Exception:
        db.rollback()
        raise
    db.refresh(load)
    return load


def list_dispatches(db: Session, limit: int = 200) -> list[tuple[Load, int, int]]:
    """(load, volumes removed, product lines) for dispatched loads, newest first."""
    totals = (select(InventoryMovement.load_id, func.sum(-InventoryMovement.quantity).label("volumes"),
                     func.count().label("lines"))
              .where(InventoryMovement.type == InventoryMovement.DISPATCH_OUT).group_by(InventoryMovement.load_id)
              .subquery())
    rows = db.execute(select(Load, func.coalesce(totals.c.volumes, 0), func.coalesce(totals.c.lines, 0))
                      .outerjoin(totals, totals.c.load_id == Load.id)
                      .where(Load.status == Load.STATUS_DISPATCHED)
                      .order_by(Load.dispatched_at.desc()).limit(limit)).unique()
    return [(load, int(v), int(n)) for load, v, n in rows]
