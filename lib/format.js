// Locale-aware formatting (pt-BR / BRL).

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

export const fmtMoney = (n) => brl.format(Number(n) || 0);
export const fmtMoneyCompact = (n) => brlCompact.format(Number(n) || 0);

export function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// "2026-06" -> "Junho de 2026"
export function fmtMonthLabel(ym) {
  const [y, m] = ym.split("-");
  return `${MESES[Number(m) - 1]} de ${y}`;
}

const MESES_ABBR = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// "2026-06" -> "jun/26"
export function fmtMonthShort(ym) {
  const [y, m] = ym.split("-");
  return `${MESES_ABBR[Number(m) - 1]}/${y.slice(2)}`;
}

// Lista de N meses terminando em `ym` (inclusive), do mais antigo ao mais recente.
export function lastMonths(n, ym = currentMonthKey()) {
  const [y, m] = ym.split("-").map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export const monthKey = (iso) => iso.slice(0, 7); // "2026-06-15" -> "2026-06"

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const currentMonthKey = () => todayISO().slice(0, 7);

export function fmtMeses(n) {
  if (n === Infinity || n == null) return "—";
  if (n <= 0) return "Meta atingida";
  if (n < 1) return "menos de 1 mês";
  const r = Math.ceil(n);
  return r === 1 ? "1 mês" : `${r} meses`;
}
