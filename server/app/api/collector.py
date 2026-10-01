"""Endpoints used by collectors. Payloads are small and plain JSON for HttpWebRequest clients."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import client_ip, current_auth
from app.core.config import get_settings
from app.core.database import get_db
from app.core.errors import DomainError
from app.models import CollectionSession
from app.repositories.repos import SessionRepo
from app.schemas.collector import (DeviceConfigOut, DeviceProfileIn, DeviceProfileOut, HeartbeatIn, HeartbeatOut,
                                   ItemLookupOut, LoginRequest, LoginResponse, ScanBatchIn, ScanBatchOut, ScanIn,
                                   ScanResult, SessionOut)
from app.services import auth_service, catalog_service, device_service, scan_service
from app.services.auth_service import AuthContext

router = APIRouter(prefix="/api")


@router.post("/auth/login", response_model=LoginResponse)
def login(req: LoginRequest, db: Session = Depends(get_db), ip: str | None = Depends(client_ip)):
    return auth_service.login(db, req, ip)


@router.get("/sessions", response_model=list[SessionOut])
def open_sessions(db: Session = Depends(get_db), _: AuthContext = Depends(current_auth)):
    return SessionRepo(db).list(CollectionSession.STATUS_OPEN)


@router.post("/scans", response_model=ScanResult)
def post_scan(payload: ScanIn, db: Session = Depends(get_db), auth: AuthContext = Depends(current_auth)):
    return scan_service.submit_scan(db, payload, auth)


@router.post("/scans/batch", response_model=ScanBatchOut)
def post_scan_batch(payload: ScanBatchIn, db: Session = Depends(get_db),
                    auth: AuthContext = Depends(current_auth)):
    if len(payload.scans) > get_settings().max_batch_size:
        raise DomainError("BATCH_TOO_LARGE", f"Maximum {get_settings().max_batch_size} scans per batch",
                          status_code=413)
    return ScanBatchOut(results=scan_service.submit_batch(db, payload.scans, auth))


@router.get("/items/by-barcode/{barcode:path}", response_model=ItemLookupOut)
def item_by_barcode(barcode: str, db: Session = Depends(get_db), _: AuthContext = Depends(current_auth)):
    return catalog_service.lookup(db, barcode)


@router.get("/device/config", response_model=DeviceConfigOut)
def device_config(device_id: str = Query(alias="deviceId"), db: Session = Depends(get_db),
                  auth: AuthContext = Depends(current_auth)):
    return device_service.get_config(db, device_id, auth)


@router.post("/device/heartbeat", response_model=HeartbeatOut)
def device_heartbeat(hb: HeartbeatIn, db: Session = Depends(get_db), auth: AuthContext = Depends(current_auth),
                     ip: str | None = Depends(client_ip)):
    return device_service.heartbeat(db, hb, auth, ip)


@router.post("/device/profile", response_model=DeviceProfileOut)
def device_profile(data: DeviceProfileIn, db: Session = Depends(get_db), auth: AuthContext = Depends(current_auth)):
    return device_service.update_profile(db, data.device_id, data.name, auth)
