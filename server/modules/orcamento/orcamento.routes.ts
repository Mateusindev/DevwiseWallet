import { Hono } from "hono";
import { zValidator } from "@/server/lib/validator";
import { requirePermission } from "@/server/auth/middleware";
import { orcamentoService } from "./orcamento.service";
import {
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

export const orcamentoRoutes = new Hono()
  // ── Fixas ─────────────────────────────────────────────────────────────────
  .post(`${base}/fixas`, manage, zValidator("json", addDespesaFixaSchema), async (c) =>
    c.json(await orcamentoService.addDespesaFixa(c.req.param("esp"), c.req.valid("json")), 201)
  )
  .patch(`${base}/fixas/:id/toggle`, manage, async (c) =>
    c.json(await orcamentoService.toggleDespesaFixa(c.req.param("esp"), c.req.param("id")))
  )
  .put(`${base}/fixas/:id/pago/:ym`, manage, zValidator("json", setPagamentoSchema), async (c) => {
    const { ym } = ymParamSchema.parse({ ym: c.req.param("ym") });
    return c.json(
      await orcamentoService.setPagamentoFixa(
        c.req.param("esp"),
        c.req.param("id"),
        ym,
        c.req.valid("json").valorPago
      )
    );
  })
  .patch(`${base}/fixas/:id`, manage, zValidator("json", updateDespesaFixaSchema), async (c) =>
    c.json(await orcamentoService.updateDespesaFixa(c.req.param("esp"), c.req.param("id"), c.req.valid("json")))
  )
  .delete(`${base}/fixas/:id`, manage, async (c) =>
    c.json(await orcamentoService.removeDespesaFixa(c.req.param("esp"), c.req.param("id")))
  )

  // ── Renda do mês ─────────────────────────────────────────────────────────
  .put(`${base}/rendas/:ym`, manage, zValidator("json", setRendaSchema), async (c) => {
    const { ym } = ymParamSchema.parse({ ym: c.req.param("ym") });
    return c.json(await orcamentoService.setRenda(c.req.param("esp"), ym, c.req.valid("json").valor));
  })
  .delete(`${base}/rendas/:ym`, manage, async (c) => {
    const { ym } = ymParamSchema.parse({ ym: c.req.param("ym") });
    return c.json(await orcamentoService.clearRenda(c.req.param("esp"), ym));
  })

  // ── Despesas do mês ──────────────────────────────────────────────────────
  .post(`${base}/mes`, manage, zValidator("json", addDespesaMesSchema), async (c) =>
    c.json(await orcamentoService.addDespesaMes(c.req.param("esp"), c.req.valid("json")), 201)
  )
  .put(`${base}/mes/:id/pago`, manage, zValidator("json", setPagamentoSchema), async (c) =>
    c.json(await orcamentoService.setPagaMes(c.req.param("esp"), c.req.param("id"), c.req.valid("json").valorPago))
  )
  .patch(`${base}/mes/:id`, manage, zValidator("json", updateDespesaMesSchema), async (c) =>
    c.json(await orcamentoService.updateDespesaMes(c.req.param("esp"), c.req.param("id"), c.req.valid("json")))
  )
  .delete(`${base}/mes/:id`, manage, async (c) =>
    c.json(await orcamentoService.removeDespesaMes(c.req.param("esp"), c.req.param("id")))
  )

  // ── Receitas do mês ──────────────────────────────────────────────────────
  .post(`${base}/receitas`, manage, zValidator("json", addReceitaMesSchema), async (c) =>
    c.json(await orcamentoService.addReceitaMes(c.req.param("esp"), c.req.valid("json")), 201)
  )
  .patch(`${base}/receitas/:id`, manage, zValidator("json", updateReceitaMesSchema), async (c) =>
    c.json(await orcamentoService.updateReceitaMes(c.req.param("esp"), c.req.param("id"), c.req.valid("json")))
  )
  .delete(`${base}/receitas/:id`, manage, async (c) =>
    c.json(await orcamentoService.removeReceitaMes(c.req.param("esp"), c.req.param("id")))
  );
