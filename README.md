# Cofre — Wallet (Next.js + Hono)

App único: front (React) e back (Hono RPC) no mesmo projeto Next.js, com type-safety ponta a ponta.
Substitui os projetos antigos `api/` (Fastify) e `web/` (Vite) — legado, não desenvolver neles.

## Stack

- **Next.js 16** (App Router) + React 19 + Tailwind 4
- **Hono 4** — app completo em `server/app.ts` (`basePath("/api")`), **81 endpoints**
- **Hono RPC**: front consome via `hc<AppType>` (`services/financeApi.ts`), type-safe ponta a ponta
- **Zod 4** na validação de entrada (`zValidator` custom → 422)
- **Prisma 6** + PostgreSQL 16 (docker) — v6 pinada de propósito (v7 quebra generator/config)
- **Bun** como runtime de tooling e test runner

## Rodar

```bash
# 1. banco (compose na raiz do repo Wallet/, um nível acima — Postgres 16 na porta 5434)
docker compose up -d

# 2. env — preencher AUTH_SECRET (sem ele o dev usa fallback inseguro; produção recusa subir)
cp .env.example .env
openssl rand -base64 48        # cola o resultado em AUTH_SECRET

# 3. deps + prisma client
bun install
bun run prisma:generate
bun run prisma:push

# 4. seeds
bun run seed:auth        # roles + admin@wallet.local/admin123 (aceita: email senha)
bun run seed:test        # conta de testes teste@wallet.local/teste123 + dados de exemplo

# 5. dev
bun dev                  # http://localhost:3000
```

Sempre `bun`/`bunx`, nunca npm/yarn.

## Testes

Duas suítes, em **processos separados**. O `mock.module` do Bun é global no runner: rodar tudo
num processo só vaza os repositories mockados dos unitários pra dentro dos testes de integração.
**Nunca rode `bun test` sem filtro.**

```bash
bun run test           # unit + integração, em sequência
bun run test:unit      # só unit — repositories mockados, sem banco (um processo por arquivo)
bun run test:int       # só integração — Postgres real + app Hono real via app.request()
bun run test:db:setup  # cria/atualiza o banco de teste (uma vez, antes da 1ª rodada)
bun test caixinha      # filtra por caminho do arquivo
bun test -t "nome"     # filtra por nome do teste
bun run typecheck      # tsc --noEmit — também valida os contratos do RPC
bun run lint
```

- **Unit** (`server/**/*.test.ts`): `scripts/test-unit.ts` roda um processo por arquivo — `mock.module`
  não pode ser desfeito, então um arquivo que mocka um *service* serviria o stub pros arquivos
  seguintes. A cobertura sai do merge dos lcov de cada processo.
- **Integração** (`tests/integration/*.test.ts`): nada mockado — passa por `onError`, `requireAuth`,
  `requirePermission`, `zValidator`, services, repositories e Prisma. Harness em
  `tests/integration/harness.ts` (`resetDb`, `seedRoles`, `account`, `client`).
- Banco de teste: `TEST_DATABASE_URL` (default `postgresql://postgres:postgres@localhost:5432/cofre_test`).
  O nome **precisa conter "test"** — as suítes dão `TRUNCATE` em todas as tabelas.
- CI (`.github/workflows/ci.yml`): typecheck → `test:unit --coverage` → `test:int` (service container
  `postgres:16`) → lint. Bun pinado em 1.3.14.

Mapa detalhado do backend e progresso da cobertura: [`TESTES-BACKEND.md`](TESTES-BACKEND.md).

## Auth (JWT + PBAC/RBAC)

- **Sessão**: JWT HS256 (`AUTH_SECRET`) em cookie **httpOnly** `auth_token` (SameSite=Lax, Secure em prod, 7d). Front nunca vê o token.
- **RBAC → PBAC**: usuário tem N roles; role = lista de permissions granulares (`recurso:acao`, wildcard `caixinha:*` / `*`). Autorização SEMPRE por permission (`requirePermission("caixinha:manage")`), nunca por nome de role. Roles/permissions são lidas do banco a cada request — trocar role de alguém vale imediatamente.
- **Roles seed** (`server/auth/default-roles.ts`): `admin` (`*`) · `membro` (tudo menos dev/admin) · `leitor` (só `:view`).
- Permission nova de rota precisa entrar no catálogo (`server/auth/permissions.ts`), senão as roles que a usam falham validação (422).
- **Billing futuro (SaaS)**: `server/auth/entitlements.ts` é o seam — autorização efetiva = permissions das roles ∩ entitlements do plano. Hoje devolve `["*"]`; o módulo de cobrança troca isso pelas permissions do plano contratado sem tocar no resto.

