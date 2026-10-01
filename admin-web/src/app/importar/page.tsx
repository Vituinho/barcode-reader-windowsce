"use client";

import Link from "next/link";
import { useState } from "react";
import { Btn, Card, ErrorBox, Shell, Table, Td } from "@/components/ui";
import { apiUpload, errorMessage } from "@/lib/api";
import type { ImportReport } from "@/lib/types";

export default function ImportPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!files.length) return;
    const form = new FormData();
    files.forEach((f) => form.append("files", f, f.name));
    setBusy(true);
    setError(null);
    try {
      setReport(await apiUpload<ImportReport>("/api/import/xml", form));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Importar XML de NF-e">
      <ErrorBox error={error} />
      <div className="mb-4 rounded border border-slate-200 bg-white p-4">
        <p className="mb-3 text-sm text-slate-600">
          Selecione um ou vários arquivos <b>.xml</b> ou um <b>.zip</b> com pastas de XML. A carga é lida do texto
          &quot;Carga:&quot; das informações adicionais da NF-e. Reimportar o mesmo XML não duplica nada (chave de acesso).
        </p>
        <input
          type="file"
          multiple
          accept=".xml,.zip,application/xml,text/xml,application/zip"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          className="block text-sm"
        />
        <div className="mt-3 flex items-center gap-3">
          <Btn onClick={submit} disabled={busy || !files.length}>{busy ? "Importando..." : "Importar"}</Btn>
          <span className="text-sm text-slate-500">{files.length} arquivo(s) selecionado(s)</span>
        </div>
      </div>

      {report && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card label="Arquivos processados" value={report.filesProcessed} />
            <Card label="XML aceitos" value={report.xmlAccepted} />
            <Card label="NF-e importadas" value={report.invoicesImported} tone="good" />
            <Card label="Duplicadas ignoradas" value={report.duplicatesSkipped} />
            <Card label="XML inválidos / recusados" value={report.invalid.length} tone={report.invalid.length ? "bad" : undefined} />
            <Card label="Cargas criadas" value={report.loadsCreated.length} />
            <Card label="Produtos criados / atualizados" value={`${report.productsCreated} / ${report.productsUpdated}`} />
            <Card label="Avisos" value={report.warnings.length} tone={report.warnings.length ? "warn" : undefined} />
          </div>
          {report.loadsCreated.length > 0 && (
            <p className="mb-4 text-sm">
              Cargas criadas: {report.loadsCreated.join(", ")} · <Link className="underline" href="/cargas">ver cargas</Link>
            </p>
          )}
          {report.invalid.length > 0 && (
            <>
              <h2 className="mb-2 font-semibold text-red-700">Arquivos recusados</h2>
              <Table head={["Arquivo", "Motivo", "Detalhe"]}>
                {report.invalid.map((i, n) => (
                  <tr key={n}><Td mono>{i.file}</Td><Td>{i.code}</Td><Td>{i.message}</Td></tr>
                ))}
              </Table>
            </>
          )}
          {report.warnings.length > 0 && (
            <>
              <h2 className="mb-2 mt-4 font-semibold text-purple-700">Avisos (dados preservados, revisar)</h2>
              <Table head={["Carga", "Arquivo", "Aviso", "Detalhe"]}>
                {report.warnings.map((w, n) => (
                  <tr key={n}><Td mono>{w.load ?? "—"}</Td><Td mono>{w.file}</Td><Td>{w.code}</Td><Td>{w.message}</Td></tr>
                ))}
              </Table>
            </>
          )}
          {report.ignoredFiles.length > 0 && (
            <p className="mt-3 text-xs text-slate-500">Ignorados (não XML): {report.ignoredFiles.join(", ")}</p>
          )}
        </>
      )}
    </Shell>
  );
}
