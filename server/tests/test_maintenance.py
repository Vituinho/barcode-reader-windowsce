"""Operational data reset (homologation tool)."""
from sqlalchemy import func, select

from app.core.config import get_settings
from app.models import (AuditLog, Barcode, CollectionSession, Device, InventoryBalance, InventoryMovement, Invoice,
                        InvoiceItem, Item, Load, LoadItem, Scan, SoftwareRelease, User)
from tests.test_logistics import load_by_code, nfe, scan, upload

URL = "/api/admin/maintenance/reset-operational-data"


def count(db, model) -> int:
    db.expire_all()
    return db.scalar(select(func.count()).select_from(model))


def populate(client, seed, op_headers, admin_headers):
    """Import a load, scan its volume (+ an unknown code), dispatch it, and add a release."""
    xml = nfe(load="231127", lines=(("6050647134", "BASE", "SEM GTIN", "UN", "1"),))
    upload(client, admin_headers, ("a.xml", xml))
    scan(client, seed, op_headers, "60506471342313480002")
    scan(client, seed, op_headers, "99999999992313480010")
    load = load_by_code(client, admin_headers, "231127")
    assert client.post(f"/api/loads/{load['id']}/dispatch", headers=admin_headers).status_code == 200
    client.post("/api/admin/releases", headers=admin_headers, json={
        "platform": "WINDOWS_DESKTOP", "version": "1.0.0", "fileName": "GivovaCollector-Simulator-v1.0.0.zip",
        "downloadUrl": "https://example.com/f.zip", "active": True})
    return xml


def test_reset_requires_admin_and_exact_confirmation(client, seed, op_headers, admin_headers, db):
    populate(client, seed, op_headers, admin_headers)
    assert client.post(URL, json={"confirmation": "RESETAR DADOS"}, headers=op_headers).status_code == 403
    assert client.get("/api/admin/maintenance", headers=op_headers).status_code == 403
    for wrong in ("", "resetar dados", "RESETAR"):
        r = client.post(URL, json={"confirmation": wrong}, headers=admin_headers)
        assert r.status_code == 422 and r.json()["error"] == "CONFIRMATION_REQUIRED"
    assert count(db, Load) == 1 and count(db, Scan) == 2 and count(db, InventoryMovement) == 2


def test_reset_removes_operational_data_and_keeps_configuration(client, seed, op_headers, admin_headers, db):
    xml = populate(client, seed, op_headers, admin_headers)
    before = {m: count(db, m) for m in (User, Device, CollectionSession, SoftwareRelease)}

    r = client.post(URL, json={"confirmation": "RESETAR DADOS"}, headers=admin_headers)
    assert r.status_code == 200, r.text
    deleted = r.json()["deleted"]
    assert deleted["loads"] == 1 and deleted["invoices"] == 1 and deleted["scans"] == 2
    assert deleted["inventory_movements"] == 2 and deleted["products"] == 1  # the XML product only

    for model in (Load, Invoice, InvoiceItem, LoadItem, InventoryMovement, InventoryBalance, Scan):
        assert count(db, model) == 0, model.__tablename__
    # Preserved: users, devices, sessions, releases, seed catalog product and its configured barcode.
    assert {m: count(db, m) for m in before} == before
    assert db.scalar(select(Item.sku)) == "7891234567"
    assert db.scalar(select(Barcode.code)) == "7891234567890"
    assert db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == "OPERATIONAL_DATA_RESET")) == 1

    # The previously dispatched load can be imported again from scratch.
    again = upload(client, admin_headers, ("a.xml", xml)).json()
    assert again["invoicesImported"] == 1 and again["loadsCreated"] == ["231127"] and not again["invalid"]
    assert load_by_code(client, admin_headers, "231127")["status"] == "PENDING"


def test_reset_can_be_disabled(client, seed, admin_headers, monkeypatch):
    monkeypatch.setattr(get_settings(), "allow_operational_reset", False)
    r = client.post(URL, json={"confirmation": "RESETAR DADOS"}, headers=admin_headers)
    assert r.status_code == 403 and r.json()["error"] == "RESET_DISABLED"
    assert client.get("/api/admin/maintenance", headers=admin_headers).json()["operationalResetEnabled"] is False
