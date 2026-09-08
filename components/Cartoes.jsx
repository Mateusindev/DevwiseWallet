import { useEffect, useMemo, useState } from "react";
import { CreditCard, Plus, Pencil, Trash2, CalendarClock, Users, Receipt, Flag, TrendingDown, ChevronDown, Upload } from "lucide-react";
import { Card, Button, ProgressBar, Donut } from "./ui/primitives.jsx";
import { HBars, StackedBars } from "./ui/charts.jsx";
import { CartaoModal } from "./forms.jsx";
import ImportOfxModal from "./ImportOfx.jsx";
import { CompartilharModal, MeusCompartilhamentos } from "./Compartilhamento.jsx";
import { fmtMoney, fmtMoneyCompact, fmtMonthLabel, fmtMonthShort, currentMonthKey, addMonths } from "../lib/format.js";
import { acento, janelaMeses, mesesComFatura, quitacaoParceladas, quitacaoPorCartao } from "../lib/calc.js";
import { MonthStepper } from "./ui/fields.jsx";
import { useFinance } from "../store/FinanceContext.jsx";
import * as api from "../services/financeApi";
import { useAuth } from "./AuthGate";

export default function Cartoes() {
  const { cartoes, reloadCartoes, removeCartao, despesasFixas, despesasMes } = useFinance();
  const { can } = useAuth();
  const canManage = can("cartao:manage");
  const canShare = can("cartao:share");
  const canViewShared = can("cartao:view_shared");
  const [ym, setYm] = useState(currentMonthKey());
  const [novoOpen, setNovoOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [importando, setImportando] = useState(null); // cartão pré-selecionado no import
  // Janela de faturas: 12 meses pra cada lado, esticada pelas parcelas em aberto.
  const comFatura = useMemo(() => mesesComFatura(despesasFixas, despesasMes), [despesasFixas, despesasMes]);
  const janela = useMemo(() => janelaMeses({ dados: comFatura, atras: 12, frente: 12 }), [comFatura]);

  // recarrega os agregados quando troca o mês
  useEffect(() => {
    if (ym !== currentMonthKey()) reloadCartoes(ym);
    else reloadCartoes();
  }, [ym, reloadCartoes]);

  // total agregado de todos os cartões
  const totais = useMemo(() => {
    const limite = cartoes.reduce((s, c) => s + (c.limite || 0), 0);
    const usado = cartoes.reduce((s, c) => s + (c.faturaMes || 0) + (c.comprometido || 0), 0);
    const disponivel = limite - usado;
    return { limite, usado, disponivel, pct: limite > 0 ? usado / limite : 0 };
  }, [cartoes]);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <CreditCard size={20} /> Cartões de crédito
          </h2>
          <p className="text-sm text-slate-400">Limites, faturas e parcelas em aberto.</p>
        </div>
        <div className="flex items-center gap-2">
          <MonthStepper value={ym} onValue={setYm} min={janela.min} max={janela.max} marked={comFatura} />
          {canManage && cartoes.length > 0 && (
            <Button variant="ghost" onClick={() => setImportando(cartoes[0])} title="Importar fatura OFX">
              <Upload size={16} /> OFX
            </Button>
          )}
          {canManage && <Button onClick={() => setNovoOpen(true)}><Plus size={16} /> Novo cartão</Button>}
        </div>
      </header>

      {cartoes.length === 0 ? (
        <Card className="px-5 py-14 text-center">
          <CreditCard size={28} className="mx-auto mb-3 text-slate-500" />
          <p className="text-sm text-slate-400">Nenhum cartão cadastrado.</p>
          <p className="mt-1 text-xs text-slate-500">Cadastre seus cartões pra associar despesas e acompanhar a fatura.</p>
        </Card>
      ) : (
        <>
        <Card className="p-5 sm:p-6">
          <div className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Limite total</p>
                <p className="tnum text-3xl font-bold text-white sm:text-4xl">{fmtMoney(totais.limite)}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-white/4 p-3">
                  <p className="text-[11px] leading-tight text-slate-500">Comprometido</p>
                  <p className="tnum text-sm font-bold text-rose-400">{fmtMoney(totais.usado)}</p>
                </div>
                <div className="rounded-xl bg-white/4 p-3">
                  <p className="text-[11px] leading-tight text-slate-500">Disponível</p>
                  <p className={`tnum text-sm font-bold ${totais.disponivel < 0 ? "text-rose-400" : "text-emerald-400"}`}>{fmtMoney(totais.disponivel)}</p>
                </div>
              </div>
            </div>
            <div className="flex justify-center">
              <Donut
                segments={totais.limite > 0
                  ? [{ value: totais.usado, color: "#fb7185" }, { value: Math.max(totais.disponivel, 0), color: "rgba(255,255,255,0.06)" }]
                  : [{ value: 1, color: "rgba(255,255,255,0.06)" }]}
                centerSub="usado"
                centerLabel={`${Math.round(totais.pct * 100)}%`}
              />
            </div>
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          {cartoes.map((c) => (
            <CartaoCard key={c.id} cartao={c} canManage={canManage} canShare={canShare}
                        onEdit={() => setEditing(c)} onRemove={() => removeCartao(c.id)}
                        onShare={() => setSharing(c)} />
          ))}
        </div>
        </>
      )}

      {cartoes.length > 0 && <ParaOndeVaiAFatura ym={ym} cartoes={cartoes} />}

      <QuitacaoParceladas ym={ym} cartoes={cartoes} />

      {canViewShared && <MeusCompartilhamentos ym={ym} />}

      <ImportOfxModal open={!!importando} cartaoId={importando?.id} onClose={() => setImportando(null)}
                      mes={ym} mesLabel={fmtMonthLabel(ym)} />

      <CartaoModal open={novoOpen} onClose={() => setNovoOpen(false)} />
      <CartaoModal open={!!editing} cartao={editing} onClose={() => setEditing(null)} />
      <CompartilharModal open={!!sharing} cartao={sharing} ym={ym} onClose={() => setSharing(null)} />
    </section>
  );
}

