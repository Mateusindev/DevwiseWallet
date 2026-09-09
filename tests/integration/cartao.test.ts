// Integração: /api/cartoes — CRUD e os agregados do mês (fatura, comprometido
// futuro, disponível) somando fixas + avulsas de TODOS os espaços do dono.
import { describe, expect, it, beforeEach } from "bun:test";
import { account, resetDb, seedRoles, prisma, type Client } from "./harness";
import { currentMonth } from "@/server/lib/serialize";

let api: Client;
let esp: string;

const UUID_ZERO = "00000000-0000-0000-0000-000000000000";

// "2026-07" + 2 → "2026-09"
function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

beforeEach(async () => {
  await resetDb();
  await seedRoles();
  api = (await account({ roles: ["membro"] })).api;
  esp = (await api.post("/despesas/espacos", { nome: "Principal" })).body.id;
});

const novoCartao = async (body: Record<string, unknown> = {}) =>
  (await api.post("/cartoes", { nome: "Nubank", limite: 5000, ...body })).body;

const fixaNoCartao = async (cartaoId: string, body: Record<string, unknown> = {}, espaco = esp) =>
  (
    await api.post(`/despesas/espacos/${espaco}/fixas`, {
      descricao: "Assinatura",
      valor: 100,
      cartaoId,
      ...body,
    })
  ).body.despesa;

const avulsaNoCartao = async (cartaoId: string, body: Record<string, unknown> = {}, espaco = esp) =>
  (
    await api.post(`/despesas/espacos/${espaco}/mes`, {
      mes: currentMonth(),
      descricao: "Compra",
      valor: 250,
      cartaoId,
      ...body,
    })
  ).body.despesa;

describe("POST /api/cartoes", () => {
  it("cria com defaults e ordem 1", async () => {
    const res = await api.post("/cartoes", {});
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: res.body.id,
      nome: "Novo cartão",
      bandeira: null,
      limite: 0,
      diaFechamento: null,
      diaVencimento: 1,
      cor: "violet",
      ordem: 1,
    });
  });

  it("ordem é count+1 e arredonda o limite", async () => {
    await novoCartao();
    const segundo = await novoCartao({ nome: "Inter", limite: 1999.999, bandeira: " Visa " });
    expect(segundo).toMatchObject({ ordem: 2, limite: 2000, bandeira: "Visa" });
  });

  it("dia fora de 1..31 e limite negativo → 422", async () => {
    expect((await api.post("/cartoes", { diaVencimento: 0 })).status).toBe(422);
    expect((await api.post("/cartoes", { diaFechamento: 32 })).status).toBe(422);
    expect((await api.post("/cartoes", { limite: -1 })).status).toBe(422);
  });
});

