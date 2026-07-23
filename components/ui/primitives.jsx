// Small shared UI primitives. Kept in one file — they're tiny and cohesive.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const cx = (...c) => c.filter(Boolean).join(" ");

// ── Card ──────────────────────────────────────────────────────────────────
export function Card({ className, children, as: Tag = "div", ...rest }) {
  return (
    <Tag
      className={cx(
        "rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]",
        "shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_8px_24px_-12px_rgba(0,0,0,0.6)]",
        className
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

// ── Button ──────────────────────────────────────────────────────────────────
const VARIANTS = {
  primary: "bg-blue-600 hover:bg-blue-500 text-white",
  growth: "bg-emerald-600 hover:bg-emerald-500 text-white",
  ghost: "bg-white/5 hover:bg-white/10 text-slate-200",
  danger: "bg-rose-600/90 hover:bg-rose-600 text-white",
  outline: "border border-[var(--color-line)] hover:bg-white/5 text-slate-200",
};
export function Button({ variant = "primary", className, loading, children, disabled, ...rest }) {
  return (
    <button
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold",
        "transition-colors duration-150 cursor-pointer select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)]",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        VARIANTS[variant],
        className
      )}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }) {
  return (
    <span
      className={cx("inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white", className)}
      aria-hidden
    />
  );
}

// ── ProgressBar ──────────────────────────────────────────────────────────────
export function ProgressBar({ value = 0, fromClass = "from-blue-500", toClass = "to-blue-400", className }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={cx("h-2.5 w-full overflow-hidden rounded-full bg-white/8", className)}
         role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={cx("h-full rounded-full bg-gradient-to-r transition-[width] duration-500 ease-out", fromClass, toClass)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────
export function Badge({ children, className }) {
  return (
    <span className={cx("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium", className)}>
      {children}
    </span>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, children }) {
  const ref = useRef(null);
  // onClose costuma ser arrow inline (nova identidade a cada render). Guarda a
  // versão atual num ref pra NÃO re-rodar o efeito a cada keystroke do pai —
  // senão ref.current.focus() rouba o foco do input a cada letra digitada.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  // Portal p/ o body: evita <form> aninhado quando um Modal é renderizado
  // dentro do form de outro (ex: criar categoria dentro da despesa).
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-[fade_.15s_ease-out]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 w-full sm:max-w-md outline-none animate-[pop_.18s_ease-out]"
      >
        <div className="m-3 rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-2)] p-5 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white cursor-pointer transition-colors"
            >
              <X size={18} />
            </button>
          </div>
          {children}
        </div>
      </div>
      <style>{`
        @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.98) } to { opacity: 1; transform: none } }
      `}</style>
    </div>,
    document.body
  );
}

// ── Form fields ─────────────────────────────────────────────────────────────
export function Field({ label, hint, error, children, required }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-sm font-medium text-slate-300">
        {label}
        {required && <span className="text-rose-400">*</span>}
      </span>
      {children}
      {error ? (
        <span role="alert" className="mt-1 block text-xs text-rose-400">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

const inputBase =
  "w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-bg)] px-3.5 py-2.5 text-sm text-white " +
  "placeholder:text-slate-500 transition-colors focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30";

export function TextInput({ className, ...rest }) {
  return <input className={cx(inputBase, className)} {...rest} />;
}

export function Textarea({ className, rows = 2, ...rest }) {
  return <textarea rows={rows} className={cx(inputBase, "resize-y", className)} {...rest} />;
}

export function Select({ className, children, ...rest }) {
  return (
    <select className={cx(inputBase, "cursor-pointer", className)} {...rest}>
      {children}
    </select>
  );
}

// Percent input — mesma máscara de 2 casas do MoneyInput, sufixo "% a.a.".
export function PercentInput({ value, onValue, placeholder = "0,00", ...rest }) {
  const handle = (e) => {
    const digits = e.target.value.replace(/\D/g, "");
    onValue(digits ? Number(digits) / 100 : 0);
  };
  const display =
    value > 0
      ? value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "";
  return (
    <div className="relative">
      <input
        inputMode="numeric"
        className={cx(inputBase, "pr-16 tnum")}
        value={display}
        onChange={handle}
        placeholder={placeholder}
        {...rest}
      />
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">% a.a.</span>
    </div>
  );
}

// Money input — formats to BRL on the fly, returns number via onValue.
export function MoneyInput({ value, onValue, placeholder = "0,00", ...rest }) {
  const handle = (e) => {
    const digits = e.target.value.replace(/\D/g, "");
    onValue(digits ? Number(digits) / 100 : 0);
  };
  const display =
    value > 0
      ? value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "";
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-400">R$</span>
      <input
        inputMode="numeric"
        className={cx(inputBase, "pl-10 tnum")}
        value={display}
        onChange={handle}
        placeholder={placeholder}
        {...rest}
      />
    </div>
  );
}

// ── Donut (allocation overview) ─────────────────────────────────────────────
export function Donut({ segments, size = 168, stroke = 18, centerLabel, centerSub }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        {segments.map((s, i) => {
          const len = (s.value / total) * c;
          const dash = `${len} ${c - len}`;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              strokeLinecap="round"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      {(centerLabel || centerSub) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {centerSub && <span className="text-xs text-slate-400">{centerSub}</span>}
          {centerLabel && <span className="tnum text-xl font-bold text-white">{centerLabel}</span>}
        </div>
      )}
    </div>
  );
}
