// Integração: /api/admin/* — gestão de usuários, roles e catálogo de
// permissions, incluindo as guardas anti-lockout.
import { describe, expect, it, beforeEach } from "bun:test";
import { account, client, createUser, login, resetDb, seedRoles, prisma, type Client } from "./harness";
import { PERMISSIONS } from "@/server/auth/permissions";

let api: Client;
let adminId: string;
let membroRoleId: string;

const UUID_ZERO = "00000000-0000-0000-0000-000000000000";

beforeEach(async () => {
  await resetDb();
  await seedRoles();
  const conta = await account({ email: "admin@teste.local", roles: ["admin"] });
  api = conta.api;
  adminId = conta.user.id;
  membroRoleId = (await prisma.role.findUniqueOrThrow({ where: { nome: "membro" } })).id;
});

// ── Users ───────────────────────────────────────────────────────────────────

describe("GET /api/admin/users", () => {
  it("lista com roles e permissions agregadas", async () => {
    await createUser({ email: "membro@teste.local", roles: ["membro"] });

    const res = await api.get("/admin/users");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const membro = res.body.find((u: { email: string }) => u.email === "membro@teste.local");
    expect(membro).toMatchObject({ ativo: true, roles: [{ nome: "membro" }] });
    expect(membro.permissions).toContain("caixinha:*");
    expect(membro).not.toHaveProperty("senhaHash");
  });
});

describe("POST /api/admin/users", () => {
  it("cria com roles e a conta já loga", async () => {
    const res = await api.post("/admin/users", {
      email: "Novo@Teste.local",
      nome: "Novo",
      senha: "segredo123",
      roleIds: [membroRoleId, membroRoleId], // duplicado é deduplicado
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: "novo@teste.local", nome: "Novo", ativo: true });
    expect(res.body.roles).toEqual([{ id: membroRoleId, nome: "membro" }]);

    const cookie = await login("novo@teste.local", "segredo123");
    expect(cookie).toContain("auth_token=");
  });

  it("sem roleIds cria sem permission nenhuma", async () => {
    const res = await api.post("/admin/users", {
      email: "vazio@teste.local",
      nome: "Vazio",
      senha: "segredo123",
    });
    expect(res.body).toMatchObject({ roles: [], permissions: [] });

    const semPermissao = await login("vazio@teste.local", "segredo123");
    expect((await client(semPermissao).get("/state")).status).toBe(403);
  });

  it("email duplicado → 409", async () => {
    await createUser({ email: "dup@teste.local" });
    const res = await api.post("/admin/users", {
      email: "dup@teste.local",
      nome: "Dup",
      senha: "segredo123",
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Email já cadastrado" });
  });

  it("roleId inexistente → 422", async () => {
    const res = await api.post("/admin/users", {
      email: "semrole@teste.local",
      nome: "X",
      senha: "segredo123",
      roleIds: [UUID_ZERO],
    });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ error: "Role inexistente na lista" });
  });

  it("payload inválido → 422", async () => {
    expect(
      (await api.post("/admin/users", { email: "x@t.local", nome: "X", senha: "123" })).status
    ).toBe(422);
    expect(
      (await api.post("/admin/users", { email: "nao-email", nome: "X", senha: "segredo123" })).status
    ).toBe(422);
  });
});

