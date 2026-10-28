// Montagem PURA dos cartões (agregados de fatura, resumo mês a mês, quitação,
// linhas da fatura) — sem Prisma, sem I/O. Roda no servidor (a partir do que o
// Prisma leu) e no navegador (a partir do que o PostgREST leu direto, ver
// `services/leituraDireta.ts`). Tipos estruturais: Decimal ou number.
import { num, round, effectiveParcela, parcelaAtivaNoMes, parcelaView } from "@/server/lib/serialize";

type Dec = Parameters<typeof num>[0];

export type CartaoLinha = {
  id: string;
  nome: string;
  bandeira: string | null;
  limite: Dec;
  diaFechamento: number | null;
  diaVencimento: number;
  cor: string;
  ordem: number;
};

type ParcelaFonte = {
  parcelado: boolean;
  parcelaAtual: number | null;
  totalParcelas: number | null;
  parcelaMesRef: string | null;
};

type FixaFonte = ParcelaFonte & {
  id: string;
  descricao: string;
  valor: Dec;
  cartaoId: string | null;
  categoriaId: string | null;
};

type AvulsaFonte = {
  id: string;
  descricao: string;
  valor: Dec;
  mes: string;
  cartaoId: string | null;
  categoriaId: string | null;
};

// 'YYYY-MM' + 1 mês (vira o ano sozinho).
function proximoMes(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Parcelas futuras (depois do mês `mes`) de uma fixa parcelada, já auto-avançadas.
function parcelasRestantes(d: ParcelaFonte, mes: string) {
  if (!d.parcelado || !d.totalParcelas) return 0;
  const eff = effectiveParcela(d, mes) ?? 0;
  return Math.max(d.totalParcelas - eff, 0);
}

// View básica (sem agregados) — usada onde só precisa do cadastro.
export function cartaoView(c: CartaoLinha) {
  return {
    id: c.id,
    nome: c.nome,
    bandeira: c.bandeira,
    limite: num(c.limite),
    diaFechamento: c.diaFechamento,
    diaVencimento: c.diaVencimento,
    cor: c.cor,
    ordem: c.ordem,
  };
}

// Agregados de um cartão num mês, a partir das linhas JÁ carregadas. Puro de
// propósito: é o que deixa a lista somar N cartões com 3 queries fixas em vez
// de 3 por cartão.
type LinhaFixa = ParcelaFonte & { valor: Dec };

export function agregadosDoCartao(
  c: CartaoLinha,
  fixas: LinhaFixa[],
  avulsas: { valor: Dec }[],
  mes: string
) {
  // fixas: parcelada conta só dentro da janela (quitadas saem sozinhas); fixa normal sempre.
  const fixasNoMes = fixas.reduce((s, d) => (parcelaAtivaNoMes(d, mes) ? s + num(d.valor) : s), 0);
  // avulsas do mês não parcelam — somam direto.
  const avulsasTotal = avulsas.reduce((s, d) => s + num(d.valor), 0);
  const faturaMes = round(fixasNoMes + avulsasTotal);

  // comprometido futuro = parcelas de fixas que ainda vão cair depois do mês visto
  const comprometido = round(
    fixas.reduce((s, d) => s + parcelasRestantes(d, mes) * num(d.valor), 0)
  );

  const limite = num(c.limite);
  return {
    ...cartaoView(c),
    faturaMes,
    comprometido,
    disponivel: round(limite - faturaMes - comprometido),
  };
}


// Lista com agregados de um mês: 3 leituras fixas (cartões, fixas com cartão,
// avulsas com cartão no mês) agrupadas aqui em memória.
export function cartoesComAgregados(cartoes: CartaoLinha[], fixas: (LinhaFixa & { cartaoId: string | null })[], avulsas: { valor: Dec; cartaoId: string | null }[], mes: string) {
  const porCartao = <T extends { cartaoId: string | null }>(linhas: T[]) => {
    const mapa = new Map<string, T[]>();
    for (const l of linhas) {
      const atual = mapa.get(l.cartaoId as string);
      if (atual) atual.push(l);
      else mapa.set(l.cartaoId as string, [l]);
    }
    return mapa;
  };
  const fixasPor = porCartao(fixas);
  const avulsasPor = porCartao(avulsas);

  return cartoes.map((c) =>
    agregadosDoCartao(c, fixasPor.get(c.id) ?? [], avulsasPor.get(c.id) ?? [], mes)
  );
}

// Resumo da fatura mês a mês, por cartão e por categoria.
export function resumoPorMesView(de: string, ate: string, fixas: FixaFonte[], avulsas: AvulsaFonte[]) {
  const avulsasPorMes = new Map<string, AvulsaFonte[]>();
  for (const d of avulsas) {
    const lista = avulsasPorMes.get(d.mes);
    if (lista) lista.push(d);
    else avulsasPorMes.set(d.mes, [d]);
  }

  const meses = [];
  for (let ym = de; ym <= ate; ym = proximoMes(ym)) {
    const porCartao = new Map<string, number>();
    const porCategoria = new Map<string, number>();
    const soma = (mapa: Map<string, number>, chave: string, valor: number) =>
      mapa.set(chave, round((mapa.get(chave) ?? 0) + valor));

    // fixa parcelada só entra nos meses da janela dela; fixa normal, sempre
    for (const d of fixas) {
      if (!parcelaAtivaNoMes(d, ym)) continue;
      const valor = num(d.valor);
      soma(porCartao, d.cartaoId as string, valor);
      soma(porCategoria, d.categoriaId ?? "", valor);
    }
    for (const d of avulsasPorMes.get(ym) ?? []) {
      const valor = num(d.valor);
      soma(porCartao, d.cartaoId as string, valor);
      soma(porCategoria, d.categoriaId ?? "", valor);
    }

    const lista = (mapa: Map<string, number>, campo: "cartaoId" | "categoriaId") =>
      [...mapa.entries()]
        .map(([id, total]) => ({ [campo]: id || null, total }))
        .sort((a, b) => b.total - a.total);

    meses.push({
      ym,
      total: round([...porCartao.values()].reduce((s, v) => s + v, 0)),
      porCartao: lista(porCartao, "cartaoId") as { cartaoId: string | null; total: number }[],
      porCategoria: lista(porCategoria, "categoriaId") as { categoriaId: string | null; total: number }[],
    });
  }
  return { de, ate, meses };
}

// Linhas da fatura de um cartão no mês: fixas ativas na janela + avulsas do mês.
export function faturaLinhasView(mes: string, fixas: FixaFonte[], avulsas: AvulsaFonte[]) {
  const linhasFixas = fixas
    .filter((d) => parcelaAtivaNoMes(d, mes))
    .map((d) => {
      const eff = effectiveParcela(d, mes);
      return {
        id: d.id,
        tipo: "fixa" as const,
        descricao: d.descricao,
        valor: num(d.valor),
        parcelado: d.parcelado,
        parcelaAtual: eff,
        totalParcelas: d.totalParcelas,
      };
    });
  const linhasAvulsas = avulsas.map((d) => ({
    id: d.id,
    tipo: "mes" as const,
    descricao: d.descricao,
    valor: num(d.valor),
    parcelado: false,
    parcelaAtual: null,
    totalParcelas: null,
  }));
  return [...linhasFixas, ...linhasAvulsas];
}

// Parceladas em aberto do dono + o que já foi pago delas no mês. Cru de
// propósito: o painel de quitação roda lib/calc.js#quitacaoParceladas em cima.
export function parceladasView(
  mes: string,
  fixas: (FixaFonte & {
    ativa: boolean;
    diaVencimento: number;
    espacoId: string;
    espaco: { nome: string; emoji: string };
  })[],
  pagamentos: { despesaFixaId: string; ym: string; valorPago: Dec }[]
) {
  const ids = new Set(fixas.map((d) => d.id));
  return {
    mes,
    fixas: fixas.map((d) => ({
      id: d.id,
      descricao: d.descricao,
      valor: num(d.valor),
      ativa: d.ativa,
      diaVencimento: d.diaVencimento,
      categoriaId: d.categoriaId,
      espacoId: d.espacoId,
      espacoNome: d.espaco.nome,
      espacoEmoji: d.espaco.emoji,
      ...parcelaView(d),
    })),
    // só o que aponta pra uma parcelada listada — o resto é ruído pro painel
    pagamentos: pagamentos
      .filter((p) => ids.has(p.despesaFixaId))
      .map((p) => ({ despesaFixaId: p.despesaFixaId, ym: p.ym, valorPago: num(p.valorPago) })),
  };
}
