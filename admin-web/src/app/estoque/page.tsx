"use client";

import { Boxes, History, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge, Btn, EmptyState, ErrorBox, inputCls, Loading, SearchInput, Shell, Table, Td, useCurrentUser } from "@/components/ui";
import { api, errorMessage, fmtDateTime, query } from "@/lib/api";
import { formatProgrammingDate } from "@/lib/programming";
import type { InventoryRow, Movement, Programming } from "@/lib/types";

interface MovementHistory {
  code: string;
  description: string;
  quantity: number;
  movements: Movement[];
}

const nf = new Intl.NumberFormat("pt-BR");

export default function StockPage() {
  const user = useCurrentUser();
  const admin = user?.role === "ADMIN";
  const [rows, setRows] = useState<InventoryRow[] | null>(null);
  const [q, setQ] = useState("");
  const [onlyInStock, setOnlyInStock] = useState(true);
  const [selected, setSelected] = useState<MovementHistory | null>(null);
  const [adj, setAdj] = useState({ quantity: "", reason: "" });
  const [error, setError] = useState<string | null>(null);
  const [programmings, setProgrammings] = useState<Programming[]>([]);
  const [programmingId, setProgrammingId] = useState("");

  useEffect(() => {
    api<Programming[]>("/api/programmings").then(setProgrammings).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    try {
      setRows(await api<InventoryRow[]>(`/api/inventory${query({ q, inStock: onlyInStock ? "true" : undefined, programmingId: programmingId || undefined })}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [q, onlyInStock, programmingId]);

  useEffect(() => setSelected(null), [programmingId]);
  const programmingName = (id: string) => {
    const p = programmings.find((x) => x.id === id);
    return p ? formatProgrammingDate(p.scheduledDate) + (p.name ? ` (${p.name})` : "") : "";
  };

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function openHistory(code: string) {
    try {
      const h = await api<{ productCode: string; description: string; quantity: number; movements: Movement[] }>(
        `/api/inventory/${encodeURIComponent(code)}/movements${query({ programmingId: programmingId || undefined })}`,
      );
      setSelected({ code: h.productCode, description: h.description, quantity: h.quantity, movements: h.movements });
      setAdj({ quantity: "", reason: "" });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function adjust() {
    if (!selected) return;
    const quantity = Number(adj.quantity);
    if (!Number.isInteger(quantity) || quantity === 0) {
      setError("Quantidade do ajuste deve ser um inteiro diferente de zero (negativo para retirar).");
      return;
    }
    try {
      await api("/api/inventory/adjustments", { method: "POST", body: { productCode: selected.code, quantity, reason: adj.reason, programmingId: programmingId || null } });
      await openHistory(selected.code);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const total = (rows ?? []).reduce((s, r) => s + r.quantity, 0);

  return (
    <Shell title="Estoque" description="Saldo de produção por produto. Entradas vêm das leituras; saídas, das expedições. Cada programação tem o seu estoque.">
      <ErrorBox error={error} />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar por código ou produto..." className="sm:w-[28rem]" />
        <select className={`${inputCls} sm:w-64`} value={programmingId} onChange={(e) => setProgrammingId(e.target.value)} aria-label="Programação">
          <option value="">Todas as programações</option>
          {programmings.map((p) => (
            <option key={p.id} value={p.id}>{programmingName(p.id)}{p.status === "CLOSED" ? " (encerrada)" : ""}</option>
          ))}
        </select>
        <label className="inline-flex h-10 items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="size-4 accent-orange-600" checked={onlyInStock} onChange={(e) => setOnlyInStock(e.target.checked)} />
          Somente com estoque
        </label>
        {rows && (
          <span className="text-sm text-slate-500 sm:ml-auto">
            {nf.format(rows.length)} produtos · <b className="text-slate-900">{nf.format(total)}</b> volumes
          </span>
        )}
      </div>

      {rows === null ? (
        !error && <Loading />
      ) : (
        <Table
          head={["Código", "Produto", "Unidade", { label: "Estoque", align: "right" }, "Última entrada", "Última saída", ""]}
          minWidth={820}
          empty={<EmptyState icon={Boxes} title="Nenhum produto encontrado" description={onlyInStock ? "Desmarque “Somente com estoque” para ver todo o catálogo." : undefined} />}
        >
          {rows.map((r) => (
            <tr key={r.productCode}>
              <Td mono>{r.productCode}</Td>
              <Td className="max-w-[28rem]">{r.description}</Td>
              <Td>{r.unit ?? "—"}</Td>
              <Td align="right"><span className={`text-base font-bold ${r.quantity === 0 ? "text-slate-400" : ""}`}>{nf.format(r.quantity)}</span></Td>
              <Td className="whitespace-nowrap text-slate-600">{fmtDateTime(r.lastInAt)}</Td>
              <Td className="whitespace-nowrap text-slate-600">{fmtDateTime(r.lastOutAt)}</Td>
              <Td>{admin && <Btn variant="ghost" size="sm" icon={History} onClick={() => void openHistory(r.productCode)}>Histórico</Btn>}</Td>
            </tr>
          ))}
        </Table>
      )}

      {selected && (
        <div className="fixed inset-0 z-30" role="dialog" aria-modal="true" aria-label={`Movimentações de ${selected.code}`}>
          <div className="absolute inset-0 bg-slate-950/40" onClick={() => setSelected(null)} />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col bg-white shadow-xl">
            <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-lg font-bold">{selected.code}</div>
                <div className="truncate text-sm text-slate-600">{selected.description}</div>
              </div>
              <div className="text-right">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Estoque</div>
                <div className="text-2xl font-bold tabular-nums">{nf.format(selected.quantity)}</div>
              </div>
              <button onClick={() => setSelected(null)} aria-label="Fechar" className="inline-flex size-10 items-center justify-center rounded-md hover:bg-slate-100">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <form
              className="flex flex-wrap items-end gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                void adjust();
              }}
            >
              <label className="text-xs font-medium text-slate-600">
                Ajuste
                <input className={`${inputCls} mt-1 block w-24`} inputMode="numeric" placeholder="+5 / -2" value={adj.quantity}
                       onChange={(e) => setAdj({ ...adj, quantity: e.target.value })} />
              </label>
              <label className="min-w-0 flex-1 text-xs font-medium text-slate-600">
                Motivo (obrigatório)
                <input className={`${inputCls} mt-1 block w-full`} value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} />
              </label>
              <Btn type="submit" disabled={adj.reason.trim().length < 3 || !adj.quantity}>Registrar</Btn>
              <p className="w-full text-xs text-slate-500">
                O ajuste vale para {programmingId ? <>a programação <b>{programmingName(programmingId)}</b></> : <>o estoque geral (sem programação); escolha uma programação acima para ajustar o estoque dela</>}.
              </p>
            </form>
            <ol className="flex-1 divide-y divide-slate-100 overflow-y-auto">
              {selected.movements.length === 0 && <li><EmptyState title="Sem movimentações" /></li>}
              {selected.movements.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <span className={`w-12 text-right text-base font-bold tabular-nums ${m.quantity < 0 ? "text-red-700" : "text-green-700"}`}>
                    {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                  </span>
                  <span className="min-w-0 flex-1">
                    <Badge value={m.type} />
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {fmtDateTime(m.createdAt)} · {m.createdByName ?? "—"}{m.deviceId ? ` · ${m.deviceId}` : ""}
                    </span>
                    {m.reason && <span className="block text-xs text-slate-700">{m.reason}</span>}
                  </span>
                  {m.loadId && <a href={`/cargas/${m.loadId}`} className="text-xs font-semibold text-orange-700 hover:underline">Carga</a>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Shell>
  );
}
