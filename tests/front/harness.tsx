/* eslint-disable @typescript-eslint/no-explicit-any -- helpers genéricos de teste */
// Harness da suíte de front: componentes reais + contexto real + financeApi
// real + app Hono real + Postgres real. Nada mockado.
//
// O truque é a ponte de fetch: `hc<AppType>('/')` fala com o fetch global em
// URL relativa, então trocar o fetch por uma função que chama `app.request()`
// faz cada clique atravessar onError, requireAuth, requirePermission,
// zValidator, services, repositories e Prisma — o mesmo caminho da suíte de
// integração, só que dirigido pela UI.
//
// Banco: mesmo TEST_DATABASE_URL da integração (tests/setup/env.ts, preload
// global). Esta suíte trunca as mesmas tabelas — por isso roda em processo
// separado e nunca em paralelo com `test:int`.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { app } from "@/server/app";
import { reseed } from "@/server/modules/dev/seed";
import {
  createUser,
  prisma,
  resetDb,
  seedRoles,
  type ContaOpts,
} from "../integration/harness";
import { fmtMoney } from "@/lib/format.js";
import { currentMonthKey } from "@/lib/format.js";
import AuthGate from "@/components/AuthGate";
import { FinanceProvider } from "@/store/FinanceContext.jsx";
import App from "@/App.jsx";

export { act, createUser, prisma, resetDb, seedRoles, render, screen, waitFor, within, userEvent };
export type { ContaOpts };

// ── Ponte de fetch ──────────────────────────────────────────────────────────

export type Bridge = {
  /** cookies da "sessão do navegador" (auth_token é httpOnly) */
  jar: Map<string, string>;
  /** requests que passaram pela ponte, na ordem — pra assertar disparos */
  calls: { method: string; path: string; status: number }[];
  restore: () => void;
};

// Set-Cookie precisa ser lido como lista: o Headers do happy-dom e o do Bun
// diferem em getSetCookie(), e juntar tudo num get() quebraria em "Expires=Thu,
// 01 Jan 1970" (a vírgula da data).
function setCookies(headers: Headers): string[] {
  const h = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  const raw = headers.get("set-cookie");
  return raw ? [raw] : [];
}

const EXPIRADO = /max-age=0|expires=thu,\s*01 jan 1970/i;

// Substitui globalThis.fetch por uma ponte pro app Hono, com cookie jar próprio.
// Um jar por chamada: dois renders = duas sessões independentes (usado no
// teste de compartilhamento, onde A compartilha e B enxerga).
export function installFetchBridge(): Bridge {
  const jar = new Map<string, string>();
  const calls: Bridge["calls"] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: any, init?: any) => {
    const url = new URL(
      typeof input === "string" ? input : (input?.url ?? String(input)),
      "http://localhost:3000/"
    );
    const method = (init?.method ?? input?.method ?? "GET").toUpperCase();

    const headers = new Headers(init?.headers ?? input?.headers ?? undefined);
    if (jar.size) {
      headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
    }

    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : ((init?.body ?? (typeof input?.text === "function" ? await input.text() : undefined)) as
            | string
            | undefined);

    const res = await app.request(url.pathname + url.search, { method, headers, body });

    for (const cookie of setCookies(res.headers)) {
      const [kv, ...attrs] = cookie.split(";");
      const i = kv.indexOf("=");
      const nome = kv.slice(0, i).trim();
      // logout manda Max-Age=0 — sem isto a sessão "não sai" no teste
      if (EXPIRADO.test(attrs.join(";"))) jar.delete(nome);
      else jar.set(nome, kv.slice(i + 1));
    }

    calls.push({ method, path: url.pathname + url.search, status: res.status });
    return res;
  }) as typeof fetch;

  return { jar, calls, restore: () => { globalThis.fetch = original; } };
}

// ── Render ──────────────────────────────────────────────────────────────────

const arvore = (
  <AuthGate>
    <FinanceProvider>
      <App />
    </FinanceProvider>
  </AuthGate>
);

// Espera o AuthGate resolver /auth/me.
export async function waitForSessao() {
  await waitFor(() => expectAusente("Verificando sessão…"));
}

// Espera o boot do FinanceProvider (GET /state) terminar.
export async function waitForBoot() {
  await waitForSessao();
  await waitFor(() => expectAusente("Carregando suas finanças…"), { timeout: 5000 });
}

function expectAusente(texto: string) {
  if (screen.queryByText(texto)) throw new Error(`ainda visível: ${texto}`);
}

