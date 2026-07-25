import { describe, expect, it, beforeEach, mock } from "bun:test";
import { NotFoundError } from "@/server/lib/errors";

type Cx = Record<string, unknown>;

const db: {
  rows: Cx[];
  created: Cx | null;
  updated: { id: string; data: Cx } | null;
  deleted: string | null;
} = { rows: [], created: null, updated: null, deleted: null };

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
    delete: async (id: string) => {
      db.deleted = id;
      db.rows = db.rows.filter((r) => r.id !== id);
    },
  },
}));

const { caixinhaService } = await import("./caixinha.service");

const U = "u-1"; // dono usado em todas as chamadas

beforeEach(() => {
  db.rows = [caixinha()];
  db.created = null;
  db.updated = null;
  db.deleted = null;
});

describe("caixinhaService.create", () => {
  it("ordem = count + 1, saldo inicia 0, valores arredondados", async () => {
    const view = await caixinhaService.create(U, {
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
    await caixinhaService.create(U, { nome: "X", aporteMensal: 0, taxaJuros: 0, cor: "blue", acumulaSobra: false });
    expect(db.created!.meta).toBeNull();
  });
});

describe("caixinhaService.update", () => {
  it("id inexistente lança NotFoundError", async () => {
    expect(caixinhaService.update(U, "nope", { nome: "Y" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("meta null explícito é preservado (remove meta)", async () => {
    await caixinhaService.update(U, "cx-1", { meta: null });
    expect(db.updated!.data.meta).toBeNull();
  });

  it("arredonda aporteMensal e saldo", async () => {
    await caixinhaService.update(U, "cx-1", { aporteMensal: 10.005, saldo: 99.999 });
    expect(db.updated!.data).toMatchObject({ aporteMensal: 10.01, saldo: 100 });
  });
});

describe("caixinhaService.list", () => {
  it("serializa Decimal-like pra number", async () => {
    const [v] = await caixinhaService.list(U);
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

  it("lista vazia devolve array vazio", async () => {
    db.rows = [];
    expect(await caixinhaService.list(U)).toEqual([]);
  });
});

describe("caixinhaService.getOrThrow", () => {
  it("devolve a linha crua do dono", async () => {
    expect(await caixinhaService.getOrThrow(U, "cx-1")).toMatchObject({ id: "cx-1" });
  });

  it("caixinha de outro dono responde 404, não 403 (não vaza existência)", async () => {
    // o repositório já filtra por userId — do ponto de vista do service, some
    db.rows = [];
    expect(caixinhaService.getOrThrow(U, "cx-1")).rejects.toMatchObject({
      statusCode: 404,
      message: "Caixinha não encontrada: cx-1",
    });
  });
});

describe("caixinhaService.remove", () => {
  it("apaga e devolve o id", async () => {
    expect(await caixinhaService.remove(U, "cx-1")).toEqual({ id: "cx-1" });
    expect(db.deleted).toBe("cx-1");
  });

  it("id inexistente lança NotFoundError e não apaga nada", async () => {
    expect(caixinhaService.remove(U, "nope")).rejects.toBeInstanceOf(NotFoundError);
    expect(db.deleted).toBeNull();
  });
});
