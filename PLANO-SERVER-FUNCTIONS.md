# Plano — migrar de Hono RPC para Server Functions

Next 16.2.10 · React 19.2.4 · escopo hoje: 84 rotas Hono, 85 funções exportadas em `services/financeApi.ts`, 8.4k LOC em `server/`, 3.5k LOC de teste de integração.

---

## 1. Diagnóstico: por que está lento

Antes de mover transporte, o que foi medido no código. O custo por request hoje não vem de "usar API" — vem de quantas requests a UI dispara e de quanto cada uma carrega.

### 1.1 `getOrcamento` não tem filtro de mês

`espacoRepository.findWithOrcamento` (`server/modules/espaco/espaco.repository.ts:30`) usa o include `withOrcamento` (linhas 11-17): **todas** as `despesasFixas`, **todas** as `despesasMes` (histórico inteiro, sem `where` de mês), todas as `receitasMes` + skips, todas as `rendasMensais`, `pagamentosFixas`, e para cada despesa os `shares` com `contato` incluído.

`orcamentoView` (`server/modules/espaco/espaco.service.ts:32`) serializa tudo isso. A rota `GET /despesas/espacos/:esp` (`services/financeApi.ts:181`) **não aceita `ym`**. Então o payload cresce para sempre: quem usa o app há um ano paga o ano inteiro em cada leitura.

### 1.2 Dashboard multiplica isso por N espaços — e refaz a cada troca de mês

`components/Dashboard.jsx:150-167`:

```js
useEffect(() => {
  Promise.all(espacos.map(async (e) => {
    const o = await api.getOrcamento(e.id).catch(() => null);
    ...
  }))
}, [espacos, ym]);
```

N espaços × histórico completo, **em paralelo**, e a dependência `ym` refaz o fan-out inteiro a cada clique no seletor de mês. Isso é o pior caminho do app e o candidato número um para "muito lento".

### 1.3 Toda mutação custa 2 round-trips

`store/FinanceContext.jsx` chama `reloadCartoes()` depois de `addDespesaFixa`, `updateDespesaFixa`, `toggleDespesaFixa`, `removeDespesaFixa`, `bulkFixas`, `bulkMes`, `importDespesasMes`, `addDespesaMes`, `updateDespesaMes`, `removeDespesaMes`. Cada uma dessas ações é: `POST/PATCH` → resposta → `GET /cartoes` → resposta. Latência dobrada, sequencial, em ~10 ações.

### 1.4 `GET /cartoes` é N+1

`cartaoService.listWithAggregates` (`server/modules/cartao/cartao.service.ts:190`):

```ts
const cartoes = await cartaoRepository.list(userId);
return Promise.all(cartoes.map((c) => this.withAggregates(c, mes)));
```

e `withAggregates` (linha 45) faz 3 queries. N cartões = 1 + 3N queries. Como 1.3 chama isso depois de quase toda mutação, é 1 + 3N queries de brinde por ação do usuário.

### 1.5 Auth: 2 idas ao banco por request

`requireAuth` (`server/auth/middleware.ts:10`) faz `verifyToken` + `authService.getSessionUser(userId)` → `authRepository.findById` com roles. Depois `requirePermission` chama `authService.can()`, que chama `planEntitlements(user.id)` (`server/auth/auth.service.ts:79`). Sem cache por request. Multiplique pelo fan-out de 1.2.

### 1.6 Boot é um waterfall de 3 etapas no cliente

`app/page.tsx` é `'use client'`. Sequência real: HTML quase vazio → baixa e hidrata o bundle → `AuthGate` roda `me()` no `useEffect` (`components/AuthGate.tsx:45`) → só então `FinanceProvider` roda `getBootstrap()` (`store/FinanceContext.jsx`) → render. Dois round-trips que só começam **depois** do JS carregar, e nenhum deles pode ser prefetchado.

### 1.7 Veredito

