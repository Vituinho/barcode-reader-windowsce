"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { getToken, setToken } from "@/lib/api";

const NAV = [
  ["/dashboard", "Painel"],
  ["/estoque", "Estoque"],
  ["/cargas", "Cargas"],
  ["/expedicoes", "Expedições"],
  ["/scans", "Leituras"],
  ["/barcodes/unknown", "Códigos desconhecidos"],
  ["/importar", "Importar XML"],
  ["/items", "Itens"],
  ["/sessions", "Sessões"],
  ["/devices", "Coletores"],
  ["/users", "Usuários"],
  ["/downloads", "Downloads"],
  ["/settings/releases", "Versões"],
] as const;

export function Shell({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) router.replace("/login");
    else setReady(true);
  }, [router]);

  if (!ready) return null;
  return (
    <div className="min-h-screen">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <span className="font-bold tracking-wide">GIVOVA · Coleta</span>
          <nav className="flex flex-wrap gap-1 text-sm">
            {NAV.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className={`rounded px-2 py-1 ${path === href ? "bg-white/20" : "hover:bg-white/10"}`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <button
            className="ml-auto text-sm text-slate-300 hover:text-white"
            onClick={() => {
              setToken(null);
              router.replace("/login");
            }}
          >
            Sair
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{title}</h1>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </div>
        {children}
      </main>
    </div>
  );
}

export function Btn({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const styles = {
    primary: "bg-slate-900 text-white hover:bg-slate-700",
    secondary: "border border-slate-300 bg-white hover:bg-slate-100",
    danger: "bg-red-700 text-white hover:bg-red-600",
  }[variant];
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`rounded px-3 py-1.5 text-sm disabled:opacity-50 ${styles}`}>
      {children}
    </button>
  );
}

export const inputCls = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm";

const BADGE: Record<string, string> = {
  ONLINE: "bg-green-100 text-green-800",
  ACCEPTED: "bg-green-100 text-green-800",
  KNOWN: "bg-green-100 text-green-800",
  OPEN: "bg-green-100 text-green-800",
  ACTIVE: "bg-green-100 text-green-800",
  UNKNOWN: "bg-amber-100 text-amber-800",
  DUPLICATE: "bg-yellow-100 text-yellow-800",
  OFFLINE: "bg-slate-200 text-slate-700",
  CLOSED: "bg-slate-200 text-slate-700",
  DISABLED: "bg-red-100 text-red-800",
  REJECTED: "bg-red-100 text-red-800",
  SESSION_CLOSED: "bg-purple-100 text-purple-800",
  SESSION_NOT_FOUND: "bg-purple-100 text-purple-800",
  READY: "bg-green-100 text-green-800",
  PENDING: "bg-amber-100 text-amber-800",
  DISPATCHED: "bg-slate-200 text-slate-700",
  REVIEW: "bg-purple-100 text-purple-800",
  SCAN_IN: "bg-green-100 text-green-800",
  DISPATCH_OUT: "bg-slate-200 text-slate-700",
  ADJUSTMENT_IN: "bg-blue-100 text-blue-800",
  ADJUSTMENT_OUT: "bg-red-100 text-red-800",
};

export function Badge({ value }: { value: string }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${BADGE[value] ?? "bg-slate-100"}`}>{value}</span>;
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return <td className={`px-3 py-2 align-top ${mono ? "font-mono" : ""}`}>{children}</td>;
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>;
}

export function Card({ label, value, tone }: { label: string; value: ReactNode; tone?: "warn" | "bad" | "good" }) {
  const toneCls = tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : tone === "good" ? "text-green-700" : "";
  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}

export function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Btn
      variant="secondary"
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => setCopied(false));
      }}
    >
      {copied ? "Copiado" : label}
    </Btn>
  );
}
