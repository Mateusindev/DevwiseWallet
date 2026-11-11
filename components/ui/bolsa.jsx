"use client";

// Gráfico de velas (candlestick) — cara de corretora/exchange. Usado no
// orçamento (Início) e nas caixinhas. Cada mês é uma vela sobre o saldo:
//   abre  = saldo no começo do mês
//   máx.  = abre + entradas (se tudo tivesse entrado antes de sair)
//   mín.  = abre − saídas  (se tudo tivesse saído antes de entrar)
//   fecha = abre + entradas − saídas
// Verde fechou acima da abertura, vermelho abaixo. Linha cobalto = média móvel
// de 3 meses do fechamento. Embaixo, volume: entradas × saídas do mês.
// Número grande segue o crosshair; último fechamento pulsa; período 3M/6M/1A
// (preferência em localStorage, por tela).
//
// SVG puro (sem lib): largura medida por ResizeObserver, então texto e traço
// ficam nítidos em vez de esticar com viewBox.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { fmtMoney } from "../../lib/format.js";

const cx = (...c) => c.filter(Boolean).join(" ");

const UP = "var(--acento-emerald)";
const DOWN = "var(--acento-rose)";
const BRAND = "var(--color-brand)";
const PERIODOS = [{ id: 3, nome: "3M" }, { id: 6, nome: "6M" }, { id: 12, nome: "1A" }];

// ── utilitários ─────────────────────────────────────────────────────────────

// Callback ref: o contêiner pode nascer depois (sem histórico → com histórico).
function useLargura() {
  const [el, setEl] = useState(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

// Preferência por visitante, via useSyncExternalStore: no servidor (e na
// hidratação) vale o padrão; no cliente, o storage. Storage pode jogar exceção
// em aba privada — aí fica o padrão.
const ouvintes = new Set();
const assinar = (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); };
function lerPref(chave) {
  try { return localStorage.getItem(chave); } catch { return null; }
}
function usePref(chave, padrao, validos) {
  const raw = useSyncExternalStore(assinar, () => lerPref(chave), () => null);
  const lido = raw == null ? padrao : typeof padrao === "number" ? Number(raw) : raw;
  const v = validos.includes(lido) ? lido : padrao;
  const set = (novo) => {
    try { localStorage.setItem(chave, String(novo)); } catch { /* sem storage */ }
    ouvintes.forEach((fn) => fn());
  };
  return [v, set];
}

function escalaY(min, max, n = 4) {
  if (!(max > min)) { const d = Math.abs(max) || 100; min -= d / 2; max += d / 2; }
  const bruto = (max - min) / n;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= bruto) ?? 10 * mag;
  const lo = Math.floor(min / passo) * passo;
  const hi = Math.ceil(max / passo) * passo;
  const marcas = [];
  for (let v = lo; v <= hi + passo / 2; v += passo) marcas.push(Math.round(v * 100) / 100);
  return { lo, hi, marcas };
}

// "1,5 mil" / "−300" — rótulo de eixo é o menor texto do gráfico.
const fmtEixo = (v) => {
  const s = v < 0 ? "−" : "";
  const a = Math.abs(v);
  return a >= 1000
    ? `${s}${(a / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
    : `${s}${a.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
};

// Curva monotônica (Fritsch–Carlson): suave sem "passar do ponto" — uma spline
// comum inventa pico/vale que não existe entre dois meses.
function curva(pts) {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    t[i] = m[i - 1] * m[i] <= 0 ? 0
      : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  }
  t[n - 1] = m[n - 2];
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = dx[i] / 3;
    d += `C${x0 + h},${y0 + t[i] * h} ${x1 - h},${y1 - t[i + 1] * h} ${x1},${y1}`;
  }
  return d;
}

// ── controles ───────────────────────────────────────────────────────────────

function Segmentos({ opcoes, valor, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label}
         className="inline-flex max-w-full overflow-x-auto rounded-[10px] bg-[var(--color-trilho)] p-0.5">
      {opcoes.map((o) => {
        const ativo = o.id === valor;
        return (
          <button key={o.id} type="button" role="radio" aria-checked={ativo} onClick={() => onChange(o.id)}
                  className={cx("cursor-pointer whitespace-nowrap rounded-[8px] px-2.5 py-1 text-xs font-medium transition-colors",
                                ativo ? "bg-[var(--color-surface)] text-ink ring-1 ring-[var(--color-line-strong)]"
                                      : "text-slate-400 hover:text-slate-200")}>
            {o.nome}
          </button>
        );
      })}
    </div>
  );
}

