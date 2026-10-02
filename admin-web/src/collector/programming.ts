/** Load programming selected on this collector (remembered locally; validated against OPEN programmings). */
import type { KeyValueStorage } from "./identity.ts";

export interface ProgrammingChoice {
  id: string;
  scheduledDate: string; // YYYY-MM-DD
  name: string | null;
}

export const PROGRAMMING_KEY = "givova.coleta.programming";

/** "2026-10-02" -> "02/10/2026" without timezone shifts. */
export function formatProgrammingDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : isoDate;
}

export function programmingLabel(p: ProgrammingChoice): string {
  return p.name ? `${formatProgrammingDate(p.scheduledDate)} · ${p.name}` : formatProgrammingDate(p.scheduledDate);
}

export function loadRememberedProgramming(storage: KeyValueStorage): ProgrammingChoice | null {
  try {
    const raw = storage.getItem(PROGRAMMING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as ProgrammingChoice;
    return p && p.id && p.scheduledDate ? p : null;
  } catch {
    return null;
  }
}

export function rememberProgramming(storage: KeyValueStorage, p: ProgrammingChoice | null) {
  try {
    if (p) storage.setItem(PROGRAMMING_KEY, JSON.stringify(p));
    else storage.removeItem(PROGRAMMING_KEY);
  } catch {
    /* ignore */
  }
}

/** Keeps the remembered programming only if it is still OPEN on the server. */
export function validateRemembered(remembered: ProgrammingChoice | null, open: ProgrammingChoice[]): ProgrammingChoice | null {
  if (!remembered) return open.length === 1 ? open[0] : null; // single open programming: select it
  return open.find((p) => p.id === remembered.id) ?? null;
}
