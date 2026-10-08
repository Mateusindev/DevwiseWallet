# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Comandos

```bash
docker compose up -d        # na raiz Wallet/ (um nível acima) — Postgres 16 na porta 5434
bun install
bun run prisma:generate
bun dev                     # http://localhost:3000

bun run test                # unit + integração (processos separados — ver Testes)
bun run test:unit           # só unit (repositories mockados)
bun run test:int            # só integração (precisa do banco de teste)
bun run test:db:setup       # cria/atualiza o banco de teste (cofre_test)
bun test caixinha           # filtra por caminho do arquivo
bun test -t "nome do teste" # filtra por nome
bun run typecheck           # tsc --noEmit — é a garantia de contrato das actions
bun run bench               # requests/queries/ms/KB por cenário (banco de teste)
bun run lint
bun run build

bun run prisma:push | prisma:migrate | prisma:studio
bun run seed:auth           # roles + admin@wallet.local (aceita: email senha)
bun run seed:test           # conta de testes teste@wallet.local / teste123 (+ dados de exemplo)
```

Sempre Bun (`bun`/`bunx`), nunca npm/yarn. Prisma **pinado em v6** (v7 tem breaking changes de generator/config).

## Restrição: `.env`

**Não editar `.env`** — usuário nega edição por agente. Alterações de env: atualizar `.env.example` e listar como pendência manual. Banco na porta **5434** (5432/5433 ocupadas por outro projeto): `postgresql://cofre:cofre@localhost:5434/cofre`. Sem `AUTH_SECRET` o dev usa fallback inseguro; produção recusa subir.

## Arquitetura

Front e back no mesmo projeto Next.js, type-safety ponta a ponta por **Server Functions** (o tipo é a assinatura da função importada). Substitui `../api` (Fastify) e `../web` (Vite) — legado, não desenvolver neles (cutover em `../PLANO-REFATORACAO.md`).

O app Hono ainda existe e continua registrando todas as rotas, mas o front **não passa mais por elas** — só o import de OFX. As duas camadas coexistem de propósito (Fase 5 do `PLANO-SERVER-FUNCTIONS.md` é que apaga o Hono, e ela está gated em rodar um tempo em produção).

