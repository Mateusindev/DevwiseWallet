# Mapa das telas + plano dos testes de integração do front

> Documento de trabalho, irmão do `TESTES-BACKEND.md`. Serve pra **retomar depois de
> limpar o contexto**.
> Ordem de leitura: `Decisão de arquitetura` → `Infra a criar` → `Convenções` →
> `Mapa das telas` → `Checklist` (pega o primeiro `[ ]`).

**Status: Lotes 0 a 7 feitos** — 334 testes verdes de front (82 de lib + 252 da
camada 2, em 19 arquivos), somando **875 no repo** com os 287 unitários de `server/**`
e os 254 de integração.

Os achados P1/P2 do mapeamento foram **corrigidos** (ver `BUGS-FRONTEND.md`): erro geral
nos modais de movimentação, ações barradas sem caixinha, grupo zerado do "O que devo",
confirmação nas 3 exclusões, logout em mobile, `FieldGroup` nos grupos de botões,
`aria-label` do ✓ do salário, erro visível no "O que devo", actions do provider
memoizadas e lint zerado (o step do CI virou bloqueante).

**Cobertura de linhas do front: 100%** em `App.jsx`, `components/**`, `store/`,
`services/` e `lib/format.js` (medido depois das correções dos Achados); `lib/calc.js`
fecha 100% na suíte `test:lib` — o que falta na medição do front são as funções órfãs
que só o `lib` exercita (Achado 11). Falta só o Lote 8 (smoke E2E, opcional).

---

## Decisão de arquitetura

"Teste de integração do front" pode significar três coisas bem diferentes. A escolhida:

| Camada | O que é | Escopo | Decisão |
|---|---|---|---|
| **1 — unit de front** | funções puras de `lib/calc.js` e `lib/format.js` | sem DOM | **fazer** (já existe `lib/calc.test.js` órfão — ver Achados) |
| **2 — integração de front** | componentes reais + `FinanceContext` real + `financeApi` real + **app Hono real** + **Postgres real**, via `happy-dom` + Testing Library | tela inteira, ponta a ponta, sem mock | **fazer — é o foco deste plano** |
| **3 — E2E** | navegador de verdade (Playwright) contra `next build && next start` | Next runtime, hidratação, CSS, responsivo | **depois**, smoke curto só (ver Próximos passos) |

### Por que a camada 2 não usa mock do `financeApi`

O front tem **um único seam** com dados: `services/financeApi.ts` (`hc<AppType>('/')`).
Mockar esse seam é o caminho óbvio e é o que quase todo projeto faz — e é exatamente
o que **não** queremos, pelos mesmos motivos que o backend escolheu banco real na
suíte de integração:

- o mock congela o shape da resposta; o `AppType` muda e o teste continua verde;
- `orcamentoView`, agregados de fatura e `parcelaView` são calculados no **back**. Um
  mock desses blobs vira uma segunda implementação da regra de negócio dentro do teste;
- os bugs reais desse app não são de render, são de **contrato e de estado**
  (o reducer aplicar o patch errado, o `reloadCartoes` não disparar, o `userId` não
  isolar). Nada disso aparece com API mockada.

O truque que viabiliza: `hc<AppType>('/')` fala com `fetch` global em URL relativa
(`/api/...`). Trocar `globalThis.fetch` por uma ponte que chama `app.request()` —
o mesmo `app.request()` da suíte de integração do back — faz o componente exercitar
`onError`, `requireAuth`, `requirePermission`, `zValidator`, services, repositories e
Prisma. Zero mock, zero servidor HTTP, zero navegador.

### Por que não Playwright como camada principal

Já existe skill de Playwright no ambiente e ele é a ferramenta certa pra hidratação e
layout. Mas como camada **principal** custa caro: precisa de build do Next, servidor
de verdade e navegador no CI, roda em ~minutos em vez de ~segundos, e o feedback de
falha é pior (screenshot em vez de stack). Fica como smoke de 4–5 caminhos, num
workflow separado, depois que a camada 2 estiver de pé.

---

## Como rodar (depois do Lote 1)

```bash
bun run test                   # lib + unit + integração + front (4 processos, em sequência)
bun run test:lib               # só as funções puras de lib/ (sem DOM, sem banco)
bun run test:front             # só front (happy-dom + banco real)
bun test --preload ./tests/setup/dom.ts tests/front --coverage \
  --coverage-reporter=lcov --coverage-dir=coverage/front
bun test --preload ./tests/setup/dom.ts tests/front/shell.test.tsx   # um arquivo só
bun run test:db:setup          # mesma coisa da suíte de back (uma vez)
```

`test:lib` é `bun test ./lib/` — o `./` importa: o filtro `lib` casaria também
`server/lib/*.test.ts`, que pertencem à suíte unitária (com `mock.module`).

`bun run test:front` = `bun test --preload ./tests/setup/dom.ts tests/front`.
O `--preload` é **por suíte de propósito**: registrar os globais de DOM
(`document`, `window`, `navigator`) no preload global do `bunfig.toml` valeria
também pros testes de back, que não precisam disso.

Banco: o mesmo `TEST_DATABASE_URL` do back (`tests/setup/env.ts` continua sendo o
preload global, com a guarda do nome "test"). A suíte de front **trunca as mesmas
tabelas** — por isso ela roda em processo separado e nunca em paralelo com `test:int`.

---

## Dependências a instalar

```bash
bun add -d happy-dom @happy-dom/global-registrator \
  @testing-library/react @testing-library/dom @testing-library/user-event \
  @testing-library/jest-dom
```

Instaladas em 2026-07-25: `happy-dom` 20.11.1 · `@happy-dom/global-registrator`
20.11.1 · `@testing-library/react` 16.3.2 (linha que suporta React 19) ·
`user-event` 14.6.1 · `jest-dom` 7.0.0 · `@testing-library/dom` 10.4.1.

Nenhuma dep de produção nova. `next` não é importado por nenhum componente sob teste
(só `app/page.tsx`, que fica fora do escopo) — a suíte roda sem runtime do Next.

---

## Infra (criada)

### `tests/setup/dom.ts` — preload da suíte de front

Faz quatro coisas, nesta ordem (a ordem é o ponto — por isso é `--preload` e não
`beforeAll`):

1. **guarda `fetch`/`Headers`/`Request`/`Response`/`FormData`/`Blob` nativos do Bun**;
2. `GlobalRegistrator.register({ url: "http://localhost:3000/" })` — a `url` explícita
   é o que faz `hc<AppType>('/')` resolver `/api/...` pra `http://localhost:3000/api/...`;
3. **restaura os nativos por cima** dos do happy-dom (ver armadilha abaixo);
4. `IS_REACT_ACT_ENVIRONMENT = true`, `expect.extend(matchers)` do jest-dom e
   `afterEach(cleanup)` (a RTL só auto-limpa dentro de jest/vitest).

