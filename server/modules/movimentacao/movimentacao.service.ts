import type { Movimentacao } from "@prisma/client";
import { movimentacaoRepository } from "./movimentacao.repository";
import { caixinhaService, toView as caixinhaView } from "../caixinha/caixinha.service";
import { NotFoundError } from "@/server/lib/errors";
import { num, isoDate, parseDate, isoToday, round } from "@/server/lib/serialize";
import type { CreateMovimentacaoDTO } from "./movimentacao.dto";

export function toView(mv: Movimentacao) {
  return {
    id: mv.id,
    caixinhaId: mv.caixinhaId,
    tipo: mv.tipo,
    valor: num(mv.valor),
    descricao: mv.descricao,
    data: isoDate(mv.data),
  };
}

export const movimentacaoService = {
  async list(userId: string) {
    const rows = await movimentacaoRepository.list(userId);
    return rows.map(toView);
  },

  async create(userId: string, dto: CreateMovimentacaoDTO) {
    await caixinhaService.getOrThrow(userId, dto.caixinhaId); // valida existência + dono
    const valor = round(dto.valor);
    const padrao = dto.tipo === "aporte" ? "Aporte" : "Despesa";
    const { movimentacao, caixinha } = await movimentacaoRepository.createAndApply({
      caixinhaId: dto.caixinhaId,
      tipo: dto.tipo,
      valor,
      descricao: dto.descricao?.trim() || padrao,
      data: parseDate(dto.data || isoToday()),
      delta: dto.tipo === "aporte" ? valor : -valor,
    });
    return { movimentacao: toView(movimentacao), caixinha: caixinhaView(caixinha) };
  },

  async remove(userId: string, id: string) {
    const mv = await movimentacaoRepository.findById(id, userId);
    if (!mv) throw new NotFoundError(`Movimentação não encontrada: ${id}`);
    // reverter: aporte some -> tira do saldo; despesa some -> devolve ao saldo
    const delta = mv.tipo === "aporte" ? -num(mv.valor) : num(mv.valor);
    const caixinha = await movimentacaoRepository.removeAndRevert(id, mv.caixinhaId, delta);
    return { id, caixinha: caixinhaView(caixinha) };
  },
};
