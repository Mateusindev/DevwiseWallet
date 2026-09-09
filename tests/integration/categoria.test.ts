// Integração: /api/categorias — CRUD, ordem e desvínculo das despesas no delete.
import { describe, expect, it, beforeEach } from "bun:test";
import { account, resetDb, seedRoles, prisma, type Client } from "./harness";

let api: Client;

beforeEach(async () => {
  await resetDb();
  await seedRoles();
  api = (await account({ roles: ["membro"] })).api;
});

describe("POST /api/categorias", () => {
  it("cria com defaults e ordem 1", async () => {
    const res = await api.post("/categorias", {});
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: res.body.id, nome: "Nova categoria", cor: "blue", ordem: 1 });
  });

  it("ordem é count+1", async () => {
    await api.post("/categorias", { nome: "Moradia" });
    const segunda = await api.post("/categorias", { nome: "Lazer", cor: "violet" });
    expect(segunda.body).toMatchObject({ nome: "Lazer", cor: "violet", ordem: 2 });
  });

  it("nome vazio → 422", async () => {
    expect((await api.post("/categorias", { nome: "   " })).status).toBe(422);
  });
});

describe("GET /api/categorias", () => {
  it("lista por ordem asc, só do dono", async () => {
    await api.post("/categorias", { nome: "Primeira" });
    await api.post("/categorias", { nome: "Segunda" });

    const outro = await account({ roles: ["membro"] });
    await outro.api.post("/categorias", { nome: "De outra conta" });

    const res = await api.get("/categorias");
    expect(res.body.map((c: { nome: string }) => c.nome)).toEqual(["Primeira", "Segunda"]);
  });
});

describe("PATCH /api/categorias/:id", () => {
  it("atualiza nome, cor e ordem", async () => {
    const cat = (await api.post("/categorias", { nome: "Antes" })).body;
    const res = await api.patch(`/categorias/${cat.id}`, { nome: "Depois", cor: "rose", ordem: 9 });
    expect(res.body).toEqual({ id: cat.id, nome: "Depois", cor: "rose", ordem: 9 });
  });

  it("categoria de outra conta → 404", async () => {
    const outro = await account({ roles: ["membro"] });
    const alheia = (await outro.api.post("/categorias", { nome: "Alheia" })).body;
    expect((await api.patch(`/categorias/${alheia.id}`, { nome: "Hack" })).status).toBe(404);
  });
});

describe("DELETE /api/categorias/:id", () => {
  it("remove e desvincula as despesas (categoria_id vira null)", async () => {
    const esp = (await api.post("/despesas/espacos", { nome: "Principal" })).body.id;
    const cat = (await api.post("/categorias", { nome: "Moradia" })).body;
    const fixa = (
      await api.post(`/despesas/espacos/${esp}/fixas`, {
        descricao: "Aluguel",
        valor: 900,
        categoriaId: cat.id,
      })
    ).body.despesa;
    const avulsa = (
      await api.post(`/despesas/espacos/${esp}/mes`, {
        mes: "2026-07",
        descricao: "Mercado",
        valor: 300,
        categoriaId: cat.id,
      })
    ).body.despesa;

    const res = await api.delete(`/categorias/${cat.id}`);
    expect(res.body).toEqual({ id: cat.id });
    expect((await api.get("/categorias")).body).toEqual([]);

    expect((await prisma.despesaFixa.findUnique({ where: { id: fixa.id } }))?.categoriaId).toBeNull();
    expect((await prisma.despesaMes.findUnique({ where: { id: avulsa.id } }))?.categoriaId).toBeNull();
  });

  it("id inexistente → 404", async () => {
    expect((await api.delete("/categorias/00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });
});

describe("permissions", () => {
  it("leitor lista, não muta", async () => {
    const leitor = await account({ roles: ["leitor"] });
    expect((await leitor.api.get("/categorias")).status).toBe(200);
    const res = await leitor.api.post("/categorias", { nome: "Não vai" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Sem permissão: categoria:manage" });
  });
});
