import { Hono } from "hono";
import { zValidator } from "@/server/lib/validator";
import { requirePermission, type AuthEnv } from "@/server/auth/middleware";
import { categoriaService } from "./categoria.service";
import { createCategoriaSchema, updateCategoriaSchema } from "./categoria.dto";

export const categoriaRoutes = new Hono<AuthEnv>()
  .get("/categorias", requirePermission("categoria:view"), async (c) =>
    c.json(await categoriaService.list(c.get("user").id))
  )
  .post(
    "/categorias",
    requirePermission("categoria:manage"),
    zValidator("json", createCategoriaSchema),
    async (c) => c.json(await categoriaService.create(c.get("user").id, c.req.valid("json")), 201)
  )
  .patch(
    "/categorias/:id",
    requirePermission("categoria:manage"),
    zValidator("json", updateCategoriaSchema),
    async (c) => c.json(await categoriaService.update(c.get("user").id, c.req.param("id"), c.req.valid("json")))
  )
  .delete("/categorias/:id", requirePermission("categoria:manage"), async (c) =>
    c.json(await categoriaService.remove(c.get("user").id, c.req.param("id")))
  );
