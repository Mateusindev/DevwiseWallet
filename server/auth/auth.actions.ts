"use server";

// Auth foi o último módulo a migrar de propósito: é o que mexe no cookie e o
// que quebra o app inteiro se sair errado.
//
// O cookie é exatamente o mesmo (`AUTH_COOKIE`, httpOnly, mesmas opções), então
// uma sessão aberta pela rota Hono continua valendo aqui e vice-versa.
import { cookies } from "next/headers";
import { z } from "zod";
import { authService, AUTH_COOKIE, TOKEN_TTL_S } from "./auth.service";
import { sessaoAtual } from "@/server/next/session";
import { erroDaAction, type ActionResult } from "@/server/next/action";
import type { AuthUser } from "./auth.service";
import { tokenDeLeitura, type TokenLeitura } from "./supabase-token";

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
  sameSite: "lax",
  path: "/",
  secure: process.env.NODE_ENV === "production",
} as const;

async function abreSessao(user: AuthUser) {
  const token = await authService.signToken(user.id);
  (await cookies()).set(AUTH_COOKIE, token, { ...cookieOpts, maxAge: TOKEN_TTL_S });
  return user;
}

export async function entrar(input: unknown): Promise<ActionResult<AuthUser>> {
  try {
    const { email, senha } = loginSchema.parse(input);
    return { ok: true, data: await abreSessao(await authService.login(email, senha)) };
  } catch (err) {
    return erroDaAction(err);
  }
}

export async function cadastrar(input: unknown): Promise<ActionResult<AuthUser>> {
  try {
    const { nome, email, senha } = registerSchema.parse(input);
    return { ok: true, data: await abreSessao(await authService.register(nome, email, senha)) };
  } catch (err) {
    return erroDaAction(err);
  }
}

export async function sair(): Promise<ActionResult<{ ok: true }>> {
  (await cookies()).delete({ name: AUTH_COOKIE, path: "/" });
  return { ok: true, data: { ok: true } };
}

// null = sem sessão. O componente decide mostrar o login — nunca foi 401 pro
// front, era `me()` devolvendo null.
export async function usuarioLogado(): Promise<ActionResult<AuthUser | null>> {
  try {
    return { ok: true, data: await sessaoAtual() };
  } catch (err) {
    return erroDaAction(err);
  }
}

// Token curto de leitura direta no Supabase (ver `supabase-token.ts`). null =
// leitura direta desligada neste ambiente, sem sessão ou sem `state:view` — o
// front cai pras actions. O primeiro vem pronto no boot (RSC); esta é a
// renovação.
export async function tokenLeituraDireta(): Promise<ActionResult<TokenLeitura | null>> {
  try {
    return { ok: true, data: await tokenDeLeitura(await sessaoAtual()) };
  } catch (err) {
    return erroDaAction(err);
  }
}
