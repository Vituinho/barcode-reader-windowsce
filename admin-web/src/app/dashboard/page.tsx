"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge, Card, ErrorBox, Shell, Table, Td } from "@/components/ui";
import { api, errorMessage, fmtAge, fmtDateTime } from "@/lib/api";
import type { Dashboard, Device } from "@/lib/types";

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, dev] = await Promise.all([api<Dashboard>("/api/admin/dashboard"), api<Device[]>("/api/admin/devices")]);
      setData(d);
      setDevices(dev);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <Shell title="Painel">
      <ErrorBox error={error} />
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card label="Leituras hoje" value={data.scansToday} />
            <Card label="Desconhecidas hoje" value={data.unknownScansToday} tone={data.unknownScansToday ? "warn" : undefined} />
            <Card label="Códigos desconhecidos" value={<Link href="/barcodes/unknown" className="underline">{data.unknownBarcodes}</Link>} />
            <Card label="Conflitos abertos" value={<Link href="/scans?syncState=CONFLICT" className="underline">{data.conflictsOpen}</Link>} tone={data.conflictsOpen ? "bad" : undefined} />
            <Card label="Sessões abertas" value={data.openSessions} />
            <Card label="Coletores online" value={data.devicesOnline} tone="good" />
            <Card label="Coletores offline" value={data.devicesOffline} />
            <Card label="Coletores desativados" value={data.devicesDisabled} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Atualizado em {fmtDateTime(data.serverTime)}. ONLINE = heartbeat recente; não é garantia em tempo real.
          </p>
        </>
      )}
      <h2 className="mb-2 mt-6 font-semibold">Coletores</h2>
      <Table head={["Coletor", "Status", "Último contato", "Operador", "Pendentes"]}>
        {devices.map((d) => (
          <tr key={d.id}>
            <Td mono>{d.id}</Td>
            <Td><Badge value={d.connectivity} /></Td>
            <Td>{fmtDateTime(d.lastSeenAt)} <span className="text-slate-500">({fmtAge(d.lastSeenAgeSeconds)})</span></Td>
            <Td>{d.lastOperatorName ?? "—"}</Td>
            <Td>{d.pendingScans ?? "—"}</Td>
          </tr>
        ))}
      </Table>
    </Shell>
  );
}
