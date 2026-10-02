/**
 * Production barcode rules of the selected programming, cached for instant (also offline) feedback.
 * Only a prediction for the operator: every reading is still queued and the server classifies it.
 * Mirrors server/app/services/barcode_rules.py.
 */
import { normalizeProductCode } from "./barcode.ts";

export interface ScanRules {
  productCodes: string[];
  eans: string[];
}

export type PredictedResult = "WRONG_BARCODE" | "NOT_IN_PROGRAM" | null;

const RULES_PREFIX = "givova.coleta.rules.";

/** EAN-8 / UPC-A / EAN-13 / GTIN-14 with a valid check digit. */
export function isGtin(value: string): boolean {
  const v = value.trim();
  if (![8, 12, 13, 14].includes(v.length) || !/^\d+$/.test(v)) return false;
  const digits = v.slice(0, -1).split("").reverse();
  const total = digits.reduce((sum, d, i) => sum + Number(d) * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (total % 10)) % 10 === Number(v[v.length - 1]);
}

/** null = no local objection (collect, or let the server decide). */
export function predictResult(raw: string, rules: ScanRules | null): PredictedResult {
  if (!rules) return null;
  const value = raw.trim();
  if (rules.eans.includes(value)) return "WRONG_BARCODE";
  const code = normalizeProductCode(value);
  if (code !== null && rules.productCodes.includes(code)) return null;
  if (isGtin(value)) return "WRONG_BARCODE";
  return "NOT_IN_PROGRAM";
}

export function loadRules(storage: Storage, programmingId: string): ScanRules | null {
  try {
    const parsed = JSON.parse(storage.getItem(RULES_PREFIX + programmingId) ?? "null") as ScanRules | null;
    return parsed && Array.isArray(parsed.productCodes) && Array.isArray(parsed.eans) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveRules(storage: Storage, programmingId: string, rules: ScanRules): void {
  try {
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith(RULES_PREFIX) && key !== RULES_PREFIX + programmingId) storage.removeItem(key);
    }
    storage.setItem(RULES_PREFIX + programmingId, JSON.stringify({ productCodes: rules.productCodes, eans: rules.eans }));
  } catch {
    /* storage full / blocked: predictions simply stay off */
  }
}
