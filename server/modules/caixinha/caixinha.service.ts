import type { Caixinha } from "@prisma/client";
import { caixinhaRepository } from "./caixinha.repository";
import { NotFoundError } from "@/server/lib/errors";
import { num, numOrNull, round } from "@/server/lib/serialize";
import type { CreateCaixinhaDTO, UpdateCaixinhaDTO } from "./caixinha.dto";

// Caixinha serializada (formato do mock/front).
export function toView(cx: Caixinha) {
  return {
    id: cx.id,
    nome: cx.nome,
    tipo: cx.tipo ?? null,
    aporteMensal: num(cx.aporteMensal),
    taxaJuros: num(cx.taxaJuros),
    meta: numOrNull(cx.meta),
    saldo: num(cx.saldo),
    cor: cx.cor,
    acumulaSobra: cx.acumulaSobra,
    ordem: cx.ordem,
  };
}

export const caixinhaService = {
  async list() {
    const rows = await caixinhaRepository.list();
    return rows.map(toView);
  },

  async getOrThrow(id: string): Promise<Caixinha> {
    const cx = await caixinhaRepository.findById(id);
    if (!cx) throw new NotFoundError(`Caixinha não encontrada: ${id}`);
    return cx;
  },

  async create(dto: CreateCaixinhaDTO) {
    const ordem = (await caixinhaRepository.count()) + 1;
    const cx = await caixinhaRepository.create({
      nome: dto.nome,
      tipo: dto.tipo ?? null,
      aporteMensal: round(dto.aporteMensal),
      taxaJuros: round(dto.taxaJuros),
      meta: dto.meta != null ? round(dto.meta) : null,
      saldo: 0,
      cor: dto.cor,
      acumulaSobra: dto.acumulaSobra,
      ordem,
    });
    return toView(cx);
  },

  async update(id: string, patch: UpdateCaixinhaDTO) {
    await this.getOrThrow(id);
    const data: Record<string, unknown> = { ...patch };
    if (patch.aporteMensal != null) data.aporteMensal = round(patch.aporteMensal);
    if (patch.taxaJuros != null) data.taxaJuros = round(patch.taxaJuros);
    if (patch.meta !== undefined) data.meta = patch.meta != null ? round(patch.meta) : null;
    if (patch.saldo != null) data.saldo = round(patch.saldo);
    const cx = await caixinhaRepository.update(id, data);
    return toView(cx);
  },

  async remove(id: string) {
    await this.getOrThrow(id);
    await caixinhaRepository.delete(id); // cascade apaga as movimentações (schema)
    return { id };
  },
};
