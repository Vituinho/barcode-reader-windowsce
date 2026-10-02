export { formatProgrammingDate } from "@/collector/programming";

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

/** "2026-10-02" -> "sexta-feira" (calendar date, no timezone shift). */
export function weekdayOf(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
}

/** Today's calendar date in the browser's timezone as YYYY-MM-DD. */
export function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