> ⚠ **Armadilha que custou o primeiro teste vermelho: a pilha de fetch do happy-dom
> descarta `Set-Cookie` da resposta.** Ela simula um navegador — o cookie iria pro jar
> interno dela e sai do header. Com o `Response` do happy-dom ativo,
> `res.headers.getSetCookie()` do `app.request()` volta `[]`, o `auth_token` nunca
> entra no jar da ponte e **todo** teste autenticado cai no `LoginForm`. Restaurar os
> nativos do Bun depois do `register()` resolve; o DOM (`document`/`window`) continua
> intacto porque são globais independentes.

Os imports de `@testing-library/*` e do jest-dom são **dinâmicos** (`await import`)
dentro do preload: os dois tocam DOM na carga do módulo e precisam rodar depois do
`register()`. E os matchers vêm como named exports (mais um default em CJS) — o
preload junta os dois antes do `expect.extend`.

### `tests/setup/jest-dom.d.ts` — tipos dos matchers

`expect.extend` é runtime; o `tsc --noEmit` do `typecheck` não sabe de
`toBeInTheDocument` e reprovaria a suíte inteira. O arquivo aumenta
`Matchers`/`AsymmetricMatchers` do módulo `bun:test` com `TestingLibraryMatchers`.

### `tests/front/harness.tsx` — ponte de fetch + `renderApp`

Reaproveita `resetDb`, `seedRoles`, `createUser` e `prisma` de
`tests/integration/harness.ts` (importa de lá, não duplica) e reexporta
`screen`/`waitFor`/`within`/`userEvent` pra o teste ter um import só.

```tsx
import { app } from "@/server/app";

// Ponte: fetch do "navegador" → app.request() do Hono, com cookie jar próprio.
// O jar existe porque auth_token é httpOnly: o happy-dom não persiste Set-Cookie
// de uma resposta sintética, e o front (corretamente) nunca lê o cookie.
export function installFetchBridge() {
  const jar = new Map<string, string>();
  const original = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const req = new Request(input as RequestInfo, init);
    const url = new URL(req.url);
    const headers = new Headers(req.headers);
    if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));

    const res = await app.request(url.pathname + url.search, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
    });

    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(";");
      const i = kv.indexOf("=");
      const [nome, valor] = [kv.slice(0, i).trim(), kv.slice(i + 1)];
      // logout manda Max-Age=0 — o jar tem que respeitar, senão a sessão "não sai"
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(attrs.join(";"))) jar.delete(nome);
      else jar.set(nome, valor);
    }
    return res;
  };

  return { jar, restore: () => { globalThis.fetch = original; } };
}
```

`renderApp(opts)` — o entry point de quase todo teste:

```tsx
// renderApp({ roles: ["membro"] })          → conta com as roles padrão
// renderApp({ permissions: ["caixinha:view"] }) → role ad-hoc, pra testar gating exato
// renderApp({ seed: true })                 → + dados de exemplo (reseed do módulo dev)
export async function renderApp(opts: ContaOpts & { seed?: boolean } = {}) {
  await resetDb();
  await seedRoles();
  const user = await createUser(opts);
  const bridge = installFetchBridge();
  // login pela rota real, atravessando a ponte → jar recebe o auth_token
  await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, senha: user.senha }),
  });
  const utils = render(
    <AuthGate><FinanceProvider><App /></FinanceProvider></AuthGate>
  );
  await waitForBoot();   // some o "Carregando suas finanças…"
  return { user, bridge, ...utils };
}
```

Helpers que valem a pena no harness (evitam repetição feia nos testes):

| Helper | Pra que |
|---|---|
| `renderApp(opts)` | boot completo autenticado, já esperando o `GET /state` |
| `renderAnon()` | render sem login — cai no `LoginForm` (usado pelos testes de sessão) |
| `waitForBoot()` | espera o fim do `status: "loading"` do `FinanceProvider` |
| `money(n)` | `fmtMoney(n)` normalizado (NBSP → espaço), pra usar em matcher de texto |
| `byMoney(n)` | matcher de texto que normaliza whitespace do nó antes de comparar |
| `goTo("cartoes")` | clica no item de nav (usa o label, não o índice) |
| `openModal(nome)` | clica no gatilho e devolve o `within(dialog)` do portal |
| `mesAtual()` / `addMeses(n)` | mês corrente e deslocamento, mesma regra da suíte de back |
| `seedDados(userId)` | chama `reseed()` de `server/modules/dev/seed.ts` (é o que `renderApp({ seed: true })` usa) |
| `bridge.calls` | log `{ method, path, status }` de tudo que passou pela ponte — pra assertar disparo (ex.: "trocar a aba recarregou só o orçamento") |
| `renderApp({ skipReset: true })` | não trunca o banco: usado quando o `beforeEach` já resetou, ou pra montar duas contas no mesmo teste |
| `renderApp({ setup })` | monta o cenário **pela API real** depois do login e antes do render (`setup: async ({ api, user }) => …`) — nenhum agregado é recalculado no teste |
| `api` / `espacoAtivo(api)` | cliente autenticado pela ponte; `espacoAtivo` força o `GET /state` porque o espaço default é criado sob demanda |
| `campo(dialog, "Aporte mensal")` | acha o controle pelo prefixo do label (o `Field` embrulha controle + hint no mesmo `<label>`) |
| `digitarMoney` / `digitarNumero` | máscara de dinheiro (dígitos crus) e `<input type=number>` (que precisa de `{backspace}`, não `clear`) |
| `esperarAusente` / `esperarSemDialog` | espera algo desaparecer **sem** `expect` dentro do `waitFor` (ver convenção 16) |

### `package.json`

```jsonc
"test":        "bun run test:lib && bun run test:unit && bun run test:int && bun run test:front",
"test:lib":    "bun test ./lib/",     // camada 1 — o "./" evita casar server/lib/
"test:front":  "bun test --preload ./tests/setup/dom.ts tests/front",
```

---

## Convenções e armadilhas

Cada item abaixo é uma dor já identificada na leitura do código — não é hipótese.

1. **NBSP no dinheiro.** `fmtMoney(1234.5)` devolve `"R$ 1.234,50"` (`a0`, não `20`)
   — `Intl` com `pt-BR`/`BRL`. `getByText("R$ 1.234,50")` **falha**. Use `byMoney(1234.5)`
   do harness (normaliza whitespace) ou `getByText(/1\.234,50/)`. Vale pro
   `fmtMoneyCompact` também (`"R$ 1.235"`).
