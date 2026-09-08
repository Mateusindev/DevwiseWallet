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
bun run typecheck           # tsc --noEmit — também valida contratos do RPC
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

Front e back no mesmo projeto Next.js, type-safety ponta a ponta via Hono RPC. Substitui `../api` (Fastify) e `../web` (Vite) — legado, não desenvolver neles (cutover em `../PLANO-REFATORACAO.md`).

- **Backend inteiro** no app Hono de `server/app.ts` (`basePath('/api')`, `onError` central, `export type AppType`); a rota catch-all `app/api/[[...route]]/route.ts` só pluga ele no Next (`handle(app)`) e reexporta o `AppType`. O app é importável direto — é assim que os testes de integração batem nas rotas (`app.request()`), sem subir servidor.
- **`AppType` → client**: `services/financeApi.ts` cria `hc<AppType>('/')` e é o **único seam** entre front e API. Payloads tipados com `InferRequestType`. Front nunca digita URL.
- **Rotas Hono obrigatoriamente encadeadas** (`.get().post()...` numa única expressão; submódulos via `.route("/", subApp)`) — é o que o `AppType` captura. Rota registrada fora da cadeia fica invisível pro client RPC.
- **Módulos** em `server/modules/<dominio>/` (caixinha, movimentacao, cartao, cartao-share, categoria, espaco, orcamento, admin, bootstrap, dev): `*.dto.ts` (zod) · `*.repository.ts` (Prisma) · `*.service.ts` (regra de negócio) · `*.routes.ts` (Hono + zValidator). Não existem controllers.
- **Erros centralizados** no `onError`: `ZodError → 422 {error, issues}` (o `zValidator` custom de `server/lib/validator.ts` lança em vez de responder), `AppError → statusCode`, `Prisma P2025 → 404`, `HTTPException` do Hono → status dela (ex.: body JSON malformado → 400), resto `500`. Shape sempre `{ error }`.
- **Serialização**: services convertem Decimal/Date (`num`, `isoDate` em `server/lib/serialize.ts`) — front nunca vê tipos do Prisma.
- **Prisma singleton** via `globalThis` (`server/lib/prisma.ts`).
- **Front é SPA client-side**: `app/page.tsx` `'use client'` monta `AuthGate > FinanceProvider > App`. Componentes em `components/` são jsx portados do Vite (`allowJs`).
- **Rotas em lote / import / resumo** (evitam N requests + N `reloadCartoes`): `POST /despesas/espacos/:esp/mes/bulk` e `.../fixas/bulk` (pagar/despagar · excluir · categoria · cartao · ativar/pausar), `POST .../mes/import` (OFX) e `GET /cartoes/resumo?de&ate` (fatura mês a mês, por cartão e por categoria; janela de 24 meses). Nos lotes, **todos os ids são carregados filtrando por espaço + dono antes de qualquer escrita** — se algum não voltar, 404 e nada é aplicado.

### Front — camadas próprias

- **`components/ui/fields.jsx`**: controles com Radix (`Select`/`SelectItem`, `Checkbox`, `CheckboxField`, `NumberInput`, `DayInput`, `MonthSelect`/`MonthStepper`, `DateInput`, `FormError`). Nenhum controle nativo do sistema aparece na app (só o `<input type="file">` do import OFX, escondido com `sr-only`). `NumberInput` **nunca emite string**: `number | null`, clamp no blur — é o que evita 422 com `""` virando 0 no `z.coerce`. Select dentro de `Modal` exige `Select.Portal` (senão o popup é clipado pelo `overflow-y-auto` do modal) e `z-[70]`.
- **`components/ui/useFormState.js`**: estado de form + validação pura + erro por campo + banner (`formError`) + foco no primeiro campo inválido (pelo `name` do controle). Erro de API com `issues` (422) vira erro de campo via `lib/formErrors.js`; o que não casa com campo cai no banner. Expõe `touched` e `patch(p, { marcarTocado: false })` — é assim que uma sugestão automática (vencimento = fechamento + 7) não sobrescreve o que o usuário digitou.
- **`services/financeApi.ts`** lança `ApiError` (`status` + `issues`), não `Error` cru.
- **`components/ui/useSelecao.js`** + **`components/BulkBar.jsx`**: seleção com Shift+clique e barra de ações em lote (portal no body; dentro da lista o overflow dos Cards cortava a barra). A seleção é resetada por uma chave `${ym}:${espacoId}`.
- **`lib/ofx.js`**: parser de OFX 1.x (SGML) e 2.x (XML) + `lerArquivoOfx` (escolhe o `TextDecoder` pelo CHARSET do cabeçalho — cp1252 lido como UTF-8 estraga acento). O parse é no cliente; o servidor só faz dedup por `fitid` e insere.
- **`lib/calc.js`** concentra o domínio puro: janela do seletor de mês (`janelaMeses`, `mesesComDados`, `mesesComFatura`), sugestão de dia de fatura (`diaMaisDias`/`sugere*`), expansão de receita recorrente (`receitasDoMes`) e sugestão de categoria por descrição (`sugereCategoria`).

