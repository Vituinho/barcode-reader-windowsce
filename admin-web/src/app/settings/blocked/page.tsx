"use client";

import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "@/components/dialog";
import { Badge, Btn, EmptyState, ErrorBox, inputCls, Shell, Table, Td } from "@/components/ui";
import { api, errorMessage, fmtDateTime } from "@/lib/api";

interface BlockedBarcode {
  id: string;
  value: string;
  reason: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function BlockedBarcodesPage() {
  const [rows, setRows] = useState<BlockedBarcode[] | null>(null);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { confirm: ask, dialog } = useConfirm();

  const load = useCallback(async () => {
    try {
      setRows(await api<BlockedBarcode[]>("/api/admin/blocked-barcodes"));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(path: string, method: string, body: unknown) {
    try {
      await api(path, { method, body });
      setError(null);
      await load();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  }

  return (
    <Shell
      title="Códigos bloqueados"
      description="Leituras destes códigos (valor exato) aparecem como CÓDIGO BLOQUEADO no coletor, ficam registradas para auditoria e nunca entram no estoque."
    >
      <ErrorBox error={error} />
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await save("/api/admin/blocked-barcodes", "POST", { value: value.trim(), reason: reason.trim() || null })) {
            setValue("");
            setReason("");
          }
        }}
      >
        <input className={`${inputCls} w-80 font-mono`} placeholder="Código completo lido" value={value} onChange={(e) => setValue(e.target.value)} />
        <input className={`${inputCls} w-72`} placeholder="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Btn type="submit" disabled={!value.trim()}>Bloquear código</Btn>
      </form>
      {rows !== null && rows.length === 0 ? (
        <EmptyState title="Nenhum código bloqueado" description="Bloqueie aqui etiquetas que não devem ser coletadas." />
      ) : (
        <Table head={["Código", "Motivo", "Status", "Bloqueado em", "Atualizado", ""]}>
          {(rows ?? []).map((r) => (
            <tr key={r.id}>
              <Td mono>{r.value}</Td>
              <Td>{r.reason ?? <span className="text-slate-400">—</span>}</Td>
              <Td><Badge value={r.active ? "BLOCKED" : "INACTIVE"} label={r.active ? "BLOQUEADO" : "LIBERADO"} tone={r.active ? "danger" : "neutral"} /></Td>
              <Td>{fmtDateTime(r.createdAt)}</Td>
              <Td>{fmtDateTime(r.updatedAt)}</Td>
              <Td>
                {r.active ? (
                  <Btn variant="secondary" onClick={async () => {
                    const ok = await ask({ title: `Liberar o código ${r.value}?`, confirmLabel: "Liberar",
                      message: "Novas leituras deste código voltam a seguir as regras normais de coleta." });
                    if (ok.ok) void save(`/api/admin/blocked-barcodes/${r.id}`, "PATCH", { active: false });
                  }}>Liberar</Btn>
                ) : (
                  <Btn variant="danger" onClick={() => save(`/api/admin/blocked-barcodes/${r.id}`, "PATCH", { active: true })}>Bloquear de novo</Btn>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {dialog}
    </Shell>
  );
}
