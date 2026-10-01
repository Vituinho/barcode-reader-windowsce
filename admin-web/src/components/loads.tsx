import type { LoadSummary } from "@/lib/types";

/** Large, unambiguous status for warehouse staff. READY is computed from current stock by the API. */
export function LoadStatusBlock({ load }: { load: LoadSummary }) {
  if (load.status === "DISPATCHED") {
    return <div className="rounded bg-slate-200 px-3 py-2 text-center text-sm font-bold text-slate-700">EXPEDIDA</div>;
  }
  if (load.needsReview) {
    return (
      <div className="rounded bg-purple-100 px-3 py-2 text-center text-sm font-bold text-purple-800">
        REVISAR QUANTIDADES
      </div>
    );
  }
  if (load.status === "READY") {
    return (
      <div className="rounded bg-green-600 px-3 py-2 text-center text-sm font-bold text-white">PRONTO PARA EXPEDIÇÃO</div>
    );
  }
  return (
    <div className="rounded bg-amber-100 px-3 py-2 text-center text-sm font-bold text-amber-900">
      FALTAM {load.missingVolumes}
    </div>
  );
}

export function ProgressBar({ value, status }: { value: number; status: string }) {
  const color = status === "READY" ? "bg-green-600" : status === "DISPATCHED" ? "bg-slate-500" : "bg-amber-500";
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-slate-200">
      <div className={`h-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
