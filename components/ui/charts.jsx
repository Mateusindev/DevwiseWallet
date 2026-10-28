// Lightweight SVG/flex charts — no external lib. Cores lidas dos tokens do
// tema (`app/globals.css`), então valem no claro e no escuro.
//
// Regras que todos seguem: uma pergunta por gráfico, grade horizontal fraca com
// 3–4 marcas redondas acima do máximo (nunca gráfico sem escala), barra de
// canto reto na base, rótulo de eixo nunca maior que o dado, tooltip numa
// caixa simples dentro da área do gráfico.
import { fmtMoneyCompact } from "../../lib/format.js";

const cx = (...c) => c.filter(Boolean).join(" ");

const tooltipClass =
  "pointer-events-none absolute z-30 whitespace-nowrap rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs text-slate-300 opacity-0 shadow-[var(--sombra-flutua)] transition-opacity group-hover:opacity-100";

// Passo "redondo" (1, 2, 2.5, 5 × 10^n) que cobre o máximo em `n` faixas.
export function escalaRedonda(max, n = 4) {
  if (!(max > 0)) return { topo: 1, marcas: [0, 1] };
  const bruto = max / n;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= bruto) ?? 10 * mag;
  const faixas = Math.ceil(max / passo);
  const topo = faixas * passo;
  return { topo, marcas: Array.from({ length: faixas + 1 }, (_, i) => i * passo) };
}

