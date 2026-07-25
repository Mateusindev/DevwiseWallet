import { Hono } from "hono";
import { zValidator } from "@/server/lib/validator";
import { requirePermission, type AuthEnv } from "@/server/auth/middleware";
import { movimentacaoService } from "./movimentacao.service";
import { createMovimentacaoSchema } from "./movimentacao.dto";

export const movimentacaoRoutes = new Hono<AuthEnv>()
  .get("/movimentacoes", requirePermission("movimentacao:view"), async (c) =>
    c.json(await movimentacaoService.list(c.get("user").id))
  )
  .post(
    "/movimentacoes",
    requirePermission("movimentacao:manage"),
    zValidator("json", createMovimentacaoSchema),
    async (c) => c.json(await movimentacaoService.create(c.get("user").id, c.req.valid("json")), 201)
  )
  .delete("/movimentacoes/:id", requirePermission("movimentacao:manage"), async (c) =>
    c.json(await movimentacaoService.remove(c.get("user").id, c.req.param("id")))
  );
