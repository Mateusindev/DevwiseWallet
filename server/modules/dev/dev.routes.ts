import { Hono } from "hono";
import { AppError } from "@/server/lib/errors";
import { requirePermission, type AuthEnv } from "@/server/auth/middleware";
import { reseed } from "./seed";

export const devRoutes = new Hono<AuthEnv>()
  // POST /dev/reset — restaura os dados de exemplo do próprio usuário
  // (botão "Restaurar dados"). Não toca em dados de outras contas.
  .post("/dev/reset", requirePermission("dev:reset"), async (c) => {
    if (process.env.NODE_ENV === "production") {
      throw new AppError("Indisponível em produção.", 403);
    }
    await reseed(c.get("user").id);
    return c.json({ ok: true });
  });
