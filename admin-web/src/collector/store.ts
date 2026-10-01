/** Opens the scan queue used by /coleta: IndexedDB when available, memory as a last resort (UI warns). */
import { openIdbQueue } from "./idbQueue.ts";
import { createMemoryQueue, type ScanQueue } from "./queue.ts";

export async function openScanQueue(): Promise<ScanQueue> {
  try {
    if (typeof indexedDB === "undefined") throw new Error("IndexedDB unavailable");
    const queue = await openIdbQueue(indexedDB);
    // Ask the browser not to evict the queue under storage pressure (granted silently on installed PWAs).
    void navigator.storage?.persist?.().catch(() => false);
    return queue;
  } catch {
    return createMemoryQueue();
  }
}
