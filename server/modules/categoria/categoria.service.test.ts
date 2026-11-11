import { describe, expect, it, beforeEach, mock } from "bun:test";
import { NotFoundError } from "@/server/lib/errors";

type Row = Record<string, unknown>;

const cat = (over: Row = {}): Row => ({ id: "cat-1", nome: "Moradia", cor: "blue", ordem: 1, createdAt: new Date(), ...over });

const db: {
  rows: Row[];
  created: Row | null;
  deleted: string | null;
  onCreate: ((data: Row) => void) | null;
  uso: { fixas: Row[]; lancamentos: Row[] };
  reordenado: string[] | null;
  mesclado: string[] | null;
} = { rows: [], created: null, deleted: null, onCreate: null, uso: { fixas: [], lancamentos: [] }, reordenado: null, mesclado: null };

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
    uso: async () => db.uso,
    reordenar: async (_u: string, ids: string[]) => {
      db.reordenado = ids;
      return [];
    },
    mesclar: async (_u: string, origem: string, destino: string) => {
      db.mesclado = [origem, destino];
      return { fixas: 2, lancamentos: 5 };
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
  db.uso = { fixas: [], lancamentos: [] };
  db.reordenado = null;
  db.mesclado = null;
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

describe("categoriaService.uso", () => {
  it("junta fixas e lançamentos por categoria; sem uso não aparece", async () => {
    db.uso = {
      fixas: [{ categoriaId: "cat-1", _count: { _all: 3 } }],
      lancamentos: [
        { categoriaId: "cat-1", _count: { _all: 7 }, _max: { mes: "2026-10" } },
        { categoriaId: "cat-2", _count: { _all: 1 }, _max: { mes: "2026-01" } },
      ],
    };
    expect(await categoriaService.uso(U)).toEqual({
      "cat-1": { fixas: 3, lancamentos: 7, ultimoMes: "2026-10" },
      "cat-2": { fixas: 0, lancamentos: 1, ultimoMes: "2026-01" },
    });
  });
});

describe("categoriaService.reordenar", () => {
  beforeEach(() => {
    db.rows = [cat({ id: "a" }), cat({ id: "b" }), cat({ id: "c" })];
  });

  it("aceita a lista inteira em outra ordem", async () => {
    await categoriaService.reordenar(U, { ids: ["c", "a", "b"] });
    expect(db.reordenado).toEqual(["c", "a", "b"]);
  });

  it("id alheio → 404 e nada é gravado", async () => {
    await expect(categoriaService.reordenar(U, { ids: ["a", "b", "x"] })).rejects.toBeInstanceOf(NotFoundError);
    expect(db.reordenado).toBeNull();
  });

  it("faltando ou repetida → 422 e nada é gravado", async () => {
    await expect(categoriaService.reordenar(U, { ids: ["a", "b"] })).rejects.toMatchObject({ statusCode: 422 });
    await expect(categoriaService.reordenar(U, { ids: ["a", "a", "b"] })).rejects.toMatchObject({ statusCode: 422 });
    expect(db.reordenado).toBeNull();
  });
});

describe("categoriaService.mesclar", () => {
  beforeEach(() => {
    db.rows = [cat({ id: "a" }), cat({ id: "b" })];
  });

  it("move as despesas e devolve quantas mudaram", async () => {
    expect(await categoriaService.mesclar(U, "a", { destinoId: "b" })).toEqual({ id: "a", destinoId: "b", fixas: 2, lancamentos: 5 });
    expect(db.mesclado).toEqual(["a", "b"]);
  });

  it("na mesma categoria → 422", async () => {
    await expect(categoriaService.mesclar(U, "a", { destinoId: "a" })).rejects.toMatchObject({ statusCode: 422 });
    expect(db.mesclado).toBeNull();
  });

  it("destino de outro dono → 404, nada muda", async () => {
    await expect(categoriaService.mesclar(U, "a", { destinoId: "x" })).rejects.toBeInstanceOf(NotFoundError);
    expect(db.mesclado).toBeNull();
  });
});
