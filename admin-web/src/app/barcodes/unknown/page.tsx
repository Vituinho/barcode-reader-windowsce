"use client";

import { ScanSearch } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorBox, Loading, SearchInput, Shell, Table, Td } from "@/components/ui";
import { api, errorMessage, fmtDateTime, query } from "@/lib/api";
import type { UnknownCode } from "@/lib/types";

/** Readings whose first 10 characters match no product (cProd). Stored, but never added to stock. */
export default function UnknownCodesPage() {
  const [codes, setCodes] = useState<UnknownCode[] | null>(null);
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
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // Repeated unknown codes first: a code read 30 times matters more than one read once.
  const sorted = useMemo(
    () => [...(codes ?? [])].sort((a, b) => b.occurrences - a.occurrences || b.lastSeenAt.localeCompare(a.lastSeenAt)),
    [codes],
  );
  const max = sorted[0]?.occurrences ?? 1;

  return (
    <Shell title="Códigos desconhecidos" description="Leituras cujos 10 primeiros caracteres não correspondem a nenhum produto (cProd) das NF-e importadas. Não entram no estoque; ao importar a NF-e do produto, o código sai desta lista.">
      <ErrorBox error={error} />
      <SearchInput value={q} onChange={setQ} placeholder="Buscar código..." className="mb-4 sm:w-80" />
      {codes === null ? (
        !error && <Loading />
      ) : (
        <Table
          head={["Código normalizado", "Código bruto (última leitura)", { label: "Ocorrências", align: "right" }, "Primeira leitura", "Última leitura", "Dispositivo", "Operador"]}
          minWidth={900}
          empty={<EmptyState icon={ScanSearch} title="Nenhum código desconhecido" description="Todas as leituras correspondem a produtos importados." />}
        >
          {sorted.map((c) => {
            const hot = c.occurrences >= 5;
            return (
              <tr key={c.productCode} className={hot ? "bg-amber-50/60" : ""}>
                <Td mono><b className="text-[15px]">{c.productCode}</b></Td>
                <Td mono className="max-w-[16rem] break-all text-slate-600">{c.lastRawBarcode?.replace(/[\r\n\t]+$/, "")}</Td>
                <Td align="right">
                  <div className="flex items-center justify-end gap-2">
                    <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 sm:block" aria-hidden>
                      <span className={`block h-full ${hot ? "bg-amber-500" : "bg-slate-400"}`} style={{ width: `${(c.occurrences / max) * 100}%` }} />
                    </span>
                    <b className={hot ? "text-base text-amber-800" : ""}>{c.occurrences}×</b>
                  </div>
                </Td>
                <Td className="whitespace-nowrap text-slate-600">{fmtDateTime(c.firstSeenAt)}</Td>
                <Td className="whitespace-nowrap text-slate-600">{fmtDateTime(c.lastSeenAt)}</Td>
                <Td mono className="max-w-[12rem] truncate text-xs">{c.lastDeviceId ?? "—"}</Td>
                <Td>{c.lastOperatorName ?? "—"}</Td>
              </tr>
            );
          })}
        </Table>
      )}
    </Shell>
  );
}
