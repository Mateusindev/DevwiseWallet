import { Hono } from "hono";
import { zValidator } from "@/server/lib/validator";
import { requirePermission, type AuthEnv } from "@/server/auth/middleware";
import { espacoService } from "./espaco.service";
import { createEspacoSchema, updateEspacoSchema, setActiveSchema } from "./espaco.dto";

const view = requirePermission("espaco:view");
const manage = requirePermission("espaco:manage");

export const espacoRoutes = new Hono<AuthEnv>()
  .get("/despesas/espacos", view, async (c) => c.json(await espacoService.listWithActive(c.get("user").id)))
  .put("/despesas/espacos/active", manage, zValidator("json", setActiveSchema), async (c) =>
    c.json(await espacoService.setActive(c.get("user").id, c.req.valid("json").id))
  )
  .post("/despesas/espacos", manage, zValidator("json", createEspacoSchema), async (c) =>
    c.json(await espacoService.create(c.get("user").id, c.req.valid("json")), 201)
  )
  .patch("/despesas/espacos/:id", manage, zValidator("json", updateEspacoSchema), async (c) =>
    c.json(await espacoService.update(c.get("user").id, c.req.param("id"), c.req.valid("json")))
  )
  .delete("/despesas/espacos/:id", manage, async (c) =>
    c.json(await espacoService.remove(c.get("user").id, c.req.param("id")))
  )
  .post("/despesas/espacos/:id/ocultar/:ym", manage, async (c) =>
    c.json(await espacoService.ocultarNoMes(c.get("user").id, c.req.param("id"), c.req.param("ym")))
  )
  .delete("/despesas/espacos/:id/ocultar/:ym", manage, async (c) =>
    c.json(await espacoService.restaurarNoMes(c.get("user").id, c.req.param("id"), c.req.param("ym")))
  )
  .get("/despesas/espacos/:esp", view, async (c) =>
    c.json(await espacoService.getOrcamento(c.get("user").id, c.req.param("esp")))
  );
