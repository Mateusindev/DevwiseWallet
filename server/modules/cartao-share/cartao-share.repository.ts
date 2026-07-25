import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";

const withLinha = { include: { despesaFixa: true, despesaMes: true } } as const;

// Visão da pessoa compartilhada: precisa do cartão e de quem é o dono dele.
const withCartaoEDono = {
  include: {
    despesaFixa: true,
    despesaMes: true,
    cartao: { include: { user: { select: { id: true, nome: true } } } },
  },
} as const;

export const cartaoShareRepository = {
  // ── Contatos (agenda do dono) ──────────────────────────────────────────────
  contatoList(ownerId: string) {
    return prisma.contato.findMany({ where: { ownerId }, orderBy: { nome: "asc" } });
  },
  contatoFindById(id: string, ownerId: string) {
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
  // Contatos que JÁ apontam pra este usuário — um por dono que o cadastrou.
  contatosByUserId(userId: string) {
    return prisma.contato.findMany({ where: { userId } });
  },
  // Contatos ainda sem vínculo com este email (candidatos a vínculo lazy).
  contatosUnlinkedByEmail(email: string) {
    return prisma.contato.findMany({ where: { email, userId: null } });
  },

  userByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },

  // Linhas compartilháveis: só as do próprio dono (evita apontar despesa alheia).
  despesaFixaExists(id: string, ownerId: string) {
    return prisma.despesaFixa.findFirst({
      where: { id, espaco: { userId: ownerId } },
      select: { id: true },
    });
  },
  despesaMesExists(id: string, ownerId: string) {
    return prisma.despesaMes.findFirst({
      where: { id, espaco: { userId: ownerId } },
      select: { id: true },
    });
  },

  // ── Shares ──────────────────────────────────────────────────────────────
  sharesByCartao(cartaoId: string) {
    return prisma.cartaoShare.findMany({ where: { cartaoId }, ...withLinha });
  },
  sharesByContatoIds(contatoIds: string[]) {
    return prisma.cartaoShare.findMany({
      where: { contatoId: { in: contatoIds } },
      ...withCartaoEDono,
    });
  },
  // Share do dono = share num cartão dele.
  shareFindById(id: string, ownerId: string) {
    return prisma.cartaoShare.findFirst({ where: { id, cartao: { userId: ownerId } }, ...withLinha });
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
