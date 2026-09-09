"use server";

import { acao } from "@/server/next/action";
import { AppError } from "@/server/lib/errors";
import { reseed } from "./seed";

// Restaura os dados de exemplo do próprio usuário ("Restaurar dados").
// Não toca em dados de outras contas.
export async function resetarDados() {
  return acao("dev:reset", async (user) => {
    if (process.env.NODE_ENV === "production") {
      throw new AppError("Indisponível em produção.", 403);
    }
    await reseed(user.id);
    return { ok: true as const };
  });
}
