import { describe, expect, it, beforeEach, mock } from "bun:test";
import { Hono } from "hono";
import { AppError } from "@/server/lib/errors";
import type { AuthUser } from "./auth.service";

const state: {
  userId: string | null; // o que verifyToken devolve
  user: AuthUser | null; // o que getSessionUser devolve
  permitidas: string[]; // o que authService.can aprova
} = { userId: null, user: null, permitidas: [] };

const membro: AuthUser = {
  id: "u1",
  email: "joao@wallet.local",
  nome: "João",
  roles: ["membro"],
  permissions: ["caixinha:manage"],
};

mock.module("@/server/auth/auth.service", () => ({
  AUTH_COOKIE: "auth_token",
  authService: {
    verifyToken: async (token: string) => (token === "token-bom" ? state.userId : null),
    getSessionUser: async () => state.user,
    can: async (_u: AuthUser, permission: string) => state.permitidas.includes(permission),
  },
}));

const { requireAuth, requirePermission } = await import("./middleware");

// App mínimo com o mesmo onError do route.ts (AppError → statusCode).
const app = new Hono<{ Variables: { user: AuthUser } }>()
  .onError((err, c) =>
    err instanceof AppError ? c.json({ error: err.message }, err.statusCode as 400) : c.json({ error: "boom" }, 500)
  )
  .use(requireAuth)
  .get("/livre", (c) => c.json({ user: c.get("user") }))
  .get("/protegida", requirePermission("caixinha:manage"), (c) => c.json({ ok: true }));

const req = (path: string, cookie?: string) =>
  app.request(path, cookie ? { headers: { cookie } } : undefined);

beforeEach(() => {
  state.userId = "u1";
  state.user = membro;
  state.permitidas = ["caixinha:manage"];
});

describe("requireAuth", () => {
  it("sem cookie → 401", async () => {
    const res = await req("/livre");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Não autenticado" });
  });

  it("token inválido → 401 'sessão inválida'", async () => {
    const res = await req("/livre", "auth_token=token-ruim");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sessão inválida ou expirada" });
  });

  it("token válido mas usuário sumiu/desativou → 401", async () => {
    state.user = null;
    const res = await req("/livre", "auth_token=token-bom");
    expect(res.status).toBe(401);
  });

  it("sucesso popula c.get('user') com roles e permissions", async () => {
    const res = await req("/livre", "auth_token=token-bom");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: membro });
  });

  it("cookie de outro nome é ignorado", async () => {
    expect((await req("/livre", "outro_token=token-bom")).status).toBe(401);
  });
});

describe("requirePermission", () => {
  it("libera quando authService.can aprova", async () => {
    const res = await req("/protegida", "auth_token=token-bom");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("nega com 403 e diz qual permission faltou", async () => {
    state.permitidas = [];
    const res = await req("/protegida", "auth_token=token-bom");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Sem permissão: caixinha:manage" });
  });

  it("sem sessão o 401 vem antes do 403 (requireAuth roda primeiro)", async () => {
    state.permitidas = [];
    expect((await req("/protegida")).status).toBe(401);
  });
});
