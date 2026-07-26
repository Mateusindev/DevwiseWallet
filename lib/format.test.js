import { describe, expect, it } from "bun:test";
import {
  fmtMoney,
  fmtMoneyCompact,
  fmtDate,
  fmtMonthLabel,
  fmtMonthShort,
  lastMonths,
  monthKey,
  todayISO,
  currentMonthKey,
  fmtMeses,
} from "./format.js";

// Espaço fino/NBSP do Intl pt-BR. Os testes de front dependem disso (ver
// TESTES-FRONTEND.md, convenção 1) — se o runtime mudar o separador, é aqui
// que quebra primeiro, não num getByText opaco de componente.
const NBSP = " ";

describe("fmtMoney", () => {
  it("formata BRL com NBSP entre símbolo e número", () => {
    expect(fmtMoney(1234.5)).toBe(`R$${NBSP}1.234,50`);
    expect(fmtMoney(1234.5)).not.toBe("R$ 1.234,50"); // espaço comum NÃO serve
  });

  it("arredonda pra 2 casas e mantém o sinal", () => {
    expect(fmtMoney(0.005)).toBe(`R$${NBSP}0,01`);
    expect(fmtMoney(-5)).toBe(`-R$${NBSP}5,00`);
  });

  it("entrada inválida vira zero (não NaN)", () => {
    expect(fmtMoney(0)).toBe(`R$${NBSP}0,00`);
    expect(fmtMoney(null)).toBe(`R$${NBSP}0,00`);
    expect(fmtMoney(undefined)).toBe(`R$${NBSP}0,00`);
    expect(fmtMoney("abc")).toBe(`R$${NBSP}0,00`);
  });

  it("aceita string numérica", () => {
    expect(fmtMoney("12.5")).toBe(`R$${NBSP}12,50`);
  });
});

describe("fmtMoneyCompact", () => {
  it("sem centavos, arredondando", () => {
    expect(fmtMoneyCompact(1234.5)).toBe(`R$${NBSP}1.235`);
    expect(fmtMoneyCompact(1234.4)).toBe(`R$${NBSP}1.234`);
    expect(fmtMoneyCompact(0)).toBe(`R$${NBSP}0`);
  });
});

describe("fmtDate", () => {
  it("ISO -> dd/mm/aaaa", () => {
    expect(fmtDate("2026-06-15")).toBe("15/06/2026");
  });

  it("vazio/nulo -> string vazia (usado como default de input)", () => {
    expect(fmtDate("")).toBe("");
    expect(fmtDate(null)).toBe("");
    expect(fmtDate(undefined)).toBe("");
  });

  it("ignora a parte de hora quando vem datetime", () => {
    // split("-") pega "15T00:00:00Z" no dia — comportamento atual, documentado
    expect(fmtDate("2026-06-15T00:00:00Z")).toBe("15T00:00:00Z/06/2026");
  });
});

describe("fmtMonthLabel / fmtMonthShort", () => {
  it("rótulo longo em pt-BR", () => {
    expect(fmtMonthLabel("2026-06")).toBe("Junho de 2026");
    expect(fmtMonthLabel("2026-01")).toBe("Janeiro de 2026");
    expect(fmtMonthLabel("2026-12")).toBe("Dezembro de 2026");
  });

  it("rótulo curto com ano de 2 dígitos", () => {
    expect(fmtMonthShort("2026-06")).toBe("jun/26");
    expect(fmtMonthShort("2026-03")).toBe("mar/26");
    expect(fmtMonthShort("2027-12")).toBe("dez/27");
  });

  it("aceita a chave completa de data (só olha YYYY-MM)", () => {
    expect(fmtMonthLabel("2026-06-15")).toBe("Junho de 2026");
  });
});

describe("lastMonths", () => {
  it("N meses terminando no informado, do mais antigo pro mais novo", () => {
    expect(lastMonths(3, "2026-06")).toEqual(["2026-04", "2026-05", "2026-06"]);
  });

  it("atravessa a virada de ano", () => {
    expect(lastMonths(4, "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("n = 1 devolve só o próprio mês; n = 0 devolve vazio", () => {
    expect(lastMonths(1, "2026-06")).toEqual(["2026-06"]);
    expect(lastMonths(0, "2026-06")).toEqual([]);
  });

  it("default é o mês corrente (última posição)", () => {
    const meses = lastMonths(2);
    expect(meses).toHaveLength(2);
    expect(meses[1]).toBe(currentMonthKey());
  });
});

describe("monthKey / todayISO / currentMonthKey", () => {
  it("monthKey corta a data ISO no mês", () => {
    expect(monthKey("2026-06-15")).toBe("2026-06");
  });

  it("todayISO é YYYY-MM-DD e currentMonthKey é o prefixo dele", () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(currentMonthKey()).toBe(todayISO().slice(0, 7));
  });
});

describe("fmtMeses", () => {
  it("Infinity e null viram travessão", () => {
    expect(fmtMeses(Infinity)).toBe("—");
    expect(fmtMeses(null)).toBe("—");
    expect(fmtMeses(undefined)).toBe("—");
  });

  it("0 ou negativo -> meta atingida", () => {
    expect(fmtMeses(0)).toBe("Meta atingida");
    expect(fmtMeses(-3)).toBe("Meta atingida");
  });

  it("fração abaixo de 1 tem texto próprio", () => {
    expect(fmtMeses(0.4)).toBe("menos de 1 mês");
  });

  it("arredonda pra cima e concorda o plural", () => {
    expect(fmtMeses(1)).toBe("1 mês");
    expect(fmtMeses(1.2)).toBe("2 meses");
    expect(fmtMeses(6)).toBe("6 meses");
  });
});
