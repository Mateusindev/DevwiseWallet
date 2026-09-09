import { describe, expect, it } from "bun:test";
import {
  addMonths,
  aplicaDivisao,
  devidoNoMes,
  linhaBase,
  mesQuitado,
  rateioDaLinha,
  shareComprometido,
  shareParcela,
  shareValorNoMes,
  validaRateio,
  valorEfetivoDono,
  type ShareLike,
} from "./rateio";

// Fixa parcelada com âncora: parcela 1 em 2026-06 de um total de 12.
const fixa = (over: Partial<ShareLike["despesaFixa"]> = {}) => ({
  valor: 200,
  parcelado: true,
  parcelaAtual: 1,
  totalParcelas: 12,
  parcelaMesRef: "2026-06",
  ...over,
});

const share = (over: Partial<ShareLike> = {}): ShareLike => ({
  id: "s1",
  contatoId: "c1",
  tipo: "linha",
  percentual: null,
  valor: null,
  mesRef: null,
  despesaFixa: null,
  despesaMes: null,
  ...over,
});

const comContato = (s: ShareLike, nome: string, status = "ativo") => ({ ...s, contato: { nome, status } });

describe("addMonths", () => {
  it("atravessa a virada de ano nos dois sentidos", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-06", 0)).toBe("2026-06");
  });
});

describe("parte de cada contato", () => {
  it("percentual e valor fixo saem da base da linha", () => {
    const base = share({ despesaFixa: fixa({ parcelado: false, totalParcelas: null, parcelaAtual: null, parcelaMesRef: null }) });
    expect(linhaBase(base)).toBe(200);
    expect(aplicaDivisao(200, { ...base, percentual: 50 })).toBe(100);
    expect(aplicaDivisao(200, { ...base, valor: 30 })).toBe(30);
    // sem percentual e sem valor = a linha inteira é do contato
    expect(aplicaDivisao(200, base)).toBe(200);
    // valor fixo maior que a linha não inventa dívida
    expect(aplicaDivisao(200, { ...base, valor: 500 })).toBe(200);
  });

  it("share de valor avulso só conta no mesRef (null = todo mês)", () => {
    const avulso = share({ tipo: "valor", valor: 40, mesRef: "2026-07" });
    expect(shareValorNoMes(avulso, "2026-07")).toBe(40);
    expect(shareValorNoMes(avulso, "2026-08")).toBe(0);
    expect(shareValorNoMes({ ...avulso, mesRef: null }, "2026-08")).toBe(40);
  });

  it("parcela encerrada zera a parte — a fixa some sozinha", () => {
    const s = share({ percentual: 50, despesaFixa: fixa({ totalParcelas: 3 }) }); // 06,07,08
    expect(shareValorNoMes(s, "2026-08")).toBe(100);
    expect(shareValorNoMes(s, "2026-09")).toBe(0);
    expect(shareParcela(s, "2026-08")).toEqual({ parcelaAtual: 3, totalParcelas: 3, restantes: 0 });
  });
});

describe("comprometido com adiantamento", () => {
  const s = share({ percentual: 50, despesaFixa: fixa({ totalParcelas: 12 }) }); // parte = 100/mês

  it("sem adiantamento é parcelas restantes × parte", () => {
    // em 2026-06 é a parcela 1: restam 11
    expect(shareComprometido(s, "2026-06")).toBe(1100);
  });

  it("adiantar 3 parcelas derruba o comprometido em 3 × parte", () => {
    expect(shareComprometido(s, "2026-06", "2026-09")).toBe(800);
  });

  it("adiantamento maior que o que resta não deixa o comprometido negativo", () => {
    expect(shareComprometido(s, "2026-06", "2030-01")).toBe(0);
  });
});

