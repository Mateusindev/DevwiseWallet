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
  deletedRole: string | null;
} = { users: [], roles: [], updated: null, deletedUser: null, deletedRole: null };

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
    deleteRole: async (id: string) => {
      state.deletedRole = id;
    },
  },
}));

const { adminService } = await import("./admin.service");

beforeEach(() => {
  state.users = [userRow(), userRow({ id: "u2", email: "b@x.com", nome: "B" })];
  state.roles = [roleMembro];
  state.updated = null;
  state.deletedUser = null;
  state.deletedRole = null;
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

describe("adminService.listUsers", () => {
  it("achata roles e permissions e nunca expõe o hash da senha", async () => {
    const [u] = await adminService.listUsers();
    expect(u).toEqual({
      id: "u1",
      email: "a@x.com",
      nome: "A",
      ativo: true,
      roles: [{ id: "r1", nome: "membro" }],
      permissions: ["caixinha:*"],
    });
    expect(u).not.toHaveProperty("senhaHash");
  });

  it("dedupa permissions repetidas entre roles do mesmo usuário", async () => {
    const outra = { id: "r2", nome: "gestor", descricao: null, permissions: ["caixinha:*", "cartao:view"] };
    state.users = [userRow({ roles: [{ role: roleMembro }, { role: outra }] })];
    const [u] = await adminService.listUsers();
    expect(u.permissions).toEqual(["caixinha:*", "cartao:view"]);
  });
});

describe("adminService.listRoles", () => {
  it("expõe a contagem de usuários da role", async () => {
    expect(await adminService.listRoles()).toEqual([
      { id: "r1", nome: "membro", descricao: null, permissions: ["caixinha:*"], usuarios: 1 },
    ]);
  });

  it("role sem _count reporta 0 usuários", async () => {
    state.roles = [{ id: "r9", nome: "vazia", descricao: null, permissions: [] }];
    expect((await adminService.listRoles())[0].usuarios).toBe(0);
  });
});

describe("adminService users", () => {
  it("createUser normaliza o email, dedupa roleIds e grava hash", async () => {
    const u = await adminService.createUser({
      email: "  NOVO@X.COM ",
      nome: "Novo",
      senha: "123456",
      roleIds: ["r1", "r1"],
    });
    expect(u.email).toBe("novo@x.com");
  });

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

  it("updateUser de id inexistente → 404", async () => {
    expect(adminService.updateUser("fantasma", { nome: "X" }, "u1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deleteUser de id inexistente → 404", async () => {
    expect(adminService.deleteUser("fantasma", "u1")).rejects.toBeInstanceOf(NotFoundError);
    expect(state.deletedUser).toBeNull();
  });

  it("updateUser normaliza o email e recusa colisão com outro usuário (409)", async () => {
    expect(adminService.updateUser("u2", { email: " A@X.com " }, "u1")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("manter o próprio email não conta como colisão", async () => {
    await adminService.updateUser("u1", { email: "A@X.com" }, "u-admin");
    expect(state.updated!.data).toEqual({ email: "a@x.com" });
  });

  it("trocar a senha grava hash, nunca o texto puro", async () => {
    await adminService.updateUser("u2", { senha: "novasenha" }, "u1");
    expect(state.updated!.data.senhaHash).toMatch(/^scrypt:/);
    expect(state.updated!.data).not.toHaveProperty("senha");
  });

  it("roleIds duplicados são deduplicados antes de gravar", async () => {
    await adminService.updateUser("u2", { roleIds: ["r1", "r1"] }, "u1");
    expect(state.updated!.roleIds).toEqual(["r1"]);
  });

  it("patch sem roleIds não mexe nas roles (undefined, não lista vazia)", async () => {
    await adminService.updateUser("u2", { nome: "B2" }, "u1");
    expect(state.updated!.roleIds).toBeUndefined();
  });

  it("admin pode zerar as roles de OUTRO usuário", async () => {
    await adminService.updateUser("u2", { roleIds: [] }, "u1");
    expect(state.updated!.roleIds).toEqual([]);
  });

  it("roleId inexistente no update → 422", async () => {
    expect(adminService.updateUser("u2", { roleIds: ["fantasma"] }, "u1")).rejects.toMatchObject({
      statusCode: 422,
    });
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

  it("updateRole mantendo o próprio nome não dispara conflito", async () => {
    const r = await adminService.updateRole("r1", { nome: "membro", descricao: "Padrão" });
    expect(r).toMatchObject({ nome: "membro", descricao: "Padrão" });
  });

  it("updateRole recusa renomear pra um nome já usado (409)", async () => {
    state.roles = [roleMembro, { id: "r2", nome: "gestor", descricao: null, permissions: [] }];
    expect(adminService.updateRole("r1", { nome: "gestor" })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("updateRole dedupa permissions e aceita descrição nula", async () => {
    await adminService.updateRole("r1", { permissions: ["user:view", "user:view"], descricao: null });
    const r = await adminService.updateRole("r1", { permissions: ["user:view", "user:view"] });
    expect(r.permissions).toEqual(["user:view"]);
  });

  it("deleteRole apaga (user_roles caem em cascata)", async () => {
    expect(await adminService.deleteRole("r1")).toEqual({ id: "r1" });
    expect(state.deletedRole).toBe("r1");
  });

  it("deleteRole de id inexistente → 404 e nada é apagado", async () => {
    expect(adminService.deleteRole("fantasma")).rejects.toBeInstanceOf(NotFoundError);
    expect(state.deletedRole).toBeNull();
  });
});
