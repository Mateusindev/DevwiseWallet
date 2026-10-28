// Paridade da leitura direta: a MESMA conta lida pelo servidor (services +
// Prisma) e direto do PostgREST (`services/leituraDireta.ts` + RLS) tem que dar
// o MESMO payload, byte a byte — e um token de outra conta não pode ver nada.
//
// Rodar depois de mexer em `*.view.ts`, em `leituraDireta.ts` ou nas policies.
// Precisa de um PostgREST local na frente do banco (nunca aponte pro Supabase):
//
//   # banco local com a conta de teste, shim do Supabase e RLS
//   export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cofre_preview DIRECT_URL=$DATABASE_URL
//   bunx prisma db push --skip-generate && bun run seed:test
//   bunx prisma db execute --file tests/setup/supabase-shim.sql --schema prisma/schema.prisma
//   bunx prisma db execute --file prisma/manual/20261028-rls-leitura-direta.sql --schema prisma/schema.prisma
//   # PostgREST (porta 3201) + o prefixo /rest/v1 que o supabase-js espera
//   docker run -d --name wallet-postgrest --add-host=host.docker.internal:host-gateway -p 3201:3000 \
//     -e PGRST_DB_URI=postgres://authenticator:authenticator@host.docker.internal:5432/cofre_preview \
//     -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=$SUPABASE_JWT_SECRET \
//     postgrest/postgrest:v12.2.3
//   NEXT_PUBLIC_SUPABASE_URL=http://localhost:3202 ... (um proxy /rest/v1 → :3201)
//   bun scripts/paridade-leitura-direta.ts
(globalThis as { window?: unknown }).window = globalThis; // lib/supabase só adota token no navegador
import { prisma } from "../server/lib/prisma";
import { authService } from "../server/auth/auth.service";
import { tokenDeLeitura } from "../server/auth/supabase-token";
import { adotarTokenInicial, esquecerToken } from "../lib/supabase";
import * as direto from "../services/leituraDireta";
import { getState } from "../server/modules/bootstrap/bootstrap.service";
import { espacoService } from "../server/modules/espaco/espaco.service";
import { cartaoService } from "../server/modules/cartao/cartao.service";
import { addMonths, currentMonth } from "../server/lib/serialize";

let falhas = 0;
function igual(nome: string, a: unknown, b: unknown) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja === jb) { console.log("  ok  ", nome); return; }
  falhas++;
  console.log("  DIFF", nome);
  console.log("    servidor:", ja.slice(0, 600));
  console.log("    direto:  ", jb.slice(0, 600));
}

const user = await prisma.user.findUniqueOrThrow({ where: { email: "teste@wallet.local" } });
const sess = await authService.getSessionUser(user.id);
const tok = await tokenDeLeitura(sess);
if (!tok) throw new Error("token null — env da leitura direta faltando?");
adotarTokenInicial(tok);

const ym = currentMonth();
for (const m of [ym, addMonths(ym, -3)]) {
  console.log(`\nmês ${m}`);
  igual("getState", await getState(user.id, m), await direto.getBootstrapDireto(m));
  for (const e of await prisma.espaco.findMany({ where: { userId: user.id } })) {
    igual(`orcamento ${e.nome}`, await espacoService.getOrcamento(user.id, e.id, m), await direto.getOrcamentoDireto(e.id, m));
  }
  igual("cartoes", await cartaoService.listWithAggregates(user.id, m), await direto.getCartoesDireto(m));
  igual("resumoCartoes", await cartaoService.resumoPorMes(user.id, addMonths(m, -5), m), await direto.getResumoCartoesDireto(undefined, m));
  igual("parceladas", await cartaoService.parceladasEmAberto(user.id, m), await direto.getParceladasDireto(m));
  igual("resumoEspacos", await espacoService.resumoPorEspaco(user.id, m), await direto.getResumoEspacosDireto(m));
  for (const c of await prisma.cartao.findMany({ where: { userId: user.id } })) {
    igual(`faturaLinhas ${c.nome}`, await cartaoService.faturaLinhas(user.id, c.id, m), await direto.getFaturaLinhasDireto(c.id, m));
  }
}

// ── Isolamento: token de OUTRO usuário não enxerga nada da conta de teste ──
console.log("\nisolamento");
esquecerToken();
const intruso = await prisma.user.upsert({
  where: { email: "intruso@wallet.local" },
  create: { email: "intruso@wallet.local", nome: "Intruso", senhaHash: "x" },
  update: {},
});
const papel = await prisma.role.findFirst({ where: { nome: "membro" } });
if (papel) await prisma.userRole.upsert({ where: { userId_roleId: { userId: intruso.id, roleId: papel.id } }, create: { userId: intruso.id, roleId: papel.id }, update: {} });
const tokIntruso = await tokenDeLeitura(await authService.getSessionUser(intruso.id));
const espacoAlvo = await prisma.espaco.findFirstOrThrow({ where: { userId: user.id } });
const cartaoAlvo = await prisma.cartao.findFirstOrThrow({ where: { userId: user.id } });
const base = process.env.NEXT_PUBLIC_SUPABASE_URL + "/rest/v1";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;
const h = { apikey: ANON, Authorization: `Bearer ${tokIntruso!.token}` };
for (const t of ["caixinhas", "movimentacoes", "cartoes", "categorias", "espacos", "despesas_fixas", "despesas_mes", "receitas_mes", "pagamentos_fixas", "cartao_shares", "contatos", "app_settings", "users", "roles", "user_roles", "convites", "share_adocoes", "share_adiantamentos"]) {
  const r = await fetch(`${base}/${t}?select=*`, { headers: h });
  const body = await r.json();
  const vazamento = Array.isArray(body) && body.some((x: Record<string, unknown>) => x.user_id === user.id || x.owner_id === user.id || x.id === user.id);
  const n = Array.isArray(body) ? body.length : `HTTP ${r.status}`;
  console.log(vazamento ? "  VAZOU" : "  ok  ", t, "→", n);
  if (vazamento) falhas++;
}
const r1 = await fetch(`${base}/espacos?id=eq.${espacoAlvo.id}&select=*`, { headers: h });
console.log("  espaço alheio por id →", await r1.text());
const r2 = await fetch(`${base}/rpc/meses_com_lancamento`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ p_espaco: espacoAlvo.id }) });
console.log("  rpc meses do espaço alheio →", await r2.text());
const r3 = await fetch(`${base}/cartoes?id=eq.${cartaoAlvo.id}`, { method: "PATCH", headers: { ...h, "content-type": "application/json", Prefer: "return=representation" }, body: JSON.stringify({ nome: "hack" }) });
console.log("  PATCH cartão alheio →", r3.status, await r3.text());
const r4 = await fetch(`${base}/caixinhas`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ user_id: intruso.id, nome: "x" }) });
console.log("  INSERT na própria conta →", r4.status, (await r4.text()).slice(0, 120));
const r5 = await fetch(`${base}/users?select=email,senha_hash`, { headers: { apikey: ANON } });
console.log("  anon lendo users →", r5.status, (await r5.text()).slice(0, 120));

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo igual, nada vazou");
await prisma.$disconnect();
process.exit(falhas ? 1 : 0);
