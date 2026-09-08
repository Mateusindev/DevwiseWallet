import { useEffect, useState } from "react";
import { Users, Trash2, Plus, HandCoins } from "lucide-react";
import { Card, Button, Modal, Field, TextInput, MoneyInput } from "./ui/primitives.jsx";
import { Select, SelectItem, NumberInput, FormError } from "./ui/fields.jsx";
import { useFormState } from "./ui/useFormState.js";
import { emailValido, texto } from "../lib/formErrors.js";
import { fmtMoney } from "../lib/format.js";
import { acento } from "../lib/calc.js";
import * as api from "../services/financeApi";

// ── Modal: compartilhar fatura de um cartão ────────────────────────────────────
export function CompartilharModal({ open, onClose, cartao, ym }) {
  const [contatos, setContatos] = useState([]);
  const [linhas, setLinhas] = useState([]);
  const [shares, setShares] = useState([]);

  const NOVA_PESSOA = "__novo__";
  const { f, set, patch, errors, formError, submitting, submit, reset } = useFormState(
    () => ({
      contatoId: "", novoNome: "", novoEmail: "", tipo: "linha", linhaKey: "",
      divisao: "inteira", percentual: 50, valor: 0, recorrencia: "recorrente",
    }),
    (f) => {
      const nova = f.contatoId === NOVA_PESSOA;
      const comValor = f.tipo === "valor" || (f.tipo === "linha" && f.divisao === "valor");
      return {
        contatoId: f.contatoId ? "" : "Escolha ou cadastre uma pessoa.",
        novoNome: nova ? texto(f.novoNome, { obrigatorio: true, max: 80, campo: "O nome" }) : "",
        novoEmail: nova && f.novoEmail.trim() && !emailValido(f.novoEmail) ? "Email inválido." : "",
        linhaKey: f.tipo === "linha" && !f.linhaKey ? "Escolha a linha da fatura." : "",
        percentual:
          f.tipo === "linha" && f.divisao === "percentual" && !(f.percentual >= 1 && f.percentual <= 100)
            ? "O percentual vai de 1 a 100."
            : "",
        valor: comValor && !(f.valor > 0) ? "Informe um valor maior que zero." : "",
      };
    },
    async (f) => {
      // contato novo é criado antes do share (o back só aceita id existente)
      let cid = f.contatoId;
      if (cid === NOVA_PESSOA) {
        const novo = await api.addContato({ nome: f.novoNome.trim(), email: f.novoEmail.trim() || null });
        cid = novo.id;
      }

      let dto;
      if (f.tipo === "linha") {
        const [ltipo, lid] = f.linhaKey.split(":");
        dto = {
          contatoId: cid,
          tipo: "linha",
          [ltipo === "fixa" ? "despesaFixaId" : "despesaMesId"]: lid,
          ...(f.divisao === "percentual" ? { percentual: f.percentual } : {}),
          ...(f.divisao === "valor" ? { valor: f.valor } : {}),
        };
      } else {
        dto = { contatoId: cid, tipo: "valor", valor: f.valor, mesRef: f.recorrencia === "pontual" ? ym : null };
      }
      await api.addCartaoShare(cartao.id, dto);
      // segue no modal pra compartilhar a próxima linha com a mesma pessoa
      patch({ contatoId: cid, novoNome: "", novoEmail: "", linhaKey: "", valor: 0 });
      await reload();
    }
  );

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
      reset();
    }
  }, [open, cartao?.id, ym]);

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
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormError>{formError}</FormError>
          <Field label="Pessoa" required error={errors.contatoId}>
            <Select name="contatoId" value={f.contatoId} onValue={(v) => set("contatoId", v)} placeholder="Selecione…">
              {contatos.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.nome}{c.vinculado ? " ✓" : ""}</SelectItem>
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
              <Field label="Email" hint="p/ ela ver quando tiver conta" error={errors.novoEmail}>
                <TextInput name="novoEmail" value={f.novoEmail} placeholder="maria@email.com"
                           onChange={(e) => set("novoEmail", e.target.value)} />
              </Field>
            </div>
          )}

          <Field label="O que compartilhar">
            <Select name="tipo" value={f.tipo} onValue={(v) => set("tipo", v)}>
              <SelectItem value="linha">Uma linha da fatura</SelectItem>
              <SelectItem value="valor">Um valor da fatura</SelectItem>
            </Select>
          </Field>

          {f.tipo === "linha" ? (
            <>
              <Field label="Linha" required error={errors.linhaKey}>
                <Select name="linhaKey" value={f.linhaKey} onValue={(v) => set("linhaKey", v)} placeholder="Selecione…">
                  {linhas.map((l) => (
                    <SelectItem key={`${l.tipo}:${l.id}`} value={`${l.tipo}:${l.id}`}>
                      {l.descricao} · {fmtMoney(l.valor)}
                      {l.parcelado ? ` (${l.parcelaAtual}/${l.totalParcelas})` : ""}
                    </SelectItem>
                  ))}
                </Select>
              </Field>
              <Field label="Quanto dessa linha">
                <Select name="divisao" value={f.divisao} onValue={(v) => set("divisao", v)}>
                  <SelectItem value="inteira">Linha inteira (100%)</SelectItem>
                  <SelectItem value="percentual">Percentual</SelectItem>
                  <SelectItem value="valor">Valor fixo por mês</SelectItem>
                </Select>
              </Field>
              {f.divisao === "percentual" && (
                <Field label="Percentual (%)" error={errors.percentual}>
                  <NumberInput name="percentual" value={f.percentual} min={1} max={100}
                               onValue={(v) => set("percentual", v)} />
                </Field>
              )}
              {f.divisao === "valor" && (
                <Field label="Valor por mês" error={errors.valor}>
                  <MoneyInput name="valor" value={f.valor} onValue={(v) => set("valor", v)} />
                </Field>
              )}
            </>
          ) : (
            <>
              <Field label="Valor" required error={errors.valor}>
                <MoneyInput name="valor" value={f.valor} onValue={(v) => set("valor", v)} />
              </Field>
              <Field label="Recorrência">
                <Select name="recorrencia" value={f.recorrencia} onValue={(v) => set("recorrencia", v)}>
                  <SelectItem value="recorrente">Todo mês</SelectItem>
                  <SelectItem value="pontual">Só neste mês ({ym})</SelectItem>
                </Select>
              </Field>
            </>
          )}

          <Button type="submit" className="w-full" loading={submitting}>
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
