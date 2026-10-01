/** Opens the scan queue used by /coleta. */
import { createMemoryQueue, type ScanQueue } from "./queue.ts";

export async function openScanQueue(): Promise<ScanQueue> {
  return createMemoryQueue();
}
