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
  list() {
    return prisma.espaco.findMany({ orderBy: { createdAt: "asc" } });
  },

  findById(id: string) {
    return prisma.espaco.findUnique({ where: { id } });
  },

  findWithOrcamento(id: string) {
    return prisma.espaco.findUnique({ where: { id }, include: withOrcamento });
  },

  count() {
    return prisma.espaco.count();
  },

  create(data: Prisma.EspacoCreateInput) {
    return prisma.espaco.create({ data });
  },

  update(id: string, data: Prisma.EspacoUpdateInput) {
    return prisma.espaco.update({ where: { id }, data });
  },

  delete(id: string) {
    return prisma.espaco.delete({ where: { id } });
  },

  // ── Ocultar espaço num mês (exclusão só daquele mês, reversível) ────────────
  listOcultos() {
    return prisma.espacoMesOculto.findMany();
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

  // ── app_settings (singleton id=true) ──────────────────────────────────────
  async getActiveEspacoId(): Promise<string | null> {
    const s = await prisma.appSettings.findUnique({ where: { id: true } });
    return s?.activeEspacoId ?? null;
  },

  async setActiveEspacoId(activeEspacoId: string | null) {
    await prisma.appSettings.upsert({
      where: { id: true },
      create: { id: true, activeEspacoId },
      update: { activeEspacoId },
    });
    return activeEspacoId;
  },
};
