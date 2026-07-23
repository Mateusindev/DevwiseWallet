import { Hono } from "hono";
import { zValidator } from "@/server/lib/validator";
import { requirePermission, type AuthEnv } from "@/server/auth/middleware";
import { PERMISSIONS } from "@/server/auth/permissions";
import { adminService } from "./admin.service";
import { createUserSchema, updateUserSchema, createRoleSchema, updateRoleSchema } from "./admin.dto";

export const adminRoutes = new Hono<AuthEnv>()
  // ── Users ──────────────────────────────────────────────────────────────────
  .get("/admin/users", requirePermission("user:view"), async (c) =>
    c.json(await adminService.listUsers())
  )
  .post(
    "/admin/users",
    requirePermission("user:manage"),
    zValidator("json", createUserSchema),
    async (c) => c.json(await adminService.createUser(c.req.valid("json")), 201)
  )
  .patch(
    "/admin/users/:id",
    requirePermission("user:manage"),
    zValidator("json", updateUserSchema),
    async (c) =>
      c.json(await adminService.updateUser(c.req.param("id"), c.req.valid("json"), c.get("user").id))
  )
  .delete("/admin/users/:id", requirePermission("user:manage"), async (c) =>
    c.json(await adminService.deleteUser(c.req.param("id"), c.get("user").id))
  )

  // ── Roles ──────────────────────────────────────────────────────────────────
  .get("/admin/roles", requirePermission("role:view"), async (c) =>
    c.json(await adminService.listRoles())
  )
  .post(
    "/admin/roles",
    requirePermission("role:manage"),
    zValidator("json", createRoleSchema),
    async (c) => c.json(await adminService.createRole(c.req.valid("json")), 201)
  )
  .patch(
    "/admin/roles/:id",
    requirePermission("role:manage"),
    zValidator("json", updateRoleSchema),
    async (c) => c.json(await adminService.updateRole(c.req.param("id"), c.req.valid("json")))
  )
  .delete("/admin/roles/:id", requirePermission("role:manage"), async (c) =>
    c.json(await adminService.deleteRole(c.req.param("id")))
  )

  // catálogo de permissions (pro editor de roles do front)
  .get("/admin/permissions", requirePermission("role:view"), async (c) =>
    c.json({ permissions: PERMISSIONS })
  );