2. **Mês corrente é global.** `currentMonthKey()` lê o relógio, e parcela
   (`parcelaInfo`) / fixa no mês (`fixaContaNoMes`) / seletor de mês dependem dele.
   Mesma regra da suíte de back: derive de `mesAtual()` + `addMeses(n)`, nunca
   `"2026-03"` fixo, senão quebra na virada do mês.
3. **Um arquivo, um processo? Não — mas zero `mock.module`.** A suíte de front roda
   num processo só (como a de integração). Isso é seguro **enquanto nenhum arquivo
   mockar módulo**. Se algum dia precisar mockar (ex.: `lucide-react`), a suíte migra
   pro runner por arquivo (`scripts/test-unit.ts` é o molde).
4. **`resetDb()` no `beforeEach`**, sempre. Estado de banco entre testes do mesmo
   arquivo vaza igual na suíte de back.
5. **Portais.** `Modal` e o popover do `PagarControl` usam `createPortal(document.body)`.
   Não use `within(container)` do `render` pra procurar dentro de modal — busque pelo
   `role="dialog"` (`Modal` já tem `aria-modal` e `aria-label={title}`).
6. **`getBoundingClientRect` é zero no happy-dom.** O `PagarControl` posiciona o
   popover com ele; o objeto retornado é truthy, então o popover **renderiza** (em
   `top: 8`). Só não asserte coordenada.
7. **`user-event` precisa de `await`** em tudo, e cada `await` já embrulha em `act`.
   Não misture com `fireEvent` no mesmo teste.
8. **`MoneyInput` / `PercentInput` são máscaras de dígito**: descartam não-dígito e
   dividem por 100. Pra escrever `1.234,50` digite `"123450"`. `clear()` + `type()`,
   porque o `value` exibido é formatado.
9. **Erro de request vira texto na tela, não exceção.** `unwrap` do `financeApi` lança
   `Error(data.error)`; os formulários pegam e mostram em `<Field error>` (role `alert`).
   Teste o **texto**, não o rejeito.
10. **`can()` é do front, autoridade é do back.** Ao testar gating, asserte as duas
    coisas: o botão não aparece **e** a rota nega (403/404). São bugs independentes.
11. **Cobertura**: `bun test --preload ./tests/setup/dom.ts tests/front --coverage \
  --coverage-reporter=lcov --coverage-dir=coverage/front` cobre `components/`, `store/`,
    `lib/` — e também `server/` de novo (a ponte executa o back). Ao comparar número
    com o `TESTES-BACKEND.md`, filtre por prefixo.
12. **`cleanup` é por teste, não por render.** Dois `renderApp` no mesmo teste (caso do
    isolamento entre contas) deixam as duas árvores no `document` — use as queries
    plurais (`getAllByText`) ou `within(container)` do render específico.
13. **Texto duplicado é a regra, não a exceção.** A nav é renderizada duas vezes
    (sidebar `lg:` + barra mobile), o `Brand` também, e o nome da caixinha aparece na
    legenda do hero *e* no card. `getByText` nesses casos falha com "found multiple" —
    prefira `getAllBy*` ou uma âncora única (`getByRole("button", { name: ... })`).
14. **Mensagens de erro do back são literais.** Login errado é
    `"Email ou senha inválidos"` (mesma mensagem pra conta inativa — não vaza estado da
    conta) e cadastro duplicado é `"Email já cadastrado"`. Não invente regex otimista.
15. **Rejeição sem `catch` derruba a suíte inteira, não só um teste.** O runner do Bun
    reporta "Unhandled error between tests" e sai com **código 1 mesmo com 0 testes
    falhando** (e a mensagem às vezes não aparece). Foi o que os efeitos
    fire-and-forget do `Dashboard`/`Cartoes` (`reloadCartoes`, `getOrcamento`) fizeram:
    403 numa conta sem `cartao:view`, ou 401 quando o request estava em vôo no
    `resetDb` do teste seguinte. Corrigido no código (Achados 4 e 7) — se aparecer de
    novo, procure `.then(` sem `.catch(`.
16. **Nunca `waitFor(() => expect(...))` no bun:test.** O `expect` do Bun conta a
    falha de *cada tentativa* no resultado do arquivo — a primeira sondagem negativa
    (que é o caso normal!) derruba a suíte, e às vezes creditada em **outro** teste
    ("Expected: '' / Received: 'element'" num arquivo que não tem aquela asserção).
    Para esperar algo aparecer use `findBy*`; para desaparecer, `esperarAusente`.
17. **`getByRole(..., { name })` não normaliza o nome acessível.** Ao contrário do
    `getByText`, o matcher de `name` roda com normalizador identidade — o NBSP do
    `fmtMoney` sobrevive. Botão "Usar valor planejado (R$ 200,00)" só casa por regex
    (ou com a string com NBSP de verdade).
18. **Grupo de botões usa `FieldGroup`, não `Field`.** Um `<button>` dentro de `<label>`
    herda o texto inteiro do label como nome acessível — era o caso dos presets de meses
    da reserva, dos seletores de cor/emoji e dos chips de role/permission (Achado 8,
    corrigido). Todos usam `FieldGroup` (`<fieldset>`/`<legend>`) agora, então
    `getByRole("button", { name: "3 meses" })` funciona, e `getByText` também. O helper
    `campo()` procura em `<label>` **e** em `<fieldset>` (pelo texto da `<legend>`);
    controle dentro de `FieldGroup` precisa de `aria-label` próprio — a `<legend>` nomeia
    o grupo, não o campo.
19. **`userEvent.clear` não serve em `<input type=number>` no happy-dom** (sem API de
    seleção, sobra resíduo: "6" + `clear` + "9" virou "39"). `{backspace}` zera o campo
    inteiro — é o que `digitarNumero` usa.
20. **Contar requests exige esperar o efeito na tela.** No wizard da reserva o card
    aparece no `POST` e o saldo só no `PATCH` seguinte; medir `bridge.calls` logo após
    o card renderizar pega a fila no meio. Espere o dado do segundo request (o `25%`).
21. **Validação nativa do input pode engolir o submit.** `<TextInput type="number"
    min={1}>` com 0 não chega no handler, então a mensagem de erro do form nunca
    aparece — asserte "nenhum request" em vez de "mensagem".
22. **"Aporte" aparece duas vezes com caixinha na tela**: o botão do header do Dashboard
    e o do `CaixinhaCard` têm o mesmo nome acessível. `getByRole("button", { name:
    /^Aporte$/ })` falha com "found multiple" — use `getAllByRole(...)[0]` (o do header
    vem primeiro no DOM). "Registrar despesa" (header) e "Despesa" (card) são distintos.
23. **Sem caixinha nenhuma o Dashboard esconde as ações de movimentação.** Cenário de
    aporte/despesa precisa criar uma caixinha no `setup` — senão os botões não existem
    (correção do Achado 6).
