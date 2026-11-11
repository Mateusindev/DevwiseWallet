import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";

export const categoriaRepository = {
  list(userId: string) {
    return prisma.categoria.findMany({ where: { userId }, orderBy: { ordem: "asc" } });
  },

  findById(id: string, userId: string) {
    return prisma.categoria.findFirst({ where: { id, userId } });
  },

  count(userId: string) {
    return prisma.categoria.count({ where: { userId } });
  },

  create(data: Prisma.CategoriaUncheckedCreateInput) {
    return prisma.categoria.create({ data });
  },

  createMany(data: Prisma.CategoriaUncheckedCreateInput[]) {
    return prisma.categoria.createMany({ data });
  },

  update(id: string, data: Prisma.CategoriaUncheckedUpdateInput) {
    return prisma.categoria.update({ where: { id }, data });
  },

  delete(id: string) {
    return prisma.categoria.delete({ where: { id } });
  },

  // Quantas fixas/lançamentos usam cada categoria, em TODOS os espaços do dono.
  // Dois groupBy em paralelo — uma volta de rede, não uma por categoria.
  async uso(userId: string) {
    const [fixas, lancamentos] = await Promise.all([
      prisma.despesaFixa.groupBy({
        by: ["categoriaId"],
        where: { espaco: { userId }, categoriaId: { not: null } },
        _count: { _all: true },
      }),
      prisma.despesaMes.groupBy({
        by: ["categoriaId"],
        where: { espaco: { userId }, categoriaId: { not: null } },
        _count: { _all: true },
        _max: { mes: true },
      }),
    ]);
    return { fixas, lancamentos };
  },

  // Uma transação: ou a ordem inteira muda, ou nada. `userId` no where de cada
  // update — id alheio não casa e não é tocado.
  reordenar(userId: string, ids: string[]) {
    return prisma.$transaction(
      ids.map((id, i) => prisma.categoria.updateMany({ where: { id, userId }, data: { ordem: i + 1 } }))
    );
  },

  // Move as despesas da origem pro destino e apaga a origem, numa transação.
  // O escopo `espaco: { userId }` é redundante com a posse da categoria (o
  // assertVinculos não deixa despesa alheia apontar pra ela), mas é o mesmo
  // cinto que os repositories usam em toda escrita.
  async mesclar(userId: string, origemId: string, destinoId: string) {
    const [fixas, lancamentos] = await prisma.$transaction([
      prisma.despesaFixa.updateMany({
        where: { categoriaId: origemId, espaco: { userId } },
        data: { categoriaId: destinoId },
      }),
      prisma.despesaMes.updateMany({
        where: { categoriaId: origemId, espaco: { userId } },
        data: { categoriaId: destinoId },
      }),
      prisma.categoria.deleteMany({ where: { id: origemId, userId } }),
    ]);
    return { fixas: fixas.count, lancamentos: lancamentos.count };
  },
};
