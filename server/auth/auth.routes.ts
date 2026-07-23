import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { zValidator } from "@/server/lib/validator";
import { authService, AUTH_COOKIE, TOKEN_TTL_S } from "./auth.service";
import { requireAuth, type AuthEnv } from "./middleware";

const loginSchema = z.object({
  email: z.email(),
  senha: z.string().min(1),
});

const registerSchema = z.object({
  nome: z.string().trim().min(1),
  email: z.email(),
  senha: z.string().min(6),
});

const cookieOpts = {
  httpOnly: true,
  sameSite: "Lax",
  path: "/",
  secure: process.env.NODE_ENV === "production",
} as const;

export const authRoutes = new Hono<AuthEnv>()
  .post("/auth/login", zValidator("json", loginSchema), async (c) => {
    const { email, senha } = c.req.valid("json");
    const user = await authService.login(email, senha);
    const token = await authService.signToken(user.id);
    setCookie(c, AUTH_COOKIE, token, { ...cookieOpts, maxAge: TOKEN_TTL_S });
    return c.json(user);
  })
  .post("/auth/register", zValidator("json", registerSchema), async (c) => {
    const { nome, email, senha } = c.req.valid("json");
    const user = await authService.register(nome, email, senha);
    const token = await authService.signToken(user.id);
    setCookie(c, AUTH_COOKIE, token, { ...cookieOpts, maxAge: TOKEN_TTL_S });
    return c.json(user, 201);
  })
  .post("/auth/logout", async (c) => {
    deleteCookie(c, AUTH_COOKIE, { path: "/" });
    return c.json({ ok: true });
  })
  .get("/auth/me", requireAuth, async (c) => c.json(c.get("user")));
