import { useState } from "react";
import { useFinance } from "../store/FinanceContext.jsx";
import { Modal, Field, TextInput, Textarea, MoneyInput, PercentInput, Button, inputBase } from "./ui/primitives.jsx";
import { Select, SelectItem, CheckboxField, NumberInput, DayInput, DateInput, MonthSelect, FormError } from "./ui/fields.jsx";
import { useFormState } from "./ui/useFormState.js";
import { dataValida, texto } from "../lib/formErrors.js";
import { addMonths, fmtMoney, fmtMonthLabel, todayISO } from "../lib/format.js";
import { acento, parcelaInfo, sugereFechamento, sugereVencimento } from "../lib/calc.js";
import { useAuth } from "./AuthGate";

// Regras que repetem em quase todo form daqui.
const exigeValor = (v) => (v > 0 ? "" : "Informe um valor maior que zero.");
const exigeNota = (v) => texto(v, { max: 1000, campo: "A nota" });
const exigeData = (v, mes) => {
  if (!dataValida(v)) return "Escolha uma data válida.";
  // A lista filtra por `mes`, não por `data`: data de outro mês faria a linha
  // "desaparecer" logo depois de salvar.
  if (mes && v.slice(0, 7) !== mes) return "A data precisa ser deste mês.";
  return "";
};

// ── Bloco compartilhado: vincular cartão (+ parcelamento, só fixas) ───────────
// `f`/`set` = estado do form. `comParcela` liga os campos de parcela (fixas).
function CartaoParcelaFields({ f, set, errors = {}, comParcela = true, onPickCartao }) {
  const { cartoes } = useFinance();
  return (
    <>
      <Field label="Cartão de crédito" hint={cartoes.length ? "" : "Cadastre um cartão na página Cartões."}>
        <Select
          name="cartaoId"
          value={f.cartaoId || ""}
          // limpa parcelamento se tirar o cartão
          onValue={(cartaoId) => {
            set({ cartaoId, ...(cartaoId ? {} : { parcelado: false }) });
            onPickCartao?.(cartoes.find((c) => c.id === cartaoId) || null);
          }}
        >
          <SelectItem value="">Sem cartão (à vista / débito)</SelectItem>
          {cartoes.map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
          ))}
        </Select>
      </Field>

      {comParcela && f.cartaoId && (
        // Bloco destacado: no celular o checkbox solto passava despercebido
        // (aparece só depois de escolher o cartão, no fim do form).
        <div className="rounded-xl border border-[var(--color-line)] bg-veu/[0.03] p-4">
          <CheckboxField
            label="Compra parcelada"
            hint="Lança em parcelas na fatura do cartão."
            checked={!!f.parcelado}
            onChecked={(parcelado) => set({ parcelado })}
          />

          {f.parcelado && (
            <div className="mt-4 grid grid-cols-1 gap-4 min-[380px]:grid-cols-2">
              <Field label="Parcela atual" hint="Ex.: 3" error={errors.parcelaAtual}>
                <NumberInput name="parcelaAtual" value={f.parcelaAtual} min={1} max={480}
                             onValue={(parcelaAtual) => set({ parcelaAtual })} />
              </Field>
              <Field label="Total de parcelas" hint="Ex.: 10" error={errors.totalParcelas}>
                <NumberInput name="totalParcelas" value={f.totalParcelas} min={1} max={480} allowEmpty
                             onValue={(totalParcelas) => set({ totalParcelas })} />
              </Field>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// Valida o bloco de parcelamento (usado só pelas fixas).
function errosParcela(f) {
  if (!f.cartaoId || !f.parcelado) return {};
  const erros = {};
  if (!(f.parcelaAtual >= 1)) erros.parcelaAtual = "Informe a parcela atual (1 ou mais).";
  if (!(f.totalParcelas >= 1)) erros.totalParcelas = "Informe o total de parcelas.";
  else if (f.parcelaAtual > f.totalParcelas) erros.parcelaAtual = `A parcela atual não pode passar de ${f.totalParcelas}.`;
  return erros;
}

// Seletor de categoria (compartilhado por fixas e despesas do mês).
// Criar categoria é inline: opção "+ Nova categoria…" abre o modal e já
// seleciona a recém-criada — sem página separada.
const NOVA_CATEGORIA = "__nova__";
function CategoriaField({ f, set }) {
  const { categorias } = useFinance();
  const { can } = useAuth();
  const podeCriar = can("categoria:manage");
  const [novoOpen, setNovoOpen] = useState(false);
  return (
    <Field label="Categoria">
      <Select name="categoriaId" value={f.categoriaId || ""}
              onValue={(v) => {
                if (v === NOVA_CATEGORIA) { setNovoOpen(true); return; }
                set("categoriaId", v);
              }}>
        <SelectItem value="">Sem categoria</SelectItem>
        {categorias.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: acento(c.cor).dot }} />
              {c.nome}
            </span>
          </SelectItem>
        ))}
        {podeCriar && <SelectItem value={NOVA_CATEGORIA}>+ Nova categoria…</SelectItem>}
      </Select>
      {podeCriar && (
        <CategoriaModal open={novoOpen} onClose={() => setNovoOpen(false)}
                        onCreated={(cat) => set("categoriaId", cat.id)} />
      )}
    </Field>
  );
}

