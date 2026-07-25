// Integração: /api/caixinhas — CRUD, ordem, arredondamento e isolamento por dono.
import { describe, expect, it, beforeEach } from "bun:test";
import { account, resetDb, seedRoles, prisma, type Client } from "./harness";

let api: Client;

beforeEach(async () => {
  await resetDb();
  await seedRoles();
  api = (await account({ roles: ["membro"] })).api;
});

describe("POST /api/caixinhas", () => {
  it("cria com defaults do DTO, saldo 0 e ordem 1", async () => {
    const res = await api.post("/caixinhas", {});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      nome: "Nova caixinha",
      tipo: null,
      aporteMensal: 0,
      taxaJuros: 0,
      meta: null,
      saldo: 0,
      cor: "blue",
      acumulaSobra: false,
      ordem: 1,
    });
  });

  it("ordem é count+1 e o saldo do body é ignorado", async () => {
    await api.post("/caixinhas", { nome: "A" });
    const b = await api.post("/caixinhas", { nome: "B", saldo: 999 });
    expect(b.body.ordem).toBe(2);
    expect(b.body.saldo).toBe(0);
  });

  it("arredonda dinheiro pra 2 casas", async () => {
    const res = await api.post("/caixinhas", {
      nome: "Arredonda",
      aporteMensal: 100.567,
      taxaJuros: 0.999,
      meta: 1000.005,
    });
    expect(res.body).toMatchObject({ aporteMensal: 100.57, taxaJuros: 1, meta: 1000.01 });
  });

  it("aceita o discriminador tipo=emergencia", async () => {
    const res = await api.post("/caixinhas", { nome: "Reserva", tipo: "emergencia" });
    expect(res.body.tipo).toBe("emergencia");
  });

  it("tipo fora do literal → 422", async () => {
    const res = await api.post("/caixinhas", { nome: "X", tipo: "qualquer" });
    expect(res.status).toBe(422);
  });

  it("valores negativos → 422", async () => {
    expect((await api.post("/caixinhas", { aporteMensal: -1 })).status).toBe(422);
    expect((await api.post("/caixinhas", { meta: 0 })).status).toBe(422);
    expect((await api.post("/caixinhas", { nome: "  " })).status).toBe(422);
  });
});

describe("GET /api/caixinhas", () => {
  it("lista por ordem asc", async () => {
    await api.post("/caixinhas", { nome: "Primeira" });
    await api.post("/caixinhas", { nome: "Segunda" });

    const res = await api.get("/caixinhas");
    expect(res.status).toBe(200);
    expect(res.body.map((c: { nome: string }) => c.nome)).toEqual(["Primeira", "Segunda"]);
  });
});

describe("PATCH /api/caixinhas/:id", () => {
  it("aplica patch parcial e arredonda", async () => {
    const cx = (await api.post("/caixinhas", { nome: "Antes", aporteMensal: 100 })).body;

    const res = await api.patch(`/caixinhas/${cx.id}`, {
      nome: "Depois",
      saldo: 10.999,
      acumulaSobra: true,
      ordem: 7,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      nome: "Depois",
      saldo: 11,
      acumulaSobra: true,
      ordem: 7,
      aporteMensal: 100,
    });
  });

  it("meta: null limpa a meta", async () => {
    const cx = (await api.post("/caixinhas", { nome: "Com meta", meta: 500 })).body;
    const res = await api.patch(`/caixinhas/${cx.id}`, { meta: null });
    expect(res.body.meta).toBeNull();
  });

  it("id inexistente → 404", async () => {
    const res = await api.patch("/caixinhas/00000000-0000-0000-0000-000000000000", { nome: "X" });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("Caixinha não encontrada");
  });
});

describe("DELETE /api/caixinhas/:id", () => {
  it("remove e leva as movimentações em cascata", async () => {
    const cx = (await api.post("/caixinhas", { nome: "Vai sumir" })).body;
    await api.post("/movimentacoes", { caixinhaId: cx.id, tipo: "aporte", valor: 50 });

    const res = await api.delete(`/caixinhas/${cx.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: cx.id });
    expect(await prisma.movimentacao.count({ where: { caixinhaId: cx.id } })).toBe(0);
    expect((await api.get("/caixinhas")).body).toEqual([]);
  });

  it("id inexistente → 404", async () => {
    expect((await api.delete("/caixinhas/00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });
});

describe("isolamento entre contas", () => {
  it("caixinha de outro dono responde 404 (não 403) em leitura e mutação", async () => {
    const dono = await account({ roles: ["membro"] });
    const cx = (await dono.api.post("/caixinhas", { nome: "Da outra conta" })).body;

    const outro = await account({ roles: ["membro"] });
    expect((await outro.api.get("/caixinhas")).body).toEqual([]);
    expect((await outro.api.patch(`/caixinhas/${cx.id}`, { nome: "Hack" })).status).toBe(404);
    expect((await outro.api.delete(`/caixinhas/${cx.id}`)).status).toBe(404);

    // segue intacta pro dono
    expect((await dono.api.get("/caixinhas")).body[0].nome).toBe("Da outra conta");
  });
});

describe("permissions", () => {
  it("leitor lê mas não muta", async () => {
    const leitor = await account({ roles: ["leitor"] });
    expect((await leitor.api.get("/caixinhas")).status).toBe(200);

    const res = await leitor.api.post("/caixinhas", { nome: "Não vai" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Sem permissão: caixinha:manage" });
  });

  it("sem caixinha:view → 403 na listagem", async () => {
    const sem = await account({ permissions: ["state:view"] });
    expect((await sem.api.get("/caixinhas")).status).toBe(403);
  });
});
