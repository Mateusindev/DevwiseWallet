// Controles de formulário da casa sobre os componentes shadcn (Select,
// Checkbox, Popover em `components/ui/*.tsx`). Ficam fora de `primitives.jsx`
// porque têm portal, estado de abertura e navegação por teclado — nada "tiny
// and cohesive". A API (`onValue`, `onChecked`, "" como "sem valor") é a que as
// telas já usam.
import { useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputBase } from "./primitives.jsx";
import { Select as SelectUI, SelectContent, SelectItem as SelectItemUI, SelectTrigger, SelectValue } from "./select";
import { Checkbox as CheckboxUI } from "./checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { MESES, MESES_ABBR, addMonths, currentMonthKey, fmtDate, fmtMonthLabel, todayISO } from "../../lib/format.js";

const cx = cn;

// Radix não aceita item com value "" (reservado pra "sem valor"). Os forms usam
// "" como "sem categoria/sem cartão", então codifica na fronteira do Radix.
const EMPTY = "__empty__";
const enc = (v) => (v === "" || v == null ? EMPTY : v);
const dec = (v) => (v === EMPTY ? "" : v);

// Camadas flutuantes (popover/select) ficam em z-[70] no próprio componente
// shadcn: acima do Modal (z-50) e do popover de pagamento das fixas (z-61).

// ── FormError ───────────────────────────────────────────────────────────────
// Banner de topo do formulário. Renderiza sempre que existir mensagem — é o
// que impede erro silencioso quando a falha não pertence a nenhum campo.
export function FormError({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3.5 py-3 text-sm text-rose-300">
      {children}
    </p>
  );
}

// ── Select ──────────────────────────────────────────────────────────────────
// Composição (não `options={[]}`) pra preservar label rica: cor, emoji,
// "— saldo R$ x", "3/10".
export function Select({ value, onValue, placeholder, disabled, className, children, ...rest }) {
  return (
    <SelectUI value={enc(value)} onValueChange={(v) => onValue(dec(v))} disabled={disabled}>
      <SelectTrigger
        className={cx(inputBase, "cursor-pointer text-left data-[placeholder]:text-slate-500 [&_svg:not([class*='text-'])]:text-slate-500", className)}
        {...rest}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      {/* O SelectContent do shadcn já porta pro body: sem isso o popup é
          clipado pelo overflow-y-auto do Modal. */}
      <SelectContent position="popper" sideOffset={6} className="max-h-[min(20rem,60vh)] w-[var(--radix-select-trigger-width)]">
        {children}
      </SelectContent>
    </SelectUI>
  );
}

export function SelectItem({ value, disabled, className, children }) {
  return (
    <SelectItemUI
      value={enc(value)}
      disabled={disabled}
      className={cx("text-slate-200 focus:text-ink data-[state=checked]:font-medium data-[state=checked]:text-ink", className)}
    >
      {children}
    </SelectItemUI>
  );
}

// ── Checkbox ────────────────────────────────────────────────────────────────
export function Checkbox({ checked, onChecked, disabled, className, ...rest }) {
  return (
    <CheckboxUI
      checked={checked === "indeterminate" ? "indeterminate" : !!checked}
      onCheckedChange={(v) => onChecked(!!v)}
      disabled={disabled}
      className={className}
      {...rest}
    />
  );
}

