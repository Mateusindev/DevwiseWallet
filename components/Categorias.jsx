"use client";

// Página `/categorias` — antes categoria só nascia inline no select da despesa e
// não tinha onde renomear em lote, reordenar, mesclar nem excluir.
//
// Precisão aqui é saber o que cada ação mexe ANTES de clicar: cada linha mostra
// quantas fixas e lançamentos usam a categoria (em todas as páginas, via
// `usoCategorias`) e quanto ela pesa no mês visto. Excluir diz quantas despesas
// ficam sem categoria; mesclar diz quantas mudam de dono.
import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Pencil, Trash2, Merge, ArrowUp, ArrowDown, GripVertical, Search } from "lucide-react";
import {
  Card, CardHeader, Button, IconButton, Modal, PageHeader, EmptyState, TextInput,
} from "./ui/primitives.jsx";
import { Select, SelectItem, FormError } from "./ui/fields.jsx";
import { HBars } from "./ui/charts.jsx";
import { CategoriaModal } from "./forms.jsx";
import { useAsync } from "./ui/useAsync.js";
import { fmtMoney, fmtMoneyCompact, fmtMonthLabel, fmtMonthShort } from "../lib/format.js";
import { acento, fixaContaNoMes } from "../lib/calc.js";
import { useFinance } from "../store/FinanceContext.jsx";
import { useAuth } from "./AuthGate";
import * as api from "../services/financeApi";

const cx = (...c) => c.filter(Boolean).join(" ");
const SEM_USO = { fixas: 0, lancamentos: 0, ultimoMes: null };

function plural(n, um, varios) {
  return `${n} ${n === 1 ? um : varios}`;
}

// "3 fixas · 12 lançamentos · último out/26" — só as partes que existem.
function descreveUso(u) {
  const partes = [];
  if (u.fixas) partes.push(plural(u.fixas, "fixa", "fixas"));
  if (u.lancamentos) partes.push(plural(u.lancamentos, "lançamento", "lançamentos"));
  if (!partes.length) return "sem uso";
  if (u.ultimoMes) partes.push(`último ${fmtMonthShort(u.ultimoMes)}`);
  return partes.join(" · ");
}

