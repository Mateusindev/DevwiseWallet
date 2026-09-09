// Integração: POST /api/dev/reset — restaura os dados de exemplo do usuário
// logado (e só dele), com guarda de produção.
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { account, resetDb, seedRoles, prisma } from "./harness";

beforeEach(async () => {
  await resetDb();
  await seedRoles();
});

describe("POST /api/dev/reset", () => {
  it("recria os dados de exemplo do próprio usuário", async () => {
    const { api, user } = await account({ roles: ["admin"] });
    await api.post("/caixinhas", { nome: "Some no reset" });

    const res = await api.post("/dev/reset");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const state = await api.get("/state");
    expect(state.body.caixinhas.map((c: { nome: string }) => c.nome)).toEqual([
      "Reserva de emergência",
      "Despesas Variáveis",
    ]);
    expect(state.body.espacos.map((e: { nome: string }) => e.nome)).toEqual(["Nosso", "Meu"]);
    expect(state.body.cartoes.map((c: { nome: string }) => c.nome)).toEqual(["Nubank", "Inter"]);
    expect(state.body.movimentacoes).toHaveLength(9);
    expect(await prisma.contato.count({ where: { ownerId: user.id } })).toBe(2);
    // 4 no modo linha (cartão vem da despesa, cartaoId null) + 1 avulso na fatura
    expect(await prisma.cartaoShare.count({ where: { contato: { ownerId: user.id } } })).toBe(5);
  });

  it("é idempotente (roda duas vezes sem duplicar)", async () => {
    const { api, user } = await account({ roles: ["admin"] });
    await api.post("/dev/reset");
    await api.post("/dev/reset");

    expect(await prisma.caixinha.count({ where: { userId: user.id } })).toBe(2);
    expect(await prisma.espaco.count({ where: { userId: user.id } })).toBe(2);
    expect(await prisma.contato.count({ where: { ownerId: user.id } })).toBe(2);
  });

  it("não toca nos dados de outra conta", async () => {
    const outro = await account({ roles: ["membro"] });
    await outro.api.post("/caixinhas", { nome: "Intocada" });

    const admin = await account({ roles: ["admin"] });
    await admin.api.post("/dev/reset");

    const state = await outro.api.get("/state");
    expect(state.body.caixinhas.map((c: { nome: string }) => c.nome)).toEqual(["Intocada"]);
  });

  it("exige dev:reset — membro leva 403", async () => {
    const membro = await account({ roles: ["membro"] });
    const res = await membro.api.post("/dev/reset");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Sem permissão: dev:reset" });
  });
});

describe("guarda de produção", () => {
  // cast: o @types/node do Next declara NODE_ENV como readonly
  const env = process.env as { NODE_ENV?: string };
  const original = env.NODE_ENV;
  afterEach(() => {
    env.NODE_ENV = original;
  });

  it("responde 403 quando NODE_ENV=production", async () => {
    const { api } = await account({ roles: ["admin"] });
    env.NODE_ENV = "production";

    const res = await api.post("/dev/reset");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Indisponível em produção." });
  });
});
