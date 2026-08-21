import { describe, expect, it } from "bun:test";
import { taxaMensal, saldoProjetado, mesesParaMeta, horizonteOrcamento, mesesOrcamento, quitacaoFixa, quitacaoParceladas, quitacaoPorCartao } from "./calc.js";
import { addMonths, monthRange, currentMonthKey } from "./format.js";

describe("taxaMensal", () => {
  it("0 ou ausente vira 0", () => {
    expect(taxaMensal(0)).toBe(0);
    expect(taxaMensal(undefined)).toBe(0);
  });

  it("12% a.a. ≈ 0.9489% a.m. (efetiva, não 1%)", () => {
    expect(taxaMensal(12)).toBeCloseTo(0.009489, 5);
  });
});

describe("saldoProjetado", () => {
  it("sem taxa: linear saldo + aporte·n", () => {
    expect(saldoProjetado({ saldo: 100, aporteMensal: 50, taxaJuros: 0 }, 10)).toBe(600);
  });

  it("com taxa: FV composto de saldo + anuidade dos aportes", () => {
    // 1000 a 12% a.a. por 12 meses = 1120; anuidade dos aportes = 100·(0.12/i)
    const i = Math.pow(1.12, 1 / 12) - 1;
    const fv = saldoProjetado({ saldo: 1000, aporteMensal: 100, taxaJuros: 12 }, 12);
    expect(fv).toBeCloseTo(1120 + 100 * (0.12 / i), 6);
  });

  it("n = 0 devolve o saldo atual", () => {
    expect(saldoProjetado({ saldo: 500, aporteMensal: 100, taxaJuros: 12 }, 0)).toBeCloseTo(500, 6);
  });
});

describe("mesesParaMeta", () => {
  const cx = (over = {}) => ({ saldo: 0, aporteMensal: 0, taxaJuros: 0, meta: null, ...over });

  it("sem meta -> null; meta atingida -> 0", () => {
    expect(mesesParaMeta(cx())).toBeNull();
    expect(mesesParaMeta(cx({ meta: 100, saldo: 100 }))).toBe(0);
  });

  it("sem aporte nem taxa -> Infinity", () => {
    expect(mesesParaMeta(cx({ meta: 100, saldo: 10 }))).toBe(Infinity);
  });

  it("sem taxa: falta / aporte (comportamento antigo)", () => {
    expect(mesesParaMeta(cx({ meta: 1000, saldo: 400, aporteMensal: 100 }))).toBe(6);
  });

  it("com taxa: menos meses que o linear", () => {
    const linear = mesesParaMeta(cx({ meta: 100000, saldo: 10000, aporteMensal: 1000 }));
    const composto = mesesParaMeta(cx({ meta: 100000, saldo: 10000, aporteMensal: 1000, taxaJuros: 12 }));
    expect(composto).toBeLessThan(linear);
    // conferido contra o FV: no mês n a projeção cruza a meta
    expect(saldoProjetado(cx({ saldo: 10000, aporteMensal: 1000, taxaJuros: 12 }), composto)).toBeCloseTo(100000, 0);
  });

  it("só rendimento, sem aporte: converge", () => {
    // 1000 -> 2000 a 12% a.a.: n = ln(2)/ln(1.12^(1/12)) ≈ 73.4 meses
    const n = mesesParaMeta(cx({ meta: 2000, saldo: 1000, taxaJuros: 12 }));
    expect(n).toBeCloseTo(73.4, 0);
  });

  it("saldo 0 e sem aporte, mesmo com taxa -> Infinity", () => {
    expect(mesesParaMeta(cx({ meta: 100, saldo: 0, taxaJuros: 12 }))).toBe(Infinity);
  });
});