// Espera algo DESAPARECER. Não use `waitFor(() => expect(x).not.toBe...)`: o
// `expect` do bun:test conta a falha de cada tentativa no resultado do arquivo,
// então uma primeira sondagem negativa (o normal!) derruba a suíte — às vezes
// creditada em OUTRO teste. Para esperar algo APARECER, use `findBy*`.
export async function esperarAusente(query: () => unknown, oque = "elemento") {
  await waitFor(() => {
    if (query()) throw new Error(`${oque} ainda presente`);
  });
}

export const esperarSemDialog = () =>
  esperarAusente(() => screen.queryByRole("dialog"), "dialog");

// Espera a query devolver exatamente `n` elementos. `findAllBy*` resolve no
// primeiro match, então não serve pra "agora tem dois".
export async function esperarQuantidade(query: () => unknown[], n: number, oque = "elementos") {
  await waitFor(() => {
    const achados = query().length;
    if (achados !== n) throw new Error(`esperava ${n} ${oque}, achei ${achados}`);
  });
}

export type RenderOpts = ContaOpts & {
  /** popula a conta com os dados de exemplo do módulo dev */
  seed?: boolean;
  /** não zera o banco (pra montar cenários com 2 contas no mesmo teste) */
  skipReset?: boolean;
  /**
   * Monta o cenário DEPOIS do login e ANTES do render, com `api` já autenticado
   * pela ponte. Preferido ao Prisma direto: passa pelos mesmos DTOs/serviços que
   * a UI usaria, então o cenário nunca fica impossível de produzir pelo app.
   */
  setup?: (ctx: { api: Api; user: Awaited<ReturnType<typeof createUser>> }) => Promise<void>;
};

// Cliente mínimo pra montar cenário / conferir o back de dentro do teste.
export type Api = ReturnType<typeof apiClient>;

function apiClient() {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const texto = await res.text();
    const json = texto ? JSON.parse(texto) : null;
    if (!res.ok) {
      throw new Error(`${method} ${path} → ${res.status}: ${texto}`);
    }
    return json;
  };
  return {
    status: async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`/api${path}`, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return res.status;
    },
    get: (p: string) => call("GET", p),
    post: (p: string, b?: unknown) => call("POST", p, b ?? {}),
    put: (p: string, b?: unknown) => call("PUT", p, b ?? {}),
    patch: (p: string, b?: unknown) => call("PATCH", p, b ?? {}),
    delete: (p: string) => call("DELETE", p),
  };
}

export const api = apiClient();

// Espaço/categorias default são criados sob demanda pelo GET /state (é o boot do
// app). Num `setup` que roda antes do render, /despesas/espacos ainda devolve
// lista vazia e activeEspacoId null — chame isto pra ter o espaço ativo.
export async function espacoAtivo(cliente: Api = api): Promise<string> {
  const { activeEspacoId } = await cliente.get("/state");
  if (!activeEspacoId) throw new Error("/state não devolveu activeEspacoId");
  return activeEspacoId;
}

// Boot completo autenticado: banco limpo, roles padrão, conta criada, login
// pela rota real e app renderizado já com o /state resolvido.
export async function renderApp(opts: RenderOpts = {}) {
  const { seed, skipReset, setup, ...conta } = opts;
  if (!skipReset) {
    await resetDb();
    await seedRoles();
  }
  const user = await createUser(conta);
  if (seed) await reseed(user.id);

  const bridge = installFetchBridge();
  await login(user.email, user.senha);
  if (setup) await setup({ api, user });

  const utils = render(arvore);
  await waitForBoot();
  return { user, bridge, api, user1: userEvent.setup(), ...utils };
}

// Render sem sessão: cai no LoginForm. Banco limpo + roles, sem conta.
export async function renderAnon(opts: { skipReset?: boolean } = {}) {
  if (!opts.skipReset) {
    await resetDb();
    await seedRoles();
  }
  const bridge = installFetchBridge();
  const utils = render(arvore);
  await waitForSessao();
  return { bridge, user1: userEvent.setup(), ...utils };
}

// Login pela rota real, atravessando a ponte (o jar recebe o auth_token).
export async function login(email: string, senha: string) {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, senha }),
  });
  if (!res.ok) throw new Error(`login falhou (${res.status}): ${await res.text()}`);
  return res;
}

// Dados de exemplo do módulo dev pro usuário informado.
export const seedDados = (userId: string) => reseed(userId);

// ── Matchers de texto ───────────────────────────────────────────────────────

// fmtMoney usa NBSP entre "R$" e o número (Intl pt-BR). Comparar com espaço
// comum falha silenciosamente — normalize sempre por aqui.
export const money = (n: number) => fmtMoney(n).replace(/ /g, " ");

