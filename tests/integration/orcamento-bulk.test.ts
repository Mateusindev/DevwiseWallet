// Integração: ações em lote de despesas (fixas e do mês). O que importa aqui é
// atomicidade (id alheio não aplica nada) e o `ignoradas` das parceladas.
import { describe, expect, it, beforeEach } from "bun:test";
import { account, resetDb, seedRoles, type Client } from "./harness";
import { currentMonth } from "@/server/lib/serialize";

let api: Client;
let esp: string;
let outroEsp: string;

const UUID_ZERO = "00000000-0000-0000-0000-000000000000";
const YM = currentMonth();

beforeEach(async () => {
  await resetDb();
  await seedRoles();
  api = (await account({ roles: ["membro"] })).api;
  esp = (await api.post("/despesas/espacos", { nome: "Principal" })).body.id;
  outroEsp = (await api.post("/despesas/espacos", { nome: "Secundário" })).body.id;
});

const addFixa = async (body: Record<string, unknown> = {}, espaco = esp) =>
  (await api.post(`/despesas/espacos/${espaco}/fixas`, { descricao: "Aluguel", valor: 900, ...body })).body.despesa;

const addMes = async (body: Record<string, unknown> = {}, espaco = esp) =>
  (await api.post(`/despesas/espacos/${espaco}/mes`, { mes: "2026-07", descricao: "Mercado", valor: 300, ...body }))
    .body.despesa;

const bulkMes = (body: Record<string, unknown>, espaco = esp) =>
  api.post(`/despesas/espacos/${espaco}/mes/bulk`, body);
const bulkFixa = (body: Record<string, unknown>, espaco = esp) =>
  api.post(`/despesas/espacos/${espaco}/fixas/bulk`, body);

const listaMes = async () => (await api.get(`/despesas/espacos/${esp}`)).body.despesasMes;

describe("POST /mes/bulk", () => {
  it("pagar quita cada linha pelo próprio valor", async () => {
    const a = await addMes({ valor: 100 });
    const b = await addMes({ valor: 250 });
    const res = await bulkMes({ ids: [a.id, b.id], op: "pagar" });

    expect(res.status).toBe(200);
    expect(res.body.op).toBe("pagar");
    expect(res.body.aplicadas).toHaveLength(2);
    expect(res.body.aplicadas.every((d: { paga: boolean }) => d.paga)).toBe(true);
    expect(res.body.aplicadas.map((d: { valorPago: number }) => d.valorPago).sort()).toEqual([100, 250]);
  });

  it("despagar desfaz", async () => {
    const a = await addMes({ valor: 100 });
    await bulkMes({ ids: [a.id], op: "pagar" });
    const res = await bulkMes({ ids: [a.id], op: "despagar" });
    expect(res.body.aplicadas[0]).toMatchObject({ paga: false, valorPago: 0 });
  });

  it("excluir devolve os removidos e apaga do orçamento", async () => {
    const a = await addMes();
    const b = await addMes();
    const c = await addMes();
    const res = await bulkMes({ ids: [a.id, b.id], op: "excluir" });

    expect(res.body.removidos.sort()).toEqual([a.id, b.id].sort());
    expect((await listaMes()).map((d: { id: string }) => d.id)).toEqual([c.id]);
  });

  it("categoria e cartão aplicam no lote (e null limpa)", async () => {
    const cat = (await api.post("/categorias", { nome: "Mercado" })).body;
    const cartao = (await api.post("/cartoes", { nome: "Nubank" })).body;
    const a = await addMes();
    const b = await addMes();

    const comCat = await bulkMes({ ids: [a.id, b.id], op: "categoria", categoriaId: cat.id });
    expect(comCat.body.aplicadas.every((d: { categoriaId: string }) => d.categoriaId === cat.id)).toBe(true);

    const comCartao = await bulkMes({ ids: [a.id, b.id], op: "cartao", cartaoId: cartao.id });
    expect(comCartao.body.aplicadas.every((d: { cartaoId: string }) => d.cartaoId === cartao.id)).toBe(true);

    const limpo = await bulkMes({ ids: [a.id], op: "categoria", categoriaId: null });
    expect(limpo.body.aplicadas[0].categoriaId).toBeNull();
  });

  it("categoria de outro dono → 404 e nada aplicado", async () => {
    const outro = await account({ roles: ["membro"] });
    const catAlheia = (await outro.api.post("/categorias", { nome: "Alheia" })).body;
    const a = await addMes();

    const res = await bulkMes({ ids: [a.id], op: "categoria", categoriaId: catAlheia.id });
    expect(res.status).toBe(404);
    expect((await listaMes())[0].categoriaId).toBeNull();
  });

  it("id inexistente no lote → 404 e nada aplicado (transação)", async () => {
    const a = await addMes({ valor: 100 });
    const res = await bulkMes({ ids: [a.id, UUID_ZERO], op: "pagar" });

    expect(res.status).toBe(404);
    expect((await listaMes())[0]).toMatchObject({ paga: false, valorPago: 0 });
  });

  it("despesa de outro espaço do mesmo dono → 404", async () => {
    const alheia = await addMes({}, outroEsp);
    expect((await bulkMes({ ids: [alheia.id], op: "excluir" })).status).toBe(404);
  });

  it("op=categoria sem categoriaId → 422", async () => {
    const a = await addMes();
    const res = await bulkMes({ ids: [a.id], op: "categoria" });
    expect(res.status).toBe(422);
    expect(res.body.issues.some((i: { path: string[] }) => i.path[0] === "categoriaId")).toBe(true);
  });

  it("ids vazio, id não-uuid e op inválida → 422", async () => {
    expect((await bulkMes({ ids: [], op: "pagar" })).status).toBe(422);
    expect((await bulkMes({ ids: ["nope"], op: "pagar" })).status).toBe(422);
    expect((await bulkMes({ ids: [UUID_ZERO], op: "voar" })).status).toBe(422);
  });

  it("mais de 200 ids → 422", async () => {
    const ids = Array.from({ length: 201 }, () => UUID_ZERO);
    expect((await bulkMes({ ids, op: "pagar" })).status).toBe(422);
  });

  it("sem orcamento:manage → 403", async () => {
    const leitor = await account({ permissions: ["orcamento:view", "espaco:view"] });
    const res = await leitor.api.post(`/despesas/espacos/${esp}/mes/bulk`, { ids: [UUID_ZERO], op: "pagar" });
    expect(res.status).toBe(403);
  });
});

