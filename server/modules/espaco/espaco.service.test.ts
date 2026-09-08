import { describe, expect, it, beforeEach, mock } from "bun:test";
import { AppError, NotFoundError } from "@/server/lib/errors";

type Row = Record<string, unknown>;

const esp = (id: string, over: Row = {}): Row => ({
  id,
  nome: `Espaço ${id}`,
  tipo: "outro",
  emoji: "📁",
  rendaMensal: 0,
  moeda: "BRL",
  ...over,
});

const state: {
  espacos: Row[];
  ocultos: { espacoId: string; ym: string }[];
  activeId: string | null;
  hidden: { espacoId: string; ym: string } | null;
  unhidden: { espacoId: string; ym: string } | null;
  deleted: string | null;
  created: Row | null;
  updated: { id: string; data: Row } | null;
  orcamento: Row | null;
} = {
  espacos: [],
  ocultos: [],
  activeId: null,
  hidden: null,
  unhidden: null,
  deleted: null,
  created: null,
  updated: null,
  orcamento: null,
};

mock.module("@/server/modules/espaco/espaco.repository", () => ({
  espacoRepository: {
    list: async () => state.espacos,
    findById: async (id: string) => state.espacos.find((e) => e.id === id) ?? null,
    findWithOrcamento: async (id: string) => (state.orcamento?.id === id ? state.orcamento : null),
    count: async () => state.espacos.length,
    create: async (data: Row) => {
      state.created = data;
      const novo = esp("e-new", data);
      state.espacos.push(novo);
      return novo;
    },
    update: async (id: string, data: Row) => {
      state.updated = { id, data };
      return esp(id, data);
    },
    delete: async (id: string) => {
      state.deleted = id;
      state.espacos = state.espacos.filter((e) => e.id !== id);
    },
    listOcultos: async () => state.ocultos,
    hide: async (espacoId: string, ym: string) => {
      state.hidden = { espacoId, ym };
    },
    unhide: async (espacoId: string, ym: string) => {
      state.unhidden = { espacoId, ym };
    },
    getActiveEspacoId: async () => state.activeId,
    setActiveEspacoId: async (_userId: string, id: string | null) => {
      state.activeId = id;
      return id;
    },
  },
}));

const { espacoService, espacoView, orcamentoView } = await import("./espaco.service");

const U = "u-1";

beforeEach(() => {
  state.espacos = [esp("e1"), esp("e2")];
  state.ocultos = [];
  state.activeId = "e1";
  state.hidden = null;
  state.unhidden = null;
  state.deleted = null;
  state.created = null;
  state.updated = null;
  state.orcamento = null;
});

describe("espacoView", () => {
  it("expõe só id/nome/tipo/emoji (renda e moeda ficam no orçamento)", () => {
    expect(espacoView(esp("e1", { rendaMensal: 5000, moeda: "BRL" }) as never)).toEqual({
      id: "e1",
      nome: "Espaço e1",
      tipo: "outro",
      emoji: "📁",
    });
  });
});

describe("espacoService.ensureDefaults", () => {
  it('conta nova ganha o espaço pessoal "Meu" e ele já vira o ativo', async () => {
    state.espacos = [];
    state.activeId = null;
    await espacoService.ensureDefaults(U);
    expect(state.created).toMatchObject({
      userId: U,
      nome: "Meu",
      tipo: "pessoal",
      emoji: "🧍",
      rendaMensal: 0,
      moeda: "BRL",
    });
    expect(state.activeId as string | null).toBe("e-new");
  });

  it("é idempotente: quem já tem espaço não ganha outro", async () => {
    await espacoService.ensureDefaults(U);
    expect(state.created).toBeNull();
    expect(state.espacos.length).toBe(2);
  });
});

describe("espacoService.listWithActive", () => {
  it("ativo sumiu → fallback pro primeiro", async () => {
    state.activeId = "morto";
    const r = await espacoService.listWithActive(U);
    expect(r.activeEspacoId).toBe("e1");
    expect(state.activeId).toBe("e1");
  });

  it("ativo válido é mantido e a lista vem serializada", async () => {
    state.activeId = "e2";
    const r = await espacoService.listWithActive(U);
    expect(r.activeEspacoId).toBe("e2");
    expect(r.espacos).toEqual([
      { id: "e1", nome: "Espaço e1", tipo: "outro", emoji: "📁" },
      { id: "e2", nome: "Espaço e2", tipo: "outro", emoji: "📁" },
    ]);
  });

  it("sem espaço nenhum o ativo vira null", async () => {
    state.espacos = [];
    const r = await espacoService.listWithActive(U);
    expect(r.activeEspacoId).toBeNull();
    expect(state.activeId).toBeNull();
  });

  it("devolve os ocultos como pares espacoId+ym", async () => {
    state.ocultos = [{ espacoId: "e2", ym: "2026-06", extra: "ignorado" } as never];
    const r = await espacoService.listWithActive(U);
    expect(r.espacosOcultos).toEqual([{ espacoId: "e2", ym: "2026-06" }]);
  });
});

