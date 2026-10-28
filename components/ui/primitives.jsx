// Small shared UI primitives. Kept in one file — they're tiny and cohesive.
//
// A base é shadcn/ui (`components/ui/*.tsx`, copiado pelo CLI e ajustado ao
// sistema visual): o que mora AQUI é a API que as telas já usam — variantes
// com nome da casa (`primary`, `danger`), `size="md"`, pendência automática do
// clique, `Modal` controlado por `open`/`onClose`. As telas não importam o
// shadcn direto; trocar a base não pede tocar em tela nenhuma.
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

const cx = cn;

// ── Card ──────────────────────────────────────────────────────────────────
// Superfície chapada: borda de 1px, sem sombra em repouso. Raio grande (20px)
// só no cartão; dentro dele os raios descem (10 → 8 → 6).
export function Card({ className, children, as: Tag = "div", ...rest }) {
  return (
    <Tag
      data-slot="card"
      className={cx("min-w-0 rounded-2xl border bg-card text-card-foreground", className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

// Cabeçalho de cartão: título (16/600) + descrição cinza + ação à direita.
// O título é `h3` por padrão: as seções da tela são `h2`.
export function CardHeader({ title, description, action, as: Tag = "h3", className }) {
  return (
    <div className={cx("flex flex-wrap items-start justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <Tag className="text-[15px] font-semibold leading-6 text-ink">{title}</Tag>
        {description && <p className="mt-0.5 text-[13px] leading-5 text-slate-500">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

// ── Page / section headers ──────────────────────────────────────────────────
// Um h1 por tela, substantivo (não saudação), com a frase do dado embaixo e as
// ações reais à direita. Mesmo componente em todas as rotas: é o que dá à app
// uma borda esquerda só, do título até a última linha.
export function PageHeader({ title, description, actions, children, className }) {
  return (
    <header className={cx("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.015em] text-ink sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-400">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function SectionHeader({ title, description, actions, className, id }) {
  return (
    <div className={cx("flex flex-wrap items-end justify-between gap-x-4 gap-y-2", className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-lg font-semibold leading-7 text-ink">{title}</h2>
        {description && <p className="text-[13px] text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// Estado vazio: o quadro continua, uma frase diz o que falta e (quando há)
// a ação que preenche fica onde o dado vai aparecer.
export function EmptyState({ title, description, action, className, compact }) {
  return (
    <div className={cx(
      "flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[var(--color-line-strong)] px-5 text-center",
      compact ? "py-6" : "py-10",
      className
    )}>
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {description && <p className="max-w-sm text-[13px] text-slate-500">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

// Valor rotulado (rótulo cinza em cima, número em tinta embaixo). Sem ícone,
// sem tile: o número é a informação.
export function Stat({ label, value, sub, tone, size = "md", className }) {
  const cor = tone === "pos" ? "text-emerald-400" : tone === "neg" ? "text-rose-400" : "text-ink";
  const tam = size === "lg" ? "text-[32px] leading-10 tracking-[-0.02em]" : size === "sm" ? "text-base" : "text-xl";
  return (
    <div className={cx("min-w-0", className)}>
      <p className="text-[13px] text-slate-500">{label}</p>
      <p className={cx("tnum font-semibold", tam, cor)}>{value}</p>
      {sub && <p className="mt-0.5 text-[13px] text-slate-500">{sub}</p>}
    </div>
  );
}

// ── Button ──────────────────────────────────────────────────────────────────
// Variantes vêm do `buttonVariants` do shadcn (`components/ui/button.tsx`).
// primary = tinta (quase-preto no claro, quase-branco no escuro): uma por tela.
// growth/danger-soft são tons pálidos com tinta do mesmo matiz — cor diz o que
// a ação faz, não "isto é um botão". Os nomes antigos são traduzidos aqui.
const VARIANTE = { primary: "default", danger: "destructive", "danger-soft": "destructive-soft" };
const TAMANHO = { md: "default" };
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

export const buttonClass = (variant = "primary", size = "md", className) =>
  cx(buttonVariants({ variant: VARIANTE[variant] ?? variant, size: TAMANHO[size] ?? size }), className);

export function Button({ variant = "primary", size = "md", className, loading, children, disabled, onClick, ...rest }) {
  const [pendente, clique] = usePendenteDoClique(onClick);
  const ocupado = disabled || loading || pendente;
  return (
    <button
      data-slot="button"
      disabled={ocupado}
      onClick={clique}
      aria-busy={loading || pendente ? true : undefined}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {(loading || pendente) && <Spinner />}
      {children}
    </button>
  );
}

// Botão só-ícone (lixeira, sincronizar) com a MESMA pendência automática do
// Button: eram esses os cliques que ninguém segurava. A área de toque cresce
// além do desenho (`before:`) pra chegar nos 40px sem inflar a linha.
export function IconButton({ className, tone = "neutral", children, onClick, disabled, ...rest }) {
  const [pendente, clique] = usePendenteDoClique(onClick);
  const tons = {
    neutral: "text-slate-500 hover:bg-accent hover:text-ink",
    danger: "text-slate-500 hover:bg-rose-500/12 hover:text-rose-400",
  };
  return (
    <button
      onClick={clique}
      disabled={disabled || pendente}
      aria-busy={pendente ? true : undefined}
      className={cx(
        "relative grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors cursor-pointer",
        "before:absolute before:-inset-1 before:content-['']",
        "disabled:cursor-not-allowed disabled:opacity-45",
        tons[tone] ?? tons.neutral,
        className
      )}
      {...rest}
    >
      {pendente ? <Spinner className="h-3.5 w-3.5" /> : children}
    </button>
  );
}

// Herda a cor do texto: serve em botão de tinta, pálido ou transparente.
export function Spinner({ className }) {
  return (
    <span
      className={cx("inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent opacity-80", className)}
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
    <div className={cx("space-y-2.5", className)}>
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
        <Skeleton key={i} className="flex-1 rounded-t-md rounded-b-none"
                  style={{ height: `${ALTURAS_SKEL[i % ALTURAS_SKEL.length] * 100}%` }} />
      ))}
    </div>
  );
}

// ── ProgressBar ──────────────────────────────────────────────────────────────
// Preenchimento chapado na razão verdadeira (sem gradiente, sem toco no zero).
// `color` (CSS) ou `barClass`; `fromClass` ("from-emerald-500") segue aceito
// pelos chamadores antigos e vira o `bg-` do mesmo tom.
export function ProgressBar({ value = 0, color, barClass, fromClass, className, label }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const fill = barClass ?? (fromClass ? fromClass.replace(/^from-/, "bg-") : "bg-blue-500");
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-trilho)]", className)}
         role="progressbar" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      {pct > 0 && (
        <div
          className={cx("h-full rounded-full transition-[width] duration-500 ease-out", !color && fill)}
          style={{ width: `${pct}%`, ...(color ? { backgroundColor: color } : null) }}
        />
      )}
    </div>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────
// Pílula de status: tom pálido com tinta do mesmo matiz. Nunca espremida.
const BADGE_TONES = {
  neutral: "bg-veu/[0.07] text-slate-300",
  pos: "bg-emerald-500/15 text-emerald-300",
  neg: "bg-rose-500/15 text-rose-300",
  warn: "bg-amber-500/15 text-amber-300",
  brand: "bg-blue-500/15 text-blue-300",
};
export function Badge({ children, className, tone }) {
  return (
    <span className={cx(
      "inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium leading-5",
      tone && BADGE_TONES[tone],
      className
    )}>
      {children}
    </span>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────
// Dialog do shadcn (Radix): diálogo centrado no desktop, folha que sobe do
// rodapé no celular (`components/ui/dialog.tsx`). Radix já prende o Tab, fecha
// só o de cima no Esc (modal dentro de modal: criar categoria dentro da
// despesa), trava o scroll do body e porta pro body (evita <form> aninhado).
//
// O que fica aqui é a API da casa (`open`/`onClose`) e duas decisões de foco:
//   · abertura: se um campo pegou o foco (autoFocus), fica nele; senão foca o
//     próprio diálogo — o padrão do Radix focaria o X, e roubar o foco do
//     campo disparava blur → "tocado" → erro de validação já na abertura;
//   · fechamento: volta pro último elemento focado FORA de qualquer diálogo.
//     O Radix guarda o `activeElement` da montagem, que já é o campo do
//     autoFocus (removido junto com o diálogo) — o foco caía no body.
let ultimoFocoFora = null;
if (typeof document !== "undefined") {
  document.addEventListener("focusin", (e) => {
    if (!(e.target instanceof Element) || !e.target.closest("[data-modal]")) ultimoFocoFora = e.target;
  });
}

export function Modal({ open, onClose, title, description, size = "md", children }) {
  const anterior = useRef(null);
  const conteudo = useRef(null);
  // o rastreador ignora `[data-modal]`, então mesmo depois do autoFocus levar o
  // foco pra dentro, `ultimoFocoFora` ainda é quem abriu
  useEffect(() => { if (open) anterior.current = ultimoFocoFora; }, [open]);

  const largura = size === "lg" ? "sm:max-w-2xl" : size === "sm" ? "sm:max-w-sm" : "sm:max-w-lg";
  return (
    <Dialog open={!!open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        ref={conteudo}
        data-modal
        showCloseButton={false}
        className={largura}
        {...(description ? {} : { "aria-describedby": undefined })}
        onOpenAutoFocus={(e) => {
          // só roda quando nenhum campo pegou o foco sozinho (autoFocus)
          e.preventDefault();
          conteudo.current?.focus();
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const alvo = anterior.current;
          anterior.current = null;
          if (alvo && typeof alvo.focus === "function" && alvo.isConnected) alvo.focus();
        }}
      >
        {/* alça da folha no celular */}
        <span aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-veu/15 sm:hidden" />
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-3 sm:px-6 sm:pt-5">
          <div className="min-w-0">
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription className="mt-0.5">{description}</DialogDescription>}
          </div>
          <IconButton onClick={onClose} aria-label="Fechar" className="-mr-1.5 mt-0.5">
            <X size={18} />
          </IconButton>
        </div>
        {/* Corpo rolável com cabeçalho fixo: form que cresce (ex: "Compra
            parcelada" aparece ao escolher cartão) não empurra os botões pra
            fora da tela no celular. */}
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-1 sm:px-6 sm:pb-6">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

// ── Form fields ─────────────────────────────────────────────────────────────
// Rótulo visível em cima (14/500), erro embaixo do próprio campo.
export function Field({ label, hint, error, children, required }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-sm font-medium text-slate-200">
        {label}
        {required && <span className="text-rose-400" aria-hidden>*</span>}
      </span>
      {children}
      {error ? (
        <span role="alert" className="mt-1.5 block text-[13px] text-rose-400">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-[13px] text-slate-500">{hint}</span>
      ) : null}
    </label>
  );
}

// text-base no mobile de propósito: com fonte < 16px o Safari/iOS dá zoom ao
// focar o campo e o layout do modal "salta". Volta pra text-sm no desktop.
export const inputBase =
  "h-10 w-full rounded-xl border border-[var(--color-line-strong)] bg-input px-3.5 text-base sm:text-sm text-ink " +
  "placeholder:text-slate-500 transition-[border-color,box-shadow] hover:border-veu/25 " +
  "focus:border-blue-500 focus:outline-none focus:ring-[3px] focus:ring-blue-500/20 " +
  "aria-[invalid=true]:border-rose-400/70";

export function TextInput({ className, ...rest }) {
  return <input className={cx(inputBase, className)} {...rest} />;
}

export function Textarea({ className, rows = 2, ...rest }) {
  return <textarea rows={rows} className={cx(inputBase, "h-auto resize-y py-2.5", className)} {...rest} />;
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
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-500">% a.a.</span>
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
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-500">R$</span>
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

// ── Donut (anel fino) ───────────────────────────────────────────────────────
// Só pra 3–5 partes de um todo que NÃO estão listadas ao lado. Traço fino,
// sem rótulo nas fatias, emendas de 2px entre elas.
export function Donut({ segments, size = 148, stroke = 10, centerLabel, centerSub }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const visiveis = segments.filter((s) => s.value > 0);
  const emenda = visiveis.length > 1 ? 2 : 0;
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-trilho)" strokeWidth={stroke} />
        {segments.map((s, i) => {
          const len = (s.value / total) * c;
          const dash = `${Math.max(len - emenda, 0)} ${c - Math.max(len - emenda, 0)}`;
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
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      {(centerLabel || centerSub) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          {centerSub && <span className="text-xs text-slate-500">{centerSub}</span>}
          {centerLabel && <span className="tnum text-lg font-semibold text-ink">{centerLabel}</span>}
        </div>
      )}
    </div>
  );
}
