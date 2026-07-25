# Mapa do backend + progresso dos testes (unit + integração)

> Documento de trabalho. Serve pra **retomar depois de limpar o contexto**.
> Ordem de leitura: `Como rodar` → `Estado atual` → `Checklist` → pega o primeiro item `[ ]`.

---

## Como rodar

```bash
bun run test                   # unit + integração (processos separados)
bun run test:unit              # só unit  (repositories mockados, sem banco)
bun run test:int               # só integração (banco real)
bun run test:db:setup          # cria/atualiza o banco de teste (uma vez)
bun run test:unit -- --coverage
bun test espaco                # filtra por caminho (dentro de uma suíte)
bun test -t "nome do teste"    # filtra por nome
bun run typecheck              # tsc --noEmit
bun run lint
```

**Nunca rode `bun test` sem filtro**: o runner do Bun usa um processo só e o
`mock.module` dos unitários vaza pros testes de integração (219 falsos negativos).
Por isso `bun run test` chama as duas suítes em processos separados.

Banco de teste: `TEST_DATABASE_URL` (default
`postgresql://postgres:postgres@localhost:5432/cofre_test`). O nome precisa conter
"test" — `tests/setup/env.ts` recusa subir caso contrário, porque as suítes dão
`TRUNCATE` em todas as tabelas.

CI: `.github/workflows/ci.yml` roda `typecheck → test:db:setup → test:unit --coverage
→ test:int → lint` em todo push para `master` e em todo PR que aponte pra ela, com
um service container `postgres:16` pro banco de teste.

---

## Convenção dos testes deste repo

### Unit (`server/**/*.test.ts`)

Unit test colocado ao lado do código (`*.test.ts`). **Repositório é mockado com
`mock.module` do Bun — nenhum teste toca o banco.** Padrão:

```ts
import { describe, expect, it, beforeEach, mock } from "bun:test";

const state = { /* linhas fake mutáveis */ };

mock.module("@/server/modules/x/x.repository", () => ({
  xRepository: { findById: async () => state.row, /* ... */ },
}));

// import dinâmico DEPOIS do mock.module — obrigatório
const { xService } = await import("./x.service");

beforeEach(() => { /* reset do state */ });
```

Regras:
- `mock.module` **antes** do `await import()` do módulo sob teste, senão o real vaza.
- Serviços recebem `userId` como 1º parâmetro; recurso de outro dono → `NotFoundError` (404), nunca 403.
- Valores monetários passam por `round()` (2 casas) — asserção deve bater no valor arredondado.

### Integração (`tests/integration/*.test.ts`)

Banco Postgres real + app Hono real (`server/app.ts`) via `app.request()`. **Nada é
mockado**: a request passa por `onError`, `requireAuth`, `requirePermission`,
`zValidator`, service, repository e Prisma. Padrão:

```ts
import { describe, expect, it, beforeEach } from "bun:test";
import { account, resetDb, seedRoles, type Client } from "./harness";

let api: Client;

beforeEach(async () => {
  await resetDb();                                    // TRUNCATE de tudo
  await seedRoles();                                  // admin / membro / leitor
  api = (await account({ roles: ["membro"] })).api;    // cria usuário + loga de verdade
});

it("faz algo", async () => {
  const res = await api.post("/caixinhas", { nome: "X" }); // "/api" é prefixado
  expect(res.status).toBe(201);
});
```

Harness (`tests/integration/harness.ts`):
- `resetDb()` / `seedRoles()` — chamar no `beforeEach` (as suítes rodam em sequência
  num processo só, então o estado tem que ser zerado por teste).
- `account({ email?, senha?, roles?, permissions?, ativo? })` → `{ user, api, cookie }`.
  `permissions` cria uma role ad-hoc com exatamente aquelas permissions (é assim que
  se testa 403 granular); `roles` usa as padrão.
- `createUser()` (só cria) · `login(email, senha)` (cookie via rota real) ·
  `client(cookie)` · `anon` (sem sessão) · `prisma` (asserção direta no banco).

Regras:
- Mês corrente importa: parcelas ancoram em `currentMonth()`. Use `currentMonth()` e um
  `addMonths()` local em vez de datas fixas, senão o teste quebra na virada do mês.
