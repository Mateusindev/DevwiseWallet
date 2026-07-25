import type { DespesaFixa, DespesaMes } from "@prisma/client";
import { orcamentoRepository } from "./orcamento.repository";
import { espacoService } from "../espaco/espaco.service";
import { NotFoundError } from "@/server/lib/errors";
import { num, isoDate, parseDate, round, parcelaView, parcelaWrite, currentMonth } from "@/server/lib/serialize";
import type {
  AddDespesaFixaDTO,
  UpdateDespesaFixaDTO,
  AddDespesaMesDTO,
  UpdateDespesaMesDTO,
  AddReceitaMesDTO,
  UpdateReceitaMesDTO,
} from "./orcamento.dto";

// Garante que a entidade pertence ao espaço informado.
function assertPertence(found: { espacoId: string } | null, espacoId: string, label: string, id: string) {
  if (!found || found.espacoId !== espacoId) {
    throw new NotFoundError(`${label} não encontrada: ${id}`);
  }
}

function fixaView(d: DespesaFixa) {
  return {
    id: d.id,
    descricao: d.descricao,
    valor: num(d.valor),
    diaVencimento: d.diaVencimento,
    ativa: d.ativa,
    categoriaId: d.categoriaId,
    nota: d.nota,
    ...parcelaView(d),
  };
}

function mesView(d: DespesaMes) {
  return {
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
  };
}

// Quanto pago, clampado entre 0 e o valor devido (2 casas).
function clampPago(valorPago: number, valor: number): number {
  return Math.min(Math.max(round(valorPago), 0), round(valor));
}

function receitaView(r: { id: string; mes: string; descricao: string; valor: unknown; data: Date }) {
  return {
    id: r.id,
    mes: r.mes,
    descricao: r.descricao,
    valor: num(r.valor as never),
    data: isoDate(r.data),
  };
}

