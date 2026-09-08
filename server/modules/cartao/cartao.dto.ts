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
const ym = z.string().regex(/^\d{4}-\d{2}$/, "O mês deve estar no formato YYYY-MM");

export const cartaoQuerySchema = z.object({
  ym: ym.optional(),
});

// ?de=YYYY-MM&ate=YYYY-MM — janela do resumo. Teto de 24 meses: acima disso a
// agregação em memória deixa de ser barata e o gráfico deixa de ser legível.
export const resumoQuerySchema = z
  .object({ de: ym.optional(), ate: ym.optional() })
  .refine((q) => !q.de || !q.ate || q.de <= q.ate, {
    message: "O início da janela vem antes do fim",
    path: ["de"],
  })
  .refine((q) => !q.de || !q.ate || mesesEntre(q.de, q.ate) < 24, {
    message: "A janela do resumo é de no máximo 24 meses",
    path: ["de"],
  });

function mesesEntre(a: string, b: string) {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

export type CreateCartaoDTO = z.infer<typeof createCartaoSchema>;
export type UpdateCartaoDTO = z.infer<typeof updateCartaoSchema>;