describe("devido no mês", () => {
  const s = share({ percentual: 50, despesaFixa: fixa() });

  it("share ignorado não é devido", () => {
    expect(devidoNoMes(s, "2026-06", { modo: "ignorado", quitadoAte: null })).toBe(0);
  });

  it("mês coberto por adiantamento não é devido", () => {
    expect(mesQuitado("2026-08", "2026-07")).toBe(true);
    expect(devidoNoMes(s, "2026-07", { modo: "fixa", quitadoAte: "2026-08" })).toBe(0);
    expect(devidoNoMes(s, "2026-09", { modo: "fixa", quitadoAte: "2026-08" })).toBe(100);
  });

  it("sem adoção nenhuma continua devendo", () => {
    expect(devidoNoMes(s, "2026-06", null)).toBe(100);
  });
});

describe("rateio da linha", () => {
  const aluguel = fixa({ valor: 1800, parcelado: false, parcelaAtual: null, totalParcelas: null, parcelaMesRef: null });

  it("divide entre N pessoas e devolve a sobra do dono", () => {
    const shares = [
      comContato(share({ id: "a", contatoId: "m", percentual: 33.33, despesaFixa: aluguel }), "Maria"),
      comContato(share({ id: "b", contatoId: "c", percentual: 33.33, despesaFixa: aluguel }), "Carlos"),
    ];
    const r = rateioDaLinha(1800, shares, "2026-06");
    expect(r.partes.map((p) => p.valor)).toEqual([599.94, 599.94]);
    expect(r.soma).toBe(1199.88);
    expect(r.sobraDono).toBe(600.12);
  });

  it("contato que recusou não entra na soma — o dono não passa a pagar menos", () => {
    const shares = [
      comContato(share({ id: "a", contatoId: "m", percentual: 50, despesaFixa: aluguel }), "Maria"),
      comContato(share({ id: "b", contatoId: "c", percentual: 50, despesaFixa: aluguel }), "Carlos", "recusado"),
    ];
    const r = rateioDaLinha(1800, shares, "2026-06");
    expect(r.soma).toBe(900);
    expect(r.sobraDono).toBe(900);
    expect(r.partes).toHaveLength(2); // continua listado
  });

  it("abateShares decide se a linha pesa cheia ou só a parte do dono", () => {
    const shares = [comContato(share({ percentual: 50, despesaFixa: aluguel }), "Maria")];
    expect(valorEfetivoDono({ valor: 1800, abateShares: false }, shares, "2026-06")).toBe(1800);
    expect(valorEfetivoDono({ valor: 1800, abateShares: true }, shares, "2026-06")).toBe(900);
  });
});

describe("validaRateio", () => {
  it("aceita a soma exatamente no limite", () => {
    expect(validaRateio(1800, [{ percentual: 60 }, { percentual: 40 }])).toBeNull();
    expect(validaRateio(1800, [{ valor: 1000 }, { valor: 800 }])).toBeNull();
  });

  it("barra percentual acima de 100", () => {
    expect(validaRateio(1800, [{ percentual: 60 }, { percentual: 50 }])).toContain("110");
  });

  it("barra valores fixos que passam da linha", () => {
    expect(validaRateio(1000, [{ valor: 600 }, { valor: 600 }])).toContain("passa do valor da linha");
  });

  it("percentual e valor fixo na mesma linha somam na mesma conta", () => {
    expect(validaRateio(1000, [{ percentual: 50 }, { valor: 500 }])).toBeNull();
    expect(validaRateio(1000, [{ percentual: 50 }, { valor: 600 }])).toContain("passa do valor da linha");
  });

  it("não deixa a mesma pessoa ter percentual e valor ao mesmo tempo", () => {
    expect(validaRateio(1000, [{ percentual: 50, valor: 100 }])).toContain("não os dois");
  });

  it("item sem percentual e sem valor vale a linha inteira", () => {
    expect(validaRateio(1000, [{}])).toBeNull();
    expect(validaRateio(1000, [{}, { percentual: 10 }])).toContain("passa do valor da linha");
  });
});
