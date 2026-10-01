"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorBox, Shell, Table, Td } from "@/components/ui";
import { api, errorMessage, fmtDateTime } from "@/lib/api";
import type { DispatchRow } from "@/lib/types";

export default function DispatchesPage() {
  const [rows, setRows] = useState<DispatchRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<DispatchRow[]>("/api/dispatches").then(setRows).catch((e) => setError(errorMessage(e)));
  }, []);

  return (
    <Shell title="Expedições">
      <ErrorBox error={error} />
      <Table head={["Carga", "Data/hora", "Usuário", "Volumes retirados", "Produtos", ""]}>
        {rows.map((d) => (
          <tr key={d.loadId}>
            <Td mono>{d.externalCode}</Td>
            <Td>{fmtDateTime(d.dispatchedAt)}</Td>
            <Td>{d.dispatchedByName ?? "—"}</Td>
            <Td><b>{d.volumes}</b></Td>
            <Td>{d.productLines}</Td>
            <Td><Link className="underline" href={`/cargas/${d.loadId}`}>Detalhes</Link></Td>
          </tr>
        ))}
      </Table>
      {rows.length === 0 && !error && <p className="mt-3 text-sm text-slate-500">Nenhuma carga expedida ainda.</p>}
    </Shell>
  );
}