export const orcamentoService = {
  // ── Despesas fixas ─────────────────────────────────────────────────────────
  async addDespesaFixa(userId: string, espacoId: string, dto: AddDespesaFixaDTO) {
    await espacoService.getOrThrow(userId, espacoId);
    const df = await orcamentoRepository.createDespesaFixa({
      espacoId,
      descricao: dto.descricao,
      valor: round(dto.valor),
      diaVencimento: dto.diaVencimento,
      ativa: true,
      categoriaId: dto.categoriaId ?? null,
      nota: dto.nota || null,
      ...parcelaWrite(dto, currentMonth()),
    });
    return fixaView(df);
  },

  async updateDespesaFixa(userId: string, espacoId: string, id: string, patch: UpdateDespesaFixaDTO) {
    await espacoService.getOrThrow(userId, espacoId);
    const found = await orcamentoRepository.findDespesaFixa(id);
    assertPertence(found, espacoId, "Despesa fixa", id);
    const data: Record<string, unknown> = {};
    if (patch.descricao !== undefined) data.descricao = patch.descricao;
    if (patch.valor !== undefined) data.valor = round(patch.valor);
    if (patch.diaVencimento !== undefined) data.diaVencimento = patch.diaVencimento;
    if (patch.ativa !== undefined) data.ativa = patch.ativa;
    if ("categoriaId" in patch) data.categoriaId = patch.categoriaId ?? null;
    if ("nota" in patch) data.nota = patch.nota || null;
    // parcela/cartão: só toca se algum campo veio no patch
    if ("cartaoId" in patch || "parcelado" in patch || "parcelaAtual" in patch || "totalParcelas" in patch) {
      // editar parcela = restabelecer a âncora pro mês corrente ("agora estou na parcela X")
      Object.assign(data, parcelaWrite({ ...found!, ...patch }, currentMonth()));
    }
    const df = await orcamentoRepository.updateDespesaFixa(id, data);
    return fixaView(df);
  },

  async toggleDespesaFixa(userId: string, espacoId: string, id: string) {
    await espacoService.getOrThrow(userId, espacoId);
    const found = await orcamentoRepository.findDespesaFixa(id);
    assertPertence(found, espacoId, "Despesa fixa", id);
    const df = await orcamentoRepository.updateDespesaFixa(id, { ativa: !found!.ativa });
    return fixaView(df);
  },

  async removeDespesaFixa(userId: string, espacoId: string, id: string) {
    await espacoService.getOrThrow(userId, espacoId);
    const found = await orcamentoRepository.findDespesaFixa(id);
    assertPertence(found, espacoId, "Despesa fixa", id);
    await orcamentoRepository.deleteDespesaFixa(id);
    return { id };
  },

  // Define quanto foi pago da fixa no mês `ym` (valor absoluto, não delta).
  //   <= 0      → remove o registro (nada pago)
  //   >= valor  → quitada (clampa no valor)
  //   intermed. → pagamento parcial
  async setPagamentoFixa(userId: string, espacoId: string, id: string, ym: string, valorPago: number) {
    await espacoService.getOrThrow(userId, espacoId);
    const found = await orcamentoRepository.findDespesaFixa(id);
    assertPertence(found, espacoId, "Despesa fixa", id);
    const valor = num(found!.valor);
    const pago = clampPago(valorPago, valor);
    if (pago <= 0) {
      const existing = await orcamentoRepository.findPagamentoFixa(id, ym);
      if (existing) await orcamentoRepository.deletePagamentoFixa(id, ym);
      return { despesaFixaId: id, ym, valorPago: 0, pago: false };
    }
    await orcamentoRepository.upsertPagamentoFixa(espacoId, id, ym, pago);
    return { despesaFixaId: id, ym, valorPago: pago, pago: pago >= valor };
  },

  // ── Despesas do mês ──────────────────────────────────────────────────────
  async addDespesaMes(userId: string, espacoId: string, dto: AddDespesaMesDTO) {
    await espacoService.getOrThrow(userId, espacoId);
    const dm = await orcamentoRepository.createDespesaMes({
      espacoId,
      mes: dto.mes,
      descricao: dto.descricao,
      valor: round(dto.valor),
      data: parseDate(dto.data || `${dto.mes}-01`),
      cartaoId: dto.cartaoId ?? null,
      categoriaId: dto.categoriaId ?? null,
      nota: dto.nota || null,
    });
    return mesView(dm);
  },

  async updateDespesaMes(userId: string, espacoId: string, id: string, patch: UpdateDespesaMesDTO) {
    await espacoService.getOrThrow(userId, espacoId);
    const found = await orcamentoRepository.findDespesaMes(id);
    assertPertence(found, espacoId, "Despesa do mês", id);
    const data: Record<string, unknown> = {};
    if (patch.descricao !== undefined) data.descricao = patch.descricao;
    if (patch.valor !== undefined) data.valor = round(patch.valor);
    if (patch.data !== undefined) data.data = parseDate(patch.data);
    if ("cartaoId" in patch) data.cartaoId = patch.cartaoId ?? null;
    if ("categoriaId" in patch) data.categoriaId = patch.categoriaId ?? null;
    if ("nota" in patch) data.nota = patch.nota || null;
    const dm = await orcamentoRepository.updateDespesaMes(id, data);
    return mesView(dm);
  },

  async removeDespesaMes(userId: string, espacoId: string, id: string) {
    await espacoService.getOrThrow(userId, espacoId);
    const found = await orcamentoRepository.findDespesaMes(id);
    assertPertence(found, espacoId, "Despesa do mês", id);
    await orcamentoRepository.deleteDespesaMes(id);
    return { id };
  },

  // Define quanto foi pago de uma despesa do mês (valor absoluto). paga = pago >= valor.
  async setPagaMes(userId: string, espacoId: string, id: string, valorPago: number) {
    await espacoService.getOrThrow(userId, espacoId);
    const found = await orcamentoRepository.findDespesaMes(id);
    assertPertence(found, espacoId, "Despesa do mês", id);
    const valor = num(found!.valor);
    const pago = clampPago(valorPago, valor);
    const dm = await orcamentoRepository.updateDespesaMes(id, { valorPago: pago, paga: pago >= valor && valor > 0 });
    return mesView(dm);
  },

  // ── Receitas do mês ──────────────────────────────────────────────────────
  async addReceitaMes(userId: string, espacoId: string, dto: AddReceitaMesDTO) {
    await espacoService.getOrThrow(userId, espacoId);
    const rm = await orcamentoRepository.createReceitaMes({
      espacoId,
      mes: dto.mes,
      descricao: dto.descricao,
      valor: round(dto.valor),
      data: parseDate(dto.data || `${dto.mes}-01`),
    });
    return receitaView(rm);
  },

  async updateReceitaMes(userId: string, espacoId: string, id: string, patch: UpdateReceitaMesDTO) {
    await espacoService.getOrThrow(userId, espacoId);
    const found = await orcamentoRepository.findReceitaMes(id);
    assertPertence(found, espacoId, "Receita do mês", id);
    const data: Record<string, unknown> = {};
    if (patch.descricao !== undefined) data.descricao = patch.descricao;
    if (patch.valor !== undefined) data.valor = round(patch.valor);
    if (patch.data !== undefined) data.data = parseDate(patch.data);
    const rm = await orcamentoRepository.updateReceitaMes(id, data);
    return receitaView(rm);
  },

  async removeReceitaMes(userId: string, espacoId: string, id: string) {
    await espacoService.getOrThrow(userId, espacoId);
    const found = await orcamentoRepository.findReceitaMes(id);
    assertPertence(found, espacoId, "Receita do mês", id);
    await orcamentoRepository.deleteReceitaMes(id);
    return { id };
  },

  // ── Renda mensal ─────────────────────────────────────────────────────────
  async setRenda(userId: string, espacoId: string, ym: string, valor: number) {
    await espacoService.getOrThrow(userId, espacoId);
    const r = await orcamentoRepository.upsertRenda(espacoId, ym, round(valor));
    return { ym: r.ym, valor: num(r.valor) };
  },

  // Remove o override do mês → o mês passa a herdar o salário fixo do espaço.
  async clearRenda(userId: string, espacoId: string, ym: string) {
    await espacoService.getOrThrow(userId, espacoId);
    await orcamentoRepository.deleteRenda(espacoId, ym);
    return { ym };
  },
};
