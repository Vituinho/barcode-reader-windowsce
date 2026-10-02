/**
 * Sends queued scans to the existing POST /api/scans, oldest first, one at a time.
 * - same clientScanId on every retry (server idempotency prevents double stock)
 * - network/5xx: keep PENDING, back off; 401: keep PENDING, require login; 403: keep PENDING, blocked
 * - explicit validation refusal (400/409/413/422 from the API): REJECTED, kept for review, not retried
 * Real request failures drive the connection state; navigator.onLine is only a hint.
 */
import type { QueuedScan, ScanQueue } from "./queue.ts";

export type Connection = "UNKNOWN" | "ONLINE" | "OFFLINE" | "SYNCING" | "LOGIN_REQUIRED" | "BLOCKED" | "SERVER_ERROR";

export interface EngineState {
  connection: Connection;
  pending: number;
  lastError: string | null;
}

export interface ScanResponse {
  accepted: boolean;
  result: string;
  productCode?: string | null;
  itemName?: string | null;
  currentStock?: number | null;
  newlyReadyLoads?: number | null;
  readyLoadCodes?: string[] | null;
  replayed?: boolean;
}

export type SendResult =
  | { kind: "ok"; body: ScanResponse }
  | { kind: "network"; message: string }
  | { kind: "auth"; message: string }
  | { kind: "forbidden"; code: string; message: string }
  | { kind: "rejected"; code: string; message: string }
  | { kind: "server"; status: number; message: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function buildScanPayload(scan: QueuedScan) {
  return {
    clientScanId: scan.clientScanId,
    deviceId: scan.deviceId,
    operatorId: scan.operatorId,
    sessionId: scan.sessionId,
    programmingId: scan.programmingId ?? null,
    barcode: scan.barcode,
    rawBarcode: scan.rawBarcode,
    source: scan.source === "CAMERA" ? "WEB_CAMERA" : "WEB",
    scannedAtDevice: scan.scannedAt,
  };
}

async function timedFetch(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs: number) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    return await fetchImpl(url, { ...init, signal: controller?.signal });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function sendScan(fetchImpl: FetchLike, apiUrl: string, token: string, scan: QueuedScan,
                               timeoutMs = 15000): Promise<SendResult> {
  let res: Response;
  try {
    res = await timedFetch(fetchImpl, `${apiUrl}/api/scans`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(buildScanPayload(scan)),
      cache: "no-store",
    }, timeoutMs);
  } catch (e) {
    return { kind: "network", message: e instanceof Error && e.name === "AbortError" ? "tempo esgotado" : "sem conexão" };
  }
  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = null; // proxy/captive portal error page
  }
  if (res.ok) {
    if (!body || typeof body.result !== "string") return { kind: "server", status: res.status, message: "resposta inválida" };
    return { kind: "ok", body: body as unknown as ScanResponse };
  }
  const code = typeof body?.error === "string" ? body.error : `HTTP ${res.status}`;
  const message = typeof body?.message === "string" ? body.message : code;
  const fromApi = body !== null && ("error" in body || "detail" in body);
  if (res.status === 401 && fromApi) return { kind: "auth", message };
  if (res.status === 403 && fromApi) return { kind: "forbidden", code, message };
  if (fromApi && [400, 409, 413, 422].includes(res.status)) return { kind: "rejected", code, message };
  return { kind: "server", status: res.status, message };
}

export interface EngineOptions {
  queue: ScanQueue;
  apiUrl: string;
  getToken: () => string | null;
  fetchImpl?: FetchLike;
  onState?: (state: EngineState) => void;
  onScanUpdated?: (scan: QueuedScan) => void;
  heartbeat?: () => { deviceId: string; operatorId: string | null } | null;
}

const CONFLICT_RESULTS = ["SESSION_CLOSED", "SESSION_NOT_FOUND", "PROGRAMMING_CLOSED", "PROGRAMMING_NOT_FOUND"];

