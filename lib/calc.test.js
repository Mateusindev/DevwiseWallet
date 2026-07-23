import { describe, expect, it } from "bun:test";
import { taxaMensal, saldoProjetado, mesesParaMeta } from "./calc.js";

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