- **Actions** em `server/modules/<dominio>/<dominio>.actions.ts` (`'use server'` no topo). Elas são o backend vivo: chamam o service e nada mais.
- **`server/next/session.ts`**: `currentUser` / `requirePerm` / `requireAnyPerm` — o equivalente de `requireAuth`/`requirePermission` fora do Hono. Lê o MESMO cookie httpOnly e usa o MESMO `authService`, então rota e action enxergam a mesma sessão. `cache` do React memoiza a sessão por request.
- **`server/next/action.ts`**: `acao(permissions, fn)` e `acaoValidada(permissions, schema, input, fn)`. Toda action nova passa por um dos dois — é o que torna permission e validação impossíveis de esquecer. Server Function não tem status HTTP, então o retorno é discriminado: `{ ok: true, data }` | `{ ok: false, status, error, issues? }`, com o mesmo mapeamento do `onError` (ZodError → 422 com issues, `AppError` → statusCode, Prisma P2025 → 404, resto 500). `permissions` pode ser lista: basta uma (é o alias histórico de `cartao:share`/`cartao:view_shared`).
- **`services/financeApi.ts`** continua sendo o **único seam** entre front e dados: reconstrói o `ApiError` (com `status` e `issues`) a partir do resultado da action, então `useFormState` segue marcando o campo culpado. Nenhum componente conhece action nem URL.
- **Cache de leitura no seam**: `ler(chave, fn)` dedupa chamada idêntica em voo e reaproveita o resultado por 20s; `mutar(promise)` embrulha TODA escrita e chama `invalidarLeituras()` no `finally`. Ficam no `financeApi` de propósito — é o que garante que nenhuma mutação nova esqueça de invalidar, e o que faz trocar de aba não refazer as leituras da tela anterior. O dispatcher de Server Actions do Next é **serial por cliente**: duas leituras disparadas juntas viram fila, e cada uma custa uma volta de rede até o banco.
- **Rotas reais** (`app/page.tsx`, `app/despesas`, `app/cartoes`, `app/pessoas`, `app/admin`, `app/caixinhas/[id]`). Cada `page.tsx` é fininha: envolve a tela em `<Protegido perms={[...]}>` (`components/AppShell.jsx`) e nada mais — quem tem os dados é o provider do **layout**, então trocar de rota não custa ida ao banco. As telas (`Dashboard`, `DespesasFixas`, `Cartoes`, `Pessoas`, `CaixinhaDetail`) carregam o próprio `'use client'`.
- **Boot servido em RSC, no layout**: `app/layout.tsx` dispara `sessaoAtual()` e `getState()` **sem await** e passa as Promises pro `app/boot.tsx` (`'use client'`), que desembrulha com `use()` e monta `AuthGate` → `FinanceProvider` → `AppShell` → `{children}`. Fica no layout (e não numa página) porque o Next **não re-renderiza layout compartilhado** na troca de rota: sessão, estado financeiro e casca sobrevivem à navegação. `experimental.staleTimes.dynamic` guarda o segmento de página no cliente (o default é 0s e, como o layout lê cookie, toda rota é dinâmica).
- **Feedback de espera é obrigatório**: `Button`/`IconButton` (`components/ui/primitives.jsx`) ficam **pendentes automaticamente** quando o `onClick` devolve Promise — é o que impede clique repetido em ação lenta (o sintoma era criar oito contatos iguais). Botão `type="submit"` não passa por aí: recebe `loading={submitting}` do `useFormState`. Leitura de tela usa `useAsync` (`components/ui/useAsync.js`) + os `Skeleton*` — o padrão antigo (`api.x().then(setDado).catch(() => setVazio)` num efeito) deixava a tela idêntica a "não tem nada" durante a busca inteira.
- **Módulos** em `server/modules/<dominio>/` (caixinha, movimentacao, cartao, cartao-share, categoria, espaco, orcamento, admin, bootstrap, dev): `*.dto.ts` (zod) · `*.repository.ts` (Prisma) · `*.service.ts` (regra de negócio) · `*.actions.ts` (Server Functions) · `*.routes.ts` (Hono, legado). Não existem controllers.
- **Import de OFX fica em Route Handler**, não em action: o payload passa do cap de 1MB e não é mutação com re-render. É a única rota que sobrevive à Fase 5 de propósito.
- **Fan-out é proibido no cliente**: o Next despacha Server Actions **uma por vez por cliente**, então `Promise.all` no front vira fila. Leitura que precisa de várias fontes é uma action só que paraleliza no servidor — `bootstrapAdmin`, `abrirRateio`, `painelDoCartao`, `GET /despesas/resumo`.
- **Backend legado** no app Hono de `server/app.ts` (`basePath('/api')`, `onError` central, `export type AppType`); a rota catch-all `app/api/[[...route]]/route.ts` pluga ele no Next. Enquanto existir, **rota nova tem que entrar na cadeia** (`.get().post()...` numa expressão só) — fora dela é invisível pro `AppType`.
- **Serialização**: services convertem Decimal/Date (`num`, `isoDate` em `server/lib/serialize.ts`) — front nunca vê tipos do Prisma.
- **Prisma singleton** via `globalThis` (`server/lib/prisma.ts`). `PRISMA_QUERY_LOG=1` liga o evento `query` (é como `bun run bench` conta idas ao banco).
- **O que custa é ida ao banco EM SÉRIE, não número de query.** O banco fica fora da máquina (Supabase `us-west-2`), então cada volta é rede inteira: medido, **141ms** por query na conexão direta (porta 5432) e **713ms** via pooler pgbouncer (6543) — o pgbouncer multiplica por ~5. Regra prática nos services: leitura que não depende de outra vai em `Promise.all`; leitura que depende (o orçamento precisa saber qual é o espaço ativo) é uma segunda leva. `getState`, `listWithActive`, `getOrcamento`, `meusCompartilhamentos` e `sincronizaConvites` estão escritos assim de propósito.
- **Orçamento vem por janela**: `getOrcamento(userId, espacoId, ym)` carrega `despesasMes` e `pagamentosFixas` de `ym-12` a `ym+12` (fixas e receitas continuam inteiras — são cadastro). O payload traz `janela: { de, ate }` e as listas `mesesComDespesa`/`mesesComFatura` (groupBy barato) pros pontinhos do seletor de mês; o `FinanceContext` refaz a busca quando o mês visto sai da janela.
- **Mutação de despesa devolve `cartoes`**: as respostas do orçamento carregam os agregados de fatura já recalculados, e o front não dispara mais um `GET /cartoes` atrás de cada ação. Nas mutações singulares o shape é `{ despesa, cartoes }`; no delete, `{ id, cartoes }`.
- **Rotas em lote / import / resumo** (evitam N requests + N `reloadCartoes`): `POST /despesas/espacos/:esp/mes/bulk` e `.../fixas/bulk` (pagar/despagar · excluir · categoria · cartao · ativar/pausar), `POST .../mes/import` (OFX) e `GET /cartoes/resumo?de&ate` (fatura mês a mês, por cartão e por categoria; janela de 24 meses). Nos lotes, **todos os ids são carregados filtrando por espaço + dono antes de qualquer escrita** — se algum não voltar, 404 e nada é aplicado.

