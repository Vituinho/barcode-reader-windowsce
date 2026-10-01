/**
 * Durable scan queue in IndexedDB (survives reloads, browser restarts and expired logins).
 * Pending/rejected records are never removed here; only confirmed ones are pruned.
 */
import type { QueuedScan, ScanQueue } from "./queue.ts";

export const DB_NAME = "givova-coleta";
const STORE = "scans";
const VERSION = 1;

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

export async function openIdbQueue(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<ScanQueue> {
  const open = factory.open(name, VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains(STORE)) {
      const store = db.createObjectStore(STORE, { keyPath: "clientScanId" });
      store.createIndex("createdAt", "createdAt");
      store.createIndex("status", "status");
    }
  };
  const db = await req(open);

  async function all(): Promise<QueuedScan[]> {
    const tx = db.transaction(STORE, "readonly");
    const rows = await req(tx.objectStore(STORE).index("createdAt").getAll() as IDBRequest<QueuedScan[]>);
    return rows;
  }

  return {
    durable: true,
    async add(scan) {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).add(scan); // fails on an existing clientScanId
      await done(tx); // resolves only once committed to disk
    },
    async put(scan) {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(scan);
      await done(tx);
    },
    async get(id) {
      const tx = db.transaction(STORE, "readonly");
      return (await req(tx.objectStore(STORE).get(id))) as QueuedScan | undefined;
    },
    async pending() {
      const tx = db.transaction(STORE, "readonly");
      const rows = (await req(tx.objectStore(STORE).index("status").getAll("PENDING"))) as QueuedScan[];
      return rows.sort((a, b) => a.createdAt - b.createdAt);
    },
    async recent(limit) {
      return (await all()).reverse().slice(0, limit);
    },
    async pendingCount() {
      const tx = db.transaction(STORE, "readonly");
      return await req(tx.objectStore(STORE).index("status").count("PENDING"));
    },
    async prune(keepConfirmed) {
      const confirmed = (await all()).filter((r) => r.status === "SYNCED" || r.status === "CONFLICT");
      const remove = confirmed.slice(0, Math.max(0, confirmed.length - keepConfirmed));
      if (!remove.length) return;
      const tx = db.transaction(STORE, "readwrite");
      for (const r of remove) tx.objectStore(STORE).delete(r.clientScanId);
      await done(tx);
    },
  };
}
