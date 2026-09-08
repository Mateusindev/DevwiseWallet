import { Hono } from "hono";
import { zValidator } from "@/server/lib/validator";
import { requirePermission, type AuthEnv } from "@/server/auth/middleware";
import { orcamentoService } from "./orcamento.service";
import {
  bulkFixaSchema,
  bulkMesSchema,
  addDespesaFixaSchema,
  updateDespesaFixaSchema,
  addDespesaMesSchema,
  updateDespesaMesSchema,
  addReceitaMesSchema,
  updateReceitaMesSchema,
  setRendaSchema,
  setPagamentoSchema,
  ymParamSchema,
} from "./orcamento.dto";

const base = "/despesas/espacos/:esp";
const manage = requirePermission("orcamento:manage");

export const orcamentoRoutes = new Hono<AuthEnv>()
  // ── Fixas ─────────────────────────────────────────────────────────────────
  .post(`${base}/fixas`, manage, zValidator("json", addDespesaFixaSchema), async (c) =>
    c.json(
      await orcamentoService.addDespesaFixa(c.get("user").id, c.req.param("esp"), c.req.valid("json")),
      201
    )
  )
  .patch(`${base}/fixas/:id/toggle`, manage, async (c) =>
    c.json(
      await orcamentoService.toggleDespesaFixa(c.get("user").id, c.req.param("esp"), c.req.param("id"))
    )
  )
  .put(`${base}/fixas/:id/pago/:ym`, manage, zValidator("json", setPagamentoSchema), async (c) => {
    const { ym } = ymParamSchema.parse({ ym: c.req.param("ym") });
    return c.json(
      await orcamentoService.setPagamentoFixa(
        c.get("user").id,
        c.req.param("esp"),
        c.req.param("id"),
        ym,
        c.req.valid("json").valorPago
      )
    );
  })
  .patch(`${base}/fixas/:id`, manage, zValidator("json", updateDespesaFixaSchema), async (c) =>
    c.json(
      await orcamentoService.updateDespesaFixa(
        c.get("user").id,
        c.req.param("esp"),
        c.req.param("id"),
        c.req.valid("json")
      )
    )
  )
  .delete(`${base}/fixas/:id`, manage, async (c) =>
    c.json(
      await orcamentoService.removeDespesaFixa(c.get("user").id, c.req.param("esp"), c.req.param("id"))
    )
  )
  // lote: precisa vir antes de nada? não — a rota é literal, mas tem que estar
  // DENTRO da cadeia, senão não existe pro client RPC.
  .post(`${base}/fixas/bulk`, manage, zValidator("json", bulkFixaSchema), async (c) =>
    c.json(await orcamentoService.bulkFixa(c.get("user").id, c.req.param("esp"), c.req.valid("json")))
  )

  // ── Renda do mês ─────────────────────────────────────────────────────────
  .put(`${base}/rendas/:ym`, manage, zValidator("json", setRendaSchema), async (c) => {
    const { ym } = ymParamSchema.parse({ ym: c.req.param("ym") });
    return c.json(
      await orcamentoService.setRenda(
        c.get("user").id,
        c.req.param("esp"),
        ym,
        c.req.valid("json").valor
      )
    );
  })
  .delete(`${base}/rendas/:ym`, manage, async (c) => {
    const { ym } = ymParamSchema.parse({ ym: c.req.param("ym") });
    return c.json(await orcamentoService.clearRenda(c.get("user").id, c.req.param("esp"), ym));
  })

  // ── Despesas do mês ──────────────────────────────────────────────────────
  .post(`${base}/mes`, manage, zValidator("json", addDespesaMesSchema), async (c) =>
    c.json(
      await orcamentoService.addDespesaMes(c.get("user").id, c.req.param("esp"), c.req.valid("json")),
      201
    )
  )
  .put(`${base}/mes/:id/pago`, manage, zValidator("json", setPagamentoSchema), async (c) =>
    c.json(
      await orcamentoService.setPagaMes(
        c.get("user").id,
        c.req.param("esp"),
        c.req.param("id"),
        c.req.valid("json").valorPago
      )
    )
  )
  .patch(`${base}/mes/:id`, manage, zValidator("json", updateDespesaMesSchema), async (c) =>
    c.json(
      await orcamentoService.updateDespesaMes(
        c.get("user").id,
        c.req.param("esp"),
        c.req.param("id"),
        c.req.valid("json")
      )
    )
  )
  .delete(`${base}/mes/:id`, manage, async (c) =>
    c.json(
      await orcamentoService.removeDespesaMes(c.get("user").id, c.req.param("esp"), c.req.param("id"))
    )
  )
  .post(`${base}/mes/bulk`, manage, zValidator("json", bulkMesSchema), async (c) =>
    c.json(await orcamentoService.bulkMes(c.get("user").id, c.req.param("esp"), c.req.valid("json")))
  )

  // ── Receitas do mês ──────────────────────────────────────────────────────
  .post(`${base}/receitas`, manage, zValidator("json", addReceitaMesSchema), async (c) =>
    c.json(
      await orcamentoService.addReceitaMes(c.get("user").id, c.req.param("esp"), c.req.valid("json")),
      201
    )
  )
  .patch(`${base}/receitas/:id`, manage, zValidator("json", updateReceitaMesSchema), async (c) =>
    c.json(
      await orcamentoService.updateReceitaMes(
        c.get("user").id,
        c.req.param("esp"),
        c.req.param("id"),
        c.req.valid("json")
      )
    )
  )
  .delete(`${base}/receitas/:id`, manage, async (c) =>
    c.json(
      await orcamentoService.removeReceitaMes(c.get("user").id, c.req.param("esp"), c.req.param("id"))
    )
  );