Server Functions resolvem **1.6** (e só ele) diretamente. Não tocam em 1.1–1.5. E há um agravante documentado:

> **Next.js dispatches Server Actions one at a time per client.** [...] do not rely on `Promise.all` to parallelize Server Actions from the client.
> — `node_modules/next/dist/docs/01-app/02-guides/server-actions.md`

Existem 4 fan-outs paralelos no front hoje: `components/Dashboard.jsx:153` (N espaços), `components/Compartilhamento.jsx:66`, `components/Compartilhamento.jsx:283`, `components/Admin.tsx:33`. Migrar esses para Server Functions **sem antes colapsá-los** troca N requests paralelas por N sequenciais — fica mais lento, não menos.

Por isso a Fase 0 abaixo é pré-requisito, não opcional. Ela entrega a maior parte do ganho de performance e é independente da migração de transporte.

---

## 2. Razões que justificam a migração (fora de performance)

Depois da Fase 0, a migração continua valendo — pelo que ela simplifica, não pela latência:

- **Tipo end-to-end nativo.** Hoje o contrato vive em `AppType` + `hc<AppType>` + `InferRequestType`. Com Server Functions o tipo é a assinatura da própria função importada. Menos indireção, menos truque de tipo (`Body<T>`, o `unwrap` genérico com `Awaited<ReturnType<R["json"]>>`).
- **Uma camada a menos.** Morre `*.routes.ts` (84 registros encadeados), o `zValidator` custom, o `onError`, o `hc` client, e a regra frágil de "rota fora da cadeia fica invisível pro client RPC".
- **Boot em RSC.** Só faz sentido com o servidor podendo renderizar dado — é a Fase 2.
- **`use cache: private`** (Next 16, experimental, exige `cacheComponents: true`): cache por usuário na memória do browser, para dado de sessão. Não existe equivalente no setup atual.

## 3. Custo honesto

- 84 rotas → ~10 arquivos `actions.ts`, um por módulo.
- 3.553 LOC de teste de integração que hoje batem em `app.request()` precisam mudar de alvo. **Server Functions não são chamáveis fora do request store do Next** — não existe `app.request()` equivalente. Mitigação em 4.5.
- Server Functions são POST-only, cap de 1MB no body por padrão, com CSRF por `Origin`/`Host` e action IDs que rotacionam a cada deploy (≤14 dias mesmo sem mudança de fonte). Cada um vira uma pendência concreta na Fase 1.

---

## 4. Fases

### Fase 0 — performance (independente, faça primeiro)

Ordem por retorno sobre esforço.

**0.1 · `getOrcamento` aceita `ym`.** `withOrcamento` passa a filtrar `despesasMes: { where: { mes: { in: janela } } }` e `pagamentosFixas: { where: { ym: { in: janela } } }`. Janela = o mês visto + o que `lib/calc.js#janelaMeses` já precisa para o seletor. Fixas e receitas continuam inteiras (são cadastro, não histórico). O front já tem `ym` global no `FinanceContext`, então é só propagar. Rotas afetadas: `GET /despesas/espacos/:esp`, `GET /state`.
*Risco:* `mesesComDados`/`mesesComFatura` em `lib/calc.js` derivam a janela do seletor a partir dos dados carregados. Se a janela vier filtrada, isso se morde. Resolver com um campo separado só com a lista de `ym` que têm dado (um `groupBy` barato), não com o payload inteiro.

**0.2 · Um endpoint para o gráfico por espaço.** `GET /despesas/resumo?ym` devolve `[{ espacoId, nome, emoji, cor, saiu }]`, calculado em uma query agregada. Mata o fan-out de `Dashboard.jsx:150-167` (N requests → 1) e é pré-requisito da migração, por causa do dispatch sequencial. Mesmo espírito do `GET /cartoes/resumo` que já existe.

**0.3 · Mutação devolve os cartões afetados.** As rotas de despesa passam a incluir `cartoes` (ou só os cartões cujo agregado mudou) na própria resposta; `FinanceContext` faz `dispatch SET_CARTOES` com isso e some com `reloadCartoes()` das ~10 ações. Corta 1 round-trip por ação.

**0.4 · Matar o N+1 de `listWithAggregates`.** Trocar `Promise.all(cartoes.map(withAggregates))` por 3 queries agregadas (`groupBy` por `cartaoId`) e montar os agregados em memória. 1+3N → 4 queries fixas.

**0.5 · Cachear a sessão por request.** Um único `getSessionUser` + `planEntitlements` por request, memoizado no escopo da request (hoje `requireAuth` e cada `can()` vão ao banco de novo).

**0.6 · Medir.** Sem baseline não há como afirmar que qualquer fase seguinte ajudou. `next dev` mente sobre latência (compila sob demanda) — medir em `bun run build && bun start`, com o Postgres local, contando requests e ms por cenário: boot, troca de mês, marcar uma fixa como paga, importar OFX.

*Estado esperado no fim da Fase 0:* boot com 2 requests em vez de 2+N; troca de mês com 1 em vez de N; mutação com 1 em vez de 2. Nenhuma linha de transporte trocada ainda.

### Fase 1 — seam de servidor (sem migrar nada)

Criar o que toda Server Function vai precisar, e provar em **uma** função antes de escalar.

**1.1 · `server/next/session.ts`** — o equivalente de `requireAuth`/`requirePermission` fora do Hono:

```ts
// lê o cookie httpOnly via cookies(), valida, devolve o AuthUser
export async function currentUser(): Promise<AuthUser>          // lança 401
export async function requirePerm(p: string): Promise<AuthUser> // lança 403
```

Reaproveita `authService.verifyToken` / `getSessionUser` / `can` sem alteração. `AUTH_COOKIE` continua o mesmo, então **login e sessão não mudam** durante a migração — Hono e Server Functions leem o mesmo cookie e podem coexistir indefinidamente.

**1.2 · `server/next/action.ts`** — wrapper que reproduz o contrato que o front já espera. O `onError` do Hono hoje mapeia `ZodError → 422 {error, issues}`, `AppError → statusCode`, `P2025 → 404`. O front depende disso: `services/financeApi.ts` lança `ApiError` com `status` e `issues`, e `components/ui/useFormState.js` usa os `issues` via `lib/formErrors.js` para marcar o campo culpado. Se isso quebrar, todo form do app perde validação por campo.

Server Functions não têm status HTTP. Então o wrapper devolve um resultado discriminado — `{ ok: true, data }` | `{ ok: false, status, error, issues? }` — e é `financeApi` que reconstrói o `ApiError` a partir dele. Assim `useFormState` não muda uma linha.

O wrapper também roda o zod DTO (os `*.dto.ts` ficam como estão) e faz o `requirePerm`, para que autenticação e validação sejam impossíveis de esquecer numa action nova.

**1.3 · Provar em uma fatia.** Migrar só `categoria` (4 rotas, módulo mais simples, sem rateio nem parcela): `server/modules/categoria/categoria.actions.ts` com `'use server'` no topo, chamando o `categoriaService` que já existe sem tocar nele. Trocar por dentro as 4 funções correspondentes em `financeApi.ts`, mantendo assinatura e shape de retorno idênticos.

**Nenhum componente muda.** É isso que faz a migração ser incremental: `CLAUDE.md` já define `services/financeApi.ts` como o único seam entre front e API, e ele continua sendo. Cada função troca de implementação por baixo; as 85 assinaturas ficam.

