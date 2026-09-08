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

  // ── Resumo por mês (uma query por faixa, não 24 × N) ─────────────────────
  // Fixas ativas com cartão: a janela de parcela é resolvida em memória (a
  // âncora + total é que dizem em que meses cada uma cai).
  fixasComCartaoDoUsuario(userId: string) {
    return prisma.despesaFixa.findMany({
      where: { ativa: true, cartaoId: { not: null }, espaco: { userId } },
    });
  },
  avulsasComCartaoNoIntervalo(userId: string, de: string, ate: string) {
    return prisma.despesaMes.findMany({
      where: { cartaoId: { not: null }, mes: { gte: de, lte: ate }, espaco: { userId } },
    });
  },

  // Toda parcelada ativa do dono, de QUALQUER espaço — a aba de cartões é da
  // conta, não de um espaço, então o painel de quitação tem que ver tudo (é o
  // mesmo escopo do `comprometido` de cada cartão). Inclui parcelada sem cartão
  // (carnê, boleto): também é dívida a quitar.
  parceladasDoUsuario(userId: string) {
    return prisma.despesaFixa.findMany({
      where: { parcelado: true, ativa: true, espaco: { userId } },
      include: { espaco: { select: { nome: true, emoji: true } } },
      orderBy: { descricao: "asc" },
    });
  },

  // Pagamentos das fixas do dono num mês (desconta parcela já paga no mês visto).
  pagamentosDoUsuarioNoMes(userId: string, ym: string) {
    return prisma.pagamentoFixa.findMany({ where: { ym, espaco: { userId } } });
  },
};
