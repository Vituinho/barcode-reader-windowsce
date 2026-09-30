"""Items and the barcode registry."""
import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import Conflict, NotFound
from app.models import Barcode, Item
from app.repositories.repos import AuditRepo, BarcodeRepo, ItemRepo
from app.schemas.admin import BarcodeOut, ItemCreate, ItemOut, ItemUpdate
from app.schemas.collector import ItemLookupOut
from app.services.auth_service import AuthContext


def lookup(db: Session, code: str) -> ItemLookupOut:
    barcode = BarcodeRepo(db).by_code(code)
    if barcode is None or barcode.item is None:
        return ItemLookupOut(barcode=code, status=Barcode.STATUS_UNKNOWN)
    return ItemLookupOut(barcode=code, status=Barcode.STATUS_KNOWN, item_id=barcode.item.id,
                         item_name=barcode.item.name, sku=barcode.item.sku)


def _item_out(item: Item, codes: list[str]) -> ItemOut:
    return ItemOut(id=item.id, sku=item.sku, name=item.name, description=item.description,
                   is_active=item.is_active, created_at=item.created_at, barcodes=codes)


def list_items(db: Session, q: str | None) -> list[ItemOut]:
    repo = ItemRepo(db)
    items = repo.list(q)
    codes = repo.barcodes_for([i.id for i in items])
    return [_item_out(i, codes[i.id]) for i in items]


def _assign(db: Session, barcode: Barcode, item: Item | None) -> None:
    barcode.item_id = item.id if item else None
    barcode.item = item
    barcode.status = Barcode.STATUS_KNOWN if item else Barcode.STATUS_UNKNOWN


def create_item(db: Session, data: ItemCreate, auth: AuthContext) -> ItemOut:
    item = Item(sku=data.sku or None, name=data.name, description=data.description)
    db.add(item)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise Conflict("SKU_EXISTS", "SKU já cadastrado")
    barcodes = BarcodeRepo(db)
    for code in data.barcodes:
        if not code.strip():
            continue
        barcode = barcodes.get_or_create(code, None)
        if barcode.item_id and barcode.item_id != item.id:
            db.rollback()
            raise Conflict("BARCODE_ASSIGNED", f"Código {code} já pertence a outro item")
        _assign(db, barcode, item)
    AuditRepo(db).add("ITEM_CREATED", actor_user_id=auth.user.id, entity_type="item", entity_id=str(item.id))
    db.commit()
    return _item_out(item, [c for c in data.barcodes if c.strip()])


def update_item(db: Session, item_id: uuid.UUID, data: ItemUpdate, auth: AuthContext) -> ItemOut:
    repo = ItemRepo(db)
    item = repo.get(item_id)
    if item is None:
        raise NotFound("ITEM_NOT_FOUND")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(item, field, value)
    AuditRepo(db).add("ITEM_UPDATED", actor_user_id=auth.user.id, entity_type="item", entity_id=str(item.id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise Conflict("SKU_EXISTS", "SKU já cadastrado")
    return _item_out(item, repo.barcodes_for([item.id])[item.id])


def list_barcodes(db: Session, status: str | None, q: str | None) -> list[BarcodeOut]:
    return [
        BarcodeOut(id=b.id, code=b.code, status=b.status, item_id=b.item_id,
                   item_name=b.item.name if b.item else None, first_seen_at=b.first_seen_at,
                   last_seen_at=b.last_seen_at, scan_count=n)
        for b, n in BarcodeRepo(db).list(status, q)
    ]


def assign_barcode(db: Session, barcode_id: uuid.UUID, item_id: uuid.UUID | None, auth: AuthContext) -> BarcodeOut:
    """Identifying an UNKNOWN barcode: past scans resolve to the item through the relation."""
    barcode = BarcodeRepo(db).get(barcode_id)
    if barcode is None:
        raise NotFound("BARCODE_NOT_FOUND")
    item = None
    if item_id is not None:
        item = ItemRepo(db).get(item_id)
        if item is None:
            raise NotFound("ITEM_NOT_FOUND")
    previous = str(barcode.item_id) if barcode.item_id else None
    _assign(db, barcode, item)
    AuditRepo(db).add("BARCODE_ASSIGNED", actor_user_id=auth.user.id, entity_type="barcode",
                      entity_id=str(barcode.id),
                      details={"code": barcode.code, "from": previous, "to": str(item_id) if item_id else None})
    db.commit()
    return BarcodeOut(id=barcode.id, code=barcode.code, status=barcode.status, item_id=barcode.item_id,
                      item_name=item.name if item else None, first_seen_at=barcode.first_seen_at,
                      last_seen_at=barcode.last_seen_at)
