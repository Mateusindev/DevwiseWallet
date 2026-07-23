import { useState } from "react";
import { Plus, Minus, Target, TrendingUp, Infinity as InfinityIcon, LifeBuoy, SlidersHorizontal } from "lucide-react";
import { Card, ProgressBar, Badge } from "./ui/primitives.jsx";
import { fmtMoney, fmtMeses } from "../lib/format.js";
import { progresso, mesesParaMeta, faltaParaMeta, acento } from "../lib/calc.js";
import { ReservaEmergenciaModal } from "./forms.jsx";
import { useAuth } from "./AuthGate";

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
    <Card className="flex flex-col p-5 transition-colors hover:border-white/15">
      {/* header */}
      <button onClick={onOpen}
              className="group flex items-start justify-between text-left cursor-pointer"
              aria-label={`Abrir ${caixinha.nome}`}>
        <div className="flex items-center gap-3">
          <span className={`grid h-10 w-10 place-items-center rounded-xl ${a.soft}`}>
            {isEmergencia ? <LifeBuoy size={18} className={a.text} />
              : temMeta ? <Target size={18} className={a.text} />
              : caixinha.acumulaSobra ? <TrendingUp size={18} className={a.text} />
              : <InfinityIcon size={18} className={a.text} />}
          </span>
          <div>
            <h3 className="font-semibold text-white group-hover:underline decoration-white/30 underline-offset-4">
              {caixinha.nome}
            </h3>
            <p className="text-xs text-slate-400">
              {caixinha.aporteMensal > 0 ? `${fmtMoney(caixinha.aporteMensal)}/mês` : "Sem aporte fixo"}
            </p>
          </div>
        </div>
        {caixinha.acumulaSobra && (
          <Badge className="bg-white/5 text-slate-300">acumula sobra</Badge>
        )}
      </button>

      {/* saldo */}
      <div className="mt-5">
        <p className="text-xs uppercase tracking-wide text-slate-500">Saldo</p>
        <p className={`tnum text-2xl font-bold ${caixinha.saldo < 0 ? "text-rose-400" : "text-white"}`}>
          {fmtMoney(caixinha.saldo)}
        </p>
      </div>

      {/* progress / meta */}
      <div className="mt-4 min-h-[58px]">
        {temMeta ? (
          <>
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="text-slate-400">Meta {fmtMoney(caixinha.meta)}</span>
              <span className={`tnum font-semibold ${a.text}`}>{Math.round((prog || 0) * 100)}%</span>
            </div>
            <ProgressBar value={prog} fromClass={a.from} toClass="to-white/70" />
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-400">
              <span>
                {falta > 0
                  ? <>Faltam <span className="tnum text-slate-200">{fmtMoney(falta)}</span> · <span className="text-slate-200">{fmtMeses(meses)}</span></>
                  : <span className="text-emerald-400">✓ Meta atingida</span>}
              </span>
              {isEmergencia && podeConfig && (
                <button onClick={() => setConfigOpen(true)}
                        className="inline-flex shrink-0 items-center gap-1 text-slate-400 hover:text-slate-200 cursor-pointer">
                  <SlidersHorizontal size={12} /> Ajustar
                </button>
              )}
            </div>
          </>
        ) : isEmergencia ? (
          podeConfig ? (
            <button onClick={() => setConfigOpen(true)}
                    className={`flex h-full w-full items-center justify-between gap-2 rounded-xl px-3.5 py-3 text-sm font-semibold cursor-pointer transition-colors ${a.soft} ${a.text} hover:brightness-110`}>
              <span>Configurar reserva</span>
              <span aria-hidden>→</span>
            </button>
          ) : (
            <div className="flex h-full items-center rounded-xl bg-white/4 px-3 py-3 text-xs text-slate-400">
              Reserva ainda não configurada.
            </div>
          )
        ) : (
          <div className="flex h-full items-center rounded-xl bg-white/4 px-3 py-3 text-xs text-slate-400">
            {caixinha.acumulaSobra
              ? "Cofre flexível — recebe o que sobra no mês."
              : "Sem meta definida. Acumulando livremente."}
          </div>
        )}
      </div>

      {isEmergencia && (
        <ReservaEmergenciaModal open={configOpen} onClose={() => setConfigOpen(false)} caixinha={caixinha} />
      )}

      {/* actions */}
      {can("movimentacao:manage") && (
      <div className="mt-4 flex gap-2">
        <button onClick={onAporte}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500/15 py-2 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25 cursor-pointer">
          <Plus size={15} /> Aporte
        </button>
        <button onClick={onDespesa}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white/5 py-2 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/10 cursor-pointer">
          <Minus size={15} /> Despesa
        </button>
      </div>
      )}
    </Card>
  );
}
