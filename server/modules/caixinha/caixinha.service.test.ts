import { describe, expect, it, beforeEach, mock } from "bun:test";
import { NotFoundError } from "@/server/lib/errors";

type Cx = Record<string, unknown>;

const db: { rows: Cx[]; created: Cx | null; updated: { id: string; data: Cx } | null } = {
  rows: [],
  created: null,
  updated: null,
};

const caixinha = (over: Cx = {}): Cx => ({
  id: "cx-1",
  nome: "Emergência",
  aporteMensal: 700,
  taxaJuros: 0,
  meta: 14000,
  saldo: 158.25,
  cor: "emerald",
  acumulaSobra: false,
  ordem: 1,
  ...over,
});

mock.module("@/server/modules/caixinha/caixinha.repository", () => ({
  caixinhaRepository: {
    list: async () => db.rows,
    findById: async (id: string) => db.rows.find((r) => r.id === id) ?? null,
    count: async () => db.rows.length,
    create: async (data: Cx) => {
      db.created = data;
      return caixinha({ id: "cx-new", ...data });
    },
    update: async (id: string, data: Cx) => {
      db.updated = { id, data };
      return caixinha({ id, ...data });
    },
  },
}));

const { caixinhaService } = await import("./caixinha.service");

beforeEach(() => {
  db.rows = [caixinha()];
  db.created = null;
  db.updated = null;
});

describe("caixinhaService.create", () => {
  it("ordem = count + 1, saldo inicia 0, valores arredondados", async () => {
    const view = await caixinhaService.create({
      nome: "Nova",
      aporteMensal: 100.005,
      taxaJuros: 10.505,
      meta: 500.004,
      cor: "blue",
      acumulaSobra: false,
    });
    expect(db.created).toMatchObject({ ordem: 2, saldo: 0, aporteMensal: 100.01, taxaJuros: 10.51, meta: 500 });
    expect(view.saldo).toBe(0);
  });

  it("meta ausente vira null", async () => {
    await caixinhaService.create({ nome: "X", aporteMensal: 0, taxaJuros: 0, cor: "blue", acumulaSobra: false });
    expect(db.created!.meta).toBeNull();
  });
});

describe("caixinhaService.update", () => {
  it("id inexistente lança NotFoundError", async () => {
    expect(caixinhaService.update("nope", { nome: "Y" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("meta null explícito é preservado (remove meta)", async () => {
    await caixinhaService.update("cx-1", { meta: null });
    expect(db.updated!.data.meta).toBeNull();
  });

  it("arredonda aporteMensal e saldo", async () => {
    await caixinhaService.update("cx-1", { aporteMensal: 10.005, saldo: 99.999 });
    expect(db.updated!.data).toMatchObject({ aporteMensal: 10.01, saldo: 100 });
  });
});

describe("caixinhaService.list", () => {
  it("serializa Decimal-like pra number", async () => {
    const [v] = await caixinhaService.list();
    expect(v).toEqual({
      id: "cx-1",
      nome: "Emergência",
      tipo: null,
      aporteMensal: 700,
      taxaJuros: 0,
      meta: 14000,
      saldo: 158.25,
      cor: "emerald",
      acumulaSobra: false,
      ordem: 1,
    });
  });
});
