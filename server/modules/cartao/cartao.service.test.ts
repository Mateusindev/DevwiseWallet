import { describe, expect, it, beforeEach, mock } from "bun:test";
import { NotFoundError } from "@/server/lib/errors";

type Row = Record<string, unknown>;

const state: {
  fixas: Row[];
  avulsas: Row[];
  parceladas: Row[];
  created: Row | null;
  updated: { id: string; data: Row } | null;
  deleted: string | null;
} = {
  fixas: [],
  avulsas: [],
  parceladas: [],
  created: null,
  updated: null,
  deleted: null,
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
    create: async (data: Row) => {
      state.created = data;
      return { ...cartao, id: "ct-new", ...data };
    },
    update: async (id: string, data: Row) => {
      state.updated = { id, data };
      return { ...cartao, id, ...data };
    },
    delete: async (id: string) => {
      state.deleted = id;
    },
    fixasAtivasDoCartao: async () => state.fixas,
    avulsasDoCartaoNoMes: async () => state.avulsas,
    fixasParceladas: async () => state.parceladas,
  },
}));

const { cartaoService, cartaoView } = await import("./cartao.service");

const U = "u-1";

beforeEach(() => {
  state.fixas = [];
  state.avulsas = [];
  state.parceladas = [];
  state.created = null;
  state.updated = null;
  state.deleted = null;
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

  it("cartão sem lançamento nenhum: fatura 0 e disponível = limite", async () => {
    const v = await cartaoService.withAggregates(cartao as never, "2026-06");
    expect(v).toMatchObject({ faturaMes: 0, comprometido: 0, disponivel: 8000 });
  });

  it("parcelamento já quitado não gera comprometido", async () => {
    // 12/12 em 2026-06 → em 2026-07 restantes = 0
    state.parceladas = [
      fixa({ parcelado: true, parcelaAtual: 12, totalParcelas: 12, parcelaMesRef: "2026-06", valor: 100 }),
    ];
    expect((await cartaoService.withAggregates(cartao as never, "2026-07")).comprometido).toBe(0);
  });

  it("estouro de limite deixa o disponível negativo (não clampa em 0)", async () => {
    state.fixas = [fixa({ valor: 9000 })];
    expect((await cartaoService.withAggregates(cartao as never, "2026-06")).disponivel).toBe(-1000);
  });

  it("soma de centavos fica arredondada em 2 casas", async () => {
    state.fixas = [fixa({ valor: 0.1 }), fixa({ id: "df-2", valor: 0.2 })];
    expect((await cartaoService.withAggregates(cartao as never, "2026-06")).faturaMes).toBe(0.3);
  });
});

describe("cartaoView", () => {
  it("serializa o cadastro do cartão", () => {
    expect(cartaoView(cartao as never)).toEqual({
      id: "ct-1",
      nome: "Nubank",
      bandeira: "Master",
      limite: 8000,
      diaFechamento: 3,
      diaVencimento: 10,
      cor: "violet",
      ordem: 1,
    });
  });
});

describe("cartaoService.getOrThrow", () => {
  it("cartão de outro dono responde 404, não 403", async () => {
    expect(cartaoService.getOrThrow(U, "alheio")).rejects.toMatchObject({
      statusCode: 404,
      message: "Cartão não encontrado: alheio",
    });
  });
});

describe("cartaoService.listWithAggregates", () => {
  it("agrega cada cartão da lista no mês pedido", async () => {
    state.fixas = [fixa({ valor: 150 })];
    const [v] = await cartaoService.listWithAggregates(U, "2026-06");
    expect(v).toMatchObject({ id: "ct-1", faturaMes: 150, disponivel: 7850 });
  });
});

describe("cartaoService.faturaLinhas", () => {
  it("junta fixas na janela + avulsas do mês, marcando o tipo de cada linha", async () => {
    state.fixas = [
      fixa({ id: "df-1", descricao: "Streaming", valor: 40 }),
      fixa({
        id: "df-2",
        descricao: "Notebook",
        valor: 200,
        parcelado: true,
        parcelaAtual: 3,
        totalParcelas: 12,
        parcelaMesRef: "2026-06",
      }),
    ];
    state.avulsas = [{ id: "dm-1", descricao: "Mercado", valor: 90 }];

    const linhas = await cartaoService.faturaLinhas(U, "ct-1", "2026-06");

    expect(linhas).toEqual([
      { id: "df-1", tipo: "fixa", descricao: "Streaming", valor: 40, parcelado: false, parcelaAtual: null, totalParcelas: null },
      { id: "df-2", tipo: "fixa", descricao: "Notebook", valor: 200, parcelado: true, parcelaAtual: 3, totalParcelas: 12 },
      { id: "dm-1", tipo: "mes", descricao: "Mercado", valor: 90, parcelado: false, parcelaAtual: null, totalParcelas: null },
    ]);
  });

  it("parcela fora da janela não aparece na fatura", async () => {
    state.fixas = [
      fixa({ parcelado: true, parcelaAtual: 12, totalParcelas: 12, parcelaMesRef: "2026-06", valor: 100 }),
    ];
    expect(await cartaoService.faturaLinhas(U, "ct-1", "2026-07")).toEqual([]);
  });

  it("parcela efetiva auto-avança com o mês pedido", async () => {
    state.fixas = [
      fixa({ parcelado: true, parcelaAtual: 3, totalParcelas: 12, parcelaMesRef: "2026-06", valor: 200 }),
    ];
    const [linha] = await cartaoService.faturaLinhas(U, "ct-1", "2026-08");
    expect(linha.parcelaAtual).toBe(5);
  });

  it("cartão de outro dono → 404", async () => {
    expect(cartaoService.faturaLinhas(U, "alheio", "2026-06")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("cartaoService.create", () => {
  it("ordem = count + 1, limite arredondado, bandeira/diaFechamento default null", async () => {
    const v = await cartaoService.create(U, { nome: "Inter", limite: 1000.005, diaVencimento: 15, cor: "orange" });
    expect(state.created).toMatchObject({
      userId: U,
      nome: "Inter",
      bandeira: null,
      limite: 1000.01,
      diaFechamento: null,
      diaVencimento: 15,
      ordem: 2,
    });
    expect(v.nome).toBe("Inter");
  });
});

describe("cartaoService.update", () => {
  it("arredonda o limite quando vem no patch", async () => {
    await cartaoService.update(U, "ct-1", { limite: 5000.005 });
    expect(state.updated).toEqual({ id: "ct-1", data: { limite: 5000.01 } });
  });

  it("patch sem limite não inventa o campo", async () => {
    await cartaoService.update(U, "ct-1", { nome: "Nubank Ultravioleta" });
    expect(state.updated!.data).toEqual({ nome: "Nubank Ultravioleta" });
  });

  it("cartão de outro dono → 404", async () => {
    expect(cartaoService.update(U, "alheio", { nome: "X" })).rejects.toBeInstanceOf(NotFoundError);
    expect(state.updated).toBeNull();
  });
});

describe("cartaoService.remove", () => {
  it("apaga e devolve o id (despesas ficam com cartao_id NULL)", async () => {
    expect(await cartaoService.remove(U, "ct-1")).toEqual({ id: "ct-1" });
    expect(state.deleted).toBe("ct-1");
  });

  it("cartão de outro dono → 404 e nada é apagado", async () => {
    expect(cartaoService.remove(U, "alheio")).rejects.toBeInstanceOf(NotFoundError);
    expect(state.deleted).toBeNull();
  });
});
