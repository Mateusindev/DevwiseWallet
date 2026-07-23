import { useState } from "react";
import { useFinance } from "../store/FinanceContext.jsx";
import { Modal, Field, TextInput, Textarea, Select, MoneyInput, PercentInput, Button } from "./ui/primitives.jsx";
import { fmtMoney, todayISO } from "../lib/format.js";
import { acento, parcelaInfo } from "../lib/calc.js";
import { useAuth } from "./AuthGate";

// ── Bloco compartilhado: vincular cartão (+ parcelamento, só fixas) ───────────
// `f`/`set` = estado do form. `comParcela` liga os campos de parcela (fixas).
function CartaoParcelaFields({ f, set, comParcela = true }) {
  const { cartoes } = useFinance();
  return (
    <>
      <Field label="Cartão de crédito" hint={cartoes.length ? "" : "Cadastre um cartão na página Cartões"}>
        <Select
          value={f.cartaoId || ""}
          onChange={(e) => {
            const cartaoId = e.target.value;
            // limpa parcelamento se tirar o cartão
            set({ cartaoId, ...(cartaoId ? {} : { parcelado: false }) });
          }}
        >
          <option value="">Sem cartão (à vista / débito)</option>
          {cartoes.map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </Select>
      </Field>

      {comParcela && f.cartaoId && (
        <>
          <label className="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={!!f.parcelado}
              onChange={(e) => set({ parcelado: e.target.checked })}
              className="h-4 w-4 rounded border-white/20 bg-transparent accent-blue-500 cursor-pointer"
            />
            Compra parcelada
          </label>

          {f.parcelado && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Parcela atual" hint="ex: 3">
                <TextInput type="number" min={1} value={f.parcelaAtual}
                           onChange={(e) => set({ parcelaAtual: e.target.value })} />
              </Field>
              <Field label="Total de parcelas" hint="ex: 10">
                <TextInput type="number" min={1} value={f.totalParcelas}
                           onChange={(e) => set({ totalParcelas: e.target.value })} />
              </Field>
            </div>
          )}
        </>
      )}
    </>
  );
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
      <Select value={f.categoriaId || ""}
              onChange={(e) => {
                if (e.target.value === NOVA_CATEGORIA) { setNovoOpen(true); return; }
                set("categoriaId", e.target.value);
              }}>
        <option value="">Sem categoria</option>
        {categorias.map((c) => (
          <option key={c.id} value={c.id}>{c.nome}</option>
        ))}
        {podeCriar && <option value={NOVA_CATEGORIA}>+ Nova categoria…</option>}
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
    parcelaAtual: parcelado ? Number(f.parcelaAtual) || 1 : null,
    totalParcelas: parcelado ? Number(f.totalParcelas) || null : null,
  };
}

