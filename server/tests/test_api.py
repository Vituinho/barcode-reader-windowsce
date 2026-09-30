from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import func, select

from app.models import Barcode, Device, Scan
from tests.conftest import later, login, scan_payload


def count_scans(db, **filters) -> int:
    db.expire_all()
    stmt = select(func.count()).select_from(Scan)
    for key, value in filters.items():
        stmt = stmt.where(getattr(Scan, key) == value)
    return db.scalar(stmt)


# ---- auth -----------------------------------------------------------------------------------

def test_login_success_and_failure(client, seed):
    r = login(client)
    assert r.status_code == 200
    body = r.json()
    assert body["accessToken"] and body["fullName"] == "Operador" and body["deviceId"] == "GVT-CE-001"

    assert login(client, password="wrong").status_code == 401
    assert login(client, username="nobody@example.com").status_code == 401
    assert client.get("/api/sessions").status_code == 401


def test_login_rejects_unregistered_device_when_auto_register_off(client, seed):
    r = login(client, device_id="GVT-CE-999")
    assert r.status_code == 403 and r.json()["error"] == "DEVICE_NOT_REGISTERED"


def test_sessions_lists_open_only(client, op_headers, admin_headers):
    client.post("/api/admin/sessions", json={"name": "CARGA 58342", "sessionType": "LOADING"}, headers=admin_headers)
    names = [s["name"] for s in client.get("/api/sessions", headers=op_headers).json()]
    assert set(names) == {"RECEBIMENTO TESTE", "CARGA 58342"}


def test_operator_cannot_use_admin_api(client, op_headers):
    assert client.get("/api/admin/scans", headers=op_headers).status_code == 403


# ---- scans ----------------------------------------------------------------------------------

