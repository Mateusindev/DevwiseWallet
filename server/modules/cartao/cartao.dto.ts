import { z } from "zod";

const dia = z.coerce.number().int().min(1).max(31);

export const createCartaoSchema = z.object({
  nome: z.string().trim().min(1).default("Novo cartão"),
  bandeira: z.string().trim().nullable().optional(),
  limite: z.coerce.number().nonnegative().default(0),
  diaFechamento: dia.nullable().optional(),
  diaVencimento: dia.default(1),
  cor: z.string().default("violet"),
});

export const updateCartaoSchema = z.object({
  nome: z.string().trim().min(1).optional(),
  bandeira: z.string().trim().nullable().optional(),
  limite: z.coerce.number().nonnegative().optional(),
  diaFechamento: dia.nullable().optional(),
  diaVencimento: dia.optional(),
  cor: z.string().optional(),
  ordem: z.coerce.number().int().optional(),
});

// ?ym=YYYY-MM (opcional)
export const cartaoQuerySchema = z.object({
  ym: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export type CreateCartaoDTO = z.infer<typeof createCartaoSchema>;
export type UpdateCartaoDTO = z.infer<typeof updateCartaoSchema>;
