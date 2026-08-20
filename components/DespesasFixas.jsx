import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Plus, Trash2, CalendarClock, Wallet, ArrowDownLeft, ArrowUpRight, Pencil, Check, CreditCard, CheckCircle2, X, Undo2,
  Receipt, Flag, ChevronDown, TrendingDown,
} from "lucide-react";
import { Card, Button, MoneyInput, Spinner, Modal, ProgressBar } from "./ui/primitives.jsx";
import { DespesaFixaModal, DespesaMesModal, ReceitaMesModal, EspacoModal } from "./forms.jsx";
import { fmtMoney, fmtMonthLabel, fmtMonthShort, currentMonthKey } from "../lib/format.js";
import { totalFixasNoMes, despesasDoMes, receitasDoMes, orcamentoMes, mesesOrcamento, rendaDoMes, parcelaInfo, fixaContaNoMes, fixaPaga, fixaValorPago, fixaFaltaPagar, fixaParcial, acento, espacoOcultoNoMes, espacosVisiveisNoMes, espacosOcultosNoMes, quitacaoParceladas } from "../lib/calc.js";
import { useFinance } from "../store/FinanceContext.jsx";
import { useAuth } from "./AuthGate";

// Tag de categoria numa linha de despesa.
function CategoriaBadge({ d, categoriasMap }) {
  if (!d.categoriaId) return null;
  const c = categoriasMap[d.categoriaId];
  if (!c) return null;
  const a = acento(c.cor);
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: a.dot + "26", color: a.dot }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: a.dot }} /> {c.nome}
    </span>
  );
}

// Badge de cartão + parcela numa linha de despesa (parcela auto-avança pelo mês `ym`).
function CartaoBadge({ d, cartoesMap, ym }) {
  if (!d.cartaoId) return null;
  const c = cartoesMap[d.cartaoId];
  const parc = parcelaInfo(d, ym);
  const a = acento(c?.cor || "violet");
  return (
    <span className="mt-0.5 inline-flex flex-wrap items-center gap-1.5 text-xs">
      <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium"
        style={{ backgroundColor: a.dot + "26", color: a.dot }}>
        <CreditCard size={11} /> {c?.nome || "Cartão"}
      </span>
      {parc && (
        parc.ended ? (
          <span className="text-emerald-400">parcelas quitadas ({parc.total}/{parc.total})</span>
        ) : (
          <span className="text-slate-500">
            parcela {parc.label}{parc.restantes > 0 ? ` · faltam ${parc.restantes} (${fmtMoney(parc.valorRestante)})` : " · última"}
          </span>
        )
      )}
    </span>
  );
}

