import { Hono } from "hono";
import { zValidator } from "@/server/lib/validator";
import { requirePermission, type AuthEnv } from "@/server/auth/middleware";
import { cartaoService } from "./cartao.service";
import { createCartaoSchema, updateCartaoSchema, cartaoQuerySchema } from "./cartao.dto";

export const cartaoRoutes = new Hono<AuthEnv>()
  .get(
    "/cartoes",
    requirePermission("cartao:view"),
    zValidator("query", cartaoQuerySchema),
    async (c) => c.json(await cartaoService.listWithAggregates(c.get("user").id, c.req.valid("query").ym))
  )
  .get(
    "/cartoes/:id/fatura",
    requirePermission("cartao:view"),
    zValidator("query", cartaoQuerySchema),
    async (c) => c.json(await cartaoService.faturaLinhas(c.get("user").id, c.req.param("id"), c.req.valid("query").ym))
  )
  .post(
    "/cartoes",
    requirePermission("cartao:manage"),
    zValidator("json", createCartaoSchema),
    async (c) => c.json(await cartaoService.create(c.get("user").id, c.req.valid("json")), 201)
  )
  .patch(
    "/cartoes/:id",
    requirePermission("cartao:manage"),
    zValidator("json", updateCartaoSchema),
    async (c) => c.json(await cartaoService.update(c.get("user").id, c.req.param("id"), c.req.valid("json")))
  )
  .delete("/cartoes/:id", requirePermission("cartao:manage"), async (c) =>
    c.json(await cartaoService.remove(c.get("user").id, c.req.param("id")))
  );
