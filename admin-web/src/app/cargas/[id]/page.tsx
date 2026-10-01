"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";
import { LoadStatusBlock, ProgressBar } from "@/components/loads";
import { Badge, Btn, ErrorBox, inputCls, Shell, Table, Td } from "@/components/ui";
import { api, errorMessage, fmtDateTime } from "@/lib/api";
import type { LoadDetail, LoadRequirement } from "@/lib/types";

export default function LoadDetailPage() {
  const { id } = useParams<{ id: string }>();
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
    if (!confirm(`Expedir carga ${load.externalCode}?\nOs volumes necessários serão retirados do estoque.`)) return;
    setBusy(true);
    try {
      setLoad(await api<LoadDetail>(`/api/loads/${load.id}/dispatch`, { method: "POST" }));
      setError(null);
    } catch (e) {
      // e.g. LOAD_NO_LONGER_READY when another load consumed the stock first
      setError(errorMessage(e));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function resolve(r: LoadRequirement) {
    const value = window.prompt(
      `Produto ${r.productCode}: a NF-e informa ${r.commercialQuantity} ${r.unit ?? ""}.\n` +
        "Quantos VOLUMES físicos (etiquetas a ler) esta carga precisa deste produto?",
    );
    if (!value) return;
    const qty = Number(value);
    if (!Number.isInteger(qty) || qty <= 0) {
      setError("Informe um número inteiro de volumes maior que zero.");
      return;
    }
    const note = window.prompt("Observação (obrigatório informar a origem da contagem):") ?? "";
    try {
      setLoad(await api<LoadDetail>(`/api/loads/${load!.id}/items/${r.id}`, {
        method: "PATCH",
        body: { requiredQuantity: qty, note },
      }));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!load) return <Shell title="Carga"><ErrorBox error={error} /></Shell>;

  return (
    <Shell
      title={`Carga ${load.externalCode}`}
      actions={<Link href="/cargas" className="text-sm underline">← Cargas</Link>}
    >
      <ErrorBox error={error} />
      <div className="mb-4 grid gap-3 md:grid-cols-[2fr_1fr]">
        <div className="rounded border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-baseline gap-4">
            <span className="font-mono text-3xl font-bold">{load.externalCode}</span>
            <span className="text-2xl font-semibold">{load.availableVolumes} / {load.requiredVolumes}</span>
            <span className="text-sm text-slate-500">{load.productLines} produtos · {load.invoiceCount} NF · {load.customerCount} clientes</span>
          </div>
          <div className="my-3"><ProgressBar value={load.progress} status={load.status} /></div>
          <LoadStatusBlock load={load} />
          {load.status === "DISPATCHED" && (
            <p className="mt-2 text-sm">Expedida em {fmtDateTime(load.dispatchedAt)} por {load.dispatchedByName ?? "—"}</p>
          )}
        </div>
        <div className="flex flex-col justify-center gap-2 rounded border border-slate-200 bg-white p-4">
          {load.status === "READY" ? (
            <button
              onClick={dispatch}
              disabled={busy}
              className="rounded bg-green-700 px-4 py-4 text-lg font-bold text-white hover:bg-green-600 disabled:opacity-50"
            >
              {busy ? "EXPEDINDO..." : "EXPEDIR CARGA"}
            </button>
          ) : (
            <button disabled className="cursor-not-allowed rounded bg-slate-300 px-4 py-4 text-lg font-bold text-slate-600">
              EXPEDIR CARGA
            </button>
          )}
          <p className="text-xs text-slate-500">
            {load.status === "READY"
              ? "O servidor confere o estoque novamente no momento da expedição."
              : load.needsReview
                ? "Defina os volumes dos itens marcados como REVISAR antes de expedir."
                : load.status === "PENDING" ? "Expedição liberada quando todo o estoque necessário estiver disponível." : ""}
          </p>
        </div>
      </div>

      <h2 className="mb-2 font-semibold">Produtos necessários</h2>
      <Table head={["Código", "Produto", "Precisa", "Estoque", "Falta", "NF-e (qCom)", ""]}>
        {load.requirements.map((r) => (
          <tr key={r.id} className={r.needsReview ? "bg-purple-50" : r.missing > 0 && load.status !== "DISPATCHED" ? "bg-amber-50" : ""}>
            <Td mono>{r.productCode}</Td>
            <Td>{r.description}</Td>
            <Td>{r.requiredQuantity ?? <Badge value="REVIEW" />}</Td>
            <Td>{r.stock}</Td>
            <Td>{r.needsReview ? "—" : load.status === "DISPATCHED" ? 0 : <b className={r.missing ? "text-red-700" : ""}>{r.missing}</b>}</Td>
            <Td>
              {r.commercialQuantity} {r.unit}
              {r.reviewReason && <div className="text-xs text-purple-700">{r.reviewReason}</div>}
              {r.resolutionNote && <div className="text-xs text-slate-500">Definido: {r.resolutionNote}</div>}
            </Td>
            <Td>
              {load.status !== "DISPATCHED" && (r.needsReview || r.resolvedAt) && (
                <Btn variant="secondary" onClick={() => resolve(r)}>{r.needsReview ? "Definir volumes" : "Alterar"}</Btn>
              )}
            </Td>
          </tr>
        ))}
      </Table>

      <h2 className="mb-2 mt-6 font-semibold">Notas fiscais / destinos</h2>
      <Table head={["NF", "Cliente", "Destino", "Pedido", "Volumes (qVol)", "Avisos", ""]}>
        {load.invoices.map((i) => (
          <Fragment key={i.id}>
            <tr>
              <Td mono>{i.invoiceNumber}</Td>
              <Td>{i.customerName}<div className="text-xs text-slate-500">{i.customerDocument} {i.externalCustomerCode && `· ${i.externalCustomerCode}`}</div></Td>
              <Td>{i.city}/{i.state}</Td>
              <Td mono>{i.orderNumber ?? "—"}</Td>
              <Td>{i.volumeCount ?? "—"} {i.volumeSpecies}</Td>
              <Td>{i.warnings.map((w) => <div key={w.code} className="text-xs text-purple-700">{w.code}: {w.message}</div>)}</Td>
              <Td><Btn variant="secondary" onClick={() => setOpenInvoice(openInvoice === i.id ? null : i.id)}>Itens</Btn></Td>
            </tr>
            {openInvoice === i.id && (
              <tr>
                <td colSpan={7} className="bg-slate-50 px-3 py-2 text-xs">
                  <div className="mb-1 font-mono text-slate-500">Chave {i.accessKey} · arquivo {i.sourceFileName}</div>
                  {i.lines.map((l) => (
                    <div key={l.lineNumber} className="font-mono">
                      {l.lineNumber}. {l.productCode} · {l.description} · {l.quantity} {l.unit} {l.ean ? `· EAN ${l.ean}` : ""} {!l.discrete && "· REVISAR"}
                    </div>
                  ))}
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </Table>

      {load.dispatchMovements.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 font-semibold">Saídas de estoque desta expedição</h2>
          <Table head={["Código", "Produto", "Quantidade", "Usuário", "Data"]}>
            {load.dispatchMovements.map((m) => (
              <tr key={m.id}>
                <Td mono>{m.productCode}</Td>
                <Td>{m.description}</Td>
                <Td>{m.quantity}</Td>
                <Td>{m.createdByName ?? "—"}</Td>
                <Td>{fmtDateTime(m.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Shell>
  );
}
