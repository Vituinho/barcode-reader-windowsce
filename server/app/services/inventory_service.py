"""Stock = append-only movement ledger + per-product balance row updated in the same transaction.

Every change goes through apply_movement(); balances are never edited directly. The balance row has a
CHECK (quantity >= 0) so negative stock is impossible even if a caller forgets to validate.
"""
import uuid
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.errors import Conflict, DomainError, NotFound
from app.core.timeutil import utcnow
from app.models import InventoryBalance, InventoryMovement, Item
from app.repositories.repos import AuditRepo
from app.services.auth_service import AuthContext

PRODUCT_CODE_LENGTH = 10


def normalize_product_code(raw: str) -> str | None:
    """Product identity = first 10 characters of the scanned value (surrounding whitespace trimmed).
    Never parsed as a number; leading zeroes and letters are kept. Shorter readings -> None (invalid)."""
    value = (raw or "").strip()
    if len(value) < PRODUCT_CODE_LENGTH:
        return None
    return value[:PRODUCT_CODE_LENGTH]


def product_by_code(db: Session, code: str) -> Item | None:
    return db.scalar(select(Item).where(Item.sku == code))


def balance_of(db: Session, product_id: uuid.UUID) -> int:
    return db.scalar(select(InventoryBalance.quantity).where(InventoryBalance.product_id == product_id)) or 0


def apply_movement(db: Session, product_id: uuid.UUID, movement_type: str, quantity: int, *,
                   scan_id: uuid.UUID | None = None, load_id: uuid.UUID | None = None, reason: str | None = None,
                   device_id: str | None = None, user_id: uuid.UUID | None = None,
                   now: datetime | None = None) -> int:
    """Adds a ledger row and updates the balance atomically (caller commits). Returns the new balance."""
    if quantity == 0:
        raise ValueError("movement quantity must not be zero")
    now = now or utcnow()
    db.add(InventoryMovement(product_id=product_id, type=movement_type, quantity=quantity, scan_id=scan_id,
                             load_id=load_id, reason=reason, device_id=device_id, created_by_id=user_id,
                             created_at=now))
    db.flush()
    if quantity < 0:
        # Plain UPDATE: an INSERT .. ON CONFLICT would evaluate CHECK (quantity >= 0) on the proposed
        # negative row first. The CHECK still rejects any update that would go below zero.
        new_quantity = db.execute(
            update(InventoryBalance).where(InventoryBalance.product_id == product_id)
            .values(quantity=InventoryBalance.quantity + quantity, last_out_at=now, updated_at=now)
            .returning(InventoryBalance.quantity)
        ).scalar_one_or_none()
        if new_quantity is None:
            raise Conflict("INSUFFICIENT_STOCK", "Produto sem estoque")
        return new_quantity
    stmt = (
        pg_insert(InventoryBalance)
        .values(product_id=product_id, quantity=quantity, last_in_at=now, updated_at=now)
        .on_conflict_do_update(
            index_elements=[InventoryBalance.product_id],
            set_={"quantity": InventoryBalance.quantity + quantity, "last_in_at": now, "updated_at": now},
        )
        .returning(InventoryBalance.quantity)
    )
    return db.execute(stmt).scalar_one()


def list_inventory(db: Session, q: str | None, only_in_stock: bool = False, limit: int = 500) -> list[dict]:
    stmt = (
        select(Item, InventoryBalance)
        .outerjoin(InventoryBalance, InventoryBalance.product_id == Item.id)
        .where(Item.sku.is_not(None))
        .order_by(func.coalesce(InventoryBalance.quantity, 0).desc(), Item.sku)
        .limit(limit)
    )
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(Item.sku.ilike(like) | Item.name.ilike(like))
    if only_in_stock:
        stmt = stmt.where(InventoryBalance.quantity > 0)
    return [
        {"product_id": item.id, "product_code": item.sku, "description": item.name, "unit": item.unit,
         "ean": item.ean, "quantity": bal.quantity if bal else 0,
         "last_in_at": bal.last_in_at if bal else None, "last_out_at": bal.last_out_at if bal else None}
        for item, bal in db.execute(stmt)
    ]


def movements(db: Session, product_code: str, limit: int = 200) -> tuple[Item, list[InventoryMovement]]:
    product = product_by_code(db, product_code)
    if product is None:
        raise NotFound("PRODUCT_NOT_FOUND", "Produto não encontrado")
    rows = db.scalars(select(InventoryMovement).where(InventoryMovement.product_id == product.id)
                      .order_by(InventoryMovement.created_at.desc()).limit(limit)).unique().all()
    return product, list(rows)


def adjust(db: Session, product_code: str, quantity: int, reason: str, auth: AuthContext) -> int:
    """Manual correction (ADMIN). Always a ledger movement with a mandatory reason."""
    reason = (reason or "").strip()
    if not reason:
        raise DomainError("REASON_REQUIRED", "Informe o motivo do ajuste", status_code=422)
    if quantity == 0:
        raise DomainError("INVALID_QUANTITY", "Quantidade deve ser diferente de zero", status_code=422)
    product = product_by_code(db, product_code)
    if product is None:
        raise NotFound("PRODUCT_NOT_FOUND", "Produto não encontrado")
    if quantity < 0:
        current = db.scalar(select(InventoryBalance.quantity).where(InventoryBalance.product_id == product.id)
                            .with_for_update()) or 0
        if current + quantity < 0:
            raise Conflict("INSUFFICIENT_STOCK", f"Estoque atual {current}: não é possível retirar {-quantity}")
    movement_type = InventoryMovement.ADJUSTMENT_IN if quantity > 0 else InventoryMovement.ADJUSTMENT_OUT
    new_balance = apply_movement(db, product.id, movement_type, quantity, reason=reason, user_id=auth.user.id)
    AuditRepo(db).add("INVENTORY_ADJUSTED", actor_user_id=auth.user.id, entity_type="product", entity_id=product.sku,
                      details={"quantity": quantity, "reason": reason, "balance": new_balance})
    db.commit()
    return new_balance
