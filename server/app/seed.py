"""Development seed. Idempotent: running it twice does not duplicate data.

Usage:  python -m app.seed
Passwords come from SEED_ADMIN_PASSWORD / SEED_OPERATOR_PASSWORD (never hard-coded).
"""
import sys

from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import session_factory
from app.core.security import hash_password
from app.models import Barcode, CollectionSession, Device, Item, User

ITEMS = [
    ("COL-ORION", "Colchão Ortobom Orion", ["7891234567890"]),
    ("MON-DELL-24", 'Monitor Dell 24"', ["0884116123456"]),
    ("NB-DELL-LAT", "Notebook Dell Latitude", ["5397184123456"]),
]


def main() -> int:
    settings = get_settings()
    if not settings.seed_admin_password or not settings.seed_operator_password:
        print("Set SEED_ADMIN_PASSWORD and SEED_OPERATOR_PASSWORD (in .env) before seeding.")
        return 1

    with session_factory()() as db:
        def ensure_user(username: str, name: str, role: str, password: str) -> User:
            user = db.scalar(select(User).where(User.username == username))
            if user is None:
                user = User(username=username, full_name=name, role=role, password_hash=hash_password(password))
                db.add(user)
                db.flush()
                print(f"user created: {username} ({role})")
            return user

        admin = ensure_user("admin@example.com", "Administrador", User.ROLE_ADMIN, settings.seed_admin_password)
        ensure_user("operator@example.com", "Operador Teste", User.ROLE_OPERATOR, settings.seed_operator_password)

        if db.get(Device, "GVT-CE-001") is None:
            db.add(Device(id="GVT-CE-001", name="Coletor 001", status=Device.STATUS_ACTIVE))
            print("device created: GVT-CE-001")

        if db.scalar(select(CollectionSession).where(CollectionSession.name == "RECEBIMENTO TESTE")) is None:
            db.add(CollectionSession(name="RECEBIMENTO TESTE", session_type="RECEIVING",
                                     status=CollectionSession.STATUS_OPEN, created_by_id=admin.id))
            print("session created: RECEBIMENTO TESTE")

        for sku, name, codes in ITEMS:
            item = db.scalar(select(Item).where(Item.sku == sku))
            if item is None:
                item = Item(sku=sku, name=name)
                db.add(item)
                db.flush()
                print(f"item created: {name}")
            for code in codes:
                if db.scalar(select(Barcode).where(Barcode.code == code)) is None:
                    db.add(Barcode(code=code, item_id=item.id, status=Barcode.STATUS_KNOWN))
        db.commit()
    print("seed complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
