"use client";

// Página `/caixinhas` — saiu do Início. Tudo de caixinha mora aqui: total
// guardado, o gráfico de bolsa do saldo, a lista e os modais (aporte, retirada,
// nova caixinha). O dado vem do provider do layout: abrir a rota não busca nada.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, PiggyBank, LifeBuoy, ChevronRight } from "lucide-react";
import { Card, CardHeader, Button, Modal, SectionHeader, EmptyState, Valor, PageHeader } from "./ui/primitives.jsx";
import { BarraComposicao } from "./ui/charts.jsx";
import { GraficoBolsa } from "./ui/bolsa.jsx";
import CaixinhaCard from "./CaixinhaCard.jsx";
import { AporteModal, DespesaVariavelModal, CaixinhaModal, ReservaEmergenciaModal } from "./forms.jsx";
import { fmtMoney, fmtMonthShort, lastMonths, currentMonthKey, monthKey } from "../lib/format.js";
import { totalSaldo, totalAporteMensal, acento } from "../lib/calc.js";
import { useFinance } from "../store/FinanceContext.jsx";
import { useAuth } from "./AuthGate";

const ROTULOS = { acumulado: "Saldo em", entrada: "Aportes", saida: "Retiradas" };

const cx = (...c) => c.filter(Boolean).join(" ");

// Série mensal das caixinhas (todas ou uma) + o saldo de antes da janela.
// O saldo guardado é a verdade (juros/sobra podem não ter movimentação), então
// a história é reconstruída DE TRÁS PRA FRENTE: saldo de hoje menos o que entrou
// a partir do primeiro mês. Assim o último ponto bate com o saldo da tela.
export function serieCaixinhas(caixinhas, movimentacoes, filtro, meses = 12) {
  const alvo = filtro ? caixinhas.filter((c) => c.id === filtro) : caixinhas;
  const ids = new Set(alvo.map((c) => c.id));
  const saldo = alvo.reduce((s, c) => s + c.saldo, 0);
  const janela = lastMonths(meses, currentMonthKey());
  const primeiro = janela[0];
  const porMes = new Map(janela.map((m) => [m, { aporte: 0, retirada: 0 }]));
  let depois = 0; // líquido de tudo desde o primeiro mês (inclusive datas futuras)
  for (const mv of movimentacoes) {
    if (!ids.has(mv.caixinhaId)) continue;
    const m = monthKey(mv.data);
    if (m < primeiro) continue;
    const liquido = mv.tipo === "aporte" ? mv.valor : -mv.valor;
    depois += liquido;
    const b = porMes.get(m);
    if (!b) continue;
    if (mv.tipo === "aporte") b.aporte += mv.valor;
    else b.retirada += mv.valor;
  }
  const points = janela.map((m) => {
    const b = porMes.get(m);
    return { key: m, label: fmtMonthShort(m), recebido: b.aporte, saiu: b.retirada, sobrou: b.aporte - b.retirada };
  });
  // "Ajustar saldo" muda o saldo SEM movimentação. Se a reconstrução daria
  // saldo negativo antes da janela (impossível num cofre), o ajuste veio
  // depois: começa do zero e a diferença entra no mês atual como ajuste —
  // assim o último ponto continua batendo com o saldo da tela.
  let inicio = saldo - depois;
  if (inicio < 0) {
    const ultimo = points[points.length - 1];
    if (ultimo.key === currentMonthKey()) {
      ultimo.sobrou += inicio;
      ultimo.saiu += -inicio;
      ultimo.ajuste = inicio;
    }
    inicio = 0;
  }
  return { points, inicio };
}