describe("addMonths / monthRange", () => {
  it("vira o ano nas duas direções", () => {
    expect(addMonths("2026-08", 4)).toBe("2026-12");
    expect(addMonths("2026-08", 6)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("monthRange inclui as duas pontas, do mais antigo ao mais recente", () => {
    expect(monthRange(-1, 1, "2026-01")).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
});

describe("horizonteOrcamento", () => {
  it("vai do mês visto até dezembro do ano corrente", () => {
    const h = horizonteOrcamento("2026-08");
    expect(h[0]).toBe("2026-08");
    expect(h).toContain("2026-12");
  });

  it("no fim do ano não encolhe: mantém 6 meses à frente", () => {
    expect(horizonteOrcamento("2026-11")).toEqual([
      "2026-11", "2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05",
    ]);
  });
});

describe("mesesOrcamento", () => {
  it("junta meses com lançamento e o horizonte, sem repetir, do mais novo pro mais velho", () => {
    const meses = mesesOrcamento({ "2025-01": 5000 }, [{ mes: "2025-03" }], [{ mes: currentMonthKey() }]);
    expect(new Set(meses).size).toBe(meses.length);
    expect(meses).toContain("2025-01");
    expect(meses).toContain("2025-03");
    expect(meses[0]).toBe(horizonteOrcamento().at(-1)); // ordenado desc: o mais à frente primeiro
    expect(meses.at(-1)).toBe("2025-01");
  });
});

// Fixa parcelada ancorada: parcela `atual` no mês `ref`.
const parcelada = (over = {}) => ({
  id: "f1", descricao: "Sofá", valor: 200, ativa: true,
  parcelado: true, parcelaAtual: 3, totalParcelas: 10, parcelaMesRef: "2026-08",
  ...over,
});

describe("quitacaoFixa", () => {
  it("não parcelada devolve null", () => {
    expect(quitacaoFixa([], { ...parcelada(), parcelado: false }, "2026-08")).toBeNull();
  });

  it("já quitada devolve null", () => {
    // âncora parcela 10/10 em ago → em set já passou
    expect(quitacaoFixa([], parcelada({ parcelaAtual: 10 }), "2026-09")).toBeNull();
  });

  it("conta a parcela do mês visto + as restantes", () => {
    const q = quitacaoFixa([], parcelada(), "2026-08");
    expect(q.parcelas).toBe(8); // 3..10
    expect(q.falta).toBe(1600);
    expect(q.contrato).toBe(2000);
    expect(q.quitado).toBe(400); // 2 parcelas pagas
    expect(q.ultimoMes).toBe("2027-03"); // ago + 7
  });

  it("auto-avança a parcela pelo mês visto", () => {
    const q = quitacaoFixa([], parcelada(), "2026-10");
    expect(q.atual).toBe(5);
    expect(q.parcelas).toBe(6); // 5..10
    expect(q.falta).toBe(1200);
    expect(q.ultimoMes).toBe("2027-03"); // mesma data final
  });

  it("desconta o que já foi pago da parcela do mês visto", () => {
    const pagos = [{ despesaFixaId: "f1", ym: "2026-08", valorPago: 50 }];
    const q = quitacaoFixa(pagos, parcelada(), "2026-08");
    expect(q.falta).toBe(1550);
    expect(q.faltaNoMes).toBe(150);
  });

  it("parcela que ainda não começou não cobra no mês visto", () => {
    // âncora parcela 1 em out, visto em ago → efetiva -1
    const q = quitacaoFixa([], parcelada({ parcelaAtual: 1, parcelaMesRef: "2026-10" }), "2026-08");
    expect(q.notStarted).toBe(true);
    expect(q.faltaNoMes).toBe(0);
    expect(q.parcelas).toBe(10);
    expect(q.primeiroMes).toBe("2026-10");
    expect(q.ultimoMes).toBe("2027-07"); // 10ª parcela
  });

  it("última parcela: 1 parcela, quita no próprio mês", () => {
    const q = quitacaoFixa([], parcelada({ parcelaAtual: 10 }), "2026-08");
    expect(q.parcelas).toBe(1);
    expect(q.falta).toBe(200);
    expect(q.ultimoMes).toBe("2026-08");
    expect(q.progresso).toBeCloseTo(0.9, 6);
  });
});

describe("quitacaoParceladas", () => {
  it("ignora fixa pausada e não parcelada", () => {
    const fixas = [
      parcelada(),
      parcelada({ id: "f2", ativa: false }),
      { id: "f3", descricao: "Luz", valor: 300, ativa: true, parcelado: false, totalParcelas: null, parcelaAtual: null, parcelaMesRef: null },
    ];
    const q = quitacaoParceladas(fixas, [], "2026-08");
    expect(q.itens.map((i) => i.id)).toEqual(["f1"]);
    expect(q.falta).toBe(1600);
  });

  it("soma dívidas e usa a última parcela mais distante como fim", () => {
    const fixas = [
      parcelada(),                                                       // fim 2027-03, falta 1600
      parcelada({ id: "f2", descricao: "TV", valor: 100, parcelaAtual: 1, totalParcelas: 3 }), // fim 2026-10, falta 300
    ];
    const q = quitacaoParceladas(fixas, [], "2026-08");
    expect(q.falta).toBe(1900);
    expect(q.faltaNoMes).toBe(300);
    expect(q.ultimoMes).toBe("2027-03");
    expect(q.mesesAte).toBe(7);
    expect(q.cronograma).toHaveLength(8);
    expect(q.itens.map((i) => i.id)).toEqual(["f1", "f2"]); // maior dívida primeiro
  });

  it("cronograma tem só as contas que caem em cada mês", () => {
    const fixas = [
      parcelada(),
      parcelada({ id: "f2", descricao: "TV", valor: 100, parcelaAtual: 1, totalParcelas: 3 }),
    ];
    const { cronograma } = quitacaoParceladas(fixas, [], "2026-08");
    expect(cronograma[0]).toEqual({ ym: "2026-08", valor: 300, itens: 2 });
    expect(cronograma[2]).toEqual({ ym: "2026-10", valor: 300, itens: 2 }); // 3ª e última da TV
    expect(cronograma[3]).toEqual({ ym: "2026-11", valor: 200, itens: 1 }); // TV quitada
    expect(cronograma.at(-1)).toEqual({ ym: "2027-03", valor: 200, itens: 1 });
  });

  it("cronograma desconta pagamento parcial só no mês visto", () => {
    const pagos = [{ despesaFixaId: "f1", ym: "2026-08", valorPago: 200 }];
    const { cronograma, faltaNoMes, falta } = quitacaoParceladas([parcelada()], pagos, "2026-08");
    expect(cronograma[0].valor).toBe(0); // parcela do mês já paga
    expect(faltaNoMes).toBe(0);
    expect(falta).toBe(1400);
    expect(cronograma[1].valor).toBe(200);
  });

  it("sem parceladas: agregado zerado", () => {
    const q = quitacaoParceladas([], [], "2026-08");
    expect(q.itens).toEqual([]);
    expect(q.falta).toBe(0);
    expect(q.ultimoMes).toBeNull();
    expect(q.cronograma).toEqual([]);
  });
});

describe("quitacaoPorCartao", () => {
  const fixas = [
    parcelada({ id: "a", descricao: "Sofá", cartaoId: "c1" }),                                        // falta 1600
    parcelada({ id: "b", descricao: "TV", cartaoId: "c2", valor: 100, parcelaAtual: 1, totalParcelas: 3 }), // falta 300
    parcelada({ id: "c", descricao: "Fogão", cartaoId: null, valor: 50, parcelaAtual: 1, totalParcelas: 4 }), // carnê, falta 200
  ];

  it("agrupa por cartão, maior dívida primeiro e sem cartão no fim", () => {
    const g = quitacaoPorCartao(fixas, [], "2026-08");
    expect(g.map((x) => x.cartaoId)).toEqual(["c1", "c2", null]);
    expect(g.map((x) => x.falta)).toEqual([1600, 300, 200]);
  });

  it("cada grupo tem seu próprio fim e cronograma", () => {
    const [c1, c2] = quitacaoPorCartao(fixas, [], "2026-08");
    expect(c1.ultimoMes).toBe("2027-03");
    expect(c1.cronograma).toHaveLength(8);
    expect(c2.ultimoMes).toBe("2026-10");
    expect(c2.cronograma).toHaveLength(3);
  });

  it("grupo sem parcelada em aberto sai da lista", () => {
    // c2 já quitou (parcela 3/3 ancorada em ago, visto em set)
    const g = quitacaoPorCartao(
      [fixas[0], parcelada({ id: "b", cartaoId: "c2", parcelaAtual: 10 })],
      [],
      "2026-09"
    );
    expect(g.map((x) => x.cartaoId)).toEqual(["c1"]);
  });

  it("sem parceladas devolve lista vazia", () => {
    expect(quitacaoPorCartao([], [], "2026-08")).toEqual([]);
    expect(quitacaoPorCartao(undefined, undefined, "2026-08")).toEqual([]);
  });
});