// Etiqueta no eixo direito (preço do crosshair / último valor).
// Sem `cor` = neutra (tinta com texto da superfície — inverte junto com o tema).
function TagY({ x, y, w, texto, cor }) {
  return (
    <g className="pointer-events-none">
      <rect x={x} y={y - 9} width={w} height={18} rx={4} style={{ fill: cor ?? "var(--color-ink)" }} />
      <text x={x + w / 2} y={y + 3.5} textAnchor="middle" className="tnum text-[10.5px] font-semibold"
            style={{ fill: cor ? "#fff" : "var(--color-surface)" }}>
        {texto}
      </text>
    </g>
  );
}

function TagX({ x, y, texto }) {
  const w = Math.max(texto.length * 6.6 + 14, 40);
  return (
    <g className="pointer-events-none">
      <rect x={x - w / 2} y={y} width={w} height={18} rx={4} style={{ fill: "var(--color-ink)" }} />
      <text x={x} y={y + 12.5} textAnchor="middle" className="text-[10.5px] font-semibold" style={{ fill: "var(--color-surface)" }}>{texto}</text>
    </g>
  );
}

// ── componente ──────────────────────────────────────────────────────────────

const ROTULOS_ORCAMENTO = { acumulado: "Saldo acumulado até", entrada: "Recebido", saida: "Gasto" };

