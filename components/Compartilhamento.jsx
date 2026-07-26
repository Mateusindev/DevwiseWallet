import { useCallback, useEffect, useState } from "react";
import { Users, Trash2, Plus, HandCoins } from "lucide-react";
import { Card, Button, Modal, Field, TextInput, Select, MoneyInput } from "./ui/primitives.jsx";
import { fmtMoney } from "../lib/format.js";
import { acento } from "../lib/calc.js";
import * as api from "../services/financeApi";

// ── Modal: compartilhar fatura de um cartão ────────────────────────────────────
// O form vive DENTRO do Modal: fechado, o Modal não renderiza os filhos, então o
// estado morre junto e reabrir já vem limpo. É o que substitui o efeito que
// resetava os campos (setState em cascata dentro de efeito).
export function CompartilharModal({ open, onClose, cartao, ym }) {
  if (!cartao) return null;
  return (
    <Modal open={open} onClose={onClose} title={`Compartilhar · ${cartao.nome}`}>
      <CompartilharForm cartao={cartao} ym={ym} />
    </Modal>
  );
}

function CompartilharForm({ cartao, ym }) {
  const [contatos, setContatos] = useState([]);
  const [linhas, setLinhas] = useState([]);
  const [shares, setShares] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // form
  const [contatoId, setContatoId] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [novoEmail, setNovoEmail] = useState("");
  const [tipo, setTipo] = useState("linha");
  const [linhaKey, setLinhaKey] = useState("");
  const [divisao, setDivisao] = useState("inteira");
  const [percentual, setPercentual] = useState(50);
  const [valor, setValor] = useState(0);
  const [recorrencia, setRecorrencia] = useState("recorrente");

  // Busca e aplicação separadas: chamar direto do efeito uma função que faz
  // setState é render em cascata (react-hooks/set-state-in-effect). Dentro de
  // callback de promise, não.
  const buscar = useCallback(
    () =>
      Promise.all([
        api.getContatos(),
        api.getFaturaLinhas(cartao.id, ym),
        api.getCartaoShares(cartao.id, ym),
      ]),
    [cartao.id, ym]
  );

  const aplicar = useCallback(([cs, ls, ss]) => {
    setContatos(cs);
    setLinhas(ls);
    setShares(ss);
  }, []);

  // usado depois de criar/remover share
  const reload = useCallback(() => buscar().then(aplicar), [buscar, aplicar]);

  useEffect(() => {
    let cancel = false;
    buscar()
      .then((carga) => { if (!cancel) aplicar(carga); })
      .catch(() => {});
    return () => { cancel = true; };
  }, [buscar, aplicar]);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      // resolve contato (existente ou novo)
      let cid = contatoId;
      if (cid === "__novo__" || (!cid && novoNome.trim())) {
        if (!novoNome.trim()) throw new Error("Informe o nome da pessoa.");
        const novo = await api.addContato({ nome: novoNome.trim(), email: novoEmail.trim() || null });
        cid = novo.id;
      }
      if (!cid) throw new Error("Escolha ou cadastre um contato.");

      let dto;
      if (tipo === "linha") {
        if (!linhaKey) throw new Error("Selecione uma linha da fatura.");
        const [ltipo, lid] = linhaKey.split(":");
        dto = {
          contatoId: cid,
          tipo: "linha",
          [ltipo === "fixa" ? "despesaFixaId" : "despesaMesId"]: lid,
          ...(divisao === "percentual" ? { percentual: Number(percentual) } : {}),
          ...(divisao === "valor" ? { valor: Number(valor) } : {}),
        };
      } else {
        if (!valor) throw new Error("Informe o valor.");
        dto = {
          contatoId: cid,
          tipo: "valor",
          valor: Number(valor),
          mesRef: recorrencia === "pontual" ? ym : null,
        };
      }
      await api.addCartaoShare(cartao.id, dto);
      setContatoId(cid);
      setNovoNome("");
      setNovoEmail("");
      setLinhaKey("");
      setValor(0);
      await reload();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    await api.removeCartaoShare(id);
    await reload();
  }

  return (
      <div className="space-y-5">
        {/* lista de shares existentes */}
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">Compartilhado com</p>
          {shares.length === 0 ? (
            <p className="text-sm text-slate-500">Nada compartilhado ainda.</p>
          ) : (
            shares.map((s) => {
              const nome = contatos.find((c) => c.id === s.contatoId)?.nome ?? "—";
              const desc =
                s.tipo === "valor"
                  ? `valor ${s.mesRef ? `(${s.mesRef})` : "(todo mês)"}`
                  : s.linhaDescricao ?? "linha";
              return (
                <div key={s.id} className="flex items-center justify-between rounded-xl bg-white/4 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-200">
                      {nome} · <span className="text-slate-400">{desc}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {fmtMoney(s.valorMes)} este mês
                      {s.parcela ? ` · parcela ${s.parcela.parcelaAtual}/${s.parcela.totalParcelas} · faltam ${s.parcela.restantes}` : ""}
                    </p>
                  </div>
                  <button onClick={() => remove(s.id)} aria-label="Remover"
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-500/15 hover:text-rose-400 cursor-pointer transition-colors">
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="border-t border-[var(--color-line)]" />

        {/* form novo share */}
        <form onSubmit={submit} className="space-y-4">
          <Field label="Pessoa" error={err}>
            <Select value={contatoId} onChange={(e) => setContatoId(e.target.value)}>
              <option value="">Selecione…</option>
              {contatos.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}{c.vinculado ? " ✓" : ""}</option>
              ))}
              <option value="__novo__">+ Nova pessoa</option>
            </Select>
          </Field>

          {contatoId === "__novo__" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nome">
                <TextInput value={novoNome} placeholder="Maria" onChange={(e) => setNovoNome(e.target.value)} />
              </Field>
              <Field label="Email" hint="p/ ela ver quando tiver conta">
                <TextInput value={novoEmail} placeholder="maria@email.com" onChange={(e) => setNovoEmail(e.target.value)} />
              </Field>
            </div>
          )}

          <Field label="O que compartilhar">
            <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="linha">Uma linha da fatura</option>
              <option value="valor">Um valor da fatura</option>
            </Select>
          </Field>

          {tipo === "linha" ? (
            <>
              <Field label="Linha">
                <Select value={linhaKey} onChange={(e) => setLinhaKey(e.target.value)}>
                  <option value="">Selecione…</option>
                  {linhas.map((l) => (
                    <option key={`${l.tipo}:${l.id}`} value={`${l.tipo}:${l.id}`}>
                      {l.descricao} · {fmtMoney(l.valor)}
                      {l.parcelado ? ` (${l.parcelaAtual}/${l.totalParcelas})` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Quanto dessa linha">
                <Select value={divisao} onChange={(e) => setDivisao(e.target.value)}>
                  <option value="inteira">Linha inteira (100%)</option>
                  <option value="percentual">Percentual</option>
                  <option value="valor">Valor fixo por mês</option>
                </Select>
              </Field>
              {divisao === "percentual" && (
                <Field label="Percentual (%)">
                  <TextInput type="number" min={1} max={100} value={percentual}
                             onChange={(e) => setPercentual(e.target.value)} />
                </Field>
              )}
              {divisao === "valor" && (
                <Field label="Valor por mês">
                  <MoneyInput value={valor} onValue={setValor} />
                </Field>
              )}
            </>
          ) : (
            <>
              <Field label="Valor">
                <MoneyInput value={valor} onValue={setValor} />
              </Field>
              <Field label="Recorrência">
                <Select value={recorrencia} onChange={(e) => setRecorrencia(e.target.value)}>
                  <option value="recorrente">Todo mês</option>
                  <option value="pontual">Só neste mês ({ym})</option>
                </Select>
              </Field>
            </>
          )}

          <Button type="submit" className="w-full" loading={busy}>
            <Plus size={16} /> Compartilhar
          </Button>
        </form>
      </div>
  );
}

// ── Painel "O que devo" (pessoa compartilhada) ──────────────────────────────────
export function MeusCompartilhamentos({ ym }) {
  const [grupos, setGrupos] = useState([]);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let cancel = false;
    // O catch é obrigatório (rejeição solta polui o console e derruba a suíte),
    // mas não pode virar "não devo nada": guarda a mensagem pra mostrar no painel.
    api.getMeusCompartilhamentos(ym)
      .then((gs) => { if (!cancel) { setGrupos(gs); setErro(""); } })
      .catch((e) => { if (!cancel) { setGrupos([]); setErro(e?.message || "Falha ao carregar"); } });
    return () => { cancel = true; };
  }, [ym]);

  if (erro) {
    return (
      <Card className="p-5 sm:p-6">
        <h3 className="mb-2 flex items-center gap-2 text-base font-semibold text-white">
          <HandCoins size={18} /> O que devo
        </h3>
        <p role="alert" className="text-sm text-rose-400">
          Não consegui carregar o que você deve. {erro}
        </p>
      </Card>
    );
  }

  if (grupos.length === 0) return null;

  return (
    <Card className="p-5 sm:p-6">
      <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-white">
        <HandCoins size={18} /> O que devo
      </h3>
      <div className="space-y-4">
        {grupos.map((g) => {
          const a = acento(g.cartao.cor);
          return (
            <div key={g.cartao.id} className="rounded-xl bg-white/4 p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white" style={{ color: a.dot }}>{g.cartao.nome}</p>
                  {g.dono?.nome && <p className="truncate text-xs text-slate-500">fatura de {g.dono.nome}</p>}
                </div>
                <p className="tnum text-sm font-bold text-rose-400">{fmtMoney(g.devidoMes)}</p>
              </div>
              <ul className="space-y-1 text-xs text-slate-400">
                {g.linhas.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {l.linhaDescricao ?? (l.tipo === "valor" ? "Valor combinado" : "Linha")}
                      {l.parcela ? ` · ${l.parcela.parcelaAtual}/${l.parcela.totalParcelas} (faltam ${l.parcela.restantes})` : ""}
                    </span>
                    <span className="tnum text-slate-300">{fmtMoney(l.valorMes)}</span>
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
    </Card>
  );
}
