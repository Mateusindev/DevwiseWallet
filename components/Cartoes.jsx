"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, CalendarClock, Users, ChevronDown, Upload } from "lucide-react";
import {
  Card, CardHeader, Button, IconButton, ProgressBar, PageHeader, SectionHeader, EmptyState, Stat, Badge,
  Skeleton, SkeletonChart, SkeletonLines, SkeletonList, Spinner,
} from "./ui/primitives.jsx";
import { useAsync } from "./ui/useAsync.js";
import { HBars, StackedBars } from "./ui/charts.jsx";
import { CartaoModal } from "./forms.jsx";
import ImportOfxModal from "./ImportOfx.jsx";
import { CompartilharModal, MeusCompartilhamentos } from "./Compartilhamento.jsx";
import { fmtMoney, fmtMoneyCompact, fmtMonthLabel, fmtMonthShort, currentMonthKey, addMonths } from "../lib/format.js";
import { acento, janelaMeses, mesesComFatura, quitacaoParceladas, quitacaoPorCartao } from "../lib/calc.js";
import { MonthStepper } from "./ui/fields.jsx";
import { useFinance } from "../store/FinanceContext.jsx";
import * as api from "../services/financeApi";
import { useAuth } from "./AuthGate";

// Vermelho é sinal, não textura: só aparece quando o limite estourou ou está
// a ≤10% de estourar. Comprometido normal é tinta.
const COR_ALERTA = "var(--acento-rose)";
const perto = (pct) => pct >= 0.9;

