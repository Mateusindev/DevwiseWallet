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

const receita = (over: Row = {}): Row => ({
  id: "rm-1",
  espacoId: "e1",
  mes: "2026-06",
  descricao: "Freela",
  valor: 500,
  data: new Date("2026-06-20T00:00:00.000Z"),
  ...over,
});

const state: {
  fixa: Row | null;
  despesa: Row | null;
  receita: Row | null;
  pagamento: Row | null;
  upserted: Row | null;
  deletedPagamento: boolean;
  updatedFixa: Row | null;
  updatedDespesa: Row | null;
  updatedReceita: Row | null;
  createdFixa: Row | null;
  createdDespesa: Row | null;
  createdReceita: Row | null;
  deleted: string[];
  rendaRemovida: { espacoId: string; ym: string } | null;
} = {
  fixa: null,
  despesa: null,
  receita: null,
  pagamento: null,
  upserted: null,
  deletedPagamento: false,
  updatedFixa: null,
  updatedDespesa: null,
  updatedReceita: null,
  createdFixa: null,
  createdDespesa: null,
  createdReceita: null,
  deleted: [],
  rendaRemovida: null,
};

mock.module("@/server/modules/orcamento/orcamento.repository", () => ({
  orcamentoRepository: {
    findDespesaFixa: async () => state.fixa,
    updateDespesaFixa: async (_id: string, data: Row) => {
      state.updatedFixa = data;
      return { ...state.fixa, ...data };
    },
    deleteDespesaFixa: async (id: string) => {
      state.deleted.push(id);
    },
    createDespesaFixa: async (data: Row) => {
      state.createdFixa = data;
      return fixa(data);
    },
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
    deleteDespesaMes: async (id: string) => {
      state.deleted.push(id);
    },
    findReceitaMes: async () => state.receita,
    createReceitaMes: async (data: Row) => {
      state.createdReceita = data;
      return receita(data);
    },
    updateReceitaMes: async (_id: string, data: Row) => {
      state.updatedReceita = data;
      return receita({ ...state.receita, ...data });
    },
    deleteReceitaMes: async (id: string) => {
      state.deleted.push(id);
    },
    upsertRenda: async (espacoId: string, ym: string, valor: number) => ({ espacoId, ym, valor }),
    deleteRenda: async (espacoId: string, ym: string) => {
      state.rendaRemovida = { espacoId, ym };
    },
  },
}));

mock.module("@/server/modules/espaco/espaco.repository", () => ({
  espacoRepository: {
    findById: async (id: string) => (id === "e1" ? { id: "e1", nome: "E", tipo: "outro", emoji: "📁" } : null),
  },
}));

// cartaoId/categoriaId são validados como do próprio dono (assertVinculos):
// "ct-1"/"cat-1" pertencem ao usuário; qualquer outro id é de outra conta.
mock.module("@/server/modules/cartao/cartao.repository", () => ({
  cartaoRepository: {
    findById: async (id: string, userId: string) =>
      id === "ct-1" && userId === "u-1" ? { id: "ct-1", userId, limite: 0 } : null,
  },
}));

mock.module("@/server/modules/categoria/categoria.repository", () => ({
  categoriaRepository: {
    findById: async (id: string, userId: string) =>
      id === "cat-1" && userId === "u-1" ? { id: "cat-1", userId, nome: "C" } : null,
  },
}));

const { orcamentoService } = await import("./orcamento.service");

const U = "u-1";

beforeEach(() => {
  state.fixa = fixa();
  state.despesa = despMes();
  state.receita = receita();
  state.pagamento = null;
  state.upserted = null;
  state.deletedPagamento = false;
  state.updatedFixa = null;
  state.updatedDespesa = null;
  state.updatedReceita = null;
  state.createdFixa = null;
  state.createdDespesa = null;
  state.createdReceita = null;
  state.deleted = [];
  state.rendaRemovida = null;
});

const MES_CORRENTE = new Date().toISOString().slice(0, 7);