// R$ 1.500 → "1,5 mil"; o rótulo de eixo é o menor texto do gráfico.
const fmtEixo = (v) =>
  v >= 1000
    ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`
    : v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

// Grade + rótulos do eixo Y numa faixa própria à esquerda (rótulo nunca em
// cima da barra).
function Grade({ marcas, topo, height }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {marcas.map((m) => (
        <div key={m} className="absolute inset-x-0 flex items-center" style={{ bottom: (m / topo) * height - 0.5 }}>
          <span className="tnum w-11 shrink-0 pr-2 text-right text-[11px] leading-none text-slate-500">{fmtEixo(m)}</span>
          <span className={cx("h-px flex-1", m === 0 ? "bg-veu/20" : "bg-[var(--color-grade)]")} />
        </div>
      ))}
    </div>
  );
}

export function Legenda({ items, className }) {
  return (
    <ul className={cx("flex flex-wrap gap-x-4 gap-y-1.5", className)}>
      {items.map((it) => (
        <li key={it.name} className="inline-flex items-center gap-1.5 text-xs text-slate-400">
          <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ backgroundColor: it.color }} /> {it.name}
        </li>
      ))}
    </ul>
  );
}

// ── Grouped vertical bars (compara séries por período) ──────────────────────
// data: [{ label, key?, bars: [{ value, color, name }] }]
export function GroupedBars({ data, height = 168, format = fmtMoneyCompact, destaque }) {
  const max = Math.max(0, ...data.flatMap((d) => d.bars.map((b) => b.value)));
  const { topo, marcas } = escalaRedonda(max);
  return (
    <div>
      <div className="relative [overflow-x:clip]" style={{ height }}>
        <Grade marcas={marcas} topo={topo} height={height} />
        <div className="absolute inset-y-0 left-11 right-0 flex items-end gap-2 sm:gap-4">
          {data.map((d, i) => {
            const ancora = i === 0 ? "left-0" : i === data.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2";
            return (
              <div key={d.key ?? d.label} className="group relative flex h-full flex-1 items-end justify-center gap-[3px]">
                {d.bars.map((b, j) => (
                  <div key={j} className="w-full max-w-[18px] rounded-t-[3px] transition-opacity group-hover:opacity-90"
                       style={{ height: b.value > 0 ? Math.max((b.value / topo) * height, 2) : 0, backgroundColor: b.color }} />
                ))}
                <div className={cx(tooltipClass, "top-0", ancora)}>
                  <p className="mb-0.5 font-semibold text-ink">{d.label}</p>
                  {d.bars.map((b) => (
                    <p key={b.name} className="tnum flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-[3px]" style={{ backgroundColor: b.color }} />
                      {b.name} <span className="ml-auto pl-3 text-ink">{format(b.value)}</span>
                    </p>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="ml-11 mt-2 flex gap-2 sm:gap-4">
        {data.map((d) => (
          <span key={d.key ?? d.label}
                className={cx("flex-1 text-center text-[11px]", destaque != null && (d.key ?? d.label) === destaque ? "font-semibold text-ink" : "text-slate-500")}>
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Ranked horizontal bars ──────────────────────────────────────────────────
// items: [{ label, value, color, sub, extra }] — ordenados pelo chamador.
// O valor fica na linha do rótulo, a barra (fina) embaixo: a lista se lê como
// lista, e o comprimento confirma a ordem.
export function HBars({ items, format = fmtMoneyCompact, empty = "Sem dados.", total }) {
  if (!items.length) return <p className="py-8 text-center text-sm text-slate-500">{empty}</p>;
  const max = Math.max(1, ...items.map((i) => i.value));
  const soma = total ?? items.reduce((s, i) => s + i.value, 0);
  return (
    <ul className="space-y-3.5">
      {items.map((it) => (
        <li key={it.label}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-slate-200">
              <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ backgroundColor: it.color }} />
              <span className="truncate">{it.label}</span>
            </span>
            <span className="flex shrink-0 items-baseline gap-2.5">
              {soma > 0 && (
                <span className="tnum w-9 text-right text-xs text-slate-500">{Math.round((it.value / soma) * 100)}%</span>
              )}
              <span className="tnum font-medium text-ink">{format(it.value)}</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-trilho)]">
            <div className="h-full rounded-full" style={{ width: `${(it.value / max) * 100}%`, backgroundColor: it.color }} />
          </div>
          {it.sub && <p className="mt-1 text-xs text-slate-500">{it.sub}</p>}
        </li>
      ))}
    </ul>
  );
}

// ── Barra 100% (composição de um todo) ──────────────────────────────────────
// partes: [{ key, value, color, label }]. Emendas de 2px entre as partes.
export function BarraComposicao({ partes, height = 10, className, label }) {
  const total = partes.reduce((s, p) => s + Math.max(p.value, 0), 0);
  return (
    <div className={cx("flex w-full gap-[2px] overflow-hidden rounded-full", className)} style={{ height }}
         role="img" aria-label={label}>
      {total <= 0 ? (
        <span className="h-full w-full bg-[var(--color-trilho)]" />
      ) : (
        partes.filter((p) => p.value > 0).map((p) => (
          <span key={p.key ?? p.label} className="h-full" title={p.label}
                style={{ flexGrow: p.value, flexBasis: 0, backgroundColor: p.color }} />
        ))
      )}
    </div>
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
export function SobraMensal({ points, height = 184, format = fmtMoneyCompact, destaque }) {
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
  const diff = (atual?.sobrou ?? 0) - media;

  return (
    <div>
      {/* o número antes do desenho: o gráfico contextualiza, não informa */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <p className="text-[13px] text-slate-500">Sobrou em {atual?.label ?? "—"}</p>
          <p className={cx("tnum text-2xl font-semibold tracking-[-0.01em]", (atual?.sobrou ?? 0) < 0 ? "text-rose-400" : "text-ink")}>
            {format(atual?.sobrou ?? 0)}
          </p>
          <p className="tnum mt-0.5 text-[13px] text-slate-500">
            {Math.abs(diff) < 1 ? "na média dos últimos meses"
              : <><span className={diff < 0 ? "text-rose-400" : "text-emerald-400"}>{diff > 0 ? "+" : "−"}{format(Math.abs(diff))}</span> contra a média de {points.length} meses</>}
          </p>
        </div>
        <dl className="flex gap-6 text-right">
          <div>
            <dt className="text-[13px] text-slate-500">Média {points.length} meses</dt>
            <dd className={cx("tnum text-sm font-semibold", media < 0 ? "text-rose-400" : "text-ink")}>
              {format(media)}
            </dd>
          </div>
          <div>
            <dt className="text-[13px] text-slate-500">Meses no vermelho</dt>
            <dd className={cx("tnum text-sm font-semibold", negativos > 0 ? "text-rose-400" : "text-ink")}>
              {negativos} de {points.length}
            </dd>
          </div>
        </dl>
      </div>

      <div className="relative [overflow-x:clip]" style={{ height }}
           role="img"
           aria-label={"Sobra mensal: " + points.map((p) => p.label + " " + format(p.sobrou)).join(", ")}>
        {/* zero: a referência que faltava na linha antiga */}
        <div className="pointer-events-none absolute inset-x-0 z-0 h-px bg-veu/20" style={{ top: topoZero }} />

        <div className="relative z-10 flex h-full items-stretch gap-[3px] sm:gap-1.5">
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
              <div key={k} className="group relative flex min-w-0 flex-1 flex-col">
                <span style={{ height: PAD_TOPO }} />
                <div className="flex flex-col justify-end" style={{ height: areaPos }}>
                  {!neg && (
                    <div className={cx("w-full rounded-t-[3px] transition-colors",
                                       destacado ? "bg-emerald-400" : "bg-emerald-400/35 group-hover:bg-emerald-400/60")}
                         style={{ height: h }} />
                  )}
                </div>
                <div className="flex flex-col justify-start" style={{ height: areaNeg }}>
                  {neg && (
                    <div className={cx("w-full rounded-b-[3px] transition-colors",
                                       destacado ? "bg-rose-400" : "bg-rose-400/40 group-hover:bg-rose-400/65")}
                         style={{ height: h }} />
                  )}
                </div>

                {/* mês visto: valor sempre à vista, encostado na barra */}
                {destacado && (
                  <span className={cx(
                    "tnum pointer-events-none absolute z-20 whitespace-nowrap text-xs font-semibold",
                    // mesma âncora do tooltip: o mês visto é quase sempre o
                    // último, e centralizado ali o valor saía cortado
                    ancora,
                    neg ? "text-rose-400" : "text-ink"
                  )}
                    style={neg ? { top: topoZero + h + 4 } : { top: topoZero - h - 20 }}>
                    {format(p.sobrou)}
                  </span>
                )}

                {/* Hover: o mês inteiro (sobra + o porquê dela). Fica DENTRO da
                    área do gráfico — nada sai por cima do quadro. */}
                <span className={cx(tooltipClass, "bottom-0.5 leading-relaxed", ancora)}>
                  <b className="font-semibold text-ink">{p.label}</b>
                  {" · sobrou "}
                  <b className={cx("font-semibold", neg ? "text-rose-400" : "text-ink")}>{format(p.sobrou)}</b>
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
        <div className="pointer-events-none absolute inset-x-0 z-20 border-t border-dashed border-slate-400/70"
             style={{ top: topoMedia }}>
          <span className="tnum absolute -top-2.5 left-0 rounded bg-[var(--color-surface)] px-1 text-[11px] font-medium text-slate-400">
            média {format(media)}
          </span>
        </div>
      </div>

      <div className="mt-2 flex gap-[3px] sm:gap-1.5">
        {points.map((p, i) => {
          const k = p.key ?? p.label;
          const destacado = k === destaque;
          // Rótulo alternado no mobile (doze meses não caem lado a lado), mas
          // com "invisible" e não "hidden": sumir do flex desalinharia o
          // rótulo dos meses que ficam.
          return (
            <span key={k} className={cx(
              "min-w-0 flex-1 truncate text-center text-[11px]",
              destacado ? "font-semibold text-ink" : "text-slate-500",
              !destacado && i % 2 === 1 && "invisible sm:visible"
            )}>
              {p.label}
            </span>
          );
        })}
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
  if (data.length === 0 || totais.every((t) => t === 0)) {
    return <p className="py-8 text-center text-sm text-slate-500">{empty}</p>;
  }
  const { topo, marcas } = escalaRedonda(Math.max(...totais));
  return (
    <div>
      <Legenda items={series} className="mb-4" />
      <div className="relative [overflow-x:clip]" style={{ height }}>
        <Grade marcas={marcas} topo={topo} height={height} />
        <div className="absolute inset-y-0 left-11 right-0 flex items-end gap-2 sm:gap-4">
          {data.map((d, i) => {
            const total = totais[i];
            const destacado = destaque != null && (d.key ?? d.label) === destaque;
            const visiveis = series.filter((sr) => (d.valores[sr.key] || 0) > 0);
            const ancora = i === 0 ? "left-0" : i === data.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2";
            const alt = (total / topo) * height;
            return (
              <div key={d.key ?? d.label} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                {/* rótulo direto só no mês destacado — número em toda coluna é ruído */}
                {destacado && (
                  <span className="tnum absolute whitespace-nowrap text-[11px] font-semibold text-ink" style={{ bottom: alt + 4 }}>
                    {format(total)}
                  </span>
                )}
                <div className={cx("flex w-full max-w-[36px] flex-col-reverse gap-[2px] transition-opacity",
                                   destaque != null && !destacado && "opacity-70 group-hover:opacity-100")}>
                  {visiveis.map((sr, k) => {
                    const v = d.valores[sr.key] || 0;
                    return (
                      <div key={sr.key} className="w-full shrink-0"
                           style={{ height: Math.max((v / topo) * height - 2, 2), backgroundColor: sr.color,
                                    borderRadius: k === visiveis.length - 1 ? "3px 3px 0 0" : 0 }} />
                    );
                  })}
                </div>
                <div className={cx(tooltipClass, "top-0", ancora)}>
                  <p className="mb-0.5 font-semibold text-ink">{d.label} · <span className="tnum">{format(total)}</span></p>
                  {visiveis.map((sr) => (
                    <p key={sr.key} className="tnum flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-[3px]" style={{ backgroundColor: sr.color }} />
                      {sr.name} <span className="ml-auto pl-3 text-ink">{format(d.valores[sr.key] || 0)}</span>
                    </p>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="ml-11 mt-2 flex gap-2 sm:gap-4">
        {data.map((d) => {
          const destacado = destaque != null && (d.key ?? d.label) === destaque;
          return (
            <span key={d.key ?? d.label}
                  className={cx("min-w-0 flex-1 truncate text-center text-[11px]", destacado ? "font-semibold text-ink" : "text-slate-500")}>
              {d.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
