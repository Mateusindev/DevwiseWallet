import { describe, it, expect } from "bun:test";
import { dataValida, emailValido, issuesToFields, mensagemDeErro, texto } from "./formErrors.js";

describe("issuesToFields", () => {
  it("mapeia issue por campo com texto em pt-BR", () => {
    const issues = [
      { path: ["diaVencimento"], code: "too_small", minimum: 1, origin: "number", inclusive: true },
      { path: ["descricao"], code: "too_small", minimum: 1, origin: "string" },
    ];
    expect(issuesToFields(issues)).toEqual({
      diaVencimento: "Precisa ser no mínimo 1.",
      descricao: "Campo obrigatório.",
    });
  });

  it("primeira issue do campo ganha", () => {
    const issues = [
      { path: ["valor"], code: "too_small", minimum: 0, origin: "number", inclusive: true },
      { path: ["valor"], code: "invalid_type", expected: "number" },
    ];
    expect(issuesToFields(issues).valor).toBe("Precisa ser no mínimo 0.");
  });

  it("usa a mensagem do DTO quando o código não tem tradução (refine)", () => {
    const issues = [{ path: ["parcelaAtual"], code: "custom", message: "A parcela atual não pode passar do total" }];
    expect(issuesToFields(issues).parcelaAtual).toBe("A parcela atual não pode passar do total");
  });

  it("ignora issue sem path e aceita entrada vazia", () => {
    expect(issuesToFields([{ code: "custom", message: "x" }])).toEqual({});
    expect(issuesToFields(undefined)).toEqual({});
  });
});

describe("mensagemDeErro", () => {
  it("traduz por status", () => {
    expect(mensagemDeErro({ status: 403 })).toBe("Você não tem permissão para isso.");
    expect(mensagemDeErro({ status: 500 })).toBe("O servidor falhou. Tente de novo em instantes.");
  });

  it("fetch rejeitado (sem status) vira falta de conexão", () => {
    expect(mensagemDeErro(new TypeError("Failed to fetch"))).toBe("Sem conexão com o servidor.");
  });

  it("erro comum mantém a própria mensagem", () => {
    expect(mensagemDeErro(new Error("Espaço não encontrado"))).toBe("Espaço não encontrado");
  });
});

describe("texto", () => {
  it("exige quando obrigatório", () => {
    expect(texto("   ", { obrigatorio: true, campo: "A descrição" })).toBe("Informe a descrição.");
    expect(texto("", { campo: "A nota" })).toBe("");
  });

  it("respeita max", () => {
    expect(texto("a".repeat(121), { max: 120, campo: "A descrição" })).toBe("A descrição passa de 120 caracteres.");
    expect(texto("ok", { obrigatorio: true, max: 120, campo: "A descrição" })).toBe("");
  });
});

describe("dataValida / emailValido", () => {
  it("rejeita data que não existe no calendário", () => {
    expect(dataValida("2026-09-08")).toBe(true);
    expect(dataValida("2026-02-31")).toBe(false);
    expect(dataValida("2026-9-8")).toBe(false);
    expect(dataValida("")).toBe(false);
    expect(dataValida(null)).toBe(false);
  });

  it("valida email", () => {
    expect(emailValido("maria@email.com")).toBe(true);
    expect(emailValido("maria@email")).toBe(false);
    expect(emailValido("maria")).toBe(false);
  });
});
