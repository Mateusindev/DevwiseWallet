import { prisma } from "@/server/lib/prisma";

const withRoles = { roles: { include: { role: true } } } as const;

export const authRepository = {
  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email }, include: withRoles });
  },

  findById(id: string) {
    return prisma.user.findUnique({ where: { id }, include: withRoles });
  },

  create(data: { email: string; nome: string; senhaHash: string; roleIds: string[] }) {
    return prisma.user.create({
      data: {
        email: data.email,
        nome: data.nome,
        senhaHash: data.senhaHash,
        roles: { create: data.roleIds.map((roleId) => ({ roleId })) },
      },
      include: withRoles,
    });
  },

  findRoleByName(nome: string) {
    return prisma.role.findUnique({ where: { nome } });
  },
};

export type UserWithRoles = NonNullable<Awaited<ReturnType<typeof authRepository.findById>>>;