export default function Categorias() {
  const fin = useFinance();
  const { categorias, despesasFixas, despesasMes, espacos, activeEspacoId, ym } = fin;
  const { can } = useAuth();
  const podeEditar = can("categoria:manage");

  const { dado: uso, carregando: carregandoUso, recarregar } = useAsync(
    () => api.getUsoCategorias(), "usoCategorias", { inicial: {} }
  );

  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState(null); // categoria | "nova" | null
  const [mesclando, setMesclando] = useState(null);
  const [excluindo, setExcluindo] = useState(null);
  const [arrastando, setArrastando] = useState(null);
  const [erroOrdem, setErroOrdem] = useState("");

  const ordenadas = useMemo(() => [...categorias].sort((a, b) => a.ordem - b.ordem), [categorias]);
  const filtradas = busca.trim()
    ? ordenadas.filter((c) => c.nome.toLowerCase().includes(busca.trim().toLowerCase()))
    : ordenadas;

  // Gasto no mês visto, página ativa — mesma régua do "Por categoria" do Início.
  const gastoMes = useMemo(() => {
    const acc = new Map();
    const add = (id, v) => acc.set(id || "__none", (acc.get(id || "__none") || 0) + v);
    despesasFixas.filter((d) => fixaContaNoMes(d, ym)).forEach((d) => add(d.categoriaId, d.valor));
    despesasMes.filter((d) => d.mes === ym).forEach((d) => add(d.categoriaId, d.valor));
    return acc;
  }, [despesasFixas, despesasMes, ym]);
  const totalMes = [...gastoMes.values()].reduce((s, v) => s + v, 0);
  const semCategoriaMes = gastoMes.get("__none") || 0;
  const espaco = espacos.find((e) => e.id === activeEspacoId);
  const nomeEspaco = espaco ? `${espaco.emoji ? `${espaco.emoji} ` : ""}${espaco.nome}` : "";

  const barras = ordenadas
    .map((c) => ({ label: c.nome, value: gastoMes.get(c.id) || 0, color: acento(c.cor).dot }))
    .filter((b) => b.value > 0)
    .sort((a, b) => b.value - a.value);
  if (semCategoriaMes > 0) barras.push({ label: "Sem categoria", value: semCategoriaMes, color: "var(--acento-neutro)" });

  async function mover(id, para) {
    const ids = ordenadas.map((c) => c.id);
    const de = ids.indexOf(id);
    if (de < 0 || para < 0 || para >= ids.length || para === de) return;
    ids.splice(para, 0, ids.splice(de, 1)[0]);
    setErroOrdem("");
    try {
      await fin.reordenarCategorias(ids);
    } catch (e) {
      setErroOrdem(e.message || "Não deu pra salvar a ordem.");
    }
  }

  const reordenavel = podeEditar && !busca.trim();

  return (
    <section className="space-y-6">
      <PageHeader
        title="Categorias"
        description={`${plural(categorias.length, "categoria", "categorias")} · valem pra todas as páginas de despesa`}
        actions={podeEditar && (
          <Button onClick={() => setEditando("nova")}><Plus size={16} /> Nova categoria</Button>
        )}
      />

      <div className="space-y-4">
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-line)] px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-ink">Suas categorias</h2>
              <p className="text-[13px] text-slate-500">
                {reordenavel ? "Arraste ou use as setas: é a ordem dos selects e dos gráficos." : "Limpe a busca pra reordenar."}
              </p>
            </div>
            <label className="relative w-full sm:w-56">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <span className="sr-only">Buscar categoria</span>
              <TextInput value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…" className="pl-9" />
            </label>
          </div>

          {erroOrdem && <div className="px-5 pt-3"><FormError>{erroOrdem}</FormError></div>}

          {ordenadas.length === 0 ? (
            <EmptyState className="m-5" title="Nenhuma categoria"
              description="Categorias organizam fixas e lançamentos nos gráficos."
              action={podeEditar && <Button size="sm" onClick={() => setEditando("nova")}><Plus size={15} /> Criar categoria</Button>} />
          ) : filtradas.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-500">Nada com “{busca}”.</p>
          ) : (
            <ol className="divide-y divide-[var(--color-line)]">
              {filtradas.map((c) => {
                const i = ordenadas.indexOf(c);
                const u = uso?.[c.id] ?? SEM_USO;
                const gasto = gastoMes.get(c.id) || 0;
                const pct = totalMes > 0 ? gasto / totalMes : 0;
                const a = acento(c.cor);
                return (
                  <li key={c.id}
                      draggable={reordenavel}
                      onDragStart={(e) => { setArrastando(c.id); e.dataTransfer.effectAllowed = "move"; }}
                      onDragOver={(e) => { if (arrastando) e.preventDefault(); }}
                      onDrop={(e) => { e.preventDefault(); if (arrastando) mover(arrastando, i); setArrastando(null); }}
                      onDragEnd={() => setArrastando(null)}
                      className={cx("group flex items-center gap-3 px-3 py-3 transition-colors sm:px-4",
                                    arrastando === c.id ? "opacity-40" : "hover:bg-[var(--realce)]")}>
                    {reordenavel && (
                      <GripVertical size={16} aria-hidden className="hidden shrink-0 cursor-grab text-slate-600 group-hover:text-slate-400 sm:block" />
                    )}
                    <span className="tnum w-5 shrink-0 text-right text-xs text-slate-500">{i + 1}</span>
                    <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: a.dot }} />

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{c.nome}</p>
                      <p className="tnum text-[12px] leading-snug text-slate-500">
                        {carregandoUso ? "contando…" : descreveUso(u)}
                      </p>
                    </div>

                    {/* peso no mês visto: valor + barrinha */}
                    <div className="hidden w-32 shrink-0 sm:block">
                      <p className="tnum text-right text-sm font-medium text-ink">{gasto > 0 ? fmtMoney(gasto) : "—"}</p>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--color-trilho)]">
                        <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, backgroundColor: a.dot }} />
                      </div>
                    </div>

                    {podeEditar && (
                      <div className="flex shrink-0 items-center">
                        {reordenavel && (
                          <>
                            <IconButton aria-label={`Subir ${c.nome}`} disabled={i === 0} onClick={() => mover(c.id, i - 1)}>
                              <ArrowUp size={15} />
                            </IconButton>
                            <IconButton aria-label={`Descer ${c.nome}`} disabled={i === ordenadas.length - 1} onClick={() => mover(c.id, i + 1)}>
                              <ArrowDown size={15} />
                            </IconButton>
                          </>
                        )}
                        <IconButton aria-label={`Editar ${c.nome}`} onClick={() => setEditando(c)}><Pencil size={15} /></IconButton>
                        <IconButton aria-label={`Mesclar ${c.nome} em outra`} disabled={ordenadas.length < 2} onClick={() => setMesclando(c)}>
                          <Merge size={15} />
                        </IconButton>
                        <IconButton tone="danger" aria-label={`Excluir ${c.nome}`} onClick={() => setExcluindo(c)}><Trash2 size={15} /></IconButton>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card className={cx("p-5 sm:p-6", semCategoriaMes <= 0 && "lg:col-span-2")}>
            <CardHeader title="Peso no mês" art="bar_chart"
                        description={`${fmtMonthLabel(ym)}${nomeEspaco ? ` · ${nomeEspaco}` : ""} · ${fmtMoneyCompact(totalMes)}`}
                        className="mb-5" />
            <HBars items={barras} empty="Nenhuma despesa neste mês." />
          </Card>

          {semCategoriaMes > 0 && (
            <Card className="self-start p-5">
              <p className="text-sm font-medium text-ink">{fmtMoney(semCategoriaMes)} sem categoria</p>
              <p className="mt-1 text-[13px] text-slate-500">
                Despesas sem categoria não entram em nenhuma fatia. Classifique em lote na tela de despesas (selecione → categoria).
              </p>
              <Link href="/despesas" className="mt-3 inline-block text-sm font-medium text-blue-400 hover:text-blue-300">Ir pra Despesas</Link>
            </Card>
          )}
        </div>
      </div>

      <CategoriaModal key={editando === "nova" ? "nova" : editando?.id ?? "fechado"}
                      open={!!editando} onClose={() => setEditando(null)}
                      categoria={editando === "nova" ? null : editando} />

      <MesclarModal origem={mesclando} categorias={ordenadas} uso={uso}
                    onClose={() => setMesclando(null)} onFeito={recarregar} />

      <ExcluirModal categoria={excluindo} uso={excluindo ? uso?.[excluindo.id] ?? SEM_USO : SEM_USO}
                    onClose={() => setExcluindo(null)} onFeito={recarregar} />
    </section>
  );
}

