"use client";

import { Archive, ChevronDown, Download, ExternalLink, Laptop, ScanLine, Smartphone } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/brand";
import { useInstallPrompt } from "@/components/pwa";
import { Badge, CopyButton, ErrorBox, Panel, Shell } from "@/components/ui";
import { API_URL, api, errorMessage, fmtBytes, fmtDateTime, safeDownloadUrl } from "@/lib/api";
import type { SoftwareRelease } from "@/lib/types";

const GUIDES = [
  {
    icon: Smartphone,
    title: "Android · Chrome",
    steps: ["Abra o GIVOVA Coleta no Chrome", "Toque no menu ⋮", "Toque em “Adicionar à tela inicial” ou “Instalar app”"],
  },
  {
    icon: Smartphone,
    title: "iPhone / iPad · Safari",
    steps: ["Abra o GIVOVA Coleta no Safari", "Toque em Compartilhar", "Toque em “Adicionar à Tela de Início”"],
  },
  {
    icon: Laptop,
    title: "Computador · Chrome ou Edge",
    steps: ["Abra o GIVOVA Coleta no navegador", "Clique no ícone de instalar na barra de endereço, se disponível", "Ou use direto pelo navegador"],
  },
];

export default function InstallPage() {
  const { install, installed } = useInstallPrompt();
  const [origin, setOrigin] = useState("");
  const [legacy, setLegacy] = useState<SoftwareRelease[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    api<SoftwareRelease[]>("/api/releases").then(setLegacy).catch((e) => setError(errorMessage(e)));
  }, []);

  const collectorUrl = origin ? `${origin}/coleta` : "/coleta";

  return (
    <Shell title="Instalação" description="O coletor oficial é o GIVOVA Coleta Web: funciona em coletores Android, celulares, tablets e computadores, inclusive offline.">
      <ErrorBox error={error} />

      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center gap-4">
          <BrandMark size={56} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold tracking-tight">GIVOVA COLETA WEB</h2>
            <p className="text-sm text-slate-600">Leitor físico (modo teclado), câmera ou digitação. As leituras ficam salvas no aparelho até sincronizar.</p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Link href="/coleta" className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-md bg-orange-600 px-5 text-sm font-bold text-white hover:bg-orange-700 sm:flex-none">
              <ScanLine className="size-5" aria-hidden /> ABRIR COLETOR
            </Link>
            {install && !installed && (
              <button onClick={() => void install()} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-5 text-sm font-bold text-slate-800 hover:bg-slate-50 sm:flex-none">
                <Download className="size-5" aria-hidden /> INSTALAR APLICATIVO
              </button>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4 text-sm">
          <span className="text-slate-500">Endereço do coletor:</span>
          <code className="rounded bg-slate-100 px-2 py-1 font-mono text-[13px]">{collectorUrl}</code>
          <CopyButton text={collectorUrl} />
          {installed && <Badge value="ACTIVE" label="INSTALADO NESTE APARELHO" />}
        </div>
      </section>

      <h2 className="mb-3 text-sm font-semibold text-slate-900">Adicionar à tela inicial</h2>
      <div className="mb-3 grid gap-3 md:grid-cols-3">
        {GUIDES.map((g) => (
          <div key={g.title} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-2 font-semibold">
              <g.icon className="size-4 text-slate-500" aria-hidden /> {g.title}
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
              {g.steps.map((s) => <li key={s}>{s}</li>)}
            </ol>
          </div>
        ))}
      </div>
      <p className="mb-6 text-xs text-slate-500">
        A instalação depende do navegador e do sistema: nem todos oferecem a opção. Sem instalar, o coletor funciona normalmente pelo navegador.
        A câmera exige HTTPS (já disponível no endereço oficial).
      </p>

      <Panel title="Coletor físico (leitor de código de barras)" className="mb-6">
        <ul className="space-y-1.5 px-4 py-3 text-sm text-slate-700">
          <li>• Configure o leitor em <b>modo teclado</b> (keyboard wedge) com sufixo <b>ENTER</b> (TAB também é aceito).</li>
          <li>• Abra o coletor e leia: o campo de leitura fica sempre pronto, sem tocar na tela.</li>
          <li>• O produto é identificado pelos <b>10 primeiros caracteres</b> da etiqueta; a leitura completa também é guardada.</li>
          <li>• Cada navegador recebe uma identificação própria (WEB-…). Dê um nome ao dispositivo em Coletor › Menu › Renomear.</li>
        </ul>
      </Panel>

      <details className="group rounded-lg border border-slate-200 bg-white">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 px-4 py-3 text-sm font-semibold">
          <Archive className="size-4 text-slate-400" aria-hidden />
          Coletor Windows / Windows CE
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] font-bold text-slate-700">LEGADO / NÃO UTILIZADO NA OPERAÇÃO ATUAL</span>
          <ChevronDown className="ml-auto size-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <div className="space-y-2 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
          <p>O coletor nativo foi substituído pelo GIVOVA Coleta Web e não recebe novas versões. Mantido apenas como referência.</p>
          {legacy.length === 0 ? (
            <p className="text-xs">Nenhum pacote legado publicado.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {legacy.map((r) => {
                const url = safeDownloadUrl(r.downloadUrl);
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                    <span className="font-mono">{r.fileName}</span>
                    <span>v{r.version} · {fmtDateTime(r.releasedAt)} · {fmtBytes(r.fileSize)}</span>
                    {url && (
                      <a href={url} rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 font-semibold text-slate-700 hover:underline">
                        Baixar <ExternalLink className="size-3" aria-hidden />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-xs">Servidor (API): <code className="font-mono">{API_URL}</code></p>
        </div>
      </details>
    </Shell>
  );
}
