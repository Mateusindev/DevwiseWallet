import { describe, expect, it } from "bun:test";
import {
  round,
  monthsBetween,
  effectiveParcela,
  parcelaAtivaNoMes,
  parcelaWrite,
  parseDate,
  isoDate,
  num,
  numOrNull,
} from "./serialize";

describe("round", () => {
  it("arredonda pra 2 casas", () => {
    expect(round(10.005)).toBe(10.01);
    expect(round(10.004)).toBe(10);
    expect(round(0.1 + 0.2)).toBe(0.3);
  });
});

describe("num / numOrNull", () => {
  it("null vira 0 / null", () => {
    expect(num(null)).toBe(0);
    expect(numOrNull(null)).toBeNull();
  });
  it("number passa direto", () => {
    expect(num(12.5)).toBe(12.5);
    expect(numOrNull(12.5)).toBe(12.5);
  });
});

describe("datas", () => {
  it("parseDate → UTC, isoDate roundtrip", () => {
    const d = parseDate("2026-06-15");
    expect(d.toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(isoDate(d)).toBe("2026-06-15");
  });
});

describe("monthsBetween", () => {
  it("mesmo mês = 0", () => expect(monthsBetween("2026-06", "2026-06")).toBe(0));
  it("avança e cruza ano", () => expect(monthsBetween("2025-11", "2026-02")).toBe(3));
  it("pode ser negativo", () => expect(monthsBetween("2026-06", "2026-04")).toBe(-2));
});

describe("effectiveParcela", () => {
  const fixa = { parcelado: true, parcelaAtual: 3, totalParcelas: 12, parcelaMesRef: "2026-06" };

  it("auto-avança a partir da âncora", () => {
    expect(effectiveParcela(fixa, "2026-06")).toBe(3);
    expect(effectiveParcela(fixa, "2026-08")).toBe(5);
  });

  it("não parcelado → null", () => {
    expect(effectiveParcela({ ...fixa, parcelado: false }, "2026-06")).toBeNull();
  });

  it("sem âncora usa o próprio ym", () => {
    expect(effectiveParcela({ ...fixa, parcelaMesRef: null }, "2026-09")).toBe(3);
  });
});

describe("parcelaAtivaNoMes", () => {
  const fixa = { parcelado: true, parcelaAtual: 11, totalParcelas: 12, parcelaMesRef: "2026-06" };

  it("dentro da janela conta", () => {
    expect(parcelaAtivaNoMes(fixa, "2026-06")).toBe(true);
    expect(parcelaAtivaNoMes(fixa, "2026-07")).toBe(true); // parcela 12/12
  });

  it("auto-quita após o fim", () => {
    expect(parcelaAtivaNoMes(fixa, "2026-08")).toBe(false); // parcela 13 > 12
  });

  it("antes da janela não conta", () => {
    expect(parcelaAtivaNoMes({ ...fixa, parcelaAtual: 1 }, "2026-05")).toBe(false); // parcela 0
  });

  it("não parcelado sempre conta", () => {
    expect(parcelaAtivaNoMes({ parcelado: false, parcelaAtual: null, totalParcelas: null, parcelaMesRef: null }, "2026-06")).toBe(true);
  });
});

describe("parcelaWrite", () => {
  it("não parcelado zera tudo", () => {
    expect(parcelaWrite({ cartaoId: "c1", parcelado: false, parcelaAtual: 3, totalParcelas: 12 }, "2026-06")).toEqual({
      cartaoId: "c1",
      parcelado: false,
      parcelaAtual: null,
      totalParcelas: null,
      parcelaMesRef: null,
    });
  });

  it("parcelado ancora no refMonth e default parcela 1", () => {
    expect(parcelaWrite({ parcelado: true, totalParcelas: 10 }, "2026-06")).toEqual({
      cartaoId: null,
      parcelado: true,
      parcelaAtual: 1,
      totalParcelas: 10,
      parcelaMesRef: "2026-06",
    });
  });
});
