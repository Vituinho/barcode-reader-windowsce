"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Btn, ErrorBox, inputCls, Shell, Table, Td } from "@/components/ui";
import { api, errorMessage, fmtAge, fmtDateTime } from "@/lib/api";
import type { Device } from "@/lib/types";

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [form, setForm] = useState({ id: "", name: "" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDevices(await api<Device[]>("/api/admin/devices"));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  async function call(path: string, method: string, body: unknown) {
    try {
      await api(path, { method, body });
      setError(null);
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <Shell title="Coletores">
      <ErrorBox error={error} />
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          call("/api/admin/devices", "POST", form).then(() => setForm({ id: "", name: "" }));
        }}
      >
        <input className={inputCls} placeholder="ID (ex.: GVT-CE-002)" value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />
        <input className={inputCls} placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Btn type="submit" disabled={!form.id || !form.name}>Cadastrar coletor</Btn>
      </form>
      <Table head={["Coletor", "Nome", "Status", "Último contato", "Operador", "Pendentes", "Bateria", "Versão", "Relógio", "IP", ""]}>
        {devices.map((d) => (
          <tr key={d.id}>
            <Td mono>{d.id}</Td>
            <Td>{d.name}</Td>
            <Td><Badge value={d.connectivity} /></Td>
            <Td>
              {fmtDateTime(d.lastSeenAt)}
              <div className="text-xs text-slate-500">{fmtAge(d.lastSeenAgeSeconds)}</div>
            </Td>
            <Td>{d.lastOperatorName ?? "—"}</Td>
            <Td>{d.pendingScans ?? "—"}</Td>
            <Td>{d.batteryLevel !== null ? `${d.batteryLevel}%` : "—"}</Td>
            <Td>{d.appVersion ?? "—"}</Td>
            <Td>
              {d.clockSkewSeconds === null ? "—" : Math.abs(d.clockSkewSeconds) > 120 ? (
                <span className="text-amber-700">{d.clockSkewSeconds}s</span>
              ) : "ok"}
            </Td>
            <Td mono>{d.lastIp ?? "—"}</Td>
            <Td>
              {d.status === "ACTIVE" ? (
                <Btn variant="danger" onClick={() => confirm(`Desativar ${d.id}?`) && call(`/api/admin/devices/${d.id}`, "PATCH", { status: "DISABLED" })}>Desativar</Btn>
              ) : (
                <Btn variant="secondary" onClick={() => call(`/api/admin/devices/${d.id}`, "PATCH", { status: "ACTIVE" })}>Ativar</Btn>
              )}
            </Td>
          </tr>
        ))}
      </Table>
      <p className="mt-2 text-xs text-slate-500">
        Status baseado no último heartbeat/leitura recebido. OFFLINE significa apenas que o servidor não recebe contato recente.
      </p>
    </Shell>
  );
}
