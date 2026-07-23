import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";

export const caixinhaRepository = {
  list() {
    return prisma.caixinha.findMany({ orderBy: { ordem: "asc" } });
  },

  findById(id: string) {
    return prisma.caixinha.findUnique({ where: { id } });
  },

  count() {
    return prisma.caixinha.count();
  },

  create(data: Prisma.CaixinhaCreateInput) {
    return prisma.caixinha.create({ data });
  },

  update(id: string, data: Prisma.CaixinhaUpdateInput) {
    return prisma.caixinha.update({ where: { id }, data });
  },

  delete(id: string) {
    return prisma.caixinha.delete({ where: { id } });
  },
};
