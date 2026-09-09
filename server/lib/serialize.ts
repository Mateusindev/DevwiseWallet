import { Prisma } from "@prisma/client";

type DecimalLike = Prisma.Decimal | number | null | undefined;

// Decimal do Prisma -> number (JSON limpo pro front).
export function num(v: DecimalLike): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : v.toNumber();
}

// Decimal opcional -> number | null (preserva "sem meta").
export function numOrNull(v: DecimalLike): number | null {
  if (v == null) return null;
  return typeof v === "number" ? v : v.toNumber();
}

// Date -> 'YYYY-MM-DD' (mesmo formato do mock).
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// 'YYYY-MM-DD' -> Date em UTC (evita drift de timezone).
export function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export const isoToday = (): string => new Date().toISOString().slice(0, 10);

export const currentMonth = (): string => new Date().toISOString().slice(0, 7);

// Arredonda pra 2 casas (espelha round() do mock).
export function round(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

// Meses decorridos de a → b ('YYYY-MM'). Pode ser negativo.
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

// 'YYYY-MM' + n meses.
export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

type ParcelaShape = {
  parcelado: boolean;
  parcelaAtual: number | null;
  totalParcelas: number | null;
  parcelaMesRef: string | null;
};

// Parcela efetiva no mês `ym`, auto-avançada a partir da âncora (parcelaMesRef).
// Ex.: âncora '2026-06' parcela 3 → em '2026-08' vira 5.
export function effectiveParcela(d: ParcelaShape, ym: string): number | null {
  if (!d.parcelado || !d.totalParcelas) return null;
  const base = d.parcelaAtual ?? 1;
  const ref = d.parcelaMesRef ?? ym;
  return base + monthsBetween(ref, ym);
}

// A parcela cai no mês `ym`? (dentro da janela 1..total). Auto-quita após o fim.
export function parcelaAtivaNoMes(d: ParcelaShape, ym: string): boolean {
  const eff = effectiveParcela(d, ym);
  if (eff == null) return true; // não parcelado → sempre conta
  return eff >= 1 && eff <= (d.totalParcelas as number);
}

// Campos de cartão + parcelamento de uma despesa (fixa ou do mês).
export function parcelaView(d: {
  cartaoId: string | null;
  parcelado: boolean;
  parcelaAtual: number | null;
  totalParcelas: number | null;
  parcelaMesRef: string | null;
}) {
  return {
    cartaoId: d.cartaoId,
    parcelado: d.parcelado,
    parcelaAtual: d.parcelaAtual,
    totalParcelas: d.totalParcelas,
    parcelaMesRef: d.parcelaMesRef,
  };
}

// Normaliza campos de parcela vindos do DTO pra gravar no banco.
// `refMonth` = mês a que parcelaAtual se refere (âncora do auto-avanço).
// Se não for parcelado, zera tudo.
export function parcelaWrite(
  dto: {
    cartaoId?: string | null;
    parcelado?: boolean;
    parcelaAtual?: number | null;
    totalParcelas?: number | null;
  },
  refMonth: string
) {
  const parcelado = dto.parcelado ?? false;
  return {
    cartaoId: dto.cartaoId ?? null,
    parcelado,
    parcelaAtual: parcelado ? dto.parcelaAtual ?? 1 : null,
    totalParcelas: parcelado ? dto.totalParcelas ?? null : null,
    parcelaMesRef: parcelado ? refMonth : null,
  };
}
