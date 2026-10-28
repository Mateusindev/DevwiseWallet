"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Popover as RPopover } from "radix-ui";
import {
  Plus, Trash2, Pencil, Check, CreditCard, X, Undo2, Repeat, Upload, Split, Pause, Play, MoreHorizontal, EyeOff,
} from "lucide-react";
import {
  Card, Button, Field, MoneyInput, Spinner, Modal, PageHeader, SectionHeader, EmptyState, Badge, IconButton,
} from "./ui/primitives.jsx";
import { Checkbox, CheckboxField, FormError, MonthStepper, Select, SelectItem } from "./ui/fields.jsx";
import { BarraComposicao } from "./ui/charts.jsx";
import BulkBar, { BulkAcao } from "./BulkBar.jsx";
import ImportOfxModal from "./ImportOfx.jsx";
import { MeusCompartilhamentos, RateioChips, RatearModal } from "./Compartilhamento.jsx";
import { useSelecao } from "./ui/useSelecao.js";
import { mensagemDeErro } from "../lib/formErrors.js";
import { DespesaFixaModal, DespesaMesModal, ReceitaMesModal, EspacoModal } from "./forms.jsx";
import { fmtDate, fmtMoney, fmtMonthLabel } from "../lib/format.js";
import { totalFixasNoMes, despesasDoMes, receitasDoMes, orcamentoMes, janelaMeses, mesesComDados, rendaDoMes, parcelaInfo, fixaContaNoMes, fixaPaga, fixaValorPago, fixaFaltaPagar, fixaParcial, acento, espacoOcultoNoMes, espacosVisiveisNoMes, espacosOcultosNoMes, valorEfetivoLinha } from "../lib/calc.js";
import { useFinance } from "../store/FinanceContext.jsx";
import { useAuth } from "./AuthGate";

// Cores da barra "pra onde foi o recebido": um matiz (cobalto) em dois tons
// pras saídas, verde pro que sobrou — a mesma polaridade calma do resto.
const COR_FIXAS = "var(--color-brand)";
const COR_DO_MES = "color-mix(in srgb, var(--color-brand) 42%, transparent)";
const COR_SOBRA = "var(--acento-emerald)";

// Opção do seletor de escopo (recorrente): título + o que acontece de fato.
function EscopoOpcao({ titulo, desc, tone, disabled, onClick }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`w-full rounded-xl border p-4 text-left transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
        tone === "danger"
          ? "border-rose-400/30 hover:bg-rose-500/[0.06]"
          : "border-[var(--color-line-strong)] hover:border-veu/30 hover:bg-veu/[0.03]"
      }`}>
      <span className={`block font-semibold ${tone === "danger" ? "text-rose-400" : "text-ink"}`}>{titulo}</span>
      <span className="mt-0.5 block text-[13px] text-slate-500">{desc}</span>
    </button>
  );
}

// Etiqueta de categoria numa linha de despesa: tom pálido com a tinta do mesmo matiz.
function CategoriaBadge({ d, categoriasMap }) {
  if (!d.categoriaId) return null;
  const c = categoriasMap[d.categoriaId];
  if (!c) return null;
  return <Badge className={acento(c.cor).chip}>{c.nome}</Badge>;
}

// Etiqueta de cartão + parcela numa linha de despesa (parcela auto-avança pelo mês `ym`).
function CartaoBadge({ d, cartoesMap, ym }) {
  if (!d.cartaoId) return null;
  const c = cartoesMap[d.cartaoId];
  const parc = parcelaInfo(d, ym);
  return (
    <>
      <Badge className={acento(c?.cor || "violet").chip}>
        <CreditCard size={12} /> {c?.nome || "Cartão"}
      </Badge>
      {parc && (
        parc.ended ? (
          <span className="tnum text-xs text-emerald-400">parcelas quitadas ({parc.total}/{parc.total})</span>
        ) : (
          <span className="tnum text-xs text-slate-500">
            parcela {parc.label}{parc.restantes > 0 ? ` · faltam ${parc.restantes} (${fmtMoney(parc.valorRestante)})` : " · última"}
          </span>
        )
      )}
    </>
  );
}

// Valor da linha: o efetivo (só a parte do dono quando abate o rateio) com o
// cheio riscado de referência. Linha paga fica em cinza — o status já está no
// botão de pagamento; pintar a linha inteira de verde era ruído.
function ValorLinha({ d, quitada, sinal }) {
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className={`tnum text-[15px] font-semibold ${sinal === "+" ? "text-emerald-400" : quitada ? "text-slate-400" : "text-ink"}`}>
        {sinal}{fmtMoney(sinal === "+" ? d.valor : valorEfetivoLinha(d))}
      </span>
      {/* abateShares: o total conta só a parte do dono; o cheio fica de referência */}
      {d.abateShares && d.rateio?.length > 0 && (
        <span className="tnum text-xs text-slate-500 line-through">{fmtMoney(d.valor)}</span>
      )}
    </span>
  );
}

// Linha de lista (receita, despesa do mês, fixa). No desktop é uma linha só:
// seleção · texto · valor · ações. No celular o valor fica à direita do texto
// e as ações descem pra uma faixa própria, alinhada à direita.
function Linha({ selecionada, apagada, sel, children, valor, acoes }) {
  return (
    <li className={`flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3.5 transition-colors sm:flex-nowrap sm:items-center sm:px-5 ${
      selecionada ? "bg-blue-500/[0.06]" : "hover:bg-veu/[0.02]"} ${apagada ? "opacity-60" : ""}`}>
      {sel && <span className="flex h-6 items-center sm:h-auto">{sel}</span>}
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex shrink-0 justify-end sm:w-32">{valor}</div>
      {acoes && (
        <div className="flex basis-full items-center justify-end gap-1 sm:basis-auto">{acoes}</div>
      )}
    </li>
  );
}

function Meta({ children }) {
  return <p className="tnum mt-0.5 text-[13px] text-slate-500">{children}</p>;
}

