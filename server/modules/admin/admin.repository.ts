import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";

const userInclude = { roles: { include: { role: true } } } satisfies Prisma.UserInclude;

export type AdminUser = Prisma.UserGetPayload<{ include: typeof userInclude }>;

export const adminRepository = {
  // ── Users ──────────────────────────────────────────────────────────────────
  listUsers() {
    return prisma.user.findMany({ include: userInclude, orderBy: { createdAt: "asc" } });
  },

  findUser(id: string) {
    return prisma.user.findUnique({ where: { id }, include: userInclude });
  },

  findUserByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },

  createUser(data: { email: string; nome: string; senhaHash: string; roleIds: string[] }) {
    return prisma.user.create({
      data: {
        email: data.email,
        nome: data.nome,
        senhaHash: data.senhaHash,
        roles: { create: data.roleIds.map((roleId) => ({ roleId })) },
      },
      include: userInclude,
    });
  },

  // roleIds undefined = não mexe nas roles; array = substitui o conjunto.
  updateUser(
    id: string,
    data: { email?: string; nome?: string; senhaHash?: string; ativo?: boolean },
    roleIds?: string[]
  ) {
    return prisma.user.update({
      where: { id },
      data: {
        ...data,
        ...(roleIds !== undefined && {
          roles: { deleteMany: {}, create: roleIds.map((roleId) => ({ roleId })) },
        }),
      },
      include: userInclude,
    });
  },

  deleteUser(id: string) {
    return prisma.user.delete({ where: { id } });
  },

  // ── Roles ──────────────────────────────────────────────────────────────────
  listRoles() {
    return prisma.role.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { users: true } } },
    });
  },

  findRole(id: string) {
    return prisma.role.findUnique({ where: { id } });
  },

  findRoleByName(nome: string) {
    return prisma.role.findUnique({ where: { nome } });
  },

  countRolesByIds(ids: string[]) {
    return prisma.role.count({ where: { id: { in: ids } } });
  },

  createRole(data: Prisma.RoleCreateInput) {
    return prisma.role.create({ data, include: { _count: { select: { users: true } } } });
  },

  updateRole(id: string, data: Prisma.RoleUpdateInput) {
    return prisma.role.update({
      where: { id },
      data,
      include: { _count: { select: { users: true } } },
    });
  },

  deleteRole(id: string) {
    return prisma.role.delete({ where: { id } });
  },
};
