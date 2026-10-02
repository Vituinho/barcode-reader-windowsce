"""Programming lifecycle, ZIP/RAR import into a programming, offline/closed-programming conflicts, idempotency."""
import io
import os
import uuid
import zipfile

import pytest
from sqlalchemy import func, select

from app.models import InventoryMovement, Load, Scan
from app.services import rar_archive
from tests.conftest import later, scan_payload
from tests.test_logistics import nfe
from tests.test_programming import BIG, BASE_LINES, balance, import_into, new_programming, pscan, setup_programming

RAR_FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "programacao-teste.rar")


def test_programming_create_close_reopen_are_admin_only(client, seed, op_headers, admin_headers):
    assert client.post("/api/programmings", json={"scheduledDate": "2026-10-02"}, headers=op_headers).status_code == 403
    pid = new_programming(client, admin_headers)
    assert client.post(f"/api/programmings/{pid}/close", headers=op_headers).status_code == 403
    files = [("files", ("a.xml", nfe(), "application/xml"))]
    assert client.post(f"/api/programmings/{pid}/import", headers=op_headers, files=files).status_code == 403
    # operators can read (collector selector)
    listed = client.get("/api/programmings?status=OPEN", headers=op_headers).json()
    assert [p["id"] for p in listed] == [pid] and listed[0]["scheduledDate"] == "2026-10-02"
    closed = client.post(f"/api/programmings/{pid}/close", headers=admin_headers).json()
    assert closed["status"] == "CLOSED" and closed["closedAt"]
    assert client.get("/api/programmings?status=OPEN", headers=op_headers).json() == []
    assert client.post(f"/api/programmings/{pid}/reopen", headers=admin_headers).json()["status"] == "OPEN"


def test_import_requires_open_programming(client, seed, admin_headers):
    pid = new_programming(client, admin_headers)
    client.post(f"/api/programmings/{pid}/close", headers=admin_headers)
    r = client.post(f"/api/programmings/{pid}/import", headers=admin_headers,
                    files=[("files", ("a.xml", nfe(), "application/xml"))])
    assert r.status_code == 409 and r.json()["error"] == "PROGRAMMING_CLOSED"


def test_zip_import_into_programming(client, seed, admin_headers, db):
    pid = new_programming(client, admin_headers)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("231322/a.xml", nfe(load="231322", lines=BASE_LINES))
        z.writestr("231331/b.xml", nfe(load="231331", lines=BASE_LINES))
        z.writestr("leia-me.txt", "x")
    report = import_into(client, admin_headers, pid, ("prog.zip", buf.getvalue()))
    assert sorted(report["loadsCreated"]) == ["231322", "231331"] and report["ignoredFiles"] == ["prog.zip:leia-me.txt"]
    db.expire_all()
    assert {str(l.programming_id) for l in db.scalars(select(Load))} == {pid}


def test_load_already_in_other_programming_is_rejected(client, seed, admin_headers, db):
    p1 = setup_programming(client, admin_headers, load="231322")
    p2 = new_programming(client, admin_headers, day="2026-10-03")
    report = import_into(client, admin_headers, p2, ("b.xml", nfe(load="231322", lines=BASE_LINES)))
    assert report["invoicesImported"] == 0 and report["invalid"][0]["code"] == "LOAD_IN_OTHER_PROGRAMMING"
    db.expire_all()
    assert str(db.scalar(select(Load.programming_id))) == p1


@pytest.mark.skipif(not rar_archive.tool_available(), reason="bsdtar (libarchive-tools) not installed")
def test_rar_import_into_programming(client, seed, admin_headers, db):
    assert client.get("/api/programmings/import-capabilities", headers=admin_headers).json() == {"zip": True, "rar": True}
    pid = new_programming(client, admin_headers)
    with open(RAR_FIXTURE, "rb") as f:
        data = f.read()
    report = import_into(client, admin_headers, pid, ("programacao.rar", data))
    assert report["invoicesImported"] == 2 and sorted(report["loadsCreated"]) == ["231322", "231331"]
    assert report["ignoredFiles"] == ["programacao.rar:leia-me.txt"] and not report["invalid"]
    again = import_into(client, admin_headers, pid, ("programacao.rar", data))
    assert again["invoicesImported"] == 0 and again["duplicatesSkipped"] == 2


def test_corrupt_rar_is_refused(client, seed, admin_headers):
    pid = new_programming(client, admin_headers)
    report = import_into(client, admin_headers, pid, ("bad.rar", b"Rar!\x1a\x07\x01\x00" + b"\x00" * 64))
    assert report["invoicesImported"] == 0
    assert report["invalid"] and report["invalid"][0]["code"] in ("INVALID_RAR", "RAR_UNSUPPORTED")


def test_scan_synced_after_close_goes_to_review_and_is_never_moved(client, seed, op_headers, admin_headers, db):
    pid = setup_programming(client, admin_headers)
    other = setup_programming(client, admin_headers, load="231400")  # open programming with the same product
    client.post(f"/api/programmings/{pid}/close", headers=admin_headers)
    body = pscan(client, seed, op_headers, pid, BIG)  # collected offline before the close, synced now
    assert body["result"] == "PROGRAMMING_CLOSED" and body["programmingId"] == pid
    assert balance(db, "1040421012", pid) == balance(db, "1040421012", other) == 0
    r = client.post(f"/api/admin/scans/{body['serverScanId']}/resolve", json={"action": "ACCEPT", "note": "ok"},
                    headers=admin_headers)
    assert r.status_code == 200, r.text
    assert balance(db, "1040421012", pid) == 1 and balance(db, "1040421012", other) == 0


def test_unknown_programming_is_a_conflict(client, seed, op_headers, admin_headers, db):
    setup_programming(client, admin_headers)
    body = pscan(client, seed, op_headers, str(uuid.uuid4()), BIG)
    assert body["result"] == "PROGRAMMING_NOT_FOUND"
    assert db.scalar(select(InventoryMovement.id)) is None


def test_programming_scan_resend_is_idempotent(client, seed, op_headers, admin_headers, db):
    pid = setup_programming(client, admin_headers)
    payload = scan_payload(seed, barcode=BIG, at=later(5), session_id="")
    payload["programmingId"] = pid
    first = client.post("/api/scans", json=payload, headers=op_headers).json()
    again = client.post("/api/scans", json=payload, headers=op_headers).json()
    assert again["replayed"] is True and again["serverScanId"] == first["serverScanId"]
    assert balance(db, "1040421012", pid) == 1
    assert db.scalar(select(func.count()).select_from(InventoryMovement)) == 1


@pytest.mark.parametrize("raw", ["1040421012", "1040421012X", "10404210122313220003ABC"])
def test_production_code_length_is_not_hardcoded(client, seed, op_headers, admin_headers, db, raw):
    pid = setup_programming(client, admin_headers)
    body = pscan(client, seed, op_headers, pid, raw)
    assert body["result"] == "KNOWN" and body["productCode"] == "1040421012"
    stored = db.scalar(select(Scan).where(Scan.client_scan_id == body["clientScanId"]))
    assert stored.raw_barcode == raw
