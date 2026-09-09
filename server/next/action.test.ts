// O wrapper das Server Functions é onde auth, permission e mapeamento de erro
// passam a viver — o que antes estava espalhado em requireAuth/requirePermission
// e no onError do Hono. É o teste que segura esse contrato.
import { describe, expect, it, beforeEach, mock } from "bun:test";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { AppError, NotFoundError } from "@/server/lib/errors";

const state: { permitidas: string[] | "todas"; pedidas: string[][] } = {
  permitidas: "todas",
  pedidas: [],
};

const USER = { id: "u-1", email: "a@b.c", nome: "A", roles: [], permissions: [] };

mock.module("@/server/next/session", () => ({
  async requireAnyPerm(...permissions: string[]) {
    state.pedidas.push(permissions);
    if (state.permitidas === "todas") return USER;
    if (permissions.some((p) => (state.permitidas as string[]).includes(p))) return USER;
    throw new AppError(`Sem permissão: ${permissions.join(" | ")}`, 403);
  },
}));

const { acao, acaoValidada, erroDaAction } = await import("./action");

beforeEach(() => {
  state.permitidas = "todas";
  state.pedidas = [];
});

describe("acao", () => {
  it("devolve { ok: true, data } com o retorno do service", async () => {
    expect(await acao("categoria:view", async () => ({ n: 1 }))).toEqual({
      ok: true,
      data: { n: 1 },
    });
  });

  it("passa o usuário da sessão pro service", async () => {
    const r = await acao("categoria:view", async (user) => user.id);
    expect(r).toEqual({ ok: true, data: "u-1" });
  });

  it("sem permission responde 403 e nem chama o service", async () => {
    state.permitidas = [];
    let chamou = false;
    const r = await acao("categoria:manage", async () => {
      chamou = true;
    });
    expect(r).toEqual({ ok: false, status: 403, error: "Sem permissão: categoria:manage" });
    expect(chamou).toBe(false);
  });

  it("lista de permissions: basta uma (é o alias histórico do compartilhamento)", async () => {
    state.permitidas = ["cartao:share"];
    const r = await acao(["share:manage", "cartao:share"], async () => "ok");
    expect(r).toEqual({ ok: true, data: "ok" });
    expect(state.pedidas[0]).toEqual(["share:manage", "cartao:share"]);
  });
});

describe("acaoValidada", () => {
  const schema = z.object({ nome: z.string().trim().min(1), cor: z.string().default("blue") });

  it("aplica os defaults do DTO antes do service", async () => {
    const r = await acaoValidada("categoria:manage", schema, { nome: "  Casa  " }, async (_u, dto) => dto);
    expect(r).toEqual({ ok: true, data: { nome: "Casa", cor: "blue" } });
  });

  it("payload inválido vira 422 com os issues do zod (é o que marca o campo no form)", async () => {
    const r = await acaoValidada("categoria:manage", schema, { nome: "   " }, async () => "nunca");
    expect(r).toMatchObject({ ok: false, status: 422, error: "Validação falhou" });
    const issues = (r as { issues: { path: (string | number)[] }[] }).issues;
    expect(issues.some((i) => i.path[0] === "nome")).toBe(true);
  });

  it("valida depois da permission: sem acesso não vaza o formato do DTO", async () => {
    state.permitidas = [];
    const r = await acaoValidada("categoria:manage", schema, { nome: "" }, async () => "nunca");
    expect(r).toMatchObject({ status: 403 });
  });
});

describe("erroDaAction — mesmo mapeamento do onError do Hono", () => {
  it("AppError mantém o statusCode e a mensagem", () => {
    expect(erroDaAction(new AppError("Não dá", 400))).toEqual({
      ok: false,
      status: 400,
      error: "Não dá",
    });
  });

  it("NotFoundError vira 404 (recurso de outro dono não vaza existência)", () => {
    expect(erroDaAction(new NotFoundError("Categoria não encontrada: x"))).toMatchObject({
      status: 404,
    });
  });

  it("P2025 do Prisma vira 404", () => {
    const err = new Prisma.PrismaClientKnownRequestError("no", {
      code: "P2025",
      clientVersion: "6",
    });
    expect(erroDaAction(err)).toEqual({ ok: false, status: 404, error: "Registro não encontrado" });
  });

  it("erro desconhecido vira 500 sem vazar a mensagem", () => {
    expect(erroDaAction(new Error("select * from users falhou"))).toEqual({
      ok: false,
      status: 500,
      error: "Erro interno",
    });
  });
});
