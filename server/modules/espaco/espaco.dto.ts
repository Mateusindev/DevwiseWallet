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

// ?ym=YYYY-MM — centro da janela de histórico do orçamento (default: mês atual).
export const orcamentoQuerySchema = z.object({
  ym: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "O mês deve estar no formato YYYY-MM")
    .optional(),
});

export type CreateEspacoDTO = z.infer<typeof createEspacoSchema>;
export type UpdateEspacoDTO = z.infer<typeof updateEspacoSchema>;
