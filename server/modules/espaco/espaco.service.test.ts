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
  deleted: string | null;
} = { espacos: [], ocultos: [], activeId: null, hidden: null, deleted: null };

mock.module("@/server/modules/espaco/espaco.repository", () => ({
  espacoRepository: {
    list: async () => state.espacos,
    findById: async (_userId: string, id: string) => state.espacos.find((e) => e.id === id) ?? null,
    count: async () => state.espacos.length,
    delete: async (id: string) => {
      state.deleted = id;
      state.espacos = state.espacos.filter((e) => e.id !== id);
    },
    listOcultos: async () => state.ocultos,
    hide: async (espacoId: string, ym: string) => {
      state.hidden = { espacoId, ym };
    },
    unhide: async () => {},
    getActiveEspacoId: async () => state.activeId,
    setActiveEspacoId: async (_userId: string, id: string | null) => {
      state.activeId = id;
      return id;
    },
  },
}));

const { espacoService } = await import("./espaco.service");

beforeEach(() => {
  state.espacos = [esp("e1"), esp("e2")];
  state.ocultos = [];
  state.activeId = "e1";
  state.hidden = null;
  state.deleted = null;
});

describe("espacoService.listWithActive", () => {
  it("ativo sumiu → fallback pro primeiro", async () => {
    state.activeId = "morto";
    const r = await espacoService.listWithActive("u-1");
    expect(r.activeEspacoId).toBe("e1");
    expect(state.activeId).toBe("e1");
  });
});

describe("espacoService.ocultarNoMes", () => {
  it("oculta quando há outro visível no mês", async () => {
    const r = await espacoService.ocultarNoMes("u-1", "e1", "2026-06");
    expect(r).toEqual({ id: "e1", ym: "2026-06" });
    expect(state.hidden).toEqual({ espacoId: "e1", ym: "2026-06" });
  });

  it("não deixa ocultar o último visível do mês", async () => {
    state.ocultos = [{ espacoId: "e2", ym: "2026-06" }];
    expect(espacoService.ocultarNoMes("u-1", "e1", "2026-06")).rejects.toBeInstanceOf(AppError);
  });

  it("espaço inexistente lança NotFoundError", async () => {
    expect(espacoService.ocultarNoMes("u-1", "nope", "2026-06")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("espacoService.remove", () => {
  it("não remove o único espaço", async () => {
    state.espacos = [esp("e1")];
    expect(espacoService.remove("u-1", "e1")).rejects.toBeInstanceOf(AppError);
  });

  it("remover o ativo reassina pro primeiro restante", async () => {
    const r = await espacoService.remove("u-1", "e1");
    expect(state.deleted).toBe("e1");
    expect(r.activeEspacoId).toBe("e2");
  });
});
