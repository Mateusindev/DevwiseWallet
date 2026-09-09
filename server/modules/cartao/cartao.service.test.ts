import { describe, expect, it, beforeEach, mock } from "bun:test";
import { NotFoundError } from "@/server/lib/errors";

type Row = Record<string, unknown>;

const state: {
  fixas: Row[];
  avulsas: Row[];
  fixasComCartao: Row[];
  avulsasIntervalo: Row[];
  created: Row | null;
  updated: { id: string; data: Row } | null;
  deleted: string | null;
} = {
  fixas: [],
  avulsas: [],
  fixasComCartao: [],
  avulsasIntervalo: [],
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
    fixasComCartaoDoUsuario: async () => state.fixasComCartao,
    avulsasComCartaoNoIntervalo: async (_u: string, de: string, ate: string) =>
      state.avulsasIntervalo.filter((d) => (d.mes as string) >= de && (d.mes as string) <= ate),
  },
}));

const { cartaoService, cartaoView, agregadosDoCartao } = await import("./cartao.service");

const U = "u-1";

beforeEach(() => {
  state.fixas = [];
  state.avulsas = [];
  state.fixasComCartao = [];
  state.avulsasIntervalo = [];
  state.created = null;
  state.updated = null;
  state.deleted = null;
});

// Puro: recebe as linhas já carregadas (é o que deixa a lista somar N cartões
// com 3 queries fixas). Uma parcelada está na MESMA lista das fixas ativas —
// ela conta na fatura enquanto está na janela e no comprometido pelo que resta.
describe("agregadosDoCartao", () => {
  const ag = (fixas: Row[], avulsas: Row[], mes: string) =>
    agregadosDoCartao(cartao as never, fixas as never, avulsas as never, mes);

  it("fatura = fixas ativas + avulsas do mês", () => {
    const v = ag([fixa({ valor: 200 }), fixa({ id: "df-2", valor: 40 })], [{ valor: 250 }], "2026-06");
    expect(v.faturaMes).toBe(490);
    expect(v.comprometido).toBe(0);
    expect(v.disponivel).toBe(8000 - 490);
  });

  it("fixa parcelada fora da janela não entra na fatura", () => {
    // 12/12 em 2026-06 → em 2026-07 já quitou
    const parc = fixa({ parcelado: true, parcelaAtual: 12, totalParcelas: 12, parcelaMesRef: "2026-06", valor: 100 });
    expect(ag([parc], [], "2026-07").faturaMes).toBe(0);
  });

  it("comprometido = parcelas restantes × valor", () => {
    // parcela 3/12 em 2026-06 → restam 9 × 200 = 1800
    const parc = fixa({ parcelado: true, parcelaAtual: 3, totalParcelas: 12, parcelaMesRef: "2026-06", valor: 200 });
    const v = ag([parc], [], "2026-06");
    expect(v.faturaMes).toBe(200);
    expect(v.comprometido).toBe(1800);
    expect(v.disponivel).toBe(8000 - 200 - 1800);
  });

  it("comprometido auto-avança com o mês visto", () => {
    const parc = fixa({ parcelado: true, parcelaAtual: 3, totalParcelas: 12, parcelaMesRef: "2026-06", valor: 200 });
    expect(ag([parc], [], "2026-08").comprometido).toBe(1400); // efetiva 5 → restam 7
  });

  it("cartão sem lançamento nenhum: fatura 0 e disponível = limite", () => {
    expect(ag([], [], "2026-06")).toMatchObject({ faturaMes: 0, comprometido: 0, disponivel: 8000 });
  });

  it("parcelamento já quitado não gera comprometido", () => {
    const parc = fixa({ parcelado: true, parcelaAtual: 12, totalParcelas: 12, parcelaMesRef: "2026-06", valor: 100 });
    expect(ag([parc], [], "2026-07").comprometido).toBe(0);
  });

  it("estouro de limite deixa o disponível negativo (não clampa em 0)", () => {
    expect(ag([fixa({ valor: 9000 })], [], "2026-06").disponivel).toBe(-1000);
  });

  it("soma de centavos fica arredondada em 2 casas", () => {
    expect(ag([fixa({ valor: 0.1 }), fixa({ id: "df-2", valor: 0.2 })], [], "2026-06").faturaMes).toBe(0.3);
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
    state.fixasComCartao = [fixa({ valor: 150, cartaoId: "ct-1" })];
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

describe("cartaoService.resumoPorMes", () => {
  it("soma por mês, por cartão e por categoria", async () => {
    state.fixasComCartao = [
      fixa({ id: "f1", valor: 100, cartaoId: "ct-1", categoriaId: "cat-1" }),
      fixa({ id: "f2", valor: 50, cartaoId: "ct-2", categoriaId: null }),
    ];
    state.avulsasIntervalo = [
      { id: "m1", mes: "2026-07", valor: 30, cartaoId: "ct-1", categoriaId: "cat-2" },
    ];

    const r = await cartaoService.resumoPorMes(U, "2026-06", "2026-07");
    expect(r.meses.map((m) => m.ym)).toEqual(["2026-06", "2026-07"]);
    expect(r.meses[0].total).toBe(150);
    expect(r.meses[1].total).toBe(180);
    expect(r.meses[1].porCartao).toEqual([
      { cartaoId: "ct-1", total: 130 },
      { cartaoId: "ct-2", total: 50 },
    ]);
    // fixa sem categoria vira null (o front rotula como "Sem categoria")
    expect(r.meses[1].porCategoria).toEqual([
      { categoriaId: "cat-1", total: 100 },
      { categoriaId: null, total: 50 },
      { categoriaId: "cat-2", total: 30 },
    ]);
  });

  it("parcelada só conta nos meses da janela dela", async () => {
    state.fixasComCartao = [
      fixa({ id: "f1", valor: 200, cartaoId: "ct-1", categoriaId: null,
             parcelado: true, parcelaAtual: 2, totalParcelas: 3, parcelaMesRef: "2026-06" }),
    ];
    const r = await cartaoService.resumoPorMes(U, "2026-05", "2026-09");
    expect(r.meses.map((m) => m.total)).toEqual([200, 200, 200, 0, 0]);
  });

  it("vira o ano e devolve mês vazio com total 0", async () => {
    const r = await cartaoService.resumoPorMes(U, "2026-11", "2027-01");
    expect(r.meses.map((m) => m.ym)).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(r.meses.every((m) => m.total === 0 && m.porCartao.length === 0)).toBe(true);
  });
});
