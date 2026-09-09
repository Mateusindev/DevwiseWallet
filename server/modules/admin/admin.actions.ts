"use server";

import { acao, acaoValidada } from "@/server/next/action";
import { PERMISSIONS } from "@/server/auth/permissions";
import { authService } from "@/server/auth/auth.service";
import { currentUser } from "@/server/next/session";
import { erroDaAction, type ActionResult } from "@/server/next/action";
import { adminService } from "./admin.service";
import { createUserSchema, updateUserSchema, createRoleSchema, updateRoleSchema } from "./admin.dto";

type AdminBootstrap = {
  users: Awaited<ReturnType<typeof adminService.listUsers>> | null;
  roles: Awaited<ReturnType<typeof adminService.listRoles>> | null;
  permissions: readonly string[];
};

// Tela Admin numa chamada só. O `Promise.all` que estava no componente virou
// paralelismo DENTRO da action: o dispatcher do cliente serializa uma action
// por vez, então três leituras em paralelo no front viravam três sequenciais.
//
// Cada parte respeita a permission que a rota equivalente exigia — quem só tem
// `role:view` recebe `users: null`, como o componente já tratava.
export async function bootstrapAdmin(): Promise<ActionResult<AdminBootstrap>> {
  try {
    const user = await currentUser();
    const [podeUsers, podeRoles] = await Promise.all([
      authService.can(user, "user:view"),
      authService.can(user, "role:view"),
    ]);
    const [users, roles] = await Promise.all([
      podeUsers ? adminService.listUsers() : null,
      podeRoles ? adminService.listRoles() : null,
    ]);
    return {
      ok: true,
      data: { users, roles, permissions: podeRoles ? PERMISSIONS : [] },
    };
  } catch (err) {
    return erroDaAction(err);
  }
}

// ── Users ────────────────────────────────────────────────────────────────────

export async function listarUsuarios() {
  return acao("user:view", () => adminService.listUsers());
}

export async function criarUsuario(input: unknown) {
  return acaoValidada("user:manage", createUserSchema, input, (_user, dto) =>
    adminService.createUser(dto)
  );
}

export async function atualizarUsuario(id: string, input: unknown) {
  return acaoValidada("user:manage", updateUserSchema, input, (user, dto) =>
    adminService.updateUser(id, dto, user.id)
  );
}

export async function removerUsuario(id: string) {
  return acao("user:manage", (user) => adminService.deleteUser(id, user.id));
}

// ── Roles ────────────────────────────────────────────────────────────────────

export async function listarRoles() {
  return acao("role:view", () => adminService.listRoles());
}

export async function criarRole(input: unknown) {
  return acaoValidada("role:manage", createRoleSchema, input, (_user, dto) =>
    adminService.createRole(dto)
  );
}

export async function atualizarRole(id: string, input: unknown) {
  return acaoValidada("role:manage", updateRoleSchema, input, (_user, dto) =>
    adminService.updateRole(id, dto)
  );
}

export async function removerRole(id: string) {
  return acao("role:manage", () => adminService.deleteRole(id));
}

// Catálogo de permissions (editor de roles do front).
export async function listarPermissions() {
  return acao("role:view", async () => ({ permissions: PERMISSIONS }));
}
