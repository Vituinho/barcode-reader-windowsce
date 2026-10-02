"""RAR support for NF-e imports.

RAR is a proprietary format: Python cannot decompress it alone.
- Headers (names, sizes, encryption) are parsed in pure Python by `rarfile`, so every safety check runs
  BEFORE anything is decompressed.
- Decompression uses `bsdtar` (libarchive), found on PATH. On Railway it comes from the Debian/Ubuntu package
  `libarchive-tools` (see server/railpack.json). On Windows the built-in C:\\Windows\\System32\\tar.exe is bsdtar.
- Only the already-validated XML members are extracted, with one bsdtar call (argument list, never a shell),
  into a private temporary directory that is removed afterwards. bsdtar refuses absolute and '..' paths.
"""
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass

import rarfile

RAR_MAGIC = (b"Rar!\x1a\x07\x00", b"Rar!\x1a\x07\x01\x00")
EXTRACT_TIMEOUT_SECONDS = 120

_bsdtar: str | None = None
_checked = False


def is_rar(name: str, data: bytes) -> bool:
    return name.lower().endswith(".rar") or data.startswith(RAR_MAGIC)


def _find_bsdtar() -> str | None:
    candidates = [shutil.which("bsdtar")]
    if sys.platform == "win32":
        candidates.append(os.path.join(os.environ.get("SystemRoot", r"C:\Windows"), "System32", "tar.exe"))
    for tool in candidates:
        if not tool or not os.path.exists(tool):
            continue
        try:
            version = subprocess.run([tool, "--version"], capture_output=True, text=True, timeout=10).stdout
        except (OSError, subprocess.SubprocessError):
            continue
        if "bsdtar" in version and "libarchive" in version:
            return tool
    return None


def tool_available() -> bool:
    global _bsdtar, _checked
    if not _checked:
        _bsdtar = _find_bsdtar()
        _checked = True
    return _bsdtar is not None


@dataclass
class RarMember:
    filename: str
    file_size: int
    compress_size: int
    encrypted: bool


class RarError(Exception):
    pass


def list_members(data: bytes) -> tuple[list[RarMember], str]:
    """Writes the upload to a private temp file and parses its headers. Caller must call cleanup(path)."""
    fd, path = tempfile.mkstemp(prefix="givova-", suffix=".rar")
    with os.fdopen(fd, "wb") as fh:
        fh.write(data)
    try:
        with rarfile.RarFile(path) as archive:
            if archive.needs_password():
                raise RarError("Arquivo RAR protegido por senha")
            members = [RarMember(i.filename, int(i.file_size or 0), int(i.compress_size or 0), bool(i.needs_password()))
                       for i in archive.infolist() if not i.isdir()]
        return members, path
    except rarfile.Error as exc:
        cleanup(path)
        raise RarError(f"Arquivo RAR inválido ou corrompido ({type(exc).__name__})")
    except RarError:
        cleanup(path)
        raise


def extract(path: str, names: list[str], max_bytes: int) -> dict[str, bytes]:
    """Extracts only `names` (already validated) and returns {archive name: content}."""
    if not names:
        return {}
    if not tool_available():
        raise RarError("Extrator RAR (bsdtar) indisponível")
    out: dict[str, bytes] = {}
    with tempfile.TemporaryDirectory(prefix="givova-rar-") as work:
        target = os.path.join(work, "out")
        os.mkdir(target)
        root = os.path.realpath(target)
        # Member names go in a NUL-separated list file: no argv length limit, no special-character issues.
        list_file = os.path.join(work, "members.lst")
        with open(list_file, "wb") as fh:
            fh.write(b"\0".join(n.encode("utf-8") for n in names) + b"\0")
        try:
            proc = subprocess.run([_bsdtar, "-x", "-f", path, "-C", target, "--null", "-T", list_file],
                                  capture_output=True, timeout=EXTRACT_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            raise RarError("Tempo esgotado ao extrair o RAR")
        if proc.returncode != 0:
            detail = proc.stderr.decode("utf-8", "replace").strip().splitlines()[-1:] or [""]
            raise RarError(f"Falha ao extrair RAR: {detail[0][:200]}")
        for name in names:
            dest = os.path.realpath(os.path.join(target, *name.replace("\\", "/").split("/")))
            if not dest.startswith(root + os.sep) or not os.path.isfile(dest):
                continue  # defense in depth: never read outside the private directory
            with open(dest, "rb") as fh:
                content = fh.read(max_bytes + 1)
            if len(content) <= max_bytes:
                out[name] = content
    return out


def cleanup(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass
