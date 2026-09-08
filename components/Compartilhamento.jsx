import { useEffect, useState } from "react";
import { Users, Trash2, Plus, HandCoins } from "lucide-react";
import { Card, Button, Modal, Field, TextInput, MoneyInput } from "./ui/primitives.jsx";
import { Select, SelectItem, NumberInput } from "./ui/fields.jsx";
import { fmtMoney } from "../lib/format.js";
import { acento } from "../lib/calc.js";
import * as api from "../services/financeApi";

// ── Modal: compartilhar fatura de um cartão ────────────────────────────────────
export function CompartilharModal({ open, onClose, cartao, ym }) {
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

  async function reload() {
    if (!cartao) return;
    const [cs, ls, ss] = await Promise.all([
      api.getContatos(),
      api.getFaturaLinhas(cartao.id, ym),
      api.getCartaoShares(cartao.id, ym),
    ]);
    setContatos(cs);
    setLinhas(ls);
    setShares(ss);
  }

  useEffect(() => {
    if (open) {
      reload();
      setErr("");
      setContatoId("");
      setNovoNome("");
      setNovoEmail("");
      setTipo("linha");
      setLinhaKey("");
      setDivisao("inteira");
    }
  }, [open, cartao?.id, ym]);

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

  if (!cartao) return null;

  return (
    <Modal open={open} onClose={onClose} title={`Compartilhar · ${cartao.nome}`}>
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
            <Select value={contatoId} onValue={setContatoId} placeholder="Selecione…">
              {contatos.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.nome}{c.vinculado ? " ✓" : ""}</SelectItem>
              ))}
              <SelectItem value="__novo__">+ Nova pessoa</SelectItem>
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
            <Select value={tipo} onValue={setTipo}>
              <SelectItem value="linha">Uma linha da fatura</SelectItem>
              <SelectItem value="valor">Um valor da fatura</SelectItem>
            </Select>
          </Field>

          {tipo === "linha" ? (
            <>
              <Field label="Linha">
                <Select value={linhaKey} onValue={setLinhaKey} placeholder="Selecione…">
                  {linhas.map((l) => (
                    <SelectItem key={`${l.tipo}:${l.id}`} value={`${l.tipo}:${l.id}`}>
                      {l.descricao} · {fmtMoney(l.valor)}
                      {l.parcelado ? ` (${l.parcelaAtual}/${l.totalParcelas})` : ""}
                    </SelectItem>
                  ))}
                </Select>
              </Field>
              <Field label="Quanto dessa linha">
                <Select value={divisao} onValue={setDivisao}>
                  <SelectItem value="inteira">Linha inteira (100%)</SelectItem>
                  <SelectItem value="percentual">Percentual</SelectItem>
                  <SelectItem value="valor">Valor fixo por mês</SelectItem>
                </Select>
              </Field>
              {divisao === "percentual" && (
                <Field label="Percentual (%)">
                  <NumberInput value={percentual} min={1} max={100} onValue={setPercentual} />
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
                <Select value={recorrencia} onValue={setRecorrencia}>
                  <SelectItem value="recorrente">Todo mês</SelectItem>
                  <SelectItem value="pontual">Só neste mês ({ym})</SelectItem>
                </Select>
              </Field>
            </>
          )}

          <Button type="submit" className="w-full" loading={busy}>
            <Plus size={16} /> Compartilhar
          </Button>
        </form>
      </div>
    </Modal>
  );
}

// ── Painel "O que devo" (pessoa compartilhada) ──────────────────────────────────
export function MeusCompartilhamentos({ ym }) {
  const [grupos, setGrupos] = useState([]);

  useEffect(() => {
    api.getMeusCompartilhamentos(ym).then(setGrupos).catch(() => setGrupos([]));
  }, [ym]);

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
