import { Hono } from "hono";
import { zValidator } from "@/server/lib/validator";
import { requirePermission, type AuthEnv } from "@/server/auth/middleware";
import { caixinhaService } from "./caixinha.service";
import { createCaixinhaSchema, updateCaixinhaSchema } from "./caixinha.dto";

export const caixinhaRoutes = new Hono<AuthEnv>()
  .get("/caixinhas", requirePermission("caixinha:view"), async (c) =>
    c.json(await caixinhaService.list(c.get("user").id))
  )
  .post(
    "/caixinhas",
    requirePermission("caixinha:manage"),
    zValidator("json", createCaixinhaSchema),
    async (c) => c.json(await caixinhaService.create(c.get("user").id, c.req.valid("json")), 201)
  )
  .patch(
    "/caixinhas/:id",
    requirePermission("caixinha:manage"),
    zValidator("json", updateCaixinhaSchema),
    async (c) =>
      c.json(await caixinhaService.update(c.get("user").id, c.req.param("id"), c.req.valid("json")))
  )
  .delete("/caixinhas/:id", requirePermission("caixinha:manage"), async (c) =>
    c.json(await caixinhaService.remove(c.get("user").id, c.req.param("id")))
  );
