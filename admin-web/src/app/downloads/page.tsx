"use client";

import { useEffect, useState } from "react";
import { CopyButton, ErrorBox, Shell } from "@/components/ui";
import { API_URL, api, errorMessage, fmtBytes, fmtDateTime, safeDownloadUrl } from "@/lib/api";
import type { Platform, SoftwareRelease } from "@/lib/types";

interface Slot {
  platform: Platform;
  title: string;
  compatibility: string;
  fileType: string;
  expectedFile: string;
  pendingMessage: string;
  steps: string[];
  stepsNote?: string;
}

const SLOTS: Slot[] = [
  {
    platform: "WINDOWS_CE",
    title: "Coletor Windows CE",
    compatibility: "Windows CE 5.0+ / Windows Embedded Compact, .NET Compact Framework 3.5 (sujeito à homologação)",
    fileType: "Instalador CAB (.cab)",
    expectedFile: "GivovaCollector-CE-v1.0.0.cab",
    pendingMessage: "Instalador Windows CE aguardando homologação do equipamento.",
    steps: [
      "Baixe o arquivo .CAB.",
      "Copie para o coletor.",
      "Execute o instalador no Windows CE.",
      "Abra Givova Coleta.",
      "Configure servidor e DeviceId.",
    ],
    stepsNote: "Instruções provisórias: podem mudar após a homologação do equipamento.",
  },
  {
    platform: "WINDOWS_DESKTOP",
    title: "Simulador para Windows",
    compatibility: "Windows 10/11 (.NET Framework 4.x), leitor USB em modo teclado ou digitação",
    fileType: "Pacote ZIP (.zip)",
    expectedFile: "GivovaCollector-Simulator-v1.0.0.zip",
    pendingMessage: "Pacote do simulador ainda não publicado. Cadastre-o em Versões.",
    steps: [
      "Baixe o arquivo ZIP.",
      "Extraia para uma pasta (ex.: C:\\GivovaColeta).",
      "Configure collector.ini (renomeie collector.ini.example e defina DeviceId).",
      "Execute GivovaCollector.exe.",
    ],
  },
];

export default function DownloadsPage() {
  const [releases, setReleases] = useState<SoftwareRelease[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SoftwareRelease[]>("/api/releases")
      .then(setReleases)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  const configLine = `ApiBaseUrl=${API_URL}`;

  return (
    <Shell title="Downloads / Instalação">
      <ErrorBox error={error} />

      <section className="mb-6 rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">Endereço do servidor (API)</h2>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded bg-slate-100 px-2 py-1 text-sm">{API_URL}</code>
          <CopyButton text={API_URL} />
        </div>
        <p className="mt-3 text-sm text-slate-600">Exemplo para o arquivo collector.ini do coletor/simulador:</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <code className="rounded bg-slate-100 px-2 py-1 text-sm">{configLine}</code>
          <CopyButton text={configLine} label="Copiar linha" />
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {SLOTS.map((slot) => {
          const release = releases?.find((r) => r.platform === slot.platform) ?? null;
          const url = safeDownloadUrl(release?.downloadUrl);
          return (
            <section key={slot.platform} className="flex flex-col rounded border border-slate-200 bg-white p-4">
              <h2 className="text-lg font-semibold">{slot.title}</h2>
              <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-slate-500">Versão</dt>
                <dd>{release ? release.version : "—"}</dd>
                <dt className="text-slate-500">Data</dt>
                <dd>{release ? fmtDateTime(release.releasedAt) : "—"}</dd>
                <dt className="text-slate-500">Compatibilidade</dt>
                <dd>{slot.compatibility}</dd>
                <dt className="text-slate-500">Tipo</dt>
                <dd>{slot.fileType}</dd>
                <dt className="text-slate-500">Arquivo</dt>
                <dd className="break-all font-mono">{release ? release.fileName : slot.expectedFile}</dd>
                <dt className="text-slate-500">Tamanho</dt>
                <dd>{fmtBytes(release?.fileSize)}</dd>
                <dt className="text-slate-500">SHA-256</dt>
                <dd className="break-all font-mono text-xs">{release?.sha256 ?? "—"}</dd>
              </dl>
              {release?.releaseNotes && (
                <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{release.releaseNotes}</p>
              )}

              <div className="mt-4">
                {release && url ? (
                  <a
                    href={url}
                    rel="noopener noreferrer"
                    className="inline-block rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                  >
                    BAIXAR INSTALADOR
                  </a>
                ) : (
                  <>
                    <button disabled className="cursor-not-allowed rounded bg-slate-300 px-4 py-2 text-sm font-semibold text-slate-600">
                      BAIXAR INSTALADOR
                    </button>
                    {releases !== null && (
                      <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        {slot.pendingMessage}
                      </p>
                    )}
                  </>
                )}
              </div>

              <h3 className="mt-5 text-sm font-semibold">Instalação</h3>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm">
                {slot.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {slot.stepsNote && <p className="mt-2 text-xs text-slate-500">{slot.stepsNote}</p>}
            </section>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Confira o SHA-256 após baixar (PowerShell: <code>Get-FileHash arquivo -Algorithm SHA256</code>). Os pacotes não
        contêm senhas, tokens nem dados locais; o login é feito no aplicativo.
      </p>
    </Shell>
  );
}
