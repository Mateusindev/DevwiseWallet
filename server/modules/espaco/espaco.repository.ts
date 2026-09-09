import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";

// Espaço com tudo que compõe o orçamento (fixas, mês, receitas, rendas).
// O rateio vem junto do orçamento: sem isso a lista de despesas precisaria de
// uma request por linha compartilhada só pra desenhar as iniciais dos contatos.
const withRateio = {
  shares: { include: { contato: { select: { id: true, nome: true, status: true } } } },
} satisfies Prisma.DespesaFixaInclude & Prisma.DespesaMesInclude;

// O histórico é filtrado por janela de meses: sem isso o payload cresce pra
// sempre (quem usa o app há um ano paga o ano inteiro em cada leitura).
// Fixas e receitas continuam inteiras — são cadastro, não histórico.
const orcamentoInclude = (de: string, ate: string) =>
  ({
    despesasFixas: { orderBy: { createdAt: "asc" }, include: withRateio },
    despesasMes: { where: { mes: { gte: de, lte: ate } }, orderBy: { data: "desc" }, include: withRateio },
    receitasMes: { orderBy: { data: "desc" }, include: { skips: true } },
    rendasMensais: { orderBy: { ym: "asc" } },
    pagamentosFixas: { where: { ym: { gte: de, lte: ate } } },
  }) satisfies Prisma.EspacoInclude;

export type EspacoComOrcamento = Prisma.EspacoGetPayload<{
  include: ReturnType<typeof orcamentoInclude>;
}>;

export const espacoRepository = {
  list(userId: string) {
    return prisma.espaco.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  },

  findById(id: string, userId: string) {
    return prisma.espaco.findFirst({ where: { id, userId } });
  },

  findWithOrcamento(id: string, userId: string, de: string, ate: string) {
    return prisma.espaco.findFirst({ where: { id, userId }, include: orcamentoInclude(de, ate) });
  },

  // Meses que TÊM lançamento, fora da janela — dois groupBy baratos que
  // substituem o payload inteiro na hora de desenhar os pontinhos do seletor
  // de mês (`mesesComDados` / `mesesComFatura` no front).
  async mesesComLancamento(espacoId: string) {
    const [despesa, fatura] = await Promise.all([
      prisma.despesaMes.groupBy({ by: ["mes"], where: { espacoId } }),
      prisma.despesaMes.groupBy({ by: ["mes"], where: { espacoId, cartaoId: { not: null } } }),
    ]);
    return {
      mesesComDespesa: despesa.map((r) => r.mes).sort(),
      mesesComFatura: fatura.map((r) => r.mes).sort(),
    };
  },

  count(userId: string) {
    return prisma.espaco.count({ where: { userId } });
  },

  create(data: Prisma.EspacoUncheckedCreateInput) {
    return prisma.espaco.create({ data });
  },

  update(id: string, data: Prisma.EspacoUncheckedUpdateInput) {
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

  // ── app_settings (uma linha por usuário; PK = user_id) ─────────────────────
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
