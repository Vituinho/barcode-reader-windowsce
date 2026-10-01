"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorBox, inputCls, Shell, Table, Td } from "@/components/ui";
import { api, errorMessage, fmtDateTime, query } from "@/lib/api";
import type { UnknownCode } from "@/lib/types";

/** Readings whose first 10 characters match no product (cProd). They were stored but add no stock. */
export default function UnknownCodesPage() {
  const [codes, setCodes] = useState<UnknownCode[]>([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCodes(await api<UnknownCode[]>(`/api/admin/unknown-codes${query({ q })}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [q]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Shell title="Códigos desconhecidos">
      <ErrorBox error={error} />
      <p className="mb-3 text-sm text-slate-600">
        Leituras cujos 10 primeiros caracteres não correspondem a nenhum produto (cProd) das NF-e importadas. Ficam
        registradas, mas não entram no estoque. Ao importar um XML com o produto, o código sai desta lista.
      </p>
      <input className={`${inputCls} mb-3 w-72`} placeholder="Código contém" value={q} onChange={(e) => setQ(e.target.value)} />
      <Table head={["Código (10 primeiros)", "Leitura completa (última)", "Ocorrências", "Primeira", "Última", "Coletor", "Operador"]}>
        {codes.map((c) => (
          <tr key={c.productCode}>
            <Td mono><b>{c.productCode}</b></Td>
            <Td mono>{c.lastRawBarcode?.replace(/[\r\n\t]+$/, "")}</Td>
            <Td>{c.occurrences}</Td>
            <Td>{fmtDateTime(c.firstSeenAt)}</Td>
            <Td>{fmtDateTime(c.lastSeenAt)}</Td>
            <Td mono>{c.lastDeviceId ?? "—"}</Td>
            <Td>{c.lastOperatorName ?? "—"}</Td>
          </tr>
        ))}
      </Table>
      {codes.length === 0 && !error && <p className="mt-3 text-sm text-slate-500">Nenhum código desconhecido.</p>}
    </Shell>
  );
}
