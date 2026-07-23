import { z } from "zod";
import { isAssignablePermission } from "@/server/auth/permissions";

const permissionList = z
  .array(z.string())
  .refine((ps) => ps.every(isAssignablePermission), {
    message: "permission desconhecida (use o catálogo ou wildcard tipo 'caixinha:*')",
  });

export const createUserSchema = z.object({
  email: z.email(),
  nome: z.string().trim().min(1),
  senha: z.string().min(6),
  roleIds: z.array(z.uuid()).default([]),
});

export const updateUserSchema = z.object({
  email: z.email().optional(),
  nome: z.string().trim().min(1).optional(),
  senha: z.string().min(6).optional(),
  ativo: z.boolean().optional(),
  roleIds: z.array(z.uuid()).optional(),
});

export const createRoleSchema = z.object({
  nome: z.string().trim().min(1),
  descricao: z.string().trim().nullable().optional(),
  permissions: permissionList.default([]),
});

export const updateRoleSchema = z.object({
  nome: z.string().trim().min(1).optional(),
  descricao: z.string().trim().nullable().optional(),
  permissions: permissionList.optional(),
});

export type CreateUserDTO = z.infer<typeof createUserSchema>;
export type UpdateUserDTO = z.infer<typeof updateUserSchema>;
export type CreateRoleDTO = z.infer<typeof createRoleSchema>;
export type UpdateRoleDTO = z.infer<typeof updateRoleSchema>;
