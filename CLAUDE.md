# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Comandos

```bash
docker compose up -d        # na raiz Wallet/ (um nível acima) — Postgres 16 na porta 5434
bun install
bun run prisma:generate
bun dev                     # http://localhost:3000

bun test                    # unit tests
bun test caixinha           # filtra por caminho do arquivo
bun test -t "nome do teste" # filtra por nome
bun run typecheck           # tsc --noEmit — também valida contratos do RPC
bun run lint
bun run build

bun run prisma:push | prisma:migrate | prisma:studio
bun run seed:auth           # roles + admin@wallet.local (aceita: email senha)
```

Sempre Bun (`bun`/`bunx`), nunca npm/yarn. Prisma **pinado em v6** (v7 tem breaking changes de generator/config).

## Restrição: `.env`

**Não editar `.env`** — usuário nega edição por agente. Alterações de env: atualizar `.env.example` e listar como pendência manual. Banco na porta **5434** (5432/5433 ocupadas por outro projeto): `postgresql://cofre:cofre@localhost:5434/cofre`. Sem `AUTH_SECRET` o dev usa fallback inseguro; produção recusa subir.

## Arquitetura

Front e back no mesmo projeto Next.js, type-safety ponta a ponta via Hono RPC. Substitui `../api` (Fastify) e `../web` (Vite) — legado, não desenvolver neles (cutover em `../PLANO-REFATORACAO.md`).

- **Backend inteiro** na rota catch-all `app/api/[[...route]]/route.ts`: app Hono com `basePath('/api')`, `onError` central e `export type AppType`.
- **`AppType` → client**: `services/financeApi.ts` cria `hc<AppType>('/')` e é o **único seam** entre front e API. Payloads tipados com `InferRequestType`. Front nunca digita URL.
- **Rotas Hono obrigatoriamente encadeadas** (`.get().post()...` numa única expressão; submódulos via `.route("/", subApp)`) — é o que o `AppType` captura. Rota registrada fora da cadeia fica invisível pro client RPC.
- **Módulos** em `server/modules/<dominio>/` (caixinha, movimentacao, cartao, categoria, espaco, orcamento, admin, bootstrap, dev): `*.dto.ts` (zod) · `*.repository.ts` (Prisma) · `*.service.ts` (regra de negócio) · `*.routes.ts` (Hono + zValidator). Não existem controllers.
- **Erros centralizados** no `onError`: `ZodError → 422 {error, issues}` (o `zValidator` custom de `server/lib/validator.ts` lança em vez de responder), `AppError → statusCode`, `Prisma P2025 → 404`, resto `500`. Shape sempre `{ error }`.
- **Serialização**: services convertem Decimal/Date (`num`, `isoDate` em `server/lib/serialize.ts`) — front nunca vê tipos do Prisma.
- **Prisma singleton** via `globalThis` (`server/lib/prisma.ts`).
- **Front é SPA client-side**: `app/page.tsx` `'use client'` monta `AuthGate > FinanceProvider > App`. Componentes em `components/` são jsx portados do Vite (`allowJs`).

### Auth (JWT + PBAC/RBAC) — `server/auth/`

- JWT HS256 em cookie httpOnly `auth_token`. `requireAuth` global em `/api` (exceto health/login/logout) + `requirePermission("recurso:acao")` em cada rota.
- Autorização **sempre por permission**, nunca por nome de role. Wildcards segmentados: `caixinha:*`, `*` (`server/auth/permissions.ts`). Roles lidas do banco a cada request — mudança vale imediatamente.
- `server/auth/entitlements.ts` é o seam do billing SaaS futuro: autorização efetiva = permissions das roles ∩ entitlements do plano (hoje `["*"]`).
- Front esconde UI de mutação via `useAuth().can(permission)`, mas a autoridade é sempre o back.
- Nova permission de rota entra no catálogo (`server/auth/permissions.ts`), senão roles que a usam falham validação (422).

### Testes

Unit tests colocados junto do código (`*.test.ts`), repositories mockados com `mock.module` do Bun — não tocam banco.
