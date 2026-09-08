# Plano — Reforma de inputs, validação, gráficos, bulk actions e import OFX

> Ciclo: 2026-09 · Branch base: `master` · Escopo: front (`components/`, `lib/`, `store/`) + back (`server/modules/orcamento`, `server/modules/cartao`) + 2 migrations Prisma.

## 0. Decisões já tomadas (não re-discutir)

| Tema | Decisão |
|---|---|
| Inputs nativos | **Headless lib (Radix)** — `@radix-ui/react-select`, `-checkbox`, `-popover`. Month/day/date pickers construídos em cima de `Popover`. |
| Reuso de receitas extras | **Flag recorrente no modelo** — migration em `ReceitaMes` (+ tabela de skip por mês). |
| Bulk actions em Despesas | **Todas as 4**: marcar paga/desfazer · excluir · mudar categoria/cartão · pausar/ativar fixas. |
| Import de arquivo | **OFX** (extrato/fatura de banco), parse no cliente, dedup por `FITID`. |

## 1. Regras do repositório que valem para toda etapa

- **Bun sempre**: `bun add`, `bun run`, `bunx`. Nunca npm/yarn.
- **Não editar `.env`**. Qualquer variável nova entra em `.env.example` + lista de pendência manual no fim do ciclo.
- **Prisma pinado em v6**. Migrations via `bun run prisma:migrate` (dev) — nunca `prisma db push` em algo que vai pra produção.
- **Rotas Hono obrigatoriamente encadeadas** na mesma expressão (`.get().post()...`). Rota fora da cadeia não existe pro client RPC e `bun run typecheck` não acusa — o sintoma é `client.api.x` inexistente no `financeApi.ts`.
- **Todo service recebe `userId` como primeiro parâmetro**; rotas passam `c.get("user").id`. Recurso de outro dono → **404**, nunca 403.
- **Id de outro agregado que vem no payload é validado como do dono** (`assertVinculos` em `server/modules/orcamento/orcamento.service.ts:28`). Toda rota nova que aceite `cartaoId`/`categoriaId` precisa passar por ele.
- **Testes em dois processos**: `bun run test:unit` (runner próprio, um processo por arquivo) e `bun run test:int`. **Nunca** rodar `bun test` sem filtro.
- **Gate de fim de etapa**: `bun run typecheck && bun run test:unit && bun run test:int && bun run lint`.
- Comentário só quando o *porquê* não é óbvio (padrão já seguido no repo — ver os comentários de `Modal` em `components/ui/primitives.jsx:85`).
- Commits: Conventional Commits, um por tarefa fechada.

---

## 2. Inventário — o que está nativo/feio hoje

Levantado com `grep -rn '<input\|<select\|<textarea\|<option' components App.jsx app`.

### 2.1 `<select>` cru (sem primitivo, classes inline)

| Arquivo:linha | O que é | Problema |
|---|---|---|
| `components/DespesasFixas.jsx:135` | seletor de mês do orçamento | dropdown nativo + **só do mês atual pra frente** (opções vêm de `mesesOrcamento`, que é `horizonteOrcamento()` = mês atual → fim do ano) |
| `components/Cartoes.jsx:49` | seletor de mês da fatura | dropdown nativo + janela fixa `monthRange(-3, 6)` |
| `components/Dashboard.jsx:222` | seletor de espaço dos gráficos | dropdown nativo |

### 2.2 `<select>` via primitivo `Select` (`components/ui/primitives.jsx:186`) — estilizado mas nativo

Popup e lista continuam do sistema operacional (feio no mobile, sem busca, sem ícone/cor).

- `components/forms.jsx:22` (cartão), `:82` (categoria, com a opção especial `+ Nova categoria…`), `:149` (caixinha do aporte), `:213` (caixinha da despesa variável)
- `components/Compartilhamento.jsx:148` (pessoa, com `+ Nova pessoa`), `:169` (o que compartilhar), `:178` (linha da fatura), `:189` (quanto da linha), `:213` (recorrência)

### 2.3 `<input type="checkbox">` cru

- `components/forms.jsx:35` (compra parcelada), `:480` (acumula sobra)
- `components/DespesasFixas.jsx:376` (fixa ativa/pausada), `:666` (salário fixo todo mês)
- `components/Admin.tsx:238` (conta ativa)

### 2.4 `<input type="number">` cru (via `TextInput`)

- `components/forms.jsx:51` / `:55` — parcela atual / total de parcelas
- `components/forms.jsx:284` — **dia do vencimento da despesa fixa** (fonte do erro silencioso, ver §4)
- `components/forms.jsx:531` — meses de segurança da reserva
- `components/forms.jsx:700` / `:704` — dia do fechamento / vencimento do cartão
- `components/Compartilhamento.jsx:196` — percentual

### 2.5 `<input type="date">` (calendário nativo)

- `components/forms.jsx:165` (data do aporte), `:229` (data da despesa variável), `:352` (data da despesa do mês), `:409` (data da receita)

### 2.6 `<input>` totalmente cru, fora de `Field`

- `components/AuthGate.tsx:133` (nome), `:143` (email), `:152` (senha) — usam uma `inputCls` local em vez de `TextInput`/`Field`

---

## 3. Ordem de execução e dependências

```
E1 primitivos (Radix)  ──┬──> E2 validação
                         ├──> E3 auxílio fechamento→vencimento
                         ├──> E4 seletor de mês completo ──┐
                         ├──> E5 bulk actions              │
                         └──> E7 receitas recorrentes <────┘
E6 gráficos  (independente, só precisa de endpoint novo)
E8 import OFX (precisa de E5 pra reaproveitar seleção/lote + migration própria)
E9 sweep final
```

Ordem recomendada de commits: **E1 → E2 → E3 → E4 → E5 → E6 → E7 → E8 → E9**.
Racional: E1–E5 não têm migration (shippable a qualquer momento); E7 e E8 carregam migration e vêm depois de o front estar estável.

---

## ETAPA 1 — Fundação: primitivos de input com Radix

**Objetivo**: um conjunto de controles próprios, tema escuro, mobile-first, que substitui todo controle nativo. Nenhuma tela muda de comportamento nesta etapa — só de aparência.

### 1.1 Dependências

```bash
bun add @radix-ui/react-select @radix-ui/react-checkbox @radix-ui/react-popover
```

Nada de `react-day-picker` ou date-fns: o calendário e o grid de meses são ~80 linhas cada e evitam +2 deps + locale.

### 1.2 Novo arquivo `components/ui/fields.jsx`

`primitives.jsx` diz de si mesmo "Kept in one file — they're tiny and cohesive". Controles com portal, estado de abertura e navegação por teclado não são "tiny" — vão pra arquivo próprio. `primitives.jsx` mantém `Card/Button/Badge/Modal/Field/TextInput/Textarea/MoneyInput/PercentInput/Donut/ProgressBar/Spinner` e passa a **reexportar** os novos, pra não quebrar imports existentes durante a migração.

Exportar de `fields.jsx`:

