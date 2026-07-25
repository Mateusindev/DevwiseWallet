import { describe, expect, it } from "bun:test";
import {
  round,
  monthsBetween,
  effectiveParcela,
  parcelaAtivaNoMes,
  parcelaView,
  parcelaWrite,
  parseDate,
  isoDate,
  isoToday,
  currentMonth,
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
  it("undefined também", () => {
    expect(num(undefined)).toBe(0);
    expect(numOrNull(undefined)).toBeNull();
  });
  it("number passa direto", () => {
    expect(num(12.5)).toBe(12.5);
    expect(numOrNull(12.5)).toBe(12.5);
  });
  it("Decimal do Prisma vira number via toNumber()", () => {
    const decimalLike = { toNumber: () => 42.75 } as never;
    expect(num(decimalLike)).toBe(42.75);
    expect(numOrNull(decimalLike)).toBe(42.75);
  });
});

describe("datas", () => {
  it("parseDate → UTC, isoDate roundtrip", () => {
    const d = parseDate("2026-06-15");
    expect(d.toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(isoDate(d)).toBe("2026-06-15");
  });

  it("isoToday / currentMonth têm o formato esperado e são consistentes entre si", () => {
    const hoje = isoToday();
    expect(hoje).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(currentMonth()).toMatch(/^\d{4}-\d{2}$/);
    expect(hoje.startsWith(currentMonth())).toBe(true);
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

describe("parcelaView", () => {
  it("expõe só cartão + campos de parcela, ignorando o resto da linha", () => {
    const despesa = {
      id: "df-1",
      descricao: "Notebook",
      valor: 200,
      cartaoId: "ct-1",
      parcelado: true,
      parcelaAtual: 3,
      totalParcelas: 12,
      parcelaMesRef: "2026-06",
    };
    expect(parcelaView(despesa)).toEqual({
      cartaoId: "ct-1",
      parcelado: true,
      parcelaAtual: 3,
      totalParcelas: 12,
      parcelaMesRef: "2026-06",
    });
  });

  it("linha sem cartão nem parcelamento sai toda nula", () => {
    expect(
      parcelaView({ cartaoId: null, parcelado: false, parcelaAtual: null, totalParcelas: null, parcelaMesRef: null })
    ).toEqual({ cartaoId: null, parcelado: false, parcelaAtual: null, totalParcelas: null, parcelaMesRef: null });
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

  it("dto vazio = não parcelado sem cartão", () => {
    expect(parcelaWrite({}, "2026-06")).toEqual({
      cartaoId: null,
      parcelado: false,
      parcelaAtual: null,
      totalParcelas: null,
      parcelaMesRef: null,
    });
  });

  it("parcelado sem totalParcelas mantém total null (parcelamento aberto)", () => {
    expect(parcelaWrite({ parcelado: true, parcelaAtual: 4 }, "2026-06")).toMatchObject({
      parcelaAtual: 4,
      totalParcelas: null,
      parcelaMesRef: "2026-06",
    });
  });

  it("round-trip: o que parcelaWrite grava é o que parcelaView devolve", () => {
    const gravado = parcelaWrite({ cartaoId: "ct-1", parcelado: true, parcelaAtual: 2, totalParcelas: 6 }, "2026-06");
    expect(parcelaView(gravado)).toEqual(gravado);
  });
});