describe("POST /fixas/bulk", () => {
  it("pagar registra o pagamento do mês", async () => {
    const a = await addFixa({ valor: 900 });
    const b = await addFixa({ valor: 100 });
    const res = await bulkFixa({ ids: [a.id, b.id], op: "pagar", ym: YM });

    expect(res.status).toBe(200);
    expect(res.body.ignoradas).toBe(0);
    expect(res.body.pagamentos).toHaveLength(2);
    expect(res.body.pagamentos.map((p: { valorPago: number }) => p.valorPago).sort()).toEqual([100, 900]);
  });

  it("despagar remove o pagamento do mês", async () => {
    const a = await addFixa();
    await bulkFixa({ ids: [a.id], op: "pagar", ym: YM });
    const res = await bulkFixa({ ids: [a.id], op: "despagar", ym: YM });
    expect(res.body.pagamentos).toEqual([]);
  });

  it("parcelada já quitada é ignorada, não erro", async () => {
    const ativa = await addFixa({ valor: 100 });
    // parcela 3/3 ancorada no mês atual → no mês seguinte já acabou
    const quitada = await addFixa({ valor: 50, parcelado: true, parcelaAtual: 3, totalParcelas: 3 });
    const proximo = (() => {
      const [y, m] = YM.split("-").map(Number);
      const d = new Date(Date.UTC(y, m, 1));
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    })();

    const res = await bulkFixa({ ids: [ativa.id, quitada.id], op: "pagar", ym: proximo });
    expect(res.body.ignoradas).toBe(1);
    expect(res.body.pagamentos).toHaveLength(1);
    expect(res.body.pagamentos[0].despesaFixaId).toBe(ativa.id);
  });

  it("pausar e ativar em lote", async () => {
    const a = await addFixa();
    const b = await addFixa();
    const pausadas = await bulkFixa({ ids: [a.id, b.id], op: "pausar", ym: YM });
    expect(pausadas.body.aplicadas.every((d: { ativa: boolean }) => d.ativa === false)).toBe(true);

    const ativas = await bulkFixa({ ids: [a.id, b.id], op: "ativar", ym: YM });
    expect(ativas.body.aplicadas.every((d: { ativa: boolean }) => d.ativa === true)).toBe(true);
  });

  it("tirar o cartão em lote zera o parcelamento", async () => {
    const cartao = (await api.post("/cartoes", { nome: "Inter" })).body;
    const a = await addFixa({ cartaoId: cartao.id, parcelado: true, parcelaAtual: 2, totalParcelas: 10 });

    const res = await bulkFixa({ ids: [a.id], op: "cartao", cartaoId: null, ym: YM });
    expect(res.body.aplicadas[0]).toMatchObject({
      cartaoId: null,
      parcelado: false,
      parcelaAtual: null,
      totalParcelas: null,
    });
  });

  it("excluir apaga as fixas e os pagamentos delas", async () => {
    const a = await addFixa();
    await bulkFixa({ ids: [a.id], op: "pagar", ym: YM });
    const res = await bulkFixa({ ids: [a.id], op: "excluir", ym: YM });

    expect(res.body.removidos).toEqual([a.id]);
    const orc = (await api.get(`/despesas/espacos/${esp}`)).body;
    expect(orc.despesasFixas).toEqual([]);
    expect(orc.pagamentosFixas).toEqual([]);
  });

  it("cartão de outro dono → 404 e nada aplicado", async () => {
    const outro = await account({ roles: ["membro"] });
    const cartaoAlheio = (await outro.api.post("/cartoes", { nome: "Alheio" })).body;
    const a = await addFixa();

    const res = await bulkFixa({ ids: [a.id], op: "cartao", cartaoId: cartaoAlheio.id, ym: YM });
    expect(res.status).toBe(404);
    const orc = (await api.get(`/despesas/espacos/${esp}`)).body;
    expect(orc.despesasFixas[0].cartaoId).toBeNull();
  });

  it("ym inválido → 422", async () => {
    const a = await addFixa();
    expect((await bulkFixa({ ids: [a.id], op: "pagar", ym: "2026/07" })).status).toBe(422);
  });
});
