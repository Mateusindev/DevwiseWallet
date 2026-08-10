import { useEffect, useMemo, useState } from "react";
import { CreditCard, Plus, Pencil, Trash2, CalendarClock, Users } from "lucide-react";
import { Card, Button, ProgressBar, Donut } from "./ui/primitives.jsx";
import { CartaoModal } from "./forms.jsx";
import { CompartilharModal, MeusCompartilhamentos } from "./Compartilhamento.jsx";
import { fmtMoney, fmtMonthLabel, currentMonthKey, monthRange } from "../lib/format.js";
import { acento } from "../lib/calc.js";
import { useFinance } from "../store/FinanceContext.jsx";
import { useAuth } from "./AuthGate";

export default function Cartoes() {
  const { cartoes, reloadCartoes, removeCartao } = useFinance();
  const { can } = useAuth();
  const canManage = can("cartao:manage");
  const canShare = can("cartao:share");
  const canViewShared = can("cartao:view_shared");
  const [ym, setYm] = useState(currentMonthKey());
  const [novoOpen, setNovoOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sharing, setSharing] = useState(null);
  // meses ao redor do atual (−3 … +6) pra escolher a fatura
  const meses = useMemo(() => monthRange(-3, 6), []);

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

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <CreditCard size={20} /> Cartões de crédito
          </h2>
          <p className="text-sm text-slate-400">Limites, faturas e parcelas em aberto.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={ym} onChange={(e) => setYm(e.target.value)}
                  className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2 text-sm text-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500/30">
            {meses.map((m) => <option key={m} value={m}>{fmtMonthLabel(m)}</option>)}
          </select>
          {canManage && <Button onClick={() => setNovoOpen(true)}><Plus size={16} /> Novo cartão</Button>}
        </div>
      </header>

      {cartoes.length === 0 ? (
        <Card className="px-5 py-14 text-center">
          <CreditCard size={28} className="mx-auto mb-3 text-slate-500" />
          <p className="text-sm text-slate-400">Nenhum cartão cadastrado.</p>
          <p className="mt-1 text-xs text-slate-500">Cadastre seus cartões pra associar despesas e acompanhar a fatura.</p>
        </Card>
      ) : (
        <>
        <Card className="p-5 sm:p-6">
          <div className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Limite total</p>
                <p className="tnum text-3xl font-bold text-white sm:text-4xl">{fmtMoney(totais.limite)}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/4 p-3">
                  <p className="text-[11px] leading-tight text-slate-500">Comprometido</p>
                  <p className="tnum text-sm font-bold text-rose-400">{fmtMoney(totais.usado)}</p>
                </div>
                <div className="rounded-xl bg-white/4 p-3">
                  <p className="text-[11px] leading-tight text-slate-500">Disponível</p>
                  <p className={`tnum text-sm font-bold ${totais.disponivel < 0 ? "text-rose-400" : "text-emerald-400"}`}>{fmtMoney(totais.disponivel)}</p>
                </div>
              </div>
            </div>
            <div className="flex justify-center">
              <Donut
                segments={totais.limite > 0
                  ? [{ value: totais.usado, color: "#fb7185" }, { value: Math.max(totais.disponivel, 0), color: "rgba(255,255,255,0.06)" }]
                  : [{ value: 1, color: "rgba(255,255,255,0.06)" }]}
                centerSub="usado"
                centerLabel={`${Math.round(totais.pct * 100)}%`}
              />
            </div>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          {cartoes.map((c) => (
            <CartaoCard key={c.id} cartao={c} canManage={canManage} canShare={canShare}
                        onEdit={() => setEditing(c)} onRemove={() => removeCartao(c.id)}
                        onShare={() => setSharing(c)} />
          ))}
        </div>
        </>
      )}

      {canViewShared && <MeusCompartilhamentos ym={ym} />}

      <CartaoModal open={novoOpen} onClose={() => setNovoOpen(false)} />
      <CartaoModal open={!!editing} cartao={editing} onClose={() => setEditing(null)} />
      <CompartilharModal open={!!sharing} cartao={sharing} ym={ym} onClose={() => setSharing(null)} />
    </section>
  );
}

function CartaoCard({ cartao: c, canManage, canShare, onEdit, onRemove, onShare }) {
  const a = acento(c.cor);
  const usado = (c.faturaMes || 0) + (c.comprometido || 0);
  const pct = c.limite > 0 ? usado / c.limite : 0;
  const estourado = c.disponivel < 0;

  return (
    <Card className="overflow-hidden p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ backgroundColor: a.dot + "26", color: a.dot }}>
            <CreditCard size={20} />
          </span>
          <div>
            <p className="font-semibold text-white">{c.nome}</p>
            <p className="text-xs text-slate-500">
              {c.bandeira ? `${c.bandeira} · ` : ""}limite {fmtMoney(c.limite)}
            </p>
          </div>
        </div>
        {(canManage || canShare) && (
          <div className="flex gap-1">
            {canShare && (
              <button onClick={onShare} aria-label="Compartilhar cartão"
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-slate-200 cursor-pointer transition-colors">
                <Users size={15} />
              </button>
            )}
            {canManage && (
              <>
                <button onClick={onEdit} aria-label="Editar cartão"
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-slate-200 cursor-pointer transition-colors">
                  <Pencil size={15} />
                </button>
                <button onClick={onRemove} aria-label="Remover cartão"
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/15 hover:text-rose-400 cursor-pointer transition-colors">
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <ProgressBar value={pct} fromClass={a.from} toClass={a.from}
                   className={estourado ? "ring-1 ring-rose-500/40" : ""} />
      <p className="mt-1.5 text-xs text-slate-500">
        {fmtMoney(usado)} de {fmtMoney(c.limite)} comprometidos ({Math.round(pct * 100)}%)
      </p>

      <dl className="mt-4 space-y-2 text-sm">
        <Linha label="Fatura do mês" value={c.faturaMes} />
        <Linha label="Parcelas em aberto" value={c.comprometido} muted />
        <div className="my-1 border-t border-[var(--color-line)]" />
        <Linha label="Limite disponível" value={c.disponivel} strong tone={estourado ? "neg" : "pos"} />
      </dl>

      <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
        <CalendarClock size={14} />
        Vence dia {c.diaVencimento}
        {c.diaFechamento ? ` · fecha dia ${c.diaFechamento}` : ""}
      </div>
    </Card>
  );
}

function Linha({ label, value, strong, muted, tone }) {
  const color = tone === "pos" ? "text-emerald-400" : tone === "neg" ? "text-rose-400" : muted ? "text-slate-400" : "text-slate-200";
  return (
    <div className="flex items-center justify-between">
      <dt className={strong ? "font-semibold text-white" : "text-slate-400"}>{label}</dt>
      <dd className={`tnum ${strong ? "font-bold" : ""} ${color}`}>{fmtMoney(value)}</dd>
    </div>
  );
}
