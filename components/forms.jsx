import { useState } from "react";
import { useFinance } from "../store/FinanceContext.jsx";
import { Modal, Field, TextInput, Textarea, MoneyInput, PercentInput, Button } from "./ui/primitives.jsx";
import { Select, SelectItem, CheckboxField, NumberInput, DayInput, DateInput, FormError } from "./ui/fields.jsx";
import { useFormState } from "./ui/useFormState.js";
import { dataValida, texto } from "../lib/formErrors.js";
import { fmtMoney, todayISO } from "../lib/format.js";
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
      <Field label="Cartão de crédito" hint={cartoes.length ? "" : "Cadastre um cartão na página Cartões"}>
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
        <div className="rounded-xl border border-[var(--color-line)] bg-white/[0.03] p-3">
          <CheckboxField
            label="Compra parcelada"
            hint="Marque para lançar em parcelas na fatura"
            checked={!!f.parcelado}
            onChecked={(parcelado) => set({ parcelado })}
          />

          {f.parcelado && (
            <div className="mt-3 grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
              <Field label="Parcela atual" hint="ex: 3" error={errors.parcelaAtual}>
                <NumberInput name="parcelaAtual" value={f.parcelaAtual} min={1} max={480}
                             onValue={(parcelaAtual) => set({ parcelaAtual })} />
              </Field>
              <Field label="Total de parcelas" hint="ex: 10" error={errors.totalParcelas}>
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
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: acento(c.cor).dot }} />
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

// Rodapé padrão: cancelar + salvar.
function Acoes({ onCancel, submitting, variant = "primary", children }) {
  return (
    <div className="flex gap-2 pt-1">
      <Button type="button" variant="ghost" className="flex-1" onClick={onCancel}>Cancelar</Button>
      <Button type="submit" variant={variant} className="flex-1" loading={submitting}>{children}</Button>
    </div>
  );
}

// ── Aporte ──────────────────────────────────────────────────────────────────
export function AporteModal({ open, onClose, caixinhas, defaultCaixinhaId }) {
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
    <Modal open={open} onClose={close} title="Registrar aporte">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError>{formError}</FormError>
        <Field label="Caixinha" required error={errors.caixinhaId}>
          <Select name="caixinhaId" value={f.caixinhaId} onValue={(v) => set("caixinhaId", v)} placeholder="Selecione…">
            {caixinhas.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: acento(c.cor).dot }} />
                  {c.nome}
                </span>
              </SelectItem>
            ))}
          </Select>
        </Field>
        <Field label="Valor" required error={errors.valor}
               hint={sugestao ? `Aporte mensal planejado: ${fmtMoney(sugestao)}` : ""}>
          <MoneyInput name="valor" value={f.valor} onValue={(v) => set("valor", v)}
                      onBlur={() => touch("valor")} autoFocus />
        </Field>
        {sugestao > 0 && f.valor !== sugestao && (
          <button type="button" onClick={() => set("valor", sugestao)}
                  className="-mt-2 text-xs font-medium text-blue-400 hover:text-blue-300 cursor-pointer">
            Usar valor planejado ({fmtMoney(sugestao)})
          </button>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data" error={errors.data}>
            <DateInput name="data" value={f.data} onValue={(v) => set("data", v)} />
          </Field>
          <Field label="Descrição">
            <TextInput name="descricao" value={f.descricao} placeholder="Aporte mensal"
                       onChange={(e) => set("descricao", e.target.value)} />
          </Field>
        </div>
        <Acoes onCancel={close} submitting={submitting} variant="growth">Adicionar</Acoes>
      </form>
    </Modal>
  );
}

