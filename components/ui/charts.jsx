// Lightweight SVG/flex charts — no external lib. Dark-theme tuned.
import { fmtMoneyCompact } from "../../lib/format.js";

const cx = (...c) => c.filter(Boolean).join(" ");

// ── Grouped vertical bars (compara séries por período) ──────────────────────
// data: [{ label, bars: [{ value, color, name }] }]
export function GroupedBars({ data, height = 168, format = fmtMoneyCompact }) {
  const max = Math.max(1, ...data.flatMap((d) => d.bars.map((b) => b.value)));
  return (
    <div className="flex items-end gap-2 sm:gap-3" style={{ height: height + 26 }}>
      {data.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center gap-1.5">
          <div className="flex w-full items-end justify-center gap-1" style={{ height }}>
            {d.bars.map((b, i) => {
              const h = Math.max((b.value / max) * height, b.value > 0 ? 3 : 0);
              return (
                <div key={i} className="group relative flex w-full max-w-[22px] flex-col justify-end" style={{ height }}>
                  <div className="pointer-events-none absolute -top-0.5 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-200 opacity-0 ring-1 ring-white/10 transition-opacity group-hover:opacity-100">
                    {b.name}: {format(b.value)}
                  </div>
                  <div className="w-full rounded-t-md transition-all" style={{ height: h, backgroundColor: b.color }} />
                </div>
              );
            })}
          </div>
          <span className="text-[10px] text-slate-500">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Ranked horizontal bars ──────────────────────────────────────────────────
// items: [{ label, value, color, sub }]
export function HBars({ items, format = fmtMoneyCompact, empty = "Sem dados." }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-slate-500">{empty}</p>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <li key={it.label}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-slate-300">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: it.color }} />
              <span className="truncate">{it.label}</span>
            </span>
            <span className="tnum shrink-0 font-medium text-slate-200">{format(it.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full transition-all" style={{ width: `${(it.value / max) * 100}%`, backgroundColor: it.color }} />
          </div>
          {it.sub && <p className="mt-0.5 text-[11px] text-slate-500">{it.sub}</p>}
        </li>
      ))}
    </ul>
  );
}

// ── Sparkline-ish line (evolução de saldo/sobra) ────────────────────────────
// points: [{ label, value }]
export function LineTrend({ points, height = 120, color = "#3b82f6", format = fmtMoneyCompact }) {
  if (points.length < 2) return <p className="py-6 text-center text-sm text-slate-500">Pouco histórico.</p>;
  const vals = points.map((p) => p.value);
  const min = Math.min(0, ...vals);
  const max = Math.max(1, ...vals);
  const span = max - min || 1;
  const W = 100, H = 100;
  const xs = (i) => (i / (points.length - 1)) * W;
  const ys = (v) => H - ((v - min) / span) * H;
  const line = points.map((p, i) => `${xs(i)},${ys(p.value)}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  const zeroY = ys(0);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height }}>
        <defs>
          <linearGradient id="lt" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {min < 0 && <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" strokeDasharray="2 2" />}
        <polygon points={area} fill="url(#lt)" />
        <polyline points={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={i} cx={xs(i)} cy={ys(p.value)} r="1.6" fill={color} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
        {points.map((p, i) => <span key={i} className={cx(i !== 0 && i !== points.length - 1 && "hidden sm:inline")}>{p.label}</span>)}
      </div>
    </div>
  );
}
