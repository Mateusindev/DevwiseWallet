import { describe, it, expect } from "bun:test";
import {
  addDespesaFixaSchema,
  addDespesaMesSchema,
  addReceitaMesSchema,
  bulkFixaSchema,
  bulkMesSchema,
  updateDespesaFixaSchema,
} from "./orcamento.dto";

// Erro do primeiro issue de um campo (é o que o front mostra ancorado nele).
const erroDe = (result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } }, campo: string) =>
  result.error?.issues.find((i) => i.path[0] === campo)?.message;

describe("addDespesaFixaSchema", () => {
  it("dia do vencimento vazio → 422 com issue no campo", () => {
    // O bug original: "" virava 0 no coerce e falhava no min(1) sem texto útil.
    const r = addDespesaFixaSchema.safeParse({ descricao: "Aluguel", valor: 100, diaVencimento: "" });
    expect(r.success).toBe(false);
    expect(erroDe(r, "diaVencimento")).toBe("Informe o dia do vencimento (1 a 31)");
  });

  it("dia do vencimento ausente cai no default 1", () => {
    const r = addDespesaFixaSchema.safeParse({ descricao: "Aluguel", valor: 100 });
    expect(r.success).toBe(true);
    expect(r.data?.diaVencimento).toBe(1);
  });

  it("dia fora de 1..31 → issue no campo", () => {
    expect(erroDe(addDespesaFixaSchema.safeParse({ valor: 1, diaVencimento: 32 }), "diaVencimento")).toBe(
      "O dia do vencimento vai de 1 a 31"
    );
  });

  it("descrição vazia e valor negativo → issue no campo certo", () => {
    expect(erroDe(addDespesaFixaSchema.safeParse({ descricao: "   ", valor: 1 }), "descricao")).toBe(
      "Informe a descrição"
    );
    expect(erroDe(addDespesaFixaSchema.safeParse({ valor: -1 }), "valor")).toBe("O valor não pode ser negativo");
  });

  it("parcela atual além do total → issue em parcelaAtual", () => {
    const r = addDespesaFixaSchema.safeParse({
      valor: 100, parcelado: true, parcelaAtual: 13, totalParcelas: 12,
    });
    expect(r.success).toBe(false);
    expect(erroDe(r, "parcelaAtual")).toBe("A parcela atual não pode passar do total de parcelas");
  });

  it("parcela igual ao total é válida", () => {
    expect(
      addDespesaFixaSchema.safeParse({ valor: 100, parcelado: true, parcelaAtual: 12, totalParcelas: 12 }).success
    ).toBe(true);
  });

  it("o mesmo vale no update", () => {
    const r = updateDespesaFixaSchema.safeParse({ parcelado: true, parcelaAtual: 5, totalParcelas: 3 });
    expect(erroDe(r, "parcelaAtual")).toBe("A parcela atual não pode passar do total de parcelas");
  });
});

describe("data dentro do mês", () => {
  it("despesa do mês com data de outro mês → issue em data", () => {
    const r = addDespesaMesSchema.safeParse({ mes: "2026-09", valor: 50, data: "2026-10-01" });
    expect(r.success).toBe(false);
    expect(erroDe(r, "data")).toBe("A data precisa estar dentro do mês");
  });

  it("receita do mês idem", () => {
    const r = addReceitaMesSchema.safeParse({ mes: "2026-09", valor: 50, data: "2026-08-31" });
    expect(erroDe(r, "data")).toBe("A data precisa estar dentro do mês");
  });

  it("data do próprio mês passa, e sem data também", () => {
    expect(addDespesaMesSchema.safeParse({ mes: "2026-09", valor: 50, data: "2026-09-30" }).success).toBe(true);
    expect(addDespesaMesSchema.safeParse({ mes: "2026-09", valor: 50 }).success).toBe(true);
  });
});

describe("schemas de lote", () => {
  // uuid v4 de verdade: o zod v4 confere versão e variante
  const ID = "11111111-1111-4111-8111-111111111111";

  it("op=categoria sem categoriaId → issue em categoriaId", () => {
    const r = bulkMesSchema.safeParse({ ids: [ID], op: "categoria" });
    expect(r.success).toBe(false);
    expect(erroDe(r, "categoriaId")).toBe("Escolha a categoria a aplicar");
  });

  it("categoriaId null é válido (tirar a categoria)", () => {
    expect(bulkMesSchema.safeParse({ ids: [ID], op: "categoria", categoriaId: null }).success).toBe(true);
  });

  it("op=cartao sem cartaoId → issue em cartaoId", () => {
    expect(erroDe(bulkMesSchema.safeParse({ ids: [ID], op: "cartao" }), "cartaoId")).toBe(
      "Escolha o cartão a aplicar"
    );
  });

  it("lista vazia ou acima de 200 ids → issue em ids", () => {
    expect(erroDe(bulkMesSchema.safeParse({ ids: [], op: "pagar" }), "ids")).toBe(
      "Selecione pelo menos uma linha"
    );
    const muitos = Array.from({ length: 201 }, () => ID);
    expect(erroDe(bulkMesSchema.safeParse({ ids: muitos, op: "pagar" }), "ids")).toBe(
      "No máximo 200 linhas por vez"
    );
  });

  it("fixas exigem ym e aceitam ativar/pausar", () => {
    expect(bulkFixaSchema.safeParse({ ids: [ID], op: "pausar" }).success).toBe(false);
    expect(bulkFixaSchema.safeParse({ ids: [ID], op: "pausar", ym: "2026-09" }).success).toBe(true);
    expect(bulkMesSchema.safeParse({ ids: [ID], op: "pausar" }).success).toBe(false);
  });
});