```bash
bun run seed:auth                       # roles + admin@wallet.local/admin123
bun run seed:auth email@x.com senha     # admin custom
```

Rotas públicas: `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/logout`.
Todo o resto exige sessão + permission. `GET /api/auth/me` → `{ id, email, nome, roles, permissions }`.

## Multi-tenancy (dado por usuário)

- Agregados raiz têm `userId` (coluna `user_id`): `Caixinha`, `Cartao`, `Categoria`, `Espaco`, `AppSettings`, `Contato`. O que pende deles (movimentações, despesas, pagamentos, shares) **não** tem `user_id` — herda o dono pela FK.
- Todo service recebe `userId` como **primeiro parâmetro**; as rotas passam `c.get("user").id`. Repositórios filtram por `userId` (ou pela relação: `caixinha: { userId }`, `espaco: { userId }`, `cartao: { userId }`) — nunca buscam só por `id`.
- Recurso de outro dono responde **404**, não 403 — `getOrThrow(userId, id)` não vaza existência.
- **Id de outro agregado que vem no payload é validado como do dono** (`assertVinculos` no orçamento, `caixinhaService.getOrThrow` na movimentação, `despesaFixaExists`/`despesaMesExists` no share). Aceitar id alheio contaminaria o agregado do outro dono — uma fixa injetada entraria na fatura do cartão dele.
- `AppSettings` tem PK `user_id` (uma linha por usuário, não é mais singleton). `POST /api/dev/reset` reseta só os dados do usuário logado.

## Cartão compartilhado (`server/modules/cartao-share/`)

- `Contato` é a agenda do dono (`ownerId`); `userId` vincula lazy a quem tem conta (casado por email no 1º `GET /api/me/compartilhamentos`). Unique `(ownerId, userId)` — um contato vinculado por agenda, mas a mesma pessoa pode ser contato de vários donos.
- `CartaoShare` divide uma linha da fatura (`despesaFixaId` XOR `despesaMesId`, percentual ou valor) ou um valor avulso (`mesRef` null = recorrente). É **informativo**: não altera a fatura do dono.
- Permissions: `cartao:share` (gestão pelo dono) e `cartao:view_shared` (`/api/me/compartilhamentos`, visão "o que devo").

## Admin (CRUD de usuários e roles)

- API: `/api/admin/users` (GET/POST/PATCH/DELETE — `user:view`/`user:manage`), `/api/admin/roles` (idem — `role:view`/`role:manage`), `/api/admin/permissions` (catálogo pro editor de roles).
- Front: aba **Admin** (só aparece com `user:view` ou `role:view`) — criar/editar usuário com N roles, criar/editar role marcando permissions do catálogo (com wildcards `recurso:*` e `*`).
- Guardas: usuário não se desativa, não remove as próprias roles nem se exclui; permissions de role são validadas contra o catálogo (422 se desconhecida).
- O front esconde toda UI de mutação sem a permission correspondente (`useAuth().can`), mas a autoridade é sempre o back.

## Estrutura

```
server/
  app.ts                      # app Hono completo + onError central + export AppType
  auth/                       # JWT, cookie, middleware, PBAC matcher, roles padrão, entitlements
  lib/                        # prisma singleton, errors, serialize, zValidator(422)
  modules/<dominio>/          # *.dto.ts (zod) · *.repository.ts · *.service.ts · *.routes.ts
    caixinha · movimentacao · cartao · cartao-share · categoria · espaco
    orcamento · admin · bootstrap · dev
app/
  api/[[...route]]/route.ts   # só pluga o app no Next (handle(app)) e reexporta AppType
  page.tsx                    # 'use client' — AuthGate > FinanceProvider > App
services/financeApi.ts        # client hc tipado — único seam do front com a API
components/ · store/ · lib/   # UI portada do projeto Vite (jsx) + AuthGate.tsx
tests/
  integration/                # rotas via app.request(), banco real + harness
  setup/env.ts                # preload de todos os testes — força o banco de teste
```

## Convenções

- Rotas Hono sempre **encadeadas** (`.get().post()...` numa única expressão; submódulos via `.route("/", subApp)`) — é o que o `AppType` captura; rota fora da cadeia fica invisível pro client RPC.
- Não existem controllers: `routes` (Hono + zValidator) → `service` (regra de negócio) → `repository` (Prisma).
- Erros centralizados no `onError` de `server/app.ts`: `ZodError → 422 { error, issues }` · `AppError → statusCode` · `Prisma P2025 → 404` · `HTTPException → status dela` (ex.: JSON malformado → 400) · resto `500`. Shape sempre `{ error }`.
- Services serializam Decimal/Date pra JSON (`num`, `isoDate` em `server/lib/serialize.ts`) — front nunca vê tipos do Prisma.