describe("GET /api/cartoes (agregados)", () => {
  it("cartão sem despesa: fatura 0 e disponível = limite", async () => {
    await novoCartao({ limite: 5000 });
    const res = await api.get("/cartoes");
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ faturaMes: 0, comprometido: 0, disponivel: 5000 });
  });

  it("soma fixas ativas + avulsas do mês", async () => {
    const cartao = await novoCartao({ limite: 5000 });
    await fixaNoCartao(cartao.id, { valor: 100 });
    await avulsaNoCartao(cartao.id, { valor: 250.5 });

    const res = await api.get(`/cartoes?ym=${currentMonth()}`);
    expect(res.body[0]).toMatchObject({
      faturaMes: 350.5,
      comprometido: 0,
      disponivel: 4649.5,
    });
  });

  it("fixa inativa e avulsa de outro mês ficam fora", async () => {
    const cartao = await novoCartao({ limite: 1000 });
    const fixa = await fixaNoCartao(cartao.id, { valor: 100 });
    await api.patch(`/despesas/espacos/${esp}/fixas/${fixa.id}/toggle`);
    await avulsaNoCartao(cartao.id, { valor: 80, mes: addMonths(currentMonth(), 1) });

    const res = await api.get("/cartoes");
    expect(res.body[0]).toMatchObject({ faturaMes: 0, disponivel: 1000 });
  });

  it("despesa sem cartão não entra na fatura de ninguém", async () => {
    await novoCartao({ limite: 1000 });
    await api.post(`/despesas/espacos/${esp}/fixas`, { descricao: "Aluguel", valor: 900 });

    expect((await api.get("/cartoes")).body[0]).toMatchObject({ faturaMes: 0, disponivel: 1000 });
  });

  it("cartão é global na conta: soma despesas de todos os espaços", async () => {
    const outroEsp = (await api.post("/despesas/espacos", { nome: "Secundário" })).body.id;
    const cartao = await novoCartao({ limite: 2000 });
    await fixaNoCartao(cartao.id, { valor: 100 });
    await fixaNoCartao(cartao.id, { valor: 40, descricao: "Streaming" }, outroEsp);

    expect((await api.get("/cartoes")).body[0]).toMatchObject({ faturaMes: 140, disponivel: 1860 });
  });

  it("fixa parcelada: conta na fatura do mês e compromete as parcelas restantes", async () => {
    const cartao = await novoCartao({ limite: 5000 });
    // âncora = mês corrente, parcela 3 de 12, R$200
    await fixaNoCartao(cartao.id, {
      descricao: "Jiu-jitsu",
      valor: 200,
      parcelado: true,
      parcelaAtual: 3,
      totalParcelas: 12,
    });

    const agora = await api.get(`/cartoes?ym=${currentMonth()}`);
    expect(agora.body[0]).toMatchObject({
      faturaMes: 200,
      comprometido: 1800, // (12 - 3) × 200
      disponivel: 3000,
    });

    // dois meses à frente a parcela auto-avança pra 5
    const futuro = await api.get(`/cartoes?ym=${addMonths(currentMonth(), 2)}`);
    expect(futuro.body[0]).toMatchObject({
      faturaMes: 200,
      comprometido: 1400, // (12 - 5) × 200
    });
  });

  it("parcelamento encerrado sai da fatura sozinho", async () => {
    const cartao = await novoCartao({ limite: 1000 });
    await fixaNoCartao(cartao.id, {
      valor: 150,
      parcelado: true,
      parcelaAtual: 12,
      totalParcelas: 12,
    });

    const depois = await api.get(`/cartoes?ym=${addMonths(currentMonth(), 1)}`);
    expect(depois.body[0]).toMatchObject({ faturaMes: 0, comprometido: 0, disponivel: 1000 });
  });

  it("disponível fica negativo quando a fatura passa do limite", async () => {
    const cartao = await novoCartao({ limite: 100 });
    await avulsaNoCartao(cartao.id, { valor: 300 });
    expect((await api.get("/cartoes")).body[0]).toMatchObject({ faturaMes: 300, disponivel: -200 });
  });

  it("lista por ordem asc e só os do dono", async () => {
    await novoCartao({ nome: "Primeiro" });
    await novoCartao({ nome: "Segundo" });

    const outro = await account({ roles: ["membro"] });
    await outro.api.post("/cartoes", { nome: "De outra conta" });

    const res = await api.get("/cartoes");
    expect(res.body.map((c: { nome: string }) => c.nome)).toEqual(["Primeiro", "Segundo"]);
  });

  it("ym mal formatado → 422", async () => {
    expect((await api.get("/cartoes?ym=2026")).status).toBe(422);
  });
});