export default function DespesasFixas() {
  const fin = useFinance();
  const {
    despesasFixas, despesasMes, receitasMes, rendasMensais, config,
    espacos, espacosOcultos, activeEspacoId, orcamentoStatus, cartoes, categorias, pagamentosFixas,
    setActiveEspaco, toggleDespesaFixa, removeDespesaFixa, removeDespesaMes, removeReceitaMes, setPagamentoFixa, setPagaMes,
  } = fin;
  const cartoesMap = useMemo(() => Object.fromEntries(cartoes.map((c) => [c.id, c])), [cartoes]);
  const categoriasMap = useMemo(() => Object.fromEntries(categorias.map((c) => [c.id, c])), [categorias]);
  const { can } = useAuth();
  const canOrc = can("orcamento:manage");

  const [ym, setYm] = useState(currentMonthKey());
  const [fixaOpen, setFixaOpen] = useState(false);
  const [mesOpen, setMesOpen] = useState(false);
  const [receitaOpen, setReceitaOpen] = useState(false);
  const [editFixa, setEditFixa] = useState(null);
  const [editMes, setEditMes] = useState(null);
  const [editReceita, setEditReceita] = useState(null);
  const [delFixa, setDelFixa] = useState(null); // despesa fixa a excluir (confirma)
  const [delMes, setDelMes] = useState(null); // despesa do mês a excluir
  const [delReceita, setDelReceita] = useState(null); // receita do mês a excluir
  const [delBusy, setDelBusy] = useState(false);

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

  const meses = useMemo(() => mesesOrcamento(rendasMensais, despesasMes, receitasMes), [rendasMensais, despesasMes, receitasMes]);
  const orc = useMemo(
    () => orcamentoMes({ rendasMensais, despesasMes, receitasMes, despesasFixas, config }, ym),
    [rendasMensais, despesasMes, receitasMes, despesasFixas, config, ym]
  );
  const fixasAtivas = totalFixasNoMes(despesasFixas, ym);
  const doMes = useMemo(
    () => [...despesasDoMes(despesasMes, ym)].sort((a, b) => b.valor - a.valor),
    [despesasMes, ym]
  );
  const receitasDoMesList = useMemo(() => receitasDoMes(receitasMes, ym), [receitasMes, ym]);
  // ordem só por valor — pago/não pago não mexe na posição.
  const fixasOrdenadas = [...despesasFixas].sort((a, b) => b.valor - a.valor);
  // resumo de pagamento — só conta fixas que caem no mês (parcelas quitadas/pausadas fora).
  const fixasNoMes = useMemo(() => fixasOrdenadas.filter((d) => fixaContaNoMes(d, ym)), [fixasOrdenadas, ym]);
  const fixasPagasCount = fixasNoMes.filter((d) => fixaPaga(pagamentosFixas, d, ym)).length;
  // falta = soma do que ainda resta em cada fixa (desconta pagamentos parciais).
  const faltaPagar = fixasNoMes.reduce((s, d) => s + fixaFaltaPagar(pagamentosFixas, d, ym), 0);

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

  return (
    <section className="space-y-6">
      {/* espaço (Nosso / Meu) — só o orçamento muda, caixinhas seguem globais */}
      <EspacoTabs ym={ym} />

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <span>{espacoAtivo?.emoji}</span> Despesas · {espacoAtivo?.nome}
          </h2>
          <p className="text-sm text-slate-400">Quanto recebeu, quanto saiu, quanto sobrou.</p>
        </div>
        <select value={ym} onChange={(e) => setYm(e.target.value)}
          className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2 text-sm text-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/30">
          {meses.map((m) => <option key={m} value={m}>{fmtMonthLabel(m)}</option>)}
        </select>
      </header>

      {/* conteúdo do orçamento — esmaece durante troca de espaço */}
      <div className={`space-y-6 transition-opacity ${loading ? "pointer-events-none opacity-40" : "opacity-100"}`}>
        {/* recebido + resumo */}
        <RecebidoCard ym={ym} valor={rendaDoMes(rendasMensais, config, ym)}
          fixa={config.rendaMensal || 0} override={rendasMensais[ym] ?? null} />

        <div className="grid grid-cols-3 gap-3">
          <Resumo icon={ArrowDownLeft} label="Recebido" value={orc.recebido} tone="emerald" />
          <Resumo icon={ArrowUpRight} label="Saiu (fixas + mês)" value={orc.saiu} tone="rose" />
          <Resumo icon={Wallet} label="Sobrou" value={orc.sobrou} tone={orc.sobrou >= 0 ? "blue" : "rose"} />
        </div>

        <Card className="p-5">
          <dl className="space-y-2 text-sm">
            <Row label="Salário / renda" value={orc.salario} />
            {orc.extras > 0 && <Row label="+ Receitas extras" value={orc.extras} tone="pos" />}
            <Row label="= Recebido no mês" value={orc.recebido} strong />
            <Row label="− Despesas fixas" value={-orc.fixas} />
            <Row label="− Despesas do mês" value={-orc.variaveis} />
            <div className="my-2 border-t border-[var(--color-line)]" />
            <Row label="= Sobrou" value={orc.sobrou} strong tone={orc.sobrou >= 0 ? "pos" : "neg"} />
          </dl>
        </Card>

        {/* receitas extras do mês */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-white">
              Receitas extras de {fmtMonthLabel(ym)}
              <span className="ml-2 tnum text-sm font-normal text-slate-400">{fmtMoney(orc.extras)}</span>
            </h3>
            {canOrc && (
              <button onClick={() => setReceitaOpen(true)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-400 hover:text-emerald-300 cursor-pointer">
                <Plus size={15} /> Lançar receita
              </button>
            )}
          </div>
          <Card className="overflow-hidden">
            {receitasDoMesList.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm text-slate-400">Nenhuma receita extra neste mês.</p>
                <p className="mt-1 text-xs text-slate-500">Dinheiro por fora além do salário: freela, bônus, venda…</p>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {receitasDoMesList.map((r) => (
                  <li key={r.id} className="group flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 sm:px-5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-400">
                      <ArrowDownLeft size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-200">{r.descricao}</p>
                      {r.data && <p className="text-xs text-slate-500">{r.data.split("-").reverse().join("/")}</p>}
                    </div>
                    <div className="flex w-full items-center justify-end gap-1 sm:w-auto sm:gap-2">
                      <span className="tnum font-semibold text-emerald-400">+{fmtMoney(r.valor)}</span>
                      {canOrc && (
                        <>
                          <button onClick={() => setEditReceita(r)} aria-label={`Editar ${r.descricao}`}
                            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-200 cursor-pointer">
                            <Pencil size={15} />
                          </button>
                          <button onClick={() => setDelReceita(r)} aria-label={`Remover ${r.descricao}`}
                            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-rose-500/15 hover:text-rose-400 cursor-pointer">
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* despesas do mês */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-white">
              Despesas de {fmtMonthLabel(ym)}
              <span className="ml-2 tnum text-sm font-normal text-slate-400">{fmtMoney(orc.variaveis)}</span>
            </h3>
            {canOrc && (
              <button onClick={() => setMesOpen(true)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-400 hover:text-blue-300 cursor-pointer">
                <Plus size={15} /> Adicionar
              </button>
            )}
          </div>
          <Card className="overflow-hidden">
            {doMes.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-500">Nenhuma despesa lançada neste mês.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {doMes.map((d) => {
                  const pago = d.paga;
                  const parcial = !pago && (d.valorPago || 0) > 0;
                  const falta = Math.max(d.valor - (d.valorPago || 0), 0);
                  return (
                  <li key={d.id} className={`group flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 transition-colors sm:px-5 ${pago ? "bg-emerald-500/[0.06]" : parcial ? "bg-amber-500/[0.06]" : ""}`}>
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors ${pago ? "bg-emerald-500/15 text-emerald-400" : parcial ? "bg-amber-500/15 text-amber-400" : "bg-rose-500/15 text-rose-400"}`}>
                      {pago ? <Check size={16} /> : <ArrowUpRight size={16} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium text-slate-200">{d.descricao}</p>
                        {pago && (
                          <span className="shrink-0 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-400">
                            Paga
                          </span>
                        )}
                        {parcial && (
                          <span className="shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-400">
                            Parcial
                          </span>
                        )}
                      </div>
                      {d.data && <p className="text-xs text-slate-500">{d.data.split("-").reverse().join("/")}</p>}
                      {d.nota && <p className="mt-0.5 whitespace-pre-wrap break-words text-xs italic text-slate-400">{d.nota}</p>}
                      {parcial && (
                        <p className="mt-0.5 text-xs text-amber-400/90">
                          pago <span className="tnum font-medium">{fmtMoney(d.valorPago)}</span> · falta <span className="tnum font-medium">{fmtMoney(falta)}</span>
                        </p>
                      )}
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <CategoriaBadge d={d} categoriasMap={categoriasMap} />
                        <CartaoBadge d={d} cartoesMap={cartoesMap} ym={ym} inline />
                      </div>
                    </div>
                    <div className="flex w-full items-center justify-end gap-1 sm:w-auto sm:gap-2">
                      <span className={`tnum font-semibold ${pago ? "text-emerald-400" : "text-slate-200"}`}>{fmtMoney(d.valor)}</span>
                      {canOrc && (
                        <>
                          <PagarControl valor={d.valor} valorPago={d.valorPago || 0} onSet={(v) => setPagaMes(d.id, v)} />
                          <button onClick={() => setEditMes(d)} aria-label={`Editar ${d.descricao}`}
                            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-200 cursor-pointer">
                            <Pencil size={15} />
                          </button>
                          <button onClick={() => setDelMes(d)} aria-label={`Remover ${d.descricao}`}
                            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-rose-500/15 hover:text-rose-400 cursor-pointer">
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        {/* quitação das parceladas — panorama até zerar */}
        <QuitacaoParceladas despesasFixas={despesasFixas} pagamentosFixas={pagamentosFixas} ym={ym} />

        {/* despesas fixas */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-white">
                Despesas fixas
                <span className="ml-2 tnum text-sm font-normal text-slate-400">{fmtMoney(fixasAtivas)}/mês</span>
              </h3>
              {fixasNoMes.length > 0 && (
                <p className="mt-0.5 text-xs text-slate-500">
                  {fixasPagasCount === fixasNoMes.length ? (
                    <span className="text-emerald-400">tudo pago em {fmtMonthLabel(ym)} ✓</span>
                  ) : (
                    <>
                      {fixasPagasCount}/{fixasNoMes.length} pagas · faltam{" "}
                      <span className="tnum font-medium text-slate-300">{fmtMoney(faltaPagar)}</span>
                    </>
                  )}
                </p>
              )}
            </div>
            {canOrc && (
              <button onClick={() => setFixaOpen(true)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-400 hover:text-blue-300 cursor-pointer">
                <Plus size={15} /> Nova fixa
              </button>
            )}
          </div>
          <Card className="overflow-hidden">
            {fixasOrdenadas.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm text-slate-400">Nenhuma despesa fixa cadastrada.</p>
                <p className="mt-1 text-xs text-slate-500">Adicione aluguel, internet, assinaturas…</p>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {fixasOrdenadas.map((d) => {
                  const conta = fixaContaNoMes(d, ym);
                  const paga = conta && fixaPaga(pagamentosFixas, d, ym);
                  const parcial = conta && fixaParcial(pagamentosFixas, d, ym);
                  const valorPago = fixaValorPago(pagamentosFixas, d.id, ym);
                  const falta = fixaFaltaPagar(pagamentosFixas, d, ym);
                  return (
                    <li key={d.id}
                      className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 transition-colors sm:px-5 ${!d.ativa ? "opacity-50" : ""} ${paga ? "bg-emerald-500/[0.06]" : parcial ? "bg-amber-500/[0.06]" : ""}`}>
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors ${paga ? "bg-emerald-500/15 text-emerald-400" : parcial ? "bg-amber-500/15 text-amber-400" : "bg-white/5 text-slate-400"}`}>
                        {paga ? <Check size={16} /> : <CalendarClock size={16} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium text-slate-200">{d.descricao}</p>
                          {paga && (
                            <span className="shrink-0 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-400">
                              Paga
                            </span>
                          )}
                          {parcial && (
                            <span className="shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-400">
                              Parcial
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">vence dia {d.diaVencimento}</p>
                        {d.nota && <p className="mt-0.5 whitespace-pre-wrap break-words text-xs italic text-slate-400">{d.nota}</p>}
                        {parcial && (
                          <p className="mt-0.5 text-xs text-amber-400/90">
                            pago <span className="tnum font-medium">{fmtMoney(valorPago)}</span> · falta <span className="tnum font-medium">{fmtMoney(falta)}</span>
                          </p>
                        )}
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <CategoriaBadge d={d} categoriasMap={categoriasMap} />
                          <CartaoBadge d={d} cartoesMap={cartoesMap} ym={ym} inline />
                        </div>
                      </div>
                      <div className="flex w-full items-center justify-end gap-1 sm:w-auto sm:gap-2">
                        <span className={`tnum font-semibold ${paga ? "text-emerald-400" : "text-slate-200"}`}>{fmtMoney(d.valor)}</span>
                        {canOrc && (
                          <>
                            {conta && <PagarControl valor={d.valor} valorPago={valorPago} onSet={(v) => setPagamentoFixa(d.id, ym, v)} />}
                            <label className="flex cursor-pointer items-center" title={d.ativa ? "Ativa" : "Pausada"}>
                              <input type="checkbox" checked={d.ativa} onChange={() => toggleDespesaFixa(d.id)}
                                className="h-4 w-4 rounded border-white/20 bg-transparent accent-blue-500 cursor-pointer" />
                            </label>
                            <button onClick={() => setEditFixa(d)} aria-label={`Editar ${d.descricao}`}
                              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/10 hover:text-slate-200 cursor-pointer">
                              <Pencil size={16} />
                            </button>
                            <button onClick={() => setDelFixa(d)} aria-label={`Remover ${d.descricao}`}
                              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-rose-500/15 hover:text-rose-400 cursor-pointer">
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>{/* /conteúdo do orçamento */}

      <DespesaFixaModal open={fixaOpen} onClose={() => setFixaOpen(false)} />
      <DespesaFixaModal open={!!editFixa} despesa={editFixa} onClose={() => setEditFixa(null)} />
      <DespesaMesModal open={mesOpen} onClose={() => setMesOpen(false)} mes={ym} mesLabel={fmtMonthLabel(ym)} />
      <DespesaMesModal open={!!editMes} despesa={editMes} onClose={() => setEditMes(null)} mes={ym} mesLabel={fmtMonthLabel(ym)} />
      <ReceitaMesModal open={receitaOpen} onClose={() => setReceitaOpen(false)} mes={ym} mesLabel={fmtMonthLabel(ym)} />
      <ReceitaMesModal open={!!editReceita} receita={editReceita} onClose={() => setEditReceita(null)} mes={ym} mesLabel={fmtMonthLabel(ym)} />

      <Modal open={!!delFixa} onClose={() => !delBusy && setDelFixa(null)} title="Excluir despesa fixa">
        {delFixa && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              Excluir <b className="text-white">{delFixa.descricao}</b> ({fmtMoney(delFixa.valor)})?
            </p>
            <p className="rounded-xl bg-rose-500/10 px-3.5 py-3 text-xs text-rose-200 ring-1 ring-rose-500/20">
              Some de todos os meses e apaga o histórico de pagamentos dela. Não dá pra desfazer.
            </p>
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
              Excluir <b className="text-white">{delMes.descricao}</b> ({fmtMoney(delMes.valor)})?
            </p>
            <p className="rounded-xl bg-rose-500/10 px-3.5 py-3 text-xs text-rose-200 ring-1 ring-rose-500/20">
              Apaga essa despesa de {fmtMonthLabel(ym)}. Não dá pra desfazer.
            </p>
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
              Excluir <b className="text-white">{delReceita.descricao}</b> ({fmtMoney(delReceita.valor)})?
            </p>
            <p className="rounded-xl bg-rose-500/10 px-3.5 py-3 text-xs text-rose-200 ring-1 ring-rose-500/20">
              Apaga essa receita de {fmtMonthLabel(ym)}. Não dá pra desfazer.
            </p>
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

// Painel de quitação das fixas parceladas: quanto falta pra zerar tudo, quando
// fica livre e quanto sai por mês até lá. Só leitura — não altera nada.
function QuitacaoParceladas({ despesasFixas, pagamentosFixas, ym }) {
  const [aberto, setAberto] = useState(false);
  const q = useMemo(() => quitacaoParceladas(despesasFixas, pagamentosFixas, ym), [despesasFixas, pagamentosFixas, ym]);
  if (q.itens.length === 0) return null;

  const mediaMes = q.cronograma.length > 0 ? q.falta / q.cronograma.length : 0;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-white">
            Quitação das parceladas
            <span className="ml-2 tnum text-sm font-normal text-slate-400">{q.itens.length} em andamento</span>
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            O que ainda vai cair de {fmtMonthLabel(ym)} até a última parcela.
          </p>
        </div>
      </div>

      <Card className="p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="flex items-center gap-1.5 text-[11px] text-slate-400 sm:text-xs">
              <Receipt size={13} className="text-amber-400" /> Falta pra quitar tudo
            </p>
            <p className="tnum text-xl font-bold text-white sm:text-2xl">{fmtMoney(q.falta)}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              de {fmtMoney(q.contrato)} contratados
            </p>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-[11px] text-slate-400 sm:text-xs">
              <TrendingDown size={13} className="text-rose-400" /> Ainda sai em {fmtMonthShort(ym)}
            </p>
            <p className="tnum text-xl font-bold text-white sm:text-2xl">{fmtMoney(q.faltaNoMes)}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              média de {fmtMoney(mediaMes)}/mês até o fim
            </p>
          </div>
          <div>
            <p className="flex items-center gap-1.5 text-[11px] text-slate-400 sm:text-xs">
              <Flag size={13} className="text-emerald-400" /> Livre em
            </p>
            <p className="text-xl font-bold text-white sm:text-2xl">{fmtMonthShort(q.ultimoMes)}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {q.mesesAte === 0 ? "última parcela é este mês" : `faltam ${q.mesesAte + 1} ${q.mesesAte + 1 === 1 ? "mês" : "meses"}`}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-slate-400">Já quitado</span>
            <span className="tnum font-medium text-slate-300">
              {fmtMoney(q.quitado)} · {Math.round(q.progresso * 100)}%
            </span>
          </div>
          <ProgressBar value={q.progresso} fromClass="from-emerald-500" toClass="to-emerald-400" />
        </div>

        {/* por parcelada */}
        <ul className="mt-4 divide-y divide-[var(--color-line)] border-t border-[var(--color-line)]">
          {q.itens.map((i) => (
            <li key={i.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 flex-1 truncate font-medium text-slate-200">{i.descricao}</p>
                <span className="tnum font-semibold text-slate-200">{fmtMoney(i.falta)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-medium text-slate-300">{i.label}</span>
                <span>
                  {i.notStarted
                    ? `começa em ${fmtMonthShort(i.primeiroMes)}`
                    : `${i.parcelas} ${i.parcelas === 1 ? "parcela" : "parcelas"} de ${fmtMoney(i.valor)}`}
                </span>
                <span className="text-slate-600">·</span>
                <span>quita em {fmtMonthShort(i.ultimoMes)}</span>
              </div>
              <ProgressBar className="mt-2 h-1.5" value={i.progresso} fromClass="from-blue-500" toClass="to-blue-400" />
            </li>
          ))}
        </ul>

        {/* cronograma mês a mês */}
        <button onClick={() => setAberto((v) => !v)}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blue-400 hover:text-blue-300 cursor-pointer">
          <ChevronDown size={15} className={`transition-transform ${aberto ? "rotate-180" : ""}`} />
          {aberto ? "Ocultar" : "Ver"} mês a mês até quitar
        </button>

        {aberto && (
          <ul className="mt-3 space-y-1.5">
            {q.cronograma.map((c) => (
              <li key={c.ym} className="flex items-center gap-3 text-xs">
                <span className={`w-14 shrink-0 ${c.ym === ym ? "font-semibold text-slate-200" : "text-slate-500"}`}>
                  {fmtMonthShort(c.ym)}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/8">
                  <span className="block h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400"
                    style={{ width: `${q.picoMes > 0 ? (c.valor / q.picoMes) * 100 : 0}%` }} />
                </span>
                <span className="tnum w-24 shrink-0 text-right text-slate-300">{fmtMoney(c.valor)}</span>
                <span className="w-16 shrink-0 text-right text-slate-500">{c.itens} {c.itens === 1 ? "conta" : "contas"}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// Abas de espaço de despesa (Nosso / Meu / …) + criar novo.
// As abas são filtradas pelo mês `ym`: páginas excluídas naquele mês somem
// (exclusão reversível). Uma faixa abaixo lista as ocultas p/ restaurar.
function EspacoTabs({ ym }) {
  const {
    espacos, espacosOcultos, activeEspacoId, orcamentoStatus,
    setActiveEspaco, ocultarEspacoMes, restaurarEspacoMes, removeEspaco,
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

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        <div className="flex gap-1.5 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5">
          {visiveis.map((e) => {
            const active = e.id === activeEspacoId;
            return (
              <div key={e.id} className="group relative">
                <button onClick={() => setActiveEspaco(e.id)} disabled={loading}
                  aria-current={active ? "true" : undefined}
                  className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer disabled:cursor-not-allowed ${active ? "bg-blue-500/20 text-blue-200 ring-1 ring-blue-500/40" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                    }`}>
                  <span>{e.emoji}</span>
                  {e.nome}
                  {active && loading && <Spinner className="h-3.5 w-3.5" />}
                </button>
                {podeExcluir && (
                  <button onClick={() => setConfirmDel(e)}
                    aria-label={`Ocultar ${e.nome} de ${fmtMonthLabel(ym)}`}
                    title={`Ocultar de ${fmtMonthLabel(ym)}`}
                    className="absolute -right-1 -top-1 hidden h-4 w-4 place-items-center rounded-full bg-slate-600 text-white ring-2 ring-[var(--color-surface)] hover:bg-slate-500 cursor-pointer group-hover:grid">
                    <X size={10} strokeWidth={3} />
                  </button>
                )}
                {podeExcluirPerm && (
                  <button onClick={() => setConfirmDelPerm(e)}
                    aria-label={`Excluir ${e.nome} permanentemente`}
                    title="Excluir permanentemente"
                    className="absolute -right-1 -bottom-1 hidden h-4 w-4 place-items-center rounded-full bg-rose-600 text-white ring-2 ring-[var(--color-surface)] hover:bg-rose-500 cursor-pointer group-hover:grid">
                    <Trash2 size={9} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {canEspaco && (
          <button onClick={() => setNovoOpen(true)} aria-label="Novo espaço de despesa"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-dashed border-white/15 text-slate-400 hover:border-white/30 hover:text-slate-200 cursor-pointer transition-colors">
            <Plus size={18} />
          </button>
        )}
      </div>

      {canEspaco && ocultas.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>Ocultas em {fmtMonthLabel(ym)}:</span>
          {ocultas.map((e) => (
            <button key={e.id} onClick={() => restaurarEspacoMes(e.id, ym)}
              title={`Restaurar ${e.nome} em ${fmtMonthLabel(ym)}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1 font-medium text-slate-400 hover:text-slate-200 hover:border-white/25 cursor-pointer transition-colors">
              <span>{e.emoji}</span>{e.nome}
              <Undo2 size={12} className="text-emerald-400" />
            </button>
          ))}
        </div>
      )}

      <EspacoModal open={novoOpen} onClose={() => setNovoOpen(false)}
        onCreated={(esp) => setActiveEspaco(esp.id)} />

      <Modal open={!!confirmDel} onClose={() => !busy && setConfirmDel(null)} title="Excluir página do mês">
        {confirmDel && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              Excluir <b className="text-white">{confirmDel.emoji} {confirmDel.nome}</b> só de{" "}
              <b className="text-white">{fmtMonthLabel(ym)}</b>?
            </p>
            <p className="rounded-xl bg-white/4 px-3.5 py-3 text-xs text-slate-400">
              Some só deste mês. A página e os dados dela continuam nos outros meses —
              dá pra restaurar quando quiser.
            </p>
            <div className="flex gap-2 pt-1">
              <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => setConfirmDel(null)}>
                Cancelar
              </Button>
              <Button variant="danger" className="flex-1" loading={busy} onClick={confirmar}>
                <X size={15} /> Ocultar do mês
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!confirmDelPerm} onClose={() => !busy && setConfirmDelPerm(null)} title="Excluir espaço permanentemente">
        {confirmDelPerm && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              Excluir <b className="text-white">{confirmDelPerm.emoji} {confirmDelPerm.nome}</b> de vez?
            </p>
            <p className="rounded-xl bg-rose-500/10 px-3.5 py-3 text-xs text-rose-200 ring-1 ring-rose-500/20">
              Apaga o espaço e <b>todos os dados dele em todos os meses</b> — despesas fixas,
              despesas do mês, receitas e renda. Não dá pra desfazer. As caixinhas
              (economias) são compartilhadas e não são afetadas.
            </p>
            <div className="flex gap-2 pt-1">
              <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => setConfirmDelPerm(null)}>
                Cancelar
              </Button>
              <Button variant="danger" className="flex-1" loading={busy} onClick={confirmarPerm}>
                <Trash2 size={15} /> Excluir permanentemente
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// Card "Salário no mês" — edita valor do mês visível. Checkbox "fixo todo mês"
// grava o default do espaço (herdado pelos meses sem override); desmarcado, o
// valor vira override só daquele mês.
function RecebidoCard({ ym, valor, fixa, override }) {
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

  return (
    <Card className="flex items-start justify-between gap-4 p-5">
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-slate-500">Salário em {fmtMonthLabel(ym)}</p>
        {editing ? (
          <div className="mt-1.5 space-y-2.5">
            <div className="flex items-center gap-2">
              <div className="w-40">
                <MoneyInput value={draft} onValue={setDraft} autoFocus
                  onKeyDown={(e) => e.key === "Enter" && save()} />
              </div>
              <Button variant="growth" onClick={save} loading={busy} className="px-3">
                <Check size={16} />
              </Button>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input type="checkbox" checked={fixo} onChange={(e) => setFixo(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-transparent accent-emerald-500 cursor-pointer" />
              Salário fixo — repete todo mês
            </label>
          </div>
        ) : (
          <>
            <p className="tnum text-3xl font-bold text-white">{fmtMoney(valor)}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {hasOverride
                ? "Só neste mês (edite p/ tornar fixo)"
                : fixa > 0 ? "Salário fixo — todos os meses" : "Sem salário definido"}
            </p>
          </>
        )}
      </div>
      {!editing && can("orcamento:manage") && (
        <button onClick={startEdit}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-white/5 px-3.5 py-2 text-sm font-medium text-slate-300 hover:bg-white/10 cursor-pointer transition-colors">
          <Pencil size={15} /> Editar
        </button>
      )}
    </Card>
  );
}

// Controle de pagamento (fixa no mês ou despesa do mês) — suporta pagamento parcial.
//   onSet(valorAbsoluto) define quanto foi pago no total (back-end clampa em [0, valor]).
//   quitada  → clique desfaz tudo (set 0)
//   parcial  → botão "Falta R$X" abre popover pra pagar mais
//   nada     → botão "Pagar" abre popover
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
    if (r) setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    setOpen(true);
  }

  // quitada → botão verde que desfaz o pagamento
  if (pago) {
    return (
      <button onClick={() => set(0)} disabled={busy} aria-pressed
        title="Desfazer pagamento"
        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-400 ring-1 ring-emerald-500/30 transition-colors cursor-pointer hover:bg-emerald-500/25 disabled:cursor-wait disabled:opacity-60">
        {busy ? <Spinner className="h-3.5 w-3.5" /> : <CheckCircle2 size={14} />}
        Paga
      </button>
    );
  }

  return (
    <span className="shrink-0">
      <button ref={btnRef} onClick={abrir} disabled={busy} aria-expanded={open}
        title={parcial ? "Pagar o restante" : "Registrar pagamento"}
        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer disabled:cursor-wait disabled:opacity-60 ${parcial
            ? "bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30 hover:bg-amber-500/25"
            : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200"
          }`}>
        {busy ? <Spinner className="h-3.5 w-3.5" /> : <CheckCircle2 size={14} />}
        {parcial ? `Falta ${fmtMoney(falta)}` : "Pagar"}
      </button>

      {open && pos && createPortal(
        <>
          {/* backdrop: clique fora fecha */}
          <button aria-hidden tabIndex={-1} onClick={() => setOpen(false)}
            className="fixed inset-0 z-[60] cursor-default" />
          <div style={{ top: pos.top, right: pos.right }}
            className="fixed z-[61] w-60 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-left shadow-xl">
            {parcial && (
              <p className="mb-2 text-xs text-slate-400">
                Pago <span className="tnum font-medium text-amber-400">{fmtMoney(valorPago)}</span> de {fmtMoney(valor)}
              </p>
            )}
            <label className="mb-1.5 block text-xs font-medium text-slate-300">Paguei agora</label>
            <MoneyInput value={draft} onValue={setDraft} autoFocus
              onKeyDown={(e) => e.key === "Enter" && set(valorPago + draft)} />
            <p className="mt-1.5 text-[11px] text-slate-500">falta {fmtMoney(falta)}</p>
            <div className="mt-3 flex items-center gap-2">
              <Button variant="growth" onClick={() => set(valorPago + draft)} loading={busy}
                className="flex-1 justify-center px-2 py-1.5 text-xs">
                Confirmar
              </Button>
              <button onClick={() => set(valor)} disabled={busy} title="Quitar valor cheio"
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10 cursor-pointer disabled:opacity-60">
                Quitar
              </button>
            </div>
            {parcial && (
              <button onClick={() => set(0)} disabled={busy}
                className="mt-2 w-full text-center text-[11px] text-slate-500 transition-colors hover:text-rose-400 cursor-pointer disabled:opacity-60">
                desfazer pagamentos
              </button>
            )}
          </div>
        </>,
        document.body
      )}
    </span>
  );
}

function Resumo({ icon: Icon, label, value, tone }) {
  const tones = {
    emerald: "text-emerald-400 bg-emerald-500/15",
    rose: "text-rose-400 bg-rose-500/15",
    blue: "text-blue-400 bg-blue-500/15",
  };
  return (
    <Card className="p-4">
      <span className={`mb-3 grid h-9 w-9 place-items-center rounded-lg ${tones[tone]}`}>
        <Icon size={17} />
      </span>
      <p className="text-[11px] leading-tight text-slate-400 sm:text-xs">{label}</p>
      <p className="tnum text-lg font-bold text-white sm:text-xl">{fmtMoney(value)}</p>
    </Card>
  );
}

function Row({ label, value, strong, tone }) {
  const color = tone === "pos" ? "text-emerald-400" : tone === "neg" ? "text-rose-400" : "text-slate-200";
  return (
    <div className="flex items-center justify-between">
      <dt className={strong ? "font-semibold text-white" : "text-slate-400"}>{label}</dt>
      <dd className={`tnum ${strong ? "font-bold" : ""} ${color}`}>{fmtMoney(value)}</dd>
    </div>
  );
}
