// Controles de formulário próprios (Radix + tema escuro). Ficam fora de
// `primitives.jsx` porque têm portal, estado de abertura e navegação por
// teclado — nada "tiny and cohesive".
import { useMemo, useState } from "react";
import * as RSelect from "@radix-ui/react-select";
import * as RCheckbox from "@radix-ui/react-checkbox";
import * as RPopover from "@radix-ui/react-popover";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CalendarDays } from "lucide-react";
import { inputBase } from "./primitives.jsx";
import { MESES, MESES_ABBR, addMonths, currentMonthKey, fmtDate, fmtMonthLabel, todayISO } from "../../lib/format.js";

const cx = (...c) => c.filter(Boolean).join(" ");

// Radix não aceita item com value "" (reservado pra "sem valor"). Os forms usam
// "" como "sem categoria/sem cartão", então codifica na fronteira do Radix.
const EMPTY = "__empty__";
const enc = (v) => (v === "" || v == null ? EMPTY : v);
const dec = (v) => (v === EMPTY ? "" : v);

// Camada flutuante (dropdown/popover): z acima do Modal (z-50) e do popover de
// pagamento das fixas (z-61).
const layer =
  "z-[70] overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] shadow-2xl";

// ── FormError ───────────────────────────────────────────────────────────────
// Banner de topo do formulário. Renderiza sempre que existir mensagem — é o
// que impede erro silencioso quando a falha não pertence a nenhum campo.
export function FormError({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-xl bg-rose-500/10 px-3.5 py-3 text-sm text-rose-300 ring-1 ring-rose-500/30">
      {children}
    </p>
  );
}

