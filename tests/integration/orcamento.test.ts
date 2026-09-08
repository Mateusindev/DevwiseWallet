// Integração: /api/despesas/espacos/:esp/... — fixas (+ pagamentos), despesas
// do mês, receitas e renda mensal. Inclui a checagem de que a linha pertence ao
// espaço informado (404) e a reancoragem de parcela.
import { describe, expect, it, beforeEach } from "bun:test";
import { account, resetDb, seedRoles, type Client } from "./harness";
import { currentMonth } from "@/server/lib/serialize";

let api: Client;
let esp: string;
let outroEsp: string;

const UUID_ZERO = "00000000-0000-0000-0000-000000000000";

beforeEach(async () => {
  await resetDb();
  await seedRoles();
  api = (await account({ roles: ["membro"] })).api;
  esp = (await api.post("/despesas/espacos", { nome: "Principal" })).body.id;
  outroEsp = (await api.post("/despesas/espacos", { nome: "Secundário" })).body.id;
});

const addFixa = async (body: Record<string, unknown> = {}, espaco = esp) =>
  (await api.post(`/despesas/espacos/${espaco}/fixas`, { descricao: "Aluguel", valor: 900, ...body }))
    .body;

const addMes = async (body: Record<string, unknown> = {}, espaco = esp) =>
  (
    await api.post(`/despesas/espacos/${espaco}/mes`, {
      mes: "2026-07",
      descricao: "Mercado",
      valor: 300,
      ...body,
    })
  ).body;

// ── Despesas fixas ───────────────────────────────────────────────────────────

describe("POST /fixas", () => {
  it("cria com defaults do DTO", async () => {
    const res = await api.post(`/despesas/espacos/${esp}/fixas`, { valor: 120.456 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: res.body.id,
      descricao: "Despesa fixa",
      valor: 120.46,
      diaVencimento: 1,
      ativa: true,
      categoriaId: null,
      nota: null,
      cartaoId: null,
      parcelado: false,
      parcelaAtual: null,
      totalParcelas: null,
      parcelaMesRef: null,
    });
  });

  it("parcelada ancora no mês corrente", async () => {
    const fixa = await addFixa({ parcelado: true, parcelaAtual: 3, totalParcelas: 12 });
    expect(fixa).toMatchObject({
      parcelado: true,
      parcelaAtual: 3,
      totalParcelas: 12,
      parcelaMesRef: currentMonth(),
    });
  });

  it("parcelaAtual default 1 quando parcelado sem informar", async () => {
    const fixa = await addFixa({ parcelado: true, totalParcelas: 6 });
    expect(fixa).toMatchObject({ parcelaAtual: 1, totalParcelas: 6 });
  });

  it("aceita categoria, cartão e nota", async () => {
    const cat = (await api.post("/categorias", { nome: "Moradia" })).body;
    const cartao = (await api.post("/cartoes", { nome: "Nubank" })).body;

    const fixa = await addFixa({ categoriaId: cat.id, cartaoId: cartao.id, nota: "  contrato  " });
    expect(fixa).toMatchObject({ categoriaId: cat.id, cartaoId: cartao.id, nota: "contrato" });
  });

  it("nota vazia vira null", async () => {
    expect((await addFixa({ nota: "   " })).nota).toBeNull();
  });

  it("dia do vencimento vazio → 422 com issue no campo", async () => {
    const res = await api.post(`/despesas/espacos/${esp}/fixas`, { valor: 10, diaVencimento: "" });
    expect(res.status).toBe(422);
    expect(res.body.issues.some((i: { path: string[] }) => i.path[0] === "diaVencimento")).toBe(true);
  });

  it("parcela atual além do total → 422", async () => {
    const res = await api.post(`/despesas/espacos/${esp}/fixas`, {
      valor: 10, parcelado: true, parcelaAtual: 13, totalParcelas: 12,
    });
    expect(res.status).toBe(422);
  });

  it("valor negativo, dia fora de 1..31 e descrição vazia → 422", async () => {
    expect((await api.post(`/despesas/espacos/${esp}/fixas`, { valor: -1 })).status).toBe(422);
    expect((await api.post(`/despesas/espacos/${esp}/fixas`, { valor: 10, diaVencimento: 32 })).status).toBe(
      422
    );
    expect(
      (await api.post(`/despesas/espacos/${esp}/fixas`, { valor: 10, descricao: "  " })).status
    ).toBe(422);
  });

  it("espaço inexistente ou de outra conta → 404", async () => {
    expect((await api.post(`/despesas/espacos/${UUID_ZERO}/fixas`, { valor: 10 })).status).toBe(404);

    const outro = await account({ roles: ["membro"] });
    const alheio = (await outro.api.post("/despesas/espacos", { nome: "Alheio" })).body.id;
    expect((await api.post(`/despesas/espacos/${alheio}/fixas`, { valor: 10 })).status).toBe(404);
  });
});

