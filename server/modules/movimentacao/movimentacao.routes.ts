import { Hono } from "hono";
import { zValidator } from "@/server/lib/validator";
import { requirePermission } from "@/server/auth/middleware";
import { movimentacaoService } from "./movimentacao.service";
import { createMovimentacaoSchema } from "./movimentacao.dto";

export const movimentacaoRoutes = new Hono()
  .get("/movimentacoes", requirePermission("movimentacao:view"), async (c) =>
    c.json(await movimentacaoService.list())
  )
  .post(
    "/movimentacoes",
    requirePermission("movimentacao:manage"),
    zValidator("json", createMovimentacaoSchema),
    async (c) => c.json(await movimentacaoService.create(c.req.valid("json")), 201)
  )
  .delete("/movimentacoes/:id", requirePermission("movimentacao:manage"), async (c) =>
    c.json(await movimentacaoService.remove(c.req.param("id")))
  );
