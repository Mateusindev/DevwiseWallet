/* eslint-disable @typescript-eslint/no-explicit-any -- corpo de resposta é JSON
   dinâmico; tipar como unknown obrigaria cast em cada asserção dos testes. */
// Harness dos testes de integração: banco real + app Hono real.
//
// Nada é mockado aqui — as requests passam por onError, requireAuth,
// requirePermission, zValidator, services, repositories e Prisma de verdade.
// Ver tests/setup/env.ts (aponta o Prisma pro banco de teste).
import { app } from "@/server/app";
import { prisma } from "@/server/lib/prisma";
import { hashPassword } from "@/server/auth/password";
import { seedDefaultRoles } from "@/server/auth/default-roles";

// ── Requests ────────────────────────────────────────────────────────────────

export type Res<T = any> = {
  status: number;
  body: T;
  headers: Headers;
};

// Caminho sem "/api" é prefixado (o app tem basePath("/api")).
const full = (path: string) => (path.startsWith("/api") ? path : `/api${path}`);

async function request<T = any>(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string
): Promise<Res<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (cookie) headers.cookie = cookie;

  const res = await app.request(full(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed as T, headers: res.headers };
}

// Client HTTP amarrado (ou não) a uma sessão.
export function client(cookie?: string) {
  return {
    cookie,
    get: <T = any>(p: string) => request<T>("GET", p, undefined, cookie),
    post: <T = any>(p: string, b?: unknown) => request<T>("POST", p, b ?? {}, cookie),
    put: <T = any>(p: string, b?: unknown) => request<T>("PUT", p, b ?? {}, cookie),
    patch: <T = any>(p: string, b?: unknown) => request<T>("PATCH", p, b ?? {}, cookie),
    delete: <T = any>(p: string) => request<T>("DELETE", p, undefined, cookie),
  };
}

export type Client = ReturnType<typeof client>;

// Client sem sessão (pra checar 401 e rotas públicas).
export const anon = client();

// ── Banco ───────────────────────────────────────────────────────────────────

// Toda tabela do schema. TRUNCATE ... CASCADE já cobriria via FK, mas a lista
// explícita evita surpresa quando um model novo entrar sem relação.
const TABELAS = [
  "user_roles",
  "cartao_shares",
  "contatos",
  "movimentacoes",
  "pagamentos_fixas",
  "despesas_fixas",
  "despesas_mes",
  "receitas_mes",
  "rendas_mensais",
  "espaco_mes_oculto",
  "app_settings",
  "caixinhas",
  "cartoes",
  "categorias",
  "espacos",
  "roles",
  "users",
];

let checado = false;

// Zera o banco de teste. Chamar no beforeEach de cada suíte.
export async function resetDb() {
  try {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${TABELAS.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`
    );
    checado = true;
  } catch (err) {
    if (checado) throw err;
    throw new Error(
      "Banco de teste indisponível. Suba o Postgres e rode `bun run test:db:setup`.\n" +
        `DATABASE_URL=${process.env.DATABASE_URL}\n` +
        `causa: ${(err as Error).message}`
    );
  }
}

// Roles padrão do produto (admin / membro / leitor).
export async function seedRoles() {
  return seedDefaultRoles(prisma);
}

// ── Contas ──────────────────────────────────────────────────────────────────

export type ContaOpts = {
  email?: string;
  nome?: string;
  senha?: string;
  /** roles por nome (precisam existir — use seedRoles antes) */
  roles?: string[];
  /** cria uma role ad-hoc com exatamente essas permissions */
  permissions?: string[];
  ativo?: boolean;
};

let seq = 0;

// Cria usuário direto no banco (sem passar pelas rotas).
export async function createUser(opts: ContaOpts = {}) {
  seq += 1;
  const email = (opts.email ?? `user${seq}-${Date.now()}@teste.local`).toLowerCase();
  const senha = opts.senha ?? "senha123";
  const nomesRoles = [...(opts.roles ?? [])];

  if (opts.permissions) {
    const nome = `role-adhoc-${seq}`;
    await prisma.role.create({ data: { nome, permissions: opts.permissions } });
    nomesRoles.push(nome);
  }

  const roles = nomesRoles.length
    ? await prisma.role.findMany({ where: { nome: { in: nomesRoles } } })
    : [];
  if (roles.length !== nomesRoles.length) {
    throw new Error(`role inexistente em [${nomesRoles.join(", ")}] — rode seedRoles() antes`);
  }

  const user = await prisma.user.create({
    data: {
      email,
      nome: opts.nome ?? `Teste ${seq}`,
      senhaHash: hashPassword(senha),
      ativo: opts.ativo ?? true,
      roles: { create: roles.map((r) => ({ roleId: r.id })) },
    },
    select: { id: true, email: true, nome: true, ativo: true },
  });

  return { ...user, senha };
}

// Faz login pela rota real e devolve o cookie de sessão.
export async function login(email: string, senha: string): Promise<string> {
  const res = await request("POST", "/auth/login", { email, senha });
  if (res.status !== 200) {
    throw new Error(`login falhou (${res.status}): ${JSON.stringify(res.body)}`);
  }
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("login não devolveu set-cookie");
  return setCookie.split(";")[0]; // "auth_token=<jwt>"
}

// Cria a conta e já devolve um client logado.
export async function account(opts: ContaOpts = {}) {
  const user = await createUser(opts);
  const cookie = await login(user.email, user.senha);
  return { user, api: client(cookie), cookie };
}

// Atalho: conta com acesso total ("*").
export const contaAdmin = (opts: ContaOpts = {}) => account({ permissions: ["*"], ...opts });

export { prisma };
