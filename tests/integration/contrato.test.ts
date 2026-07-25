// Integração transversal: o que vale pra TODA rota — sessão obrigatória,
// shape de erro do onError central e o matcher de permissions com wildcard.
import { describe, expect, it, beforeEach } from "bun:test";
import { account, anon, client, createUser, login, resetDb, seedRoles, type Res } from "./harness";

const UUID_ZERO = "00000000-0000-0000-0000-000000000000";

// Uma rota por grupo — o requireAuth é global, então isso cobre o /api inteiro.
const ROTAS_PROTEGIDAS: [string, string][] = [
  ["GET", "/state"],
  ["GET", "/caixinhas"],
  ["POST", "/caixinhas"],
  ["GET", "/movimentacoes"],
  ["GET", "/despesas/espacos"],
  ["PUT", "/despesas/espacos/active"],
  ["POST", `/despesas/espacos/${UUID_ZERO}/fixas`],
  ["PUT", `/despesas/espacos/${UUID_ZERO}/rendas/2026-07`],
  ["POST", `/despesas/espacos/${UUID_ZERO}/mes`],
  ["POST", `/despesas/espacos/${UUID_ZERO}/receitas`],
  ["GET", "/cartoes"],
  ["GET", `/cartoes/${UUID_ZERO}/fatura`],
  ["GET", `/cartoes/${UUID_ZERO}/shares`],
  ["GET", "/contatos"],
  ["PATCH", `/shares/${UUID_ZERO}`],
  ["GET", "/me/compartilhamentos"],
  ["GET", "/categorias"],
  ["GET", "/admin/users"],
  ["GET", "/admin/roles"],
  ["GET", "/admin/permissions"],
  ["POST", "/dev/reset"],
];

beforeEach(async () => {
  await resetDb();
  await seedRoles();
});

describe("sessão obrigatória", () => {
  it.each(ROTAS_PROTEGIDAS)("%s %s sem cookie → 401", async (method, path) => {
    const chamadas: Record<string, () => Promise<Res>> = {
      GET: () => anon.get(path),
      POST: () => anon.post(path, {}),
      PUT: () => anon.put(path, {}),
      PATCH: () => anon.patch(path, {}),
      DELETE: () => anon.delete(path),
    };
    const res = await chamadas[method]();
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Não autenticado" });
  });

  it("rotas públicas seguem abertas", async () => {
    expect((await anon.get("/health")).status).toBe(200);
    expect((await anon.post("/auth/logout")).status).toBe(200);
    expect((await anon.post("/auth/login", { email: "x@y.local", senha: "z" })).status).toBe(401);
  });
});

describe("shape de erro", () => {
  it("sempre { error } — 401, 403, 404, 400 e 422", async () => {
    const { api } = await account({ permissions: ["caixinha:view"] });

    const semSessao = await anon.get("/caixinhas");
    expect(Object.keys(semSessao.body)).toEqual(["error"]);

    const semPermissao = await api.post("/caixinhas", { nome: "X" });
    expect(Object.keys(semPermissao.body)).toEqual(["error"]);
    expect(semPermissao.status).toBe(403);

    const inexistente = await api.get(`/cartoes/${UUID_ZERO}/fatura`);
    expect(inexistente.status).toBe(403); // sem cartao:view antes de chegar no 404

    const membro = await account({ roles: ["membro"] });
    const naoAchou = await membro.api.get(`/cartoes/${UUID_ZERO}/fatura`);
    expect(naoAchou.status).toBe(404);
    expect(Object.keys(naoAchou.body)).toEqual(["error"]);

    const espaco = (await membro.api.post("/despesas/espacos", { nome: "Único" })).body;
    const regraDeNegocio = await membro.api.delete(`/despesas/espacos/${espaco.id}`);
    expect(regraDeNegocio.status).toBe(400);
    expect(Object.keys(regraDeNegocio.body)).toEqual(["error"]);
  });

  it("422 do zValidator inclui issues", async () => {
    const { api } = await account({ roles: ["membro"] });
    const res = await api.post("/caixinhas", { aporteMensal: -5 });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Validação falhou");
    expect(res.body.issues[0]).toMatchObject({ path: ["aporteMensal"] });
  });

  it("erro inesperado do banco → 500 sem vazar detalhe", async () => {
    const { api } = await account({ roles: ["membro"] });
    const cx = (await api.post("/caixinhas", { nome: "X" })).body;

    // ordem estoura o int4 do Postgres → erro não mapeado no onError
    // (o console.error do handler aparece no output do teste, é esperado)
    const res = await api.patch(`/caixinhas/${cx.id}`, { ordem: 2_147_483_648 });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Erro interno" });
  });

  it("body JSON malformado → 400 (HTTPException do Hono)", async () => {
    const u = await createUser({ roles: ["membro"] });
    const cookie = await login(u.email, u.senha);

    const res = await (await import("@/server/app")).app.request("/api/caixinhas", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: "{ isso não é json",
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Malformed JSON in request body" });
  });
});

describe("permissions com wildcard", () => {
  it('"*" libera tudo', async () => {
    const { api } = await account({ permissions: ["*"] });
    expect((await api.get("/state")).status).toBe(200);
    expect((await api.get("/admin/users")).status).toBe(200);
    expect((await api.post("/dev/reset")).status).toBe(200);
  });

  it('"caixinha:*" cobre view e manage, mas nada de outro recurso', async () => {
    const { api } = await account({ permissions: ["caixinha:*"] });
    expect((await api.get("/caixinhas")).status).toBe(200);
    expect((await api.post("/caixinhas", { nome: "Ok" })).status).toBe(201);
    expect((await api.get("/cartoes")).status).toBe(403);
    expect((await api.get("/state")).status).toBe(403);
  });

  it("permission exata não cobre irmã", async () => {
    const { api } = await account({ permissions: ["caixinha:view"] });
    expect((await api.get("/caixinhas")).status).toBe(200);
    expect((await api.post("/caixinhas", { nome: "Não" })).status).toBe(403);
  });

  it("usuário sem role nenhuma leva 403 em tudo (mas autentica)", async () => {
    const u = await createUser({});
    const api = client(await login(u.email, u.senha));
    expect((await api.get("/auth/me")).status).toBe(200);
    expect((await api.get("/state")).status).toBe(403);
    expect((await api.get("/caixinhas")).status).toBe(403);
  });
});
