"""Sessions, users, scan review/export and dashboard for the admin panel."""
import csv
import io
import uuid
from collections.abc import Iterator

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import Conflict, DomainError, NotFound
from app.core.security import hash_password
from app.core.timeutil import local_day_start_utc, utcnow
from app.models import Barcode, CollectionSession, InventoryMovement, Item, Scan, User
from app.repositories.repos import AuditRepo, DeviceRepo, ScanFilter, ScanRepo, SessionRepo, UserRepo
from app.schemas.admin import (DashboardOut, ScanOut, ScanPage, SessionAdminOut, SessionCreate, UserCreate,
                               UserOut, UserUpdate)
from app.services.auth_service import AuthContext
from app.services import inventory_service, load_service
from app.services.device_service import connectivity


# ---- sessions -------------------------------------------------------------------------------

def list_sessions(db: Session, status: str | None) -> list[SessionAdminOut]:
    sessions = SessionRepo(db).list(status)
    counts: dict[uuid.UUID, tuple[int, int]] = {}
    if sessions:
        rows = db.execute(
            select(Scan.session_id,
                   func.count().filter(Scan.sync_state == Scan.STATE_ACCEPTED),
                   func.count().filter(Scan.sync_state.in_(Scan.CONFLICT_STATES)))
            .where(Scan.session_id.in_([s.id for s in sessions])).group_by(Scan.session_id)
        )
        counts = {sid: (n, c) for sid, n, c in rows}
    out = []
    for s in sessions:
        n, c = counts.get(s.id, (0, 0))
        out.append(SessionAdminOut(id=s.id, name=s.name, session_type=s.session_type, status=s.status,
                                   notes=s.notes, created_at=s.created_at, closed_at=s.closed_at,
                                   scan_count=n, conflict_count=c))
    return out


def create_session(db: Session, data: SessionCreate, auth: AuthContext) -> CollectionSession:
    session = CollectionSession(name=data.name.strip(), session_type=data.session_type.strip().upper() or "GENERAL",
                                notes=data.notes, status=CollectionSession.STATUS_OPEN, created_by_id=auth.user.id)
    db.add(session)
    db.flush()
    AuditRepo(db).add("SESSION_CREATED", actor_user_id=auth.user.id, entity_type="session",
                      entity_id=str(session.id), details={"name": session.name})
    db.commit()
    return session


def set_session_status(db: Session, session_id: uuid.UUID, open_: bool, auth: AuthContext) -> CollectionSession:
    session = SessionRepo(db).get(session_id)
    if session is None:
        raise NotFound("SESSION_NOT_FOUND")
    if open_:
        session.status, session.closed_at, session.closed_by_id = CollectionSession.STATUS_OPEN, None, None
    else:
        session.status, session.closed_at, session.closed_by_id = (
            CollectionSession.STATUS_CLOSED, utcnow(), auth.user.id)
    AuditRepo(db).add("SESSION_REOPENED" if open_ else "SESSION_CLOSED", actor_user_id=auth.user.id,
                      entity_type="session", entity_id=str(session.id))
    db.commit()
    return session


# ---- users ----------------------------------------------------------------------------------

def list_users(db: Session) -> list[UserOut]:
    return [UserOut.model_validate(u) for u in UserRepo(db).list()]


def create_user(db: Session, data: UserCreate, auth: AuthContext) -> UserOut:
    user = User(username=data.username.strip().lower(), full_name=data.full_name.strip(),
                password_hash=hash_password(data.password), role=data.role)
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise Conflict("USERNAME_EXISTS", "Usuário já existe")
    AuditRepo(db).add("USER_CREATED", actor_user_id=auth.user.id, entity_type="user", entity_id=str(user.id))
    db.commit()
    return UserOut.model_validate(user)


