# Bugs e pendências do front — achados pela suíte de testes

> Documento de trabalho, irmão de `TESTES-FRONTEND.md`. Serve pra **retomar depois de
> limpar o contexto**: cada item traz onde está, como reproduzir, o efeito e a correção.
> Os itens P1, P2, o refactor do provider e o lint foram **corrigidos** em 2026-07-25 —
> viraram a seção "Corrigidos", com o teste que agora fixa o comportamento novo. O que
> segue aberto são as duas **decisões de produto** (código sem UI) e uma nota de
> infraestrutura.

Contexto rápido:

```bash
bun run test        # lib + unit + integração + front (sai 0)
bun run test:front  # só a camada 2 (happy-dom + app Hono real + Postgres)
bun run typecheck   # limpo
bun run lint        # limpo (0 erros, 0 warnings) — bloqueante no CI desde a correção do item 13
```

Legenda de prioridade: **P1** quebra ou engana o usuário · **P2** UX/a11y ·
**P3** higiene.

---

## Abertos

### 10. Ações do contexto sem UI (P3 — decisão de produto)

- **Onde**: `store/FinanceContext.jsx` — `renameEspaco`, `updateCategoria`,
  `removeCategoria`, `resetAll`. Nenhuma tela dispara.
- **Decidir**: construir a UI (renomear página, gerenciar categorias, "restaurar dados
  de exemplo") ou remover o código morto. **Decisão de 2026-07-25: manter, decidir
  depois.**
- **Hoje**: coberto por `tests/front/store.test.tsx` e
  `tests/front/finance-api.test.ts` — se remover, remover os testes junto.

### 11. `lib/calc.js` tem funções órfãs (P3 — decisão de produto)

- **Onde**: `movsDoMes`, `resumoMensal`, `mesesDisponiveis`, `saldoProjetado` (esta só
  via `mesesParaMeta`). Nenhum componente importa.
- **Hoje**: 100% cobertas por `test:lib`, 0% no run do front — é o motivo do
  `lib/calc.js` aparecer com 77% na medição de cobertura do front.
- **Decidir**: manter (são úteis e testadas) ou remover as que não têm futuro.
  **Decisão de 2026-07-25: manter, decidir depois.**

### 12. `test:lib` fora do runner por-arquivo (nota, não é bug)

- **Onde**: `package.json` → `"test:lib": "bun test ./lib/"`.
- **Nota**: o `./` é obrigatório — o filtro `lib` casaria também `server/lib/*.test.ts`,
  que pertencem à suíte unitária (com `mock.module`). Se algum dia um teste de `lib/`
  precisar de `mock.module`, migrar pro molde de `scripts/test-unit.ts`.

---

## Corrigidos (2026-07-25)

### 1. Erro do back não aparecia no `AporteModal` / `DespesaVariavelModal` (P1)

- **Era**: `components/forms.jsx` — `error={err && f.valor <= 0 ? err : ""}`. O `catch`
  do submit fazia `setErr(e.message)`, mas o único `<Field error>` do form só renderiza
  quando o **próprio campo** está inválido. Com valor válido e erro do servidor (403,
  404, 422, 500) a mensagem não aparecia em lugar nenhum: o modal ficava aberto e
  parecia que o clique não fez nada.
- **Correção**: os dois modais separam `errCampo` (valor ≤ 0 → continua no `Field`) de
  `errGeral` (guarda de caixinha e qualquer resposta do back → `<p role="alert">` antes
  dos botões). Sempre exatamente um alerta na tela. Trocar de caixinha no select também
  limpa o erro.
- **Testes**: `tests/front/caixinha.test.tsx` → `describe("erro do back nos modais de
  movimentação")`, com repro real (a caixinha existe quando o modal abre e é excluída
  antes do submit → 404 `"Caixinha não encontrada"` visível).

### 2. Aporte/despesa com zero caixinhas mandava `caixinhaId: ""` → 422 (P1)

- **Era**: `components/forms.jsx` — `caixinhaId: defaultCaixinhaId || caixinhas[0]?.id
  || ""`. Conta nova mostrava "Aporte" e "Registrar despesa" no Dashboard; qualquer
  submit mandava string vazia e o zValidator recusava. Combinado com o item 1, o usuário
  não recebia retorno nenhum.
- **Correção**: duas camadas. `Dashboard.jsx` esconde as duas ações quando
  `caixinhas.length === 0` e mostra um empty state ("Nenhuma caixinha ainda" +
  orientação, diferente com e sem `caixinha:manage`); os modais barram o submit sem
  `caixinhaId` com mensagem no slot geral do item 1, em vez de mandar o request.
- **Testes**: `tests/front/caixinha.test.tsx` → `describe("conta sem caixinha nenhuma")`.
  `tests/front/permissions.test.tsx` ganhou uma caixinha no setup do caso do `membro`.

### 3. "O que devo" mostrava grupo zerado (P1)

- **Era**: `GET /api/me/compartilhamentos?ym=` devolvia o grupo do cartão mesmo com
  `devidoMes` 0 (share de uma linha que não existe naquele mês), então o painel ficava
  na tela com `R$ 0,00`.
- **Correção**: filtro no back (`server/modules/cartao-share/cartao-share.service.ts`,
  `meusCompartilhamentos`): grupo com `devidoMes === 0 && comprometido === 0` sai da
  resposta. Front não mudou — o `if (grupos.length === 0) return null` já resolve.
- **Testes**: `tests/front/o-que-devo.test.tsx` → `"no mês seguinte o grupo sai da lista
  em vez de vir zerado"`; `tests/integration/cartao-share.test.ts` → `"respeita o ym
  pedido"` agora espera `[]`.

### 4. Exclusões sem confirmação, em 3 lugares (P1)

- **Era**: `components/Cartoes.jsx` (cartão), `components/Admin.tsx` (usuário e role) —
  clique único e o registro sumia, ao contrário de todas as outras exclusões do app.
- **Correção**: os três abrem `Modal` de confirmação no mesmo padrão de
  `DespesasFixas.jsx` (estado `delX`/`excluindo` + `delBusy`, botão danger, backdrop
  travado enquanto salva). O aviso é específico: cartão explica o SetNull ("as despesas
  continuam, mas perdem o cartão"), role diz quantos usuários perdem as permissions.
- **Testes**: `tests/front/cartoes.test.tsx` (confirma + cancela) e
  `tests/front/admin.test.tsx` (usuário: confirma + cancela; role: confirma + o aviso de
  N usuários).

### 5. Logout só existia no desktop (P2)

- **Era**: `components/AuthGate.tsx` — `hidden … lg:block`. Em telas menores que `lg`
  não havia como sair da conta.
- **Correção**: o botão perdeu o `hidden`/`lg:block` (o topbar mobile do `App.jsx` só
  tem a marca à esquerda, então o canto direito está livre) e ganhou `aria-label="Sair"`.
- **Teste**: não coberto por layout (happy-dom não faz CSS) — o `aria-label` deixa o
  botão localizável por role/name, e o fluxo de logout já é testado em
  `tests/front/sessao.test.tsx`.

### 6. Botões dentro do `<label>` do `Field` herdavam o nome acessível (P2)

- **Era**: `components/forms.jsx` (presets "3/6/12 meses" da reserva, seletores de cor,
  emojis) e `components/Admin.tsx` (chips de role e de permission). O nome acessível de
  cada botão virava o texto inteiro do label — ex.: *"Meses de segurança 3 meses 12 meses
  6 Quantos meses de gasto quer ter guardados"* — anunciado a cada botão pelo leitor de
  tela.
- **Correção**: novo primitivo `FieldGroup` em `components/ui/primitives.jsx`
  (`<fieldset>` + `<legend>`, mesmo hint/erro do `Field`), usado em todos os grupos de
  botões. Cada botão ganhou `aria-pressed`; o input livre de meses ganhou `aria-label`
  explícito (fora do `<label>` ele ficaria sem nome).
- **Impacto nos testes**: o helper `campo()` do harness passou a aceitar
  `<fieldset>`/`<legend>` além de `<label>`. Os `getByText` nos presets continuam
  válidos e agora `getByRole("button", { name: "3 meses" })` também funciona.

### 7. Botão ✓ de salvar salário sem rótulo (P2)

- **Era**: `components/DespesasFixas.jsx` → `RecebidoCard`, `<Button>` só com o ícone
  `Check` e nome acessível vazio.
- **Correção**: `aria-label="Salvar salário"`.
- **Teste**: `tests/front/renda.test.tsx` continua achando "o único button do bloco" —
  com o rótulo, dá pra buscar por nome quando for conveniente.

### 8. `MeusCompartilhamentos` engolia erro de API (P2)

- **Era**: `components/Compartilhamento.jsx` — `.catch(() => setGrupos([]))`: falha de
  rede/permissão ficava indistinguível de "não devo nada" (o painel simplesmente não
  aparecia).
- **Correção**: o `catch` continua existindo (é o que evita unhandled rejection — ver
  convenção 15 do `TESTES-FRONTEND.md`), mas guarda a mensagem num estado `erro` e o
  painel renderiza `role="alert"` com "Não consegui carregar o que você deve". O efeito
  também ganhou guarda de `cancel`.
- **Teste**: `tests/front/o-que-devo.test.tsx` cobre o caminho feliz; sem
  `cartao:view_shared` o painel nem é montado (gate em `Cartoes.jsx`), então o caminho de
  erro é o de falha real de request.

### 9. `FinanceProvider` recriava todas as actions a cada render (P3 — causa raiz)

- **Era**: `store/FinanceContext.jsx` — `const actions = { … }` no corpo do componente.
  Qualquer efeito que dependesse de uma action rodava em **todo** render; foi a causa
  raiz do loop infinito de `DespesasFixas.jsx` ("Maximum update depth exceeded").
- **Correção**: `actions` num `useMemo` com deps `[esp, espacos, espacosOcultos,
  bootstrap, reloadCartoes, refreshCartoes]` — as três únicas fatias de estado que as
  actions leem. `refreshCartoes` virou `useCallback`. O `value` do provider também é
  memoizado. Agora a identidade das actions só muda quando elas passam a se comportar
  diferente.
- **Nota**: a guarda por ref (`puloRef`) em `DespesasFixas.jsx` ficou como cinto de
  segurança — o efeito agora roda só quando mês/espaço mudam, mas o ref evita disparar a
  troca duas vezes enquanto o PUT/GET está em vôo.
- **Rede de segurança**: a suíte de front inteira (251 testes).

### 13. Lint tinha 9 erros pré-existentes (P3)

`bun run lint` fecha **limpo** (0 erros, 0 warnings) e o step do CI deixou de ser
informativo (`continue-on-error` removido de `.github/workflows/ci.yml`).

| arquivo | era | correção |
|---|---|---|
| `components/Admin.tsx` (3×) | setState síncrono dentro de efeito | `buscar`/`aplicar` separados (setState só em callback de promise); os forms de usuário e role foram movidos **pra dentro** do `Modal`, que não renderiza filhos fechado — reabrir já vem limpo, sem efeito de reset |
| `components/Compartilhamento.jsx` | idem | mesmo tratamento: `CompartilharForm` vive dentro do `Modal`, `buscar`/`aplicar` separados |
| `components/Dashboard.jsx` (2×) | idem | o espaço visualizado passou a ser **derivado** (`escolhido ?? activeEspacoId`) e o fetch guarda `{ id, orc }`, o que dá "carregando" e "orçamento válido" sem nenhum setState síncrono |
| `components/Cartoes.jsx:32` | `useMemo(mesesRange, [])` | `useMemo(() => mesesRange(), [])` |
| `components/ui/primitives.jsx:91` | ref escrito durante o render | a escrita do `onCloseRef` foi pra um efeito |
| `components/ui/primitives.jsx` (Donut) | `offset += len` dentro do map do JSX | arcos pré-calculados por `reduce` |

Warnings zerados junto: deps condicionais do `Dashboard` (viraram um único `src`
memoizado), `format` sem uso no `LineTrend`, expressões-vírgula em
`scripts/test-unit.ts`, e o `_userId` do seam de entitlements (o
`argsIgnorePattern: "^_"` entrou no `eslint.config.mjs`).

---

## Já corrigidos antes (histórico)

- **A. Loop infinito de render** (`DespesasFixas.jsx`, efeito do pulo automático de
  página). Estar numa página oculta no mês e trocar o mês travava a tela com "Maximum
  update depth exceeded". Guarda por ref (`puloRef`). Causa raiz = item 9, agora fechada.
- **B. `reloadCartoes()`/`getOrcamento()` sem `catch`** em `Dashboard.jsx` (mount e
  efeito do select de página) e `Cartoes.jsx` (troca de mês). Conta sem `cartao:view`
  gerava unhandled rejection a cada boot.
- **C. Fire-and-forget sem `catch` no `FinanceContext`**: as 7 chamadas de
  `reloadCartoes()` depois de mutações de despesa passam por `refreshCartoes()`, que
  engole o erro de propósito.

> Por que B e C importam além do console: no runner do Bun uma rejeição solta vira
> "Unhandled error between tests" e faz o processo **sair com código 1 mesmo com 0
> testes falhando**. Se o CI ficar vermelho sem teste vermelho, procure `.then(` sem
> `.catch(`.
