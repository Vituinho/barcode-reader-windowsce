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
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Card label="Estoque (volumes)" value={<Link href="/estoque" className="underline">{data.stockTotal}</Link>} />
            <Card label="Cargas pendentes" value={<Link href="/cargas?status=PENDING" className="underline">{data.loadsPending}</Link>} tone={data.loadsPending ? "warn" : undefined} />
            <Card label="Cargas prontas" value={<Link href="/cargas" className="underline">{data.loadsReady}</Link>} tone={data.loadsReady ? "good" : undefined} />
            <Card label="Expedidas hoje" value={<Link href="/expedicoes" className="underline">{data.loadsDispatchedToday}</Link>} />
            <Card label="Leituras hoje" value={data.scansToday} />
            <Card label="Códigos desconhecidos" value={<Link href="/barcodes/unknown" className="underline">{data.unknownBarcodes}</Link>} tone={data.unknownBarcodes ? "warn" : undefined} />
          </div>
          <section className="mb-4 rounded border border-green-200 bg-white p-4">
            <h2 className="mb-2 font-semibold">Cargas prontas para expedição</h2>
            {data.readyLoads.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhuma carga pronta no momento.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.readyLoads.map((l) => (
                  <Link key={l.id} href={`/cargas/${l.id}`} className="rounded bg-green-600 px-3 py-2 font-mono text-lg font-bold text-white hover:bg-green-700">
                    {l.externalCode} <span className="text-xs font-normal">({l.volumes} vol.)</span>
                  </Link>
                ))}
              </div>
            )}
            {data.loadsReview > 0 && (
              <p className="mt-2 text-sm text-purple-700">{data.loadsReview} carga(s) aguardando revisão de quantidades (unidade não discreta).</p>
            )}
          </section>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card label="Desconhecidas hoje" value={data.unknownScansToday} tone={data.unknownScansToday ? "warn" : undefined} />
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
