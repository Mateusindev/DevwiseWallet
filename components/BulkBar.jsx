import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { fmtMoney } from "../lib/format.js";
import { Spinner, usePendenteDoClique } from "./ui/primitives.jsx";

// Barra de ações em lote, fixa no rodapé. Vive num portal pro body: dentro da
// lista ela seria cortada pelo overflow dos Cards.
//
// `pb-[env(safe-area-inset-bottom)]`: sem isso o botão fica embaixo da barra de
// gestos do iOS. Quem renderiza também precisa de padding no fim da lista pra
// última linha não ficar coberta (ver `pb-24` em DespesasFixas).
export default function BulkBar({ quantos, total, label, aviso, erro, onLimpar, children }) {
  if (quantos === 0 || typeof document === "undefined") return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto w-full max-w-3xl rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-2)] p-3 shadow-2xl">
        {(erro || aviso) && (
          <p role={erro ? "alert" : undefined}
             className={`mb-2 rounded-lg px-2.5 py-1.5 text-xs ${erro ? "bg-rose-500/10 text-rose-300" : "bg-amber-500/10 text-amber-300"}`}>
            {erro || aviso}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto flex items-center gap-2 pl-1">
            <button type="button" onClick={onLimpar} aria-label="Limpar seleção"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white cursor-pointer transition-colors">
              <X size={16} />
            </button>
            <p className="text-sm text-slate-200">
              <span className="font-semibold">{quantos}</span> {label}
              <span className="tnum ml-2 text-slate-400">{fmtMoney(total)}</span>
            </p>
          </div>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

// Botão da barra (compacto, cabe 5 numa tela de 390px).
export function BulkAcao({ onClick, disabled, tone = "ghost", children }) {
  // Lote é a ação mais lenta do app (carrega todos os ids antes de escrever
  // nada): sem a pendência automática o segundo clique disparava o lote de novo.
  const [pendente, clique] = usePendenteDoClique(onClick);
  const tons = {
    ghost: "bg-white/5 text-slate-200 hover:bg-white/10",
    primary: "bg-blue-600 text-white hover:bg-blue-500",
    growth: "bg-emerald-600 text-white hover:bg-emerald-500",
    danger: "bg-rose-600/90 text-white hover:bg-rose-600",
  };
  return (
    <button type="button" onClick={clique} disabled={disabled || pendente} aria-busy={pendente ? true : undefined}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${tons[tone]}`}>
      {pendente ? <Spinner className="h-3.5 w-3.5" /> : children}
    </button>
  );
}
