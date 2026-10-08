import { useEffect, useMemo, useState } from "react";
import {
  Users, Trash2, Plus, HandCoins, Link2, Check, X, Mail, UserPlus,
  RefreshCw, EyeOff, CalendarCheck, Split, AlertTriangle,
} from "lucide-react";
import {
  Card, Button, IconButton, Modal, Field, TextInput, MoneyInput, Badge,
  Spinner, SkeletonList,
} from "./ui/primitives.jsx";
import { Select, SelectItem, NumberInput, FormError, CheckboxField } from "./ui/fields.jsx";
import { useFormState } from "./ui/useFormState.js";
import { useAsync } from "./ui/useAsync.js";
import { emailValido, texto } from "../lib/formErrors.js";
import { fmtMoney } from "../lib/format.js";
import { acento, iniciais } from "../lib/calc.js";
import { useFinance } from "../store/FinanceContext.jsx";
import * as api from "../services/financeApi";

const STATUS = {
  local: { label: "Só na agenda", tone: "text-slate-400" },
  convidado: { label: "Convite enviado", tone: "text-amber-400" },
  ativo: { label: "Aceitou", tone: "text-emerald-400" },
  recusado: { label: "Recusou", tone: "text-rose-400" },
};

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
    <span className={`inline-flex items-center gap-1 ${className}`} title={rateio.map((r) => `${r.nome}: ${fmtMoney(r.valor)}`).join(" · ")}>
      <Split size={11} className="text-slate-500" />
      {rateio.map((r) => (
        <span key={r.shareId}
          className={`grid h-5 w-5 place-items-center rounded-full text-[9px] font-bold ${
            r.status === "recusado" ? "bg-rose-500/15 text-rose-400 line-through" :
            r.status === "ativo" ? "bg-emerald-500/15 text-emerald-300" : "bg-veu/8 text-slate-300"
          }`}>
          {iniciais(r.nome)}
        </span>
      ))}
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

  return (
    <Modal open={open} onClose={onClose} title={`Dividir · ${linha.descricao}`}>
      <div className="space-y-5">
        <FormError>{erro}</FormError>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-xs">
            <span className="text-slate-500">Valor da linha</span>
            <span className="tnum font-semibold text-slate-200">{fmtMoney(base)}</span>
          </div>
          {/* barra de rateio: cada fatia + o que sobra pro dono */}
          <div className="flex h-2.5 overflow-hidden rounded-full bg-veu/8">
            {partes.map((v, i) => (
              <div key={itens[i].contatoId}
                style={{ width: `${base ? Math.min((v / base) * 100, 100) : 0}%` }}
                className={estourou ? "bg-rose-500" : "bg-blue-500"} />
            ))}
            {sobra > 0 && <div style={{ width: `${base ? (sobra / base) * 100 : 0}%` }} className="bg-emerald-500/60" />}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px]">
            <span className={estourou ? "text-rose-400" : "text-slate-400"}>
              dividido: <span className="tnum">{fmtMoney(soma)}</span>
            </span>
            <span className={sobra < 0 ? "text-rose-400" : "text-emerald-400"}>
              sobra pra você: <span className="tnum">{fmtMoney(sobra)}</span>
            </span>
          </div>
          {estourou && (
            <p className="mt-1.5 text-xs text-rose-400">A soma passa do valor da linha — ajuste antes de salvar.</p>
          )}
        </div>

        <div className="space-y-2">
          {carregando && <SkeletonList rows={2} height="h-20" label="Carregando a divisão" />}
          {!carregando && itens.length === 0 && (
            <p className="text-sm text-slate-500">Ninguém dividindo essa linha ainda.</p>
          )}
          {itens.map((i, idx) => (
            <div key={i.contatoId} className="rounded-xl bg-veu/4 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-slate-200">{nomeDe(i.contatoId)}</p>
                <div className="flex items-center gap-2">
                  <span className="tnum text-xs text-slate-400">{fmtMoney(partes[idx])}</span>
                  <button onClick={() => setItens((v) => v.filter((_, n) => n !== idx))} aria-label={`Tirar ${nomeDe(i.contatoId)}`}
                    className="rounded-lg p-1 text-slate-500 transition-colors hover:bg-rose-500/15 hover:text-rose-400 cursor-pointer">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Select name={`modo-${idx}`} value={i.modo} onValue={(v) => patchItem(idx, { modo: v })}>
                  <SelectItem value="percentual">Percentual</SelectItem>
                  <SelectItem value="valor">Valor fixo</SelectItem>
                  <SelectItem value="inteira">Linha inteira</SelectItem>
                </Select>
                {i.modo === "percentual" && (
                  <NumberInput name={`pct-${idx}`} value={i.percentual} min={1} max={100}
                    onValue={(v) => patchItem(idx, { percentual: v })} />
                )}
                {i.modo === "valor" && (
                  <MoneyInput name={`val-${idx}`} value={i.valor} onValue={(v) => patchItem(idx, { valor: v })} />
                )}
              </div>
            </div>
          ))}
        </div>

        {disponiveis.length > 0 && (
          <Field label="Adicionar pessoa">
            <Select name="addPessoa" value="" onValue={addPessoa} placeholder="Escolher da agenda…">
              {disponiveis.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nome} · {STATUS[c.status]?.label ?? c.status}
                </SelectItem>
              ))}
            </Select>
          </Field>
        )}

        <div className="rounded-xl bg-veu/4 p-3">
          <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Nova pessoa</p>
          <div className="grid grid-cols-2 gap-2">
            <TextInput name="novoNome" value={novo.nome} placeholder="Nome"
              onChange={(e) => setNovo((v) => ({ ...v, nome: e.target.value }))} />
            <TextInput name="novoEmail" value={novo.email} placeholder="email (opcional)"
              onChange={(e) => setNovo((v) => ({ ...v, email: e.target.value }))} />
          </div>
          <Button variant="ghost" className="mt-2 w-full" onClick={criarContato}>
            <UserPlus size={15} /> Cadastrar e adicionar
          </Button>
        </div>

        <CheckboxField
          label="Abater da minha despesa"
          hint="O orçamento passa a contar só a sua parte. Fatura de cartão normalmente fica cheia; aluguel, não."
          checked={abate}
          onChecked={setAbate}
        />

        <Button className="w-full" onClick={salvar} loading={salvando} disabled={estourou}>
          <Check size={16} /> Salvar divisão
        </Button>
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
      <Modal open={open && !rateando} onClose={onClose} title={`Compartilhar · ${cartao.nome}`}>
        <div className="space-y-5">
          {/* linhas da fatura: cada uma pode ser dividida com N pessoas */}
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">Linhas da fatura</p>
            {linhas.length === 0 ? (
              <p className="text-sm text-slate-500">Nada nesta fatura em {ym}.</p>
            ) : (
              linhas.map((l) => {
                const divisao = porLinha(l);
                return (
                  <div key={`${l.tipo}:${l.id}`} className="flex items-center justify-between gap-2 rounded-xl bg-veu/4 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-200">{l.descricao}</p>
                      <p className="text-xs text-slate-500">
                        {fmtMoney(l.valor)}
                        {l.parcelado ? ` · ${l.parcelaAtual}/${l.totalParcelas}` : ""}
                        {divisao.length > 0
                          ? ` · dividida com ${divisao.map((s) => s.contatoNome).join(", ")}`
                          : ""}
                      </p>
                    </div>
                    <Button variant="ghost" onClick={() => setRateando({ linha: l, campo: l.tipo })}>
                      <Split size={15} /> Dividir
                    </Button>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-[var(--color-line)]" />

          {/* valor avulso da fatura (não amarra numa linha) */}
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">Valores combinados</p>
            {avulsos.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum valor avulso.</p>
            ) : (
              avulsos.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-xl bg-veu/4 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-200">
                      {s.contatoNome} · <span className="text-slate-400">{s.mesRef ? `só ${s.mesRef}` : "todo mês"}</span>
                    </p>
                    <p className="tnum text-xs text-slate-500">{fmtMoney(s.valorMes)}</p>
                  </div>
                  <button onClick={() => remove(s.id)} aria-label="Remover"
                    className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-rose-500/15 hover:text-rose-400 cursor-pointer">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            )}
          </div>

          <form onSubmit={submit} className="space-y-4" noValidate>
            <FormError>{formError}</FormError>
            <Field label="Pessoa" required error={errors.contatoId}>
              <Select name="contatoId" value={f.contatoId} onValue={(v) => set("contatoId", v)} placeholder="Selecione…">
                {contatos.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}{c.status === "ativo" ? " ✓" : ""}
                  </SelectItem>
                ))}
                <SelectItem value={NOVA_PESSOA}>+ Nova pessoa</SelectItem>
              </Select>
            </Field>

            {f.contatoId === NOVA_PESSOA && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nome" required error={errors.novoNome}>
                  <TextInput name="novoNome" value={f.novoNome} placeholder="Maria"
                    onChange={(e) => set("novoNome", e.target.value)} />
                </Field>
                <Field label="Email" hint="p/ convidar depois" error={errors.novoEmail}>
                  <TextInput name="novoEmail" value={f.novoEmail} placeholder="maria@email.com"
                    onChange={(e) => set("novoEmail", e.target.value)} />
                </Field>
              </div>
            )}

            <Field label="Valor" required error={errors.valor}>
              <MoneyInput name="valor" value={f.valor} onValue={(v) => set("valor", v)} />
            </Field>
            <Field label="Recorrência">
              <Select name="recorrencia" value={f.recorrencia} onValue={(v) => set("recorrencia", v)}>
                <SelectItem value="recorrente">Todo mês</SelectItem>
                <SelectItem value="pontual">Só neste mês ({ym})</SelectItem>
              </Select>
            </Field>

            <Button type="submit" className="w-full" loading={submitting}>
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

  return (
    <Card className="border-amber-500/30 bg-amber-500/[0.06] p-4 sm:p-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-300">
        <Mail size={16} /> {convites.length === 1 ? "Um convite esperando você" : `${convites.length} convites esperando você`}
      </h3>
      <FormError>{erro}</FormError>
      <div className="space-y-2">
        {convites.map((cv) => (
          <div key={cv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-veu/4 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm text-slate-200">
                <span className="font-medium">{cv.dono.nome}</span> quer dividir despesas com você
              </p>
              <p className="text-xs text-slate-500">te chamou de “{cv.comoMeChamou}”</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => responder(cv.id, true)}><Check size={15} /> Aceitar</Button>
              <Button variant="ghost" onClick={() => responder(cv.id, false)}><X size={15} /> Recusar</Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Agenda de contatos (dono) ────────────────────────────────────────────────
export function Contatos() {
  const {
    dado: contatos,
    carregando,
    erro: erroCarga,
    revalidando: revalidandoContatos,
    recarregar,
  } = useAsync(() => api.getContatos(), "contatos", { inicial: [] });
  const [erro, setErro] = useState("");
  const [linkDe, setLinkDe] = useState(null); // { contatoId, link }
  const [novo, setNovo] = useState({ nome: "", email: "" });
  // O submit do form não passa pelo onClick do Button (quem submete é o form),
  // então a pendência do "Adicionar" é explícita. Sem isso o Enter/clique
  // repetido criava a mesma pessoa N vezes — era o bug mais visível da aba.
  const [salvando, setSalvando] = useState(false);

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
      setLinkDe({ contatoId: c.id, link: `${window.location.origin}${cv.link}` });
      recarregar();
    } catch (e) {
      setErro(erroDe(e));
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
      <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-ink">
        <Users size={18} /> Pessoas
        {revalidandoContatos && <Spinner className="h-3.5 w-3.5 border-slate-500/40 border-t-slate-300" />}
      </h3>
      <FormError>{erro || erroCarga}</FormError>

      <div className="space-y-2">
        {carregando ? (
          <SkeletonList rows={3} height="h-16" label="Carregando a agenda" />
        ) : (
          contatos.length === 0 && <p className="text-sm text-slate-500">Nenhuma pessoa na agenda ainda.</p>
        )}
        {!carregando && contatos.map((c) => {
          const st = STATUS[c.status] ?? STATUS.local;
          return (
            <div key={c.id} className="rounded-xl bg-veu/4 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate text-sm font-medium text-slate-200">
                    {c.nome}
                    {c.reciproco && <Badge className="text-[10px]">recíproco</Badge>}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {c.email || "sem email"} · <span className={st.tone}>{st.label}</span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {c.status !== "ativo" && (
                    <Button variant="ghost" onClick={() => convidar(c)}>
                      <Mail size={15} /> {c.status === "convidado" ? "Reenviar" : "Convidar"}
                    </Button>
                  )}
                  <IconButton tone="danger" onClick={() => remover(c.id)} aria-label={`Remover ${c.nome}`}>
                    <Trash2 size={15} />
                  </IconButton>
                </div>
              </div>
              {linkDe?.contatoId === c.id && (
                // não existe envio de email no projeto: o link é copiado à mão
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-veu/10 px-2 py-1.5">
                  <Link2 size={13} className="shrink-0 text-slate-500" />
                  <input readOnly value={linkDe.link} onFocus={(e) => e.target.select()}
                    className="min-w-0 flex-1 bg-transparent text-xs text-slate-300 outline-none" />
                  <button onClick={() => navigator.clipboard?.writeText(linkDe.link)}
                    className="shrink-0 rounded-md bg-veu/8 px-2 py-1 text-[11px] text-slate-200 cursor-pointer hover:bg-veu/15">
                    copiar
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <form onSubmit={criar} className="mt-4 space-y-2 border-t border-[var(--color-line)] pt-4">
        <div className="grid grid-cols-2 gap-2">
          <TextInput name="nome" value={novo.nome} placeholder="Nome"
            onChange={(e) => setNovo((v) => ({ ...v, nome: e.target.value }))} />
          <TextInput name="email" value={novo.email} placeholder="email (opcional)"
            onChange={(e) => setNovo((v) => ({ ...v, email: e.target.value }))} />
        </div>
        <Button type="submit" variant="ghost" className="w-full" loading={salvando}>
          {salvando ? "Adicionando…" : <><UserPlus size={15} /> Adicionar</>}
        </Button>
      </form>
    </Card>
  );
}

// ── Painel "O que devo" ──────────────────────────────────────────────────────
const SEM_DEVIDO = { donos: [], orfas: [] };

export function MeusCompartilhamentos({ ym }) {
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

  // Este painel é a leitura mais cara do app (cruza contatos, shares, adoções e
  // adiantamentos). Sem skeleton ele ficava indistinguível de "não devo nada"
  // por vários segundos e depois aparecia empurrando a página.
  if (carregando) {
    return (
      <Card className="p-5 sm:p-6">
        <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-ink">
          <HandCoins size={18} /> O que devo
        </h3>
        <SkeletonList rows={2} height="h-20" label="Carregando o que você deve" />
      </Card>
    );
  }
  if (erroCarga && dados.donos.length === 0 && dados.orfas.length === 0) {
    return (
      <Card className="p-5 sm:p-6">
        <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-ink">
          <HandCoins size={18} /> O que devo
        </h3>
        <FormError>{erroCarga}</FormError>
        <Button variant="ghost" onClick={recarregar}><RefreshCw size={15} /> Tentar de novo</Button>
      </Card>
    );
  }
  if (dados.donos.length === 0 && dados.orfas.length === 0) return null;

  return (
    <Card className="p-5 sm:p-6">
      <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-ink">
        <HandCoins size={18} /> O que devo
        {revalidando && <Spinner className="h-3.5 w-3.5 border-slate-500/40 border-t-slate-300" />}
      </h3>
      <FormError>{erro}</FormError>

      <div className="space-y-5">
        {dados.donos.map((d) => (
          <div key={d.dono.id}>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <p className="truncate font-semibold text-ink">{d.dono.nome}</p>
              <p className="tnum text-sm font-bold text-rose-400">{fmtMoney(d.devidoMes)}</p>
            </div>

            <div className="space-y-3">
              {d.grupos.map((g) => {
                const a = acento(g.cartao?.cor ?? "slate");
                return (
                  <div key={g.chave} className="rounded-xl bg-veu/4 p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium" style={g.cartao ? { color: a.dot } : undefined}>
                        {g.titulo}
                      </p>
                      <p className="tnum text-xs text-slate-400">{fmtMoney(g.devidoMes)}</p>
                    </div>

                    <ul className="space-y-2">
                      {g.linhas.map((l) => (
                        <li key={l.id} className={`rounded-lg px-2 py-1.5 ${l.ignorado ? "opacity-45" : ""} ${l.divergente ? "bg-amber-500/[0.08]" : ""}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-xs text-slate-300">
                              {l.linhaDescricao ?? (l.tipo === "valor" ? "Valor combinado" : "Linha")}
                              {l.parcela ? ` · ${l.parcela.parcelaAtual}/${l.parcela.totalParcelas}` : ""}
                            </span>
                            <span className="tnum shrink-0 text-xs text-slate-200">
                              {l.valorMes === 0 && l.valorCheio > 0 ? (
                                <span className="text-emerald-400">adiantado</span>
                              ) : (
                                fmtMoney(l.valorMes)
                              )}
                            </span>
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {l.adocao && l.adocao.modo !== "ignorado" && (
                              <Badge className="text-[10px] text-emerald-300">no seu orçamento</Badge>
                            )}
                            {l.ignorado && <Badge className="text-[10px]">ignorado</Badge>}
                            {l.quitadoAte && (
                              <span className="text-[10px] text-emerald-400">pago até {l.quitadoAte}</span>
                            )}
                            {l.comprometido > 0 && (
                              <span className="text-[10px] text-slate-500">futuro {fmtMoney(l.comprometido)}</span>
                            )}
                          </div>

                          {l.divergente && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-amber-300">
                              <AlertTriangle size={12} />
                              o valor virou {fmtMoney(l.valorCheio)}
                              <button onClick={() => roda(() => api.sincronizarShare(l.id, ym))}
                                className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-200 cursor-pointer hover:bg-amber-500/25">
                                <RefreshCw size={11} /> atualizar
                              </button>
                            </div>
                          )}

                          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                            {!l.adocao && (
                              <>
                                <AcaoMini icon={CalendarCheck} onClick={() => setAcao({ linha: l, modo: "adotar" })}>
                                  virar despesa
                                </AcaoMini>
                                <AcaoMini icon={EyeOff} onClick={() => roda(() => api.ignorarShare(l.id, ym))}>
                                  ignorar
                                </AcaoMini>
                              </>
                            )}
                            {l.adocao && (
                              <AcaoMini icon={Trash2} onClick={() => roda(() => api.desfazerAdocao(l.id, false))}>
                                desfazer
                              </AcaoMini>
                            )}
                            {l.parcela && l.parcela.restantes > 0 && (
                              <AcaoMini icon={HandCoins} onClick={() => setAcao({ linha: l, modo: "adiantar" })}>
                                adiantar
                              </AcaoMini>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>

                    {g.comprometido > 0 && (
                      <p className="mt-2 text-[11px] text-slate-500">
                        <Users size={11} className="mr-1 inline" />
                        parcelas futuras: {fmtMoney(g.comprometido)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {dados.orfas.length > 0 && (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-300">
              <AlertTriangle size={15} /> Compartilhamento removido pelo dono
            </p>
            <p className="mb-2 text-xs text-slate-400">
              A despesa continua na sua conta — ela é sua. Apague se não valer mais.
            </p>
            <ul className="space-y-1.5">
              {dados.orfas.map((o) => (
                <li key={o.shareId} className="flex items-center justify-between gap-2 text-xs text-slate-300">
                  <span className="truncate">{o.descricao ?? "Despesa adotada"}</span>
                  <div className="flex shrink-0 gap-1.5">
                    <AcaoMini icon={Trash2} onClick={() => roda(() => api.desfazerAdocao(o.shareId, true))}>
                      excluir despesa
                    </AcaoMini>
                    <AcaoMini icon={X} onClick={() => roda(() => api.desfazerAdocao(o.shareId, false))}>
                      só dispensar
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
          onDone={() => { setAcao(null); carregar(); refresh(); }}
        />
      )}
      {acao?.modo === "adiantar" && (
        <AdiantarModal
          onClose={() => setAcao(null)}
          linha={acao.linha}
          ym={ym}
          onDone={() => { setAcao(null); carregar(); refresh(); }}
        />
      )}
    </Card>
  );
}

function AcaoMini({ icon: Icon, children, onClick }) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md bg-veu/6 px-1.5 py-0.5 text-slate-300 transition-colors cursor-pointer hover:bg-veu/12 hover:text-ink">
      <Icon size={11} /> {children}
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
    <Modal open onClose={onClose} title="Virar despesa minha">
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
        <Button className="w-full" onClick={salvar} loading={salvando}>
          <CalendarCheck size={16} /> Lançar na minha conta
        </Button>
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
    <Modal open onClose={onClose} title="Adiantar parcelas">
      <div className="space-y-4">
        <FormError>{erro}</FormError>
        <p className="text-sm text-slate-400">
          {linha.linhaDescricao ?? "Valor combinado"} · <span className="tnum">{fmtMoney(linha.valorCheio)}</span> por mês
          {linha.parcela ? ` · faltam ${linha.parcela.restantes}` : ""}
        </p>
        <Field label="Quantas parcelas" hint={`total ${fmtMoney(linha.valorCheio * (parcelas || 0))}`}>
          <NumberInput name="parcelas" value={parcelas} min={1} max={max} onValue={setParcelas} />
        </Field>
        <Button className="w-full" onClick={salvar} loading={salvando}>
          <HandCoins size={16} /> Adiantar
        </Button>
      </div>
    </Modal>
  );
}
