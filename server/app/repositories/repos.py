"""Thin data-access helpers. Business rules live in app.services."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import Select, func, select, tuple_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import AuditLog, Barcode, CollectionSession, Device, Item, Scan, User


class UserRepo:
    def __init__(self, db: Session):
        self.db = db

    def get(self, user_id: uuid.UUID) -> User | None:
        return self.db.get(User, user_id)

    def by_username(self, username: str) -> User | None:
        return self.db.scalar(select(User).where(func.lower(User.username) == username.strip().lower()))

    def list(self) -> list[User]:
        return list(self.db.scalars(select(User).order_by(User.full_name)))


class DeviceRepo:
    def __init__(self, db: Session):
        self.db = db

    def get(self, device_id: str) -> Device | None:
        return self.db.get(Device, device_id)

    def list(self) -> list[Device]:
        return list(self.db.scalars(select(Device).order_by(Device.id)).unique())


class SessionRepo:
    def __init__(self, db: Session):
        self.db = db

    def get(self, session_id: uuid.UUID) -> CollectionSession | None:
        return self.db.get(CollectionSession, session_id)

    def list(self, status: str | None = None) -> list[CollectionSession]:
        stmt = select(CollectionSession).order_by(CollectionSession.created_at.desc())
        if status:
            stmt = stmt.where(CollectionSession.status == status)
        return list(self.db.scalars(stmt))


class ItemRepo:
    def __init__(self, db: Session):
        self.db = db

    def get(self, item_id: uuid.UUID) -> Item | None:
        return self.db.get(Item, item_id)

    def list(self, q: str | None = None, limit: int = 200) -> list[Item]:
        stmt = select(Item).order_by(Item.name).limit(limit)
        if q:
            like = f"%{q}%"
            stmt = stmt.where(Item.name.ilike(like) | Item.sku.ilike(like))
        return list(self.db.scalars(stmt))

    def barcodes_for(self, item_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[str]]:
        out: dict[uuid.UUID, list[str]] = {i: [] for i in item_ids}
        if item_ids:
            rows = self.db.execute(
                select(Barcode.item_id, Barcode.code).where(Barcode.item_id.in_(item_ids)).order_by(Barcode.code)
            )
            for item_id, code in rows:
                out[item_id].append(code)
        return out


class BarcodeRepo:
    def __init__(self, db: Session):
        self.db = db

    def get(self, barcode_id: uuid.UUID) -> Barcode | None:
        return self.db.get(Barcode, barcode_id)

    def by_code(self, code: str) -> Barcode | None:
        return self.db.scalar(select(Barcode).where(Barcode.code == code))

    def get_or_create(self, code: str, seen_at: datetime | None) -> Barcode:
        """Race-safe upsert: concurrent first scans of the same new code converge on one row."""
        barcode = self.by_code(code)
        if barcode is None:
            try:
                with self.db.begin_nested():
                    barcode = Barcode(code=code, status=Barcode.STATUS_UNKNOWN,
                                      first_seen_at=seen_at, last_seen_at=seen_at)
                    self.db.add(barcode)
                    self.db.flush()
                return barcode
            except IntegrityError:
                barcode = self.by_code(code)
                assert barcode is not None
        if seen_at is not None:
            if barcode.first_seen_at is None or seen_at < barcode.first_seen_at:
                barcode.first_seen_at = seen_at
            if barcode.last_seen_at is None or seen_at > barcode.last_seen_at:
                barcode.last_seen_at = seen_at
        return barcode

    def list(self, status: str | None, q: str | None, limit: int = 500) -> list[tuple[Barcode, int]]:
        counts = (
            select(Scan.barcode_id, func.count().label("n")).group_by(Scan.barcode_id).subquery()
        )
        stmt = (
            select(Barcode, func.coalesce(counts.c.n, 0))
            .outerjoin(counts, counts.c.barcode_id == Barcode.id)
            .order_by(Barcode.last_seen_at.desc().nulls_last())
            .limit(limit)
        )
        if status:
            stmt = stmt.where(Barcode.status == status)
        if q:
            stmt = stmt.where(Barcode.code.contains(q, autoescape=True))
        return [(b, n) for b, n in self.db.execute(stmt).unique()]


class ScanFilter:
    def __init__(self, device_id: str | None = None, operator_id: uuid.UUID | None = None,
                 session_id: uuid.UUID | None = None, sync_state: str | None = None,
                 barcode: str | None = None, result: str | None = None,
                 date_from: datetime | None = None, date_to: datetime | None = None):
        self.device_id = device_id
        self.operator_id = operator_id
        self.session_id = session_id
        self.sync_state = sync_state
        self.barcode = barcode
        self.result = result
        self.date_from = date_from
        self.date_to = date_to

    def apply(self, stmt: Select) -> Select:
        if self.device_id:
            stmt = stmt.where(Scan.device_id == self.device_id)
        if self.operator_id:
            stmt = stmt.where(Scan.operator_id == self.operator_id)
        if self.session_id:
            stmt = stmt.where(Scan.session_id == self.session_id)
        if self.sync_state == "CONFLICT":
            stmt = stmt.where(Scan.sync_state.in_(Scan.CONFLICT_STATES))
        elif self.sync_state:
            stmt = stmt.where(Scan.sync_state == self.sync_state)
        if self.result:
            stmt = stmt.where(Scan.result == self.result)
        if self.barcode:
            stmt = stmt.join(Barcode, Barcode.id == Scan.barcode_id).where(
                Barcode.code.contains(self.barcode, autoescape=True))
        if self.date_from:
            stmt = stmt.where(Scan.received_at_server >= self.date_from)
        if self.date_to:
            stmt = stmt.where(Scan.received_at_server < self.date_to)
        return stmt


class ScanRepo:
    def __init__(self, db: Session):
        self.db = db

    def get(self, scan_id: uuid.UUID) -> Scan | None:
        return self.db.get(Scan, scan_id)

    def by_client_id(self, client_scan_id: str) -> Scan | None:
        return self.db.scalar(select(Scan).where(Scan.client_scan_id == client_scan_id))

    def find_recent_duplicate(self, device_id: str, operator_id: uuid.UUID | None,
                              session_id: uuid.UUID | None, barcode_id: uuid.UUID,
                              scanned_at: datetime, window_seconds: int) -> Scan | None:
        window = timedelta(seconds=window_seconds)
        stmt = select(Scan).where(
            Scan.device_id == device_id,
            Scan.barcode_id == barcode_id,
            Scan.sync_state == Scan.STATE_ACCEPTED,
            Scan.scanned_at_device >= scanned_at - window,
            Scan.scanned_at_device <= scanned_at + window,
        )
        stmt = stmt.where(Scan.operator_id.is_(None) if operator_id is None else Scan.operator_id == operator_id)
        stmt = stmt.where(Scan.session_id.is_(None) if session_id is None else Scan.session_id == session_id)
        return self.db.scalars(stmt.limit(1)).first()

    def query(self, flt: ScanFilter, limit: int, offset: int) -> tuple[int, list[Scan]]:
        total = self.db.scalar(flt.apply(select(func.count()).select_from(Scan))) or 0
        stmt = flt.apply(select(Scan)).order_by(Scan.received_at_server.desc(), Scan.id).limit(limit).offset(offset)
        return total, list(self.db.scalars(stmt).unique())

    def iterate(self, flt: ScanFilter, chunk: int = 1000):
        """Keyset pagination so large exports never load every scan at once."""
        last = None
        while True:
            stmt = flt.apply(select(Scan)).order_by(Scan.received_at_server, Scan.id).limit(chunk)
            if last is not None:
                stmt = stmt.where(tuple_(Scan.received_at_server, Scan.id) > last)
            rows = list(self.db.scalars(stmt).unique())
            yield from rows
            if len(rows) < chunk:
                return
            last = (rows[-1].received_at_server, rows[-1].id)
            self.db.expunge_all()


class AuditRepo:
    def __init__(self, db: Session):
        self.db = db

    def add(self, action: str, actor_user_id: uuid.UUID | None = None, device_id: str | None = None,
            entity_type: str | None = None, entity_id: str | None = None, details: dict | None = None) -> None:
        self.db.add(AuditLog(action=action, actor_user_id=actor_user_id, device_id=device_id,
                             entity_type=entity_type, entity_id=entity_id, details=details))