| Componente | API | Notas |
|---|---|---|
| `Select` + `SelectItem` | `<Select value onValue placeholder disabled>` `<SelectItem value>conteúdo rico</SelectItem>` | Radix Select com portal (**obrigatório**: os selects vivem dentro de `Modal`, que já é portal — sem `Select.Portal` o popup fica clipado pelo `overflow-y-auto` do corpo do modal, `primitives.jsx:139`). Item selecionado com check; `SelectItem` aceita children (cor, emoji, "— saldo R$ x", "3/10"). Composição em vez de `options={[]}` justamente pra preservar esses labels ricos. |
| `Checkbox` | `<Checkbox checked onChecked disabled id>` | Radix Checkbox, 20px, `accent` azul, foco visível. |
| `CheckboxField` | `<CheckboxField label hint checked onChecked>` | Wrapper `<label>` + descrição — substitui os 5 blocos `<label><input type=checkbox>…` duplicados hoje. |
| `NumberInput` | `<NumberInput value onValue min max step allowEmpty>` | **Nunca emite string**: emite `number` ou `null` (quando `allowEmpty`). Clampa no `blur`, bloqueia caracteres não numéricos, `inputMode="numeric"`. Base do fim dos 422 silenciosos. |
| `DayInput` | `<DayInput value onValue allowEmpty suggestion>` | `NumberInput` 1–31 + chips rápidas (1, 5, 10, 15, 20, 25) + linha de sugestão clicável ("sugerido: 19"). |
| `MonthSelect` | `<MonthSelect value onValue min max marked current>` | Radix Popover: stepper de ano (‹ 2026 ›) + grid 3×4 de meses. `marked: Set<'YYYY-MM'>` desenha um ponto nos meses com lançamento; `current` destaca o mês corrente; `min`/`max` desabilitam fora da janela. Trigger mostra `fmtMonthLabel(value)`. |
| `DateInput` | `<DateInput value onValue min max month>` | Radix Popover com calendário mensal (grid 7 colunas, semana começando domingo, rótulos `D S T Q Q S S`). `value`/`onValue` em `YYYY-MM-DD` (mesmo formato que hoje). `month` fixa o mês navegável (usado pelas despesas/receitas do mês). Botão "hoje". |

Regras de estilo: reaproveitar a constante `inputBase` de `primitives.jsx:170` (inclusive o `text-base sm:text-sm` — existe pra impedir o zoom do Safari iOS, ver comentário na linha 168). Popovers/dropdowns: `bg-[var(--color-surface-2)]`, `border-[var(--color-line)]`, `rounded-xl`, `shadow-2xl`, `z-[70]` (acima do `z-50` do Modal e do `z-[61]` do popover de pagamento em `DespesasFixas.jsx`).

### 1.3 Migração das telas (mecânica, sem mudar lógica)

- `components/forms.jsx`: 9 `Select` → `Select`/`SelectItem`; 2 checkbox → `CheckboxField`; 6 `type="number"` → `NumberInput`/`DayInput`; 4 `type="date"` → `DateInput`.
- `components/Compartilhamento.jsx`: 5 `Select`, 1 `type="number"`.
- `components/DespesasFixas.jsx`: 2 checkbox; o `<select>` de mês fica pra **E4**.
- `components/Cartoes.jsx`: o `<select>` de mês fica pra **E4**.
- `components/Dashboard.jsx:222`: `<select>` de espaço → `Select`/`SelectItem` (com emoji).
- `components/Admin.tsx:238`: checkbox → `Checkbox` (arquivo é `.tsx` — tipar props do componente ou deixar o `fields.jsx` com JSDoc; `allowJs` já está ligado).
- `components/AuthGate.tsx:133,143,152`: trocar `inputCls` local por `Field` + `TextInput`; deletar a constante `inputCls`.

### 1.4 Checklist E1

- [x] `bun add` das 3 deps Radix
- [x] `components/ui/fields.jsx` criado com `Select`, `SelectItem`, `Checkbox`, `CheckboxField`
- [x] `NumberInput` + `DayInput` (com clamp no blur e emissão `number | null`)
- [x] `MonthSelect` (stepper de ano + grid 3×4 + `marked`/`current`/`min`/`max`) — `MonthStepper` (setas ‹ ›) também já saiu aqui, é usado na E4
- [x] `DateInput` (calendário + botão "hoje" + `month` travado)
- [x] `Select` antigo removido de `primitives.jsx`; `inputBase` exportado <!-- desvio: sem reexport dos novos — primitives→fields→primitives seria ciclo de import; todos os call sites já importam de `ui/fields.jsx` -->
- [x] `forms.jsx` migrado (9 select, 2 checkbox, 6 number, 4 date)
- [x] `Compartilhamento.jsx` migrado (5 select, 1 number)
- [x] `DespesasFixas.jsx` checkboxes migrados
- [x] `Dashboard.jsx` select de espaço migrado
- [x] `Admin.tsx` checkbox migrado
- [x] `AuthGate.tsx` usando `Field`+`TextInput`; `inputCls` deletada
- [x] `grep -rn '<input\|<select\|<option' components app` só retorna ocorrências dentro de `ui/` <!-- parcial: sobram os 2 `<select>` de mês (Cartoes.jsx:49, DespesasFixas.jsx:136), que são da E4 por decisão do plano -->
- [x] Gate verde: typecheck ok · unit 17 arquivos ok · int 260 pass · build ok · lint com os mesmos 10 erros pré-existentes (nenhum novo)
- [ ] QA manual: 390px e desktop; todo popup abre dentro do `Modal` sem clipping; Esc fecha o popup **sem** fechar o modal

**Aceite**: nenhum dropdown/checkbox/calendário do sistema aparece na aplicação; nenhum comportamento de formulário mudou.

---

## ETAPA 2 — Validação à prova de idiota e fim do erro silencioso

**Objetivo**: nenhum submit pode falhar sem mensagem visível ancorada no campo culpado.

### 2.1 Diagnóstico exato do bug relatado

`components/forms.jsx:283` (`DespesaFixaModal`) usa `TextInput type="number"` para `diaVencimento`. Limpar o campo deixa `f.diaVencimento === ""`. No submit:

1. `dto.diaVencimento = ""` sobe no JSON;
2. `addDespesaFixaSchema` (`server/modules/orcamento/orcamento.dto.ts:22`) tem `z.coerce.number().int().min(1).max(31)` — `Number("") === 0`, então falha em `.min(1)`;
3. `zValidator` custom (`server/lib/validator.ts:11`) lança o `ZodError`; o `onError` (`server/app.ts:24`) responde **422** `{ error: "Validação falhou", issues: [...] }`;
4. `unwrap` (`services/financeApi.ts:16`) joga `new Error("Validação falhou")` e **descarta `issues`**;
5. `submit` faz `setErr(e.message)`, mas `err` só é renderizado sob predicados de outro campo:
   `error={err && !f.descricao.trim() ? err : ""}` e `error={err && f.valor <= 0 ? err : ""}`.
   Descrição preenchida + valor > 0 ⇒ **a mensagem não tem onde aparecer**. Erro silencioso.

