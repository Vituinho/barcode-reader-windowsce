"use client";

import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "@/components/dialog";
import { Badge, Btn, ErrorBox, inputCls, Shell, Table, Td } from "@/components/ui";
import { api, errorMessage, fmtDateTime } from "@/lib/api";
import type { User } from "@/lib/types";

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [form, setForm] = useState({ username: "", fullName: "", password: "", role: "OPERATOR" });
  const [error, setError] = useState<string | null>(null);
  const { confirm: ask, dialog } = useConfirm();

  const load = useCallback(async () => {
    try {
      setUsers(await api<User[]>("/api/admin/users"));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function call(path: string, method: string, body: unknown) {
    try {
      await api(path, { method, body });
      setError(null);
      load();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    }
  }

  return (
    <Shell title="Usuários" description="Operadores acessam o coletor, estoque e cargas. Administradores acessam todo o painel.">
      <ErrorBox error={error} />
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await call("/api/admin/users", "POST", form)) setForm({ username: "", fullName: "", password: "", role: "OPERATOR" });
        }}
      >
        <input className={inputCls} placeholder="Usuário (login)" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <input className={inputCls} placeholder="Nome" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        <input className={inputCls} type="password" placeholder="Senha (6+)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <select className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="OPERATOR">Operador</option>
          <option value="ADMIN">Administrador</option>
        </select>
        <Btn type="submit" disabled={!form.username || !form.fullName || form.password.length < 6}>Criar usuário</Btn>
      </form>
      <Table head={["Nome", "Usuário", "Perfil", "Status", "Criado", ""]}>
        {users.map((u) => (
          <tr key={u.id}>
            <Td>{u.fullName}</Td>
            <Td mono>{u.username}</Td>
            <Td>{u.role}</Td>
            <Td><Badge value={u.isActive ? "ACTIVE" : "DISABLED"} /></Td>
            <Td>{fmtDateTime(u.createdAt)}</Td>
            <Td>
              <div className="flex gap-1">
                <Btn variant="secondary" onClick={() => call(`/api/admin/users/${u.id}`, "PATCH", { isActive: !u.isActive })}>
                  {u.isActive ? "Desativar" : "Ativar"}
                </Btn>
                <Btn
                  variant="secondary"
                  onClick={() => {
                    void (async () => {
                      const r = await ask({ title: `Nova senha para ${u.username}`, confirmLabel: "Redefinir senha",
                        message: "Mínimo de 6 caracteres. Informe a nova senha ao usuário por um canal seguro.",
                        input: { label: "Nova senha", type: "password", required: true } });
                      if (r.ok) void call(`/api/admin/users/${u.id}`, "PATCH", { password: r.value });
                    })();
                  }}
                >
                  Redefinir senha
                </Btn>
              </div>
            </Td>
          </tr>
        ))}
      </Table>
      {dialog}
    </Shell>
  );
}
