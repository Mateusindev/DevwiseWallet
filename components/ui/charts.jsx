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

// ── Sobra mensal ────────────────────────────────────────────────────────────
// points: [{ key, label, sobrou, recebido, saiu }] — do mês mais antigo ao mais
// recente. `destaque` = key do mês visto.
//
// Substituiu um LineTrend. O problema não era o desenho, era a pergunta: "sobra"
// é um número COM SINAL, e uma linha com o eixo colado no menor valor não mostra
// nem quando o mês fechou no vermelho, nem quanto. Aqui:
//   · zero é uma linha real no meio, sempre desenhada — barra pra cima sobrou,
//     pra baixo faltou, e a cor segue o sinal de cada mês (não o do mês atual,
//     que era o que a linha inteira usava);
//   · a média entra como referência tracejada: sobrar 200 num mês só diz algo
//     comparado com o normal;
//   · o mês visto fica destacado com valor à vista — nos outros o número
//     aparece no hover, senão viram doze rótulos brigando;
//   · a escala é simétrica quando há vermelho, pra que -300 e +300 tenham o
//     mesmo tamanho e a comparação seja honesta.
export function SobraMensal({ points, height = 200, format = fmtMoneyCompact, destaque }) {
  if (!points || points.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-500">Sem histórico ainda.</p>;
  }

  const vals = points.map((p) => p.sobrou);
  const maxPos = Math.max(0, ...vals);
  const maxNeg = Math.max(0, ...vals.map((v) => -v));
  // Escala simétrica quando existe mês negativo: o vermelho não pode parecer
  // menor que o verde só porque o pico positivo é maior.
  const escala = Math.max(maxNeg > 0 ? Math.max(maxPos, maxNeg) : maxPos, 1);

  // Faixa reservada no topo pro rótulo do mês destacado — sem ela o número
  // ficava cortado justo no mês que interessa.
  const PAD_TOPO = 24;
  const util = height - PAD_TOPO;
  const areaPos = maxNeg > 0 ? util / 2 : util;
  const areaNeg = util - areaPos;
  const topoZero = PAD_TOPO + areaPos;
  const px = (v) => {
    const area = v >= 0 ? areaPos : areaNeg;
    return Math.min((Math.abs(v) / escala) * area, area);
  };

  const media = vals.reduce((s, v) => s + v, 0) / vals.length;
  const negativos = vals.filter((v) => v < 0).length;
  const atual = points.find((p) => (p.key ?? p.label) === destaque) ?? points[points.length - 1];
  const topoMedia = media >= 0 ? topoZero - px(media) : topoZero + px(media);

  return (
    <div>
      {/* o número antes do desenho: o gráfico contextualiza, não informa */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Sobrou em {atual?.label ?? "—"}
          </p>
          <p className={cx("tnum text-2xl font-bold", (atual?.sobrou ?? 0) < 0 ? "text-rose-400" : "text-emerald-400")}>
            {format(atual?.sobrou ?? 0)}
          </p>
        </div>
        <dl className="flex gap-5 text-right">
          <div>
            <dt className="text-[11px] text-slate-500">média {points.length}m</dt>
            <dd className={cx("tnum text-sm font-semibold", media < 0 ? "text-rose-400" : "text-slate-200")}>
              {format(media)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500">no vermelho</dt>
            <dd className={cx("tnum text-sm font-semibold", negativos > 0 ? "text-rose-400" : "text-slate-200")}>
              {negativos}/{points.length}
            </dd>
          </div>
        </dl>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="relative min-w-[300px]" style={{ height }}
             role="img"
             aria-label={"Sobra mensal: " + points.map((p) => p.label + " " + format(p.sobrou)).join(", ")}>
          {/* zero: a referência que faltava na linha antiga */}
          <div className="pointer-events-none absolute inset-x-0 z-0 border-t border-white/20" style={{ top: topoZero }} />

          <div className="relative z-10 flex h-full items-stretch gap-1 sm:gap-1.5">
            {points.map((p, i) => {
              const k = p.key ?? p.label;
              const destacado = k === destaque;
              const neg = p.sobrou < 0;
              const h = Math.max(px(p.sobrou), p.sobrou === 0 ? 0 : 2);
              // Alinhamento do tooltip pela posição da coluna: centralizado no
              // meio, encostado nas pontas — a caixa é larga e nas bordas sairia
              // da área visível.
              const ancora =
                i <= 1 ? "left-0" : i >= points.length - 2 ? "right-0" : "left-1/2 -translate-x-1/2";
              return (
                <div key={k} className="group relative flex min-w-[16px] flex-1 flex-col">
                  <span style={{ height: PAD_TOPO }} />
                  <div className="flex flex-col justify-end" style={{ height: areaPos }}>
                    {!neg && (
                      <div className={cx("w-full rounded-t-md transition-colors",
                                         destacado ? "bg-emerald-400" : "bg-emerald-500/50 group-hover:bg-emerald-400")}
                           style={{ height: h }} />
                    )}
                  </div>
                  <div className="flex flex-col justify-start" style={{ height: areaNeg }}>
                    {neg && (
                      <div className={cx("w-full rounded-b-md transition-colors",
                                         destacado ? "bg-rose-400" : "bg-rose-500/50 group-hover:bg-rose-400")}
                           style={{ height: h }} />
                    )}
                  </div>

                  {/* mês visto: valor sempre à vista, encostado na barra */}
                  {destacado && (
                    <span className={cx(
                      "tnum pointer-events-none absolute z-20 whitespace-nowrap rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold",
                      // mesma âncora do tooltip: o mês visto é quase sempre o
                      // último, e centralizado ali o valor saía cortado
                      ancora,
                      neg ? "text-rose-300" : "text-emerald-300"
                    )}
                      style={neg ? { top: topoZero + h + 4 } : { top: topoZero - h - 19 }}>
                      {format(p.sobrou)}
                    </span>
                  )}

                  {/* Hover: o mês inteiro (sobra + o porquê dela). Fica DENTRO da
                      área do gráfico porque o wrapper tem overflow-x:auto, e isso
                      corta também o que passa por cima — era o que fazia o tooltip
                      antigo simplesmente não aparecer. */}
                  <span className={cx(
                    "pointer-events-none absolute bottom-0.5 z-30 whitespace-nowrap rounded-md bg-slate-900/95 px-2 py-1 text-[10px] leading-relaxed text-slate-200 opacity-0 ring-1 ring-white/10 transition-opacity group-hover:opacity-100",
                    ancora
                  )}>
                    <b className="text-slate-100">{p.label}</b>
                    {" · sobrou "}
                    <b className={neg ? "text-rose-300" : "text-emerald-300"}>{format(p.sobrou)}</b>
                    <br />
                    recebeu {format(p.recebido ?? 0)} · gastou {format(p.saiu ?? 0)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Média por cima das barras (z-20): com pouca variação o gráfico é um
              paredão, e é a média que diz qual mês ficou acima ou abaixo do normal.
              O rótulo vai pra ESQUERDA — à direita ele bate no valor do mês visto,
              que é justamente onde a barra destacada costuma estar. */}
          <div className="pointer-events-none absolute inset-x-0 z-20 border-t border-dashed border-sky-300/70"
               style={{ top: topoMedia }}>
            <span className="tnum absolute -top-2 left-0 rounded bg-[var(--color-surface)] px-1 text-[9px] font-semibold text-sky-300">
              média {format(media)}
            </span>
          </div>
        </div>

        <div className="mt-1.5 flex min-w-[300px] gap-1 sm:gap-1.5">
          {points.map((p, i) => {
            const k = p.key ?? p.label;
            const destacado = k === destaque;
            // Rótulo alternado no mobile (doze meses não caem lado a lado), mas
            // com "invisible" e não "hidden": sumir do flex desalinharia o
            // rótulo dos meses que ficam.
            return (
              <span key={k} className={cx(
                "min-w-[16px] flex-1 text-center text-[10px]",
                destacado ? "font-semibold text-slate-300" : "text-slate-500",
                !destacado && i % 2 === 1 && "invisible sm:visible"
              )}>
                {p.label}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Stacked vertical bars (composição do total por período) ─────────────────
// data:   [{ key, label, valores: { [serieKey]: number } }]
// series: [{ key, name, color }] — ordem FIXA (nunca por ranking: a cor tem que
//         seguir a entidade, senão trocar de mês repinta as barras).
//
// Segmentos separados por 2px da superfície e legenda sempre presente: as cores
// vêm do cadastro do usuário (cartão/categoria), então podem cair em pares
// difíceis de distinguir — o rótulo e o tooltip é que garantem a identidade.
export function StackedBars({ data, series, height = 168, format = fmtMoneyCompact, destaque, empty = "Sem dados." }) {
  const totais = data.map((d) => series.reduce((s, sr) => s + (d.valores[sr.key] || 0), 0));
  const max = Math.max(1, ...totais);
  if (data.length === 0 || totais.every((t) => t === 0)) {
    return <p className="py-6 text-center text-sm text-slate-500">{empty}</p>;
  }
  return (
    <div>
      <div className="flex items-end gap-2 overflow-x-auto pb-1 sm:gap-3">
        {data.map((d, i) => {
          const total = totais[i];
          const destacado = destaque != null && (d.key ?? d.label) === destaque;
          const visiveis = series.filter((sr) => (d.valores[sr.key] || 0) > 0);
          return (
            <div key={d.key ?? d.label} className="flex min-w-[38px] flex-1 flex-col items-center gap-1.5">
              {/* rótulo direto só no mês destacado — número em toda coluna é ruído */}
              <span className={cx("tnum text-[10px]", destacado ? "text-slate-200" : "text-transparent")}>
                {format(total)}
              </span>
              <div className="flex w-full max-w-[44px] flex-col-reverse justify-start gap-[2px]" style={{ height }}>
                {visiveis.map((sr, k) => {
                  const v = d.valores[sr.key] || 0;
                  const h = Math.max((v / max) * height, 3);
                  const topo = k === visiveis.length - 1;
                  return (
                    <div key={sr.key} className="group relative w-full shrink-0"
                         style={{ height: h, backgroundColor: sr.color, borderRadius: topo ? "4px 4px 0 0" : 0 }}>
                      <span className="pointer-events-none absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-200 opacity-0 ring-1 ring-white/10 transition-opacity group-hover:opacity-100">
                        {sr.name}: {format(v)}
                      </span>
                    </div>
                  );
                })}
              </div>
              <span className={cx("text-[10px]", destacado ? "font-semibold text-slate-300" : "text-slate-500")}>
                {d.label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
        {series.map((sr) => (
          <span key={sr.key} className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: sr.color }} /> {sr.name}
          </span>
        ))}
      </div>
    </div>
  );
}
