"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Plus, Minus, Trash2, Target, Pencil } from "lucide-react";
import { Card, ProgressBar, Button, IconButton, Modal } from "./ui/primitives.jsx";
import { AporteModal, DespesaVariavelModal, CaixinhaModal } from "./forms.jsx";
import { fmtMoney, fmtMeses, fmtDate, monthKey, fmtMonthLabel } from "../lib/format.js";
import { progresso, mesesParaMeta, faltaParaMeta, acento } from "../lib/calc.js";
import { useFinance } from "../store/FinanceContext.jsx";
import { useAuth } from "./AuthGate";

export default function CaixinhaDetail({ caixinha, onBack }) {
  const { movimentacoes, removeMovimentacao, removeCaixinha } = useFinance();
  const { can } = useAuth();
  const canMov = can("movimentacao:manage");
  const canEdit = can("caixinha:manage");
  const [aporteOpen, setAporteOpen] = useState(false);
  const [despesaOpen, setDespesaOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [delBusy, setDelBusy] = useState(false);

  async function excluir() {
    setDelBusy(true);
    try {
      await removeCaixinha(caixinha.id);
      onBack();
    } finally { setDelBusy(false); }
  }
  const a = acento(caixinha.cor);

  const movs = useMemo(
    () =>
      movimentacoes
        .filter((m) => m.caixinhaId === caixinha.id)
        .sort((x, y) => y.data.localeCompare(x.data)),
    [movimentacoes, caixinha.id]
  );

  // group by month
  const grupos = useMemo(() => {
    const map = new Map();
    for (const m of movs) {
      const k = monthKey(m.data);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(m);
    }
    return [...map.entries()];
  }, [movs]);

  const prog = progresso(caixinha);
  const temMeta = caixinha.meta != null;

  return (
    <section className="space-y-5">
      <button onClick={onBack}
              className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white cursor-pointer transition-colors">
        <ArrowLeft size={16} /> Voltar
      </button>

      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className={`grid h-12 w-12 place-items-center rounded-2xl ${a.soft}`}>
              <Target size={22} className={a.text} />
            </span>
            <div>
              <h2 className="text-xl font-bold text-white">{caixinha.nome}</h2>
              <p className="text-sm text-slate-400">
                {caixinha.aporteMensal > 0 ? `${fmtMoney(caixinha.aporteMensal)}/mês` : "Sem aporte fixo"}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-slate-500">Saldo atual</p>
              <p className={`tnum text-3xl font-bold ${caixinha.saldo < 0 ? "text-rose-400" : "text-white"}`}>
                {fmtMoney(caixinha.saldo)}
              </p>
            </div>
            {canEdit && (
              <div className="flex items-center gap-1">
                <button onClick={() => setEditOpen(true)} aria-label="Editar caixinha"
                        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white cursor-pointer">
                  <Pencil size={16} />
                </button>
                <button onClick={() => setConfirmDel(true)} aria-label="Excluir caixinha"
                        className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-500/15 hover:text-rose-300 cursor-pointer">
                  <Trash2 size={16} />
                </button>
              </div>
            )}
          </div>
        </div>

        {temMeta && (
          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="text-slate-400">Meta {fmtMoney(caixinha.meta)}</span>
              <span className={`tnum font-semibold ${a.text}`}>{Math.round((prog || 0) * 100)}%</span>
            </div>
            <ProgressBar value={prog} fromClass={a.from} toClass="to-white/70" />
            <p className="mt-2 text-xs text-slate-400">
              {faltaParaMeta(caixinha) > 0
                ? <>Faltam <span className="tnum text-slate-200">{fmtMoney(faltaParaMeta(caixinha))}</span> · estimativa de <span className="text-slate-200">{fmtMeses(mesesParaMeta(caixinha))}</span></>
                : <span className="text-emerald-400">✓ Meta atingida</span>}
            </p>
          </div>
        )}

        {canMov && (
          <div className="mt-5 flex gap-2">
            <Button variant="growth" onClick={() => setAporteOpen(true)} className="flex-1 sm:flex-none">
              <Plus size={16} /> Aporte
            </Button>
            <Button variant="outline" onClick={() => setDespesaOpen(true)} className="flex-1 sm:flex-none">
              <Minus size={16} /> Despesa
            </Button>
          </div>
        )}
      </Card>

      {/* history */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-300">Histórico · {movs.length} movimentações</h3>
        {grupos.length === 0 ? (
          <Card className="px-5 py-12 text-center text-sm text-slate-500">
            Nenhuma movimentação ainda. Registre o primeiro aporte.
          </Card>
        ) : (
          <div className="space-y-5">
            {grupos.map(([mes, items]) => (
              <div key={mes}>
                <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                  {fmtMonthLabel(mes)}
                </p>
                <Card className="overflow-hidden">
                  <ul className="divide-y divide-[var(--color-line)]">
                    {items.map((m) => (
                      <li key={m.id} className="group flex items-center gap-3 px-5 py-3.5">
                        <span className={`grid h-9 w-9 place-items-center rounded-lg ${m.tipo === "aporte" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
                          {m.tipo === "aporte" ? <Plus size={16} /> : <Minus size={16} />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-200">{m.descricao}</p>
                          <p className="text-xs text-slate-500">{fmtDate(m.data)}</p>
                        </div>
                        <span className={`tnum font-semibold ${m.tipo === "aporte" ? "text-emerald-400" : "text-rose-400"}`}>
                          {m.tipo === "aporte" ? "+" : "−"}{fmtMoney(m.valor)}
                        </span>
                        {canMov && (
                          <IconButton tone="danger" onClick={() => removeMovimentacao(m.id)}
                                      aria-label="Remover movimentação"
                                      className="text-slate-600 opacity-0 group-hover:opacity-100">
                            <Trash2 size={15} />
                          </IconButton>
                        )}
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            ))}
          </div>
        )}
      </div>

      <AporteModal open={aporteOpen} onClose={() => setAporteOpen(false)} caixinhas={[caixinha]} defaultCaixinhaId={caixinha.id} lockCaixinha />
      <DespesaVariavelModal open={despesaOpen} onClose={() => setDespesaOpen(false)} caixinhas={[caixinha]} defaultCaixinhaId={caixinha.id} lockCaixinha />
      <CaixinhaModal open={editOpen} onClose={() => setEditOpen(false)} caixinha={caixinha} />

      <Modal open={confirmDel} onClose={() => !delBusy && setConfirmDel(false)} title="Excluir caixinha">
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            Excluir <b className="text-white">{caixinha.nome}</b>?
          </p>
          <p className="rounded-xl bg-rose-500/10 px-3.5 py-3 text-xs text-rose-200 ring-1 ring-rose-500/20">
            Apaga a caixinha e <b>todas as movimentações</b> (aportes e despesas) dela.
            Não dá pra desfazer.
          </p>
          <div className="flex gap-2 pt-1">
            <Button variant="ghost" className="flex-1" disabled={delBusy} onClick={() => setConfirmDel(false)}>
              Cancelar
            </Button>
            <Button variant="danger" className="flex-1" loading={delBusy} onClick={excluir}>
              <Trash2 size={15} /> Excluir
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
