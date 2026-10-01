"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { BrandMark, BrandName } from "@/components/brand";
import { getDeviceIdentity, DEFAULT_DEVICE_NAME } from "@/collector/identity";
import { api, ApiError, errorMessage, homeFor, setAuth, type SessionUser } from "@/lib/api";

interface LoginResponse {
  accessToken: string;
  userId: string;
  fullName: string;
  role: "ADMIN" | "OPERATOR";
  deviceId: string | null;
}

const DEVICE_PROBLEMS: Record<string, string> = {
  DEVICE_DISABLED: "Este navegador está desativado como coletor.",
  DEVICE_NOT_REGISTERED: "Este navegador não está cadastrado como coletor.",
};

/** Accepts only same-site paths for ?next= (no open redirects). */
function safeNext(): string | null {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") && next !== "/login" ? next : null;
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const device = getDeviceIdentity(window.localStorage);
    const call = (deviceId?: string) =>
      api<LoginResponse>("/api/auth/login", { method: "POST", body: { username, password, deviceId } });
    try {
      let res: LoginResponse;
      let deviceProblem: string | null = null;
      try {
        // Bind the token to this browser's collector id so it can send scans.
        res = await call(device.id);
      } catch (err) {
        if (!(err instanceof ApiError && err.code && err.code in DEVICE_PROBLEMS)) throw err;
        deviceProblem = DEVICE_PROBLEMS[err.code];
        res = await call(undefined); // admin panel still usable; collecting is not
      }
      if (deviceProblem && res.role !== "ADMIN") throw new Error(`${deviceProblem} Fale com o administrador.`);
      const user: SessionUser = { id: res.userId, fullName: res.fullName, role: res.role, deviceBound: !deviceProblem };
      setAuth(res.accessToken, user);
      if (!deviceProblem && device.name !== DEFAULT_DEVICE_NAME) {
        // Keep the friendly collector name in sync with the server (best effort).
        api("/api/device/profile", { method: "POST", body: { deviceId: device.id, name: device.name }, noRedirect: true })
          .catch(() => undefined);
      }
      router.replace(safeNext() ?? homeFor(user));
    } catch (err) {
      setError(err instanceof TypeError ? "Sem conexão com o servidor." : errorMessage(err));
      setBusy(false);
    }
  }

  const field =
    "mt-1.5 block h-12 w-full rounded-md border border-slate-300 bg-white px-3 text-base text-slate-900 " +
    "focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/30";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3">
          <BrandMark size={44} />
          <BrandName subtitle="Coleta & Expedição" />
        </div>
        <form onSubmit={submit} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm" noValidate>
          {error && (
            <div role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}
          <label className="block text-sm font-medium text-slate-700">
            Usuário
            <input className={field} value={username} onChange={(e) => setUsername(e.target.value)}
                   autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required />
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Senha
            <input className={field} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                   autoComplete="current-password" required />
          </label>
          <button
            type="submit"
            disabled={busy || !username || !password}
            className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-orange-600 text-sm font-bold tracking-wide text-white hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {busy ? "ENTRANDO..." : "ENTRAR"}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-500">Acesso restrito a colaboradores.</p>
      </div>
    </main>
  );
}