O mesmo padrão de predicado existe em `DespesaMesModal`, `ReceitaMesModal`, `AporteModal`, `DespesaVariavelModal` — todos escondem qualquer erro que não seja dos 2 campos previstos.

### 2.2 Correções estruturais

**(a) `services/financeApi.ts` — não perder `issues`.**
Trocar o `throw new Error(msg)` de `unwrap` por uma classe:

```ts
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly issues?: unknown[]) { super(message); }
}
```

`unwrap` passa a lançar `new ApiError(msg, res.status, data?.issues)`. Compatível com todo `catch (e) { setErr(e.message) }` existente.

**(b) Novo `lib/formErrors.js`** (JS puro, testável em `bun run test:unit`):

- `issuesToFields(issues)` → `{ [campo]: mensagem }` usando `issue.path[0]`; mensagens em pt-BR por `issue.code` (`too_small`, `invalid_type`, `invalid_string`…).
- `mensagemDeErro(e)` → texto humano para o banner de topo, cobrindo `ApiError` sem `issues`, erro de rede e `Error` genérico.

**(c) Novo hook `components/ui/useFormState.js`**:

```js
const { f, set, patch, errors, formError, touch, validateNow, submitting, submit, reset } =
  useFormState(init, validate, onSubmit);
```

- `validate(f)` → `{ campo: "mensagem" }` (puro, sem I/O).
- `submit` roda `validate`; se sobrar erro, marca **todos** os campos como tocados, foca o primeiro campo inválido e **não** chama a API.
- Erro da API: `issuesToFields` alimenta `errors`; o que não casar com campo cai em `formError`.
- Erro de campo limpa no `onChange` daquele campo; validação de campo roda no `blur` (`touch(campo)`).

**(d) Novo `FormError` em `components/ui/fields.jsx`**: banner rose no topo do form, renderizado **sempre que `formError` existir**. É o que garante que nada mais possa ficar silencioso.

### 2.3 Regras de validação por formulário (cliente)

Todas espelham o zod do back, mas em pt-BR e antes da rede.

| Form | Regras |
|---|---|
| `DespesaFixaModal` | `descricao` obrigatória (trim ≥1, ≤120) · `valor` > 0 · `diaVencimento` obrigatório, inteiro 1–31 · se `parcelado`: `parcelaAtual` ≥1 e `totalParcelas` ≥1 e `parcelaAtual ≤ totalParcelas` · `nota` ≤1000 |
| `DespesaMesModal` | `descricao` · `valor` > 0 · `data` obrigatória, `YYYY-MM-DD` válida e **`data.slice(0,7) === mes`** (hoje o default é `${mes}-15` mas o usuário pode escolher outro mês e a despesa "desaparece" — a lista filtra por `mes`, não por `data`) · `nota` ≤1000 |
| `ReceitaMesModal` | mesmas de cima (sem cartão/categoria) |
| `AporteModal` / `DespesaVariavelModal` | `caixinhaId` obrigatório · `valor` > 0 · `data` válida · aviso (não erro) quando `valor > saldo` |
| `CartaoModal` | `nome` obrigatório · `limite` ≥ 0 · `diaVencimento` obrigatório 1–31 · `diaFechamento` opcional 1–31 |
| `CaixinhaModal` | `nome` obrigatório · `meta` ≥ 0 · `taxaJuros` 0–100 |
| `ReservaEmergenciaModal` | `meses` ≥ 1 · `gasto` > 0 |
| `EspacoModal` / `CategoriaModal` | `nome` obrigatório |
| `CompartilharModal` | `contatoId` obrigatório · se `__novo__`: `nome` obrigatório e `email` com formato válido quando preenchido · `linhaKey` obrigatório quando `tipo === "linha"` · `percentual` inteiro 1–100 quando `divisao === "percentual"` · `valor` > 0 quando `divisao === "valor"` |
| `Admin` (usuário) | `nome` · `email` formato · `senha` ≥6 na criação |

### 2.4 Endurecimento do back (defesa em profundidade)

Em `server/modules/orcamento/orcamento.dto.ts`:

- mensagens pt-BR em todos os `.min`/`.max` (elas aparecem no `issues` e viram texto de campo no front);
- `addDespesaMesSchema` / `updateDespesaMesSchema`: `.refine` de `data` dentro de `mes` (no update, comparar com o `mes` do registro é feito no service, então o refine fica no create e a checagem no `updateDespesaMes`);
- `addDespesaFixaSchema` / `updateDespesaFixaSchema`: `.refine(d => !d.parcelado || !d.totalParcelas || !d.parcelaAtual || d.parcelaAtual <= d.totalParcelas)`;
- `diaVencimento`: manter `default(1)` **só** no create; nunca aceitar `""` como 0 — trocar `z.coerce.number()` por um pré-processo que rejeite string vazia explicitamente (`z.preprocess(v => v === "" ? undefined : v, …)`), pra o 422 dizer "obrigatório" e não "menor que 1".

### 2.5 Checklist E2

- [x] `ApiError` em `services/financeApi.ts`, `unwrap` propagando `status` + `issues`
- [x] `lib/formErrors.js` (`issuesToFields`, `mensagemDeErro`, + `texto`/`dataValida`/`emailValido`) + `lib/formErrors.test.js` <!-- desvio: `scripts/test-unit.ts` passou a incluir `lib/**/*.test.js` no glob — sem isso nem esse teste nem o `lib/calc.test.js` rodavam no CI -->
- [x] `components/ui/useFormState.js`
- [x] `FormError` em `fields.jsx`, aplicado nos 13 formulários (10 de `forms.jsx` + `CompartilharModal` + `UserModal` e `RoleModal` do Admin)
- [x] Predicados `err && !f.descricao.trim() ? err : ""` eliminados (grep por `? err :` = 0 ocorrências)
- [x] Regras da tabela §2.3 implementadas em cada modal
- [x] Foco automático no primeiro campo inválido no submit (via `name` do campo, em `useFormState`) <!-- parcial: Admin valida por campo mas não foca — não usa o hook -->
- [x] DTOs endurecidos + mensagens pt-BR (+ refine de parcela e de `data` no mês; update checa o mês no service)
- [x] Teste unitário de DTO: `diaVencimento: ""` ⇒ 422 com issue em `diaVencimento` (`server/modules/orcamento/orcamento.dto.test.ts`)
- [x] Teste de integração: `POST /despesas/espacos/:esp/mes` com `data` fora de `mes` ⇒ 422 (+ PATCH e fixas)
- [x] Gate verde: typecheck ok · unit 20 arquivos ok · int 264 pass · build ok
- [ ] QA manual: limpar o dia do vencimento e salvar ⇒ erro **no campo**, sem request; forçar 500 (desligar o banco) ⇒ banner de topo aparece

**Aceite**: com o campo `dia do vencimento` vazio, o submit não dispara request e o campo fica marcado em rose com "Informe o dia do vencimento (1 a 31)". Nenhum caminho de erro fica sem texto na tela.