- Arredondamento é do float mesmo (`round()` com EPSILON): `600.555 → 600.55`. Prefira
  centavos que não caem no limite (`.559`) quando o valor exato não é o ponto do teste.
- Recurso de outro dono → 404. Toda suíte de módulo tem um caso de isolamento.

---

## Mapa do backend

Todo o back vive no app Hono de `server/app.ts` (`basePath('/api')`, `onError` central,
`export type AppType`); `app/api/[[...route]]/route.ts` só faz `handle(app)`. Camadas por módulo:
`*.dto.ts` (zod) · `*.repository.ts` (Prisma) · `*.service.ts` (regra) · `*.routes.ts` (Hono + zValidator).
Sem controllers.

### Infra (`server/lib`, `server/auth`)

| Arquivo | O que faz | Pontos testáveis |
|---|---|---|
| `lib/errors.ts` | `AppError` (statusCode, default 400), `NotFoundError` (404) | statusCode/name |
| `lib/serialize.ts` | `num`, `numOrNull`, `isoDate`, `parseDate`, `round`, `monthsBetween`, `effectiveParcela`, `parcelaAtivaNoMes`, `parcelaView`, `parcelaWrite` | auto-avanço de parcela, clamp de janela, normalização de escrita |
| `lib/validator.ts` | `zValidator` custom que **lança** ZodError em vez de responder 400 | erro propagado → `onError` → 422 |
| `lib/prisma.ts` | singleton via `globalThis` | — (não testar) |
| `auth/password.ts` | scrypt `scrypt:<salt>:<hash>` | verify ok/falha, formato inválido |
| `auth/permissions.ts` | `hasPermission` com wildcard segmentado (`caixinha:*`, `*`) + catálogo | matches/negativos |
| `auth/entitlements.ts` | seam de billing; hoje devolve `["*"]` | contrato |
| `auth/auth.service.ts` | login, register, `getSessionUser`, `can`, `signToken`/`verifyToken`, `authSecret` | credencial inválida = msg única; prod sem `AUTH_SECRET` lança |
| `auth/middleware.ts` | `requireAuth` (cookie `auth_token`) + `requirePermission` | 401 sem/token inválido, 403 sem permission |

### Módulos de domínio (`server/modules/<dominio>`)

| Módulo | Serviço — regras que importam | Rotas |
|---|---|---|
| `bootstrap` | `getState`: `ensureDefaults` de espaço+categoria, agrega tudo em paralelo, orçamento só se houver espaço ativo | `GET /state` |
| `caixinha` | `create` calcula `ordem = count+1`, saldo inicia 0; `update` arredonda campos monetários; `getOrThrow` 404 | `/caixinhas`, `/caixinhas/:id` |
| `movimentacao` | `create` valida dono da caixinha, `delta = +aporte / -despesa`, descrição default "Aporte"/"Despesa"; `remove` reverte o saldo | `/movimentacoes`, `/movimentacoes/:id` |
| `espaco` | `ensureDefaults` (espaço "Meu", idempotente); `listWithActive` com fallback do ativo; `ocultarNoMes` proíbe ocultar o último visível; `remove` proíbe remover o único e reassina o ativo; `orcamentoView` monta o blob do front | `/despesas/espacos*`, `/despesas/espacos/active` |
| `orcamento` | `assertPertence` (404 se a linha é de outro espaço); `assertVinculos` (`cartaoId`/`categoriaId` precisam ser do próprio dono → 404); `clampPago` entre 0 e o valor; `setPagamentoFixa` (<=0 apaga o registro); `setPagaMes` (`paga = pago >= valor && valor > 0`); patch de parcela reancora no mês corrente; `data` default = dia 01 do mês | `/despesas/espacos/:esp/...` |
| `cartao` | `withAggregates`: fatura = fixas na janela + avulsas do mês; comprometido = parcelas restantes × valor; disponível = limite − fatura − comprometido; `faturaLinhas` lista fixas ativas + avulsas | `/cartoes`, `/cartoes/:id`, `/cartoes/:id/fatura`, `/cartoes/:id/shares` |
| `cartao-share` | `shareValorNoMes` (tipo valor recorrente vs pontual; tipo linha com percentual/valor/linha inteira); `shareComprometido`; vínculo lazy de `Contato` por email (`vinculavelPor`, `resolveContatos` — 1 contato por dono); `meusCompartilhamentos` agrupa por cartão | `/contatos*`, `/cartoes/:id/shares`, `/shares/:id`, `/me/compartilhamentos` |
| `categoria` | `ensureDefaults` cria 8 categorias padrão, idempotente; `create` com `ordem = count+1` | `/categorias`, `/categorias/:id` |
| `admin` | unicidade de email/nome de role (409); `assertRolesExist` (422); guard anti-lockout (não desativa/zera roles de si mesmo, não se auto-exclui) | `/admin/users*`, `/admin/roles*`, `/admin/permissions` |
| `dev` | `POST /dev/reset` reseta só os dados do usuário logado | `/dev/reset` |

