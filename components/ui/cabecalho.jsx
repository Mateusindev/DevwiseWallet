"use client";

// Cabeçalho das telas que andam por mês (Visão geral, Despesas, Cartões).
// O MÊS é o h1 — é ele que muda a tela inteira; o nome da tela desce pra uma
// sobrancelha em caixa alta. O mês grande é o próprio gatilho do seletor, com
// setas soltas do lado. Telas sem mês seguem com o `PageHeader`.
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { MonthSelect } from "./fields.jsx";
import { MESES, addMonths, fmtMonthLabel } from "../../lib/format.js";
import { TrocaPagina } from "../TrocaPagina.jsx";

const nomeMes = (ym) => MESES[Number(ym.slice(5, 7)) - 1];

// `trocaPagina`: as bolhas de página (espaço) entram ao lado das setas do
// mês — é global, como trocar de perfil.
export function CabecalhoMes({ pagina, contexto, ym, onYm, min, max, marked, resumo, actions, trocaPagina, className }) {
  const troca = trocaPagina ? <TrocaPagina ym={ym} /> : null;
  const prev = addMonths(ym, -1);
  const next = addMonths(ym, 1);
  const seta = "grid size-8 place-items-center rounded-full text-slate-400 transition-colors hover:bg-veu/[0.07] hover:text-ink cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed";
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="min-w-0">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          {pagina}
          {!troca && contexto && <> · <span className="normal-case tracking-normal">{contexto}</span></>}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-2">
          <h1 className="sr-only">{pagina} — {fmtMonthLabel(ym)}</h1>
          <MonthSelect bare align="start" value={ym} onValue={onYm} min={min} max={max} marked={marked}
            className="group inline-flex items-center gap-1.5 rounded-lg text-left text-[32px] leading-10 sm:text-[36px] sm:leading-[44px]">
            <span className="font-semibold tracking-[-0.02em] text-ink">{nomeMes(ym)}</span>
            <span className="tnum font-semibold tracking-[-0.02em] text-slate-500">{ym.slice(0, 4)}</span>
            <ChevronDown size={18} className="mt-1 text-slate-500 transition-transform group-data-[state=open]:rotate-180" />
          </MonthSelect>
          <span className="inline-flex items-center" role="group" aria-label="Mês">
            <button type="button" aria-label="Mês anterior" className={seta} disabled={!!min && prev < min} onClick={() => onYm(prev)}>
              <ChevronLeft size={18} />
            </button>
            <button type="button" aria-label="Mês seguinte" className={seta} disabled={!!max && next > max} onClick={() => onYm(next)}>
              <ChevronRight size={18} />
            </button>
          </span>
          {troca && (
            <>
              <span className="mx-2 hidden h-7 w-px bg-[var(--color-line-strong)] sm:block" aria-hidden />
              {troca}
            </>
          )}
        </div>
      </div>
      {(resumo || actions) && (
        <div className="flex flex-wrap items-center gap-3">
          {resumo}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
    </header>
  );
}

// Selo do resumo ao lado das ações: verde = folga, vermelho = estouro.
export function SeloResumo({ tone = "neutro", children, className }) {
  const cor = tone === "pos" ? "bg-emerald-500/15 text-emerald-400"
    : tone === "neg" ? "bg-rose-500/15 text-rose-400"
    : "bg-veu/[0.06] text-slate-300";
  return (
    <span className={cn("tnum inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium", cor, className)}>
      {children}
    </span>
  );
}
