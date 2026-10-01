"use client";

import { useEffect, useState } from "react";
import { useConfirm } from "@/components/dialog";
import { ErrorBox, inputCls, Shell, Table, Td } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

const CONFIRMATION = "RESETAR DADOS";

const LABELS: Record<string, string> = {
  loads: "Cargas",
  invoices: "Notas fiscais",
  invoice_items: "Itens de notas",
  load_items: "Requisitos de cargas",
  inventory_movements: "Movimentações de estoque (inclui expedições)",
  inventory_balances: "Saldos de estoque",
  scans: "Leituras",
  barcodes: "Códigos lidos / desconhecidos",
  products: "Produtos importados de XML",
};

/** Homologation / maintenance tool (ADMIN only; the API enforces role, confirmation and ALLOW_OPERATIONAL_RESET). */
export default function MaintenancePage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm: ask, dialog } = useConfirm();

  useEffect(() => {
    api<{ operationalResetEnabled: boolean }>("/api/admin/maintenance")
      .then((s) => setEnabled(s.operationalResetEnabled))
      .catch((e) => setError(errorMessage(e)));
  }, []);

  async function reset() {
    if (typed !== CONFIRMATION) return;
    const r = await ask({ title: "Resetar dados operacionais?", tone: "danger", confirmLabel: "Resetar agora",
      message: "Cargas, notas, estoque, expedições e leituras serão removidos. Esta ação não pode ser desfeita." });
    if (!r.ok) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ deleted: Record<string, number> }>("/api/admin/maintenance/reset-operational-data", {
        method: "POST",
        body: { confirmation: typed },
      });
      setResult(r.deleted);
      setTyped("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Configurações › Manutenção">
      <ErrorBox error={error} />
      <section className="max-w-2xl rounded border-2 border-red-300 bg-white p-5">
        <div className="mb-2 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
          FERRAMENTA DE HOMOLOGAÇÃO
        </div>
        <h2 className="text-lg font-semibold text-red-800">Resetar dados operacionais</h2>
        <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-900">
          Esta ação remove cargas, notas, estoque, expedições e leituras. Usuários, coletores e configurações serão
          mantidos.
        </p>
        <p className="mt-2 text-xs text-slate-600">
          Também remove produtos criados pela importação de XML. Mantidos: usuários, coletores, sessões, versões/downloads,
          produtos cadastrados manualmente e o registro de auditoria. Leituras ainda pendentes nos coletores (offline)
          serão enviadas depois do reset; sincronize os coletores antes.
        </p>

        {enabled === false ? (
          <p className="mt-4 text-sm font-semibold text-slate-700">
            Desativado neste ambiente (ALLOW_OPERATIONAL_RESET=false).
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            <label className="block text-sm">
              Para confirmar, digite <b className="font-mono">{CONFIRMATION}</b>:
              <input className={`${inputCls} mt-1 block w-64 font-mono`} value={typed} onChange={(e) => setTyped(e.target.value)} />
            </label>
            <button
              onClick={reset}
              disabled={busy || typed !== CONFIRMATION || enabled !== true}
              className="rounded bg-red-700 px-4 py-3 text-sm font-bold text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "RESETANDO..." : "RESETAR DADOS OPERACIONAIS"}
            </button>
          </div>
        )}
      </section>

      {result && (
        <section className="mt-6 max-w-2xl">
          <h2 className="mb-2 font-semibold text-green-800">Reset concluído — registros removidos</h2>
          <Table head={["Dado", "Removidos"]}>
            {Object.entries(result).map(([k, v]) => (
              <tr key={k}><Td>{LABELS[k] ?? k}</Td><Td>{v}</Td></tr>
            ))}
          </Table>
        </section>
      )}
      {dialog}
    </Shell>
  );
}