24. **Form dentro do `Modal` reseta por desmontagem.** `UserModal`/`RoleModal`
    (`Admin.tsx`) e `CompartilharModal` renderizam o form como filho do `Modal`, que
    devolve `null` fechado. Reabrir monta de novo, então o estado nasce dos
    `useState(props)` — não existe efeito de reset pra esperar. Em teste isso significa:
    fechar e reabrir sempre volta ao estado inicial.

---

## Mapa das telas

Front inteiro é **SPA client-side**: `app/page.tsx` (`'use client'`) monta
`AuthGate > FinanceProvider > App`. Não há rota de Next por tela — a navegação é
`useState` em `App.jsx` (`view`: `dashboard | fixas | cartoes | admin | caixinha`).
Nenhum componente de `components/` importa `next/*`, e é isso que permite renderizar
`App` direto no teste sem runtime do Next.

### Sessão e shell

| Tela / bloco | Arquivo | API que dispara | Perms | Estados a cobrir |
|---|---|---|---|---|
| **Gate de sessão** | `AuthGate.tsx` | `GET /auth/me` | — | `checking` ("Verificando sessão…"), `anon` → login, `authed` → app; `me()` 401 → anon; erro de rede → anon |
| **Login** | `AuthGate.tsx` `LoginForm` | `POST /auth/login` | — | sucesso; credencial errada (msg genérica do back); conta inativa; `busy` desabilita o submit |
| **Cadastro** | idem, `mode: register` | `POST /auth/register` | — | toggle login↔cadastro limpa erro; email duplicado (409); senha < 6 (`minLength` do input); campo `nome` só aparece no modo cadastro |
| **Logout** | `AuthGate.tsx` | `POST /auth/logout` | — | volta pro login; cookie sai do jar (`Max-Age=0`). ⚠ botão é `hidden lg:block` — só existe em desktop (ver Achados) |
| **Shell / nav** | `App.jsx` | — | `caixinha:view`, `orcamento:view`, `cartao:view`, `user:view`\|`role:view` | nav filtrada por perm; view inicial = 1º item visível; nav vazia → "Sua conta não tem permissão…"; `fin.status: loading` → spinner; `error` → mensagem + "Tentar de novo" (`refresh`); voltar de `caixinha` limpa `caixinhaId` |

### Início (Dashboard)

`components/Dashboard.jsx` · disparos no mount: `GET /state` (boot do provider) +
`GET /cartoes`. Trocar o select de página dispara `GET /despesas/espacos/:esp`.

| Bloco | Perms | O que testar |
|---|---|---|
| Header + ações | `movimentacao:manage` | mês corrente formatado; botões "Aporte"/"Registrar despesa" só com a perm |
| Hero patrimônio | — | `totalSaldo`, `totalAporteMensal`, progresso das metas (`atingidas/qtd`, %), "sem metas" quando nenhuma tem meta; donut com placeholder quando saldo 0; legenda ordenada por `ordem` |
| Grid de caixinhas | `caixinha:manage` | ordenação por `ordem`; "Nova" só com a perm; abre `CaixinhaDetail` pelo card |
| Nova caixinha (2 passos) | `caixinha:manage` | sem reserva → passo "escolher tipo"; com reserva já criada → vai direto pra `CaixinhaModal` |
| Gráficos do orçamento | `orcamento:view` | bloco inteiro some sem a perm; select de página busca o orçamento do outro espaço **sem** trocar o ativo (o `activeEspacoId` do contexto não muda); opacidade de loading; "Nenhuma despesa neste mês" / "Nenhum cartão cadastrado" |
| Despesas por categoria | `orcamento:view` | soma fixas que caem no mês + avulsas do mês; "Sem categoria" agrupado; % por fatia |
| Uso dos cartões | `orcamento:view` | limite/comprometido/disponível vindos do agregado do back; disponível negativo em rose |

### Caixinha (detalhe)

`components/CaixinhaDetail.jsx` + `CaixinhaCard.jsx`

| Bloco | Perms | O que testar |
|---|---|---|
| Header | `caixinha:manage` | saldo negativo em rose; ícones de editar/excluir só com a perm |
| Meta | — | %, "Faltam X · estimativa de Y", "✓ Meta atingida"; bloco ausente sem meta |
| Ações | `movimentacao:manage` | Aporte/Despesa abrem modal já com a caixinha selecionada (`defaultCaixinhaId`) |
| Histórico | `movimentacao:manage` | agrupado por mês, desc por data; sinal `+`/`−` por tipo; remover movimentação reverte o saldo no header (vem do back) |
| Excluir | `caixinha:manage` | modal de confirmação; confirma → volta pro dashboard e o card sai da grid; cascade das movimentações |
| `CaixinhaCard` variantes | `caixinha:manage` | com meta · sem meta · `acumulaSobra` (badge + texto) · `tipo: emergencia` sem meta → "Configurar reserva" (com perm) vs "Reserva ainda não configurada" (sem) · com meta → "Ajustar" |

### Despesas (orçamento)

`components/DespesasFixas.jsx` — a tela mais densa do app. Sub-blocos:

| Sub-bloco | API | Perms | O que testar |
|---|---|---|---|
| `EspacoTabs` | `PUT /despesas/espacos/active`, `GET /despesas/espacos/:esp`, `POST /despesas/espacos`, `PATCH`/`DELETE`, `POST`/`DELETE .../ocultar/:ym` | `espaco:manage` | troca de aba recarrega **só** o orçamento (caixinhas intactas); spinner na aba ativa; ocultar do mês (reversível) + faixa "Ocultas em <mês>" com restaurar; excluir permanente (modal com aviso); guardas: `X` some quando sobra 1 visível no mês, lixeira some quando sobra 1 espaço; ocultar a página ativa pula pra 1ª visível; **trocar o mês** pra um onde a ativa está oculta também pula (efeito no mount) |
| `RecebidoCard` | `PUT .../rendas/:ym`, `DELETE .../rendas/:ym`, `PATCH /despesas/espacos/:id` (`rendaMensal`) | `orcamento:manage` | "Salário fixo — todos os meses" vs "Só neste mês"; marcar "fixo" com override existente grava o fixo **e** apaga o override; desmarcar grava override só do mês; Enter salva; botão "Editar" só com a perm |
| Select de mês | — | — | opções vindas de `mesesOrcamento` (renda + despesas + receitas); trocar o mês recalcula tudo |
| Resumo (3 cards) + breakdown | — | — | `recebido = salário + extras`; `saiu = fixas no mês + avulsas`; `sobrou` com tom por sinal; linha "+ Receitas extras" só quando > 0 |
| Receitas extras | `POST`/`PATCH`/`DELETE .../receitas` | `orcamento:manage` | vazio com dica; criar/editar/excluir (com modal de confirmação); total no título |
| Despesas do mês | `POST`/`PATCH`/`DELETE .../mes`, `PUT .../mes/:id/pago` | `orcamento:manage` | ordenadas por valor desc; badges Paga/Parcial + cor da linha; `nota` renderizada; badge de categoria e de cartão; excluir confirma |
| Despesas fixas | `POST`/`PATCH`/`DELETE .../fixas`, `PATCH .../toggle`, `PUT .../fixas/:id/pago/:ym` | `orcamento:manage` | ordem por valor (pago não move a linha); `ativa: false` → opacidade e fora do total; parcela: "parcela 3/10 · faltam 7 (R$ X)" e "parcelas quitadas"; resumo "N/M pagas · faltam R$ X" conta **só** fixas que caem no mês; excluir confirma com aviso de histórico |
| `PagarControl` | `PUT .../pago` | `orcamento:manage` | "Pagar" → popover com valor pré-preenchido = falta; "Confirmar" soma ao já pago; "Quitar" paga cheio; parcial → botão "Falta R$ X" em amber; quitada → botão "Paga" verde, clique desfaz (set 0); "desfazer pagamentos" no popover parcial; backdrop fecha |

