import { describe, expect, it } from "bun:test";
import {
  taxaMensal,
  saldoProjetado,
  mesesParaMeta,
  monthsBetween,
  progresso,
  faltaParaMeta,
  totalAporteMensal,
  totalSaldo,
  totalDespesasFixas,
  movsDoMes,
  resumoMensal,
  mesesDisponiveis,
  rendaDoMes,
  despesasDoMes,
  receitasDoMes,
  orcamentoMes,
  mesesOrcamento,
  parcelaInfo,
  fixaContaNoMes,
  totalFixasNoMes,
  fixaValorPago,
  fixaFaltaPagar,
  fixaPaga,
  fixaParcial,
  espacoOcultoNoMes,
  espacosVisiveisNoMes,
  espacosOcultosNoMes,
  acento,
  ACENTO,
} from "./calc.js";
import { currentMonthKey } from "./format.js";

// Mês corrente é lido do relógio por todo default deste módulo. Datas fixas
// ("2026-03") quebrariam na virada do mês — tudo aqui é relativo ao hoje.
const mesAtual = () => currentMonthKey();
const addMeses = (n, ym = mesAtual()) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const dia = (ym, d = "15") => `${ym}-${d}`;

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

describe("monthsBetween", () => {
  it("conta meses decorridos, com sinal", () => {
    expect(monthsBetween("2026-01", "2026-06")).toBe(5);
    expect(monthsBetween("2026-06", "2026-01")).toBe(-5);
    expect(monthsBetween("2026-06", "2026-06")).toBe(0);
  });

  it("atravessa o ano", () => {
    expect(monthsBetween("2025-11", "2026-02")).toBe(3);
    expect(monthsBetween("2024-06", "2026-06")).toBe(24);
  });
});

describe("progresso / faltaParaMeta", () => {
  it("sem meta (null, 0 ou negativa) não há barra", () => {
    expect(progresso({ saldo: 100, meta: null })).toBeNull();
    expect(progresso({ saldo: 100, meta: 0 })).toBeNull();
    expect(progresso({ saldo: 100, meta: -10 })).toBeNull();
  });

  it("fração 0..1, clampada no topo", () => {
    expect(progresso({ saldo: 250, meta: 1000 })).toBe(0.25);
    expect(progresso({ saldo: 2000, meta: 1000 })).toBe(1);
  });

  it("faltaParaMeta nunca é negativa e é 0 sem meta", () => {
    expect(faltaParaMeta({ saldo: 400, meta: 1000 })).toBe(600);
    expect(faltaParaMeta({ saldo: 1200, meta: 1000 })).toBe(0);
    expect(faltaParaMeta({ saldo: 400, meta: null })).toBe(0);
  });
});

describe("totais", () => {
  const caixinhas = [
    { saldo: 100, aporteMensal: 50 },
    { saldo: 200 }, // sem aporte
    { saldo: 0, aporteMensal: 25 },
  ];

  it("soma saldo e aporte tratando ausente como 0", () => {
    expect(totalSaldo(caixinhas)).toBe(300);
    expect(totalAporteMensal(caixinhas)).toBe(75);
    expect(totalSaldo([])).toBe(0);
    expect(totalAporteMensal([])).toBe(0);
  });

  it("totalDespesasFixas ignora as pausadas", () => {
    const fixas = [
      { valor: 100, ativa: true },
      { valor: 50, ativa: false },
      { valor: 25, ativa: true },
    ];
    expect(totalDespesasFixas(fixas)).toBe(125);
  });
});

describe("movsDoMes", () => {
  const ym = mesAtual();
  const movs = [
    { data: dia(ym, "05"), valor: 10 },
    { data: dia(addMeses(-1), "20"), valor: 20 },
    { data: dia(ym, "28"), valor: 30 },
  ];

  it("filtra pelo mês e ordena da mais nova pra mais velha", () => {
    expect(movsDoMes(movs, ym).map((m) => m.valor)).toEqual([30, 10]);
  });

  it("default é o mês corrente", () => {
    expect(movsDoMes(movs)).toHaveLength(2);
  });

  it("mês sem movimentação devolve vazio", () => {
    expect(movsDoMes(movs, addMeses(-5))).toEqual([]);
  });
});

