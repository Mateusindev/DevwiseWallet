import { describe, expect, it, beforeEach, mock } from "bun:test";
import { AppError } from "@/server/lib/errors";
import { hashPassword, verifyPassword } from "./password";

type Row = Record<string, unknown>;

const state: { user: Row | null; entitlements: string[] } = { user: null, entitlements: ["*"] };

const roleMembro = { id: "r1", nome: "membro", permissions: ["caixinha:*", "state:view"] };
const roleLeitor = { id: "r2", nome: "leitor", permissions: ["cartao:view"] };

const userRow = (over: Row = {}): Row => ({
  id: "u1",
  email: "joao@wallet.local",
  nome: "João",
  senhaHash: hashPassword("segredo123"),
  ativo: true,
  roles: [{ role: roleMembro }, { role: roleLeitor }],
  ...over,
});

mock.module("@/server/auth/auth.repository", () => ({
  authRepository: {
    findByEmail: async (email: string) => (state.user && state.user.email === email ? state.user : null),
    findById: async (id: string) => (state.user && state.user.id === id ? state.user : null),
  },
}));

mock.module("@/server/auth/entitlements", () => ({
  planEntitlements: async () => state.entitlements,
}));

const { authService, toAuthUser } = await import("./auth.service");

beforeEach(() => {
  state.user = userRow();
  state.entitlements = ["*"];
});

describe("password", () => {
  it("hash verifica e rejeita senha errada", () => {
    const h = hashPassword("abc");
    expect(verifyPassword("abc", h)).toBe(true);
    expect(verifyPassword("abd", h)).toBe(false);
  });
});

describe("authService.login", () => {
  it("sucesso retorna AuthUser com união das permissions das roles", async () => {
    const u = await authService.login("joao@wallet.local", "segredo123");
    expect(u.roles).toEqual(["membro", "leitor"]);
    expect(u.permissions).toEqual(["caixinha:*", "state:view", "cartao:view"]);
  });

  it("senha errada → 401 com mensagem genérica", async () => {
    expect(authService.login("joao@wallet.local", "errada")).rejects.toMatchObject({
      statusCode: 401,
      message: "Email ou senha inválidos",
    });
  });

  it("email inexistente → mesma mensagem (não vaza existência)", async () => {
    expect(authService.login("naoexiste@x.com", "segredo123")).rejects.toBeInstanceOf(AppError);
  });

  it("usuário inativo não loga", async () => {
    state.user = userRow({ ativo: false });
    expect(authService.login("joao@wallet.local", "segredo123")).rejects.toMatchObject({ statusCode: 401 });
  });

  it("email é normalizado (case/espaços)", async () => {
    const u = await authService.login("  JoAo@Wallet.LOCAL ", "segredo123");
    expect(u.id).toBe("u1");
  });
});

describe("authService.can — roles ∩ entitlements", () => {
  it("permission da role com entitlement total", async () => {
    const u = toAuthUser(userRow() as never);
    expect(await authService.can(u, "caixinha:manage")).toBe(true);
    expect(await authService.can(u, "dev:reset")).toBe(false);
  });

  it("entitlement do plano restringe mesmo com role liberando (seam de billing)", async () => {
    state.entitlements = ["state:view"]; // plano só libera visualizar
    const u = toAuthUser(userRow() as never);
    expect(await authService.can(u, "state:view")).toBe(true);
    expect(await authService.can(u, "caixinha:manage")).toBe(false);
  });
});

describe("tokens", () => {
  it("sign → verify roundtrip", async () => {
    const token = await authService.signToken("u1");
    expect(await authService.verifyToken(token)).toBe("u1");
  });

  it("token adulterado → null", async () => {
    const token = await authService.signToken("u1");
    expect(await authService.verifyToken(token.slice(0, -2) + "xx")).toBeNull();
  });
});
