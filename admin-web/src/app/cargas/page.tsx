"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LoadStatusBlock, ProgressBar } from "@/components/loads";
import { ErrorBox, inputCls, Shell } from "@/components/ui";
import { api, errorMessage, fmtDateTime, query } from "@/lib/api";
import type { LoadSummary } from "@/lib/types";

const FILTERS = [
  ["", "Abertas e expedidas"],
  ["READY", "Prontas"],
  ["PENDING", "Pendentes"],
  ["REVIEW", "Revisar quantidades"],
  ["DISPATCHED", "Expedidas"],
] as const;

export default function LoadsPage() {
  const [loads, setLoads] = useState<LoadSummary[]>([]);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Deep link from the dashboard, e.g. /cargas?status=PENDING
    const initial = new URLSearchParams(window.location.search).get("status");
    if (initial) setStatus(initial);
  }, []);

  const load = useCallback(async () => {
    try {
      setLoads(await api<LoadSummary[]>(`/api/loads${query({ status, q })}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [status, q]);

  useEffect(() => {
    load();
    // Stock changes with every scan: keep readiness fresh.
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const ready = loads.filter((l) => l.status === "READY").length;

  return (
    <Shell title="Cargas">
      <ErrorBox error={error} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className={`${inputCls} w-64`} placeholder="Carga, cliente, pedido, NF, cidade" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
          {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="text-sm text-slate-600">{loads.length} cargas · {ready} prontas</span>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        O estoque é compartilhado e não é reservado: várias cargas podem aparecer prontas ao mesmo tempo. Ao expedir uma,
        as demais são recalculadas.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {loads.map((l) => (
          <Link key={l.id} href={`/cargas/${l.id}`} className="block rounded border border-slate-200 bg-white p-4 hover:border-slate-400">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-2xl font-bold">{l.externalCode}</span>
              <span className="text-xs text-slate-500">{l.invoiceCount} NF · {l.customerCount} clientes</span>
            </div>
            <div className="mt-2 text-lg font-semibold">
              {l.availableVolumes} / {l.requiredVolumes} <span className="text-sm font-normal text-slate-500">volumes</span>
            </div>
            <div className="my-2"><ProgressBar value={l.progress} status={l.status} /></div>
            <LoadStatusBlock load={l} />
            <div className="mt-2 text-xs text-slate-500">
              {l.status === "DISPATCHED" ? `Expedida ${fmtDateTime(l.dispatchedAt)}` : `Importada ${fmtDateTime(l.importedAt)}`}
              {l.warningInvoices > 0 && <span className="ml-2 text-purple-700">⚠ {l.warningInvoices} NF com aviso</span>}
            </div>
          </Link>
        ))}
      </div>
      {loads.length === 0 && <p className="text-sm text-slate-500">Nenhuma carga. Importe os XML em Importar XML.</p>}
    </Shell>
  );
}
