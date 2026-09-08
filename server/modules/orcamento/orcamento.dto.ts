import { z } from "zod";

// Mensagens em pt-BR de propósito: elas viajam no `issues` do 422 e o front as
// mostra ancoradas no campo (ver lib/formErrors.js).
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A data deve estar no formato YYYY-MM-DD");
const ym = z.string().regex(/^\d{4}-\d{2}$/, "O mês deve estar no formato YYYY-MM");

const descricao = (padrao: string) =>
  z.string().trim().min(1, "Informe a descrição").max(120, "A descrição passa de 120 caracteres").default(padrao);

const valor = z.coerce.number().nonnegative("O valor não pode ser negativo");

// Dia do mês. `z.coerce.number()` transforma "" e null em 0, então a mensagem
// do min é "informe", não "menor que 1" — é o texto que o usuário lê no campo.
const diaVencimento = z.coerce
  .number()
  .int("O dia do vencimento precisa ser um número inteiro")
  .min(1, "Informe o dia do vencimento (1 a 31)")
  .max(31, "O dia do vencimento vai de 1 a 31");

// Campos de cartão + parcelamento (compartilhados por fixa e despesa do mês).
const parcelaShape = {
  cartaoId: z.string().uuid().nullable().optional(),
  parcelado: z.boolean().optional(),
  parcelaAtual: z.coerce.number().int().min(1, "A parcela atual começa em 1").nullable().optional(),
  totalParcelas: z.coerce.number().int().min(1, "O total de parcelas começa em 1").nullable().optional(),
};

// Parcela atual além do total deixaria a fixa nascer quitada (não aparece em mês nenhum).
const parcelaCoerente = (d: { parcelado?: boolean; parcelaAtual?: number | null; totalParcelas?: number | null }) =>
  !d.parcelado || !d.totalParcelas || !d.parcelaAtual || d.parcelaAtual <= d.totalParcelas;
const parcelaCoerenteOpts = {
  message: "A parcela atual não pode passar do total de parcelas",
  path: ["parcelaAtual"],
};

const categoriaId = z.string().uuid().nullable().optional();

// Observação livre (opcional). String vazia vira null no service.
const nota = z.string().trim().max(1000, "A nota passa de 1000 caracteres").nullable().optional();

// A lista de despesas/receitas filtra por `mes`; data de outro mês faria a linha
// sumir da tela logo depois de salvar.
const dataNoMes = (d: { mes: string; data?: string }) => !d.data || d.data.slice(0, 7) === d.mes;
const dataNoMesOpts = { message: "A data precisa estar dentro do mês", path: ["data"] };

export const addDespesaFixaSchema = z
  .object({
    descricao: descricao("Despesa fixa"),
    valor,
    diaVencimento: diaVencimento.default(1),
    categoriaId,
    nota,
    ...parcelaShape,
  })
  .refine(parcelaCoerente, parcelaCoerenteOpts);

export const updateDespesaFixaSchema = z
  .object({
    descricao: z.string().trim().min(1, "Informe a descrição").max(120, "A descrição passa de 120 caracteres").optional(),
    valor: valor.optional(),
    diaVencimento: diaVencimento.optional(),
    ativa: z.boolean().optional(),
    categoriaId,
    nota,
    ...parcelaShape,
  })
  .refine(parcelaCoerente, parcelaCoerenteOpts);

// Despesa do mês: aceita cartão (à vista), mas NÃO parcelamento (só fixas parcelam).
export const addDespesaMesSchema = z
  .object({
    mes: ym,
    descricao: descricao("Despesa"),
    valor,
    data: ymd.optional(),
    cartaoId: z.string().uuid().nullable().optional(),
    categoriaId,
    nota,
  })
  .refine(dataNoMes, dataNoMesOpts);

export const updateDespesaMesSchema = z.object({
  descricao: z.string().trim().min(1, "Informe a descrição").max(120, "A descrição passa de 120 caracteres").optional(),
  valor: valor.optional(),
  data: ymd.optional(),
  cartaoId: z.string().uuid().nullable().optional(),
  categoriaId,
  nota,
});

// Receita recorrente: `mes` passa a ser a âncora e `mesFim` fecha a janela
// (null = sem fim). O fim nunca vem antes da âncora.
const recorrencia = {
  recorrente: z.boolean().optional(),
  mesFim: ym.nullable().optional(),
};
const fimDepoisDoInicio = (d: { mes?: string; mesFim?: string | null }) =>
  !d.mesFim || !d.mes || d.mesFim >= d.mes;