// Matcher de texto que normaliza o whitespace do nó antes de comparar.
export const byMoney = (n: number) => {
  const alvo = money(n);
  return (_conteudo: string, node: Element | null) =>
    (node?.textContent ?? "").replace(/\s+/g, " ").trim() === alvo;
};

// Texto exato ignorando NBSP e quebras (útil pra "Faltam R$ X · ...").
export const byTexto = (esperado: string) => (_c: string, node: Element | null) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim() === esperado.replace(/\s+/g, " ").trim();

// ── Campos de formulário ────────────────────────────────────────────────────
// `Field` embrulha o controle num <label> junto com o hint, então o texto do
// label é "Rótulo <hint>" e o `getByLabelText` exato não casa. Além disso o
// MoneyInput/PercentInput ficam dentro de um <div> relativo (pro "R$"), o que
// depende do label.control do happy-dom pra resolver. Buscar pelo prefixo do
// label é mais previsível e não muda quando um hint é adicionado.
//
// `FieldGroup` (grupos de botões: presets, cores, chips) usa <fieldset>/<legend>
// em vez de <label> — um <button> dentro de <label> herdaria o texto inteiro
// como nome acessível. Aqui os dois casam pelo mesmo prefixo.
export function campo(escopo: HTMLElement, rotulo: string): HTMLElement {
  const grupos = [...escopo.querySelectorAll("label, fieldset")];
  const grupo = grupos.find((el) => {
    const texto =
      el.tagName === "FIELDSET" ? (el.querySelector("legend")?.textContent ?? "") : (el.textContent ?? "");
    return texto.trim().startsWith(rotulo);
  });
  const controle = grupo?.querySelector<HTMLElement>("input, select, textarea");
  if (!controle) throw new Error(`campo "${rotulo}" não encontrado`);
  return controle;
}

// Digita numa máscara de dinheiro/percentual: são dígitos crus divididos por
// 100 ("25000" → 250,00). `clear` antes porque o value exibido é formatado.
export async function digitarMoney(
  u: ReturnType<typeof userEvent.setup>,
  input: HTMLElement,
  digitos: string
) {
  await u.clear(input);
  await u.type(input, digitos);
}

// Digita num <input type="number"> controlado. `userEvent.clear` não serve:
// o happy-dom não implementa seleção de texto, então clear deixa resíduo (um
// "6" virava "39" ao digitar "9"). Já `{backspace}` zera o campo inteiro —
// quirk do happy-dom, mas determinístico. Backspaces extras são no-op.
export async function digitarNumero(
  u: ReturnType<typeof userEvent.setup>,
  input: HTMLElement,
  valor: string | number
) {
  await u.click(input);
  await u.type(input, `{backspace}{backspace}{backspace}${valor}`);
}

// ── Navegação e modais ──────────────────────────────────────────────────────

const LABEL_NAV: Record<string, string> = {
  dashboard: "Início",
  fixas: "Despesas",
  cartoes: "Cartões",
  admin: "Admin",
};

// Clica no item de nav pelo label (a nav é renderizada duas vezes — sidebar
// desktop e barra mobile; qualquer uma serve, o handler é o mesmo).
export async function goTo(view: keyof typeof LABEL_NAV | string, u = userEvent.setup()) {
  const label = LABEL_NAV[view] ?? view;
  const [botao] = screen.getAllByRole("button", { name: new RegExp(`^${label}$`) });
  await u.click(botao);
  return botao;
}

// Abre um modal pelo nome do gatilho e devolve o `within` do dialog (que vive
// num portal, fora do container do render).
export async function openModal(gatilho: string | RegExp, u = userEvent.setup()) {
  const nome = typeof gatilho === "string" ? new RegExp(gatilho, "i") : gatilho;
  await u.click(screen.getByRole("button", { name: nome }));
  const dialog = await screen.findByRole("dialog");
  return { dialog, ui: within(dialog) };
}

export const dialogAberto = () => screen.queryByRole("dialog");

// ── Mês ─────────────────────────────────────────────────────────────────────
// Mesma regra da suíte de back: nada de "2026-03" fixo — o mês corrente é lido
// do relógio pelo app inteiro e viraria falha na virada do mês.

export const mesAtual = () => currentMonthKey();

export function addMeses(n: number, ym: string = mesAtual()) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const diaDoMes = (dia = 15, ym: string = mesAtual()) =>
  `${ym}-${String(dia).padStart(2, "0")}`;
