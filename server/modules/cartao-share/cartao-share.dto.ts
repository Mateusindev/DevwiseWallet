import { z } from "zod";

const ym = z.string().regex(/^\d{4}-\d{2}$/, "O mês deve estar no formato YYYY-MM");
const uuid = z.string().uuid("Id inválido");
const percentual = z.coerce
  .number()
  .positive("O percentual precisa ser maior que zero")
  .max(100, "O percentual vai até 100");
const valorPositivo = z.coerce.number().positive("O valor precisa ser maior que zero");

export const createContatoSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome"),
  email: z.string().trim().email("Email inválido").nullable().optional(),
});

export const updateContatoSchema = z.object({
  nome: z.string().trim().min(1, "Informe o nome").optional(),
  email: z.string().trim().email("Email inválido").nullable().optional(),
});

// Um share ou aponta uma linha (despesaFixaId XOR despesaMesId, com percentual OU
// valor fixo — nenhum = linha inteira) ou é um valor avulso de um cartão
// (mesRef null = recorrente, YYYY-MM = pontual).
// O cartão do modo linha NÃO vem no payload: é derivado da despesa apontada —
// é isso que deixa uma fixa sem cartão (aluguel) ser compartilhada.
export const createShareSchema = z
  .object({
    contatoId: uuid,
    tipo: z.enum(["linha", "valor"]),
    descricao: z.string().trim().max(120, "A descrição passa de 120 caracteres").optional(),
    cartaoId: uuid.nullable().optional(),
    despesaFixaId: uuid.optional(),
    despesaMesId: uuid.optional(),
    percentual: percentual.optional(),
    valor: valorPositivo.optional(),
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
  descricao: z.string().trim().max(120, "A descrição passa de 120 caracteres").optional(),
  percentual: percentual.nullable().optional(),
  valor: valorPositivo.nullable().optional(),
  mesRef: ym.nullable().optional(),
});

// Rateio de UMA linha entre N contatos, numa transação. É substituição: os
// shares que não vierem em `itens` saem. Lista vazia limpa o rateio — evita
// colidir com os uniques (despesa, contato) num "salvar" repetido.
export const rateioSchema = z
  .object({
    despesaFixaId: uuid.optional(),
    despesaMesId: uuid.optional(),
    abateShares: z.boolean().optional(),
    itens: z
      .array(
        z.object({
          contatoId: uuid,
          descricao: z.string().trim().max(120, "A descrição passa de 120 caracteres").optional(),
          percentual: percentual.nullable().optional(),
          valor: valorPositivo.nullable().optional(),
        })
      )
      .max(20, "No máximo 20 pessoas por linha"),
  })
  .superRefine((v, ctx) => {
    const refs = [v.despesaFixaId, v.despesaMesId].filter(Boolean).length;
    if (refs !== 1)
      ctx.addIssue({
        code: "custom",
        message: "Informe exatamente uma despesaFixaId OU despesaMesId",
        path: ["despesaFixaId"],
      });
    const vistos = new Set<string>();
    v.itens.forEach((i, idx) => {
      if (i.percentual != null && i.valor != null)
        ctx.addIssue({ code: "custom", message: "Use percentual OU valor", path: ["itens", idx, "percentual"] });
      if (vistos.has(i.contatoId))
        ctx.addIssue({ code: "custom", message: "Pessoa repetida no rateio", path: ["itens", idx, "contatoId"] });
      vistos.add(i.contatoId);
    });
  });

// ── Convite / aceite ────────────────────────────────────────────────────────

export const conviteSchema = z.object({
  // sobrescreve o email do contato (ex.: contato criado só com nome)
  email: z.string().trim().email("Email inválido").optional(),
  diasValidade: z.coerce.number().int().min(1).max(90).optional(),
});

// ── Adoção / adiantamento (lado do devedor) ────────────────────────────────

export const adotarSchema = z.object({
  modo: z.enum(["fixa", "mes"]),
  espacoId: uuid,
  ym: ym.optional(),
});

export const desfazerAdocaoSchema = z.object({
  // "1"/"true" remove também a despesa criada; por padrão ela fica (é despesa
  // real do devedor, não pode sumir por decisão de terceiro).
  removerDespesa: z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
    .transform((v) => v === true || v === "true" || v === "1")
    .optional(),
});

export const adiantarSchema = z
  .object({
    parcelas: z.coerce.number().int().min(1, "Adiante pelo menos uma parcela").max(120).optional(),
    cobreAte: ym.optional(),
    ym: ym.optional(),
  })
  .superRefine((v, ctx) => {
    if ((v.parcelas == null) === (v.cobreAte == null))
      ctx.addIssue({ code: "custom", message: "Informe parcelas OU cobreAte", path: ["parcelas"] });
  });

export const shareQuerySchema = z.object({ ym: ym.optional() });

// Ler o rateio de uma linha sem saber o espaço dela: quem compartilha a partir
// da fatura do cartão só tem o id da linha em mãos.
export const rateioQuerySchema = z.object({
  despesaFixaId: uuid.optional(),
  despesaMesId: uuid.optional(),
  ym: ym.optional(),
});

export type CreateContatoDTO = z.infer<typeof createContatoSchema>;
export type UpdateContatoDTO = z.infer<typeof updateContatoSchema>;
export type CreateShareDTO = z.infer<typeof createShareSchema>;
export type UpdateShareDTO = z.infer<typeof updateShareSchema>;
export type RateioDTO = z.infer<typeof rateioSchema>;
export type ConviteDTO = z.infer<typeof conviteSchema>;
export type AdotarDTO = z.infer<typeof adotarSchema>;
export type AdiantarDTO = z.infer<typeof adiantarSchema>;
