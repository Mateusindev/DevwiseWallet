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
    findById: async (id: string) => state.movs.find((m) => m.id === id) ?? null,
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
    findById: async (id: string) => (id === "cx-1" ? cx : null),
  },
}));

const { movimentacaoService } = await import("./movimentacao.service");

const U = "u-1";

beforeEach(() => {
  state.movs = [mov()];
  state.applied = null;
  state.reverted = null;
});

describe("movimentacaoService.list", () => {
  it("serializa valor pra number e data pra YYYY-MM-DD", async () => {
    const [v] = await movimentacaoService.list(U);
    expect(v).toEqual({
      id: "mv-1",
      caixinhaId: "cx-1",
      tipo: "aporte",
      valor: 50,
      descricao: "Aporte",
      data: "2026-06-05",
    });
  });

  it("sem movimentação devolve array vazio", async () => {
    state.movs = [];
    expect(await movimentacaoService.list(U)).toEqual([]);
  });
});

describe("movimentacaoService.create", () => {
  it("aporte soma no saldo (delta positivo) e usa descrição padrão", async () => {
    await movimentacaoService.create(U, { caixinhaId: "cx-1", tipo: "aporte", valor: 50 });
    expect(state.applied).toMatchObject({ delta: 50, descricao: "Aporte" });
  });

  it("despesa subtrai do saldo (delta negativo)", async () => {
    await movimentacaoService.create(U, { caixinhaId: "cx-1", tipo: "despesa", valor: 30, descricao: "Farmácia" });
    expect(state.applied).toMatchObject({ delta: -30, descricao: "Farmácia" });
  });

  it("caixinha inexistente lança NotFoundError", async () => {
    expect(
      movimentacaoService.create(U, { caixinhaId: "nope", tipo: "aporte", valor: 10 })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("valor arredondado pra 2 casas", async () => {
    await movimentacaoService.create(U, { caixinhaId: "cx-1", tipo: "aporte", valor: 10.005 });
    expect(state.applied!.valor).toBe(10.01);
  });

  it("descrição só de espaços cai no padrão do tipo", async () => {
    await movimentacaoService.create(U, { caixinhaId: "cx-1", tipo: "despesa", valor: 10, descricao: "   " });
    expect(state.applied!.descricao).toBe("Despesa");
  });

  it("descrição informada é trimada", async () => {
    await movimentacaoService.create(U, { caixinhaId: "cx-1", tipo: "aporte", valor: 10, descricao: "  13º  " });
    expect(state.applied!.descricao).toBe("13º");
  });

  it("data explícita é gravada em UTC", async () => {
    await movimentacaoService.create(U, { caixinhaId: "cx-1", tipo: "aporte", valor: 10, data: "2026-03-09" });
    expect((state.applied!.data as Date).toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });

  it("sem data usa hoje", async () => {
    await movimentacaoService.create(U, { caixinhaId: "cx-1", tipo: "aporte", valor: 10 });
    const gravada = (state.applied!.data as Date).toISOString().slice(0, 10);
    expect(gravada).toBe(new Date().toISOString().slice(0, 10));
  });

  it("devolve a movimentação e a caixinha já com o saldo novo", async () => {
    const r = await movimentacaoService.create(U, { caixinhaId: "cx-1", tipo: "aporte", valor: 50 });
    expect(r.movimentacao.caixinhaId).toBe("cx-1");
    expect(r.caixinha).toMatchObject({ id: "cx-1", saldo: 100 });
  });
});

describe("movimentacaoService.remove", () => {
  it("remover aporte tira do saldo (delta negativo)", async () => {
    await movimentacaoService.remove(U, "mv-1");
    expect(state.reverted).toEqual({ id: "mv-1", caixinhaId: "cx-1", delta: -50 });
  });

  it("remover despesa devolve ao saldo (delta positivo)", async () => {
    state.movs = [mov({ tipo: "despesa", valor: 80 })];
    await movimentacaoService.remove(U, "mv-1");
    expect(state.reverted!.delta).toBe(80);
  });

  it("id inexistente lança NotFoundError", async () => {
    expect(movimentacaoService.remove(U, "nope")).rejects.toBeInstanceOf(NotFoundError);
  });
});
