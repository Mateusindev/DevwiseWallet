import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";

export const categoriaRepository = {
  list(userId: string) {
    return prisma.categoria.findMany({ where: { userId }, orderBy: { ordem: "asc" } });
  },

  findById(userId: string, id: string) {
    return prisma.categoria.findFirst({ where: { id, userId } });
  },

  count(userId: string) {
    return prisma.categoria.count({ where: { userId } });
  },

  create(data: Prisma.CategoriaUncheckedCreateInput) {
    return prisma.categoria.create({ data });
  },

  update(id: string, data: Prisma.CategoriaUpdateInput) {
    return prisma.categoria.update({ where: { id }, data });
  },

  delete(id: string) {
    return prisma.categoria.delete({ where: { id } });
  },
};
