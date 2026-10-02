"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, FileArchive, FileCode2, Loader2, UploadCloud, X, XCircle } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { Btn, ErrorBox, Table, Td } from "@/components/ui";
import { apiUpload, errorMessage, fmtBytes } from "@/lib/api";
import type { ImportIssue, ImportReport } from "@/lib/types";

const PREVIEW = 50;

function Issues({ title, items, tone }: { title: string; items: ImportIssue[]; tone: "warning" | "danger" }) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, PREVIEW);
  return (
    <details className="group rounded-lg border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold">
        {tone === "danger" ? <XCircle className="size-4 text-red-700" aria-hidden /> : <AlertTriangle className="size-4 text-amber-700" aria-hidden />}
        {title} ({items.length})
        <ChevronDown className="ml-auto size-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-slate-200 p-3">
        <Table head={["Carga", "Arquivo", "Motivo", "Detalhe"]} minWidth={760}>
          {shown.map((w, n) => (
            <tr key={n}>
              <Td mono>{w.load ?? "—"}</Td>
              <Td mono className="max-w-[16rem] break-all">{w.file}</Td>
              <Td className="whitespace-nowrap font-semibold">{w.code}</Td>
              <Td>{w.message}</Td>
            </tr>
          ))}
        </Table>
        {items.length > PREVIEW && !all && (
          <button onClick={() => setAll(true)} className="mt-2 text-sm font-semibold text-orange-700 hover:underline">
            Mostrar todos os {items.length}
          </button>
        )}
      </div>
    </details>
  );
}

export function ImportReportView({ report, loadsLink }: { report: ImportReport; loadsLink?: ReactNode }) {
  return (
    <section className="mt-6 space-y-3" aria-label="Resultado da importação">
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold">Resultado da importação</h2>
        <ul className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {[
            `${report.xmlAccepted} de ${report.filesProcessed} arquivos lidos como NF-e`,
            `${report.invoicesImported} NF-e importadas`,
            `${report.loadsCreated.length} cargas criadas${report.loadsUpdated.length ? `, ${report.loadsUpdated.length} atualizadas` : ""}`,
            `${report.productsCreated} produtos novos${report.productsUpdated ? `, ${report.productsUpdated} atualizados` : ""}`,
            `${report.duplicatesSkipped} duplicadas ignoradas`,
          ].map((text) => (
            <li key={text} className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-green-700" aria-hidden /> {text}
            </li>
          ))}
          <li className="flex items-center gap-2">
            <AlertTriangle className={`size-4 ${report.warnings.length ? "text-amber-700" : "text-slate-300"}`} aria-hidden />
            Avisos: <b>{report.warnings.length}</b>
          </li>
          <li className="flex items-center gap-2">
            <XCircle className={`size-4 ${report.invalid.length ? "text-red-700" : "text-slate-300"}`} aria-hidden />
            Recusados: <b>{report.invalid.length}</b>
          </li>
        </ul>
        {report.loadsCreated.length > 0 && (
          <p className="mt-3 text-sm text-slate-600">
            Cargas criadas: <span className="font-mono">{report.loadsCreated.slice(0, 20).join(", ")}{report.loadsCreated.length > 20 ? "…" : ""}</span>
            {loadsLink && <> {loadsLink}</>}
          </p>
        )}
      </div>
      <Issues title="Ver arquivos recusados" items={report.invalid} tone="danger" />
      <Issues title="Ver avisos" items={report.warnings} tone="warning" />
      {report.ignoredFiles.length > 0 && (
        <p className="text-xs text-slate-500">Ignorados (não XML): {report.ignoredFiles.slice(0, 10).join(", ")}{report.ignoredFiles.length > 10 ? "…" : ""}</p>
      )}
    </section>
  );
}