// Monta o payload de cartão/parcela a partir do estado do form.
function cartaoPayload(f) {
  if (!f.cartaoId) return { cartaoId: null, parcelado: false };
  const parcelado = !!f.parcelado;
  return {
    cartaoId: f.cartaoId,
    parcelado,
    parcelaAtual: parcelado ? f.parcelaAtual || 1 : null,
    totalParcelas: parcelado ? f.totalParcelas || null : null,
  };
}

// Rodapé padrão: cancelar + salvar, à direita. No celular empilha com a ação
// principal por cima (perto do polegar) e os dois ocupam a largura toda.
// `variant="danger"` só pra confirmação destrutiva — salvar é sempre primário.
function Acoes({ onCancel, submitting, variant = "primary", children }) {
  return (
    <div className="flex flex-col-reverse gap-2 border-t border-[var(--color-line)] pt-4 sm:flex-row sm:justify-end">
      <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={onCancel}>Cancelar</Button>
      <Button type="submit" variant={variant} className="w-full sm:w-auto sm:min-w-28" loading={submitting}>{children}</Button>
    </div>
  );
}

// Seletor de cor: grupo de opções exclusivas (radio), nome da cor como rótulo
// acessível, selecionado marcado por anel de tinta — não por escala/opacidade.
const NOME_COR = { emerald: "Verde", blue: "Azul", violet: "Violeta", amber: "Âmbar", rose: "Rosa", cyan: "Ciano" };
function CorPicker({ cores, value, onValue, label = "Cor" }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2.5">
      {cores.map((c) => {
        const sel = value === c;
        return (
          <button key={c} type="button" role="radio" aria-checked={sel} aria-label={NOME_COR[c] ?? c}
                  title={NOME_COR[c] ?? c} onClick={() => onValue(c)}
                  className={`grid h-9 w-9 place-items-center rounded-full cursor-pointer transition-shadow ${
                    sel ? "ring-2 ring-ink ring-offset-2 ring-offset-[var(--color-surface)]" : "hover:ring-2 hover:ring-veu/20 hover:ring-offset-2 hover:ring-offset-[var(--color-surface)]"
                  }`}>
            <span className="h-7 w-7 rounded-full" style={{ backgroundColor: acento(c).dot }} />
          </button>
        );
      })}
    </div>
  );
}

// Opção selecionável em linha (chip grande): borda, tinta quando escolhida.
const opcaoClass = (sel) =>
  `h-10 rounded-xl px-3.5 text-sm font-medium cursor-pointer transition-colors ${
    sel ? "bg-ink text-[var(--color-on-ink)]" : "border border-[var(--color-line-strong)] text-slate-300 hover:bg-veu/[0.05] hover:text-ink"
  }`;

// Caixinha travada: o modal foi aberto a partir de um card, não há o que escolher.
function CaixinhaFixa({ label, caixinha, sufixo }) {
  return (
    <Field label={label}>
      <div className={`${inputBase} flex items-center gap-2 bg-veu/[0.03] text-slate-300`} aria-readonly="true">
        <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: acento(caixinha.cor).dot }} />
        <span className="truncate">{caixinha.nome}{sufixo}</span>
      </div>
    </Field>
  );
}

