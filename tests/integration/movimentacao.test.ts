// Integração: /api/movimentacoes — efeito no saldo da caixinha (transação),
// descrição default, reversão no delete e isolamento por dono.
import { describe, expect, it, beforeEach } from "bun:test";
import { account, resetDb, seedRoles, type Client } from "./harness";
import { isoToday } from "@/server/lib/serialize";

let api: Client;
let caixinhaId: string;

beforeEach(async () => {
  await resetDb();
  await seedRoles();
  api = (await account({ roles: ["membro"] })).api;
  caixinhaId = (await api.post("/caixinhas", { nome: "Reserva" })).body.id;
});

describe("POST /api/movimentacoes", () => {
  it("aporte soma no saldo e devolve movimentação + caixinha", async () => {
    const res = await api.post("/movimentacoes", {
      caixinhaId,
      tipo: "aporte",
      valor: 150.555,
      data: "2026-07-10",
    });

    expect(res.status).toBe(201);
    expect(res.body.movimentacao).toMatchObject({
      caixinhaId,
      tipo: "aporte",
      valor: 150.56,
      descricao: "Aporte",
      data: "2026-07-10",
    });
    expect(res.body.caixinha.saldo).toBe(150.56);
  });

  it("despesa subtrai do saldo (pode ficar negativo)", async () => {
    await api.post("/movimentacoes", { caixinhaId, tipo: "aporte", valor: 100 });
    const res = await api.post("/movimentacoes", { caixinhaId, tipo: "despesa", valor: 130 });

    expect(res.body.movimentacao).toMatchObject({ tipo: "despesa", descricao: "Despesa" });
    expect(res.body.caixinha.saldo).toBe(-30);
  });

  it("descrição em branco cai no default por tipo", async () => {
    const aporte = await api.post("/movimentacoes", {
      caixinhaId,
      tipo: "aporte",
      valor: 10,
      descricao: "   ",
    });
    expect(aporte.body.movimentacao.descricao).toBe("Aporte");

    const nomeada = await api.post("/movimentacoes", {
      caixinhaId,
      tipo: "despesa",
      valor: 10,
      descricao: "  Farmácia  ",
    });
    expect(nomeada.body.movimentacao.descricao).toBe("Farmácia");
  });

  it("sem data usa hoje", async () => {
    const res = await api.post("/movimentacoes", { caixinhaId, tipo: "aporte", valor: 5 });
    expect(res.body.movimentacao.data).toBe(isoToday());
  });

  it("valor <= 0 ou data mal formatada → 422", async () => {
    expect((await api.post("/movimentacoes", { caixinhaId, tipo: "aporte", valor: 0 })).status).toBe(422);
    expect(
      (await api.post("/movimentacoes", { caixinhaId, tipo: "aporte", valor: 10, data: "10/07/2026" }))
        .status
    ).toBe(422);
    expect((await api.post("/movimentacoes", { caixinhaId, tipo: "transferencia", valor: 10 })).status).toBe(
      422
    );
  });

  it("caixinha inexistente → 404 e nada é criado", async () => {
    const res = await api.post("/movimentacoes", {
      caixinhaId: "00000000-0000-0000-0000-000000000000",
      tipo: "aporte",
      valor: 10,
    });
    expect(res.status).toBe(404);
    expect((await api.get("/movimentacoes")).body).toEqual([]);
  });
});

describe("GET /api/movimentacoes", () => {
  it("lista por data desc, só do dono", async () => {
    await api.post("/movimentacoes", { caixinhaId, tipo: "aporte", valor: 10, data: "2026-06-01" });
    await api.post("/movimentacoes", { caixinhaId, tipo: "aporte", valor: 20, data: "2026-07-01" });

    const outro = await account({ roles: ["membro"] });
    const cxOutro = (await outro.api.post("/caixinhas", { nome: "Outra" })).body.id;
    await outro.api.post("/movimentacoes", { caixinhaId: cxOutro, tipo: "aporte", valor: 99 });

    const res = await api.get("/movimentacoes");
    expect(res.body.map((m: { valor: number }) => m.valor)).toEqual([20, 10]);
  });
});

describe("DELETE /api/movimentacoes/:id", () => {
  it("aporte removido devolve o saldo", async () => {
    const mv = (await api.post("/movimentacoes", { caixinhaId, tipo: "aporte", valor: 80 })).body
      .movimentacao;

    const res = await api.delete(`/movimentacoes/${mv.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: mv.id });
    expect(res.body.caixinha.saldo).toBe(0);
    expect((await api.get("/movimentacoes")).body).toEqual([]);
  });

  it("despesa removida volta a somar no saldo", async () => {
    await api.post("/movimentacoes", { caixinhaId, tipo: "aporte", valor: 100 });
    const desp = (await api.post("/movimentacoes", { caixinhaId, tipo: "despesa", valor: 40 })).body
      .movimentacao;

    const res = await api.delete(`/movimentacoes/${desp.id}`);
    expect(res.body.caixinha.saldo).toBe(100);
  });

  it("movimentação de outra conta → 404 e saldo intacto", async () => {
    const mv = (await api.post("/movimentacoes", { caixinhaId, tipo: "aporte", valor: 60 })).body
      .movimentacao;

    const outro = await account({ roles: ["membro"] });
    expect((await outro.api.delete(`/movimentacoes/${mv.id}`)).status).toBe(404);
    expect((await api.get("/caixinhas")).body[0].saldo).toBe(60);
  });
});

describe("permissions", () => {
  it("leitor lista mas não cria", async () => {
    const leitor = await account({ roles: ["leitor"] });
    expect((await leitor.api.get("/movimentacoes")).status).toBe(200);
    const res = await leitor.api.post("/movimentacoes", { caixinhaId, tipo: "aporte", valor: 10 });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Sem permissão: movimentacao:manage" });
  });
});
