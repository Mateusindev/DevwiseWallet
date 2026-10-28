import { useEffect, useMemo, useState } from "react";
import {
  Users, Trash2, Plus, HandCoins, Link2, Check, X, Mail, UserPlus,
  RefreshCw, EyeOff, CalendarCheck, Split, AlertTriangle, Copy,
} from "lucide-react";
import {
  Card, CardHeader, Button, IconButton, Modal, Field, TextInput, MoneyInput, Badge,
  Spinner, SkeletonList, EmptyState, usePendenteDoClique,
} from "./ui/primitives.jsx";
import { BarraComposicao } from "./ui/charts.jsx";
import { Select, SelectItem, NumberInput, FormError, CheckboxField } from "./ui/fields.jsx";
import { useFormState } from "./ui/useFormState.js";
import { useAsync } from "./ui/useAsync.js";
import { emailValido, texto } from "../lib/formErrors.js";
import { fmtMoney, fmtMonthLabel } from "../lib/format.js";
import { acento, iniciais } from "../lib/calc.js";
import { useFinance } from "../store/FinanceContext.jsx";
import * as api from "../services/financeApi";

// Status do contato: tom da pílula (pálido + tinta do mesmo matiz).
const STATUS = {
  local: { label: "Só na agenda", tone: "neutral" },
  convidado: { label: "Convite enviado", tone: "warn" },
  ativo: { label: "Aceitou", tone: "pos" },
  recusado: { label: "Recusou", tone: "neg" },
};

// ── Tom de cada pessoa ───────────────────────────────────────────────────────
// Cada pessoa tem UM matiz estável, derivado do nome (o mesmo nome cai sempre no
// mesmo tom — na agenda, nas iniciais da linha dividida e no modal de rateio).
// A ordem alterna matizes distantes (azul → âmbar → verde → violeta → rosa →
// ciano) pra pessoas vizinhas raramente caírem em tons parecidos. É identidade,
// não dado: fica pálido e fora das legendas.
const TONS_PESSOA = ["blue", "amber", "emerald", "violet", "rose", "cyan"];
export function tomDaPessoa(nome) {
  const k = String(nome || "").trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
  return acento(TONS_PESSOA[h % TONS_PESSOA.length]);
}

const TAM_AVATAR = { xs: "h-6 w-6 text-[11px]", sm: "h-7 w-7 text-[11px]", md: "h-9 w-9 text-xs" };
export function Avatar({ nome, size = "md", className = "" }) {
  return (
    <span aria-hidden
      className={`grid shrink-0 place-items-center rounded-full font-semibold ${TAM_AVATAR[size]} ${tomDaPessoa(nome).chip} ${className}`}>
      {iniciais(nome)}
    </span>
  );
}

function erroDe(e) {
  return e?.message || "Não deu pra completar essa ação.";
}

// ── Iniciais das pessoas na linha compartilhada ──────────────────────────────
// Fica na própria linha de despesa: sem isso não dá pra saber que o aluguel é
// dividido sem abrir o modal.
export function RateioChips({ d, className = "" }) {
  const rateio = d?.rateio ?? [];
  if (rateio.length === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}
          title={rateio.map((r) => `${r.nome}: ${fmtMoney(r.valor)}${r.status === "recusado" ? " (recusou)" : ""}`).join(" · ")}>
      <Split size={12} className="text-slate-500" aria-hidden />
      <span className="sr-only">Dividida com {rateio.map((r) => r.nome).join(", ")}</span>
      {/* iniciais encavaladas no tom de cada pessoa; quem recusou fica apagado */}
      <span className="flex -space-x-1.5">
        {rateio.map((r) => (
          <Avatar key={r.shareId} nome={r.nome} size="xs"
            className={`ring-2 ring-[var(--color-surface)] ${r.status === "recusado" ? "opacity-40 line-through" : ""}`} />
        ))}
      </span>
    </span>
  );
}

