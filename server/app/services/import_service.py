"""NF-e XML import (single XMLs, many XMLs, or ZIP/RAR archives with folders).

Security: XML is parsed with defusedxml (no DTD, no entities, no external resolution). ZIP entries are read in
memory only (never extracted to disk); absolute/parent-relative paths are rejected; size, count and
compression-ratio limits stop zip bombs. Nothing is persisted to the filesystem.

Quantities: qCom/uCom/qVol are stored exactly as in the XML. A load requirement gets a physical volume count
only when it can be derived safely (discrete unit such as UN, integer qCom, and qVol consistent with the
invoice lines). Otherwise the requirement is left without a count (needs review) and a warning is recorded.
"""
import io
import uuid
import posixpath
import re
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, InvalidOperation
from xml.etree.ElementTree import Element, ParseError

from defusedxml import DefusedXmlException
from defusedxml.ElementTree import fromstring as safe_fromstring
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import DomainError
from app.models import Invoice, InvoiceItem, Item, Load, LoadItem
from app.repositories.repos import AuditRepo
from app.services import rar_archive
from app.services.auth_service import AuthContext

MAX_REQUEST_BYTES = 60 * 1024 * 1024
MAX_XML_BYTES = 5 * 1024 * 1024
MAX_FILES = 3000
MAX_ZIP_ENTRIES = 5000
MAX_ZIP_UNCOMPRESSED = 300 * 1024 * 1024
MAX_COMPRESSION_RATIO = 200

# Units whose quantity is a count of discrete pieces that can be matched 1:1 with scanned volumes.
DISCRETE_UNITS = {"UN", "UND", "UNID", "UNIDADE", "PC", "PCS", "PECA", "PEÇA", "PÇ"}

_LOAD_RE = re.compile(r"\bCarga\s*:\s*([A-Za-z0-9][A-Za-z0-9._-]{0,39})", re.IGNORECASE)
_ORDER_RE = re.compile(r"\bPedido\s*:\s*([A-Za-z0-9][A-Za-z0-9._/-]{0,39})", re.IGNORECASE)
_CUSTOMER_RE = re.compile(r"\bCliente\s*:\s*([A-Za-z0-9][A-Za-z0-9._-]{0,39})", re.IGNORECASE)


class InvalidXml(Exception):
    pass


@dataclass
class ParsedLine:
    line_number: int
    code: str
    description: str | None
    ean: str | None
    unit: str | None
    quantity: Decimal


@dataclass
class ParsedInvoice:
    access_key: str
    invoice_number: str | None
    issued_at: datetime | None
    customer_name: str | None
    customer_document: str | None
    city: str | None
    state: str | None
    load_code: str | None
    order_number: str | None
    customer_code: str | None
    volume_count: Decimal | None
    volume_species: str | None
    status_code: str | None
    lines: list[ParsedLine]


@dataclass
class Source:
    name: str      # file name only (no directories)
    folder: str | None
    data: bytes


@dataclass
class ImportReport:
    files_processed: int = 0
    xml_accepted: int = 0
    duplicates_skipped: int = 0
    invoices_imported: int = 0
    products_created: int = 0
    products_updated: int = 0
    ignored_files: list[str] = field(default_factory=list)
    invalid: list[dict] = field(default_factory=list)
    loads_created: list[str] = field(default_factory=list)
    loads_updated: list[str] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)

    def fail(self, name: str, code: str, message: str) -> None:
        self.invalid.append({"file": name, "code": code, "message": message})

    def warn(self, name: str, code: str, message: str, access_key: str | None = None, load: str | None = None):
        self.warnings.append({"file": name, "code": code, "message": message, "access_key": access_key, "load": load})


# ---- XML helpers (namespace-agnostic) ---------------------------------------------------------

def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _child(el: Element | None, name: str) -> Element | None:
    if el is None:
        return None
    for c in el:
        if _local(c.tag) == name:
            return c
    return None


def _children(el: Element | None, name: str) -> list[Element]:
    return [] if el is None else [c for c in el if _local(c.tag) == name]


def _path(el: Element | None, *names: str) -> Element | None:
    for n in names:
        el = _child(el, n)
    return el


def _text(el: Element | None, *names: str) -> str | None:
    target = _path(el, *names) if names else el
    if target is None or target.text is None:
        return None
    value = target.text.strip()
    return value or None


def _find_first(root: Element, name: str) -> Element | None:
    for el in root.iter():
        if _local(el.tag) == name:
            return el
    return None


