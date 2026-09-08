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

export const addReceitaMesSchema = z
  .object({
    mes: ym,
    descricao: descricao("Receita extra"),
    valor,
    data: ymd.optional(),
  })
  .refine(dataNoMes, dataNoMesOpts);

export const updateReceitaMesSchema = z.object({
  descricao: z.string().trim().min(1, "Informe a descrição").max(120, "A descrição passa de 120 caracteres").optional(),
  valor: valor.optional(),
  data: ymd.optional(),
});

export const setRendaSchema = z.object({ valor });

// Quanto foi pago (valor absoluto) de uma fixa/despesa do mês.
export const setPagamentoSchema = z.object({ valorPago: valor });

export const ymParamSchema = z.object({ ym });

export type AddDespesaFixaDTO = z.infer<typeof addDespesaFixaSchema>;
export type UpdateDespesaFixaDTO = z.infer<typeof updateDespesaFixaSchema>;
export type AddDespesaMesDTO = z.infer<typeof addDespesaMesSchema>;
export type UpdateDespesaMesDTO = z.infer<typeof updateDespesaMesSchema>;
export type AddReceitaMesDTO = z.infer<typeof addReceitaMesSchema>;
export type UpdateReceitaMesDTO = z.infer<typeof updateReceitaMesSchema>;