**1.4 · Pendências de configuração** (levantar aqui, aplicar antes do primeiro deploy):
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` estável entre instâncias, senão referência de action fica indecifrável em deploy multi-instância. **`.env` não é editável por agente** → entra no `.env.example` e é aplicado à mão.
- `serverActions.bodySizeLimit` em `next.config.ts` — o default é 1MB e o import de OFX manda o lote de transações parseado no cliente (`lib/ofx.js` parseia, o servidor só deduplica por `fitid`). Um extrato grande passa de 1MB. Ver 4.4.
- `serverActions.allowedOrigins` se houver proxy/CDN na frente (o CSRF compara `Origin` com `Host`/`X-Forwarded-Host`).
- Action IDs rotacionam por deploy: cliente com bundle antigo recebe "Failed to find Server Action". Tratar como caminho de retry na UI, não como erro fatal.

### Fase 2 — boot em RSC (o ganho real de latência)

Mata o waterfall de 1.6, seguindo o padrão de `node_modules/next/dist/docs/01-app/02-guides/single-page-applications.md` ("Using React's `use` within a Context Provider").

- `app/layout.tsx` (Server Component) chama `currentUser()` e `getState()` **sem `await`** e passa as Promises para os providers.
- `AuthGate` e `FinanceProvider` deixam de buscar no `useEffect` e passam a desembrulhar com `use(promise)`, caindo em `<Suspense>` enquanto chega.
- O servidor começa as queries antes do JS existir no cliente; os dados chegam no mesmo stream do HTML. Dois round-trips e a espera pelo bundle saem do caminho crítico.
- Login/logout continuam sendo mutação client-side; o `AuthGate` só perde o `me()` de abertura.
- Opcional depois: `'use cache: private'` no `getState` com `cacheLife`, para a volta de navegação. Exige `cacheComponents: true` em `next.config.ts` e é marcado experimental — deixar por último, e só com o baseline de 0.6 para comparar.

*Cuidado:* `app/page.tsx` hoje é `'use client'` inteiro e `App.jsx` mantém `view`/`caixinhaId` em `useState`. A Fase 2 **não** converte a navegação para rotas de arquivo; o app segue SPA client-side. Só o boot passa a ser servido.

### Fase 3 — migrar os módulos

Um módulo por vez, cada um: criar `<modulo>.actions.ts`, apontar as funções de `financeApi` para ele, rodar `bun run typecheck` + `bun run test`, commitar. A rota Hono correspondente só é apagada na Fase 5, então rollback é reverter um commit.

Ordem por risco crescente:

| # | Módulo | Rotas | Nota |
|---|--------|------:|------|
| 1 | `categoria` | 4 | já feito em 1.3 como prova |
| 2 | `caixinha` | 4 | |
| 3 | `movimentacao` | 3 | valida o padrão de retorno composto (`{ movimentacao, caixinha }`) |
| 4 | `espaco` | 8 | depende de 0.1 estar pronto |
| 5 | `cartao` | 7 | depende de 0.3 e 0.4 |
| 6 | `admin` | 9 | fan-out em `Admin.tsx:33` → colapsar antes (4.1) |
| 7 | `dev` | 1 | |
| 8 | `orcamento` | 20 | o maior; inclui bulk e import (ver 4.4) |
| 9 | `cartao-share` | 24 | o mais novo e o mais complexo; fan-out em `Compartilhamento.jsx:66,283` |
| 10 | `auth` | 4 | **último** — mexe em cookie e é o que quebra o app inteiro se sair errado |

`server/modules/*/*.service.ts` e `*.repository.ts` **não mudam**. Isso funciona porque todo service já recebe `userId` como primeiro parâmetro (regra de multi-tenancy do `CLAUDE.md`); a action só troca `c.get("user").id` por `(await requirePerm("x:y")).id`. É a mesma linha, de outra fonte.

### Fase 4 — colapsar o que sobrou de fan-out

Obrigatório antes de considerar a migração concluída — cada um destes vira N chamadas sequenciais sob Server Functions:

**4.1 · `components/Admin.tsx:33`** — `Promise.all([listUsers, listRoles, listPermissions])` → uma action `getAdminBootstrap()` que faz o `Promise.all` **no servidor** (lá dentro paraleliza normalmente; a restrição é só do dispatcher do cliente).

**4.2 · `components/Compartilhamento.jsx:66`** — `Promise.all([getContatos, getRateio])` → uma action.

**4.3 · `components/Compartilhamento.jsx:283`** — `Promise.all([getContatos, getFaturaLinhas, getCartaoShares])` → uma action.

**4.4 · Import de OFX fica Route Handler, não Server Function.** Duas razões: o cap de 1MB no body de action, e o fato de não ser mutação com re-render (o front já faz `UPSERT_MANY_DM` + um `reloadCartoes`). Os docs recomendam Route Handler exatamente para isso. `POST /despesas/espacos/:esp/mes/import` é a única rota que sobrevive à Fase 5 de propósito.

**4.5 · Retestar.** Os `tests/integration/*.test.ts` batem em `app.request()`, que não existe para Server Functions. Estratégia:
- **Manter** os testes de integração, apontados para os **services** com banco real (`resetDb`, `seedRoles`, `account()` de `tests/integration/harness.ts` continuam válidos; muda o `client(cookie)` por chamada direta de service). A cobertura de regra de negócio, multi-tenancy e 404-não-403 fica intacta — é onde ela realmente mora.
- **Cobrir o que sai do caminho** — auth, permission, validação zod e mapeamento de erro — com testes do wrapper de 1.2, que é o único lugar onde essa lógica passa a viver.
- **`tests/integration/contrato.test.ts`** perde sentido no formato atual (ele valida o contrato HTTP). Substituir por `bun run typecheck`, que passa a ser a garantia de contrato quando o tipo é a assinatura da função.
- A regra de processos separados (`scripts/test-unit.ts`, um processo por arquivo por causa do `mock.module` global do Bun) continua valendo e não é afetada.

### Fase 5 — remover o Hono

Só quando as fases 3 e 4 estiverem verdes e o app rodar um tempo em produção com as duas camadas coexistindo.

- Apagar `server/app.ts`, os 10 `*.routes.ts`, `server/lib/validator.ts`, `server/auth/middleware.ts`.
- `app/api/[[...route]]/route.ts` reduz ao Route Handler de import de OFX (4.4) e ao `/health`.
- Sai `hono` e `@hono/zod-validator` do `package.json`.
- `services/financeApi.ts` perde o `hc` client, o `Body<T>` e o `unwrap`; fica um barrel de re-export das actions + a reconstrução de `ApiError`. As 85 assinaturas seguem as mesmas — nenhum componente foi tocado em nenhuma fase.
- Atualizar `CLAUDE.md`: a seção "Arquitetura" descreve o `AppType` como único seam e a regra de rotas encadeadas; as duas deixam de existir.

---

## 5. O que NÃO fazer

- **Não** migrar leitura com fan-out antes de colapsar o fan-out (0.2, 4.1-4.3). Dispatch sequencial transforma o ganho em perda.
- **Não** usar Server Function para o import de OFX (1MB, não é mutação com re-render).
- **Não** mexer em `*.service.ts` / `*.repository.ts` durante a Fase 3. Se um service precisar mudar, isso é Fase 0 e vai num commit separado — senão fica impossível dizer se uma regressão veio da regra de negócio ou do transporte.
- **Não** converter a navegação SPA para rotas de arquivo no mesmo esforço. É outro projeto, com outro risco.
- **Não** apagar rota Hono no mesmo commit que cria a action. Rollback vira reescrita.

## 6. Pendências manuais (fora do alcance do agente)

- `.env`: adicionar `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (o `.env.example` será atualizado com o campo e um comentário).
- Decidir se `cacheComponents: true` entra (habilita `use cache: private`, marcado experimental no 16.2.10).
- Rodar 0.6 (baseline) antes de qualquer fase, em `bun start`, não em `bun dev`.
