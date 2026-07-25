import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";

// Espaço com tudo que compõe o orçamento (fixas, mês, receitas, rendas).
const withOrcamento = {
  despesasFixas: { orderBy: { createdAt: "asc" } },
  despesasMes: { orderBy: { data: "desc" } },
  receitasMes: { orderBy: { data: "desc" } },
  rendasMensais: { orderBy: { ym: "asc" } },
  pagamentosFixas: true,
} satisfies Prisma.EspacoInclude;

export type EspacoComOrcamento = Prisma.EspacoGetPayload<{ include: typeof withOrcamento }>;

export const espacoRepository = {
  list(userId: string) {
    return prisma.espaco.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  },

  findById(userId: string, id: string) {
    return prisma.espaco.findFirst({ where: { id, userId } });
  },

  findWithOrcamento(userId: string, id: string) {
    return prisma.espaco.findFirst({ where: { id, userId }, include: withOrcamento });
  },

  count(userId: string) {
    return prisma.espaco.count({ where: { userId } });
  },

  create(data: Prisma.EspacoUncheckedCreateInput) {
    return prisma.espaco.create({ data });
  },

  update(id: string, data: Prisma.EspacoUpdateInput) {
    return prisma.espaco.update({ where: { id }, data });
  },

  delete(id: string) {
    return prisma.espaco.delete({ where: { id } });
  },

  // ── Ocultar espaço num mês (exclusão só daquele mês, reversível) ────────────
  listOcultos(userId: string) {
    return prisma.espacoMesOculto.findMany({ where: { espaco: { userId } } });
  },

  hide(espacoId: string, ym: string) {
    return prisma.espacoMesOculto.upsert({
      where: { espacoId_ym: { espacoId, ym } },
      create: { espacoId, ym },
      update: {},
    });
  },

  unhide(espacoId: string, ym: string) {
    return prisma.espacoMesOculto.deleteMany({ where: { espacoId, ym } });
  },

  // ── app_settings (por usuário — PK = user_id) ──────────────────────────────
  async getActiveEspacoId(userId: string): Promise<string | null> {
    const s = await prisma.appSettings.findUnique({ where: { userId } });
    return s?.activeEspacoId ?? null;
  },

  async setActiveEspacoId(userId: string, activeEspacoId: string | null) {
    await prisma.appSettings.upsert({
      where: { userId },
      create: { userId, activeEspacoId },
      update: { activeEspacoId },
    });
    return activeEspacoId;
  },
};
