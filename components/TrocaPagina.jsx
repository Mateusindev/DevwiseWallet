"use client";

// Trocador de página (espaço) — mora no cabeçalho do mês e vale pra app
// inteira, como trocar de perfil. Bolhas soltas: um clique troca; a seta abre
// o menu com o gasto de cada página no mês, ocultar/excluir a ativa,
// restaurar ocultas e criar nova. Os modais de confirmação moram aqui também.
import { useState } from "react";
import { Popover as RPopover } from "radix-ui";
import { Check, ChevronDown, EyeOff, Plus, Trash2, Undo2 } from "lucide-react";
import { Button, Modal, Spinner } from "./ui/primitives.jsx";
import { useAsync } from "./ui/useAsync.js";
import { EspacoModal } from "./forms.jsx";
import { useFinance } from "../store/FinanceContext.jsx";
import { useAuth } from "./AuthGate";
import * as api from "../services/financeApi";
import { espacosOcultosNoMes, espacosVisiveisNoMes } from "../lib/calc.js";
import { fmtMoneyCompact, fmtMonthLabel } from "../lib/format.js";
import { cn } from "@/lib/utils";

// ── peças ───────────────────────────────────────────────────────────────────
const rosto = (e) => e?.emoji || e?.nome?.slice(0, 1).toUpperCase() || "?";

function Bolha({ e, className, ...rest }) {
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-full bg-[var(--color-surface)] ring-1 ring-[var(--color-line-strong)]", className)} {...rest}>
      {rosto(e)}
    </span>
  );
}

const itemMenu = "flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors cursor-pointer";

