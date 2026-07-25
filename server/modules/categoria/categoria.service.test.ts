import { describe, expect, it, beforeEach, mock } from "bun:test";
import { NotFoundError } from "@/server/lib/errors";

type Row = Record<string, unknown>;

const cat = (over: Row = {}): Row => ({ id: "cat-1", nome: "Moradia", cor: "blue", ordem: 1, createdAt: new Date(), ...over });

const db: { rows: Row[]; created: Row | null; deleted: string | null } = { rows: [], created: null, deleted: null };

mock.module("@/server/modules/categoria/categoria.repository", () => ({
  categoriaRepository: {
    list: async () => db.rows,
    findById: async (_userId: string, id: string) => db.rows.find((r) => r.id === id) ?? null,
    count: async () => db.rows.length,
    create: async (data: Row) => {
      db.created = data;
      return cat({ id: "cat-new", ...data });
    },
    update: async (id: string, data: Row) => cat({ id, ...data }),
    delete: async (id: string) => {
      db.deleted = id;
    },
  },
}));

const { categoriaService } = await import("./categoria.service");

beforeEach(() => {
  db.rows = [cat()];
  db.created = null;
  db.deleted = null;
});

describe("categoriaService", () => {
  it("create: ordem = count + 1", async () => {
    await categoriaService.create("u-1", { nome: "Lazer", cor: "violet" });
    expect(db.created).toMatchObject({ nome: "Lazer", ordem: 2 });
  });

  it("view expõe só id/nome/cor/ordem", async () => {
    const [v] = await categoriaService.list("u-1");
    expect(v).toEqual({ id: "cat-1", nome: "Moradia", cor: "blue", ordem: 1 });
  });

  it("update/remove de id inexistente lança NotFoundError", async () => {
    expect(categoriaService.update("u-1", "nope", { nome: "X" })).rejects.toBeInstanceOf(NotFoundError);
    expect(categoriaService.remove("u-1", "nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("remove deleta e retorna id", async () => {
    const r = await categoriaService.remove("u-1", "cat-1");
    expect(r).toEqual({ id: "cat-1" });
    expect(db.deleted).toBe("cat-1");
  });
});
