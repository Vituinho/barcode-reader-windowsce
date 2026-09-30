"""Scan intake: idempotent by clientScanId, never loses an accepted payload.

Rules (in order):
1. Same clientScanId already stored -> return the stored result (idempotent resend).
2. Every non-blank barcode is accepted; unknown values are registered as UNKNOWN.
3. Session closed / missing -> stored as a conflict for administrative resolution.
4. Same device+operator+session+barcode within the duplicate window -> stored as DUPLICATE,
   not counted as a business scan.
"""
import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import Conflict, DomainError, Forbidden
from app.core.timeutil import device_time_to_utc, utcnow
from app.models import CollectionSession, Device, Scan
from app.repositories.repos import BarcodeRepo, DeviceRepo, ScanRepo, SessionRepo, UserRepo
from app.schemas.collector import ScanIn, ScanResult
from app.services.auth_service import AuthContext


def to_result(scan: Scan, replayed: bool = False) -> ScanResult:
    accepted_state = scan.sync_state == Scan.STATE_ACCEPTED
    item = scan.barcode.item
    return ScanResult(
        accepted=True,
        result=scan.result if accepted_state else scan.sync_state,
        client_scan_id=scan.client_scan_id,
        server_scan_id=scan.id,
        barcode=scan.barcode.code,
        barcode_status=scan.barcode.status,
        item_name=item.name if item else None,
        sync_state=scan.sync_state,
        server_timestamp=scan.received_at_server,
        replayed=replayed,
    )


def _check_device(db: Session, payload_device_id: str) -> Device:
    device = DeviceRepo(db).get(payload_device_id)
    if device is None:
        raise Forbidden("DEVICE_NOT_REGISTERED", "Coletor não cadastrado")
    if device.status == Device.STATUS_DISABLED:
        raise Forbidden("DEVICE_DISABLED", "Coletor desativado")
    return device


def _replay(existing: Scan, payload: ScanIn) -> ScanResult:
    if existing.device_id != payload.device_id or existing.barcode.code != payload.barcode:
        raise Conflict("CLIENT_SCAN_ID_REUSED", "clientScanId already used for a different scan")
    return to_result(existing, replayed=True)


def _resolve_session(db: Session, raw_session_id: str | None) -> tuple[CollectionSession | None, str | None]:
    """Returns (session, conflict_state)."""
    if not raw_session_id:
        return None, None
    try:
        session = SessionRepo(db).get(uuid.UUID(raw_session_id))
    except ValueError:
        session = None
    if session is None:
        return None, Scan.STATE_SESSION_NOT_FOUND
    if session.status != CollectionSession.STATUS_OPEN:
        return session, Scan.STATE_SESSION_CLOSED
    return session, None


def submit_scan(db: Session, payload: ScanIn, auth: AuthContext) -> ScanResult:
    settings = get_settings()
    scans = ScanRepo(db)
    if auth.device_id != payload.device_id:
        raise Forbidden("DEVICE_MISMATCH", "deviceId does not match the authenticated device")

    existing = scans.by_client_id(payload.client_scan_id)
    if existing is not None:
        return _replay(existing, payload)

    device = _check_device(db, payload.device_id)
    if len(payload.barcode) > settings.max_barcode_length:
        raise DomainError("BARCODE_TOO_LONG", "Barcode exceeds maximum length", status_code=422)

    operator_id = payload.operator_id
    if operator_id is None or UserRepo(db).get(operator_id) is None:
        operator_id = auth.user.id

    scanned_at = device_time_to_utc(payload.scanned_at_device)
    now = utcnow()
    try:
        barcode = BarcodeRepo(db).get_or_create(payload.barcode, scanned_at)
        session, conflict_state = _resolve_session(db, payload.session_id)

        state = conflict_state or Scan.STATE_ACCEPTED
        if state == Scan.STATE_ACCEPTED:
            window = device.duplicate_window_seconds
            if window is None:
                window = settings.duplicate_window_seconds
            if window > 0 and scans.find_recent_duplicate(
                    device.id, operator_id, session.id if session else None, barcode.id, scanned_at, window):
                state = Scan.STATE_DUPLICATE

        scan = Scan(
            client_scan_id=payload.client_scan_id,
            device_id=device.id,
            operator_id=operator_id,
            session_id=session.id if session else None,
            requested_session_id=payload.session_id,
            barcode_id=barcode.id,
            raw_barcode=payload.raw_barcode if payload.raw_barcode is not None else payload.barcode,
            source=payload.source,
            scanned_at_device=scanned_at,
            received_at_server=now,
            result=barcode.status,
            sync_state=state,
        )
        with db.begin_nested():
            db.add(scan)
            db.flush()
        device.last_seen_at = now
        db.commit()
    except IntegrityError:
        # Concurrent resend of the same clientScanId won the race: answer with the stored result.
        db.rollback()
        existing = scans.by_client_id(payload.client_scan_id)
        if existing is None:
            raise
        return _replay(existing, payload)

    db.refresh(scan)
    return to_result(scan)


def submit_batch(db: Session, payloads: list[ScanIn], auth: AuthContext) -> list[ScanResult]:
    """Each scan is processed independently; one failure never discards the others."""
    results: list[ScanResult] = []
    for payload in payloads:
        try:
            results.append(submit_scan(db, payload, auth))
        except DomainError as exc:
            db.rollback()
            results.append(ScanResult(accepted=False, result="ERROR", client_scan_id=payload.client_scan_id,
                                      barcode=payload.barcode, error=exc.code, message=exc.message))
    return results
