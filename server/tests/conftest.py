"""Tests run against a real PostgreSQL database (TEST_DATABASE_URL). The schema is rebuilt with Alembic."""
import os
import uuid
from datetime import datetime, timedelta

import pytest

TEST_DB = os.environ.get("TEST_DATABASE_URL")
if not TEST_DB:
    pytest.exit("Set TEST_DATABASE_URL to a disposable PostgreSQL database (it will be wiped).", returncode=2)

os.environ["DATABASE_URL"] = TEST_DB
os.environ["SECRET_KEY"] = "test-secret-key-0123456789abcdef"
os.environ["DUPLICATE_WINDOW_SECONDS"] = "2"
os.environ["AUTO_REGISTER_DEVICES"] = "false"
os.environ["ADMIN_WEB_ORIGIN"] = "https://admin.example.com"

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.database import get_engine, session_factory  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Barcode, CollectionSession, Device, Item, User  # noqa: E402

SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASSWORD = "senha-teste-123"


@pytest.fixture(scope="session", autouse=True)
def schema():
    with get_engine().begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    cfg = Config(os.path.join(SERVER_DIR, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(SERVER_DIR, "alembic"))
    command.upgrade(cfg, "head")
    yield


@pytest.fixture(autouse=True)
def clean_db(schema):
    with get_engine().begin() as conn:
        conn.execute(text("TRUNCATE inventory_movements, inventory_balances, load_items, invoice_items, invoices, loads, load_programmings, blocked_barcodes, scans, barcodes, items, audit_logs, collection_sessions, devices, users, software_releases CASCADE"))
    yield


@pytest.fixture
def db():
    with session_factory()() as s:
        yield s


@pytest.fixture
def seed(db):
    admin = User(username="admin@example.com", full_name="Admin", role=User.ROLE_ADMIN,
                 password_hash=hash_password(PASSWORD))
    op = User(username="operator@example.com", full_name="Operador", role=User.ROLE_OPERATOR,
              password_hash=hash_password(PASSWORD))
    db.add_all([admin, op, Device(id="GVT-CE-001", name="Coletor 1"), Device(id="GVT-CE-002", name="Coletor 2")])
    session = CollectionSession(name="RECEBIMENTO TESTE", status=CollectionSession.STATUS_OPEN)
    # Product code = first 10 characters of the scanned value
    item = Item(sku="7891234567", name="Colchão Ortobom Orion", unit="UN")
    db.add_all([session, item])
    db.flush()
    db.add(Barcode(code="7891234567890", item_id=item.id, status=Barcode.STATUS_KNOWN))
    db.commit()
    return {"admin": admin, "operator": op, "session": session, "item": item}


@pytest.fixture
def client():
    return TestClient(app)


def login(client, username="operator@example.com", device_id="GVT-CE-001", password=PASSWORD):
    return client.post("/api/auth/login", json={"username": username, "password": password, "deviceId": device_id})


@pytest.fixture
def op_headers(client, seed):
    r = login(client)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['accessToken']}"}


@pytest.fixture
def admin_headers(client, seed):
    r = login(client, "admin@example.com", None)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['accessToken']}"}


def scan_payload(seed, barcode="7891234567890", client_scan_id=None, at=None, device_id="GVT-CE-001",
                 session_id=None):
    at = at or datetime(2026, 9, 30, 10, 32, 15)
    return {
        "clientScanId": client_scan_id or f"{device_id}-{uuid.uuid4().hex}",
        "deviceId": device_id,
        "operatorId": str(seed["operator"].id),
        "sessionId": session_id if session_id is not None else str(seed["session"].id),
        "barcode": barcode,
        "rawBarcode": barcode,
        "source": "WINDOWS_CE",
        "scannedAtDevice": at.isoformat(timespec="seconds"),
    }


def later(seconds: int) -> datetime:
    return datetime(2026, 9, 30, 10, 32, 15) + timedelta(seconds=seconds)
