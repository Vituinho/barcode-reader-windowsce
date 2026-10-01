/**
 * Product identity rule (the server is authoritative; this mirrors it for instant feedback):
 * trim surrounding whitespace, require at least 10 characters, product code = first 10 characters.
 * Letters and leading zeroes are kept; values are never parsed as numbers. EAN is irrelevant here.
 */
export const PRODUCT_CODE_LENGTH = 10;

/** Removes scanner framing characters only (terminators / NUL). Everything else is kept. */
export function cleanReading(raw: string): string {
  return raw.replace(/\u0000/g, "").replace(/^[\u0002]+/, "").replace(/[\r\n\t\u0003\u0004]+$/, "");
}

export function normalizeProductCode(raw: string): string | null {
  const value = cleanReading(raw).trim();
  return value.length < PRODUCT_CODE_LENGTH ? null : value.slice(0, PRODUCT_CODE_LENGTH);
}

export interface ScannerKeyAction {
  /** Call event.preventDefault() (keeps focus, avoids form submission / focus navigation). */
  preventDefault: boolean;
  /** Completed reading, when the key terminated a scan. */
  submit: string | null;
}

/**
 * Keyboard-wedge handling: scanners type the code and finish with Enter (optionally Tab).
 * Pure function so it can be tested without a DOM.
 */
export function scannerKeyAction(key: string, value: string, tabCompletes: boolean): ScannerKeyAction {
  if (key === "Enter" || (key === "Tab" && tabCompletes)) {
    return { preventDefault: true, submit: value.trim().length > 0 ? value : null };
  }
  if (key === "Tab") return { preventDefault: true, submit: null }; // never move focus away mid-scan
  return { preventDefault: false, submit: null };
}

/** Ignores the same raw reading repeated within the window (accidental double trigger only). */
export function createDuplicateGuard(windowMs = 2000) {
  const last = new Map<string, number>();
  return {
    isDuplicate(raw: string, now: number): boolean {
      const key = raw.trim();
      const previous = last.get(key);
      if (previous !== undefined && now - previous >= 0 && now - previous < windowMs) return true;
      if (last.size > 64) last.clear();
      last.set(key, now);
      return false;
    },
  };
}
