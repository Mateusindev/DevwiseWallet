import { describe, expect, it, beforeEach, mock } from "bun:test";
import { AppError, NotFoundError } from "@/server/lib/errors";
import { isAssignablePermission } from "@/server/auth/permissions";
import { createRoleSchema } from "./admin.dto";

type Row = Record<string, unknown>;

const roleMembro = { id: "r1", nome: "membro", descricao: null, permissions: ["caixinha:*"], _count: { users: 1 } };

const state: {
  users: Row[];
  roles: Row[];
  updated: { id: string; data: Row; roleIds?: string[] } | null;
  deletedUser: string | null;
} = { users: [], roles: [], updated: null, deletedUser: null };

const userRow = (over: Row = {}): Row => ({
  id: "u1",
  email: "a@x.com",
  nome: "A",
  senhaHash: "scrypt:x:y",
  ativo: true,
  roles: [{ role: roleMembro }],
  ...over,
});

mock.module("@/server/modules/admin/admin.repository", () => ({
  adminRepository: {
    listUsers: async () => state.users,
    findUser: async (id: string) => state.users.find((u) => u.id === id) ?? null,
    findUserByEmail: async (email: string) => state.users.find((u) => u.email === email) ?? null,
    createUser: async (data: Row) => userRow({ id: "u-new", ...data, roles: [] }),
    updateUser: async (id: string, data: Row, roleIds?: string[]) => {
      state.updated = { id, data, roleIds };
      return userRow({ id, ...data });
    },
    deleteUser: async (id: string) => {
      state.deletedUser = id;
    },
    listRoles: async () => state.roles,
    findRole: async (id: string) => state.roles.find((r) => r.id === id) ?? null,
    findRoleByName: async (nome: string) => state.roles.find((r) => r.nome === nome) ?? null,
    countRolesByIds: async (ids: string[]) => state.roles.filter((r) => ids.includes(r.id as string)).length,
    createRole: async (data: Row) => ({ id: "r-new", _count: { users: 0 }, descricao: null, ...data }),
    updateRole: async (id: string, data: Row) => ({ ...state.roles.find((r) => r.id === id), ...data }),
    deleteRole: async () => {},
  },
}));

const { adminService } = await import("./admin.service");

beforeEach(() => {
  state.users = [userRow(), userRow({ id: "u2", email: "b@x.com", nome: "B" })];
  state.roles = [roleMembro];
  state.updated = null;
  state.deletedUser = null;
});

describe("isAssignablePermission", () => {
  it("aceita catálogo, wildcard de recurso e global", () => {
    expect(isAssignablePermission("caixinha:view")).toBe(true);
    expect(isAssignablePermission("caixinha:*")).toBe(true);
    expect(isAssignablePermission("*")).toBe(true);
  });

  it("rejeita permission fora do catálogo", () => {
    expect(isAssignablePermission("nao_existe:view")).toBe(false);
    expect(isAssignablePermission("naoexiste:*")).toBe(false);
    expect(isAssignablePermission("caixinha")).toBe(false);
  });
});

describe("createRoleSchema", () => {
  it("rejeita role com permission desconhecida", () => {
    const r = createRoleSchema.safeParse({ nome: "x", permissions: ["llm:chat"] });
    expect(r.success).toBe(false);
  });

  it("aceita permissions válidas", () => {
    const r = createRoleSchema.safeParse({ nome: "x", permissions: ["user:*", "role:view", "*"] });
    expect(r.success).toBe(true);
  });
});

describe("adminService users", () => {
  it("createUser rejeita email duplicado (409)", async () => {
    expect(
      adminService.createUser({ email: "a@x.com", nome: "Dup", senha: "123456", roleIds: [] })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("createUser rejeita roleId inexistente", async () => {
    expect(
      adminService.createUser({ email: "novo@x.com", nome: "N", senha: "123456", roleIds: ["fantasma"] })
    ).rejects.toBeInstanceOf(AppError);
  });

  it("não deixa o usuário se desativar", async () => {
    expect(adminService.updateUser("u1", { ativo: false }, "u1")).rejects.toBeInstanceOf(AppError);
  });

  it("não deixa o usuário remover as próprias roles", async () => {
    expect(adminService.updateUser("u1", { roleIds: [] }, "u1")).rejects.toBeInstanceOf(AppError);
  });

  it("admin pode desativar outro usuário", async () => {
    const u = await adminService.updateUser("u2", { ativo: false }, "u1");
    expect(state.updated).toMatchObject({ id: "u2", data: { ativo: false } });
    expect(u.ativo).toBe(false);
  });

  it("não deixa excluir a si mesmo", async () => {
    expect(adminService.deleteUser("u1", "u1")).rejects.toBeInstanceOf(AppError);
  });

  it("exclui outro usuário", async () => {
    await adminService.deleteUser("u2", "u1");
    expect(state.deletedUser).toBe("u2");
  });
});

describe("adminService roles", () => {
  it("createRole rejeita nome duplicado (409)", async () => {
    expect(
      adminService.createRole({ nome: "membro", descricao: null, permissions: [] })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("updateRole de id inexistente → 404", async () => {
    expect(adminService.updateRole("nope", { nome: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("createRole dedupa permissions", async () => {
    const r = await adminService.createRole({ nome: "nova", descricao: null, permissions: ["user:view", "user:view"] });
    expect(r.permissions).toEqual(["user:view"]);
  });
});
