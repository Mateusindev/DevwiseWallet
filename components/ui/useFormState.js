import { useState } from "react";
import { issuesToFields, mensagemDeErro } from "../../lib/formErrors.js";

// Estado de formulário com validação e erro por campo.
//
//   const { f, set, errors, formError, submit } = useFormState(init, validar, salvar);
//
// `init` é função (roda tarde: os modais montam antes de ter a linha a editar).
// `validar(f)` é puro e devolve `{ campo: "mensagem" }`.
// `salvar(f)` faz o I/O; erro dele com `issues` (422) vira erro de campo, o
// resto vira `formError` — nenhum caminho de erro fica sem texto na tela.
export function useFormState(init, validar, salvar) {
  const [form, setForm] = useState(null);
  const f = form ?? init();
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Campos em que o usuário já mexeu — é o que impede uma sugestão automática
  // (ex: vencimento = fechamento + 7) de sobrescrever escolha dele.
  const [touched, setTouched] = useState(() => new Set());

  const limpar = (campos) =>
    setErrors((e) => {
      if (!campos.some((k) => e[k])) return e;
      const next = { ...e };
      for (const k of campos) delete next[k];
      return next;
    });

  const marcar = (campos) =>
    setTouched((t) => {
      if (campos.every((k) => t.has(k))) return t;
      const next = new Set(t);
      for (const k of campos) next.add(k);
      return next;
    });

  // Editar um campo apaga o erro dele (e o banner) — o texto velho não pode
  // sobreviver à correção. `marcarTocado: false` é pra escrita automática
  // (sugestão), que não conta como "o usuário mexeu".
  // Atualização funcional de propósito: dois patches no mesmo handler (mexer no
  // fechamento também sugere o vencimento) não podem partir do mesmo snapshot.
  const patch = (p, { marcarTocado = true } = {}) => {
    setForm((prev) => ({ ...(prev ?? init()), ...p }));
    limpar(Object.keys(p));
    setFormError("");
    if (marcarTocado) marcar(Object.keys(p));
  };
  const set = (k, v) => patch({ [k]: v });

  const soErros = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v));

  // Valida no blur: erro aparece assim que o usuário sai do campo, não só no submit.
  const touch = (k) => {
    marcar([k]);
    const erro = soErros(validar(f))[k];
    setErrors((e) => (erro ? { ...e, [k]: erro } : e));
  };

  const validateNow = () => {
    const errs = soErros(validar(f));
    setErrors(errs);
    return errs;
  };

  function reset() {
    setForm(null);
    setErrors({});
    setFormError("");
    setTouched(new Set());
  }

  async function submit(e) {
    e?.preventDefault?.();
    const formEl = e?.currentTarget;
    const errs = soErros(validar(f));
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      setFormError("");
      marcar(Object.keys(f));
      focarPrimeiro(formEl, Object.keys(errs)[0]);
      return false;
    }
    setSubmitting(true);
    setErrors({});
    setFormError("");
    try {
      await salvar(f);
      return true;
    } catch (err) {
      const doCampo = issuesToFields(err?.issues);
      const conhecidos = Object.fromEntries(Object.entries(doCampo).filter(([k]) => k in f));
      setErrors(conhecidos);
      // Issue de campo que o form não tem (ou erro sem issues) não pode sumir.
      const sobrou = Object.keys(doCampo).length > Object.keys(conhecidos).length;
      if (Object.keys(conhecidos).length === 0 || sobrou) setFormError(mensagemDeErro(err));
      focarPrimeiro(formEl, Object.keys(conhecidos)[0]);
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  return { f, set, patch, errors, formError, setFormError, touch, touched, validateNow, submitting, submit, reset };
}

// `name` do campo é o que liga a mensagem ao controle — vale pro input nativo,
// pro trigger do Select e pro do DateInput (todos recebem `name`).
function focarPrimeiro(formEl, campo) {
  if (!formEl || !campo) return;
  const el = formEl.querySelector(`[name="${campo}"]`);
  if (!el) return;
  el.focus?.();
  el.scrollIntoView?.({ block: "center", behavior: "smooth" });
}
