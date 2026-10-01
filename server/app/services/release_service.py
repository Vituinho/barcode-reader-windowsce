"""Release manifest: one active (current) release per platform. Binaries live outside the database."""
import uuid

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import Conflict, NotFound
from app.core.timeutil import utcnow
from app.models import SoftwareRelease
from app.repositories.repos import AuditRepo
from app.schemas.releases import LatestReleaseOut, ReleaseCreate, ReleaseOut, ReleaseUpdate
from app.services.auth_service import AuthContext


def parse_semver(version: str) -> tuple[int, int, int]:
    major, minor, patch = (int(p) for p in version.split("."))
    return major, minor, patch


def list_active(db: Session) -> list[SoftwareRelease]:
    return list(db.scalars(select(SoftwareRelease).where(SoftwareRelease.active)
                           .order_by(SoftwareRelease.platform)))


def list_all(db: Session) -> list[SoftwareRelease]:
    return list(db.scalars(select(SoftwareRelease)
                           .order_by(SoftwareRelease.platform, SoftwareRelease.released_at.desc())))


def latest(db: Session, platform: str, current_version: str | None) -> LatestReleaseOut:
    release = db.scalar(select(SoftwareRelease).where(SoftwareRelease.platform == platform,
                                                      SoftwareRelease.active))
    if release is None:
        raise NotFound("NO_RELEASE", "Nenhuma versão publicada para esta plataforma")
    out = LatestReleaseOut.model_validate(release)
    if current_version:
        out.update_available = parse_semver(release.version) > parse_semver(current_version)
    return out


def _get(db: Session, release_id: uuid.UUID) -> SoftwareRelease:
    release = db.get(SoftwareRelease, release_id)
    if release is None:
        raise NotFound("RELEASE_NOT_FOUND")
    return release


def _deactivate_others(db: Session, release: SoftwareRelease) -> None:
    db.execute(update(SoftwareRelease)
               .where(SoftwareRelease.platform == release.platform, SoftwareRelease.id != release.id)
               .values(active=False))


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise Conflict("RELEASE_EXISTS", "Já existe uma versão com esta plataforma/versão")


def create(db: Session, data: ReleaseCreate, auth: AuthContext) -> ReleaseOut:
    values = data.model_dump()
    values["released_at"] = values["released_at"] or utcnow()
    want_active = values.pop("active")
    release = SoftwareRelease(**values, active=False)
    db.add(release)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise Conflict("RELEASE_EXISTS", "Já existe uma versão com esta plataforma/versão")
    if want_active:
        _deactivate_others(db, release)
        db.flush()
        release.active = True
    AuditRepo(db).add("RELEASE_CREATED", actor_user_id=auth.user.id, entity_type="release",
                      details={"platform": data.platform, "version": data.version})
    _commit(db)
    db.refresh(release)
    return ReleaseOut.model_validate(release)


def update_release(db: Session, release_id: uuid.UUID, data: ReleaseUpdate, auth: AuthContext) -> ReleaseOut:
    release = _get(db, release_id)
    changes = data.model_dump(exclude_unset=True)
    for required in ("version", "file_name", "download_url", "released_at"):
        if required in changes and changes[required] is None:
            changes.pop(required)
    for field, value in changes.items():
        setattr(release, field, value)
    AuditRepo(db).add("RELEASE_UPDATED", actor_user_id=auth.user.id, entity_type="release",
                      entity_id=str(release.id), details={"fields": sorted(changes)})
    _commit(db)
    db.refresh(release)
    return ReleaseOut.model_validate(release)


def set_active(db: Session, release_id: uuid.UUID, active: bool, auth: AuthContext) -> ReleaseOut:
    release = _get(db, release_id)
    if active:
        _deactivate_others(db, release)
        db.flush()
    release.active = active
    AuditRepo(db).add("RELEASE_ACTIVATED" if active else "RELEASE_DEACTIVATED", actor_user_id=auth.user.id,
                      entity_type="release", entity_id=str(release.id),
                      details={"platform": release.platform, "version": release.version})
    _commit(db)
    db.refresh(release)
    return ReleaseOut.model_validate(release)
