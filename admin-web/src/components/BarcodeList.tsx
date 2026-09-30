"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Btn, ErrorBox, inputCls, Shell, Table, Td } from "@/components/ui";
import { api, errorMessage, fmtDateTime, query } from "@/lib/api";
import type { Barcode, Item } from "@/lib/types";

/** Barcode registry. Assigning an item to an UNKNOWN code makes its past scans resolve to that item. */
export function BarcodeList({ onlyUnknown }: { onlyUnknown: boolean }) {
  const [codes, setCodes] = useState<Barcode[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState(onlyUnknown ? "UNKNOWN" : "");
  const [q, setQ] = useState("");
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, i] = await Promise.all([
        api<Barcode[]>(`/api/admin/barcodes${query({ status, q })}`),
        api<Item[]>("/api/admin/items"),
      ]);
      setCodes(c);
      setItems(i.filter((x) => x.isActive));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [status, q]);

  useEffect(() => {
    load();
  }, [load]);

  async function assign(code: Barcode, itemId: string | null) {
    try {
      await api(`/api/admin/barcodes/${code.id}/assign`, { method: "POST", body: { itemId } });
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Shell title={onlyUnknown ? "Códigos desconhecidos" : "Códigos de barras"}>
      <ErrorBox error={error} />
      <div className="mb-3 flex flex-wrap gap-2">
        {!onlyUnknown && (
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option>
            <option value="KNOWN">KNOWN</option>
            <option value="UNKNOWN">UNKNOWN</option>
          </select>
        )}
        <input className={`${inputCls} w-72`} placeholder="Código contém" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Table head={["Código", "Status", "Item", "Leituras", "Primeira leitura", "Última leitura", "Associar item"]}>
        {codes.map((c) => (
          <tr key={c.id}>
            <Td mono>{c.code}</Td>
            <Td><Badge value={c.status} /></Td>
            <Td>{c.itemName ?? "—"}</Td>
            <Td>{c.scanCount}</Td>
            <Td>{fmtDateTime(c.firstSeenAt)}</Td>
            <Td>{fmtDateTime(c.lastSeenAt)}</Td>
            <Td>
              <div className="flex gap-1">
                <select
                  className={inputCls}
                  value={selection[c.id] ?? c.itemId ?? ""}
                  onChange={(e) => setSelection({ ...selection, [c.id]: e.target.value })}
                >
                  <option value="">— nenhum —</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <Btn variant="secondary" onClick={() => assign(c, (selection[c.id] ?? c.itemId) || null)}>Salvar</Btn>
              </div>
            </Td>
          </tr>
        ))}
      </Table>
    </Shell>
  );
}
