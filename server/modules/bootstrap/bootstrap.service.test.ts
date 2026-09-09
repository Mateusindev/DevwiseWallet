import { describe, expect, it, beforeEach, mock } from "bun:test";

type Row = Record<string, unknown>;

const state: {
  chamadas: string[];
  activeEspacoId: string | null;
} = { chamadas: [], activeEspacoId: "e1" };

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
    ensureDefaults: registra("categoria.ensureDefaults", undefined),
    list: registra("categoria.list", [{ id: "cat-1" }]),
  },
}));

mock.module("@/server/modules/espaco/espaco.service", () => ({
  espacoService: {
    ensureDefaults: registra("espaco.ensureDefaults", undefined),
    listWithActive: async () => {
      state.chamadas.push("espaco.listWithActive");
      return {
        espacos: [{ id: "e1" }],
        activeEspacoId: state.activeEspacoId,
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
});

describe("getState", () => {
  it("provisiona os defaults de espaço e categoria antes de ler", async () => {
    await getState(U);
    const iEspaco = state.chamadas.indexOf("espaco.ensureDefaults");
    const iCategoria = state.chamadas.indexOf("categoria.ensureDefaults");
    expect(iEspaco).toBeGreaterThanOrEqual(0);
    expect(iCategoria).toBeGreaterThanOrEqual(0);
    expect(iEspaco).toBeLessThan(state.chamadas.indexOf("espaco.listWithActive"));
    expect(iCategoria).toBeLessThan(state.chamadas.indexOf("categoria.list"));
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