### Cartões

`components/Cartoes.jsx` + `components/Compartilhamento.jsx`

| Bloco | API | Perms | O que testar |
|---|---|---|---|
| Header + mês | `GET /cartoes?ym` | — | select de −3…+6 meses; trocar o mês recarrega os agregados |
| Vazio | — | — | "Nenhum cartão cadastrado" |
| Totais + donut | — | — | soma de `limite`, `faturaMes + comprometido`, disponível; % usado |
| `CartaoCard` | — | `cartao:manage`, `cartao:share` | fatura do mês / parcelas em aberto / limite disponível (todos do back); "estourado" com ring rose quando `disponivel < 0`; vencimento e fechamento; ícones por perm |
| `CartaoModal` | `POST`/`PATCH /cartoes` | `cartao:manage` | criar/editar; `diaFechamento` vazio → `null`; cor; nome vazio → erro inline |
| Excluir cartão | `DELETE /cartoes/:id` | `cartao:manage` | remove da grid; despesas vinculadas ficam com `cartaoId: null` (SetNull). ⚠ **sem confirmação** hoje (ver Achados) |
| `CompartilharModal` | `GET /contatos`, `POST /contatos`, `GET /cartoes/:id/fatura`, `GET`/`POST /cartoes/:id/shares`, `DELETE /shares/:id` | `cartao:share` | contato existente vs "+ Nova pessoa" (cria e reusa no próximo submit); tipo linha (linha inteira / percentual / valor fixo) vs tipo valor (recorrente vs "só neste mês"); lista "Compartilhado com" com `valorMes` e parcela; remover share recarrega; erros de guarda (sem contato, sem linha, sem valor) aparecem inline |
| `MeusCompartilhamentos` | `GET /me/compartilhamentos?ym` | `cartao:view_shared` | painel "O que devo" só aparece com grupos; agrupado por cartão, com dono; `devidoMes`; "parcelas futuras"; sem a perm, some. ⚠ erro é engolido (ver Achados) |

### Admin

`components/Admin.tsx`

| Bloco | API | Perms | O que testar |
|---|---|---|---|
| Tabs | `GET /admin/users`, `/admin/roles`, `/admin/permissions` | `user:view`, `role:view` | aba inicial = users se tiver `user:view`, senão roles; aba sem perm não renderiza; erro do load aparece no topo |
| `UsersTab` | `DELETE /admin/users/:id` | `user:manage` | contagem; badge de roles; "(você)" no próprio; "inativo" + opacidade; lixeira ausente no próprio (anti-lockout do front). ⚠ **sem confirmação** |
| `UserModal` | `POST`/`PATCH /admin/users` | `user:manage` | criar (senha obrigatória) vs editar (senha vazia mantém); toggle de roles; "Conta ativa" só ao editar outro; email duplicado (409) inline |
| `RolesTab` | `DELETE /admin/roles/:id` | `role:manage` | cards com descrição e contagem de usuários; `*` em amber; "nenhuma permission". ⚠ **sem confirmação** |
| `RoleModal` | `POST`/`PATCH /admin/roles` | `role:manage` | catálogo agrupado por recurso, com chip de wildcard por grupo e `*` global; toggle; nome duplicado (409); permission fora do catálogo (422) |
| Efeito imediato | — | — | trocar as permissions da role do próprio usuário → próxima request já reflete (roles são lidas do banco a cada request) |

### Formulários compartilhados (`components/forms.jsx`)

| Modal | Usado em | O que testar |
|---|---|---|
| `AporteModal` | Dashboard, CaixinhaDetail, CaixinhaCard | sugestão = `aporteMensal` da caixinha + botão "Usar valor planejado"; valor ≤ 0 → erro inline (sem request); saldo do header atualiza; data default = hoje |
| `DespesaVariavelModal` | idem | aviso "⚠ Valor maior que o saldo" quando `valor > saldo` (não bloqueia); saldo vai a negativo |
| `DespesaFixaModal` | Despesas | criar/editar; prefill re-ancora a parcela efetiva do mês; parcelamento só com cartão; tirar o cartão limpa `parcelado`; descrição/valor vazios → erro inline |
| `DespesaMesModal` | Despesas | `comParcela={false}` (sem campos de parcela); data default `${mes}-15` |
| `ReceitaMesModal` | Despesas | criar/editar; entra em "Recebido" e em `+ Receitas extras` |
| `CaixinhaModal` | Dashboard, CaixinhaDetail | criar/editar; `meta: 0` → `null`; seleção de cor; `acumulaSobra` |
| `ReservaEmergenciaModal` | Dashboard, CaixinhaCard | meta **derivada** (`meses × gasto`), não digitada; presets 3/6/12 + input livre; "completa em ~N meses"; criar faz 2 requests (create + update do saldo, porque create zera o saldo); editar grava meta/aporte/saldo |
| `EspacoModal` | Despesas (`EspacoTabs`) | nome + emoji; criado vira o ativo |
| `CategoriaModal` | inline no `CategoriaField` | opção "+ Nova categoria…" abre o modal **dentro** de outro form (portal evita `<form>` aninhado) e já seleciona a criada; só com `categoria:manage` |

### Primitivos e gráficos

