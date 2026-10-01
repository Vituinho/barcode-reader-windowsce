"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Btn, ErrorBox, inputCls, Shell, Table, Td } from "@/components/ui";
import { api, errorMessage, fmtBytes, fmtDateTime } from "@/lib/api";
import type { Platform, SoftwareRelease } from "@/lib/types";

const EMPTY = {
  platform: "WINDOWS_DESKTOP" as Platform,
  version: "",
  fileName: "",
  downloadUrl: "",
  sha256: "",
  fileSize: "",
  releaseNotes: "",
  active: true,
};

/** ADMIN only (API enforces it). Binaries are hosted externally; only metadata + https URL are stored. */
export default function ReleasesPage() {
  const [releases, setReleases] = useState<SoftwareRelease[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReleases(await api<SoftwareRelease[]>("/api/admin/releases"));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function call(path: string, method: string, body?: unknown) {
    try {
      await api(path, { method, body });
      setError(null);
      await load();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  }

  async function save() {
    const payload = {
      version: form.version.trim(),
      fileName: form.fileName.trim(),
      downloadUrl: form.downloadUrl.trim(),
      sha256: form.sha256.trim() || null,
      fileSize: form.fileSize.trim() ? Number(form.fileSize) : null,
      releaseNotes: form.releaseNotes.trim() || null,
    };
    const ok = editingId
      ? await call(`/api/admin/releases/${editingId}`, "PATCH", payload)
      : await call("/api/admin/releases", "POST", { ...payload, platform: form.platform, active: form.active });
    if (ok) {
      setForm(EMPTY);
      setEditingId(null);
    }
  }

  function edit(r: SoftwareRelease) {
    setEditingId(r.id);
    setForm({
      platform: r.platform,
      version: r.version,
      fileName: r.fileName,
      downloadUrl: r.downloadUrl,
      sha256: r.sha256 ?? "",
      fileSize: r.fileSize?.toString() ?? "",
      releaseNotes: r.releaseNotes ?? "",
      active: r.active,
    });
  }

  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <Shell title="Versões do coletor">
      <ErrorBox error={error} />
      <div className="mb-4 rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-semibold">{editingId ? "Editar versão" : "Nova versão"}</h2>
        <div className="grid gap-2 md:grid-cols-2">
          <label className="text-sm">
            Plataforma
            <select className={`${inputCls} mt-1 w-full`} value={form.platform} onChange={set("platform")} disabled={!!editingId}>
              <option value="WINDOWS_DESKTOP">WINDOWS_DESKTOP (simulador)</option>
              <option value="WINDOWS_CE">WINDOWS_CE (coletor)</option>
            </select>
          </label>
          <label className="text-sm">
            Versão (x.y.z)
            <input className={`${inputCls} mt-1 w-full`} placeholder="1.0.0" value={form.version} onChange={set("version")} />
          </label>
          <label className="text-sm">
            Nome do arquivo
            <input className={`${inputCls} mt-1 w-full`} placeholder="GivovaCollector-Simulator-v1.0.0.zip" value={form.fileName} onChange={set("fileName")} />
          </label>
          <label className="text-sm">
            URL de download (https)
            <input className={`${inputCls} mt-1 w-full`} placeholder="https://github.com/.../releases/download/..." value={form.downloadUrl} onChange={set("downloadUrl")} />
          </label>
          <label className="text-sm">
            SHA-256
            <input className={`${inputCls} mt-1 w-full font-mono`} value={form.sha256} onChange={set("sha256")} />
          </label>
          <label className="text-sm">
            Tamanho (bytes)
            <input className={`${inputCls} mt-1 w-full`} inputMode="numeric" value={form.fileSize} onChange={set("fileSize")} />
          </label>
          <label className="text-sm md:col-span-2">
            Notas da versão
            <textarea className={`${inputCls} mt-1 w-full`} rows={3} value={form.releaseNotes} onChange={set("releaseNotes")} />
          </label>
          {!editingId && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Marcar como versão atual da plataforma
            </label>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <Btn onClick={save} disabled={!form.version || !form.fileName || !form.downloadUrl}>
            {editingId ? "Salvar alterações" : "Cadastrar versão"}
          </Btn>
          {editingId && (
            <Btn variant="secondary" onClick={() => { setEditingId(null); setForm(EMPTY); }}>Cancelar</Btn>
          )}
        </div>
      </div>

      <Table head={["Plataforma", "Versão", "Arquivo", "Tamanho", "SHA-256", "Data", "Status", ""]}>
        {releases.map((r) => (
          <tr key={r.id}>
            <Td>{r.platform}</Td>
            <Td mono>{r.version}</Td>
            <Td mono>{r.fileName}</Td>
            <Td>{fmtBytes(r.fileSize)}</Td>
            <Td mono>{r.sha256 ? `${r.sha256.slice(0, 12)}…` : "—"}</Td>
            <Td>{fmtDateTime(r.releasedAt)}</Td>
            <Td><Badge value={r.active ? "ACTIVE" : "DISABLED"} /></Td>
            <Td>
              <div className="flex gap-1">
                <Btn variant="secondary" onClick={() => edit(r)}>Editar</Btn>
                {r.active ? (
                  <Btn variant="secondary" onClick={() => call(`/api/admin/releases/${r.id}/deactivate`, "POST")}>Desativar</Btn>
                ) : (
                  <Btn variant="secondary" onClick={() => call(`/api/admin/releases/${r.id}/activate`, "POST")}>Ativar</Btn>
                )}
              </div>
            </Td>
          </tr>
        ))}
      </Table>
      <p className="mt-2 text-xs text-slate-500">
        Apenas uma versão ativa por plataforma: ativar uma versão desativa a anterior. Os arquivos ficam hospedados fora do
        sistema (ex.: GitHub Releases); aqui ficam só os metadados.
      </p>
    </Shell>
  );
}
