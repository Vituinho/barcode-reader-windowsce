/**
 * Web collector logic tests. Run with `npm test` (Node's built-in runner; TypeScript executed directly).
 * Server-side guarantees (idempotent stock, unknown codes) are covered by server/tests/test_logistics.py.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { IDBFactory } from "fake-indexeddb";
import { createDuplicateGuard, normalizeProductCode, scannerKeyAction } from "../src/collector/barcode.ts";
import { getDeviceIdentity, setDeviceName, type KeyValueStorage } from "../src/collector/identity.ts";
import { openIdbQueue } from "../src/collector/idbQueue.ts";
import { pendingLogoutMessage } from "../src/collector/logout.ts";
import { submitReading, type PipelineContext } from "../src/collector/pipeline.ts";
import { createMemoryQueue, type QueuedScan, type ScanQueue } from "../src/collector/queue.ts";
import { createSyncEngine } from "../src/collector/sync.ts";
import { createCameraDebounce } from "../src/collector/cameraDebounce.ts";
import { isGtin, loadRules, predictResult, saveRules } from "../src/collector/rules.ts";

const require = createRequire(import.meta.url);
const { cachePolicy } = require("../public/sw-policy.js") as {
  cachePolicy: (url: string, method: string, mode: string, origin: string) => string;
};

function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

function ctx(queue: ScanQueue, now = { t: 1_000_000 }): PipelineContext {
  return { queue, guard: createDuplicateGuard(2000), deviceId: "WEB-00000000-0000-4000-8000-000000000000",
           operatorId: "op-1", sessionId: null, now: () => now.t };
}

type Reply = { status: number; body?: unknown } | "network";

/** Fake API: records every request; replies are consumed in order (default: KNOWN). */
function fakeApi(replies: Reply[] = []) {
  const calls: { url: string; body: Record<string, unknown> | null; auth: string | null }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body, auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null });
    if (url.endsWith("/api/health")) return new Response("{}", { status: 200 });
    const reply = replies.length ? replies.shift()! : { status: 200 };
    if (reply === "network") throw new TypeError("Failed to fetch");
    const payload = reply.body ?? { accepted: true, result: "KNOWN", productCode: body?.barcode?.slice(0, 10),
                                     itemName: "Produto", currentStock: 7, newlyReadyLoads: 0 };
    return new Response(JSON.stringify(payload), { status: reply.status, headers: { "Content-Type": "application/json" } });
  };
  return { calls, fetchImpl, scans: () => calls.filter((c) => c.url.endsWith("/api/scans")) };
}

function engine(queue: ScanQueue, api: ReturnType<typeof fakeApi>, token: { v: string | null } = { v: "tok" }) {
  return createSyncEngine({ queue, apiUrl: "https://api.test", getToken: () => token.v, fetchImpl: api.fetchImpl });
}

describe("barcode rule (first 10 characters)", () => {
  it("1. long logistics barcode -> first 10 chars", () => {
    assert.equal(normalizeProductCode("60506471342313480002"), "6050647134");
  });
  it("2. exactly 10 chars", () => {
    assert.equal(normalizeProductCode("6050647134"), "6050647134");
  });
  it("3. shorter than 10 -> invalid", () => {
    assert.equal(normalizeProductCode("12345"), null);
    assert.equal(normalizeProductCode("   605064713   "), null);
  });
  it("4. leading zeroes preserved (never numeric)", () => {
    assert.equal(normalizeProductCode("00123456789999"), "0012345678");
  });
  it("5. alphanumeric code preserved; surrounding spaces trimmed", () => {
    assert.equal(normalizeProductCode("  104121A181XYZ "), "104121A181");
  });
});

describe("physical scanner (keyboard wedge)", () => {
  it("6. Enter completes the scan and is prevented from submitting forms", () => {
    assert.deepEqual(scannerKeyAction("Enter", "60506471342313480002", true), { preventDefault: true, submit: "60506471342313480002" });
    assert.deepEqual(scannerKeyAction("Enter", "", true), { preventDefault: true, submit: null });
    assert.deepEqual(scannerKeyAction("5", "6050", true), { preventDefault: false, submit: null });
  });
  it("7. Tab completes only when enabled, and never moves focus away", () => {
    assert.equal(scannerKeyAction("Tab", "6050647134", true).submit, "6050647134");
    assert.deepEqual(scannerKeyAction("Tab", "6050647134", false), { preventDefault: true, submit: null });
  });
  it("8. same reading within 2 s is ignored, later rescan is accepted", async () => {
    const queue = createMemoryQueue();
    const clock = { t: 1_000_000 };
    const c = ctx(queue, clock);
    assert.equal((await submitReading("60506471342313480002", "KEYBOARD", c)).kind, "queued");
    clock.t += 1500;
    assert.equal((await submitReading("60506471342313480002", "KEYBOARD", c)).kind, "duplicate");
    clock.t += 2500;
    assert.equal((await submitReading("60506471342313480002", "KEYBOARD", c)).kind, "queued");
    assert.equal(await queue.pendingCount(), 2);
  });
  it("invalid reading is never queued", async () => {
    const queue = createMemoryQueue();
    assert.equal((await submitReading("12345", "KEYBOARD", ctx(queue))).kind, "invalid");
    assert.equal(await queue.pendingCount(), 0);
  });
});

