import { AlertCircle, CheckCircle2, PackageCheck, Truck } from "lucide-react";
import type { LoadSummary } from "@/lib/types";

export type LoadState = "READY" | "PENDING" | "DISPATCHED" | "REVIEW";

export function loadState(load: Pick<LoadSummary, "status" | "needsReview">): LoadState {
  if (load.status === "DISPATCHED") return "DISPATCHED";
  if (load.needsReview) return "REVIEW";
  return load.status;
}

const STATE: Record<LoadState, { label: string; cls: string; bar: string; Icon: typeof Truck }> = {
  READY: { label: "PRONTA", cls: "bg-green-700 text-white", bar: "bg-green-600", Icon: CheckCircle2 },
  PENDING: { label: "PENDENTE", cls: "bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300", bar: "bg-amber-500", Icon: Truck },
  REVIEW: { label: "REVISAR QUANTIDADES", cls: "bg-purple-100 text-purple-900 ring-1 ring-inset ring-purple-300", bar: "bg-purple-500", Icon: AlertCircle },
  DISPATCHED: { label: "EXPEDIDA", cls: "bg-slate-200 text-slate-700", bar: "bg-slate-400", Icon: PackageCheck },
};

/** Status chip used for loads everywhere (icon + text, never color alone). */
export function LoadStatusChip({ state, large }: { state: LoadState; large?: boolean }) {
  const s = STATE[state];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-bold ${large ? "px-3 py-1.5 text-sm" : "px-2 py-0.5 text-[11px]"} ${s.cls}`}>
      <s.Icon className={large ? "size-4" : "size-3.5"} aria-hidden />
      {s.label}
    </span>
  );
}

export function ProgressBar({ value, state }: { value: number; state: LoadState }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Progresso da carga"
    >
      <div className={`h-full rounded-full ${STATE[state].bar}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** One-line summary of what is missing, in the operator's language. */
export function shortageText(load: LoadSummary): string {
  const state = loadState(load);
  if (state === "DISPATCHED") return "Expedida";
  if (state === "REVIEW") return "Quantidade a definir em itens não unitários";
  if (state === "READY") return "Pronta para expedição";
  return `Faltam ${load.missingVolumes} ${load.missingVolumes === 1 ? "volume" : "volumes"}`;
}
