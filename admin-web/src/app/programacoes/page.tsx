"use client";

import { CalendarDays, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ProgressBar } from "@/components/loads";
import { Badge, EmptyState, ErrorBox, Loading, Shell, useCurrentUser } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatProgrammingDate, weekdayOf } from "@/lib/programming";
import type { Programming } from "@/lib/types";

const FILTERS = [
  { value: "OPEN", label: "Abertas" },
  { value: "CLOSED", label: "Encerradas" },
  { value: "", label: "Todas" },
];

export default function ProgrammingsPage() {
  const user = useCurrentUser();
  const [status, setStatus] = useState("OPEN");
  const [rows, setRows] = useState<Programming[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (s: string) => {
    try {
      setRows(await api<Programming[]>(`/api/programmings${s ? `?status=${s}` : ""}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    setRows(null);
    void load(status);
  }, [load, status]);

  return (
    <Shell
      title="Programações de cargas"
      description="Cada programação reúne as cargas de um dia de produção. O estoque coletado para ela vale para qualquer carga da mesma programação."
      actions={user?.role === "ADMIN" && (
        <Link href="/programacoes/nova" className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700">
          <Plus className="size-4" aria-hidden /> Nova programação
        </Link>
      )}
    >
      <ErrorBox error={error} />
      <div className="mb-4 inline-flex rounded-md border border-slate-300 bg-white p-0.5" role="tablist" aria-label="Filtrar programações">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={status === f.value}
            onClick={() => setStatus(f.value)}
            className={`h-8 rounded px-3 text-sm font-semibold ${status === f.value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {rows === null ? (
        !error && <Loading />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={status === "OPEN" ? "Nenhuma programação aberta" : "Nenhuma programação encontrada"}
          description={user?.role === "ADMIN" ? "Crie a programação do dia e importe o ZIP ou RAR com os XML das cargas." : "Peça ao administrador para abrir a programação do dia."}
        />
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white">
          {rows.map((p) => {
            const open = p.loadCount - p.dispatchedCount;
            return (
              <li key={p.id}>
                <Link
                  href={`/programacoes/${p.id}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-3 px-4 py-4 hover:bg-slate-50 lg:grid-cols-[13rem_minmax(0,1fr)_14rem_auto]"
                >
                  <span className="col-start-1 row-start-1 min-w-0">
                    <span className="block text-xl font-black tabular-nums tracking-tight text-slate-950">{formatProgrammingDate(p.scheduledDate)}</span>
                    <span className="block truncate text-sm text-slate-500">{p.name ?? weekdayOf(p.scheduledDate)}</span>
                  </span>
                  <span className="col-span-2 row-start-2 lg:col-span-1 lg:row-start-1 lg:col-start-2">
                    <span className="mb-1.5 flex justify-between text-xs text-slate-600">
                      <span><b className="text-slate-900">{p.coveredVolumes}</b> de {p.requiredVolumes} volumes cobertos</span>
                      <span className="font-semibold tabular-nums">{p.progress}%</span>
                    </span>
                    <ProgressBar value={p.progress} state={open > 0 && p.readyCount === open ? "READY" : "PENDING"} />
                  </span>
                  <span className="hidden text-sm text-slate-600 lg:block">
                    <b className={p.readyCount ? "text-green-700" : "text-slate-900"}>{p.readyCount}</b> prontas de {open} a expedir
                    {p.dispatchedCount > 0 && <span className="block text-xs text-slate-500">{p.dispatchedCount} já expedidas</span>}
                    {p.reviewCount > 0 && <span className="block text-xs text-purple-800">{p.reviewCount} para revisar</span>}
                  </span>
                  <span className="col-start-2 row-start-1 justify-self-end lg:col-start-4"><Badge value={p.status} /></span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Shell>
  );
}