def update_user(db: Session, user_id: uuid.UUID, data: UserUpdate, auth: AuthContext) -> UserOut:
    user = UserRepo(db).get(user_id)
    if user is None:
        raise NotFound("USER_NOT_FOUND")
    changes = data.model_dump(exclude_unset=True)
    if user.id == auth.user.id and (changes.get("is_active") is False or changes.get("role") == User.ROLE_OPERATOR):
        raise DomainError("CANNOT_DEMOTE_SELF", "Não é possível desativar ou rebaixar o próprio usuário")
    if "password" in changes:
        user.password_hash = hash_password(changes.pop("password"))
    for field, value in changes.items():
        setattr(user, field, value)
    AuditRepo(db).add("USER_UPDATED", actor_user_id=auth.user.id, entity_type="user", entity_id=str(user.id),
                      details={"fields": sorted(data.model_dump(exclude_unset=True).keys())})
    db.commit()
    return UserOut.model_validate(user)


# ---- scans ----------------------------------------------------------------------------------

def _item_name(s: Scan) -> str | None:
    if s.product is not None:
        return s.product.name
    return s.barcode.item.name if s.barcode.item else None


def scan_out(s: Scan) -> ScanOut:
    return ScanOut(
        id=s.id, client_scan_id=s.client_scan_id, device_id=s.device_id, operator_id=s.operator_id,
        operator_name=s.operator.full_name if s.operator else None, session_id=s.session_id,
        session_name=s.session.name if s.session else None, requested_session_id=s.requested_session_id,
        barcode=s.barcode.code, raw_barcode=s.raw_barcode, barcode_status=s.barcode.status,
        product_code=s.product_code, item_name=_item_name(s), result=s.result, sync_state=s.sync_state,
        source=s.source, scanned_at_device=s.scanned_at_device, received_at_server=s.received_at_server,
        resolved_at=s.resolved_at, resolution_note=s.resolution_note,
    )


def query_scans(db: Session, flt: ScanFilter, limit: int, offset: int) -> ScanPage:
    total, scans = ScanRepo(db).query(flt, min(max(limit, 1), 500), max(offset, 0))
    return ScanPage(total=total, items=[scan_out(s) for s in scans])


CSV_COLUMNS = ["server_scan_id", "client_scan_id", "device_id", "operator", "session", "barcode",
               "product_code", "barcode_status", "item_name", "result", "sync_state", "scanned_at_device",
               "received_at_server"]


def export_scans_csv(db: Session, flt: ScanFilter) -> Iterator[str]:
    tz = get_settings().tz
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";")
    buf.write("﻿")  # Excel-friendly UTF-8
    writer.writerow(CSV_COLUMNS)
    for s in ScanRepo(db).iterate(flt):
        writer.writerow([
            s.id, s.client_scan_id, s.device_id, s.operator.full_name if s.operator else "",
            s.session.name if s.session else "", s.barcode.code, s.product_code or "", s.barcode.status,
            _item_name(s) or "", s.result,
            s.sync_state, s.scanned_at_device.astimezone(tz).isoformat(),
            s.received_at_server.astimezone(tz).isoformat(),
        ])
        if buf.tell() > 64_000:
            yield buf.getvalue()
            buf.seek(0)
            buf.truncate(0)
    yield buf.getvalue()


def resolve_scan(db: Session, scan: Scan, action: str, note: str | None, auth: AuthContext) -> None:
    if scan.sync_state not in Scan.CONFLICT_STATES:
        raise DomainError("NOT_A_CONFLICT", "Somente leituras em conflito podem ser resolvidas", status_code=409)
    previous = scan.sync_state
    scan.sync_state = Scan.STATE_ACCEPTED if action == "ACCEPT" else Scan.STATE_REJECTED
    scan.resolved_at = utcnow()
    scan.resolved_by_id = auth.user.id
    scan.resolution_note = note
    if scan.sync_state == Scan.STATE_ACCEPTED and scan.product_id is not None and db.scalar(
            select(InventoryMovement.id).where(InventoryMovement.scan_id == scan.id)) is None:
        # Accepted late: the physical volume now counts as stock (once; scan_id is unique in the ledger).
        inventory_service.apply_movement(db, scan.product_id, InventoryMovement.SCAN_IN, 1,
                                         programming_id=scan.programming_id, scan_id=scan.id,
                                         device_id=scan.device_id, user_id=auth.user.id)
    AuditRepo(db).add("SCAN_CONFLICT_RESOLVED", actor_user_id=auth.user.id, entity_type="scan",
                      entity_id=str(scan.id), details={"from": previous, "to": scan.sync_state, "note": note})