### Semântica de `ReceitaMes.mes` (âncora)

Receita extra pode ser **recorrente** (`recorrente` + `mesFim` opcional). Nesse caso `mes` deixa de ser "o mês do lançamento" e passa a ser a **âncora** (primeiro mês em que vale) — a coluna não foi renomeada pra não quebrar a `receitaView`. `ReceitaMesSkip (receita_id, ym)` guarda a exceção de um mês. O front expande as instâncias com `receitasDoMes(receitasMes, ym, skips)`, que devolve `key` (`"id:ym"`) e `mesEfetivo`: o `id` se repete entre meses, então **nenhuma key de React nem handler pode usar só o `id`**.

### Multi-tenancy (dado por usuário)

- Agregados raiz têm `userId` (coluna `user_id`): Caixinha, Cartao, Categoria, Espaco, AppSettings, Contato. O que pende deles (movimentações, despesas, pagamentos, shares) **não** tem `user_id` — herda o dono pela FK.
- Todo service recebe `userId` como **primeiro parâmetro**; as rotas passam `c.get("user").id` (por isso cada `Hono<AuthEnv>`). Repositórios filtram por `userId` (ou pela relação: `caixinha: { userId }`, `espaco: { userId }`, `cartao: { userId }`) — nunca buscam só por `id`.
- Recurso de outro dono responde **404**, não 403 — `getOrThrow(userId, id)` não vaza existência.
- **Id de outro agregado que vem no payload é validado como do dono**: `assertVinculos` no `orcamento.service` (`cartaoId`, `categoriaId`), `caixinhaService.getOrThrow` na movimentação, `despesaFixaExists`/`despesaMesExists` no share. Aceitar id alheio contaminaria agregados do outro dono (uma fixa injetada entra na fatura do cartão dele, que é calculada por `cartaoId`).
- `AppSettings` tem PK `user_id` (uma linha por usuário, não é mais singleton). `dev/reset` reseta só os dados do usuário logado.

### Cartão compartilhado — `server/modules/cartao-share/`

- `Contato` é a agenda do dono (`ownerId`); `userId` vincula lazy a quem tem conta (casado por email no 1º `GET /me/compartilhamentos`). Unique `(ownerId, userId)` → um contato vinculado por agenda, mas a mesma pessoa pode ser contato de vários donos.
- `CartaoShare` divide uma linha da fatura (`despesaFixaId` XOR `despesaMesId`, percentual ou valor) ou um valor avulso (`mesRef` null = recorrente). É informativo: não altera a fatura do dono.
- Permissions: `cartao:share` (gestão pelo dono) e `cartao:view_shared` (`/me/compartilhamentos`, visão "o que devo").

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
- **Integração** (`bun run test:int`): `tests/integration/*.test.ts`, banco Postgres real + app Hono real via `app.request()`. Nada mockado: passa por `onError`, `requireAuth`, `requirePermission`, `zValidator`, services, repositories e Prisma.
  - `tests/setup/env.ts` é preload de **todos** os testes (`bunfig.toml`) e força `DATABASE_URL` pro banco de teste (`TEST_DATABASE_URL`, default `postgresql://postgres:postgres@localhost:5432/cofre_test`). O nome do banco precisa conter "test" — as suítes truncam todas as tabelas.
  - `tests/integration/harness.ts`: `resetDb()`, `seedRoles()`, `account({ roles | permissions })` (cria usuário + loga pela rota real) e `client(cookie)` com `get/post/put/patch/delete` que prefixam `/api`.
  - Antes da primeira rodada: `bun run test:db:setup` (aplica o schema; cria o banco se não existir).
- CI (`.github/workflows/ci.yml`) roda typecheck → `test:unit --coverage` → `test:int` (service container `postgres:16`) → lint (informativo).
