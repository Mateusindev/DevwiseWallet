import { describe, expect, it, beforeEach, mock } from "bun:test";

type Row = Record<string, unknown>;

const state: {
  chamadas: string[];
  activeEspacoId: string | null;
  espacos: Row[];
  categorias: Row[];
} = { chamadas: [], activeEspacoId: "e1", espacos: [{ id: "e1" }], categorias: [{ id: "cat-1" }] };

const registra = <T>(nome: string, valor: T) => async () => {
  state.chamadas.push(nome);
  return valor;
};

mock.module("@/server/modules/caixinha/caixinha.service", () => ({
  caixinhaService: { list: registra("caixinha.list", [{ id: "cx-1" }]) },
}));

mock.module("@/server/modules/movimentacao/movimentacao.service", () => ({
  movimentacaoService: { list: registra("movimentacao.list", [{ id: "mv-1" }]) },
}));

mock.module("@/server/modules/cartao/cartao.service", () => ({
  cartaoService: { listWithAggregates: registra("cartao.listWithAggregates", [{ id: "ct-1" }]) },
}));

mock.module("@/server/modules/categoria/categoria.service", () => ({
  categoriaService: {
    ensureDefaults: async () => {
      state.chamadas.push("categoria.ensureDefaults");
      state.categorias = [{ id: "cat-1" }];
    },
    list: async () => {
      state.chamadas.push("categoria.list");
      return state.categorias;
    },
  },
}));

mock.module("@/server/modules/espaco/espaco.service", () => ({
  espacoService: {
    ensureDefaults: async () => {
      state.chamadas.push("espaco.ensureDefaults");
      state.espacos = [{ id: "e1" }];
      state.activeEspacoId = "e1";
    },
    listWithActive: async () => {
      state.chamadas.push("espaco.listWithActive");
      return {
        espacos: state.espacos,
        activeEspacoId: state.espacos.length > 0 ? state.activeEspacoId : null,
        espacosOcultos: [{ espacoId: "e1", ym: "2026-06" }],
      };
    },
    getOrcamento: async (_userId: string, espacoId: string) => {
      state.chamadas.push(`espaco.getOrcamento:${espacoId}`);
      return { config: { rendaMensal: 0, moeda: "BRL" } } as Row;
    },
  },
}));

const { getState } = await import("./bootstrap.service");

const U = "u-1";

beforeEach(() => {
  state.chamadas = [];
  state.activeEspacoId = "e1";
  state.espacos = [{ id: "e1" }];
  state.categorias = [{ id: "cat-1" }];
});

describe("getState", () => {
  // O boot é a leitura mais cara do app e roda em toda carga de página: o
  // provisionamento não pode custar nada pra quem já tem conta feita.
  it("conta com dados não paga provisionamento nenhum", async () => {
    await getState(U);
    expect(state.chamadas).not.toContain("espaco.ensureDefaults");
    expect(state.chamadas).not.toContain("categoria.ensureDefaults");
  });

  it("conta vazia é provisionada e o payload já sai completo", async () => {
    state.espacos = [];
    state.categorias = [];
    state.activeEspacoId = null;

    const s = await getState(U);

    expect(state.chamadas).toContain("espaco.ensureDefaults");
    expect(state.chamadas).toContain("categoria.ensureDefaults");
    // a releitura acontece DEPOIS do provisionamento — senão o payload sairia
    // vazio justo no primeiro boot da conta
    const iEnsure = state.chamadas.indexOf("espaco.ensureDefaults");
    expect(state.chamadas.lastIndexOf("espaco.listWithActive")).toBeGreaterThan(iEnsure);
    expect(s.espacos).toMatchObject([{ id: "e1" }]);
    expect(s.categorias).toMatchObject([{ id: "cat-1" }]);
    expect(state.chamadas).toContain("espaco.getOrcamento:e1");
  });

  it("uma leva de leitura em paralelo: nada em série antes do orçamento", async () => {
    await getState(U);
    // o orçamento é o único que depende de outra leitura (precisa do espaço
    // ativo), então é o último
    expect(state.chamadas.at(-1)).toBe("espaco.getOrcamento:e1");
    expect(state.chamadas.filter((c) => c === "espaco.listWithActive")).toHaveLength(1);
  });

  it("devolve o payload inicial completo do usuário", async () => {
    const s = await getState(U);
    expect(Object.keys(s).sort()).toEqual(
      [
        "activeEspacoId",
        "caixinhas",
        "cartoes",
        "categorias",
        "espacos",
        "espacosOcultos",
        "movimentacoes",
        "orcamento",
        "userId",
      ].sort()
    );
    expect(s).toMatchObject({
      userId: U,
      caixinhas: [{ id: "cx-1" }],
      movimentacoes: [{ id: "mv-1" }],
      cartoes: [{ id: "ct-1" }],
      categorias: [{ id: "cat-1" }],
      espacos: [{ id: "e1" }],
      activeEspacoId: "e1",
      espacosOcultos: [{ espacoId: "e1", ym: "2026-06" }],
    });
  });

  it("carrega o orçamento do espaço ativo", async () => {
    const s = await getState(U);
    expect(state.chamadas).toContain("espaco.getOrcamento:e1");
    expect(s.orcamento?.config).toEqual({ rendaMensal: 0, moeda: "BRL" });
  });

  it("sem espaço ativo o orçamento vem null (não estoura)", async () => {
    state.activeEspacoId = null;
    const s = await getState(U);
    expect(s.orcamento).toBeNull();
    expect(state.chamadas.some((c) => c.startsWith("espaco.getOrcamento"))).toBe(false);
  });
});
