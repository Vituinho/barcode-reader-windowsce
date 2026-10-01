"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Btn, ErrorBox, inputCls, Shell, Table, Td } from "@/components/ui";
import { api, errorMessage, fmtDateTime, query } from "@/lib/api";
import type { InventoryRow, Movement } from "@/lib/types";

const TYPE_LABEL: Record<string, string> = {
  SCAN_IN: "Entrada (leitura)",
  DISPATCH_OUT: "Saída (expedição)",
  ADJUSTMENT_IN: "Ajuste +",
  ADJUSTMENT_OUT: "Ajuste −",
};

export default function StockPage() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [q, setQ] = useState("");
  const [onlyInStock, setOnlyInStock] = useState(true);
  const [selected, setSelected] = useState<{ code: string; description: string; quantity: number; movements: Movement[] } | null>(null);
  const [adj, setAdj] = useState({ quantity: "", reason: "" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await api<InventoryRow[]>(`/api/inventory${query({ q, inStock: onlyInStock ? "true" : undefined })}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [q, onlyInStock]);

  useEffect(() => {
    load();
  }, [load]);

  async function openHistory(code: string) {
    try {
      const h = await api<{ productCode: string; description: string; quantity: number; movements: Movement[] }>(
        `/api/inventory/${encodeURIComponent(code)}/movements`,
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
      setError("Quantidade do ajuste deve ser um inteiro diferente de zero (use negativo para retirar).");
      return;
    }
    try {
      await api("/api/inventory/adjustments", {
        method: "POST",
        body: { productCode: selected.code, quantity, reason: adj.reason },
      });
      await openHistory(selected.code);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const total = rows.reduce((s, r) => s + r.quantity, 0);

  return (
    <Shell title="Estoque">
      <ErrorBox error={error} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input className={`${inputCls} w-72`} placeholder="Código ou descrição" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={onlyInStock} onChange={(e) => setOnlyInStock(e.target.checked)} /> Somente com estoque
        </label>
        <span className="text-sm text-slate-600">{rows.length} produtos · <b>{total}</b> volumes</span>
      </div>

      {selected && (
        <div className="mb-4 rounded border border-slate-300 bg-white p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">
              <span className="font-mono">{selected.code}</span> · {selected.description} · estoque <b>{selected.quantity}</b>
            </h2>
            <Btn variant="secondary" onClick={() => setSelected(null)}>Fechar</Btn>
          </div>
          <div className="my-3 flex flex-wrap items-end gap-2 rounded bg-slate-50 p-2 text-sm">
            <span className="font-medium">Ajuste manual (ADMIN):</span>
            <input className={`${inputCls} w-28`} placeholder="+5 / -2" value={adj.quantity} onChange={(e) => setAdj({ ...adj, quantity: e.target.value })} />
            <input className={`${inputCls} w-72`} placeholder="Motivo (obrigatório)" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} />
            <Btn onClick={adjust} disabled={adj.reason.trim().length < 3 || !adj.quantity}>Registrar ajuste</Btn>
          </div>
          <Table head={["Data", "Tipo", "Qtd", "Usuário", "Coletor", "Motivo / origem"]}>
            {selected.movements.map((m) => (
              <tr key={m.id}>
                <Td>{fmtDateTime(m.createdAt)}</Td>
                <Td><Badge value={m.type} /> <span className="text-xs text-slate-500">{TYPE_LABEL[m.type]}</span></Td>
                <Td><b className={m.quantity < 0 ? "text-red-700" : "text-green-700"}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</b></Td>
                <Td>{m.createdByName ?? "—"}</Td>
                <Td mono>{m.deviceId ?? "—"}</Td>
                <Td>{m.reason ?? (m.loadId ? <a className="underline" href={`/cargas/${m.loadId}`}>carga</a> : m.scanId ? "leitura" : "—")}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      <Table head={["Código", "Produto", "Unidade", "Estoque atual", "Última entrada", "Última saída", ""]}>
        {rows.map((r) => (
          <tr key={r.productCode}>
            <Td mono>{r.productCode}</Td>
            <Td>{r.description}</Td>
            <Td>{r.unit ?? "—"}</Td>
            <Td><span className="text-lg font-semibold">{r.quantity}</span></Td>
            <Td>{fmtDateTime(r.lastInAt)}</Td>
            <Td>{fmtDateTime(r.lastOutAt)}</Td>
            <Td><Btn variant="secondary" onClick={() => openHistory(r.productCode)}>Movimentações</Btn></Td>
          </tr>
        ))}
      </Table>
    </Shell>
  );
}
