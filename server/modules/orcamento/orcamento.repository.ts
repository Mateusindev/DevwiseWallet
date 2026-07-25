import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";

// Repositório do orçamento de um espaço: despesas fixas, despesas/receitas do
// mês e renda mensal. As linhas herdam o dono do espaço — por isso todo find
// cruza `espaco: { userId }`; o service ainda confere o espacoId (assertPertence).
export const orcamentoRepository = {
  // ── Despesas fixas ─────────────────────────────────────────────────────────
  createDespesaFixa(data: Prisma.DespesaFixaUncheckedCreateInput) {
    return prisma.despesaFixa.create({ data });
  },
  findDespesaFixa(id: string, userId: string) {
    return prisma.despesaFixa.findFirst({ where: { id, espaco: { userId } } });
  },
  updateDespesaFixa(id: string, data: Prisma.DespesaFixaUncheckedUpdateInput) {
    return prisma.despesaFixa.update({ where: { id }, data });
  },
  deleteDespesaFixa(id: string) {
    return prisma.despesaFixa.delete({ where: { id } });
  },

  // ── Pagamentos de fixas (quanto pago por mês) ────────────────────────────
  findPagamentoFixa(despesaFixaId: string, ym: string) {
    return prisma.pagamentoFixa.findUnique({ where: { despesaFixaId_ym: { despesaFixaId, ym } } });
  },
  upsertPagamentoFixa(espacoId: string, despesaFixaId: string, ym: string, valorPago: number) {
    return prisma.pagamentoFixa.upsert({
      where: { despesaFixaId_ym: { despesaFixaId, ym } },
      create: { espacoId, despesaFixaId, ym, valorPago },
      update: { valorPago },
    });
  },
  deletePagamentoFixa(despesaFixaId: string, ym: string) {
    return prisma.pagamentoFixa.delete({ where: { despesaFixaId_ym: { despesaFixaId, ym } } });
  },

  // ── Despesas do mês ──────────────────────────────────────────────────────
  createDespesaMes(data: Prisma.DespesaMesUncheckedCreateInput) {
    return prisma.despesaMes.create({ data });
  },
  findDespesaMes(id: string, userId: string) {
    return prisma.despesaMes.findFirst({ where: { id, espaco: { userId } } });
  },
  updateDespesaMes(id: string, data: Prisma.DespesaMesUncheckedUpdateInput) {
    return prisma.despesaMes.update({ where: { id }, data });
  },
  deleteDespesaMes(id: string) {
    return prisma.despesaMes.delete({ where: { id } });
  },

  // ── Receitas do mês ──────────────────────────────────────────────────────
  createReceitaMes(data: Prisma.ReceitaMesUncheckedCreateInput) {
    return prisma.receitaMes.create({ data });
  },
  findReceitaMes(id: string, userId: string) {
    return prisma.receitaMes.findFirst({ where: { id, espaco: { userId } } });
  },
  updateReceitaMes(id: string, data: Prisma.ReceitaMesUncheckedUpdateInput) {
    return prisma.receitaMes.update({ where: { id }, data });
  },
  deleteReceitaMes(id: string) {
    return prisma.receitaMes.delete({ where: { id } });
  },

  // ── Renda mensal (upsert por espaço+ym) ──────────────────────────────────
  upsertRenda(espacoId: string, ym: string, valor: number) {
    return prisma.rendaMensal.upsert({
      where: { espacoId_ym: { espacoId, ym } },
      create: { espacoId, ym, valor },
      update: { valor },
    });
  },
  // deleteMany: não lança se o mês não tiver override (volta a herdar o fixo).
  deleteRenda(espacoId: string, ym: string) {
    return prisma.rendaMensal.deleteMany({ where: { espacoId, ym } });
  },
};
