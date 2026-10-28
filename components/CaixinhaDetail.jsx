"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Plus, Minus, Trash2, Pencil } from "lucide-react";
import {
  Card, ProgressBar, Button, IconButton, Modal, PageHeader, SectionHeader, EmptyState, Badge,
} from "./ui/primitives.jsx";
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
  const falta = faltaParaMeta(caixinha);
  const totais = useMemo(() => {
    let entrou = 0, saiu = 0;
    for (const m of movs) {
      if (m.tipo === "aporte") entrou += m.valor;
      else saiu += m.valor;
    }
    return { entrou, saiu };
  }, [movs]);

  // A frase debaixo do título é a resposta: quanto falta, ou que já chegou.
  const achado = temMeta
    ? falta > 0
      ? `${Math.round((prog || 0) * 100)}% da meta de ${fmtMoney(caixinha.meta)} · faltam ${fmtMoney(falta)}`
      : `Meta de ${fmtMoney(caixinha.meta)} atingida`
    : caixinha.acumulaSobra
      ? "Cofre flexível: recebe o que sobra no mês"
      : "Sem meta definida, acumulando livremente";

  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <button onClick={onBack}
                className="-ml-1 inline-flex h-8 items-center gap-1.5 rounded-lg px-1 text-[13px] font-medium text-slate-400 hover:text-ink cursor-pointer transition-colors">
          <ArrowLeft size={15} /> Início
        </button>
        <PageHeader
          title={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ backgroundColor: a.dot }} aria-hidden />
              {caixinha.nome}
              <Badge className={`${a.chip} align-middle`}>{tipoDe(caixinha)}</Badge>
            </span>
          }
          description={achado}
          actions={(canMov || canEdit) && (
            <>
              {canEdit && (
                <>
                  <IconButton onClick={() => setEditOpen(true)} aria-label="Editar caixinha" title="Editar">
                    <Pencil size={16} />
                  </IconButton>
                  <IconButton tone="danger" onClick={() => setConfirmDel(true)} aria-label="Excluir caixinha" title="Excluir">
                    <Trash2 size={16} />
                  </IconButton>
                </>
              )}
              {canMov && (
                <>
                  <Button variant="secondary" onClick={() => setDespesaOpen(true)}><Minus size={16} /> Despesa</Button>
                  <Button onClick={() => setAporteOpen(true)}><Plus size={16} /> Aporte</Button>
                </>
              )}
            </>
          )}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
        {/* resumo: o saldo lidera, a meta explica */}
        <Card className="p-5 sm:p-6 lg:sticky lg:top-8">
          <p className="text-[13px] text-slate-500">Saldo atual</p>
          <p className={`tnum text-[32px] font-semibold leading-10 tracking-[-0.02em] ${caixinha.saldo < 0 ? "text-rose-400" : "text-ink"}`}>
            {fmtMoney(caixinha.saldo)}
          </p>

          {temMeta && (
            <div className="mt-5">
              <ProgressBar value={prog} color={a.dot} label={`Progresso da meta de ${caixinha.nome}`} />
              <p className="tnum mt-2.5 text-[13px] text-slate-400">
                <span className="font-medium text-ink">{Math.round((prog || 0) * 100)}%</span> de {fmtMoney(caixinha.meta)}
              </p>
              <p className="tnum mt-0.5 text-[13px] text-slate-500">
                {falta > 0
                  ? <>Faltam {fmtMoney(falta)} · estimativa de {fmtMeses(mesesParaMeta(caixinha))}</>
                  : <span className="text-emerald-400">Meta atingida</span>}
              </p>
            </div>
          )}

          <dl className="mt-5 space-y-2.5 border-t border-[var(--color-line)] pt-4 text-sm">
            <Linha label="Aporte mensal" value={caixinha.aporteMensal > 0 ? fmtMoney(caixinha.aporteMensal) : "—"} />
            {caixinha.taxaJuros > 0 && (
              <Linha label="Rendimento" value={`${caixinha.taxaJuros.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% a.a.`} />
            )}
            <Linha label="Total aportado" value={`+${fmtMoney(totais.entrou)}`} tone="pos" />
            <Linha label="Total retirado" value={fmtMoney(totais.saiu)} />
          </dl>
        </Card>

        {/* histórico */}
        <div className="space-y-4">
          <SectionHeader title="Histórico"
            description={`${movs.length} ${movs.length === 1 ? "movimentação" : "movimentações"}`} />
          {grupos.length === 0 ? (
            <EmptyState title="Nenhuma movimentação ainda"
              description="O saldo nasce dos aportes. Registre o primeiro."
              action={canMov && <Button size="sm" onClick={() => setAporteOpen(true)}><Plus size={15} /> Registrar aporte</Button>} />
          ) : (
            // Um quadro só, meses como subtítulos: com um aporte por mês, um
            // cartão por mês virava pilha de caixas com uma linha cada.
            <Card className="px-5 py-2 sm:px-6">
              {grupos.map(([mes, items], gi) => {
                const liquido = items.reduce((s, m) => s + (m.tipo === "aporte" ? m.valor : -m.valor), 0);
                return (
                  <div key={mes} className={gi > 0 ? "border-t border-[var(--color-line)]" : ""}>
                    <div className="flex items-baseline justify-between gap-3 pb-1 pt-4">
                      <h3 className="text-[13px] font-medium text-slate-400">{fmtMonthLabel(mes)}</h3>
                      <span className={`tnum text-[13px] ${canMov ? "sm:mr-11" : ""} ${liquido < 0 ? "text-slate-400" : "text-emerald-400"}`}>
                        {liquido >= 0 ? "+" : "−"}{fmtMoney(Math.abs(liquido))} no mês
                      </span>
                    </div>
                    <ul className="divide-y divide-[var(--color-line)]">
                      {items.map((m) => (
                        <li key={m.id} className="group flex min-h-14 items-center gap-3 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-200">{m.descricao}</p>
                            <p className="tnum text-[13px] text-slate-500">
                              {fmtDate(m.data)} · {m.tipo === "aporte" ? "Aporte" : "Despesa"}
                            </p>
                          </div>
                          {/* polaridade calma: entrada verde com +, saída em tinta com − */}
                          <span className={`tnum shrink-0 text-right text-sm font-semibold ${m.tipo === "aporte" ? "text-emerald-400" : "text-ink"}`}>
                            {m.tipo === "aporte" ? "+" : "−"}{fmtMoney(m.valor)}
                          </span>
                          {canMov && (
                            <IconButton tone="danger" onClick={() => removeMovimentacao(m.id)}
                                        aria-label={`Remover ${m.descricao}`}
                                        className="sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100">
                              <Trash2 size={15} />
                            </IconButton>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </Card>
          )}
        </div>
      </div>

      <AporteModal open={aporteOpen} onClose={() => setAporteOpen(false)} caixinhas={[caixinha]} defaultCaixinhaId={caixinha.id} lockCaixinha />
      <DespesaVariavelModal open={despesaOpen} onClose={() => setDespesaOpen(false)} caixinhas={[caixinha]} defaultCaixinhaId={caixinha.id} lockCaixinha />
      <CaixinhaModal open={editOpen} onClose={() => setEditOpen(false)} caixinha={caixinha} />

      <Modal open={confirmDel} onClose={() => !delBusy && setConfirmDel(false)} title={`Excluir ${caixinha.nome}?`} size="sm">
        <div className="space-y-5">
          <p className="text-sm text-slate-300">
            Apaga a caixinha e <b className="font-semibold text-ink">todas as movimentações</b> dela
            ({movs.length} {movs.length === 1 ? "registro" : "registros"}). Não dá pra desfazer.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" className="w-full sm:w-auto" disabled={delBusy} onClick={() => setConfirmDel(false)}>
              Cancelar
            </Button>
            <Button variant="danger" className="w-full sm:w-auto" loading={delBusy} onClick={excluir}>
              <Trash2 size={15} /> Excluir caixinha
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

// Tipo da caixinha em palavras (mesma régua do card do Início).
function tipoDe(c) {
  if (c.tipo === "emergencia") return "Reserva";
  if (c.meta != null) return "Com meta";
  if (c.acumulaSobra) return "Acumula sobra";
  return "Livre";
}

function Linha({ label, value, tone }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-400">{label}</dt>
      <dd className={`tnum font-medium ${tone === "pos" ? "text-emerald-400" : "text-ink"}`}>{value}</dd>
    </div>
  );
}
