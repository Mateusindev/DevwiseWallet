import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";

export const categoriaRepository = {
  list() {
    return prisma.categoria.findMany({ orderBy: { ordem: "asc" } });
  },

  findById(id: string) {
    return prisma.categoria.findUnique({ where: { id } });
  },

  count() {
    return prisma.categoria.count();
  },

  create(data: Prisma.CategoriaCreateInput) {
    return prisma.categoria.create({ data });
  },

  update(id: string, data: Prisma.CategoriaUpdateInput) {
    return prisma.categoria.update({ where: { id }, data });
  },

  delete(id: string) {
    return prisma.categoria.delete({ where: { id } });
  },
};