describe("offline queue and sync", () => {
  it("9. clientScanId is generated once, before any request, and reused on retry", async () => {
    const queue = createMemoryQueue();
    const out = await submitReading("60506471342313480002", "KEYBOARD", ctx(queue));
    assert.equal(out.kind, "queued");
    const id = out.kind === "queued" ? out.scan.clientScanId : "";
    assert.match(id, /^WEB-[0-9a-f-]{36}-[0-9a-f-]{36}$/);
    const api = fakeApi(["network", { status: 200 }]);
    const e = engine(queue, api);
    await e.runOnce();
    await e.runOnce();
    assert.deepEqual(api.scans().map((c) => c.body?.clientScanId), [id, id]);
  });

  it("10. network failure keeps the scan queued (offline state)", async () => {
    const queue = createMemoryQueue();
    await submitReading("60506471342313480002", "KEYBOARD", ctx(queue));
    const e = engine(queue, fakeApi(["network"]));
    await e.runOnce();
    assert.equal(await queue.pendingCount(), 1);
    assert.equal(e.getState().connection, "OFFLINE");
    assert.equal((await queue.pending())[0].attempts, 1);
  });

  it("11. pending scans survive a page reload (IndexedDB reopened)", async () => {
    const idb = new IDBFactory();
    const first = await openIdbQueue(idb, "reload-test");
    await submitReading("60506471342313480002", "KEYBOARD", ctx(first));
    await submitReading("60506471342313480003", "KEYBOARD", { ...ctx(first), now: () => 2_000_000 });
    const reopened = await openIdbQueue(idb, "reload-test");
    assert.equal(reopened.durable, true);
    const pending = await reopened.pending();
    assert.deepEqual(pending.map((p) => p.productCode), ["6050647134", "6050647134"]);
    assert.ok(pending[0].createdAt < pending[1].createdAt, "scan order preserved");
  });

  it("12. successful retry clears the pending state and stores the server answer", async () => {
    const queue = await openIdbQueue(new IDBFactory(), "retry-test");
    await submitReading("60506471342313480002", "KEYBOARD", ctx(queue));
    const e = engine(queue, fakeApi(["network", { status: 200 }]));
    await e.runOnce();
    assert.equal(await queue.pendingCount(), 1);
    await e.runOnce();
    assert.equal(await queue.pendingCount(), 0);
    const [synced] = await queue.recent(1);
    assert.equal(synced.status, "SYNCED");
    assert.equal(synced.currentStock, 7);
    assert.equal(e.getState().connection, "ONLINE");
  });

  it("13. a retried scan keeps its clientScanId so the server can deduplicate stock", async () => {
    // The server guarantee (one SCAN_IN per clientScanId) is tested in server/tests/test_logistics.py.
    const queue = createMemoryQueue();
    await submitReading("60506471342313480002", "KEYBOARD", ctx(queue));
    const api = fakeApi([{ status: 502, body: { error: "BAD_GATEWAY" } }, { status: 200, body: { accepted: true, result: "KNOWN", currentStock: 1, replayed: true } }]);
    const e = engine(queue, api);
    await e.runOnce();
    await e.runOnce();
    const ids = new Set(api.scans().map((c) => c.body?.clientScanId));
    assert.equal(ids.size, 1);
    assert.equal(api.scans()[0].body?.rawBarcode, "60506471342313480002");
  });

  it("14. unknown product is stored with no stock in the local record", async () => {
    const queue = createMemoryQueue();
    await submitReading("ZZZZZZZZZZ0001", "KEYBOARD", ctx(queue));
    const e = engine(queue, fakeApi([{ status: 200, body: { accepted: true, result: "UNKNOWN", productCode: "ZZZZZZZZZZ", currentStock: null } }]));
    await e.runOnce();
    const [r] = await queue.recent(1);
    assert.equal(r.result, "UNKNOWN");
    assert.equal(r.currentStock, null);
  });

  it("15. login expiration never deletes queued scans; sync resumes after login", async () => {
    const queue = createMemoryQueue();
    await submitReading("60506471342313480002", "KEYBOARD", ctx(queue));
    const token = { v: "expired" as string | null };
    const api = fakeApi([{ status: 401, body: { error: "TOKEN_EXPIRED" } }, { status: 200 }]);
    const e = engine(queue, api, token);
    await e.runOnce();
    assert.equal(e.getState().connection, "LOGIN_REQUIRED");
    assert.equal(await queue.pendingCount(), 1);
    token.v = null; // logged out: nothing is sent, nothing is lost
    await e.runOnce();
    assert.equal(await queue.pendingCount(), 1);
    token.v = "fresh";
    await e.runOnce();
    assert.equal(await queue.pendingCount(), 0);
    assert.equal(api.scans().at(-1)?.auth, "Bearer fresh");
  });

  it("validation refusal is kept as REJECTED and does not block later scans", async () => {
    const queue = createMemoryQueue();
    const clock = { t: 1 };
    await submitReading("60506471342313480002", "KEYBOARD", ctx(queue, clock));
    clock.t = 10_000;
    await submitReading("60506471342313480003", "KEYBOARD", ctx(queue, clock));
    const e = engine(queue, fakeApi([{ status: 422, body: { error: "BARCODE_TOO_SHORT" } }, { status: 200 }]));
    await e.runOnce();
    const rows: QueuedScan[] = await queue.recent(5);
    assert.deepEqual(rows.map((r) => r.status).sort(), ["REJECTED", "SYNCED"]);
  });
});