def resolve_scan_by_id(db: Session, scan_id: uuid.UUID, action: str, note: str | None, auth: AuthContext) -> ScanOut:
    scan = ScanRepo(db).get(scan_id)
    if scan is None:
        raise NotFound("SCAN_NOT_FOUND")
    resolve_scan(db, scan, action, note, auth)
    db.commit()
    return scan_out(scan)


def resolve_session_conflicts(db: Session, session_id: uuid.UUID, action: str, note: str | None,
                              auth: AuthContext) -> int:
    scans = db.scalars(select(Scan).where(Scan.session_id == session_id,
                                          Scan.sync_state.in_(Scan.CONFLICT_STATES))).unique().all()
    for scan in scans:
        resolve_scan(db, scan, action, note, auth)
    db.commit()
    return len(scans)


# ---- dashboard ------------------------------------------------------------------------------

def dashboard(db: Session) -> DashboardOut:
    day_start = local_day_start_utc()
    today = select(func.count()).select_from(Scan).where(
        Scan.received_at_server >= day_start, Scan.sync_state == Scan.STATE_ACCEPTED)
    states = {"ONLINE": 0, "OFFLINE": 0, "DISABLED": 0}
    for device in DeviceRepo(db).list():
        states[connectivity(device)[0]] += 1
    return DashboardOut(
        scans_today=db.scalar(today) or 0,
        unknown_scans_today=db.scalar(today.where(Scan.result == Scan.RESULT_UNKNOWN)) or 0,
        unknown_barcodes=db.scalar(select(func.count(func.distinct(Scan.product_code))).where(
            Scan.result == Scan.RESULT_UNKNOWN, Scan.product_code.is_not(None),
            Scan.sync_state != Scan.STATE_WRONG_BARCODE,
            ~select(Item.id).where(Item.sku == Scan.product_code).exists())) or 0,
        conflicts_open=db.scalar(select(func.count()).select_from(Scan)
                                 .where(Scan.sync_state.in_(Scan.CONFLICT_STATES))) or 0,
        open_sessions=db.scalar(select(func.count()).select_from(CollectionSession)
                                .where(CollectionSession.status == CollectionSession.STATUS_OPEN)) or 0,
        devices_online=states["ONLINE"], devices_offline=states["OFFLINE"], devices_disabled=states["DISABLED"],
        server_time=utcnow(),
        **load_service.dashboard_counts(db),
    )


def unknown_codes(db: Session, q: str | None = None, limit: int = 500) -> list[dict]:
    """Scanned product codes (first 10 chars) that match no product, grouped with their occurrences."""
    still_unknown = ~select(Item.id).where(Item.sku == Scan.product_code).exists()
    # EAN / wrong-code readings are not product codes to register
    base = [Scan.result == Scan.RESULT_UNKNOWN, Scan.product_code.is_not(None), still_unknown,
            Scan.sync_state != Scan.STATE_WRONG_BARCODE]
    if q:
        base.append(Scan.product_code.ilike(f"%{q.strip()}%"))
    groups = db.execute(
        select(Scan.product_code, func.count(), func.min(Scan.received_at_server), func.max(Scan.received_at_server))
        .where(*base).group_by(Scan.product_code).order_by(func.max(Scan.received_at_server).desc()).limit(limit)
    ).all()
    if not groups:
        return []
    rank = func.row_number().over(partition_by=Scan.product_code,
                                  order_by=Scan.received_at_server.desc()).label("rank")
    ranked = (select(Scan.id, rank).where(*base, Scan.product_code.in_([g[0] for g in groups]))).subquery()
    latest = db.scalars(select(Scan).join(ranked, ranked.c.id == Scan.id).where(ranked.c.rank == 1)).unique().all()
    last_by_code = {s.product_code: s for s in latest}
    out = []
    for code, count, first_at, last_at in groups:
        last = last_by_code.get(code)
        out.append({"product_code": code, "occurrences": count, "first_seen_at": first_at, "last_seen_at": last_at,
                    "last_raw_barcode": last.raw_barcode if last else None,
                    "last_device_id": last.device_id if last else None,
                    "last_operator_name": last.operator.full_name if last and last.operator else None})
    return out
