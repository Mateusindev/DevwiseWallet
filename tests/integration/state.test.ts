// Integração: GET /api/state (bootstrap) — provisiona defaults da conta nova e
// agrega o payload inicial do front.
import { describe, expect, it, beforeEach } from "bun:test";
import { account, resetDb, seedRoles, prisma } from "./harness";

beforeEach(async () => {
  await resetDb();
  await seedRoles();
});

describe("GET /api/state", () => {
  it("conta nova ganha espaço + categorias padrão e payload vazio", async () => {
    const { api } = await account({ roles: ["membro"] });

    const res = await api.get("/state");
    expect(res.status).toBe(200);

    expect(res.body.espacos).toHaveLength(1);
    expect(res.body.espacos[0]).toMatchObject({ nome: "Meu", tipo: "pessoal", emoji: "🧍" });
    expect(res.body.activeEspacoId).toBe(res.body.espacos[0].id);

    expect(res.body.categorias.map((c: { nome: string }) => c.nome)).toEqual([
      "Moradia",
      "Alimentação",
      "Transporte",
      "Saúde",
      "Lazer",
      "Educação",
      "Compras",
      "Contas & Assinaturas",
    ]);

    expect(res.body.caixinhas).toEqual([]);
    expect(res.body.movimentacoes).toEqual([]);
    expect(res.body.cartoes).toEqual([]);
    expect(res.body.espacosOcultos).toEqual([]);
    expect(res.body.orcamento).toMatchObject({
      despesasFixas: [],
      despesasMes: [],
      receitasMes: [],
      pagamentosFixas: [],
      rendasMensais: {},
      config: { rendaMensal: 0, moeda: "BRL" },
    });
  });

  it("ensureDefaults é idempotente entre chamadas", async () => {
    const { api, user } = await account({ roles: ["membro"] });

    await api.get("/state");
    await api.get("/state");

    expect(await prisma.espaco.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.categoria.count({ where: { userId: user.id } })).toBe(8);
  });

  it("agrega caixinhas, movimentações, cartões e orçamento do espaço ativo", async () => {
    const { api } = await account({ roles: ["membro"] });
    const inicial = await api.get("/state");
    const espacoId = inicial.body.activeEspacoId;

    const cx = await api.post("/caixinhas", { nome: "Reserva", aporteMensal: 300 });
    await api.post("/movimentacoes", { caixinhaId: cx.body.id, tipo: "aporte", valor: 150 });
    await api.post("/cartoes", { nome: "Nubank", limite: 1000 });
    await api.post(`/despesas/espacos/${espacoId}/fixas`, { descricao: "Aluguel", valor: 900 });
    await api.put(`/despesas/espacos/${espacoId}/rendas/2026-07`, { valor: 5000 });

    const res = await api.get("/state");
    expect(res.body.caixinhas).toHaveLength(1);
    expect(res.body.caixinhas[0]).toMatchObject({ nome: "Reserva", saldo: 150 });
    expect(res.body.movimentacoes).toHaveLength(1);
    expect(res.body.cartoes[0]).toMatchObject({ nome: "Nubank", limite: 1000, disponivel: 1000 });
    expect(res.body.orcamento.despesasFixas[0]).toMatchObject({ descricao: "Aluguel", valor: 900 });
    expect(res.body.orcamento.rendasMensais).toEqual({ "2026-07": 5000 });
  });

  it("não vaza dados de outra conta", async () => {
    const a = await account({ roles: ["membro"] });
    await a.api.post("/caixinhas", { nome: "Só da A" });

    const b = await account({ roles: ["membro"] });
    const res = await b.api.get("/state");

    expect(res.body.caixinhas).toEqual([]);
    expect(res.body.espacos).toHaveLength(1);
    expect(res.body.espacos[0].id).not.toBe((await a.api.get("/state")).body.espacos[0].id);
  });

  it("sem a permission state:view → 403", async () => {
    const { api } = await account({ permissions: ["caixinha:view"] });
    const res = await api.get("/state");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Sem permissão: state:view" });
  });
});
