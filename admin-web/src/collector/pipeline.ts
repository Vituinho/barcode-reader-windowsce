/**
 * Single entry point for every reading (physical scanner or camera):
 * validate -> duplicate guard -> durable local save (clientScanId created once) -> caller triggers sync.
 * No stock or product logic here: the server is authoritative.
 */
import { normalizeProductCode } from "./barcode.ts";
import { newClientScanId } from "./identity.ts";
import type { QueuedScan, ScanQueue } from "./queue.ts";

export type ReadingOutcome =
  | { kind: "invalid"; raw: string }
  | { kind: "duplicate"; raw: string; productCode: string }
  | { kind: "queued"; scan: QueuedScan }
  | { kind: "error"; raw: string; message: string };

export interface PipelineContext {
  queue: ScanQueue;
  guard: { isDuplicate(raw: string, now: number): boolean };
  deviceId: string;
  operatorId: string | null;
  sessionId: string | null;
  now?: () => number;
}

export async function submitReading(raw: string, source: QueuedScan["source"], ctx: PipelineContext): Promise<ReadingOutcome> {
  const productCode = normalizeProductCode(raw);
  if (productCode === null) return { kind: "invalid", raw };
  const now = ctx.now ? ctx.now() : Date.now();
  if (ctx.guard.isDuplicate(raw, now)) return { kind: "duplicate", raw, productCode };

  const scan: QueuedScan = {
    clientScanId: newClientScanId(ctx.deviceId),
    rawBarcode: raw,
    barcode: raw.trim(),
    productCode,
    deviceId: ctx.deviceId,
    operatorId: ctx.operatorId,
    sessionId: ctx.sessionId,
    source,
    scannedAt: new Date(now).toISOString(),
    createdAt: now,
    status: "PENDING",
    attempts: 0,
    lastError: null,
    result: null,
    itemName: null,
    currentStock: null,
    newlyReadyLoads: null,
  };
  try {
    await ctx.queue.add(scan);
  } catch (e) {
    // Not saved: never confirm this reading to the operator.
    return { kind: "error", raw, message: e instanceof Error ? e.message : String(e) };
  }
  return { kind: "queued", scan };
}
