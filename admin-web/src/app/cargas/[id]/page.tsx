"use client";

import { ArrowLeft, CheckCircle2, ChevronDown, PackageCheck, Truck } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "@/components/dialog";
import { LoadStatusChip, loadState, ProgressBar } from "@/components/loads";
import { Badge, Btn, ErrorBox, Loading, Panel, Shell, Table, Td, useCurrentUser } from "@/components/ui";
import { api, errorMessage, fmtDateTime } from "@/lib/api";
import type { LoadDetail, LoadRequirement } from "@/lib/types";

const BANNER = {
  READY: { text: "PRONTA PARA EXPEDIÇÃO", cls: "border-green-300 bg-green-700 text-white" },
  PENDING: { text: "PENDENTE · AGUARDANDO ESTOQUE", cls: "border-amber-300 bg-amber-50 text-amber-900" },
  REVIEW: { text: "REVISAR QUANTIDADES ANTES DE EXPEDIR", cls: "border-purple-300 bg-purple-50 text-purple-900" },
  DISPATCHED: { text: "EXPEDIDA", cls: "border-slate-300 bg-slate-100 text-slate-700" },
};

export default function LoadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const user = useCurrentUser();
  const admin = user?.role === "ADMIN";
  const { confirm, dialog } = useConfirm();
  const [load, setLoad] = useState<LoadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openInvoice, setOpenInvoice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoad(await api<LoadDetail>(`/api/loads/${id}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  async function dispatch() {
    if (!load) return;
    const r = await confirm({
      title: `Expedir carga ${load.externalCode}?`,
      message: (
        <>
          Os <b>{load.requiredVolumes} volumes</b> necessários serão retirados do estoque ({load.requirements.length} produtos).
          O servidor confere o estoque novamente; se outra carga consumiu os volumes antes, a expedição é recusada.
        </>
      ),
      confirmLabel: "Expedir carga",
    });
    if (!r.ok) return;
    setBusy(true);
    try {
      setLoad(await api<LoadDetail>(`/api/loads/${load.id}/dispatch`, { method: "POST" }));
      setError(null);
    } catch (e) {
      setError(errorMessage(e)); // e.g. LOAD_NO_LONGER_READY
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function resolve(r: LoadRequirement) {
    const qty = await confirm({
      title: `Volumes do produto ${r.productCode}`,
      message: <>A NF-e informa <b>{r.commercialQuantity} {r.unit}</b>, que não é contagem de volumes. Informe quantos volumes físicos (etiquetas) esta carga precisa.</>,
      confirmLabel: "Continuar",
      input: { label: "Volumes físicos", type: "number", required: true, initial: r.requiredQuantity?.toString() },
    });
    if (!qty.ok) return;
    const n = Number(qty.value);
    if (!Number.isInteger(n) || n <= 0) {
      setError("Informe um número inteiro de volumes maior que zero.");
      return;
    }
    const note = await confirm({
      title: "Origem da contagem",
      message: "Registre de onde veio a quantidade (fica no histórico da carga).",
      confirmLabel: "Salvar",
      input: { label: "Observação", placeholder: "Ex.: 40 rolos conferidos no romaneio", required: true },
    });
    if (!note.ok) return;
    try {
      setLoad(await api<LoadDetail>(`/api/loads/${load!.id}/items/${r.id}`, { method: "PATCH", body: { requiredQuantity: n, note: note.value } }));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!load) return <Shell title="Carga"><ErrorBox error={error} />{!error && <Loading />}</Shell>;

  const state = loadState(load);
  const banner = BANNER[state];
  const shortages = load.requirements.filter((r) => r.missing > 0 || r.needsReview);

  return (
    <Shell
      title={`Carga ${load.externalCode}`}
      actions={<Link href="/cargas" className="inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"><ArrowLeft className="size-4" aria-hidden /> Cargas</Link>}
    >
      <ErrorBox error={error} />

      <div className={`mb-4 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 ${banner.cls}`}>
        {state === "READY" ? <CheckCircle2 className="size-6" aria-hidden /> : state === "DISPATCHED" ? <PackageCheck className="size-6" aria-hidden /> : <Truck className="size-6" aria-hidden />}
        <span className="text-lg font-black tracking-wide">{banner.text}</span>
        {state === "DISPATCHED" && <span className="text-sm">em {fmtDateTime(load.dispatchedAt)} por {load.dispatchedByName ?? "—"}</span>}
        {state === "READY" && admin && (
          <span className="ml-auto">
            <button
              onClick={dispatch}
              disabled={busy}
              className="inline-flex h-12 items-center gap-2 rounded-md bg-white px-5 text-sm font-black tracking-wide text-green-800 shadow-sm hover:bg-green-50 disabled:opacity-50"
            >
              <PackageCheck className="size-5" aria-hidden /> {busy ? "EXPEDINDO..." : "EXPEDIR CARGA"}
            </button>
          </span>
        )}
      </div>

      <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          ["Previsto", load.requiredVolumes],
          ["Coberto", state === "DISPATCHED" ? load.requiredVolumes : load.coveredVolumes],
          ["Disponível", state === "DISPATCHED" ? "—" : load.stockVolumes],
          ["Falta", state === "DISPATCHED" ? 0 : load.missingVolumes],
          ["NF-e / clientes", `${load.invoiceCount} / ${load.customerCount}`],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-lg border border-slate-200 bg-white p-3">
            <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
            <dd className={`mt-1 text-2xl font-bold tabular-nums ${label === "Falta" && Number(value) > 0 ? "text-amber-700" : ""}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mb-6 flex items-center gap-3">
        <ProgressBar value={load.progress} state={state} />
        <span className="text-sm font-semibold tabular-nums">{load.progress}%</span>
      </div>

      <Panel
        title="Produtos necessários"
        actions={shortages.length > 0 && state !== "DISPATCHED"
          ? <span className="text-xs font-semibold text-amber-800">{shortages.length} {shortages.length === 1 ? "produto com pendência" : "produtos com pendência"}</span>
          : undefined}
        className="mb-6"
      >
        {/* phones: one compact card per product, numbers side by side */}
        <ul className="divide-y divide-slate-100 sm:hidden">
          {load.requirements.map((r) => {
            const short = state !== "DISPATCHED" && r.missing > 0;
            return (
              <li key={r.id} className={`px-4 py-3 ${r.needsReview ? "bg-purple-50/60" : short ? "bg-amber-50/70" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-sm font-semibold">{r.productCode}</span>
                  {r.sideRulePending ? <Badge value="REVIEW" label="LADO PENDENTE" />
                    : r.needsReview ? <Badge value="REVIEW" label="REVISAR" />
                    : state === "DISPATCHED" ? <Badge value="DISPATCHED" />
                    : short ? <Badge value="PENDING" label={`FALTA ${r.missing}`} /> : <Badge value="READY" label="OK" />}
                </div>
                <div className="mt-0.5 text-sm text-slate-700">{r.description}</div>
                <div className="mt-1.5 flex gap-4 text-xs text-slate-500">
                  <span>Previsto <b className="text-sm text-slate-900">{r.requiredQuantity ?? "—"}</b></span>
                  <span>Coberto <b className="text-sm text-slate-900">{r.needsReview ? "—" : r.available}</b></span>
                  <span>Disponível <b className="text-sm text-slate-900">{r.stock}</b></span>
                  {short && <span>Falta <b className="text-sm text-amber-800">{r.missing}</b></span>}
                </div>
                {r.reviewReason && <div className="mt-1 text-xs text-purple-800">{r.reviewReason} · NF-e: {r.commercialQuantity} {r.unit}</div>}
                {admin && state !== "DISPATCHED" && (r.requiredQuantity === null || r.resolvedAt) && (
                  <div className="mt-2"><Btn variant="secondary" size="sm" onClick={() => void resolve(r)}>{r.requiredQuantity === null ? "Definir volumes" : "Alterar"}</Btn></div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="hidden sm:block">
        <Table
          head={["Código", "Produto", { label: "Previsto", align: "right" }, { label: "Coberto", align: "right" }, { label: "Disponível", align: "right" }, { label: "Falta", align: "right" }, "Status", ""]}
          minWidth={820}
          bare
        >
          {load.requirements.map((r) => {
            const short = state !== "DISPATCHED" && r.missing > 0;
            return (
              <tr key={r.id} className={r.needsReview ? "bg-purple-50/60" : short ? "bg-amber-50/70" : ""}>
                <Td mono>{r.productCode}</Td>
                <Td>
                  <span className={short || r.needsReview ? "font-medium" : "text-slate-600"}>{r.description}</span>
                  {r.reviewReason && <div className="text-xs text-purple-800">{r.reviewReason} · NF-e: {r.commercialQuantity} {r.unit}</div>}
                  {r.resolutionNote && <div className="text-xs text-slate-500">Definido manualmente: {r.resolutionNote}</div>}
                </Td>
                <Td align="right">{r.requiredQuantity ?? "—"}</Td>
                <Td align="right">{r.needsReview ? "—" : state === "DISPATCHED" ? r.requiredQuantity : r.available}</Td>
                <Td align="right">{r.stock}</Td>
                <Td align="right">{r.needsReview || state === "DISPATCHED" ? "—" : short ? <b className="text-amber-800">{r.missing}</b> : 0}</Td>
                <Td>
                  {r.sideRulePending ? <Badge value="REVIEW" label="LADO PENDENTE" />
                    : r.needsReview ? <Badge value="REVIEW" label="REVISAR" />
                    : state === "DISPATCHED" ? <Badge value="DISPATCHED" />
                    : short ? <Badge value="PENDING" label={`FALTA ${r.missing}`} />
                    : <Badge value="READY" label="OK" />}
                </Td>
                <Td>
                  {admin && state !== "DISPATCHED" && (r.requiredQuantity === null || r.resolvedAt) && (
                    <Btn variant="secondary" size="sm" onClick={() => void resolve(r)}>{r.requiredQuantity === null ? "Definir volumes" : "Alterar"}</Btn>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
        </div>
      </Panel>

      <Panel title={`Notas fiscais e destinos (${load.invoices.length})`} className="mb-6">
        <ul className="divide-y divide-slate-100">
          {load.invoices.map((i) => (
            <li key={i.id}>
              <button
                onClick={() => setOpenInvoice(openInvoice === i.id ? null : i.id)}
                aria-expanded={openInvoice === i.id}
                className="grid w-full grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 sm:grid-cols-[5.5rem_minmax(0,1fr)_10rem_6rem_auto]"
              >
                <span className="font-mono text-sm font-semibold">{i.invoiceNumber}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{i.customerName}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {i.city}/{i.state}{i.orderNumber ? ` · Pedido ${i.orderNumber}` : ""}{i.externalCustomerCode ? ` · ${i.externalCustomerCode}` : ""}
                  </span>
                </span>
                <span className="hidden text-xs text-slate-500 sm:block">{i.volumeCount ?? "—"} {i.volumeSpecies}</span>
                <span className="hidden sm:block">{i.warnings.length > 0 && <Badge value="REVIEW" label="AVISO" />}</span>
                <ChevronDown className={`size-4 text-slate-400 transition-transform ${openInvoice === i.id ? "rotate-180" : ""}`} aria-hidden />
              </button>
              {openInvoice === i.id && (
                <div className="space-y-1 bg-slate-50 px-4 py-3 text-xs">
                  <div className="font-mono text-slate-500">Chave {i.accessKey} · {i.sourceFileName}</div>
                  {i.warnings.map((w) => <div key={w.code} className="text-purple-800">{w.code}: {w.message}</div>)}
                  {i.lines.map((l) => (
                    <div key={l.lineNumber} className="font-mono">
                      {l.lineNumber}. {l.productCode} · {l.description} · {l.quantity} {l.unit}{l.ean ? ` · EAN ${l.ean}` : ""}{!l.discrete && " · REVISAR"}
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      {load.dispatchMovements.length > 0 && (
        <Panel title="Saídas de estoque desta expedição">
          <Table bare head={["Código", "Produto", { label: "Quantidade", align: "right" }, "Responsável", "Data"]}>
            {load.dispatchMovements.map((m) => (
              <tr key={m.id}>
                <Td mono>{m.productCode}</Td>
                <Td>{m.description}</Td>
                <Td align="right">{m.quantity}</Td>
                <Td>{m.createdByName ?? "—"}</Td>
                <Td>{fmtDateTime(m.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}
      {dialog}
    </Shell>
  );
}
