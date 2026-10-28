// Cliente do Supabase pro NAVEGADOR, só pra leitura direta (PostgREST + RLS).
//
// Não usa o Auth do Supabase: quem loga é o app. O token vem do servidor
// (`server/auth/supabase-token.ts`) — o primeiro junto do boot servido, os
// seguintes pela action `tokenLeituraDireta` quando o atual está pra vencer.
// `accessToken` faz o supabase-js mandar esse token em toda requisição (e
// desliga o módulo de auth dele, que aqui não existe).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { tokenLeituraDireta } from "@/server/auth/auth.actions";
import type { TokenLeitura } from "@/server/auth/supabase-token";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Renova com folga: um token que vence no meio de uma leitura viraria 401.
const FOLGA_S = 120;

let atual: TokenLeitura | null = null;
// `false` = o servidor disse que este usuário/ambiente não lê direto (sem env,
// sem `state:view`): não pergunta de novo a cada leitura.
let disponivel: boolean | null = null;
let renovando: Promise<TokenLeitura | null> | null = null;

const valido = (t: TokenLeitura | null) => !!t && t.exp - FOLGA_S > Date.now() / 1000;

// Boot servido: o layout já emitiu o primeiro token junto da sessão.
//
// Uma vez por carga de página, e só no navegador: o Boot re-renderiza com a
// MESMA Promise do primeiro request — depois de um logout/login com outra
// conta, readotar aquele token leria os dados da conta anterior. No SSR o
// módulo é compartilhado entre requests, então token nenhum fica guardado lá.
let inicialAdotado = false;
export function adotarTokenInicial(t: TokenLeitura | null) {
  if (typeof window === "undefined" || inicialAdotado) return;
  inicialAdotado = true;
  atual = t;
  disponivel = t ? true : null; // null: sem token no boot ainda pode ser login depois
}

// Logout / troca de conta: o token é do usuário anterior.
export function esquecerToken() {
  atual = null;
  disponivel = null;
  renovando = null;
}

async function renova(): Promise<TokenLeitura | null> {
  if (!renovando) {
    renovando = tokenLeituraDireta()
      .then((r) => (r.ok ? r.data : null))
      .catch(() => null)
      .then((t) => {
        atual = t;
        disponivel = !!t;
        renovando = null;
        return t;
      });
  }
  return renovando;
}

async function token(): Promise<string | null> {
  if (valido(atual)) return atual!.token;
  return (await renova())?.token ?? null;
}

// Criado na primeira leitura, não no import: o supabase-js chama `accessToken`
// já na construção (pro realtime), e no import isso acontecia antes do boot
// adotar o token inicial — virava uma action extra em toda carga de página.
let cliente: SupabaseClient | null = null;
function oCliente(): SupabaseClient | null {
  if (!URL || !ANON_KEY) return null;
  cliente ??= createClient(URL, ANON_KEY, {
    accessToken: async () => (await token()) ?? ANON_KEY,
    db: { schema: "public" },
  });
  return cliente;
}

// O cliente pronto pra ler, ou null quando a leitura direta não vale aqui —
// quem chama cai pras Server Actions.
export async function supabaseParaLeitura(): Promise<SupabaseClient | null> {
  if (!URL || !ANON_KEY || disponivel === false) return null;
  if (!valido(atual) && !(await renova())) return null;
  return oCliente();
}

// Dono do token atual (`sub`). O refresh do boot devolve `userId` no payload
// (o FinanceProvider confere se o estado é da sessão atual) e quem lê direto
// não passa pelo servidor pra saber.
export function usuarioDoToken(): string | null {
  if (!atual) return null;
  try {
    const payload = atual.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return (JSON.parse(atob(payload)) as { sub?: string }).sub ?? null;
  } catch {
    return null;
  }
}