### Front — camadas próprias

- **Tema claro/escuro por variável, não por `dark:`**: as telas usam a paleta slate do Tailwind direto (~400 ocorrências). No v4 toda utilitária compila pra `var(--color-slate-400)`, então `html[data-tema="claro"]` em `app/globals.css` **redefine a escala** (e os tons 200/300/400 dos acentos, que em fundo branco não passam de 2:1) e vira a app inteira sem tocar em componente — e sem alguém esquecer o `dark:` numa tela nova. Dois tokens próprios nasceram daí porque "branco" tinha dois papéis: `text-ink` (texto forte, era `text-white`) e `bg-veu/10` (sobreposição, era `bg-white/10`). **`text-white` continua literal onde o fundo é colorido** (label de botão azul não inverte). O tema é client-side (`components/ui/tema.jsx`, `localStorage` em `wallet:tema`, fonte da verdade é o atributo no `<html>` lido por `useSyncExternalStore`); quem aplica antes da primeira pintura é o **script inline no `<head>`** do `app/layout.tsx` — em efeito do React daria flash do fundo escuro a cada recarga. Sem valor salvo, segue o `prefers-color-scheme`.
- **`components/ui/fields.jsx`**: controles com Radix (`Select`/`SelectItem`, `Checkbox`, `CheckboxField`, `NumberInput`, `DayInput`, `MonthSelect`/`MonthStepper`, `DateInput`, `FormError`). Nenhum controle nativo do sistema aparece na app (só o `<input type="file">` do import OFX, escondido com `sr-only`). `NumberInput` **nunca emite string**: `number | null`, clamp no blur — é o que evita 422 com `""` virando 0 no `z.coerce`. Select dentro de `Modal` exige `Select.Portal` (senão o popup é clipado pelo `overflow-y-auto` do modal) e `z-[70]`.
- **`components/ui/useFormState.js`**: estado de form + validação pura + erro por campo + banner (`formError`) + foco no primeiro campo inválido (pelo `name` do controle). Erro de API com `issues` (422) vira erro de campo via `lib/formErrors.js`; o que não casa com campo cai no banner. Expõe `touched` e `patch(p, { marcarTocado: false })` — é assim que uma sugestão automática (vencimento = fechamento + 7) não sobrescreve o que o usuário digitou.
- **`services/financeApi.ts`** lança `ApiError` (`status` + `issues`), não `Error` cru.
- **`components/ui/useSelecao.js`** + **`components/BulkBar.jsx`**: seleção com Shift+clique e barra de ações em lote (portal no body; dentro da lista o overflow dos Cards cortava a barra). A seleção é resetada por uma chave `${ym}:${espacoId}`.
- **`lib/ofx.js`**: parser de OFX 1.x (SGML) e 2.x (XML) + `lerArquivoOfx` (escolhe o `TextDecoder` pelo CHARSET do cabeçalho — cp1252 lido como UTF-8 estraga acento). O parse é no cliente; o servidor só faz dedup por `fitid` e insere.
- **`lib/calc.js`** concentra o domínio puro: janela do seletor de mês (`janelaMeses`, `mesesComDados`, `mesesComFatura`), sugestão de dia de fatura (`diaMaisDias`/`sugere*`), expansão de receita recorrente (`receitasDoMes`) e sugestão de categoria por descrição (`sugereCategoria`).
- **`components/ui/charts.jsx`**: `GroupedBars`, `HBars`, `StackedBars` e `SobraMensal`. `SobraMensal` é barra divergente em torno de um **zero desenhado** (não uma linha com eixo colado no menor valor): sobra tem sinal, e o antigo `LineTrend` não mostrava nem quando o mês fechou no vermelho nem quanto. Escala fica simétrica quando existe mês negativo, a média entra como tracejada de referência (com pouca variação o gráfico é um paredão e é ela que diz qual mês fugiu do normal), e o tooltip mora **dentro** da área do gráfico — o wrapper tem `overflow-x:auto`, que corta também o que sai por cima.