export function createSyncEngine(opts: EngineOptions) {
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  let connection: Connection = "UNKNOWN";
  let lastError: string | null = null;
  let failures = 0;
  let running = false;
  let rerun = false;
  let stopped = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastHeartbeat = 0;

  async function emit() {
    const pending = await opts.queue.pendingCount();
    opts.onState?.({ connection, pending, lastError });
    return pending;
  }

  function setConnection(next: Connection, error: string | null = null) {
    connection = next;
    lastError = error;
  }

  async function probe() {
    try {
      const res = await timedFetch(fetchImpl, `${opts.apiUrl}/api/health`, { cache: "no-store" }, 8000);
      if (res.ok) {
        failures = 0;
        setConnection("ONLINE");
      } else setConnection("SERVER_ERROR", `HTTP ${res.status}`);
    } catch {
      failures++;
      setConnection("OFFLINE", "sem conexão");
    }
  }

  async function sendHeartbeat(token: string, pending: number) {
    const info = opts.heartbeat?.();
    if (!info || Date.now() - lastHeartbeat < 60000) return;
    lastHeartbeat = Date.now();
    try {
      await timedFetch(fetchImpl, `${opts.apiUrl}/api/device/heartbeat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: info.deviceId, appVersion: "web", operatorId: info.operatorId,
                               pendingScans: pending, timestamp: new Date().toISOString() }),
        cache: "no-store",
      }, 8000);
    } catch {
      /* heartbeat is best effort */
    }
  }

  /** One pass over the queue. Never deletes a pending scan. */
  async function runOnce(): Promise<void> {
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      const pending = await opts.queue.pending();
      const token = opts.getToken();
      if (!token) {
        setConnection("LOGIN_REQUIRED", "login necessário");
        return;
      }
      if (pending.length === 0) {
        if (connection !== "ONLINE") await probe();
        if (connection === "ONLINE") await sendHeartbeat(token, 0);
        return;
      }
      setConnection("SYNCING");
      await emit();
      for (const scan of pending) {
        const r = await sendScan(fetchImpl, opts.apiUrl, token, scan);
        if (r.kind === "ok") {
          const updated: QueuedScan = {
            ...scan,
            status: CONFLICT_RESULTS.includes(r.body.result) ? "CONFLICT" : "SYNCED",
            attempts: scan.attempts + 1,
            lastError: null,
            result: r.body.result,
            itemName: r.body.itemName ?? null,
            currentStock: typeof r.body.currentStock === "number" ? r.body.currentStock : null,
            newlyReadyLoads: typeof r.body.newlyReadyLoads === "number" ? r.body.newlyReadyLoads : null,
            readyLoadCodes: Array.isArray(r.body.readyLoadCodes) ? r.body.readyLoadCodes : null,
          };
          await opts.queue.put(updated);
          opts.onScanUpdated?.(updated);
          failures = 0;
          continue;
        }
        if (r.kind === "rejected") {
          const updated: QueuedScan = { ...scan, status: "REJECTED", attempts: scan.attempts + 1,
                                        lastError: `${r.code}: ${r.message}` };
          await opts.queue.put(updated);
          opts.onScanUpdated?.(updated);
          continue;
        }
        await opts.queue.put({ ...scan, attempts: scan.attempts + 1, lastError: r.message });
        failures++;
        if (r.kind === "network") setConnection("OFFLINE", r.message);
        else if (r.kind === "auth") setConnection("LOGIN_REQUIRED", "login expirado");
        else if (r.kind === "forbidden") setConnection("BLOCKED", r.message);
        else setConnection("SERVER_ERROR", r.message);
        return;
      }
      setConnection("ONLINE");
      await opts.queue.prune(100);
      await sendHeartbeat(token, 0);
    } finally {
      running = false;
      await emit();
      if (rerun) {
        rerun = false;
        void runOnce();
      } else schedule();
    }
  }

  function nextDelay(): number {
    switch (connection) {
      case "ONLINE":
        return 15000;
      case "LOGIN_REQUIRED":
        return 30000;
      case "BLOCKED":
        return 60000;
      default:
        return Math.min(30000, 2000 * 2 ** Math.min(failures, 4));
    }
  }

  function schedule() {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void runOnce(), nextDelay());
  }

  const onOnline = () => {
    failures = 0;
    trigger();
  };
  const onOffline = () => {
    setConnection("OFFLINE", "sem conexão");
    void emit();
  };
  const onVisible = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") trigger();
  };

  function trigger() {
    if (timer) clearTimeout(timer);
    void runOnce();
  }

  return {
    start() {
      stopped = false;
      if (typeof window !== "undefined") {
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
        document.addEventListener("visibilitychange", onVisible);
      }
      trigger();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
        document.removeEventListener("visibilitychange", onVisible);
      }
    },
    /** New scan / manual sync / login: try immediately (resets backoff). */
    trigger(resetBackoff = false) {
      if (resetBackoff) failures = 0;
      trigger();
    },
    runOnce,
    getState: () => ({ connection, lastError }),
  };
}
