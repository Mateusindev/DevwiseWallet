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

  // ── Lote de fixas ────────────────────────────────────────────────────────
  // O filtro é sempre espaço + dono; o service compara a contagem com os ids
  // pedidos antes de escrever qualquer coisa.
  findDespesasFixasByIds(ids: string[], userId: string, espacoId: string) {
    return prisma.despesaFixa.findMany({ where: { id: { in: ids }, espacoId, espaco: { userId } } });
  },
  updateManyDespesaFixa(ids: string[], data: Prisma.DespesaFixaUncheckedUpdateManyInput) {
    return prisma.despesaFixa.updateMany({ where: { id: { in: ids } }, data });
  },
  deleteManyDespesaFixa(ids: string[]) {
    return prisma.despesaFixa.deleteMany({ where: { id: { in: ids } } });
  },
  // Um upsert por fixa (o valor pago é o valor dela), tudo ou nada.
  upsertPagamentosFixas(espacoId: string, ym: string, linhas: { id: string; valorPago: number }[]) {
    return prisma.$transaction(
      linhas.map((l) =>
        prisma.pagamentoFixa.upsert({
          where: { despesaFixaId_ym: { despesaFixaId: l.id, ym } },
          create: { espacoId, despesaFixaId: l.id, ym, valorPago: l.valorPago },
          update: { valorPago: l.valorPago },
        })
      )
    );
  },
  deletePagamentosFixas(ids: string[], ym: string) {
    return prisma.pagamentoFixa.deleteMany({ where: { despesaFixaId: { in: ids }, ym } });
  },
  findPagamentosFixasByIds(ids: string[], ym: string) {
    return prisma.pagamentoFixa.findMany({ where: { despesaFixaId: { in: ids }, ym } });
  },

  // ── Lote de despesas do mês ──────────────────────────────────────────────
  findDespesasMesByIds(ids: string[], userId: string, espacoId: string) {
    return prisma.despesaMes.findMany({ where: { id: { in: ids }, espacoId, espaco: { userId } } });
  },
  updateManyDespesaMes(ids: string[], data: Prisma.DespesaMesUncheckedUpdateManyInput) {
    return prisma.despesaMes.updateMany({ where: { id: { in: ids } }, data });
  },
  deleteManyDespesaMes(ids: string[]) {
    return prisma.despesaMes.deleteMany({ where: { id: { in: ids } } });
  },
  // "Pagar" é por linha: cada uma quita pelo próprio valor.
  pagarDespesasMes(linhas: { id: string; valor: number }[]) {
    return prisma.$transaction(
      linhas.map((l) =>
        prisma.despesaMes.update({
          where: { id: l.id },
          data: { valorPago: l.valor, paga: l.valor > 0 },
        })
      )
    );
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