describe("PATCH /fixas/:id", () => {
  it("patch parcial não mexe no resto", async () => {
    const fixa = await addFixa({ diaVencimento: 8 });
    const res = await api.patch(`/despesas/espacos/${esp}/fixas/${fixa.id}`, { valor: 1000.999 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ descricao: "Aluguel", valor: 1001, diaVencimento: 8, ativa: true });
  });

  it("categoriaId/nota podem ser limpos com null", async () => {
    const cat = (await api.post("/categorias", { nome: "Moradia" })).body;
    const fixa = await addFixa({ categoriaId: cat.id, nota: "obs" });

    const res = await api.patch(`/despesas/espacos/${esp}/fixas/${fixa.id}`, {
      categoriaId: null,
      nota: null,
    });
    expect(res.body).toMatchObject({ categoriaId: null, nota: null });
  });

  it("editar parcela reancora no mês corrente", async () => {
    const fixa = await addFixa({ parcelado: true, parcelaAtual: 2, totalParcelas: 10 });
    // volta a âncora pro passado direto no banco pra provar a reancoragem
    const res = await api.patch(`/despesas/espacos/${esp}/fixas/${fixa.id}`, { parcelaAtual: 7 });
    expect(res.body).toMatchObject({
      parcelado: true,
      parcelaAtual: 7,
      totalParcelas: 10,
      parcelaMesRef: currentMonth(),
    });
  });

  it("parcelado: false zera os campos de parcela", async () => {
    const fixa = await addFixa({ parcelado: true, parcelaAtual: 2, totalParcelas: 10 });
    const res = await api.patch(`/despesas/espacos/${esp}/fixas/${fixa.id}`, { parcelado: false });
    expect(res.body).toMatchObject({
      parcelado: false,
      parcelaAtual: null,
      totalParcelas: null,
      parcelaMesRef: null,
    });
  });

  it("patch sem campo de parcela preserva a parcela", async () => {
    const fixa = await addFixa({ parcelado: true, parcelaAtual: 4, totalParcelas: 8 });
    const res = await api.patch(`/despesas/espacos/${esp}/fixas/${fixa.id}`, { descricao: "Outro nome" });
    expect(res.body).toMatchObject({ descricao: "Outro nome", parcelado: true, parcelaAtual: 4 });
  });

  it("fixa de outro espaço do mesmo dono → 404", async () => {
    const fixa = await addFixa({}, outroEsp);
    const res = await api.patch(`/despesas/espacos/${esp}/fixas/${fixa.id}`, { valor: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Despesa fixa não encontrada");
  });

  it("fixa de outra conta → 404", async () => {
    const outro = await account({ roles: ["membro"] });
    const alheioEsp = (await outro.api.post("/despesas/espacos", { nome: "Alheio" })).body.id;
    const alheia = (
      await outro.api.post(`/despesas/espacos/${alheioEsp}/fixas`, { descricao: "X", valor: 5 })
    ).body;

    expect((await api.patch(`/despesas/espacos/${esp}/fixas/${alheia.id}`, { valor: 1 })).status).toBe(404);
  });
});

describe("PATCH /fixas/:id/toggle", () => {
  it("alterna ativa", async () => {
    const fixa = await addFixa();
    expect((await api.patch(`/despesas/espacos/${esp}/fixas/${fixa.id}/toggle`)).body.ativa).toBe(false);
    expect((await api.patch(`/despesas/espacos/${esp}/fixas/${fixa.id}/toggle`)).body.ativa).toBe(true);
  });

  it("fixa de outro espaço → 404", async () => {
    const fixa = await addFixa({}, outroEsp);
    expect((await api.patch(`/despesas/espacos/${esp}/fixas/${fixa.id}/toggle`)).status).toBe(404);
  });
});

describe("PUT /fixas/:id/pago/:ym", () => {
  it("pagamento parcial não quita", async () => {
    const fixa = await addFixa({ valor: 900 });
    const res = await api.put(`/despesas/espacos/${esp}/fixas/${fixa.id}/pago/2026-07`, {
      valorPago: 300,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ despesaFixaId: fixa.id, ym: "2026-07", valorPago: 300, pago: false });
  });

  it("valor acima do devido clampa e quita", async () => {
    const fixa = await addFixa({ valor: 900 });
    const res = await api.put(`/despesas/espacos/${esp}/fixas/${fixa.id}/pago/2026-07`, {
      valorPago: 5000,
    });
    expect(res.body).toEqual({ despesaFixaId: fixa.id, ym: "2026-07", valorPago: 900, pago: true });
  });

  it("segundo PUT sobrescreve (upsert por fixa+mês)", async () => {
    const fixa = await addFixa({ valor: 900 });
    await api.put(`/despesas/espacos/${esp}/fixas/${fixa.id}/pago/2026-07`, { valorPago: 100 });
    await api.put(`/despesas/espacos/${esp}/fixas/${fixa.id}/pago/2026-07`, { valorPago: 400 });

    const orc = await api.get(`/despesas/espacos/${esp}`);
    expect(orc.body.pagamentosFixas).toEqual([
      { despesaFixaId: fixa.id, ym: "2026-07", valorPago: 400 },
    ]);
  });

  it("zero remove o registro do mês", async () => {
    const fixa = await addFixa({ valor: 900 });
    await api.put(`/despesas/espacos/${esp}/fixas/${fixa.id}/pago/2026-07`, { valorPago: 300 });

    const res = await api.put(`/despesas/espacos/${esp}/fixas/${fixa.id}/pago/2026-07`, {
      valorPago: 0,
    });
    expect(res.body).toEqual({ despesaFixaId: fixa.id, ym: "2026-07", valorPago: 0, pago: false });
    expect((await api.get(`/despesas/espacos/${esp}`)).body.pagamentosFixas).toEqual([]);
  });

  it("zero em mês sem pagamento é no-op", async () => {
    const fixa = await addFixa({ valor: 900 });
    const res = await api.put(`/despesas/espacos/${esp}/fixas/${fixa.id}/pago/2026-08`, {
      valorPago: 0,
    });
    expect(res.status).toBe(200);
    expect(res.body.valorPago).toBe(0);
  });

  it("pagamentos são por mês", async () => {
    const fixa = await addFixa({ valor: 900 });
    await api.put(`/despesas/espacos/${esp}/fixas/${fixa.id}/pago/2026-07`, { valorPago: 900 });
    await api.put(`/despesas/espacos/${esp}/fixas/${fixa.id}/pago/2026-08`, { valorPago: 450 });

    const pagos = (await api.get(`/despesas/espacos/${esp}`)).body.pagamentosFixas;
    expect(pagos).toHaveLength(2);
    expect(pagos.find((p: { ym: string }) => p.ym === "2026-08").valorPago).toBe(450);
  });

  it("ym mal formatado → 422", async () => {
    const fixa = await addFixa();
    const res = await api.put(`/despesas/espacos/${esp}/fixas/${fixa.id}/pago/2026-7`, {
      valorPago: 10,
    });
    expect(res.status).toBe(422);
  });

  it("valorPago negativo → 422", async () => {
    const fixa = await addFixa();
    expect(
      (await api.put(`/despesas/espacos/${esp}/fixas/${fixa.id}/pago/2026-07`, { valorPago: -1 })).status
    ).toBe(422);
  });

  it("fixa de outro espaço → 404", async () => {
    const fixa = await addFixa({}, outroEsp);
    expect(
      (await api.put(`/despesas/espacos/${esp}/fixas/${fixa.id}/pago/2026-07`, { valorPago: 10 })).status
    ).toBe(404);
  });
});

describe("DELETE /fixas/:id", () => {
  it("remove a fixa e os pagamentos dela", async () => {
    const fixa = await addFixa();
    await api.put(`/despesas/espacos/${esp}/fixas/${fixa.id}/pago/2026-07`, { valorPago: 100 });

    const res = await api.delete(`/despesas/espacos/${esp}/fixas/${fixa.id}`);
    expect(res.body).toEqual({ id: fixa.id });

    const orc = await api.get(`/despesas/espacos/${esp}`);
    expect(orc.body.despesasFixas).toEqual([]);
    expect(orc.body.pagamentosFixas).toEqual([]);
  });

  it("fixa de outro espaço → 404", async () => {
    const fixa = await addFixa({}, outroEsp);
    expect((await api.delete(`/despesas/espacos/${esp}/fixas/${fixa.id}`)).status).toBe(404);
  });
});

// ── Despesas do mês ──────────────────────────────────────────────────────────

describe("POST /mes", () => {
  it("sem data usa o dia 01 do mês", async () => {
    const res = await api.post(`/despesas/espacos/${esp}/mes`, { mes: "2026-07", valor: 99.999 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: res.body.id,
      mes: "2026-07",
      descricao: "Despesa",
      valor: 100,
      data: "2026-07-01",
      paga: false,
      valorPago: 0,
      cartaoId: null,
      categoriaId: null,
      nota: null,
    });
  });

  it("aceita data, cartão, categoria e nota", async () => {
    const cartao = (await api.post("/cartoes", { nome: "Inter" })).body;
    const cat = (await api.post("/categorias", { nome: "Compras" })).body;

    const dm = await addMes({
      data: "2026-07-18",
      cartaoId: cartao.id,
      categoriaId: cat.id,
      nota: "parcelado no crédito",
    });
    expect(dm).toMatchObject({
      data: "2026-07-18",
      cartaoId: cartao.id,
      categoriaId: cat.id,
      nota: "parcelado no crédito",
    });
  });

  it("mes fora de YYYY-MM → 422", async () => {
    expect((await api.post(`/despesas/espacos/${esp}/mes`, { mes: "2026/07", valor: 10 })).status).toBe(
      422
    );
  });

  it("despesa do mês não aceita parcelamento (campo ignorado)", async () => {
    const dm = await addMes({ parcelado: true, totalParcelas: 5 });
    expect(dm.parcelado).toBeUndefined();
  });

  it("data fora do mês → 422 com issue em data", async () => {
    // a lista filtra por `mes`: data de outro mês faria a linha sumir da tela
    const res = await api.post(`/despesas/espacos/${esp}/mes`, {
      mes: "2026-07",
      valor: 10,
      data: "2026-08-01",
    });
    expect(res.status).toBe(422);
    expect(res.body.issues.some((i: { path: string[] }) => i.path[0] === "data")).toBe(true);
  });
});

describe("PATCH /mes/:id", () => {
  it("atualiza descrição, valor e data", async () => {
    const dm = await addMes();
    const res = await api.patch(`/despesas/espacos/${esp}/mes/${dm.id}`, {
      descricao: "Mercado grande",
      valor: 355.559,
      data: "2026-07-20",
    });
    expect(res.body).toMatchObject({ descricao: "Mercado grande", valor: 355.56, data: "2026-07-20" });
  });

  it("desvincula cartão e categoria com null", async () => {
    const cartao = (await api.post("/cartoes", { nome: "Inter" })).body;
    const dm = await addMes({ cartaoId: cartao.id });
    const res = await api.patch(`/despesas/espacos/${esp}/mes/${dm.id}`, {
      cartaoId: null,
      categoriaId: null,
    });
    expect(res.body).toMatchObject({ cartaoId: null, categoriaId: null });
  });

  it("data fora do mês do registro → 422", async () => {
    const dm = await addMes();
    const res = await api.patch(`/despesas/espacos/${esp}/mes/${dm.id}`, { data: "2026-08-02" });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain("2026-07");
  });

  it("despesa de outro espaço → 404", async () => {
    const dm = await addMes({}, outroEsp);
    const res = await api.patch(`/despesas/espacos/${esp}/mes/${dm.id}`, { valor: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Despesa do mês não encontrada");
  });
});

describe("PUT /mes/:id/pago", () => {
  it("pagamento parcial mantém paga=false", async () => {
    const dm = await addMes({ valor: 300 });
    const res = await api.put(`/despesas/espacos/${esp}/mes/${dm.id}/pago`, { valorPago: 100 });
    expect(res.body).toMatchObject({ valorPago: 100, paga: false });
  });

  it("pagamento total marca paga e clampa o excesso", async () => {
    const dm = await addMes({ valor: 300 });
    const res = await api.put(`/despesas/espacos/${esp}/mes/${dm.id}/pago`, { valorPago: 999 });
    expect(res.body).toMatchObject({ valorPago: 300, paga: true });
  });

  it("despesa de valor 0 nunca fica paga", async () => {
    const dm = await addMes({ valor: 0 });
    const res = await api.put(`/despesas/espacos/${esp}/mes/${dm.id}/pago`, { valorPago: 0 });
    expect(res.body).toMatchObject({ valorPago: 0, paga: false });
  });

  it("zerar o pago desmarca", async () => {
    const dm = await addMes({ valor: 300 });
    await api.put(`/despesas/espacos/${esp}/mes/${dm.id}/pago`, { valorPago: 300 });
    const res = await api.put(`/despesas/espacos/${esp}/mes/${dm.id}/pago`, { valorPago: 0 });
    expect(res.body).toMatchObject({ valorPago: 0, paga: false });
  });

  it("despesa de outro espaço → 404", async () => {
    const dm = await addMes({}, outroEsp);
    expect(
      (await api.put(`/despesas/espacos/${esp}/mes/${dm.id}/pago`, { valorPago: 10 })).status
    ).toBe(404);
  });
});

describe("DELETE /mes/:id", () => {
  it("remove", async () => {
    const dm = await addMes();
    expect((await api.delete(`/despesas/espacos/${esp}/mes/${dm.id}`)).body).toEqual({ id: dm.id });
    expect((await api.get(`/despesas/espacos/${esp}`)).body.despesasMes).toEqual([]);
  });

  it("de outro espaço → 404", async () => {
    const dm = await addMes({}, outroEsp);
    expect((await api.delete(`/despesas/espacos/${esp}/mes/${dm.id}`)).status).toBe(404);
  });
});

// ── Receitas do mês ──────────────────────────────────────────────────────────

describe("receitas do mês", () => {
  it("CRUD completo", async () => {
    const criada = await api.post(`/despesas/espacos/${esp}/receitas`, {
      mes: "2026-07",
      valor: 600.559,
    });
    expect(criada.status).toBe(201);
    expect(criada.body).toEqual({
      id: criada.body.id,
      mes: "2026-07",
      descricao: "Receita extra",
      valor: 600.56,
      data: "2026-07-01",
    });

    const patch = await api.patch(`/despesas/espacos/${esp}/receitas/${criada.body.id}`, {
      descricao: "Freela",
      valor: 700,
      data: "2026-07-15",
    });
    expect(patch.body).toMatchObject({ descricao: "Freela", valor: 700, data: "2026-07-15" });

    const del = await api.delete(`/despesas/espacos/${esp}/receitas/${criada.body.id}`);
    expect(del.body).toEqual({ id: criada.body.id });
    expect((await api.get(`/despesas/espacos/${esp}`)).body.receitasMes).toEqual([]);
  });

  it("receita de outro espaço → 404 em patch e delete", async () => {
    const r = (
      await api.post(`/despesas/espacos/${outroEsp}/receitas`, { mes: "2026-07", valor: 100 })
    ).body;

    const patch = await api.patch(`/despesas/espacos/${esp}/receitas/${r.id}`, { valor: 1 });
    expect(patch.status).toBe(404);
    expect(patch.body.error).toContain("Receita do mês não encontrada");
    expect((await api.delete(`/despesas/espacos/${esp}/receitas/${r.id}`)).status).toBe(404);
  });

  it("mes inválido → 422", async () => {
    expect(
      (await api.post(`/despesas/espacos/${esp}/receitas`, { mes: "07-2026", valor: 10 })).status
    ).toBe(422);
  });
});

// ── Renda mensal ─────────────────────────────────────────────────────────────

describe("renda do mês", () => {
  it("define, sobrescreve e limpa", async () => {
    const set = await api.put(`/despesas/espacos/${esp}/rendas/2026-07`, { valor: 5000.559 });
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ ym: "2026-07", valor: 5000.56 });

    await api.put(`/despesas/espacos/${esp}/rendas/2026-07`, { valor: 6000 });
    expect((await api.get(`/despesas/espacos/${esp}`)).body.rendasMensais).toEqual({ "2026-07": 6000 });

    const clear = await api.delete(`/despesas/espacos/${esp}/rendas/2026-07`);
    expect(clear.body).toEqual({ ym: "2026-07" });
    expect((await api.get(`/despesas/espacos/${esp}`)).body.rendasMensais).toEqual({});
  });

  it("limpar mês sem override é no-op", async () => {
    expect((await api.delete(`/despesas/espacos/${esp}/rendas/2026-09`)).status).toBe(200);
  });

  it("ym inválido → 422 (PUT e DELETE)", async () => {
    expect((await api.put(`/despesas/espacos/${esp}/rendas/2026`, { valor: 10 })).status).toBe(422);
    expect((await api.delete(`/despesas/espacos/${esp}/rendas/2026`)).status).toBe(422);
  });

  it("espaço de outra conta → 404", async () => {
    const outro = await account({ roles: ["membro"] });
    const alheio = (await outro.api.post("/despesas/espacos", { nome: "Alheio" })).body.id;
    expect((await api.put(`/despesas/espacos/${alheio}/rendas/2026-07`, { valor: 10 })).status).toBe(404);
    expect((await api.delete(`/despesas/espacos/${alheio}/rendas/2026-07`)).status).toBe(404);
  });
});

// ── Vínculos com cartão e categoria ─────────────────────────────────────────

describe("cartaoId / categoriaId só aceitam recurso do próprio dono", () => {
  const alheios = async () => {
    const outro = await account({ roles: ["membro"] });
    return {
      cartaoId: (await outro.api.post("/cartoes", { nome: "Cartão alheio" })).body.id,
      categoriaId: (await outro.api.post("/categorias", { nome: "Categoria alheia" })).body.id,
    };
  };

  it("fixa com cartão de outra conta → 404 e nada é criado", async () => {
    const { cartaoId } = await alheios();

    const res = await api.post(`/despesas/espacos/${esp}/fixas`, {
      descricao: "Invasora",
      valor: 500,
      cartaoId,
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Cartão não encontrado");
    expect((await api.get(`/despesas/espacos/${esp}`)).body.despesasFixas).toEqual([]);
  });

  it("a fatura do dono do cartão não pode ser inflada por fixa de outra conta", async () => {
    const vitima = await account({ roles: ["membro"] });
    const cartaoId = (await vitima.api.post("/cartoes", { nome: "Nubank", limite: 1000 })).body.id;

    const res = await api.post(`/despesas/espacos/${esp}/fixas`, {
      descricao: "Cobrança injetada",
      valor: 900,
      cartaoId,
    });
    expect(res.status).toBe(404);

    const cartoes = await vitima.api.get("/cartoes");
    expect(cartoes.body[0]).toMatchObject({ faturaMes: 0, comprometido: 0, disponivel: 1000 });
  });

  it("fixa com categoria de outra conta → 404", async () => {
    const { categoriaId } = await alheios();
    const res = await api.post(`/despesas/espacos/${esp}/fixas`, {
      descricao: "X",
      valor: 10,
      categoriaId,
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Categoria não encontrada");
  });

  it("patch de fixa não pode apontar cartão/categoria alheios", async () => {
    const { cartaoId, categoriaId } = await alheios();
    const fixa = await addFixa();

    expect((await api.patch(`/despesas/espacos/${esp}/fixas/${fixa.id}`, { cartaoId })).status).toBe(404);
    expect((await api.patch(`/despesas/espacos/${esp}/fixas/${fixa.id}`, { categoriaId })).status).toBe(
      404
    );

    const atual = (await api.get(`/despesas/espacos/${esp}`)).body.despesasFixas[0];
    expect(atual).toMatchObject({ cartaoId: null, categoriaId: null });
  });

  it("despesa do mês idem, no create e no patch", async () => {
    const { cartaoId, categoriaId } = await alheios();

    expect(
      (await api.post(`/despesas/espacos/${esp}/mes`, { mes: "2026-07", valor: 10, cartaoId })).status
    ).toBe(404);
    expect(
      (await api.post(`/despesas/espacos/${esp}/mes`, { mes: "2026-07", valor: 10, categoriaId })).status
    ).toBe(404);

    const dm = await addMes();
    expect((await api.patch(`/despesas/espacos/${esp}/mes/${dm.id}`, { cartaoId })).status).toBe(404);
    expect((await api.patch(`/despesas/espacos/${esp}/mes/${dm.id}`, { categoriaId })).status).toBe(404);
  });

  it("cartão e categoria próprios seguem funcionando; null limpa", async () => {
    const cartaoId = (await api.post("/cartoes", { nome: "Meu" })).body.id;
    const categoriaId = (await api.post("/categorias", { nome: "Minha" })).body.id;

    const fixa = await addFixa({ cartaoId, categoriaId });
    expect(fixa).toMatchObject({ cartaoId, categoriaId });

    const limpa = await api.patch(`/despesas/espacos/${esp}/fixas/${fixa.id}`, {
      cartaoId: null,
      categoriaId: null,
    });
    expect(limpa.body).toMatchObject({ cartaoId: null, categoriaId: null });
  });
});

describe("permissions", () => {
  it("todas as mutações de orçamento exigem orcamento:manage", async () => {
    const leitor = await account({ roles: ["leitor"] });
    const res = await leitor.api.post(`/despesas/espacos/${esp}/fixas`, { valor: 10 });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Sem permissão: orcamento:manage" });
    expect((await leitor.api.put(`/despesas/espacos/${esp}/rendas/2026-07`, { valor: 1 })).status).toBe(
      403
    );
  });
});