export function CheckboxField({ label, hint, checked, onChecked, disabled, className }) {
  return (
    <label className={cx("flex cursor-pointer items-start gap-3 text-sm font-medium text-slate-200 [&>button]:mt-0.5", className)}>
      <Checkbox checked={checked} onChecked={onChecked} disabled={disabled} />
      <span>
        {label}
        {hint && <span className="mt-0.5 block text-[13px] font-normal text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

// ── NumberInput ─────────────────────────────────────────────────────────────
// Nunca emite string: `number` ou `null`. Clampa no blur — clampar a cada tecla
// impediria digitar "1" antes do "5" num campo com min 10.
export function NumberInput({ value, onValue, min, max, allowEmpty = false, className, onBlur, ...rest }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  // Reflete mudança externa (reset do form, sugestão vinda de outro campo) sem
  // atropelar o que está sendo digitado: só reescreve o texto quando o número
  // que ele representa deixou de bater com o `value` que veio de fora.
  const [visto, setVisto] = useState(value);
  if (visto !== value) {
    setVisto(value);
    if (text === "" ? value != null : Number(text) !== value) setText(value == null ? "" : String(value));
  }

  const handle = (e) => {
    const digits = e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    setText(digits);
    onValue(digits === "" ? null : Number(digits));
  };
  const blur = (e) => {
    if (text === "") {
      if (!allowEmpty && min != null) { setText(String(min)); onValue(min); }
    } else {
      let n = Number(text);
      if (min != null && n < min) n = min;
      if (max != null && n > max) n = max;
      setText(String(n));
      onValue(n);
    }
    onBlur?.(e);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className={cx(inputBase, "tnum", className)}
      value={text}
      onChange={handle}
      onBlur={blur}
      {...rest}
    />
  );
}

// ── DayInput ────────────────────────────────────────────────────────────────
const DIAS_RAPIDOS = [1, 5, 10, 15, 20, 25];
export function DayInput({ value, onValue, allowEmpty = false, suggestion, className, ...rest }) {
  return (
    <div className="space-y-2">
      <NumberInput value={value} onValue={onValue} min={1} max={31} allowEmpty={allowEmpty} className={className} {...rest} />
      <div className="flex flex-wrap gap-1.5">
        {DIAS_RAPIDOS.map((d) => (
          <button
            key={d} type="button" onClick={() => onValue(d)}
            className={cx(
              "tnum h-8 min-w-9 rounded-lg px-2 text-[13px] font-medium cursor-pointer transition-colors",
              Number(value) === d ? "bg-ink text-[var(--color-on-ink)]" : "bg-veu/[0.06] text-slate-400 hover:bg-veu/10 hover:text-ink"
            )}
          >
            {d}
          </button>
        ))}
      </div>
      {suggestion != null && Number(value) !== Number(suggestion) && (
        <button type="button" onClick={() => onValue(suggestion)}
                className="text-[13px] font-medium text-blue-400 hover:text-blue-300 cursor-pointer">
          sugerido: dia {suggestion}
        </button>
      )}
    </div>
  );
}

// ── MonthSelect ─────────────────────────────────────────────────────────────
export function MonthSelect({ value, onValue, min, max, marked, current = currentMonthKey(), className }) {
  const [open, setOpen] = useState(false);
  const [ano, setAno] = useState(() => Number((value || current).slice(0, 4)));
  const ym = (a, m) => `${a}-${String(m + 1).padStart(2, "0")}`;
  const fora = (k) => (min && k < min) || (max && k > max);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setAno(Number((value || current).slice(0, 4))); }}>
      <PopoverTrigger
        className={cx(
          "inline-flex h-10 min-w-[11.5rem] items-center justify-between gap-2 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3.5 text-sm font-medium text-ink cursor-pointer",
          "transition-colors hover:bg-veu/[0.05]",
          className
        )}
      >
        {fmtMonthLabel(value)}
        <ChevronDown size={15} className="text-slate-500" />
      </PopoverTrigger>
      <PopoverContent sideOffset={6} align="end" className="w-64 p-3">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Ano anterior" onClick={() => setAno(ano - 1)}
                    disabled={!!min && ym(ano - 1, 11) < min}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-veu/10 hover:text-ink cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
              <ChevronLeft size={16} />
            </button>
            <span className="tnum text-sm font-semibold text-ink">{ano}</span>
            <button type="button" aria-label="Ano seguinte" onClick={() => setAno(ano + 1)}
                    disabled={!!max && ym(ano + 1, 0) > max}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-veu/10 hover:text-ink cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {MESES_ABBR.map((rot, i) => {
              const k = ym(ano, i);
              const sel = k === value;
              return (
                <button
                  key={k} type="button" disabled={fora(k)}
                  aria-label={fmtMonthLabel(k)}
                  onClick={() => { onValue(k); setOpen(false); }}
                  className={cx(
                    "relative h-10 rounded-lg text-[13px] font-medium capitalize cursor-pointer transition-colors",
                    sel ? "bg-ink text-[var(--color-on-ink)]"
                        : k === current ? "text-blue-400 ring-1 ring-inset ring-blue-500/50 hover:bg-veu/[0.07]"
                        : "text-slate-300 hover:bg-veu/[0.07]",
                    "disabled:opacity-25 disabled:cursor-not-allowed"
                  )}
                >
                  {rot}
                  {marked?.has(k) && (
                    <span className={cx("absolute bottom-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full", sel ? "bg-[var(--color-on-ink)]" : "bg-blue-400")} />
                  )}
                </button>
              );
            })}
          </div>
      </PopoverContent>
    </Popover>
  );
}