// ── Select ──────────────────────────────────────────────────────────────────
// Composição (não `options={[]}`) pra preservar label rica: cor, emoji,
// "— saldo R$ x", "3/10".
export function Select({ value, onValue, placeholder, disabled, className, children, ...rest }) {
  return (
    <RSelect.Root value={enc(value)} onValueChange={(v) => onValue(dec(v))} disabled={disabled}>
      <RSelect.Trigger
        className={cx(inputBase, "flex cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50", className)}
        {...rest}
      >
        <span className="truncate"><RSelect.Value placeholder={placeholder} /></span>
        <RSelect.Icon className="shrink-0 text-slate-400"><ChevronDown size={16} /></RSelect.Icon>
      </RSelect.Trigger>
      {/* Portal obrigatório: sem ele o popup é clipado pelo overflow-y-auto do Modal. */}
      <RSelect.Portal>
        <RSelect.Content position="popper" sideOffset={6} className={cx(layer, "max-h-[min(20rem,60vh)] w-[var(--radix-select-trigger-width)]")}>
          <RSelect.ScrollUpButton className="flex h-6 items-center justify-center text-slate-400">
            <ChevronUp size={14} />
          </RSelect.ScrollUpButton>
          <RSelect.Viewport className="p-1">{children}</RSelect.Viewport>
          <RSelect.ScrollDownButton className="flex h-6 items-center justify-center text-slate-400">
            <ChevronDown size={14} />
          </RSelect.ScrollDownButton>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}

export function SelectItem({ value, disabled, className, children }) {
  return (
    <RSelect.Item
      value={enc(value)}
      disabled={disabled}
      className={cx(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-lg py-2 pl-3 pr-8 text-base sm:text-sm text-slate-200 outline-none",
        "data-[highlighted]:bg-veu/10 data-[highlighted]:text-ink data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed",
        className
      )}
    >
      <RSelect.ItemText>{children}</RSelect.ItemText>
      <RSelect.ItemIndicator className="absolute right-2.5 text-blue-400"><Check size={15} /></RSelect.ItemIndicator>
    </RSelect.Item>
  );
}

// ── Checkbox ────────────────────────────────────────────────────────────────
export function Checkbox({ checked, onChecked, disabled, className, ...rest }) {
  const indeterminate = checked === "indeterminate";
  return (
    <RCheckbox.Root
      checked={indeterminate ? "indeterminate" : !!checked}
      onCheckedChange={(v) => onChecked(!!v)}
      disabled={disabled}
      className={cx(
        "grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded-md border border-veu/20 bg-transparent transition-colors",
        "data-[state=checked]:border-blue-500 data-[state=checked]:bg-blue-500 data-[state=indeterminate]:border-blue-500 data-[state=indeterminate]:bg-blue-500",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...rest}
    >
      <RCheckbox.Indicator className="text-white">
        {indeterminate ? <span className="block h-0.5 w-2.5 rounded bg-white" /> : <Check size={14} strokeWidth={3} />}
      </RCheckbox.Indicator>
    </RCheckbox.Root>
  );
}

export function CheckboxField({ label, hint, checked, onChecked, disabled, className }) {
  return (
    <label className={cx("flex cursor-pointer items-center gap-3 text-sm font-medium text-slate-200", className)}>
      <Checkbox checked={checked} onChecked={onChecked} disabled={disabled} />
      <span>
        {label}
        {hint && <span className="mt-0.5 block text-xs font-normal text-slate-500">{hint}</span>}
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
              "min-w-8 rounded-lg px-2 py-1 text-xs font-semibold cursor-pointer transition-colors",
              Number(value) === d ? "bg-blue-500/20 text-blue-200 ring-1 ring-blue-500/40" : "bg-veu/5 text-slate-400 hover:bg-veu/10"
            )}
          >
            {d}
          </button>
        ))}
      </div>
      {suggestion != null && Number(value) !== Number(suggestion) && (
        <button type="button" onClick={() => onValue(suggestion)}
                className="text-xs font-medium text-blue-400 hover:text-blue-300 cursor-pointer">
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
    <RPopover.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) setAno(Number((value || current).slice(0, 4))); }}>
      <RPopover.Trigger
        className={cx(
          "inline-flex items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2 text-sm text-ink cursor-pointer",
          "transition-colors hover:bg-veu/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30",
          className
        )}
      >
        {fmtMonthLabel(value)}
        <ChevronDown size={15} className="text-slate-400" />
      </RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content sideOffset={6} align="end" className={cx(layer, "w-64 p-3")}>
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
                    "relative rounded-lg py-2 text-xs font-semibold cursor-pointer transition-colors",
                    sel ? "bg-blue-500 text-white"
                        : k === current ? "bg-veu/5 text-blue-300 ring-1 ring-blue-500/40 hover:bg-veu/10"
                        : "bg-veu/5 text-slate-300 hover:bg-veu/10",
                    "disabled:opacity-25 disabled:cursor-not-allowed"
                  )}
                >
                  {rot}
                  {marked?.has(k) && (
                    <span className={cx("absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full", sel ? "bg-white" : "bg-blue-400")} />
                  )}
                </button>
              );
            })}
          </div>
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

// Setas ‹ › ao lado do seletor — trocar de mês é o gesto mais usado, não vale
// abrir o popover pra isso.
export function MonthStepper({ value, onValue, min, max, marked, current, className }) {
  const prev = addMonths(value, -1);
  const next = addMonths(value, 1);
  const btn = "rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-2 text-slate-300 cursor-pointer transition-colors hover:bg-veu/5 disabled:opacity-30 disabled:cursor-not-allowed";
  return (
    <div className={cx("flex items-center gap-1.5", className)}>
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
    <RPopover.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) setVisto(base); }}>
      <RPopover.Trigger
        name={name}
        disabled={disabled}
        className={cx(inputBase, "flex cursor-pointer items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50", className)}
      >
        <span className={value ? "tnum" : "text-slate-500"}>{value ? fmtDate(value) : "dd/mm/aaaa"}</span>
        <CalendarDays size={16} className="shrink-0 text-slate-400" />
      </RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content sideOffset={6} align="start" className={cx(layer, "w-72 p-3")}>
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
              <span key={i} className="py-1 text-[11px] font-semibold text-slate-500">{d}</span>
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
                    sel ? "bg-blue-500 font-semibold text-white"
                        : k === hoje ? "text-blue-300 ring-1 ring-blue-500/40 hover:bg-veu/10"
                        : "text-slate-300 hover:bg-veu/10",
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
                    className="mt-2 w-full rounded-lg bg-veu/5 py-2 text-xs font-semibold text-slate-300 hover:bg-veu/10 cursor-pointer">
              hoje
            </button>
          )}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}
