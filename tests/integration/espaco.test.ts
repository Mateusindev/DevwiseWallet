// Integração: /api/despesas/espacos — lista + ativo, CRUD, guardas (último
// espaço / última página do mês), ocultar por mês e o blob de orçamento.
import { describe, expect, it, beforeEach } from "bun:test";
import { account, resetDb, seedRoles, prisma, type Client } from "./harness";

let api: Client;
let userId: string;

beforeEach(async () => {
  await resetDb();
  await seedRoles();
  const conta = await account({ roles: ["membro"] });
  api = conta.api;
  userId = conta.user.id;
});

const criar = async (nome: string, extra: Record<string, unknown> = {}) =>
  (await api.post("/despesas/espacos", { nome, ...extra })).body;

describe("GET /api/despesas/espacos", () => {
  it("conta sem espaço nenhum devolve lista vazia e ativo null", async () => {
    const res = await api.get("/despesas/espacos");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ espacos: [], activeEspacoId: null, espacosOcultos: [] });
  });

  it("lista por createdAt asc", async () => {
    await criar("Primeiro");
    await criar("Segundo");
    const res = await api.get("/despesas/espacos");
    expect(res.body.espacos.map((e: { nome: string }) => e.nome)).toEqual(["Primeiro", "Segundo"]);
  });

  it("ativo aponta pro primeiro quando o salvo não existe mais", async () => {
    const esp = await criar("Único");
    // simula settings apontando pra um espaço que sumiu
    await prisma.appSettings.upsert({
      where: { userId },
      create: { userId, activeEspacoId: null },
      update: { activeEspacoId: null },
    });

    const res = await api.get("/despesas/espacos");
    expect(res.body.activeEspacoId).toBe(esp.id);
    // e o fallback é persistido
    expect((await prisma.appSettings.findUnique({ where: { userId } }))?.activeEspacoId).toBe(esp.id);
  });
});

describe("POST /api/despesas/espacos", () => {
  it("cria com defaults e o primeiro vira ativo", async () => {
    const res = await api.post("/despesas/espacos", {});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ nome: "Novo espaço", tipo: "outro", emoji: "📁" });
    expect((await api.get("/despesas/espacos")).body.activeEspacoId).toBe(res.body.id);
  });

  it("segundo espaço não rouba o ativo", async () => {
    const primeiro = await criar("Primeiro");
    await criar("Segundo");
    expect((await api.get("/despesas/espacos")).body.activeEspacoId).toBe(primeiro.id);
  });

  it("renda e moeda vão pro orçamento (view do espaço só tem cadastro)", async () => {
    const esp = await criar("Casal", { rendaMensal: 7800.456, moeda: "USD", tipo: "casal", emoji: "💑" });
    expect(esp).toEqual({ id: esp.id, nome: "Casal", tipo: "casal", emoji: "💑" });

    const orc = await api.get(`/despesas/espacos/${esp.id}`);
    expect(orc.body.config).toEqual({ rendaMensal: 7800.46, moeda: "USD" });
  });

  it("nome vazio → 422", async () => {
    expect((await api.post("/despesas/espacos", { nome: "   " })).status).toBe(422);
    expect((await api.post("/despesas/espacos", { rendaMensal: -5 })).status).toBe(422);
  });
});

describe("PUT /api/despesas/espacos/active", () => {
  it("troca o ativo", async () => {
    await criar("Primeiro");
    const segundo = await criar("Segundo");

    const res = await api.put("/despesas/espacos/active", { id: segundo.id });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ activeEspacoId: segundo.id });
    expect((await api.get("/despesas/espacos")).body.activeEspacoId).toBe(segundo.id);
  });

  it("espaço de outra conta → 404", async () => {
    const outro = await account({ roles: ["membro"] });
    const alheio = (await outro.api.post("/despesas/espacos", { nome: "Alheio" })).body;

    const res = await api.put("/despesas/espacos/active", { id: alheio.id });
    expect(res.status).toBe(404);
  });

  it("id não-uuid → 422", async () => {
    expect((await api.put("/despesas/espacos/active", { id: "abc" })).status).toBe(422);
  });
});

describe("PATCH /api/despesas/espacos/:id", () => {
  it("atualiza cadastro e arredonda a renda", async () => {
    const esp = await criar("Antes");
    const res = await api.patch(`/despesas/espacos/${esp.id}`, {
      nome: "Depois",
      emoji: "🏠",
      rendaMensal: 1234.567,
    });
    expect(res.body).toMatchObject({ nome: "Depois", emoji: "🏠" });
    expect((await api.get(`/despesas/espacos/${esp.id}`)).body.config.rendaMensal).toBe(1234.57);
  });

  it("espaço de outra conta → 404", async () => {
    const outro = await account({ roles: ["membro"] });
    const alheio = (await outro.api.post("/despesas/espacos", { nome: "Alheio" })).body;
    expect((await api.patch(`/despesas/espacos/${alheio.id}`, { nome: "Hack" })).status).toBe(404);
  });
});

