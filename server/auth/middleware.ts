import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { AppError } from "@/server/lib/errors";
import { authService, AUTH_COOKIE, type AuthUser } from "./auth.service";

export type AuthEnv = { Variables: { user: AuthUser } };

// Sessão obrigatória: valida o JWT do cookie httpOnly e carrega o usuário
// (com roles/permissions) pro contexto.
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const token = getCookie(c, AUTH_COOKIE);
  if (!token) throw new AppError("Não autenticado", 401);

  const userId = await authService.verifyToken(token);
  if (!userId) throw new AppError("Sessão inválida ou expirada", 401);

  const user = await authService.getSessionUser(userId);
  if (!user) throw new AppError("Sessão inválida ou expirada", 401);

  c.set("user", user);
  await next();
});

// PBAC: exige uma permission granular. Sempre depois de requireAuth.
export const requirePermission = (permission: string) =>
  createMiddleware<AuthEnv>(async (c, next) => {
    const user = c.get("user");
    if (!(await authService.can(user, permission))) {
      throw new AppError(`Sem permissão: ${permission}`, 403);
    }
    await next();
  });
