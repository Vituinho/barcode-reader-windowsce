"use client";

import { ArrowLeft, ChevronDown, Lock, LockOpen, PackageCheck, ScanLine, Truck, UploadCloud } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { rememberProgramming } from "@/collector/programming";
import { openScanQueue } from "@/collector/store";
import { useConfirm } from "@/components/dialog";
import { Importer } from "@/components/importer";
import { LoadStatusChip, loadState, ProgressBar, shortageText } from "@/components/loads";
import { Badge, Btn, EmptyState, ErrorBox, Loading, Panel, Shell, Table, Td, useCurrentUser } from "@/components/ui";
import { api, errorMessage, fmtDateTime } from "@/lib/api";
import { formatProgrammingDate, weekdayOf } from "@/lib/programming";
import type { LoadSummary, ProductCoverage, Programming } from "@/lib/types";

const nf = new Intl.NumberFormat("pt-BR");

export default function ProgrammingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const user = useCurrentUser();
  const admin = user?.role === "ADMIN";
  const { confirm, dialog } = useConfirm();
  const [programming, setProgramming] = useState<Programming | null>(null);
  const [loads, setLoads] = useState<LoadSummary[]>([]);
  const [products, setProducts] = useState<ProductCoverage[]>([]);
  const [allowRar, setAllowRar] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [p, l, pr] = await Promise.all([
        api<Programming>(`/api/programmings/${id}`),
        api<LoadSummary[]>(`/api/loads?programmingId=${id}`),
        api<ProductCoverage[]>(`/api/programmings/${id}/products`),
      ]);
      setProgramming(p);
      setLoads(l);
      setProducts(pr);
      if (p.loadCount === 0 && p.status === "OPEN") setImportOpen(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    api<{ zip: boolean; rar: boolean }>("/api/programmings/import-capabilities")
      .then((c) => setAllowRar(c.rar))
      .catch(() => setAllowRar(false));
  }, []);

  if (!programming) {
    return <Shell title="Programação"><ErrorBox error={error} />{!error && <Loading />}</Shell>;
  }

  const p = programming;
  const isOpen = p.status === "OPEN";
  const ready = loads.filter((l) => loadState(l) === "READY");
  const toDispatch = p.loadCount - p.dispatchedCount;
  const coveredPct = p.requiredVolumes ? (p.coveredVolumes / p.requiredVolumes) * 100 : 0;

  function collect() {
    rememberProgramming(window.localStorage, { id: p.id, scheduledDate: p.scheduledDate, name: p.name });
    router.push("/coleta");
  }

  async function dispatch(load: LoadSummary) {
    const r = await confirm({
      title: `Expedir carga ${load.externalCode}?`,
      message: <>Os <b>{load.requiredVolumes} volumes</b> serão retirados do estoque desta programação. O servidor confere o estoque de novo antes de expedir.</>,
      confirmLabel: "Expedir carga",
    });
    if (!r.ok) return;
    setBusy(load.id);
    try {
      await api(`/api/loads/${load.id}/dispatch`, { method: "POST" });
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  async function setStatus(open: boolean) {
    if (!open) {
      let localPending = 0;
      try {
        const queue = await openScanQueue();
        localPending = (await queue.pending()).filter((s) => s.programmingId === p.id).length;
      } catch {
        /* no local queue on this browser */
      }
      const warnings = [
        toDispatch - ready.length > 0 && `${toDispatch - ready.length} ${toDispatch - ready.length === 1 ? "carga ainda não está pronta" : "cargas ainda não estão prontas"}`,
        ready.length > 0 && `${ready.length} ${ready.length === 1 ? "carga pronta não foi expedida" : "cargas prontas não foram expedidas"}`,
        p.reviewCount > 0 && `${p.reviewCount} ${p.reviewCount === 1 ? "carga precisa" : "cargas precisam"} de revisão`,
        p.warningInvoices > 0 && `${p.warningInvoices} NF-e com avisos de importação`,
        localPending > 0 && `${localPending} ${localPending === 1 ? "leitura ainda não enviada" : "leituras ainda não enviadas"} neste aparelho`,
      ].filter(Boolean) as string[];
      const r = await confirm({
        title: `Encerrar a programação ${formatProgrammingDate(p.scheduledDate)}?`,
        tone: warnings.length ? "danger" : "primary",
        confirmLabel: "Encerrar programação",
        message: (
          <>
            {warnings.length > 0 && (
              <ul className="mb-3 list-disc space-y-1 pl-5 text-red-800">
                {warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
            Coletores deixam de oferecer esta programação. Leituras feitas offline e enviadas depois do encerramento ficam em revisão;
            nenhum volume é movido para outra programação.
          </>
        ),
      });
      if (!r.ok) return;
    }
    setBusy("status");
    try {
      setProgramming(await api<Programming>(`/api/programmings/${p.id}/${open ? "reopen" : "close"}`, { method: "POST" }));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Shell
      title="Programação de cargas"
      actions={<Link href="/programacoes" className="inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"><ArrowLeft className="size-4" aria-hidden /> Programações</Link>}
    >
      <ErrorBox error={error} />

      {/* Day board: the one place this page speaks loudly */}
      <section className="mb-5 overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label="Situação da programação">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4 px-5 pt-5">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="text-[clamp(2rem,5vw,3rem)] font-black leading-none tabular-nums tracking-tight text-slate-950">
                {formatProgrammingDate(p.scheduledDate)}
              </span>
              <Badge value={p.status} />
            </div>
            <p className="mt-1.5 text-sm text-slate-500">
              {weekdayOf(p.scheduledDate)}{p.name ? `, ${p.name}` : ""}
              {!isOpen && p.closedAt && ` · encerrada em ${fmtDateTime(p.closedAt)}`}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {isOpen && (
              <button onClick={collect} className="inline-flex h-11 items-center gap-2 rounded-md bg-orange-600 px-5 text-sm font-bold text-white hover:bg-orange-700">
                <ScanLine className="size-4" aria-hidden /> Coletar
              </button>
            )}
            {admin && isOpen && (
              <Btn variant="secondary" onClick={() => setImportOpen((v) => !v)}>
                <UploadCloud className="size-4" aria-hidden /> Adicionar XML / ZIP{allowRar ? " / RAR" : ""}
              </Btn>
            )}
            {admin && (isOpen
              ? <Btn variant="secondary" disabled={busy === "status"} onClick={() => setStatus(false)}><Lock className="size-4" aria-hidden /> Encerrar</Btn>
              : <Btn variant="secondary" disabled={busy === "status"} onClick={() => setStatus(true)}><LockOpen className="size-4" aria-hidden /> Reabrir</Btn>)}
          </div>
        </div>

        <div className="px-5 pb-5 pt-6">
          <p className="mb-2 text-sm text-slate-700">
            {p.requiredVolumes === 0
              ? "Nenhum volume previsto ainda. Importe os XML das cargas desta programação."
              : <><b className="text-slate-950">{nf.format(p.coveredVolumes)}</b> de {nf.format(p.requiredVolumes)} volumes previstos já estão cobertos pelo estoque de produção.</>}
          </p>
          <div className="flex h-4 w-full overflow-hidden rounded bg-slate-100" role="img"
               aria-label={`${p.coveredVolumes} cobertos, ${p.missingVolumes} faltam, de ${p.requiredVolumes} previstos`}>
            <div className="h-full bg-green-600" style={{ width: `${coveredPct}%` }} />
            <div className="h-full bg-amber-400" style={{ width: `${100 - coveredPct}%`, display: p.requiredVolumes ? undefined : "none" }} />
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            {([
              ["Previsto", nf.format(p.requiredVolumes), ""],
              ["Coberto", nf.format(p.coveredVolumes), "text-green-700"],
              ["Falta", nf.format(p.missingVolumes), p.missingVolumes ? "text-amber-700" : ""],
              ["Disponível", nf.format(p.stockVolumes), ""],
              ["Cargas prontas", `${p.readyCount} de ${toDispatch}`, p.readyCount ? "text-green-700" : ""],
              ["Expedidas", String(p.dispatchedCount), ""],
            ] as const).map(([label, value, cls]) => (
              <div key={label}>
                <dt className="text-slate-500">{label}</dt>
                <dd className={`text-xl font-bold tabular-nums ${cls}`}>{value}</dd>
              </div>
            ))}
          </dl>
          {(p.reviewCount > 0 || p.warningInvoices > 0) && (
            <p className="mt-3 text-sm text-purple-900">
              {p.reviewCount > 0 && <>{p.reviewCount} {p.reviewCount === 1 ? "carga precisa" : "cargas precisam"} de revisão. </>}
              {p.warningInvoices > 0 && <>{p.warningInvoices} NF-e com avisos de importação.</>}
            </p>
          )}
        </div>
      </section>

      {admin && isOpen && importOpen && (
        <section className="mb-6" aria-label="Importar NF-e nesta programação">
          <Importer endpoint={`/api/programmings/${p.id}/import`} allowRar={allowRar} compact onImported={() => void refresh()} />
        </section>
      )}

      <Panel
        title={<span className="flex items-center gap-2"><PackageCheck className="size-4 text-green-700" aria-hidden /> Cargas que já podem sair</span>}
        className={`mb-6 ${ready.length ? "border-green-300" : ""}`}
      >
        {ready.length === 0 ? (
          <p className="px-4 py-4 text-sm text-slate-500">
            {toDispatch === 0 && p.loadCount > 0 ? "Todas as cargas desta programação foram expedidas." : "Nenhuma carga está completa ainda. Elas aparecem aqui assim que o estoque cobre tudo o que precisam."}
          </p>
        ) : (
          <ul className="divide-y divide-green-100">
            {ready.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-green-50/60 px-4 py-3">
                <Link href={`/cargas/${l.id}`} className="font-mono text-lg font-bold text-green-900 hover:underline">{l.externalCode}</Link>
                <span className="text-sm text-green-900">{l.requiredVolumes} {l.requiredVolumes === 1 ? "volume" : "volumes"}, {l.invoiceCount} NF-e, {l.customerCount} {l.customerCount === 1 ? "cliente" : "clientes"}</span>
                {admin && (
                  <span className="ml-auto">
                    <Btn disabled={busy === l.id} onClick={() => dispatch(l)}>
                      <PackageCheck className="size-4" aria-hidden /> {busy === l.id ? "Expedindo…" : "Expedir"}
                    </Btn>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Produtos da programação (${products.length})`} className="mb-6">
        {products.length === 0 ? (
          <EmptyState title="Nenhum produto previsto" description="Os produtos aparecem depois da importação dos XML." />
        ) : (
          <Table
            bare
            minWidth={820}
            head={["Código", "Produto", { label: "Previsto", align: "right" }, { label: "Coberto", align: "right" }, { label: "Disponível", align: "right" }, { label: "Falta", align: "right" }, "Cobertura"]}
          >
            {products.map((r) => {
              const pct = r.required ? Math.round((r.covered / r.required) * 100) : 0;
              return (
                <tr key={r.productCode ?? r.description} className={r.needsReview ? "bg-purple-50/60" : r.missing > 0 ? "" : "text-slate-600"}>
                  <Td mono>{r.productCode ?? "—"}</Td>
                  <Td>
                    {r.description}
                    <div className="text-xs text-slate-500">
                      {r.openLoads} {r.openLoads === 1 ? "carga" : "cargas"}{r.dispatched > 0 ? `, ${r.dispatched} vol. já expedidos` : ""}
                    </div>
                  </Td>
                  <Td align="right">{r.required}</Td>
                  <Td align="right">{r.covered}</Td>
                  <Td align="right">{r.stock}</Td>
                  <Td align="right">{r.missing > 0 ? <b className="text-amber-800">{r.missing}</b> : 0}</Td>
                  <Td>
                    {r.needsReview ? <Badge value="REVIEW" label="REVISAR" />
                      : r.required === 0 ? <span className="text-xs text-slate-500">expedido</span>
                      : <span className="flex min-w-[7rem] items-center gap-2"><ProgressBar value={pct} state={pct >= 100 ? "READY" : "PENDING"} /><span className="w-9 text-right text-xs tabular-nums">{pct}%</span></span>}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Panel>

      <Panel title={`Cargas (${loads.length})`} className="mb-6">
        {loads.length === 0 ? (
          <EmptyState icon={Truck} title="Nenhuma carga nesta programação" description={admin && isOpen ? "Use Adicionar XML / ZIP para importar as cargas." : undefined} />
        ) : (
          <Table bare minWidth={760} head={["Carga", "Situação", "Cobertura", { label: "Previsto", align: "right" }, { label: "Coberto", align: "right" }, { label: "Falta", align: "right" }, "NF-e"]}>
            {loads.map((l) => {
              const state = loadState(l);
              return (
                <tr key={l.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/cargas/${l.id}`)}>
                  <Td mono><Link href={`/cargas/${l.id}`} className="font-bold hover:underline" onClick={(e) => e.stopPropagation()}>{l.externalCode}</Link></Td>
                  <Td><LoadStatusChip state={state} /><div className="mt-0.5 text-xs text-slate-500">{shortageText(l)}</div></Td>
                  <Td><span className="flex min-w-[7rem] items-center gap-2"><ProgressBar value={l.progress} state={state} /><span className="w-9 text-right text-xs tabular-nums">{l.progress}%</span></span></Td>
                  <Td align="right">{l.requiredVolumes}</Td>
                  <Td align="right">{l.coveredVolumes}</Td>
                  <Td align="right">{state === "DISPATCHED" ? 0 : l.missingVolumes > 0 ? <b className="text-amber-800">{l.missingVolumes}</b> : 0}</Td>
                  <Td>{l.invoiceCount}{l.warningInvoices > 0 && <span className="ml-1 text-xs text-amber-800">({l.warningInvoices} c/ aviso)</span>}</Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Panel>

      <details className="group mb-6 text-sm text-slate-600">
        <summary className="flex cursor-pointer list-none items-center gap-1 font-semibold text-slate-700">
          Como ler estes números <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <ul className="mt-2 max-w-prose list-disc space-y-1 pl-5">
          <li><b>Previsto</b>: volumes que as cargas ainda não expedidas precisam.</li>
          <li><b>Disponível</b>: estoque de produção desta programação, coletado pela etiqueta maior.</li>
          <li><b>Coberto</b>: parte do previsto que o estoque já atende. O estoque não é reservado: o mesmo volume pode completar qualquer carga da programação.</li>
          <li><b>Falta</b>: previsto menos coberto.</li>
        </ul>
      </details>
      {dialog}
    </Shell>
  );
}