describe("DELETE /api/despesas/espacos/:id", () => {
  it("não remove o único espaço", async () => {
    const esp = await criar("Único");
    const res = await api.delete(`/despesas/espacos/${esp.id}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Não dá pra remover o único espaço." });
  });

  it("remove o ativo e reassina pro que sobrou, levando o orçamento em cascata", async () => {
    const primeiro = await criar("Primeiro");
    const segundo = await criar("Segundo");
    await api.post(`/despesas/espacos/${primeiro.id}/fixas`, { descricao: "Aluguel", valor: 800 });
    await api.put(`/despesas/espacos/${primeiro.id}/rendas/2026-07`, { valor: 5000 });

    const res = await api.delete(`/despesas/espacos/${primeiro.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: primeiro.id, activeEspacoId: segundo.id });
    expect(await prisma.despesaFixa.count({ where: { espacoId: primeiro.id } })).toBe(0);
    expect(await prisma.rendaMensal.count({ where: { espacoId: primeiro.id } })).toBe(0);
  });

  it("remover não-ativo mantém o ativo", async () => {
    const primeiro = await criar("Primeiro");
    const segundo = await criar("Segundo");
    const res = await api.delete(`/despesas/espacos/${segundo.id}`);
    expect(res.body).toEqual({ id: segundo.id, activeEspacoId: primeiro.id });
  });
});

describe("ocultar / restaurar no mês", () => {
  it("oculta e restaura, refletindo em espacosOcultos", async () => {
    const primeiro = await criar("Primeiro");
    const segundo = await criar("Segundo");

    const hide = await api.post(`/despesas/espacos/${segundo.id}/ocultar/2026-07`);
    expect(hide.status).toBe(200);
    expect(hide.body).toEqual({ id: segundo.id, ym: "2026-07" });
    expect((await api.get("/despesas/espacos")).body.espacosOcultos).toEqual([
      { espacoId: segundo.id, ym: "2026-07" },
    ]);

    // idempotente (upsert)
    expect((await api.post(`/despesas/espacos/${segundo.id}/ocultar/2026-07`)).status).toBe(200);
    expect(await prisma.espacoMesOculto.count()).toBe(1);

    const show = await api.delete(`/despesas/espacos/${segundo.id}/ocultar/2026-07`);
    expect(show.body).toEqual({ id: segundo.id, ym: "2026-07" });
    expect((await api.get("/despesas/espacos")).body.espacosOcultos).toEqual([]);

    // o espaço segue existindo nos outros meses
    expect((await api.get("/despesas/espacos")).body.espacos).toHaveLength(2);
    expect(primeiro.id).toBeDefined();
  });

  it("não oculta a última página visível do mês", async () => {
    const primeiro = await criar("Primeiro");
    const segundo = await criar("Segundo");
    await api.post(`/despesas/espacos/${segundo.id}/ocultar/2026-07`);

    const res = await api.post(`/despesas/espacos/${primeiro.id}/ocultar/2026-07`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Não dá pra excluir a única página do mês." });
  });

  it("restaurar mês que não estava oculto é no-op", async () => {
    const esp = await criar("Único");
    expect((await api.delete(`/despesas/espacos/${esp.id}/ocultar/2026-07`)).status).toBe(200);
  });

  it("espaço de outra conta → 404", async () => {
    const outro = await account({ roles: ["membro"] });
    const alheio = (await outro.api.post("/despesas/espacos", { nome: "Alheio" })).body;
    expect((await api.post(`/despesas/espacos/${alheio.id}/ocultar/2026-07`)).status).toBe(404);
    expect((await api.delete(`/despesas/espacos/${alheio.id}/ocultar/2026-07`)).status).toBe(404);
  });
});

describe("GET /api/despesas/espacos/:esp (orçamento)", () => {
  it("devolve o blob completo do espaço", async () => {
    const esp = await criar("Meu", { rendaMensal: 3000 });
    const fixa = (
      await api.post(`/despesas/espacos/${esp.id}/fixas`, { descricao: "Internet", valor: 100 })
    ).body;
    await api.put(`/despesas/espacos/${esp.id}/fixas/${fixa.id}/pago/2026-07`, { valorPago: 100 });
    await api.post(`/despesas/espacos/${esp.id}/mes`, {
      mes: "2026-07",
      descricao: "Mercado",
      valor: 500,
    });
    await api.post(`/despesas/espacos/${esp.id}/receitas`, {
      mes: "2026-07",
      descricao: "Freela",
      valor: 900,
    });
    await api.put(`/despesas/espacos/${esp.id}/rendas/2026-07`, { valor: 3200 });

    const res = await api.get(`/despesas/espacos/${esp.id}`);
    expect(res.status).toBe(200);
    expect(res.body.despesasFixas).toHaveLength(1);
    expect(res.body.despesasMes[0]).toMatchObject({ descricao: "Mercado", valor: 500, paga: false });
    expect(res.body.receitasMes[0]).toMatchObject({ descricao: "Freela", valor: 900 });
    expect(res.body.pagamentosFixas).toEqual([
      { despesaFixaId: fixa.id, ym: "2026-07", valorPago: 100 },
    ]);
    expect(res.body.rendasMensais).toEqual({ "2026-07": 3200 });
    expect(res.body.config).toEqual({ rendaMensal: 3000, moeda: "BRL" });
  });

  it("espaço inexistente ou de outra conta → 404", async () => {
    expect((await api.get("/despesas/espacos/00000000-0000-0000-0000-000000000000")).status).toBe(404);

    const outro = await account({ roles: ["membro"] });
    const alheio = (await outro.api.post("/despesas/espacos", { nome: "Alheio" })).body;
    expect((await api.get(`/despesas/espacos/${alheio.id}`)).status).toBe(404);
  });
});

describe("permissions", () => {
  it("leitor lê, não muta", async () => {
    const esp = await criar("Meu");
    const leitor = await account({ roles: ["leitor"] });

    expect((await leitor.api.get("/despesas/espacos")).status).toBe(200);
    const res = await leitor.api.post("/despesas/espacos", { nome: "Não vai" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Sem permissão: espaco:manage" });
    expect((await leitor.api.delete(`/despesas/espacos/${esp.id}`)).status).toBe(403);
  });
});