### Semântica de `ReceitaMes.mes` (âncora)

Receita extra pode ser **recorrente** (`recorrente` + `mesFim` opcional). Nesse caso `mes` deixa de ser "o mês do lançamento" e passa a ser a **âncora** (primeiro mês em que vale) — a coluna não foi renomeada pra não quebrar a `receitaView`. `ReceitaMesSkip (receita_id, ym)` guarda a exceção de um mês. O front expande as instâncias com `receitasDoMes(receitasMes, ym, skips)`, que devolve `key` (`"id:ym"`) e `mesEfetivo`: o `id` se repete entre meses, então **nenhuma key de React nem handler pode usar só o `id`**.

### Multi-tenancy (dado por usuário)

- Agregados raiz têm `userId` (coluna `user_id`): Caixinha, Cartao, Categoria, Espaco, AppSettings, Contato. O que pende deles (movimentações, despesas, pagamentos, shares) **não** tem `user_id` — herda o dono pela FK.
- Todo service recebe `userId` como **primeiro parâmetro**; as rotas passam `c.get("user").id` (por isso cada `Hono<AuthEnv>`). Repositórios filtram por `userId` (ou pela relação: `caixinha: { userId }`, `espaco: { userId }`, `cartao: { userId }`) — nunca buscam só por `id`.
- Recurso de outro dono responde **404**, não 403 — `getOrThrow(userId, id)` não vaza existência.
- **Id de outro agregado que vem no payload é validado como do dono**: `assertVinculos` no `orcamento.service` (`cartaoId`, `categoriaId`), `caixinhaService.getOrThrow` na movimentação, `despesaFixaExists`/`despesaMesExists` no share. Aceitar id alheio contaminaria agregados do outro dono (uma fixa injetada entra na fatura do cartão dele, que é calculada por `cartaoId`).
- `AppSettings` tem PK `user_id` (uma linha por usuário, não é mais singleton). `dev/reset` reseta só os dados do usuário logado.

### Compartilhamento — `server/modules/cartao-share/`

O nome do módulo (e da tabela `cartao_shares`) ficou: renomear custa migration destrutiva e não paga — mesma decisão de não renomear `ReceitaMes.mes` quando virou âncora. Mas **share não é mais "do cartão"**.

