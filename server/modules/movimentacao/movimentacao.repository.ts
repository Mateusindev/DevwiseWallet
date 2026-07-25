import { Prisma, type TipoMovimentacao } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";

export const movimentacaoRepository = {
  // Movimentação não tem userId próprio — escopa pelo dono da caixinha.
  list(userId: string) {
    return prisma.movimentacao.findMany({ where: { caixinha: { userId } }, orderBy: { data: "desc" } });
  },

  findById(userId: string, id: string) {
    return prisma.movimentacao.findFirst({ where: { id, caixinha: { userId } } });
  },

  // Cria a movimentação e ajusta o saldo da caixinha atomicamente.
  createAndApply(input: {
    caixinhaId: string;
    tipo: TipoMovimentacao;
    valor: number;
    descricao: string;
    data: Date;
    delta: number; // quanto somar no saldo (+aporte / -despesa)
  }) {
    return prisma.$transaction(async (tx) => {
      const movimentacao = await tx.movimentacao.create({
        data: {
          caixinhaId: input.caixinhaId,
          tipo: input.tipo,
          valor: input.valor,
          descricao: input.descricao,
          data: input.data,
        },
      });
      const caixinha = await tx.caixinha.update({
        where: { id: input.caixinhaId },
        data: { saldo: { increment: new Prisma.Decimal(input.delta) } },
      });
      return { movimentacao, caixinha };
    });
  },

  // Remove e reverte o saldo atomicamente.
  removeAndRevert(id: string, caixinhaId: string, delta: number) {
    return prisma.$transaction(async (tx) => {
      await tx.movimentacao.delete({ where: { id } });
      const caixinha = await tx.caixinha.update({
        where: { id: caixinhaId },
        data: { saldo: { increment: new Prisma.Decimal(delta) } },
      });
      return caixinha;
    });
  },
};
