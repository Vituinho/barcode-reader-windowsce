"""XML load planning, inventory and dispatch. Synthetic NF-e XMLs mirror the real files (default namespace,
nfeProc wrapper, 'Carga:' in infAdFisco)."""
import io
import zipfile
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import func, select

from app.models import InventoryBalance, InventoryMovement, Invoice, Item, Load, LoadItem, Scan
from tests.conftest import later, scan_payload

_seq = iter(range(1, 10_000))


def nfe(load="231139", lines=(("6050647134", "BASE SOMMIER", "7896988303706", "UN", "4.0000"),), qvol=None,
        key=None, pedido="831631", cliente="AAABHI", nnf=None):
    n = next(_seq)
    key = key or f"2926090274834200011055001{n:019d}"
    dets = "".join(
        f'<det nItem="{i}"><prod><cProd>{c}</cProd><cEAN>{e}</cEAN><xProd>{d}</xProd><uCom>{u}</uCom>'
        f"<qCom>{q}</qCom></prod></det>"
        for i, (c, d, e, u, q) in enumerate(lines, 1))
    total = qvol if qvol is not None else sum(float(l[4]) for l in lines)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe xmlns="http://www.portalfiscal.inf.br/nfe">
<infNFe Id="NFe{key}" versao="4.00"><ide><nNF>{nnf or 2255800 + n}</nNF><dhEmi>2026-09-10T07:48:00-03:00</dhEmi></ide>
<dest><CPF>12345678901</CPF><xNome>CLIENTE {n}</xNome><enderDest><xMun>SALVADOR</xMun><UF>BA</UF></enderDest></dest>
{dets}<transp><vol><qVol>{total:g}</qVol><esp>UNIDADE</esp></vol></transp>
<infAdic><infAdFisco>\\Frete inc.\\Cliente: {cliente} Pedido: {pedido} Carga: {load}\\</infAdFisco></infAdic>
</infNFe></NFe><protNFe versao="4.00"><infProt><chNFe>{key}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>
""".encode()


def upload(client, headers, *files):
    return client.post("/api/import/xml", headers=headers,
                       files=[("files", (name, data, "application/octet-stream")) for name, data in files])


def scan(client, seed, headers, code, n=1):
    for i in range(n):
        r = client.post("/api/scans", json=scan_payload(seed, barcode=code, at=later(10 * (i + 1))), headers=headers)
        assert r.status_code == 200, r.text
    return r.json()


def stock(db, code):
    db.expire_all()
    return db.scalar(select(InventoryBalance.quantity).join(Item, Item.id == InventoryBalance.product_id)
                     .where(Item.sku == code)) or 0


def load_by_code(client, headers, code):
    return next(l for l in client.get("/api/loads", headers=headers).json() if l["externalCode"] == code)


# ---- barcode normalization (1-5, 9-11) --------------------------------------------------------

def test_long_barcode_uses_first_ten_chars_and_adds_stock(client, seed, op_headers, admin_headers, db):
    upload(client, admin_headers, ("a.xml", nfe()))
    body = scan(client, seed, op_headers, "60506471342313480002")
    assert body["productCode"] == "6050647134" and body["result"] == "KNOWN"
    assert body["itemName"] == "BASE SOMMIER" and body["currentStock"] == 1
    s = db.scalar(select(Scan).where(Scan.product_code == "6050647134"))
    assert s.raw_barcode == "60506471342313480002"
    assert stock(db, "6050647134") == 1


def test_exactly_ten_chars(client, seed, op_headers, admin_headers, db):
    upload(client, admin_headers, ("a.xml", nfe()))
    assert scan(client, seed, op_headers, "6050647134")["productCode"] == "6050647134"


def test_shorter_than_ten_is_rejected(client, seed, op_headers, db):
    r = client.post("/api/scans", json=scan_payload(seed, barcode="605064713"), headers=op_headers)
    assert r.status_code == 422 and r.json()["error"] == "BARCODE_TOO_SHORT"
    assert db.scalar(select(func.count()).select_from(Scan)) == 0


def test_leading_zero_and_alphanumeric_codes_preserved(client, seed, op_headers, admin_headers, db):
    upload(client, admin_headers, ("a.xml", nfe(lines=(("0012345678", "PROD ZERO", "SEM GTIN", "UN", "1"),
                                                        ("104121A181", "PROD ALFA", "SEM GTIN", "UN", "1")))))
    assert scan(client, seed, op_headers, "00123456789999")["productCode"] == "0012345678"
    assert scan(client, seed, op_headers, "104121A181XYZ")["productCode"] == "104121A181"
    assert stock(db, "0012345678") == 1 and stock(db, "104121A181") == 1


def test_duplicate_client_scan_id_never_adds_stock_twice(client, seed, op_headers, admin_headers, db):
    upload(client, admin_headers, ("a.xml", nfe()))
    payload = scan_payload(seed, barcode="60506471342313480002")
    first = client.post("/api/scans", json=payload, headers=op_headers).json()
    again = client.post("/api/scans", json=payload, headers=op_headers).json()
    assert again["replayed"] is True and again["currentStock"] == 1 == first["currentStock"]
    assert stock(db, "6050647134") == 1
    assert db.scalar(select(func.count()).select_from(InventoryMovement)) == 1


def test_unknown_code_is_kept_without_stock(client, seed, op_headers, admin_headers, db):
    body = scan(client, seed, op_headers, "99999999990000123")
    assert body["result"] == "UNKNOWN" and body["productCode"] == "9999999999" and body["currentStock"] is None
    assert db.scalar(select(func.count()).select_from(InventoryMovement)) == 0
    assert db.scalar(select(func.count()).select_from(Item).where(Item.sku == "9999999999")) == 0
    codes = client.get("/api/admin/unknown-codes", headers=admin_headers).json()
    assert codes[0]["productCode"] == "9999999999" and codes[0]["lastRawBarcode"] == "99999999990000123"


# ---- import (6-8, 18, 19) ---------------------------------------------------------------------

def test_import_without_ean_or_sem_gtin(client, admin_headers, db):
    xml = nfe(lines=(("1041602635", "LIGHT D33", "SEM GTIN", "UN", "2"), ("1041602636", "LIGHT D45", "", "UN", "1")))
    r = upload(client, admin_headers, ("x.xml", xml)).json()
    assert r["invoicesImported"] == 1 and r["productsCreated"] == 2 and not r["invalid"]
    assert db.scalar(select(Item.ean).where(Item.sku == "1041602635")) is None
    inv = db.scalar(select(Invoice))
    assert inv.order_number == "831631" and inv.external_customer_code == "AAABHI" and inv.city == "SALVADOR"


def test_duplicate_import_creates_nothing(client, admin_headers, db):
    xml = nfe()
    first = upload(client, admin_headers, ("x.xml", xml)).json()
    second = upload(client, admin_headers, ("x.xml", xml), ("copy.xml", xml)).json()
    assert first["invoicesImported"] == 1 and first["loadsCreated"] == ["231139"]
    assert second["invoicesImported"] == 0 and second["duplicatesSkipped"] == 2 and second["loadsCreated"] == []
    for model in (Invoice, Load, LoadItem, Item):
        assert db.scalar(select(func.count()).select_from(model)) == (2 if model is Item else 1)  # + seed item
    assert db.scalar(select(LoadItem.required_quantity)) == 4


def test_malformed_and_xxe_xml_rejected(client, admin_headers, db):
    xxe = b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><nfeProc>&e;</nfeProc>'
    r = upload(client, admin_headers, ("broken.xml", b"<nfeProc><NFe>"), ("xxe.xml", xxe),
               ("notnfe.xml", b"<root/>")).json()
    assert r["invoicesImported"] == 0 and r["xmlAccepted"] == 0
    assert {i["file"] for i in r["invalid"]} == {"broken.xml", "xxe.xml", "notnfe.xml"}
    assert db.scalar(select(func.count()).select_from(Invoice)) == 0


def test_zip_import_with_folders_traversal_and_non_xml(client, admin_headers, db):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xml/231139/a-nfe.xml", nfe(load="231139"))
        z.writestr("xml/231140/b-nfe.xml", nfe(load="231139"))  # folder disagrees: XML wins, warning
        z.writestr("../../evil.xml", nfe(load="666"))
        z.writestr("/abs/evil2.xml", nfe(load="667"))
        z.writestr("xml/Planilha.xlsx", b"PK not really")
    r = upload(client, admin_headers, ("cargas.zip", buf.getvalue())).json()
    assert r["invoicesImported"] == 2 and r["loadsCreated"] == ["231139"]
    assert sorted(i["code"] for i in r["invalid"]) == ["UNSAFE_PATH", "UNSAFE_PATH"]
    assert any(w["code"] == "FOLDER_LOAD_MISMATCH" for w in r["warnings"])
    assert r["ignoredFiles"] == ["cargas.zip:xml/Planilha.xlsx"]
    assert db.scalar(select(func.count()).select_from(Load).where(Load.external_code.in_(["666", "667"]))) == 0


def test_meter_unit_is_flagged_not_converted(client, admin_headers, db):
    xml = nfe(load="231122", lines=(("2020211732", "LAMINADO", "SEM GTIN", "MT", "400.0000"),), qvol=40)
    r = upload(client, admin_headers, ("m.xml", xml)).json()
    assert any(w["code"] == "NON_DISCRETE_UNIT" for w in r["warnings"])
    load = load_by_code(client, admin_headers, "231122")
    assert load["needsReview"] is True and load["status"] == "PENDING"
    assert load["warningInvoices"] == 1
    item = db.scalar(select(LoadItem))
    assert item.required_quantity is None and float(item.commercial_quantity) == 400 and item.unit == "MT"
    # Admin enters the physical volume count explicitly (audited); then readiness can be computed.
    detail = client.patch(f"/api/loads/{load['id']}/items/{item.id}", json={"requiredQuantity": 40, "note": "40 rolos"},
                          headers=admin_headers).json()
    assert detail["needsReview"] is False and detail["requiredVolumes"] == 40


# ---- readiness and dispatch (12-17) -----------------------------------------------------------

def two_loads(client, admin_headers):
    upload(client, admin_headers,
           ("a.xml", nfe(load="231139", lines=(("6050647134", "BASE", "SEM GTIN", "UN", "2"),
                                               ("1040421012", "COLCHAO", "SEM GTIN", "UN", "1")))),
           ("b.xml", nfe(load="231140", lines=(("6050647134", "BASE", "SEM GTIN", "UN", "2"),))))


def test_ready_and_pending_calculation(client, seed, op_headers, admin_headers):
    two_loads(client, admin_headers)
    scan(client, seed, op_headers, "60506471340000000001", n=2)
    a, b = load_by_code(client, admin_headers, "231139"), load_by_code(client, admin_headers, "231140")
    assert (a["status"], a["requiredVolumes"], a["availableVolumes"], a["missingVolumes"]) == ("PENDING", 3, 2, 1)
    assert (b["status"], b["missingVolumes"], b["progress"]) == ("READY", 0, 100)
    assert a["warningInvoices"] == 0 and a["invoiceCount"] == 1
    detail = client.get(f"/api/loads/{a['id']}", headers=admin_headers).json()
    missing = {r["productCode"]: r["missing"] for r in detail["requirements"]}
    assert missing == {"1040421012": 1, "6050647134": 0}
    last = scan(client, seed, op_headers, "10404210129999")
    assert last["newlyReadyLoads"] == 1
    assert load_by_code(client, admin_headers, "231139")["status"] == "READY"


def test_dispatch_removes_stock_and_recalculates_other_loads(client, seed, op_headers, admin_headers, db):
    two_loads(client, admin_headers)
    scan(client, seed, op_headers, "60506471340000000001", n=3)
    scan(client, seed, op_headers, "10404210129999")
    a, b = load_by_code(client, admin_headers, "231139"), load_by_code(client, admin_headers, "231140")
    assert a["status"] == b["status"] == "READY"  # shared stock, no reservation
    r = client.post(f"/api/loads/{a['id']}/dispatch", headers=admin_headers)
    assert r.status_code == 200 and r.json()["status"] == "DISPATCHED"
    assert stock(db, "6050647134") == 1 and stock(db, "1040421012") == 0
    b = load_by_code(client, admin_headers, "231140")
    assert b["status"] == "PENDING" and b["missingVolumes"] == 1
    hist = client.get("/api/dispatches", headers=admin_headers).json()
    assert hist[0]["externalCode"] == "231139" and hist[0]["volumes"] == 3


def test_load_cannot_be_dispatched_twice(client, seed, op_headers, admin_headers, db):
    upload(client, admin_headers, ("a.xml", nfe(lines=(("6050647134", "BASE", "SEM GTIN", "UN", "1"),))))
    scan(client, seed, op_headers, "60506471340000000001", n=3)
    load = load_by_code(client, admin_headers, "231139")
    first = client.post(f"/api/loads/{load['id']}/dispatch", headers=admin_headers)
    assert first.status_code == 200, first.text
    again = client.post(f"/api/loads/{load['id']}/dispatch", headers=admin_headers)
    assert again.status_code == 409 and again.json()["error"] == "LOAD_ALREADY_DISPATCHED"
    assert stock(db, "6050647134") == 2


def test_insufficient_stock_blocks_dispatch(client, seed, op_headers, admin_headers, db):
    upload(client, admin_headers, ("a.xml", nfe()))  # needs 4
    scan(client, seed, op_headers, "60506471340000000001", n=3)
    load = load_by_code(client, admin_headers, "231139")
    r = client.post(f"/api/loads/{load['id']}/dispatch", headers=admin_headers)
    assert r.status_code == 409 and r.json()["error"] == "LOAD_NO_LONGER_READY"
    assert stock(db, "6050647134") == 3
    assert db.scalar(select(Load.status)) == "PENDING"


def test_concurrent_dispatch_never_overconsumes_stock(client, seed, op_headers, admin_headers, db):
    two_loads(client, admin_headers)
    scan(client, seed, op_headers, "60506471340000000001", n=2)  # enough for only ONE of the loads
    scan(client, seed, op_headers, "10404210129999")
    ids = [load_by_code(client, admin_headers, c)["id"] for c in ("231139", "231140")] * 3
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda i: client.post(f"/api/loads/{i}/dispatch", headers=admin_headers), ids))
    assert sum(r.status_code == 200 for r in results) == 1
    assert all(r.status_code == 409 for r in results if r.status_code != 200)
    assert stock(db, "6050647134") == 0
    db.expire_all()
    assert db.scalar(select(func.min(InventoryBalance.quantity))) >= 0
    assert db.scalar(select(func.count()).select_from(Load).where(Load.status == "DISPATCHED")) == 1


def test_operator_cannot_import_dispatch_or_adjust(client, seed, op_headers, admin_headers):
    assert upload(client, op_headers, ("a.xml", nfe())).status_code == 403
    upload(client, admin_headers, ("a.xml", nfe()))
    load = load_by_code(client, op_headers, "231139")  # operators can view loads
    assert client.post(f"/api/loads/{load['id']}/dispatch", headers=op_headers).status_code == 403
    adj = {"productCode": "6050647134", "quantity": 5, "reason": "contagem"}
    assert client.post("/api/inventory/adjustments", json=adj, headers=op_headers).status_code == 403
    assert client.get("/api/inventory", headers=op_headers).status_code == 200


def test_manual_adjustment_requires_reason_and_never_goes_negative(client, seed, admin_headers, db):
    upload(client, admin_headers, ("a.xml", nfe()))
    no_reason = {"productCode": "6050647134", "quantity": 5, "reason": " "}
    assert client.post("/api/inventory/adjustments", json=no_reason, headers=admin_headers).status_code == 422
    ok = {"productCode": "6050647134", "quantity": 5, "reason": "inventário inicial"}
    assert client.post("/api/inventory/adjustments", json=ok, headers=admin_headers).json()["quantity"] == 5
    too_much = {"productCode": "6050647134", "quantity": -6, "reason": "avaria"}
    r = client.post("/api/inventory/adjustments", json=too_much, headers=admin_headers)
    assert r.status_code == 409 and stock(db, "6050647134") == 5
    hist = client.get("/api/inventory/6050647134/movements", headers=admin_headers).json()
    assert hist["quantity"] == 5 and hist["movements"][0]["type"] == "ADJUSTMENT_IN"


def test_dashboard_operational_counts(client, seed, op_headers, admin_headers):
    two_loads(client, admin_headers)
    scan(client, seed, op_headers, "60506471340000000001", n=2)
    d = client.get("/api/admin/dashboard", headers=admin_headers).json()
    assert d["stockTotal"] == 2 and d["loadsReady"] == 1 and d["loadsPending"] == 1
    assert d["readyLoads"][0]["externalCode"] == "231140"