// ── Despesa variável (deduz da caixinha) ─────────────────────────────────────
export function DespesaVariavelModal({ open, onClose, caixinhas, defaultCaixinhaId }) {
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
    <Modal open={open} onClose={close} title="Registrar despesa">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError>{formError}</FormError>
        <Field label="Debitar da caixinha" required error={errors.caixinhaId}>
          <Select name="caixinhaId" value={f.caixinhaId} onValue={(v) => set("caixinhaId", v)} placeholder="Selecione…">
            {caixinhas.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: acento(c.cor).dot }} />
                  {c.nome} — saldo {fmtMoney(c.saldo)}
                </span>
              </SelectItem>
            ))}
          </Select>
        </Field>
        <Field label="Valor" required error={errors.valor}
               hint={cx ? `Saldo disponível: ${fmtMoney(cx.saldo)}` : ""}>
          <MoneyInput name="valor" value={f.valor} onValue={(v) => set("valor", v)}
                      onBlur={() => touch("valor")} autoFocus />
        </Field>
        {insuficiente && (
          <p className="-mt-2 text-xs text-amber-400">
            ⚠ Valor maior que o saldo — a caixinha ficará negativa.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data" error={errors.data}>
            <DateInput name="data" value={f.data} onValue={(v) => set("data", v)} />
          </Field>
          <Field label="Descrição">
            <TextInput name="descricao" value={f.descricao} placeholder="Mercado, farmácia…"
                       onChange={(e) => set("descricao", e.target.value)} />
          </Field>
        </div>
        <Acoes onCancel={close} submitting={submitting} variant="danger">Registrar saída</Acoes>
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
        <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
          <Field label={f.parcelado ? "Valor da parcela" : "Valor mensal"} required error={errors.valor}>
            <MoneyInput name="valor" value={f.valor} onValue={(v) => set("valor", v)} onBlur={() => touch("valor")} />
          </Field>
          <Field label="Dia do vencimento" required error={errors.diaVencimento}
                 hint={vencimentoDoCartao ? `vence com a fatura do ${vencimentoDoCartao.nome}` : "1 a 31"}>
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
        <Field label="Nota" hint="observação livre — opcional" error={errors.nota}>
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
        <div className="grid grid-cols-1 gap-3 min-[380px]:grid-cols-2">
          <Field label="Valor" required error={errors.valor}>
            <MoneyInput name="valor" value={f.valor} onValue={(v) => set("valor", v)} onBlur={() => touch("valor")} />
          </Field>
          <Field label="Data" error={errors.data}>
            <DateInput name="data" value={f.data} onValue={(v) => set("data", v)} month={mes} />
          </Field>
        </div>
        <CategoriaField f={f} set={set} />
        <CartaoParcelaFields f={f} set={patch} errors={errors} comParcela={false} />
        <Field label="Nota" hint="observação livre — opcional" error={errors.nota}>
          <Textarea name="nota" value={f.nota} placeholder="Detalhes, lembrete, referência…"
                    onChange={(e) => set("nota", e.target.value)} />
        </Field>
        <Acoes onCancel={close} submitting={submitting} variant="danger">{editing ? "Salvar" : "Adicionar"}</Acoes>
      </form>
    </Modal>
  );
}

