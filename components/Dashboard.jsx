import { useEffect, useMemo, useState } from "react";
import { Plus, PiggyBank, Target, LifeBuoy, ChevronRight } from "lucide-react";
import { Card, Donut, Button, ProgressBar, Modal } from "./ui/primitives.jsx";
import { GroupedBars, HBars, LineTrend } from "./ui/charts.jsx";
import CaixinhaCard from "./CaixinhaCard.jsx";
import { AporteModal, DespesaVariavelModal, CaixinhaModal, ReservaEmergenciaModal } from "./forms.jsx";
import { fmtMoney, fmtMoneyCompact, currentMonthKey, fmtMonthLabel, fmtMonthShort, lastMonths } from "../lib/format.js";
import { totalSaldo, totalAporteMensal, acento, orcamentoMes, fixaContaNoMes } from "../lib/calc.js";
import { useFinance } from "../store/FinanceContext.jsx";
import { useAuth } from "./AuthGate";

const GREY = "#64748b";

export default function Dashboard({ onOpenCaixinha }) {
  const fin = useFinance();
  const { can } = useAuth();
  const {
    caixinhas, cartoes, categorias, despesasFixas, despesasMes, receitasMes,
    rendasMensais, config, reloadCartoes,
  } = fin;

  const ym = currentMonthKey();
  // agregados de fatura do mês (caso o usuário caia aqui primeiro)
  useEffect(() => { reloadCartoes(); }, [reloadCartoes]);

  const catMap = useMemo(() => Object.fromEntries(categorias.map((c) => [c.id, c])), [categorias]);
  const orc = useMemo(
    () => orcamentoMes({ rendasMensais, despesasMes, receitasMes, despesasFixas, config }, ym),
    [rendasMensais, despesasMes, receitasMes, despesasFixas, config, ym]
  );
  // série dos últimos 6 meses (evolução + sobra)
  const serie = useMemo(() =>
    lastMonths(6, ym).map((m) => ({
      ym: m,
      ...orcamentoMes({ rendasMensais, despesasMes, receitasMes, despesasFixas, config }, m),
    })),
    [rendasMensais, despesasMes, receitasMes, despesasFixas, config, ym]
  );

  // despesas do mês por categoria (fixas que caem + avulsas)
  const porCategoria = useMemo(() => {
    const acc = {};
    const add = (id, v) => { const k = id || "__none"; acc[k] = (acc[k] || 0) + v; };
    despesasFixas.filter((d) => fixaContaNoMes(d, ym)).forEach((d) => add(d.categoriaId, d.valor));
    despesasMes.filter((d) => d.mes === ym).forEach((d) => add(d.categoriaId, d.valor));
    return Object.entries(acc)
      .map(([id, value]) => {
        const c = id !== "__none" ? catMap[id] : null;
        return { label: c?.nome || "Sem categoria", value, color: c ? acento(c.cor).dot : GREY };
      })
      .sort((a, b) => b.value - a.value);
  }, [despesasFixas, despesasMes, catMap, ym]);

  const topFixas = useMemo(() =>
    despesasFixas
      .filter((d) => fixaContaNoMes(d, ym))
      .map((d) => ({ label: d.descricao, value: d.valor, color: d.categoriaId && catMap[d.categoriaId] ? acento(catMap[d.categoriaId].cor).dot : GREY }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6),
    [despesasFixas, catMap, ym]
  );

  const cart = useMemo(() => {
    const limite = cartoes.reduce((s, c) => s + (c.limite || 0), 0);
    const usado = cartoes.reduce((s, c) => s + (c.faturaMes || 0) + (c.comprometido || 0), 0);
    return { limite, usado, disponivel: limite - usado, pct: limite > 0 ? usado / limite : 0 };
  }, [cartoes]);

  const gastoCartao = porCategoria.reduce((s, c) => s + c.value, 0);

  const [aporte, setAporte] = useState(false);
  const [despesa, setDespesa] = useState(false);
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

  const segments = caixinhas
    .filter((c) => c.saldo > 0)
    .map((c) => ({ value: c.saldo, color: acento(c.cor).dot }));

  const ordered = [...caixinhas].sort((a, b) => a.ordem - b.ordem);

  return (
    <section className="space-y-6">
      {/* greeting + quick actions */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">{fmtMonthLabel(currentMonthKey())}</p>
        </div>
        {can("movimentacao:manage") && (
          <div className="flex flex-wrap gap-2">
            <Button variant="growth" onClick={() => setAporte(true)}><Plus size={16} /> Aporte</Button>
            <Button variant="outline" onClick={() => setDespesa(true)}>Registrar despesa</Button>
          </div>
        )}
      </header>

      {/* hero: patrimônio + donut */}
      <Card className="p-5 sm:p-6">
        <div className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="space-y-5">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Total guardado</p>
              <p className="tnum text-3xl font-bold text-white sm:text-4xl">{fmtMoney(saldo)}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/4 p-3">
                <PiggyBank size={15} className="mb-1.5 text-slate-500" />
                <p className="text-[11px] leading-tight text-slate-500">Aporte mensal</p>
                <p className="tnum text-sm font-bold text-emerald-400">{fmtMoney(aporteMensal)}</p>
              </div>
              <div className="rounded-xl bg-white/4 p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <Target size={15} className="text-slate-500" />
                  {metas.qtd > 0 && (
                    <span className="tnum text-[11px] text-slate-500">{metas.atingidas}/{metas.qtd} metas</span>
                  )}
                </div>
                <p className="text-[11px] leading-tight text-slate-500">Progresso das metas</p>
                {metas.qtd > 0 ? (
                  <>
                    <p className="tnum text-sm font-bold text-blue-400">{Math.round(metas.progresso * 100)}%</p>
                    <ProgressBar value={metas.progresso} className="mt-1.5 h-1.5" />
                  </>
                ) : (
                  <p className="text-sm font-medium text-slate-400">sem metas</p>
                )}
              </div>
            </div>
          </div>
          <div className="flex justify-center">
            <Donut
              segments={segments.length ? segments : [{ value: 1, color: "rgba(255,255,255,0.06)" }]}
              centerLabel={fmtMoney(saldo).replace("R$ ", "R$ ")}
            />
          </div>
        </div>
        {/* legend */}
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--color-line)] pt-4">
          {ordered.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-2 text-xs text-slate-400">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: acento(c.cor).dot }} />
              {c.nome} <span className="tnum text-slate-300">{fmtMoney(c.saldo)}</span>
            </span>
          ))}
        </div>
      </Card>

      {/* caixinhas */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Caixinhas</h3>
          {can("caixinha:manage") && (
            <button onClick={() => setNovaMode(temReserva ? "normal" : "choose")}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-400 hover:text-blue-300 cursor-pointer">
              <Plus size={15} /> Nova
            </button>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {ordered.map((c) => (
            <CaixinhaCard
              key={c.id}
              caixinha={c}
              onOpen={() => onOpenCaixinha(c.id)}
              onAporte={() => setAporte(true)}
              onDespesa={() => setDespesa(true)}
            />
          ))}
        </div>
      </div>

      {/* Gráficos do orçamento (espaço ativo) */}
      {can("orcamento:view") && (
        <>
          {/* Evolução mensal */}
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Entradas × saídas · 6 meses</h3>
              <Legend items={[{ name: "Recebido", color: "#10b981" }, { name: "Gasto", color: "#f43f5e" }]} />
            </div>
            <GroupedBars
              data={serie.map((s) => ({
                label: fmtMonthShort(s.ym),
                bars: [{ name: "Recebido", value: s.recebido, color: "#10b981" }, { name: "Gasto", value: s.saiu, color: "#f43f5e" }],
              }))}
            />
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Sobra mensal */}
            <Card className="p-5">
              <h3 className="mb-4 text-sm font-semibold text-white">Sobra mensal</h3>
              <LineTrend points={serie.map((s) => ({ label: fmtMonthShort(s.ym), value: s.sobrou }))}
                         color={orc.sobrou >= 0 ? "#3b82f6" : "#f43f5e"} />
            </Card>

            {/* Despesas por categoria */}
            <Card className="p-5">
              <h3 className="mb-4 text-sm font-semibold text-white">Despesas por categoria</h3>
              {porCategoria.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">Nenhuma despesa neste mês.</p>
              ) : (
                <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
                  <Donut size={150} segments={porCategoria.map((c) => ({ value: c.value, color: c.color }))}
                         centerSub="gasto" centerLabel={fmtMoneyCompact(gastoCartao)} />
                  <ul className="flex-1 space-y-2 self-stretch">
                    {porCategoria.map((c) => (
                      <li key={c.label} className="flex items-center gap-2 text-sm">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                        <span className="min-w-0 flex-1 truncate text-slate-300">{c.label}</span>
                        <span className="tnum text-slate-400">{Math.round((c.value / gastoCartao) * 100)}%</span>
                        <span className="tnum w-20 text-right font-medium text-slate-200">{fmtMoneyCompact(c.value)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>

            {/* Top despesas fixas */}
            <Card className="p-5">
              <h3 className="mb-4 text-sm font-semibold text-white">Maiores despesas fixas</h3>
              <HBars items={topFixas} empty="Nenhuma despesa fixa ativa." />
            </Card>

            {/* Cartões */}
            <Card className="p-5">
              <h3 className="mb-4 text-sm font-semibold text-white">Uso dos cartões</h3>
              {cart.limite === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500">Nenhum cartão cadastrado.</p>
              ) : (
                <div className="flex flex-col items-center gap-5 sm:flex-row">
                  <Donut size={150}
                         segments={[{ value: cart.usado, color: "#fb7185" }, { value: Math.max(cart.disponivel, 0), color: "rgba(255,255,255,0.06)" }]}
                         centerSub="usado" centerLabel={`${Math.round(cart.pct * 100)}%`} />
                  <dl className="flex-1 space-y-2.5 self-stretch text-sm">
                    <KV label="Limite total" value={fmtMoney(cart.limite)} />
                    <KV label="Comprometido" value={fmtMoney(cart.usado)} tone="rose" />
                    <KV label="Disponível" value={fmtMoney(cart.disponivel)} tone={cart.disponivel < 0 ? "rose" : "emerald"} strong />
                  </dl>
                </div>
              )}
            </Card>
          </div>
        </>
      )}

      <AporteModal open={aporte} onClose={() => setAporte(false)} caixinhas={ordered} />
      <DespesaVariavelModal open={despesa} onClose={() => setDespesa(false)} caixinhas={ordered} />

      {/* Passo 1: escolher o tipo de caixinha a criar */}
      <Modal open={novaMode === "choose"} onClose={() => setNovaMode(null)} title="Nova caixinha">
        <div className="space-y-2.5">
          <TipoOpcao icon={LifeBuoy} tone="emerald" title="Reserva de emergência"
            desc="Meta calculada pelas suas respostas — meses de segurança × gasto mensal."
            onClick={() => setNovaMode("reserva")} />
          <TipoOpcao icon={PiggyBank} tone="blue" title="Caixinha comum"
            desc="Meta livre, aporte mensal e rendimento — pra qualquer objetivo."
            onClick={() => setNovaMode("normal")} />
        </div>
      </Modal>

      <CaixinhaModal open={novaMode === "normal"} onClose={() => setNovaMode(null)} />
      <ReservaEmergenciaModal open={novaMode === "reserva"} onClose={() => setNovaMode(null)}
        onCreated={() => setNovaMode(null)} />
    </section>
  );
}

// Linha rótulo/valor (uso dos cartões). Portado do antigo Painel.
function KV({ label, value, tone, strong }) {
  const color = tone === "rose" ? "text-rose-400" : tone === "emerald" ? "text-emerald-400" : "text-slate-200";
  return (
    <div className="flex items-center justify-between">
      <dt className={strong ? "font-semibold text-white" : "text-slate-400"}>{label}</dt>
      <dd className={`tnum ${strong ? "font-bold" : ""} ${color}`}>{value}</dd>
    </div>
  );
}

function Legend({ items }) {
  return (
    <div className="flex gap-3">
      {items.map((it) => (
        <span key={it.name} className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: it.color }} /> {it.name}
        </span>
      ))}
    </div>
  );
}

// Opção de tipo no passo 1 do "Nova caixinha".
function TipoOpcao({ icon: Icon, tone, title, desc, onClick }) {
  const tones = { emerald: "text-emerald-400 bg-emerald-500/15", blue: "text-blue-400 bg-blue-500/15" };
  return (
    <button onClick={onClick}
      className="flex w-full items-center gap-3.5 rounded-xl border border-[var(--color-line)] bg-white/[0.02] p-4 text-left hover:border-white/25 hover:bg-white/5 cursor-pointer transition-colors">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tones[tone]}`}>
        <Icon size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-white">{title}</span>
        <span className="block text-xs text-slate-400">{desc}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-slate-500" />
    </button>
  );
}
