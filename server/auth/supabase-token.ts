import { sign } from "hono/jwt";
import { prisma } from "@/server/lib/prisma";
import { authService, type AuthUser } from "./auth.service";

// Token de LEITURA DIRETA no Supabase (PostgREST + RLS).
//
// O login continua sendo do app (cookie httpOnly `auth_token`, scrypt, roles no
// banco). Este é um segundo JWT, curto, assinado com o JWT secret do PROJETO
// Supabase — é o que o PostgREST aceita e o que faz `auth.uid()` devolver o id
// do usuário nas policies (`prisma/manual/20261028-rls-leitura-direta.sql`).
//
// Ele só abre LEITURA das linhas do próprio dono: as policies são todas de
// SELECT e não existe nenhuma de escrita. Escrita segue nas Server Actions.
//
// Autorização: RLS garante posse, não permission. Por isso o token só sai pra
// quem tem `state:view` (é a mesma porta do boot) — sem ela, o navegador segue
// lendo pelas actions, que checam permission por leitura.
export const SUPABASE_TOKEN_TTL_S = 60 * 60; // 1h; o cliente renova antes de vencer

export type TokenLeitura = { token: string; exp: number };

// Liga só com as três variáveis presentes. Sem elas (dev com Postgres local,
// testes, CI) o front lê pelas actions como sempre — a troca é por ambiente.
export function leituraDiretaConfigurada() {
  return Boolean(
    process.env.SUPABASE_JWT_SECRET &&
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// Trava: o token só existe se o banco JÁ tem o RLS da migração. Com as env
// setadas e a migração esquecida, um token `authenticated` leria as tabelas
// de TODOS os usuários (as consultas do navegador não filtram por dono — quem
// filtra é a policy), inclusive `users.senha_hash`. Então: qualquer tabela do
// schema public sem RLS, ou a RPC ausente → sem token → front segue pelas
// actions. Confirmado uma vez, fica em memória; falha é reconferida a cada
// minuto (dá pra aplicar a migração sem redeploy).
let rls: { ok: boolean; em: number } | null = null;

async function rlsAplicado(): Promise<boolean> {
  if (rls && (rls.ok || Date.now() - rls.em < 60_000)) return rls.ok;
  try {
    const [r] = await prisma.$queryRaw<{ sem_rls: bigint; rpc: boolean }[]>`
      select
        (select count(*) from pg_tables where schemaname = 'public' and not rowsecurity) as sem_rls,
        to_regprocedure('public.meses_com_lancamento(uuid)') is not null as rpc`;
    rls = { ok: Number(r.sem_rls) === 0 && r.rpc, em: Date.now() };
    if (!rls.ok) console.warn("[leitura direta] desligada: RLS/RPC da migração 20261028 não encontrados no banco");
  } catch {
    rls = { ok: false, em: Date.now() };
  }
  return rls.ok;
}

export async function tokenDeLeitura(user: AuthUser | null): Promise<TokenLeitura | null> {
  if (!user || !leituraDiretaConfigurada()) return null;
  if (!(await rlsAplicado())) return null;
  if (!(await authService.can(user, "state:view"))) return null;
  const now = Math.floor(Date.now() / 1000);
  const exp = now + SUPABASE_TOKEN_TTL_S;
  const token = await sign(
    { sub: user.id, role: "authenticated", aud: "authenticated", iat: now, exp },
    process.env.SUPABASE_JWT_SECRET as string
  );
  return { token, exp };
}
