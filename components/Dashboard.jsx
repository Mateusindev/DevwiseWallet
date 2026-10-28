"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, PiggyBank, LifeBuoy, ChevronRight } from "lucide-react";
import {
  Card, CardHeader, Button, ProgressBar, Modal, PageHeader, SectionHeader, EmptyState,
  Skeleton, SkeletonChart, SkeletonLines, Spinner,
} from "./ui/primitives.jsx";
import { useAsync } from "./ui/useAsync.js";
import { MonthStepper, Select, SelectItem } from "./ui/fields.jsx";
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

  // Espaço visualizado nos gráficos — independente da página ativa em Despesas.
  // Default = espaço ativo; trocar busca o orçamento do escolhido sem mexer no global.
  const [vizId, setVizId] = useState(activeEspacoId);
  const [vizOrc, setVizOrc] = useState(null); // orçamento buscado p/ espaço != ativo
  const [vizLoading, setVizLoading] = useState(false);

  // ativo só chega depois do boot — adota como default assim que existir
  useEffect(() => { if (vizId == null && activeEspacoId) setVizId(activeEspacoId); }, [activeEspacoId, vizId]);

  useEffect(() => {
    if (!vizId || vizId === activeEspacoId) { setVizOrc(null); return; }
    let cancel = false;
    setVizLoading(true);
    api.getOrcamento(vizId, ym)
      .then((o) => { if (!cancel) setVizOrc(o); })
      .finally(() => { if (!cancel) setVizLoading(false); });
    return () => { cancel = true; };
  }, [vizId, activeEspacoId, ym]);

  // Fonte do orçamento p/ os gráficos: contexto (espaço ativo, dados vivos) ou o buscado.
  const usaAtivo = !vizId || vizId === activeEspacoId;
  const dFixas = usaAtivo ? despesasFixas : (vizOrc?.despesasFixas || []);
  const dMes = usaAtivo ? despesasMes : (vizOrc?.despesasMes || []);
  const rMes = usaAtivo ? receitasMes : (vizOrc?.receitasMes || []);
  const rSkips = usaAtivo ? receitasSkips : (vizOrc?.receitasSkips || []);
  const rendas = usaAtivo ? rendasMensais : (vizOrc?.rendasMensais || {});
  const cfg = usaAtivo ? config : (vizOrc?.config || { rendaMensal: 0 });
  const mComDespesa = usaAtivo ? fin.mesesComDespesa : (vizOrc?.mesesComDespesa || []);

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
    return { limite, usado, disponivel: limite - usado, pct: limite > 0 ? usado / limite : 0 };
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
    <section className="space-y-10">
      {/* convite pendente bloqueia tudo que vem depois — fica antes do resto */}
      {can("cartao:view_shared") && <ConvitesBanner onRespondido={fin.refresh} />}

      <PageHeader
        title="Visão geral"
        description={
          podeOrc && mesVisto ? (
            <>
              {fmtMonthLabel(ym)} · {mesVisto.sobrou >= 0 ? "sobraram " : "faltaram "}
              <span className={`tnum font-medium ${mesVisto.sobrou < 0 ? "text-rose-400" : "text-ink"}`}>
                {fmtMoney(Math.abs(mesVisto.sobrou))}
              </span>
              {nomeEspaco && <> em {nomeEspaco}</>}
            </>
          ) : fmtMonthLabel(ym)
        }
        actions={
          <>
            <MonthStepper value={ym} onValue={setYm} min={janela.min} max={janela.max} marked={comDados} />
            {can("movimentacao:manage") && (
              <>
                <Button variant="outline" onClick={() => setDespesa({})}>Registrar despesa</Button>
                <Button onClick={() => setAporte({})}><Plus size={16} /> Aporte</Button>
              </>
            )}
          </>
        }
      />

      {/* patrimônio + o mês */}
      <div className={`grid grid-cols-1 gap-6 ${podeOrc ? "lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]" : ""}`}>
        <Card className="flex flex-col p-5 sm:p-6">
          <CardHeader title="Total guardado" description={`${caixinhas.length} ${caixinhas.length === 1 ? "caixinha" : "caixinhas"}`} />
          <p className="tnum mt-3 text-[34px] font-semibold leading-10 tracking-[-0.02em] text-ink">{fmtMoney(saldo)}</p>
          <p className="tnum mt-1 text-[13px] text-slate-500">
            <span className="text-slate-300">{fmtMoney(aporteMensal)}</span> por mês em aportes
            {metas.qtd > 0 && (
              <> · {metas.atingidas} de {metas.qtd} {metas.qtd === 1 ? "meta atingida" : "metas atingidas"} ({Math.round(metas.progresso * 100)}% do total)</>
            )}
          </p>

          <BarraComposicao className="mt-6 lg:mt-auto"
            label="Como o total se divide entre as caixinhas"
            partes={ordered.map((c) => ({ key: c.id, label: c.nome, value: c.saldo, color: acento(c.cor).dot }))} />
          {/* legenda que carrega o dado: nome, fatia e valor */}
          <ul className="mt-4 divide-y divide-[var(--color-line)]">
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
          <Card className="flex flex-col p-5 sm:p-6">
            <CardHeader title="Este mês" description={nomeEspaco ? `${fmtMonthLabel(ym)} · ${nomeEspaco}` : fmtMonthLabel(ym)} />
            <dl className="mt-4 space-y-2.5 text-sm">
              <KV label="Recebido" value={`+${fmtMoney(mesVisto.recebido)}`} tone="emerald" />
              <KV label="Despesas fixas" value={fmtMoney(mesVisto.fixas)} />
              <KV label="Despesas do mês" value={fmtMoney(mesVisto.variaveis)} />
            </dl>
            <div className="mt-4 flex items-baseline justify-between border-t border-[var(--color-line)] pt-4">
              <span className="text-sm font-medium text-ink">{mesVisto.sobrou >= 0 ? "Sobrou" : "Faltou"}</span>
              <span className={`tnum text-2xl font-semibold tracking-[-0.01em] ${mesVisto.sobrou < 0 ? "text-rose-400" : "text-ink"}`}>
                {fmtMoney(mesVisto.sobrou)}
              </span>
            </div>

            {/* uso dos cartões: trilho do tamanho do limite, comprometido cheio */}
            <div className="mt-auto pt-6">
              <div className="rounded-xl bg-veu/[0.035] p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[13px] font-medium text-slate-300">Uso dos cartões</p>
                  {cart.limite > 0 && (
                    <p className={`tnum text-[13px] ${cart.pct > 0.9 ? "font-semibold text-rose-400" : "text-slate-400"}`}>
                      {Math.round(cart.pct * 100)}% do limite
                    </p>
                  )}
                </div>
                {cart.limite === 0 ? (
                  <p className="mt-1 text-[13px] text-slate-500">Nenhum cartão cadastrado.</p>
                ) : (
                  <>
                    <ProgressBar className="mt-2.5" value={cart.pct} label="Limite comprometido"
                                 barClass={cart.pct > 0.9 ? "bg-rose-400" : "bg-blue-500"} />
                    <dl className="mt-3 grid grid-cols-3 gap-3 text-[13px]">
                      <MiniKV label="Comprometido" value={fmtMoney(cart.usado)} />
                      <MiniKV label="Disponível" value={fmtMoney(cart.disponivel)} neg={cart.disponivel < 0} />
                      <MiniKV label="Limite" value={fmtMoney(cart.limite)} />
                    </dl>
                  </>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* caixinhas */}
      <div className="space-y-4">
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

      {/* Gráficos do orçamento — espaço escolhido no select (independe da página ativa em Despesas) */}
      {podeOrc && (
        <div className="space-y-4">
          <SectionHeader
            title={<span className="flex items-center gap-2">Orçamento
              {vizLoading && <Spinner className="h-4 w-4 text-slate-500" />}</span>}
            description="Como o dinheiro entra e sai, mês a mês"
            actions={espacos.length > 0 && (
              <label className="flex items-center gap-2 text-[13px] text-slate-500">
                <span className="whitespace-nowrap">Página</span>
                <Select value={vizId ?? ""} onValue={setVizId} className="w-auto min-w-40" placeholder="Selecione…" aria-label="Página do orçamento">
                  {espacos.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.emoji ? `${e.emoji} ` : ""}{e.nome}</SelectItem>
                  ))}
                </Select>
              </label>
            )}
          />
          {/* Primeira carga de uma página que NÃO é a ativa: sem skeleton os
              gráficos apareciam vazios (dados = []) e depois se preenchiam, o
              que se lê como "essa página não tem nada". */}
          {vizLoading && !vizOrc ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card className="space-y-4 p-6 lg:col-span-2"><Skeleton className="h-4 w-52" /><SkeletonChart /></Card>
              <Card className="space-y-4 p-6"><Skeleton className="h-4 w-32" /><SkeletonChart height={150} bars={10} /></Card>
              <Card className="space-y-4 p-6"><Skeleton className="h-4 w-44" /><SkeletonLines lines={5} /></Card>
            </div>
          ) : (
          <div className={`grid grid-cols-1 gap-6 transition-opacity md:grid-cols-2 xl:grid-cols-6 ${vizLoading ? "pointer-events-none opacity-40" : "opacity-100"}`}>
            {/* Sobra mensal — 12 meses (a janela do orçamento já traz esse histórico) */}
            <Card className="p-5 sm:p-6 md:col-span-2 xl:col-span-6">
              <CardHeader title="Sobra mensal" description="Recebido menos gasto, últimos 12 meses" className="mb-5" />
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
          )}
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
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className={`tnum font-medium ${tone === "emerald" ? "text-emerald-400" : "text-ink"}`}>{value}</dd>
    </div>
  );
}

function MiniKV({ label, value, neg }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-slate-500">{label}</dt>
      <dd className={`tnum truncate font-medium ${neg ? "text-rose-400" : "text-ink"}`}>{value}</dd>
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