function Rodape({ children }) {
  return <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">{children}</div>;
}

function MesclarModal({ origem, categorias, uso, onClose, onFeito }) {
  const { mesclarCategoria } = useFinance();
  const [destino, setDestino] = useState("");
  const [erro, setErro] = useState("");
  const opcoes = categorias.filter((c) => c.id !== origem?.id);
  const u = origem ? uso?.[origem.id] ?? SEM_USO : SEM_USO;
  const alvo = opcoes.find((c) => c.id === destino);

  function fechar() { setDestino(""); setErro(""); onClose(); }

  async function confirmar() {
    if (!alvo) { setErro("Escolha a categoria que fica."); return; }
    setErro("");
    try {
      await mesclarCategoria(origem.id, alvo.id);
      onFeito?.();
      fechar();
    } catch (e) {
      setErro(e.message || "Não deu pra mesclar.");
    }
  }

  return (
    <Modal open={!!origem} onClose={fechar} title={`Mesclar “${origem?.nome ?? ""}”`}
           description="As despesas dela passam pra outra categoria e ela deixa de existir.">
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium text-slate-200">Juntar em</p>
          {/* "" vira item sentinela no Select da casa (o Radix não aceita ""), então
              o placeholder é um item desabilitado */}
          <Select value={destino} onValue={setDestino} name="destino">
            <SelectItem value="" disabled>Escolha a categoria que fica</SelectItem>
            {opcoes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: acento(c.cor).dot }} />{c.nome}
                </span>
              </SelectItem>
            ))}
          </Select>
        </div>
        <p className="rounded-[10px] bg-[var(--color-trilho)] px-3 py-2.5 text-[13px] text-slate-400">
          {u.fixas + u.lancamentos === 0
            ? "Nenhuma despesa usa essa categoria — mesclar só apaga ela."
            : <>Vão mudar <b className="font-semibold text-ink">{plural(u.fixas, "fixa", "fixas")}</b> e{" "}
                <b className="font-semibold text-ink">{plural(u.lancamentos, "lançamento", "lançamentos")}</b>, em todas as páginas
                {alvo && <> — tudo vira <b className="font-semibold text-ink">{alvo.nome}</b></>}.</>}
        </p>
        <FormError>{erro}</FormError>
        <Rodape>
          <Button variant="outline" onClick={fechar}>Cancelar</Button>
          <Button onClick={confirmar} disabled={!alvo}>Mesclar</Button>
        </Rodape>
      </div>
    </Modal>
  );
}

function ExcluirModal({ categoria, uso, onClose, onFeito }) {
  const { removeCategoria } = useFinance();
  const [erro, setErro] = useState("");
  const total = uso.fixas + uso.lancamentos;

  function fechar() { setErro(""); onClose(); }

  async function confirmar() {
    setErro("");
    try {
      await removeCategoria(categoria.id);
      onFeito?.();
      fechar();
    } catch (e) {
      setErro(e.message || "Não deu pra excluir.");
    }
  }

  return (
    <Modal open={!!categoria} onClose={fechar} size="sm" title={`Excluir “${categoria?.nome ?? ""}”?`}>
      <div className="space-y-4">
        <p className="text-sm text-slate-400">
          {total === 0
            ? "Nenhuma despesa usa essa categoria."
            : <><b className="font-semibold text-ink">{plural(total, "despesa fica", "despesas ficam")}</b> sem categoria
                ({plural(uso.fixas, "fixa", "fixas")} · {plural(uso.lancamentos, "lançamento", "lançamentos")}).
                Se a ideia é juntar com outra, use <b className="font-semibold text-ink">Mesclar</b>.</>}
        </p>
        <FormError>{erro}</FormError>
        <Rodape>
          <Button variant="outline" onClick={fechar}>Cancelar</Button>
          <Button variant="danger" onClick={confirmar}>Excluir</Button>
        </Rodape>
      </div>
    </Modal>
  );
}
