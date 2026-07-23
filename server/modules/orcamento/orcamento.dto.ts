import { z } from "zod";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data deve ser YYYY-MM-DD");
const ym = z.string().regex(/^\d{4}-\d{2}$/, "mês deve ser YYYY-MM");

// Campos de cartão + parcelamento (compartilhados por fixa e despesa do mês).
const parcelaShape = {
  cartaoId: z.string().uuid().nullable().optional(),
  parcelado: z.boolean().optional(),
  parcelaAtual: z.coerce.number().int().min(1).nullable().optional(),
  totalParcelas: z.coerce.number().int().min(1).nullable().optional(),
};

const categoriaId = z.string().uuid().nullable().optional();

// Observação livre (opcional). String vazia vira null no service.
const nota = z.string().trim().max(1000).nullable().optional();

export const addDespesaFixaSchema = z.object({
  descricao: z.string().trim().min(1).default("Despesa fixa"),
  valor: z.coerce.number().nonnegative(),
  diaVencimento: z.coerce.number().int().min(1).max(31).default(1),
  categoriaId,
  nota,
  ...parcelaShape,
});

export const updateDespesaFixaSchema = z.object({
  descricao: z.string().trim().min(1).optional(),
  valor: z.coerce.number().nonnegative().optional(),
  diaVencimento: z.coerce.number().int().min(1).max(31).optional(),
  ativa: z.boolean().optional(),
  categoriaId,
  nota,
  ...parcelaShape,
});

// Despesa do mês: aceita cartão (à vista), mas NÃO parcelamento (só fixas parcelam).
export const addDespesaMesSchema = z.object({
  mes: ym,
  descricao: z.string().trim().min(1).default("Despesa"),
  valor: z.coerce.number().nonnegative(),
  data: ymd.optional(),
  cartaoId: z.string().uuid().nullable().optional(),
  categoriaId,
  nota,
});

export const updateDespesaMesSchema = z.object({
  descricao: z.string().trim().min(1).optional(),
  valor: z.coerce.number().nonnegative().optional(),
  data: ymd.optional(),
  cartaoId: z.string().uuid().nullable().optional(),
  categoriaId,
  nota,
});

export const addReceitaMesSchema = z.object({
  mes: ym,
  descricao: z.string().trim().min(1).default("Receita extra"),
  valor: z.coerce.number().nonnegative(),
  data: ymd.optional(),
});

export const updateReceitaMesSchema = z.object({
  descricao: z.string().trim().min(1).optional(),
  valor: z.coerce.number().nonnegative().optional(),
  data: ymd.optional(),
});

export const setRendaSchema = z.object({ valor: z.coerce.number().nonnegative() });

// Quanto foi pago (valor absoluto) de uma fixa/despesa do mês.
export const setPagamentoSchema = z.object({ valorPago: z.coerce.number().nonnegative() });

export const ymParamSchema = z.object({ ym });

export type AddDespesaFixaDTO = z.infer<typeof addDespesaFixaSchema>;
export type UpdateDespesaFixaDTO = z.infer<typeof updateDespesaFixaSchema>;
export type AddDespesaMesDTO = z.infer<typeof addDespesaMesSchema>;
export type UpdateDespesaMesDTO = z.infer<typeof updateDespesaMesSchema>;
export type AddReceitaMesDTO = z.infer<typeof addReceitaMesSchema>;
export type UpdateReceitaMesDTO = z.infer<typeof updateReceitaMesSchema>;
