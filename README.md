# Givova Coleta — barcode collection for Windows CE handhelds

Offline-first barcode collection for industrial Windows CE / Windows Embedded Compact handhelds.

```
Windows CE handheld (C# WinForms, .NET Compact Framework 3.5)
        │  Wi-Fi / LAN, HTTP + JSON (HttpWebRequest)
        ▼
Backend API (Python FastAPI, SQLAlchemy 2, Alembic)  ──►  PostgreSQL
        ▲
Admin web panel (Next.js + TypeScript + Tailwind)
```

| Folder | Content |
|---|---|
| `windows-ce-client/` | Collector app (`src/GivovaCollector`), core tests, end-to-end scenario runner, desktop build script |
| `server/` | API, models, Alembic migrations, seed, pytest suite |
| `admin-web/` | Admin panel (sessions, scans, unknown barcodes, items, collectors, users, CSV export) |

## Core rule: no scan is ever lost

```
PHYSICAL SCAN → LOCAL DURABLE SAVE → UI CONFIRMATION → SERVER SYNC → SERVER CONFIRMATION → MARK LOCAL RECORD SYNCED
```

- Every scan is appended to a local **journal file** (`data\scans.journal`) and flushed to storage *before* the
  operator sees any confirmation. Each line is a full record snapshot with a CRC32. After a power loss, a torn
  or corrupted line is skipped on its own and the other lines are still read.
- Each scan gets a `clientScanId` (`{deviceId}-{yyyyMMddHHmmss}-{guid}`) on the device. The server enforces it as
  UNIQUE, so resending is **idempotent**: if a response is lost, the retry gets back the stored result and no
  second row is created.
- A background thread sends pending scans in order. Network errors, 5xx responses and malformed responses keep
  the record PENDING and back off (from the sync interval up to 60 s). A 401 keeps the queue and asks for a new
  login. Only an explicit validation refusal from the API (400/409/413/422) marks a record REJECTED. The record
  stays on the device and can be re-queued from *Pendências*.
- On startup the journal is reloaded and sync resumes. Compaction drops only records the server already holds
  from previous days. It rewrites the journal through tmp/bak files so a crash during compaction can be recovered.
- **Accidental double trigger**: the same device + operator + session + barcode within `DuplicateWindowSeconds`
  (default 2 s) shows `DUPLICADO / IGNORADO` and is not queued. The server applies the same rule using device
  scan time, and stores such a scan with state `DUPLICATE`, not as a business scan. Scanning the same barcode
  again later is normal and allowed.
- **Unknown barcodes** are always accepted. They are registered as `UNKNOWN`, and an admin can link them to an
  item later. Old scans then resolve to that item through the relation, while `result` keeps the classification
  at scan time.
- **Session closed while offline**: the server stores these scans with state `SESSION_CLOSED` (or
  `SESSION_NOT_FOUND`), and admins accept or reject them per scan or per session. Nothing is discarded.
- Timestamps: `scannedAtDevice` (device wall clock, interpreted in `APP_TIMEZONE`) and `receivedAtServer`
  (authoritative). Heartbeats record the device clock skew, which is shown on the collectors page.

## Server

Requirements: Python 3.11+, PostgreSQL 13+.

```bash
cd server
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt      # Linux/macOS: .venv/bin/pip
cp .env.example .env                                  # then edit DATABASE_URL, SECRET_KEY, seed passwords
```

PostgreSQL setup (example):

```sql
CREATE USER givova WITH PASSWORD 'change-me';
CREATE DATABASE givova OWNER givova;
```

Migrate, seed and run:

```bash
.venv/Scripts/alembic upgrade head
.venv/Scripts/python -m app.seed
.venv/Scripts/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` is required so the collectors on the Wi-Fi can reach the PC. Allow TCP 8000 in the Windows
firewall.

The seed creates `admin@example.com` (ADMIN) and `operator@example.com` (OPERATOR). Their passwords come from
`SEED_ADMIN_PASSWORD` and `SEED_OPERATOR_PASSWORD`. It also creates device `GVT-CE-001`, the open session
`RECEBIMENTO TESTE`, and three items with barcodes (e.g. `7891234567890` = Colchão Ortobom Orion). Never commit
`.env`.

Tests (they wipe the target database, so use a disposable one):

```bash
TEST_DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/givova_test .venv/Scripts/python -m pytest -q
```