describe("PATCH /api/admin/users/:id", () => {
  it("troca email, nome, senha, ativo e roles", async () => {
    const alvo = await createUser({ email: "alvo@teste.local", senha: "antiga123" });

    const res = await api.patch(`/admin/users/${alvo.id}`, {
      email: "Novo-Email@Teste.local",
      nome: "Renomeado",
      senha: "nova12345",
      roleIds: [membroRoleId],
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      email: "novo-email@teste.local",
      nome: "Renomeado",
      roles: [{ nome: "membro" }],
    });

    // senha antiga não vale mais; a nova sim
    expect(await login("novo-email@teste.local", "nova12345")).toContain("auth_token=");
    await expect(login("novo-email@teste.local", "antiga123")).rejects.toThrow();
  });

  it("desativar bloqueia o login do alvo", async () => {
    const alvo = await createUser({ email: "alvo@teste.local", roles: ["membro"] });
    const res = await api.patch(`/admin/users/${alvo.id}`, { ativo: false });
    expect(res.body.ativo).toBe(false);
    await expect(login(alvo.email, alvo.senha)).rejects.toThrow();
  });

  it("email já usado por outro → 409; o próprio email é aceito", async () => {
    const a = await createUser({ email: "a@teste.local" });
    await createUser({ email: "b@teste.local" });

    expect((await api.patch(`/admin/users/${a.id}`, { email: "b@teste.local" })).status).toBe(409);
    expect((await api.patch(`/admin/users/${a.id}`, { email: "a@teste.local" })).status).toBe(200);
  });

  it("anti-lockout: não se desativa nem zera as próprias roles", async () => {
    const desativar = await api.patch(`/admin/users/${adminId}`, { ativo: false });
    expect(desativar.status).toBe(400);
    expect(desativar.body).toEqual({
      error: "Não dá pra desativar ou remover as próprias roles.",
    });

    expect((await api.patch(`/admin/users/${adminId}`, { roleIds: [] })).status).toBe(400);
    // trocar as próprias roles por outra lista é permitido
    expect((await api.patch(`/admin/users/${adminId}`, { roleIds: [membroRoleId] })).status).toBe(200);
  });

  it("usuário inexistente → 404", async () => {
    expect((await api.patch(`/admin/users/${UUID_ZERO}`, { nome: "X" })).status).toBe(404);
  });

  it("roleId inexistente → 422", async () => {
    const alvo = await createUser({ email: "alvo@teste.local" });
    const res = await api.patch(`/admin/users/${alvo.id}`, { roleIds: [UUID_ZERO] });
    expect(res.status).toBe(422);
  });
});

