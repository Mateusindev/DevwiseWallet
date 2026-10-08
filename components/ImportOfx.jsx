import { useMemo, useState } from "react";
import { Upload, FileText, Check } from "lucide-react";
import { Button, Field, Modal } from "./ui/primitives.jsx";
import { Checkbox, FormError, Select, SelectItem } from "./ui/fields.jsx";
import { useFinance } from "../store/FinanceContext.jsx";
import { lerArquivoOfx, parseOfx } from "../lib/ofx.js";
import { acento, sugereCategoria } from "../lib/calc.js";
import { mensagemDeErro } from "../lib/formErrors.js";
import { fmtDate, fmtMoney } from "../lib/format.js";

// Import de extrato/fatura OFX em 3 passos: arquivo → conferir → resultado.
// O parse é no cliente (preview instantâneo, zero upload); o servidor só faz
// dedup por fitid e insere numa transação.
export default function ImportOfxModal({ open, onClose, mes, mesLabel, cartaoId: cartaoInicial = "" }) {
  const { cartoes, categorias, despesasMes, importDespesasMes } = useFinance();
  const [passo, setPasso] = useState("arquivo");
  const [arquivo, setArquivo] = useState(null);
  const [linhas, setLinhas] = useState([]); // { key, data, descricao, valor, fitid, categoriaId, marcada }
  const [fora, setFora] = useState({ credito: 0, mes: 0 });
  const [cartao, setCartao] = useState(cartaoInicial);
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [aplicarCat, setAplicarCat] = useState("");

  // fitid que já entrou neste espaço — reimportar o mesmo arquivo não duplica
  const jaImportados = useMemo(
    () => new Set((despesasMes || []).map((d) => d.fitid).filter(Boolean)),
    [despesasMes]
  );

  const marcadas = linhas.filter((l) => l.marcada && !l.duplicada);
  const total = marcadas.reduce((s, l) => s + l.valor, 0);
  const duplicadas = linhas.filter((l) => l.duplicada).length;

  function fechar() {
    setPasso("arquivo");
    setArquivo(null);
    setLinhas([]);
    setFora({ credito: 0, mes: 0 });
    setCartao(cartaoInicial);
    setErro("");
    setResultado(null);
    setAplicarCat("");
    onClose();
  }

  async function escolher(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite re-escolher o mesmo arquivo
    if (!file) return;
    setErro("");
    setArquivo(file);
    try {
      const texto = await lerArquivoOfx(file);
      const { transacoes } = parseOfx(texto);
      // crédito (pagamento de fatura, estorno) não é despesa; data de outro mês
      // faria a linha sumir da lista — as duas ficam de fora, com aviso.
      const credito = transacoes.filter((t) => t.tipo !== "debito").length;
      const debitos = transacoes.filter((t) => t.tipo === "debito");
      const doMes = debitos.filter((t) => t.data.slice(0, 7) === mes);
      setFora({ credito, mes: debitos.length - doMes.length });
      setLinhas(
        doMes.map((t, i) => ({
          key: t.fitid || `${t.data}:${i}`,
          fitid: t.fitid,
          data: t.data,
          descricao: t.descricao.slice(0, 120),
          valor: Math.abs(t.valor),
          categoriaId: sugereCategoria(t.descricao, despesasMes) || "",
          duplicada: !!t.fitid && jaImportados.has(t.fitid),
          marcada: true,
        }))
      );
      setPasso("conferir");
    } catch (err) {
      setLinhas([]);
      setErro(err instanceof Error ? err.message : "Não foi possível ler o arquivo.");
    }
  }

  function alterna(key) {
    setLinhas((ls) => ls.map((l) => (l.key === key ? { ...l, marcada: !l.marcada } : l)));
  }
  function todas(ligar) {
    setLinhas((ls) => ls.map((l) => (l.duplicada ? l : { ...l, marcada: ligar })));
  }
  function setCategoria(key, categoriaId) {
    setLinhas((ls) => ls.map((l) => (l.key === key ? { ...l, categoriaId } : l)));
  }
  function aplicarNasMarcadas(categoriaId) {
    setAplicarCat(categoriaId);
    setLinhas((ls) => ls.map((l) => (l.marcada && !l.duplicada ? { ...l, categoriaId } : l)));
  }

  async function importar() {
    setBusy(true);
    setErro("");
    try {
      const r = await importDespesasMes({
        mes,
        cartaoId: cartao || null,
        itens: marcadas.map((l) => ({
          fitid: l.fitid,
          data: l.data,
          descricao: l.descricao,
          valor: l.valor,
          categoriaId: l.categoriaId || null,
        })),
      });
      setResultado({ criadas: r.criadas.length, ignoradas: r.ignoradas.length, desmarcadas: linhas.length - marcadas.length - duplicadas });
      setPasso("resultado");
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setBusy(false);
    }
  }

  const titulo = passo === "arquivo" ? "Importar OFX" : passo === "conferir" ? `Conferir · ${mesLabel}` : "Import concluído";

  return (
    <Modal open={open} onClose={() => !busy && fechar()} title={titulo}>
      <div className="space-y-4">
        <FormError>{erro}</FormError>

        {passo === "arquivo" && (
          <>
            {/* input nativo escondido: só o label estilizado aparece */}
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border border-dashed border-[var(--color-line)] bg-veu/[0.02] px-5 py-10 text-center transition-colors hover:border-veu/30 hover:bg-veu/5">
              <input type="file" accept=".ofx,.qfx,application/x-ofx" className="sr-only" onChange={escolher} />
              <Upload size={22} className="text-slate-400" />
              <span className="text-sm font-semibold text-ink">Escolher arquivo .ofx</span>
              <span className="text-xs text-slate-500">Extrato ou fatura baixada do banco (.ofx / .qfx)</span>
            </label>
            {arquivo && (
              <p className="flex items-center gap-2 text-xs text-slate-400">
                <FileText size={14} /> {arquivo.name} · {(arquivo.size / 1024).toFixed(0)} KB
              </p>
            )}
            <p className="rounded-xl bg-veu/4 px-3.5 py-3 text-xs text-slate-400">
              As transações entram como despesas de <b className="text-slate-300">{mesLabel}</b>. O arquivo não sai do
              seu navegador — a leitura é local.
            </p>
          </>
        )}

        {passo === "conferir" && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm text-slate-300">
                <b>{marcadas.length}</b> de {linhas.length} transações ·{" "}
                <span className="tnum font-semibold text-ink">{fmtMoney(total)}</span>
              </p>
              <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                <Checkbox
                  checked={marcadas.length === linhas.length - duplicadas && marcadas.length > 0}
                  onChecked={(v) => todas(v)}
                  aria-label="Marcar todas"
                />
                todas
              </label>
            </div>
            {(duplicadas > 0 || fora.credito > 0 || fora.mes > 0) && (
              <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                {[
                  duplicadas > 0 && `${duplicadas} já importada${duplicadas > 1 ? "s" : ""}`,
                  fora.credito > 0 && `${fora.credito} crédito${fora.credito > 1 ? "s" : ""} (pagamento/estorno)`,
                  fora.mes > 0 && `${fora.mes} fora de ${mesLabel}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}{" "}
                — fora do import.
              </p>
            )}

            <Field label="Cartão" hint="vale para todas as linhas importadas">
              <Select value={cartao} onValue={setCartao}>
                <SelectItem value="">Sem cartão (à vista / débito)</SelectItem>
                {cartoes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                ))}
              </Select>
            </Field>

            <Field label="Aplicar categoria nas marcadas" hint="a sugestão automática vem das despesas anteriores">
              <Select value={aplicarCat} onValue={aplicarNasMarcadas} placeholder="Escolher…">
                <SelectItem value="">Sem categoria</SelectItem>
                {categorias.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: acento(c.cor).dot }} />
                      {c.nome}
                    </span>
                  </SelectItem>
                ))}
              </Select>
            </Field>

            <ul className="max-h-72 divide-y divide-[var(--color-line)] overflow-y-auto rounded-xl border border-[var(--color-line)]">
              {linhas.map((l) => (
                <li key={l.key} className={`space-y-2 px-3 py-2.5 ${l.duplicada ? "opacity-50" : ""}`}>
                  <div className="flex items-start gap-2.5">
                    <Checkbox checked={l.marcada && !l.duplicada} disabled={l.duplicada}
                              onChecked={() => alterna(l.key)} aria-label={`Importar ${l.descricao}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-slate-200">{l.descricao}</p>
                      <p className="text-[11px] text-slate-500">
                        {fmtDate(l.data)}{l.duplicada ? " · já importada" : ""}
                      </p>
                    </div>
                    <span className="tnum shrink-0 text-sm font-semibold text-slate-200">{fmtMoney(l.valor)}</span>
                  </div>
                  {!l.duplicada && (
                    <Select value={l.categoriaId} onValue={(v) => setCategoria(l.key, v)} className="py-1.5 text-sm">
                      <SelectItem value="">Sem categoria</SelectItem>
                      {categorias.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="inline-flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: acento(c.cor).dot }} />
                            {c.nome}
                          </span>
                        </SelectItem>
                      ))}
                    </Select>
                  )}
                </li>
              ))}
            </ul>

            <div className="flex gap-2 pt-1">
              <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => setPasso("arquivo")}>
                Voltar
              </Button>
              <Button className="flex-1" loading={busy} disabled={marcadas.length === 0} onClick={importar}>
                Importar {marcadas.length}
              </Button>
            </div>
          </>
        )}

        {passo === "resultado" && resultado && (
          <>
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-500/15 text-emerald-400">
                <Check size={24} />
              </span>
              <p className="text-lg font-semibold text-ink">
                {resultado.criadas} {resultado.criadas === 1 ? "despesa criada" : "despesas criadas"}
              </p>
              <p className="text-sm text-slate-400">
                em {mesLabel}
                {resultado.ignoradas > 0 && ` · ${resultado.ignoradas} ignorada(s) por já existir`}
                {resultado.desmarcadas > 0 && ` · ${resultado.desmarcadas} desmarcada(s)`}
              </p>
            </div>
            <Button className="w-full" onClick={fechar}>Fechar</Button>
          </>
        )}
      </div>
    </Modal>
  );
}