// Setas ‹ › ao lado do seletor — trocar de mês é o gesto mais usado, não vale
// abrir o popover pra isso.
export function MonthStepper({ value, onValue, min, max, marked, current, className }) {
  const prev = addMonths(value, -1);
  const next = addMonths(value, 1);
  const btn = "grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] text-slate-300 cursor-pointer transition-colors hover:bg-veu/[0.05] hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed";
  return (
    <div className={cx("flex items-center gap-1.5", className)} role="group" aria-label="Mês">
      <button type="button" aria-label="Mês anterior" onClick={() => onValue(prev)} disabled={!!min && prev < min} className={btn}>
        <ChevronLeft size={16} />
      </button>
      <MonthSelect value={value} onValue={onValue} min={min} max={max} marked={marked} current={current} />
      <button type="button" aria-label="Mês seguinte" onClick={() => onValue(next)} disabled={!!max && next > max} className={btn}>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

// ── DateInput ───────────────────────────────────────────────────────────────
// Tudo em UTC: `new Date("2026-09-01")` local vira 31/08 em fuso negativo.
const diasNoMes = (ano, mes) => new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
const primeiroDiaSemana = (ano, mes) => new Date(Date.UTC(ano, mes, 1)).getUTCDay();
const SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

export function DateInput({ value, onValue, min, max, month, className, disabled, name }) {
  const [open, setOpen] = useState(false);
  const base = month || (value || todayISO()).slice(0, 7);
  const [visto, setVisto] = useState(base);
  const mesVisto = month || visto;
  const [ano, mes] = useMemo(() => mesVisto.split("-").map(Number), [mesVisto]);

  const hoje = todayISO();
  const dias = diasNoMes(ano, mes - 1);
  const offset = primeiroDiaSemana(ano, mes - 1);
  const iso = (d) => `${mesVisto}-${String(d).padStart(2, "0")}`;
  const fora = (k) => (min && k < min) || (max && k > max);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setVisto(base); }}>
      <PopoverTrigger
        name={name}
        disabled={disabled}
        className={cx(inputBase, "flex cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50", className)}
      >
        <span className={value ? "tnum" : "text-slate-500"}>{value ? fmtDate(value) : "dd/mm/aaaa"}</span>
        <CalendarDays size={16} className="shrink-0 text-slate-400" />
      </PopoverTrigger>
      <PopoverContent sideOffset={6} align="start" className="w-72 p-3">
          <div className="mb-2 flex items-center justify-between">
            {/* `month` travado (despesa/receita do mês): esconde a navegação em
                vez de deixar sair do mês e a linha "desaparecer" da lista. */}
            <button type="button" aria-label="Mês anterior" onClick={() => setVisto(addMonths(mesVisto, -1))}
                    disabled={!!month}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-veu/10 hover:text-ink cursor-pointer disabled:invisible">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold text-ink">{MESES[mes - 1]} de {ano}</span>
            <button type="button" aria-label="Mês seguinte" onClick={() => setVisto(addMonths(mesVisto, 1))}
                    disabled={!!month}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-veu/10 hover:text-ink cursor-pointer disabled:invisible">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {SEMANA.map((d, i) => (
              <span key={i} className="py-1 text-xs font-medium text-slate-500">{d}</span>
            ))}
            {Array.from({ length: offset }, (_, i) => <span key={`v${i}`} />)}
            {Array.from({ length: dias }, (_, i) => {
              const d = i + 1;
              const k = iso(d);
              const sel = k === value;
              return (
                <button
                  key={k} type="button" disabled={fora(k)}
                  onClick={() => { onValue(k); setOpen(false); }}
                  className={cx(
                    "tnum grid h-9 place-items-center rounded-lg text-sm cursor-pointer transition-colors",
                    sel ? "bg-ink font-semibold text-[var(--color-on-ink)]"
                        : k === hoje ? "text-blue-400 ring-1 ring-inset ring-blue-500/50 hover:bg-veu/[0.07]"
                        : "text-slate-300 hover:bg-veu/[0.07]",
                    "disabled:opacity-25 disabled:cursor-not-allowed"
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
          {!fora(hoje) && (!month || hoje.slice(0, 7) === month) && (
            <button type="button" onClick={() => { onValue(hoje); setOpen(false); }}
                    className="mt-2 h-9 w-full rounded-lg bg-veu/[0.06] text-[13px] font-medium text-slate-300 hover:bg-veu/10 hover:text-ink cursor-pointer">
              hoje
            </button>
          )}
      </PopoverContent>
    </Popover>
  );
}
