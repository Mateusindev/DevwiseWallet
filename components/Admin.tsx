"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
// primitives são .jsx sem tipos — TS inferiria todas as props como obrigatórias
import * as P from "./ui/primitives.jsx";
const { Card, Button, IconButton, Modal, Field, TextInput, Badge, Skeleton, SkeletonList, PageHeader, EmptyState } =
  P as unknown as Record<string, React.ComponentType<Record<string, unknown>>>;
import * as F from "./ui/fields.jsx";
const { CheckboxField, FormError } = F as unknown as Record<string, React.ComponentType<Record<string, unknown>>>;
import { emailValido, issuesToFields, mensagemDeErro, texto } from "@/lib/formErrors.js";
import { useAuth } from "./AuthGate";
import {
  getAdminBootstrap, createUser, updateUser, deleteUser,
  createRole, updateRole, deleteRole,
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

  // Uma chamada só: o servidor paraleliza users/roles/permissions e já respeita
  // a permission de cada parte. Três leituras em paralelo aqui virariam três
  // sequenciais — o dispatcher de Server Actions é serial por cliente.
  const reload = useCallback(async () => {
    setError(null);
    try {
      const b = await getAdminBootstrap();
      setUsers(b.users);
      setRoles(b.roles);
      setPermissions([...b.permissions]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar");
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return (
    <section className="space-y-8">
      <PageHeader
        title="Admin"
        description="Quem acessa a conta e o que cada papel pode fazer."
        actions={
          <div role="tablist" aria-label="Área do admin" className="flex gap-1 rounded-xl bg-veu/[0.05] p-1">
            {can("user:view") && (
              <TabButton active={tab === "users"} onClick={() => setTab("users")} label="Usuários" />
            )}
            {can("role:view") && (
              <TabButton active={tab === "roles"} onClick={() => setTab("roles")} label="Roles" />
            )}
          </div>
        }
      />

      {error && <FormError>{error}</FormError>}

      {tab === "users" && (
        <UsersTab users={users} roles={roles} meId={me.id} canManage={can("user:manage")} onChanged={reload} />
      )}
      {tab === "roles" && (
        <RolesTab roles={roles} permissions={permissions} canManage={can("role:manage")} onChanged={reload} />
      )}
    </section>
  );
}

// Trilho segmentado: a aba ativa é uma pílula de superfície, não um acento.
function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} role="tab" aria-selected={active}
      className={`h-8 rounded-lg px-3.5 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
        active ? "bg-[var(--color-surface)] text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-slate-400 hover:text-ink"
      }`}>
      {label}
    </button>
  );
}

function iniciais(nome: string) {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  return ((p[0]?.[0] ?? "?") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}

// Mesmas colunas no cabeçalho e nas linhas (a partir de sm). Abaixo disso a
// linha vira duas: nome/email em cima, papéis embaixo — nada rola de lado.
const COLS_USUARIO = "sm:grid sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1.3fr)_5.5rem_4.5rem] sm:items-center sm:gap-4";

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold leading-7 text-ink">Usuários</h2>
          <p className="tnum text-[13px] text-slate-500">
            {users.length} {users.length === 1 ? "usuário" : "usuários"} · {users.filter((u) => u.ativo).length} ativos
          </p>
        </div>
        {canManage && <Button onClick={() => setNovoOpen(true)}><Plus size={16} /> Novo usuário</Button>}
      </div>

      <Card className="px-5 py-2 sm:px-6">
        {/* cabeçalho: cinza, sentence case, sem faixa */}
        <div className={`hidden py-2.5 text-[13px] text-slate-500 ${COLS_USUARIO}`}>
          <span>Nome</span><span>Roles</span><span>Status</span><span className="sr-only">Ações</span>
        </div>
        <ul className="divide-y divide-[var(--color-line)] sm:border-t sm:border-[var(--color-line)]">
          {users.map((u) => (
            <li key={u.id} className={`flex flex-col gap-2 py-3.5 ${COLS_USUARIO}`}>
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-500/15 text-xs font-semibold text-blue-300">
                  {iniciais(u.nome)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
                    <span className="truncate">{u.nome}</span>
                    {u.id === meId && <Badge tone="neutral">você</Badge>}
                  </p>
                  <p className="truncate text-[13px] text-slate-500">{u.email}</p>
                </div>
                {/* no celular as ações ficam na própria linha do nome */}
                {canManage && <AcoesUsuario u={u} meId={meId} onEdit={() => setEditing(u)} onChanged={onChanged} className="flex sm:hidden" />}
              </div>
              <div className="flex min-w-0 flex-wrap gap-1.5 pl-11 sm:pl-0">
                {u.roles.length === 0
                  ? <span className="text-[13px] text-slate-500">—</span>
                  : u.roles.map((r) => <Badge key={r.id} tone="neutral">{r.nome}</Badge>)}
                {!u.ativo && <Badge tone="neg" className="sm:hidden">Inativo</Badge>}
              </div>
              <div className="hidden sm:block">
                {u.ativo ? <Badge tone="pos">Ativo</Badge> : <Badge tone="neg">Inativo</Badge>}
              </div>
              {canManage
                ? <AcoesUsuario u={u} meId={meId} onEdit={() => setEditing(u)} onChanged={onChanged} className="hidden sm:flex" />
                : <span className="hidden sm:block" />}
            </li>
          ))}
        </ul>
      </Card>

      <UserModal open={novoOpen} onClose={() => setNovoOpen(false)} roles={roles ?? []} onSaved={onChanged} />
      <UserModal open={!!editing} user={editing} meId={meId} onClose={() => setEditing(null)} roles={roles ?? []} onSaved={onChanged} />
    </div>
  );
}

function AcoesUsuario({ u, meId, onEdit, onChanged, className = "" }: {
  u: AdminUserView; meId: string; onEdit: () => void; onChanged: () => Promise<void>; className?: string;
}) {
  return (
    <div className={`shrink-0 items-center justify-end gap-1 ${className}`}>
      <IconButton onClick={onEdit} aria-label={`Editar ${u.nome}`}>
        <Pencil size={15} />
      </IconButton>
      {u.id !== meId && (
        <IconButton
          tone="danger"
          onClick={async () => { await deleteUser(u.id); await onChanged(); }}
          aria-label={`Excluir ${u.nome}`}>
          <Trash2 size={15} />
        </IconButton>
      )}
    </div>
  );
}

// Rodapé dos modais: ações à direita, empilhadas (principal por cima) no celular.
function Rodape({ busy, onCancel, children }: { busy: boolean; onCancel: () => void; children: React.ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-line)] pt-4 sm:flex-row sm:justify-end">
      <Button variant="ghost" type="button" className="w-full sm:w-auto" disabled={busy} onClick={onCancel}>Cancelar</Button>
      <Button type="submit" className="w-full sm:w-auto sm:min-w-28" loading={busy}>{children}</Button>
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
        <Field label={editing ? "Nova senha" : "Senha"} hint={editing ? "Deixe vazio pra manter a atual." : "Mínimo de 6 caracteres."}
               required={!editing} error={errors.senha}>
          <TextInput type="password" value={senha} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSenha(e.target.value)}
            autoComplete="new-password" />
        </Field>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-200">Roles</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Roles do usuário">
            {roles.map((r) => {
              const on = roleIds.includes(r.id);
              return (
                <button key={r.id} type="button" aria-pressed={on}
                  onClick={() => setRoleIds(on ? roleIds.filter((id) => id !== r.id) : [...roleIds, r.id])}
                  className={`h-9 rounded-lg px-3 text-[13px] font-medium transition-colors cursor-pointer ${
                    on ? "bg-ink text-[var(--color-on-ink)]" : "border border-[var(--color-line-strong)] text-slate-300 hover:bg-veu/[0.05] hover:text-ink"
                  }`}>
                  {r.nome}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[13px] text-slate-500">Um usuário pode ter mais de uma.</p>
        </div>

        {editing && user && user.id !== meId && (
          <CheckboxField label="Conta ativa" checked={ativo} onChecked={setAtivo} />
        )}

        <Rodape busy={busy} onCancel={onClose}>{editing ? "Salvar" : "Criar usuário"}</Rodape>
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold leading-7 text-ink">Roles</h2>
          <p className="tnum text-[13px] text-slate-500">{roles.length} {roles.length === 1 ? "papel" : "papéis"} · autorização sempre por permission</p>
        </div>
        {canManage && <Button onClick={() => setNovoOpen(true)}><Plus size={16} /> Nova role</Button>}
      </div>

      {roles.length === 0 && <EmptyState title="Nenhuma role cadastrada" description="Crie um papel e escolha as permissions dele." />}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {roles.map((r) => (
          <Card key={r.id} className="flex flex-col p-5 sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-[15px] font-semibold text-ink">{r.nome}</h3>
                <p className="text-[13px] text-slate-500">
                  {r.descricao || "Sem descrição"} · <span className="tnum">{r.usuarios}</span> {r.usuarios === 1 ? "usuário" : "usuários"}
                </p>
              </div>
              {canManage && (
                <div className="flex shrink-0 gap-1">
                  <IconButton onClick={() => setEditing(r)} aria-label={`Editar ${r.nome}`}>
                    <Pencil size={15} />
                  </IconButton>
                  <IconButton
                    tone="danger"
                    onClick={async () => { await deleteRole(r.id); await onChanged(); }}
                    aria-label={`Excluir ${r.nome}`}>
                    <Trash2 size={15} />
                  </IconButton>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {r.permissions.length === 0
                ? <span className="text-[13px] text-slate-500">Nenhuma permission.</span>
                : r.permissions.map((p) => (
                  // wildcard total é o único que merece cor: é o que dá tudo
                  <Badge key={p} tone={p === "*" ? "warn" : "neutral"}>{p}</Badge>
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

        <Field label="Permissions" hint="recurso:* cobre todas as ações do recurso; * cobre tudo.">
          <div className="max-h-72 space-y-4 overflow-y-auto rounded-xl border border-[var(--color-line-strong)] p-3.5">
            <PermChip p="*" on={perms.includes("*")} onToggle={() => toggle("*")} destaque />
            {grupos.map(([recurso, ps]) => (
              <div key={recurso}>
                <p className="mb-2 text-[13px] font-medium text-slate-400">{recurso}</p>
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

        <Rodape busy={busy} onCancel={onClose}>{editing ? "Salvar" : "Criar role"}</Rodape>
      </form>
    </Modal>
  );
}

function PermChip({ p, on, onToggle, destaque }: { p: string; on: boolean; onToggle: () => void; destaque?: boolean }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={on}
      className={`h-8 rounded-lg px-2.5 text-xs font-medium transition-colors cursor-pointer ${
        on
          ? destaque ? "bg-amber-500/20 text-amber-300 ring-1 ring-inset ring-amber-400/40" : "bg-ink text-[var(--color-on-ink)]"
          : "border border-[var(--color-line-strong)] text-slate-400 hover:bg-veu/[0.05] hover:text-ink"
      }`}>
      {p}
    </button>
  );
}

// Skeleton no formato da lista (e não um spinner centralizado): o bloco já
// mostra quantas linhas vêm e a página não salta quando os dados chegam.
function Loading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-6 w-32" />
      <Card className="p-4">
        <SkeletonList rows={4} height="h-14" label="Carregando" />
      </Card>
    </div>
  );
}
