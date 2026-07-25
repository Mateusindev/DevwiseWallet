// Integração: sessão (login/register/logout/me), health e o contrato de erro
// central. Banco e app reais.
import { describe, expect, it, beforeEach } from "bun:test";
import { anon, client, createUser, login, resetDb, seedRoles, prisma } from "./harness";

beforeEach(async () => {
  await resetDb();
  await seedRoles();
});

describe("GET /api/health", () => {
  it("é público", async () => {
    const res = await anon.get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("POST /api/auth/login", () => {
  it("loga, devolve o usuário com permissions e seta cookie httpOnly", async () => {
    const u = await createUser({ email: "Ana@Teste.local", senha: "segredo123", roles: ["membro"] });

    const res = await anon.post("/auth/login", { email: "ana@teste.local", senha: "segredo123" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: u.id, email: "ana@teste.local", roles: ["membro"] });
    expect(res.body.permissions).toContain("caixinha:*");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("auth_token=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    // dev/test não marca Secure (senão o cookie não sobe em http)
    expect(cookie).not.toContain("Secure");
  });

  it("senha errada → 401 com mensagem genérica", async () => {
    await createUser({ email: "ana@teste.local", senha: "segredo123" });
    const res = await anon.post("/auth/login", { email: "ana@teste.local", senha: "errada" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Email ou senha inválidos" });
  });

  it("email inexistente → mesma mensagem de senha errada (não vaza existência)", async () => {
    const res = await anon.post("/auth/login", { email: "ninguem@teste.local", senha: "x" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Email ou senha inválidos" });
  });

  it("usuário inativo → 401", async () => {
    await createUser({ email: "off@teste.local", senha: "segredo123", ativo: false });
    const res = await anon.post("/auth/login", { email: "off@teste.local", senha: "segredo123" });
    expect(res.status).toBe(401);
  });

  it("payload inválido → 422 do zValidator com issues", async () => {
    const res = await anon.post("/auth/login", { email: "nao-e-email", senha: "" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Validação falhou");
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThanOrEqual(2);
  });
});

describe("POST /api/auth/register", () => {
  it("cria conta com a role membro, já logada", async () => {
    const res = await anon.post("/auth/register", {
      nome: "  Novo  ",
      email: "Novo@Teste.local",
      senha: "segredo123",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ nome: "Novo", email: "novo@teste.local", roles: ["membro"] });
    expect(res.headers.get("set-cookie")).toContain("auth_token=");

    const salvo = await prisma.user.findUnique({ where: { email: "novo@teste.local" } });
    expect(salvo).not.toBeNull();
  });

  it("email já cadastrado → 409", async () => {
    await createUser({ email: "dup@teste.local" });
    const res = await anon.post("/auth/register", {
      nome: "Dup",
      email: "dup@teste.local",
      senha: "segredo123",
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Email já cadastrado" });
  });

  it("sem a role membro no banco → 500 (config faltando)", async () => {
    await prisma.role.deleteMany({ where: { nome: "membro" } });
    const res = await anon.post("/auth/register", {
      nome: "Sem Role",
      email: "semrole@teste.local",
      senha: "segredo123",
    });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Role padrão 'membro' não configurada" });
  });

  it("senha curta → 422", async () => {
    const res = await anon.post("/auth/register", {
      nome: "Curta",
      email: "curta@teste.local",
      senha: "123",
    });
    expect(res.status).toBe(422);
  });
});

describe("GET /api/auth/me", () => {
  it("com cookie devolve a sessão fresca do banco", async () => {
    const u = await createUser({ roles: ["leitor"] });
    const cookie = await login(u.email, u.senha);

    const res = await client(cookie).get("/auth/me");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: u.id, roles: ["leitor"] });
  });

  it("sem cookie → 401", async () => {
    const res = await anon.get("/auth/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Não autenticado" });
  });

  it("cookie adulterado → 401", async () => {
    const res = await client("auth_token=nao.e.um.jwt").get("/auth/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Sessão inválida ou expirada" });
  });

  it("usuário desativado depois do login → 401 na request seguinte", async () => {
    const u = await createUser({ roles: ["membro"] });
    const api = client(await login(u.email, u.senha));
    expect((await api.get("/auth/me")).status).toBe(200);

    await prisma.user.update({ where: { id: u.id }, data: { ativo: false } });
    expect((await api.get("/auth/me")).status).toBe(401);
  });

  it("role trocada vale na request seguinte (sem reemitir token)", async () => {
    const u = await createUser({ roles: ["leitor"] });
    const api = client(await login(u.email, u.senha));
    expect((await api.get("/auth/me")).body.roles).toEqual(["leitor"]);

    const membro = await prisma.role.findUniqueOrThrow({ where: { nome: "membro" } });
    await prisma.userRole.deleteMany({ where: { userId: u.id } });
    await prisma.userRole.create({ data: { userId: u.id, roleId: membro.id } });

    expect((await api.get("/auth/me")).body.roles).toEqual(["membro"]);
  });
});

describe("POST /api/auth/logout", () => {
  it("expira o cookie", async () => {
    const res = await anon.post("/auth/logout");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers.get("set-cookie")).toContain("auth_token=;");
  });
});

describe("rota inexistente", () => {
  // requireAuth é `.use` global do /api: caminho desconhecido passa pelo
  // middleware antes de virar 404.
  it("sem sessão → 401", async () => {
    expect((await anon.get("/nao-existe")).status).toBe(401);
  });

  it("com sessão → 404", async () => {
    const u = await createUser({ roles: ["membro"] });
    const res = await client(await login(u.email, u.senha)).get("/nao-existe");
    expect(res.status).toBe(404);
  });
});
