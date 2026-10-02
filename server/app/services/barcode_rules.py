"""Production barcode rules for programming-scoped collection.

The production label carries a large barcode whose first 10 characters are the product code (cProd); the
rest is preserved as raw text and never parsed (its full format is not confirmed). The small EAN of the same
label must never add production stock:

1. a value equal to any imported EAN (items.ean / invoice_items.ean) -> WRONG_BARCODE
2. product code required by the programming                           -> collected
3. GTIN-shaped value (8/12/13/14 digits, valid check digit)          -> WRONG_BARCODE
4. anything else                                                     -> NOT_IN_PROGRAM
"""
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import InvoiceItem, Item, Load, LoadItem

WRONG_BARCODE = "WRONG_BARCODE"
NOT_IN_PROGRAM = "NOT_IN_PROGRAM"

GTIN_LENGTHS = (8, 12, 13, 14)


def is_gtin(value: str) -> bool:
    """EAN-8 / UPC-A / EAN-13 / GTIN-14 with a valid check digit."""
    v = (value or "").strip()
    if len(v) not in GTIN_LENGTHS or not v.isdigit():
        return False
    body, check = v[:-1], int(v[-1])
    total = sum(int(d) * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return (10 - total % 10) % 10 == check


def known_eans(db: Session) -> set[str]:
    values = set(db.scalars(select(Item.ean).where(Item.ean.is_not(None))))
    values.update(db.scalars(select(InvoiceItem.ean).where(InvoiceItem.ean.is_not(None)).distinct()))
    return {v.strip() for v in values if v and v.strip()}


def is_known_ean(db: Session, value: str) -> bool:
    v = (value or "").strip()
    if not v:
        return False
    return db.scalar(select(Item.id).where(Item.ean == v).limit(1)) is not None or \
        db.scalar(select(InvoiceItem.id).where(InvoiceItem.ean == v).limit(1)) is not None


def programming_product_codes(db: Session, programming_id: uuid.UUID) -> set[str]:
    """Product codes required by any load of the programming."""
    return set(db.scalars(
        select(Item.sku).join(LoadItem, LoadItem.product_id == Item.id).join(Load, Load.id == LoadItem.load_id)
        .where(Load.programming_id == programming_id, Item.sku.is_not(None)).distinct()))


def programming_has_product(db: Session, programming_id: uuid.UUID, product_id: uuid.UUID) -> bool:
    return db.scalar(select(LoadItem.id).join(Load, Load.id == LoadItem.load_id).where(
        Load.programming_id == programming_id, LoadItem.product_id == product_id).limit(1)) is not None


def classify(db: Session, raw: str, product: Item | None, programming_id: uuid.UUID | None) -> str | None:
    """Rejection state for a programming scan, or None when it may be collected.
    programming_id None = programming unknown to the server (its own conflict handles it)."""
    if is_known_ean(db, raw):
        return WRONG_BARCODE
    in_program = product is not None and programming_id is not None and \
        programming_has_product(db, programming_id, product.id)
    if in_program:
        return None
    if is_gtin(raw):
        return WRONG_BARCODE
    return NOT_IN_PROGRAM if programming_id is not None else None