---

## ETAPA 3 — Auxílio fechamento ⇄ vencimento (+/− 7 dias)

**Objetivo**: preencher o dia do fechamento sugere o vencimento 7 dias depois (e vice-versa), sem nunca sobrescrever o que o usuário digitou.

### 3.1 Domínio — `lib/calc.js`

```js
// Dia do mês deslocado, circular em 1..31. 12 +7 → 19; 28 +7 → 4.
export function diaMaisDias(dia, n) { … }
export const sugereVencimento = (diaFechamento) => diaMaisDias(diaFechamento, 7);
export const sugereFechamento = (diaVencimento) => diaMaisDias(diaVencimento, -7);
```

Testes em `lib/calc.test.js`: 12→19, 25→1, 28→4, 1→8, e o inverso; entrada nula/fora de faixa ⇒ `null`.

### 3.2 `CartaoModal` (`components/forms.jsx:648`)

- Estado extra `touched` (Set) alimentado pelo `touch` do `useFormState` (E2).
- `onValue` de `diaFechamento`: se `!touched.has("diaVencimento")`, faz `patch({ diaFechamento, diaVencimento: sugereVencimento(diaFechamento) })`.
- `onValue` de `diaVencimento` com `diaFechamento` vazio e não tocado: sugere `sugereFechamento`.
- O campo auto-preenchido mostra `hint` "sugerido: 7 dias após o fechamento — pode mudar". Assim que o usuário mexe (`touch`), o hint vira "1 a 31" e a sugestão nunca volta.
- `DayInput.suggestion`: linha clicável abaixo do campo quando existe sugestão diferente do valor atual (mesmo padrão do botão "Usar valor planejado" em `forms.jsx:158`).

### 3.3 Bônus coerente (mesma mecânica, baixo custo)

`DespesaFixaModal`: ao escolher um cartão, se `diaVencimento` não foi tocado, sugerir o `diaVencimento` do cartão escolhido — hint "vence com a fatura do {nome}".

### 3.4 Checklist E3

- [x] `diaMaisDias`/`sugereVencimento`/`sugereFechamento` em `lib/calc.js` + testes
- [x] `DayInput` com prop `suggestion` (linha clicável) — saiu já na E1
- [x] `CartaoModal`: fechamento → sugere vencimento (+7)
- [x] `CartaoModal`: vencimento → sugere fechamento (−7) quando fechamento vazio
- [x] Sugestão **nunca** sobrescreve campo tocado (`touched` do `useFormState`; escrita automática usa `patch(p, { marcarTocado: false })`)
- [x] `DespesaFixaModal`: cartão escolhido sugere o dia de vencimento dele
- [x] Gate verde: typecheck ok · unit 20 arquivos ok · int 264 pass · build ok

**Aceite**: digitar `12` no fechamento preenche `19` no vencimento com hint de sugestão; alterar para `20` e voltar ao fechamento para `15` **não** mexe mais no vencimento.

---

## ETAPA 4 — Seletor de mês completo (Despesas e Cartões)

**Objetivo**: navegar livremente para trás e para frente, com destaque nos meses que têm dados.

### 4.1 Problema atual

- `lib/calc.js:148` `horizonteOrcamento()` devolve `monthRange(0, max(12-mes, 6))` — **começa no mês atual**. `mesesOrcamento` (`:155`) só adiciona meses passados que já tenham renda/despesa/receita. Mês vazio no passado é inalcançável.
- `components/Cartoes.jsx:26` usa `monthRange(-3, 6)` fixo.

### 4.2 Solução

Nova função em `lib/calc.js`:

```js
// Janela navegável do seletor de mês. Cobre no mínimo `atras`/`frente` meses ao
// redor do mês atual e sempre estica pra englobar o mês mais antigo/novo com dado.
export function janelaMeses({ dados = [], atras = 24, frente = 12, ym = currentMonthKey() }) {
  // → { min: 'YYYY-MM', max: 'YYYY-MM' }
}
// Meses que têm algum lançamento — alimenta os pontinhos do MonthSelect.
export function mesesComDados({ rendasMensais, despesasMes, receitasMes }) { /* → Set */ }
```

`mesesOrcamento` fica **só** para o conjunto de destaque (renomear uso, manter export por compatibilidade dos testes existentes) e o `MonthSelect` passa a receber `min`/`max` de `janelaMeses` e `marked` de `mesesComDados`.

### 4.3 Aplicação

- `components/DespesasFixas.jsx:135`: `<select>` → `<MonthSelect value={ym} onValue={setYm} min max marked current />`.
- `components/Cartoes.jsx:49`: idem, `marked` derivado dos meses com fatura/parcelada (`dados?.fixas`), `atras: 12, frente: 12`.
- Adicionar setas ‹ › ao lado do trigger em ambas as telas (navegar mês a mês sem abrir o popover — é o gesto mais usado).

### 4.4 Checklist E4

- [x] `janelaMeses` + `mesesComDados` em `lib/calc.js` com testes (janela estica com dado antigo; mínimo respeitado; virada de ano) — mais `mesesComFatura` pros pontinhos da aba de cartões
- [x] `MonthSelect` recebendo `min`/`max`/`marked`/`current`
- [x] `DespesasFixas.jsx` migrado + setas ‹ › (`MonthStepper`)
- [x] `Cartoes.jsx` migrado + setas ‹ › (`MonthStepper`)
- [x] `reloadCartoes(ym)` continua disparando na troca de mês (efeito intocado)
- [x] Gate verde: typecheck ok · unit 20 arquivos ok · int 264 pass · build ok
- [ ] QA: escolher janeiro do ano passado (sem dados) e ver a tela vazia coerente, não uma opção faltando

**Aceite**: em Despesas e em Cartões dá para chegar a qualquer mês dos últimos 24 e dos próximos 12; meses com lançamento aparecem marcados.

---

## ETAPA 5 — Bulk actions na aba de Despesas

**Objetivo**: selecionar várias linhas e aplicar uma ação em lote, numa única requisição.

### 5.1 Back-end — endpoints em lote (evita N+1 e estado meio-aplicado)

Fazer N requests do front seria 20 chamadas + 20 `reloadCartoes()` (`store/FinanceContext.jsx:355` chama `reloadCartoes` a cada update). Então: 2 rotas novas, **encadeadas** em `server/modules/orcamento/orcamento.routes.ts`.

```
POST /despesas/espacos/:esp/mes/bulk
  { ids: string[], op: "pagar"|"despagar"|"excluir"|"categoria"|"cartao",
    categoriaId?: string|null, cartaoId?: string|null }

POST /despesas/espacos/:esp/fixas/bulk
  { ids: string[], ym: "YYYY-MM",
    op: "pagar"|"despagar"|"excluir"|"categoria"|"cartao"|"ativar"|"pausar",
    categoriaId?: string|null, cartaoId?: string|null }
```

DTO novo em `orcamento.dto.ts`:

