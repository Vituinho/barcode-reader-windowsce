import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import admin, collector, releases
from app.core.config import get_settings
from app.core.errors import DomainError
from app.core.timeutil import utcnow

log = logging.getLogger("givova")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Givova Coleta API", version="1.0.0")
    origins = settings.cors_origin_list
    if origins:
        # Only the admin panel origin(s); collectors are not browsers and need no CORS.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_methods=["GET", "POST", "PATCH"],
            allow_headers=["Authorization", "Content-Type", "Accept"],
            expose_headers=["Content-Disposition"],
        )
    else:
        log.warning("ADMIN_WEB_ORIGIN not set: browser requests from the admin panel will be blocked (CORS)")

    @app.exception_handler(DomainError)
    async def domain_error_handler(_: Request, exc: DomainError):
        return JSONResponse(status_code=exc.status_code, content={"error": exc.code, "message": exc.message})

    @app.exception_handler(Exception)
    async def unexpected_error_handler(_: Request, exc: Exception):
        log.exception("Unhandled error", exc_info=exc)
        return JSONResponse(status_code=500, content={"error": "INTERNAL_ERROR", "message": "Erro interno"})

    @app.get("/api/health")
    def health():
        # Used by the collector "Testar conexão" button; no auth, no database access.
        return {"ok": True, "serverTime": utcnow().isoformat()}

    app.include_router(collector.router)
    app.include_router(admin.router)
    app.include_router(releases.router)
    return app


app = create_app()