describe("resumoMensal", () => {
  const ym = mesAtual();
  const dados = {
    movimentacoes: [
      { data: dia(ym, "02"), tipo: "aporte", valor: 300 },
      { data: dia(ym, "10"), tipo: "despesa", valor: 200 },
      { data: dia(addMeses(-1), "10"), tipo: "despesa", valor: 999 }, // outro mês
    ],
    despesasFixas: [
      { valor: 500, ativa: true },
      { valor: 70, ativa: false },
    ],
    config: { rendaMensal: 2000 },
  };

  it("entrou/saiu/sobrou consideram só o mês pedido", () => {
    const r = resumoMensal(dados, ym);
    expect(r).toMatchObject({
      ym,
      entrou: 2000,
      aportado: 300,
      fixas: 500,
      variaveis: 200,
      saiu: 700,
      sobrou: 1300,
    });
  });

  it("naoAlocado desconta aportes e fixas da renda", () => {
    expect(resumoMensal(dados, ym).naoAlocado).toBe(1200);
  });

  it("renda ausente vira 0", () => {
    const r = resumoMensal({ ...dados, config: {} }, ym);
    expect(r.entrou).toBe(0);
    expect(r.sobrou).toBe(-700);
  });
});

describe("mesesDisponiveis", () => {
  it("meses do histórico + o corrente, do mais novo pro mais velho, sem repetir", () => {
    const anterior = addMeses(-1);
    const movs = [
      { data: dia(anterior, "10") },
      { data: dia(anterior, "20") },
      { data: dia(addMeses(-3), "01") },
    ];
    expect(mesesDisponiveis(movs)).toEqual([mesAtual(), anterior, addMeses(-3)]);
  });

  it("histórico vazio ainda oferece o mês corrente", () => {
    expect(mesesDisponiveis([])).toEqual([mesAtual()]);
  });
});

describe("rendaDoMes", () => {
  it("override do mês vence o config", () => {
    expect(rendaDoMes({ "2026-06": 3000 }, { rendaMensal: 2000 }, "2026-06")).toBe(3000);
  });

  it("sem override cai no salário fixo do config", () => {
    expect(rendaDoMes({}, { rendaMensal: 2000 }, "2026-06")).toBe(2000);
    expect(rendaDoMes(null, { rendaMensal: 2000 }, "2026-06")).toBe(2000);
  });

  it("override 0 é respeitado (não cai no fallback)", () => {
    expect(rendaDoMes({ "2026-06": 0 }, { rendaMensal: 2000 }, "2026-06")).toBe(0);
  });

  it("sem nada vira 0", () => {
    expect(rendaDoMes(null, null, "2026-06")).toBe(0);
  });
});

describe("despesasDoMes / receitasDoMes", () => {
  const itens = [
    { mes: "2026-06", data: "2026-06-05", valor: 10 },
    { mes: "2026-06", data: "2026-06-25", valor: 20 },
    { mes: "2026-05", data: "2026-05-31", valor: 30 },
  ];

  it("filtra pelo mês e ordena por data desc", () => {
    expect(despesasDoMes(itens, "2026-06").map((d) => d.valor)).toEqual([20, 10]);
    expect(receitasDoMes(itens, "2026-06").map((r) => r.valor)).toEqual([20, 10]);
  });

  it("lista ausente vira vazio", () => {
    expect(despesasDoMes(null, "2026-06")).toEqual([]);
    expect(receitasDoMes(undefined, "2026-06")).toEqual([]);
  });

  it("item sem data não quebra a ordenação", () => {
    const semData = [{ mes: "2026-06", valor: 1 }, { mes: "2026-06", data: "2026-06-02", valor: 2 }];
    expect(despesasDoMes(semData, "2026-06").map((d) => d.valor)).toEqual([2, 1]);
  });
});

describe("orcamentoMes", () => {
  const ym = "2026-06";
  const dados = {
    rendasMensais: { "2026-06": 5000 },
    receitasMes: [
      { mes: ym, data: "2026-06-03", valor: 400 },
      { mes: "2026-05", data: "2026-05-03", valor: 999 },
    ],
    despesasMes: [
      { mes: ym, data: "2026-06-08", valor: 150 },
      { mes: ym, data: "2026-06-09", valor: 50 },
    ],
    despesasFixas: [
      { valor: 1000, ativa: true },
      { valor: 300, ativa: false }, // pausada não conta
    ],
    config: { rendaMensal: 100 },
  };

  it("recebido = salário do mês + extras do mês", () => {
    const o = orcamentoMes(dados, ym);
    expect(o.salario).toBe(5000);
    expect(o.extras).toBe(400);
    expect(o.recebido).toBe(5400);
  });

  it("saiu = fixas que caem no mês + avulsas; sobrou é a diferença", () => {
    const o = orcamentoMes(dados, ym);
    expect(o.fixas).toBe(1000);
    expect(o.variaveis).toBe(200);
    expect(o.saiu).toBe(1200);
    expect(o.sobrou).toBe(4200);
  });

  it("parcela quitada sai do total de fixas sozinha", () => {
    const fixas = [
      { valor: 200, ativa: true, parcelado: true, totalParcelas: 3, parcelaAtual: 1, parcelaMesRef: "2026-01" },
    ];
    // âncora 1/3 em jan → em jun seria a 6ª parcela: quitada
    expect(orcamentoMes({ ...dados, despesasFixas: fixas }, ym).fixas).toBe(0);
  });

  it("sem renda no mês usa o salário fixo do config", () => {
    expect(orcamentoMes({ ...dados, rendasMensais: {} }, ym).salario).toBe(100);
  });

  it("default é o mês corrente", () => {
    expect(orcamentoMes({ ...dados, rendasMensais: {} }).ym).toBe(mesAtual());
  });
});