### Suítes de integração (`tests/integration/`)

| Arquivo | Cobre |
|---|---|
| `auth.test.ts` | health, login (401 genérico, inativo), register (409, role faltando), `/auth/me` (sessão fresca: desativar/trocar role vale na request seguinte), logout, cookie httpOnly |
| `contrato.test.ts` | 401 em todo grupo de rota sem cookie, shape `{ error }` por status, 422 com `issues`, JSON malformado → 400, erro não mapeado → 500, wildcards (`*`, `caixinha:*`, permission exata) |
| `state.test.ts` | defaults da conta nova (1 espaço + 8 categorias), idempotência, agregação, isolamento |
| `caixinha.test.ts` | CRUD, `ordem = count+1`, saldo server-side, arredondamento, `meta: null`, cascade de movimentações, 404 cross-account |
| `movimentacao.test.ts` | saldo por tipo (transação), descrição default, data default, reversão no delete, 404 |
| `espaco.test.ts` | lista + ativo (fallback), primeiro vira ativo, update, guardas (único espaço / última página do mês), ocultar/restaurar, blob de orçamento |
| `orcamento.test.ts` | fixas (defaults, parcela + reancoragem, toggle, delete), pagamentos por mês (parcial/clamp/zero remove), despesas do mês (`pago` → `paga`), receitas, renda, 404 por espaço errado, 404 com `cartaoId`/`categoriaId` de outra conta (inclui fatura da vítima intacta) |
| `cartao.test.ts` | CRUD, agregados (fatura/comprometido/disponível) com fixa inativa, avulsa de outro mês, parcelada auto-avançando e encerrada, cartão global entre espaços, `faturaLinhas`, SetNull no delete |
| `cartao-share.test.ts` | contatos (vínculo lazy, unique por agenda, mesma pessoa em agendas diferentes), shares (percentual/valor/linha inteira, valor recorrente vs pontual, parcelas), guardas de DTO (422), `/me/compartilhamentos` (claim lazy, agrupamento por cartão, múltiplos donos, `ym`) |
| `categoria.test.ts` | CRUD, ordem, SetNull nas despesas, 404 |
| `admin.test.ts` | users (criar/login, 409, 422 de role, patch de senha/email/ativo/roles, anti-lockout), roles (CRUD, 409, permission fora do catálogo, efeito imediato da troca de permissions), catálogo |
| `dev.test.ts` | `/dev/reset` recria só os dados do próprio usuário, idempotente, 403 sem `dev:reset`, guarda de produção |

### Fora de escopo (por ora)

- `server/lib/prisma.ts` — singleton, sem lógica.
- `scripts/*` — utilitários de linha de comando (`seed-auth`, `reseed`, `seed-test-account`); rodados à mão.
- `lib/calc.js` / `lib/format.js` — front (portados do Vite), aparecem no relatório de cobertura mas não são backend.
- Client RPC (`services/financeApi.ts`) — hoje só o `typecheck` valida o contrato.

---

## Estado atual

<!-- ATUALIZAR a cada lote -->

**287 unit (17 arquivos) + 254 integração (12 arquivos) = 541 testes, 0 falhas.**
`bun run typecheck` limpo.

- Unit (`bun run test:unit -- --coverage`): **100% funcs / 98.20% linhas** nos
  arquivos exercitados.
