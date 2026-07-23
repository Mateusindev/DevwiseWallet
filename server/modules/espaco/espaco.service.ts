import type { Espaco } from "@prisma/client";
import { espacoRepository, type EspacoComOrcamento } from "./espaco.repository";
import { AppError, NotFoundError } from "@/server/lib/errors";
import { num, isoDate, round, parcelaView } from "@/server/lib/serialize";
import type { CreateEspacoDTO, UpdateEspacoDTO } from "./espaco.dto";

export function espacoView(esp: Espaco) {
  return { id: esp.id, nome: esp.nome, tipo: esp.tipo, emoji: esp.emoji };
}

// Monta o blob de orçamento no formato que o front espera.
export function orcamentoView(esp: EspacoComOrcamento) {
  const rendasMensais: Record<string, number> = {};
  for (const r of esp.rendasMensais) rendasMensais[r.ym] = num(r.valor);

  return {
    despesasFixas: esp.despesasFixas.map((d) => ({
      id: d.id,
      descricao: d.descricao,
      valor: num(d.valor),
      diaVencimento: d.diaVencimento,
      ativa: d.ativa,
      categoriaId: d.categoriaId,
      nota: d.nota,
      ...parcelaView(d),
    })),
    despesasMes: esp.despesasMes.map((d) => ({
      id: d.id,
      mes: d.mes,
      descricao: d.descricao,
      valor: num(d.valor),
      data: isoDate(d.data),
      paga: d.paga,
      valorPago: num(d.valorPago),
      cartaoId: d.cartaoId,
      categoriaId: d.categoriaId,
      nota: d.nota,
    })),
    receitasMes: esp.receitasMes.map((r) => ({
      id: r.id,
      mes: r.mes,
      descricao: r.descricao,
      valor: num(r.valor),
      data: isoDate(r.data),
    })),
    pagamentosFixas: esp.pagamentosFixas.map((p) => ({
      despesaFixaId: p.despesaFixaId,
      ym: p.ym,
      valorPago: num(p.valorPago),
    })),
    rendasMensais,
    config: { rendaMensal: num(esp.rendaMensal), moeda: esp.moeda },
  };
}

export const espacoService = {
  // Espaço padrão provisionado em base vazia: só "Meu" (pessoal). Idempotente.
  async ensureDefaults() {
    if ((await espacoRepository.count()) > 0) return;
    const esp = await espacoRepository.create({
      nome: "Meu",
      tipo: "pessoal",
      emoji: "🧍",
      rendaMensal: 0,
      moeda: "BRL",
    });
    await espacoRepository.setActiveEspacoId(esp.id);
  },

  async getOrThrow(id: string): Promise<Espaco> {
    const esp = await espacoRepository.findById(id);
    if (!esp) throw new NotFoundError(`Espaço de despesa não encontrado: ${id}`);
    return esp;
  },

  // Lista + espaço ativo (com fallback pro primeiro se o ativo sumir).
  async listWithActive() {
    const espacos = await espacoRepository.list();
    let activeEspacoId = await espacoRepository.getActiveEspacoId();
    const exists = activeEspacoId && espacos.some((e) => e.id === activeEspacoId);
    if (!exists) {
      activeEspacoId = espacos[0]?.id ?? null;
      await espacoRepository.setActiveEspacoId(activeEspacoId);
    }
    const espacosOcultos = (await espacoRepository.listOcultos()).map((o) => ({
      espacoId: o.espacoId,
      ym: o.ym,
    }));
    return { espacos: espacos.map(espacoView), activeEspacoId, espacosOcultos };
  },

  // Oculta o espaço só no mês `ym` (exclusão reversível daquele mês).
  //   guarda: não deixa ocultar o último espaço visível do mês.
  async ocultarNoMes(id: string, ym: string) {
    await this.getOrThrow(id);
    const espacos = await espacoRepository.list();
    const ocultos = await espacoRepository.listOcultos();
    const ocultosNoMes = new Set(ocultos.filter((o) => o.ym === ym).map((o) => o.espacoId));
    const visiveis = espacos.filter((e) => !ocultosNoMes.has(e.id));
    if (visiveis.length <= 1 && visiveis.some((e) => e.id === id)) {
      throw new AppError("Não dá pra excluir a única página do mês.");
    }
    await espacoRepository.hide(id, ym);
    return { id, ym };
  },

  // Restaura o espaço no mês `ym` (desfaz a exclusão daquele mês).
  async restaurarNoMes(id: string, ym: string) {
    await this.getOrThrow(id);
    await espacoRepository.unhide(id, ym);
    return { id, ym };
  },

  async getOrcamento(espacoId: string) {
    const esp = await espacoRepository.findWithOrcamento(espacoId);
    if (!esp) throw new NotFoundError(`Espaço de despesa não encontrado: ${espacoId}`);
    return orcamentoView(esp);
  },

  async setActive(id: string) {
    await this.getOrThrow(id);
    await espacoRepository.setActiveEspacoId(id);
    return { activeEspacoId: id };
  },

  async create(dto: CreateEspacoDTO) {
    const esp = await espacoRepository.create({
      nome: dto.nome,
      tipo: dto.tipo,
      emoji: dto.emoji,
      rendaMensal: round(dto.rendaMensal ?? 0),
      moeda: dto.moeda ?? "BRL",
    });
    // primeiro espaço vira ativo automaticamente
    if ((await espacoRepository.getActiveEspacoId()) == null) {
      await espacoRepository.setActiveEspacoId(esp.id);
    }
    return espacoView(esp);
  },

  async update(id: string, patch: UpdateEspacoDTO) {
    await this.getOrThrow(id);
    const data: Record<string, unknown> = { ...patch };
    if (patch.rendaMensal != null) data.rendaMensal = round(patch.rendaMensal);
    const esp = await espacoRepository.update(id, data);
    return espacoView(esp);
  },

  async remove(id: string) {
    await this.getOrThrow(id);
    if ((await espacoRepository.count()) <= 1) {
      throw new AppError("Não dá pra remover o único espaço.");
    }
    await espacoRepository.delete(id); // cascata limpa orçamento
    // se era o ativo, reassina pro primeiro restante
    let activeEspacoId = await espacoRepository.getActiveEspacoId();
    if (activeEspacoId === id || activeEspacoId == null) {
      const rest = await espacoRepository.list();
      activeEspacoId = rest[0]?.id ?? null;
      await espacoRepository.setActiveEspacoId(activeEspacoId);
    }
    return { id, activeEspacoId };
  },
};
