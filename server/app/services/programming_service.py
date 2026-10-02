"""Programação de cargas: production day that groups imported loads, production scans and production stock."""
import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.errors import Conflict, NotFound
from app.core.timeutil import utcnow
from app.models import Invoice, Load, LoadProgramming
from app.repositories.repos import AuditRepo
from app.services.auth_service import AuthContext


def get(db: Session, programming_id: uuid.UUID) -> LoadProgramming:
    programming = db.get(LoadProgramming, programming_id)
    if programming is None:
        raise NotFound("PROGRAMMING_NOT_FOUND", "Programação não encontrada")
    return programming


def require_open(db: Session, programming_id: uuid.UUID) -> LoadProgramming:
    programming = get(db, programming_id)
    if programming.status != LoadProgramming.STATUS_OPEN:
        raise Conflict("PROGRAMMING_CLOSED", "Programação encerrada: reabra para importar ou coletar")
    return programming


def list_all(db: Session, status: str | None = None, limit: int = 200) -> list[LoadProgramming]:
    stmt = select(LoadProgramming).order_by(LoadProgramming.scheduled_date.desc(), LoadProgramming.created_at.desc())
    if status:
        stmt = stmt.where(LoadProgramming.status == status)
    return list(db.scalars(stmt.limit(limit)))


def create(db: Session, scheduled_date: date, name: str | None, auth: AuthContext) -> LoadProgramming:
    programming = LoadProgramming(scheduled_date=scheduled_date, name=(name or "").strip() or None,
                                  status=LoadProgramming.STATUS_OPEN, created_by_id=auth.user.id)
    db.add(programming)
    db.flush()
    AuditRepo(db).add("PROGRAMMING_CREATED", actor_user_id=auth.user.id, entity_type="programming",
                      entity_id=str(programming.id), details={"date": scheduled_date.isoformat()})
    db.commit()
    return programming


def set_status(db: Session, programming_id: uuid.UUID, open_: bool, auth: AuthContext) -> LoadProgramming:
    programming = get(db, programming_id)
    if open_:
        programming.status, programming.closed_at, programming.closed_by_id = LoadProgramming.STATUS_OPEN, None, None
    else:
        programming.status, programming.closed_at, programming.closed_by_id = (
            LoadProgramming.STATUS_CLOSED, utcnow(), auth.user.id)
    AuditRepo(db).add("PROGRAMMING_REOPENED" if open_ else "PROGRAMMING_CLOSED", actor_user_id=auth.user.id,
                      entity_type="programming", entity_id=str(programming.id))
    db.commit()
    return programming


def load_ids(db: Session, programming_id: uuid.UUID) -> list[uuid.UUID]:
    return list(db.scalars(select(Load.id).where(Load.programming_id == programming_id)))


def warning_invoices(db: Session, programming_id: uuid.UUID) -> int:
    return db.scalar(select(func.count()).select_from(Invoice).join(Load, Load.id == Invoice.load_id).where(
        Load.programming_id == programming_id, func.json_typeof(Invoice.warnings) == "array")) or 0