Collector endpoints: `POST /api/auth/login`, `GET /api/sessions`, `POST /api/scans`, `POST /api/scans/batch`,
`GET /api/items/by-barcode/{barcode}`, `GET /api/device/config`, `POST /api/device/heartbeat`, `GET /api/health`.
Admin endpoints live under `/api/admin/*`. OpenAPI docs are at `http://<server>:8000/docs`.

## Admin web

```bash
cd admin-web
npm install
cp .env.example .env.local        # NEXT_PUBLIC_API_URL=http://<server>:8000
npm run dev                       # or: npm run build && npm run start
```

Open `http://localhost:3000` and log in with an ADMIN user. The API only accepts browser requests from the
origin(s) in `ADMIN_WEB_ORIGIN` (`server/.env`). Wildcards are refused. `NEXT_PUBLIC_API_URL` is inlined into the
bundle at build time, so `npm run build` fails if it is missing.

## Railway deployment

One Railway project with three services from this repo:

| Service | Root directory | Config file | Variables |
|---|---|---|---|
| PostgreSQL | — | — | managed by Railway |
| API | `/server` | `/server/railway.json` | `DATABASE_URL`, `SECRET_KEY`, `ADMIN_WEB_ORIGIN`, `SEED_ADMIN_PASSWORD`, `SEED_OPERATOR_PASSWORD` |
| Admin | `/admin-web` | `/admin-web/railway.json` | `NEXT_PUBLIC_API_URL` |

- **API service:** pre-deploy runs `alembic upgrade head`, start is `python -m app.serve` (binds `0.0.0.0:$PORT`),
  and the health check is `/api/health`.
- **Admin service:** builds `output: "standalone"` and starts with `npm run start` (binds `0.0.0.0:$PORT`).
- **Seed:** a manual step, `python -m app.seed`, run on the API service.
- **Collectors:** set `ApiBaseUrl` to the API's public `https://…up.railway.app` URL. Railway serves HTTPS with
  modern TLS only, so check each device with TESTAR CONEXÃO (see TLS note below).

## Windows CE collector

### Required toolchain (for the real device build)

- **Visual Studio 2008 Professional** (or higher; Express has no Smart Device support) with *Smart Device
  Programmability* installed, plus VS2008 SP1. Newer Visual Studio versions cannot build .NET CF projects.
- **.NET Compact Framework 3.5** (included with VS2008 SP1). The device needs the CF 3.5 runtime
  (`NETCFv35.wce.<cpu>.cab`, often preinstalled on CE 6/7 images).
- The **device SDK** from the manufacturer (or the generic *Windows CE 5.0 / 6.0* SDK) to deploy and debug. The
  project targets generic Windows CE 5.0+. Use *Project → Change Target Platform* to pick the vendor SDK.
- ActiveSync (Windows XP/7) or Windows Mobile Device Center to deploy over USB. Otherwise copy files manually.
- CAB packaging: add a *Smart Device CAB Project* in VS2008 (File → Add → New Project → Other Project Types →
  Setup and Deployment) with the primary output of `GivovaCollector`. No CAB project is included, because the
  toolchain was not available to produce and verify one.

Open `windows-ce-client/GivovaCollector.sln` in VS2008 and build Release. Deploy these files together:
`GivovaCollector.exe` and `collector.ini` (from `collector.ini.example`).

### Configure the server IP on the collector

Either edit `collector.ini` next to the exe before copying it, or use **CONFIG** on the login screen. The default
admin PIN is `1234`, and the screen asks you to change it. Settings:

| Key | Meaning |
|---|---|
| `DeviceId` | Permanent unique id, e.g. `GVT-CE-001`. It cannot be changed while scans are pending. |
| `ApiBaseUrl` | `http://192.168.x.x:8000` (the server PC's LAN IP). Use **TESTAR CONEXÃO** to check it. |
| `SyncIntervalSeconds` / `RequestTimeoutSeconds` / `DuplicateWindowSeconds` | Timings. The server can override sync interval and duplicate window per device. |
| `TabCompletesScan` | TAB also ends a barcode (ENTER always does). |
| `DataDirectory` | Folder for the journal. **It must be on storage that survives a cold boot** (see below). |

**TLS:** many CE 5/6 images support only old TLS versions and have outdated root certificates. Use plain HTTP only
on a trusted, isolated warehouse LAN/VLAN or over a VPN. Use `https://` only after confirming that the device
negotiates the server's TLS version and trusts its certificate. The app never disables certificate validation.

### How keyboard-wedge scanning works

Set the scanner (the vendor's scanner control panel) to **keyboard wedge** with an **ENTER suffix**, which is the
default on most devices. The barcode field on the scan screen always keeps focus. Characters arrive as keystrokes,
and ENTER (or optionally TAB) completes the scan. The field then clears and is ready for the next scan. Values
are opaque text. Only framing characters are removed: trailing CR/LF/TAB/ETX/EOT and a leading STX. Leading
zeroes, case, spaces, separators and GS1 `0x1D` are kept. The raw value, including the terminator, is also sent
as `rawBarcode`. Wedges that paste the whole value at once are handled too.

Screen states: `SALVO / ENVIANDO…` → `REGISTRADO` (green) or `DESCONHECIDO / REGISTRADO` (orange). Offline:
`SALVO OFFLINE` (blue). Other states: `DUPLICADO / IGNORADO`, `SESSÃO FECHADA / P/ REVISÃO`, `ERRO`. The scan
screen never opens a modal dialog. Optional sounds: put `sounds\ok.wav`, `offline.wav` and `error.wav` next to the
exe, otherwise system beeps are used.

### Vendor SDK integration point

`Scanner/VendorScannerProvider.cs` is an abstract base class with no vendor code on purpose. To use a
manufacturer SDK (Zebra/Symbol EMDK, Honeywell/Intermec, Datalogic):

1. Subclass it in its own file.
2. Reference the vendor assembly only there.
3. Call `OnScanned(data, symbology)` from the SDK read callback.
4. Return it from `ScannerFactory.Create` when `ScannerMode=VENDOR`.

Until then, `VENDOR` falls back to keyboard wedge.

### Test without a real collector

```powershell
cd windows-ce-client
powershell -ExecutionPolicy Bypass -File build-desktop.ps1 -RunTests
```

This compiles the same sources with the Windows built-in `csc.exe` restricted to **C# 3** (the VS2008/CF 3.5
language level) into `build\desktop\`:

- `GivovaCollector.exe`: desktop simulator. Type a code and press ENTER to act as the wedge. Run it with
  `--size=320x240` or `--size=480x640` to test other screen layouts. Edit `build\desktop\collector.ini` to point
  `ApiBaseUrl` at your server.
- `CollectorCoreTests.exe`: queue persistence, torn/corrupt lines, compaction recovery, scan IDs, terminator
  cleanup, duplicate window, sync retry/backoff and state transitions.
- `ScenarioRunner.exe`: acceptance scenarios A–F, plus the closed-session case, against a running API. It uses
  the collector's real journal, sync service and `HttpWebRequest` client. To simulate Wi-Fi loss it points at a
  dead port.

  ```powershell
  $env:GIVOVA_ADMIN_PASSWORD="..."; $env:GIVOVA_OPERATOR_PASSWORD="..."; .\build\desktop\ScenarioRunner.exe
  ```

The desktop compiler checks syntax and the shared logic. It does **not** prove that every API used exists in the
Compact Framework. The code deliberately avoids async/await, LINQ, `TryParse`, `File.ReadAllText`, app.config,
`ParameterizedThreadStart` and other CF gaps, but the authoritative check is the VS2008 build.

### Hardware details still needed

- Exact model and OS: CE 5/6/7 or Windows Mobile, CPU (ARMv4I…), screen resolution/DPI, and whether CF 3.5 is
  preinstalled.
- Which folder survives a cold boot (e.g. `\Application`, `\Flash File Store`, `\IPSM`), to set `DataDirectory`.
- Scanner wedge configuration (suffix ENTER/TAB, prefix characters) or the vendor SDK version for
  `VendorScannerProvider`.
- Wi-Fi/TLS capabilities if HTTPS is required. Also whether the battery API (`GetSystemPowerStatusEx`) is present;
  battery reporting is optional.

## Known limitations

- **Offline login** is not available. A login needs the server. After an app restart the saved token (not the
  password) lets the operator continue until it expires (`ACCESS_TOKEN_EXPIRE_MINUTES`, default 12 h). If the
  token expires while the app is running, scanning continues and the SINC button turns into LOGIN to renew it.
- **Pending scans of a logged-out operator** keep that operator's id. They sync as soon as any operator logs in
  on that device.
- A barcode longer than 512 characters is refused on the device.