describe("mesesOrcamento", () => {
  it("une meses de renda, despesa e receita com o corrente, desc, sem repetir", () => {
    const meses = mesesOrcamento(
      { "2026-01": 1 },
      [{ mes: "2026-03" }, { mes: "2026-01" }],
      [{ mes: "2026-02" }]
    );
    expect(meses.slice(0, 1)).toEqual([mesAtual()]); // corrente é o mais novo aqui
    expect(meses).toContain("2026-03");
    expect(meses).toContain("2026-02");
    expect(meses).toContain("2026-01");
    expect(new Set(meses).size).toBe(meses.length);
    expect([...meses].sort((a, b) => b.localeCompare(a))).toEqual(meses);
  });

  it("tudo vazio/nulo devolve só o mês corrente", () => {
    expect(mesesOrcamento(null, null, null)).toEqual([mesAtual()]);
  });
});

describe("parcelaInfo", () => {
  const base = { parcelado: true, totalParcelas: 10, parcelaAtual: 3, parcelaMesRef: "2026-01", valor: 100 };

  it("não parcelada devolve null", () => {
    expect(parcelaInfo({ parcelado: false, totalParcelas: 10 })).toBeNull();
    expect(parcelaInfo({ parcelado: true, totalParcelas: 0 })).toBeNull();
    expect(parcelaInfo(null)).toBeNull();
  });

  it("auto-avança a partir da âncora", () => {
    expect(parcelaInfo(base, "2026-01").atual).toBe(3);
    expect(parcelaInfo(base, "2026-02").atual).toBe(4);
    expect(parcelaInfo(base, "2026-06").atual).toBe(8);
  });

  it("restantes e valorRestante olham pra frente do mês visto", () => {
    const p = parcelaInfo(base, "2026-01");
    expect(p.restantes).toBe(7);
    expect(p.valorRestante).toBe(700);
    expect(p.label).toBe("3/10");
  });

  it("depois da última parcela: ended, restantes 0, label no total", () => {
    const p = parcelaInfo(base, "2026-09"); // 3 + 8 = 11 > 10
    expect(p.atual).toBe(11);
    expect(p.ended).toBe(true);
    expect(p.restantes).toBe(0);
    expect(p.valorRestante).toBe(0);
    expect(p.label).toBe("10/10");
  });

  it("antes da primeira parcela: notStarted e label clampado em 0", () => {
    const p = parcelaInfo({ ...base, parcelaAtual: 1 }, "2025-11"); // 1 - 2 = -1
    expect(p.atual).toBe(-1);
    expect(p.notStarted).toBe(true);
    expect(p.label).toBe("0/10");
  });

  it("sem âncora, o mês visto é a âncora (parcela fica em parcelaAtual)", () => {
    expect(parcelaInfo({ ...base, parcelaMesRef: null }, "2026-08").atual).toBe(3);
  });

  it("default é o mês corrente", () => {
    const p = parcelaInfo({ ...base, parcelaMesRef: mesAtual() });
    expect(p.atual).toBe(3);
  });
});