/** Drop zone + file list + upload. `allowRar` only when the server reported it can open RAR archives. */
export function Importer({ endpoint, allowRar, onImported, loadsLink, compact }: {
  endpoint: string;
  allowRar: boolean;
  onImported?: (report: ImportReport) => void;
  loadsLink?: ReactNode;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = allowRar ? /\.(xml|zip|rar)$/i : /\.(xml|zip)$/i;
  const kinds = allowRar ? "XML, ZIP ou RAR" : "XML ou ZIP";

  function addFiles(list: FileList | null) {
    if (!list) return;
    const accepted = Array.from(list).filter((f) => accept.test(f.name));
    const rejected = list.length - accepted.length;
    setError(rejected ? `${rejected} arquivo(s) ignorado(s): envie apenas ${kinds}.` : null);
    setFiles((prev) => [...prev, ...accepted.filter((f) => !prev.some((p) => p.name === f.name && p.size === f.size))]);
    setReport(null);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  async function submit() {
    if (!files.length) return;
    const form = new FormData();
    files.forEach((f) => form.append("files", f, f.name));
    setBusy(true);
    setError(null);
    try {
      const r = await apiUpload<ImportReport>(endpoint, form);
      setReport(r);
      setFiles([]);
      onImported?.(r);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const total = files.reduce((s, f) => s + f.size, 0);

  return (
    <div>
      <ErrorBox error={error} />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center rounded-lg border-2 border-dashed px-6 text-center transition-colors ${compact ? "py-6" : "py-10"} ${
          dragging ? "border-orange-500 bg-orange-50" : "border-slate-300 bg-white"}`}
      >
        <UploadCloud className={`size-10 ${dragging ? "text-orange-600" : "text-slate-400"}`} aria-hidden />
        <p className="mt-3 text-base font-semibold text-slate-900">Arraste aqui o {allowRar ? "ZIP, RAR" : "ZIP"} ou os XML</p>
        <div className="mt-3">
          <Btn variant="secondary" onClick={() => inputRef.current?.click()}>Selecionar arquivos</Btn>
        </div>
        <p className="mt-3 max-w-prose text-xs text-slate-500">
          Aceita XML de NF-e e arquivos {allowRar ? "ZIP ou RAR" : "ZIP"} com pastas de XML. Outros arquivos dentro do pacote são ignorados.
          {!allowRar && " RAR não está disponível neste servidor."}
        </p>
        <input ref={inputRef} type="file" multiple hidden
               accept={`.xml,.zip,application/xml,text/xml,application/zip${allowRar ? ",.rar,application/vnd.rar,application/x-rar-compressed" : ""}`}
               onChange={(e) => {
                 addFiles(e.target.files);
                 e.target.value = "";
               }} />
      </div>

      {files.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white">
          <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto">
            {files.map((f) => (
              <li key={f.name + f.size} className="flex items-center gap-3 px-4 py-2 text-sm">
                {/\.(zip|rar)$/i.test(f.name) ? <FileArchive className="size-4 text-slate-500" aria-hidden /> : <FileCode2 className="size-4 text-slate-500" aria-hidden />}
                <span className="min-w-0 flex-1 truncate font-mono">{f.name}</span>
                <span className="text-xs text-slate-500">{fmtBytes(f.size)}</span>
                <button onClick={() => setFiles(files.filter((x) => x !== f))} aria-label={`Remover ${f.name}`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-4 py-3">
            <span className="text-sm text-slate-600">{files.length} arquivo(s), {fmtBytes(total)}</span>
            <span className="ml-auto flex gap-2">
              <Btn variant="ghost" onClick={() => setFiles([])} disabled={busy}>Limpar</Btn>
              <Btn onClick={submit} disabled={busy}>
                {busy ? <><Loader2 className="size-4 animate-spin" aria-hidden /> Importando…</> : "Importar NF-e"}
              </Btn>
            </span>
          </div>
        </div>
      )}

      {report && <ImportReportView report={report} loadsLink={loadsLink} />}
    </div>
  );
}
