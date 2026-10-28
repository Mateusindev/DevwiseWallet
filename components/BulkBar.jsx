import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { fmtMoney } from "../lib/format.js";
import { IconButton, Spinner, buttonClass, usePendenteDoClique } from "./ui/primitives.jsx";

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
      <div className="pointer-events-auto mb-16 w-full max-w-3xl rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] p-2.5 shadow-[var(--sombra-flutua)] animate-[sobe_.18s_ease-out] lg:mb-0">
        {(erro || aviso) && (
          <p role={erro ? "alert" : undefined}
             className={`mb-2 rounded-lg px-3 py-2 text-[13px] ${erro ? "bg-rose-500/10 text-rose-300" : "bg-amber-500/10 text-amber-300"}`}>
            {erro || aviso}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="mr-auto flex items-center gap-1.5">
            <IconButton onClick={onLimpar} aria-label="Limpar seleção" title="Limpar seleção">
              <X size={16} />
            </IconButton>
            <p className="text-sm text-slate-300" aria-live="polite">
              <span className="font-semibold text-ink">{quantos}</span> {label}
              <span className="tnum ml-2 font-medium text-ink">{fmtMoney(total)}</span>
            </p>
          </div>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

// Botão da barra (compacto, cabe 5 numa tela de 390px). Mesmas variantes do
// `Button` — o primário é tinta, o de pagar é o verde pálido.
export function BulkAcao({ onClick, disabled, tone = "ghost", children }) {
  // Lote é a ação mais lenta do app (carrega todos os ids antes de escrever
  // nada): sem a pendência automática o segundo clique disparava o lote de novo.
  const [pendente, clique] = usePendenteDoClique(onClick);
  const variante = { ghost: "secondary", primary: "primary", growth: "growth", danger: "danger-soft" }[tone] ?? "secondary";
  return (
    <button type="button" onClick={clique} disabled={disabled || pendente} aria-busy={pendente ? true : undefined}
            className={buttonClass(variante, "sm")}>
      {pendente ? <Spinner className="h-3.5 w-3.5" /> : children}
    </button>
  );
}