describe("espacoService.setActive", () => {
  it("troca o ativo", async () => {
    expect(await espacoService.setActive(U, "e2")).toEqual({ activeEspacoId: "e2" });
    expect(state.activeId).toBe("e2");
  });

  it("espaço de outro dono → 404 e ativo intacto", async () => {
    expect(espacoService.setActive(U, "alheio")).rejects.toBeInstanceOf(NotFoundError);
    expect(state.activeId).toBe("e1");
  });
});

describe("espacoService.create", () => {
  it("arredonda a renda e usa BRL como moeda default", async () => {
    await espacoService.create(U, { nome: "Casa", tipo: "casa", emoji: "🏠", rendaMensal: 1200.005 });
    expect(state.created).toMatchObject({ nome: "Casa", rendaMensal: 1200.01, moeda: "BRL" });
  });

  it("sem renda informada grava 0", async () => {
    await espacoService.create(U, { nome: "Casa", tipo: "casa", emoji: "🏠" });
    expect(state.created!.rendaMensal).toBe(0);
  });

  it("o primeiro espaço da conta vira ativo automaticamente", async () => {
    state.espacos = [];
    state.activeId = null;
    await espacoService.create(U, { nome: "Casa", tipo: "casa", emoji: "🏠" });
    expect(state.activeId as string | null).toBe("e-new");
  });

  it("já havendo ativo, criar outro não rouba o foco", async () => {
    await espacoService.create(U, { nome: "Casa", tipo: "casa", emoji: "🏠" });
    expect(state.activeId).toBe("e1");
  });
});

