"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Btn, ErrorBox, inputCls, Shell } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatProgrammingDate, todayIso, weekdayOf } from "@/lib/programming";
import type { Programming } from "@/lib/types";

export default function NewProgrammingPage() {
  const router = useRouter();
  const [day, setDay] = useState(todayIso);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const p = await api<Programming>("/api/programmings", { method: "POST", body: { scheduledDate: day, name: name.trim() || null } });
      router.replace(`/programacoes/${p.id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Shell
      title="Nova programação"
      actions={<Link href="/programacoes" className="inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"><ArrowLeft className="size-4" aria-hidden /> Programações</Link>}
    >
      <ErrorBox error={error} />
      <form
        className="max-w-lg space-y-5 rounded-lg border border-slate-200 bg-white p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (day) void create();
        }}
      >
        <label className="block text-sm font-medium text-slate-700">
          Data da programação
          <input type="date" required className={`${inputCls} mt-1.5 block h-12 w-full text-base`} value={day} onChange={(e) => setDay(e.target.value)} />
          {day && <span className="mt-1 block text-xs text-slate-500">{formatProgrammingDate(day)}, {weekdayOf(day)}</span>}
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Nome (opcional)
          <input className={`${inputCls} mt-1.5 block w-full`} maxLength={150} placeholder="Ex.: Turno da manhã" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <p className="text-sm text-slate-600">Depois de criar, importe o ZIP ou RAR com os XML das cargas na página da programação.</p>
        <Btn type="submit" disabled={busy || !day}>{busy ? "Criando…" : "Criar programação"}</Btn>
      </form>
    </Shell>
  );
}
