import { describe, expect, it, beforeEach, mock } from "bun:test";
import { NotFoundError } from "@/server/lib/errors";

type Row = Record<string, unknown>;

const state: {
  movs: Row[];
  applied: Row | null;
  reverted: { id: string; caixinhaId: string; delta: number } | null;
} = { movs: [], applied: null, reverted: null };

const cx = { id: "cx-1", nome: "Caixinha", aporteMensal: 0, meta: null, saldo: 100, cor: "blue", acumulaSobra: false, ordem: 1 };

const mov = (over: Row = {}): Row => ({
  id: "mv-1",
  caixinhaId: "cx-1",
  tipo: "aporte",
  valor: 50,
  descricao: "Aporte",
  data: new Date("2026-06-05T00:00:00.000Z"),
  ...over,
});

mock.module("@/server/modules/movimentacao/movimentacao.repository", () => ({
  movimentacaoRepository: {
    list: async () => state.movs,
    findById: async (_userId: string, id: string) => state.movs.find((m) => m.id === id) ?? null,
    createAndApply: async (input: Row) => {
      state.applied = input;
      return { movimentacao: mov(input), caixinha: cx };
    },
    removeAndRevert: async (id: string, caixinhaId: string, delta: number) => {
      state.reverted = { id, caixinhaId, delta };
      return cx;
    },
  },
}));

mock.module("@/server/modules/caixinha/caixinha.repository", () => ({
  caixinhaRepository: {
    findById: async (_userId: string, id: string) => (id === "cx-1" ? cx : null),
  },
}));

const { movimentacaoService } = await import("./movimentacao.service");

beforeEach(() => {
  state.movs = [mov()];
  state.applied = null;
  state.reverted = null;
});

describe("movimentacaoService.create", () => {
  it("aporte soma no saldo (delta positivo) e usa descrição padrão", async () => {
    await movimentacaoService.create("u-1", { caixinhaId: "cx-1", tipo: "aporte", valor: 50 });
    expect(state.applied).toMatchObject({ delta: 50, descricao: "Aporte" });
  });

  it("despesa subtrai do saldo (delta negativo)", async () => {
    await movimentacaoService.create("u-1", { caixinhaId: "cx-1", tipo: "despesa", valor: 30, descricao: "Farmácia" });
    expect(state.applied).toMatchObject({ delta: -30, descricao: "Farmácia" });
  });

  it("caixinha inexistente lança NotFoundError", async () => {
    expect(
      movimentacaoService.create("u-1", { caixinhaId: "nope", tipo: "aporte", valor: 10 })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("valor arredondado pra 2 casas", async () => {
    await movimentacaoService.create("u-1", { caixinhaId: "cx-1", tipo: "aporte", valor: 10.005 });
    expect(state.applied!.valor).toBe(10.01);
  });
});

describe("movimentacaoService.remove", () => {
  it("remover aporte tira do saldo (delta negativo)", async () => {
    await movimentacaoService.remove("u-1", "mv-1");
    expect(state.reverted).toEqual({ id: "mv-1", caixinhaId: "cx-1", delta: -50 });
  });

  it("remover despesa devolve ao saldo (delta positivo)", async () => {
    state.movs = [mov({ tipo: "despesa", valor: 80 })];
    await movimentacaoService.remove("u-1", "mv-1");
    expect(state.reverted!.delta).toBe(80);
  });

  it("id inexistente lança NotFoundError", async () => {
    expect(movimentacaoService.remove("u-1", "nope")).rejects.toBeInstanceOf(NotFoundError);
  });
});
