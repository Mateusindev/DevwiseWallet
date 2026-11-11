import type { Categoria } from "@prisma/client";
import { categoriaRepository } from "./categoria.repository";
import { AppError, NotFoundError } from "@/server/lib/errors";
import type { CreateCategoriaDTO, UpdateCategoriaDTO, ReordenarCategoriasDTO, MesclarCategoriaDTO } from "./categoria.dto";

import { categoriaView } from "./categoria.view";

// Categoria serializada — em `categoria.view.ts`, que o navegador também usa.
export { categoriaView };

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
  // Um INSERT só: em série eram oito idas ao banco no primeiro boot da conta.
  async ensureDefaults(userId: string) {
    if ((await categoriaRepository.count(userId)) > 0) return;
    await categoriaRepository.createMany(
      DEFAULT_CATEGORIAS.map((d, i) => ({ userId, nome: d.nome, cor: d.cor, ordem: i + 1 }))
    );
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

  // Uso por categoria (todas as páginas): { [categoriaId]: { fixas, lancamentos, ultimoMes } }.
  // Categoria sem uso não aparece — o front lê como zero.
  async uso(userId: string) {
    const { fixas, lancamentos } = await categoriaRepository.uso(userId);
    const out: Record<string, { fixas: number; lancamentos: number; ultimoMes: string | null }> = {};
    const linha = (id: string) => (out[id] ??= { fixas: 0, lancamentos: 0, ultimoMes: null });
    for (const f of fixas) if (f.categoriaId) linha(f.categoriaId).fixas = f._count._all;
    for (const l of lancamentos) {
      if (!l.categoriaId) continue;
      const o = linha(l.categoriaId);
      o.lancamentos = l._count._all;
      o.ultimoMes = l._max.mes ?? null;
    }
    return out;
  },

  // A lista nova tem que ser EXATAMENTE as categorias do dono, sem repetir:
  // faltar uma deixaria duas com a mesma ordem; sobrar uma é id alheio (404).
  async reordenar(userId: string, dto: ReordenarCategoriasDTO) {
    const minhas = await categoriaRepository.list(userId);
    const meus = new Set(minhas.map((c) => c.id));
    const vistos = new Set<string>();
    for (const id of dto.ids) {
      if (!meus.has(id)) throw new NotFoundError(`Categoria não encontrada: ${id}`);
      if (vistos.has(id)) throw new AppError("Categoria repetida na ordem", 422);
      vistos.add(id);
    }
    if (vistos.size !== meus.size) throw new AppError("A ordem precisa conter todas as categorias", 422);
    await categoriaRepository.reordenar(userId, dto.ids);
    return this.list(userId);
  },

  // Junta a origem no destino: despesas mudam de categoria e a origem some.
  async mesclar(userId: string, origemId: string, dto: MesclarCategoriaDTO) {
    if (origemId === dto.destinoId) throw new AppError("Escolha outra categoria pra mesclar", 422);
    await Promise.all([this.getOrThrow(userId, origemId), this.getOrThrow(userId, dto.destinoId)]);
    const movidas = await categoriaRepository.mesclar(userId, origemId, dto.destinoId);
    return { id: origemId, destinoId: dto.destinoId, ...movidas };
  },

  async remove(userId: string, id: string) {
    await this.getOrThrow(userId, id);
    await categoriaRepository.delete(id); // despesas mantêm-se, categoria_id vira NULL
    return { id };
  },
};
