import uuid
from dataclasses import dataclass

import jwt
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import Forbidden, Unauthorized
from app.core.security import create_access_token, decode_access_token, hash_password, verify_password
from app.core.timeutil import utcnow
from app.models import Device, User
from app.repositories.repos import AuditRepo, DeviceRepo, UserRepo
from app.schemas.collector import LoginRequest, LoginResponse

# Used to keep login timing similar for unknown usernames
_DUMMY_HASH = hash_password("timing-equalizer")


@dataclass
class AuthContext:
    user: User
    device_id: str | None

    @property
    def is_admin(self) -> bool:
        return self.user.role == User.ROLE_ADMIN


def login(db: Session, req: LoginRequest, client_ip: str | None) -> LoginResponse:
    users, devices, audit = UserRepo(db), DeviceRepo(db), AuditRepo(db)
    user = users.by_username(req.username)
    if user is None:
        verify_password(req.password, _DUMMY_HASH)
        raise Unauthorized("INVALID_CREDENTIALS", "Usuário ou senha inválidos")
    if not verify_password(req.password, user.password_hash):
        audit.add("LOGIN_FAILED", actor_user_id=user.id, device_id=req.device_id)
        db.commit()
        raise Unauthorized("INVALID_CREDENTIALS", "Usuário ou senha inválidos")
    if not user.is_active:
        raise Forbidden("USER_DISABLED", "Usuário desativado")

    device_id = req.device_id.strip() if req.device_id else None
    if device_id:
        device = devices.get(device_id)
        if device is None:
            if not get_settings().auto_register_devices:
                raise Forbidden("DEVICE_NOT_REGISTERED", "Coletor não cadastrado")
            device = Device(id=device_id, name=device_id, status=Device.STATUS_ACTIVE)
            db.add(device)
            audit.add("DEVICE_AUTO_REGISTERED", actor_user_id=user.id, device_id=device_id,
                      entity_type="device", entity_id=device_id)
        if device.status == Device.STATUS_DISABLED:
            raise Forbidden("DEVICE_DISABLED", "Coletor desativado")
        device.last_operator_id = user.id
        device.last_seen_at = utcnow()
        device.last_ip = client_ip

    audit.add("LOGIN", actor_user_id=user.id, device_id=device_id)
    db.commit()
    token, expires = create_access_token(str(user.id), user.role, device_id)
    return LoginResponse(access_token=token, expires_at=expires, user_id=user.id, username=user.username,
                         full_name=user.full_name, role=user.role, device_id=device_id)


def authenticate_token(db: Session, token: str) -> AuthContext:
    try:
        claims = decode_access_token(token)
    except jwt.ExpiredSignatureError:
        raise Unauthorized("TOKEN_EXPIRED", "Login expirado")
    except jwt.PyJWTError:
        raise Unauthorized("INVALID_TOKEN", "Token inválido")
    try:
        user = UserRepo(db).get(uuid.UUID(claims["sub"]))
    except (KeyError, ValueError):
        raise Unauthorized("INVALID_TOKEN", "Token inválido")
    if user is None or not user.is_active:
        raise Unauthorized("USER_DISABLED", "Usuário desativado")
    return AuthContext(user=user, device_id=claims.get("dev"))
