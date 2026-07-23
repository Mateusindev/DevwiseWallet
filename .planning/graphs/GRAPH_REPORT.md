# Graph Report - app  (2026-07-09)

## Corpus Check
- 82 files · ~32,856 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 514 nodes · 1103 edges · 26 communities (21 shown, 5 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `37f4a504`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]

## God Nodes (most connected - your core abstractions)
1. `unwrap()` - 49 edges
2. `useFinance()` - 29 edges
3. `fmtMoney()` - 24 edges
4. `useAuth()` - 19 edges
5. `NotFoundError` - 16 edges
6. `compilerOptions` - 16 edges
7. `ACENTO` - 14 edges
8. `currentMonthKey()` - 14 edges
9. `num()` - 14 edges
10. `scripts` - 12 edges

## Surprising Connections (you probably didn't know these)
- `mesesRange()` --calls--> `currentMonthKey()`  [EXTRACTED]
  components/Cartoes.jsx → lib/format.js
- `Linha()` --calls--> `fmtMoney()`  [EXTRACTED]
  components/Cartoes.jsx → lib/format.js
- `CategoriaBadge()` --calls--> `ACENTO`  [EXTRACTED]
  components/DespesasFixas.jsx → lib/calc.js
- `PagarControl()` --calls--> `fmtMoney()`  [EXTRACTED]
  components/DespesasFixas.jsx → lib/format.js
- `Resumo()` --calls--> `fmtMoney()`  [EXTRACTED]
  components/DespesasFixas.jsx → lib/format.js

## Import Cycles
- None detected.

## Communities (26 total, 5 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (98): App(), NAV, useAuth(), CaixinhaCard(), CaixinhaDetail(), CartaoCard(), Cartoes(), Linha() (+90 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (48): caixinhaRepository, caixinhaService, Cx, db, toView(), cartaoRepository, cartaoService, cartaoView() (+40 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (59): Admin(), { Card, Button, Modal, Field, TextInput, Badge, Spinner }, AuthContext, AuthContextValue, Status, addAporte(), addCaixinha(), addCartao() (+51 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (37): dependencies, hono, @hono/zod-validator, lucide-react, next, @prisma/client, react, react-dom (+29 more)

### Community 4 - "Community 4"
Cohesion: 0.09
Nodes (23): CreateRoleDTO, createRoleSchema, CreateUserDTO, createUserSchema, permissionList, UpdateRoleDTO, updateRoleSchema, UpdateUserDTO (+15 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (22): AddDespesaFixaDTO, addDespesaFixaSchema, AddDespesaMesDTO, addDespesaMesSchema, AddReceitaMesDTO, addReceitaMesSchema, categoriaId, nota (+14 more)

### Community 6 - "Community 6"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 7 - "Community 7"
Cohesion: 0.21
Nodes (7): authRepository, UserWithRoles, withRoles, authService, AuthUser, planEntitlements(), AppError

### Community 8 - "Community 8"
Cohesion: 0.27
Nodes (7): CreateCategoriaDTO, createCategoriaSchema, UpdateCategoriaDTO, updateCategoriaSchema, categoriaRepository, categoriaRoutes, categoriaService

### Community 9 - "Community 9"
Cohesion: 0.18
Nodes (10): getState(), orcamentoRoutes, app, AppType, DELETE, GET, PATCH, POST (+2 more)

### Community 10 - "Community 10"
Cohesion: 0.27
Nodes (8): CreateEspacoDTO, createEspacoSchema, setActiveSchema, UpdateEspacoDTO, updateEspacoSchema, espacoRoutes, manage, view

### Community 11 - "Community 11"
Cohesion: 0.20
Nodes (9): Admin (CRUD de usuários e roles), Auth (JWT + PBAC/RBAC), Cofre — Wallet (Next.js + Hono), Convenções, Estrutura, Rodar, Stack, Testes (+1 more)

### Community 12 - "Community 12"
Cohesion: 0.31
Nodes (7): cartaoQuerySchema, CreateCartaoDTO, createCartaoSchema, dia, UpdateCartaoDTO, updateCartaoSchema, cartaoRoutes

### Community 13 - "Community 13"
Cohesion: 0.39
Nodes (5): caixinhasSeed(), makeSeed(), movimentacoesSeed(), orcamentoMeu(), orcamentoNosso()

### Community 14 - "Community 14"
Cohesion: 0.33
Nodes (5): authRoutes, cookieOpts, loginSchema, requireAuth, zValidator()

### Community 15 - "Community 15"
Cohesion: 0.38
Nodes (5): CreateCaixinhaDTO, createCaixinhaSchema, UpdateCaixinhaDTO, updateCaixinhaSchema, caixinhaRoutes

### Community 16 - "Community 16"
Cohesion: 0.29
Nodes (5): Arquitetura, Auth (JWT + PBAC/RBAC) — `server/auth/`, Comandos, Restrição: `.env`, Testes

### Community 17 - "Community 17"
Cohesion: 0.33
Nodes (4): roleLeitor, roleMembro, Row, state

### Community 18 - "Community 18"
Cohesion: 0.40
Nodes (4): CreateMovimentacaoDTO, createMovimentacaoSchema, ymd, movimentacaoRoutes

### Community 19 - "Community 19"
Cohesion: 0.50
Nodes (3): requirePermission(), devRoutes, reseed()

### Community 20 - "Community 20"
Cohesion: 0.40
Nodes (3): cartao, Row, state

## Knowledge Gaps
- **135 isolated node(s):** `NAV`, `app`, `routes`, `GET`, `POST` (+130 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **5 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `NotFoundError` connect `Community 1` to `Community 8`, `Community 4`, `Community 7`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `AppError` connect `Community 7` to `Community 1`, `Community 4`, `Community 9`, `Community 17`, `Community 19`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Why does `hasPermission()` connect `Community 4` to `Community 2`, `Community 7`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **What connects `NAV`, `app`, `routes` to the rest of the system?**
  _135 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05426997245179063 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.053946053946053944 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.053923541247484906 - nodes in this community are weakly interconnected._