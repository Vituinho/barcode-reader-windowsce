"use client";

import { AlertCircle, AlertTriangle, ArrowRight, Boxes, CheckCircle2, PackageCheck, ScanLine, ScanSearch, Smartphone, Truck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LoadStatusChip, ProgressBar } from "@/components/loads";
import { Badge, Card, EmptyState, ErrorBox, Loading, Panel, Shell } from "@/components/ui";
import { api, errorMessage, fmtAge, fmtDateTime } from "@/lib/api";
import type { Dashboard, Device } from "@/lib/types";

const nf = new Intl.NumberFormat("pt-BR");

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

  const alerts: { tone: "review" | "warning" | "danger"; text: string; href: string }[] = [];
  if (data) {
    if (data.loadsReview) alerts.push({ tone: "review", href: "/cargas?status=REVIEW",
      text: `${data.loadsReview} ${data.loadsReview === 1 ? "carga precisa" : "cargas precisam"} revisar quantidades` });
    if (data.unknownScansToday) alerts.push({ tone: "warning", href: "/barcodes/unknown",
      text: `${data.unknownScansToday} ${data.unknownScansToday === 1 ? "leitura" : "leituras"} de código desconhecido hoje` });
    if (data.conflictsOpen) alerts.push({ tone: "danger", href: "/scans?syncState=CONFLICT",
      text: `${data.conflictsOpen} ${data.conflictsOpen === 1 ? "leitura" : "leituras"} em sessão encerrada aguardando revisão` });
  }

  return (
    <Shell title="Painel" description="Situação atual do estoque, das cargas e das leituras.">
      <ErrorBox error={error} />
      {!data ? (
        !error && <Loading />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Card label="Estoque atual" value={nf.format(data.stockTotal)} hint="volumes disponíveis" icon={Boxes} href="/estoque" />
            <Card label="Prontas" value={data.loadsReady} tone={data.loadsReady ? "good" : undefined} hint="cargas para expedir" icon={CheckCircle2} href="/cargas?status=READY" />
            <Card label="Pendentes" value={data.loadsPending} tone={data.loadsPending ? "warn" : undefined} hint="cargas incompletas" icon={Truck} href="/cargas?status=PENDING" />
            <Card label="Expedidas hoje" value={data.loadsDispatchedToday} hint="cargas" icon={PackageCheck} href="/expedicoes" />
            <Card label="Leituras hoje" value={nf.format(data.scansToday)} hint="volumes lidos" icon={ScanLine} href="/scans" />
            <Card label="Desconhecidos" value={data.unknownBarcodes} tone={data.unknownBarcodes ? "warn" : undefined} hint="códigos sem produto" icon={ScanSearch} href="/barcodes/unknown" />
          </div>

          {alerts.length > 0 && (
            <ul className="space-y-2" aria-label="Alertas operacionais">
              {alerts.map((a) => (
                <li key={a.text}>
                  <Link
                    href={a.href}
                    className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium hover:shadow-sm ${
                      a.tone === "review" ? "border-purple-200 bg-purple-50 text-purple-900"
                        : a.tone === "danger" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}
                  >
                    {a.tone === "review" ? <AlertCircle className="size-4 shrink-0" aria-hidden /> : <AlertTriangle className="size-4 shrink-0" aria-hidden />}
                    <span className="flex-1">{a.text}</span>
                    <ArrowRight className="size-4 shrink-0 opacity-60" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Panel
              title="Cargas prontas para expedição"
              actions={<Link href="/cargas?status=READY" className="text-sm font-semibold text-orange-700 hover:underline">Ver todas</Link>}
            >
              {data.readyLoads.length === 0 ? (
                <EmptyState icon={Truck} title="Nenhuma carga pronta no momento" description="Uma carga fica pronta quando todo o estoque necessário foi coletado." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.readyLoads.map((l) => (
                    <li key={l.id}>
                      <Link href={`/cargas/${l.id}`} className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 hover:bg-slate-50">
                        <span className="font-mono text-base font-bold">{l.externalCode}</span>
                        <span className="flex items-center gap-3">
                          <ProgressBar value={100} state="READY" />
                          <span className="whitespace-nowrap text-sm tabular-nums text-slate-600">{l.volumes} vol.</span>
                        </span>
                        <LoadStatusChip state="READY" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Coletores" actions={<Link href="/devices" className="text-sm font-semibold text-orange-700 hover:underline">Gerenciar</Link>}>
              {devices.length === 0 ? (
                <EmptyState icon={Smartphone} title="Nenhum coletor registrado" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {devices.slice(0, 8).map((d) => (
                    <li key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{d.name}</span>
                        <span className="block truncate text-xs text-slate-500">
                          {d.lastOperatorName ?? "—"} · {fmtAge(d.lastSeenAgeSeconds)}
                        </span>
                      </span>
                      {d.pendingScans ? <span className="text-xs font-semibold text-sky-800">{d.pendingScans} pend.</span> : null}
                      <Badge value={d.connectivity} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <p className="text-xs text-slate-500">
            Atualizado em {fmtDateTime(data.serverTime)} · ONLINE indica contato recente do coletor, não garantia em tempo real.
          </p>
        </div>
      )}
    </Shell>
  );
}