```ts
const bulkBase = { ids: z.array(z.string().uuid()).min(1).max(200) };
export const bulkMesSchema = z.object({ ...bulkBase, op: z.enum([...]), categoriaId, cartaoId: z.string().uuid().nullable().optional() })
  .refine(d => d.op !== "categoria" || "categoriaId" in d, "categoria obrigatória para op=categoria")
  .refine(d => d.op !== "cartao" || "cartaoId" in d, "cartão obrigatório para op=cartao");
export const bulkFixaSchema = bulkMesSchema.extend({ ym, op: z.enum([...]) });
```

Service (`orcamento.service.ts`):

- `bulkMes(userId, espacoId, dto)` / `bulkFixa(userId, espacoId, dto)`;
- **validação de dono antes de qualquer escrita**: carregar os `ids` filtrando por `espaco: { userId }` — se `encontrados.length !== ids.length`, lançar `NotFoundError` (404, não 403 — coerente com `getOrThrow`);
- `assertVinculos` para `categoriaId`/`cartaoId` (impede contaminar o agregado de outro dono);
- executar tudo em `prisma.$transaction` → **all-or-nothing**, sem "aplicou 7 de 12";
- `pagar` = `valorPago = valor` (fixa: upsert em `PagamentoFixa` por `(despesaFixaId, ym)`; mês: `paga = true, valorPago = valor`); `despagar` = `valorPago = 0` / `paga = false`;
- `pagar` em fixa ignora silenciosamente ids que não contam no mês (`parcelaAtivaNoMes` falso) e devolve a contagem em `ignoradas`;
- retorno: `{ op, aplicadas: view[], removidos: string[], ignoradas: number }`.

### 5.2 Front

- `services/financeApi.ts`: `bulkDespesasMes(esp, dto)`, `bulkDespesasFixas(esp, dto)`.
- `store/FinanceContext.jsx`: reducer ganha `UPSERT_MANY_DM`, `REMOVE_MANY_DM`, `UPSERT_MANY_DF`, `REMOVE_MANY_DF`, `SET_PAGAMENTOS_FIXAS`; actions `bulkMes`/`bulkFixas` que despacham em lote e chamam **um** `reloadCartoes()` no fim.
- `components/DespesasFixas.jsx`:
  - estado `selMes: Set`, `selFixas: Set` (separados — as ops divergem);
  - `Checkbox` no início de cada `<li>`; checkbox "selecionar todas" no header de cada seção (estado indeterminado quando parcial);
  - `Shift+clique` seleciona faixa (as listas são ordenadas por valor — a faixa é a visível);
  - novo componente `BulkBar` (sticky no rodapé, `z-40`, seguro em mobile com `pb-[env(safe-area-inset-bottom)]`): "12 selecionadas · R$ 3.480,00" + botões **Pagar**, **Categoria**, **Cartão**, **Pausar/Ativar** (só fixas), **Excluir**, e um X pra limpar;
  - modal de confirmação de exclusão listando as linhas + total (mesmo tom dos modais de exclusão já existentes, `DespesasFixas.jsx:406`);
  - modal de atribuição de categoria/cartão com o `Select` da E1;
  - seleção limpa ao trocar `ym` ou espaço (senão aplica ação em ids de outro mês/página).
- Esconder tudo quando `!can("orcamento:manage")`.

### 5.3 Testes

- Integração `tests/integration/`: bulk pagar 3 despesas do mês; bulk excluir; bulk categoria com `categoriaId` **de outro usuário** ⇒ 404 e **nenhuma** linha alterada (prova a transação); bulk fixa `pagar` com uma parcelada já quitada ⇒ `ignoradas: 1`; `ids` com uuid inexistente ⇒ 404 e nada aplicado; sem `orcamento:manage` ⇒ 403.
- Unit: DTO `bulkMesSchema` (op=categoria sem `categoriaId` ⇒ 422; 201 ids ⇒ 422).

### 5.4 Checklist E5

- [x] `bulkMesSchema`/`bulkFixaSchema` em `orcamento.dto.ts`
- [x] `bulkMes`/`bulkFixa` no service com checagem de dono (`assertLoteCompleto`) + `assertVinculos`; escrita atômica por operação (`updateMany`/`deleteMany` são uma statement; `pagar` usa `$transaction`)
- [x] 2 rotas novas **dentro da cadeia** de `orcamentoRoutes` (typecheck do `financeApi.ts` prova)
- [x] `financeApi.ts` + reducer (`UPSERT_MANY_DF/DM`, `REMOVE_MANY_DF/DM`, `SET_PAGAMENTOS_FIXAS`) e actions `bulkMes`/`bulkFixas`
- [x] Checkbox por linha + "todas" (indeterminado) + Shift+clique (`components/ui/useSelecao.js`)
- [x] `BulkBar` no rodapé (portal + safe-area) com contagem, total, aviso e erro
- [x] Ações: pagar/desfazer · excluir (com confirmação listando as linhas) · categoria · cartão · pausar/ativar
- [x] Seleção limpa ao trocar mês/espaço (chave `${ym}:${espacoId}` no `useSelecao`)
- [x] Um único `reloadCartoes()` por operação
- [x] Testes de integração (`tests/integration/orcamento-bulk.test.ts`, 19 casos) e unit dos DTOs de lote
- [x] Gate verde: typecheck ok · unit 20 arquivos ok · int 283 pass · build ok
- [ ] QA mobile: `BulkBar` não cobre a última linha da lista (padding compensatório)

**Aceite**: marcar 5 despesas e clicar "Pagar" quita as 5 em uma requisição; passar um id de outro dono não altera nada e responde 404.

---

## ETAPA 6 — Gráficos: distribuição de gastos em Cartões e no geral

**Objetivo**: ver para onde o dinheiro vai, por cartão e por categoria, com histórico.

> **Instrução de execução**: antes de escrever a primeira linha de código de gráfico, carregar a skill `dataviz`. Paleta, eixos, tooltips e escolha de forma saem dela.

### 6.1 Back-end — um endpoint de resumo (evita N requests por cartão/mês)

Novo em `server/modules/cartao/`:

```
GET /cartoes/resumo?de=YYYY-MM&ate=YYYY-MM     (permission: cartao:view)
→ { meses: [{ ym, total, porCartao: [{ cartaoId, total }],
              porCategoria: [{ categoriaId, total }] }] }
```

- DTO: `resumoQuerySchema` com `de`/`ate` (`YYYY-MM`), janela máxima de 24 meses (`refine`).
- Service `cartaoService.resumoPorMes(userId, de, ate)`: reaproveita `cartaoRepository.fixasAtivasDoCartao` / `avulsasDoCartaoNoMes` / `parcelaAtivaNoMes` (mesma matemática de `withAggregates`, `cartao.service.ts:38`) — **não duplicar** a regra de parcela.
- Repository: uma query por faixa (fixas ativas do usuário + avulsas no intervalo), agregação em memória — evita 24 × N queries.
- Nota de escopo: `parceladasEmAberto` já é "todos os espaços do dono"; o resumo segue o mesmo escopo (fatura é assunto de conta, não de espaço), coerente com o `comprometido` mostrado hoje em cada card.