describe("GET /api/cartoes/:id/fatura", () => {
  it("lista fixas na janela + avulsas do mês, com parcela efetiva", async () => {
    const cartao = await novoCartao();
    await fixaNoCartao(cartao.id, { descricao: "Streaming", valor: 40 });
    await fixaNoCartao(cartao.id, {
      descricao: "Jiu-jitsu",
      valor: 200,
      parcelado: true,
      parcelaAtual: 3,
      totalParcelas: 12,
    });
    await avulsaNoCartao(cartao.id, { descricao: "Geladeira", valor: 900 });

    const res = await api.get(`/cartoes/${cartao.id}/fatura?ym=${currentMonth()}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: expect.any(String),
        tipo: "fixa",
        descricao: "Streaming",
        valor: 40,
        parcelado: false,
        parcelaAtual: null,
        totalParcelas: null,
      },
      {
        id: expect.any(String),
        tipo: "fixa",
        descricao: "Jiu-jitsu",
        valor: 200,
        parcelado: true,
        parcelaAtual: 3,
        totalParcelas: 12,
      },
      {
        id: expect.any(String),
        tipo: "mes",
        descricao: "Geladeira",
        valor: 900,
        parcelado: false,
        parcelaAtual: null,
        totalParcelas: null,
      },
    ]);
  });

  it("parcela auto-avança conforme o mês pedido", async () => {
    const cartao = await novoCartao();
    await fixaNoCartao(cartao.id, {
      valor: 200,
      parcelado: true,
      parcelaAtual: 1,
      totalParcelas: 3,
    });

    const m2 = await api.get(`/cartoes/${cartao.id}/fatura?ym=${addMonths(currentMonth(), 2)}`);
    expect(m2.body[0]).toMatchObject({ parcelaAtual: 3, totalParcelas: 3 });

    const m3 = await api.get(`/cartoes/${cartao.id}/fatura?ym=${addMonths(currentMonth(), 3)}`);
    expect(m3.body).toEqual([]);
  });

  it("cartão inexistente ou de outra conta → 404", async () => {
    expect((await api.get(`/cartoes/${UUID_ZERO}/fatura`)).status).toBe(404);

    const outro = await account({ roles: ["membro"] });
    const alheio = (await outro.api.post("/cartoes", { nome: "Alheio" })).body;
    const res = await api.get(`/cartoes/${alheio.id}/fatura`);
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Cartão não encontrado");
  });
});

describe("PATCH /api/cartoes/:id", () => {
  it("atualiza e arredonda o limite", async () => {
    const cartao = await novoCartao();
    const res = await api.patch(`/cartoes/${cartao.id}`, {
      nome: "Nubank Ultravioleta",
      limite: 9999.994,
      diaFechamento: 3,
      ordem: 5,
    });
    expect(res.body).toMatchObject({
      nome: "Nubank Ultravioleta",
      limite: 9999.99,
      diaFechamento: 3,
      ordem: 5,
    });
  });

  it("bandeira: null limpa", async () => {
    const cartao = await novoCartao({ bandeira: "Visa" });
    expect((await api.patch(`/cartoes/${cartao.id}`, { bandeira: null })).body.bandeira).toBeNull();
  });

  it("de outra conta → 404", async () => {
    const outro = await account({ roles: ["membro"] });
    const alheio = (await outro.api.post("/cartoes", { nome: "Alheio" })).body;
    expect((await api.patch(`/cartoes/${alheio.id}`, { nome: "Hack" })).status).toBe(404);
  });
});

describe("DELETE /api/cartoes/:id", () => {
  it("remove o cartão e desvincula as despesas (cartao_id vira null)", async () => {
    const cartao = await novoCartao();
    const fixa = await fixaNoCartao(cartao.id);
    const avulsa = await avulsaNoCartao(cartao.id);

    const res = await api.delete(`/cartoes/${cartao.id}`);
    expect(res.body).toEqual({ id: cartao.id });
    expect((await api.get("/cartoes")).body).toEqual([]);

    expect((await prisma.despesaFixa.findUnique({ where: { id: fixa.id } }))?.cartaoId).toBeNull();
    expect((await prisma.despesaMes.findUnique({ where: { id: avulsa.id } }))?.cartaoId).toBeNull();
  });

  it("de outra conta → 404", async () => {
    const outro = await account({ roles: ["membro"] });
    const alheio = (await outro.api.post("/cartoes", { nome: "Alheio" })).body;
    expect((await api.delete(`/cartoes/${alheio.id}`)).status).toBe(404);
  });
});

describe("GET /api/cartoes/parceladas", () => {
  const mes = currentMonth();

  it("sem parcelada: listas vazias", async () => {
    await novoCartao();
    const res = await api.get("/cartoes/parceladas");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mes, fixas: [], pagamentos: [] });
  });

  it("traz parcelada de qualquer espaço, com cartão ou sem, e ignora fixa normal", async () => {
    const cartao = await novoCartao();
    const outroEsp = (await api.post("/despesas/espacos", { nome: "Secundário" })).body.id;
    await fixaNoCartao(cartao.id, { descricao: "Sofá", valor: 200, parcelado: true, parcelaAtual: 3, totalParcelas: 10 });
    await fixaNoCartao(cartao.id, { descricao: "Netflix", valor: 50 }); // fixa normal fica fora
    await api.post(`/despesas/espacos/${outroEsp}/fixas`, {
      descricao: "Fogão", valor: 50, parcelado: true, parcelaAtual: 1, totalParcelas: 4,
    });

    const { fixas } = (await api.get("/cartoes/parceladas")).body;
    expect(fixas.map((f: { descricao: string }) => f.descricao)).toEqual(["Fogão", "Sofá"]);
    expect(fixas.find((f: { descricao: string }) => f.descricao === "Sofá")).toMatchObject({
      valor: 200, cartaoId: cartao.id, parcelado: true, parcelaAtual: 3, totalParcelas: 10,
      parcelaMesRef: mes, espacoId: esp, espacoNome: "Principal",
    });
    // parcelada sem cartão (carnê) também é dívida a quitar
    expect(fixas.find((f: { descricao: string }) => f.descricao === "Fogão")).toMatchObject({
      cartaoId: null, espacoId: outroEsp, espacoNome: "Secundário",
    });
  });

  it("parcelada pausada fica fora", async () => {
    const cartao = await novoCartao();
    const fixa = await fixaNoCartao(cartao.id, { parcelado: true, parcelaAtual: 1, totalParcelas: 5 });
    await api.patch(`/despesas/espacos/${esp}/fixas/${fixa.id}/toggle`, {});
    expect((await api.get("/cartoes/parceladas")).body.fixas).toEqual([]);
  });

  it("devolve o pago no mês pedido, só das parceladas listadas", async () => {
    const cartao = await novoCartao();
    const parc = await fixaNoCartao(cartao.id, { valor: 200, parcelado: true, parcelaAtual: 2, totalParcelas: 6 });
    const normal = await fixaNoCartao(cartao.id, { descricao: "Netflix", valor: 50 });
    await api.put(`/despesas/espacos/${esp}/fixas/${parc.id}/pago/${mes}`, { valorPago: 80 });
    await api.put(`/despesas/espacos/${esp}/fixas/${normal.id}/pago/${mes}`, { valorPago: 50 });

    const res = await api.get("/cartoes/parceladas");
    expect(res.body.pagamentos).toEqual([{ despesaFixaId: parc.id, ym: mes, valorPago: 80 }]);

    // outro mês → nada pago
    const outroMes = addMonths(mes, 1);
    const noOutro = await api.get(`/cartoes/parceladas?ym=${outroMes}`);
    expect(noOutro.body).toMatchObject({ mes: outroMes, pagamentos: [] });
  });

  it("não vaza parcelada de outra conta", async () => {
    const outro = await account({ roles: ["membro"] });
    const espAlheio = (await outro.api.post("/despesas/espacos", { nome: "Dele" })).body.id;
    await outro.api.post(`/despesas/espacos/${espAlheio}/fixas`, {
      descricao: "Alheia", valor: 999, parcelado: true, parcelaAtual: 1, totalParcelas: 9,
    });
    expect((await api.get("/cartoes/parceladas")).body.fixas).toEqual([]);
  });

  it("ym malformado → 422", async () => {
    expect((await api.get("/cartoes/parceladas?ym=2026-1")).status).toBe(422);
  });
});

describe("GET /api/cartoes/resumo", () => {
  it("soma a fatura mês a mês, por cartão e por categoria", async () => {
    const nubank = await novoCartao({ nome: "Nubank" });
    const inter = await novoCartao({ nome: "Inter" });
    const cat = (await api.post("/categorias", { nome: "Mercado" })).body;
    const mes = currentMonth();

    await fixaNoCartao(nubank.id, { valor: 100, categoriaId: cat.id });
    await fixaNoCartao(inter.id, { valor: 40 });
    await avulsaNoCartao(nubank.id, { valor: 250, mes, categoriaId: cat.id });

    const res = await api.get(`/cartoes/resumo?de=${mes}&ate=${mes}`);
    expect(res.status).toBe(200);
    expect(res.body.meses).toHaveLength(1);
    expect(res.body.meses[0]).toMatchObject({ ym: mes, total: 390 });
    expect(res.body.meses[0].porCartao).toEqual([
      { cartaoId: nubank.id, total: 350 },
      { cartaoId: inter.id, total: 40 },
    ]);
    expect(res.body.meses[0].porCategoria).toEqual([
      { categoriaId: cat.id, total: 350 },
      { categoriaId: null, total: 40 },
    ]);
  });

  it("sem parâmetros usa a janela de 6 meses até o mês atual", async () => {
    const res = await api.get("/cartoes/resumo");
    expect(res.body.meses).toHaveLength(6);
    expect(res.body.meses[5].ym).toBe(currentMonth());
  });

  it("parcelada quitada não aparece no mês fora da janela dela", async () => {
    const cartao = await novoCartao();
    const mes = currentMonth();
    // 3/3 ancorada no mês atual → no mês seguinte já acabou
    await fixaNoCartao(cartao.id, { valor: 90, parcelado: true, parcelaAtual: 3, totalParcelas: 3 });

    const res = await api.get(`/cartoes/resumo?de=${mes}&ate=${addMonths(mes, 1)}`);
    expect(res.body.meses.map((m: { total: number }) => m.total)).toEqual([90, 0]);
  });

  it("só devolve dados do dono", async () => {
    const outro = await account({ roles: ["membro"] });
    const espAlheio = (await outro.api.post("/despesas/espacos", { nome: "Alheio" })).body.id;
    const cartaoAlheio = (await outro.api.post("/cartoes", { nome: "Alheio" })).body;
    await outro.api.post(`/despesas/espacos/${espAlheio}/fixas`, {
      descricao: "Fixa alheia", valor: 999, cartaoId: cartaoAlheio.id,
    });

    const res = await api.get("/cartoes/resumo");
    expect(res.body.meses.every((m: { total: number }) => m.total === 0)).toBe(true);
  });

  it("janela maior que 24 meses ou invertida → 422", async () => {
    expect((await api.get("/cartoes/resumo?de=2024-01&ate=2026-02")).status).toBe(422);
    expect((await api.get("/cartoes/resumo?de=2026-05&ate=2026-01")).status).toBe(422);
    expect((await api.get("/cartoes/resumo?de=2026/05&ate=2026-06")).status).toBe(422);
  });
});

describe("permissions", () => {
  it("leitor lê fatura e lista, não muta", async () => {
    const cartao = await novoCartao();
    const leitor = await account({ roles: ["leitor"] });

    expect((await leitor.api.get("/cartoes")).status).toBe(200);
    const res = await leitor.api.post("/cartoes", { nome: "Não vai" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Sem permissão: cartao:manage" });
    expect((await leitor.api.delete(`/cartoes/${cartao.id}`)).status).toBe(403);
  });

  it("sem cartao:view → 403", async () => {
    const sem = await account({ permissions: ["state:view"] });
    expect((await sem.api.get("/cartoes")).status).toBe(403);
    expect((await sem.api.get("/cartoes/parceladas")).status).toBe(403);
    expect((await sem.api.get("/cartoes/resumo")).status).toBe(403);
  });
});