describe("fixaContaNoMes / totalFixasNoMes", () => {
  it("pausada nunca conta", () => {
    expect(fixaContaNoMes({ ativa: false, valor: 10 }, "2026-06")).toBe(false);
  });

  it("não parcelada e ativa conta sempre", () => {
    expect(fixaContaNoMes({ ativa: true, valor: 10 }, "2026-06")).toBe(true);
  });

  it("parcelada conta só dentro da janela", () => {
    const d = { ativa: true, valor: 100, parcelado: true, totalParcelas: 3, parcelaAtual: 1, parcelaMesRef: "2026-03" };
    expect(fixaContaNoMes(d, "2026-02")).toBe(false); // não começou
    expect(fixaContaNoMes(d, "2026-03")).toBe(true);  // 1/3
    expect(fixaContaNoMes(d, "2026-05")).toBe(true);  // 3/3
    expect(fixaContaNoMes(d, "2026-06")).toBe(false); // quitada
  });

  it("totalFixasNoMes soma só o que cai no mês", () => {
    const fixas = [
      { ativa: true, valor: 100 },
      { ativa: false, valor: 999 },
      { ativa: true, valor: 50, parcelado: true, totalParcelas: 2, parcelaAtual: 1, parcelaMesRef: "2026-01" },
    ];
    expect(totalFixasNoMes(fixas, "2026-01")).toBe(150);
    expect(totalFixasNoMes(fixas, "2026-06")).toBe(100); // parcela já quitada
    expect(totalFixasNoMes(null, "2026-06")).toBe(0);
  });
});

describe("pagamentos de fixa", () => {
  const ym = "2026-06";
  const d = { id: "f1", valor: 200 };
  const pagos = (valorPago) => [{ despesaFixaId: "f1", ym, valorPago }];

  it("sem registro: 0 pago, falta tudo, nem paga nem parcial", () => {
    expect(fixaValorPago([], "f1", ym)).toBe(0);
    expect(fixaFaltaPagar([], d, ym)).toBe(200);
    expect(fixaPaga([], d, ym)).toBe(false);
    expect(fixaParcial([], d, ym)).toBe(false);
    expect(fixaValorPago(null, "f1", ym)).toBe(0);
  });

  it("pagamento parcial", () => {
    expect(fixaValorPago(pagos(50), "f1", ym)).toBe(50);
    expect(fixaFaltaPagar(pagos(50), d, ym)).toBe(150);
    expect(fixaPaga(pagos(50), d, ym)).toBe(false);
    expect(fixaParcial(pagos(50), d, ym)).toBe(true);
  });

  it("quitada (igual ou acima do valor): falta 0, não é parcial", () => {
    expect(fixaPaga(pagos(200), d, ym)).toBe(true);
    expect(fixaPaga(pagos(250), d, ym)).toBe(true);
    expect(fixaFaltaPagar(pagos(250), d, ym)).toBe(0);
    expect(fixaParcial(pagos(200), d, ym)).toBe(false);
  });

  it("registro de outro mês ou de outra fixa é ignorado", () => {
    expect(fixaValorPago(pagos(200), "f1", "2026-07")).toBe(0);
    expect(fixaValorPago([{ despesaFixaId: "f2", ym, valorPago: 200 }], "f1", ym)).toBe(0);
  });

  it("fixa de valor 0 nunca fica 'paga'", () => {
    expect(fixaPaga(pagos(0), { id: "f1", valor: 0 }, ym)).toBe(false);
  });
});

describe("espaços ocultos por mês", () => {
  const espacos = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const ocultos = [{ espacoId: "b", ym: "2026-06" }];

  it("oculto vale só no mês registrado", () => {
    expect(espacoOcultoNoMes(ocultos, "b", "2026-06")).toBe(true);
    expect(espacoOcultoNoMes(ocultos, "b", "2026-07")).toBe(false);
    expect(espacoOcultoNoMes(ocultos, "a", "2026-06")).toBe(false);
    expect(espacoOcultoNoMes(null, "a", "2026-06")).toBe(false);
  });

  it("visíveis mantêm a ordem original; ocultos são o complemento", () => {
    expect(espacosVisiveisNoMes(espacos, ocultos, "2026-06").map((e) => e.id)).toEqual(["a", "c"]);
    expect(espacosOcultosNoMes(espacos, ocultos, "2026-06").map((e) => e.id)).toEqual(["b"]);
    expect(espacosVisiveisNoMes(espacos, ocultos, "2026-07")).toHaveLength(3);
    expect(espacosOcultosNoMes(espacos, ocultos, "2026-07")).toEqual([]);
  });

  it("listas nulas não quebram", () => {
    expect(espacosVisiveisNoMes(null, null, "2026-06")).toEqual([]);
    expect(espacosOcultosNoMes(null, null, "2026-06")).toEqual([]);
  });
});

describe("acento", () => {
  it("cor conhecida devolve o próprio conjunto de classes", () => {
    expect(acento("rose")).toBe(ACENTO.rose);
    expect(acento("emerald").dot).toBe("#10b981");
  });

  it("cor desconhecida/ausente cai no azul", () => {
    expect(acento("chartreuse")).toBe(ACENTO.blue);
    expect(acento(null)).toBe(ACENTO.blue);
    expect(acento(undefined)).toBe(ACENTO.blue);
  });
});