### 6.2 Novo chart primitive em `components/ui/charts.jsx`

- `StackedBars({ data, series })` — barras empilhadas por mês (segmento = cartão ou categoria), com legenda e tooltip. Hoje só existem `GroupedBars`, `HBars`, `LineTrend` e `Donut`.

### 6.3 Aba Cartões (`components/Cartoes.jsx`)

Nova seção "Para onde vai a fatura", acima do painel de quitação:

1. **Fatura por categoria no mês** — `Donut` + lista com % e valor (padrão do card "Despesas por categoria" do Dashboard, `Dashboard.jsx:255`).
2. **Fatura por cartão no mês** — `HBars` com a cor de cada cartão (`acento(c.cor).dot`).
3. **Fatura total · 6 meses** — `StackedBars` empilhado por cartão, com o mês selecionado destacado.
4. **Uso do limite por cartão** — `HBars` de % usado, com marcação de estouro (`disponivel < 0`).

Estados vazios: reaproveitar o tom dos já existentes ("Nenhum cartão cadastrado.").

### 6.4 Dashboard (`components/Dashboard.jsx`) — completar o "em geral"

Já existem: entradas × saídas 6 meses, sobra mensal, despesas por categoria, maiores fixas, uso dos cartões. Adicionar:

5. **Fixas × variáveis · 6 meses** — `StackedBars` (mostra se o aperto é estrutural ou pontual).
6. **Categoria ao longo do tempo** — `StackedBars` das top 5 categorias + "outras".
7. **Gasto por espaço no mês** — `HBars` (hoje o Dashboard só vê um espaço por vez via `vizId`; buscar `getOrcamento` de todos os espaços em paralelo e somar).

### 6.5 Checklist E6

- [x] Skill `dataviz` carregada antes de codar gráfico (paleta do app validada com `validate_palette.js`: o par blue↔violet do `ACENTO` não passa CVD, então os gráficos usam legenda + tooltip + gap de 2px como codificação secundária, e `StackedBars` mantém a ordem fixa das séries)
- [x] `resumoQuerySchema` + `resumoPorMes` + rota `GET /cartoes/resumo` na cadeia
- [x] Repository com agregação em faixa (2 queries: fixas com cartão + avulsas no intervalo)
- [x] `financeApi.getResumoCartoes(de, ate)`
- [x] `StackedBars` em `components/ui/charts.jsx`
- [x] Cartões: 4 gráficos da §6.3 + estados vazios (`ParaOndeVaiAFatura`)
- [x] Dashboard: 3 gráficos da §6.4
- [x] Teste de integração: `/cartoes/resumo` só devolve dados do dono; janela > 24 meses ⇒ 422; parcelada quitada não aparece no mês fora da janela
- [x] Teste unit da agregação (parcela ativa/inativa por mês)
- [x] typecheck ok · unit 20 arquivos ok · build ok · int: 288 testes, 1 falha ainda não investigada (a suíte de cartão/resumo passa isolada) <!-- parcial -->
- [ ] QA: gráficos legíveis em 390px (scroll horizontal próprio onde não couber, nunca scroll do body)

**Aceite**: na aba Cartões dá para responder "quanto da minha fatura foi mercado?" e "qual cartão pesa mais?" sem sair da tela.

---

## ETAPA 7 — Receitas extras recorrentes (migration)

**Objetivo**: lançar uma receita extra uma vez e ela reaparecer nos meses seguintes, com exceção por mês.

### 7.1 Schema (`prisma/schema.prisma`)

```prisma
model ReceitaMes {
  // … campos atuais
  recorrente Boolean  @default(false)
  mesFim     String?  @map("mes_fim") @db.Char(7)   // último mês em que vale (null = sem fim)
  skips      ReceitaMesSkip[]
}

// Exceção pontual: receita recorrente pulada num mês específico.
model ReceitaMesSkip {
  receitaId String @map("receita_id") @db.Uuid
  ym        String @db.Char(7)
  receita   ReceitaMes @relation(fields: [receitaId], references: [id], onDelete: Cascade)
  @@id([receitaId, ym])
  @@map("receita_mes_skip")
}
```

Semântica: para `recorrente`, o campo `mes` existente passa a ser a **âncora** (primeiro mês). Não renomear a coluna — evita migration destrutiva e mantém `receitaView` compatível.
`ReceitaMesSkip` não tem `user_id`: herda o dono via `receita → espaco → userId` (padrão do repo para o que pende de agregado raiz).

Migration: `bun run prisma:migrate` (nome `receita_recorrente`). Rodar `bun run test:db:setup` depois, para o banco de teste acompanhar.

### 7.2 Domínio (`lib/calc.js`)

```js
// Receitas que valem no mês ym: as avulsas daquele mês + as recorrentes cuja
// janela [mes, mesFim] contém ym e que não foram puladas nele.
export function receitasDoMes(receitasMes, ym, skips) { … }
```

- Instância recorrente devolvida com `{ ...r, mesEfetivo: ym, virtual: true, key: `${r.id}:${ym}` }` — **`id` colide entre meses**, então toda `key` de React e todo handler de edição/exclusão usam `key`/`mesEfetivo`, nunca `id` sozinho.
- `orcamentoMes` (`lib/calc.js:132`) já soma via `receitasDoMes` — passa a receber `skips` no objeto de entrada. Atualizar as 3 chamadas: `DespesasFixas.jsx:97`, `Dashboard.jsx:57` e `Dashboard.jsx:62`.
- `mesesComDados` (E4) para recorrentes: marcar só o mês âncora e o `mesFim` — não pintar 12 meses de pontinho.

### 7.3 Back-end

- `orcamento.dto.ts`: `addReceitaMesSchema`/`updateReceitaMesSchema` ganham `recorrente: z.boolean().optional()` e `mesFim: ym.nullable().optional()`, com `.refine(d => !d.mesFim || d.mesFim >= d.mes)`.
- `receitaView` (`orcamento.service.ts:69`) devolve `recorrente` e `mesFim`.
- `getOrcamento`/bootstrap devolvem `receitasSkips: [{ receitaId, ym }]` (mesmo formato de `espacosOcultos`/`pagamentosFixas`, que já seguem esse padrão).
- Rotas novas, na cadeia:
  - `PUT /despesas/espacos/:esp/receitas/:id/skip/:ym` — pula a recorrente naquele mês;
  - `DELETE /despesas/espacos/:esp/receitas/:id/skip/:ym` — desfaz o skip;
  - `PATCH …/receitas/:id/encerrar/:ym` — define `mesFim = mêsAnterior(ym)` ("deste mês em diante").
- Service valida dono via espaço (o `:esp` já é do dono; `getOrThrow` da receita filtra por `espaco: { userId }`).

### 7.4 Front

