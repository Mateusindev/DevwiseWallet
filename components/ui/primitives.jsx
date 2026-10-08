// Small shared UI primitives. Kept in one file — they're tiny and cohesive.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

const cx = (...c) => c.filter(Boolean).join(" ");

// ── Card ──────────────────────────────────────────────────────────────────
export function Card({ className, children, as: Tag = "div", ...rest }) {
  return (
    <Tag
      className={cx(
        "rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)]",
        "shadow-[var(--sombra-card)]",
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
  ghost: "bg-veu/5 hover:bg-veu/10 text-slate-200",
  danger: "bg-rose-600/90 hover:bg-rose-600 text-white",
  outline: "border border-[var(--color-line)] hover:bg-veu/5 text-slate-200",
};
// ── Pendência automática do clique ──────────────────────────────────────────
// Se o `onClick` devolve Promise, o botão se desabilita até ela resolver. É o
// que impede clique repetido em ação lenta — o sintoma era criar oito contatos
// iguais numa fila de requests, porque o dispatcher de Server Actions é serial
// e nada na tela dizia que estava indo.
//
// Botão `type="submit"` NÃO passa por aqui (quem submete é o form): esses
// recebem `loading={submitting}` do useFormState.
export function usePendenteDoClique(onClick) {
  const [pendente, setPendente] = useState(false);
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);

  if (!onClick) return [false, undefined];
  const clique = (e) => {
    const r = onClick(e);
    if (!r || typeof r.then !== "function") return r;
    setPendente(true);
    const solta = () => { if (vivo.current) setPendente(false); };
    // rejeição segue propagando (quem chamou é que trata / loga) — aqui só
    // liberamos o botão.
    return r.then(
      (v) => { solta(); return v; },
      (err) => { solta(); throw err; }
    );
  };
  return [pendente, clique];
}

export function Button({ variant = "primary", className, loading, children, disabled, onClick, ...rest }) {
  const [pendente, clique] = usePendenteDoClique(onClick);
  const ocupado = disabled || loading || pendente;
  return (
    <button
      disabled={ocupado}
      onClick={clique}
      aria-busy={loading || pendente ? true : undefined}
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
      {(loading || pendente) && <Spinner />}
      {children}
    </button>
  );
}

// Botão só-ícone (lixeira, sincronizar) com a MESMA pendência automática do
// Button: eram esses os cliques que ninguém segurava.
export function IconButton({ className, tone = "neutral", children, onClick, disabled, ...rest }) {
  const [pendente, clique] = usePendenteDoClique(onClick);
  const tons = {
    neutral: "text-slate-500 hover:bg-veu/10 hover:text-slate-200",
    danger: "text-slate-500 hover:bg-rose-500/15 hover:text-rose-400",
  };
  return (
    <button
      onClick={clique}
      disabled={disabled || pendente}
      aria-busy={pendente ? true : undefined}
      className={cx(
        "shrink-0 rounded-lg p-1.5 transition-colors cursor-pointer",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        tons[tone] ?? tons.neutral,
        className
      )}
      {...rest}
    >
      {pendente ? <Spinner className="h-3.5 w-3.5 border-slate-400/40 border-t-slate-200" /> : children}
    </button>
  );
}

export function Spinner({ className }) {
  return (
    <span
      className={cx("inline-block h-4 w-4 animate-spin rounded-full border-2 border-veu/30 border-t-white", className)}
      aria-hidden
    />
  );
}

// ── Skeleton ────────────────────────────────────────────────────────────────
// Bloco cinza no lugar do conteúdo que está vindo. Serve pra tela nunca ficar
// vazia (nem "pronta e errada") enquanto a leitura acontece — o app tem ida ao
// banco fora da máquina, então esse intervalo é sempre visível.
export function Skeleton({ className, rounded = "rounded-lg", style }) {
  return <span aria-hidden style={style} className={cx("skel block", rounded, className)} />;
}

// N linhas de texto fantasma; a última sai mais curta (parece parágrafo).
export function SkeletonLines({ lines = 3, className }) {
  return (
    <div className={cx("space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx("h-3.5", i === lines - 1 ? "w-2/5" : "w-full")} />
      ))}
    </div>
  );
}

// Lista de itens (linha de contato, linha de despesa, card de cartão).
export function SkeletonList({ rows = 3, height = "h-14", className, label = "Carregando…" }) {
  return (
    <div className={cx("space-y-2", className)} role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cx(height, "w-full rounded-xl")} />
      ))}
    </div>
  );
}

// Placeholder de gráfico: barras de altura variada, não um retângulo chapado —
// o formato já diz que ali vai nascer um gráfico.
const ALTURAS_SKEL = [0.55, 0.8, 0.42, 0.95, 0.62, 0.75, 0.5, 0.85, 0.68, 0.9, 0.46, 0.72];
export function SkeletonChart({ height = 168, bars = 8, className }) {
  return (
    <div className={cx("flex items-end gap-2", className)} style={{ height }}
         role="status" aria-label="Carregando gráfico">
      {Array.from({ length: bars }, (_, i) => (
        <Skeleton key={i} className="flex-1 rounded-t-md"
                  style={{ height: `${ALTURAS_SKEL[i % ALTURAS_SKEL.length] * 100}%` }} />
      ))}
    </div>
  );
}

// ── ProgressBar ──────────────────────────────────────────────────────────────
export function ProgressBar({ value = 0, fromClass = "from-blue-500", toClass = "to-blue-400", className }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={cx("h-2.5 w-full overflow-hidden rounded-full bg-veu/8", className)}
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
        {/* Coluna com altura travada no viewport: cabeçalho fixo + corpo rolável.
            Sem isso, form que cresce (ex: "Compra parcelada" aparece ao escolher
            cartão) empurra os campos e os botões pra fora da tela no celular —
            e o scroll do body está bloqueado enquanto o modal está aberto. */}
        <div className="modal-card m-3 flex flex-col rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface-2)] shadow-2xl">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
            <h2 className="text-lg font-semibold text-ink">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="-mr-1.5 shrink-0 rounded-lg p-2 text-slate-400 hover:bg-veu/10 hover:text-ink cursor-pointer transition-colors"
            >
              <X size={18} />
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain p-5">{children}</div>
        </div>
      </div>
      <style>{`
        @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.98) } to { opacity: 1; transform: none } }
        .modal-card { max-height: calc(100vh - 1.5rem) }
        /* dvh acompanha a barra do navegador/teclado no mobile */
        @supports (height: 100dvh) { .modal-card { max-height: calc(100dvh - 1.5rem) } }
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

// text-base no mobile de propósito: com fonte < 16px o Safari/iOS dá zoom ao
// focar o campo e o layout do modal "salta". Volta pra text-sm no desktop.
export const inputBase =
  "w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-bg)] px-3.5 py-2.5 text-base sm:text-sm text-ink " +
  "placeholder:text-slate-500 transition-colors focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-500/30";

export function TextInput({ className, ...rest }) {
  return <input className={cx(inputBase, className)} {...rest} />;
}

export function Textarea({ className, rows = 2, ...rest }) {
  return <textarea rows={rows} className={cx(inputBase, "resize-y", className)} {...rest} />;
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
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-trilho)" strokeWidth={stroke} />
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
          {centerLabel && <span className="tnum text-xl font-bold text-ink">{centerLabel}</span>}
        </div>
      )}
    </div>
  );
}
