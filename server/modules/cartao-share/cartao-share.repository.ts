import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";

const withLinha = { include: { despesaFixa: true, despesaMes: true } } as const;

export const cartaoShareRepository = {
  // ── Contatos (escopados pelo dono da agenda: ownerId) ───────────────────────
  contatoList(ownerId: string) {
    return prisma.contato.findMany({ where: { ownerId }, orderBy: { nome: "asc" } });
  },
  contatoFindById(ownerId: string, id: string) {
    return prisma.contato.findFirst({ where: { id, ownerId } });
  },
  contatoCreate(data: Prisma.ContatoUncheckedCreateInput) {
    return prisma.contato.create({ data });
  },
  contatoUpdate(id: string, data: Prisma.ContatoUncheckedUpdateInput) {
    return prisma.contato.update({ where: { id }, data });
  },
  contatoDelete(id: string) {
    return prisma.contato.delete({ where: { id } });
  },
  // Contatos que apontam pro usuário logado (pode haver 1 por dono que o convidou).
  contatosByUserId(userId: string) {
    return prisma.contato.findMany({ where: { userId } });
  },
  // Contatos com este email ainda sem vínculo (candidatos a vínculo lazy).
  contatosUnlinkedByEmail(email: string) {
    return prisma.contato.findMany({ where: { email, userId: null } });
  },

  userByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },

  // Despesa (fixa/mês) que pertence a um espaço do usuário — impede compartilhar
  // linha de outra pessoa.
  despesaFixaOwned(userId: string, id: string) {
    return prisma.despesaFixa.findFirst({ where: { id, espaco: { userId } }, select: { id: true } });
  },
  despesaMesOwned(userId: string, id: string) {
    return prisma.despesaMes.findFirst({ where: { id, espaco: { userId } }, select: { id: true } });
  },

  // ── Shares ──────────────────────────────────────────────────────────────
  sharesByCartao(cartaoId: string) {
    return prisma.cartaoShare.findMany({ where: { cartaoId }, ...withLinha });
  },
  sharesByContatoIds(contatoIds: string[]) {
    return prisma.cartaoShare.findMany({
      where: { contatoId: { in: contatoIds } },
      include: { despesaFixa: true, despesaMes: true, cartao: true },
    });
  },
  // Inclui o cartão pra checar o dono (cartao.userId) antes de editar/remover.
  shareFindById(id: string) {
    return prisma.cartaoShare.findUnique({
      where: { id },
      include: { despesaFixa: true, despesaMes: true, cartao: true },
    });
  },
  shareCreate(data: Prisma.CartaoShareUncheckedCreateInput) {
    return prisma.cartaoShare.create({ data, ...withLinha });
  },
  shareUpdate(id: string, data: Prisma.CartaoShareUncheckedUpdateInput) {
    return prisma.cartaoShare.update({ where: { id }, data, ...withLinha });
  },
  shareDelete(id: string) {
    return prisma.cartaoShare.delete({ where: { id } });
  },
};
