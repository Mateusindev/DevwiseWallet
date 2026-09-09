// Sessão fora do Hono — o que `requireAuth` / `requirePermission` fazem, para
// Server Functions e Server Components.
//
// Lê o MESMO cookie httpOnly (`AUTH_COOKIE`) e usa o MESMO authService, então
// as duas camadas coexistem sem nada especial: uma rota Hono e uma action
// enxergam a mesma sessão. É isso que deixa a migração ser módulo a módulo.
import { cache } from "react";
import { cookies } from "next/headers";
import { AppError } from "@/server/lib/errors";
import { authService, AUTH_COOKIE, type AuthUser } from "@/server/auth/auth.service";

// `cache` do React memoiza por request: várias actions/leituras no mesmo
// request compartilham um único getSessionUser — e, por serem o MESMO objeto,
// compartilham também o cache de entitlements do authService.
export const sessaoAtual = cache(async (): Promise<AuthUser | null> => {
  const token = (await cookies()).get(AUTH_COOKIE)?.value;
  if (!token) return null;
  const userId = await authService.verifyToken(token);
  if (!userId) return null;
  return authService.getSessionUser(userId);
});

// Sessão obrigatória. 401 no shape que o front já trata (AppError → status).
export async function currentUser(): Promise<AuthUser> {
  const user = await sessaoAtual();
  if (!user) throw new AppError("Não autenticado", 401);
  return user;
}

// PBAC: exige uma permission granular. 403.
export async function requirePerm(permission: string): Promise<AuthUser> {
  const user = await currentUser();
  if (!(await authService.can(user, permission))) {
    throw new AppError(`Sem permissão: ${permission}`, 403);
  }
  return user;
}

// Basta UMA — mesma semântica do requireAnyPermission do Hono, que existe pros
// aliases históricos de permission do compartilhamento.
export async function requireAnyPerm(...permissions: string[]): Promise<AuthUser> {
  const user = await currentUser();
  for (const p of permissions) {
    if (await authService.can(user, p)) return user;
  }
  throw new AppError(`Sem permissão: ${permissions.join(" | ")}`, 403);
}
