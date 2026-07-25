import { Hono } from "hono";
import { zValidator } from "@/server/lib/validator";
import { requirePermission, type AuthEnv } from "@/server/auth/middleware";
import { cartaoShareService } from "./cartao-share.service";
import {
  createContatoSchema,
  updateContatoSchema,
  createShareSchema,
  updateShareSchema,
  shareQuerySchema,
} from "./cartao-share.dto";

export const cartaoShareRoutes = new Hono<AuthEnv>()
  // ── Contatos (agenda do dono logado) ────────────────────────────────────────
  .get("/contatos", requirePermission("cartao:share"), async (c) =>
    c.json(await cartaoShareService.listContatos(c.get("user").id))
  )
  .post(
    "/contatos",
    requirePermission("cartao:share"),
    zValidator("json", createContatoSchema),
    async (c) =>
      c.json(await cartaoShareService.createContato(c.get("user").id, c.req.valid("json")), 201)
  )
  .patch(
    "/contatos/:id",
    requirePermission("cartao:share"),
    zValidator("json", updateContatoSchema),
    async (c) =>
      c.json(
        await cartaoShareService.updateContato(
          c.get("user").id,
          c.req.param("id"),
          c.req.valid("json")
        )
      )
  )
  .delete("/contatos/:id", requirePermission("cartao:share"), async (c) =>
    c.json(await cartaoShareService.removeContato(c.get("user").id, c.req.param("id")))
  )
  // ── Shares de um cartão (dono) ────────────────────────────────────────────────
  .get(
    "/cartoes/:id/shares",
    requirePermission("cartao:share"),
    zValidator("query", shareQuerySchema),
    async (c) =>
      c.json(
        await cartaoShareService.listByCartao(
          c.get("user").id,
          c.req.param("id"),
          c.req.valid("query").ym
        )
      )
  )
  .post(
    "/cartoes/:id/shares",
    requirePermission("cartao:share"),
    zValidator("json", createShareSchema),
    async (c) =>
      c.json(
        await cartaoShareService.createShare(c.get("user").id, c.req.param("id"), c.req.valid("json")),
        201
      )
  )
  .patch(
    "/shares/:id",
    requirePermission("cartao:share"),
    zValidator("json", updateShareSchema),
    async (c) =>
      c.json(
        await cartaoShareService.updateShare(c.get("user").id, c.req.param("id"), c.req.valid("json"))
      )
  )
  .delete("/shares/:id", requirePermission("cartao:share"), async (c) =>
    c.json(await cartaoShareService.removeShare(c.get("user").id, c.req.param("id")))
  )
  // ── Visão da pessoa compartilhada ("o que devo") ─────────────────────────────
  .get(
    "/me/compartilhamentos",
    requirePermission("cartao:view_shared"),
    zValidator("query", shareQuerySchema),
    async (c) =>
      c.json(await cartaoShareService.meusCompartilhamentos(c.get("user"), c.req.valid("query").ym))
  );
