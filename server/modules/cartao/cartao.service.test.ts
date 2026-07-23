import { describe, expect, it, beforeEach, mock } from "bun:test";

type Row = Record<string, unknown>;

const state: { fixas: Row[]; avulsas: Row[]; parceladas: Row[] } = {
  fixas: [],
  avulsas: [],
  parceladas: [],
};

const cartao = {
  id: "ct-1",
  nome: "Nubank",
  bandeira: "Master",
  limite: 8000,
  diaFechamento: 3,
  diaVencimento: 10,
  cor: "violet",
  ordem: 1,
};

const fixa = (over: Row = {}): Row => ({
  id: "df-1",
  valor: 200,
  parcelado: false,
  parcelaAtual: null,
  totalParcelas: null,
  parcelaMesRef: null,
  ...over,
});

mock.module("@/server/modules/cartao/cartao.repository", () => ({
  cartaoRepository: {
    list: async () => [cartao],
    findById: async (id: string) => (id === "ct-1" ? cartao : null),
    count: async () => 1,
    fixasAtivasDoCartao: async () => state.fixas,
    avulsasDoCartaoNoMes: async () => state.avulsas,
    fixasParceladas: async () => state.parceladas,
  },
}));

const { cartaoService } = await import("./cartao.service");

beforeEach(() => {
  state.fixas = [];
  state.avulsas = [];
  state.parceladas = [];
});

describe("cartaoService.withAggregates", () => {
  it("fatura = fixas ativas + avulsas do mês", async () => {
    state.fixas = [fixa({ valor: 200 }), fixa({ id: "df-2", valor: 40 })];
    state.avulsas = [{ valor: 250 }];
    const v = await cartaoService.withAggregates(cartao as never, "2026-06");
    expect(v.faturaMes).toBe(490);
    expect(v.comprometido).toBe(0);
    expect(v.disponivel).toBe(8000 - 490);
  });

  it("fixa parcelada fora da janela não entra na fatura", async () => {
    // 12/12 em 2026-06 → em 2026-07 já quitou
    state.fixas = [fixa({ parcelado: true, parcelaAtual: 12, totalParcelas: 12, parcelaMesRef: "2026-06", valor: 100 })];
    const v = await cartaoService.withAggregates(cartao as never, "2026-07");
    expect(v.faturaMes).toBe(0);
  });

  it("comprometido = parcelas restantes × valor", async () => {
    // parcela 3/12 em 2026-06 → restam 9 × 200 = 1800
    const parc = fixa({ parcelado: true, parcelaAtual: 3, totalParcelas: 12, parcelaMesRef: "2026-06", valor: 200 });
    state.fixas = [parc];
    state.parceladas = [parc];
    const v = await cartaoService.withAggregates(cartao as never, "2026-06");
    expect(v.faturaMes).toBe(200);
    expect(v.comprometido).toBe(1800);
    expect(v.disponivel).toBe(8000 - 200 - 1800);
  });

  it("comprometido auto-avança com o mês visto", async () => {
    const parc = fixa({ parcelado: true, parcelaAtual: 3, totalParcelas: 12, parcelaMesRef: "2026-06", valor: 200 });
    state.parceladas = [parc];
    const v = await cartaoService.withAggregates(cartao as never, "2026-08"); // efetiva 5 → restam 7
    expect(v.comprometido).toBe(1400);
  });
});