describe("DELETE /api/admin/users/:id", () => {
  it("remove o usuário e os dados dele em cascata", async () => {
    const alvo = await account({ email: "alvo@teste.local", roles: ["membro"] });
    await alvo.api.post("/caixinhas", { nome: "Some junto" });

    const res = await api.delete(`/admin/users/${alvo.user.id}`);
    expect(res.body).toEqual({ id: alvo.user.id });
    expect(await prisma.caixinha.count({ where: { userId: alvo.user.id } })).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: alvo.user.id } })).toBeNull();
  });

  it("não exclui o próprio usuário", async () => {
    const res = await api.delete(`/admin/users/${adminId}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Não dá pra excluir o próprio usuário." });
  });

  it("usuário inexistente → 404", async () => {
    expect((await api.delete(`/admin/users/${UUID_ZERO}`)).status).toBe(404);
  });
});

// ── Roles ───────────────────────────────────────────────────────────────────

describe("roles", () => {
  it("lista com contagem de usuários", async () => {
    const res = await api.get("/admin/roles");
    expect(res.status).toBe(200);
    expect(res.body.map((r: { nome: string }) => r.nome)).toEqual(["admin", "membro", "leitor"]);
    expect(res.body.find((r: { nome: string }) => r.nome === "admin").usuarios).toBe(1);
    expect(res.body.find((r: { nome: string }) => r.nome === "membro").usuarios).toBe(0);
  });

  it("cria com permissions deduplicadas", async () => {
    const res = await api.post("/admin/roles", {
      nome: "suporte",
      descricao: "  Só leitura de usuários  ",
      permissions: ["user:view", "user:view", "caixinha:*"],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      nome: "suporte",
      descricao: "Só leitura de usuários",
      permissions: ["user:view", "caixinha:*"],
      usuarios: 0,
    });
  });

  it("nome duplicado → 409", async () => {
    const res = await api.post("/admin/roles", { nome: "membro", permissions: [] });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Já existe role com esse nome" });
  });

  it("permission fora do catálogo → 422", async () => {
    expect((await api.post("/admin/roles", { nome: "x", permissions: ["nao:existe"] })).status).toBe(422);
    expect((await api.post("/admin/roles", { nome: "x", permissions: ["Caixinha:View"] })).status).toBe(
      422
    );
    // wildcards válidos passam
    expect((await api.post("/admin/roles", { nome: "curinga", permissions: ["*", "cartao:*"] })).status).toBe(
      201
    );
  });

  it("patch renomeia, troca permissions e vale na request seguinte", async () => {
    const role = (await api.post("/admin/roles", { nome: "temp", permissions: ["state:view"] })).body;
    const alvo = await account({ email: "alvo@teste.local", roles: ["temp"] });

    expect((await alvo.api.get("/state")).status).toBe(200);
    expect((await alvo.api.get("/caixinhas")).status).toBe(403);

    const res = await api.patch(`/admin/roles/${role.id}`, {
      nome: "temp2",
      descricao: null,
      permissions: ["state:view", "caixinha:view"],
    });
    expect(res.body).toMatchObject({
      nome: "temp2",
      descricao: null,
      permissions: ["state:view", "caixinha:view"],
      usuarios: 1,
    });

    expect((await alvo.api.get("/caixinhas")).status).toBe(200);
  });

  it("renomear pra nome existente → 409; manter o próprio nome é ok", async () => {
    const role = (await api.post("/admin/roles", { nome: "temp", permissions: [] })).body;
    expect((await api.patch(`/admin/roles/${role.id}`, { nome: "membro" })).status).toBe(409);
    expect((await api.patch(`/admin/roles/${role.id}`, { nome: "temp" })).status).toBe(200);
  });

  it("role inexistente → 404 em patch e delete", async () => {
    expect((await api.patch(`/admin/roles/${UUID_ZERO}`, { nome: "x" })).status).toBe(404);
    expect((await api.delete(`/admin/roles/${UUID_ZERO}`)).status).toBe(404);
  });

  it("delete leva os vínculos user_roles em cascata", async () => {
    const role = (await api.post("/admin/roles", { nome: "temp", permissions: ["state:view"] })).body;
    const alvo = await account({ email: "alvo@teste.local", roles: ["temp"] });

    const res = await api.delete(`/admin/roles/${role.id}`);
    expect(res.body).toEqual({ id: role.id });
    expect(await prisma.userRole.count({ where: { roleId: role.id } })).toBe(0);
    // usuário continua existindo, agora sem permission
    expect((await alvo.api.get("/state")).status).toBe(403);
  });
});

describe("GET /api/admin/permissions", () => {
  it("devolve o catálogo", async () => {
    const res = await api.get("/admin/permissions");
    expect(res.status).toBe(200);
    expect(res.body.permissions).toEqual([...PERMISSIONS]);
  });
});

// ── Autorização ─────────────────────────────────────────────────────────────

describe("permissions do admin", () => {
  it("membro não acessa nada de admin", async () => {
    const membro = await account({ email: "membro@teste.local", roles: ["membro"] });

    expect((await membro.api.get("/admin/users")).status).toBe(403);
    expect((await membro.api.get("/admin/roles")).status).toBe(403);
    expect((await membro.api.get("/admin/permissions")).status).toBe(403);
    const res = await membro.api.post("/admin/roles", { nome: "x", permissions: [] });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Sem permissão: role:manage" });
  });

  it("user:view lê mas não muta usuários", async () => {
    const suporte = await account({ email: "suporte@teste.local", permissions: ["user:view"] });
    expect((await suporte.api.get("/admin/users")).status).toBe(200);
    const res = await suporte.api.post("/admin/users", {
      email: "x@teste.local",
      nome: "X",
      senha: "segredo123",
    });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Sem permissão: user:manage" });
  });
});
