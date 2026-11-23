import type { Caixinha } from "@prisma/client";
import { caixinhaRepository } from "./caixinha.repository";
import { NotFoundError } from "@/server/lib/errors";
import { round } from "@/server/lib/serialize";
import type { CreateCaixinhaDTO, UpdateCaixinhaDTO, SelicDTO } from "./caixinha.dto";

import { toView } from "./caixinha.view";

// Caixinha serializada (formato do front) — em `caixinha.view.ts`, que o
// navegador também usa.
export { toView };

export const caixinhaService = {
  async list(userId: string) {
    const rows = await caixinhaRepository.list(userId);
    return rows.map(toView);
  },

  // 404 (não 403) quando a caixinha é de outro dono — não vaza existência.
  async getOrThrow(userId: string, id: string): Promise<Caixinha> {
    const cx = await caixinhaRepository.findById(id, userId);
    if (!cx) throw new NotFoundError(`Caixinha não encontrada: ${id}`);
    return cx;
  },

  async create(userId: string, dto: CreateCaixinhaDTO) {
    const ordem = (await caixinhaRepository.count(userId)) + 1;
    const cx = await caixinhaRepository.create({
      userId,
      nome: dto.nome,
      tipo: dto.tipo ?? null,
      aporteMensal: round(dto.aporteMensal),
      taxaJuros: round(dto.taxaJuros),
      percentualCdi: dto.percentualCdi != null ? round(dto.percentualCdi) : null,
      meta: dto.meta != null ? round(dto.meta) : null,
      saldo: 0,
      cor: dto.cor,
      acumulaSobra: dto.acumulaSobra,
      ordem,
    });
    return toView(cx);
  },

  async update(userId: string, id: string, patch: UpdateCaixinhaDTO) {
    await this.getOrThrow(userId, id);
    const data: Record<string, unknown> = { ...patch };
    if (patch.aporteMensal != null) data.aporteMensal = round(patch.aporteMensal);
    if (patch.taxaJuros != null) data.taxaJuros = round(patch.taxaJuros);
    if (patch.percentualCdi !== undefined) data.percentualCdi = patch.percentualCdi != null ? round(patch.percentualCdi) : null;
    if (patch.meta !== undefined) data.meta = patch.meta != null ? round(patch.meta) : null;
    if (patch.saldo != null) data.saldo = round(patch.saldo);
    const cx = await caixinhaRepository.update(id, data);
    return toView(cx);
  },

  // Selic é do usuário (app_settings), não da caixinha: mudou uma vez, toda
  // caixinha em % do CDI recalcula a previsão.
  async setSelic(userId: string, dto: SelicDTO) {
    const selic = await caixinhaRepository.setSelic(userId, round(dto.selic));
    return { selic };
  },

  async remove(userId: string, id: string) {
    await this.getOrThrow(userId, id);
    await caixinhaRepository.delete(id); // cascade apaga as movimentações (schema)
    return { id };
  },
};
