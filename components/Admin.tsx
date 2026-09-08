"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ShieldCheck, Users, KeyRound, Plus, Pencil, Trash2 } from "lucide-react";
// primitives são .jsx sem tipos — TS inferiria todas as props como obrigatórias
import * as P from "./ui/primitives.jsx";
const { Card, Button, Modal, Field, TextInput, Badge, Spinner } =
  P as unknown as Record<string, React.ComponentType<Record<string, unknown>>>;
import * as F from "./ui/fields.jsx";
const { CheckboxField, FormError } = F as unknown as Record<string, React.ComponentType<Record<string, unknown>>>;
import { emailValido, issuesToFields, mensagemDeErro, texto } from "@/lib/formErrors.js";
import { useAuth } from "./AuthGate";
import {
  listUsers, createUser, updateUser, deleteUser,
  listRoles, createRole, updateRole, deleteRole,
  listPermissions,
  type AdminUserView, type AdminRoleView,
} from "@/services/financeApi";

// Tela Admin: CRUD de usuários e roles (RBAC), com permissions granulares (PBAC).
export default function Admin() {
  const { can, user: me } = useAuth();
  const [tab, setTab] = useState<"users" | "roles">(can("user:view") ? "users" : "roles");

  const [users, setUsers] = useState<AdminUserView[] | null>(null);
  const [roles, setRoles] = useState<AdminRoleView[] | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [u, r, p] = await Promise.all([
        can("user:view") ? listUsers() : Promise.resolve(null),
        can("role:view") ? listRoles() : Promise.resolve(null),
        can("role:view") ? listPermissions() : Promise.resolve({ permissions: [] as unknown as readonly string[] }),
      ]);
      setUsers(u);
      setRoles(r);
      setPermissions([...(p?.permissions ?? [])]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar");
    }
  }, [can]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <ShieldCheck size={20} /> Administração
          </h2>
          <p className="text-sm text-slate-400">Usuários, roles e permissions.</p>
        </div>
        <div className="flex gap-1.5 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5">
          {can("user:view") && (
            <TabButton active={tab === "users"} onClick={() => setTab("users")} icon={Users} label="Usuários" />
          )}
          {can("role:view") && (
            <TabButton active={tab === "roles"} onClick={() => setTab("roles")} icon={KeyRound} label="Roles" />
          )}
        </div>
      </header>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      {tab === "users" && (
        <UsersTab users={users} roles={roles} meId={me.id} canManage={can("user:manage")} onChanged={reload} />
      )}
      {tab === "roles" && (
        <RolesTab roles={roles} permissions={permissions} canManage={can("role:manage")} onChanged={reload} />
      )}
    </section>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: {
  active: boolean; onClick: () => void; icon: typeof Users; label: string;
}) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer ${
        active ? "bg-blue-500/20 text-blue-200 ring-1 ring-blue-500/40" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
      }`}>
      <Icon size={15} /> {label}
    </button>
  );
}

// ── Usuários ──────────────────────────────────────────────────────────────────

function UsersTab({ users, roles, meId, canManage, onChanged }: {
  users: AdminUserView[] | null;
  roles: AdminRoleView[] | null;
  meId: string;
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [novoOpen, setNovoOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUserView | null>(null);

  if (!users) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{users.length} usuário{users.length === 1 ? "" : "s"}</p>
        {canManage && <Button onClick={() => setNovoOpen(true)}><Plus size={16} /> Novo usuário</Button>}
      </div>

      <Card className="overflow-hidden">
        <ul className="divide-y divide-[var(--color-line)]">
          {users.map((u) => (
            <li key={u.id} className={`group flex items-center gap-3 px-5 py-3.5 ${!u.ativo ? "opacity-50" : ""}`}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-500/15 text-sm font-bold text-blue-300">
                {u.nome.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-200">
                  {u.nome}
                  {u.id === meId && <span className="ml-2 text-[11px] text-slate-500">(você)</span>}
                  {!u.ativo && <span className="ml-2 rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-rose-400">inativo</span>}
                </p>
                <p className="truncate text-xs text-slate-500">{u.email}</p>
              </div>
              <div className="hidden flex-wrap justify-end gap-1 sm:flex">
                {u.roles.map((r) => <Badge key={r.id} className="bg-white/5 text-slate-300">{r.nome}</Badge>)}
              </div>
              {canManage && (
                <>
                  <button onClick={() => setEditing(u)} aria-label={`Editar ${u.nome}`}
                    className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-200 cursor-pointer">
                    <Pencil size={15} />
                  </button>
                  {u.id !== meId && (
                    <button
                      onClick={async () => { await deleteUser(u.id); await onChanged(); }}
                      aria-label={`Excluir ${u.nome}`}
                      className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-rose-500/15 hover:text-rose-400 cursor-pointer">
                      <Trash2 size={15} />
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <UserModal open={novoOpen} onClose={() => setNovoOpen(false)} roles={roles ?? []} onSaved={onChanged} />
      <UserModal open={!!editing} user={editing} meId={meId} onClose={() => setEditing(null)} roles={roles ?? []} onSaved={onChanged} />
    </div>
  );
}

function UserModal({ open, onClose, user, meId, roles, onSaved }: {
  open: boolean;
  onClose: () => void;
  user?: AdminUserView | null;
  meId?: string;
  roles: AdminRoleView[];
  onSaved: () => Promise<void>;
}) {
  const editing = !!user;
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [ativo, setAtivo] = useState(true);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setNome(user?.nome ?? "");
    setEmail(user?.email ?? "");
    setSenha("");
    setAtivo(user?.ativo ?? true);
    setRoleIds(user?.roles.map((r) => r.id) ?? []);
    setError("");
    setErrors({});
  }, [open, user]);

  // Senha vazia na edição = manter a atual; na criação é obrigatória.
  function validar(): Record<string, string> {
    const e: Record<string, string> = {};
    const nomeErro = texto(nome, { obrigatorio: true, max: 80, campo: "O nome" });
    if (nomeErro) e.nome = nomeErro;
    if (!emailValido(email)) e.email = "Informe um email válido.";
    if ((!editing || senha) && senha.length < 6) e.senha = "A senha precisa de pelo menos 6 caracteres.";
    return e;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const errs = validar();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    setErrors({});
    try {
      if (editing && user) {
        await updateUser(user.id, {
          nome, email, ativo,
          roleIds,
          ...(senha ? { senha } : {}),
        });
      } else {
        await createUser({ nome, email, senha, roleIds });
      }
      await onSaved();
      onClose();
    } catch (err) {
      const doCampo = issuesToFields((err as { issues?: unknown[] })?.issues) as Record<string, string>;
      setErrors(doCampo);
      if (Object.keys(doCampo).length === 0) setError(mensagemDeErro(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={editing ? "Editar usuário" : "Novo usuário"}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError>{error}</FormError>
        <Field label="Nome" required error={errors.nome}>
          <TextInput value={nome} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNome(e.target.value)} autoFocus />
        </Field>
        <Field label="Email" required error={errors.email}>
          <TextInput type="email" value={email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)} />
        </Field>
        <Field label={editing ? "Nova senha" : "Senha"} hint={editing ? "deixe vazio pra manter" : "mínimo 6 caracteres"}
               required={!editing} error={errors.senha}>
          <TextInput type="password" value={senha} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSenha(e.target.value)}
            autoComplete="new-password" />
        </Field>

        <Field label="Roles" hint="usuário pode ter mais de uma">
          <div className="flex flex-wrap gap-1.5">
            {roles.map((r) => {
              const on = roleIds.includes(r.id);
              return (
                <button key={r.id} type="button"
                  onClick={() => setRoleIds(on ? roleIds.filter((id) => id !== r.id) : [...roleIds, r.id])}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                    on ? "bg-blue-500/20 text-blue-200 ring-1 ring-blue-500/40" : "bg-white/5 text-slate-400 hover:bg-white/10"
                  }`}>
                  {r.nome}
                </button>
              );
            })}
          </div>
        </Field>

        {editing && user && user.id !== meId && (
          <CheckboxField label="Conta ativa" checked={ativo} onChecked={setAtivo} />
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="ghost" type="button" className="flex-1" disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button type="submit" className="flex-1" loading={busy}>{editing ? "Salvar" : "Criar"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Roles ─────────────────────────────────────────────────────────────────────

function RolesTab({ roles, permissions, canManage, onChanged }: {
  roles: AdminRoleView[] | null;
  permissions: string[];
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [novoOpen, setNovoOpen] = useState(false);
  const [editing, setEditing] = useState<AdminRoleView | null>(null);

  if (!roles) return <Loading />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{roles.length} role{roles.length === 1 ? "" : "s"}</p>
        {canManage && <Button onClick={() => setNovoOpen(true)}><Plus size={16} /> Nova role</Button>}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {roles.map((r) => (
          <Card key={r.id} className="p-5">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-white">{r.nome}</p>
                <p className="text-xs text-slate-500">
                  {r.descricao || "sem descrição"} · {r.usuarios} usuário{r.usuarios === 1 ? "" : "s"}
                </p>
              </div>
              {canManage && (
                <div className="flex shrink-0 gap-1">
                  <button onClick={() => setEditing(r)} aria-label={`Editar ${r.nome}`}
                    className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-200 cursor-pointer">
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={async () => { await deleteRole(r.id); await onChanged(); }}
                    aria-label={`Excluir ${r.nome}`}
                    className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-rose-500/15 hover:text-rose-400 cursor-pointer">
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {r.permissions.length === 0
                ? <span className="text-xs text-slate-500">nenhuma permission</span>
                : r.permissions.map((p) => (
                  <Badge key={p} className={p === "*" ? "bg-amber-500/15 text-amber-300" : "bg-white/5 text-slate-300"}>
                    {p}
                  </Badge>
                ))}
            </div>
          </Card>
        ))}
      </div>

      <RoleModal open={novoOpen} onClose={() => setNovoOpen(false)} permissions={permissions} onSaved={onChanged} />
      <RoleModal open={!!editing} role={editing} onClose={() => setEditing(null)} permissions={permissions} onSaved={onChanged} />
    </div>
  );
}

function RoleModal({ open, onClose, role, permissions, onSaved }: {
  open: boolean;
  onClose: () => void;
  role?: AdminRoleView | null;
  permissions: string[];
  onSaved: () => Promise<void>;
}) {
  const editing = !!role;
  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [perms, setPerms] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNome(role?.nome ?? "");
    setDescricao(role?.descricao ?? "");
    setPerms(role?.permissions ?? []);
    setError(null);
  }, [open, role]);

  // catálogo agrupado por recurso + entrada de wildcard por grupo
  const grupos = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of permissions) {
      const recurso = p.split(":")[0];
      if (!map.has(recurso)) map.set(recurso, []);
      map.get(recurso)!.push(p);
    }
    return [...map.entries()];
  }, [permissions]);

  const toggle = (p: string) => setPerms(perms.includes(p) ? perms.filter((x) => x !== p) : [...perms, p]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editing && role) await updateRole(role.id, { nome, descricao: descricao || null, permissions: perms });
      else await createRole({ nome, descricao: descricao || null, permissions: perms });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title={editing ? "Editar role" : "Nova role"}>
      <form onSubmit={submit} className="space-y-4">
        <FormError>{error}</FormError>
        <Field label="Nome" required>
          <TextInput value={nome} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNome(e.target.value)} required autoFocus />
        </Field>
        <Field label="Descrição">
          <TextInput value={descricao} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDescricao(e.target.value)} />
        </Field>

        <Field label="Permissions" hint="wildcard: recurso:* cobre todas as ações do recurso; * cobre tudo">
          <div className="max-h-64 space-y-3 overflow-y-auto rounded-xl border border-[var(--color-line)] p-3">
            <PermChip p="*" on={perms.includes("*")} onToggle={() => toggle("*")} destaque />
            {grupos.map(([recurso, ps]) => (
              <div key={recurso}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{recurso}</p>
                <div className="flex flex-wrap gap-1.5">
                  <PermChip p={`${recurso}:*`} on={perms.includes(`${recurso}:*`)} onToggle={() => toggle(`${recurso}:*`)} destaque />
                  {ps.map((p) => (
                    <PermChip key={p} p={p} on={perms.includes(p)} onToggle={() => toggle(p)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Field>

        <div className="flex gap-2 pt-1">
          <Button variant="ghost" type="button" className="flex-1" disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button type="submit" className="flex-1" loading={busy}>{editing ? "Salvar" : "Criar"}</Button>
        </div>
      </form>
    </Modal>
  );
}

function PermChip({ p, on, onToggle, destaque }: { p: string; on: boolean; onToggle: () => void; destaque?: boolean }) {
  return (
    <button type="button" onClick={onToggle}
      className={`rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
        on
          ? destaque ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40" : "bg-blue-500/20 text-blue-200 ring-1 ring-blue-500/40"
          : "bg-white/5 text-slate-400 hover:bg-white/10"
      }`}>
      {p}
    </button>
  );
}

function Loading() {
  return (
    <Card className="grid place-items-center px-5 py-14">
      <Spinner className="h-6 w-6" />
    </Card>
  );
}