| Arquivo | O que testar |
|---|---|
| `ui/primitives.jsx` | `Modal`: Esc fecha, backdrop fecha, `body.overflow` restaurado no unmount, foco no dialog, **não rouba foco a cada keystroke** (o `onCloseRef` existe por causa disso — é regressão que merece teste); `MoneyInput`/`PercentInput`: máscara e `onValue`; `Button` `loading` desabilita; `ProgressBar` clampa 0..1 e `aria-valuenow`; `Field` erro tem `role="alert"` |
| `ui/charts.jsx` | `GroupedBars`/`HBars`/`LineTrend`: normalização por máximo, lista vazia, `empty` do `HBars`. Camada 1 (sem DOM real, só render) |

### Matriz de permissions × tela

Eixo mais barato de cobrir e o que mais pega bug de vazamento de UI. Roles padrão de
`server/auth/default-roles.ts`:

| Tela / ação | `admin` (`*`) | `membro` | `leitor` | conta sem role |
|---|---|---|---|---|
| Nav: Início | ✅ | ✅ | ✅ | — |
| Nav: Despesas | ✅ | ✅ | ✅ | — |
| Nav: Cartões | ✅ | ✅ | ✅ | — |
| Nav: Admin | ✅ | ❌ | ❌ | — |
| App montado | ✅ | ✅ | ✅ | ❌ "sem permissão pra ver nenhuma área" |
| Aporte / despesa (mov.) | ✅ | ✅ | ❌ | — |
| Nova/editar caixinha | ✅ | ✅ | ❌ | — |
| Gráficos do orçamento | ✅ | ✅ | ✅ | — |
| Criar/editar/pagar despesa | ✅ | ✅ | ❌ | — |
| Abas de espaço (criar/ocultar) | ✅ | ✅ | ❌ (troca de aba é local, o `PUT active` 403 é engolido) | — |
| Cartão: criar/editar | ✅ | ✅ | ❌ | — |
| Cartão: compartilhar | ✅ | ✅ | ❌ | — |
| "O que devo" | ✅ | ❌ (`membro` não tem `cartao:view_shared`) | ✅ | — |
| Admin: users / roles | ✅ | ❌ | ❌ | — |

Cada linha "❌" vira **duas** asserções: UI ausente + rota nega. E um caso de
isolamento por tela: dado de outro usuário → 404, nunca aparece.

---

## Achados do mapeamento (não são testes — são coisas pra decidir)

> Lista priorizada, com repro e correção, em **`BUGS-FRONTEND.md`** — é o documento pra
> pegar quando o assunto for *corrigir*. O que segue abaixo é o registro cronológico de
> como cada achado apareceu. **Todos, menos os dois de código sem UI, estão corrigidos**
> (2026-07-25).

Encontrados lendo o código pra montar o mapa (1–6) e depois pela própria suíte (7–12).

1. **`lib/calc.test.js` não roda em nenhum script.** O runner de unit usa o glob
   `server/**/*.test.ts` (`scripts/test-unit.ts:20`) e `test:int` só olha
   `tests/integration`. São ~10 testes de `taxaMensal`/`saldoProjetado`/`mesesParaMeta`
   invisíveis hoje. Resolver com o script `test:lib` do Lote 0.
2. ~~**Exclusões sem confirmação**~~ — **corrigido**: cartão, usuário e role abrem
   `Modal` de confirmação como o resto do app, com aviso específico (SetNull das
   despesas; N usuários que perdem as permissions).
3. ~~**`MeusCompartilhamentos` engole erro**~~ — **corrigido**: o `catch` continua (evita
   unhandled rejection), mas agora guarda a mensagem e o painel mostra `role="alert"`.
4. ~~**`Dashboard` busca orçamento sem `catch`**~~ — **corrigido** (Lote 3): o
   `.then().finally()` do `getOrcamento` ganhou `.catch` (limpa `vizOrc`), senão a
   rejeição solta derrubava a suíte de front inteira (ver convenção 15).
5. ~~**Logout só existe em desktop**~~ — **corrigido**: o botão perdeu o `hidden
   … lg:block` e ganhou `aria-label="Sair"`.
6. ~~**`AporteModal` com zero caixinhas** manda `caixinhaId: ""` → 422~~ — **corrigido**:
   o Dashboard esconde as ações e mostra empty state sem caixinha; os modais barram o
   submit com mensagem.
7. ~~**`reloadCartoes()` sem `catch`**~~ — **corrigido** (Lote 3) no mount do
   `Dashboard` e no efeito de troca de mês do `Cartoes`. Antes, uma conta com
   `caixinha:view` e sem `cartao:view` gerava unhandled rejection a cada boot. Os três
   pontos agora engolem o erro de propósito (a tela fica com os dados que tem); se um
   dia precisar de UI de erro, é aqui.
8. ~~**Botões dentro do `<label>` do `Field`**~~ — **corrigido**: o nome acessível de cada
   botão virava "Meses de segurança 3 meses 12 meses 6 Quantos meses de gasto quer ter
   guardados". Novo primitivo `FieldGroup` (`<fieldset>`/`<legend>`) nos presets de meses,
   nas cores, nos emojis e nos chips de role/permission; `aria-pressed` em cada botão e
   `aria-label` no input livre de meses.
9. **Loop infinito de render no pulo automático de página** — **corrigido** (Lote 4,
   `DespesasFixas.jsx`): `setActiveEspaco` vem do provider com identidade nova a cada
   render, então o efeito rodava em TODO render; enquanto o PUT/GET da troca estava em
   vôo o `activeEspacoId` ainda era o antigo, o efeito disparava de novo e cada chamada
   dispatchava `ORC_LOADING` → "Maximum update depth exceeded" e a tela travada.
   Reproduzível na UI: estar numa página oculta no mês e trocar o mês. Guarda por ref
   resolve; a causa raiz (provider recriando as actions a cada render) **também foi
   corrigida** — `actions` num `useMemo` com deps reais.
10. ~~**`AporteModal`/`DespesaVariavelModal` engolem o erro do back visualmente**~~ —
    **corrigido**: os dois separam erro de campo (`<Field error>`) de erro geral
    (`<p role="alert">` antes dos botões), então resposta do back sempre aparece.
11. ~~**"O que devo" mostra grupo com R$ 0,00**~~ — **corrigido no back**:
    `meusCompartilhamentos` descarta grupo com `devidoMes === 0 && comprometido === 0`.
12. **Fire-and-forget sem `catch` no `FinanceContext`** — **corrigido** (cobertura):
    `reloadCartoes()` era chamado sem `await` nem `catch` depois de cada mutação de
    despesa; qualquer 401/403 ali virava unhandled rejection. Agora passa por
    `refreshCartoes()`, que engole o erro de propósito.


---

## Checklist

Legenda: `[ ]` pendente · `[x]` feito · `[~]` parcial

