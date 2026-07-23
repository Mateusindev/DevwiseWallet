import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";

export const cartaoRepository = {
  list() {
    return prisma.cartao.findMany({ orderBy: { ordem: "asc" } });
  },

  findById(id: string) {
    return prisma.cartao.findUnique({ where: { id } });
  },

  count() {
    return prisma.cartao.count();
  },

  create(data: Prisma.CartaoCreateInput) {
    return prisma.cartao.create({ data });
  },

  update(id: string, data: Prisma.CartaoUpdateInput) {
    return prisma.cartao.update({ where: { id }, data });
  },

  delete(id: string) {
    return prisma.cartao.delete({ where: { id } });
  },

  // Despesas vinculadas a um cartão (cruza TODOS os espaços — cartão é global).
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