// ── Aporte ──────────────────────────────────────────────────────────────────
export function AporteModal({ open, onClose, caixinhas, defaultCaixinhaId, lockCaixinha }) {
  const { addAporte } = useFinance();
  const { f, set, errors, formError, touch, submitting, submit, reset } = useFormState(
    () => ({ caixinhaId: defaultCaixinhaId || caixinhas[0]?.id || "", valor: 0, descricao: "", data: todayISO() }),
    (f) => ({
      caixinhaId: f.caixinhaId ? "" : "Escolha uma caixinha.",
      valor: exigeValor(f.valor),
      data: exigeData(f.data),
    }),
    async (f) => { await addAporte(f); close(); }
  );

  const cx = caixinhas.find((c) => c.id === f.caixinhaId);
  // pre-fill with the caixinha's planned monthly contribution
  const sugestao = cx?.aporteMensal || 0;

  function close() { reset(); onClose(); }

  return (
    <Modal open={open} onClose={close} title="Registrar aporte" description="Dinheiro que entra numa caixinha.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError>{formError}</FormError>
        {lockCaixinha && cx ? (
          <CaixinhaFixa label="Caixinha" caixinha={cx} />
        ) : (
          <Field label="Caixinha" required error={errors.caixinhaId}>
            <Select name="caixinhaId" value={f.caixinhaId} onValue={(v) => set("caixinhaId", v)} placeholder="Selecione…">
              {caixinhas.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: acento(c.cor).dot }} />
                    {c.nome}
                  </span>
                </SelectItem>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Valor" required error={errors.valor}
               hint={sugestao ? `Aporte mensal planejado: ${fmtMoney(sugestao)}` : ""}>
          <MoneyInput name="valor" value={f.valor} onValue={(v) => set("valor", v)}
                      onBlur={() => touch("valor")} autoFocus />
        </Field>
        {sugestao > 0 && f.valor !== sugestao && (
          <button type="button" onClick={() => set("valor", sugestao)}
                  className="-mt-2 text-[13px] font-medium text-blue-400 hover:text-blue-300 cursor-pointer">
            Usar valor planejado ({fmtMoney(sugestao)})
          </button>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Data" error={errors.data}>
            <DateInput name="data" value={f.data} onValue={(v) => set("data", v)} />
          </Field>
          <Field label="Descrição">
            <TextInput name="descricao" value={f.descricao} placeholder="Aporte mensal"
                       onChange={(e) => set("descricao", e.target.value)} />
          </Field>
        </div>
        <Acoes onCancel={close} submitting={submitting}>Adicionar aporte</Acoes>
      </form>
    </Modal>
  );
}

// ── Despesa variável (deduz da caixinha) ─────────────────────────────────────
export function DespesaVariavelModal({ open, onClose, caixinhas, defaultCaixinhaId, lockCaixinha }) {
  const { addDespesaVariavel } = useFinance();
  const { f, set, errors, formError, touch, submitting, submit, reset } = useFormState(
    () => ({ caixinhaId: defaultCaixinhaId || caixinhas[0]?.id || "", valor: 0, descricao: "", data: todayISO() }),
    (f) => ({
      caixinhaId: f.caixinhaId ? "" : "Escolha uma caixinha.",
      valor: exigeValor(f.valor),
      data: exigeData(f.data),
    }),
    async (f) => { await addDespesaVariavel(f); close(); }
  );

  const cx = caixinhas.find((c) => c.id === f.caixinhaId);
  const insuficiente = cx && f.valor > cx.saldo;

  function close() { reset(); onClose(); }

  return (
    <Modal open={open} onClose={close} title="Registrar despesa" description="Sai do saldo de uma caixinha.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError>{formError}</FormError>
        {lockCaixinha && cx ? (
          <CaixinhaFixa label="Debitar da caixinha" caixinha={cx} sufixo={` — saldo ${fmtMoney(cx.saldo)}`} />
        ) : (
          <Field label="Debitar da caixinha" required error={errors.caixinhaId}>
            <Select name="caixinhaId" value={f.caixinhaId} onValue={(v) => set("caixinhaId", v)} placeholder="Selecione…">
              {caixinhas.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: acento(c.cor).dot }} />
                    {c.nome} — saldo {fmtMoney(c.saldo)}
                  </span>
                </SelectItem>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Valor" required error={errors.valor}
               hint={cx ? `Saldo disponível: ${fmtMoney(cx.saldo)}` : ""}>
          <MoneyInput name="valor" value={f.valor} onValue={(v) => set("valor", v)}
                      onBlur={() => touch("valor")} autoFocus />
        </Field>
        {insuficiente && (
          <p role="status" className="-mt-1 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-300">
            Valor maior que o saldo: a caixinha vai ficar negativa.
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Data" error={errors.data}>
            <DateInput name="data" value={f.data} onValue={(v) => set("data", v)} />
          </Field>
          <Field label="Descrição">
            <TextInput name="descricao" value={f.descricao} placeholder="Mercado, farmácia…"
                       onChange={(e) => set("descricao", e.target.value)} />
          </Field>
        </div>
        <Acoes onCancel={close} submitting={submitting}>Registrar saída</Acoes>
      </form>
    </Modal>
  );
}

// ── Despesa fixa (recorrente) ────────────────────────────────────────────────
export function DespesaFixaModal({ open, onClose, despesa }) {
  const { addDespesaFixa, updateDespesaFixa, cartoes } = useFinance();
  const editing = !!despesa;
  const init = () => {
    if (!despesa) return { descricao: "", valor: 0, diaVencimento: 5, cartaoId: "", categoriaId: "", nota: "", parcelado: false, parcelaAtual: 1, totalParcelas: null };
    // prefill com a parcela EFETIVA do mês atual (editar re-ancora "agora estou na X")
    const eff = despesa.parcelado ? parcelaInfo(despesa) : null;
    return {
      descricao: despesa.descricao, valor: despesa.valor, diaVencimento: despesa.diaVencimento,
      cartaoId: despesa.cartaoId || "", categoriaId: despesa.categoriaId || "", nota: despesa.nota || "", parcelado: !!despesa.parcelado,
      parcelaAtual: eff ? Math.min(Math.max(eff.atual, 1), despesa.totalParcelas) : 1,
      totalParcelas: despesa.totalParcelas ?? null,
    };
  };
  const { f, set, patch, errors, formError, touch, touched, submitting, submit, reset } = useFormState(
    init,
    (f) => ({
      descricao: texto(f.descricao, { obrigatorio: true, max: 120, campo: "A descrição" }),
      valor: exigeValor(f.valor),
      diaVencimento: f.diaVencimento >= 1 && f.diaVencimento <= 31 ? "" : "Informe o dia do vencimento (1 a 31).",
      nota: exigeNota(f.nota),
      ...errosParcela(f),
    }),
    async (f) => {
      const dto = { descricao: f.descricao, valor: f.valor, diaVencimento: f.diaVencimento, categoriaId: f.categoriaId || null, nota: f.nota.trim() || null, ...cartaoPayload(f) };
      if (editing) await updateDespesaFixa(despesa.id, dto);
      else await addDespesaFixa(dto);
      close();
    }
  );

  function close() { reset(); onClose(); }

  // Fixa no cartão costuma vencer com a fatura: sugere o dia dele enquanto o
  // usuário não tiver mexido no campo.
  const cartaoSel = cartoes.find((c) => c.id === f.cartaoId);
  const vencimentoDoCartao =
    !touched.has("diaVencimento") && cartaoSel?.diaVencimento === f.diaVencimento ? cartaoSel : null;

  return (
    <Modal open={open} onClose={close} title={editing ? "Editar despesa fixa" : "Nova despesa fixa"}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError>{formError}</FormError>
        <Field label="Descrição" required error={errors.descricao}>
          <TextInput name="descricao" value={f.descricao} placeholder="Aluguel, internet, jiu-jitsu…" autoFocus
                     onChange={(e) => set("descricao", e.target.value)} onBlur={() => touch("descricao")} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={f.parcelado ? "Valor da parcela" : "Valor mensal"} required error={errors.valor}>
            <MoneyInput name="valor" value={f.valor} onValue={(v) => set("valor", v)} onBlur={() => touch("valor")} />
          </Field>
          <Field label="Dia do vencimento" required error={errors.diaVencimento}
                 hint={vencimentoDoCartao ? `Vence com a fatura do ${vencimentoDoCartao.nome}.` : "De 1 a 31."}>
            <DayInput name="diaVencimento" value={f.diaVencimento} onValue={(v) => set("diaVencimento", v)}
                      suggestion={cartaoSel?.diaVencimento ?? null} allowEmpty />
          </Field>
        </div>
        <CategoriaField f={f} set={set} />
        <CartaoParcelaFields
          f={f} set={patch} errors={errors}
          onPickCartao={(c) => {
            if (c?.diaVencimento && !touched.has("diaVencimento")) {
              patch({ diaVencimento: c.diaVencimento }, { marcarTocado: false });
            }
          }}
        />
        <Field label="Nota" hint="Opcional." error={errors.nota}>
          <Textarea name="nota" value={f.nota} placeholder="Detalhes, lembrete, referência…"
                    onChange={(e) => set("nota", e.target.value)} />
        </Field>
        <Acoes onCancel={close} submitting={submitting}>Salvar</Acoes>
      </form>
    </Modal>
  );
}

// ── Despesa do mês (avulsa) ──────────────────────────────────────────────────
export function DespesaMesModal({ open, onClose, mes, mesLabel, despesa }) {
  const { addDespesaMes, updateDespesaMes } = useFinance();
  const editing = !!despesa;
  const init = () =>
    despesa
      ? { descricao: despesa.descricao, valor: despesa.valor, data: despesa.data, cartaoId: despesa.cartaoId || "", categoriaId: despesa.categoriaId || "", nota: despesa.nota || "" }
      : { descricao: "", valor: 0, data: `${mes}-15`, cartaoId: "", categoriaId: "", nota: "" };
  const { f, set, patch, errors, formError, touch, submitting, submit, reset } = useFormState(
    init,
    (f) => ({
      descricao: texto(f.descricao, { obrigatorio: true, max: 120, campo: "A descrição" }),
      valor: exigeValor(f.valor),
      data: exigeData(f.data, mes),
      nota: exigeNota(f.nota),
    }),
    async (f) => {
      const base = { descricao: f.descricao, valor: f.valor, data: f.data, cartaoId: f.cartaoId || null, categoriaId: f.categoriaId || null, nota: f.nota.trim() || null };
      if (editing) await updateDespesaMes(despesa.id, base);
      else await addDespesaMes({ mes, ...base });
      close();
    }
  );

  function close() { reset(); onClose(); }

  return (
    <Modal open={open} onClose={close} title={editing ? "Editar despesa" : `Despesa de ${mesLabel}`}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError>{formError}</FormError>
        <Field label="Descrição" required error={errors.descricao}>
          <TextInput name="descricao" value={f.descricao} placeholder="Mercado, transporte, geladeira…" autoFocus
                     onChange={(e) => set("descricao", e.target.value)} onBlur={() => touch("descricao")} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Valor" required error={errors.valor}>
            <MoneyInput name="valor" value={f.valor} onValue={(v) => set("valor", v)} onBlur={() => touch("valor")} />
          </Field>
          <Field label="Data" error={errors.data}>
            <DateInput name="data" value={f.data} onValue={(v) => set("data", v)} month={mes} />
          </Field>
        </div>
        <CategoriaField f={f} set={set} />
        <CartaoParcelaFields f={f} set={patch} errors={errors} comParcela={false} />
        <Field label="Nota" hint="Opcional." error={errors.nota}>
          <Textarea name="nota" value={f.nota} placeholder="Detalhes, lembrete, referência…"
                    onChange={(e) => set("nota", e.target.value)} />
        </Field>
        <Acoes onCancel={close} submitting={submitting}>{editing ? "Salvar" : "Adicionar"}</Acoes>
      </form>
    </Modal>
  );
}

// ── Receita do mês (dinheiro extra por fora) ─────────────────────────────────
// `escopo` só importa quando a receita editada é recorrente:
//   "todas"  → altera a linha real (vale pra todos os meses)
//   "mes"    → desanexa: pula a recorrente neste mês e cria uma avulsa com os
//              valores novos (a combinação é o que dá "editar só este mês")
//   "diante" → encerra a recorrente no mês anterior e reancora uma nova aqui
export function ReceitaMesModal({ open, onClose, mes, mesLabel, receita, escopo = "todas" }) {
  const { addReceitaMes, updateReceitaMes, skipReceitaMes, encerrarReceitaMes } = useFinance();
  const editing = !!receita;
  const recorrenteEditada = editing && receita.recorrente && escopo !== "todas";
  const init = () =>
    receita
      ? {
          descricao: receita.descricao,
          valor: receita.valor,
          data: receita.data,
          recorrente: !!receita.recorrente,
          mesFim: receita.mesFim ?? null,
        }
      : { descricao: "", valor: 0, data: `${mes}-15`, recorrente: false, mesFim: null };
  const { f, set, patch, errors, formError, touch, submitting, submit, reset } = useFormState(
    init,
    (f) => ({
      descricao: texto(f.descricao, { obrigatorio: true, max: 120, campo: "A descrição" }),
      valor: exigeValor(f.valor),
      data: exigeData(f.data, mes),
      mesFim: f.recorrente && f.mesFim && f.mesFim < mes ? "O mês final vem depois deste mês." : "",
    }),
    async (f) => {
      const base = { descricao: f.descricao, valor: f.valor, data: f.data };
      const recorrencia = { recorrente: !!f.recorrente, mesFim: f.recorrente ? f.mesFim : null };
      if (!editing) {
        await addReceitaMes({ mes, ...base, ...recorrencia });
      } else if (escopo === "mes") {
        await skipReceitaMes(receita.id, mes);
        await addReceitaMes({ mes, ...base });
      } else if (escopo === "diante") {
        await encerrarReceitaMes(receita.id, mes);
        await addReceitaMes({ mes, ...base, ...recorrencia });
      } else {
        await updateReceitaMes(receita.id, { ...base, ...recorrencia });
      }
      close();
    }
  );

  function close() { reset(); onClose(); }

  const titulo = !editing
    ? `Receita extra · ${mesLabel}`
    : escopo === "mes"
      ? `Editar só em ${mesLabel}`
      : escopo === "diante"
        ? `Editar de ${mesLabel} em diante`
        : "Editar receita";

  return (
    <Modal open={open} onClose={close} title={titulo}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError>{formError}</FormError>
        <Field label="Descrição" required error={errors.descricao}>
          <TextInput name="descricao" value={f.descricao} placeholder="Freela, bônus, venda, presente…" autoFocus
                     onChange={(e) => set("descricao", e.target.value)} onBlur={() => touch("descricao")} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Valor" required error={errors.valor}>
            <MoneyInput name="valor" value={f.valor} onValue={(v) => set("valor", v)} onBlur={() => touch("valor")} />
          </Field>
          <Field label="Data" error={errors.data}>
            <DateInput name="data" value={f.data} onValue={(v) => set("data", v)} month={mes} />
          </Field>
        </div>

        {/* "só neste mês" cria uma avulsa: não faz sentido oferecer recorrência */}
        {escopo !== "mes" && (
          <div className="rounded-xl border border-[var(--color-line)] bg-veu/[0.03] p-4">
            <CheckboxField
              label="Repete todo mês"
              hint="Aparece sozinha nos meses seguintes."
              checked={!!f.recorrente}
              onChecked={(recorrente) => patch({ recorrente, ...(recorrente ? {} : { mesFim: null }) })}
            />
            {f.recorrente && (
              <div className="mt-4">
                <Field label="Até (opcional)" hint={f.mesFim ? `Última vez em ${fmtMonthLabel(f.mesFim)}.` : "Sem data de fim."}
                       error={errors.mesFim}>
                  <div className="flex flex-wrap items-center gap-2">
                    <MonthSelect value={f.mesFim || addMonths(mes, 11)} onValue={(v) => set("mesFim", v)} min={mes} />
                    {f.mesFim && (
                      <button type="button" onClick={() => set("mesFim", null)}
                              className="h-10 rounded-lg px-2 text-[13px] font-medium text-slate-400 hover:text-ink cursor-pointer">
                        Sem fim
                      </button>
                    )}
                  </div>
                </Field>
              </div>
            )}
          </div>
        )}

        {recorrenteEditada && (
          <p className="text-[13px] text-slate-500">
            {escopo === "mes"
              ? "A recorrente segue valendo nos outros meses."
              : "A recorrente atual é encerrada no mês anterior e recomeça aqui com os valores novos."}
          </p>
        )}

        <Acoes onCancel={close} submitting={submitting}>{editing ? "Salvar" : "Adicionar"}</Acoes>
      </form>
    </Modal>
  );
}

// ── Nova caixinha ─────────────────────────────────────────────────────────────
const CORES = ["emerald", "blue", "violet", "amber", "rose", "cyan"];
export function CaixinhaModal({ open, onClose, caixinha }) {
  const { addCaixinha, updateCaixinha } = useFinance();
  const editing = !!caixinha;
  const init = () =>
    caixinha
      ? { nome: caixinha.nome, aporteMensal: caixinha.aporteMensal, taxaJuros: caixinha.taxaJuros ?? 0, meta: caixinha.meta ?? 0, cor: caixinha.cor, acumulaSobra: !!caixinha.acumulaSobra }
      : { nome: "", aporteMensal: 0, taxaJuros: 0, meta: 0, cor: "blue", acumulaSobra: false };
  const { f, set, errors, formError, touch, submitting, submit, reset } = useFormState(
    init,
    (f) => ({
      nome: texto(f.nome, { obrigatorio: true, max: 80, campo: "O nome" }),
      meta: f.meta >= 0 ? "" : "A meta não pode ser negativa.",
      taxaJuros: f.taxaJuros >= 0 && f.taxaJuros <= 100 ? "" : "O rendimento vai de 0 a 100% a.a.",
    }),
    async (f) => {
      const dto = { ...f, meta: f.meta > 0 ? f.meta : null };
      if (editing) await updateCaixinha(caixinha.id, dto);
      else await addCaixinha(dto);
      close();
    }
  );

  function close() { reset(); onClose(); }

  return (
    <Modal open={open} onClose={close} title={editing ? "Editar caixinha" : "Nova caixinha"}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError>{formError}</FormError>
        <Field label="Nome" required error={errors.nome}>
          <TextInput name="nome" value={f.nome} placeholder="Reserva de Sonhos, Crédito…" autoFocus
                     onChange={(e) => set("nome", e.target.value)} onBlur={() => touch("nome")} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Aporte mensal">
            <MoneyInput name="aporteMensal" value={f.aporteMensal} onValue={(v) => set("aporteMensal", v)} />
          </Field>
          <Field label="Meta" hint="Deixe 0 se não houver." error={errors.meta}>
            <MoneyInput name="meta" value={f.meta} onValue={(v) => set("meta", v)} />
          </Field>
        </div>
        <Field label="Rendimento" error={errors.taxaJuros}
               hint="Juros compostos usados só na previsão da meta. O saldo continua vindo das movimentações.">
          <PercentInput name="taxaJuros" value={f.taxaJuros} onValue={(v) => set("taxaJuros", v)} />
        </Field>
        <div>
          <p className="mb-2 text-sm font-medium text-slate-200">Cor</p>
          <CorPicker cores={CORES} value={f.cor} onValue={(c) => set("cor", c)} label="Cor da caixinha" />
        </div>
        <CheckboxField label="Acumula o que sobrar no mês" hint="A sobra do orçamento entra aqui no fim do mês."
                       checked={f.acumulaSobra}
                       onChecked={(v) => set("acumulaSobra", v)} />
        <Acoes onCancel={close} submitting={submitting}>{editing ? "Salvar" : "Criar caixinha"}</Acoes>
      </form>
    </Modal>
  );
}

// ── Reserva de emergência (wizard) ────────────────────────────────────────────
// A meta não é digitada: sai de "quantos meses de segurança" × "gasto mensal".
// Também coleta aporte mensal (previsão) e saldo já guardado. Grava via update.
const MESES_SUGERIDOS = [3, 6, 12];
const metaReserva = (f) => Math.round((f.meses || 0) * (f.gasto || 0) * 100) / 100;
export function ReservaEmergenciaModal({ open, onClose, caixinha, onCreated }) {
  const { addCaixinha, updateCaixinha } = useFinance();
  const editing = !!caixinha;
  const init = () => ({
    meses: 6,
    gasto: caixinha?.meta ? Math.round(caixinha.meta / 6) : 0,
    aporte: caixinha?.aporteMensal ?? 0,
    saldo: caixinha?.saldo ?? 0,
  });
  const { f, set, errors, formError, touch, submitting, submit, reset } = useFormState(
    init,
    (f) => ({
      meses: f.meses >= 1 ? "" : "Escolha quantos meses de segurança.",
      gasto: f.gasto > 0 ? "" : "Informe seu gasto mensal.",
    }),
    async (f) => {
      const meta = metaReserva(f);
      if (editing) {
        await updateCaixinha(caixinha.id, { meta, aporteMensal: f.aporte || 0, saldo: f.saldo || 0 });
      } else {
        const nova = await addCaixinha({
          nome: "Reserva de emergência", cor: "emerald", tipo: "emergencia",
          meta, aporteMensal: f.aporte || 0, taxaJuros: 0, acumulaSobra: false,
        });
        // create sempre zera o saldo; grava o inicial num segundo passo
        if (f.saldo > 0) await updateCaixinha(nova.id, { saldo: f.saldo });
        onCreated?.(nova);
      }
      close();
    }
  );

  const meta = metaReserva(f);
  // Previsão grosseira de meses p/ completar o que falta com o aporte informado.
  const falta = Math.max(0, meta - (f.saldo || 0));
  const mesesAteMeta = f.aporte > 0 ? Math.ceil(falta / f.aporte) : null;

  function close() { reset(); onClose(); }

  return (
    <Modal open={open} onClose={close} title={editing ? "Configurar reserva de emergência" : "Nova reserva de emergência"}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError>{formError}</FormError>
        <Field label="Meses de segurança" hint="Quantos meses de gasto você quer ter guardados." error={errors.meses}>
          <div className="flex flex-wrap items-center gap-2">
            {MESES_SUGERIDOS.map((m) => (
              <button key={m} type="button" onClick={() => set("meses", m)} aria-pressed={f.meses === m}
                      className={opcaoClass(f.meses === m)}>
                {m} meses
              </button>
            ))}
            <NumberInput name="meses" value={f.meses} min={1} max={120} aria-label="Outro número de meses"
                         onValue={(v) => set("meses", v)} className="!w-20" />
          </div>
        </Field>
        <Field label="Gasto por mês" hint="Quanto você gasta, em média, num mês." error={errors.gasto}>
          <MoneyInput name="gasto" value={f.gasto} onValue={(v) => set("gasto", v)} onBlur={() => touch("gasto")} />
        </Field>

        {/* o resultado das respostas, à vista: é ele que vira a meta */}
        <div className="flex items-end justify-between gap-3 rounded-xl bg-emerald-500/10 px-4 py-3.5">
          <div>
            <p className="text-[13px] text-emerald-300">Meta da reserva</p>
            <p className="tnum text-[13px] text-slate-400">{f.meses || 0} meses × {fmtMoney(f.gasto || 0)}</p>
          </div>
          <p className="tnum text-xl font-semibold tracking-[-0.01em] text-ink">{fmtMoney(meta)}</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Já tenho guardado" hint="Saldo inicial.">
            <MoneyInput name="saldo" value={f.saldo} onValue={(v) => set("saldo", v)} />
          </Field>
          <Field label="Guardar por mês" hint="Aporte mensal.">
            <MoneyInput name="aporte" value={f.aporte} onValue={(v) => set("aporte", v)} />
          </Field>
        </div>
        {mesesAteMeta != null && falta > 0 && (
          <p className="text-[13px] text-slate-400">
            Nesse ritmo você completa a reserva em cerca de <span className="tnum font-medium text-ink">{mesesAteMeta} meses</span>.
          </p>
        )}

        <Acoes onCancel={close} submitting={submitting}>{editing ? "Salvar reserva" : "Criar reserva"}</Acoes>
      </form>
    </Modal>
  );
}

// ── Espaço de despesa ─────────────────────────────────────────────────────────
const EMOJIS = ["💑", "🧍", "🏠", "🏢", "✈️", "🐶", "🎯", "💰"];
export function EspacoModal({ open, onClose, onCreated }) {
  const { addEspaco } = useFinance();
  const { f, set, errors, formError, touch, submitting, submit, reset } = useFormState(
    () => ({ nome: "", emoji: "📁", tipo: "outro" }),
    (f) => ({ nome: texto(f.nome, { obrigatorio: true, max: 60, campo: "O nome" }) }),
    async (f) => {
      const novo = await addEspaco(f);
      onCreated?.(novo);
      close();
    }
  );

  function close() { reset(); onClose(); }

  return (
    <Modal open={open} onClose={close} title="Nova página de despesas"
           description="Só o orçamento é separado: fixas, despesas do mês e renda próprias. As caixinhas valem pra todas.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError>{formError}</FormError>
        <Field label="Nome" required error={errors.nome}>
          <TextInput name="nome" value={f.nome} placeholder="Nosso, Meu, Viagem…" autoFocus
                     onChange={(e) => set("nome", e.target.value)} onBlur={() => touch("nome")} />
        </Field>
        <div>
          <p className="mb-2 text-sm font-medium text-slate-200">Ícone</p>
          <div role="radiogroup" aria-label="Ícone da página" className="flex flex-wrap gap-2">
            {EMOJIS.map((em) => (
              <button key={em} type="button" role="radio" aria-checked={f.emoji === em} onClick={() => set("emoji", em)}
                      aria-label={`Ícone ${em}`}
                      className={`grid h-10 w-10 place-items-center rounded-xl text-lg cursor-pointer transition-colors ${
                        f.emoji === em ? "bg-veu/[0.08] ring-2 ring-ink" : "border border-[var(--color-line-strong)] hover:bg-veu/[0.05]"
                      }`}>
                {em}
              </button>
            ))}
          </div>
        </div>
        <Acoes onCancel={close} submitting={submitting}>Criar página</Acoes>
      </form>
    </Modal>
  );
}

// ── Cartão de crédito (criar / editar) ────────────────────────────────────────
const CORES_CARTAO = ["violet", "blue", "emerald", "amber", "rose", "cyan"];
export function CartaoModal({ open, onClose, cartao }) {
  const { addCartao, updateCartao } = useFinance();
  const editing = !!cartao;
  const init = () =>
    cartao
      ? {
          nome: cartao.nome, bandeira: cartao.bandeira || "", limite: cartao.limite,
          diaFechamento: cartao.diaFechamento ?? null, diaVencimento: cartao.diaVencimento, cor: cartao.cor,
        }
      : { nome: "", bandeira: "", limite: 0, diaFechamento: null, diaVencimento: 10, cor: "violet" };
  const { f, set, patch, errors, formError, touch, touched, submitting, submit, reset } = useFormState(
    init,
    (f) => ({
      nome: texto(f.nome, { obrigatorio: true, max: 60, campo: "O nome" }),
      limite: f.limite >= 0 ? "" : "O limite não pode ser negativo.",
      diaVencimento: f.diaVencimento >= 1 && f.diaVencimento <= 31 ? "" : "Informe o dia do vencimento (1 a 31).",
      diaFechamento: f.diaFechamento == null || (f.diaFechamento >= 1 && f.diaFechamento <= 31) ? "" : "O dia do fechamento vai de 1 a 31.",
    }),
    async (f) => {
      const dto = {
        nome: f.nome,
        bandeira: f.bandeira.trim() || null,
        limite: f.limite,
        diaFechamento: f.diaFechamento ?? null,
        diaVencimento: f.diaVencimento,
        cor: f.cor,
      };
      if (editing) await updateCartao(cartao.id, dto);
      else await addCartao(dto);
      close();
    }
  );

  function close() { reset(); onClose(); }

  // A fatura vence ~7 dias depois de fechar. Preencher um lado preenche o outro,
  // mas só enquanto o usuário não tiver mexido nele (`touched`).
  function mudaFechamento(v) {
    set("diaFechamento", v);
    if (v != null && !touched.has("diaVencimento")) {
      patch({ diaVencimento: sugereVencimento(v) }, { marcarTocado: false });
    }
  }
  function mudaVencimento(v) {
    set("diaVencimento", v);
    if (v != null && f.diaFechamento == null && !touched.has("diaFechamento")) {
      patch({ diaFechamento: sugereFechamento(v) }, { marcarTocado: false });
    }
  }
  const sugestaoVencimento = f.diaFechamento != null ? sugereVencimento(f.diaFechamento) : null;
  const sugestaoFechamento = f.diaVencimento != null ? sugereFechamento(f.diaVencimento) : null;
  const vencimentoSugerido = !touched.has("diaVencimento") && f.diaVencimento === sugestaoVencimento;
  const fechamentoSugerido = !touched.has("diaFechamento") && f.diaFechamento === sugestaoFechamento;

  return (
    <Modal open={open} onClose={close} title={editing ? "Editar cartão" : "Novo cartão"}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError>{formError}</FormError>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Nome" required error={errors.nome}>
            <TextInput name="nome" value={f.nome} placeholder="Nubank, Inter…" autoFocus
                       onChange={(e) => set("nome", e.target.value)} onBlur={() => touch("nome")} />
          </Field>
          <Field label="Bandeira" hint="Opcional.">
            <TextInput name="bandeira" value={f.bandeira} placeholder="Visa, Master…"
                       onChange={(e) => set("bandeira", e.target.value)} />
          </Field>
        </div>
        <Field label="Limite" error={errors.limite}>
          <MoneyInput name="limite" value={f.limite} onValue={(v) => set("limite", v)} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Dia do fechamento" error={errors.diaFechamento}
                 hint={fechamentoSugerido ? "Sugerido: 7 dias antes do vencimento." : "Opcional."}>
            <DayInput name="diaFechamento" value={f.diaFechamento} onValue={mudaFechamento}
                      suggestion={sugestaoFechamento} allowEmpty />
          </Field>
          <Field label="Dia do vencimento" required error={errors.diaVencimento}
                 hint={vencimentoSugerido ? "Sugerido: 7 dias após o fechamento." : "De 1 a 31."}>
            <DayInput name="diaVencimento" value={f.diaVencimento} onValue={mudaVencimento}
                      suggestion={sugestaoVencimento} allowEmpty />
          </Field>
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-slate-200">Cor</p>
          <CorPicker cores={CORES_CARTAO} value={f.cor} onValue={(c) => set("cor", c)} label="Cor do cartão" />
        </div>
        <Acoes onCancel={close} submitting={submitting}>{editing ? "Salvar" : "Criar cartão"}</Acoes>
      </form>
    </Modal>
  );
}

// ── Categoria de despesa (criar / editar) ─────────────────────────────────────
const CORES_CATEGORIA = ["blue", "emerald", "violet", "amber", "rose", "cyan"];
export function CategoriaModal({ open, onClose, categoria, onCreated }) {
  const { addCategoria, updateCategoria } = useFinance();
  const editing = !!categoria;
  const init = () => (categoria ? { nome: categoria.nome, cor: categoria.cor } : { nome: "", cor: "blue" });
  const { f, set, errors, formError, touch, submitting, submit, reset } = useFormState(
    init,
    (f) => ({ nome: texto(f.nome, { obrigatorio: true, max: 60, campo: "O nome" }) }),
    async (f) => {
      if (editing) await updateCategoria(categoria.id, { nome: f.nome, cor: f.cor });
      else { const cat = await addCategoria({ nome: f.nome, cor: f.cor }); onCreated?.(cat); }
      close();
    }
  );

  function close() { reset(); onClose(); }

  return (
    <Modal open={open} onClose={close} title={editing ? "Editar categoria" : "Nova categoria"}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError>{formError}</FormError>
        <Field label="Nome" required error={errors.nome}>
          <TextInput name="nome" value={f.nome} placeholder="Moradia, Alimentação, Lazer…" autoFocus
                     onChange={(e) => set("nome", e.target.value)} onBlur={() => touch("nome")} />
        </Field>
        <div>
          <p className="mb-2 text-sm font-medium text-slate-200">Cor</p>
          <CorPicker cores={CORES_CATEGORIA} value={f.cor} onValue={(c) => set("cor", c)} label="Cor da categoria" />
        </div>
        <Acoes onCancel={close} submitting={submitting}>{editing ? "Salvar" : "Criar categoria"}</Acoes>
      </form>
    </Modal>
  );
}