export function TrocaPagina({ ym }) {
  const {
    espacos, espacosOcultos, activeEspacoId, orcamentoStatus, espacoPendente,
    setActiveEspaco, prefetchEspaco, ocultarEspacoMes, restaurarEspacoMes, removeEspaco,
  } = useFinance();
  const { can } = useAuth();
  const canEspaco = can("espaco:manage");
  const [open, setOpen] = useState(false);
  const [novoOpen, setNovoOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [confirmDelPerm, setConfirmDelPerm] = useState(null);
  const [busy, setBusy] = useState(false);

  const visiveis = espacosVisiveisNoMes(espacos, espacosOcultos, ym);
  const ocultas = espacosOcultosNoMes(espacos, espacosOcultos, ym);
  const ativoId = espacoPendente ?? activeEspacoId;
  const ativo = espacos.find((e) => e.id === ativoId);
  const loading = orcamentoStatus === "loading";
  const podeOcultar = canEspaco && visiveis.length > 1; // sempre sobra 1 no mês
  const podeExcluir = canEspaco && espacos.length > 1; // nunca zera

  // gasto do mês por página: o menu diz quanto cada perfil pesa
  const { dado: resumo } = useAsync(() => api.getResumoEspacos(ym), ["resumoEspacos", ym], { ativo: open && espacos.length > 0 });
  const gasto = Object.fromEntries((resumo?.espacos ?? []).map((x) => [x.espacoId, x.saiu]));

  const escolher = (id) => { setOpen(false); setActiveEspaco(id).catch(() => {}); };
  const pre = (id) => ({ onPointerEnter: () => prefetchEspaco(id), onFocus: () => prefetchEspaco(id) });

  if (!ativo) return null;

  const menu = (
    <RPopover.Portal>
      <RPopover.Content align="start" sideOffset={8}
        className="z-[70] w-72 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-[var(--sombra-flutua)] animate-[surge_.12s_ease-out]">
        <p className="px-2.5 pb-1 pt-1.5 text-[12px] font-medium text-slate-500">Trocar página · {fmtMonthLabel(ym)}</p>
        {visiveis.map((e) => {
          const sel = e.id === ativoId;
          return (
            <button key={e.id} type="button" onClick={() => escolher(e.id)} {...pre(e.id)}
              className={cn(itemMenu, sel ? "bg-veu/[0.05]" : "hover:bg-veu/[0.07]")}>
              <Bolha e={e} className="size-8 text-base" />
              <span className={cn("min-w-0 flex-1 truncate", sel ? "font-semibold text-ink" : "text-slate-200")}>{e.nome}</span>
              <span className="tnum text-[13px] text-slate-500">{resumo ? fmtMoneyCompact(gasto[e.id] || 0) : ""}</span>
              {sel && loading ? <Spinner className="h-3.5 w-3.5" /> : <Check size={15} className={sel ? "text-ink" : "invisible"} />}
            </button>
          );
        })}

        {canEspaco && ocultas.length > 0 && (
          <>
            <p className="px-2.5 pb-1 pt-2.5 text-[12px] font-medium text-slate-500">Ocultas neste mês</p>
            {ocultas.map((e) => (
              <button key={e.id} type="button" onClick={() => restaurarEspacoMes(e.id, ym)}
                className={cn(itemMenu, "text-slate-400 hover:bg-veu/[0.07]")}>
                <Bolha e={e} className="size-8 text-base opacity-50" />
                <span className="min-w-0 flex-1 truncate">{e.nome}</span>
                <Undo2 size={14} /> <span className="text-[13px]">Restaurar</span>
              </button>
            ))}
          </>
        )}

        {canEspaco && (
          <>
            <div className="my-1.5 h-px bg-[var(--color-line)]" />
            <button type="button" onClick={() => { setOpen(false); setNovoOpen(true); }} className={cn(itemMenu, "text-slate-200 hover:bg-veu/[0.07]")}>
              <span className="grid size-8 place-items-center rounded-full border border-dashed border-[var(--color-line-strong)]"><Plus size={15} /></span>
              Nova página
            </button>
            {podeOcultar && (
              <button type="button" onClick={() => { setOpen(false); setConfirmDel(ativo); }} className={cn(itemMenu, "text-slate-300 hover:bg-veu/[0.07]")}>
                <EyeOff size={15} className="mx-2 text-slate-500" /> Ocultar {ativo.nome} deste mês
              </button>
            )}
            {podeExcluir && (
              <button type="button" onClick={() => { setOpen(false); setConfirmDelPerm(ativo); }} className={cn(itemMenu, "text-rose-400 hover:bg-rose-500/10")}>
                <Trash2 size={15} className="mx-2" /> Excluir {ativo.nome}…
              </button>
            )}
          </>
        )}
      </RPopover.Content>
    </RPopover.Portal>
  );

  const giro = loading && <Spinner className="h-3.5 w-3.5" />;

  return (
    <>
      <RPopover.Root open={open} onOpenChange={setOpen}>
        <span className="flex items-center gap-1.5">
          {visiveis.map((e) => {
            const sel = e.id === ativoId;
            return (
              <button key={e.id} type="button" title={e.nome} aria-label={e.nome} aria-pressed={sel}
                onClick={() => escolher(e.id)} {...pre(e.id)}
                className={cn("rounded-full transition-all cursor-pointer", sel ? "" : "opacity-60 hover:opacity-100")}>
                <Bolha e={e} className={cn("size-9 text-lg", sel && "ring-2 ring-blue-500 ring-offset-2 ring-offset-[var(--color-bg)]")} />
              </button>
            );
          })}
          <RPopover.Trigger aria-label="Mais opções de página"
            className="group grid size-8 place-items-center rounded-full text-slate-400 transition-colors hover:bg-veu/[0.07] hover:text-ink cursor-pointer">
            {giro || <ChevronDown size={16} className="transition-transform group-data-[state=open]:rotate-180" />}
          </RPopover.Trigger>
        </span>
        {menu}
      </RPopover.Root>

      <EspacoModal open={novoOpen} onClose={() => setNovoOpen(false)} onCreated={(esp) => setActiveEspaco(esp.id)} />

      <Modal open={!!confirmDel} onClose={() => !busy && setConfirmDel(null)} title="Ocultar página do mês">
        {confirmDel && (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">
              Ocultar <b className="text-ink">{confirmDel.emoji} {confirmDel.nome}</b> só de <b className="text-ink">{fmtMonthLabel(ym)}</b>?
            </p>
            <p className="rounded-xl bg-veu/[0.04] px-3.5 py-3 text-[13px] text-slate-400">
              Some só deste mês. A página e os dados dela continuam nos outros meses — dá pra restaurar pelo mesmo menu.
            </p>
            <div className="flex gap-2 pt-1">
              <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => setConfirmDel(null)}>Cancelar</Button>
              <Button className="flex-1" loading={busy} onClick={async () => {
                setBusy(true);
                try { await ocultarEspacoMes(confirmDel.id, ym); setConfirmDel(null); } finally { setBusy(false); }
              }}>
                <EyeOff size={15} /> Ocultar do mês
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!confirmDelPerm} onClose={() => !busy && setConfirmDelPerm(null)} title="Excluir página permanentemente">
        {confirmDelPerm && (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">
              Excluir <b className="text-ink">{confirmDelPerm.emoji} {confirmDelPerm.nome}</b> de vez?
            </p>
            <p className="rounded-xl border border-rose-400/25 bg-rose-500/[0.07] px-3.5 py-3 text-[13px] text-rose-300">
              Apaga o espaço e <b>todos os dados dele em todos os meses</b> — despesas fixas, despesas do mês,
              receitas e renda. Não dá pra desfazer. As caixinhas (economias) são compartilhadas e não são afetadas.
            </p>
            <div className="flex gap-2 pt-1">
              <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => setConfirmDelPerm(null)}>Cancelar</Button>
              <Button variant="danger" className="flex-1" loading={busy} onClick={async () => {
                setBusy(true);
                try { await removeEspaco(confirmDelPerm.id); setConfirmDelPerm(null); } finally { setBusy(false); }
              }}>
                <Trash2 size={15} /> Excluir de vez
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
