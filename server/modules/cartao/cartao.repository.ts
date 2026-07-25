import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";

export const cartaoRepository = {
  list(userId: string) {
    return prisma.cartao.findMany({ where: { userId }, orderBy: { ordem: "asc" } });
  },

  findById(id: string, userId: string) {
    return prisma.cartao.findFirst({ where: { id, userId } });
  },

  count(userId: string) {
    return prisma.cartao.count({ where: { userId } });
  },

  create(data: Prisma.CartaoUncheckedCreateInput) {
    return prisma.cartao.create({ data });
  },

  update(id: string, data: Prisma.CartaoUncheckedUpdateInput) {
    return prisma.cartao.update({ where: { id }, data });
  },

  delete(id: string) {
    return prisma.cartao.delete({ where: { id } });
  },

  // Despesas vinculadas a um cartão (cruza TODOS os espaços do dono — cartão é
  // global dentro da conta). O cartaoId chega já validado como do usuário.
  // fixas ativas (caem todo mês) + avulsas do mês informado.
  fixasAtivasDoCartao(cartaoId: string) {
    return prisma.despesaFixa.findMany({ where: { cartaoId, ativa: true } });
  },
  avulsasDoCartaoNoMes(cartaoId: string, mes: string) {
    return prisma.despesaMes.findMany({ where: { cartaoId, mes } });
  },
  // fixas parceladas em aberto (pra calcular comprometido futuro)
  fixasParceladas(cartaoId: string) {
    return prisma.despesaFixa.findMany({ where: { cartaoId, parcelado: true, ativa: true } });
  },
};
