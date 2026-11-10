"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, PiggyBank, LifeBuoy, ChevronRight } from "lucide-react";
import {
  Card, CardHeader, Button, ProgressBar, Modal, SectionHeader, EmptyState, Valor,
  SkeletonLines, Spinner,
} from "./ui/primitives.jsx";
import { useAsync } from "./ui/useAsync.js";
import { CabecalhoMes, SeloResumo } from "./ui/cabecalho.jsx";
import { BarraComposicao, GroupedBars, HBars, Legenda, SobraMensal, StackedBars } from "./ui/charts.jsx";
import CaixinhaCard from "./CaixinhaCard.jsx";
import { ConvitesBanner, MeusCompartilhamentos } from "./Compartilhamento.jsx";
import { AporteModal, DespesaVariavelModal, CaixinhaModal, ReservaEmergenciaModal } from "./forms.jsx";
import { fmtMoney, fmtMoneyCompact, currentMonthKey, fmtMonthLabel, fmtMonthShort, lastMonths } from "../lib/format.js";
import { totalSaldo, totalAporteMensal, acento, orcamentoMes, fixaContaNoMes, janelaMeses, mesesComDados } from "../lib/calc.js";
import { useFinance } from "../store/FinanceContext.jsx";
import { useAuth } from "./AuthGate";
import * as api from "../services/financeApi";

const GREY = "var(--acento-neutro)";
// Cores dos gráficos: uma pergunta, um matiz. Entrada é verde (polaridade
// calma: dinheiro que chega), gasto é neutro — não pinta de vermelho toda
// saída normal. O cobalto marca a série principal.
const COR_RECEBIDO = "var(--acento-emerald)";
const COR_GASTO = "var(--acento-neutro)";
const COR_PRINCIPAL = "var(--color-brand)";
const COR_PRINCIPAL_CLARA = "color-mix(in srgb, var(--color-brand) 42%, transparent)";