export default function DespesasFixas() {
  const fin = useFinance();
  const {
    despesasFixas, despesasMes, receitasMes, receitasSkips, rendasMensais, config,
    espacos, espacosOcultos, activeEspacoId, orcamentoStatus, cartoes, categorias, pagamentosFixas,
    setActiveEspaco, toggleDespesaFixa, removeDespesaFixa, removeDespesaMes, removeReceitaMes, setPagamentoFixa, setPagaMes,
    bulkMes, bulkFixas, skipReceitaMes, encerrarReceitaMes, ym, setYm, mesesComDespesa,
  } = fin;
  const cartoesMap = useMemo(() => Object.fromEntries(cartoes.map((c) => [c.id, c])), [cartoes]);
  const categoriasMap = useMemo(() => Object.fromEntries(categorias.map((c) => [c.id, c])), [categorias]);
  const { can } = useAuth();
  const canOrc = can("orcamento:manage");

  const [fixaOpen, setFixaOpen] = useState(false);
  const [mesOpen, setMesOpen] = useState(false);
  const [receitaOpen, setReceitaOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editFixa, setEditFixa] = useState(null);
  const [editMes, setEditMes] = useState(null);
  const [editReceita, setEditReceita] = useState(null);
  const [delFixa, setDelFixa] = useState(null); // despesa fixa a excluir (confirma)
  const [delMes, setDelMes] = useState(null); // despesa do mês a excluir
  const [delReceita, setDelReceita] = useState(null); // receita do mês a excluir
  // Recorrente não tem "uma linha só": editar/excluir precisa saber o escopo.
  const [escopoReceita, setEscopoReceita] = useState(null); // { r, acao: "editar" | "excluir" }
  const [escopoEdicao, setEscopoEdicao] = useState("todas");
  const [delBusy, setDelBusy] = useState(false);
  // { linha, campo: "fixa" | "mes" } — divisão da linha entre N pessoas
  const [ratear, setRatear] = useState(null);

  async function excluirFixa() {
    setDelBusy(true);
    try { await removeDespesaFixa(delFixa.id); setDelFixa(null); }
    finally { setDelBusy(false); }
  }
  async function excluirMes() {
    setDelBusy(true);
    try { await removeDespesaMes(delMes.id); setDelMes(null); }
    finally { setDelBusy(false); }
  }
  async function excluirReceita() {
    setDelBusy(true);
    try { await removeReceitaMes(delReceita.id); setDelReceita(null); }
    finally { setDelBusy(false); }
  }

  // Clique em editar/excluir numa recorrente passa antes pelo seletor de escopo.
  function pedirReceita(r, acao) {
    if (r.recorrente) { setEscopoReceita({ r, acao }); return; }
    if (acao === "editar") setEditReceita(r);
    else setDelReceita(r);
  }

  async function aplicarEscopo(escopo) {
    const { r, acao } = escopoReceita;
    if (acao === "editar") {
      setEscopoEdicao(escopo);
      setEscopoReceita(null);
      setEditReceita(r);
      return;
    }
    setDelBusy(true);
    try {
      if (escopo === "mes") await skipReceitaMes(r.id, ym);
      else if (escopo === "diante") await encerrarReceitaMes(r.id, ym);
      else await removeReceitaMes(r.id);
      setEscopoReceita(null);
    } finally { setDelBusy(false); }
  }

  // Pontinho nos meses com lançamento; janela navegável esticada pelo dado mais antigo.
  const comDados = useMemo(
    () => mesesComDados({ rendasMensais, despesasMes, receitasMes, mesesComDespesa }),
    [rendasMensais, despesasMes, receitasMes, mesesComDespesa]
  );
  const janela = useMemo(() => janelaMeses({ dados: comDados }), [comDados]);
  const orc = useMemo(
    () => orcamentoMes({ rendasMensais, despesasMes, receitasMes, receitasSkips, despesasFixas, config }, ym),
    [rendasMensais, despesasMes, receitasMes, receitasSkips, despesasFixas, config, ym]
  );
  const fixasAtivas = totalFixasNoMes(despesasFixas, ym);
  const doMes = useMemo(
    () => [...despesasDoMes(despesasMes, ym)].sort((a, b) => b.valor - a.valor),
    [despesasMes, ym]
  );
  // inclui as recorrentes que caem no mês (menos as puladas)
  const receitasDoMesList = useMemo(
    () => receitasDoMes(receitasMes, ym, receitasSkips),
    [receitasMes, receitasSkips, ym]
  );
  // ordem só por valor — pago/não pago não mexe na posição.
  const fixasOrdenadas = [...despesasFixas].sort((a, b) => b.valor - a.valor);
  // resumo de pagamento — só conta fixas que caem no mês (parcelas quitadas/pausadas fora).
  const fixasNoMes = useMemo(() => fixasOrdenadas.filter((d) => fixaContaNoMes(d, ym)), [fixasOrdenadas, ym]);
  const fixasPagasCount = fixasNoMes.filter((d) => fixaPaga(pagamentosFixas, d, ym)).length;
  // falta = soma do que ainda resta em cada fixa (desconta pagamentos parciais).
  const faltaPagar = fixasNoMes.reduce((s, d) => s + fixaFaltaPagar(pagamentosFixas, d, ym), 0);

  // ── Seleção em lote ───────────────────────────────────────────────────────
  // Uma chave por mês+espaço: trocar de mês não pode deixar id antigo na
  // seleção (a ação sairia com linha de outro mês).
  const chaveSel = `${ym}:${activeEspacoId}`;
  const selMes = useSelecao(useMemo(() => doMes.map((d) => d.id), [doMes]), chaveSel);
  const selFixas = useSelecao(useMemo(() => fixasOrdenadas.map((d) => d.id), [fixasOrdenadas]), chaveSel);
  const [loteBusy, setLoteBusy] = useState(false);
  const [loteErr, setLoteErr] = useState("");
  const [loteAviso, setLoteAviso] = useState("");
  const [atribuir, setAtribuir] = useState(null); // "categoria" | "cartao"
  const [alvoId, setAlvoId] = useState("");
  const [delLote, setDelLote] = useState(false);

  // As duas listas têm operações diferentes (fixa tem pausar/ativar, mês não),
  // então a barra atende uma por vez: marcar numa limpa a outra.
  const marcarMes = (id, shift) => { selFixas.limpar(); zerarFeedback(); selMes.toggle(id, shift); };
  const marcarFixa = (id, shift) => { selMes.limpar(); zerarFeedback(); selFixas.toggle(id, shift); };
  const alvoLote = selMes.quantos > 0 ? "mes" : selFixas.quantos > 0 ? "fixas" : null;
  const linhasLote = alvoLote === "mes" ? doMes.filter((d) => selMes.tem(d.id)) : fixasOrdenadas.filter((d) => selFixas.tem(d.id));
  const totalLote = linhasLote.reduce((soma, d) => soma + d.valor, 0);

  function zerarFeedback() { setLoteErr(""); setLoteAviso(""); }
  function limparLote() { selMes.limpar(); selFixas.limpar(); zerarFeedback(); }

  async function aplicarLote(op, extra = {}) {
    const ids = linhasLote.map((d) => d.id);
    if (ids.length === 0) return;
    setLoteBusy(true);
    zerarFeedback();
    try {
      const r = alvoLote === "mes" ? await bulkMes({ ids, op, ...extra }) : await bulkFixas({ ids, op, ym, ...extra });
      setAtribuir(null);
      setDelLote(false);
      // parcelada fora da janela do mês não tem o que pagar: some do lote e o
      // usuário precisa saber que aquelas linhas ficaram como estavam.
      if (r.ignoradas > 0) {
        setLoteAviso(`${r.ignoradas} ${r.ignoradas === 1 ? "linha foi ignorada" : "linhas foram ignoradas"}: parcela fora deste mês.`);
      } else {
        limparLote();
      }
    } catch (e) {
      setLoteErr(mensagemDeErro(e));
    } finally {
      setLoteBusy(false);
    }
  }

  const espacoAtivo = espacos.find((e) => e.id === activeEspacoId);
  const loading = orcamentoStatus === "loading";

  // Página ativa oculta no mês visto → pula pra primeira visível (mantém coerência
  // entre aba selecionada e conteúdo mostrado).
  useEffect(() => {
    if (activeEspacoId && espacoOcultoNoMes(espacosOcultos, activeEspacoId, ym)) {
      const vis = espacosVisiveisNoMes(espacos, espacosOcultos, ym);
      if (vis[0] && vis[0].id !== activeEspacoId) setActiveEspaco(vis[0].id);
    }
  }, [ym, activeEspacoId, espacosOcultos, espacos, setActiveEspaco]);

  const nomeEspaco = espacoAtivo ? `${espacoAtivo.emoji ? `${espacoAtivo.emoji} ` : ""}${espacoAtivo.nome}` : "";

  return (
    <section className="space-y-8">
      <PageHeader
        title="Despesas"
        description={
          <>
            {nomeEspaco && <>{nomeEspaco} · </>}{fmtMonthLabel(ym)} · {orc.sobrou >= 0 ? "sobraram " : "faltaram "}
            <span className={`tnum font-medium ${orc.sobrou < 0 ? "text-rose-400" : "text-ink"}`}>{fmtMoney(Math.abs(orc.sobrou))}</span>
          </>
        }
        actions={
          <>
            <MonthStepper value={ym} onValue={setYm} min={janela.min} max={janela.max} marked={comDados} />
            {canOrc && <Button onClick={() => setMesOpen(true)}><Plus size={16} /> Despesa</Button>}
          </>
        }
      />

      {/* espaço (Nosso / Meu) — só o orçamento muda, caixinhas seguem globais */}
      <EspacoTabs ym={ym} />

      {/* conteúdo do orçamento — esmaece durante troca de espaço */}
      <div className={`space-y-10 transition-opacity ${loading ? "pointer-events-none opacity-40" : "opacity-100"}`}>
        {/* resumo: a sobra é a resposta; o razão embaixo diz de onde ela veio */}
        <Card className="grid grid-cols-1 gap-8 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-10">
          <div className="flex flex-col">
            <p className="text-[13px] text-slate-500">{orc.sobrou >= 0 ? "Sobrou" : "Faltou"} em {fmtMonthLabel(ym)}</p>
            <p className={`tnum mt-1 text-[34px] font-semibold leading-10 tracking-[-0.02em] ${orc.sobrou < 0 ? "text-rose-400" : "text-ink"}`}>
              {fmtMoney(orc.sobrou)}
            </p>
            <p className="tnum mt-1 text-[13px] text-slate-500">
              {orc.recebido > 0
                ? <>{Math.round((orc.sobrou / orc.recebido) * 100)}% dos {fmtMoney(orc.recebido)} recebidos</>
                : "Nada recebido neste mês"}
            </p>
            <div className="mt-6 lg:mt-auto">
              <BarraComposicao
                label="Para onde foi o que entrou"
                partes={[
                  { key: "fixas", label: "Fixas", value: orc.fixas, color: COR_FIXAS },
                  { key: "mes", label: "Do mês", value: orc.variaveis, color: COR_DO_MES },
                  { key: "sobra", label: "Sobrou", value: Math.max(orc.sobrou, 0), color: COR_SOBRA },
                ]}
              />
              {/* legenda que carrega o dado: fatia de cada parte no recebido */}
              <dl className="mt-4 grid grid-cols-3 gap-3 text-[13px]">
                {[
                  { k: "Fixas", v: orc.fixas, c: COR_FIXAS },
                  { k: "Do mês", v: orc.variaveis, c: COR_DO_MES },
                  { k: "Sobrou", v: Math.max(orc.sobrou, 0), c: COR_SOBRA },
                ].map((x) => (
                  <div key={x.k} className="min-w-0">
                    <dt className="flex items-center gap-1.5 text-slate-500">
                      <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ backgroundColor: x.c }} /> {x.k}
                    </dt>
                    <dd className="tnum mt-0.5 truncate font-medium text-ink">
                      {orc.recebido > 0 ? `${Math.round((x.v / orc.recebido) * 100)}%` : "—"}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <dl className="text-sm">
            <SalarioLinha ym={ym} valor={rendaDoMes(rendasMensais, config, ym)}
              fixa={config.rendaMensal || 0} override={rendasMensais[ym] ?? null} />
            <Row label="Receitas extras" value={orc.extras} sinal="+" tone="pos" />
            <Row label="Recebido no mês" value={orc.recebido} strong />
            <Row label="Despesas fixas" value={orc.fixas} sinal="−" />
            <Row label="Despesas do mês" value={orc.variaveis} sinal="−" />
            <Row label={orc.sobrou >= 0 ? "Sobrou" : "Faltou"} value={orc.sobrou} strong tone={orc.sobrou < 0 ? "neg" : undefined} ultima />
          </dl>
        </Card>

        {/* receitas extras do mês */}
        <div className="space-y-3">
          <SectionHeader
            title="Receitas extras"
            description={<span className="tnum">{fmtMoney(orc.extras)} em {fmtMonthLabel(ym)}</span>}
            actions={canOrc && (
              <Button variant="secondary" size="sm" onClick={() => setReceitaOpen(true)}>
                <Plus size={15} /> Receita
              </Button>
            )}
          />
          {receitasDoMesList.length === 0 ? (
            <EmptyState compact title="Nenhuma receita extra neste mês"
              description="Dinheiro por fora além do salário: freela, bônus, venda…" />
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-[var(--color-line)]">
                {receitasDoMesList.map((r) => (
                  <Linha key={r.key}
                    valor={<ValorLinha d={r} sinal="+" />}
                    acoes={canOrc && (
                      <>
                        <IconButton onClick={() => pedirReceita(r, "editar")} aria-label={`Editar ${r.descricao}`} title="Editar">
                          <Pencil size={15} />
                        </IconButton>
                        <IconButton tone="danger" onClick={() => pedirReceita(r, "excluir")} aria-label={`Remover ${r.descricao}`} title="Remover">
                          <Trash2 size={15} />
                        </IconButton>
                      </>
                    )}>
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate font-medium text-ink">{r.descricao}</p>
                      {r.recorrente && <Badge tone="neutral"><Repeat size={11} /> recorrente</Badge>}
                    </div>
                    {(r.data || (r.recorrente && r.mesFim)) && (
                      <Meta>
                        {r.data && fmtDate(r.data)}
                        {r.recorrente && r.mesFim && <>{r.data ? " · " : ""}até {fmtMonthLabel(r.mesFim)}</>}
                      </Meta>
                    )}
                  </Linha>
                ))}
              </ul>
            </Card>
          )}
        </div>

        {/* despesas do mês */}
        <div className="space-y-3">
          <SectionHeader
            title="Despesas do mês"
            description={<span className="tnum">{fmtMoney(orc.variaveis)} em {doMes.length} {doMes.length === 1 ? "lançamento" : "lançamentos"}</span>}
            actions={canOrc && (
              <>
                {doMes.length > 0 && (
                  <label className="mr-1 flex h-8 items-center gap-2 text-[13px] text-slate-400 cursor-pointer">
                    <Checkbox checked={selMes.estadoTodos}
                              onChecked={() => {}}
                              onClick={() => { selFixas.limpar(); zerarFeedback(); selMes.toggleTodos(); }}
                              aria-label="Selecionar todas as despesas do mês" />
                    Todas
                  </label>
                )}
                <Button variant="ghost" size="sm" onClick={() => setImportOpen(true)} title="Importar extrato/fatura OFX">
                  <Upload size={15} /> Importar OFX
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setMesOpen(true)}>
                  <Plus size={15} /> Despesa
                </Button>
              </>
            )}
          />
          {doMes.length === 0 ? (
            <EmptyState compact title="Nenhuma despesa lançada neste mês"
              description="Mercado, farmácia, aquela compra no cartão. Dá pra importar o extrato em OFX." />
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-[var(--color-line)]">
                {doMes.map((d) => {
                  const pago = d.paga;
                  const parcial = !pago && (d.valorPago || 0) > 0;
                  return (
                    <Linha key={d.id}
                      selecionada={selMes.tem(d.id)}
                      sel={canOrc && (
                        <Checkbox checked={selMes.tem(d.id)} onChecked={() => {}}
                                  onClick={(e) => marcarMes(d.id, e.shiftKey)}
                                  aria-label={`Selecionar ${d.descricao}`} />
                      )}
                      valor={<ValorLinha d={d} quitada={pago} />}
                      acoes={canOrc && (
                        <>
                          <PagarControl valor={d.valor} valorPago={d.valorPago || 0} onSet={(v) => setPagaMes(d.id, v)} />
                          <IconButton onClick={() => setRatear({ linha: d, campo: "mes" })} aria-label={`Dividir ${d.descricao}`} title="Dividir com pessoas">
                            <Split size={15} />
                          </IconButton>
                          <IconButton onClick={() => setEditMes(d)} aria-label={`Editar ${d.descricao}`} title="Editar">
                            <Pencil size={15} />
                          </IconButton>
                          <IconButton tone="danger" onClick={() => setDelMes(d)} aria-label={`Remover ${d.descricao}`} title="Remover">
                            <Trash2 size={15} />
                          </IconButton>
                        </>
                      )}>
                      <p className="truncate font-medium text-ink">{d.descricao}</p>
                      {(d.data || parcial) && (
                        <Meta>
                          {d.data && fmtDate(d.data)}
                          {parcial && <>{d.data ? " · " : ""}<span className="text-amber-400">pago {fmtMoney(d.valorPago)} de {fmtMoney(d.valor)}</span></>}
                        </Meta>
                      )}
                      {d.nota && <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-slate-400">{d.nota}</p>}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 empty:hidden">
                        <CategoriaBadge d={d} categoriasMap={categoriasMap} />
                        <CartaoBadge d={d} cartoesMap={cartoesMap} ym={ym} />
                        <RateioChips d={d} />
                      </div>
                    </Linha>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>

        {/* despesas fixas */}
        <div className="space-y-3">
          <SectionHeader
            title="Despesas fixas"
            description={
              <span className="tnum">
                {fmtMoney(fixasAtivas)} por mês
                {fixasNoMes.length > 0 && (
                  fixasPagasCount === fixasNoMes.length ? (
                    <> · <span className="text-emerald-400">tudo pago em {fmtMonthLabel(ym)}</span></>
                  ) : (
                    <> · {fixasPagasCount} de {fixasNoMes.length} pagas · faltam <span className="font-medium text-ink">{fmtMoney(faltaPagar)}</span></>
                  )
                )}
              </span>
            }
            actions={canOrc && (
              <>
                {fixasOrdenadas.length > 0 && (
                  <label className="mr-1 flex h-8 items-center gap-2 text-[13px] text-slate-400 cursor-pointer">
                    <Checkbox checked={selFixas.estadoTodos}
                              onChecked={() => {}}
                              onClick={() => { selMes.limpar(); zerarFeedback(); selFixas.toggleTodos(); }}
                              aria-label="Selecionar todas as despesas fixas" />
                    Todas
                  </label>
                )}
                <Button variant="secondary" size="sm" onClick={() => setFixaOpen(true)}>
                  <Plus size={15} /> Fixa
                </Button>
              </>
            )}
          />
          {fixasOrdenadas.length === 0 ? (
            <EmptyState compact title="Nenhuma despesa fixa cadastrada"
              description="Aluguel, internet, assinaturas: o que se repete todo mês." />
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-[var(--color-line)]">
                {fixasOrdenadas.map((d) => {
                  const conta = fixaContaNoMes(d, ym);
                  const paga = conta && fixaPaga(pagamentosFixas, d, ym);
                  const parcial = conta && fixaParcial(pagamentosFixas, d, ym);
                  const valorPago = fixaValorPago(pagamentosFixas, d.id, ym);
                  return (
                    <Linha key={d.id}
                      selecionada={selFixas.tem(d.id)}
                      apagada={!d.ativa}
                      sel={canOrc && (
                        <Checkbox checked={selFixas.tem(d.id)} onChecked={() => {}}
                                  onClick={(e) => marcarFixa(d.id, e.shiftKey)}
                                  aria-label={`Selecionar ${d.descricao}`} />
                      )}
                      valor={<ValorLinha d={d} quitada={paga} />}
                      acoes={canOrc && (
                        <>
                          {conta && <PagarControl valor={d.valor} valorPago={valorPago} onSet={(v) => setPagamentoFixa(d.id, ym, v)} />}
                          <IconButton onClick={() => setRatear({ linha: d, campo: "fixa" })} aria-label={`Dividir ${d.descricao}`} title="Dividir com pessoas">
                            <Split size={15} />
                          </IconButton>
                          {/* pausar/ativar: era um segundo checkbox na linha, ao lado do de seleção */}
                          <IconButton onClick={() => toggleDespesaFixa(d.id)} aria-pressed={!d.ativa}
                                      aria-label={d.ativa ? `Pausar ${d.descricao}` : `Ativar ${d.descricao}`}
                                      title={d.ativa ? "Pausar" : "Ativar"}>
                            {d.ativa ? <Pause size={15} /> : <Play size={15} />}
                          </IconButton>
                          <IconButton onClick={() => setEditFixa(d)} aria-label={`Editar ${d.descricao}`} title="Editar">
                            <Pencil size={15} />
                          </IconButton>
                          <IconButton tone="danger" onClick={() => setDelFixa(d)} aria-label={`Remover ${d.descricao}`} title="Remover">
                            <Trash2 size={15} />
                          </IconButton>
                        </>
                      )}>
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate font-medium text-ink">{d.descricao}</p>
                        {!d.ativa && <Badge tone="neutral">Pausada</Badge>}
                      </div>
                      <Meta>
                        vence dia {d.diaVencimento}
                        {parcial && <> · <span className="text-amber-400">pago {fmtMoney(valorPago)} de {fmtMoney(d.valor)}</span></>}
                      </Meta>
                      {d.nota && <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-slate-400">{d.nota}</p>}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 empty:hidden">
                        <CategoriaBadge d={d} categoriasMap={categoriasMap} />
                        <CartaoBadge d={d} cartoesMap={cartoesMap} ym={ym} />
                        <RateioChips d={d} />
                      </div>
                    </Linha>
                  );
                })}
              </ul>
            </Card>
          )}
        </div>
        {/* espaço pra última linha não ficar debaixo da BulkBar */}
        {alvoLote && <div className="h-20" aria-hidden />}
      </div>{/* /conteúdo do orçamento */}

      {can("cartao:view_shared") && <MeusCompartilhamentos ym={ym} />}

      <RatearModal
        open={!!ratear}
        onClose={() => setRatear(null)}
        linha={ratear?.linha}
        campo={ratear?.campo}
        onSaved={fin.refresh}
      />

      {canOrc && (
        <BulkBar
          quantos={linhasLote.length}
          total={totalLote}
          label={alvoLote === "mes" ? "selecionadas" : "fixas selecionadas"}
          aviso={loteAviso}
          erro={loteErr}
          onLimpar={limparLote}
        >
          <BulkAcao tone="growth" disabled={loteBusy} onClick={() => aplicarLote("pagar")}>Pagar</BulkAcao>
          <BulkAcao disabled={loteBusy} onClick={() => aplicarLote("despagar")}>Desfazer</BulkAcao>
          <BulkAcao disabled={loteBusy} onClick={() => { setAlvoId(""); zerarFeedback(); setAtribuir("categoria"); }}>Categoria</BulkAcao>
          <BulkAcao disabled={loteBusy} onClick={() => { setAlvoId(""); zerarFeedback(); setAtribuir("cartao"); }}>Cartão</BulkAcao>
          {alvoLote === "fixas" && (
            <>
              <BulkAcao disabled={loteBusy} onClick={() => aplicarLote("pausar")}>Pausar</BulkAcao>
              <BulkAcao disabled={loteBusy} onClick={() => aplicarLote("ativar")}>Ativar</BulkAcao>
            </>
          )}
          <BulkAcao tone="danger" disabled={loteBusy} onClick={() => { zerarFeedback(); setDelLote(true); }}>Excluir</BulkAcao>
        </BulkBar>
      )}

      <Modal open={!!atribuir} onClose={() => !loteBusy && setAtribuir(null)}
             title={atribuir === "cartao" ? "Aplicar cartão" : "Aplicar categoria"}>
        <div className="space-y-4">
          <FormError>{loteErr}</FormError>
          <Field label={atribuir === "cartao" ? "Cartão" : "Categoria"}
                 hint={`Vai valer para as ${linhasLote.length} linhas selecionadas.`}>
            <Select value={alvoId} onValue={setAlvoId}>
              <SelectItem value="">{atribuir === "cartao" ? "Sem cartão (à vista / débito)" : "Sem categoria"}</SelectItem>
              {(atribuir === "cartao" ? cartoes : categorias).map((x) => (
                <SelectItem key={x.id} value={x.id}>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: acento(x.cor).dot }} />
                    {x.nome}
                  </span>
                </SelectItem>
              ))}
            </Select>
          </Field>
          {atribuir === "cartao" && alvoId === "" && alvoLote === "fixas" && (
            <p className="text-[13px] text-amber-400">Tirar o cartão também tira o parcelamento das fixas selecionadas.</p>
          )}
          <div className="flex gap-2 pt-1">
            <Button variant="ghost" className="flex-1" disabled={loteBusy} onClick={() => setAtribuir(null)}>Cancelar</Button>
            <Button className="flex-1" loading={loteBusy}
                    onClick={() => aplicarLote(atribuir, atribuir === "cartao" ? { cartaoId: alvoId || null } : { categoriaId: alvoId || null })}>
              Aplicar
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={delLote} onClose={() => !loteBusy && setDelLote(false)}
             title={alvoLote === "fixas" ? "Excluir despesas fixas" : "Excluir despesas"}>
        <div className="space-y-4">
          <FormError>{loteErr}</FormError>
          <p className="text-sm text-slate-300">
            Excluir <b>{linhasLote.length}</b> {linhasLote.length === 1 ? "linha" : "linhas"} ·{" "}
            <span className="tnum font-semibold text-ink">{fmtMoney(totalLote)}</span>. Não dá pra desfazer.
          </p>
          <ul className="max-h-48 space-y-1.5 overflow-y-auto rounded-xl bg-veu/[0.04] p-3 text-sm">
            {linhasLote.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3">
                <span className="truncate text-slate-300">{d.descricao}</span>
                <span className="tnum shrink-0 text-slate-400">{fmtMoney(d.valor)}</span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 pt-1">
            <Button variant="ghost" className="flex-1" disabled={loteBusy} onClick={() => setDelLote(false)}>Cancelar</Button>
            <Button variant="danger" className="flex-1" loading={loteBusy} onClick={() => aplicarLote("excluir")}>
              Excluir
            </Button>
          </div>
        </div>
      </Modal>

      <DespesaFixaModal open={fixaOpen} onClose={() => setFixaOpen(false)} />
      <DespesaFixaModal open={!!editFixa} despesa={editFixa} onClose={() => setEditFixa(null)} />
      <DespesaMesModal open={mesOpen} onClose={() => setMesOpen(false)} mes={ym} mesLabel={fmtMonthLabel(ym)} />
      <DespesaMesModal open={!!editMes} despesa={editMes} onClose={() => setEditMes(null)} mes={ym} mesLabel={fmtMonthLabel(ym)} />
      <ImportOfxModal open={importOpen} onClose={() => setImportOpen(false)} mes={ym} mesLabel={fmtMonthLabel(ym)} />
      <ReceitaMesModal open={receitaOpen} onClose={() => setReceitaOpen(false)} mes={ym} mesLabel={fmtMonthLabel(ym)} />
      <ReceitaMesModal open={!!editReceita} receita={editReceita} escopo={escopoEdicao}
                       onClose={() => { setEditReceita(null); setEscopoEdicao("todas"); }}
                       mes={ym} mesLabel={fmtMonthLabel(ym)} />

      {/* Escopo da ação numa receita recorrente */}
      <Modal open={!!escopoReceita} onClose={() => !delBusy && setEscopoReceita(null)}
             title={escopoReceita?.acao === "editar" ? "Editar receita recorrente" : "Excluir receita recorrente"}>
        <div className="space-y-2.5">
          <p className="text-sm text-slate-400">
            <b className="text-slate-200">{escopoReceita?.r?.descricao}</b> repete todo mês. O que fazer?
          </p>
          <EscopoOpcao titulo={`Só em ${fmtMonthLabel(ym)}`}
                       desc={escopoReceita?.acao === "editar"
                         ? "Vira um lançamento avulso deste mês; os outros meses ficam como estão."
                         : "Pula este mês; os outros meses continuam."}
                       disabled={delBusy} onClick={() => aplicarEscopo("mes")} />
          <EscopoOpcao titulo={`De ${fmtMonthLabel(ym)} em diante`}
                       desc={escopoReceita?.acao === "editar"
                         ? "Encerra a recorrência no mês anterior e recomeça aqui com os valores novos."
                         : "Encerra a recorrência no mês anterior; o histórico fica."}
                       disabled={delBusy} onClick={() => aplicarEscopo("diante")} />
          <EscopoOpcao titulo="Todos os meses"
                       desc={escopoReceita?.acao === "editar"
                         ? "Altera a receita recorrente inteira, inclusive os meses passados."
                         : "Apaga a receita e todo o histórico dela."}
                       tone={escopoReceita?.acao === "excluir" ? "danger" : undefined}
                       disabled={delBusy} onClick={() => aplicarEscopo("todas")} />
        </div>
      </Modal>

      <Modal open={!!delFixa} onClose={() => !delBusy && setDelFixa(null)} title="Excluir despesa fixa">
        {delFixa && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              Excluir <b className="text-ink">{delFixa.descricao}</b> ({fmtMoney(delFixa.valor)})?
            </p>
            <Aviso>
              Some de todos os meses e apaga o histórico de pagamentos dela. Não dá pra desfazer.
            </Aviso>
            <div className="flex gap-2 pt-1">
              <Button variant="ghost" className="flex-1" disabled={delBusy} onClick={() => setDelFixa(null)}>
                Cancelar
              </Button>
              <Button variant="danger" className="flex-1" loading={delBusy} onClick={excluirFixa}>
                <Trash2 size={15} /> Excluir
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!delMes} onClose={() => !delBusy && setDelMes(null)} title="Excluir despesa do mês">
        {delMes && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              Excluir <b className="text-ink">{delMes.descricao}</b> ({fmtMoney(delMes.valor)})?
            </p>
            <Aviso>
              Apaga essa despesa de {fmtMonthLabel(ym)}. Não dá pra desfazer.
            </Aviso>
            <div className="flex gap-2 pt-1">
              <Button variant="ghost" className="flex-1" disabled={delBusy} onClick={() => setDelMes(null)}>
                Cancelar
              </Button>
              <Button variant="danger" className="flex-1" loading={delBusy} onClick={excluirMes}>
                <Trash2 size={15} /> Excluir
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!delReceita} onClose={() => !delBusy && setDelReceita(null)} title="Excluir receita do mês">
        {delReceita && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              Excluir <b className="text-ink">{delReceita.descricao}</b> ({fmtMoney(delReceita.valor)})?
            </p>
            <Aviso>
              Apaga essa receita de {fmtMonthLabel(ym)}. Não dá pra desfazer.
            </Aviso>
            <div className="flex gap-2 pt-1">
              <Button variant="ghost" className="flex-1" disabled={delBusy} onClick={() => setDelReceita(null)}>
                Cancelar
              </Button>
              <Button variant="danger" className="flex-1" loading={delBusy} onClick={excluirReceita}>
                <Trash2 size={15} /> Excluir
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}

// Abas de espaço de despesa (Nosso / Meu / …) + criar novo.
// As abas são filtradas pelo mês `ym`: páginas excluídas naquele mês somem
// (exclusão reversível). Uma faixa abaixo lista as ocultas p/ restaurar.
//
// Abas sublinhadas numa régua de 1px (neutras: cor fica pro dado). Ocultar e
// excluir moram no menu "…" da aba ATIVA — antes eram bolinhas que só
// apareciam no hover, ou seja, inalcançáveis no toque.
function EspacoTabs({ ym }) {
  const {
    espacos, espacosOcultos, activeEspacoId, orcamentoStatus, espacoPendente,
    setActiveEspaco, prefetchEspaco, ocultarEspacoMes, restaurarEspacoMes, removeEspaco,
  } = useFinance();
  const [novoOpen, setNovoOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null); // espaço a ocultar do mês
  const [confirmDelPerm, setConfirmDelPerm] = useState(null); // espaço a excluir de vez
  const [busy, setBusy] = useState(false);
  const loading = orcamentoStatus === "loading";
  const { can } = useAuth();
  const canEspaco = can("espaco:manage");

  const visiveis = espacosVisiveisNoMes(espacos, espacosOcultos, ym);
  const ocultas = espacosOcultosNoMes(espacos, espacosOcultos, ym);
  const podeExcluir = canEspaco && visiveis.length > 1; // guarda: sempre sobra 1 no mês
  const podeExcluirPerm = canEspaco && espacos.length > 1; // guarda: nunca zerar espaços

  async function confirmar() {
    setBusy(true);
    try {
      await ocultarEspacoMes(confirmDel.id, ym);
      setConfirmDel(null);
    } finally { setBusy(false); }
  }

  async function confirmarPerm() {
    setBusy(true);
    try {
      await removeEspaco(confirmDelPerm.id);
      setConfirmDelPerm(null);
    } finally { setBusy(false); }
  }

  const itemMenu = "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors cursor-pointer";

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2 border-b border-[var(--color-line)]">
        <div role="tablist" aria-label="Páginas de despesa" className="-mb-px flex min-w-0 flex-1 gap-5 overflow-x-auto">
          {visiveis.map((e) => {
            // A aba clicada acende NA HORA (o conteúdo fica esmaecido até o
            // orçamento chegar); hover/foco já pré-carregam o orçamento dela.
            const active = e.id === (espacoPendente ?? activeEspacoId);
            const vem = () => prefetchEspaco(e.id);
            return (
              <div key={e.id} className="flex shrink-0 items-center gap-0.5">
                <button role="tab" aria-selected={active} onClick={() => setActiveEspaco(e.id).catch(() => {})}
                  onPointerEnter={vem} onFocus={vem} onTouchStart={vem}
                  className={`relative inline-flex h-11 items-center gap-2 whitespace-nowrap border-b-2 text-sm transition-colors cursor-pointer disabled:cursor-not-allowed ${
                    active ? "border-ink font-semibold text-ink" : "border-transparent text-slate-400 hover:text-ink"}`}>
                  {e.emoji && <span>{e.emoji}</span>}
                  {e.nome}
                  {active && loading && <Spinner className="h-3.5 w-3.5" />}
                </button>
                {active && !loading && (podeExcluir || podeExcluirPerm) && (
                  <RPopover.Root>
                    <RPopover.Trigger asChild>
                      <IconButton className="h-7 w-7" aria-label={`Opções de ${e.nome}`} title="Opções da página">
                        <MoreHorizontal size={15} />
                      </IconButton>
                    </RPopover.Trigger>
                    <RPopover.Portal>
                      <RPopover.Content align="start" sideOffset={6}
                        className="z-[70] w-60 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-[var(--sombra-flutua)] animate-[surge_.12s_ease-out]">
                        {podeExcluir && (
                          <RPopover.Close asChild>
                            <button onClick={() => setConfirmDel(e)} className={`${itemMenu} text-slate-200 hover:bg-veu/[0.07]`}>
                              <EyeOff size={15} className="text-slate-500" /> Ocultar de {fmtMonthLabel(ym)}
                            </button>
                          </RPopover.Close>
                        )}
                        {podeExcluirPerm && (
                          <RPopover.Close asChild>
                            <button onClick={() => setConfirmDelPerm(e)} className={`${itemMenu} text-rose-400 hover:bg-rose-500/10`}>
                              <Trash2 size={15} /> Excluir página…
                            </button>
                          </RPopover.Close>
                        )}
                      </RPopover.Content>
                    </RPopover.Portal>
                  </RPopover.Root>
                )}
              </div>
            );
          })}
        </div>
        {canEspaco && (
          <Button variant="ghost" size="sm" className="mb-1.5" onClick={() => setNovoOpen(true)} aria-label="Nova página de despesa">
            <Plus size={15} /> <span className="hidden sm:inline">Nova página</span>
          </Button>
        )}
      </div>

      {canEspaco && ocultas.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-500">
          <span>Ocultas em {fmtMonthLabel(ym)}:</span>
          {ocultas.map((e) => (
            <Button key={e.id} variant="outline" size="sm" onClick={() => restaurarEspacoMes(e.id, ym)}
              title={`Restaurar ${e.nome} em ${fmtMonthLabel(ym)}`}>
              {e.emoji && <span>{e.emoji}</span>}{e.nome}
              <Undo2 size={13} className="text-slate-500" />
            </Button>
          ))}
        </div>
      )}

      <EspacoModal open={novoOpen} onClose={() => setNovoOpen(false)}
        onCreated={(esp) => setActiveEspaco(esp.id)} />

      <Modal open={!!confirmDel} onClose={() => !busy && setConfirmDel(null)} title="Ocultar página do mês">
        {confirmDel && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              Ocultar <b className="text-ink">{confirmDel.emoji} {confirmDel.nome}</b> só de{" "}
              <b className="text-ink">{fmtMonthLabel(ym)}</b>?
            </p>
            <p className="rounded-xl bg-veu/[0.04] px-3.5 py-3 text-[13px] text-slate-400">
              Some só deste mês. A página e os dados dela continuam nos outros meses —
              dá pra restaurar quando quiser.
            </p>
            <div className="flex gap-2 pt-1">
              <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => setConfirmDel(null)}>
                Cancelar
              </Button>
              <Button className="flex-1" loading={busy} onClick={confirmar}>
                <EyeOff size={15} /> Ocultar do mês
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!confirmDelPerm} onClose={() => !busy && setConfirmDelPerm(null)} title="Excluir página permanentemente">
        {confirmDelPerm && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              Excluir <b className="text-ink">{confirmDelPerm.emoji} {confirmDelPerm.nome}</b> de vez?
            </p>
            <Aviso>
              Apaga o espaço e <b>todos os dados dele em todos os meses</b> — despesas fixas,
              despesas do mês, receitas e renda. Não dá pra desfazer. As caixinhas
              (economias) são compartilhadas e não são afetadas.
            </Aviso>
            <div className="flex gap-2 pt-1">
              <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => setConfirmDelPerm(null)}>
                Cancelar
              </Button>
              <Button variant="danger" className="flex-1" loading={busy} onClick={confirmarPerm}>
                <Trash2 size={15} /> Excluir de vez
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// Aviso de consequência irreversível (dentro dos diálogos de exclusão).
function Aviso({ children }) {
  return (
    <p className="rounded-xl border border-rose-400/25 bg-rose-500/[0.07] px-3.5 py-3 text-[13px] text-rose-300">
      {children}
    </p>
  );
}

// Linha "Salário" do razão — edita o valor do mês visível. Checkbox "fixo todo
// mês" grava o default do espaço (herdado pelos meses sem override); desmarcado,
// o valor vira override só daquele mês.
function SalarioLinha({ ym, valor, fixa, override }) {
  const { setRendaMes, setRendaFixa, clearRendaMes } = useFinance();
  const { can } = useAuth();
  const hasOverride = override != null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(valor);
  const [fixo, setFixo] = useState(!hasOverride);
  const [busy, setBusy] = useState(false);

  function startEdit() {
    setDraft(valor);
    setFixo(!hasOverride); // sem override = está herdando o fixo
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    try {
      if (fixo) {
        await setRendaFixa(draft);
        if (hasOverride) await clearRendaMes(ym); // mês passa a herdar o fixo
      } else {
        await setRendaMes(ym, draft); // override só deste mês
      }
      setEditing(false);
    } finally { setBusy(false); }
  }

  if (editing) {
    return (
      <div className="mb-2.5 space-y-3 rounded-xl bg-veu/[0.035] p-3.5">
        <dt className="text-[13px] font-medium text-slate-300">Salário em {fmtMonthLabel(ym)}</dt>
        <dd className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <MoneyInput value={draft} onValue={setDraft} autoFocus aria-label="Salário"
              onKeyDown={(e) => e.key === "Enter" && save()} />
          </div>
          <Button onClick={save} loading={busy} aria-label="Salvar salário"><Check size={16} /> Salvar</Button>
          <IconButton onClick={() => setEditing(false)} disabled={busy} aria-label="Cancelar edição">
            <X size={16} />
          </IconButton>
        </div>
        <CheckboxField label="Salário fixo, repete todo mês" checked={fixo} onChecked={setFixo} />
        </dd>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 pb-2.5">
      <dt className="min-w-0 text-slate-400">
        Salário / renda
        <span className="block text-xs text-slate-500">
          {hasOverride
            ? "Só neste mês"
            : fixa > 0 ? "Fixo, todos os meses" : "Sem salário definido"}
        </span>
      </dt>
      <dd className="flex items-center gap-1">
        <span className="tnum font-medium text-ink">{fmtMoney(valor)}</span>
        {can("orcamento:manage") && (
          <IconButton onClick={startEdit} aria-label="Editar salário" title="Editar salário" className="-mr-1.5">
            <Pencil size={14} />
          </IconButton>
        )}
      </dd>
    </div>
  );
}

// Controle de pagamento (fixa no mês ou despesa do mês) — suporta pagamento parcial.
//   onSet(valorAbsoluto) define quanto foi pago no total (back-end clampa em [0, valor]).
//   quitada  → clique desfaz tudo (set 0)
//   parcial  → botão "Falta R$X" abre popover pra pagar mais
//   nada     → botão "Pagar" abre popover
// É também a ÚNICA marca de status da linha (paga / parcial / em aberto).
function PagarControl({ valor, valorPago = 0, onSet }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(0);
  const [pos, setPos] = useState(null); // {top, right} viewport coords do popover
  const btnRef = useRef(null);
  const pago = valor > 0 && valorPago >= valor;
  const parcial = valorPago > 0 && valorPago < valor;
  const falta = Math.max(valor - valorPago, 0);

  async function set(v) {
    setBusy(true);
    try {
      await onSet(v);
      setOpen(false);
    } finally { setBusy(false); }
  }
  function abrir() {
    setDraft(falta);
    const r = btnRef.current?.getBoundingClientRect();
    // no celular o popover encosta na margem em vez de vazar da tela
    if (r) setPos({ top: r.bottom + 8, right: Math.max(window.innerWidth - r.right, 12) });
    setOpen(true);
  }

  const base = "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 text-[13px] font-medium transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-60";

  // quitada → etiqueta verde que desfaz o pagamento
  if (pago) {
    return (
      <button onClick={() => set(0)} disabled={busy} aria-pressed
        title="Desfazer pagamento"
        className={`${base} bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25`}>
        {busy ? <Spinner className="h-3.5 w-3.5" /> : <Check size={14} strokeWidth={2.5} />}
        Paga
      </button>
    );
  }

  return (
    <span className="shrink-0">
      <button ref={btnRef} onClick={abrir} disabled={busy} aria-expanded={open}
        title={parcial ? "Pagar o restante" : "Registrar pagamento"}
        className={`${base} ${parcial
            ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
            : "border border-[var(--color-line-strong)] text-slate-300 hover:bg-veu/[0.05] hover:text-ink"
          }`}>
        {busy && <Spinner className="h-3.5 w-3.5" />}
        {parcial ? `Falta ${fmtMoney(falta)}` : "Pagar"}
      </button>

      {open && pos && createPortal(
        <>
          {/* backdrop: clique fora fecha */}
          <button aria-hidden tabIndex={-1} onClick={() => setOpen(false)}
            className="fixed inset-0 z-[60] cursor-default" />
          <div style={{ top: pos.top, right: pos.right }} role="dialog" aria-label="Registrar pagamento"
            className="fixed z-[61] w-64 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3.5 text-left shadow-[var(--sombra-flutua)] animate-[surge_.12s_ease-out]">
            {parcial && (
              <p className="tnum mb-2.5 text-[13px] text-slate-400">
                Pago <span className="font-medium text-amber-400">{fmtMoney(valorPago)}</span> de {fmtMoney(valor)}
              </p>
            )}
            <label className="mb-1.5 block text-[13px] font-medium text-slate-300">Paguei agora</label>
            <MoneyInput value={draft} onValue={setDraft} autoFocus
              onKeyDown={(e) => e.key === "Enter" && set(valorPago + draft)} />
            <p className="tnum mt-1.5 text-xs text-slate-500">falta {fmtMoney(falta)}</p>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" onClick={() => set(valorPago + draft)} loading={busy} className="flex-1">
                Confirmar
              </Button>
              <Button variant="secondary" size="sm" onClick={() => set(valor)} disabled={busy} title="Quitar valor cheio">
                Quitar tudo
              </Button>
            </div>
            {parcial && (
              <button onClick={() => set(0)} disabled={busy}
                className="mt-2.5 w-full text-center text-xs text-slate-500 transition-colors hover:text-rose-400 cursor-pointer disabled:opacity-60">
                Desfazer pagamentos
              </button>
            )}
          </div>
        </>,
        document.body
      )}
    </span>
  );
}

// Linha do razão do mês. Sinal no texto (+/−), não na cor: só a receita extra
// leva verde e só uma sobra negativa leva vermelho.
function Row({ label, value, strong, tone, sinal, ultima }) {
  const color = tone === "pos" ? "text-emerald-400" : tone === "neg" ? "text-rose-400" : strong ? "text-ink" : "text-slate-200";
  return (
    <div className={`flex items-baseline justify-between gap-3 py-2.5 ${strong ? "border-t border-[var(--color-line)]" : ""} ${ultima ? "pb-0" : ""}`}>
      <dt className={strong ? "font-semibold text-ink" : "text-slate-400"}>{label}</dt>
      <dd className={`tnum ${strong ? (ultima ? "text-lg font-semibold" : "font-semibold") : "font-medium"} ${color}`}>
        {sinal && value !== 0 ? `${sinal} ` : ""}{fmtMoney(value)}
      </dd>
    </div>
  );
}