- **`rateio.ts` é o cálculo puro** (sem Prisma, sem repository): `shareValorNoMes`, `shareComprometido`, `devidoNoMes`, `rateioDaLinha`, `valorEfetivoDono`, `validaRateio`. Mora fora do service porque o orçamento também precisa dele — service importando service fecharia ciclo.
- **`CartaoShare.cartaoId` é nullable**: no modo `linha` o cartão é **derivado da despesa apontada** e o campo fica null (trocar a linha de cartão não deixa o share apontando o cartão velho). Só o modo `valor` (avulso na fatura) grava `cartaoId`. É isso que deixa uma fixa **sem cartão** (aluguel) ser compartilhada.
- **N-a-N**: N linhas de `cartao_shares` na mesma despesa, uma por contato. Uniques `(despesa_fixa_id, contato_id)` e `(despesa_mes_id, contato_id)` impedem a mesma pessoa entrar duas vezes na linha. `POST /shares/rateio` **substitui** o conjunto inteiro numa transação (salvar duas vezes não colide com o unique) e valida a soma uma vez só: percentuais ≤ 100 **e** soma das partes ≤ valor da linha. Contato `recusado` continua listado mas fora da soma — a recusa de um não pode fazer o dono achar que paga menos.
- **`abateShares` (por linha, em `DespesaFixa` e `DespesaMes`)**: `false` mantém o histórico (share é informativo, fatura do cartão cheia); `true` faz o orçamento do dono contar só a parte dele. O `/state` já traz `rateio` embutido em cada linha (evita 1 request por linha só pra desenhar as iniciais) e `lib/calc.js#valorEfetivoLinha` é o que os totais do front usam.
- **Posse do share é pelo contato** (`contato.ownerId`), não mais pelo cartão — todo find do repositório cruza por aí.
- **Agenda com aceite**: `Contato.status` (`local` → `convidado` → `ativo`/`recusado`). O dono cria o convite (`POST /contatos/:id/convite`, token + link, **não há infra de email** — a UI copia o link); quem recebe vê em `GET /me/convites` e aceita. O aceite roda numa transação: vincula o contato, cria o **espelho** na agenda de quem aceitou e amarra os dois por `espelhoDeId`. **Só contato `ativo` enxerga qualquer share** — o vínculo lazy por email virou fallback que cria convite pendente (`sincronizaConvites`), não acesso liberado.
- **Adoção (`ShareAdocao`, PK = `share_id`)**: quem deve puxa a linha pro próprio orçamento como `fixa` (parcelas espelhadas da original — morre sozinha na última, `parcelaAtivaNoMes` já faz isso), `mes` (pontual) ou `ignorado`. `share_id` **não tem FK de propósito**: se o dono apagar o share, a adoção sobrevive pra virar o aviso "compartilhamento removido pelo dono" — a despesa criada é do devedor e não some por decisão de terceiro. `valorAdotado` congela o valor; divergência vira aviso + `POST .../sincronizar`.
- **Adiantamento (`ShareAdiantamento`)**: a **fonte da verdade do `quitadoAte` são os adiantamentos** (`quitadoPorShare` = maior `cobreAte`); `ShareAdocao.quitadoAte` é cache. Por isso dá pra adiantar sem ter adotado. Zera o devido nos meses cobertos, desconta do comprometido e, se a linha virou fixa aqui, gera `PagamentoFixa` nesses meses.
- **Espaço da adoção é do DEVEDOR** — validado com `espacoService.getOrThrow(user.id, ...)`, mesma regra do `assertVinculos`. Recurso de outro dono → 404.
- Permissions: `share:manage`, `share:view_shared`, `share:adotar`, `contato:manage`. As antigas `cartao:share`/`cartao:view_shared` seguem valendo como alias via `requireAnyPermission` (roles existentes não quebram).
- Front: aba **Pessoas** (`components/Pessoas.jsx`) junta convites + "o que devo" + agenda; `RatearModal` divide uma linha entre N pessoas com barra de soma/sobra; `RateioChips` mostra as iniciais na própria linha de despesa.
- Migração aditiva revisada em `prisma/manual/20260909-compartilhamento.sql` (aplicar com `prisma db execute`; **nunca** `db push --accept-data-loss` no Supabase).