- Integração (`bun test tests/integration --coverage`): **99.91% funcs / 99.08%
  linhas** — todo `*.routes.ts` e todo `*.repository.ts` em **100% de linhas**,
  mais `server/app.ts` (98%: só o ramo `Prisma P2025`, que exige corrida) e
  `server/modules/dev/seed.ts` em 100%.

Todo arquivo de `server/` sob teste unitário está em 100% de funções:

| Arquivo | Funcs | Linhas |
|---|---|---|
| `server/auth/auth.service.ts` | 100% | 100% |
| `server/auth/middleware.ts` | 100% | 100% |
| `server/auth/password.ts` | 100% | 100% |
| `server/auth/permissions.ts` | 100% | 100% |
| `server/lib/errors.ts` | 100% | 100% |
| `server/lib/serialize.ts` | 100% | 100% |
| `server/lib/validator.ts` | 100% | 100% |
| `server/modules/admin/admin.service.ts` | 100% | 99.01% |
| `server/modules/bootstrap/bootstrap.service.ts` | 100% | 100% |
| `server/modules/caixinha/caixinha.service.ts` | 100% | 100% |
| `server/modules/cartao/cartao.service.ts` | 100% | 100% |
| `server/modules/cartao-share/cartao-share.service.ts` | 100% | 99.39% |
| `server/modules/categoria/categoria.service.ts` | 100% | 100% |
| `server/modules/espaco/espaco.service.ts` | 100% | 100% |
| `server/modules/movimentacao/movimentacao.service.ts` | 100% | 100% |
| `server/modules/orcamento/orcamento.service.ts` | 100% | 100% |

As duas linhas que faltam são ramos inalcançáveis pela API pública
(`linhaBase()` com share sem linha apontada; guarda de `assertRolesExist` com
lista vazia por caminho já coberto).

**Pendências conhecidas:**
- `bun run lint` tem **9 erros pré-existentes** nos componentes portados do Vite
  (`components/*.jsx`, `components/Admin.tsx`) + 1 warning em
  `server/auth/entitlements.ts` (`_userId` não usado, é proposital). Por isso o
  passo de lint no CI está com `continue-on-error: true`. Zerar isso e remover
  a flag é o próximo item de higiene.
- `Prisma P2025 → 404` no `onError` só é alcançável em corrida (todo service
  confere existência antes) — segue sem teste.

---

## Checklist

Legenda: `[ ]` pendente · `[x]` feito · `[~]` parcial

### Lote 1 — infra
- [x] `server/lib/serialize.test.ts` — completar `parcelaView` e `parcelaWrite` (linhas 67-79 descobertas)
- [x] `server/lib/errors.test.ts` — `AppError` default 400, statusCode custom, `NotFoundError` 404
- [x] `server/lib/validator.test.ts` — payload inválido lança `ZodError` (não responde 400)
- [x] `server/auth/password.test.ts` — hash/verify, senha errada, `stored` malformado
- [x] `server/auth/entitlements.test.ts` — `planEntitlements` devolve `["*"]`

### Lote 2 — auth
- [x] `server/auth/auth.service.test.ts` — `login` sucesso, usuário inativo, `register` (email duplicado 409, role `membro` ausente 500), `getSessionUser`, `can` (role ∩ entitlement), `signToken`/`verifyToken` round-trip, token adulterado, `authSecret` em produção
- [x] `server/auth/middleware.test.ts` — `requireAuth` 401 (sem cookie / token inválido / usuário sumiu), sucesso popula `c.get("user")`; `requirePermission` 403

### Lote 3 — domínio simples
- [x] `server/modules/caixinha/caixinha.service.test.ts` — `create` (ordem, saldo 0), `update` (arredondamento, `meta: null`), `remove`
- [x] `server/modules/categoria/categoria.service.test.ts` — `ensureDefaults` (cria 8 / não recria), `create` ordem
- [x] `server/modules/movimentacao/movimentacao.service.test.ts` — `list`, descrição default, caixinha de outro dono → 404

