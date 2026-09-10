import { describe, expect, it, beforeEach, mock } from "bun:test";
import { NotFoundError } from "@/server/lib/errors";

type Row = Record<string, unknown>;

const cat = (over: Row = {}): Row => ({ id: "cat-1", nome: "Moradia", cor: "blue", ordem: 1, createdAt: new Date(), ...over });

const db: {
  rows: Row[];
  created: Row | null;
  deleted: string | null;
  onCreate: ((data: Row) => void) | null;
} = { rows: [], created: null, deleted: null, onCreate: null };

mock.module("@/server/modules/categoria/categoria.repository", () => ({
  categoriaRepository: {
    list: async () => db.rows,
    findById: async (id: string) => db.rows.find((r) => r.id === id) ?? null,
    count: async () => db.rows.length,
    create: async (data: Row) => {
      db.created = data;
      db.onCreate?.(data);
      return cat({ id: "cat-new", ...data });
    },
    createMany: async (data: Row[]) => {
      for (const d of data) db.onCreate?.(d);
      db.created = data.at(-1) ?? null;
      return { count: data.length };
    },
    update: async (id: string, data: Row) => cat({ id, ...data }),
    delete: async (id: string) => {
      db.deleted = id;
    },
  },
}));

const { categoriaService } = await import("./categoria.service");

const U = "u-1";

beforeEach(() => {
  db.rows = [cat()];
  db.created = null;
  db.deleted = null;
  db.onCreate = null;
});

describe("categoriaService.ensureDefaults", () => {
  it("base vazia recebe as 8 categorias padrão, com ordem sequencial de 1", async () => {
    db.rows = [];
    const criadas: Row[] = [];
    db.onCreate = (data) => criadas.push(data);

    await categoriaService.ensureDefaults(U);

    expect(criadas.length).toBe(8);
    expect(criadas.map((c) => c.ordem)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(criadas[0]).toMatchObject({ userId: U, nome: "Moradia", cor: "blue" });
    expect(criadas.at(-1)).toMatchObject({ nome: "Contas & Assinaturas" });
  });

  it("é idempotente: quem já tem categoria não ganha duplicata", async () => {
    const criadas: Row[] = [];
    db.onCreate = (data) => criadas.push(data);
    await categoriaService.ensureDefaults(U); // db.rows já tem 1 linha
    expect(criadas).toEqual([]);
  });
});

describe("categoriaService", () => {
  it("create: ordem = count + 1", async () => {
    await categoriaService.create(U, { nome: "Lazer", cor: "violet" });
    expect(db.created).toMatchObject({ nome: "Lazer", ordem: 2 });
  });

  it("view expõe só id/nome/cor/ordem", async () => {
    const [v] = await categoriaService.list(U);
    expect(v).toEqual({ id: "cat-1", nome: "Moradia", cor: "blue", ordem: 1 });
  });

  it("update/remove de id inexistente lança NotFoundError", async () => {
    expect(categoriaService.update(U, "nope", { nome: "X" })).rejects.toBeInstanceOf(NotFoundError);
    expect(categoriaService.remove(U, "nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("remove deleta e retorna id", async () => {
    const r = await categoriaService.remove(U, "cat-1");
    expect(r).toEqual({ id: "cat-1" });
    expect(db.deleted).toBe("cat-1");
  });
});
