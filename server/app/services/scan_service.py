"""Scan intake: idempotent by clientScanId, never loses an accepted payload.

Rules (in order):
1. Same clientScanId already stored -> return the stored result (idempotent resend, never adds stock twice).
2. The product is identified by the first 10 characters of the reading (cProd); the full reading is kept.
   Readings shorter than 10 characters are refused (BARCODE_TOO_SHORT).
3. Unknown product codes are stored as UNKNOWN scans and add no stock.
4. Session closed / missing -> stored as a conflict for administrative resolution (no stock until accepted).
5. Same device+operator+session+barcode within the duplicate window -> stored as DUPLICATE (no stock).
6. Otherwise a known product scan adds +1 stock (SCAN_IN) in the same transaction as the scan row.
A value on the admin blocklist is stored as BLOCKED (any collector) and adds no stock.
Programming scans (web collector) first apply the production barcode rules (barcode_rules): EAN / wrong code and
products outside the programming are stored for audit as WRONG_BARCODE / NOT_IN_PROGRAM and add no stock.
"""
import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import Conflict, DomainError, Forbidden
from app.core.timeutil import device_time_to_utc, utcnow
from app.models import Barcode, CollectionSession, Device, InventoryMovement, LoadProgramming, Scan
from app.repositories.repos import BarcodeRepo, DeviceRepo, ScanRepo, SessionRepo, UserRepo
from app.schemas.collector import ScanIn, ScanResult
from app.services import barcode_rules, blocklist_service, inventory_service, load_service, side_decoder
from app.services.auth_service import AuthContext


def to_result(scan: Scan, replayed: bool = False, current_stock: int | None = None,
              newly_ready_loads: int | None = None, ready_load_codes: list[str] | None = None) -> ScanResult:
    accepted_state = scan.sync_state == Scan.STATE_ACCEPTED
    product = scan.product
    return ScanResult(
        accepted=True,
        result=scan.result if accepted_state else scan.sync_state,
        client_scan_id=scan.client_scan_id,
        server_scan_id=scan.id,
        barcode=scan.barcode.code,
        barcode_status=scan.barcode.status,
        product_code=scan.product_code,
        item_name=product.name if product else None,
        current_stock=current_stock,
        newly_ready_loads=newly_ready_loads,
        ready_load_codes=ready_load_codes,
        programming_id=scan.programming_id,
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


def _replay(db: Session, existing: Scan, payload: ScanIn) -> ScanResult:
    if existing.device_id != payload.device_id or existing.barcode.code != payload.barcode:
        raise Conflict("CLIENT_SCAN_ID_REUSED", "clientScanId already used for a different scan")
    stock = inventory_service.balance_of(db, existing.product_id, existing.programming_id) \
        if existing.product_id else None
    return to_result(existing, replayed=True, current_stock=stock)


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


def _resolve_programming(db: Session, raw_id: str | None) -> tuple[LoadProgramming | None, str | None]:
    """Returns (programming, conflict_state). No id = legacy collector (global stock)."""
    if not raw_id:
        return None, None
    try:
        programming = db.get(LoadProgramming, uuid.UUID(raw_id))
    except ValueError:
        programming = None
    if programming is None:
        return None, Scan.STATE_PROGRAMMING_NOT_FOUND
    if programming.status != LoadProgramming.STATUS_OPEN:
        # Collected offline and synced after the programming closed: kept for review, never moved elsewhere.
        return programming, Scan.STATE_PROGRAMMING_CLOSED
    return programming, None


def submit_scan(db: Session, payload: ScanIn, auth: AuthContext) -> ScanResult:
    settings = get_settings()
    scans = ScanRepo(db)
    if auth.device_id != payload.device_id:
        raise Forbidden("DEVICE_MISMATCH", "deviceId does not match the authenticated device")

    existing = scans.by_client_id(payload.client_scan_id)
    if existing is not None:
        return _replay(db, existing, payload)

    device = _check_device(db, payload.device_id)
    if len(payload.barcode) > settings.max_barcode_length:
        raise DomainError("BARCODE_TOO_LONG", "Barcode exceeds maximum length", status_code=422)
    product_code = inventory_service.normalize_product_code(payload.barcode)
    if product_code is None:
        raise DomainError("BARCODE_TOO_SHORT", "Código inválido: mínimo de 10 caracteres", status_code=422)

    operator_id = payload.operator_id
    if operator_id is None or UserRepo(db).get(operator_id) is None:
        operator_id = auth.user.id

    scanned_at = device_time_to_utc(payload.scanned_at_device)
    now = utcnow()
    current_stock = None
    newly_ready = None
    ready_codes: list[str] | None = None
    try:
        product = inventory_service.product_by_code(db, product_code)
        barcode = BarcodeRepo(db).get_or_create(payload.barcode, scanned_at)
        if product is not None and barcode.item_id is None:
            barcode.item_id, barcode.status = product.id, Barcode.STATUS_KNOWN
        session, conflict_state = _resolve_session(db, payload.session_id)
        programming, programming_state = _resolve_programming(db, payload.programming_id)
        programming_id = programming.id if programming else None

        rule_state = None
        if blocklist_service.is_blocked(db, payload.barcode):
            rule_state = Scan.STATE_BLOCKED
        elif payload.programming_id:
            # Before the closed-programming conflict: a refused code must never be accepted into stock later.
            rule_state = barcode_rules.classify(
                db, payload.barcode, product,
                programming.id if programming is not None and programming_state != Scan.STATE_PROGRAMMING_NOT_FOUND
                else None)
        state = rule_state or programming_state or conflict_state or Scan.STATE_ACCEPTED
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
            product_code=product_code,
            product_id=product.id if product else None,
            programming_id=programming_id,
            side=side_decoder.decode_side(product, payload.barcode),
            result=Scan.RESULT_KNOWN if product else Scan.RESULT_UNKNOWN,
            sync_state=state,
        )
        with db.begin_nested():
            db.add(scan)
            db.flush()
        if product is not None:
            if state == Scan.STATE_ACCEPTED:
                # Same transaction as the scan row: both are committed or neither.
                # Production stock of the selected programming; any compatible load of that programming
                # may use it. A load number embedded in the label is deliberately ignored.
                current_stock = inventory_service.apply_movement(
                    db, product.id, InventoryMovement.SCAN_IN, 1, programming_id=programming_id, side=scan.side,
                    scan_id=scan.id,
                    device_id=device.id, user_id=operator_id, now=now)
                ready_codes = load_service.newly_ready_loads(db, product.id, current_stock, programming_id)
                newly_ready = len(ready_codes)
            else:
                current_stock = inventory_service.balance_of(db, product.id, programming_id)
        device.last_seen_at = now
        db.commit()
    except IntegrityError:
        # Concurrent resend of the same clientScanId won the race: answer with the stored result.
        db.rollback()
        existing = scans.by_client_id(payload.client_scan_id)
        if existing is None:
            raise
        return _replay(db, existing, payload)

    db.refresh(scan)
    return to_result(scan, current_stock=current_stock, newly_ready_loads=newly_ready, ready_load_codes=ready_codes)


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
