"use client";

import { ArrowRight, Truck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConfirm } from "@/components/dialog";
import { LoadStatusChip, loadState, ProgressBar, shortageText, type LoadState } from "@/components/loads";
import { Btn, EmptyState, ErrorBox, Loading, SearchInput, Shell, useCurrentUser } from "@/components/ui";
import { api, errorMessage, fmtDateTime, query } from "@/lib/api";
import type { LoadSummary } from "@/lib/types";

const FILTERS: { value: "" | LoadState; label: string }[] = [
  { value: "", label: "Todas" },
  { value: "READY", label: "Prontas" },
  { value: "PENDING", label: "Pendentes" },
  { value: "REVIEW", label: "Revisar" },
  { value: "DISPATCHED", label: "Expedidas" },
];

const ORDER: Record<LoadState, number> = { READY: 0, PENDING: 1, REVIEW: 2, DISPATCHED: 3 };

export default function LoadsPage() {
  const user = useCurrentUser();
  const { confirm, dialog } = useConfirm();
  const [loads, setLoads] = useState<LoadSummary[] | null>(null);
  const [status, setStatus] = useState<"" | LoadState>("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("status");
    if (initial && FILTERS.some((f) => f.value === initial)) setStatus(initial as LoadState);
  }, []);

  const load = useCallback(async () => {
    try {
      setLoads(await api<LoadSummary[]>(`/api/loads${query({ q })}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce typing
    const i = setInterval(load, 15000); // stock changes with every scan
    return () => {
      clearTimeout(t);
      clearInterval(i);
    };
  }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { "": loads?.length ?? 0 };
    for (const l of loads ?? []) c[loadState(l)] = (c[loadState(l)] ?? 0) + 1;
    return c;
  }, [loads]);

  const visible = useMemo(
    () => (loads ?? [])
      .filter((l) => !status || loadState(l) === status)
      .sort((a, b) => ORDER[loadState(a)] - ORDER[loadState(b)] || b.progress - a.progress || a.externalCode.localeCompare(b.externalCode)),
    [loads, status],
  );

  async function dispatch(l: LoadSummary) {
    const r = await confirm({
      title: `Expedir carga ${l.externalCode}?`,
      message: <>Os <b>{l.requiredVolumes} volumes</b> necessários serão retirados do estoque. O servidor confere o estoque novamente antes de expedir.</>,
      confirmLabel: "Expedir carga",
    });
    if (!r.ok) return;
    setBusy(l.id);
    try {
      await api(`/api/loads/${l.id}/dispatch`, { method: "POST" });
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      await load(); // readiness of every other load changes after a dispatch
    }
  }

  return (
    <Shell title="Cargas" description="Estoque é compartilhado e não é reservado: várias cargas podem estar prontas ao mesmo tempo. Ao expedir uma, as demais são recalculadas.">
      <ErrorBox error={error} />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar carga, cliente, pedido, NF ou cidade..." className="md:w-96" />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por status">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatus(f.value)}
              aria-pressed={status === f.value}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium ${
                status === f.value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {f.label}
              <span className={`rounded px-1 text-xs tabular-nums ${status === f.value ? "bg-white/20" : "bg-slate-100 text-slate-500"}`}>{counts[f.value] ?? 0}</span>
            </button>
          ))}
        </div>
      </div>

      {loads === null ? (
        !error && <Loading />
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white">
          <EmptyState icon={Truck} title="Nenhuma carga encontrada"
                      description={loads.length ? "Ajuste a busca ou o filtro." : "Importe os XML das NF-e em Importar XML para criar as cargas."} />
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {visible.map((l) => {
            const state = loadState(l);
            return (
              <li key={l.id} className={`flex flex-col rounded-lg border bg-white p-4 ${state === "READY" ? "border-green-300" : "border-slate-200"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/cargas/${l.id}`} className="font-mono text-xl font-bold text-slate-950 hover:underline">{l.externalCode}</Link>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {l.invoiceCount} NF-e · {l.customerCount} {l.customerCount === 1 ? "cliente" : "clientes"} · {l.productLines} produtos
                    </div>
                  </div>
                  <LoadStatusChip state={state} />
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <ProgressBar value={l.progress} state={state} />
                  <span className="w-10 text-right text-sm font-semibold tabular-nums text-slate-700">{l.progress}%</span>
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2 text-sm">
                  <span className="tabular-nums">
                    <b className="text-base">{l.availableVolumes}</b>
                    <span className="text-slate-500"> / {l.requiredVolumes} volumes</span>
                  </span>
                  <span className={`text-right text-xs font-semibold ${state === "PENDING" ? "text-amber-800" : state === "REVIEW" ? "text-purple-800" : state === "READY" ? "text-green-800" : "text-slate-500"}`}>
                    {shortageText(l)}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
                  <span className="mr-auto text-xs text-slate-500">
                    {state === "DISPATCHED" ? `Expedida ${fmtDateTime(l.dispatchedAt)}` : `Importada ${fmtDateTime(l.importedAt)}`}
                  </span>
                  <Link href={`/cargas/${l.id}`} className="inline-flex h-9 items-center gap-1 rounded-md px-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                    Ver carga <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                  {state === "READY" && user?.role === "ADMIN" && (
                    <Btn size="sm" onClick={() => void dispatch(l)} disabled={busy === l.id}>{busy === l.id ? "Expedindo..." : "Expedir"}</Btn>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {dialog}
    </Shell>
  );
}