export default function Caixinhas() {
  const router = useRouter();
  const { caixinhas, movimentacoes } = useFinance();
  const { can } = useAuth();
  const abrir = (id) => router.push(`/caixinhas/${id}`);

  // null | { caixinhaId? } — com id, o modal abre travado naquela caixinha.
  const [aporte, setAporte] = useState(null);
  const [despesa, setDespesa] = useState(null);
  const [novaMode, setNovaMode] = useState(null); // "choose" | "normal" | "reserva"
  const [filtro, setFiltro] = useState(null); // id da caixinha no gráfico, null = todas

  const ordered = useMemo(() => [...caixinhas].sort((a, b) => a.ordem - b.ordem), [caixinhas]);
  const temReserva = caixinhas.some((c) => c.tipo === "emergencia");
  const saldo = totalSaldo(caixinhas);
  const aporteMensal = totalAporteMensal(caixinhas);
  const metas = useMemo(() => {
    const comMeta = caixinhas.filter((c) => c.meta);
    const totalMeta = comMeta.reduce((s, c) => s + c.meta, 0);
    const guardado = comMeta.reduce((s, c) => s + Math.min(c.saldo, c.meta), 0);
    return {
      qtd: comMeta.length,
      atingidas: comMeta.filter((c) => c.saldo >= c.meta).length,
      progresso: totalMeta ? guardado / totalMeta : 0,
    };
  }, [caixinhas]);

  const filtroValido = filtro && caixinhas.some((c) => c.id === filtro) ? filtro : null;
  const grafico = useMemo(
    () => serieCaixinhas(caixinhas, movimentacoes, filtroValido),
    [caixinhas, movimentacoes, filtroValido]
  );
  const podeMov = can("movimentacao:manage");

  return (
    <section className="space-y-6">
      <PageHeader
        title="Caixinhas"
        description={caixinhas.length
          ? `${fmtMoney(saldo)} guardados em ${caixinhas.length} ${caixinhas.length === 1 ? "caixinha" : "caixinhas"}`
          : "Cofres com meta, reserva e sobra do mês"}
        actions={
          <>
            {podeMov && caixinhas.length > 0 && (
              <>
                <Button variant="outline" onClick={() => setDespesa({})}>Registrar retirada</Button>
                <Button variant="outline" onClick={() => setAporte({})}><Plus size={16} /> Aporte</Button>
              </>
            )}
            {can("caixinha:manage") && (
              <Button onClick={() => setNovaMode(temReserva ? "normal" : "choose")}><Plus size={16} /> Nova caixinha</Button>
            )}
          </>
        }
      />

      {ordered.length === 0 ? (
        <EmptyState title="Nenhuma caixinha ainda"
          description="Comece pela reserva de emergência: ela calcula a meta pelo seu gasto mensal."
          action={can("caixinha:manage") && <Button size="sm" onClick={() => setNovaMode("choose")}><Plus size={15} /> Criar caixinha</Button>} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            {/* gráfico de bolsa do saldo guardado */}
            <Card className="group p-5 sm:p-6">
              <CardHeader title="Evolução do guardado" art="chart_increasing"
                          description="Cada vela é um mês do saldo guardado — passe o dedo pra ver" className="mb-4" />
              {ordered.length > 1 && (
                <div className="mb-4 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Caixinha no gráfico">
                  <Chip ativo={!filtroValido} onClick={() => setFiltro(null)}>Todas</Chip>
                  {ordered.map((c) => (
                    <Chip key={c.id} ativo={filtroValido === c.id} onClick={() => setFiltro(c.id)} cor={acento(c.cor).dot}>
                      {c.nome}
                    </Chip>
                  ))}
                </div>
              )}
              <GraficoBolsa key={filtroValido ?? "todas"} points={grafico.points} inicio={grafico.inicio}
                            destaque={currentMonthKey()} rotulos={ROTULOS}
                            chavePref="caixinhas" />
            </Card>

            {/* total + divisão (era o primeiro cartão do Início) */}
            <Card className="group flex flex-col p-5 sm:p-6">
              <CardHeader title="Total guardado" art="money_bag"
                          description={`${caixinhas.length} ${caixinhas.length === 1 ? "caixinha" : "caixinhas"}`} />
              <p className="mt-2"><Valor value={saldo} className="text-[40px] leading-[48px] text-ink" /></p>
              <p className="tnum mt-1 text-[13px] text-slate-500">
                <span className="text-slate-300">{fmtMoney(aporteMensal)}</span> por mês em aportes
                {metas.qtd > 0 && (
                  <> · {metas.atingidas} de {metas.qtd} {metas.qtd === 1 ? "meta" : "metas"} ({Math.round(metas.progresso * 100)}%)</>
                )}
              </p>
              <BarraComposicao className="mt-5"
                label="Como o total se divide entre as caixinhas"
                partes={ordered.map((c) => ({ key: c.id, label: c.nome, value: c.saldo, color: acento(c.cor).dot }))} />
              <ul className="mt-3 divide-y divide-[var(--color-line)]">
                {ordered.map((c) => (
                  <li key={c.id} className="flex items-center gap-2.5 py-2 text-sm">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: acento(c.cor).dot }} />
                    <button onClick={() => abrir(c.id)}
                            className="min-w-0 flex-1 cursor-pointer truncate text-left text-slate-200 decoration-veu/30 underline-offset-4 hover:text-ink hover:underline">
                      {c.nome}
                    </button>
                    <span className="tnum w-10 text-right text-xs text-slate-500">
                      {saldo > 0 ? `${Math.round((Math.max(c.saldo, 0) / saldo) * 100)}%` : "—"}
                    </span>
                    <span className="tnum w-28 text-right font-medium text-ink">{fmtMoney(c.saldo)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <div className="space-y-3">
            <SectionHeader title="Seus cofres"
              description={aporteMensal > 0 ? `${fmtMoney(aporteMensal)} por mês em aportes programados` : "Abra um pra ver o extrato"} />
            <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${ordered.length >= 3 ? "xl:grid-cols-3" : ""}`}>
              {ordered.map((c) => (
                <CaixinhaCard
                  key={c.id}
                  caixinha={c}
                  onOpen={() => abrir(c.id)}
                  onAporte={() => setAporte({ caixinhaId: c.id })}
                  onDespesa={() => setDespesa({ caixinhaId: c.id })}
                />
              ))}
            </div>
          </div>
        </>
      )}

      <AporteModal open={!!aporte} onClose={() => setAporte(null)} caixinhas={ordered}
                   defaultCaixinhaId={aporte?.caixinhaId} lockCaixinha={!!aporte?.caixinhaId} />
      <DespesaVariavelModal open={!!despesa} onClose={() => setDespesa(null)} caixinhas={ordered}
                            defaultCaixinhaId={despesa?.caixinhaId} lockCaixinha={!!despesa?.caixinhaId} />

      {/* Passo 1: escolher o tipo de caixinha a criar */}
      <Modal open={novaMode === "choose"} onClose={() => setNovaMode(null)} title="Nova caixinha"
             description="Que tipo de cofre você quer abrir?">
        <div className="space-y-2.5">
          <TipoOpcao icon={LifeBuoy} title="Reserva de emergência"
            desc="Meta calculada pelas suas respostas: meses de segurança × gasto mensal."
            onClick={() => setNovaMode("reserva")} />
          <TipoOpcao icon={PiggyBank} title="Caixinha comum"
            desc="Meta livre, aporte mensal e rendimento, pra qualquer objetivo."
            onClick={() => setNovaMode("normal")} />
        </div>
      </Modal>

      <CaixinhaModal open={novaMode === "normal"} onClose={() => setNovaMode(null)} />
      <ReservaEmergenciaModal open={novaMode === "reserva"} onClose={() => setNovaMode(null)}
        onCreated={() => setNovaMode(null)} />
    </section>
  );
}

function Chip({ ativo, onClick, cor, children }) {
  return (
    <button type="button" role="radio" aria-checked={ativo} onClick={onClick}
            className={cx("inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                          ativo ? "bg-ink text-[var(--color-surface)]" : "bg-[var(--color-trilho)] text-slate-400 hover:text-slate-200")}>
      {cor && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cor }} />}
      {children}
    </button>
  );
}

// Opção de tipo no passo 1 do "Nova caixinha".
function TipoOpcao({ icon: Icon, title, desc, onClick }) {
  return (
    <button onClick={onClick}
      className="group flex w-full cursor-pointer items-center gap-3.5 rounded-xl border border-[var(--color-line-strong)] p-4 text-left transition-colors hover:border-veu/30 hover:bg-veu/[0.03]">
      <Icon size={20} strokeWidth={1.75} className="shrink-0 text-slate-400" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-[13px] text-slate-500">{desc}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-slate-500 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}