describe("pertencimento ao espaço", () => {
  it("fixa de outro espaço → NotFoundError", async () => {
    state.fixa = fixa({ espacoId: "outro" });
    expect(orcamentoService.toggleDespesaFixa(U, "e1", "df-1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("despesa do mês de outro espaço → NotFoundError", async () => {
    state.despesa = despMes({ espacoId: "outro" });
    expect(orcamentoService.setPagaMes(U, "e1", "dm-1", 10)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("vínculos (cartão/categoria do próprio dono)", () => {
  const fixaBase = { descricao: "X", valor: 10, diaVencimento: 1 };
  const mesBase = { mes: "2026-06", descricao: "X", valor: 10 };

  it("addDespesaFixa com cartão de outro dono → NotFoundError", async () => {
    expect(
      orcamentoService.addDespesaFixa(U, "e1", { ...fixaBase, cartaoId: "ct-alheio" })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(state.createdFixa).toBeNull();
  });

  it("addDespesaFixa com categoria de outro dono → NotFoundError", async () => {
    expect(
      orcamentoService.addDespesaFixa(U, "e1", { ...fixaBase, categoriaId: "cat-alheia" })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("updateDespesaFixa com cartão de outro dono → NotFoundError", async () => {
    expect(
      orcamentoService.updateDespesaFixa(U, "e1", "df-1", { cartaoId: "ct-alheio" })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(state.updatedFixa).toBeNull();
  });

  it("addDespesaMes com cartão de outro dono → NotFoundError", async () => {
    expect(
      orcamentoService.addDespesaMes(U, "e1", { ...mesBase, cartaoId: "ct-alheio" })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(state.createdDespesa).toBeNull();
  });

  it("updateDespesaMes com categoria de outro dono → NotFoundError", async () => {
    expect(
      orcamentoService.updateDespesaMes(U, "e1", "dm-1", { categoriaId: "cat-alheia" })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(state.updatedDespesa).toBeNull();
  });

  it("cartão e categoria do próprio dono passam", async () => {
    await orcamentoService.addDespesaFixa(U, "e1", {
      ...fixaBase,
      cartaoId: "ct-1",
      categoriaId: "cat-1",
    });
    expect(state.createdFixa).toMatchObject({ cartaoId: "ct-1", categoriaId: "cat-1" });
  });

  it("null não dispara checagem (limpar vínculo segue permitido)", async () => {
    await orcamentoService.updateDespesaMes(U, "e1", "dm-1", { cartaoId: null, categoriaId: null });
    expect(state.updatedDespesa).toEqual({ cartaoId: null, categoriaId: null });
  });
});

describe("orcamentoService.addDespesaFixa", () => {
  it("nasce ativa, com valor arredondado e nota vazia virando null", async () => {
    const v = await orcamentoService.addDespesaFixa(U, "e1", {
      descricao: "Internet",
      valor: 99.999,
      diaVencimento: 10,
      nota: "",
    });
    expect(state.createdFixa).toMatchObject({ espacoId: "e1", ativa: true, valor: 100, nota: null });
    expect(v.descricao).toBe("Internet");
  });

  it("parcelamento ancora no mês corrente", async () => {
    await orcamentoService.addDespesaFixa(U, "e1", {
      descricao: "Notebook",
      valor: 200,
      diaVencimento: 10,
      cartaoId: "ct-1",
      parcelado: true,
      parcelaAtual: 3,
      totalParcelas: 12,
    });
    expect(state.createdFixa).toMatchObject({
      cartaoId: "ct-1",
      parcelado: true,
      parcelaAtual: 3,
      totalParcelas: 12,
      parcelaMesRef: MES_CORRENTE,
    });
  });

  it("sem parcelamento zera os campos de parcela", async () => {
    await orcamentoService.addDespesaFixa(U, "e1", { descricao: "Luz", valor: 80, diaVencimento: 5 });
    expect(state.createdFixa).toMatchObject({
      cartaoId: null,
      parcelado: false,
      parcelaAtual: null,
      totalParcelas: null,
      parcelaMesRef: null,
    });
  });

  it("espaço de outro dono → 404", async () => {
    expect(
      orcamentoService.addDespesaFixa(U, "alheio", { descricao: "X", valor: 1, diaVencimento: 1 })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("orcamentoService.updateDespesaFixa", () => {
  it("patch parcial só grava o que veio", async () => {
    await orcamentoService.updateDespesaFixa(U, "e1", "df-1", { valor: 12.345 });
    expect(state.updatedFixa).toEqual({ valor: 12.35 });
  });

  it("não mexe em parcela/cartão quando o patch não cita nenhum desses campos", async () => {
    await orcamentoService.updateDespesaFixa(U, "e1", "df-1", { descricao: "Aluguel novo" });
    expect(state.updatedFixa).toEqual({ descricao: "Aluguel novo" });
  });

  it("editar parcela reancora a âncora no mês corrente", async () => {
    state.fixa = fixa({ parcelado: true, parcelaAtual: 2, totalParcelas: 12, parcelaMesRef: "2020-01", cartaoId: "ct-1" });
    await orcamentoService.updateDespesaFixa(U, "e1", "df-1", { parcelaAtual: 5 });
    expect(state.updatedFixa).toMatchObject({
      parcelado: true,
      parcelaAtual: 5,
      totalParcelas: 12,
      parcelaMesRef: MES_CORRENTE,
      cartaoId: "ct-1",
    });
  });

  it("desmarcar parcelado limpa parcela mas mantém o cartão informado", async () => {
    state.fixa = fixa({ parcelado: true, parcelaAtual: 2, totalParcelas: 12, parcelaMesRef: "2026-01", cartaoId: "ct-1" });
    await orcamentoService.updateDespesaFixa(U, "e1", "df-1", { parcelado: false });
    expect(state.updatedFixa).toMatchObject({
      parcelado: false,
      parcelaAtual: null,
      totalParcelas: null,
      parcelaMesRef: null,
      cartaoId: "ct-1",
    });
  });

  it("categoriaId e nota aceitam limpeza explícita", async () => {
    await orcamentoService.updateDespesaFixa(U, "e1", "df-1", { categoriaId: null, nota: "" });
    expect(state.updatedFixa).toEqual({ categoriaId: null, nota: null });
  });

  it("fixa de outro espaço → 404", async () => {
    state.fixa = fixa({ espacoId: "outro" });
    expect(orcamentoService.updateDespesaFixa(U, "e1", "df-1", { valor: 1 })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("orcamentoService.toggleDespesaFixa", () => {
  it("inverte o campo ativa", async () => {
    await orcamentoService.toggleDespesaFixa(U, "e1", "df-1"); // ativa: true
    expect(state.updatedFixa).toEqual({ ativa: false });

    state.fixa = fixa({ ativa: false });
    await orcamentoService.toggleDespesaFixa(U, "e1", "df-1");
    expect(state.updatedFixa).toEqual({ ativa: true });
  });
});

describe("orcamentoService.removeDespesaFixa / removeDespesaMes", () => {
  it("apagam e devolvem o id", async () => {
    expect(await orcamentoService.removeDespesaFixa(U, "e1", "df-1")).toEqual({ id: "df-1" });
    expect(await orcamentoService.removeDespesaMes(U, "e1", "dm-1")).toEqual({ id: "dm-1" });
    expect(state.deleted).toEqual(["df-1", "dm-1"]);
  });

  it("linha de outro espaço → 404 e nada é apagado", async () => {
    state.fixa = fixa({ espacoId: "outro" });
    state.despesa = despMes({ espacoId: "outro" });
    expect(orcamentoService.removeDespesaFixa(U, "e1", "df-1")).rejects.toBeInstanceOf(NotFoundError);
    expect(orcamentoService.removeDespesaMes(U, "e1", "dm-1")).rejects.toBeInstanceOf(NotFoundError);
    expect(state.deleted).toEqual([]);
  });
});

describe("orcamentoService.updateDespesaMes", () => {
  it("converte data pra UTC e arredonda o valor", async () => {
    await orcamentoService.updateDespesaMes(U, "e1", "dm-1", { valor: 10.005, data: "2026-06-30" });
    expect(state.updatedDespesa!.valor).toBe(10.01);
    expect((state.updatedDespesa!.data as Date).toISOString()).toBe("2026-06-30T00:00:00.000Z");
  });

  it("cartaoId/categoriaId/nota aceitam limpeza explícita", async () => {
    await orcamentoService.updateDespesaMes(U, "e1", "dm-1", { cartaoId: null, categoriaId: null, nota: "" });
    expect(state.updatedDespesa).toEqual({ cartaoId: null, categoriaId: null, nota: null });
  });

  it("patch vazio não grava campo nenhum", async () => {
    await orcamentoService.updateDespesaMes(U, "e1", "dm-1", {});
    expect(state.updatedDespesa).toEqual({});
  });
});

describe("orcamentoService — receitas do mês", () => {
  it("add: data default = dia 01 do mês, valor arredondado", async () => {
    const v = await orcamentoService.addReceitaMes(U, "e1", { mes: "2026-06", descricao: "Freela", valor: 500.005 });
    expect(state.createdReceita).toMatchObject({ espacoId: "e1", mes: "2026-06", valor: 500.01 });
    expect((state.createdReceita!.data as Date).toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(v.data).toBe("2026-06-01");
  });

  it("add: espaço de outro dono → 404", async () => {
    expect(
      orcamentoService.addReceitaMes(U, "alheio", { mes: "2026-06", descricao: "X", valor: 1 })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("update: só toca os campos presentes", async () => {
    await orcamentoService.updateReceitaMes(U, "e1", "rm-1", { descricao: "Bônus" });
    expect(state.updatedReceita).toEqual({ descricao: "Bônus" });
  });

  it("update/remove de receita de outro espaço → 404", async () => {
    state.receita = receita({ espacoId: "outro" });
    expect(orcamentoService.updateReceitaMes(U, "e1", "rm-1", { valor: 1 })).rejects.toBeInstanceOf(NotFoundError);
    expect(orcamentoService.removeReceitaMes(U, "e1", "rm-1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("remove: apaga e devolve o id", async () => {
    expect(await orcamentoService.removeReceitaMes(U, "e1", "rm-1")).toEqual({ id: "rm-1" });
    expect(state.deleted).toEqual(["rm-1"]);
  });
});

describe("orcamentoService.clearRenda", () => {
  it("remove o override do mês (volta a herdar o salário fixo)", async () => {
    expect(await orcamentoService.clearRenda(U, "e1", "2026-06")).toEqual({ ym: "2026-06" });
    expect(state.rendaRemovida).toEqual({ espacoId: "e1", ym: "2026-06" });
  });

  it("espaço de outro dono → 404", async () => {
    expect(orcamentoService.clearRenda(U, "alheio", "2026-06")).rejects.toBeInstanceOf(NotFoundError);
    expect(state.rendaRemovida).toBeNull();
  });
});

describe("orcamentoService.setPagamentoFixa", () => {
  it("valor intermediário → pagamento parcial", async () => {
    const r = await orcamentoService.setPagamentoFixa(U, "e1", "df-1", "2026-06", 120);
    expect(r).toEqual({ despesaFixaId: "df-1", ym: "2026-06", valorPago: 120, pago: false });
    expect(state.upserted!.valorPago).toBe(120);
  });

  it("acima do valor clampa e quita", async () => {
    const r = await orcamentoService.setPagamentoFixa(U, "e1", "df-1", "2026-06", 999);
    expect(r).toEqual({ despesaFixaId: "df-1", ym: "2026-06", valorPago: 300, pago: true });
  });

  it("<= 0 remove o registro existente", async () => {
    state.pagamento = { despesaFixaId: "df-1", ym: "2026-06", valorPago: 100 };
    const r = await orcamentoService.setPagamentoFixa(U, "e1", "df-1", "2026-06", 0);
    expect(r.pago).toBe(false);
    expect(r.valorPago).toBe(0);
    expect(state.deletedPagamento).toBe(true);
  });
});

describe("orcamentoService.setPagaMes", () => {
  it("clampa no valor e marca paga", async () => {
    const r = await orcamentoService.setPagaMes(U, "e1", "dm-1", 500);
    expect(state.updatedDespesa).toEqual({ valorPago: 100, paga: true });
    expect(r.paga).toBe(true);
  });

  it("parcial não marca paga", async () => {
    await orcamentoService.setPagaMes(U, "e1", "dm-1", 40);
    expect(state.updatedDespesa).toEqual({ valorPago: 40, paga: false });
  });

  it("valor 0 nunca marca paga", async () => {
    state.despesa = despMes({ valor: 0 });
    await orcamentoService.setPagaMes(U, "e1", "dm-1", 10);
    expect(state.updatedDespesa!.paga).toBe(false);
  });
});

describe("orcamentoService.addDespesaMes", () => {
  it("espaço inexistente → NotFoundError", async () => {
    expect(
      orcamentoService.addDespesaMes(U, "nope", { mes: "2026-06", descricao: "X", valor: 10 })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("data default = primeiro dia do mês", async () => {
    await orcamentoService.addDespesaMes(U, "e1", { mes: "2026-06", descricao: "X", valor: 10 });
    expect((state.createdDespesa!.data as Date).toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("nota vazia vira null", async () => {
    await orcamentoService.addDespesaMes(U, "e1", { mes: "2026-06", descricao: "X", valor: 10, nota: "" });
    expect(state.createdDespesa!.nota).toBeNull();
  });
});

describe("orcamentoService.setRenda", () => {
  it("arredonda e serializa", async () => {
    const r = await orcamentoService.setRenda(U, "e1", "2026-06", 1200.005);
    expect(r).toEqual({ ym: "2026-06", valor: 1200.01 });
  });
});