export default function Dashboard({ onOpenCaixinha }) {
  const fin = useFinance();
  const { can } = useAuth();
  const {
    caixinhas, cartoes, categorias, despesasFixas, despesasMes, receitasMes, receitasSkips,
    rendasMensais, config, reloadCartoes, espacos, activeEspacoId, ym, setYm,
  } = fin;

  // agregados de fatura do mês visto (caso o usuário caia aqui primeiro)
  useEffect(() => {
    if (ym !== currentMonthKey()) reloadCartoes(ym);
    else reloadCartoes();
  }, [ym, reloadCartoes]);

  // A página vem do trocador global no cabeçalho — a mesma de Despesas.
  const vizId = activeEspacoId;
  const vizLoading = fin.orcamentoStatus === "loading";
  const dFixas = despesasFixas;
  const dMes = despesasMes;
  const rMes = receitasMes;
  const rSkips = receitasSkips;
  const rendas = rendasMensais;
  const cfg = config;
  const mComDespesa = fin.mesesComDespesa;

  const catMap = useMemo(() => Object.fromEntries(categorias.map((c) => [c.id, c])), [categorias]);
  // janela do seletor de mês — mesma regra de Despesas (mês global no contexto)
  const comDados = useMemo(
    () => mesesComDados({ rendasMensais: rendas, despesasMes: dMes, receitasMes: rMes, mesesComDespesa: mComDespesa }),
    [rendas, dMes, rMes, mComDespesa]
  );
  const janela = useMemo(() => janelaMeses({ dados: comDados }), [comDados]);
  // série dos últimos 6 meses (evolução + composição)
  const serie = useMemo(() =>
    lastMonths(6, ym).map((m) => ({
      ym: m,
      ...orcamentoMes({ rendasMensais: rendas, despesasMes: dMes, receitasMes: rMes, receitasSkips: rSkips, despesasFixas: dFixas, config: cfg }, m),
    })),
    [rendas, dMes, rMes, rSkips, dFixas, cfg, ym]
  );
  // Sobra pega 12 meses: é a série em que "está melhorando ou piorando?" só
  // aparece com mais de meia dúzia de pontos, e a janela do orçamento já vem
  // com 12 meses pra trás — não custa request nenhuma.
  const serieSobra = useMemo(() =>
    lastMonths(12, ym).map((m) => ({
      key: m,
      label: fmtMonthShort(m),
      ...orcamentoMes({ rendasMensais: rendas, despesasMes: dMes, receitasMes: rMes, receitasSkips: rSkips, despesasFixas: dFixas, config: cfg }, m),
    })),
    [rendas, dMes, rMes, rSkips, dFixas, cfg, ym]
  );

  // despesas do mês por categoria (fixas que caem + avulsas)
  const porCategoria = useMemo(() => {
    const acc = {};
    const add = (id, v) => { const k = id || "__none"; acc[k] = (acc[k] || 0) + v; };
    dFixas.filter((d) => fixaContaNoMes(d, ym)).forEach((d) => add(d.categoriaId, d.valor));
    dMes.filter((d) => d.mes === ym).forEach((d) => add(d.categoriaId, d.valor));
    return Object.entries(acc)
      .map(([id, value]) => {
        const c = id !== "__none" ? catMap[id] : null;
        return { label: c?.nome || "Sem categoria", value, color: c ? acento(c.cor).dot : GREY };
      })
      .sort((a, b) => b.value - a.value);
  }, [dFixas, dMes, catMap, ym]);

  const topFixas = useMemo(() =>
    dFixas
      .filter((d) => fixaContaNoMes(d, ym))
      .map((d) => ({ label: d.descricao, value: d.valor, color: d.categoriaId && catMap[d.categoriaId] ? acento(catMap[d.categoriaId].cor).dot : GREY }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6),
    [dFixas, catMap, ym]
  );

  const cart = useMemo(() => {
    const limite = cartoes.reduce((s, c) => s + (c.limite || 0), 0);
    const usado = cartoes.reduce((s, c) => s + (c.faturaMes || 0) + (c.comprometido || 0), 0);
    const fatura = cartoes.reduce((s, c) => s + (c.faturaMes || 0), 0);
    return { limite, usado, fatura, disponivel: limite - usado, pct: limite > 0 ? usado / limite : 0 };
  }, [cartoes]);

  const gastoCartao = porCategoria.reduce((s, c) => s + c.value, 0);

  // Top 5 categorias no período + "outras": mais que isso e a legenda deixa de
  // ser legível (e a paleta não tem cor honesta pra uma 9ª série).
  const categoriaNoTempo = useMemo(() => {
    const totalPorCat = new Map();
    const porMes = serie.map((sm) => {
      const acc = new Map();
      const add = (id, v) => {
        const k = id || "__none";
        acc.set(k, (acc.get(k) || 0) + v);
        totalPorCat.set(k, (totalPorCat.get(k) || 0) + v);
      };
      dFixas.filter((d) => fixaContaNoMes(d, sm.ym)).forEach((d) => add(d.categoriaId, d.valor));
      dMes.filter((d) => d.mes === sm.ym).forEach((d) => add(d.categoriaId, d.valor));
      return { ym: sm.ym, acc };
    });

    const top = [...totalPorCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
    const series = top.map((k) => {
      const c = k !== "__none" ? catMap[k] : null;
      return { key: k, name: c?.nome || "Sem categoria", color: c ? acento(c.cor).dot : GREY };
    });
    if (totalPorCat.size > top.length) series.push({ key: "__outras", name: "Outras", color: "var(--color-slate-600)" });

    const data = porMes.map((m) => {
      const valores = {};
      let outras = 0;
      for (const [k, v] of m.acc) {
        if (top.includes(k)) valores[k] = v;
        else outras += v;
      }
      if (outras > 0) valores.__outras = outras;
      return { key: m.ym, label: fmtMonthShort(m.ym), valores };
    });
    return { series, data };
  }, [serie, dFixas, dMes, catMap]);

  // Gasto por espaço no mês — uma request agregada. A chave é só o mês: refazer
  // a busca a cada mutação local seria uma ida ao banco por clique.
  const { dado: porEspacoBruto, carregando: carregandoEspacos } = useAsync(
    () => api.getResumoEspacos(ym),
    ["resumoEspacos", ym],
    { ativo: espacos.length > 0 }
  );
  const porEspaco = useMemo(
    () =>
      (porEspacoBruto?.espacos ?? [])
        .filter((e) => e.saiu > 0)
        .map((e) => ({ label: `${e.emoji ? `${e.emoji} ` : ""}${e.nome}`, value: e.saiu }))
        .sort((a, b) => b.value - a.value),
    [porEspacoBruto]
  );

  // null | { caixinhaId? } — com id, o modal abre travado naquela caixinha.
  const [aporte, setAporte] = useState(null);
  const [despesa, setDespesa] = useState(null);
  const [novaMode, setNovaMode] = useState(null); // "choose" | "normal" | "reserva"
  const temReserva = caixinhas.some((c) => c.tipo === "emergencia");

  const saldo = totalSaldo(caixinhas);
  const aporteMensal = totalAporteMensal(caixinhas);
  // Progresso geral rumo às metas (só caixinhas com meta definida).
  const metas = useMemo(() => {
    const comMeta = caixinhas.filter((c) => c.meta);
    const totalMeta = comMeta.reduce((s, c) => s + c.meta, 0);
    const guardado = comMeta.reduce((s, c) => s + Math.min(c.saldo, c.meta), 0);
    return {
      qtd: comMeta.length,
      atingidas: comMeta.filter((c) => c.saldo >= c.meta).length,
      progresso: totalMeta ? guardado / totalMeta : 0,
    };
  }, [caixinhas]);

  const ordered = [...caixinhas].sort((a, b) => a.ordem - b.ordem);
  const espacoViz = espacos.find((e) => e.id === vizId);
  const nomeEspaco = espacoViz ? `${espacoViz.emoji ? `${espacoViz.emoji} ` : ""}${espacoViz.nome}` : "";
  // O mês visto, no espaço visualizado: é a frase debaixo do título.
  const mesVisto = serie[serie.length - 1];
  const podeOrc = can("orcamento:view");

  return (
    <section className="space-y-6">
      {/* convite pendente bloqueia tudo que vem depois — fica antes do resto */}
      {can("cartao:view_shared") && <ConvitesBanner onRespondido={fin.refresh} />}

      <CabecalhoMes
        pagina="Visão geral" contexto={podeOrc ? nomeEspaco : null} trocaPagina={podeOrc}
        ym={ym} onYm={setYm} min={janela.min} max={janela.max} marked={comDados}
        resumo={podeOrc && mesVisto && (
          <SeloResumo tone={mesVisto.sobrou < 0 ? "neg" : "pos"}>
            {mesVisto.sobrou >= 0 ? "Sobraram" : "Faltaram"} {fmtMoney(Math.abs(mesVisto.sobrou))}
          </SeloResumo>
        )}
        actions={can("movimentacao:manage") && (
          <>
            <Button variant="outline" onClick={() => setDespesa({})}>Registrar despesa</Button>
            <Button onClick={() => setAporte({})}><Plus size={16} /> Aporte</Button>
          </>
        )}
      />

      {/* patrimônio · o mês · cartões — três cartões de altura parecida, lado a
          lado: o que a ref faz e a gente não fazia era deixar um cartão alto e
          vazio no meio pra acompanhar o vizinho. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="group flex flex-col p-5">
          <CardHeader title="Total guardado" art="money_bag"
                      description={`${caixinhas.length} ${caixinhas.length === 1 ? "caixinha" : "caixinhas"}`} />
          <p className="mt-2"><Valor value={saldo} className="text-[44px] leading-[52px] text-ink sm:text-[48px] sm:leading-[56px]" /></p>
          <p className="tnum mt-1 text-[13px] text-slate-500">
            <span className="text-slate-300">{fmtMoney(aporteMensal)}</span> por mês em aportes
            {metas.qtd > 0 && (
              <> · {metas.atingidas} de {metas.qtd} {metas.qtd === 1 ? "meta" : "metas"} ({Math.round(metas.progresso * 100)}%)</>
            )}
          </p>

          <BarraComposicao className="mt-5"
            label="Como o total se divide entre as caixinhas"
            partes={ordered.map((c) => ({ key: c.id, label: c.nome, value: c.saldo, color: acento(c.cor).dot }))} />
          {/* legenda que carrega o dado: nome, fatia e valor */}
          <ul className="mt-3 divide-y divide-[var(--color-line)]">
            {ordered.map((c) => (
              <li key={c.id} className="flex items-center gap-2.5 py-2 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: acento(c.cor).dot }} />
                <button onClick={() => onOpenCaixinha(c.id)}
                        className="min-w-0 flex-1 truncate text-left text-slate-200 hover:text-ink hover:underline decoration-veu/30 underline-offset-4 cursor-pointer">
                  {c.nome}
                </button>
                <span className="tnum w-10 text-right text-xs text-slate-500">
                  {saldo > 0 ? `${Math.round((Math.max(c.saldo, 0) / saldo) * 100)}%` : "—"}
                </span>
                <span className="tnum w-28 text-right font-medium text-ink">{fmtMoney(c.saldo)}</span>
              </li>
            ))}
          </ul>
        </Card>

        {podeOrc && mesVisto && (
          <Card className="group flex flex-col p-5">
            <CardHeader title="Este mês" art="spiral_calendar" description={nomeEspaco ? `${fmtMonthLabel(ym)} · ${nomeEspaco}` : fmtMonthLabel(ym)} />
            <div className="mt-2">
              <p className="text-[13px] text-slate-500">{mesVisto.sobrou >= 0 ? "Sobrou" : "Faltou"}</p>
              <Valor value={mesVisto.sobrou} className={`text-[36px] leading-[44px] ${mesVisto.sobrou < 0 ? "text-rose-400" : "text-ink"}`} />
            </div>
            <dl className="mt-4 divide-y divide-[var(--color-line)] border-t border-[var(--color-line)] text-sm">
              <KV label="Recebido" value={`+${fmtMoney(mesVisto.recebido)}`} tone="emerald" />
              <KV label="Despesas fixas" value={fmtMoney(mesVisto.fixas)} />
              <KV label="Despesas do mês" value={fmtMoney(mesVisto.variaveis)} />
            </dl>
          </Card>
        )}

        {/* cartões: fatura do mês somada + uso do limite + um cartão por linha */}
        <Card className="group flex flex-col p-5 md:col-span-2 xl:col-span-1">
          <CardHeader title="Cartões" art="credit_card"
                      description={cart.limite > 0 ? `${Math.round(cart.pct * 100)}% do limite comprometido` : "Nenhum cartão cadastrado"} />
          <div className="mt-2">
            <p className="text-[13px] text-slate-500">Fatura de {fmtMonthLabel(ym).toLowerCase()}</p>
            <Valor value={cart.fatura} className="text-[36px] leading-[44px] text-ink" />
          </div>
          {cart.limite > 0 && (
            <>
              <ProgressBar className="mt-3" value={cart.pct} label="Limite comprometido"
                           barClass={cart.pct > 0.9 ? "bg-rose-400" : "bg-blue-500"} />
              <ul className="mt-3 divide-y divide-[var(--color-line)] text-sm">
                {cartoes.map((c) => (
                  <li key={c.id} className="flex items-center gap-2.5 py-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: acento(c.cor).dot }} />
                    <span className="min-w-0 flex-1 truncate text-slate-200">{c.nome}</span>
                    <span className="tnum text-xs text-slate-500">dia {c.diaVencimento}</span>
                    <span className="tnum w-24 text-right font-medium text-ink">{fmtMoney(c.faturaMes)}</span>
                  </li>
                ))}
              </ul>
              <p className="tnum mt-auto pt-3 text-[13px] text-slate-500">
                <span className={cart.disponivel < 0 ? "font-medium text-rose-400" : "text-slate-300"}>{fmtMoney(cart.disponivel)}</span> livres de {fmtMoney(cart.limite)}
              </p>
            </>
          )}
        </Card>
      </div>

      {/* caixinhas */}
      <div className="space-y-3">
        <SectionHeader
          title="Caixinhas"
          description={aporteMensal > 0 ? `${fmtMoney(aporteMensal)} por mês em aportes programados` : "Cofres com meta, reserva e sobra do mês"}
          actions={can("caixinha:manage") && (
            <Button variant="secondary" size="sm" onClick={() => setNovaMode(temReserva ? "normal" : "choose")}>
              <Plus size={15} /> Nova caixinha
            </Button>
          )}
        />
        {ordered.length === 0 ? (
          <EmptyState title="Nenhuma caixinha ainda"
            description="Comece pela reserva de emergência: ela calcula a meta pelo seu gasto mensal."
            action={can("caixinha:manage") && <Button size="sm" onClick={() => setNovaMode("choose")}><Plus size={15} /> Criar caixinha</Button>} />
        ) : (
          <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${ordered.length >= 3 ? "xl:grid-cols-3" : ""}`}>
            {ordered.map((c) => (
              <CaixinhaCard
                key={c.id}
                caixinha={c}
                onOpen={() => onOpenCaixinha(c.id)}
                onAporte={() => setAporte({ caixinhaId: c.id })}
                onDespesa={() => setDespesa({ caixinhaId: c.id })}
              />
            ))}
          </div>
        )}
      </div>

      {/* Gráficos do orçamento — da página escolhida no trocador do cabeçalho */}
      {podeOrc && (
        <div className="space-y-3">
          <SectionHeader
            title={<span className="flex items-center gap-2">Orçamento
              {vizLoading && <Spinner className="h-4 w-4 text-slate-500" />}</span>}
            description="Como o dinheiro entra e sai, mês a mês"
          />
          <div className={`grid grid-cols-1 gap-4 transition-opacity md:grid-cols-2 xl:grid-cols-6 ${vizLoading ? "pointer-events-none opacity-40" : "opacity-100"}`}>
            {/* Sobra mensal — 12 meses (a janela do orçamento já traz esse histórico) */}
            <Card className="group p-5 sm:p-6 md:col-span-2 xl:col-span-6">
              <CardHeader title="Sobra mensal" art="chart_increasing" description="Recebido menos gasto, últimos 12 meses" className="mb-5" />
              <SobraMensal points={serieSobra} destaque={ym} />
            </Card>

            {/* Evolução mensal */}
            <Card className="p-5 sm:p-6 xl:col-span-3">
              <CardHeader title="Entradas e saídas" description="Últimos 6 meses" className="mb-4" />
              <Legenda className="mb-4" items={[{ name: "Recebido", color: COR_RECEBIDO }, { name: "Gasto", color: COR_GASTO }]} />
              <GroupedBars
                destaque={ym}
                data={serie.map((s) => ({
                  key: s.ym,
                  label: fmtMonthShort(s.ym),
                  bars: [{ name: "Recebido", value: s.recebido, color: COR_RECEBIDO }, { name: "Gasto", value: s.saiu, color: COR_GASTO }],
                }))}
              />
            </Card>

            {/* Fixas × variáveis: mostra se o aperto é estrutural ou pontual */}
            <Card className="p-5 sm:p-6 xl:col-span-3">
              <CardHeader title="Fixas e do mês" description="O aperto é estrutural ou pontual?" className="mb-4" />
              <StackedBars
                destaque={ym}
                series={[
                  { key: "fixas", name: "Fixas", color: COR_PRINCIPAL },
                  { key: "variaveis", name: "Do mês", color: COR_PRINCIPAL_CLARA },
                ]}
                data={serie.map((sm) => ({
                  key: sm.ym,
                  label: fmtMonthShort(sm.ym),
                  valores: { fixas: sm.fixas, variaveis: sm.variaveis },
                }))}
                empty="Sem despesas nesse período."
              />
            </Card>

            {/* Despesas por categoria */}
            <Card className="p-5 sm:p-6 xl:col-span-2">
              <CardHeader title="Por categoria" description={`${fmtMonthLabel(ym)} · ${fmtMoneyCompact(gastoCartao)}`} className="mb-5" />
              <HBars items={porCategoria} empty="Nenhuma despesa neste mês." />
            </Card>

            {/* Top despesas fixas */}
            <Card className="p-5 sm:p-6 xl:col-span-2">
              <CardHeader title="Maiores fixas" description="As 6 que mais pesam no mês" className="mb-5" />
              <HBars items={topFixas} empty="Nenhuma despesa fixa ativa." />
            </Card>

            {/* Gasto por página no mês (todas as páginas, não só a visualizada) */}
            <Card className="p-5 sm:p-6 md:col-span-2 xl:col-span-2">
              <CardHeader title="Por página" description="Fixas + lançadas, em todas as páginas" className="mb-5" />
              {carregandoEspacos ? (
                <SkeletonLines lines={3} />
              ) : (
                // Ranking de uma grandeza só: um matiz, o comprimento diz a ordem.
                <HBars items={porEspaco.map((l) => ({ ...l, color: COR_PRINCIPAL }))}
                       empty="Nenhuma despesa neste mês." />
              )}
            </Card>

            {/* Categoria ao longo do tempo */}
            <Card className="p-5 sm:p-6 md:col-span-2 xl:col-span-6">
              <CardHeader title="Categorias ao longo do tempo" description="As 5 maiores dos últimos 6 meses" className="mb-4" />
              <StackedBars
                destaque={ym}
                series={categoriaNoTempo.series}
                data={categoriaNoTempo.data}
                empty="Sem despesas nesse período."
              />
            </Card>
          </div>
        </div>
      )}

      {can("cartao:view_shared") && <MeusCompartilhamentos ym={ym} />}

      <AporteModal open={!!aporte} onClose={() => setAporte(null)} caixinhas={ordered}
                   defaultCaixinhaId={aporte?.caixinhaId} lockCaixinha={!!aporte?.caixinhaId} />
      <DespesaVariavelModal open={!!despesa} onClose={() => setDespesa(null)} caixinhas={ordered}
                            defaultCaixinhaId={despesa?.caixinhaId} lockCaixinha={!!despesa?.caixinhaId} />

      {/* Passo 1: escolher o tipo de caixinha a criar */}
      <Modal open={novaMode === "choose"} onClose={() => setNovaMode(null)} title="Nova caixinha"
             description="Que tipo de cofre você quer abrir?">
        <div className="space-y-2.5">
          <TipoOpcao icon={LifeBuoy} title="Reserva de emergência"
            desc="Meta calculada pelas suas respostas: meses de segurança × gasto mensal."
            onClick={() => setNovaMode("reserva")} />
          <TipoOpcao icon={PiggyBank} title="Caixinha comum"
            desc="Meta livre, aporte mensal e rendimento, pra qualquer objetivo."
            onClick={() => setNovaMode("normal")} />
        </div>
      </Modal>

      <CaixinhaModal open={novaMode === "normal"} onClose={() => setNovaMode(null)} />
      <ReservaEmergenciaModal open={novaMode === "reserva"} onClose={() => setNovaMode(null)}
        onCreated={() => setNovaMode(null)} />
    </section>
  );
}

// Linha rótulo/valor do resumo do mês.
function KV({ label, value, tone }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-slate-400">{label}</dt>
      <dd className={`tnum font-medium ${tone === "emerald" ? "text-emerald-400" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

// Opção de tipo no passo 1 do "Nova caixinha".
function TipoOpcao({ icon: Icon, title, desc, onClick }) {
  return (
    <button onClick={onClick}
      className="group flex w-full items-center gap-3.5 rounded-xl border border-[var(--color-line-strong)] p-4 text-left transition-colors hover:border-veu/30 hover:bg-veu/[0.03] cursor-pointer">
      <Icon size={20} strokeWidth={1.75} className="shrink-0 text-slate-400" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-[13px] text-slate-500">{desc}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}