### Lote 4 — espaço + orçamento
- [x] `server/modules/espaco/espaco.service.test.ts` — `ensureDefaults`, `orcamentoView`, `getOrcamento` (404), `setActive`, `create` (1º vira ativo), `update` (arredonda renda), `restaurarNoMes`
- [x] `server/modules/orcamento/orcamento.service.test.ts` — CRUD de fixa, reancoragem de parcela no patch, receitas do mês, `clearRenda`, `removeDespesaMes`

### Lote 5 — cartão + compartilhamento
- [x] `server/modules/cartao/cartao.service.test.ts` — `getOrThrow` 404, `faturaLinhas`, `listWithAggregates`, `create` (ordem), `update` (arredonda limite), `remove`
- [x] `server/modules/cartao-share/cartao-share.service.test.ts` — CRUD de contato, `updateContato` reavalia vínculo, `listByCartao`, `createShare` (linha inexistente 404, normalização percentual/mesRef), `updateShare` (`mesRef` só em tipo valor), `removeShare`

### Lote 6 — admin + bootstrap
- [x] `server/modules/admin/admin.service.test.ts` — `listUsers`, `updateUser` (email duplicado, anti-lockout, roles), `deleteUser`, roles CRUD (409/404/422)
- [x] `server/modules/bootstrap/bootstrap.service.test.ts` — chama os `ensureDefaults`, agrega o payload, `orcamento: null` sem espaço ativo

### Infra de CI
- [x] `.github/workflows/ci.yml` — push em `master`/`main` + PRs
- [x] service container `postgres:16` + `test:db:setup` + passo separado de integração

### Lote 7 — integração (rotas + Prisma reais)
- [x] Extrair o app Hono pra `server/app.ts` (`route.ts` só faz `handle(app)`) pra
      poder importar nos testes
- [x] `tests/setup/env.ts` (preload) + `bunfig.toml` — força `DATABASE_URL` pro
      banco de teste, com guarda de nome ("test")
- [x] `tests/integration/harness.ts` — `resetDb`, `seedRoles`, `account`, `client`, `anon`
- [x] `server/auth/default-roles.ts` — roles padrão como fonte única (seeds + testes)
- [x] `scripts/seed-test-account.ts` (`bun run seed:test`) — conta de testes idempotente
- [x] 12 suítes: `auth`, `contrato`, `state`, `caixinha`, `movimentacao`, `espaco`,
      `orcamento`, `cartao`, `cartao-share`, `categoria`, `admin`, `dev`
- [x] `onError` passou a respeitar `HTTPException` do Hono (JSON malformado era 500, agora 400)
- [x] `assertVinculos` no `orcamento.service` — `cartaoId`/`categoriaId` de outra conta
      respondiam 200 e entravam no agregado do cartão alheio; agora 404 (create e patch,
      fixa e despesa do mês), com testes unitários e de integração

---

## Histórico

<!-- append: data · lote · testes · cobertura -->

| Data | Lote | Testes | Linhas |
|---|---|---|---|
| 2026-07-25 | baseline | 116 | 70.45% |
| 2026-07-25 | 1 — infra (`serialize`, `errors`, `validator`, `password`, `entitlements`) | 157 | — |
| 2026-07-25 | 2 — auth (`auth.service`, `middleware`) | 187 | — |
| 2026-07-25 | 3 — caixinha / categoria / movimentação | 205 | — |
| 2026-07-25 | 4 — espaço + orçamento | 253 | — |
| 2026-07-25 | 5 — cartão + compartilhamento | 286 | — |
| 2026-07-25 | 6 — admin + bootstrap + CI | **291** | **94.38%** |
| 2026-07-25 | 7 — integração (12 suítes, banco real) + CI com Postgres | **280 unit + 248 int** | unit 98.20% · int 99.08% |
| 2026-07-25 | 7b — `assertVinculos` (cartão/categoria de outro dono → 404) | **287 unit + 254 int** | unit 98.20% · int 99.08% |

---

## Próximos passos (não feitos)

1. **Zerar o lint** dos componentes portados e remover o `continue-on-error` do CI.
2. **Testes do client RPC** (`services/financeApi.ts`): hoje o `typecheck` já
   valida o contrato, mas não há teste de comportamento.
3. **Concorrência**: nada exercita duas requests simultâneas (o ramo `P2025` do
   `onError`, o saldo da caixinha sob aportes paralelos, `upsert` de renda).