describe("espacoService.update", () => {
  it("arredonda rendaMensal quando vem no patch", async () => {
    await espacoService.update(U, "e1", { rendaMensal: 999.999 });
    expect(state.updated).toEqual({ id: "e1", data: { rendaMensal: 1000 } });
  });

  it("patch sem renda não inventa o campo", async () => {
    await espacoService.update(U, "e1", { nome: "Novo nome" });
    expect(state.updated!.data).toEqual({ nome: "Novo nome" });
  });

  it("espaço inexistente → 404", async () => {
    expect(espacoService.update(U, "nope", { nome: "X" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("espacoService.restaurarNoMes", () => {
  it("desfaz a ocultação do mês", async () => {
    expect(await espacoService.restaurarNoMes(U, "e1", "2026-06")).toEqual({ id: "e1", ym: "2026-06" });
    expect(state.unhidden).toEqual({ espacoId: "e1", ym: "2026-06" });
  });

  it("espaço de outro dono → 404", async () => {
    expect(espacoService.restaurarNoMes(U, "alheio", "2026-06")).rejects.toBeInstanceOf(NotFoundError);
    expect(state.unhidden).toBeNull();
  });
});

describe("espacoService.ocultarNoMes", () => {
  it("oculta quando há outro visível no mês", async () => {
    const r = await espacoService.ocultarNoMes(U, "e1", "2026-06");
    expect(r).toEqual({ id: "e1", ym: "2026-06" });
    expect(state.hidden).toEqual({ espacoId: "e1", ym: "2026-06" });
  });

  it("não deixa ocultar o último visível do mês", async () => {
    state.ocultos = [{ espacoId: "e2", ym: "2026-06" }];
    expect(espacoService.ocultarNoMes(U, "e1", "2026-06")).rejects.toBeInstanceOf(AppError);
  });

  it("espaço inexistente lança NotFoundError", async () => {
    expect(espacoService.ocultarNoMes(U, "nope", "2026-06")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("espacoService.remove", () => {
  it("não remove o único espaço", async () => {
    state.espacos = [esp("e1")];
    expect(espacoService.remove(U, "e1")).rejects.toBeInstanceOf(AppError);
  });

  it("remover o ativo reassina pro primeiro restante", async () => {
    const r = await espacoService.remove(U, "e1");
    expect(state.deleted).toBe("e1");
    expect(r.activeEspacoId).toBe("e2");
  });

  it("remover um não-ativo mantém o ativo", async () => {
    const r = await espacoService.remove(U, "e2");
    expect(r.activeEspacoId).toBe("e1");
    expect(state.activeId).toBe("e1");
  });

  it("espaço de outro dono → 404 e nada é apagado", async () => {
    expect(espacoService.remove(U, "alheio")).rejects.toBeInstanceOf(NotFoundError);
    expect(state.deleted).toBeNull();
  });
});

describe("orcamentoView", () => {
  const espComOrcamento = {
    id: "e1",
    rendaMensal: 5000,
    moeda: "BRL",
    despesasFixas: [
      {
        id: "df-1",
        descricao: "Aluguel",
        valor: 1200,
        diaVencimento: 8,
        ativa: true,
        categoriaId: "cat-1",
        nota: null,
        cartaoId: "ct-1",
        parcelado: true,
        parcelaAtual: 2,
        totalParcelas: 10,
        parcelaMesRef: "2026-06",
      },
    ],
    despesasMes: [
      {
        id: "dm-1",
        mes: "2026-06",
        descricao: "Mercado",
        valor: 320.5,
        data: new Date("2026-06-08T00:00:00.000Z"),
        paga: true,
        valorPago: 320.5,
        cartaoId: null,
        categoriaId: null,
        nota: "feira",
      },
    ],
    receitasMes: [
      {
        id: "rm-1",
        mes: "2026-06",
        descricao: "Freela",
        valor: 800,
        data: new Date("2026-06-20T00:00:00.000Z"),
        recorrente: false,
        mesFim: null,
        skips: [],
      },
    ],
    pagamentosFixas: [{ despesaFixaId: "df-1", ym: "2026-06", valorPago: 600, espacoId: "e1" }],
    rendasMensais: [
      { ym: "2026-06", valor: 5200 },
      { ym: "2026-07", valor: 5300 },
    ],
  };

  it("monta o blob no formato que o front espera", () => {
    const v = orcamentoView(espComOrcamento as never);

    expect(v.despesasFixas[0]).toEqual({
      id: "df-1",
      descricao: "Aluguel",
      valor: 1200,
      diaVencimento: 8,
      ativa: true,
      categoriaId: "cat-1",
      nota: null,
      cartaoId: "ct-1",
      parcelado: true,
      parcelaAtual: 2,
      totalParcelas: 10,
      parcelaMesRef: "2026-06",
    });
    expect(v.despesasMes[0]).toEqual({
      id: "dm-1",
      mes: "2026-06",
      descricao: "Mercado",
      valor: 320.5,
      data: "2026-06-08",
      paga: true,
      valorPago: 320.5,
      cartaoId: null,
      categoriaId: null,
      nota: "feira",
    });
    expect(v.receitasMes[0]).toEqual({
      id: "rm-1",
      mes: "2026-06",
      descricao: "Freela",
      valor: 800,
      data: "2026-06-20",
      recorrente: false,
      mesFim: null,
    });
    // pagamento de fixa não carrega espacoId pro front
    expect(v.pagamentosFixas).toEqual([{ despesaFixaId: "df-1", ym: "2026-06", valorPago: 600 }]);
    expect(v.config).toEqual({ rendaMensal: 5000, moeda: "BRL" });
  });

  it("rendasMensais viram um mapa ym → valor", () => {
    expect(orcamentoView(espComOrcamento as never).rendasMensais).toEqual({
      "2026-06": 5200,
      "2026-07": 5300,
    });
  });

  it("espaço zerado devolve listas vazias, não null", () => {
    const v = orcamentoView({
      ...espComOrcamento,
      despesasFixas: [],
      despesasMes: [],
      receitasMes: [],
      pagamentosFixas: [],
      rendasMensais: [],
    } as never);
    expect(v.despesasFixas).toEqual([]);
    expect(v.rendasMensais).toEqual({});
  });
});

describe("espacoService.getOrcamento", () => {
  it("devolve o blob do espaço do dono", async () => {
    state.orcamento = {
      id: "e1",
      rendaMensal: 100,
      moeda: "BRL",
      despesasFixas: [],
      despesasMes: [],
      receitasMes: [],
      pagamentosFixas: [],
      rendasMensais: [],
    };
    const v = await espacoService.getOrcamento(U, "e1");
    expect(v.config).toEqual({ rendaMensal: 100, moeda: "BRL" });
  });

  it("espaço de outro dono → 404 (o repositório já filtra por userId)", async () => {
    expect(espacoService.getOrcamento(U, "alheio")).rejects.toBeInstanceOf(NotFoundError);
  });
});
