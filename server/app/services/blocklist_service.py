"""Admin blocklist of exact barcode values. Matching is on the whole reading (surrounding whitespace trimmed)."""
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, DomainError, NotFound
from app.models import BlockedBarcode
from app.repositories.repos import AuditRepo
from app.services.auth_service import AuthContext


def is_blocked(db: Session, raw: str) -> bool:
    value = (raw or "").strip()
    return bool(value) and db.scalar(select(BlockedBarcode.id).where(
        BlockedBarcode.value == value, BlockedBarcode.active.is_(True))) is not None


def active_values(db: Session) -> list[str]:
    return list(db.scalars(select(BlockedBarcode.value).where(BlockedBarcode.active.is_(True))
                           .order_by(BlockedBarcode.value)))


def list_all(db: Session) -> list[BlockedBarcode]:
    return list(db.scalars(select(BlockedBarcode).order_by(BlockedBarcode.active.desc(),
                                                           BlockedBarcode.created_at.desc())))


def create(db: Session, value: str, reason: str | None, auth: AuthContext) -> BlockedBarcode:
    value = (value or "").strip()
    if not value:
        raise DomainError("VALUE_REQUIRED", "Informe o código a bloquear", status_code=422)
    existing = db.scalar(select(BlockedBarcode).where(BlockedBarcode.value == value))
    if existing is not None:
        if existing.active:
            raise Conflict("ALREADY_BLOCKED", "Código já está bloqueado")
        existing.active, existing.reason = True, (reason or "").strip() or existing.reason
        entry = existing
    else:
        entry = BlockedBarcode(value=value, reason=(reason or "").strip() or None, active=True,
                               created_by_id=auth.user.id)
        db.add(entry)
    db.flush()
    AuditRepo(db).add("BARCODE_BLOCKED", actor_user_id=auth.user.id, entity_type="blocked_barcode",
                      entity_id=str(entry.id), details={"value": value, "reason": entry.reason})
    db.commit()
    return entry


def set_active(db: Session, entry_id: uuid.UUID, active: bool, auth: AuthContext) -> BlockedBarcode:
    entry = db.get(BlockedBarcode, entry_id)
    if entry is None:
        raise NotFound("BLOCKED_BARCODE_NOT_FOUND", "Código bloqueado não encontrado")
    entry.active = active
    AuditRepo(db).add("BARCODE_BLOCKED" if active else "BARCODE_UNBLOCKED", actor_user_id=auth.user.id,
                      entity_type="blocked_barcode", entity_id=str(entry.id), details={"value": entry.value})
    db.commit()
    return entry