export default function Cartoes() {
  const {
    cartoes, reloadCartoes, cartoesCarregando, removeCartao, despesasFixas, despesasMes,
    ym, setYm, mesesComFatura: mesesComFaturaFora,
  } = useFinance();
  const { can } = useAuth();
  const canManage = can("cartao:manage");
  const canShare = can("cartao:share");
  const canViewShared = can("cartao:view_shared");
  const [novoOpen, setNovoOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [importando, setImportando] = useState(null); // cartão pré-selecionado no import
  // Janela de faturas: 12 meses pra cada lado, esticada pelas parcelas em aberto.
  const comFatura = useMemo(
    () => mesesComFatura(despesasFixas, despesasMes, undefined, mesesComFaturaFora),
    [despesasFixas, despesasMes, mesesComFaturaFora]
  );
  const janela = useMemo(() => janelaMeses({ dados: comFatura, atras: 12, frente: 12 }), [comFatura]);

  // recarrega os agregados quando troca o mês
  useEffect(() => {
    if (ym !== currentMonthKey()) reloadCartoes(ym);
    else reloadCartoes();
  }, [ym, reloadCartoes]);

  // total agregado de todos os cartões
  const totais = useMemo(() => {
    const limite = cartoes.reduce((s, c) => s + (c.limite || 0), 0);
    const usado = cartoes.reduce((s, c) => s + (c.faturaMes || 0) + (c.comprometido || 0), 0);
    const disponivel = limite - usado;
    return { limite, usado, disponivel, pct: limite > 0 ? usado / limite : 0 };
  }, [cartoes]);

  // A frase do título é o achado do mês: quanto do limite já está tomado.
  const frase = cartoesCarregando ? (
    <span className="inline-flex items-center gap-2">
      <Spinner className="h-3.5 w-3.5 text-slate-500" /> Atualizando a fatura de {fmtMonthLabel(ym)}…
    </span>
  ) : cartoes.length === 0 ? (
    "Limites, faturas e parcelas em aberto."
  ) : (
    <>
      <span className="tnum font-medium text-ink">{fmtMoney(totais.usado)}</span> comprometidos de{" "}
      <span className="tnum">{fmtMoney(totais.limite)}</span> ·{" "}
      <span className={`tnum ${totais.disponivel < 0 || perto(totais.pct) ? "font-medium text-rose-400" : ""}`}>
        {Math.round(totais.pct * 100)}% do limite
      </span>
    </>
  );

  return (
    <section className="space-y-10">
      <PageHeader
        title="Cartões"
        description={frase}
        actions={
          <>
            <MonthStepper value={ym} onValue={setYm} min={janela.min} max={janela.max} marked={comFatura} />
            {canManage && cartoes.length > 0 && (
              <Button variant="outline" onClick={() => setImportando(cartoes[0])} title="Importar fatura OFX">
                <Upload size={16} /> OFX
              </Button>
            )}
            {canManage && <Button onClick={() => setNovoOpen(true)}><Plus size={16} /> Novo cartão</Button>}
          </>
        }
      />

      {cartoes.length === 0 ? (
        <EmptyState
          title="Nenhum cartão cadastrado"
          description="Cadastre seus cartões pra associar despesas e acompanhar a fatura."
          action={canManage && <Button size="sm" onClick={() => setNovoOpen(true)}><Plus size={15} /> Novo cartão</Button>}
        />
      ) : (
        <div className="space-y-6">
          <ResumoLimite totais={totais} cartoes={cartoes} />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {cartoes.map((c) => (
              <CartaoCard key={c.id} cartao={c} ym={ym} canManage={canManage} canShare={canShare}
                          onEdit={() => setEditing(c)} onRemove={() => removeCartao(c.id)}
                          onShare={() => setSharing(c)} />
            ))}
          </div>
        </div>
      )}

      {cartoes.length > 0 && <ParaOndeVaiAFatura ym={ym} cartoes={cartoes} />}

      <QuitacaoParceladas ym={ym} cartoes={cartoes} />

      {canViewShared && <MeusCompartilhamentos ym={ym} />}

      <ImportOfxModal open={!!importando} cartaoId={importando?.id} onClose={() => setImportando(null)}
                      mes={ym} mesLabel={fmtMonthLabel(ym)} />

      <CartaoModal open={novoOpen} onClose={() => setNovoOpen(false)} />
      <CartaoModal open={!!editing} cartao={editing} onClose={() => setEditing(null)} />
      <CompartilharModal open={!!sharing} cartao={sharing} ym={ym} onClose={() => setSharing(null)} />
    </section>
  );
}

// Resumo do limite da conta: três números em tipo (sem tile) e um trilho do
// tamanho do limite total, com o tomado de cada cartão na cor do cartão — a
// barra responde "quanto do limite já foi" e "de qual cartão" de uma vez.
function ResumoLimite({ totais, cartoes }) {
  const alerta = totais.disponivel < 0 || perto(totais.pct);
  const base = Math.max(totais.limite, totais.usado, 1);
  const partes = cartoes
    .map((c) => ({ c, usado: (c.faturaMes || 0) + (c.comprometido || 0) }))
    .filter((p) => p.usado > 0);
  return (
    <Card className="p-5 sm:p-6">
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
        <Stat className="col-span-2 sm:col-span-1" label="Limite total" value={fmtMoney(totais.limite)} size="lg" />
        <Stat label="Comprometido" value={fmtMoney(totais.usado)} tone={alerta ? "neg" : undefined}
              sub="fatura do mês + parcelas" />
        <Stat label="Disponível" value={fmtMoney(totais.disponivel)} tone={totais.disponivel < 0 ? "neg" : undefined}
              sub={`${Math.round(Math.max(1 - totais.pct, 0) * 100)}% do limite livre`} />
      </div>

      <div className="mt-6 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-[var(--color-trilho)]"
           role="img" aria-label={`${Math.round(totais.pct * 100)}% do limite comprometido`}>
        {partes.map(({ c, usado }) => (
          <span key={c.id} className="h-full first:rounded-l-full" title={`${c.nome}: ${fmtMoney(usado)}`}
                style={{ width: `${(usado / base) * 100}%`, backgroundColor: alerta ? COR_ALERTA : acento(c.cor).dot }} />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {cartoes.map((c) => (
          <li key={c.id} className="inline-flex items-center gap-1.5 text-[13px] text-slate-400">
            <span className="h-2 w-2 rounded-[3px]" style={{ backgroundColor: acento(c.cor).dot }} />
            {c.nome}
            <span className="tnum text-ink">{fmtMoney((c.faturaMes || 0) + (c.comprometido || 0))}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const CINZA = "var(--acento-neutro)"; // "sem categoria" — neutro de propósito, não é uma série

// "Para onde vai a fatura": composição do mês (categoria e cartão), histórico de
// 6 meses e uso do limite. Um endpoint só (`/cartoes/resumo`) alimenta os três
// primeiros — 6 meses × N cartões em requests separadas seria dezenas de idas.
function ParaOndeVaiAFatura({ ym, cartoes }) {
  const { categorias } = useFinance();
  const de = addMonths(ym, -5);
  const { dado: resumo, carregando, erro, recarregar } = useAsync(
    () => api.getResumoCartoes(de, ym),
    ["resumoCartoes", de, ym]
  );

  const cartoesMap = useMemo(() => Object.fromEntries(cartoes.map((c) => [c.id, c])), [cartoes]);
  const catMap = useMemo(() => Object.fromEntries(categorias.map((c) => [c.id, c])), [categorias]);
  const doMes = resumo?.meses?.find((m) => m.ym === ym);

  const porCategoria = (doMes?.porCategoria || []).map((x) => {
    const c = x.categoriaId ? catMap[x.categoriaId] : null;
    return { label: c?.nome || "Sem categoria", value: x.total, color: c ? acento(c.cor).dot : CINZA };
  });
  const porCartao = (doMes?.porCartao || []).map((x) => {
    const c = cartoesMap[x.cartaoId];
    return { label: c?.nome || "Cartão removido", value: x.total, color: acento(c?.cor).dot };
  });
  const totalMes = doMes?.total || 0;

  // Série empilhada por cartão. Ordem das séries = ordem dos cartões (fixa):
  // por ranking, trocar de mês repintaria as barras.
  const series = cartoes.map((c) => ({ key: c.id, name: c.nome, color: acento(c.cor).dot }));
  const serie = (resumo?.meses || []).map((m) => ({
    key: m.ym,
    label: fmtMonthShort(m.ym),
    valores: Object.fromEntries(m.porCartao.map((x) => [x.cartaoId ?? "sem", x.total])),
  }));

  // Uso do limite: fatura + comprometido futuro sobre o limite de cada cartão.
  const usoLimite = cartoes
    .filter((c) => (c.limite || 0) > 0)
    .map((c) => {
      const usado = (c.faturaMes || 0) + (c.comprometido || 0);
      return { id: c.id, nome: c.nome, usado, limite: c.limite, pct: usado / c.limite, estourou: c.disponivel < 0, cor: acento(c.cor).dot };
    })
    .sort((a, b) => b.pct - a.pct);

  const titulo = (
    <SectionHeader
      title="Para onde vai a fatura"
      description={resumo ? `${fmtMonthLabel(ym)} · ${fmtMoney(totalMes)} na fatura` : fmtMonthLabel(ym)}
    />
  );

  // Enquanto o resumo não chega, o bloco inteiro é skeleton. Antes ele
  // renderizava os quatro cards com "Nada na fatura deste mês" — indistinguível
  // de uma fatura vazia de verdade, e depois trocava tudo.
  if (carregando || (erro && !resumo)) {
    return (
      <div className="space-y-4">
        {titulo}
        {erro ? (
          <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-sm text-slate-400">Não consegui carregar o resumo da fatura. {erro}</p>
            <Button variant="secondary" size="sm" onClick={recarregar}>Tentar de novo</Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
            <Card className="space-y-4 p-6"><Skeleton className="h-4 w-40" /><SkeletonLines lines={4} /></Card>
            <Card className="space-y-4 p-6"><Skeleton className="h-4 w-36" /><SkeletonLines lines={3} /></Card>
            <Card className="space-y-4 p-6 lg:col-span-2 xl:col-span-1"><Skeleton className="h-4 w-44" /><SkeletonLines lines={3} /></Card>
            <Card className="space-y-4 p-6 lg:col-span-2 xl:col-span-3"><Skeleton className="h-4 w-48" /><SkeletonChart /></Card>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {titulo}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Card className="p-5 sm:p-6">
          <CardHeader title="Por categoria" description="Fatura do mês, todos os cartões" className="mb-5" />
          <HBars items={porCategoria} total={totalMes} empty="Nada na fatura deste mês." />
        </Card>

        <Card className="p-5 sm:p-6">
          <CardHeader title="Por cartão" description="Fatura do mês" className="mb-5" />
          <HBars items={porCartao} total={totalMes} empty="Nada na fatura deste mês." />
        </Card>

        <Card className="p-5 sm:p-6 lg:col-span-2 xl:col-span-1">
          <CardHeader title="Uso do limite" description="Fatura do mês + parcelas ainda por vir" className="mb-5" />
          {usoLimite.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">Nenhum cartão com limite definido.</p>
          ) : (
            // Trilho do tamanho do limite (razão verdadeira, não relativa ao
            // maior): 26% enche um quarto, não a barra inteira.
            <ul className="space-y-3.5">
              {usoLimite.map((u) => {
                const alerta = u.estourou || perto(u.pct);
                return (
                  <li key={u.id}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2 text-slate-200">
                        <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ backgroundColor: u.cor }} />
                        <span className="truncate">{u.nome}</span>
                      </span>
                      <span className={`tnum shrink-0 font-medium ${alerta ? "text-rose-400" : "text-ink"}`}>
                        {Math.round(u.pct * 100)}%
                      </span>
                    </div>
                    <ProgressBar value={u.pct} color={alerta ? COR_ALERTA : u.cor} label={`Limite usado de ${u.nome}`} />
                    <p className="tnum mt-1 text-xs text-slate-500">
                      {fmtMoneyCompact(u.usado)} de {fmtMoneyCompact(u.limite)}
                      {u.estourou && <span className="text-rose-400"> · estourou o limite</span>}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-5 sm:p-6 lg:col-span-2 xl:col-span-3">
          <CardHeader title="Fatura nos últimos 6 meses" description="Empilhada por cartão" className="mb-4" />
          <StackedBars data={serie} series={series} destaque={ym} empty="Sem fatura nesse período." />
        </Card>
      </div>
    </div>
  );
}

// Painel de quitação: quanto falta pra zerar todas as parceladas em aberto da
// conta, quando fica livre e quanto sai mês a mês até lá. Fica aqui (e não em
// Despesas) porque dívida parcelada é assunto de cartão — e porque o escopo é a
// conta inteira, não o espaço ativo: busca as parceladas de todos os espaços,
// igual ao `comprometido` que cada card mostra.
function QuitacaoParceladas({ ym, cartoes }) {
  const { dado: dados, carregando } = useAsync(() => api.getParceladas(ym), ["parceladas", ym]);
  const [aberto, setAberto] = useState(false);
  const cartoesMap = useMemo(() => Object.fromEntries(cartoes.map((c) => [c.id, c])), [cartoes]);
  // o cálculo é genérico e não carrega o espaço da fixa — busca no payload por id
  const fixasMap = useMemo(() => Object.fromEntries((dados?.fixas || []).map((d) => [d.id, d])), [dados]);

  const total = useMemo(
    () => quitacaoParceladas(dados?.fixas, dados?.pagamentos, ym),
    [dados, ym]
  );
  const grupos = useMemo(
    () => quitacaoPorCartao(dados?.fixas, dados?.pagamentos, ym),
    [dados, ym]
  );

  // Só existe painel se houver parcelada em aberto — mas isso a gente só sabe
  // DEPOIS da busca. Sem o skeleton o painel nascia do nada empurrando a página.
  if (carregando) {
    return (
      <Card className="space-y-4 p-5 sm:p-6">
        <Skeleton className="h-4 w-56" />
        <SkeletonList rows={2} height="h-16" label="Carregando parcelas em aberto" />
      </Card>
    );
  }
  if (total.itens.length === 0) return null;

  const mediaMes = total.cronograma.length > 0 ? total.falta / total.cronograma.length : 0;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Quitação das parceladas"
        description={`O que ainda vai cair de ${fmtMonthLabel(ym)} até a última parcela · ${total.itens.length} ${
          total.itens.length === 1 ? "compra em andamento" : "compras em andamento"}`}
      />

      <Card className="p-5 sm:p-6">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
          <Stat className="col-span-2 sm:col-span-1" label="Falta pra quitar tudo" value={fmtMoney(total.falta)} size="lg"
                sub={`de ${fmtMoney(total.contrato)} contratados`} />
          <Stat label={`Ainda sai em ${fmtMonthShort(ym)}`} value={fmtMoney(total.faltaNoMes)}
                sub={`média de ${fmtMoney(mediaMes)}/mês até o fim`} />
          <Stat label="Livre em" value={fmtMonthShort(total.ultimoMes)}
                sub={total.mesesAte === 0
                  ? "última parcela é este mês"
                  : `faltam ${total.mesesAte + 1} ${total.mesesAte + 1 === 1 ? "mês" : "meses"}`} />
        </div>

        <div className="mt-6">
          <div className="mb-1.5 flex items-baseline justify-between text-[13px]">
            <span className="text-slate-400">Já quitado</span>
            <span className="tnum text-slate-400">
              <span className="font-medium text-ink">{fmtMoney(total.quitado)}</span> · {Math.round(total.progresso * 100)}%
            </span>
          </div>
          <ProgressBar value={total.progresso} color="var(--acento-emerald)" label="Parceladas já quitadas" />
        </div>

        {/* por cartão (grupo sem cartão = carnê/boleto) */}
        <div className={`mt-6 grid grid-cols-1 gap-4 ${grupos.length > 1 ? "lg:grid-cols-2" : ""}`}>
          {grupos.map((g) => {
            const c = g.cartaoId ? cartoesMap[g.cartaoId] : null;
            const a = acento(c?.cor || "amber");
            return (
              <div key={g.cartaoId || "sem-cartao"} className="rounded-xl border border-[var(--color-line)] p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[var(--color-line)] pb-3">
                  <p className="flex min-w-0 flex-1 items-center gap-2 truncate font-semibold text-ink">
                    {g.cartaoId && <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: a.dot }} />}
                    <span className="truncate">{g.cartaoId ? c?.nome || "Cartão removido" : "Sem cartão (carnê, boleto)"}</span>
                  </p>
                  <p className="tnum text-right text-sm">
                    <span className="font-semibold text-ink">{fmtMoney(g.falta)}</span>
                    <span className="text-slate-500"> · quita em {fmtMonthShort(g.ultimoMes)}</span>
                  </p>
                </div>
                <ul className="divide-y divide-[var(--color-line)]">
                  {g.itens.map((i) => (
                    <li key={i.id} className="py-3 last:pb-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-200">{i.descricao}</p>
                        <span className="tnum text-sm font-medium text-ink">{fmtMoney(i.falta)}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        <Badge tone="neutral" className="tnum">{i.label}</Badge>
                        <span>
                          {i.notStarted
                            ? `começa em ${fmtMonthShort(i.primeiroMes)}`
                            : `${i.parcelas} ${i.parcelas === 1 ? "parcela" : "parcelas"} de ${fmtMoney(i.valor)}`}
                        </span>
                        <span aria-hidden>·</span>
                        <span>quita em {fmtMonthShort(i.ultimoMes)}</span>
                        {fixasMap[i.id]?.espacoNome && (
                          <>
                            <span aria-hidden>·</span>
                            <span>{fixasMap[i.id].espacoEmoji} {fixasMap[i.id].espacoNome}</span>
                          </>
                        )}
                      </div>
                      <ProgressBar className="mt-2" value={i.progresso} color={a.dot} label={`Progresso de ${i.descricao}`} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* cronograma mês a mês até quitar tudo */}
        <Button variant="ghost" size="sm" className="-ml-3 mt-5" aria-expanded={aberto}
                onClick={() => setAberto((v) => !v)}>
          <ChevronDown size={15} className={`transition-transform ${aberto ? "rotate-180" : ""}`} />
          {aberto ? "Ocultar" : "Ver"} mês a mês até quitar
        </Button>

        {aberto && (
          <ul className="mt-3 space-y-2">
            {total.cronograma.map((m) => (
              <li key={m.ym} className="flex items-center gap-3 text-[13px]">
                <span className={`w-14 shrink-0 ${m.ym === ym ? "font-semibold text-ink" : "text-slate-500"}`}>
                  {fmtMonthShort(m.ym)}
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-trilho)]">
                  <span className={`block h-full rounded-full ${m.ym === ym ? "bg-blue-500" : "bg-blue-500/45"}`}
                        style={{ width: `${total.picoMes > 0 ? (m.valor / total.picoMes) * 100 : 0}%` }} />
                </span>
                <span className="tnum w-24 shrink-0 text-right text-ink">{fmtMoney(m.valor)}</span>
                <span className="w-16 shrink-0 text-right text-slate-500">
                  {m.itens} {m.itens === 1 ? "conta" : "contas"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// Mini-cartão na proporção real (85,6 × 54 mm ≈ 1,6:1) na cor do cartão: é a
// identidade da linha, não um ícone num quadrado.
function ArteCartao({ cor }) {
  return (
    <span aria-hidden className="relative block h-[26px] w-[42px] shrink-0 rounded-[5px]" style={{ backgroundColor: cor }}>
      <span className="absolute left-[7px] top-[8px] h-[7px] w-[9px] rounded-[2px] bg-white/70" />
      <span className="absolute bottom-[5px] right-[6px] h-[3px] w-[12px] rounded-full bg-white/45" />
    </span>
  );
}

function CartaoCard({ cartao: c, ym, canManage, canShare, onEdit, onRemove, onShare }) {
  const a = acento(c.cor);
  const usado = (c.faturaMes || 0) + (c.comprometido || 0);
  const pct = c.limite > 0 ? usado / c.limite : 0;
  const estourado = c.disponivel < 0;
  const alerta = estourado || perto(pct);

  return (
    <Card className="flex flex-col p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ArteCartao cor={a.dot} />
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold text-ink">{c.nome}</h3>
            <p className="tnum truncate text-[13px] text-slate-500">
              {c.bandeira ? `${c.bandeira} · ` : ""}limite {fmtMoney(c.limite)}
            </p>
          </div>
        </div>
        {(canManage || canShare) && (
          <div className="-mr-1.5 flex shrink-0 gap-0.5">
            {canShare && (
              <IconButton onClick={onShare} aria-label={`Compartilhar ${c.nome}`} title="Compartilhar">
                <Users size={16} />
              </IconButton>
            )}
            {canManage && (
              <>
                <IconButton onClick={onEdit} aria-label={`Editar ${c.nome}`} title="Editar">
                  <Pencil size={16} />
                </IconButton>
                <IconButton tone="danger" onClick={onRemove} aria-label={`Remover ${c.nome}`} title="Remover">
                  <Trash2 size={16} />
                </IconButton>
              </>
            )}
          </div>
        )}
      </div>

      {/* a fatura do mês é o número que a pessoa veio ver */}
      <p className="mt-5 text-[13px] text-slate-500">Fatura de {fmtMonthLabel(ym).toLowerCase()}</p>
      <p className="tnum text-2xl font-semibold tracking-[-0.01em] text-ink">{fmtMoney(c.faturaMes)}</p>

      <ProgressBar className="mt-4" value={pct} color={alerta ? COR_ALERTA : a.dot} label={`Limite comprometido de ${c.nome}`} />
      <p className="tnum mt-1.5 text-[13px] text-slate-500">
        <span className={alerta ? "font-medium text-rose-400" : "text-slate-300"}>{Math.round(pct * 100)}%</span>
        {" "}do limite comprometido · {fmtMoney(usado)}
      </p>

      <dl className="mt-4 space-y-2 text-sm">
        <Linha label="Parcelas em aberto" value={c.comprometido} />
        <Linha label="Limite disponível" value={c.disponivel} strong tone={estourado ? "neg" : undefined} />
      </dl>

      <div className="mt-auto pt-5">
        <p className="flex items-center gap-2 border-t border-[var(--color-line)] pt-4 text-[13px] text-slate-500">
          <CalendarClock size={15} strokeWidth={1.75} />
          Vence dia {c.diaVencimento}
          {c.diaFechamento ? ` · fecha dia ${c.diaFechamento}` : ""}
        </p>
      </div>
    </Card>
  );
}

function Linha({ label, value, strong, tone }) {
  const color = tone === "neg" ? "text-rose-400" : "text-ink";
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? "font-medium text-ink" : "text-slate-400"}>{label}</dt>
      <dd className={`tnum ${strong ? "font-semibold" : ""} ${color}`}>{fmtMoney(value)}</dd>
    </div>
  );
}
