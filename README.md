# Cofre — Wallet (Next.js + Hono)

App único: front (React) e back (Hono RPC) no mesmo projeto Next.js.
Substitui os projetos antigos `api/` (Fastify) e `web/` (Vite).

## Stack

- **Next.js 16** (App Router) + React 19 + Tailwind 4
- **Hono** na rota catch-all `app/api/[[...route]]/route.ts` — 38 endpoints REST
- **Hono RPC**: front consome via `hc<AppType>` (`services/financeApi.ts`), type-safe ponta a ponta
- **Prisma 6** + PostgreSQL 16 (docker)
- **Bun** como runtime de tooling e test runner

## Rodar

```bash
# 1. banco (compose na raiz do repo Wallet/, porta 5434)
docker compose up -d

# 2. env
cp .env.example .env

# 3. deps + prisma client
bun install
bun run prisma:generate

# 4. dev
bun dev            # http://localhost:3000
```

## Testes

```bash
bun test           # unit (services + serialize), repositories mockados
bun run typecheck  # tsc --noEmit — também valida contratos do RPC
```

## Auth (JWT + PBAC/RBAC)

- **Sessão**: JWT HS256 (`AUTH_SECRET`) em cookie **httpOnly** `auth_token` (SameSite=Lax, Secure em prod, 7d). Front nunca vê o token.
- **RBAC → PBAC**: usuário tem N roles; role = lista de permissions granulares (`recurso:acao`, wildcard `caixinha:*` / `*`). Autorização SEMPRE por permission (`requirePermission("caixinha:manage")`), nunca por nome de role. Roles/permissions são lidas do banco a cada request — trocar role de alguém vale imediatamente.
- **Roles seed**: `admin` (`*`) · `membro` (tudo menos dev/admin) · `leitor` (só `:view`).
- **Billing futuro (SaaS)**: `server/auth/entitlements.ts` é o seam — autorização efetiva = permissions das roles ∩ entitlements do plano. Hoje devolve `["*"]`; o módulo de cobrança troca isso pelas permissions do plano contratado sem tocar no resto.

```bash
bun run seed:auth                       # roles + admin@wallet.local/admin123
bun run seed:auth email@x.com senha     # admin custom
```

Rotas públicas: `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/logout`. Todo o resto exige sessão + permission. `GET /api/auth/me` → `{ id, email, nome, roles, permissions }`.

### Admin (CRUD de usuários e roles)

- API: `/api/admin/users` (GET/POST/PATCH/DELETE — `user:view`/`user:manage`), `/api/admin/roles` (idem — `role:view`/`role:manage`), `/api/admin/permissions` (catálogo pro editor de roles).
- Front: aba **Admin** (só aparece com `user:view` ou `role:view`) — criar/editar usuário com N roles, criar/editar role marcando permissions do catálogo (com wildcards `recurso:*` e `*`).
- Guardas: usuário não se desativa, não remove as próprias roles nem se exclui; permissions de role são validadas contra o catálogo (422 se desconhecida).
- O front esconde toda UI de mutação sem a permission correspondente (`useAuth().can`), mas a autoridade é sempre o back.

## Estrutura

```
app/
  api/[[...route]]/route.ts   # Hono app + onError central + export AppType
  page.tsx                    # AuthGate > FinanceProvider > App
server/
  auth/                       # JWT, cookie, middleware, PBAC matcher, entitlements (seam billing)
  lib/                        # prisma singleton, errors, serialize, zValidator(422)
  modules/<dominio>/          # *.dto.ts (zod) · *.repository.ts · *.service.ts · *.routes.ts
services/financeApi.ts        # client hc tipado — único seam do front com a API
components/ · store/ · lib/   # UI portada do projeto Vite (jsx) + AuthGate.tsx
```

## Convenções

- Rotas Hono sempre **encadeadas** (`.get().post()...`) — é o que o `AppType` captura; rota fora da cadeia fica invisível pro client.
- Validação com `zValidator` custom (`server/lib/validator.ts`): falha vira `422 { error, issues }`.
- Services serializam Decimal/Date pra JSON (`num`, `isoDate`) — front nunca vê tipos do Prisma.
# wallet
