import { useState } from "react";
import { Plus, Minus, SlidersHorizontal, ChevronRight } from "lucide-react";
import { Card, ProgressBar, Badge, Button } from "./ui/primitives.jsx";
import { fmtMoney, fmtMeses } from "../lib/format.js";
import { progresso, mesesParaMeta, faltaParaMeta, acento } from "../lib/calc.js";
import { ReservaEmergenciaModal } from "./forms.jsx";
import { useAuth } from "./AuthGate";

// Tipo da caixinha em palavras (a etiqueta leva o tom da própria caixinha).
function tipoDe(c) {
  if (c.tipo === "emergencia") return "Reserva";
  if (c.meta != null) return "Com meta";
  if (c.acumulaSobra) return "Acumula sobra";
  return "Livre";
}

export default function CaixinhaCard({ caixinha, onAporte, onDespesa, onOpen }) {
  const { can } = useAuth();
  const a = acento(caixinha.cor);
  const prog = progresso(caixinha);
  const meses = mesesParaMeta(caixinha);
  const falta = faltaParaMeta(caixinha);
  const temMeta = caixinha.meta != null;
  const isEmergencia = caixinha.tipo === "emergencia";
  const podeConfig = can("caixinha:manage");
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <Card className="group/card flex flex-col p-5 transition-colors hover:border-[var(--color-line-strong)]">
      {/* cabeçalho: o nome abre o detalhe */}
      <div className="flex items-start justify-between gap-3">
        <button onClick={onOpen}
                className="group flex min-w-0 items-center gap-2 text-left cursor-pointer"
                aria-label={`Abrir ${caixinha.nome}`}>
          <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: a.dot }} />
          <h3 className="truncate text-[15px] font-semibold text-ink group-hover:underline decoration-veu/30 underline-offset-4">
            {caixinha.nome}
          </h3>
          <ChevronRight size={15} className="shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5" />
        </button>
        <Badge className={a.chip}>{tipoDe(caixinha)}</Badge>
      </div>

      {/* saldo */}
      <p className={`tnum mt-4 text-2xl font-semibold tracking-[-0.01em] ${caixinha.saldo < 0 ? "text-rose-400" : "text-ink"}`}>
        {fmtMoney(caixinha.saldo)}
      </p>
      <p className="tnum text-[13px] text-slate-500">
        {caixinha.aporteMensal > 0 ? `${fmtMoney(caixinha.aporteMensal)} por mês` : "Sem aporte fixo"}
      </p>

      {/* progresso / meta */}
      <div className="mt-5 flex-1">
        {temMeta ? (
          <>
            <ProgressBar value={prog} color={a.dot} label={`Progresso da meta de ${caixinha.nome}`} />
            <p className="tnum mt-2.5 text-[13px] text-slate-400">
              <span className="font-medium text-ink">{Math.round((prog || 0) * 100)}%</span> de {fmtMoney(caixinha.meta)}
            </p>
            <p className="tnum mt-0.5 text-[13px] text-slate-500">
              {falta > 0 ? <>Faltam {fmtMoney(falta)} · {fmtMeses(meses)}</> : <span className="text-emerald-400">Meta atingida</span>}
            </p>
          </>
        ) : isEmergencia ? (
          podeConfig ? (
            <Button variant="secondary" size="sm" className="w-full justify-between" onClick={() => setConfigOpen(true)}>
              Configurar reserva <ChevronRight size={15} />
            </Button>
          ) : (
            <p className="text-[13px] text-slate-500">Reserva ainda não configurada.</p>
          )
        ) : (
          <p className="text-[13px] text-slate-500">
            {caixinha.acumulaSobra
              ? "Cofre flexível: recebe o que sobra no mês."
              : "Sem meta definida, acumulando livremente."}
          </p>
        )}
      </div>

      {isEmergencia && (
        <ReservaEmergenciaModal open={configOpen} onClose={() => setConfigOpen(false)} caixinha={caixinha} />
      )}

      {/* ações */}
      {(can("movimentacao:manage") || (isEmergencia && temMeta && podeConfig)) && (
        <div className="mt-5 flex items-center gap-2 border-t border-[var(--color-line)] pt-4">
          {can("movimentacao:manage") && (
            <>
              <Button variant="growth" size="sm" onClick={onAporte}><Plus size={15} /> Aporte</Button>
              <Button variant="secondary" size="sm" onClick={onDespesa}><Minus size={15} /> Despesa</Button>
            </>
          )}
          {isEmergencia && temMeta && podeConfig && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setConfigOpen(true)}>
              <SlidersHorizontal size={14} /> Ajustar
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
