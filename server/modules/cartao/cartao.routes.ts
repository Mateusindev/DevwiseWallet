import { Hono } from "hono";
import { zValidator } from "@/server/lib/validator";
import { requirePermission, type AuthEnv } from "@/server/auth/middleware";
import { cartaoService } from "./cartao.service";
import { createCartaoSchema, updateCartaoSchema, cartaoQuerySchema, resumoQuerySchema } from "./cartao.dto";
import { currentMonth } from "@/server/lib/serialize";

// Janela default do resumo: 6 meses terminando no mês pedido.
function mesesAntes(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const cartaoRoutes = new Hono<AuthEnv>()
  .get(
    "/cartoes",
    requirePermission("cartao:view"),
    zValidator("query", cartaoQuerySchema),
    async (c) =>
      c.json(await cartaoService.listWithAggregates(c.get("user").id, c.req.valid("query").ym))
  )
  // parceladas em aberto do dono (todos os espaços) — alimenta o painel de quitação
  .get(
    "/cartoes/parceladas",
    requirePermission("cartao:view"),
    zValidator("query", cartaoQuerySchema),
    async (c) =>
      c.json(await cartaoService.parceladasEmAberto(c.get("user").id, c.req.valid("query").ym))
  )
  // resumo mês a mês (por cartão e por categoria) — alimenta os gráficos
  .get(
    "/cartoes/resumo",
    requirePermission("cartao:view"),
    zValidator("query", resumoQuerySchema),
    async (c) => {
      const { de, ate } = c.req.valid("query");
      const fim = ate ?? currentMonth();
      return c.json(await cartaoService.resumoPorMes(c.get("user").id, de ?? mesesAntes(fim, 5), fim));
    }
  )
  .get(
    "/cartoes/:id/fatura",
    requirePermission("cartao:view"),
    zValidator("query", cartaoQuerySchema),
    async (c) =>
      c.json(
        await cartaoService.faturaLinhas(c.get("user").id, c.req.param("id"), c.req.valid("query").ym)
      )
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
    async (c) =>
      c.json(await cartaoService.update(c.get("user").id, c.req.param("id"), c.req.valid("json")))
  )
  .delete("/cartoes/:id", requirePermission("cartao:manage"), async (c) =>
    c.json(await cartaoService.remove(c.get("user").id, c.req.param("id")))
  );