const CINZA = "#64748b"; // "sem categoria" — neutro de propósito, não é uma série

// "Para onde vai a fatura": composição do mês (categoria e cartão), histórico de
// 6 meses e uso do limite. Um endpoint só (`/cartoes/resumo`) alimenta os três
// primeiros — 6 meses × N cartões em requests separadas seria dezenas de idas.
function ParaOndeVaiAFatura({ ym, cartoes }) {
  const { categorias } = useFinance();
  const [resumo, setResumo] = useState(null);
  const de = addMonths(ym, -5);

  useEffect(() => {
    let vivo = true;
    api.getResumoCartoes(de, ym)
      .then((r) => vivo && setResumo(r))
      .catch(() => vivo && setResumo(null));
    return () => { vivo = false; };
  }, [de, ym]);

  const cartoesMap = useMemo(() => Object.fromEntries(cartoes.map((c) => [c.id, c])), [cartoes]);
  const catMap = useMemo(() => Object.fromEntries(categorias.map((c) => [c.id, c])), [categorias]);
  const doMes = resumo?.meses?.find((m) => m.ym === ym);

  const porCategoria = (doMes?.porCategoria || []).map((x) => {
    const c = x.categoriaId ? catMap[x.categoriaId] : null;
    return { label: c?.nome || "Sem categoria", value: x.total, color: c ? acento(c.cor).dot : CINZA };
  });
  const porCartao = (doMes?.porCartao || []).map((x) => {
    const c = cartoesMap[x.cartaoId];
    return { label: c?.nome || "Cartão removido", value: x.total, color: acento(c?.cor).dot };
  });
  const totalMes = doMes?.total || 0;

  // Série empilhada por cartão. Ordem das séries = ordem dos cartões (fixa):
  // por ranking, trocar de mês repintaria as barras.
  const series = cartoes.map((c) => ({ key: c.id, name: c.nome, color: acento(c.cor).dot }));
  const serie = (resumo?.meses || []).map((m) => ({
    key: m.ym,
    label: fmtMonthShort(m.ym),
    valores: Object.fromEntries(m.porCartao.map((x) => [x.cartaoId ?? "sem", x.total])),
  }));

  // Uso do limite: % da fatura + comprometido futuro sobre o limite de cada cartão.
  const usoLimite = cartoes
    .filter((c) => (c.limite || 0) > 0)
    .map((c) => {
      const usado = (c.faturaMes || 0) + (c.comprometido || 0);
      const pct = Math.round((usado / c.limite) * 100);
      return {
        label: c.nome,
        value: Math.min(pct, 100),
        color: c.disponivel < 0 ? "#f43f5e" : acento(c.cor).dot,
        sub: `${fmtMoneyCompact(usado)} de ${fmtMoneyCompact(c.limite)}${c.disponivel < 0 ? " · estourou o limite" : ""}`,
      };
    })
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-4">
      <h3 className="flex items-center gap-2 text-base font-semibold text-white">
        <TrendingDown size={17} /> Para onde vai a fatura
      </h3>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h4 className="mb-4 text-sm font-semibold text-white">Fatura por categoria · {fmtMonthLabel(ym)}</h4>
          {porCategoria.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">Nada na fatura deste mês.</p>
          ) : (
            <div className="flex flex-col items-center gap-5 sm:flex-row">
              <Donut size={150} segments={porCategoria.map((c) => ({ value: c.value, color: c.color }))}
                     centerSub="fatura" centerLabel={fmtMoneyCompact(totalMes)} />
              <ul className="flex-1 space-y-2 self-stretch">
                {porCategoria.map((c) => (
                  <li key={c.label} className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                    <span className="min-w-0 flex-1 truncate text-slate-300">{c.label}</span>
                    <span className="tnum text-slate-400">{Math.round((c.value / (totalMes || 1)) * 100)}%</span>
                    <span className="tnum w-20 text-right font-medium text-slate-200">{fmtMoneyCompact(c.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h4 className="mb-4 text-sm font-semibold text-white">Fatura por cartão · {fmtMonthLabel(ym)}</h4>
          <HBars items={porCartao} empty="Nada na fatura deste mês." />
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h4 className="mb-4 text-sm font-semibold text-white">Fatura total · 6 meses</h4>
          <StackedBars data={serie} series={series} destaque={ym} empty="Sem fatura nesse período." />
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h4 className="mb-1 text-sm font-semibold text-white">Uso do limite por cartão</h4>
          <p className="mb-4 text-xs text-slate-500">Fatura do mês + parcelas ainda por vir.</p>
          <HBars items={usoLimite} format={(v) => `${v}%`} empty="Nenhum cartão com limite definido." />
        </Card>
      </div>
    </div>
  );
}

// Painel de quitação: quanto falta pra zerar todas as parceladas em aberto da
// conta, quando fica livre e quanto sai mês a mês até lá. Fica aqui (e não em
// Despesas) porque dívida parcelada é assunto de cartão — e porque o escopo é a
// conta inteira, não o espaço ativo: busca as parceladas de todos os espaços,
// igual ao `comprometido` que cada card mostra.
function QuitacaoParceladas({ ym, cartoes }) {
  const [dados, setDados] = useState(null);
  const [aberto, setAberto] = useState(false);
  const cartoesMap = useMemo(() => Object.fromEntries(cartoes.map((c) => [c.id, c])), [cartoes]);
  // o cálculo é genérico e não carrega o espaço da fixa — busca no payload por id
  const fixasMap = useMemo(() => Object.fromEntries((dados?.fixas || []).map((d) => [d.id, d])), [dados]);

  useEffect(() => {
    let vivo = true;
    api.getParceladas(ym)
      .then((d) => vivo && setDados(d))
      .catch(() => vivo && setDados(null));
    return () => { vivo = false; };
  }, [ym]);

  const total = useMemo(
    () => quitacaoParceladas(dados?.fixas, dados?.pagamentos, ym),
    [dados, ym]
  );
  const grupos = useMemo(
    () => quitacaoPorCartao(dados?.fixas, dados?.pagamentos, ym),
    [dados, ym]
  );

  if (total.itens.length === 0) return null;

  const mediaMes = total.cronograma.length > 0 ? total.falta / total.cronograma.length : 0;

  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-4">
        <h3 className="flex items-center gap-2 text-base font-semibold text-white">
          <Receipt size={18} /> Quitação das parceladas
        </h3>
        <p className="mt-0.5 text-xs text-slate-500">
          O que ainda vai cair de {fmtMonthLabel(ym)} até a última parcela · {total.itens.length}{" "}
          {total.itens.length === 1 ? "compra em andamento" : "compras em andamento"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] text-slate-400 sm:text-xs">
            <Receipt size={13} className="text-amber-400" /> Falta pra quitar tudo
          </p>
          <p className="tnum text-xl font-bold text-white sm:text-2xl">{fmtMoney(total.falta)}</p>
          <p className="mt-0.5 text-xs text-slate-500">de {fmtMoney(total.contrato)} contratados</p>
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-[11px] text-slate-400 sm:text-xs">
            <TrendingDown size={13} className="text-rose-400" /> Ainda sai em {fmtMonthShort(ym)}
          </p>
          <p className="tnum text-xl font-bold text-white sm:text-2xl">{fmtMoney(total.faltaNoMes)}</p>
          <p className="mt-0.5 text-xs text-slate-500">média de {fmtMoney(mediaMes)}/mês até o fim</p>
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-[11px] text-slate-400 sm:text-xs">
            <Flag size={13} className="text-emerald-400" /> Livre em
          </p>
          <p className="text-xl font-bold text-white sm:text-2xl">{fmtMonthShort(total.ultimoMes)}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {total.mesesAte === 0
              ? "última parcela é este mês"
              : `faltam ${total.mesesAte + 1} ${total.mesesAte + 1 === 1 ? "mês" : "meses"}`}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-slate-400">Já quitado</span>
          <span className="tnum font-medium text-slate-300">
            {fmtMoney(total.quitado)} · {Math.round(total.progresso * 100)}%
          </span>
        </div>
        <ProgressBar value={total.progresso} fromClass="from-emerald-500" toClass="to-emerald-400" />
      </div>

      {/* por cartão (grupo sem cartão = carnê/boleto) */}
      <div className="mt-5 space-y-3">
        {grupos.map((g) => {
          const c = g.cartaoId ? cartoesMap[g.cartaoId] : null;
          const a = acento(c?.cor || "amber");
          return (
            <div key={g.cartaoId || "sem-cartao"} className="rounded-xl bg-white/4 p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 flex-1 truncate font-semibold" style={{ color: g.cartaoId ? a.dot : undefined }}>
                  {g.cartaoId ? c?.nome || "Cartão removido" : "Sem cartão (carnê, boleto)"}
                </p>
                <div className="text-right">
                  <p className="tnum text-sm font-bold text-rose-400">{fmtMoney(g.falta)}</p>
                  <p className="text-[11px] text-slate-500">quita em {fmtMonthShort(g.ultimoMes)}</p>
                </div>
              </div>
              <ul className="divide-y divide-[var(--color-line)]">
                {g.itens.map((i) => (
                  <li key={i.id} className="py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-200">{i.descricao}</p>
                      <span className="tnum text-sm font-semibold text-slate-200">{fmtMoney(i.falta)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                      <span className="rounded-md bg-white/6 px-1.5 py-0.5 font-medium text-slate-300">{i.label}</span>
                      <span>
                        {i.notStarted
                          ? `começa em ${fmtMonthShort(i.primeiroMes)}`
                          : `${i.parcelas} ${i.parcelas === 1 ? "parcela" : "parcelas"} de ${fmtMoney(i.valor)}`}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span>quita em {fmtMonthShort(i.ultimoMes)}</span>
                      {fixasMap[i.id]?.espacoNome && (
                        <>
                          <span className="text-slate-600">·</span>
                          <span>{fixasMap[i.id].espacoEmoji} {fixasMap[i.id].espacoNome}</span>
                        </>
                      )}
                    </div>
                    <ProgressBar className="mt-2 h-1.5" value={i.progresso} fromClass={a.from} toClass={a.from} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      {/* cronograma mês a mês até quitar tudo */}
      <button onClick={() => setAberto((v) => !v)}
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-blue-400 hover:text-blue-300 cursor-pointer">
        <ChevronDown size={15} className={`transition-transform ${aberto ? "rotate-180" : ""}`} />
        {aberto ? "Ocultar" : "Ver"} mês a mês até quitar
      </button>

      {aberto && (
        <ul className="mt-3 space-y-1.5">
          {total.cronograma.map((m) => (
            <li key={m.ym} className="flex items-center gap-3 text-xs">
              <span className={`w-14 shrink-0 ${m.ym === ym ? "font-semibold text-slate-200" : "text-slate-500"}`}>
                {fmtMonthShort(m.ym)}
              </span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/8">
                <span className="block h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400"
                      style={{ width: `${total.picoMes > 0 ? (m.valor / total.picoMes) * 100 : 0}%` }} />
              </span>
              <span className="tnum w-24 shrink-0 text-right text-slate-300">{fmtMoney(m.valor)}</span>
              <span className="w-16 shrink-0 text-right text-slate-500">
                {m.itens} {m.itens === 1 ? "conta" : "contas"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CartaoCard({ cartao: c, canManage, canShare, onEdit, onRemove, onShare }) {
  const a = acento(c.cor);
  const usado = (c.faturaMes || 0) + (c.comprometido || 0);
  const pct = c.limite > 0 ? usado / c.limite : 0;
  const estourado = c.disponivel < 0;

  return (
    <Card className="overflow-hidden p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ backgroundColor: a.dot + "26", color: a.dot }}>
            <CreditCard size={20} />
          </span>
          <div>
            <p className="font-semibold text-white">{c.nome}</p>
            <p className="text-xs text-slate-500">
              {c.bandeira ? `${c.bandeira} · ` : ""}limite {fmtMoney(c.limite)}
            </p>
          </div>
        </div>
        {(canManage || canShare) && (
          <div className="flex gap-1">
            {canShare && (
              <button onClick={onShare} aria-label="Compartilhar cartão"
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-slate-200 cursor-pointer transition-colors">
                <Users size={15} />
              </button>
            )}
            {canManage && (
              <>
                <button onClick={onEdit} aria-label="Editar cartão"
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-white/10 hover:text-slate-200 cursor-pointer transition-colors">
                  <Pencil size={15} />
                </button>
                <button onClick={onRemove} aria-label="Remover cartão"
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/15 hover:text-rose-400 cursor-pointer transition-colors">
                  <Trash2 size={15} />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <ProgressBar value={pct} fromClass={a.from} toClass={a.from}
                   className={estourado ? "ring-1 ring-rose-500/40" : ""} />
      <p className="mt-1.5 text-xs text-slate-500">
        {fmtMoney(usado)} de {fmtMoney(c.limite)} comprometidos ({Math.round(pct * 100)}%)
      </p>

      <dl className="mt-4 space-y-2 text-sm">
        <Linha label="Fatura do mês" value={c.faturaMes} />
        <Linha label="Parcelas em aberto" value={c.comprometido} muted />
        <div className="my-1 border-t border-[var(--color-line)]" />
        <Linha label="Limite disponível" value={c.disponivel} strong tone={estourado ? "neg" : "pos"} />
      </dl>

      <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
        <CalendarClock size={14} />
        Vence dia {c.diaVencimento}
        {c.diaFechamento ? ` · fecha dia ${c.diaFechamento}` : ""}
      </div>
    </Card>
  );
}

function Linha({ label, value, strong, muted, tone }) {
  const color = tone === "pos" ? "text-emerald-400" : tone === "neg" ? "text-rose-400" : muted ? "text-slate-400" : "text-slate-200";
  return (
    <div className="flex items-center justify-between">
      <dt className={strong ? "font-semibold text-white" : "text-slate-400"}>{label}</dt>
      <dd className={`tnum ${strong ? "font-bold" : ""} ${color}`}>{fmtMoney(value)}</dd>
    </div>
  );
}
