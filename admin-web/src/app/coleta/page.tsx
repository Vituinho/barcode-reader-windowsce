"use client";

import {
  AlertTriangle, Camera, Check, CircleSlash, CloudOff, Copy, Download, Keyboard, LayoutDashboard, Loader2, LogOut, Menu, ScanLine,
  ShieldAlert, Volume2, VolumeX, WifiOff, X, XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { BrandMark } from "@/components/brand";
import { CameraScanner, cameraSupported } from "@/components/camera";
import { useConfirm } from "@/components/dialog";
import { useInstallPrompt } from "@/components/pwa";
import { createDuplicateGuard, scannerKeyAction } from "@/collector/barcode";
import { feedback, primeAudio, setSoundEnabled, soundEnabled } from "@/collector/feedback";
import { getDeviceIdentity, setDeviceName, type DeviceIdentity } from "@/collector/identity";
import { submitReading } from "@/collector/pipeline";
import { loadRememberedProgramming, programmingLabel, rememberProgramming, validateRemembered, type ProgrammingChoice } from "@/collector/programming";
import { pendingLogoutMessage } from "@/collector/logout";
import { loadRules, predictResult, saveRules, type ScanRules } from "@/collector/rules";
import { openScanQueue } from "@/collector/store";
import type { QueuedScan, ScanQueue } from "@/collector/queue";
import { createSyncEngine, type Connection, type EngineState } from "@/collector/sync";
import { API_URL, api, getToken, getUser, setToken, type SessionUser } from "@/lib/api";

type Display =
  | { kind: "idle" }
  | { kind: "sending" | "offline"; code: string }
  | { kind: "collected"; code: string; name: string | null; stock: number | null; ready: number | null; readyCodes: string[] }
  | { kind: "unknown"; code: string }
  | { kind: "conflict"; code: string; reason: string | null }
  | { kind: "wrong_barcode"; raw: string }
  | { kind: "not_in_program"; code: string }
  | { kind: "duplicate"; code: string }
  | { kind: "invalid"; raw: string }
  | { kind: "no_programming" }
  | { kind: "rejected" | "error"; code: string; message: string };

interface SessionChoice {
  id: string;
  name: string;
}

const SESSION_KEY = "givova.coleta.session";
const TAB_KEY = "givova.coleta.tab";
const RECENT_LIMIT = 15;

const CONNECTION: Record<Connection, { label: string; cls: string; Icon: typeof Check }> = {
  UNKNOWN: { label: "CONECTANDO", cls: "bg-slate-200 text-slate-700", Icon: Loader2 },
  ONLINE: { label: "ONLINE", cls: "bg-green-100 text-green-800", Icon: Check },
  SYNCING: { label: "SINCRONIZANDO", cls: "bg-sky-100 text-sky-800", Icon: Loader2 },
  OFFLINE: { label: "OFFLINE", cls: "bg-slate-800 text-white", Icon: WifiOff },
  SERVER_ERROR: { label: "ERRO NO SERVIDOR", cls: "bg-red-100 text-red-800", Icon: AlertTriangle },
  LOGIN_REQUIRED: { label: "LOGIN EXPIRADO", cls: "bg-amber-100 text-amber-900", Icon: ShieldAlert },
  BLOCKED: { label: "COLETOR BLOQUEADO", cls: "bg-red-100 text-red-800", Icon: CircleSlash },
};

function displayFromScan(scan: QueuedScan): Display {
  if (scan.status === "REJECTED") return { kind: "rejected", code: scan.productCode, message: scan.lastError ?? "Recusado" };
  if (scan.status === "CONFLICT") return { kind: "conflict", code: scan.productCode, reason: scan.result };
  if (scan.result === "WRONG_BARCODE") return { kind: "wrong_barcode", raw: scan.rawBarcode.trim() };
  if (scan.result === "NOT_IN_PROGRAM") return { kind: "not_in_program", code: scan.productCode };
  if (scan.result === "UNKNOWN") return { kind: "unknown", code: scan.productCode };
  if (scan.result === "DUPLICATE") return { kind: "duplicate", code: scan.productCode };
  return { kind: "collected", code: scan.productCode, name: scan.itemName, stock: scan.currentStock,
           ready: scan.newlyReadyLoads, readyCodes: scan.readyLoadCodes ?? [] };
}

function rowStatus(scan: QueuedScan): { label: string; cls: string } {
  if (scan.status === "PENDING") return { label: "PENDENTE", cls: "text-sky-800 bg-sky-50 ring-sky-200" };
  if (scan.status === "REJECTED") return { label: "ERRO", cls: "text-red-800 bg-red-50 ring-red-200" };
  if (scan.status === "CONFLICT") return { label: "EM REVISÃO", cls: "text-purple-800 bg-purple-50 ring-purple-200" };
  if (scan.result === "WRONG_BARCODE") return { label: "CÓD. INCORRETO", cls: "text-red-800 bg-red-50 ring-red-200" };
  if (scan.result === "NOT_IN_PROGRAM") return { label: "FORA DA PROGRAMAÇÃO", cls: "text-amber-900 bg-amber-50 ring-amber-200" };
  if (scan.result === "UNKNOWN") return { label: "NÃO ENCONTRADO", cls: "text-amber-900 bg-amber-50 ring-amber-200" };
  if (scan.result === "DUPLICATE") return { label: "DUPLICADA", cls: "text-slate-700 bg-slate-100 ring-slate-200" };
  return { label: "COLETADO", cls: "text-green-800 bg-green-50 ring-green-200" };
}

const isTypingTarget = (el: Element | null) =>
  !!el && (el.matches("input, textarea, select, [contenteditable='true']") || !!el.closest("dialog[open], [data-no-refocus]"));

export default function ColetaPage() {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const { install } = useInstallPrompt();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [device, setDevice] = useState<DeviceIdentity | null>(null);
  const [engineState, setEngineState] = useState<EngineState>({ connection: "UNKNOWN", pending: 0, lastError: null });
  const [display, setDisplay] = useState<Display>({ kind: "idle" });
  const [recent, setRecent] = useState<QueuedScan[]>([]);
  const [durable, setDurable] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sound, setSound] = useState(true);
  const [tabCompletes, setTabCompletes] = useState(true);
  const [manualEntry, setManualEntry] = useState(false);
  const [sessions, setSessions] = useState<SessionChoice[]>([]);
  const [session, setSession] = useState<SessionChoice | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [programmings, setProgrammings] = useState<ProgrammingChoice[]>([]);
  const [programming, setProgramming] = useState<ProgrammingChoice | null>(null);
  const [hasCamera, setHasCamera] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const queueRef = useRef<ScanQueue | null>(null);
  const engineRef = useRef<ReturnType<typeof createSyncEngine> | null>(null);
  const guardRef = useRef(createDuplicateGuard(2000));
  const lastScanIdRef = useRef<string | null>(null);
  const connectionRef = useRef<Connection>("UNKNOWN");
  const sessionRef = useRef<SessionChoice | null>(null);
  const programmingRef = useRef<ProgrammingChoice | null>(null);
  const rulesRef = useRef<ScanRules | null>(null);
  const userRef = useRef<SessionUser | null>(null);
  const deviceRef = useRef<DeviceIdentity | null>(null);
  const busyRef = useRef(false);

  const refreshRecent = useCallback(async () => {
    if (queueRef.current) setRecent(await queueRef.current.recent(RECENT_LIMIT));
  }, []);

  const focusScanner = useCallback(() => {
    if (menuOpen || cameraOpen) return;
    const el = inputRef.current;
    if (el && document.activeElement !== el && !isTypingTarget(document.activeElement)) el.focus({ preventScroll: true });
  }, [menuOpen, cameraOpen]);

  // ---- bootstrap -------------------------------------------------------------------------------
  useEffect(() => {
    const u = getUser();
    if (!getToken() || !u) {
      router.replace("/login?next=/coleta");
      return;
    }
    setUser(u);
    userRef.current = u;
    const d = getDeviceIdentity(window.localStorage);
    setDevice(d);
    deviceRef.current = d;
    setSound(soundEnabled());
    setHasCamera(cameraSupported());
    try {
      setTabCompletes(localStorage.getItem(TAB_KEY) !== "off");
      const remembered = loadRememberedProgramming(window.localStorage);
      setProgramming(remembered);
      programmingRef.current = remembered;
      const s = localStorage.getItem(SESSION_KEY);
      if (s) {
        const parsed = JSON.parse(s) as SessionChoice;
        setSession(parsed);
        sessionRef.current = parsed;
      }
    } catch {
      /* ignore */
    }

    let cancelled = false;
    (async () => {
      const queue = await openScanQueue();
      if (cancelled) return;
      queueRef.current = queue;
      setDurable(queue.durable);
      const engine = createSyncEngine({
        queue,
        apiUrl: API_URL,
        getToken,
        onState: (s) => {
          connectionRef.current = s.connection;
          setEngineState(s);
          // The last reading is waiting while the server is unreachable: say so clearly.
          if (["OFFLINE", "SERVER_ERROR", "LOGIN_REQUIRED", "BLOCKED"].includes(s.connection)) {
            setDisplay((d) => (d.kind === "sending" ? { kind: "offline", code: d.code } : d));
          }
        },
        onScanUpdated: (scan) => {
          if (scan.clientScanId === lastScanIdRef.current) {
            const next = displayFromScan(scan);
            setDisplay(next);
            feedback(next.kind === "collected" ? "success" : next.kind === "unknown" || next.kind === "duplicate" ? "warning" : "error");
          }
          void refreshRecent();
        },
        heartbeat: () => (userRef.current?.deviceBound && deviceRef.current
          ? { deviceId: deviceRef.current.id, operatorId: userRef.current.id } : null),
      });
      engineRef.current = engine;
      engine.start();
      void refreshRecent();
    })();
    return () => {
      cancelled = true;
      engineRef.current?.stop();
    };
  }, [router, refreshRecent]);

  // OPEN programmings: the collector always collects for one; a remembered programming that closed is cleared.
  useEffect(() => {
    if (!user) return;
    api<ProgrammingChoice[]>("/api/programmings?status=OPEN", { noRedirect: true })
      .then((list) => {
        const open = list.map((p) => ({ id: p.id, scheduledDate: p.scheduledDate, name: p.name }));
        setProgrammings(open);
        const current = programmingRef.current;
        const valid = validateRemembered(current, open);
        if (current && !valid) setNotice(`A programação ${programmingLabel(current)} foi encerrada. Selecione outra programação.`);
        chooseProgramming(valid);
      })
      .catch(() => undefined); // offline: keep the remembered programming
  }, [user]);

  // Production rules of the selected programming (cached: instant feedback also offline).
  useEffect(() => {
    const id = programming?.id;
    rulesRef.current = id ? loadRules(window.localStorage, id) : null;
    if (!user || !id) return;
    const refresh = () =>
      api<ScanRules>(`/api/programmings/${id}/scan-rules`, { noRedirect: true })
        .then((rules) => {
          if (programmingRef.current?.id !== id) return;
          rulesRef.current = rules;
          saveRules(window.localStorage, id, rules);
        })
        .catch(() => undefined);
    void refresh();
    const timer = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [user, programming?.id]);

  // OPEN sessions (optional for scans); a remembered session that was closed is cleared.
  useEffect(() => {
    if (!user) return;
    api<SessionChoice[]>("/api/sessions", { noRedirect: true })
      .then((list) => {
        setSessions(list);
        const current = sessionRef.current;
        if (current && !list.some((s) => s.id === current.id)) {
          chooseSession(null);
          setNotice(`A sessão "${current.name}" foi encerrada. Leituras seguem sem sessão.`);
        }
      })
      .catch(() => undefined); // offline: keep the remembered session
  }, [user]);

  // Keep the scanner field ready: refocus after taps on non-interactive areas and when the window regains focus.
  useEffect(() => {
    const onPointerUp = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target && target.closest("button, a, input, select, textarea, label, dialog, [data-no-refocus]")) return;
      setTimeout(focusScanner, 0);
    };
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && (document.activeElement === document.body || document.activeElement === null)) {
        focusScanner();
      }
    }, 1000);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("focus", focusScanner);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("focus", focusScanner);
    };
  }, [focusScanner]);

  useEffect(() => {
    if (!menuOpen && !cameraOpen) focusScanner();
  }, [menuOpen, cameraOpen, focusScanner]);

  // ---- scanning --------------------------------------------------------------------------------
  const handleReading = useCallback(async (raw: string, source: QueuedScan["source"]) => {
    const queue = queueRef.current;
    const dev = deviceRef.current;
    if (!queue || !dev) return;
    const outcome = await submitReading(raw, source, {
      queue,
      guard: guardRef.current,
      deviceId: dev.id,
      operatorId: userRef.current?.id ?? null,
      sessionId: sessionRef.current?.id ?? null,
      programmingId: programmingRef.current?.id ?? null,
      requireProgramming: true,
    });
    if (outcome.kind === "no_programming") {
      setDisplay({ kind: "no_programming" });
      feedback("error");
    } else if (outcome.kind === "invalid") {
      setDisplay({ kind: "invalid", raw: outcome.raw.trim() });
      feedback("error");
    } else if (outcome.kind === "duplicate") {
      setDisplay({ kind: "duplicate", code: outcome.productCode });
      feedback("warning");
    } else if (outcome.kind === "error") {
      setDisplay({ kind: "error", code: "", message: "Falha ao salvar a leitura neste aparelho. Leia novamente." });
      feedback("error");
    } else {
      lastScanIdRef.current = outcome.scan.clientScanId;
      const online = ["ONLINE", "UNKNOWN", "SYNCING"].includes(connectionRef.current);
      // Saved and sent for audit either way; a code the rules refuse is flagged at once (the server confirms).
      const predicted = predictResult(outcome.scan.rawBarcode, rulesRef.current);
      if (predicted === "WRONG_BARCODE") {
        setDisplay({ kind: "wrong_barcode", raw: outcome.scan.rawBarcode.trim() });
        feedback("error");
      } else if (predicted === "NOT_IN_PROGRAM") {
        setDisplay({ kind: "not_in_program", code: outcome.scan.productCode });
        feedback("error");
      } else {
        setDisplay({ kind: online ? "sending" : "offline", code: outcome.scan.productCode });
        if (!online) feedback("offline");
      }
      engineRef.current?.trigger(true);
      void refreshRecent();
    }
  }, [refreshRecent]);

  const closeCamera = useCallback(() => setCameraOpen(false), []);
  // Camera readings use exactly the same pipeline as the physical scanner.
  const onCameraDetected = useCallback((raw: string) => {
    primeAudio();
    void handleReading(raw, "CAMERA");
  }, [handleReading]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    primeAudio();
    const action = scannerKeyAction(e.key, e.currentTarget.value, tabCompletes);
    if (action.preventDefault) e.preventDefault();
    if (action.submit !== null) {
      e.currentTarget.value = ""; // ready for the next label immediately
      void handleReading(action.submit, "KEYBOARD");
    }
  };

  // ---- settings --------------------------------------------------------------------------------
  function chooseProgramming(choice: ProgrammingChoice | null) {
    setProgramming(choice);
    programmingRef.current = choice;
    rememberProgramming(window.localStorage, choice);
  }

  function chooseSession(choice: SessionChoice | null) {
    setSession(choice);
    sessionRef.current = choice;
    try {
      if (choice) localStorage.setItem(SESSION_KEY, JSON.stringify(choice));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  async function renameDevice() {
    if (!device) return;
    const r = await confirm({
      title: "Nome do dispositivo",
      message: "Nome exibido no painel de coletores (ex.: Coletor Expedição 01, Celular Estoque).",
      confirmLabel: "Salvar",
      input: { label: "Nome", initial: device.name, required: true },
    });
    if (!r.ok) return;
    const next = setDeviceName(window.localStorage, r.value);
    setDevice(next);
    deviceRef.current = next;
    if (user?.deviceBound) {
      api("/api/device/profile", { method: "POST", body: { deviceId: next.id, name: next.name }, noRedirect: true })
        .catch(() => setNotice("Nome salvo neste aparelho; será enviado ao servidor quando houver conexão e novo login."));
    }
  }

  async function logout() {
    const pending = queueRef.current ? await queueRef.current.pendingCount() : 0;
    const warning = pendingLogoutMessage(pending);
    if (warning) {
      const r = await confirm({
        title: "Leituras pendentes",
        message: `${warning} Elas continuam salvas neste aparelho e serão enviadas no próximo login.`,
        confirmLabel: "Sair mesmo assim",
        tone: "danger",
      });
      if (!r.ok) return;
    }
    setToken(null);
    router.replace("/login?next=/coleta");
  }

  if (!user || !device) return null;

  const conn = CONNECTION[engineState.connection];
  const pending = engineState.pending;

  return (
    <div className="flex min-h-dvh flex-col bg-slate-100 text-slate-900">
      {/* ---- top bar ---- */}
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2 sm:px-4">
          <BrandMark size={30} />
          <span className="hidden text-sm font-extrabold tracking-[0.14em] sm:inline">GIVOVA · COLETA</span>
          <span className="text-sm font-extrabold tracking-[0.14em] max-[389px]:hidden sm:hidden">COLETA</span>
          <span role="status" className={`ml-auto inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-bold ${conn.cls}`}>
            <conn.Icon className={`size-3.5 ${conn.Icon === Loader2 ? "animate-spin" : ""}`} aria-hidden />
            {conn.label}
          </span>
          <span className={`inline-flex h-8 items-center whitespace-nowrap rounded-full px-3 text-xs font-bold tabular-nums ${pending ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-600"}`}>
            Pendentes: {pending}
          </span>
          {user.role === "ADMIN" && (
            <Link href="/dashboard" className="hidden h-8 items-center gap-1.5 rounded-md border border-slate-300 px-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:inline-flex">
              <LayoutDashboard className="size-3.5" aria-hidden /> PAINEL
            </Link>
          )}
          <button
            onClick={() => setMenuOpen(true)}
            className="inline-flex size-10 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-orange-600"
            aria-label="Abrir menu do coletor"
          >
            <Menu className="size-5" aria-hidden />
          </button>
        </div>
        <div className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-0.5 px-3 pb-2 text-xs text-slate-500 sm:px-4">
          <span>Operador: <b className="text-slate-700">{user.fullName}</b></span>
          <span>Dispositivo: <b className="text-slate-700">{device.name}</b></span>
          {session && <span>Sessão: <b className="text-slate-700">{session.name}</b></span>}
        </div>
        <div className={`border-t ${programming ? "border-slate-100 bg-slate-50" : "border-amber-200 bg-amber-50"}`}>
          <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-1.5 sm:px-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Programação</span>
            <span className={`min-w-0 truncate text-sm font-bold ${programming ? "text-slate-900" : "text-amber-800"}`}>
              {programming ? programmingLabel(programming) : "nenhuma selecionada"}
            </span>
            <button
              onClick={() => setMenuOpen(true)}
              className="ml-auto h-8 shrink-0 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              TROCAR
            </button>
          </div>
        </div>
      </header>

      {/* ---- warnings ---- */}
      <div className="mx-auto w-full max-w-6xl space-y-2 px-3 pt-3 sm:px-4">
        {engineState.connection === "LOGIN_REQUIRED" && (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <ShieldAlert className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">Login expirado. As leituras continuam salvas neste aparelho e serão enviadas após entrar novamente.</span>
            <Link href="/login?next=/coleta" className="rounded-md bg-amber-600 px-3 py-1.5 font-semibold text-white hover:bg-amber-700">ENTRAR</Link>
          </div>
        )}
        {!user.deviceBound && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Este navegador não está habilitado como coletor. As leituras ficam pendentes até um administrador liberar o dispositivo.
          </div>
        )}
        {!durable && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Armazenamento offline indisponível neste navegador (modo privado?). Não feche a página com leituras pendentes.
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700" data-no-refocus>
            <span className="flex-1">{notice}</span>
            <button onClick={() => setNotice(null)} aria-label="Fechar aviso" className="text-slate-500 hover:text-slate-800"><X className="size-4" /></button>
          </div>
        )}
      </div>

      {/* ---- main ---- */}
      <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-[minmax(0,1fr)] gap-3 px-3 py-3 sm:px-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="flex min-h-0 flex-col gap-3">
          <StatusPanel display={display} pending={pending} programming={programming} onChooseProgramming={() => setMenuOpen(true)} />

          <label className="block">
            <span className="sr-only">Leitura do código de barras</span>
            <div className="flex items-center gap-2 rounded-lg border-2 border-slate-300 bg-white px-3 focus-within:border-orange-500 focus-within:ring-4 focus-within:ring-orange-500/20">
              <ScanLine className="size-6 shrink-0 text-orange-600" aria-hidden />
              <input
                ref={inputRef}
                autoFocus
                onKeyDown={onKeyDown}
                inputMode={manualEntry ? "text" : "none"}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="done"
                placeholder={manualEntry ? "Digite o código e toque em OK" : "Leitor pronto — aponte para a etiqueta"}
                className="h-14 min-w-0 flex-1 bg-transparent font-mono text-lg tracking-wide outline-none placeholder:font-sans placeholder:text-base placeholder:tracking-normal placeholder:text-slate-400"
              />
              {manualEntry && (
                <button
                  type="button"
                  onClick={() => {
                    const el = inputRef.current;
                    if (el && el.value.trim()) {
                      const raw = el.value;
                      el.value = "";
                      primeAudio();
                      void handleReading(raw, "KEYBOARD");
                    }
                    el?.focus();
                  }}
                  className="h-10 rounded-md bg-orange-600 px-4 text-sm font-bold text-white hover:bg-orange-700"
                >
                  OK
                </button>
              )}
            </div>
          </label>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <button
              type="button"
              onClick={() => {
                setManualEntry((m) => !m);
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
              aria-pressed={manualEntry}
              className={`inline-flex h-12 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold ${manualEntry ? "border-orange-600 bg-orange-50 text-orange-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              <Keyboard className="size-4" aria-hidden /> DIGITAR CÓDIGO
            </button>
            {hasCamera && (
              <button
                type="button"
                onClick={() => {
                  primeAudio();
                  setCameraOpen(true);
                }}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Camera className="size-4" aria-hidden /> LER COM CÂMERA
              </button>
            )}
            {install && (
              <button
                type="button"
                onClick={() => void install()}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Download className="size-4" aria-hidden /> INSTALAR APLICATIVO
              </button>
            )}
            {pending > 0 && (
              <button
                type="button"
                onClick={() => engineRef.current?.trigger(true)}
                className="col-span-2 inline-flex h-12 items-center justify-center gap-2 rounded-md border border-sky-300 bg-white px-4 text-sm font-semibold text-sky-800 hover:bg-sky-50"
              >
                <CloudOff className="size-4" aria-hidden /> SINCRONIZAR AGORA
              </button>
            )}
          </div>
        </section>

        <aside className="rounded-lg border border-slate-200 bg-white" data-no-refocus>
          <h2 className="border-b border-slate-200 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-500">Últimas leituras</h2>
          {recent.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">Nenhuma leitura neste aparelho ainda.</p>
          ) : (
            <ol className="divide-y divide-slate-100">
              {recent.map((r) => {
                const st = rowStatus(r);
                return (
                  <li key={r.clientScanId} className="flex items-center gap-3 px-4 py-2">
                    <time className="w-12 shrink-0 text-xs tabular-nums text-slate-500">
                      {new Date(r.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </time>
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-sm font-semibold">{r.productCode}</span>
                      {r.itemName && <span className="block truncate text-xs text-slate-500">{r.itemName}</span>}
                    </span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ring-1 ${st.cls}`}>{st.label}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </aside>
      </main>

      {/* ---- menu drawer ---- */}
      {menuOpen && (
        <div className="fixed inset-0 z-30 flex justify-end bg-slate-950/40" onClick={() => setMenuOpen(false)} data-no-refocus>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu do coletor"
            className="flex h-full w-full max-w-sm flex-col overflow-y-auto bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <span className="font-semibold">Coletor</span>
              <button onClick={() => setMenuOpen(false)} aria-label="Fechar menu" className="inline-flex size-10 items-center justify-center rounded-md hover:bg-slate-100">
                <X className="size-5" />
              </button>
            </div>
            <div className="space-y-5 p-4 text-sm">
              {user.role === "ADMIN" && (
                <Link href="/dashboard" className="flex h-12 items-center gap-2 rounded-md bg-slate-900 px-4 font-semibold text-white hover:bg-slate-800">
                  <LayoutDashboard className="size-4" aria-hidden /> PAINEL
                </Link>
              )}

              <label className="block font-medium text-slate-700">
                Programação de cargas
                <select
                  value={programming?.id ?? ""}
                  onChange={(e) => chooseProgramming(programmings.find((x) => x.id === e.target.value) ?? null)}
                  className="mt-1.5 block h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-base"
                >
                  <option value="">Selecione…</option>
                  {programming && !programmings.some((p) => p.id === programming.id) && (
                    <option value={programming.id}>{programmingLabel(programming)}</option>
                  )}
                  {programmings.map((p) => <option key={p.id} value={p.id}>{programmingLabel(p)}</option>)}
                </select>
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Volumes coletados entram no estoque de produção desta programação e cobrem qualquer carga dela.
                </span>
              </label>

              <label className="block font-medium text-slate-700">
                Sessão de coleta (opcional)
                <select
                  value={session?.id ?? ""}
                  onChange={(e) => {
                    const s = sessions.find((x) => x.id === e.target.value) ?? null;
                    chooseSession(s);
                  }}
                  className="mt-1.5 block h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-base"
                >
                  <option value="">Sem sessão</option>
                  {session && !sessions.some((s) => s.id === session.id) && <option value={session.id}>{session.name}</option>}
                  {sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  O estoque é atualizado com ou sem sessão. Sessões apenas agrupam as leituras.
                </span>
              </label>

              <div>
                <div className="font-medium text-slate-700">Dispositivo</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{device.name}</span>
                  <button onClick={renameDevice} className="h-10 rounded-md border border-slate-300 px-3 font-semibold hover:bg-slate-50">Renomear</button>
                </div>
                <button
                  onClick={() => void navigator.clipboard?.writeText(device.id).then(() => setNotice("ID do dispositivo copiado."))}
                  className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-slate-500 hover:text-slate-800"
                >
                  {device.id} <Copy className="size-3" aria-hidden />
                </button>
              </div>

              <div className="space-y-2">
                <ToggleRow
                  label="Som e vibração"
                  on={sound}
                  icon={sound ? Volume2 : VolumeX}
                  onChange={(on) => {
                    setSound(on);
                    setSoundEnabled(on);
                  }}
                />
                <ToggleRow
                  label="TAB finaliza a leitura"
                  on={tabCompletes}
                  icon={Keyboard}
                  onChange={(on) => {
                    setTabCompletes(on);
                    try {
                      localStorage.setItem(TAB_KEY, on ? "on" : "off");
                    } catch {
                      /* ignore */
                    }
                  }}
                />
              </div>

              <button onClick={logout} className="flex h-12 w-full items-center justify-center gap-2 rounded-md border border-red-300 font-semibold text-red-700 hover:bg-red-50">
                <LogOut className="size-4" aria-hidden /> SAIR
              </button>
            </div>
          </div>
        </div>
      )}
      {cameraOpen && <CameraScanner onDetected={onCameraDetected} onClose={closeCamera} status={cameraStatus(display)} />}
      {dialog}
    </div>
  );
}

function cameraStatus(d: Display): { label: string; tone: "ok" | "warn" | "bad" | "info" } | null {
  switch (d.kind) {
    case "collected":
      return { label: `COLETADO · ${d.code}${d.stock !== null ? ` · ESTOQUE ${d.stock}` : ""}${d.readyCodes.length ? ` · CARGA PRONTA ${d.readyCodes.join(", ")}` : ""}`, tone: "ok" };
    case "unknown":
      return { label: `NÃO ENCONTRADO · ${d.code}`, tone: "warn" };
    case "wrong_barcode":
      return { label: "CÓDIGO INCORRETO · LEIA O CÓDIGO MAIOR", tone: "bad" };
    case "not_in_program":
      return { label: `NÃO ENCONTRADO NESSA PROGRAMAÇÃO · ${d.code}`, tone: "warn" };
    case "duplicate":
      return { label: "LEITURA DUPLICADA IGNORADA", tone: "info" };
    case "invalid":
      return { label: "CÓDIGO INVÁLIDO", tone: "bad" };
    case "offline":
      return { label: `SALVO OFFLINE · ${d.code}`, tone: "info" };
    case "sending":
      return { label: `SALVO · ENVIANDO ${d.code}`, tone: "info" };
    case "idle":
      return null;
    case "no_programming":
      return { label: "SELECIONE UMA PROGRAMAÇÃO", tone: "warn" };
    default:
      return { label: "ERRO", tone: "bad" };
  }
}

function ToggleRow({ label, on, onChange, icon: Icon }: { label: string; on: boolean; onChange: (on: boolean) => void; icon: typeof Check }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex h-12 w-full items-center gap-3 rounded-md border border-slate-200 px-3 text-left hover:bg-slate-50"
    >
      <Icon className="size-4 text-slate-500" aria-hidden />
      <span className="flex-1 font-medium">{label}</span>
      <span className={`relative h-6 w-11 rounded-full transition-colors ${on ? "bg-orange-600" : "bg-slate-300"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
      </span>
      <span className="w-8 text-xs font-bold text-slate-600">{on ? "SIM" : "NÃO"}</span>
    </button>
  );
}

/** The one thing an operator must see from a distance: what happened to the last reading. */
function StatusPanel({ display, pending, programming, onChooseProgramming }: {
  display: Display; pending: number; programming: ProgrammingChoice | null; onChooseProgramming: () => void;
}) {
  const big = "text-[clamp(2rem,9vw,4rem)] font-black leading-none tracking-tight";
  const code = "font-mono text-[clamp(1.75rem,7vw,3.25rem)] font-bold leading-tight tracking-wider break-all";
  const base = "flex min-h-[18rem] flex-1 flex-col items-center justify-center gap-3 rounded-xl px-5 py-8 text-center lg:min-h-[24rem]";

  let body: ReactNode;
  let cls: string;
  switch (display.kind) {
    case "idle":
    case "no_programming":
      if (!programming || display.kind === "no_programming") {
        cls = "border-2 border-amber-300 bg-amber-50 text-amber-950";
        body = (
          <>
            <div className="text-[clamp(1.5rem,6vw,2.5rem)] font-black leading-tight tracking-tight">SELECIONE UMA<br />PROGRAMAÇÃO</div>
            <p className="max-w-md text-base">Os volumes produzidos são registrados no estoque da programação de cargas escolhida.</p>
            <button onClick={onChooseProgramming} className="mt-2 h-12 rounded-md bg-orange-600 px-6 text-sm font-bold text-white hover:bg-orange-700">
              SELECIONAR PROGRAMAÇÃO
            </button>
          </>
        );
        break;
      }
      cls = "border-2 border-dashed border-slate-300 bg-white text-slate-700";
      body = (
        <>
          <ScanLine className="size-14 text-orange-600" aria-hidden />
          <div className="text-[clamp(1.5rem,6vw,2.5rem)] font-black tracking-tight">PRONTO PARA LER</div>
          <p className="text-base text-slate-500">Leia o código de barras <b>maior</b> da etiqueta de produção</p>
          <p className="text-sm font-semibold text-slate-600">Programação {programmingLabel(programming)}</p>
        </>
      );
      break;
    case "sending":
      cls = "bg-slate-800 text-white";
      body = (
        <>
          <Loader2 className="size-10 animate-spin text-slate-300" aria-hidden />
          <div className={code}>{display.code}</div>
          <div className="text-lg font-bold tracking-wide text-slate-300">SALVO · ENVIANDO…</div>
        </>
      );
      break;
    case "offline":
      cls = "bg-sky-800 text-white";
      body = (
        <>
          <WifiOff className="size-12" aria-hidden />
          <div className={big}>SALVO OFFLINE</div>
          <div className={code}>{display.code}</div>
          <div className="text-lg font-semibold text-sky-100">Sem conexão · Pendentes: {pending}</div>
        </>
      );
      break;
    case "collected":
      cls = "bg-green-700 text-white";
      body = (
        <>
          <div className={`${big} flex items-center gap-3`}><Check className="size-[0.9em]" strokeWidth={3.5} aria-hidden /> COLETADO</div>
          <div className={code}>{display.code}</div>
          {display.name && <div className="max-w-full text-lg font-semibold text-green-50 line-clamp-2">{display.name}</div>}
          {display.stock !== null && (
            <div className="mt-1 rounded-lg bg-white/15 px-6 py-2">
              <div className="text-xs font-bold tracking-[0.2em] text-green-100">ESTOQUE PRODUÇÃO</div>
              <div className="text-[clamp(2.25rem,8vw,3.5rem)] font-black leading-none tabular-nums">{display.stock}</div>
            </div>
          )}
          {display.readyCodes.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-2">
              {display.readyCodes.map((c) => (
                <div key={c} className="rounded-md bg-white px-4 py-1.5 text-lg font-black tracking-wide text-green-800">CARGA PRONTA {c}</div>
              ))}
            </div>
          ) : !!display.ready && (
            <div className="rounded-md bg-white px-3 py-1 text-sm font-bold text-green-800">
              {display.ready === 1 ? "1 carga ficou pronta" : `${display.ready} cargas ficaram prontas`}
            </div>
          )}
        </>
      );
      break;
    case "unknown":
      cls = "bg-amber-400 text-slate-950";
      body = (
        <>
          <div className={`${big} flex items-center gap-3`}><AlertTriangle className="size-[0.85em]" strokeWidth={3} aria-hidden /> NÃO ENCONTRADO</div>
          <div className="text-sm font-bold tracking-[0.2em]">CÓDIGO</div>
          <div className={code}>{display.code}</div>
          <p className="text-base font-medium">Leitura registrada para análise. Não entra no estoque.</p>
        </>
      );
      break;
    case "wrong_barcode":
      cls = "bg-red-700 text-white";
      body = (
        <>
          <div className={`${big} flex items-center gap-3`}><XCircle className="size-[0.85em]" strokeWidth={3} aria-hidden /> CÓDIGO INCORRETO</div>
          <div className="text-[clamp(1.25rem,5vw,2rem)] font-black tracking-wide">LEIA O CÓDIGO MAIOR</div>
          <p className="max-w-md text-base text-red-100">Leia o código de barras maior da etiqueta de produção. Este código não entra no estoque.</p>
          <div className="font-mono text-xl break-all text-red-100">{display.raw}</div>
        </>
      );
      break;
    case "not_in_program":
      cls = "bg-amber-400 text-slate-950";
      body = (
        <>
          <div className="text-[clamp(1.5rem,6.5vw,3rem)] font-black leading-tight tracking-tight">NÃO ENCONTRADO<br />NESSA PROGRAMAÇÃO</div>
          <div className={code}>{display.code}</div>
          <p className="max-w-md text-base font-medium">Produto não previsto nas cargas da programação{programming ? ` ${programmingLabel(programming)}` : ""}. Não entra no estoque.</p>
        </>
      );
      break;
    case "duplicate":
      cls = "bg-slate-600 text-white";
      body = (
        <>
          <div className="text-[clamp(1.5rem,6vw,2.75rem)] font-black leading-tight">LEITURA DUPLICADA<br />IGNORADA</div>
          <div className={code}>{display.code}</div>
        </>
      );
      break;
    case "invalid":
      cls = "bg-red-700 text-white";
      body = (
        <>
          <div className={`${big} flex items-center gap-3`}><XCircle className="size-[0.85em]" strokeWidth={3} aria-hidden /> CÓDIGO INVÁLIDO</div>
          <div className="font-mono text-2xl break-all">{display.raw || "—"}</div>
          <p className="text-base text-red-100">A leitura precisa ter pelo menos 10 caracteres.</p>
        </>
      );
      break;
    case "conflict":
      cls = "bg-purple-800 text-white";
      body = (
        <>
          <div className="text-[clamp(1.5rem,6vw,2.75rem)] font-black leading-tight">
            {display.reason === "PROGRAMMING_CLOSED" ? "PROGRAMAÇÃO ENCERRADA"
              : display.reason === "PROGRAMMING_NOT_FOUND" ? "PROGRAMAÇÃO NÃO ENCONTRADA" : "SESSÃO ENCERRADA"}
          </div>
          <div className={code}>{display.code}</div>
          <p className="text-base text-purple-100">Leitura guardada para revisão do administrador.</p>
        </>
      );
      break;
    default:
      cls = "bg-red-700 text-white";
      body = (
        <>
          <div className={`${big} flex items-center gap-3`}><XCircle className="size-[0.85em]" strokeWidth={3} aria-hidden /> ERRO</div>
          {display.code && <div className={code}>{display.code}</div>}
          <p className="max-w-lg text-base text-red-100">{display.message}</p>
        </>
      );
  }
  return (
    <div role="status" aria-live="assertive" aria-atomic="true" className={`${base} ${cls}`}>
      {body}
    </div>
  );
}
