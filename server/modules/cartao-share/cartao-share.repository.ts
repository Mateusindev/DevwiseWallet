import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";

const withLinha = { include: { despesaFixa: true, despesaMes: true } } as const;

export const cartaoShareRepository = {
  // ── Contatos ──────────────────────────────────────────────────────────────
  contatoList() {
    return prisma.contato.findMany({ orderBy: { nome: "asc" } });
  },
  contatoFindById(id: string) {
    return prisma.contato.findUnique({ where: { id } });
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
  contatoByUserId(userId: string) {
    return prisma.contato.findUnique({ where: { userId } });
  },
  // contato ainda não vinculado com este email (candidato a vínculo lazy)
  contatoUnlinkedByEmail(email: string) {
    return prisma.contato.findFirst({ where: { email, userId: null } });
  },

  userByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },

  despesaFixaExists(id: string) {
    return prisma.despesaFixa.findUnique({ where: { id }, select: { id: true } });
  },
  despesaMesExists(id: string) {
    return prisma.despesaMes.findUnique({ where: { id }, select: { id: true } });
  },

  // ── Shares ──────────────────────────────────────────────────────────────
  sharesByCartao(cartaoId: string) {
    return prisma.cartaoShare.findMany({ where: { cartaoId }, ...withLinha });
  },
  sharesByContato(contatoId: string) {
    return prisma.cartaoShare.findMany({
      where: { contatoId },
      include: { despesaFixa: true, despesaMes: true, cartao: true },
    });
  },
  shareFindById(id: string) {
    return prisma.cartaoShare.findUnique({ where: { id }, ...withLinha });
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
