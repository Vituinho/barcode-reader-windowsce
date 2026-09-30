import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import admin_auth
from app.core.database import get_db
from app.core.timeutil import device_time_to_utc, utcnow
from app.repositories.repos import ScanFilter
from app.schemas.admin import (BarcodeAssign, BarcodeOut, DashboardOut, DeviceCreate, DeviceOut, DeviceUpdate,
                               ItemCreate, ItemOut, ItemUpdate, ScanOut, ScanPage, ScanResolve, SessionAdminOut,
                               SessionCreate, UserCreate, UserOut, UserUpdate)
from app.services import admin_service, catalog_service, device_service
from app.services.auth_service import AuthContext

router = APIRouter(prefix="/api/admin")


@router.get("/me", response_model=UserOut)
def me(auth: AuthContext = Depends(admin_auth)):
    return auth.user


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(db: Session = Depends(get_db), _: AuthContext = Depends(admin_auth)):
    return admin_service.dashboard(db)


# ---- sessions ----
@router.get("/sessions", response_model=list[SessionAdminOut])
def sessions(status: str | None = None, db: Session = Depends(get_db), _: AuthContext = Depends(admin_auth)):
    return admin_service.list_sessions(db, status)


@router.post("/sessions", response_model=SessionAdminOut)
def create_session(data: SessionCreate, db: Session = Depends(get_db), auth: AuthContext = Depends(admin_auth)):
    return SessionAdminOut.model_validate(admin_service.create_session(db, data, auth))


@router.post("/sessions/{session_id}/close", response_model=SessionAdminOut)
def close_session(session_id: uuid.UUID, db: Session = Depends(get_db), auth: AuthContext = Depends(admin_auth)):
    return SessionAdminOut.model_validate(admin_service.set_session_status(db, session_id, False, auth))


@router.post("/sessions/{session_id}/reopen", response_model=SessionAdminOut)
def reopen_session(session_id: uuid.UUID, db: Session = Depends(get_db), auth: AuthContext = Depends(admin_auth)):
    return SessionAdminOut.model_validate(admin_service.set_session_status(db, session_id, True, auth))


@router.post("/sessions/{session_id}/resolve-conflicts")
def resolve_session_conflicts(session_id: uuid.UUID, data: ScanResolve, db: Session = Depends(get_db),
                              auth: AuthContext = Depends(admin_auth)):
    return {"resolved": admin_service.resolve_session_conflicts(db, session_id, data.action, data.note, auth)}


# ---- scans ----
def scan_filter(deviceId: str | None = None, operatorId: uuid.UUID | None = None,  # noqa: N803
                sessionId: uuid.UUID | None = None, syncState: str | None = None,  # noqa: N803
                barcode: str | None = None, result: str | None = None,
                dateFrom: datetime | None = None, dateTo: datetime | None = None) -> ScanFilter:  # noqa: N803
    return ScanFilter(device_id=deviceId or None, operator_id=operatorId, session_id=sessionId,
                      sync_state=syncState or None, barcode=barcode or None, result=result or None,
                      date_from=device_time_to_utc(dateFrom) if dateFrom else None,
                      date_to=device_time_to_utc(dateTo) if dateTo else None)


@router.get("/scans", response_model=ScanPage)
def scans(flt: ScanFilter = Depends(scan_filter), limit: int = 100, offset: int = 0,
          db: Session = Depends(get_db), _: AuthContext = Depends(admin_auth)):
    return admin_service.query_scans(db, flt, limit, offset)


@router.get("/scans/export.csv")
def export_scans(flt: ScanFilter = Depends(scan_filter), db: Session = Depends(get_db),
                 _: AuthContext = Depends(admin_auth)):
    name = f"leituras-{utcnow().strftime('%Y%m%d-%H%M%S')}.csv"
    return StreamingResponse(admin_service.export_scans_csv(db, flt), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.post("/scans/{scan_id}/resolve", response_model=ScanOut)
def resolve_scan(scan_id: uuid.UUID, data: ScanResolve, db: Session = Depends(get_db),
                 auth: AuthContext = Depends(admin_auth)):
    return admin_service.resolve_scan_by_id(db, scan_id, data.action, data.note, auth)


# ---- items / barcodes ----
@router.get("/items", response_model=list[ItemOut])
def items(q: str | None = None, db: Session = Depends(get_db), _: AuthContext = Depends(admin_auth)):
    return catalog_service.list_items(db, q)


@router.post("/items", response_model=ItemOut)
def create_item(data: ItemCreate, db: Session = Depends(get_db), auth: AuthContext = Depends(admin_auth)):
    return catalog_service.create_item(db, data, auth)


@router.patch("/items/{item_id}", response_model=ItemOut)
def update_item(item_id: uuid.UUID, data: ItemUpdate, db: Session = Depends(get_db),
                auth: AuthContext = Depends(admin_auth)):
    return catalog_service.update_item(db, item_id, data, auth)


@router.get("/barcodes", response_model=list[BarcodeOut])
def barcodes(status: str | None = None, q: str | None = None, db: Session = Depends(get_db),
             _: AuthContext = Depends(admin_auth)):
    return catalog_service.list_barcodes(db, status, q)


@router.post("/barcodes/{barcode_id}/assign", response_model=BarcodeOut)
def assign_barcode(barcode_id: uuid.UUID, data: BarcodeAssign, db: Session = Depends(get_db),
                   auth: AuthContext = Depends(admin_auth)):
    return catalog_service.assign_barcode(db, barcode_id, data.item_id, auth)


# ---- devices ----
@router.get("/devices", response_model=list[DeviceOut])
def devices(db: Session = Depends(get_db), _: AuthContext = Depends(admin_auth)):
    return device_service.list_devices(db)


@router.post("/devices", response_model=DeviceOut)
def create_device(data: DeviceCreate, db: Session = Depends(get_db), auth: AuthContext = Depends(admin_auth)):
    return device_service.create_device(db, data, auth)


@router.patch("/devices/{device_id}", response_model=DeviceOut)
def update_device(device_id: str, data: DeviceUpdate, db: Session = Depends(get_db),
                  auth: AuthContext = Depends(admin_auth)):
    return device_service.update_device(db, device_id, data, auth)


# ---- users ----
@router.get("/users", response_model=list[UserOut])
def users(db: Session = Depends(get_db), _: AuthContext = Depends(admin_auth)):
    return admin_service.list_users(db)


@router.post("/users", response_model=UserOut)
def create_user(data: UserCreate, db: Session = Depends(get_db), auth: AuthContext = Depends(admin_auth)):
    return admin_service.create_user(db, data, auth)


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: uuid.UUID, data: UserUpdate, db: Session = Depends(get_db),
                auth: AuthContext = Depends(admin_auth)):
    return admin_service.update_user(db, user_id, data, auth)