// points: [{ key, label, recebido, saiu, sobrou }] — do mais antigo ao mais
// recente (até 12). `destaque` = key do mês visto (ganha rótulo forte no eixo).
// `inicio` = saldo antes do primeiro ponto (caixinhas: o saldo real; orçamento:
// null, acumula só o período visto). `rotulos` troca os textos; `chavePref`
// separa a preferência de período de cada tela.
export function GraficoBolsa({ points, destaque, height = 320, inicio = null, rotulos, chavePref = "orcamento" }) {
  const R = { ...ROTULOS_ORCAMENTO, ...rotulos };
  const [periodo, setPeriodo] = usePref(`wallet:grafico-${chavePref}-periodo`, 12, PERIODOS.map((p) => p.id));
  const [hover, setHover] = useState(null);
  const [ref, W] = useLargura();

  const serie = useMemo(() => {
    const todos = points || [];
    const corte = Math.max(todos.length - periodo, 0);
    // com `inicio` o saldo é real e atravessa o recorte; sem ele (orçamento)
    // acumula só o período visto
    const recorte = todos.slice(corte);
    const antes = inicio != null ? inicio + todos.slice(0, corte).reduce((s, q) => s + (q.sobrou || 0), 0) : 0;
    const base = recorte.map((p, i) => {
      const open = antes + recorte.slice(0, i).reduce((s, q) => s + (q.sobrou || 0), 0);
      return {
        ...p, key: p.key ?? p.label,
        recebido: p.recebido || 0, saiu: p.saiu || 0, sobrou: p.sobrou || 0,
        open, close: open + (p.sobrou || 0), high: open + (p.recebido || 0), low: open - (p.saiu || 0),
      };
    });
    return base.map((p, i) => {
      const jan = base.slice(Math.max(0, i - 2), i + 1);
      return { ...p, mm3: jan.reduce((s, q) => s + q.close, 0) / jan.length };
    });
  }, [points, periodo, inicio]);

  if (!serie.length) {
    return <p className="py-10 text-center text-sm text-slate-500">Sem histórico ainda.</p>;
  }

  const n = serie.length;
  const ultimo = n - 1;
  const pa = serie[hover ?? ultimo];
  const prev = (hover ?? ultimo) > 0 ? serie[(hover ?? ultimo) - 1] : null;
  const sobe = (p) => p.close >= p.open;
  // doji (abriu = fechou): nem subiu nem desceu — neutro, não verde/vermelho
  const corDe = (p) => (Math.abs(p.close - p.open) < 0.005 ? "var(--color-slate-500)" : sobe(p) ? UP : DOWN);

  // escala automática, como corretora (forçar o zero achataria as velas)
  const vals = serie.flatMap((p) => [p.low, p.high]);
  const vMin = Math.min(...vals), vMax = Math.max(...vals);
  const folga = (vMax - vMin) * 0.08;
  const { lo, hi, marcas } = escalaY(vMin - folga, vMax + folga);

  // ── geometria ──
  const padL = 6, padR = 66, padT = 22, padB = 30;
  const volH = 52, volGap = 14;
  const plotW = Math.max(W - padL - padR, 10);
  const plotH = height - padT - padB - volH - volGap;
  const base = padT + plotH;
  const volTop = base + volGap;
  const band = plotW / n;
  const xOf = (i) => padL + band * (i + 0.5);
  const y = (v) => padT + ((hi - v) / (hi - lo || 1)) * plotH;
  const tagX = W - padR + 4, tagW = padR - 6;
  const bw = Math.max(Math.min(band * 0.56, 26), 3);
  const vbw = Math.max(Math.min(band * 0.24, 10), 2);
  const vMaxVol = Math.max(1, ...serie.flatMap((p) => [p.recebido, p.saiu]));

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - padL) / band);
    setHover(Math.min(Math.max(i, 0), ultimo));
  };

  const delta = prev ? pa.close - prev.close : null;
  const pct = prev && prev.close !== 0 ? (delta / Math.abs(prev.close)) * 100 : null;
  const rotuloCada = band < 34 ? 2 : 1;
  const ult = serie[ultimo];

  return (
    <div>
      {/* "cotação" (segue o crosshair) + período */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="min-w-0">
          <p className="text-[13px] text-slate-500">{R.acumulado} {pa.label}</p>
          <p className={cx("tnum text-[32px] font-semibold leading-tight tracking-[-0.02em]", pa.close < 0 ? "text-rose-400" : "text-ink")}>
            {fmtMoney(pa.close)}
          </p>
          <p className="tnum mt-0.5 text-[13px] font-medium">
            {delta == null ? <span className="text-slate-500">início do período</span> : (
              <>
                <span style={{ color: delta >= 0 ? UP : DOWN }}>
                  {delta >= 0 ? "▲" : "▼"} {fmtMoney(Math.abs(delta))}
                  {pct != null && ` (${Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)`}
                </span>
                <span className="text-slate-500"> vs {prev.label}</span>
              </>
            )}
          </p>
        </div>
        <Segmentos label="Período" opcoes={PERIODOS} valor={periodo} onChange={(v) => { setPeriodo(v); setHover(null); }} />
      </div>

      {/* OHLC + volume do mês, como a régua de uma corretora */}
      <dl className="tnum mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px]">
        {[["Abert.", pa.open], ["Máx.", pa.high], ["Mín.", pa.low], ["Fech.", pa.close]].map(([k, v]) => (
          <div key={k} className="flex gap-1.5">
            <dt className="text-slate-500">{k}</dt>
            <dd className="font-semibold" style={{ color: corDe(pa) }}>{fmtMoney(v)}</dd>
          </div>
        ))}
        <div className="flex gap-1.5">
          <dt className="text-slate-500">{R.entrada}</dt>
          <dd className="font-semibold" style={{ color: UP }}>+{fmtMoney(pa.recebido)}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-slate-500">{R.saida}</dt>
          <dd className="font-semibold text-ink">{fmtMoney(pa.saiu)}</dd>
        </div>
      </dl>

      <div ref={ref} className="relative w-full select-none" style={{ height }}>
        {W > 0 && (
          <svg width={W} height={height} className="block touch-pan-y overflow-visible"
               role="img"
               aria-label={"Velas mensais, fechamento: " + serie.map((p) => `${p.label} ${fmtMoney(p.close)}`).join(", ")}>
            {/* grade + eixo Y à direita */}
            {marcas.map((m) => (
              <g key={m}>
                <line x1={padL} x2={W - padR} y1={y(m)} y2={y(m)}
                      style={{ stroke: m === 0 ? "var(--color-line-strong)" : "var(--color-grade)" }}
                      strokeDasharray={m === 0 ? undefined : "2 4"} />
                <text x={W - padR + 10} y={y(m) + 3.5} className="tnum fill-slate-500 text-[10.5px]">{fmtEixo(m)}</text>
              </g>
            ))}

            {/* legenda da média móvel */}
            <text x={padL + 2} y={padT - 8} className="fill-slate-400 text-[10.5px] font-medium">
              <tspan style={{ fill: BRAND }}>━</tspan> MM3 <tspan className="tnum fill-ink">{fmtEixo(pa.mm3)}</tspan>
            </text>

            {/* faixa do mês sob o cursor */}
            {hover != null && (
              <rect x={xOf(hover) - band / 2} y={padT} width={band} height={plotH + volGap + volH} style={{ fill: "var(--realce)" }} />
            )}

            <g key={`${periodo}-${n}`}>
              {/* velas */}
              {serie.map((p, i) => {
                const cor = corDe(p);
                const yA = y(Math.max(p.open, p.close));
                const yB = y(Math.min(p.open, p.close));
                const apagada = hover != null && hover !== i;
                return (
                  <g key={p.key} className="bolsa-cresce" style={{ animationDelay: `${i * 40}ms` }}>
                    <g style={{ opacity: apagada ? 0.55 : 1, transition: "opacity 150ms" }}>
                      <line x1={xOf(i)} x2={xOf(i)} y1={y(p.high)} y2={y(p.low)} strokeWidth={1.5} style={{ stroke: cor }} />
                      <rect x={xOf(i) - bw / 2} y={yA} width={bw} height={Math.max(yB - yA, 1.5)} rx={2} style={{ fill: cor }} />
                    </g>
                  </g>
                );
              })}

              {/* média móvel de 3 */}
              <path d={curva(serie.map((p, i) => [xOf(i), y(p.mm3)]))} pathLength={1} fill="none" strokeWidth={1.75}
                    strokeLinejoin="round" strokeLinecap="round" style={{ stroke: BRAND }} className="bolsa-traco" />

              {/* volume: entradas × saídas */}
              <line x1={padL} x2={W - padR} y1={volTop + volH} y2={volTop + volH} style={{ stroke: "var(--color-line-strong)" }} />
              <text x={W - padR + 10} y={volTop + 9} className="fill-slate-500 text-[10px] font-medium">VOL</text>
              {serie.map((p, i) => {
                const hR = (p.recebido / vMaxVol) * volH;
                const hS = (p.saiu / vMaxVol) * volH;
                const op = hover === i ? 0.95 : hover != null ? 0.35 : 0.55;
                return (
                  <g key={p.key} className="bolsa-cresce" style={{ animationDelay: `${i * 30}ms`, transformOrigin: "bottom" }}>
                    <rect x={xOf(i) - vbw - 1} y={volTop + volH - hR} width={vbw} height={hR} rx={1.5} style={{ fill: UP, opacity: op }} />
                    <rect x={xOf(i) + 1} y={volTop + volH - hS} width={vbw} height={hS} rx={1.5} style={{ fill: DOWN, opacity: op }} />
                  </g>
                );
              })}
            </g>

            {/* último fechamento "ao vivo" — some quando o crosshair assume */}
            {hover == null && (
              <>
                <line x1={xOf(ultimo) + bw / 2} x2={W - padR} y1={y(ult.close)} y2={y(ult.close)} strokeDasharray="2 3"
                      style={{ stroke: corDe(ult), opacity: 0.7 }} />
                <circle cx={W - padR} cy={y(ult.close)} r={3} style={{ fill: corDe(ult) }} className="bolsa-pulso" />
                <TagY x={tagX} y={y(ult.close)} w={tagW} texto={fmtEixo(ult.close)} cor={corDe(ult)} />
              </>
            )}

            {/* crosshair */}
            {hover != null && (
              <g className="pointer-events-none">
                <line x1={xOf(hover)} x2={xOf(hover)} y1={padT} y2={volTop + volH} strokeDasharray="3 3" style={{ stroke: "var(--color-slate-500)" }} />
                <line x1={padL} x2={W - padR} y1={y(pa.close)} y2={y(pa.close)} strokeDasharray="3 3" style={{ stroke: "var(--color-slate-500)" }} />
                <TagY x={tagX} y={y(pa.close)} w={tagW} texto={fmtEixo(pa.close)} />
                <TagX x={Math.min(Math.max(xOf(hover), padL + 22), W - padR - 22)} y={height - padB + 6} texto={pa.label} />
              </g>
            )}

            {/* eixo X */}
            {serie.map((p, i) => {
              const forte = p.key === destaque;
              if (hover === i) return null;
              if (!forte && (ultimo - i) % rotuloCada !== 0) return null;
              return (
                <text key={p.key} x={xOf(i)} y={height - padB + 18} textAnchor="middle"
                      className={cx("text-[11px]", forte ? "fill-ink font-semibold" : "fill-slate-500")}>
                  {p.label}
                </text>
              );
            })}

            {/* captura do ponteiro (por cima de tudo) */}
            <rect x={0} y={0} width={W - padR} height={height - padB} fill="transparent"
                  onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
        )}
      </div>
    </div>
  );
}
