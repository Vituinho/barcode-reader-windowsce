"""Load programmings: programming-scoped production stock and production barcode rules."""
from sqlalchemy import func, select

from app.models import AuditLog, BlockedBarcode, InventoryBalance, InventoryMovement, Item, LoadProgramming, Scan
from tests.conftest import later, scan_payload
from tests.test_logistics import nfe

BIG = "10404210122313220003"  # production label: first 10 chars = cProd 1040421012
EAN = "7896988334632"  # small EAN of the same label (cEAN in the XML)
BASE_LINES = (("1040421012", "COLCHAO PROD", EAN, "UN", "2.0000"),)


def new_programming(client, headers, day="2026-10-02"):
    r = client.post("/api/programmings", json={"scheduledDate": day}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def import_into(client, headers, programming_id, *files):
    r = client.post(f"/api/programmings/{programming_id}/import", headers=headers,
                    files=[("files", (name, data, "application/octet-stream")) for name, data in files])
    assert r.status_code == 200, r.text
    return r.json()


def pscan(client, seed, headers, programming_id, barcode, i=1):
    payload = scan_payload(seed, barcode=barcode, at=later(10 * i), session_id="")
    payload["programmingId"] = programming_id
    r = client.post("/api/scans", json=payload, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def balance(db, code, programming_id=None):
    db.expire_all()
    stmt = select(InventoryBalance.quantity).join(Item, Item.id == InventoryBalance.product_id).where(Item.sku == code)
    stmt = stmt.where(InventoryBalance.programming_id.is_(None)) if programming_id is None \
        else stmt.where(InventoryBalance.programming_id == programming_id)
    return db.scalar(stmt) or 0


def setup_programming(client, admin_headers, load="231322", lines=BASE_LINES):
    pid = new_programming(client, admin_headers)
    import_into(client, admin_headers, pid, ("a.xml", nfe(load=load, lines=lines)))
    return pid


def test_large_code_collects_into_programming_stock(client, seed, op_headers, admin_headers, db):
    pid = setup_programming(client, admin_headers)
    body = pscan(client, seed, op_headers, pid, BIG)
    assert body["result"] == "KNOWN" and body["productCode"] == "1040421012" and body["currentStock"] == 1
    assert body["programmingId"] == pid
    assert balance(db, "1040421012", pid) == 1 and balance(db, "1040421012") == 0
    scan = db.scalar(select(Scan).where(Scan.client_scan_id == body["clientScanId"]))
    assert scan.raw_barcode == BIG and scan.product_code == "1040421012"


def test_known_ean_is_wrong_barcode_and_never_adds_stock(client, seed, op_headers, admin_headers, db):
    pid = setup_programming(client, admin_headers)
    body = pscan(client, seed, op_headers, pid, EAN)
    assert body["accepted"] is True and body["result"] == "WRONG_BARCODE"
    assert db.scalar(select(InventoryMovement.id)) is None
    stored = db.scalar(select(Scan).where(Scan.client_scan_id == body["clientScanId"]))
    assert stored.sync_state == Scan.STATE_WRONG_BARCODE and stored.raw_barcode == EAN
    # not offered as an unknown product code to register
    assert client.get("/api/admin/unknown-codes", headers=admin_headers).json() == []


def test_unimported_valid_gtin_is_wrong_barcode(client, seed, op_headers, admin_headers, db):
    pid = setup_programming(client, admin_headers)
    assert pscan(client, seed, op_headers, pid, "4006381333931")["result"] == "WRONG_BARCODE"
    assert db.scalar(select(InventoryMovement.id)) is None


def test_product_outside_programming_is_not_in_program(client, seed, op_headers, admin_headers, db):
    pid = setup_programming(client, admin_headers)
    # seed product exists globally but is not required by this programming
    assert pscan(client, seed, op_headers, pid, "7891234567XYZ0000001")["result"] == "NOT_IN_PROGRAM"
    assert pscan(client, seed, op_headers, pid, "9999999999ABC", i=2)["result"] == "NOT_IN_PROGRAM"
    assert db.scalar(select(InventoryMovement.id)) is None


def test_closed_programming_ean_is_still_refused(client, seed, op_headers, admin_headers, db):
    pid = setup_programming(client, admin_headers)
    assert client.post(f"/api/programmings/{pid}/close", headers=admin_headers).status_code == 200
    assert pscan(client, seed, op_headers, pid, EAN)["result"] == "WRONG_BARCODE"
    assert pscan(client, seed, op_headers, pid, BIG, i=2)["result"] == "PROGRAMMING_CLOSED"
    assert balance(db, "1040421012", pid) == 0


def test_scan_rules_endpoint(client, seed, op_headers, admin_headers):
    pid = setup_programming(client, admin_headers)
    rules = client.get(f"/api/programmings/{pid}/scan-rules", headers=op_headers).json()
    assert rules["productCodes"] == ["1040421012"] and EAN in rules["eans"]


def test_legacy_scan_without_programming_unchanged(client, seed, op_headers, admin_headers, db):
    setup_programming(client, admin_headers)
    r = client.post("/api/scans", json=scan_payload(seed, barcode="7891234567890"), headers=op_headers)
    assert r.json()["result"] == "KNOWN" and balance(db, "7891234567") == 1


# ---- blocklist ----------------------------------------------------------------------------------------------

def test_blocked_barcode_never_adds_stock_and_is_audited(client, seed, op_headers, admin_headers, db):
    pid = setup_programming(client, admin_headers)
    r = client.post("/api/admin/blocked-barcodes", json={"value": f" {BIG} ", "reason": "etiqueta errada"},
                    headers=admin_headers)
    assert r.status_code == 200 and r.json()["value"] == BIG
    body = pscan(client, seed, op_headers, pid, BIG)
    assert body["result"] == "BLOCKED"
    # legacy collectors are blocked too
    legacy = client.post("/api/scans", json=scan_payload(seed, barcode=BIG, at=later(99)), headers=op_headers).json()
    assert legacy["result"] == "BLOCKED"
    assert db.scalar(select(InventoryMovement.id)) is None
    stored = db.scalar(select(Scan).where(Scan.client_scan_id == body["clientScanId"]))
    assert stored.sync_state == Scan.STATE_BLOCKED and stored.raw_barcode == BIG and stored.programming_id
    assert db.scalar(select(AuditLog.id).where(AuditLog.action == "BARCODE_BLOCKED")) is not None
    assert BIG in client.get(f"/api/programmings/{pid}/scan-rules", headers=op_headers).json()["blocked"]
    # unblocking lets the code collect again
    entry = client.get("/api/admin/blocked-barcodes", headers=admin_headers).json()[0]
    assert client.patch(f"/api/admin/blocked-barcodes/{entry['id']}", json={"active": False},
                        headers=admin_headers).json()["active"] is False
    assert pscan(client, seed, op_headers, pid, BIG, i=3)["result"] == "KNOWN"


def test_blocklist_is_admin_only(client, seed, op_headers):
    assert client.get("/api/admin/blocked-barcodes", headers=op_headers).status_code == 403
    assert client.post("/api/admin/blocked-barcodes", json={"value": "X"}, headers=op_headers).status_code == 403


def test_reset_keeps_blocklist_and_removes_programmings(client, seed, op_headers, admin_headers, db, monkeypatch):
    from app.core.config import get_settings
    monkeypatch.setattr(get_settings(), "allow_operational_reset", True)
    pid = setup_programming(client, admin_headers)
    pscan(client, seed, op_headers, pid, BIG)
    client.post("/api/admin/blocked-barcodes", json={"value": EAN}, headers=admin_headers)
    r = client.post("/api/admin/maintenance/reset-operational-data", json={"confirmation": "RESETAR DADOS"},
                    headers=admin_headers)
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.scalar(select(func.count()).select_from(LoadProgramming)) == 0
    assert db.scalar(select(func.count()).select_from(BlockedBarcode)) == 1