// ── Modal: ratear UMA linha entre N pessoas ──────────────────────────────────
export function RatearModal({ open, onClose, linha, campo, onSaved }) {
  const [contatos, setContatos] = useState([]);
  const [itens, setItens] = useState([]);
  const [abate, setAbate] = useState(false);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  // "Carregando" derivado de QUAL linha já foi carregada, não de um boolean
  // ligado dentro do efeito: assim o efeito só escreve estado nos callbacks.
  const [carregadoDe, setCarregadoDe] = useState(null);
  const [novo, setNovo] = useState({ nome: "", email: "" });

  const ref = useMemo(
    () => (campo === "fixa" ? { despesaFixaId: linha?.id } : { despesaMesId: linha?.id }),
    [campo, linha?.id]
  );
  const base = linha?.valor ?? 0;
  const abateInicial = !!linha?.abateShares;

  // Contatos + rateio atual da linha numa chamada só: o dispatcher de Server
  // Actions é serial por cliente, então um Promise.all aqui viraria fila.
  //
  // Deps por VALOR (`ref` já carrega o id da linha), não pelo objeto `linha`: o
  // pai remonta o objeto a cada render e o efeito refazia a busca junto.
  const linhaId = ref.despesaFixaId ?? ref.despesaMesId ?? null;
  const carregando = open && !!linhaId && carregadoDe !== linhaId;

  useEffect(() => {
    if (!open || !linhaId) return;
    let cancelado = false;
    api.getRateioBootstrap(ref)
      .then(({ contatos: cs, rateio: r }) => {
        if (cancelado) return;
        setErro("");
        setContatos(cs);
        setAbate(abateInicial);
        setItens(
          r.shares.map((sh) => ({
            contatoId: sh.contatoId,
            modo: sh.percentual != null ? "percentual" : sh.valor != null ? "valor" : "inteira",
            percentual: sh.percentual ?? 50,
            valor: sh.valor ?? 0,
          }))
        );
      })
      .catch((e) => !cancelado && setErro(erroDe(e)))
      .finally(() => !cancelado && setCarregadoDe(linhaId));
    return () => { cancelado = true; };
  }, [open, ref, linhaId, abateInicial]);

  // espelha validaRateio do server: a barra tem que fechar antes de salvar
  const partes = itens.map((i) =>
    i.modo === "percentual" ? (base * (i.percentual || 0)) / 100 : i.modo === "valor" ? i.valor || 0 : base
  );
  const soma = Math.round((partes.reduce((t, v) => t + v, 0) + Number.EPSILON) * 100) / 100;
  const sobra = Math.round((base - soma + Number.EPSILON) * 100) / 100;
  const estourou = soma > base;

  const disponiveis = contatos.filter((c) => !itens.some((i) => i.contatoId === c.id));

  function addPessoa(contatoId) {
    setItens((v) => [...v, { contatoId, modo: "percentual", percentual: 50, valor: 0 }]);
  }
  function patchItem(idx, p) {
    setItens((v) => v.map((i, n) => (n === idx ? { ...i, ...p } : i)));
  }

  async function criarContato() {
    if (!novo.nome.trim()) return setErro("Informe o nome da pessoa.");
    if (novo.email.trim() && !emailValido(novo.email)) return setErro("Email inválido.");
    try {
      const c = await api.addContato({ nome: novo.nome.trim(), email: novo.email.trim() || null });
      setContatos((v) => [...v, c]);
      addPessoa(c.id);
      setNovo({ nome: "", email: "" });
      setErro("");
    } catch (e) {
      setErro(erroDe(e));
    }
  }

  async function salvar() {
    if (estourou) return;
    setSalvando(true);
    setErro("");
    try {
      await api.salvarRateio({
        ...ref,
        abateShares: abate,
        itens: itens.map((i) => ({
          contatoId: i.contatoId,
          ...(i.modo === "percentual" ? { percentual: i.percentual } : {}),
          ...(i.modo === "valor" ? { valor: i.valor } : {}),
        })),
      });
      await onSaved?.();
      onClose();
    } catch (e) {
      setErro(erroDe(e));
    } finally {
      setSalvando(false);
    }
  }

  if (!linha) return null;
  const nomeDe = (id) => contatos.find((c) => c.id === id)?.nome ?? "—";

  // Fatias da barra: uma por pessoa (no tom dela), e o que sobra pro dono em
  // cinza. Estourou → tudo vermelho: a barra inteira vira o aviso.
  const fatias = [
    ...itens.map((i, idx) => ({
      key: i.contatoId,
      label: nomeDe(i.contatoId),
      value: partes[idx],
      color: estourou ? "var(--color-danger)" : tomDaPessoa(nomeDe(i.contatoId)).dot,
    })),
    ...(sobra > 0 ? [{ key: "__dono", label: "Você", value: sobra, color: "var(--color-trilho)" }] : []),
  ];

  return (
    <Modal open={open} onClose={onClose} title={`Dividir ${linha.descricao}`}
           description="Cada pessoa paga uma parte; o que sobra fica com você.">
      <div className="space-y-6">
        <FormError>{erro}</FormError>

        <div>
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-slate-500">Valor da linha</span>
            <span className="tnum text-xl font-semibold text-ink">{fmtMoney(base)}</span>
          </div>
          {/* barra de rateio: cada fatia + o que sobra pro dono */}
          <BarraComposicao className="mt-3" partes={fatias} label="Divisão da linha entre as pessoas" />
          <dl className="mt-2.5 flex justify-between text-[13px]">
            <div className="flex gap-1.5">
              <dt className="text-slate-500">Dividido</dt>
              <dd className={`tnum font-medium ${estourou ? "text-rose-400" : "text-ink"}`}>{fmtMoney(soma)}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-slate-500">Fica com você</dt>
              <dd className={`tnum font-medium ${sobra < 0 ? "text-rose-400" : "text-ink"}`}>{fmtMoney(sobra)}</dd>
            </div>
          </dl>
          {estourou && (
            <p role="alert" className="mt-2 text-[13px] text-rose-400">A soma passa do valor da linha. Ajuste antes de salvar.</p>
          )}
        </div>

        <section aria-label="Pessoas na divisão">
          {carregando && <SkeletonList rows={2} height="h-24" label="Carregando a divisão" />}
          {!carregando && itens.length === 0 && (
            <EmptyState compact title="Ninguém dividindo essa linha ainda"
              description="Escolha alguém da agenda ou cadastre uma pessoa nova abaixo." />
          )}
          {itens.length > 0 && (
            <ul className="divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)]">
              {itens.map((i, idx) => (
                <li key={i.contatoId} className="p-3.5">
                  <div className="mb-3 flex items-center gap-2.5">
                    <Avatar nome={nomeDe(i.contatoId)} size="sm" />
                    <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{nomeDe(i.contatoId)}</p>
                    <span className="tnum text-sm font-medium text-ink">{fmtMoney(partes[idx])}</span>
                    <IconButton tone="danger" onClick={() => setItens((v) => v.filter((_, n) => n !== idx))}
                                aria-label={`Tirar ${nomeDe(i.contatoId)} da divisão`}>
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Select name={`modo-${idx}`} value={i.modo} onValue={(v) => patchItem(idx, { modo: v })}
                            aria-label={`Como ${nomeDe(i.contatoId)} paga`}>
                      <SelectItem value="percentual">Percentual</SelectItem>
                      <SelectItem value="valor">Valor fixo</SelectItem>
                      <SelectItem value="inteira">Linha inteira</SelectItem>
                    </Select>
                    {i.modo === "percentual" && (
                      <div className="relative">
                        <NumberInput name={`pct-${idx}`} value={i.percentual} min={1} max={100} className="pr-9"
                          aria-label={`Percentual de ${nomeDe(i.contatoId)}`}
                          onValue={(v) => patchItem(idx, { percentual: v })} />
                        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-500">%</span>
                      </div>
                    )}
                    {i.modo === "valor" && (
                      <MoneyInput name={`val-${idx}`} value={i.valor} onValue={(v) => patchItem(idx, { valor: v })}
                        aria-label={`Valor de ${nomeDe(i.contatoId)}`} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {disponiveis.length > 0 && (
          <Field label="Adicionar da agenda">
            <Select name="addPessoa" value="" onValue={addPessoa} placeholder="Escolher pessoa…">
              {disponiveis.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome} · {STATUS[c.status]?.label ?? c.status}
                </SelectItem>
              ))}
            </Select>
          </Field>
        )}

        <fieldset className="space-y-3 rounded-xl bg-veu/[0.035] p-4">
          <legend className="sr-only">Cadastrar pessoa nova</legend>
          <p className="text-sm font-medium text-ink">Pessoa nova</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nome">
              <TextInput name="novoNome" value={novo.nome} placeholder="Maria"
                onChange={(e) => setNovo((v) => ({ ...v, nome: e.target.value }))} />
            </Field>
            <Field label="Email" hint="Opcional, pra convidar depois">
              <TextInput name="novoEmail" type="email" value={novo.email} placeholder="maria@email.com"
                onChange={(e) => setNovo((v) => ({ ...v, email: e.target.value }))} />
            </Field>
          </div>
          <Button variant="secondary" size="sm" onClick={criarContato}>
            <UserPlus size={15} /> Cadastrar e adicionar
          </Button>
        </fieldset>

        <CheckboxField
          label="Abater da minha despesa"
          hint="O orçamento passa a contar só a sua parte. Fatura de cartão normalmente fica cheia; aluguel, não."
          checked={abate}
          onChecked={setAbate}
        />

        <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-line)] pt-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} loading={salvando} disabled={estourou}>
            <Check size={16} /> Salvar divisão
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Modal: compartilhar a fatura de um cartão ────────────────────────────────
// Linha da fatura → RatearModal (N pessoas). Valor avulso continua aqui.
export function CompartilharModal({ open, onClose, cartao, ym }) {
  const [contatos, setContatos] = useState([]);
  const [linhas, setLinhas] = useState([]);
  const [shares, setShares] = useState([]);
  const [rateando, setRateando] = useState(null);

  const NOVA_PESSOA = "__novo__";
  const { f, set, patch, errors, formError, submitting, submit, reset } = useFormState(
    () => ({ contatoId: "", novoNome: "", novoEmail: "", valor: 0, recorrencia: "recorrente" }),
    (f) => {
      const nova = f.contatoId === NOVA_PESSOA;
      return {
        contatoId: f.contatoId ? "" : "Escolha ou cadastre uma pessoa.",
        novoNome: nova ? texto(f.novoNome, { obrigatorio: true, max: 80, campo: "O nome" }) : "",
        novoEmail: nova && f.novoEmail.trim() && !emailValido(f.novoEmail) ? "Email inválido." : "",
        valor: !(f.valor > 0) ? "Informe um valor maior que zero." : "",
      };
    },
    async (f) => {
      let cid = f.contatoId;
      if (cid === NOVA_PESSOA) {
        const nova = await api.addContato({ nome: f.novoNome.trim(), email: f.novoEmail.trim() || null });
        cid = nova.id;
      }
      await api.addCartaoShare(cartao.id, {
        contatoId: cid,
        tipo: "valor",
        valor: f.valor,
        mesRef: f.recorrencia === "pontual" ? ym : null,
      });
      patch({ contatoId: cid, novoNome: "", novoEmail: "", valor: 0 });
      await reload();
    }
  );

  // Idem: contatos + linhas da fatura + shares do cartão numa chamada só.
  async function reload() {
    if (!cartao) return;
    const { contatos: cs, linhas: ls, shares: ss } = await api.getPainelCartaoShare(cartao.id, ym);
    setContatos(cs);
    setLinhas(ls);
    setShares(ss);
  }

  useEffect(() => {
    if (open) {
      reload();
      reset();
    }
  }, [open, cartao?.id, ym]);

  async function remove(id) {
    await api.removeCartaoShare(id);
    await reload();
  }

  if (!cartao) return null;
  const avulsos = shares.filter((s) => s.tipo === "valor");
  const porLinha = (l) => shares.filter((s) => (l.tipo === "fixa" ? s.despesaFixaId : s.despesaMesId) === l.id);

  return (
    <>
      <Modal open={open && !rateando} onClose={onClose} title={`Compartilhar ${cartao.nome}`}
             description="Divida linhas da fatura ou combine um valor fixo com alguém.">
        <div className="space-y-6">
          {/* linhas da fatura: cada uma pode ser dividida com N pessoas */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">Linhas da fatura</h3>
            {linhas.length === 0 ? (
              <p className="text-[13px] text-slate-500">Nada nesta fatura em {ym}.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)]">
                {linhas.map((l) => {
                  const divisao = porLinha(l);
                  return (
                    <li key={`${l.tipo}:${l.id}`} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-ink">{l.descricao}</p>
                        <p className="tnum text-xs text-slate-500">
                          {fmtMoney(l.valor)}
                          {l.parcelado ? ` · ${l.parcelaAtual}/${l.totalParcelas}` : ""}
                          {divisao.length > 0
                            ? ` · dividida com ${divisao.map((s) => s.contatoNome).join(", ")}`
                            : ""}
                        </p>
                      </div>
                      <Button variant="secondary" size="sm" onClick={() => setRateando({ linha: l, campo: l.tipo })}>
                        <Split size={14} /> Dividir
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* valor avulso da fatura (não amarra numa linha) */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-ink">Valores combinados</h3>
            {avulsos.length === 0 ? (
              <p className="text-[13px] text-slate-500">Nenhum valor avulso combinado.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-line)] rounded-xl border border-[var(--color-line)]">
                {avulsos.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <Avatar nome={s.contatoNome} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{s.contatoNome}</p>
                      <p className="text-xs text-slate-500">{s.mesRef ? `Só em ${s.mesRef}` : "Todo mês"}</p>
                    </div>
                    <span className="tnum text-sm font-medium text-ink">{fmtMoney(s.valorMes)}</span>
                    <IconButton tone="danger" onClick={() => remove(s.id)} aria-label={`Remover valor de ${s.contatoNome}`}>
                      <Trash2 size={15} />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <form onSubmit={submit} className="space-y-4 border-t border-[var(--color-line)] pt-5" noValidate>
            <h3 className="text-sm font-semibold text-ink">Combinar valor</h3>
            <FormError>{formError}</FormError>
            <Field label="Pessoa" required error={errors.contatoId}>
              <Select name="contatoId" value={f.contatoId} onValue={(v) => set("contatoId", v)} placeholder="Selecione…">
                {contatos.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}{c.status === "ativo" ? " · aceitou" : ""}
                  </SelectItem>
                ))}
                <SelectItem value={NOVA_PESSOA}>+ Nova pessoa</SelectItem>
              </Select>
            </Field>

            {f.contatoId === NOVA_PESSOA && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Nome" required error={errors.novoNome}>
                  <TextInput name="novoNome" value={f.novoNome} placeholder="Maria"
                    onChange={(e) => set("novoNome", e.target.value)} />
                </Field>
                <Field label="Email" hint="Opcional, pra convidar depois" error={errors.novoEmail}>
                  <TextInput name="novoEmail" value={f.novoEmail} placeholder="maria@email.com"
                    onChange={(e) => set("novoEmail", e.target.value)} />
                </Field>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Valor" required error={errors.valor}>
                <MoneyInput name="valor" value={f.valor} onValue={(v) => set("valor", v)} />
              </Field>
              <Field label="Recorrência">
                <Select name="recorrencia" value={f.recorrencia} onValue={(v) => set("recorrencia", v)}>
                  <SelectItem value="recorrente">Todo mês</SelectItem>
                  <SelectItem value="pontual">Só neste mês ({ym})</SelectItem>
                </Select>
              </Field>
            </div>

            <Button type="submit" className="w-full sm:w-auto" loading={submitting}>
              <Plus size={16} /> Combinar valor
            </Button>
          </form>
        </div>
      </Modal>

      <RatearModal
        open={!!rateando}
        onClose={() => setRateando(null)}
        linha={rateando?.linha}
        campo={rateando?.campo}
        onSaved={reload}
      />
    </>
  );
}

// ── Convites recebidos ───────────────────────────────────────────────────────
export function ConvitesBanner({ onRespondido }) {
  const { dado: convites, recarregar } = useAsync(() => api.getMeusConvites(), "convites", {
    inicial: [],
  });
  const [erro, setErro] = useState("");

  async function responder(id, aceitar) {
    setErro("");
    try {
      await (aceitar ? api.aceitarConvite(id) : api.recusarConvite(id));
      recarregar();
      await onRespondido?.();
    } catch (e) {
      setErro(erroDe(e));
    }
  }

  // Sem skeleton de propósito: o normal é NÃO ter convite, e um banner fantasma
  // em todo carregamento seria pior que a espera. Os botões seguram o clique
  // repetido sozinhos (Button fica pendente enquanto a Promise não volta) — era
  // o que fazia o "aceitar" ir duas vezes e a segunda voltar 422.
  if (convites.length === 0) return null;

  // Aviso, não alarme: superfície âmbar pálida com borda, tinta normal.
  return (
    <section aria-label="Convites recebidos"
             className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
        <Mail size={16} className="text-amber-400" aria-hidden />
        {convites.length === 1 ? "Um convite esperando você" : `${convites.length} convites esperando você`}
      </h2>
      <p className="mt-0.5 text-[13px] text-slate-400">Aceitando, você passa a ver o que essa pessoa dividiu com você.</p>
      <FormError>{erro}</FormError>
      <ul className="mt-3 divide-y divide-amber-500/15">
        {convites.map((cv) => (
          <li key={cv.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-1 last:pb-0">
            <Avatar nome={cv.dono.nome} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink">
                <span className="font-semibold">{cv.dono.nome}</span> quer dividir despesas com você
              </p>
              <p className="text-[13px] text-slate-500">Te chamou de “{cv.comoMeChamou}”</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => responder(cv.id, false)}><X size={15} /> Recusar</Button>
              <Button size="sm" onClick={() => responder(cv.id, true)}><Check size={15} /> Aceitar</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── Agenda de contatos (dono) ────────────────────────────────────────────────
// `onResumo` (opcional) recebe a contagem da agenda — a tela Pessoas usa pra
// escrever a frase do título sem fazer uma segunda leitura.
export function Contatos({ onResumo }) {
  const {
    dado: contatos,
    carregando,
    erro: erroCarga,
    revalidando: revalidandoContatos,
    recarregar,
  } = useAsync(() => api.getContatos(), "contatos", { inicial: [] });
  const [erro, setErro] = useState("");
  const [linkDe, setLinkDe] = useState(null); // { contatoId, link }
  const [copiado, setCopiado] = useState(false);
  const [novo, setNovo] = useState({ nome: "", email: "" });
  // O submit do form não passa pelo onClick do Button (quem submete é o form),
  // então a pendência do "Adicionar" é explícita. Sem isso o Enter/clique
  // repetido criava a mesma pessoa N vezes — era o bug mais visível da aba.
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (carregando) return;
    onResumo?.({
      total: contatos.length,
      convidados: contatos.filter((c) => c.status === "convidado").length,
      ativos: contatos.filter((c) => c.status === "ativo").length,
    });
  }, [carregando, contatos, onResumo]);

  async function criar(e) {
    e.preventDefault();
    setErro("");
    if (salvando) return;
    if (!novo.nome.trim()) return setErro("Informe o nome.");
    if (novo.email.trim() && !emailValido(novo.email)) return setErro("Email inválido.");
    setSalvando(true);
    try {
      await api.addContato({ nome: novo.nome.trim(), email: novo.email.trim() || null });
      setNovo({ nome: "", email: "" });
      recarregar();
    } catch (e) {
      setErro(erroDe(e));
    } finally {
      setSalvando(false);
    }
  }

  async function convidar(c) {
    setErro("");
    try {
      const cv = await api.criarConvite(c.id, {});
      setCopiado(false);
      setLinkDe({ contatoId: c.id, link: `${window.location.origin}${cv.link}` });
      recarregar();
    } catch (e) {
      setErro(erroDe(e));
    }
  }

  async function copiar() {
    try {
      await navigator.clipboard?.writeText(linkDe.link);
      setCopiado(true);
    } catch {
      // clipboard bloqueado: o campo segue selecionável pra copiar à mão
    }
  }

  async function remover(id) {
    setErro("");
    try {
      await api.removeContato(id);
      recarregar();
    } catch (e) {
      setErro(erroDe(e));
    }
  }

  return (
    <Card className="p-5 sm:p-6">
      <CardHeader
        as="h2"
        title="Agenda"
        description="Quem divide despesas com você. Só quem aceitou o convite enxerga o que foi dividido."
        action={revalidandoContatos && <Spinner className="h-3.5 w-3.5 text-slate-500" />}
      />
      <div className="mt-4 space-y-3">
        <FormError>{erro || erroCarga}</FormError>

        {carregando ? (
          <SkeletonList rows={3} height="h-14" label="Carregando a agenda" />
        ) : contatos.length === 0 ? (
          <EmptyState compact title="Ninguém na agenda ainda"
            description="Adicione quem divide contas com você. O email é opcional: dá pra convidar depois." />
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {contatos.map((c) => {
              const st = STATUS[c.status] ?? STATUS.local;
              return (
                <li key={c.id} className="py-3 first:pt-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Avatar nome={c.nome} />
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
                        <span className="truncate">{c.nome}</span>
                        {c.reciproco && <Badge tone="neutral">Recíproco</Badge>}
                      </p>
                      <p className="truncate text-[13px] text-slate-500">{c.email || "Sem email"}</p>
                    </div>
                    {/* no celular status + ações descem pra uma 2ª linha, alinhada ao nome */}
                    <div className="flex basis-full items-center gap-2 pl-12 sm:basis-auto sm:pl-0">
                      <Badge tone={st.tone}>{st.label}</Badge>
                      <span className="flex-1 sm:hidden" />
                      {c.status !== "ativo" && (
                        <Button variant="secondary" size="sm" onClick={() => convidar(c)}>
                          <Mail size={14} /> {c.status === "convidado" ? "Reenviar" : "Convidar"}
                        </Button>
                      )}
                      <IconButton tone="danger" onClick={() => remover(c.id)} aria-label={`Remover ${c.nome}`}>
                        <Trash2 size={15} />
                      </IconButton>
                    </div>
                  </div>
                  {linkDe?.contatoId === c.id && (
                    // não existe envio de email no projeto: o link é copiado à mão
                    <div className="mt-3 sm:pl-12">
                      <div className="flex">
                        <label className="relative flex min-w-0 flex-1 items-center">
                          <span className="sr-only">Link do convite de {c.nome}</span>
                          <Link2 size={14} className="pointer-events-none absolute left-3 text-slate-500" aria-hidden />
                          <input readOnly value={linkDe.link} onFocus={(e) => e.target.select()}
                            className="h-9 w-full min-w-0 rounded-l-xl border border-r-0 border-[var(--color-line-strong)] bg-[var(--color-bg)] pl-9 pr-3 text-[13px] text-slate-300 outline-none focus:border-blue-500" />
                        </label>
                        <button type="button" onClick={copiar}
                          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-r-xl border border-[var(--color-line-strong)] px-3 text-[13px] font-medium text-ink transition-colors hover:bg-veu/[0.06] cursor-pointer">
                          {copiado ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar</>}
                        </button>
                      </div>
                      <p className="mt-1.5 text-xs text-slate-500">Mande esse link pra {c.nome}. Não enviamos email.</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <form onSubmit={criar} className="mt-4 border-t border-[var(--color-line)] pt-5" noValidate>
        <p className="mb-3 text-sm font-medium text-ink">Adicionar pessoa</p>
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Field label="Nome">
            <TextInput name="nome" value={novo.nome} placeholder="Maria" autoComplete="off"
              onChange={(e) => setNovo((v) => ({ ...v, nome: e.target.value }))} />
          </Field>
          <Field label="Email (opcional)">
            <TextInput name="email" type="email" value={novo.email} placeholder="maria@email.com" autoComplete="off"
              onChange={(e) => setNovo((v) => ({ ...v, email: e.target.value }))} />
          </Field>
          <Button type="submit" loading={salvando}>
            {salvando ? "Adicionando…" : <><UserPlus size={15} /> Adicionar</>}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ── Painel "O que devo" ──────────────────────────────────────────────────────
const SEM_DEVIDO = { donos: [], orfas: [] };

// `onTotal` (opcional): devolve o total devido no mês pra frase do título da
// tela Pessoas. `vazio` decide o que mostrar quando não há dívida: no Início e
// em Despesas o painel some (null); em Pessoas ele mantém o quadro.
export function MeusCompartilhamentos({ ym, onTotal, vazio = null }) {
  const { espacos, refresh } = useFinance();
  const {
    dado: dados,
    carregando,
    erro: erroCarga,
    revalidando,
    recarregar,
  } = useAsync(() => api.getMeusCompartilhamentos(ym), ["devido", ym], { inicial: SEM_DEVIDO });
  const [erro, setErro] = useState("");
  const [acao, setAcao] = useState(null); // { linha, modo: "adotar"|"adiantar" }

  const total = dados.donos.reduce((t, d) => t + (d.devidoMes || 0), 0);
  useEffect(() => {
    if (!carregando) onTotal?.(total);
  }, [carregando, total, onTotal]);

  async function roda(fn) {
    setErro("");
    try {
      await fn();
      recarregar();
      await refresh();
    } catch (e) {
      setErro(erroDe(e));
    }
  }

  const titulo = "O que devo";
  const subtitulo = `Divisões que outras pessoas fizeram com você em ${fmtMonthLabel(ym).toLowerCase()}`;

  // Este painel é a leitura mais cara do app (cruza contatos, shares, adoções e
  // adiantamentos). Sem skeleton ele ficava indistinguível de "não devo nada"
  // por vários segundos e depois aparecia empurrando a página.
  if (carregando) {
    return (
      <Card className="p-5 sm:p-6">
        <CardHeader as="h2" title={titulo} description={subtitulo} />
        <SkeletonList className="mt-4" rows={2} height="h-20" label="Carregando o que você deve" />
      </Card>
    );
  }
  if (erroCarga && dados.donos.length === 0 && dados.orfas.length === 0) {
    return (
      <Card className="p-5 sm:p-6">
        <CardHeader as="h2" title={titulo} description={subtitulo} />
        <div className="mt-4 space-y-3">
          <FormError>{erroCarga}</FormError>
          <Button variant="secondary" size="sm" onClick={recarregar}><RefreshCw size={14} /> Tentar de novo</Button>
        </div>
      </Card>
    );
  }
  if (dados.donos.length === 0 && dados.orfas.length === 0) {
    if (!vazio) return null;
    return (
      <Card className="p-5 sm:p-6">
        <CardHeader as="h2" title={titulo} description={subtitulo} />
        <EmptyState compact className="mt-4" title={vazio}
          description="Quando alguém dividir uma despesa com você e você aceitar o convite, ela aparece aqui." />
      </Card>
    );
  }

  return (
    <Card className="p-5 sm:p-6">
      <CardHeader
        as="h2"
        title={titulo}
        description={subtitulo}
        action={
          <span className="flex items-center gap-2">
            {revalidando && <Spinner className="h-3.5 w-3.5 text-slate-500" />}
            <span className="text-right">
              <span className="block text-xs text-slate-500">Total no mês</span>
              <span className="tnum block text-xl font-semibold text-ink">{fmtMoney(total)}</span>
            </span>
          </span>
        }
      />
      <FormError>{erro}</FormError>

      <div className="mt-5 space-y-6">
        {dados.donos.map((d) => (
          <section key={d.dono.id} aria-label={`O que devo a ${d.dono.nome}`}>
            <div className="flex items-center gap-3">
              <Avatar nome={d.dono.nome} />
              <p className="min-w-0 flex-1 truncate font-semibold text-ink">{d.dono.nome}</p>
              <p className="tnum font-semibold text-ink">{fmtMoney(d.devidoMes)}</p>
            </div>

            <div className="mt-3 space-y-3 sm:pl-12">
              {d.grupos.map((g) => {
                const a = acento(g.cartao?.cor ?? "slate");
                return (
                  <div key={g.chave} className="rounded-xl border border-[var(--color-line)]">
                    <div className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-3.5 py-2.5">
                      <p className="flex min-w-0 items-center gap-2 text-[13px] font-medium text-slate-300">
                        {g.cartao && <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ backgroundColor: a.dot }} />}
                        <span className="truncate">{g.titulo}</span>
                      </p>
                      <p className="tnum text-[13px] text-slate-400">{fmtMoney(g.devidoMes)}</p>
                    </div>

                    <ul className="divide-y divide-[var(--color-line)]">
                      {g.linhas.map((l) => (
                        <li key={l.id} className={`px-3.5 py-3 ${l.divergente ? "bg-amber-500/[0.06]" : ""}`}>
                          <div className={`flex items-start justify-between gap-3 ${l.ignorado ? "opacity-50" : ""}`}>
                            <div className="min-w-0">
                              <p className="truncate text-sm text-ink">
                                {l.linhaDescricao ?? (l.tipo === "valor" ? "Valor combinado" : "Linha")}
                                {l.parcela && (
                                  <span className="tnum text-slate-500"> · {l.parcela.parcelaAtual}/{l.parcela.totalParcelas}</span>
                                )}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                                {l.adocao && l.adocao.modo !== "ignorado" && <Badge tone="pos">No seu orçamento</Badge>}
                                {l.ignorado && <Badge tone="neutral">Ignorado</Badge>}
                                {l.quitadoAte && <span className="text-emerald-400">Pago até {l.quitadoAte}</span>}
                                {l.comprometido > 0 && (
                                  <span className="tnum">Parcelas futuras {fmtMoney(l.comprometido)}</span>
                                )}
                              </div>
                            </div>
                            <span className="tnum shrink-0 text-sm font-medium text-ink">
                              {l.valorMes === 0 && l.valorCheio > 0 ? (
                                <span className="text-emerald-400">Adiantado</span>
                              ) : (
                                fmtMoney(l.valorMes)
                              )}
                            </span>
                          </div>

                          {l.divergente && (
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-amber-300">
                              <AlertTriangle size={14} aria-hidden />
                              O valor mudou pra <span className="tnum font-medium">{fmtMoney(l.valorCheio)}</span>
                              <AcaoMini icon={RefreshCw} onClick={() => roda(() => api.sincronizarShare(l.id, ym))}>
                                Atualizar
                              </AcaoMini>
                            </div>
                          )}

                          <div className="-ml-2 mt-1.5 flex flex-wrap gap-0.5">
                            {!l.adocao && (
                              <>
                                <AcaoMini icon={CalendarCheck} onClick={() => setAcao({ linha: l, modo: "adotar" })}>
                                  Virar despesa
                                </AcaoMini>
                                <AcaoMini icon={EyeOff} onClick={() => roda(() => api.ignorarShare(l.id, ym))}>
                                  Ignorar
                                </AcaoMini>
                              </>
                            )}
                            {l.adocao && (
                              <AcaoMini icon={Trash2} onClick={() => roda(() => api.desfazerAdocao(l.id, false))}>
                                Desfazer
                              </AcaoMini>
                            )}
                            {l.parcela && l.parcela.restantes > 0 && (
                              <AcaoMini icon={HandCoins} onClick={() => setAcao({ linha: l, modo: "adiantar" })}>
                                Adiantar
                              </AcaoMini>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>

                    {g.comprometido > 0 && (
                      <p className="tnum flex items-center gap-1.5 border-t border-[var(--color-line)] px-3.5 py-2 text-xs text-slate-500">
                        <Users size={13} aria-hidden /> Parcelas futuras: {fmtMoney(g.comprometido)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {dados.orfas.length > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <AlertTriangle size={15} className="text-amber-400" aria-hidden /> Compartilhamento removido pelo dono
            </p>
            <p className="mt-0.5 text-[13px] text-slate-400">
              A despesa continua na sua conta, porque ela é sua. Apague se não valer mais.
            </p>
            <ul className="mt-3 divide-y divide-amber-500/15">
              {dados.orfas.map((o) => (
                <li key={o.shareId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm text-ink">
                  <span className="min-w-0 truncate">{o.descricao ?? "Despesa adotada"}</span>
                  <div className="flex shrink-0 gap-0.5">
                    <AcaoMini icon={Trash2} onClick={() => roda(() => api.desfazerAdocao(o.shareId, true))}>
                      Excluir despesa
                    </AcaoMini>
                    <AcaoMini icon={X} onClick={() => roda(() => api.desfazerAdocao(o.shareId, false))}>
                      Só dispensar
                    </AcaoMini>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {acao?.modo === "adotar" && (
        <AdotarModal
          onClose={() => setAcao(null)}
          linha={acao.linha}
          espacos={espacos}
          ym={ym}
          onDone={() => { setAcao(null); recarregar(); refresh(); }}
        />
      )}
      {acao?.modo === "adiantar" && (
        <AdiantarModal
          onClose={() => setAcao(null)}
          linha={acao.linha}
          ym={ym}
          onDone={() => { setAcao(null); recarregar(); refresh(); }}
        />
      )}
    </Card>
  );
}

// Ação de texto da linha: pequena, mas com área de toque de botão. Fica em
// tinta (não cinza apagado) — é o que a linha pede pra fazer.
function AcaoMini({ icon: Icon, children, onClick }) {
  const [pendente, clique] = usePendenteDoClique(onClick);
  return (
    <button type="button" onClick={clique} disabled={pendente} aria-busy={pendente ? true : undefined}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-slate-300 transition-colors cursor-pointer hover:bg-veu/[0.07] hover:text-ink disabled:opacity-50">
      {pendente ? <Spinner className="h-3.5 w-3.5" /> : <Icon size={14} aria-hidden />} {children}
    </button>
  );
}

// Virar despesa na conta de quem deve: fixa (segue as parcelas até o fim) ou só
// neste mês.
function AdotarModal({ onClose, linha, espacos, ym, onDone }) {
  const [modo, setModo] = useState("fixa");
  const [espacoId, setEspacoId] = useState(() => espacos?.[0]?.id ?? "");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!espacoId) return setErro("Escolha a página de despesas.");
    setSalvando(true);
    setErro("");
    try {
      await api.adotarShare(linha.id, { modo, espacoId, ym });
      onDone();
    } catch (e) {
      setErro(erroDe(e));
    } finally {
      setSalvando(false);
    }
  }

  if (!linha) return null;
  return (
    <Modal open onClose={onClose} title="Virar despesa minha"
           description="A linha entra no seu orçamento e some sozinha na última parcela.">
      <div className="space-y-4">
        <FormError>{erro}</FormError>
        <p className="text-sm text-slate-400">
          {linha.linhaDescricao ?? "Valor combinado"} · <span className="tnum">{fmtMoney(linha.valorCheio)}</span>
          {linha.parcela ? ` · ${linha.parcela.parcelaAtual}/${linha.parcela.totalParcelas}` : ""}
        </p>
        <Field label="Como lançar">
          <Select name="modo" value={modo} onValue={setModo}>
            <SelectItem value="fixa">
              Despesa fixa{linha.parcela ? " (segue as parcelas e some no fim)" : " (todo mês)"}
            </SelectItem>
            <SelectItem value="mes">Só neste mês ({ym})</SelectItem>
          </Select>
        </Field>
        <Field label="Página de despesas" required>
          <Select name="espacoId" value={espacoId} onValue={setEspacoId} placeholder="Selecione…">
            {(espacos ?? []).map((e) => (
              <SelectItem key={e.id} value={e.id}>{e.emoji} {e.nome}</SelectItem>
            ))}
          </Select>
        </Field>
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-line)] pt-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} loading={salvando}>
            <CalendarCheck size={16} /> Lançar na minha conta
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Adiantar N parcelas: zera o devido nos meses cobertos e, se a linha já virou
// fixa aqui, marca esses meses como pagos.
function AdiantarModal({ onClose, linha, ym, onDone }) {
  const [parcelas, setParcelas] = useState(1);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setSalvando(true);
    setErro("");
    try {
      await api.adiantarShare(linha.id, { parcelas, ym });
      onDone();
    } catch (e) {
      setErro(erroDe(e));
    } finally {
      setSalvando(false);
    }
  }

  if (!linha) return null;
  const max = linha.parcela?.restantes ? linha.parcela.restantes + 1 : 12;
  return (
    <Modal open onClose={onClose} title="Adiantar parcelas"
           description="Zera o devido nos meses que você cobrir.">
      <div className="space-y-4">
        <FormError>{erro}</FormError>
        <p className="text-sm text-slate-400">
          {linha.linhaDescricao ?? "Valor combinado"} · <span className="tnum">{fmtMoney(linha.valorCheio)}</span> por mês
          {linha.parcela ? ` · faltam ${linha.parcela.restantes}` : ""}
        </p>
        <Field label="Quantas parcelas" hint={`Total de ${fmtMoney(linha.valorCheio * (parcelas || 0))}`}>
          <NumberInput name="parcelas" value={parcelas} min={1} max={max} onValue={setParcelas} />
        </Field>
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-line)] pt-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={salvar} loading={salvando}>
            <HandCoins size={16} /> Adiantar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
