from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.errors import Forbidden, Unauthorized
from app.services.auth_service import AuthContext, authenticate_token

_bearer = HTTPBearer(auto_error=False)


def current_auth(creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
                 db: Session = Depends(get_db)) -> AuthContext:
    if creds is None or not creds.credentials:
        raise Unauthorized("NOT_AUTHENTICATED", "Login necessário")
    return authenticate_token(db, creds.credentials)


def admin_auth(auth: AuthContext = Depends(current_auth)) -> AuthContext:
    if not auth.is_admin:
        raise Forbidden("ADMIN_REQUIRED", "Acesso restrito a administradores")
    return auth


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None
