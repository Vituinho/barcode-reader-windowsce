"use client";

import { ArrowRight, PackageCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, EmptyState, ErrorBox, Loading, Shell, Table, Td } from "@/components/ui";
import { api, errorMessage, fmtDateTime } from "@/lib/api";
import type { DispatchRow } from "@/lib/types";

const isToday = (iso: string | null) => !!iso && new Date(iso).toDateString() === new Date().toDateString();

export default function DispatchesPage() {
  const [rows, setRows] = useState<DispatchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<DispatchRow[]>("/api/dispatches").then(setRows).catch((e) => setError(errorMessage(e)));
  }, []);

  const today = (rows ?? []).filter((d) => isToday(d.dispatchedAt));

  return (
    <Shell title="Expedições" description="Histórico de cargas expedidas, mais recentes primeiro. Cada expedição retirou do estoque os volumes da carga.">
      <ErrorBox error={error} />
      {rows === null ? (
        !error && <Loading />
      ) : (
        <>
          {rows.length > 0 && (
            <p className="mb-3 text-sm text-slate-600">
              <b className="text-slate-900">{today.length}</b> {today.length === 1 ? "carga expedida" : "cargas expedidas"} hoje ·{" "}
              <b className="text-slate-900">{today.reduce((s, d) => s + d.volumes, 0)}</b> volumes
            </p>
          )}
          <Table
            head={["Carga", "Data/hora", "Responsável", { label: "Volumes", align: "right" }, { label: "Produtos", align: "right" }, "Status", ""]}
            minWidth={720}
            empty={<EmptyState icon={PackageCheck} title="Nenhuma carga expedida ainda" />}
          >
            {rows.map((d) => (
              <tr key={d.loadId} className={isToday(d.dispatchedAt) ? "bg-orange-50/40" : ""}>
                <Td mono><Link href={`/cargas/${d.loadId}`} className="font-bold hover:underline">{d.externalCode}</Link></Td>
                <Td className="whitespace-nowrap">
                  {fmtDateTime(d.dispatchedAt)}
                  {isToday(d.dispatchedAt) && <span className="ml-2 rounded bg-orange-100 px-1.5 py-0.5 text-[11px] font-bold text-orange-800">HOJE</span>}
                </Td>
                <Td>{d.dispatchedByName ?? "—"}</Td>
                <Td align="right"><b>{d.volumes}</b></Td>
                <Td align="right">{d.productLines}</Td>
                <Td><Badge value="DISPATCHED" /></Td>
                <Td>
                  <Link href={`/cargas/${d.loadId}`} className="inline-flex items-center gap-1 text-sm font-semibold text-orange-700 hover:underline">
                    Detalhes <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                </Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Shell>
  );
}
