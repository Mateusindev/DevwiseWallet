import { z } from "zod";

const ym = z.string().regex(/^\d{4}-\d{2}$/);

export const createContatoSchema = z.object({
  nome: z.string().trim().min(1),
  email: z.string().trim().email().nullable().optional(),
});

export const updateContatoSchema = z.object({
  nome: z.string().trim().min(1).optional(),
  email: z.string().trim().email().nullable().optional(),
});

// Um share ou aponta uma linha (despesaFixaId XOR despesaMesId, com percentual OU
// valor fixo — nenhum = linha inteira) ou é um valor avulso da fatura (mesRef null
// = recorrente, YYYY-MM = pontual).
export const createShareSchema = z
  .object({
    contatoId: z.string().uuid(),
    tipo: z.enum(["linha", "valor"]),
    descricao: z.string().trim().optional(),
    despesaFixaId: z.string().uuid().optional(),
    despesaMesId: z.string().uuid().optional(),
    percentual: z.coerce.number().positive().max(100).optional(),
    valor: z.coerce.number().positive().optional(),
    mesRef: ym.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.tipo === "linha") {
      const refs = [v.despesaFixaId, v.despesaMesId].filter(Boolean).length;
      if (refs !== 1)
        ctx.addIssue({
          code: "custom",
          message: "Modo linha: informe exatamente uma despesaFixaId OU despesaMesId",
          path: ["despesaFixaId"],
        });
      if (v.percentual != null && v.valor != null)
        ctx.addIssue({ code: "custom", message: "Use percentual OU valor, não ambos", path: ["percentual"] });
    } else {
      if (v.valor == null)
        ctx.addIssue({ code: "custom", message: "Modo valor exige valor", path: ["valor"] });
      if (v.despesaFixaId || v.despesaMesId)
        ctx.addIssue({ code: "custom", message: "Modo valor não aponta linha", path: ["tipo"] });
    }
  });

export const updateShareSchema = z.object({
  descricao: z.string().trim().optional(),
  percentual: z.coerce.number().positive().max(100).nullable().optional(),
  valor: z.coerce.number().positive().nullable().optional(),
  mesRef: ym.nullable().optional(),
});

export const shareQuerySchema = z.object({ ym: ym.optional() });

export type CreateContatoDTO = z.infer<typeof createContatoSchema>;
export type UpdateContatoDTO = z.infer<typeof updateContatoSchema>;
export type CreateShareDTO = z.infer<typeof createShareSchema>;
export type UpdateShareDTO = z.infer<typeof updateShareSchema>;
