import { Hono } from "hono";
import { zValidator } from "@/server/lib/validator";
import { requirePermission } from "@/server/auth/middleware";
import { espacoService } from "./espaco.service";
import { createEspacoSchema, updateEspacoSchema, setActiveSchema } from "./espaco.dto";

const view = requirePermission("espaco:view");
const manage = requirePermission("espaco:manage");

export const espacoRoutes = new Hono()
  .get("/despesas/espacos", view, async (c) => c.json(await espacoService.listWithActive()))
  .put("/despesas/espacos/active", manage, zValidator("json", setActiveSchema), async (c) =>
    c.json(await espacoService.setActive(c.req.valid("json").id))
  )
  .post("/despesas/espacos", manage, zValidator("json", createEspacoSchema), async (c) =>
    c.json(await espacoService.create(c.req.valid("json")), 201)
  )
  .patch("/despesas/espacos/:id", manage, zValidator("json", updateEspacoSchema), async (c) =>
    c.json(await espacoService.update(c.req.param("id"), c.req.valid("json")))
  )
  .delete("/despesas/espacos/:id", manage, async (c) =>
    c.json(await espacoService.remove(c.req.param("id")))
  )
  .post("/despesas/espacos/:id/ocultar/:ym", manage, async (c) =>
    c.json(await espacoService.ocultarNoMes(c.req.param("id"), c.req.param("ym")))
  )
  .delete("/despesas/espacos/:id/ocultar/:ym", manage, async (c) =>
    c.json(await espacoService.restaurarNoMes(c.req.param("id"), c.req.param("ym")))
  )
  .get("/despesas/espacos/:esp", view, async (c) =>
    c.json(await espacoService.getOrcamento(c.req.param("esp")))
  );