def test_known_barcode(client, seed, op_headers, db):
    r = client.post("/api/scans", json=scan_payload(seed), headers=op_headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["accepted"] is True and body["result"] == "KNOWN"
    assert body["itemName"] == "Colchão Ortobom Orion" and body["serverScanId"]
    assert count_scans(db) == 1


def test_unknown_barcode_is_accepted_and_registered(client, seed, op_headers, db):
    r = client.post("/api/scans", json=scan_payload(seed, barcode="7899999999999"), headers=op_headers)
    body = r.json()
    assert r.status_code == 200 and body["accepted"] is True and body["result"] == "UNKNOWN"
    barcode = db.scalar(select(Barcode).where(Barcode.code == "7899999999999"))
    assert barcode is not None and barcode.status == "UNKNOWN" and barcode.item_id is None
    assert count_scans(db, sync_state="ACCEPTED") == 1


def test_barcode_value_is_opaque(client, seed, op_headers, db):
    for code in ["000123", "abc-DEF/01", "(01)07891234567890(10)LOTE 7", "0000"]:
        r = client.post("/api/scans", json=scan_payload(seed, barcode=code), headers=op_headers)
        assert r.status_code == 200 and r.json()["barcode"] == code
    codes = set(db.scalars(select(Barcode.code)))
    assert {"000123", "abc-DEF/01", "(01)07891234567890(10)LOTE 7", "0000"} <= codes


def test_blank_barcode_rejected(client, seed, op_headers):
    assert client.post("/api/scans", json=scan_payload(seed, barcode="   "), headers=op_headers).status_code == 422


def test_resend_same_client_scan_id_is_idempotent(client, seed, op_headers, db):
    """Scenario D: server stored the scan, response was lost, collector resends."""
    payload = scan_payload(seed)
    first = client.post("/api/scans", json=payload, headers=op_headers).json()
    second = client.post("/api/scans", json=payload, headers=op_headers).json()
    assert second["replayed"] is True
    assert second["serverScanId"] == first["serverScanId"] and second["result"] == first["result"]
    assert count_scans(db) == 1


def test_concurrent_resends_create_one_record(client, seed, op_headers, db):
    payload = scan_payload(seed, barcode="CONCURRENT-1")
    with ThreadPoolExecutor(max_workers=6) as pool:
        responses = list(pool.map(lambda _: client.post("/api/scans", json=payload, headers=op_headers), range(6)))
    assert all(r.status_code == 200 for r in responses)
    assert len({r.json()["serverScanId"] for r in responses}) == 1
    assert count_scans(db) == 1


def test_reused_client_scan_id_with_different_barcode_conflicts(client, seed, op_headers):
    payload = scan_payload(seed)
    client.post("/api/scans", json=payload, headers=op_headers)
    payload["barcode"] = "OTHER"
    r = client.post("/api/scans", json=payload, headers=op_headers)
    assert r.status_code == 409 and r.json()["error"] == "CLIENT_SCAN_ID_REUSED"


def test_rapid_double_scan_is_duplicate(client, seed, op_headers, db):
    """Scenario E: same barcode twice within the duplicate window."""
    a = client.post("/api/scans", json=scan_payload(seed, at=later(0)), headers=op_headers).json()
    b = client.post("/api/scans", json=scan_payload(seed, at=later(1)), headers=op_headers).json()
    assert a["result"] == "KNOWN" and b["result"] == "DUPLICATE" and b["accepted"] is True
    assert count_scans(db, sync_state="ACCEPTED") == 1
    assert count_scans(db, sync_state="DUPLICATE") == 1


def test_repeated_barcode_outside_window_is_valid(client, seed, op_headers, db):
    client.post("/api/scans", json=scan_payload(seed, at=later(0)), headers=op_headers)
    r = client.post("/api/scans", json=scan_payload(seed, at=later(3)), headers=op_headers).json()
    assert r["result"] == "KNOWN"
    assert count_scans(db, sync_state="ACCEPTED") == 2


def test_same_barcode_other_device_is_not_duplicate(client, seed, op_headers, db):
    client.post("/api/scans", json=scan_payload(seed, at=later(0)), headers=op_headers)
    token2 = login(client, device_id="GVT-CE-002").json()["accessToken"]
    r = client.post("/api/scans", json=scan_payload(seed, at=later(0), device_id="GVT-CE-002"),
                    headers={"Authorization": f"Bearer {token2}"}).json()
    assert r["result"] == "KNOWN"


def test_closed_session_scan_is_kept_as_conflict(client, seed, op_headers, admin_headers, db):
    session_id = str(seed["session"].id)
    client.post(f"/api/admin/sessions/{session_id}/close", headers=admin_headers)
    payload = scan_payload(seed)
    r = client.post("/api/scans", json=payload, headers=op_headers).json()
    assert r["accepted"] is True and r["result"] == "SESSION_CLOSED"
    assert client.post("/api/scans", json=payload, headers=op_headers).json()["replayed"] is True
    assert count_scans(db, sync_state="SESSION_CLOSED") == 1

    conflicts = client.get("/api/admin/scans?syncState=CONFLICT", headers=admin_headers).json()
    assert conflicts["total"] == 1
    resolved = client.post(f"/api/admin/scans/{r['serverScanId']}/resolve",
                           json={"action": "ACCEPT", "note": "coletado antes do fechamento"},
                           headers=admin_headers).json()
    assert resolved["syncState"] == "ACCEPTED"


def test_unknown_session_id_is_kept_as_conflict(client, seed, op_headers, db):
    r = client.post("/api/scans", json=scan_payload(seed, session_id="not-a-session"), headers=op_headers).json()
    assert r["accepted"] is True and r["result"] == "SESSION_NOT_FOUND"
    assert count_scans(db) == 1


def test_disabled_device_is_refused(client, seed, op_headers, admin_headers, db):
    client.patch("/api/admin/devices/GVT-CE-001", json={"status": "DISABLED"}, headers=admin_headers)
    r = client.post("/api/scans", json=scan_payload(seed), headers=op_headers)
    assert r.status_code == 403 and r.json()["error"] == "DEVICE_DISABLED"
    assert login(client).status_code == 403
    assert count_scans(db) == 0


def test_device_mismatch_is_refused(client, seed, op_headers):
    r = client.post("/api/scans", json=scan_payload(seed, device_id="GVT-CE-002"), headers=op_headers)
    assert r.status_code == 403 and r.json()["error"] == "DEVICE_MISMATCH"


def test_unknown_barcode_identified_later(client, seed, op_headers, admin_headers):
    r = client.post("/api/scans", json=scan_payload(seed, barcode="0001112223334"), headers=op_headers).json()
    assert r["result"] == "UNKNOWN"
    unknown = client.get("/api/admin/barcodes?status=UNKNOWN", headers=admin_headers).json()
    barcode = next(b for b in unknown if b["code"] == "0001112223334")
    assert barcode["scanCount"] == 1

    assigned = client.post(f"/api/admin/barcodes/{barcode['id']}/assign", json={"itemId": str(seed["item"].id)},
                           headers=admin_headers).json()
    assert assigned["status"] == "KNOWN"
    scans = client.get("/api/admin/scans?barcode=0001112223334", headers=admin_headers).json()["items"]
    assert scans[0]["itemName"] == "Colchão Ortobom Orion" and scans[0]["barcodeStatus"] == "KNOWN"
    assert scans[0]["result"] == "UNKNOWN"  # classification at scan time is preserved
    lookup = client.get("/api/items/by-barcode/0001112223334", headers=op_headers).json()
    assert lookup["status"] == "KNOWN"


def test_batch_processes_each_scan_independently(client, seed, op_headers, db):
    good = scan_payload(seed, barcode="B-1", at=later(0))
    other_device = scan_payload(seed, barcode="B-2", device_id="GVT-CE-002")
    unknown = scan_payload(seed, barcode="B-3", at=later(5))
    r = client.post("/api/scans/batch", json={"scans": [good, other_device, unknown, good]}, headers=op_headers)
    results = r.json()["results"]
    assert [x["accepted"] for x in results] == [True, False, True, True]
    assert results[1]["error"] == "DEVICE_MISMATCH" and results[3]["replayed"] is True
    assert count_scans(db) == 2


def test_heartbeat_and_device_config(client, seed, op_headers, admin_headers, db):
    r = client.post("/api/device/heartbeat", json={
        "deviceId": "GVT-CE-001", "appVersion": "1.0.0", "operatorId": str(seed["operator"].id),
        "batteryLevel": None, "pendingScans": 3, "timestamp": "2026-09-30T10:32:15"}, headers=op_headers)
    assert r.status_code == 200 and r.json()["ok"] is True
    device = db.get(Device, "GVT-CE-001")
    db.refresh(device)
    assert device.pending_scans == 3 and device.app_version == "1.0.0"

    cfg = client.get("/api/device/config?deviceId=GVT-CE-001", headers=op_headers).json()
    assert cfg["duplicateWindowSeconds"] == 2
    devices = {d["id"]: d for d in client.get("/api/admin/devices", headers=admin_headers).json()}
    assert devices["GVT-CE-001"]["connectivity"] == "ONLINE"
    assert devices["GVT-CE-002"]["connectivity"] == "OFFLINE"


def test_csv_export(client, seed, op_headers, admin_headers):
    client.post("/api/scans", json=scan_payload(seed, barcode="0012345"), headers=op_headers)
    r = client.get("/api/admin/scans/export.csv", headers=admin_headers)
    assert r.status_code == 200 and "0012345" in r.text and "client_scan_id" in r.text
