/** Local scan queue. Every reading is stored here BEFORE any network attempt. */

export type QueueStatus = "PENDING" | "SYNCED" | "CONFLICT" | "REJECTED";

export interface QueuedScan {
  clientScanId: string;
  rawBarcode: string;
  barcode: string;
  productCode: string;
  deviceId: string;
  operatorId: string | null;
  sessionId: string | null;
  /** Programming selected when the label was read; the scan always syncs into this one. */
  programmingId: string | null;
  source: "KEYBOARD" | "CAMERA";
  scannedAt: string; // ISO with offset
  createdAt: number; // ms, ordering key
  status: QueueStatus;
  attempts: number;
  lastError: string | null;
  // Filled from the server answer
  result: string | null;
  itemName: string | null;
  currentStock: number | null;
  newlyReadyLoads: number | null;
}

export interface ScanQueue {
  readonly durable: boolean;
  add(scan: QueuedScan): Promise<void>;
  put(scan: QueuedScan): Promise<void>;
  get(clientScanId: string): Promise<QueuedScan | undefined>;
  pending(): Promise<QueuedScan[]>;
  recent(limit: number): Promise<QueuedScan[]>;
  pendingCount(): Promise<number>;
  /** Keeps only the newest confirmed records (pending/rejected are never pruned). */
  prune(keepConfirmed: number): Promise<void>;
}

const byCreated = (a: QueuedScan, b: QueuedScan) => a.createdAt - b.createdAt;

/** Fallback when IndexedDB is unavailable (some private modes). Not durable: the UI warns about it. */
export function createMemoryQueue(): ScanQueue {
  const rows = new Map<string, QueuedScan>();
  return {
    durable: false,
    async add(scan) {
      if (rows.has(scan.clientScanId)) throw new Error("duplicate clientScanId");
      rows.set(scan.clientScanId, { ...scan });
    },
    async put(scan) {
      rows.set(scan.clientScanId, { ...scan });
    },
    async get(id) {
      const r = rows.get(id);
      return r ? { ...r } : undefined;
    },
    async pending() {
      return [...rows.values()].filter((r) => r.status === "PENDING").sort(byCreated).map((r) => ({ ...r }));
    },
    async recent(limit) {
      return [...rows.values()].sort(byCreated).reverse().slice(0, limit).map((r) => ({ ...r }));
    },
    async pendingCount() {
      return [...rows.values()].filter((r) => r.status === "PENDING").length;
    },
    async prune(keep) {
      const confirmed = [...rows.values()].filter((r) => r.status === "SYNCED" || r.status === "CONFLICT").sort(byCreated);
      for (const r of confirmed.slice(0, Math.max(0, confirmed.length - keep))) rows.delete(r.clientScanId);
    },
  };
}