// ── Aporte ──────────────────────────────────────────────────────────────────
export function AporteModal({ open, onClose, caixinhas, defaultCaixinhaId }) {
  const { addAporte } = useFinance();
  const [form, setForm] = useState(null);
  const f = form ?? init();
  function init() {
    return { caixinhaId: defaultCaixinhaId || caixinhas[0]?.id || "", valor: 0, descricao: "", data: todayISO() };
  }
  const set = (k, v) => setForm({ ...f, [k]: v });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const cx = caixinhas.find((c) => c.id === f.caixinhaId);
  // pre-fill with the caixinha's planned monthly contribution
  const sugestao = cx?.aporteMensal || 0;

  async function submit(e) {
    e.preventDefault();
    if (f.valor <= 0) return setErr("Informe um valor maior que zero.");
    setBusy(true);
    try {
      await addAporte(f);
      close();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  function close() {
    setForm(null);
    setErr("");
    onClose();
  }

  return (
    <Modal open={open} onClose={close} title="Registrar aporte">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Caixinha" required>
          <Select value={f.caixinhaId} onChange={(e) => set("caixinhaId", e.target.value)}>
            {caixinhas.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </Select>
        </Field>
        <Field label="Valor" required error={err && f.valor <= 0 ? err : ""}
               hint={sugestao ? `Aporte mensal planejado: ${fmtMoney(sugestao)}` : ""}>
          <MoneyInput value={f.valor} onValue={(v) => { set("valor", v); setErr(""); }} autoFocus />
        </Field>
        {sugestao > 0 && f.valor !== sugestao && (
          <button type="button" onClick={() => set("valor", sugestao)}
                  className="-mt-2 text-xs font-medium text-blue-400 hover:text-blue-300 cursor-pointer">
            Usar valor planejado ({fmtMoney(sugestao)})
          </button>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data">
            <TextInput type="date" value={f.data} onChange={(e) => set("data", e.target.value)} />
          </Field>
          <Field label="Descrição">
            <TextInput value={f.descricao} placeholder="Aporte mensal" onChange={(e) => set("descricao", e.target.value)} />
          </Field>
        </div>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="ghost" className="flex-1" onClick={close}>Cancelar</Button>
          <Button type="submit" variant="growth" className="flex-1" loading={busy}>Adicionar</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Despesa variável (deduz da caixinha) ─────────────────────────────────────
export function DespesaVariavelModal({ open, onClose, caixinhas, defaultCaixinhaId }) {
  const { addDespesaVariavel } = useFinance();
  const [form, setForm] = useState(null);
  const f = form ?? { caixinhaId: defaultCaixinhaId || caixinhas[0]?.id || "", valor: 0, descricao: "", data: todayISO() };
  const set = (k, v) => setForm({ ...f, [k]: v });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const cx = caixinhas.find((c) => c.id === f.caixinhaId);
  const insuficiente = cx && f.valor > cx.saldo;

  async function submit(e) {
    e.preventDefault();
    if (f.valor <= 0) return setErr("Informe um valor maior que zero.");
    setBusy(true);
    try {
      await addDespesaVariavel(f);
      close();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  function close() { setForm(null); setErr(""); onClose(); }

  return (
    <Modal open={open} onClose={close} title="Registrar despesa">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Debitar da caixinha" required>
          <Select value={f.caixinhaId} onChange={(e) => set("caixinhaId", e.target.value)}>
            {caixinhas.map((c) => (
              <option key={c.id} value={c.id}>{c.nome} — saldo {fmtMoney(c.saldo)}</option>
            ))}
          </Select>
        </Field>
        <Field label="Valor" required
               error={err && f.valor <= 0 ? err : ""}
               hint={cx ? `Saldo disponível: ${fmtMoney(cx.saldo)}` : ""}>
          <MoneyInput value={f.valor} onValue={(v) => { set("valor", v); setErr(""); }} autoFocus />
        </Field>
        {insuficiente && (
          <p className="-mt-2 text-xs text-amber-400">
            ⚠ Valor maior que o saldo — a caixinha ficará negativa.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data">
            <TextInput type="date" value={f.data} onChange={(e) => set("data", e.target.value)} />
          </Field>
          <Field label="Descrição">
            <TextInput value={f.descricao} placeholder="Mercado, farmácia…" onChange={(e) => set("descricao", e.target.value)} />
          </Field>
        </div>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="ghost" className="flex-1" onClick={close}>Cancelar</Button>
          <Button type="submit" variant="danger" className="flex-1" loading={busy}>Registrar saída</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Despesa fixa (recorrente) ────────────────────────────────────────────────
export function DespesaFixaModal({ open, onClose, despesa }) {
  const { addDespesaFixa, updateDespesaFixa } = useFinance();
  const editing = !!despesa;
  const [form, setForm] = useState(null);
  const init = () => {
    if (!despesa) return { descricao: "", valor: 0, diaVencimento: 5, cartaoId: "", categoriaId: "", nota: "", parcelado: false, parcelaAtual: 1, totalParcelas: "" };
    // prefill com a parcela EFETIVA do mês atual (editar re-ancora "agora estou na X")
    const eff = despesa.parcelado ? parcelaInfo(despesa) : null;
    return {
      descricao: despesa.descricao, valor: despesa.valor, diaVencimento: despesa.diaVencimento,
      cartaoId: despesa.cartaoId || "", categoriaId: despesa.categoriaId || "", nota: despesa.nota || "", parcelado: !!despesa.parcelado,
      parcelaAtual: eff ? Math.min(Math.max(eff.atual, 1), despesa.totalParcelas) : 1,
      totalParcelas: despesa.totalParcelas ?? "",
    };
  };
  const f = form ?? init();
  const set = (k, v) => setForm({ ...f, [k]: v });
  const patch = (p) => setForm({ ...f, ...p });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!f.descricao.trim()) return setErr("Dê um nome para a despesa.");
    if (f.valor <= 0) return setErr("Informe um valor maior que zero.");
    setBusy(true);
    const dto = { descricao: f.descricao, valor: f.valor, diaVencimento: f.diaVencimento, categoriaId: f.categoriaId || null, nota: f.nota.trim() || null, ...cartaoPayload(f) };
    try {
      if (editing) await updateDespesaFixa(despesa.id, dto);
      else await addDespesaFixa(dto);
      close();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  function close() { setForm(null); setErr(""); onClose(); }

  return (
    <Modal open={open} onClose={close} title={editing ? "Editar despesa fixa" : "Nova despesa fixa"}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Descrição" required error={err && !f.descricao.trim() ? err : ""}>
          <TextInput value={f.descricao} placeholder="Aluguel, internet, jiu-jitsu…" autoFocus
                     onChange={(e) => { set("descricao", e.target.value); setErr(""); }} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={f.parcelado ? "Valor da parcela" : "Valor mensal"} required error={err && f.valor <= 0 ? err : ""}>
            <MoneyInput value={f.valor} onValue={(v) => { set("valor", v); setErr(""); }} />
          </Field>
          <Field label="Dia do vencimento" hint="1 a 31">
            <TextInput type="number" min={1} max={31} value={f.diaVencimento}
                       onChange={(e) => set("diaVencimento", e.target.value)} />
          </Field>
        </div>
        <CategoriaField f={f} set={set} />
        <CartaoParcelaFields f={f} set={patch} />
        <Field label="Nota" hint="observação livre — opcional">
          <Textarea value={f.nota} placeholder="Detalhes, lembrete, referência…"
                    onChange={(e) => set("nota", e.target.value)} />
        </Field>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="ghost" className="flex-1" onClick={close}>Cancelar</Button>
          <Button type="submit" className="flex-1" loading={busy}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Despesa do mês (avulsa) ──────────────────────────────────────────────────
export function DespesaMesModal({ open, onClose, mes, mesLabel, despesa }) {
  const { addDespesaMes, updateDespesaMes } = useFinance();
  const editing = !!despesa;
  const [form, setForm] = useState(null);
  const init = () =>
    despesa
      ? { descricao: despesa.descricao, valor: despesa.valor, data: despesa.data, cartaoId: despesa.cartaoId || "", categoriaId: despesa.categoriaId || "", nota: despesa.nota || "" }
      : { descricao: "", valor: 0, data: `${mes}-15`, cartaoId: "", categoriaId: "", nota: "" };
  const f = form ?? init();
  const set = (k, v) => setForm({ ...f, [k]: v });
  const patch = (p) => setForm({ ...f, ...p });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!f.descricao.trim()) return setErr("Dê um nome para a despesa.");
    if (f.valor <= 0) return setErr("Informe um valor maior que zero.");
    setBusy(true);
    const base = { descricao: f.descricao, valor: f.valor, data: f.data, cartaoId: f.cartaoId || null, categoriaId: f.categoriaId || null, nota: f.nota.trim() || null };
    try {
      if (editing) await updateDespesaMes(despesa.id, base);
      else await addDespesaMes({ mes, ...base });
      close();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  function close() { setForm(null); setErr(""); onClose(); }

  return (
    <Modal open={open} onClose={close} title={editing ? "Editar despesa" : `Despesa de ${mesLabel}`}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Descrição" required error={err && !f.descricao.trim() ? err : ""}>
          <TextInput value={f.descricao} placeholder="Mercado, transporte, geladeira…" autoFocus
                     onChange={(e) => { set("descricao", e.target.value); setErr(""); }} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor" required error={err && f.valor <= 0 ? err : ""}>
            <MoneyInput value={f.valor} onValue={(v) => { set("valor", v); setErr(""); }} />
          </Field>
          <Field label="Data">
            <TextInput type="date" value={f.data} onChange={(e) => set("data", e.target.value)} />
          </Field>
        </div>
        <CategoriaField f={f} set={set} />
        <CartaoParcelaFields f={f} set={patch} comParcela={false} />
        <Field label="Nota" hint="observação livre — opcional">
          <Textarea value={f.nota} placeholder="Detalhes, lembrete, referência…"
                    onChange={(e) => set("nota", e.target.value)} />
        </Field>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="ghost" className="flex-1" onClick={close}>Cancelar</Button>
          <Button type="submit" variant="danger" className="flex-1" loading={busy}>{editing ? "Salvar" : "Adicionar"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Receita do mês (dinheiro extra por fora) ─────────────────────────────────
export function ReceitaMesModal({ open, onClose, mes, mesLabel, receita }) {
  const { addReceitaMes, updateReceitaMes } = useFinance();
  const editing = !!receita;
  const [form, setForm] = useState(null);
  const init = () =>
    receita
      ? { descricao: receita.descricao, valor: receita.valor, data: receita.data }
      : { descricao: "", valor: 0, data: `${mes}-15` };
  const f = form ?? init();
  const set = (k, v) => setForm({ ...f, [k]: v });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!f.descricao.trim()) return setErr("Dê um nome para a receita.");
    if (f.valor <= 0) return setErr("Informe um valor maior que zero.");
    setBusy(true);
    const base = { descricao: f.descricao, valor: f.valor, data: f.data };
    try {
      if (editing) await updateReceitaMes(receita.id, base);
      else await addReceitaMes({ mes, ...base });
      close();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  function close() { setForm(null); setErr(""); onClose(); }

  return (
    <Modal open={open} onClose={close} title={editing ? "Editar receita" : `Receita extra · ${mesLabel}`}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Descrição" required error={err && !f.descricao.trim() ? err : ""}>
          <TextInput value={f.descricao} placeholder="Freela, bônus, venda, presente…" autoFocus
                     onChange={(e) => { set("descricao", e.target.value); setErr(""); }} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor" required error={err && f.valor <= 0 ? err : ""}>
            <MoneyInput value={f.valor} onValue={(v) => { set("valor", v); setErr(""); }} />
          </Field>
          <Field label="Data">
            <TextInput type="date" value={f.data} onChange={(e) => set("data", e.target.value)} />
          </Field>
        </div>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="ghost" className="flex-1" onClick={close}>Cancelar</Button>
          <Button type="submit" variant="growth" className="flex-1" loading={busy}>{editing ? "Salvar" : "Adicionar"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Nova caixinha ─────────────────────────────────────────────────────────────
const CORES = ["emerald", "blue", "violet", "amber", "rose", "cyan"];
export function CaixinhaModal({ open, onClose, caixinha }) {
  const { addCaixinha, updateCaixinha } = useFinance();
  const editing = !!caixinha;
  const [form, setForm] = useState(null);
  const init = () =>
    caixinha
      ? { nome: caixinha.nome, aporteMensal: caixinha.aporteMensal, taxaJuros: caixinha.taxaJuros ?? 0, meta: caixinha.meta ?? 0, cor: caixinha.cor, acumulaSobra: !!caixinha.acumulaSobra }
      : { nome: "", aporteMensal: 0, taxaJuros: 0, meta: 0, cor: "blue", acumulaSobra: false };
  const f = form ?? init();
  const set = (k, v) => setForm({ ...f, [k]: v });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!f.nome.trim()) return setErr("Dê um nome para a caixinha.");
    setBusy(true);
    const dto = { ...f, meta: f.meta > 0 ? f.meta : null };
    try {
      if (editing) await updateCaixinha(caixinha.id, dto);
      else await addCaixinha(dto);
      close();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  function close() { setForm(null); setErr(""); onClose(); }

  return (
    <Modal open={open} onClose={close} title={editing ? "Editar caixinha" : "Nova caixinha"}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nome" required error={err}>
          <TextInput value={f.nome} placeholder="Reserva de Sonhos, Crédito…" autoFocus
                     onChange={(e) => { set("nome", e.target.value); setErr(""); }} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Aporte mensal">
            <MoneyInput value={f.aporteMensal} onValue={(v) => set("aporteMensal", v)} />
          </Field>
          <Field label="Meta" hint="Deixe 0 se não houver">
            <MoneyInput value={f.meta} onValue={(v) => set("meta", v)} />
          </Field>
        </div>
        <Field label="Rendimento" hint="Juros compostos usados só na previsão da meta — o saldo continua vindo das movimentações">
          <PercentInput value={f.taxaJuros} onValue={(v) => set("taxaJuros", v)} />
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
        <label className="flex items-center gap-2.5 text-sm text-slate-300 cursor-pointer">
          <input type="checkbox" checked={f.acumulaSobra} onChange={(e) => set("acumulaSobra", e.target.checked)}
                 className="h-4 w-4 rounded border-white/20 bg-transparent accent-blue-500 cursor-pointer" />
          Acumula o que sobrar no mês
        </label>
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="ghost" className="flex-1" onClick={close}>Cancelar</Button>
          <Button type="submit" className="flex-1" loading={busy}>{editing ? "Salvar" : "Criar caixinha"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Reserva de emergência (wizard) ────────────────────────────────────────────
// A meta não é digitada: sai de "quantos meses de segurança" × "gasto mensal".
// Também coleta aporte mensal (previsão) e saldo já guardado. Grava via update.
const MESES_SUGERIDOS = [3, 6, 12];
export function ReservaEmergenciaModal({ open, onClose, caixinha, onCreated }) {
  const { addCaixinha, updateCaixinha } = useFinance();
  const editing = !!caixinha;
  const [form, setForm] = useState(null);
  const init = () => ({
    meses: 6,
    gasto: caixinha?.meta ? Math.round(caixinha.meta / 6) : 0,
    aporte: caixinha?.aporteMensal ?? 0,
    saldo: caixinha?.saldo ?? 0,
  });
  const f = form ?? init();
  const set = (k, v) => setForm({ ...f, [k]: v });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const meta = Math.round((f.meses || 0) * (f.gasto || 0) * 100) / 100;
  // Previsão grosseira de meses p/ completar o que falta com o aporte informado.
  const falta = Math.max(0, meta - (f.saldo || 0));
  const mesesAteMeta = f.aporte > 0 ? Math.ceil(falta / f.aporte) : null;

  async function submit(e) {
    e.preventDefault();
    if (!(f.meses > 0)) return setErr("Escolha quantos meses de segurança.");
    if (!(f.gasto > 0)) return setErr("Informe seu gasto mensal.");
    setBusy(true);
    try {
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
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  function close() { setForm(null); setErr(""); onClose(); }

  return (
    <Modal open={open} onClose={close} title={editing ? "Configurar reserva de emergência" : "Nova reserva de emergência"}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Meses de segurança" hint="Quantos meses de gasto quer ter guardados" error={err}>
          <div className="flex flex-wrap items-center gap-2">
            {MESES_SUGERIDOS.map((m) => (
              <button key={m} type="button" onClick={() => { set("meses", m); setErr(""); }}
                      className={`rounded-xl px-3.5 py-2 text-sm font-semibold cursor-pointer transition-colors ${f.meses === m ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}>
                {m} meses
              </button>
            ))}
            <TextInput type="number" min="1" value={f.meses}
                       onChange={(e) => { set("meses", Math.max(0, parseInt(e.target.value, 10) || 0)); setErr(""); }}
                       className="w-20" />
          </div>
        </Field>
        <Field label="Gasto por mês" hint="Quanto você gasta em média por mês">
          <MoneyInput value={f.gasto} onValue={(v) => { set("gasto", v); setErr(""); }} />
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
            <MoneyInput value={f.saldo} onValue={(v) => set("saldo", v)} />
          </Field>
          <Field label="Guardar por mês" hint="Aporte mensal">
            <MoneyInput value={f.aporte} onValue={(v) => set("aporte", v)} />
          </Field>
        </div>
        {mesesAteMeta != null && falta > 0 && (
          <p className="text-xs text-slate-400">
            Nesse ritmo você completa a reserva em cerca de <span className="text-slate-200">{mesesAteMeta} meses</span>.
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="ghost" className="flex-1" onClick={close}>Cancelar</Button>
          <Button type="submit" className="flex-1" loading={busy}>{editing ? "Salvar reserva" : "Criar reserva"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Espaço de despesa ─────────────────────────────────────────────────────────
const EMOJIS = ["💑", "🧍", "🏠", "🏢", "✈️", "🐶", "🎯", "💰"];
export function EspacoModal({ open, onClose, onCreated }) {
  const { addEspaco } = useFinance();
  const [form, setForm] = useState(null);
  const f = form ?? { nome: "", emoji: "📁", tipo: "outro" };
  const set = (k, v) => setForm({ ...f, [k]: v });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!f.nome.trim()) return setErr("Dê um nome para o espaço.");
    setBusy(true);
    try {
      const novo = await addEspaco(f);
      onCreated?.(novo);
      close();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  function close() { setForm(null); setErr(""); onClose(); }

  return (
    <Modal open={open} onClose={close} title="Novo espaço de despesa">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nome" required error={err}>
          <TextInput value={f.nome} placeholder="Nosso, Meu, Viagem…" autoFocus
                     onChange={(e) => { set("nome", e.target.value); setErr(""); }} />
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
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="ghost" className="flex-1" onClick={close}>Cancelar</Button>
          <Button type="submit" className="flex-1" loading={busy}>Criar espaço</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Cartão de crédito (criar / editar) ────────────────────────────────────────
const CORES_CARTAO = ["violet", "blue", "emerald", "amber", "rose", "cyan"];
export function CartaoModal({ open, onClose, cartao }) {
  const { addCartao, updateCartao } = useFinance();
  const editing = !!cartao;
  const [form, setForm] = useState(null);
  const init = () =>
    cartao
      ? {
          nome: cartao.nome, bandeira: cartao.bandeira || "", limite: cartao.limite,
          diaFechamento: cartao.diaFechamento ?? "", diaVencimento: cartao.diaVencimento, cor: cartao.cor,
        }
      : { nome: "", bandeira: "", limite: 0, diaFechamento: "", diaVencimento: 10, cor: "violet" };
  const f = form ?? init();
  const set = (k, v) => setForm({ ...f, [k]: v });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!f.nome.trim()) return setErr("Dê um nome para o cartão.");
    setBusy(true);
    const dto = {
      nome: f.nome,
      bandeira: f.bandeira.trim() || null,
      limite: f.limite,
      diaFechamento: f.diaFechamento === "" ? null : Number(f.diaFechamento),
      diaVencimento: Number(f.diaVencimento) || 1,
      cor: f.cor,
    };
    try {
      if (editing) await updateCartao(cartao.id, dto);
      else await addCartao(dto);
      close();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  function close() { setForm(null); setErr(""); onClose(); }

  return (
    <Modal open={open} onClose={close} title={editing ? "Editar cartão" : "Novo cartão"}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome" required error={err}>
            <TextInput value={f.nome} placeholder="Nubank, Inter…" autoFocus
                       onChange={(e) => { set("nome", e.target.value); setErr(""); }} />
          </Field>
          <Field label="Bandeira" hint="opcional">
            <TextInput value={f.bandeira} placeholder="Visa, Master…"
                       onChange={(e) => set("bandeira", e.target.value)} />
          </Field>
        </div>
        <Field label="Limite">
          <MoneyInput value={f.limite} onValue={(v) => set("limite", v)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dia do fechamento" hint="opcional">
            <TextInput type="number" min={1} max={31} value={f.diaFechamento}
                       onChange={(e) => set("diaFechamento", e.target.value)} />
          </Field>
          <Field label="Dia do vencimento" hint="1 a 31">
            <TextInput type="number" min={1} max={31} value={f.diaVencimento}
                       onChange={(e) => set("diaVencimento", e.target.value)} />
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
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="ghost" className="flex-1" onClick={close}>Cancelar</Button>
          <Button type="submit" className="flex-1" loading={busy}>{editing ? "Salvar" : "Criar cartão"}</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Categoria de despesa (criar / editar) ─────────────────────────────────────
const CORES_CATEGORIA = ["blue", "emerald", "violet", "amber", "rose", "cyan"];
export function CategoriaModal({ open, onClose, categoria, onCreated }) {
  const { addCategoria, updateCategoria } = useFinance();
  const editing = !!categoria;
  const [form, setForm] = useState(null);
  const init = () => (categoria ? { nome: categoria.nome, cor: categoria.cor } : { nome: "", cor: "blue" });
  const f = form ?? init();
  const set = (k, v) => setForm({ ...f, [k]: v });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!f.nome.trim()) return setErr("Dê um nome para a categoria.");
    setBusy(true);
    try {
      if (editing) await updateCategoria(categoria.id, { nome: f.nome, cor: f.cor });
      else { const cat = await addCategoria({ nome: f.nome, cor: f.cor }); onCreated?.(cat); }
      close();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  function close() { setForm(null); setErr(""); onClose(); }

  return (
    <Modal open={open} onClose={close} title={editing ? "Editar categoria" : "Nova categoria"}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Nome" required error={err}>
          <TextInput value={f.nome} placeholder="Moradia, Alimentação, Lazer…" autoFocus
                     onChange={(e) => { set("nome", e.target.value); setErr(""); }} />
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
        <div className="flex gap-2 pt-1">
          <Button type="button" variant="ghost" className="flex-1" onClick={close}>Cancelar</Button>
          <Button type="submit" className="flex-1" loading={busy}>{editing ? "Salvar" : "Criar categoria"}</Button>
        </div>
      </form>
    </Modal>
  );
}