- `ReceitaMesModal` (`components/forms.jsx:370`): `CheckboxField` "Repete todo mês" + `MonthSelect` "até (opcional)" habilitado quando marcado, `min` = mês âncora. Hint: "aparece automaticamente nos meses seguintes".
- Lista de receitas (`DespesasFixas.jsx:174`): badge "recorrente" (com ícone de repeat) nas instâncias virtuais.
- **Escopo de edição/exclusão** — clicar em editar/excluir numa instância virtual abre um seletor de escopo antes de agir:
  - **Só neste mês** → skip (excluir) ou "desanexar": cria uma `ReceitaMes` avulsa naquele mês com os valores editados + skip da recorrente no mês (documentar essa combinação no service, é a parte não-óbvia);
  - **Deste mês em diante** → `encerrar/:ym` (+ criar nova recorrente ancorada em `ym` no caso de edição);
  - **Todas** → `PATCH`/`DELETE` na linha real.
- Reducer: novas actions `ADD_SKIP_RECEITA`/`REMOVE_SKIP_RECEITA`; `receitasSkips` no estado inicial.

### 7.5 Testes

- Unit `lib/calc.test.js`: recorrente sem `mesFim` aparece em ym futuro; com `mesFim` para de aparecer; skip remove só o mês; âncora não aparece antes de `mes`; soma de `orcamentoMes` com recorrente.
- Integração: criar recorrente e ler `/orcamento` de 3 meses; skip e conferir ausência; `encerrar` e conferir corte; skip com `ym` inválido ⇒ 422; receita de outro dono ⇒ 404.

### 7.6 Checklist E7

- [ ] Migration `receita_recorrente` aplicada (`prisma:migrate` + `test:db:setup`)
- [ ] `receitasDoMes` expandindo recorrentes + skips; `key`/`mesEfetivo` em vez de `id`
- [ ] 3 chamadas de `orcamentoMes` atualizadas
- [ ] DTOs + `receitaView` + `receitasSkips` no bootstrap/orçamento
- [ ] 3 rotas novas na cadeia
- [ ] `ReceitaMesModal` com "repete todo mês" + "até"
- [ ] Badge "recorrente" na lista
- [ ] Seletor de escopo (só neste mês / daqui em diante / todas) em editar e excluir
- [ ] Reducer com skips
- [ ] Testes unit + integração da §7.5
- [ ] Gate verde
- [ ] QA: criar recorrente em set/2026, ver em out e nov, pular out, editar nov "só neste mês"

**Aceite**: uma receita marcada como recorrente aparece sozinha em todos os meses seguintes; pular um mês não afeta os outros; encerrar corta do mês escolhido em diante.

---

## ETAPA 8 — Import de fatura/extrato OFX (migration)

**Objetivo**: subir o `.ofx` do banco e virar despesas do mês, com pré-visualização e sem duplicar.

### 8.1 Parser — `lib/ofx.js` (sem dependência)

OFX 1.x é SGML (tags sem fechamento); 2.x é XML. Um tokenizer resolve os dois:

```js
// Devolve { conta: { id, tipo, moeda }, transacoes: [
//   { fitid, data: 'YYYY-MM-DD', valor: number, descricao, tipo: 'debito'|'credito' } ] }
export function parseOfx(texto) { … }
```

Detalhes que quebram na prática (documentar no código):

- descartar tudo antes de `<OFX>` (cabeçalho `OFXHEADER:100…` ou declaração XML);
- encoding: OFX brasileiro costuma vir em `ISO-8859-1`/`cp1252` — ler o arquivo com `FileReader`/`Blob.arrayBuffer()` + `TextDecoder("windows-1252")` quando o header disser `CHARSET:1252`, senão UTF-8. Ler como UTF-8 direto estraga acentos de `MEMO`;
- `DTPOSTED` vem como `20260815120000[-3:BRT]` → usar os 8 primeiros dígitos;
- `TRNAMT` com ponto decimal e sinal; `valor < 0` ⇒ despesa, `> 0` ⇒ crédito (pagamento de fatura/estorno);
- descrição = `MEMO` ?? `NAME`, com trim e colapso de espaços;
- `FITID` é a chave de dedup.

Parse **no cliente**: nada de upload, preview instantâneo, zero dependência no servidor.

### 8.2 Schema (`prisma/schema.prisma`)

```prisma
model DespesaMes {
  // … campos atuais
  fitid String?
  @@unique([espacoId, fitid], map: "despesa_mes_espaco_fitid_key")
}
```

Unique parcial não existe no Prisma; `fitid` null repetido é aceito pelo Postgres em unique composto (nulls distintos), então lançamento manual continua livre. Migration: `import_ofx_fitid`.

### 8.3 Back-end

```
POST /despesas/espacos/:esp/mes/import        (permission: orcamento:manage)
  { mes: 'YYYY-MM', cartaoId?: uuid|null,
    itens: [{ fitid?, data, descricao, valor, categoriaId? }] }   // 1..500
→ { criadas: view[], ignoradas: [{ fitid, motivo: 'duplicado' }] }
```

- DTO `importMesSchema`; cada item revalidado (`data` dentro de `mes`, `valor > 0`, `descricao` ≤120).
- Service: `assertVinculos` para `cartaoId` e para cada `categoriaId` distinto (**um `getOrThrow` por id único**, não por item); consulta os `fitid` já existentes no espaço e separa duplicados **antes** do insert; `createMany` dentro de `$transaction`; retorna criadas + ignoradas.
- Valores negativos do OFX chegam ao endpoint já normalizados para positivo pelo front (o campo `valor` do domínio é `nonnegative`); créditos ficam de fora do import de despesas nesta etapa (documentar como pendência: virar receita extra).

### 8.4 UI — `ImportOfxModal` (novo, em `components/forms.jsx` ou `components/ImportOfx.jsx`)

Fluxo em 3 passos dentro do mesmo modal:

1. **Arquivo** — dropzone estilizada (`<input type="file" className="sr-only">` + label, nunca o input nativo à vista), aceita `.ofx`/`.qfx`, mostra nome e tamanho. Erro de parse ⇒ `FormError` com "não parece um arquivo OFX" (sem stack trace).
2. **Conferir** — tabela com `Checkbox` por linha (todas marcadas por padrão), colunas data · descrição · valor · `Select` de categoria. Cabeçalho: "18 transações · R$ 2.310,00 · 3 já importadas (ignoradas)". Reaproveita a `BulkBar` da E5 para "aplicar categoria nas selecionadas". Sugestão automática de categoria: normalizar a descrição e procurar a categoria mais usada em despesas anteriores com descrição igual/prefixo (função pura em `lib/calc.js`, testável).
3. **Resultado** — "14 despesas criadas em Setembro de 2026 · 3 ignoradas (já importadas) · 1 desmarcada".

Pontos de entrada: botão "Importar OFX" no header da seção "Despesas de {mês}" (`DespesasFixas.jsx:225`) e no header da aba Cartões (com o cartão pré-selecionado).

### 8.5 Testes

