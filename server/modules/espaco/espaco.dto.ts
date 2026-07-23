import { z } from "zod";

export const createEspacoSchema = z.object({
  nome: z.string().trim().min(1).default("Novo espaço"),
  tipo: z.string().default("outro"),
  emoji: z.string().default("📁"),
  rendaMensal: z.coerce.number().nonnegative().optional(),
  moeda: z.string().optional(),
});

export const updateEspacoSchema = z.object({
  nome: z.string().trim().min(1).optional(),
  tipo: z.string().optional(),
  emoji: z.string().optional(),
  rendaMensal: z.coerce.number().nonnegative().optional(),
  moeda: z.string().optional(),
});

export const setActiveSchema = z.object({ id: z.string().uuid() });

export type CreateEspacoDTO = z.infer<typeof createEspacoSchema>;
export type UpdateEspacoDTO = z.infer<typeof updateEspacoSchema>;
