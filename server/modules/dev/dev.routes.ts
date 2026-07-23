import { Hono } from "hono";
import { AppError } from "@/server/lib/errors";
import { requirePermission } from "@/server/auth/middleware";
import { reseed } from "./seed";

export const devRoutes = new Hono()
  // POST /dev/reset — restaura dados de exemplo (botão "Restaurar dados").
  .post("/dev/reset", requirePermission("dev:reset"), async (c) => {
    if (process.env.NODE_ENV === "production") {
      throw new AppError("Indisponível em produção.", 403);
    }
    await reseed();
    return c.json({ ok: true });
  });