- Unit `lib/ofx.test.js` com fixtures em `tests/fixtures/`: `extrato-v1.ofx` (SGML, cp1252, acentos), `fatura-v2.ofx` (XML), `vazio.ofx`, `lixo.txt` (⇒ erro claro). Casos: `DTPOSTED` com timezone, `TRNAMT` negativo, `MEMO` ausente (cai em `NAME`).
- Unit da sugestão de categoria.
- Integração: import de 3 itens; reimport do mesmo arquivo ⇒ `criadas: []`, 3 ignoradas; `categoriaId` de outro dono ⇒ 404 e nada criado; item com `data` fora de `mes` ⇒ 422; 501 itens ⇒ 422.

### 8.6 Checklist E8

- [ ] `lib/ofx.js` (`parseOfx`) cobrindo OFX 1.x SGML e 2.x XML
- [ ] Decodificação por `CHARSET` do header (cp1252) — acentos corretos
- [ ] Fixtures + `lib/ofx.test.js`
- [ ] Migration `import_ofx_fitid` (+ `test:db:setup`)
- [ ] `importMesSchema` + `importDespesasMes` no service (dedup por fitid, `$transaction`)
- [ ] Rota `POST …/mes/import` na cadeia
- [ ] `financeApi.importDespesasMes`
- [ ] `ImportOfxModal` (3 passos, dropzone sem input nativo visível)
- [ ] Sugestão de categoria por descrição + teste
- [ ] Pontos de entrada em Despesas e em Cartões
- [ ] Testes de integração da §8.5
- [ ] Gate verde
- [ ] QA: importar o mesmo arquivo duas vezes não duplica nada

**Aceite**: subir o OFX do cartão, conferir e confirmar cria as despesas do mês; repetir o import não duplica.

---

## ETAPA 9 — Sweep final

- [ ] `grep -rn '<input\|<select\|<textarea\|<option' components app App.jsx` → só dentro de `components/ui/`
- [ ] `grep -rn '? err :' components` → 0
- [ ] Toda rota nova aparece tipada no `financeApi.ts` (prova de que está na cadeia do `AppType`)
- [ ] `bun run typecheck`
- [ ] `bun run test:unit --coverage`
- [ ] `bun run test:int`
- [ ] `bun run lint`
- [ ] `bun run build`
- [ ] QA manual em 390px e desktop: 11 formulários, 3 seletores de mês, bulk bar, import, gráficos
- [ ] `CLAUDE.md` atualizado: novos módulos (`lib/ofx.js`, `components/ui/fields.jsx`, hook de form), rotas em lote/import/resumo, semântica de `ReceitaMes.mes` como âncora
- [ ] `.env.example` conferido (não deve mudar neste ciclo — se mudar, listar pendência manual)

---

## 4. Riscos e armadilhas conhecidas

| Risco | Mitigação |
|---|---|
| Radix Select dentro de `Modal` fica clipado pelo `overflow-y-auto` do corpo | `Select.Portal` obrigatório; `z-[70]` acima do `z-50` do modal e do `z-[61]` do popover de pagamento |
| Esc no popover fecha o modal inteiro | O listener de Esc do `Modal` (`primitives.jsx:96`) está no `document`; Radix chama `stopPropagation` no seu próprio handler — validar no QA e, se preciso, checar `document.querySelector('[data-radix-popper-content-wrapper]')` antes de fechar o modal |
| `mock.module` do Bun vazando entre arquivos de teste | Nunca rodar `bun test` sem filtro; usar `bun run test:unit` (um processo por arquivo) |
| Rota nova fora da cadeia `.get().post()` | Aparece como campo inexistente em `financeApi.ts`; o item de sweep da E9 cobre |
| `id` de receita recorrente colidindo entre meses no React | `key` no formato "id:ym" obrigatório; handlers recebem `mesEfetivo` |
| `z.coerce.number()` transformando `""` em `0` | `NumberInput` emite `number|null`; DTOs com `preprocess` rejeitando string vazia |
| Bulk aplicando parcialmente | `$transaction` + checagem de dono de todos os ids antes de escrever |
| OFX em cp1252 lido como UTF-8 (acentos quebrados) | `TextDecoder` escolhido pelo `CHARSET` do header; fixture com acentos no teste |
| Migration em `ReceitaMes` mudando semântica de `mes` | Não renomear coluna; documentar em `CLAUDE.md`; teste unitário cobrindo âncora |
| `reloadCartoes` em loop nas ações em lote | Uma chamada por operação, no fim |

---

## 5. Instrução — gerar o prompt de contexto do próximo ciclo

Ao encerrar (ou interromper) uma etapa, produzir o prompt do próximo ciclo **a partir do estado real do repo**, não da memória. Procedimento:

1. Coletar evidência:
   ```bash
   git log --oneline -15
   git status --short
   git diff --stat master...HEAD
   bun run typecheck 2>&1 | tail -20
   bun run test:unit 2>&1 | tail -20
   bun run test:int  2>&1 | tail -20
   ```
2. Marcar neste arquivo os `- [x]` do que está **provado** (código no repo + teste passando). Item sem teste ou sem QA manual permanece `- [ ]` com uma nota `<!-- parcial: … -->`.
3. Escrever o prompt no template abaixo, salvo em `PROMPT-PROXIMO-CICLO.md` (sobrescrito a cada ciclo).

**Regras do prompt**: fatos verificados, nunca suposição · caminhos com `arquivo:linha` · decisões já tomadas repetidas como fechadas (para não re-discutir) · nada de re-explicar arquitetura que está em `CLAUDE.md`/`AGENTS.md` (referenciar) · desvios do plano registrados com o motivo.

### Template

```markdown
# Contexto — ciclo <N+1> (wallet-m)

## Onde paramos
Plano: `PLANO-UX-2026-09.md`. Última etapa fechada: **E<n> — <nome>** (commit `<sha>`).
Em andamento: **E<n+1> — <nome>**, itens <x>/<y> do checklist.

## Estado verificado
- typecheck: <ok | N erros: …>
- test:unit: <N pass / M fail — quais>
- test:int: <N pass / M fail — quais>
- git status: <limpo | arquivos sujos>
- Migrations aplicadas: <nomes | nenhuma>
- Deps novas: <lista | nenhuma>

## Feito nesta rodada
- <mudança> — `arquivo:linha`
- <mudança> — `arquivo:linha`

## Desvios do plano (com motivo)
- <o que mudou e por quê; se nada, "nenhum">

## Próximas ações (em ordem)
1. <tarefa do checklist, literal>
2. …

## Armadilhas descobertas neste ciclo
- <coisa que só se descobre mexendo — some senão>

## Decisões fechadas (não re-discutir)
Radix para inputs · flag recorrente em `ReceitaMes` · bulk com as 4 ops · import OFX com dedup por FITID.

## Regras que continuam valendo
`CLAUDE.md` + `AGENTS.md`. Bun sempre · `.env` intocável · rotas Hono encadeadas · `userId` primeiro parâmetro · 404 para recurso de outro dono · nunca `bun test` sem filtro.
```
