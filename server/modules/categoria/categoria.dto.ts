import { z } from "zod";

export const createCategoriaSchema = z.object({
  nome: z.string().trim().min(1).default("Nova categoria"),
  cor: z.string().default("blue"),
});

export const updateCategoriaSchema = z.object({
  nome: z.string().trim().min(1).optional(),
  cor: z.string().optional(),
  ordem: z.coerce.number().int().optional(),
});

// Ordem nova da lista INTEIRA (o service confere que são exatamente as do dono).
export const reordenarCategoriasSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

// Mesclar: as despesas da origem passam pro destino e a origem some.
export const mesclarCategoriaSchema = z.object({
  destinoId: z.string().min(1),
});

export type CreateCategoriaDTO = z.infer<typeof createCategoriaSchema>;
export type UpdateCategoriaDTO = z.infer<typeof updateCategoriaSchema>;
export type ReordenarCategoriasDTO = z.infer<typeof reordenarCategoriasSchema>;
export type MesclarCategoriaDTO = z.infer<typeof mesclarCategoriaSchema>;
