// Montagem PURA do orçamento e do resumo por espaço — sem Prisma, sem I/O.
//
// Mora fora do service porque roda nos dois lados: o service monta a partir do
// que o Prisma leu, e o navegador monta a partir do que leu DIRETO do Supabase
// (`services/leituraDireta.ts`, PostgREST + RLS). Mesma função, mesmo shape —
// é o que deixa o front trocar a origem da leitura sem notar.
//
// Os tipos são estruturais de propósito: Decimal do Prisma ou number do
// PostgREST, Date ou 'YYYY-MM-DD'. Nada aqui pode importar valor de
// `@prisma/client` (iria pro bundle do cliente).
import { num, isoDate, round, parcelaView, parcelaAtivaNoMes } from "@/server/lib/serialize";
import { aplicaDivisao, CONTATO_INATIVO, type ShareLike } from "../cartao-share/rateio";

type Dec = Parameters<typeof num>[0];
type Data = Date | string;

export type EspacoLinha = { id: string; nome: string; tipo: string; emoji: string };

export function espacoView(esp: EspacoLinha) {
  return { id: esp.id, nome: esp.nome, tipo: esp.tipo, emoji: esp.emoji };
}

// Rateio da linha no formato que o front desenha (iniciais + valor efetivo).
// Independe do mês de propósito: a parte de cada contato é sempre a mesma fatia
// da linha; quem some no mês é a linha inteira (parcela encerrada), e disso o
// front já cuida com `parcelaAtivaNoMes`.
export type ShareComContato = ShareLike & { contato: { id: string; nome: string; status: string } | null };

// A base vem por parâmetro: aqui o share está aninhado DENTRO da despesa, então
// ele não carrega `despesaFixa`/`despesaMes` pra `linhaBase` derivar sozinha.
function rateioView(shares: ShareComContato[], base: number) {
  return shares.map((s) => ({
    shareId: s.id,
    contatoId: s.contatoId,
    nome: s.contato?.nome ?? "",
    status: s.contato?.status ?? "local",
    percentual: s.percentual != null ? num(s.percentual) : null,
    valor: aplicaDivisao(base, s),
  }));
}

// Quanto a linha pesa no orçamento do dono (espelha lib/calc.js#valorEfetivoLinha).
// Contato `recusado` fica fora da soma: a recusa de um não faz o dono pagar menos.
export function valorEfetivo(valor: number, abateShares: boolean, shares: ShareComContato[]) {
  if (!abateShares) return valor;
  const soma = round(
    shares
      .filter((s) => (s.contato?.status ?? "local") !== CONTATO_INATIVO)
      .reduce((t, s) => t + aplicaDivisao(valor, s), 0)
  );
  return round(Math.max(valor - soma, 0));
}

type FixaFonte = {
  id: string;
  descricao: string;
  valor: Dec;
  diaVencimento: number;
  ativa: boolean;
  categoriaId: string | null;
  nota: string | null;
  abateShares: boolean;
  cartaoId: string | null;
  parcelado: boolean;
  parcelaAtual: number | null;
  totalParcelas: number | null;
  parcelaMesRef: string | null;
  shares: unknown[];
};

type MesFonte = {
  id: string;
  mes: string;
  descricao: string;
  valor: Dec;
  data: Data;
  paga: boolean;
  valorPago: Dec;
  cartaoId: string | null;
  categoriaId: string | null;
  nota: string | null;
  abateShares: boolean;
  fitid: string | null;
  shares: unknown[];
};

// O que compõe o orçamento de UM espaço (o `include` do repository, ou o
// embed equivalente do PostgREST).
export type OrcamentoFonte = {
  rendaMensal: Dec;
  moeda: string;
  despesasFixas: FixaFonte[];
  despesasMes: MesFonte[];
  receitasMes: {
    id: string;
    mes: string;
    descricao: string;
    valor: Dec;
    data: Data;
    recorrente: boolean;
    mesFim: string | null;
    skips: { receitaId: string; ym: string }[];
  }[];
  rendasMensais: { ym: string; valor: Dec }[];
  pagamentosFixas: { despesaFixaId: string; ym: string; valorPago: Dec }[];
};

