"use client";

import {
  AlertCircle, AlertTriangle, Barcode, Boxes, CalendarRange, Check, CheckCircle2, CircleDashed, Clock, Download,
  FileUp, Inbox, LayoutDashboard, ListChecks, Loader2, LogOut, Menu, Package, PackageCheck, ScanLine, ScanSearch,
  Search, Smartphone, Tag, Truck, Users, Wrench, X, XCircle, type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { BrandMark, BrandName } from "@/components/brand";
import { useConfirm } from "@/components/dialog";
import { pendingLogoutMessage } from "@/collector/logout";
import { openScanQueue } from "@/collector/store";
import { getToken, getUser, setToken, type SessionUser } from "@/lib/api";

// ---- navigation ---------------------------------------------------------------------------------

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Visible to operators too (read-only pages). */
  operator?: boolean;
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Operação",
    items: [
      { href: "/dashboard", label: "Painel", icon: LayoutDashboard },
      { href: "/estoque", label: "Estoque", icon: Boxes, operator: true },
      { href: "/cargas", label: "Cargas", icon: Truck, operator: true },
      { href: "/expedicoes", label: "Expedições", icon: PackageCheck, operator: true },
    ],
  },
  {
    section: "Controle",
    items: [
      { href: "/scans", label: "Leituras", icon: ListChecks },
      { href: "/barcodes/unknown", label: "Códigos desconhecidos", icon: ScanSearch },
      { href: "/importar", label: "Importar XML", icon: FileUp },
      { href: "/items", label: "Itens", icon: Package },
      { href: "/barcodes", label: "Códigos de barras", icon: Barcode },
    ],
  },
  {
    section: "Administração",
    items: [
      { href: "/sessions", label: "Sessões", icon: CalendarRange },
      { href: "/devices", label: "Coletores", icon: Smartphone },
      { href: "/users", label: "Usuários", icon: Users },
    ],
  },
  {
    section: "Sistema",
    items: [
      { href: "/downloads", label: "Instalação", icon: Download },
      { href: "/settings/releases", label: "Versões", icon: Tag },
      { href: "/settings/maintenance", label: "Manutenção", icon: Wrench },
    ],
  },
];

const OPERATOR_PATHS = ["/estoque", "/cargas", "/expedicoes"];

function activeHref(path: string): string | null {
  let best: string | null = null;
  for (const group of NAV) {
    for (const item of group.items) {
      if ((path === item.href || path.startsWith(item.href + "/")) && (!best || item.href.length > best.length)) best = item.href;
    }
  }
  return best;
}

