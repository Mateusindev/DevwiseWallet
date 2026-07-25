import type { Categoria } from "@prisma/client";
import { categoriaRepository } from "./categoria.repository";
import { NotFoundError } from "@/server/lib/errors";
import type { CreateCategoriaDTO, UpdateCategoriaDTO } from "./categoria.dto";

export function categoriaView(c: Categoria) {
  return { id: c.id, nome: c.nome, cor: c.cor, ordem: c.ordem };
}

// Categorias de gasto mais usadas — provisionadas numa base vazia.
const DEFAULT_CATEGORIAS = [
  { nome: "Moradia", cor: "blue" },
  { nome: "Alimentação", cor: "emerald" },
  { nome: "Transporte", cor: "amber" },
  { nome: "Saúde", cor: "rose" },
  { nome: "Lazer", cor: "violet" },
  { nome: "Educação", cor: "cyan" },
  { nome: "Compras", cor: "violet" },
  { nome: "Contas & Assinaturas", cor: "amber" },
];

export const categoriaService = {
  // Cria as categorias padrão do usuário se ele ainda não tiver nenhuma. Idempotente.
  async ensureDefaults(userId: string) {
    if ((await categoriaRepository.count(userId)) > 0) return;
    let ordem = 0;
    for (const d of DEFAULT_CATEGORIAS) {
      ordem += 1;
      await categoriaRepository.create({ userId, nome: d.nome, cor: d.cor, ordem });
    }
  },

  async list(userId: string) {
    const rows = await categoriaRepository.list(userId);
    return rows.map(categoriaView);
  },

  async getOrThrow(userId: string, id: string): Promise<Categoria> {
    const c = await categoriaRepository.findById(id, userId);
    if (!c) throw new NotFoundError(`Categoria não encontrada: ${id}`);
    return c;
  },

  async create(userId: string, dto: CreateCategoriaDTO) {
    const ordem = (await categoriaRepository.count(userId)) + 1;
    const c = await categoriaRepository.create({ userId, nome: dto.nome, cor: dto.cor, ordem });
    return categoriaView(c);
  },

  async update(userId: string, id: string, patch: UpdateCategoriaDTO) {
    await this.getOrThrow(userId, id);
    const c = await categoriaRepository.update(id, patch);
    return categoriaView(c);
  },

  async remove(userId: string, id: string) {
    await this.getOrThrow(userId, id);
    await categoriaRepository.delete(id); // despesas mantêm-se, categoria_id vira NULL
    return { id };
  },
};
