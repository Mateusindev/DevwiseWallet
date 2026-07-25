import { describe, expect, it, beforeEach, mock } from "bun:test";
import { NotFoundError } from "@/server/lib/errors";

type Row = Record<string, unknown>;

const fixa = (over: Row = {}): Row => ({
  id: "df-1",
  espacoId: "e1",
  descricao: "Aluguel",
  valor: 300,
  diaVencimento: 8,
  ativa: true,
  cartaoId: null,
  parcelado: false,
  parcelaAtual: null,
  totalParcelas: null,
  parcelaMesRef: null,
  categoriaId: null,
  nota: null,
  ...over,
});

const despMes = (over: Row = {}): Row => ({
  id: "dm-1",
  espacoId: "e1",
  mes: "2026-06",
  descricao: "Mercado",
  valor: 100,
  data: new Date("2026-06-08T00:00:00.000Z"),
  paga: false,
  valorPago: 0,
  cartaoId: null,
  categoriaId: null,
  nota: null,
  ...over,
});

const state: {
  fixa: Row | null;
  despesa: Row | null;
  pagamento: Row | null;
  upserted: Row | null;
  deletedPagamento: boolean;
  updatedDespesa: Row | null;
  createdDespesa: Row | null;
} = {
  fixa: null,
  despesa: null,
  pagamento: null,
  upserted: null,
  deletedPagamento: false,
  updatedDespesa: null,
  createdDespesa: null,
};

mock.module("@/server/modules/orcamento/orcamento.repository", () => ({
  orcamentoRepository: {
    findDespesaFixa: async () => state.fixa,
    updateDespesaFixa: async (_id: string, data: Row) => ({ ...state.fixa, ...data }),
    deleteDespesaFixa: async () => {},
    createDespesaFixa: async (data: Row) => fixa(data),
    findPagamentoFixa: async () => state.pagamento,
    upsertPagamentoFixa: async (espacoId: string, despesaFixaId: string, ym: string, valorPago: number) => {
      state.upserted = { espacoId, despesaFixaId, ym, valorPago };
      return state.upserted;
    },
    deletePagamentoFixa: async () => {
      state.deletedPagamento = true;
    },
    findDespesaMes: async () => state.despesa,
    createDespesaMes: async (data: Row) => {
      state.createdDespesa = data;
      return despMes(data);
    },
    updateDespesaMes: async (_id: string, data: Row) => {
      state.updatedDespesa = data;
      return { ...state.despesa, ...data };
    },
    deleteDespesaMes: async () => {},
    findReceitaMes: async () => null,
    createReceitaMes: async (data: Row) => ({ id: "rm-1", ...data }),
    updateReceitaMes: async () => null,
    deleteReceitaMes: async () => {},
    upsertRenda: async (espacoId: string, ym: string, valor: number) => ({ espacoId, ym, valor }),
  },
}));

mock.module("@/server/modules/espaco/espaco.repository", () => ({
  espacoRepository: {
    findById: async (_userId: string, id: string) => (id === "e1" ? { id: "e1", nome: "E", tipo: "outro", emoji: "📁" } : null),
  },
}));

const { orcamentoService } = await import("./orcamento.service");

beforeEach(() => {
  state.fixa = fixa();
  state.despesa = despMes();
  state.pagamento = null;
  state.upserted = null;
  state.deletedPagamento = false;
  state.updatedDespesa = null;
  state.createdDespesa = null;
});

describe("pertencimento ao espaço", () => {
  it("fixa de outro espaço → NotFoundError", async () => {
    state.fixa = fixa({ espacoId: "outro" });
    expect(orcamentoService.toggleDespesaFixa("u-1", "e1", "df-1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("despesa do mês de outro espaço → NotFoundError", async () => {
    state.despesa = despMes({ espacoId: "outro" });
    expect(orcamentoService.setPagaMes("u-1", "e1", "dm-1", 10)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("orcamentoService.setPagamentoFixa", () => {
  it("valor intermediário → pagamento parcial", async () => {
    const r = await orcamentoService.setPagamentoFixa("u-1", "e1", "df-1", "2026-06", 120);
    expect(r).toEqual({ despesaFixaId: "df-1", ym: "2026-06", valorPago: 120, pago: false });
    expect(state.upserted!.valorPago).toBe(120);
  });

  it("acima do valor clampa e quita", async () => {
    const r = await orcamentoService.setPagamentoFixa("u-1", "e1", "df-1", "2026-06", 999);
    expect(r).toEqual({ despesaFixaId: "df-1", ym: "2026-06", valorPago: 300, pago: true });
  });

  it("<= 0 remove o registro existente", async () => {
    state.pagamento = { despesaFixaId: "df-1", ym: "2026-06", valorPago: 100 };
    const r = await orcamentoService.setPagamentoFixa("u-1", "e1", "df-1", "2026-06", 0);
    expect(r.pago).toBe(false);
    expect(r.valorPago).toBe(0);
    expect(state.deletedPagamento).toBe(true);
  });
});

describe("orcamentoService.setPagaMes", () => {
  it("clampa no valor e marca paga", async () => {
    const r = await orcamentoService.setPagaMes("u-1", "e1", "dm-1", 500);
    expect(state.updatedDespesa).toEqual({ valorPago: 100, paga: true });
    expect(r.paga).toBe(true);
  });

  it("parcial não marca paga", async () => {
    await orcamentoService.setPagaMes("u-1", "e1", "dm-1", 40);
    expect(state.updatedDespesa).toEqual({ valorPago: 40, paga: false });
  });

  it("valor 0 nunca marca paga", async () => {
    state.despesa = despMes({ valor: 0 });
    await orcamentoService.setPagaMes("u-1", "e1", "dm-1", 10);
    expect(state.updatedDespesa!.paga).toBe(false);
  });
});

describe("orcamentoService.addDespesaMes", () => {
  it("espaço inexistente → NotFoundError", async () => {
    expect(
      orcamentoService.addDespesaMes("u-1", "nope", { mes: "2026-06", descricao: "X", valor: 10 })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("data default = primeiro dia do mês", async () => {
    await orcamentoService.addDespesaMes("u-1", "e1", { mes: "2026-06", descricao: "X", valor: 10 });
    expect((state.createdDespesa!.data as Date).toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("nota vazia vira null", async () => {
    await orcamentoService.addDespesaMes("u-1", "e1", { mes: "2026-06", descricao: "X", valor: 10, nota: "" });
    expect(state.createdDespesa!.nota).toBeNull();
  });
});

describe("orcamentoService.setRenda", () => {
  it("arredonda e serializa", async () => {
    const r = await orcamentoService.setRenda("u-1", "e1", "2026-06", 1200.005);
    expect(r).toEqual({ ym: "2026-06", valor: 1200.01 });
  });
});