function NavLinks({ user, path, onNavigate }: { user: SessionUser; path: string; onNavigate?: () => void }) {
  const active = activeHref(path);
  const admin = user.role === "ADMIN";
  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-5">
      <Link
        href="/coleta"
        onClick={onNavigate}
        className="flex h-12 items-center justify-center gap-2 rounded-md bg-orange-600 text-sm font-bold tracking-wide text-white shadow-sm hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
      >
        <ScanLine className="size-5" aria-hidden /> COLETAR
      </Link>
      {NAV.map((group) => {
        const items = group.items.filter((i) => admin || i.operator);
        if (!items.length) return null;
        return (
          <div key={group.section}>
            <div className="mb-1 px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{group.section}</div>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const isActive = active === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={isActive ? "page" : undefined}
                      className={`flex h-9 items-center gap-2.5 rounded-md px-3 text-sm ${
                        isActive
                          ? "bg-orange-50 font-semibold text-orange-800 shadow-[inset_3px_0_0_#ea580c]"
                          : "text-slate-700 hover:bg-slate-100 hover:text-slate-950"
                      }`}
                    >
                      <item.icon className={`size-4 shrink-0 ${isActive ? "text-orange-600" : "text-slate-400"}`} aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/** Logout that never silently abandons scans queued in this browser. */
function useLogout() {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const logout = async () => {
    let pending = 0;
    try {
      pending = await (await openScanQueue()).pendingCount();
    } catch {
      /* no queue on this browser */
    }
    const warning = pendingLogoutMessage(pending);
    if (warning) {
      const r = await confirm({
        title: "Leituras pendentes",
        message: `${warning} Elas continuam salvas neste aparelho e serão enviadas no próximo login.`,
        confirmLabel: "Sair mesmo assim",
        tone: "danger",
      });
      if (!r.ok) return;
    }
    setToken(null);
    router.replace("/login");
  };
  return { logout, dialog };
}

export function Shell({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const router = useRouter();
  const path = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [drawer, setDrawer] = useState(false);
  const { logout, dialog } = useLogout();

  useEffect(() => {
    const u = getUser();
    if (!getToken() || !u) {
      setToken(null); // tokens from before user metadata existed: log in again
      router.replace(`/login?next=${encodeURIComponent(path)}`);
    } else if (u.role !== "ADMIN" && !OPERATOR_PATHS.some((p) => path === p || path.startsWith(p + "/"))) {
      router.replace("/coleta");
    } else setUser(u);
  }, [router, path]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  if (!user) return null;

  const account = (
    <div className="flex items-center gap-2 border-t border-slate-200 px-3 pt-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">
        {user.fullName.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{user.fullName}</span>
        <span className="block text-xs text-slate-500">{user.role === "ADMIN" ? "Administrador" : "Operador"}</span>
      </span>
      <button
        onClick={() => void logout()}
        aria-label="Sair"
        title="Sair"
        className="inline-flex size-9 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      >
        <LogOut className="size-4" aria-hidden />
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 items-center gap-2.5 px-4">
          <BrandMark size={32} />
          <BrandName subtitle="Coleta & Expedição" />
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
          <NavLinks user={user} path={path} />
        </div>
        <div className="pb-3">{account}</div>
      </aside>

      {/* mobile top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-slate-200 bg-white px-3 lg:hidden">
        <button
          onClick={() => setDrawer(true)}
          aria-label="Abrir menu"
          aria-expanded={drawer}
          className="inline-flex size-10 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100"
        >
          <Menu className="size-5" aria-hidden />
        </button>
        <BrandMark size={28} />
        <span className="text-sm font-extrabold tracking-[0.14em]">GIVOVA</span>
        <Link href="/coleta" className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-md bg-orange-600 px-3 text-xs font-bold text-white hover:bg-orange-700">
          <ScanLine className="size-4" aria-hidden /> COLETAR
        </Link>
      </header>

      {/* mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-30 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-slate-950/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(18rem,85vw)] flex-col bg-white shadow-xl">
            <div className="flex h-14 items-center gap-2 px-3">
              <BrandMark size={28} />
              <BrandName />
              <button onClick={() => setDrawer(false)} aria-label="Fechar menu" className="ml-auto inline-flex size-10 items-center justify-center rounded-md hover:bg-slate-100">
                <X className="size-5" aria-hidden />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
              <NavLinks user={user} path={path} onNavigate={() => setDrawer(false)} />
            </div>
            <div className="pb-3">{account}</div>
          </div>
        </div>
      )}

      <main className="lg:pl-60">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:py-7">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">{title}</h1>
              {description && <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>}
            </div>
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
          </div>
          {children}
        </div>
      </main>
      {dialog}
    </div>
  );
}

// ---- primitives ---------------------------------------------------------------------------------

type BtnVariant = "primary" | "secondary" | "danger" | "ghost" | "dark";

const BTN: Record<BtnVariant, string> = {
  primary: "bg-orange-600 text-white hover:bg-orange-700 focus-visible:outline-orange-600",
  dark: "bg-slate-900 text-white hover:bg-slate-800 focus-visible:outline-slate-900",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:outline-slate-400",
  danger: "bg-red-700 text-white hover:bg-red-800 focus-visible:outline-red-700",
  ghost: "text-slate-700 hover:bg-slate-100 focus-visible:outline-slate-400",
};

export function Btn({
  children,
  onClick,
  variant = "primary",
  type = "button",
  disabled,
  icon: Icon,
  size = "md",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: BtnVariant;
  type?: "button" | "submit";
  disabled?: boolean;
  icon?: LucideIcon;
  size?: "sm" | "md" | "lg";
  title?: string;
}) {
  const sizeCls = size === "sm" ? "h-8 px-2.5 text-xs" : size === "lg" ? "h-12 px-5 text-sm" : "h-10 px-3.5 text-sm";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-45 ${sizeCls} ${BTN[variant]}`}
    >
      {Icon && <Icon className="size-4" aria-hidden />}
      {children}
    </button>
  );
}

export const inputCls =
  "h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 " +
  "focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/25";

export function SearchInput({ value, onChange, placeholder, className = "" }: {
  value: string; onChange: (v: string) => void; placeholder: string; className?: string;
}) {
  return (
    <label className={`relative block ${className}`}>
      <span className="sr-only">{placeholder}</span>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${inputCls} w-full pl-9`}
      />
    </label>
  );
}

type Tone = "success" | "warning" | "danger" | "neutral" | "info" | "review";

const TONE: Record<Tone, string> = {
  success: "bg-green-50 text-green-800 ring-green-600/20",
  warning: "bg-amber-50 text-amber-900 ring-amber-600/25",
  danger: "bg-red-50 text-red-800 ring-red-600/20",
  neutral: "bg-slate-100 text-slate-700 ring-slate-500/15",
  info: "bg-sky-50 text-sky-800 ring-sky-600/20",
  review: "bg-purple-50 text-purple-800 ring-purple-600/20",
};

const TONE_ICON: Record<Tone, LucideIcon> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  neutral: CircleDashed,
  info: Clock,
  review: AlertCircle,
};

/** Every status value shown in the panel: Portuguese label + tone + icon (never color alone). */
const STATUS: Record<string, [string, Tone]> = {
  READY: ["PRONTA", "success"],
  PENDING: ["PENDENTE", "warning"],
  DISPATCHED: ["EXPEDIDA", "neutral"],
  REVIEW: ["REVISAR", "review"],
  ONLINE: ["ONLINE", "success"],
  OFFLINE: ["OFFLINE", "neutral"],
  DISABLED: ["DESATIVADO", "danger"],
  ACTIVE: ["ATIVO", "success"],
  OPEN: ["ABERTA", "success"],
  CLOSED: ["ENCERRADA", "neutral"],
  ACCEPTED: ["ACEITA", "success"],
  KNOWN: ["CONHECIDO", "success"],
  UNKNOWN: ["NÃO ENCONTRADO", "warning"],
  DUPLICATE: ["DUPLICADA", "neutral"],
  REJECTED: ["REJEITADA", "danger"],
  SESSION_CLOSED: ["SESSÃO ENCERRADA", "review"],
  SESSION_NOT_FOUND: ["SESSÃO INEXISTENTE", "review"],
  SCAN_IN: ["ENTRADA", "success"],
  DISPATCH_OUT: ["EXPEDIÇÃO", "neutral"],
  ADJUSTMENT_IN: ["AJUSTE +", "info"],
  ADJUSTMENT_OUT: ["AJUSTE −", "danger"],
};

export function Badge({ value, label, tone }: { value: string; label?: string; tone?: Tone }) {
  const [text, t] = STATUS[value] ?? [value, "neutral" as Tone];
  const finalTone = tone ?? t;
  const Icon = TONE_ICON[finalTone];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-bold ring-1 ring-inset ${TONE[finalTone]}`}>
      <Icon className="size-3" aria-hidden />
      {label ?? text}
    </span>
  );
}

export function Table({ head, children, empty, minWidth = 640, bare }: {
  head: (string | { label: string; align?: "left" | "right" | "center"; className?: string })[];
  children: ReactNode;
  empty?: ReactNode;
  minWidth?: number;
  /** Inside a Panel: no own border/radius. */
  bare?: boolean;
}) {
  const hasRows = Array.isArray(children) ? children.flat().some(Boolean) : !!children;
  return (
    <div className={bare ? "overflow-hidden bg-white" : "overflow-hidden rounded-lg border border-slate-200 bg-white"}>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-left text-sm" style={{ minWidth }}>
          <thead className="sticky top-0 z-10 bg-slate-50 shadow-[inset_0_-1px_0_#e2e8f0]">
            <tr>
              {head.map((h, i) => {
                const col = typeof h === "string" ? { label: h } : h;
                return (
                  <th key={i} scope="col"
                      className={`whitespace-nowrap px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""} ${col.className ?? ""}`}>
                    {col.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 [&>tr:hover]:bg-slate-50/70">{children}</tbody>
        </table>
      </div>
      {!hasRows && empty}
    </div>
  );
}

export function Td({ children, mono, align, className = "" }: {
  children: ReactNode; mono?: boolean; align?: "left" | "right" | "center"; className?: string;
}) {
  return (
    <td className={`px-3 py-2.5 align-top ${mono ? "font-mono text-[13px]" : ""} ${align === "right" ? "text-right tabular-nums" : align === "center" ? "text-center" : ""} ${className}`}>
      {children}
    </td>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
      <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{error}</span>
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: {
  icon?: LucideIcon; title: string; description?: string; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <Icon className="size-8 text-slate-300" aria-hidden />
      <p className="mt-2 text-sm font-semibold text-slate-700">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading({ label = "Carregando..." }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

/** KPI tile. `tone` colors only the number; the label always states what it is. */
export function Card({ label, value, tone, icon: Icon, hint, href }: {
  label: string; value: ReactNode; tone?: "warn" | "bad" | "good"; icon?: LucideIcon; hint?: ReactNode; href?: string;
}) {
  const toneCls = tone === "bad" ? "text-red-700" : tone === "warn" ? "text-amber-700" : tone === "good" ? "text-green-700" : "text-slate-950";
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</span>
        {Icon && <Icon className="size-4 text-slate-400" aria-hidden />}
      </div>
      <div className={`mt-2 text-3xl font-bold tabular-nums tracking-tight ${toneCls}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </>
  );
  const cls = "block rounded-lg border border-slate-200 bg-white p-4";
  return href ? (
    <Link href={href} className={`${cls} hover:border-orange-300 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-orange-600`}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Panel({ title, actions, children, className = "" }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-slate-900">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Btn
      variant="secondary"
      size="sm"
      icon={copied ? Check : undefined}
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

/** Logged-in user (client only); pages use it to hide admin-only actions from operators. */
export function useCurrentUser(): SessionUser | null {
  const [user, setUser] = useState<SessionUser | null>(null);
  useEffect(() => setUser(getUser()), []);
  return user;
}
