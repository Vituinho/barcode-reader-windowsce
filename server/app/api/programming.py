"""Programações de cargas. Reads: any authenticated user. Create/close/import: ADMIN."""
import uuid

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import admin_auth, current_auth
from app.core.database import get_db
from app.core.errors import DomainError
from app.models import LoadProgramming
from app.schemas.logistics import ImportReportOut, ProductCoverageOut, ProgrammingIn, ProgrammingOut
from app.services import import_service, load_service, programming_service
from app.services.auth_service import AuthContext

router = APIRouter(prefix="/api/programmings")


def programming_out(db: Session, p: LoadProgramming) -> ProgrammingOut:
    views = load_service.list_views(db, programming_id=p.id, limit=5000)
    out = ProgrammingOut.model_validate(p)
    out.load_count = len(views)
    out.dispatched_count = sum(1 for v in views if v.status == "DISPATCHED")
    out.ready_count = sum(1 for v in views if v.status == "READY")
    out.review_count = sum(1 for v in views if v.status != "DISPATCHED" and v.needs_review)
    out.pending_count = out.load_count - out.dispatched_count - out.ready_count
    out.volumes_registered = load_service.volumes_registered(db, p.id)
    out.warning_invoices = programming_service.warning_invoices(db, p.id)
    for key, value in load_service.programming_totals(views).items():
        setattr(out, key, value)
    out.stock_volumes = programming_service.stock_volumes(db, p.id)
    return out


@router.get("/import-capabilities")
def import_capabilities(_: AuthContext = Depends(current_auth)):
    """Lets the UI tell users up front whether RAR archives can be opened by this server."""
    from app.services import rar_archive

    return {"zip": True, "rar": rar_archive.tool_available()}


@router.get("", response_model=list[ProgrammingOut])
def list_programmings(status: str | None = Query(default=None, pattern="^(OPEN|CLOSED)$"),
                      db: Session = Depends(get_db), _: AuthContext = Depends(current_auth)):
    return [programming_out(db, p) for p in programming_service.list_all(db, status)]


@router.post("", response_model=ProgrammingOut)
def create_programming(data: ProgrammingIn, db: Session = Depends(get_db), auth: AuthContext = Depends(admin_auth)):
    return programming_out(db, programming_service.create(db, data.scheduled_date, data.name, auth))


@router.get("/{programming_id}", response_model=ProgrammingOut)
def get_programming(programming_id: uuid.UUID, db: Session = Depends(get_db), _: AuthContext = Depends(current_auth)):
    return programming_out(db, programming_service.get(db, programming_id))


@router.post("/{programming_id}/close", response_model=ProgrammingOut)
def close_programming(programming_id: uuid.UUID, db: Session = Depends(get_db), auth: AuthContext = Depends(admin_auth)):
    return programming_out(db, programming_service.set_status(db, programming_id, False, auth))


@router.get("/{programming_id}/products", response_model=list[ProductCoverageOut])
def product_coverage(programming_id: uuid.UUID, db: Session = Depends(get_db), _: AuthContext = Depends(current_auth)):
    programming_service.get(db, programming_id)
    return [ProductCoverageOut(product_code=p.product_code, description=p.description, required=p.required,
                               covered=p.covered, stock=p.stock, missing=p.missing, dispatched=p.dispatched,
                               open_loads=p.open_loads, needs_review=p.needs_review)
            for p in load_service.product_coverage(db, programming_id)]


@router.get("/{programming_id}/scan-rules")
def scan_rules(programming_id: uuid.UUID, db: Session = Depends(get_db), _: AuthContext = Depends(current_auth)):
    """Lets the collector give instant feedback offline. The server still classifies every synced scan."""
    from app.services import barcode_rules, blocklist_service

    programming_service.get(db, programming_id)
    return {"productCodes": sorted(barcode_rules.programming_product_codes(db, programming_id)),
            "eans": sorted(barcode_rules.known_eans(db)),
            "blocked": blocklist_service.active_values(db)}


@router.post("/{programming_id}/reopen", response_model=ProgrammingOut)
def reopen_programming(programming_id: uuid.UUID, db: Session = Depends(get_db), auth: AuthContext = Depends(admin_auth)):
    return programming_out(db, programming_service.set_status(db, programming_id, True, auth))


@router.post("/{programming_id}/import", response_model=ImportReportOut)
def import_into_programming(programming_id: uuid.UUID, files: list[UploadFile] = File(...),
                            db: Session = Depends(get_db), auth: AuthContext = Depends(admin_auth)):
    programming_service.require_open(db, programming_id)
    uploads: list[tuple[str, bytes]] = []
    total = 0
    for f in files:
        data = f.file.read(import_service.MAX_REQUEST_BYTES + 1)
        total += len(data)
        if total > import_service.MAX_REQUEST_BYTES:
            raise DomainError("UPLOAD_TOO_LARGE", "Envio maior que 60 MB; divida em partes", status_code=413)
        uploads.append((f.filename or "arquivo", data))
    report = import_service.import_files(db, uploads, auth, programming_id=programming_id)
    return ImportReportOut(**report.__dict__)