### Auth (JWT + PBAC/RBAC) — `server/auth/`

- JWT HS256 em cookie httpOnly `auth_token`. `requireAuth` global em `/api` (exceto health/login/logout) + `requirePermission("recurso:acao")` em cada rota.
- Autorização **sempre por permission**, nunca por nome de role. Wildcards segmentados: `caixinha:*`, `*` (`server/auth/permissions.ts`). Roles lidas do banco a cada request — mudança vale imediatamente.
- `server/auth/entitlements.ts` é o seam do billing SaaS futuro: autorização efetiva = permissions das roles ∩ entitlements do plano (hoje `["*"]`).
- Front esconde UI de mutação via `useAuth().can(permission)`, mas a autoridade é sempre o back.
- Nova permission de rota entra no catálogo (`server/auth/permissions.ts`), senão roles que a usam falham validação (422).

### Testes

Duas suítes, **processos separados** (`bun run test` roda as duas em sequência). Motivo: `mock.module` do Bun é global no runner — rodar tudo num processo só vaza os repositories mockados dos unitários pra dentro dos testes de integração. Nunca rode `bun test` sem filtro.

- **Unit** (`bun run test:unit`): `*.test.ts` ao lado do código em `server/` **e `lib/**/*.test.js`** (domínio puro: cálculo e validação de form), repositories mockados com `mock.module` — não tocam banco. `scripts/test-unit.ts` roda **um processo por arquivo**: `mock.module` não tem como ser desfeito, então um arquivo que mocka um *service* (bootstrap mocka `caixinha.service`; `middleware.test` mocka `auth.service`) serviria o stub pros arquivos seguintes, que testariam o mock do vizinho em vez do módulo real. Como a ordem dos arquivos vem do walk do runner, isso passa numa máquina e quebra em outra — foi o que derrubou o CI no salto do Bun 1.2 → 1.3. A cobertura sai do merge dos lcov de cada processo.
  - Rodar `bun test server` direto (sem o runner) reintroduz o vazamento — use `bun run test:unit`, ou filtre um arquivo só: `bun test server/modules/caixinha`.
- **Integração** (`bun run test:int`): `tests/integration/*.test.ts`, banco Postgres real. Duas frentes:
  - **`actions.test.ts`** cobre o caminho **vivo** (Server Functions). `cookies()` do next/headers é a única coisa mockada — do token pra dentro é `verifyToken`, `getSessionUser` com roles do banco, `can()`, zod DTO, service, repository e Prisma. É onde moram as invariantes de segurança da camada nova: 401, 403, 404-não-403, 422 com issue por campo, alias de permission, lote tudo-ou-nada.
  - As demais suítes batem no app Hono via `app.request()` e cobrem a regra de negócio pelos **mesmos services**. Quando a Fase 5 apagar as rotas, elas precisam ser reapontadas.
  - `tests/setup/env.ts` é preload de **todos** os testes (`bunfig.toml`) e força `DATABASE_URL` pro banco de teste (`TEST_DATABASE_URL`, default `postgresql://postgres:postgres@localhost:5432/cofre_test`). O nome do banco precisa conter "test" — as suítes truncam todas as tabelas.
  - `tests/integration/harness.ts`: `resetDb()`, `seedRoles()`, `account({ roles | permissions })` (cria usuário + loga pela rota real) e `client(cookie)` com `get/post/put/patch/delete` que prefixam `/api`.
  - Antes da primeira rodada: `bun run test:db:setup` (aplica o schema; cria o banco se não existir).
- CI (`.github/workflows/ci.yml`) roda typecheck → `test:unit --coverage` → `test:int` (service container `postgres:16`) → lint (informativo).
