"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Btn, ErrorBox, inputCls, Shell, Table, Td } from "@/components/ui";
import { api, downloadFile, errorMessage, fmtDateTime, query } from "@/lib/api";
import type { Device, Scan, Session, User } from "@/lib/types";

const PAGE = 100;
const EMPTY = { deviceId: "", operatorId: "", sessionId: "", syncState: "", barcode: "", dateFrom: "", dateTo: "" };

export default function ScansPage() {
  const [filters, setFilters] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ total: number; items: Scan[] }>({ total: 0, items: [] });
  const [devices, setDevices] = useState<Device[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Deep link from the dashboard: /scans?syncState=CONFLICT
    const state = new URLSearchParams(window.location.search).get("syncState");
    if (state) {
      setFilters((f) => ({ ...f, syncState: state }));
      setApplied((f) => ({ ...f, syncState: state }));
    }
    Promise.all([api<Device[]>("/api/admin/devices"), api<User[]>("/api/admin/users"), api<Session[]>("/api/admin/sessions")])
      .then(([d, u, s]) => {
        setDevices(d);
        setUsers(u);
        setSessions(s);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const load = useCallback(async () => {
    try {
      setPage(await api(`/api/admin/scans${query({ ...applied, limit: PAGE, offset })}`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [applied, offset]);

  useEffect(() => {
    load();
  }, [load]);

  async function resolve(scan: Scan, action: "ACCEPT" | "REJECT") {
    const note = window.prompt(action === "ACCEPT" ? "Observação (aceitar leitura):" : "Motivo da rejeição:") ?? undefined;
    try {
      await api(`/api/admin/scans/${scan.id}/resolve`, { method: "POST", body: { action, note } });
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setFilters({ ...filters, [k]: e.target.value });

  return (
    <Shell
      title="Leituras"
      actions={
        <Btn variant="secondary" onClick={() => downloadFile(`/api/admin/scans/export.csv${query(applied)}`, "leituras.csv").catch((e) => setError(errorMessage(e)))}>
          Exportar CSV
        </Btn>
      }
    >
      <ErrorBox error={error} />
      <form
        className="mb-4 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setOffset(0);
          setApplied(filters);
        }}
      >
        <select className={inputCls} value={filters.deviceId} onChange={set("deviceId")}>
          <option value="">Todos coletores</option>
          {devices.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}
        </select>
        <select className={inputCls} value={filters.operatorId} onChange={set("operatorId")}>
          <option value="">Todos operadores</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
        </select>
        <select className={inputCls} value={filters.sessionId} onChange={set("sessionId")}>
          <option value="">Todas sessões</option>
          {sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className={inputCls} value={filters.syncState} onChange={set("syncState")}>
          <option value="">Todos estados</option>
          <option value="ACCEPTED">ACCEPTED</option>
          <option value="DUPLICATE">DUPLICATE</option>
          <option value="CONFLICT">CONFLITOS (sessão fechada/inexistente)</option>
          <option value="REJECTED">REJECTED</option>
        </select>
        <input className={inputCls} placeholder="Código contém" value={filters.barcode} onChange={set("barcode")} />
        <input className={inputCls} type="datetime-local" value={filters.dateFrom} onChange={set("dateFrom")} title="Recebido a partir de" />
        <input className={inputCls} type="datetime-local" value={filters.dateTo} onChange={set("dateTo")} title="Recebido até" />
        <Btn type="submit">Filtrar</Btn>
        <Btn variant="secondary" onClick={() => { setFilters(EMPTY); setApplied(EMPTY); setOffset(0); }}>Limpar</Btn>
      </form>

      <Table head={["Lido no coletor", "Recebido", "Código", "Item", "Resultado", "Estado", "Coletor", "Operador", "Sessão", ""]}>
        {page.items.map((s) => (
          <tr key={s.id}>
            <Td>{fmtDateTime(s.scannedAtDevice)}</Td>
            <Td>{fmtDateTime(s.receivedAtServer)}</Td>
            <Td mono>{s.barcode}</Td>
            <Td>{s.itemName ?? <span className="text-slate-400">—</span>}</Td>
            <Td><Badge value={s.result} /></Td>
            <Td><Badge value={s.syncState} /></Td>
            <Td mono>{s.deviceId}</Td>
            <Td>{s.operatorName ?? "—"}</Td>
            <Td>{s.sessionName ?? s.requestedSessionId ?? "—"}</Td>
            <Td>
              {(s.syncState === "SESSION_CLOSED" || s.syncState === "SESSION_NOT_FOUND") && (
                <div className="flex gap-1">
                  <Btn variant="secondary" onClick={() => resolve(s, "ACCEPT")}>Aceitar</Btn>
                  <Btn variant="danger" onClick={() => resolve(s, "REJECT")}>Rejeitar</Btn>
                </div>
              )}
              {s.resolutionNote && <div className="text-xs text-slate-500">{s.resolutionNote}</div>}
            </Td>
          </tr>
        ))}
      </Table>
      <div className="mt-3 flex items-center gap-2 text-sm">
        <span>{page.total} leituras</span>
        <Btn variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Anterior</Btn>
        <Btn variant="secondary" disabled={offset + PAGE >= page.total} onClick={() => setOffset(offset + PAGE)}>Próxima</Btn>
      </div>
    </Shell>
  );
}
