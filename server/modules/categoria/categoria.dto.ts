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

export type CreateCategoriaDTO = z.infer<typeof createCategoriaSchema>;
export type UpdateCategoriaDTO = z.infer<typeof updateCategoriaSchema>;