describe("camera, device identity, service worker, logout", () => {
  it("16. camera readings use the same pipeline as the scanner", async () => {
    const queue = createMemoryQueue();
    const c = ctx(queue);
    const cam = await submitReading("60506471342313480002", "CAMERA", c);
    assert.equal(cam.kind, "queued");
    if (cam.kind !== "queued") return;
    assert.equal(cam.scan.productCode, "6050647134");
    assert.equal(cam.scan.source, "CAMERA");
    // The scanner shares the duplicate guard with the camera.
    assert.equal((await submitReading("60506471342313480002", "KEYBOARD", c)).kind, "duplicate");
    const accept = createCameraDebounce(2500);
    assert.equal(accept("A", 0), true);
    assert.equal(accept("A", 100), false);
    assert.equal(accept("A", 3000), true);
  });

  it("17. device id is generated once and persists; renaming keeps the id", () => {
    const storage = memoryStorage();
    const a = getDeviceIdentity(storage);
    assert.match(a.id, /^WEB-[0-9a-f-]{36}$/);
    assert.equal(getDeviceIdentity(storage).id, a.id);
    const renamed = setDeviceName(storage, "  Coletor   Expedição 01 ");
    assert.equal(renamed.id, a.id);
    assert.equal(getDeviceIdentity(storage).name, "Coletor Expedição 01");
  });

  it("18. service worker never caches auth, API or mutations", () => {
    const o = "https://admin.example.app";
    assert.equal(cachePolicy("https://api.example.app/api/auth/login", "POST", "cors", o), "bypass");
    assert.equal(cachePolicy("https://api.example.app/api/inventory", "GET", "cors", o), "bypass");
    assert.equal(cachePolicy(`${o}/api/scans`, "POST", "cors", o), "bypass");
    assert.equal(cachePolicy(`${o}/api/loads`, "GET", "cors", o), "bypass");
    assert.equal(cachePolicy(`${o}/coleta?_rsc=abc`, "GET", "cors", o), "bypass");
    assert.equal(cachePolicy(`${o}/login`, "GET", "navigate", o), "bypass");
    assert.equal(cachePolicy(`${o}/dashboard`, "GET", "navigate", o), "bypass");
    assert.equal(cachePolicy(`${o}/_next/static/chunks/app.js`, "GET", "no-cors", o), "cache-first");
    assert.equal(cachePolicy(`${o}/icons/icon-192.png`, "GET", "no-cors", o), "cache-first");
    assert.equal(cachePolicy(`${o}/coleta`, "GET", "navigate", o), "network-first-shell");
  });

  it("19. logout warns while scans are pending", () => {
    assert.equal(pendingLogoutMessage(0), null);
    assert.equal(pendingLogoutMessage(1), "Existe 1 leitura ainda não sincronizada.");
    assert.equal(pendingLogoutMessage(4), "Existem 4 leituras ainda não sincronizadas.");
  });
});