### Lote 0 — camada 1 (sem DOM, rápido) ✅
- [x] `test:lib` no `package.json` + entrar no `bun run test` (destravou `lib/calc.test.js`)
- [x] `lib/format.test.js` — 21 testes: `fmtMoney` (NBSP explícito), `fmtMoneyCompact`,
      `fmtMonthLabel`/`Short`, `lastMonths` (virada de ano, n=0/1), `monthKey`,
      `todayISO`/`currentMonthKey`, `fmtMeses`, `fmtDate` com entrada vazia
- [x] `lib/calc.test.js` — 71 testes (era 11): `monthsBetween`, `progresso`,
      `faltaParaMeta`, totais, `movsDoMes`, `resumoMensal`, `mesesDisponiveis`,
      `rendaDoMes`, `despesasDoMes`/`receitasDoMes`, `orcamentoMes`, `mesesOrcamento`,
      `parcelaInfo` (auto-avanço, janela, `ended`/`notStarted`), `fixaContaNoMes`,
      `totalFixasNoMes`, `fixaPaga`/`Parcial`/`ValorPago`/`FaltaPagar`,
      `espacoOcultoNoMes`/`espacosVisiveisNoMes`/`OcultosNoMes`, `acento` fallback

### Lote 1 — infra da camada 2 + primeiro teste verde ✅
- [x] instalar as devDeps
- [x] `tests/setup/dom.ts` (happy-dom + restauração do fetch nativo + jest-dom +
      cleanup + act env) e `tests/setup/jest-dom.d.ts` (tipos dos matchers)
- [x] `tests/front/harness.tsx` — `installFetchBridge` (jar + `calls`), `renderApp`,
      `renderAnon`, `waitForSessao`/`waitForBoot`, `money`/`byMoney`/`byTexto`, `goTo`,
      `openModal`, `mesAtual`/`addMeses`/`diaDoMes`, `seedDados`
- [x] `test:front` no `package.json` + entrar no `bun run test`
- [x] `tests/front/sessao.test.tsx` — 9 testes: gate (`checking`/anon/authed), login
      (ok, senha errada, conta inativa), cadastro (ok, email duplicado, toggle limpa
      erro), logout (volta pro login + cookie sai do jar)
- [x] passo de CI (ver Lote 7)

### Lote 2 — shell e permissions ✅
- [x] `tests/front/shell.test.tsx` — 13 testes: nav por perm (admin/membro/leitor/
      `role:view` sozinho), view inicial = 1º item visível, nav vazia, `checking` →
      `loading` → `ready` observados em sequência, `error` do `/state` (403 sem
      `state:view`) + "Tentar de novo" religando após conceder a permission no banco,
      troca de área, voltar do detalhe da caixinha (por botão e por troca de área)
- [x] `tests/front/permissions.test.tsx` — 13 testes: matriz inteira, cada "❌" com UI
      ausente **e** rota negando (403), incluindo `cartao:view_shared` nos dois sentidos
      e isolamento entre contas (caixinha de outro dono → 404 em GET/PATCH/DELETE e fora
      da lista)

### Lote 3 — dashboard e caixinhas ✅
- [x] `tests/front/dashboard.test.tsx` — 12 testes: hero (saldo/aporte somados,
      progresso e contagem de metas, "sem metas", conta zerada), grid e legenda na
      ordem de `ordem`, "Nova" em 2 passos (com e sem reserva), blocos vazios,
      despesas por categoria (fixas do mês + avulsas + "Sem categoria" com %), uso dos
      cartões vindo do agregado, select de página buscando outro espaço **sem** trocar
      o ativo (nenhum `PUT /active`, `activeEspacoId` intacto)
- [x] `tests/front/caixinha.test.tsx` — 20 testes: criar (com validação inline e sem
      request), `meta: 0 → null`, detalhe (saldo, histórico agrupado e ordenado,
      sinais), aporte com "usar valor planejado", despesa acima do saldo (aviso +
      saldo negativo), remover movimentação revertendo o saldo, editar, excluir com
      confirmação e cascade (+ cancelar), histórico vazio, variantes do card
      (meta atingida, `acumulaSobra`, sem aporte, saldo negativo em rose, reserva
      configurada/não configurada, "Ajustar")
- [x] `tests/front/reserva.test.tsx` — 9 testes: meta derivada (presets e número
      livre), estimativa "completa em ~N meses", criar com POST + PATCH do saldo,
      saldo 0 sem segundo request, guardas de submit, e o "Ajustar" reconstruindo o
      gasto (meta / 6) e salvando num único PATCH

### Lote 4 — orçamento (o lote grande) ✅
- [x] `tests/front/espacos.test.tsx` (12) — abas, troca recarregando **só** o
      orçamento, criar, ocultar/restaurar no mês, excluir permanente, as duas guardas
      e o pulo automático (por aba e por mês). Foi aqui que apareceu o **loop de
      render** do Achado 9
- [x] `tests/front/renda.test.tsx` (10) — fixo vs override, promoção a fixo
      (PATCH + DELETE), Enter, reflexo no resumo, isolamento entre meses
- [x] `tests/front/despesas-mes.test.tsx` (11) — CRUD de avulsa e de receita extra,
      ordenação por valor, badges de categoria/cartão, nota, confirmações, mês vizinho
- [x] `tests/front/despesas-fixas.test.tsx` (13) — CRUD, toggle `ativa`, parcelamento
      (label, "· última", quitadas fora do total), reancoragem no editar, tirar o
      cartão limpando o parcelamento
- [x] `tests/front/pagamentos.test.tsx` (14) — `PagarControl` completo nas duas listas:
      parcial, confirmar somando, quitar, desfazer, backdrop, Enter e o resumo
      "N/M pagas · faltam X"

### Lote 5 — cartões e compartilhamento ✅
- [x] `tests/front/cartoes.test.tsx` (14) — CRUD, totais, agregados do back (fatura
      do mês × parcelas em aberto), estourado, troca de mês (−3…+6), SetNull nas
      despesas ao excluir
- [x] `tests/front/compartilhamento.test.tsx` (13) — contato novo/existente, linha
      (inteira / percentual / valor fixo com parcela), valor (recorrente/pontual),
      remover e as quatro guardas de validação
- [x] `tests/front/o-que-devo.test.tsx` (7) — duas sessões no mesmo teste (um jar
      cada): A compartilha, B com `cartao:view_shared` vê o painel, vínculo lazy do
      contato, isolamento dos cartões e o Achado 11 (grupo com R$ 0,00 no mês seguinte)

### Lote 6 — admin e primitivos ✅
- [x] `tests/front/admin.test.tsx` (17) — abas por permission, CRUD de usuário e de
      role, email/nome duplicados, anti-lockout, catálogo agrupado com wildcards,
      só-leitura sem `*:manage` e o efeito imediato de tirar `user:view` da própria role
