"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Btn, ErrorBox, inputCls, Shell, Table, Td } from "@/components/ui";
import { api, errorMessage, fmtDateTime } from "@/lib/api";
import type { Session } from "@/lib/types";

const TYPES = ["GENERAL", "RECEIVING", "LOADING", "SHIPPING", "INVENTORY"];

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState("RECEIVING");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSessions(await api<Session[]>("/api/admin/sessions"));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(path: string, body?: unknown) {
    try {
      await api(path, { method: "POST", body: body ?? {} });
      setError(null);
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Shell title="Sessões de coleta">
      <ErrorBox error={error} />
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run("/api/admin/sessions", { name, sessionType: type }).then(() => setName(""));
        }}
      >
        <input className={`${inputCls} w-72`} placeholder="Ex.: CARGA 58342" value={name} onChange={(e) => setName(e.target.value)} />
        <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <Btn type="submit" disabled={!name.trim()}>Abrir sessão</Btn>
      </form>
      <Table head={["Sessão", "Tipo", "Status", "Leituras", "Conflitos", "Criada", "Fechada", ""]}>
        {sessions.map((s) => (
          <tr key={s.id}>
            <Td>{s.name}</Td>
            <Td>{s.sessionType}</Td>
            <Td><Badge value={s.status} /></Td>
            <Td>{s.scanCount}</Td>
            <Td>{s.conflictCount > 0 ? <span className="font-semibold text-purple-700">{s.conflictCount}</span> : 0}</Td>
            <Td>{fmtDateTime(s.createdAt)}</Td>
            <Td>{fmtDateTime(s.closedAt)}</Td>
            <Td>
              <div className="flex flex-wrap gap-1">
                {s.status === "OPEN" ? (
                  <Btn variant="secondary" onClick={() => confirm(`Fechar a sessão ${s.name}?`) && run(`/api/admin/sessions/${s.id}/close`)}>Fechar</Btn>
                ) : (
                  <Btn variant="secondary" onClick={() => run(`/api/admin/sessions/${s.id}/reopen`)}>Reabrir</Btn>
                )}
                {s.conflictCount > 0 && (
                  <>
                    <Btn variant="secondary" onClick={() => run(`/api/admin/sessions/${s.id}/resolve-conflicts`, { action: "ACCEPT", note: "aceito em lote" })}>Aceitar conflitos</Btn>
                    <Btn variant="danger" onClick={() => confirm("Rejeitar todas as leituras em conflito?") && run(`/api/admin/sessions/${s.id}/resolve-conflicts`, { action: "REJECT", note: "rejeitado em lote" })}>Rejeitar conflitos</Btn>
                  </>
                )}
              </div>
            </Td>
          </tr>
        ))}
      </Table>
    </Shell>
  );
}