describe("production programming collection", () => {
  const rules = { productCodes: ["1040421012"], eans: ["7896988334632"] };

  it("large production code -> product = first 10 chars, raw preserved, programmingId queued and sent", async () => {
    const queue = createMemoryQueue();
    const out = await submitReading("10404210122313220003", "KEYBOARD",
                                    { ...ctx(queue), programmingId: "prog-1", requireProgramming: true });
    assert.equal(out.kind, "queued");
    const scan = (await queue.pending())[0];
    assert.equal(scan.productCode, "1040421012");
    assert.equal(scan.rawBarcode, "10404210122313220003");
    assert.equal(scan.programmingId, "prog-1");
    const api = fakeApi([{ status: 200, body: { accepted: true, result: "KNOWN", productCode: "1040421012",
                                                  currentStock: 1, newlyReadyLoads: 1, readyLoadCodes: ["231322"] } }]);
    await engine(queue, api).runOnce();
    assert.equal(api.scans()[0].body?.programmingId, "prog-1");
    assert.equal(api.scans()[0].body?.rawBarcode, "10404210122313220003");
    const synced = (await queue.recent(1))[0];
    assert.deepEqual(synced.readyLoadCodes, ["231322"]);
    assert.equal(predictResult("10404210122313220003", rules), null);
  });

  it("no programming selected -> reading refused before queuing", async () => {
    const queue = createMemoryQueue();
    const out = await submitReading("10404210122313220003", "KEYBOARD", { ...ctx(queue), requireProgramming: true });
    assert.equal(out.kind, "no_programming");
    assert.equal(await queue.pendingCount(), 0);
  });

  it("EAN -> CÓDIGO INCORRETO prediction, still queued for audit; server answer is final (no stock)", async () => {
    assert.equal(predictResult("7896988334632", rules), "WRONG_BARCODE");
    assert.equal(predictResult("4006381333931", rules), "WRONG_BARCODE"); // any valid GTIN not in the programming
    const queue = createMemoryQueue();
    await submitReading("7896988334632", "CAMERA", { ...ctx(queue), programmingId: "prog-1", requireProgramming: true });
    const api = fakeApi([{ status: 200, body: { accepted: true, result: "WRONG_BARCODE", productCode: "7896988334" } }]);
    await engine(queue, api).runOnce();
    const stored = (await queue.recent(1))[0];
    assert.equal(stored.status, "SYNCED");
    assert.equal(stored.result, "WRONG_BARCODE");
    assert.equal(stored.currentStock, null);
  });

  it("blocked value -> CÓDIGO BLOQUEADO prediction, even for a programming product", () => {
    const withBlock = { ...rules, blocked: ["10404210122313220003"] };
    assert.equal(predictResult("10404210122313220003", withBlock), "BLOCKED");
    assert.equal(predictResult("10404210122313220004", withBlock), null);
  });

  it("product outside the programming -> NOT_IN_PROGRAM prediction", () => {
    assert.equal(predictResult("60506471342313480002", rules), "NOT_IN_PROGRAM");
    assert.equal(predictResult("60506471342313480002", null), null); // no rules cached: server decides
  });

  it("scan synced after its programming closed -> CONFLICT for review, programming kept", async () => {
    const queue = createMemoryQueue();
    await submitReading("10404210122313220003", "KEYBOARD", { ...ctx(queue), programmingId: "prog-old", requireProgramming: true });
    await engine(queue, fakeApi([{ status: 200, body: { accepted: true, result: "PROGRAMMING_CLOSED" } }])).runOnce();
    const stored = (await queue.recent(1))[0];
    assert.equal(stored.status, "CONFLICT");
    assert.equal(stored.programmingId, "prog-old");
  });

  it("GTIN check digit and rules cache", () => {
    assert.ok(isGtin("7896988334632"));
    assert.ok(!isGtin("7896988334633"));
    assert.ok(!isGtin("10404210122313220003"));
    const m = new Map<string, string>();
    const storage = {
      get length() { return m.size; }, key: (i: number) => [...m.keys()][i] ?? null,
      getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k), clear: () => m.clear(),
    } as Storage;
    saveRules(storage, "p1", rules);
    saveRules(storage, "p2", { productCodes: [], eans: [] });
    assert.equal(loadRules(storage, "p1"), null); // only the selected programming is kept
    assert.deepEqual(loadRules(storage, "p2"), { productCodes: [], eans: [], blocked: [] });
  });
});