- [x] `tests/front/primitives.test.tsx` (21) — `Modal` (portal, aria, foco, Esc,
      backdrop, `body.overflow`, **regressão do foco por keystroke**), máscaras de
      `MoneyInput`/`PercentInput`, `Button` loading/disabled, `ProgressBar` clamp +
      aria, `Field` com `role="alert"`, `Card`/`Badge`. Sem banco e sem app
- [x] `tests/front/categoria-inline.test.tsx` (6) — criar categoria de dentro do form
      (dois portais, sem `<form>` aninhado), seleção automática, cancelar, validação e
      gating por `categoria:manage`

### Extra — seam e store (fora do plano original, vieram da caça à cobertura)
- [x] `tests/front/finance-api.test.ts` (13) — `unwrap` (mensagem do back, 401 do
      `me()`, register/login/logout) e os endpoints sem UI (`renameEspaco`, categoria
      update/remove, contato update/remove, share update, `resetState`, `?ym`)
- [x] `tests/front/store.test.tsx` (17) — ações do `FinanceContext` que nenhuma tela
      dispara (renomear espaço, excluir a página ativa, categorias, `resetAll`) e os
      casos de borda do reducer, com um componente-sonda sobre o provider real

### Lote 7 — CI (feito junto com o Lote 1)
- [x] passo `test:front` no `.github/workflows/ci.yml`, depois do `test:int`
- [x] passo `test:lib` (antes dos unitários — é o mais rápido e não precisa de banco)
- [x] `on: push` em `master` além do `pull_request`
- [x] `--coverage` do front avaliado: `bun test --preload ./tests/setup/dom.ts tests/front
      --coverage --coverage-reporter=lcov --coverage-dir=coverage/front` → **100%** de
      linhas em `components/**`, `store/` e `services/`. Publicar o merge dos lcov
      (back + front) segue pendente
- [x] step de lint deixou de ser informativo (`continue-on-error` removido) — ver
      Achado 13 em `BUGS-FRONTEND.md`

### Lote 8 — E2E (opcional, só depois)
- [ ] workflow separado, `next build && next start`, Playwright, 4–5 caminhos:
      login → dashboard → criar caixinha → aporte → pagar fixa. Roda em `workflow_dispatch`
      e em push pra `master`, não em todo PR

---

## CI (aplicado)

`.github/workflows/ci.yml`, logo depois do step de integração:

```yaml
      # Front: happy-dom + Testing Library, com o app Hono real por trás (ponte de
      # fetch em tests/front/harness.tsx). Usa o mesmo banco de teste, por isso roda
      # DEPOIS da integração e nunca em paralelo com ela — as duas truncam as tabelas.
      - name: Testes de front (integração)
        run: bun run test:front
```

Nada mais muda: o service container `postgres:16`, o `TEST_DATABASE_URL`,
`DATABASE_URL`/`DIRECT_URL` e o `AUTH_SECRET` do job já servem (linhas 36–41 do
workflow atual). Ordem final dos steps:

`checkout → setup-bun 1.3.14 → install → prisma:generate → typecheck →
test:db:setup → test:lib → test:unit --coverage → test:int → test:front → lint`

O step de lint deixou de ser informativo: `bun run lint` fecha limpo (0 erros, 0
warnings) desde a correção do Achado 13, então o `continue-on-error: true` saiu.

Duas mudanças de gatilho aplicadas junto:

1. **`on: push` em `master`** — antes só `pull_request`, então merge direto não rodava CI.
2. **`test:lib` como step próprio**, antes dos unitários: o runner por-arquivo de
   `scripts/test-unit.ts` é específico de `server/**` e não serve pra `lib/`.

Sobre paralelizar em jobs separados: **não vale agora.** Os três `bun test` somam
poucos minutos, e job separado exigiria replicar o service container e o
`prisma:generate` — mais tempo de setup do que se economiza.

---

## Fora de escopo (por ora)

- `app/page.tsx` / `app/layout.tsx` — só montagem; cobertos de fato pelo E2E do Lote 8.
- `app/api/[[...route]]/route.ts` — `handle(app)` + reexport de tipo.
- CSS / Tailwind / responsivo (`lg:` vs mobile) — happy-dom não faz layout. O logout
  deixou de ser `lg:`-only (Achado 5), mas confirmar que ele **aparece** no viewport
  mobile só dá no Playwright.
- Hidratação e Server Components — não se aplica: a árvore é `'use client'` inteira.
- Acessibilidade além do que a Testing Library já força (roles, labels, `aria-*`).
  Um `axe` na camada 2 é candidato futuro.

---

## Histórico

<!-- append: data · lote · testes · cobertura -->

| Data | Lote | Testes | Linhas |
|---|---|---|---|
| 2026-07-25 | plano + mapa das telas (nada implementado) | 0 | — |
| 2026-07-25 | Lote 0 — camada 1 (`lib/format` + `lib/calc`) | 82 | — |
| 2026-07-25 | Lote 1 — infra da camada 2 + `sessao` + CI | +9 | — |
| 2026-07-25 | Lote 2 — `shell` + `permissions` | +26 | — |
| 2026-07-25 | Lote 3 — `dashboard` + `caixinha` + `reserva` | +41 | — |
| 2026-07-25 | Lote 4 — orçamento (5 arquivos) | +60 | — |
| 2026-07-25 | Lote 5 — cartões + compartilhamento + o que devo | +34 | — |
| 2026-07-25 | Lote 6 — admin + primitivos + categoria inline | +44 | — |
| 2026-07-25 | Extra — `finance-api` + `store` (cobertura) | +32 | 99,2% |
| 2026-07-25 | Correção dos Achados 2/3/5/6/8/9/10/11/13 (ver `BUGS-FRONTEND.md`) | +6 | 100% |

Total do repo hoje: **875 testes** — 82 (lib) + 287 (unitários de `server/**`, 17
arquivos em processos isolados) + 254 (integração) + 252 (front). `bun run test` sai 0.

---

## Próximos passos (não feitos)

1. ~~Fechar os Achados 1–6~~ e ~~zerar o lint~~ — **feitos** (ver `BUGS-FRONTEND.md`).
   Segue aberto só o que é decisão de produto: código do contexto e funções de
   `lib/calc.js` sem UI (Achados 10 e 11 de lá) — decidido manter por ora.
2. Testes de comportamento do client RPC (`services/financeApi.ts`) — a camada 2
   cobre por tabela de arrasto, mas `unwrap` (propagação de `{ error }`, corpo vazio,
   `me()` em 401) merece arquivo próprio.
3. Smoke E2E do Lote 8 — inclui o único caso que a camada 2 não vê: o logout em viewport
   mobile (o botão deixou de ser `lg:`-only, mas layout não é testável no happy-dom).
