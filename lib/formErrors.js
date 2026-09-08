// Erro de API → texto que o usuário lê. Sem React, unit-testável.
//
// O back responde 422 com `{ error, issues }` (issues do zod). `issuesToFields`
// vira `{ campo: "mensagem" }` pro `Field` marcar o campo culpado;
// `mensagemDeErro` cobre o resto (rede, 403, 500) pro banner do topo.

// Mensagens por código de issue. Refine/custom não entra aqui de propósito: a
// mensagem do DTO é mais específica que qualquer texto genérico.
const PORCODIGO = {
  invalid_type: (i) =>
    i.expected === "int" ? "Use um número inteiro." : ehAusente(i) ? "Campo obrigatório." : "Valor inválido.",
  invalid_format: () => "Formato inválido.",
  invalid_value: () => "Opção inválida.",
  not_multiple_of: (i) => `Precisa ser múltiplo de ${i.divisor}.`,
  too_small: (i) =>
    i.origin === "string"
      ? Number(i.minimum) <= 1
        ? "Campo obrigatório."
        : `Escreva pelo menos ${i.minimum} caracteres.`
      : `Precisa ser ${i.inclusive === false ? "maior que" : "no mínimo"} ${i.minimum}.`,
  too_big: (i) =>
    i.origin === "string"
      ? `Máximo de ${i.maximum} caracteres.`
      : `Precisa ser ${i.inclusive === false ? "menor que" : "no máximo"} ${i.maximum}.`,
};

const ehAusente = (i) => i.input === undefined || i.received === "undefined";

// [{ path: ["diaVencimento"], code: "too_small", … }] → { diaVencimento: "…" }
// Primeira issue de cada campo ganha (é a que o usuário conserta primeiro).
export function issuesToFields(issues) {
  const out = {};
  for (const i of issues || []) {
    const campo = Array.isArray(i?.path) ? String(i.path[0] ?? "") : "";
    if (!campo || out[campo]) continue;
    const texto = PORCODIGO[i.code];
    out[campo] = texto ? texto(i) : i.message || "Valor inválido.";
  }
  return out;
}

// ── Validadores de campo (cliente) ──────────────────────────────────────────
// Espelham o zod do back, mas em pt-BR e antes da rede. Devolvem "" quando ok.

// `campo` entra na frase com artigo ("a descrição", "o nome") — evita ter que
// concordar gênero em cada mensagem.
export function texto(v, { obrigatorio = false, min = 0, max = 0, campo = "este campo" } = {}) {
  const s = String(v ?? "").trim();
  const nome = campo.toLowerCase();
  if (!s) return obrigatorio ? `Informe ${nome}.` : "";
  if (min && s.length < min) return `Escreva pelo menos ${min} caracteres em ${nome}.`;
  if (max && s.length > max) return `${campo} passa de ${max} caracteres.`;
  return "";
}

// 'YYYY-MM-DD' que existe no calendário (rejeita 2026-02-31).
export function dataValida(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [a, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export const emailValido = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v ?? "").trim());

// Texto do banner de topo. Só sobra o que não tem campo pra ancorar.
export function mensagemDeErro(e) {
  if (!e) return "";
  const status = e.status;
  if (status === 401) return "Sua sessão expirou. Entre de novo.";
  if (status === 403) return "Você não tem permissão para isso.";
  if (status === 404) return "Esse registro não existe mais — recarregue a página.";
  if (status === 409) return e.message || "Esse registro já existe.";
  if (status === 422) return e.message || "Confira os campos destacados.";
  if (status >= 500) return "O servidor falhou. Tente de novo em instantes.";
  // fetch rejeitado (offline, servidor fora) não tem status nem body.
  if (status == null && /fetch|network|Load failed/i.test(e.message || "")) {
    return "Sem conexão com o servidor.";
  }
  return e.message || "Algo deu errado.";
}
