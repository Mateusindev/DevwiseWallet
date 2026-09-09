// Cálculo puro do compartilhamento — sem Prisma, sem repository, sem I/O.
// Mora fora do service porque o orçamento também precisa dele (valor efetivo da
// linha quando `abateShares`) e um import de service pra service fecharia ciclo.
import { num, round, effectiveParcela, parcelaAtivaNoMes, monthsBetween, addMonths } from "@/server/lib/serialize";

export { addMonths };

type Decimalish = Parameters<typeof num>[0];

// Só o que o cálculo lê — mantém as funções testáveis com objeto literal.
export type LinhaFixaLike = {
  valor: Decimalish;
  parcelado: boolean;
  parcelaAtual: number | null;
  totalParcelas: number | null;
  parcelaMesRef: string | null;
};

export type LinhaMesLike = { valor: Decimalish; mes: string };

export type ShareLike = {
  id: string;
  contatoId: string;
  tipo: "linha" | "valor";
  percentual: Decimalish;
  valor: Decimalish;
  mesRef: string | null;
  despesaFixa?: LinhaFixaLike | null;
  despesaMes?: LinhaMesLike | null;
};

export const CONTATO_INATIVO = "recusado";

// Valor da linha apontada (0 se o share é do tipo "valor").
export function linhaBase(s: ShareLike): number {
  if (s.despesaFixa) return num(s.despesaFixa.valor);
  if (s.despesaMes) return num(s.despesaMes.valor);
  return 0;
}

// Aplica a divisão (percentual / valor fixo / linha inteira) sobre a base.
export function aplicaDivisao(base: number, s: ShareLike): number {
  if (s.percentual != null) return round((base * num(s.percentual)) / 100);
  if (s.valor != null) return round(Math.min(num(s.valor), base));
  return round(base);
}

// Quanto o contato deve neste share, no mês `mes` — ignorando adoção/adiantamento.
export function shareValorNoMes(s: ShareLike, mes: string): number {
  if (s.tipo === "valor") {
    return s.mesRef == null || s.mesRef === mes ? num(s.valor) : 0;
  }
  const ativo = s.despesaFixa
    ? parcelaAtivaNoMes(s.despesaFixa, mes)
    : s.despesaMes
      ? s.despesaMes.mes === mes
      : false;
  return ativo ? aplicaDivisao(linhaBase(s), s) : 0;
}

// Info de parcela (só quando a linha é fixa parcelada).
export function shareParcela(s: ShareLike, mes: string) {
  const d = s.despesaFixa;
  if (!d || !d.parcelado || !d.totalParcelas) return null;
  const eff = effectiveParcela(d, mes) ?? 0;
  return {
    parcelaAtual: eff,
    totalParcelas: d.totalParcelas,
    restantes: Math.max(d.totalParcelas - eff, 0),
  };
}

// O mês já foi coberto por adiantamento?
export function mesQuitado(quitadoAte: string | null | undefined, mes: string): boolean {
  return quitadoAte != null && mes <= quitadoAte;
}

// Comprometido futuro do contato: parcelas restantes × parte, menos as que o
// adiantamento já cobriu (só as posteriores ao mês corrente contam aqui).
export function shareComprometido(s: ShareLike, mes: string, quitadoAte?: string | null): number {
  const p = shareParcela(s, mes);
  if (!p) return 0;
  const adiantadas =
    quitadoAte && quitadoAte > mes ? Math.min(monthsBetween(mes, quitadoAte), p.restantes) : 0;
  return round(Math.max(p.restantes - adiantadas, 0) * aplicaDivisao(linhaBase(s), s));
}

// Quanto o devedor deve de fato neste mês: 0 se ignorou ou se já adiantou.
export function devidoNoMes(
  s: ShareLike,
  mes: string,
  adocao?: { modo: string; quitadoAte: string | null } | null
): number {
  if (adocao?.modo === "ignorado") return 0;
  if (mesQuitado(adocao?.quitadoAte, mes)) return 0;
  return shareValorNoMes(s, mes);
}

// ── Rateio de uma linha entre N contatos ────────────────────────────────────

export type ParteRateio = {
  shareId: string;
  contatoId: string;
  nome: string;
  status: string;
  percentual: number | null;
  valor: number;
};

// Divisão de uma linha: quanto cada contato leva, quanto sobra pro dono.
// Contato `recusado` continua listado (o dono cadastrou) mas não entra na soma —
// senão a recusa de um faria o dono pagar menos do que paga de verdade.
export function rateioDaLinha(
  base: number,
  shares: (ShareLike & { contato?: { nome: string; status: string } | null })[],
  mes: string
) {
  const partes: ParteRateio[] = shares.map((s) => ({
    shareId: s.id,
    contatoId: s.contatoId,
    nome: s.contato?.nome ?? "",
    status: s.contato?.status ?? "local",
    percentual: s.percentual != null ? num(s.percentual) : null,
    valor: shareValorNoMes(s, mes),
  }));
  const soma = round(
    partes.filter((p) => p.status !== CONTATO_INATIVO).reduce((t, p) => t + p.valor, 0)
  );
  return { partes, soma, sobraDono: round(base - soma) };
}

// Quanto a linha pesa no orçamento do dono. `abateShares` false mantém a
// semântica histórica (share é informativo; a fatura do cartão segue cheia).
export function valorEfetivoDono(
  linha: { valor: Decimalish; abateShares: boolean },
  shares: (ShareLike & { contato?: { nome: string; status: string } | null })[],
  mes: string
): number {
  const base = num(linha.valor);
  if (!linha.abateShares) return base;
  const { soma } = rateioDaLinha(base, shares, mes);
  return round(Math.max(base - soma, 0));
}

// ── Invariantes de escrita ──────────────────────────────────────────────────

export type ItemRateio = { percentual?: number | null; valor?: number | null };

// Devolve a mensagem do erro, ou null se o rateio fecha. O service transforma
// em 422 — aqui não há AppError pra função seguir pura.
export function validaRateio(base: number, itens: ItemRateio[]): string | null {
  let somaPct = 0;
  let somaValor = 0;
  for (const i of itens) {
    if (i.percentual != null && i.valor != null) {
      return "Use percentual OU valor em cada pessoa, não os dois";
    }
    if (i.percentual != null) somaPct += i.percentual;
    else if (i.valor != null) somaValor += i.valor;
    else somaValor += base; // sem percentual e sem valor = linha inteira
  }
  if (round(somaPct) > 100) {
    return `A soma dos percentuais é ${round(somaPct)}% — o limite é 100%`;
  }
  const total = round((base * somaPct) / 100 + somaValor);
  if (total > round(base)) {
    return `A soma das partes (${total}) passa do valor da linha (${round(base)})`;
  }
  return null;
}
