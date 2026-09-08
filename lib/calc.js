// Pure finance calculations — no React, fully unit-testable.
import { monthKey, currentMonthKey, monthRange, addMonths } from "./format.js";

// Meses decorridos de a → b ('YYYY-MM'). Pode ser negativo.
export function monthsBetween(a, b) {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

// Progress toward a goal: 0..1 (null meta -> null, no bar).
export function progresso(caixinha) {
  if (!caixinha.meta || caixinha.meta <= 0) return null;
  return Math.min(caixinha.saldo / caixinha.meta, 1);
}

// Taxa anual (%) -> taxa mensal efetiva (fração). Ex.: 12% a.a. -> ~0.00949.
export function taxaMensal(taxaAnual) {
  if (!taxaAnual || taxaAnual <= 0) return 0;
  return Math.pow(1 + taxaAnual / 100, 1 / 12) - 1;
}

// Saldo projetado após n meses: juros compostos sobre o saldo + aportes mensais.
//   FV = saldo·(1+i)^n + aporte·((1+i)^n − 1)/i   (i = 0 degrada pra linear)
export function saldoProjetado(caixinha, n) {
  const saldo = caixinha.saldo || 0;
  const aporte = caixinha.aporteMensal || 0;
  const i = taxaMensal(caixinha.taxaJuros);
  if (i === 0) return saldo + aporte * n;
  const fator = Math.pow(1 + i, n);
  return saldo * fator + aporte * ((fator - 1) / i);
}

// Months remaining to hit meta at current aporte rate (juros compostos se houver taxa).
//   Infinity  -> never (no aporte nem rendimento)
//   0         -> already reached
export function mesesParaMeta(caixinha) {
  if (!caixinha.meta || caixinha.meta <= 0) return null;
  const saldo = caixinha.saldo || 0;
  const falta = caixinha.meta - saldo;
  if (falta <= 0) return 0;
  const aporte = caixinha.aporteMensal || 0;
  const i = taxaMensal(caixinha.taxaJuros);
  if (i === 0) return aporte > 0 ? falta / aporte : Infinity;
  // Resolve n em: saldo·(1+i)^n + aporte·((1+i)^n − 1)/i = meta
  const base = saldo + aporte / i;
  if (base <= 0) return Infinity;
  return Math.log((caixinha.meta + aporte / i) / base) / Math.log(1 + i);
}

export function faltaParaMeta(caixinha) {
  if (!caixinha.meta) return 0;
  return Math.max(caixinha.meta - caixinha.saldo, 0);
}

// Total planned monthly allocation across all caixinhas.
export const totalAporteMensal = (caixinhas) =>
  caixinhas.reduce((s, c) => s + (c.aporteMensal || 0), 0);

export const totalSaldo = (caixinhas) =>
  caixinhas.reduce((s, c) => s + (c.saldo || 0), 0);

export const totalDespesasFixas = (despesasFixas) =>
  despesasFixas.filter((d) => d.ativa).reduce((s, d) => s + d.valor, 0);

// Movimentações of one month, newest first.
export function movsDoMes(movimentacoes, ym = currentMonthKey()) {
  return movimentacoes
    .filter((m) => monthKey(m.data) === ym)
    .sort((a, b) => b.data.localeCompare(a.data));
}

// Monthly summary: entrou / saiu / sobrou.
//   entrou  = renda do mês
//   saiu    = despesas fixas ativas + despesas variáveis lançadas no mês
//   aportado= soma dos aportes do mês (alocação interna, informativo)
//   sobrou  = entrou - saiu
export function resumoMensal({ movimentacoes, despesasFixas, config }, ym = currentMonthKey()) {
  const movs = movsDoMes(movimentacoes, ym);
  const aportado = movs.filter((m) => m.tipo === "aporte").reduce((s, m) => s + m.valor, 0);
  const variaveis = movs.filter((m) => m.tipo === "despesa").reduce((s, m) => s + m.valor, 0);
  const fixas = totalDespesasFixas(despesasFixas);
  const entrou = config.rendaMensal || 0;
  const saiu = fixas + variaveis;
  return {
    ym,
    entrou,
    aportado,
    fixas,
    variaveis,
    saiu,
    sobrou: entrou - saiu,
    naoAlocado: entrou - aportado - fixas,
  };
}

// Distinct month keys present in history, newest first.
export function mesesDisponiveis(movimentacoes) {
  const set = new Set(movimentacoes.map((m) => monthKey(m.data)));
  set.add(currentMonthKey());
  return [...set].sort((a, b) => b.localeCompare(a));
}

// Renda informada para o mês (fallback no config).
export function rendaDoMes(rendasMensais, config, ym) {
  const v = rendasMensais?.[ym];
  return v != null ? v : config?.rendaMensal || 0;
}

// Despesas avulsas de um mês, mais recentes primeiro.
export function despesasDoMes(despesasMes, ym) {
  return (despesasMes || [])
    .filter((d) => d.mes === ym)
    .sort((a, b) => (b.data || "").localeCompare(a.data || ""));
}

// Receitas extras que valem no mês `ym`: as avulsas daquele mês + as recorrentes
// cuja janela [mes, mesFim] contém `ym` e que não foram puladas nele.
//
// Numa recorrente, `mes` é a âncora e o `id` se repete em todos os meses — então
// toda key de React e todo handler usam `key`/`mesEfetivo`, nunca o `id` sozinho.
export function receitasDoMes(receitasMes, ym, skips) {
  const pulada = (id) => (skips || []).some((s) => s.receitaId === id && s.ym === ym);
  const doMes = [];
  for (const r of receitasMes || []) {
    if (!r.recorrente) {
      if (r.mes === ym) doMes.push({ ...r, mesEfetivo: ym, virtual: false, key: r.id });
      continue;
    }
    if (ym < r.mes) continue;                      // antes da âncora
    if (r.mesFim && ym > r.mesFim) continue;       // depois do fim
    if (pulada(r.id)) continue;                    // exceção do mês
    // data cai no mesmo dia do mês da âncora (só pra ordenar/mostrar)
    const dia = (r.data || `${r.mes}-01`).slice(8);
    doMes.push({
      ...r,
      data: `${ym}-${dia}`,
      mesEfetivo: ym,
      virtual: r.mes !== ym,
      key: `${r.id}:${ym}`,
    });
  }
  return doMes.sort((a, b) => (b.data || "").localeCompare(a.data || ""));
}

// Orçamento pessoal do mês (página de Despesas).
//   salario  = renda fixa informada no mês
//   extras   = receitas avulsas do mês (dinheiro por fora)
//   recebido = salário + extras
//   fixas    = despesas fixas que caem no mês (parcelas quitadas saem sozinhas)
//   variaveis= despesas avulsas do mês
//   sobrou   = recebido - fixas - variaveis
// Caixinhas NÃO entram aqui — orçamento pessoal é separado.
export function orcamentoMes({ rendasMensais, despesasMes, receitasMes, receitasSkips, despesasFixas, config }, ym = currentMonthKey()) {
  const salario = rendaDoMes(rendasMensais, config, ym);
  const extras = receitasDoMes(receitasMes, ym, receitasSkips).reduce((s, r) => s + r.valor, 0);
  const recebido = salario + extras;
  const fixas = totalFixasNoMes(despesasFixas, ym);
  const variaveis = despesasDoMes(despesasMes, ym).reduce((s, d) => s + d.valor, 0);
  const saiu = fixas + variaveis;
  return { ym, salario, extras, recebido, fixas, variaveis, saiu, sobrou: recebido - saiu };
}

// Meses à frente que o seletor sempre oferece, mesmo sem nada lançado — dá pra
// planejar o resto do ano mês a mês (agosto → dezembro). O mínimo evita que a
// lista encolha em novembro/dezembro, quando "até dezembro" já não é horizonte.
const MESES_MIN_A_FRENTE = 6;

// Do mês visto até o fim do horizonte de planejamento, do mais antigo ao mais recente.
export function horizonteOrcamento(ym = currentMonthKey()) {
  const mes = Number(ym.split("-")[1]);
  return monthRange(0, Math.max(12 - mes, MESES_MIN_A_FRENTE), ym);
}

// Meses disponíveis para o orçamento: tudo que já tem lançamento (rendas, despesas
// e receitas do mês) + o horizonte de planejamento a partir do mês atual.
export function mesesOrcamento(rendasMensais, despesasMes, receitasMes) {
  const set = new Set(Object.keys(rendasMensais || {}));
  (despesasMes || []).forEach((d) => set.add(d.mes));
  (receitasMes || []).forEach((r) => set.add(r.mes));
  horizonteOrcamento().forEach((m) => set.add(m));
  return [...set].sort((a, b) => b.localeCompare(a));
}

// ── Janela do seletor de mês ────────────────────────────────────────────────
// Cobre no mínimo `atras`/`frente` meses ao redor do mês atual e estica pra
// englobar o mês mais antigo/novo com dado — mês vazio no passado também tem
// que ser alcançável (era o furo do `mesesOrcamento`, que só listava meses
// com lançamento a partir do atual).
export function janelaMeses({ dados = [], atras = 24, frente = 12, ym = currentMonthKey() } = {}) {
  let min = addMonths(ym, -atras);
  let max = addMonths(ym, frente);
  for (const k of dados) {
    if (!k) continue;
    if (k < min) min = k;
    if (k > max) max = k;
  }
  return { min, max };
}

// Meses com algum lançamento do orçamento — alimenta os pontinhos do MonthSelect.
// Recorrente marca só a âncora e o mês de fim: pintar os 12 meses do meio
// transformaria o ponto ("tem lançamento aqui") em ruído.
export function mesesComDados({ rendasMensais, despesasMes, receitasMes } = {}) {
  const set = new Set(Object.keys(rendasMensais || {}));
  (despesasMes || []).forEach((d) => set.add(d.mes));
  (receitasMes || []).forEach((r) => {
    set.add(r.mes);
    if (r.recorrente && r.mesFim) set.add(r.mesFim);
  });
  return set;
}

// Meses com lançamento no cartão: despesa avulsa com cartão + a janela de
// parcelas de cada fixa parcelada. Fixa recorrente sem parcela fica de fora de
// propósito: ela cai em todo mês e o ponto não diria nada.
export function mesesComFatura(despesasFixas, despesasMes, ym = currentMonthKey()) {
  const set = new Set();
  for (const d of despesasMes || []) if (d.cartaoId) set.add(d.mes);
  for (const d of despesasFixas || []) {
    if (!d.cartaoId || !d.parcelado || !d.totalParcelas) continue;
    const q = quitacaoFixa([], d, ym);
    if (!q) continue;
    for (let m = q.primeiroMes; m <= q.ultimoMes; m = addMonths(m, 1)) set.add(m);
  }
  return set;
}

// Info de parcelamento no mês `ym`, auto-avançada a partir da âncora (parcelaMesRef).
//   atual        = parcela efetiva no mês visto (3 em jun → 4 em jul…)
//   restantes    = parcelas que ainda vão cair depois do mês visto
//   ended        = já quitou (efetiva > total)
//   notStarted   = ainda não começou (efetiva < 1)
export function parcelaInfo(d, ym = currentMonthKey()) {
  if (!d?.parcelado || !d.totalParcelas) return null;
  const base = d.parcelaAtual || 1;
  const ref = d.parcelaMesRef || ym;
  const atual = base + monthsBetween(ref, ym);
  const restantes = Math.max(d.totalParcelas - atual, 0);
  return {
    atual,
    total: d.totalParcelas,
    restantes,
    valorRestante: restantes * (d.valor || 0),
    ended: atual > d.totalParcelas,
    notStarted: atual < 1,
    label: `${Math.min(Math.max(atual, 0), d.totalParcelas)}/${d.totalParcelas}`,
  };
}

// A despesa fixa entra no orçamento/fatura do mês `ym`?
//   pausada (ativa=false) → não. Parcelada fora da janela (quitada/não iniciada) → não.
export function fixaContaNoMes(d, ym = currentMonthKey()) {
  if (!d.ativa) return false;
  if (!d.parcelado || !d.totalParcelas) return true;
  const p = parcelaInfo(d, ym);
  return !!p && !p.ended && !p.notStarted;
}

// Total de despesas fixas que caem no mês `ym` (respeita parcelas quitadas).
export function totalFixasNoMes(despesasFixas, ym = currentMonthKey()) {
  return (despesasFixas || [])
    .filter((d) => fixaContaNoMes(d, ym))
    .reduce((s, d) => s + d.valor, 0);
}

// Quanto já foi pago da fixa `fixaId` no mês `ym` (0 se nenhum registro).
export function fixaValorPago(pagamentosFixas, fixaId, ym) {
  const p = (pagamentosFixas || []).find((x) => x.despesaFixaId === fixaId && x.ym === ym);
  return p ? p.valorPago || 0 : 0;
}

// Quanto ainda falta pagar da fixa `d` no mês `ym`.
export function fixaFaltaPagar(pagamentosFixas, d, ym) {
  return Math.max((d.valor || 0) - fixaValorPago(pagamentosFixas, d.id, ym), 0);
}

// A fixa `d` está quitada no mês `ym`? (pago >= valor devido)
export function fixaPaga(pagamentosFixas, d, ym) {
  return (d.valor || 0) > 0 && fixaValorPago(pagamentosFixas, d.id, ym) >= d.valor;
}

// A fixa `d` tem pagamento parcial no mês `ym`? (algo pago, mas não quitada)
export function fixaParcial(pagamentosFixas, d, ym) {
  const pago = fixaValorPago(pagamentosFixas, d.id, ym);
  return pago > 0 && pago < (d.valor || 0);
}

// ── Quitação de parceladas ───────────────────────────────────────────────────
// "Quanto preciso pra quitar tudo" — olha só as fixas parceladas, do mês visto
// (inclusive) até a última parcela. Parcela sem cartão também conta: parcelamento
// é do carnê, não do cartão.

// Panorama de uma fixa parcelada a partir do mês `ym`. null se não é parcelada
// ou se já quitou. Desconta o que já foi pago da parcela do mês visto.
export function quitacaoFixa(pagamentosFixas, d, ym = currentMonthKey()) {
  const p = parcelaInfo(d, ym);
  if (!p || p.ended) return null;
  const valor = d.valor || 0;
  // parcelas que ainda caem: a do mês visto conta; se nem começou, cai o carnê inteiro
  const parcelas = p.notStarted ? p.total : p.restantes + 1;
  const pagoNoMes = p.notStarted ? 0 : fixaValorPago(pagamentosFixas, d.id, ym);
  const faltaNoMes = p.notStarted ? 0 : Math.max(valor - pagoNoMes, 0);
  const contrato = p.total * valor;
  const falta = Math.max(parcelas * valor - pagoNoMes, 0);
  return {
    id: d.id,
    descricao: d.descricao,
    valor,
    atual: p.atual,
    total: p.total,
    label: p.label,
    parcelas,
    falta,
    faltaNoMes,
    contrato,
    quitado: Math.max(contrato - falta, 0),
    progresso: contrato > 0 ? Math.min(Math.max(contrato - falta, 0) / contrato, 1) : 0,
    notStarted: p.notStarted,
    primeiroMes: p.notStarted ? addMonths(ym, 1 - p.atual) : ym,
    ultimoMes: addMonths(ym, p.restantes),
  };
}

// Agregado das fixas parceladas a partir do mês `ym`.
//   itens       = por fixa (maior dívida primeiro)
//   falta       = total pra quitar tudo daqui pra frente
//   faltaNoMes  = quanto das parcelas ainda sai no mês visto
//   ultimoMes   = mês da última parcela de todas ('YYYY-MM') — o mês de ficar livre
//   mesesAte    = meses do mês visto até `ultimoMes`
//   cronograma  = [{ ym, valor, itens }] mês a mês até quitar
export function quitacaoParceladas(despesasFixas, pagamentosFixas, ym = currentMonthKey()) {
  const itens = (despesasFixas || [])
    .filter((d) => d.ativa && d.parcelado && d.totalParcelas)
    .map((d) => quitacaoFixa(pagamentosFixas, d, ym))
    .filter(Boolean)
    .sort((a, b) => b.falta - a.falta || a.ultimoMes.localeCompare(b.ultimoMes));

  const falta = itens.reduce((s, i) => s + i.falta, 0);
  const faltaNoMes = itens.reduce((s, i) => s + i.faltaNoMes, 0);
  const contrato = itens.reduce((s, i) => s + i.contrato, 0);
  const ultimoMes = itens.reduce((max, i) => (!max || i.ultimoMes > max ? i.ultimoMes : max), null);
  const mesesAte = ultimoMes ? monthsBetween(ym, ultimoMes) : 0;

  const cronograma = [];
  for (let k = 0; ultimoMes && k <= mesesAte; k++) {
    const m = addMonths(ym, k);
    const doMes = itens.filter((i) => m >= i.primeiroMes && m <= i.ultimoMes);
    cronograma.push({
      ym: m,
      valor: doMes.reduce((s, i) => s + (m === ym ? i.faltaNoMes : i.valor), 0),
      itens: doMes.length,
    });
  }

  return {
    ym,
    itens,
    falta,
    faltaNoMes,
    contrato,
    quitado: Math.max(contrato - falta, 0),
    progresso: contrato > 0 ? Math.min(Math.max(contrato - falta, 0) / contrato, 1) : 0,
    ultimoMes,
    mesesAte,
    cronograma,
    // maior mês do cronograma — base pra escalar as barras
    picoMes: cronograma.reduce((mx, c) => Math.max(mx, c.valor), 0),
  };
}

// Quitação agrupada por cartão (aba de cartões). Grupo com `cartaoId` null =
// parcelada sem cartão (carnê, boleto). Cartão com mais dívida primeiro; o sem
// cartão fecha a lista.
export function quitacaoPorCartao(despesasFixas, pagamentosFixas, ym = currentMonthKey()) {
  const porId = new Map();
  for (const d of despesasFixas || []) {
    const k = d.cartaoId || "";
    if (!porId.has(k)) porId.set(k, []);
    porId.get(k).push(d);
  }
  return [...porId.entries()]
    .map(([k, fixas]) => ({ cartaoId: k || null, ...quitacaoParceladas(fixas, pagamentosFixas, ym) }))
    .filter((g) => g.itens.length > 0)
    .sort((a, b) => {
      if (!a.cartaoId !== !b.cartaoId) return a.cartaoId ? -1 : 1;
      return b.falta - a.falta;
    });
}

// ── Páginas (espaços) ocultas por mês ─────────────────────────────────────────
// A página está oculta (excluída) no mês ym?
export function espacoOcultoNoMes(espacosOcultos, espacoId, ym) {
  return (espacosOcultos || []).some((o) => o.espacoId === espacoId && o.ym === ym);
}

// Páginas visíveis no mês ym (mantém a ordem original).
export function espacosVisiveisNoMes(espacos, espacosOcultos, ym) {
  return (espacos || []).filter((e) => !espacoOcultoNoMes(espacosOcultos, e.id, ym));
}

// Páginas ocultas no mês ym.
export function espacosOcultosNoMes(espacos, espacosOcultos, ym) {
  return (espacos || []).filter((e) => espacoOcultoNoMes(espacosOcultos, e.id, ym));
}

// ── Fechamento ⇄ vencimento do cartão ─────────────────────────────
// Dia do mês deslocado, circular em 1..31 (12 +7 → 19; 28 +7 → 4). O ciclo é de
// 31 por simplicidade: o dia é um número de contrato do cartão, não uma data.
export function diaMaisDias(dia, n) {
  const d = Number(dia);
  if (!Number.isInteger(d) || d < 1 || d > 31) return null;
  return (((d - 1 + n) % 31) + 31) % 31 + 1;
}

// A fatura vence ~7 dias depois de fechar (e fecha ~7 dias antes de vencer).
export const sugereVencimento = (diaFechamento) => diaMaisDias(diaFechamento, 7);
export const sugereFechamento = (diaVencimento) => diaMaisDias(diaVencimento, -7);

// Tailwind class fragments per caixinha accent color.
export const ACENTO = {
  emerald: { text: "text-emerald-400", bg: "bg-emerald-500", soft: "bg-emerald-500/15", ring: "ring-emerald-500/30", from: "from-emerald-500", dot: "#10b981" },
  blue:    { text: "text-blue-400",    bg: "bg-blue-500",    soft: "bg-blue-500/15",    ring: "ring-blue-500/30",    from: "from-blue-500",    dot: "#3b82f6" },
  violet:  { text: "text-violet-400",  bg: "bg-violet-500",  soft: "bg-violet-500/15",  ring: "ring-violet-500/30",  from: "from-violet-500",  dot: "#8b5cf6" },
  amber:   { text: "text-amber-400",   bg: "bg-amber-500",   soft: "bg-amber-500/15",   ring: "ring-amber-500/30",   from: "from-amber-500",   dot: "#f59e0b" },
  rose:    { text: "text-rose-400",    bg: "bg-rose-500",    soft: "bg-rose-500/15",    ring: "ring-rose-500/30",    from: "from-rose-500",    dot: "#f43f5e" },
  cyan:    { text: "text-cyan-400",    bg: "bg-cyan-500",    soft: "bg-cyan-500/15",    ring: "ring-cyan-500/30",    from: "from-cyan-500",    dot: "#06b6d4" },
};
export const acento = (cor) => ACENTO[cor] || ACENTO.blue;
