"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Btn, ErrorBox, inputCls, Shell, Table, Td } from "@/components/ui";
import { api, errorMessage, query } from "@/lib/api";
import type { Item } from "@/lib/types";

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ sku: "", name: "", barcodes: "" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (search: string) => {
    try {
      setItems(await api<Item[]>(`/api/admin/items${query({ q: search })}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  async function create() {
    try {
      await api("/api/admin/items", {
        method: "POST",
        body: {
          sku: form.sku || null,
          name: form.name,
          // One barcode per line or comma; values are kept exactly (leading zeroes preserved).
          barcodes: form.barcodes.split(/[\n,]/).map((b) => b.trim()).filter(Boolean),
        },
      });
      setForm({ sku: "", name: "", barcodes: "" });
      setError(null);
      load(q);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function toggle(item: Item) {
    try {
      await api(`/api/admin/items/${item.id}`, { method: "PATCH", body: { isActive: !item.isActive } });
      load(q);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Shell title="Itens / produtos" description="Produtos identificados pelo código (cProd). Criados automaticamente pela importação de NF-e ou cadastrados aqui.">
      <ErrorBox error={error} />
      <div className="mb-4 flex flex-wrap items-start gap-2 rounded border border-slate-200 bg-white p-3">
        <input className={inputCls} placeholder="SKU (opcional)" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
        <input className={`${inputCls} w-72`} placeholder="Nome do item" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <textarea className={`${inputCls} h-auto w-72 py-2`} rows={2} placeholder="Códigos de barras (um por linha)" value={form.barcodes} onChange={(e) => setForm({ ...form, barcodes: e.target.value })} />
        <Btn onClick={create} disabled={!form.name.trim()}>Cadastrar item</Btn>
      </div>
      <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); load(q); }}>
        <input className={`${inputCls} w-72`} placeholder="Buscar por nome ou SKU" value={q} onChange={(e) => setQ(e.target.value)} />
        <Btn type="submit" variant="secondary">Buscar</Btn>
      </form>
      <Table head={["Item", "SKU", "Códigos", "Status", ""]}>
        {items.map((i) => (
          <tr key={i.id}>
            <Td>{i.name}</Td>
            <Td mono>{i.sku ?? "—"}</Td>
            <Td mono>{i.barcodes.join(", ") || "—"}</Td>
            <Td><Badge value={i.isActive ? "ACTIVE" : "DISABLED"} /></Td>
            <Td><Btn variant="secondary" onClick={() => toggle(i)}>{i.isActive ? "Desativar" : "Ativar"}</Btn></Td>
          </tr>
        ))}
      </Table>
    </Shell>
  );
}
