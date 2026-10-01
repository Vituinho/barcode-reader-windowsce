"""Release manifest endpoints. Reading: any authenticated user (admin panel, future collector update check).
Writing: ADMIN only. Only metadata and external download URLs are stored; no filesystem paths."""
import uuid

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.orm import Session

from app.api.deps import admin_auth, current_auth
from app.core.database import get_db
from app.schemas.releases import PLATFORM, SEMVER, LatestReleaseOut, ReleaseCreate, ReleaseOut, ReleaseUpdate
from app.services import release_service
from app.services.auth_service import AuthContext

router = APIRouter()


@router.get("/api/releases", response_model=list[ReleaseOut])
def active_releases(db: Session = Depends(get_db), _: AuthContext = Depends(current_auth)):
    return release_service.list_active(db)


@router.get("/api/releases/latest/{platform}", response_model=LatestReleaseOut)
def latest_release(platform: str = Path(pattern=PLATFORM),
                   current_version: str | None = Query(default=None, alias="currentVersion", pattern=SEMVER),
                   db: Session = Depends(get_db), _: AuthContext = Depends(current_auth)):
    return release_service.latest(db, platform, current_version)


@router.get("/api/admin/releases", response_model=list[ReleaseOut])
def all_releases(db: Session = Depends(get_db), _: AuthContext = Depends(admin_auth)):
    return release_service.list_all(db)


@router.post("/api/admin/releases", response_model=ReleaseOut)
def create_release(data: ReleaseCreate, db: Session = Depends(get_db), auth: AuthContext = Depends(admin_auth)):
    return release_service.create(db, data, auth)


@router.patch("/api/admin/releases/{release_id}", response_model=ReleaseOut)
def update_release(release_id: uuid.UUID, data: ReleaseUpdate, db: Session = Depends(get_db),
                   auth: AuthContext = Depends(admin_auth)):
    return release_service.update_release(db, release_id, data, auth)


@router.post("/api/admin/releases/{release_id}/activate", response_model=ReleaseOut)
def activate_release(release_id: uuid.UUID, db: Session = Depends(get_db), auth: AuthContext = Depends(admin_auth)):
    return release_service.set_active(db, release_id, True, auth)


@router.post("/api/admin/releases/{release_id}/deactivate", response_model=ReleaseOut)
def deactivate_release(release_id: uuid.UUID, db: Session = Depends(get_db),
                       auth: AuthContext = Depends(admin_auth)):
    return release_service.set_active(db, release_id, False, auth)