// ── Receita do mês (dinheiro extra por fora) ─────────────────────────────────
export function ReceitaMesModal({ open, onClose, mes, mesLabel, receita }) {
  const { addReceitaMes, updateReceitaMes } = useFinance();
  const editing = !!receita;
  const init = () =>
    receita
      ? { descricao: receita.descricao, valor: receita.valor, data: receita.data }
      : { descricao: "", valor: 0, data: `${mes}-15` };
  const { f, set, errors, formError, touch, submitting, submit, reset } = useFormState(
    init,
    (f) => ({
      descricao: texto(f.descricao, { obrigatorio: true, max: 120, campo: "A descrição" }),
      valor: exigeValor(f.valor),
      data: exigeData(f.data, mes),
    }),
    async (f) => {
      const base = { descricao: f.descricao, valor: f.valor, data: f.data };
      if (editing) await updateReceitaMes(receita.id, base);
      else await addReceitaMes({ mes, ...base });
      close();
    }
  );

  function close() { reset(); onClose(); }

  return (
    <Modal open={open} onClose={close} title={editing ? "Editar receita" : `Receita extra · ${mesLabel}`}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError>{formError}</FormError>
        <Field label="Descrição" required error={errors.descricao}>
          <TextInput name="descricao" value={f.descricao} placeholder="Freela, bônus, venda, presente…" autoFocus
                     onChange={(e) => set("descricao", e.target.value)} onBlur={() => touch("descricao")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor" required error={errors.valor}>
            <MoneyInput name="valor" value={f.valor} onValue={(v) => set("valor", v)} onBlur={() => touch("valor")} />
          </Field>
          <Field label="Data" error={errors.data}>
            <DateInput name="data" value={f.data} onValue={(v) => set("data", v)} month={mes} />
          </Field>
        </div>
        <Acoes onCancel={close} submitting={submitting} variant="growth">{editing ? "Salvar" : "Adicionar"}</Acoes>
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Aporte mensal">
            <MoneyInput name="aporteMensal" value={f.aporteMensal} onValue={(v) => set("aporteMensal", v)} />
          </Field>
          <Field label="Meta" hint="Deixe 0 se não houver" error={errors.meta}>
            <MoneyInput name="meta" value={f.meta} onValue={(v) => set("meta", v)} />
          </Field>
        </div>
        <Field label="Rendimento" error={errors.taxaJuros}
               hint="Juros compostos usados só na previsão da meta — o saldo continua vindo das movimentações">
          <PercentInput name="taxaJuros" value={f.taxaJuros} onValue={(v) => set("taxaJuros", v)} />
        </Field>
        <Field label="Cor">
          <div className="flex gap-2">
            {CORES.map((c) => (
              <button key={c} type="button" onClick={() => set("cor", c)}
                      aria-label={c}
                      style={{ backgroundColor: acento(c).dot }}
                      className={`h-9 w-9 rounded-full cursor-pointer transition-transform ${f.cor === c ? "ring-2 ring-white scale-110" : "opacity-60 hover:opacity-100"}`} />
            ))}
          </div>
        </Field>
        <CheckboxField label="Acumula o que sobrar no mês" checked={f.acumulaSobra}
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
        <Field label="Meses de segurança" hint="Quantos meses de gasto quer ter guardados" error={errors.meses}>
          <div className="flex flex-wrap items-center gap-2">
            {MESES_SUGERIDOS.map((m) => (
              <button key={m} type="button" onClick={() => set("meses", m)}
                      className={`rounded-xl px-3.5 py-2 text-sm font-semibold cursor-pointer transition-colors ${f.meses === m ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}>
                {m} meses
              </button>
            ))}
            <NumberInput name="meses" value={f.meses} min={1} max={120}
                         onValue={(v) => set("meses", v)} className="w-20" />
          </div>
        </Field>
        <Field label="Gasto por mês" hint="Quanto você gasta em média por mês" error={errors.gasto}>
          <MoneyInput name="gasto" value={f.gasto} onValue={(v) => set("gasto", v)} onBlur={() => touch("gasto")} />
        </Field>

        <div className="rounded-xl bg-emerald-500/10 px-3.5 py-3 text-sm ring-1 ring-emerald-500/20">
          <div className="flex items-center justify-between">
            <span className="text-slate-300">Meta da reserva</span>
            <span className="tnum text-lg font-bold text-emerald-200">{fmtMoney(meta)}</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {f.meses || 0} meses × {fmtMoney(f.gasto || 0)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Já tenho guardado" hint="Saldo inicial">
            <MoneyInput name="saldo" value={f.saldo} onValue={(v) => set("saldo", v)} />
          </Field>
          <Field label="Guardar por mês" hint="Aporte mensal">
            <MoneyInput name="aporte" value={f.aporte} onValue={(v) => set("aporte", v)} />
          </Field>
        </div>
        {mesesAteMeta != null && falta > 0 && (
          <p className="text-xs text-slate-400">
            Nesse ritmo você completa a reserva em cerca de <span className="text-slate-200">{mesesAteMeta} meses</span>.
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
    <Modal open={open} onClose={close} title="Novo espaço de despesa">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError>{formError}</FormError>
        <Field label="Nome" required error={errors.nome}>
          <TextInput name="nome" value={f.nome} placeholder="Nosso, Meu, Viagem…" autoFocus
                     onChange={(e) => set("nome", e.target.value)} onBlur={() => touch("nome")} />
        </Field>
        <Field label="Ícone">
          <div className="flex flex-wrap gap-2">
            {EMOJIS.map((em) => (
              <button key={em} type="button" onClick={() => set("emoji", em)}
                      aria-label={`Ícone ${em}`}
                      className={`grid h-10 w-10 place-items-center rounded-xl text-lg cursor-pointer transition-colors ${f.emoji === em ? "bg-blue-500/20 ring-2 ring-blue-500/60" : "bg-white/5 hover:bg-white/10"}`}>
                {em}
              </button>
            ))}
          </div>
        </Field>
        <p className="rounded-xl bg-white/4 px-3.5 py-3 text-xs text-slate-400">
          Só o orçamento é separado — despesas fixas, despesas do mês e renda próprias.
          As caixinhas (economias) são compartilhadas entre todos os espaços.
        </p>
        <Acoes onCancel={close} submitting={submitting}>Criar espaço</Acoes>
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome" required error={errors.nome}>
            <TextInput name="nome" value={f.nome} placeholder="Nubank, Inter…" autoFocus
                       onChange={(e) => set("nome", e.target.value)} onBlur={() => touch("nome")} />
          </Field>
          <Field label="Bandeira" hint="opcional">
            <TextInput name="bandeira" value={f.bandeira} placeholder="Visa, Master…"
                       onChange={(e) => set("bandeira", e.target.value)} />
          </Field>
        </div>
        <Field label="Limite" error={errors.limite}>
          <MoneyInput name="limite" value={f.limite} onValue={(v) => set("limite", v)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dia do fechamento" error={errors.diaFechamento}
                 hint={fechamentoSugerido ? "sugerido: 7 dias antes do vencimento — pode mudar" : "opcional"}>
            <DayInput name="diaFechamento" value={f.diaFechamento} onValue={mudaFechamento}
                      suggestion={sugestaoFechamento} allowEmpty />
          </Field>
          <Field label="Dia do vencimento" required error={errors.diaVencimento}
                 hint={vencimentoSugerido ? "sugerido: 7 dias após o fechamento — pode mudar" : "1 a 31"}>
            <DayInput name="diaVencimento" value={f.diaVencimento} onValue={mudaVencimento}
                      suggestion={sugestaoVencimento} allowEmpty />
          </Field>
        </div>
        <Field label="Cor">
          <div className="flex gap-2">
            {CORES_CARTAO.map((c) => (
              <button key={c} type="button" onClick={() => set("cor", c)} aria-label={c}
                      style={{ backgroundColor: acento(c).dot }}
                      className={`h-9 w-9 rounded-full cursor-pointer transition-transform ${f.cor === c ? "ring-2 ring-white scale-110" : "opacity-60 hover:opacity-100"}`} />
            ))}
          </div>
        </Field>
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
        <Field label="Cor">
          <div className="flex gap-2">
            {CORES_CATEGORIA.map((c) => (
              <button key={c} type="button" onClick={() => set("cor", c)} aria-label={c}
                      style={{ backgroundColor: acento(c).dot }}
                      className={`h-9 w-9 rounded-full cursor-pointer transition-transform ${f.cor === c ? "ring-2 ring-white scale-110" : "opacity-60 hover:opacity-100"}`} />
            ))}
          </div>
        </Field>
        <Acoes onCancel={close} submitting={submitting}>{editing ? "Salvar" : "Criar categoria"}</Acoes>
      </form>
    </Modal>
  );
}
