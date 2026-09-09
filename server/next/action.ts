// Contrato de erro das Server Functions.
//
// Uma action não tem status HTTP, mas o front depende do que o `onError` do
// Hono produzia: `services/financeApi.ts` lança `ApiError` com `status` e, no
// 422, os `issues` do zod — que é o que `components/ui/useFormState.js` usa pra
// marcar o campo culpado. Se isso quebrar, todo form perde validação por campo.
//
// Então toda action devolve um resultado discriminado e o financeApi
// reconstrói o ApiError a partir dele. Nenhum componente muda.
import { ZodError, type ZodType } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "@/server/lib/errors";
import { requireAnyPerm } from "./session";
import type { AuthUser } from "@/server/auth/auth.service";

export type ActionOk<T> = { ok: true; data: T };
export type ActionErr = { ok: false; status: number; error: string; issues?: unknown[] };
export type ActionResult<T> = ActionOk<T> | ActionErr;

// Mesmo mapeamento do onError central (server/app.ts).
export function erroDaAction(err: unknown): ActionErr {
  if (err instanceof ZodError) {
    return { ok: false, status: 422, error: "Validação falhou", issues: err.issues };
  }
  if (err instanceof AppError) {
    return { ok: false, status: err.statusCode, error: err.message };
  }
  // registro não encontrado no Prisma (delete/update de id inexistente)
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    return { ok: false, status: 404, error: "Registro não encontrado" };
  }
  console.error(err);
  return { ok: false, status: 500, error: "Erro interno" };
}

// Action sem payload: autentica, autoriza e mapeia o erro.
// `permissions` aceita várias — basta uma, como o requireAnyPermission do Hono.
export async function acao<T>(
  permissions: string | string[],
  fn: (user: AuthUser) => Promise<T>
): Promise<ActionResult<T>> {
  try {
    const user = await requireAnyPerm(...(Array.isArray(permissions) ? permissions : [permissions]));
    return { ok: true, data: await fn(user) };
  } catch (err) {
    return erroDaAction(err);
  }
}

// Action com payload: o DTO zod roda AQUI, antes do service — assim uma action
// nova não tem como esquecer nem a permission nem a validação. O ZodError vira
// 422 com issues, igual ao zValidator + onError.
export async function acaoValidada<S extends ZodType, T>(
  permissions: string | string[],
  schema: S,
  input: unknown,
  fn: (user: AuthUser, dto: S["_output"]) => Promise<T>
): Promise<ActionResult<T>> {
  return acao(permissions, (user) => fn(user, schema.parse(input) as S["_output"]));
}
