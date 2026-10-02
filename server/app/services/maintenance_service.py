"""HOMOLOGATION / MAINTENANCE TOOL: reset operational data before real production use.

Removes load programmings, loads, invoices, invoice lines, load requirements, dispatches, stock (movements + balances), scans,
barcode records seen by scans, and products created by XML imports. Keeps users, devices, collection
sessions, software releases, audit log, and products that existed before any XML referenced them
(seed/manual catalog). One transaction; tables are locked against concurrent writes during the reset.
Can be disabled with ALLOW_OPERATIONAL_RESET=false.
"""
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import DomainError, Forbidden
from app.models import (Barcode, InventoryBalance, InventoryMovement, Invoice, InvoiceItem, Item, Load, LoadItem,
                        LoadProgramming, Scan)
from app.repositories.repos import AuditRepo
from app.services.auth_service import AuthContext

CONFIRMATION_TEXT = "RESETAR DADOS"


def reset_operational_data(db: Session, confirmation: str, auth: AuthContext) -> dict[str, int]:
    if not get_settings().allow_operational_reset:
        raise Forbidden("RESET_DISABLED", "Reset operacional desativado neste ambiente (ALLOW_OPERATIONAL_RESET)")
    if (confirmation or "").strip() != CONFIRMATION_TEXT:
        raise DomainError("CONFIRMATION_REQUIRED", f"Digite exatamente: {CONFIRMATION_TEXT}", status_code=422)

    # Block concurrent scans/imports/dispatches while the reset runs (released at commit/rollback).
    db.execute(text(
        "LOCK TABLE inventory_movements, inventory_balances, load_items, invoice_items, invoices, loads, "
        "scans, barcodes, items, load_programmings IN SHARE ROW EXCLUSIVE MODE"))

    # Products created by XML import: referenced by imported invoice lines and created no earlier than the first
    # import that referenced them (same transaction). Pre-existing seed/manual products are kept.
    first_import = (select(InvoiceItem.product_id, func.min(Invoice.imported_at).label("first_import"))
                    .join(Invoice, Invoice.id == InvoiceItem.invoice_id).group_by(InvoiceItem.product_id).subquery())
    imported_ids = list(db.scalars(select(Item.id).join(first_import, first_import.c.product_id == Item.id)
                                   .where(Item.created_at >= first_import.c.first_import)))

    counts: dict[str, int] = {}

    def run(name: str, stmt) -> None:
        counts[name] = db.execute(stmt).rowcount or 0

    # Children before parents (foreign keys).
    run("inventory_movements", delete(InventoryMovement))
    run("inventory_balances", delete(InventoryBalance))
    run("load_items", delete(LoadItem))
    run("invoice_items", delete(InvoiceItem))
    run("invoices", delete(Invoice))
    run("loads", delete(Load))
    run("scans", delete(Scan))
    run("programmings", delete(LoadProgramming))
    barcode_filter = Barcode.item_id.is_(None)
    if imported_ids:
        barcode_filter = barcode_filter | Barcode.item_id.in_(imported_ids)
    run("barcodes", delete(Barcode).where(barcode_filter))
    # Kept catalog barcodes: forget scan history.
    db.execute(update(Barcode).values(first_seen_at=None, last_seen_at=None))
    if imported_ids:
        run("products", delete(Item).where(Item.id.in_(imported_ids)))
    else:
        counts["products"] = 0

    AuditRepo(db).add("OPERATIONAL_DATA_RESET", actor_user_id=auth.user.id, entity_type="maintenance",
                      details=counts)
    db.commit()
    return counts