// Monta o blob de orçamento no formato que o front espera.
export function orcamentoView(esp: OrcamentoFonte) {
  const rendasMensais: Record<string, number> = {};
  for (const r of esp.rendasMensais) rendasMensais[r.ym] = num(r.valor);

  return {
    despesasFixas: esp.despesasFixas.map((d) => ({
      id: d.id,
      descricao: d.descricao,
      valor: num(d.valor),
      diaVencimento: d.diaVencimento,
      ativa: d.ativa,
      categoriaId: d.categoriaId,
      nota: d.nota,
      abateShares: d.abateShares,
      rateio: rateioView(d.shares as ShareComContato[], num(d.valor)),
      ...parcelaView(d),
    })),
    despesasMes: esp.despesasMes.map((d) => ({
      id: d.id,
      mes: d.mes,
      descricao: d.descricao,
      valor: num(d.valor),
      data: isoDate(d.data),
      paga: d.paga,
      valorPago: num(d.valorPago),
      cartaoId: d.cartaoId,
      categoriaId: d.categoriaId,
      nota: d.nota,
      abateShares: d.abateShares,
      rateio: rateioView(d.shares as ShareComContato[], num(d.valor)),
      fitid: d.fitid, // o front usa pra marcar o que já veio de um OFX
    })),
    receitasMes: esp.receitasMes.map((r) => ({
      id: r.id,
      mes: r.mes,
      descricao: r.descricao,
      valor: num(r.valor),
      data: isoDate(r.data),
      recorrente: r.recorrente,
      mesFim: r.mesFim,
    })),
    // mesmo formato de espacosOcultos/pagamentosFixas: lista plana de exceções
    receitasSkips: esp.receitasMes.flatMap((r) =>
      r.skips.map((s) => ({ receitaId: s.receitaId, ym: s.ym }))
    ),
    pagamentosFixas: esp.pagamentosFixas.map((p) => ({
      despesaFixaId: p.despesaFixaId,
      ym: p.ym,
      valorPago: num(p.valorPago),
    })),
    rendasMensais,
    config: { rendaMensal: num(esp.rendaMensal), moeda: esp.moeda },
  };
}

// Gasto do mês por espaço — o gráfico "por página" do Início.
type LinhaDoResumo = {
  espacoId: string;
  valor: Dec;
  abateShares: boolean;
  shares: unknown[];
  parcelado: boolean;
  parcelaAtual: number | null;
  totalParcelas: number | null;
  parcelaMesRef: string | null;
};

export function resumoPorEspacoView(
  ym: string,
  espacos: EspacoLinha[],
  fixas: LinhaDoResumo[],
  avulsas: Omit<LinhaDoResumo, "parcelado" | "parcelaAtual" | "totalParcelas" | "parcelaMesRef">[]
) {
  const saiu = new Map<string, number>();
  const soma = (espacoId: string, v: number) => saiu.set(espacoId, (saiu.get(espacoId) ?? 0) + v);

  for (const d of fixas) {
    if (!parcelaAtivaNoMes(d, ym)) continue; // parcelada quitada sai sozinha
    soma(d.espacoId, valorEfetivo(num(d.valor), d.abateShares, d.shares as ShareComContato[]));
  }
  for (const d of avulsas) {
    soma(d.espacoId, valorEfetivo(num(d.valor), d.abateShares, d.shares as ShareComContato[]));
  }

  return {
    ym,
    espacos: espacos.map((e) => ({
      espacoId: e.id,
      nome: e.nome,
      emoji: e.emoji,
      saiu: round(saiu.get(e.id) ?? 0),
    })),
  };
}

// Espaço ativo com fallback pro primeiro quando o gravado sumiu. A gravação do
// fallback é do servidor; quem lê direto só calcula.
export function espacoAtivo(espacos: { id: string }[], gravado: string | null) {
  return gravado && espacos.some((e) => e.id === gravado) ? gravado : espacos[0]?.id ?? null;
}
