import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";

export const caixinhaRepository = {
  list(userId: string) {
    return prisma.caixinha.findMany({ where: { userId }, orderBy: { ordem: "asc" } });
  },

  findById(userId: string, id: string) {
    return prisma.caixinha.findFirst({ where: { id, userId } });
  },

  count(userId: string) {
    return prisma.caixinha.count({ where: { userId } });
  },

  create(data: Prisma.CaixinhaUncheckedCreateInput) {
    return prisma.caixinha.create({ data });
  },

  update(id: string, data: Prisma.CaixinhaUpdateInput) {
    return prisma.caixinha.update({ where: { id }, data });
  },

  delete(id: string) {
    return prisma.caixinha.delete({ where: { id } });
  },
};
