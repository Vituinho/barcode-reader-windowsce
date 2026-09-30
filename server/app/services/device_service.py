from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import Conflict, Forbidden, NotFound
from app.core.timeutil import device_time_to_utc, utcnow
from app.models import Device
from app.repositories.repos import AuditRepo, DeviceRepo, UserRepo
from app.schemas.admin import DeviceCreate, DeviceOut, DeviceUpdate
from app.schemas.collector import DeviceConfigOut, HeartbeatIn, HeartbeatOut
from app.services.auth_service import AuthContext


def connectivity(device: Device) -> tuple[str, int | None]:
    """ONLINE/OFFLINE is only a statement about heartbeat age, never a real-time claim."""
    age = None
    if device.last_seen_at is not None:
        age = int((utcnow() - device.last_seen_at).total_seconds())
    if device.status == Device.STATUS_DISABLED:
        return "DISABLED", age
    if age is not None and age <= get_settings().device_online_threshold_seconds:
        return "ONLINE", age
    return "OFFLINE", age


def to_out(device: Device) -> DeviceOut:
    state, age = connectivity(device)
    return DeviceOut(
        id=device.id, name=device.name, status=device.status, connectivity=state,
        app_version=device.app_version, last_seen_at=device.last_seen_at, last_seen_age_seconds=age,
        last_operator_name=device.last_operator.full_name if device.last_operator else None,
        last_ip=device.last_ip, battery_level=device.battery_level, pending_scans=device.pending_scans,
        clock_skew_seconds=device.clock_skew_seconds, sync_interval_seconds=device.sync_interval_seconds,
        duplicate_window_seconds=device.duplicate_window_seconds, created_at=device.created_at,
    )


def _own_device(db: Session, device_id: str, auth: AuthContext) -> Device:
    if auth.device_id != device_id:
        raise Forbidden("DEVICE_MISMATCH", "deviceId does not match the authenticated device")
    device = DeviceRepo(db).get(device_id)
    if device is None:
        raise NotFound("DEVICE_NOT_REGISTERED", "Coletor não cadastrado")
    return device


def get_config(db: Session, device_id: str, auth: AuthContext) -> DeviceConfigOut:
    settings = get_settings()
    device = _own_device(db, device_id, auth)
    return DeviceConfigOut(
        device_id=device.id, device_name=device.name, status=device.status,
        sync_interval_seconds=device.sync_interval_seconds or settings.device_sync_interval_seconds,
        duplicate_window_seconds=(device.duplicate_window_seconds
                                  if device.duplicate_window_seconds is not None
                                  else settings.duplicate_window_seconds),
        server_time=utcnow(),
    )


def heartbeat(db: Session, hb: HeartbeatIn, auth: AuthContext, client_ip: str | None) -> HeartbeatOut:
    device = _own_device(db, hb.device_id, auth)
    now = utcnow()
    device.last_seen_at = now
    device.last_ip = client_ip
    if hb.app_version:
        device.app_version = hb.app_version
    if hb.operator_id and UserRepo(db).get(hb.operator_id):
        device.last_operator_id = hb.operator_id
    device.battery_level = hb.battery_level
    device.pending_scans = hb.pending_scans
    if hb.timestamp is not None:
        device.clock_skew_seconds = int((device_time_to_utc(hb.timestamp) - now).total_seconds())
    db.commit()
    return HeartbeatOut(ok=True, server_time=now, device_status=device.status)


def list_devices(db: Session) -> list[DeviceOut]:
    return [to_out(d) for d in DeviceRepo(db).list()]


def create_device(db: Session, data: DeviceCreate, auth: AuthContext) -> DeviceOut:
    repo = DeviceRepo(db)
    if repo.get(data.id):
        raise Conflict("DEVICE_EXISTS", "Coletor já cadastrado")
    device = Device(id=data.id, name=data.name, status=Device.STATUS_ACTIVE)
    db.add(device)
    AuditRepo(db).add("DEVICE_CREATED", actor_user_id=auth.user.id, entity_type="device", entity_id=data.id)
    db.commit()
    db.refresh(device)
    return to_out(device)


def update_device(db: Session, device_id: str, data: DeviceUpdate, auth: AuthContext) -> DeviceOut:
    device = DeviceRepo(db).get(device_id)
    if device is None:
        raise NotFound("DEVICE_NOT_FOUND")
    changes = data.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(device, field, value)
    AuditRepo(db).add("DEVICE_UPDATED", actor_user_id=auth.user.id, entity_type="device", entity_id=device_id,
                      details={k: v for k, v in changes.items()})
    db.commit()
    db.refresh(device)
    return to_out(device)