def _decimal(value: str | None, what: str) -> Decimal:
    try:
        return Decimal(value)
    except (InvalidOperation, TypeError):
        raise InvalidXml(f"{what} inválido: {value!r}")


def _datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def parse_nfe(data: bytes) -> ParsedInvoice:
    try:
        root = safe_fromstring(data, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    except DefusedXmlException as exc:
        raise InvalidXml(f"XML recusado por segurança ({type(exc).__name__})")
    except (ParseError, ValueError) as exc:
        raise InvalidXml(f"XML malformado: {exc}")

    inf = _find_first(root, "infNFe")
    if inf is None:
        raise InvalidXml("Não é uma NF-e (infNFe ausente)")
    key = (inf.get("Id") or "").removeprefix("NFe")
    if not re.fullmatch(r"\d{44}", key):
        key = _text(_find_first(root, "infProt"), "chNFe") or ""
    if not re.fullmatch(r"\d{44}", key):
        raise InvalidXml("Chave de acesso ausente ou inválida")

    ide = _child(inf, "ide")
    dest = _child(inf, "dest")
    lines: list[ParsedLine] = []
    for det in _children(inf, "det"):
        prod = _child(det, "prod")
        code = _text(prod, "cProd")
        if not code:
            raise InvalidXml(f"Item {det.get('nItem')}: cProd ausente")
        ean = _text(prod, "cEAN")
        if ean and (ean.upper() == "SEM GTIN" or not ean.isdigit()):
            ean = None  # EAN is optional metadata only
        lines.append(ParsedLine(
            line_number=int(det.get("nItem") or len(lines) + 1),
            code=code,
            description=_text(prod, "xProd"),
            ean=ean[:14] if ean else None,
            unit=(_text(prod, "uCom") or "").upper() or None,
            quantity=_decimal(_text(prod, "qCom"), f"qCom do item {code}"),
        ))
    if not lines:
        raise InvalidXml("NF-e sem itens (det)")

    vols = _children(_child(inf, "transp"), "vol")
    qvol_values = [_text(v, "qVol") for v in vols]
    volume_count = sum((_decimal(v, "qVol") for v in qvol_values if v), Decimal(0)) if any(qvol_values) else None
    species = ", ".join(sorted({s for s in (_text(v, "esp") for v in vols) if s})) or None

    adic = _child(inf, "infAdic")
    info_text = " ".join(t for t in (_text(adic, "infAdFisco"), _text(adic, "infCpl")) if t)
    load_m, order_m, cust_m = _LOAD_RE.search(info_text), _ORDER_RE.search(info_text), _CUSTOMER_RE.search(info_text)

    return ParsedInvoice(
        access_key=key,
        invoice_number=_text(ide, "nNF"),
        issued_at=_datetime(_text(ide, "dhEmi") or _text(ide, "dEmi")),
        customer_name=_text(dest, "xNome"),
        customer_document=_text(dest, "CNPJ") or _text(dest, "CPF") or _text(dest, "idEstrangeiro"),
        city=_text(dest, "enderDest", "xMun"),
        state=_text(dest, "enderDest", "UF"),
        load_code=load_m.group(1) if load_m else None,
        order_number=order_m.group(1) if order_m else None,
        customer_code=cust_m.group(1) if cust_m else None,
        volume_count=volume_count,
        volume_species=species,
        status_code=_text(_find_first(root, "infProt"), "cStat"),
        lines=lines,
    )


# ---- upload handling --------------------------------------------------------------------------

def _safe_zip_member(name: str) -> tuple[str, str | None] | None:
    """Returns (file name, parent folder) or None when the path is unsafe (absolute, drive, '..')."""
    normalized = name.replace("\\", "/")
    if normalized.startswith("/") or re.match(r"^[A-Za-z]:", normalized) or "\x00" in normalized:
        return None
    parts = [p for p in normalized.split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        return None
    folder = parts[-2] if len(parts) > 1 else None
    return parts[-1], folder


def collect_sources(uploads: list[tuple[str, bytes]], report: ImportReport) -> list[Source]:
    if len(uploads) > MAX_FILES:
        raise DomainError("TOO_MANY_FILES", f"Máximo de {MAX_FILES} arquivos por envio", status_code=413)
    sources: list[Source] = []
    for raw_name, data in uploads:
        name = posixpath.basename((raw_name or "arquivo").replace("\\", "/")) or "arquivo"
        lower = name.lower()
        if lower.endswith(".zip") or data[:4] == b"PK\x03\x04":
            sources.extend(_zip_sources(name, data, report))
            continue
        if rar_archive.is_rar(name, data):
            sources.extend(_rar_sources(name, data, report))
            continue
        report.files_processed += 1
        if not lower.endswith(".xml"):
            report.ignored_files.append(name)
            continue
        if len(data) > MAX_XML_BYTES:
            report.fail(name, "FILE_TOO_LARGE", "XML maior que 5 MB")
            continue
        sources.append(Source(name, None, data))
    return sources


def _rar_sources(rar_name: str, data: bytes, report: ImportReport) -> list[Source]:
    """Same rules as ZIP: headers are validated first, then only safe XML members are extracted."""
    if not rar_archive.tool_available():
        report.files_processed += 1
        report.fail(rar_name, "RAR_UNSUPPORTED",
                    "Servidor sem extrator RAR (bsdtar). Envie ZIP ou instale o pacote libarchive-tools.")
        return []
    try:
        members, path = rar_archive.list_members(data)
    except rar_archive.RarError as exc:
        report.files_processed += 1
        report.fail(rar_name, "INVALID_RAR", str(exc))
        return []
    try:
        if len(members) > MAX_ZIP_ENTRIES:
            report.fail(rar_name, "ARCHIVE_TOO_MANY_ENTRIES", f"RAR com mais de {MAX_ZIP_ENTRIES} arquivos")
            return []
        selected: list[tuple[str, str, str | None]] = []  # (archive name, file name, folder)
        total = 0
        for m in members:
            label = f"{rar_name}:{m.filename}"
            report.files_processed += 1
            member = _safe_zip_member(m.filename)
            if member is None:
                report.fail(label, "UNSAFE_PATH", "Caminho inseguro dentro do RAR (ignorado)")
                continue
            name, folder = member
            if not name.lower().endswith(".xml"):
                report.ignored_files.append(label)
                continue
            if m.encrypted:
                report.fail(label, "ENCRYPTED", "Arquivo protegido por senha")
                continue
            if m.file_size > MAX_XML_BYTES:
                report.fail(label, "FILE_TOO_LARGE", "XML maior que 5 MB")
                continue
            if m.compress_size and m.file_size / m.compress_size > MAX_COMPRESSION_RATIO:
                report.fail(label, "SUSPICIOUS_COMPRESSION", "Taxa de compressão suspeita (possível bomba de compressão)")
                continue
            total += m.file_size
            if total > MAX_ZIP_UNCOMPRESSED:
                report.fail(rar_name, "ARCHIVE_TOO_LARGE", "Conteúdo descompactado excede o limite; restante ignorado")
                break
            selected.append((m.filename, name, folder))
        try:
            contents = rar_archive.extract(path, [s[0] for s in selected], MAX_XML_BYTES)
        except rar_archive.RarError as exc:
            report.fail(rar_name, "INVALID_RAR", str(exc))
            return []
        sources = []
        for archive_name, name, folder in selected:
            if archive_name in contents:
                sources.append(Source(name, folder, contents[archive_name]))
            else:
                report.fail(f"{rar_name}:{archive_name}", "EXTRACT_FAILED", "Arquivo não pôde ser extraído do RAR")
        return sources
    finally:
        rar_archive.cleanup(path)


def _zip_sources(zip_name: str, data: bytes, report: ImportReport) -> list[Source]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        report.files_processed += 1
        report.fail(zip_name, "INVALID_ZIP", "Arquivo ZIP inválido ou corrompido")
        return []
    sources: list[Source] = []
    total = 0
    with archive:
        infos = [i for i in archive.infolist() if not i.is_dir()]
        if len(infos) > MAX_ZIP_ENTRIES:
            report.fail(zip_name, "ZIP_TOO_MANY_ENTRIES", f"ZIP com mais de {MAX_ZIP_ENTRIES} arquivos")
            return []
        for info in infos:
            label = f"{zip_name}:{info.filename}"
            report.files_processed += 1
            member = _safe_zip_member(info.filename)
            if member is None:
                report.fail(label, "UNSAFE_PATH", "Caminho inseguro dentro do ZIP (ignorado)")
                continue
            name, folder = member
            if not name.lower().endswith(".xml"):
                report.ignored_files.append(label)
                continue
            if info.flag_bits & 0x1:
                report.fail(label, "ENCRYPTED", "Arquivo protegido por senha")
                continue
            if info.file_size > MAX_XML_BYTES:
                report.fail(label, "FILE_TOO_LARGE", "XML maior que 5 MB")
                continue
            if info.compress_size and info.file_size / info.compress_size > MAX_COMPRESSION_RATIO:
                report.fail(label, "SUSPICIOUS_COMPRESSION", "Taxa de compressão suspeita (possível zip bomb)")
                continue
            total += info.file_size
            if total > MAX_ZIP_UNCOMPRESSED:
                report.fail(zip_name, "ZIP_TOO_LARGE", "Conteúdo descompactado excede o limite; restante ignorado")
                break
            with archive.open(info) as fh:
                content = fh.read(MAX_XML_BYTES + 1)
            if len(content) > MAX_XML_BYTES:
                report.fail(label, "FILE_TOO_LARGE", "XML maior que 5 MB")
                continue
            sources.append(Source(name, folder, content))
    return sources


# ---- import -----------------------------------------------------------------------------------

def _is_discrete(line: ParsedLine) -> bool:
    return (line.unit or "") in DISCRETE_UNITS and line.quantity == line.quantity.to_integral_value() \
        and line.quantity > 0


def import_files(db: Session, uploads: list[tuple[str, bytes]], auth: AuthContext,
                 programming_id: uuid.UUID | None = None) -> ImportReport:
    """Imports NF-e files. With programming_id, every created load belongs to that programming."""
    report = ImportReport()
    sources = collect_sources(uploads, report)
    products: dict[str, Item] = {}
    touched_products: set[str] = set()
    seen_keys: set[str] = set()

    for src in sources:
        label = f"{src.folder}/{src.name}" if src.folder else src.name
        try:
            parsed = parse_nfe(src.data)
        except InvalidXml as exc:
            report.fail(label, "INVALID_XML", str(exc))
            continue
        report.xml_accepted += 1

        if not parsed.load_code:
            hint = f" (pasta '{src.folder}')" if src.folder else ""
            report.fail(label, "LOAD_ID_MISSING", f"Identificador de carga ('Carga:') ausente no XML{hint}")
            continue
        if src.folder and src.folder != parsed.load_code:
            report.warn(label, "FOLDER_LOAD_MISMATCH",
                        f"Pasta '{src.folder}' difere da carga do XML '{parsed.load_code}' (XML prevalece)",
                        parsed.access_key, parsed.load_code)
        if parsed.status_code and parsed.status_code not in ("100", "150"):
            report.warn(label, "NOT_AUTHORIZED", f"Protocolo da NF-e com cStat {parsed.status_code}",
                        parsed.access_key, parsed.load_code)

        if parsed.access_key in seen_keys or db.scalar(select(Invoice.id).where(Invoice.access_key == parsed.access_key)):
            report.duplicates_skipped += 1
            continue
        try:
            with db.begin_nested():
                _import_invoice(db, parsed, src.name, label, auth, report, products, touched_products,
                                programming_id)
            seen_keys.add(parsed.access_key)
        except _Rejected as exc:
            products.clear()  # objects created inside the rolled-back savepoint are gone
            report.fail(label, exc.code, exc.message)
        except IntegrityError:
            # Same access key imported concurrently by another request.
            products.clear()
            report.duplicates_skipped += 1

    AuditRepo(db).add("XML_IMPORTED", actor_user_id=auth.user.id, entity_type="import",
                      entity_id=str(programming_id) if programming_id else None,
                      details={"invoices": report.invoices_imported, "duplicates": report.duplicates_skipped,
                               "invalid": len(report.invalid), "loads_created": report.loads_created})
    db.commit()
    report.products_updated = sum(1 for t in touched_products if not t.startswith("new:"))
    return report


class _Rejected(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _product(db: Session, line: ParsedLine, cache: dict[str, Item], touched: set[str], report: ImportReport) -> Item:
    item = cache.get(line.code) or db.scalar(select(Item).where(Item.sku == line.code))
    if item is None:
        item = Item(sku=line.code, name=(line.description or line.code)[:200], unit=line.unit, ean=line.ean)
        db.add(item)
        db.flush()
        report.products_created += 1
        touched.add("new:" + line.code)
    elif "new:" + line.code not in touched:
        changed = False
        if not item.unit and line.unit:
            item.unit, changed = line.unit, True
        if not item.ean and line.ean:
            item.ean, changed = line.ean, True
        if changed:
            touched.add(line.code)
    cache[line.code] = item
    return item


def _import_invoice(db: Session, p: ParsedInvoice, file_name: str, label: str, auth: AuthContext,
                    report: ImportReport, cache: dict[str, Item], touched: set[str],
                    programming_id: uuid.UUID | None = None) -> None:
    load = db.scalars(select(Load).where(Load.external_code == p.load_code).with_for_update(of=Load)).first()
    if load is None:
        load = Load(external_code=p.load_code, status=Load.STATUS_PENDING, programming_id=programming_id)
        db.add(load)
        db.flush()
        if p.load_code not in report.loads_created:
            report.loads_created.append(p.load_code)
    elif load.programming_id != programming_id:
        # A load belongs to exactly one programming; never move it silently.
        raise _Rejected("LOAD_IN_OTHER_PROGRAMMING",
                        f"Carga {p.load_code} já pertence a outra programação: NF-e {p.invoice_number} não importada")
    elif load.status == Load.STATUS_DISPATCHED:
        raise _Rejected("LOAD_ALREADY_DISPATCHED",
                        f"Carga {p.load_code} já expedida: NF-e {p.invoice_number} não importada")
    elif p.load_code not in report.loads_updated and p.load_code not in report.loads_created:
        report.loads_updated.append(p.load_code)

    warnings: list[dict] = []
    review_reason: str | None = None
    non_discrete = [l for l in p.lines if not _is_discrete(l)]
    if non_discrete:
        detail = ", ".join(f"{l.code} {l.quantity.normalize()} {l.unit}" for l in non_discrete[:5])
        warnings.append({"code": "NON_DISCRETE_UNIT",
                         "message": f"Quantidade não é contagem de volumes ({detail}); qVol={p.volume_count}"})
    discrete_total = sum((l.quantity for l in p.lines if _is_discrete(l)), Decimal(0))
    if not non_discrete and p.volume_count is not None and p.volume_count != discrete_total:
        warnings.append({"code": "QVOL_MISMATCH",
                         "message": f"qVol={p.volume_count.normalize()} difere da soma de qCom={discrete_total.normalize()}"})
        review_reason = "qVol da NF-e não confere com as quantidades dos itens"

    invoice = Invoice(
        access_key=p.access_key, invoice_number=p.invoice_number, issued_at=p.issued_at, load_id=load.id,
        customer_name=(p.customer_name or "")[:200] or None, customer_document=p.customer_document,
        city=(p.city or "")[:100] or None, state=(p.state or "")[:2] or None, order_number=p.order_number,
        external_customer_code=p.customer_code, volume_count=p.volume_count,
        volume_species=(p.volume_species or "")[:60] or None, source_file_name=file_name[:255],
        warnings=warnings or None, imported_by_id=auth.user.id,
    )
    db.add(invoice)
    db.flush()

    per_product: dict[str, list] = {}
    for line in p.lines:
        item = _product(db, line, cache, touched, report)
        discrete = _is_discrete(line) and review_reason is None
        db.add(InvoiceItem(invoice_id=invoice.id, line_number=line.line_number, product_id=item.id,
                           product_code=line.code, description=(line.description or "")[:200] or None, ean=line.ean,
                           unit=line.unit, quantity=line.quantity, discrete=discrete))
        agg = per_product.setdefault(line.code, [item, Decimal(0), True, line.unit])
        agg[1] += line.quantity
        agg[2] = agg[2] and discrete

    for code, (item, qty, discrete, unit) in per_product.items():
        reason = None if discrete else (review_reason or f"Unidade '{unit}' não é contagem de volumes")
        existing = db.scalar(select(LoadItem).where(LoadItem.load_id == load.id, LoadItem.product_id == item.id))
        if existing is None:
            db.add(LoadItem(load_id=load.id, product_id=item.id, commercial_quantity=qty, unit=unit,
                            required_quantity=int(qty) if discrete else None, needs_review=not discrete,
                            review_reason=reason))
            continue
        existing.commercial_quantity += qty
        if not discrete:
            # New ambiguous quantity: any previous manual resolution no longer covers the total.
            existing.required_quantity = None
            existing.needs_review = True
            existing.review_reason = reason
            existing.resolved_at = existing.resolved_by_id = existing.resolution_note = None
        elif existing.required_quantity is not None:
            existing.required_quantity += int(qty)

    for w in warnings:
        report.warn(label, w["code"], w["message"], p.access_key, p.load_code)
    report.invoices_imported += 1
