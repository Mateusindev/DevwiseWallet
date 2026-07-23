import { z } from "zod";

export const createCaixinhaSchema = z.object({
  nome: z.string().trim().min(1).default("Nova caixinha"),
  aporteMensal: z.coerce.number().nonnegative().default(0),
  taxaJuros: z.coerce.number().nonnegative().max(9999.99).default(0),
  meta: z.coerce.number().positive().nullable().optional(),
  cor: z.string().default("blue"),
  acumulaSobra: z.boolean().default(false),
  // discriminador: só a reserva de emergência é marcável pelo cliente
  tipo: z.literal("emergencia").optional(),
});

export const updateCaixinhaSchema = z.object({
  nome: z.string().trim().min(1).optional(),
  aporteMensal: z.coerce.number().nonnegative().optional(),
  taxaJuros: z.coerce.number().nonnegative().max(9999.99).optional(),
  meta: z.coerce.number().positive().nullable().optional(),
  saldo: z.coerce.number().optional(),
  cor: z.string().optional(),
  acumulaSobra: z.boolean().optional(),
  ordem: z.coerce.number().int().optional(),
});

export type CreateCaixinhaDTO = z.infer<typeof createCaixinhaSchema>;
export type UpdateCaixinhaDTO = z.infer<typeof updateCaixinhaSchema>;
