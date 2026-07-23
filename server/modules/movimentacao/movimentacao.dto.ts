import { z } from "zod";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data deve ser YYYY-MM-DD");

// POST /movimentacoes — tipo define se entra (aporte) ou sai (despesa).
export const createMovimentacaoSchema = z.object({
  caixinhaId: z.string().uuid(),
  tipo: z.enum(["aporte", "despesa"]),
  valor: z.coerce.number().positive(),
  descricao: z.string().trim().optional(),
  data: ymd.optional(),
});

export type CreateMovimentacaoDTO = z.infer<typeof createMovimentacaoSchema>;
