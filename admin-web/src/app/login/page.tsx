"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Btn, ErrorBox, inputCls } from "@/components/ui";
import { api, errorMessage, setToken } from "@/lib/api";

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
    try {
      const res = await api<{ accessToken: string; role: string }>("/api/auth/login", {
        method: "POST",
        body: { username, password },
      });
      if (res.role !== "ADMIN") throw new Error("Acesso restrito a administradores");
      setToken(res.accessToken);
      router.replace("/dashboard");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded border border-slate-200 bg-white p-6">
        <h1 className="text-lg font-semibold">GIVOVA · Coleta — Admin</h1>
        <ErrorBox error={error} />
        <label className="block text-sm">
          Usuário
          <input className={`${inputCls} mt-1 w-full`} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </label>
        <label className="block text-sm">
          Senha
          <input type="password" className={`${inputCls} mt-1 w-full`} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <Btn type="submit" disabled={busy || !username || !password}>
          {busy ? "Entrando..." : "Entrar"}
        </Btn>
      </form>
    </div>
  );
}
