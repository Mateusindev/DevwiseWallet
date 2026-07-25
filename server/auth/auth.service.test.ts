import { describe, expect, it, beforeEach, mock } from "bun:test";
import { AppError } from "@/server/lib/errors";
import { hashPassword, verifyPassword } from "./password";

type Row = Record<string, unknown>;

const state: {
  user: Row | null;
  entitlements: string[];
  roleMembroExiste: boolean;
  created: Row | null;
} = { user: null, entitlements: ["*"], roleMembroExiste: true, created: null };

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
    findRoleByName: async (nome: string) =>
      state.roleMembroExiste && nome === "membro" ? roleMembro : null,
    create: async (data: Row) => {
      state.created = data;
      return userRow({ id: "u-new", email: data.email, nome: data.nome, roles: [{ role: roleMembro }] });
    },
  },
}));

mock.module("@/server/auth/entitlements", () => ({
  planEntitlements: async () => state.entitlements,
}));

const { authService, toAuthUser, authSecret, AUTH_COOKIE, TOKEN_TTL_S } = await import("./auth.service");

beforeEach(() => {
  state.user = userRow();
  state.entitlements = ["*"];
  state.roleMembroExiste = true;
  state.created = null;
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

describe("toAuthUser", () => {
  it("dedupa permissions repetidas entre roles", () => {
    const u = toAuthUser(
      userRow({ roles: [{ role: roleMembro }, { role: { ...roleLeitor, permissions: ["caixinha:*"] } }] }) as never
    );
    expect(u.permissions).toEqual(["caixinha:*", "state:view"]);
  });

  it("usuário sem role fica sem permission nenhuma", () => {
    const u = toAuthUser(userRow({ roles: [] }) as never);
    expect(u.roles).toEqual([]);
    expect(u.permissions).toEqual([]);
  });
});

describe("authService.register", () => {
  it("cria com a role padrão 'membro' e email/nome normalizados", async () => {
    const u = await authService.register("  Maria  ", "  Maria@X.COM ", "segredo123");
    expect(state.created).toMatchObject({ email: "maria@x.com", nome: "Maria", roleIds: ["r1"] });
    expect(u.roles).toEqual(["membro"]);
  });

  it("grava hash, nunca a senha em claro", async () => {
    await authService.register("Maria", "maria@x.com", "segredo123");
    expect(state.created!.senhaHash).not.toBe("segredo123");
    expect(verifyPassword("segredo123", state.created!.senhaHash as string)).toBe(true);
  });

  it("email já cadastrado → 409", async () => {
    expect(authService.register("João 2", "joao@wallet.local", "segredo123")).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("role 'membro' ausente no banco → 500 (base mal semeada)", async () => {
    state.roleMembroExiste = false;
    expect(authService.register("Maria", "maria@x.com", "segredo123")).rejects.toMatchObject({
      statusCode: 500,
    });
  });
});

describe("authService.getSessionUser", () => {
  it("devolve o usuário fresco do banco", async () => {
    const u = await authService.getSessionUser("u1");
    expect(u).toMatchObject({ id: "u1", email: "joao@wallet.local" });
  });

  it("usuário inexistente → null", async () => {
    expect(await authService.getSessionUser("fantasma")).toBeNull();
  });

  it("usuário desativado perde a sessão na request seguinte", async () => {
    state.user = userRow({ ativo: false });
    expect(await authService.getSessionUser("u1")).toBeNull();
  });

  it("mudança de role vale imediatamente (roles vêm do banco, não do JWT)", async () => {
    state.user = userRow({ roles: [{ role: roleLeitor }] });
    const u = await authService.getSessionUser("u1");
    expect(u!.permissions).toEqual(["cartao:view"]);
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

  it("lixo qualquer → null (não estoura)", async () => {
    expect(await authService.verifyToken("")).toBeNull();
    expect(await authService.verifyToken("nao.e.jwt")).toBeNull();
  });

  it("payload carrega sub/iat/exp com TTL de 7 dias", async () => {
    const token = await authService.signToken("u1");
    const payload = JSON.parse(atob(token.split(".")[1])) as { sub: string; iat: number; exp: number };
    expect(payload.sub).toBe("u1");
    expect(payload.exp - payload.iat).toBe(TOKEN_TTL_S);
    expect(TOKEN_TTL_S).toBe(60 * 60 * 24 * 7);
  });

  it("token expirado → null", async () => {
    const { sign } = await import("hono/jwt");
    const passado = Math.floor(Date.now() / 1000) - 10;
    const vencido = await sign({ sub: "u1", iat: passado - 60, exp: passado }, authSecret());
    expect(await authService.verifyToken(vencido)).toBeNull();
  });

  it("token assinado com outro segredo → null", async () => {
    const { sign } = await import("hono/jwt");
    const now = Math.floor(Date.now() / 1000);
    const forjado = await sign({ sub: "u1", iat: now, exp: now + 60 }, "outro-segredo");
    expect(await authService.verifyToken(forjado)).toBeNull();
  });
});

describe("authSecret", () => {
  const original = process.env.AUTH_SECRET;
  const originalEnv = process.env.NODE_ENV;

  // NODE_ENV é readonly nos tipos do Next — escrita via índice pra poder simular produção.
  const env = process.env as Record<string, string | undefined>;

  const restore = () => {
    if (original === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = original;
    if (originalEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = originalEnv;
  };

  it("usa AUTH_SECRET quando configurado", () => {
    process.env.AUTH_SECRET = "segredo-de-verdade";
    expect(authSecret()).toBe("segredo-de-verdade");
    restore();
  });

  it("fora de produção cai no fallback inseguro", () => {
    delete process.env.AUTH_SECRET;
    env.NODE_ENV = "development";
    expect(authSecret()).toBe("dev-secret-inseguro");
    restore();
  });

  it("em produção sem AUTH_SECRET recusa (não gera token com segredo conhecido)", () => {
    delete process.env.AUTH_SECRET;
    env.NODE_ENV = "production";
    expect(() => authSecret()).toThrow("AUTH_SECRET não configurado");
    restore();
  });
});

describe("constantes do cookie", () => {
  it("nome do cookie é o que o middleware lê", () => {
    expect(AUTH_COOKIE).toBe("auth_token");
  });
});