const fimOpts = { message: "O mês final vem depois do inicial", path: ["mesFim"] };

export const addReceitaMesSchema = z
  .object({
    mes: ym,
    descricao: descricao("Receita extra"),
    valor,
    data: ymd.optional(),
    ...recorrencia,
  })
  .refine(dataNoMes, dataNoMesOpts)
  .refine(fimDepoisDoInicio, fimOpts);

export const updateReceitaMesSchema = z
  .object({
    descricao: z.string().trim().min(1, "Informe a descrição").max(120, "A descrição passa de 120 caracteres").optional(),
    valor: valor.optional(),
    data: ymd.optional(),
    ...recorrencia,
  })
  .refine(fimDepoisDoInicio, fimOpts);

// ── Ações em lote ───────────────────────────────────────────────────────────
// 200 ids por chamada: o lote existe pra evitar N requests, não pra virar job.
const ids = z
  .array(z.string().uuid("Id inválido"))
  .min(1, "Selecione pelo menos uma linha")
  .max(200, "No máximo 200 linhas por vez");

const alvoLote = {
  categoriaId: z.string().uuid().nullable().optional(),
  cartaoId: z.string().uuid().nullable().optional(),
};

// `op: "categoria"` com `categoriaId` ausente ≠ com `categoriaId: null`: o
// segundo é "tirar a categoria", o primeiro é payload incompleto.
const temAlvo = (campo: "categoriaId" | "cartaoId", op: string) => (d: Record<string, unknown>) =>
  d.op !== op || campo in d;

const opsMes = ["pagar", "despagar", "excluir", "categoria", "cartao"] as const;
const opsFixa = [...opsMes, "ativar", "pausar"] as const;

export const bulkMesSchema = z
  .object({ ids, op: z.enum(opsMes), ...alvoLote })
  .refine(temAlvo("categoriaId", "categoria"), { message: "Escolha a categoria a aplicar", path: ["categoriaId"] })
  .refine(temAlvo("cartaoId", "cartao"), { message: "Escolha o cartão a aplicar", path: ["cartaoId"] });

export const bulkFixaSchema = z
  .object({ ids, op: z.enum(opsFixa), ym, ...alvoLote })
  .refine(temAlvo("categoriaId", "categoria"), { message: "Escolha a categoria a aplicar", path: ["categoriaId"] })
  .refine(temAlvo("cartaoId", "cartao"), { message: "Escolha o cartão a aplicar", path: ["cartaoId"] });

// ── Import de OFX ───────────────────────────────────────────────────────────
// O parse é no cliente; aqui cada item é revalidado como se fosse um lançamento
// manual. `fitid` é a chave de dedup (o service ignora o que já existe).
export const importMesSchema = z
  .object({
    mes: ym,
    cartaoId: z.string().uuid().nullable().optional(),
    itens: z
      .array(
        z.object({
          fitid: z.string().trim().max(255).nullable().optional(),
          data: ymd,
          descricao: z.string().trim().min(1, "Informe a descrição").max(120, "A descrição passa de 120 caracteres"),
          valor: z.coerce.number().positive("O valor precisa ser maior que zero"),
          categoriaId,
        })
      )
      .min(1, "Selecione pelo menos uma transação")
      .max(500, "No máximo 500 transações por import"),
  })
  .refine((d) => d.itens.every((i) => i.data.slice(0, 7) === d.mes), {
    message: "Toda data precisa estar dentro do mês",
    path: ["itens"],
  });

export const setRendaSchema = z.object({ valor });

// Quanto foi pago (valor absoluto) de uma fixa/despesa do mês.
export const setPagamentoSchema = z.object({ valorPago: valor });

export const ymParamSchema = z.object({ ym });

export type AddDespesaFixaDTO = z.infer<typeof addDespesaFixaSchema>;
export type UpdateDespesaFixaDTO = z.infer<typeof updateDespesaFixaSchema>;
export type AddDespesaMesDTO = z.infer<typeof addDespesaMesSchema>;
export type UpdateDespesaMesDTO = z.infer<typeof updateDespesaMesSchema>;
export type ImportMesDTO = z.infer<typeof importMesSchema>;
export type BulkMesDTO = z.infer<typeof bulkMesSchema>;
export type BulkFixaDTO = z.infer<typeof bulkFixaSchema>;
export type AddReceitaMesDTO = z.infer<typeof addReceitaMesSchema>;
export type UpdateReceitaMesDTO = z.infer<typeof updateReceitaMesSchema>;
