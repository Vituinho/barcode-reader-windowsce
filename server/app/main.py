import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import admin, collector
from app.core.config import get_settings
from app.core.errors import DomainError
from app.core.timeutil import utcnow

log = logging.getLogger("givova")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Givova Coleta API", version="1.0.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )

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
    return app


app = create_app()
