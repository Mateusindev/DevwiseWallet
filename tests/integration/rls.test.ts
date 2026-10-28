// RLS da leitura direta (`prisma/manual/20261028-rls-leitura-direta.sql`).
//
// O navegador lê o Supabase com um token cujo `sub` é o id do usuário; quem
// garante que ele só vê o que é dele são estas policies — não há servidor no
// meio. Aqui o banco de teste ganha o mínimo do Supabase
// (`tests/setup/supabase-shim.sql`: roles da API + auth.uid()), a migração é
// aplicada de verdade, e cada consulta roda como o PostgREST rodaria: role
// `authenticated` (ou `anon`) com as claims do JWT na transação.
import { describe, expect, it, beforeAll } from "bun:test";
import { resetDb, seedRoles, createUser, prisma } from "./harness";

function executa(arquivo: string) {
  const r = Bun.spawnSync(["bunx", "prisma", "db", "execute", "--file", arquivo, "--schema", "prisma/schema.prisma"], {
    env: process.env,
    stderr: "pipe",
  });
  if (r.exitCode !== 0) throw new Error(`falhou ${arquivo}: ${r.stderr.toString()}`);
}

// Roda `sql` como o PostgREST rodaria pra esse token (ou sem token = anon).
async function como<T = Record<string, unknown>[]>(sub: string | null, sql: string): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`set local role ${sub ? "authenticated" : "anon"}`);
    if (sub) {
      await tx.$executeRawUnsafe(
        `select set_config('request.jwt.claims', $1, true)`,
        JSON.stringify({ sub, role: "authenticated" })
      );
    }
    return (await tx.$queryRawUnsafe(sql)) as T;
  });
}

// Erro de permissão do Postgres (42501) — é o que o PostgREST devolve como 401/403.
async function negado(sub: string | null, sql: string) {
  await expect(como(sub, sql)).rejects.toThrow(/permission denied|42501|row-level security/i);
}

type Conta = { userId: string; espacoId: string; cartaoId: string; caixinhaId: string; contatoId: string };

async function contaComDados(): Promise<Conta> {
  const u = await createUser({ roles: ["membro"] });
  const esp = await prisma.espaco.create({ data: { userId: u.id, nome: "Casa" } });
  await prisma.appSettings.create({ data: { userId: u.id, activeEspacoId: esp.id } });
  const cartao = await prisma.cartao.create({ data: { userId: u.id, nome: "Cartão" } });
  const cat = await prisma.categoria.create({ data: { userId: u.id, nome: "Moradia" } });
  const cx = await prisma.caixinha.create({ data: { userId: u.id, nome: "Reserva" } });
  await prisma.movimentacao.create({ data: { caixinhaId: cx.id, tipo: "aporte", valor: 10, data: new Date("2026-10-01") } });
  const fixa = await prisma.despesaFixa.create({
    data: { espacoId: esp.id, descricao: "Aluguel", valor: 1000, cartaoId: cartao.id, categoriaId: cat.id },
  });
  await prisma.pagamentoFixa.create({ data: { espacoId: esp.id, despesaFixaId: fixa.id, ym: "2026-10", valorPago: 1000 } });
  await prisma.despesaMes.create({
    data: { espacoId: esp.id, mes: "2026-10", descricao: "Mercado", valor: 200, data: new Date("2026-10-05"), cartaoId: cartao.id },
  });
  const rec = await prisma.receitaMes.create({
    data: { espacoId: esp.id, mes: "2026-10", descricao: "Freela", valor: 300, data: new Date("2026-10-10"), recorrente: true },
  });
  await prisma.receitaMesSkip.create({ data: { receitaId: rec.id, ym: "2026-11" } });
  await prisma.rendaMensal.create({ data: { espacoId: esp.id, ym: "2026-10", valor: 5000 } });
  await prisma.espacoMesOculto.create({ data: { espacoId: esp.id, ym: "2026-12" } });
  const contato = await prisma.contato.create({ data: { ownerId: u.id, nome: "Maria" } });
  await prisma.cartaoShare.create({
    data: { contatoId: contato.id, tipo: "linha", despesaFixaId: fixa.id, percentual: 50 },
  });
  return { userId: u.id, espacoId: esp.id, cartaoId: cartao.id, caixinhaId: cx.id, contatoId: contato.id };
}

// Tabelas que o navegador lê, e a coluna que leva até o dono.
const LIDAS = [
  "caixinhas",
  "movimentacoes",
  "cartoes",
  "categorias",
  "espacos",
  "espaco_mes_oculto",
  "app_settings",
  "contatos",
  "despesas_fixas",
  "pagamentos_fixas",
  "despesas_mes",
  "receitas_mes",
  "receita_mes_skip",
  "rendas_mensais",
  "cartao_shares",
];

let a: Conta;
let b: Conta;

beforeAll(async () => {
  executa("tests/setup/supabase-shim.sql");
  executa("prisma/manual/20261028-rls-leitura-direta.sql");
  executa("prisma/manual/20261028-rls-leitura-direta.sql"); // idempotente
  await resetDb();
  await seedRoles();
  a = await contaComDados();
  b = await contaComDados();
});

describe("RLS — leitura direta", () => {
  it("o dono lê as próprias linhas de toda tabela liberada", async () => {
    for (const t of LIDAS) {
      const [{ n }] = await como<{ n: bigint }[]>(a.userId, `select count(*) as n from public.${t}`);
      expect({ t, n: Number(n) }).toEqual({ t, n: 1 });
    }
  });

  it("nenhuma linha de outro dono aparece, nem pedindo pelo id", async () => {
    const espacos = await como(a.userId, `select id from public.espacos`);
    expect(espacos.map((e) => e.id)).toEqual([a.espacoId]);
    expect(await como<unknown[]>(a.userId, `select id from public.espacos where id = '${b.espacoId}'`)).toEqual([]);
    expect(await como<unknown[]>(a.userId, `select id from public.cartoes where id = '${b.cartaoId}'`)).toEqual([]);
    expect(await como<unknown[]>(a.userId, `select id from public.movimentacoes where caixinha_id = '${b.caixinhaId}'`)).toEqual([]);
    expect(await como<unknown[]>(a.userId, `select id from public.cartao_shares where contato_id = '${b.contatoId}'`)).toEqual([]);
  });

  it("tabelas só do servidor ficam fechadas até pro dono", async () => {
    for (const t of ["users", "roles", "user_roles", "convites", "share_adocoes", "share_adiantamentos"]) {
      await negado(a.userId, `select * from public.${t}`);
    }
  });

  it("anon (sem token) não lê nada — inclusive users.senha_hash", async () => {
    for (const t of [...LIDAS, "users"]) await negado(null, `select * from public.${t}`);
  });

  it("nenhuma escrita passa pela API, nem na própria conta", async () => {
    await negado(a.userId, `update public.cartoes set nome = 'x' where id = '${a.cartaoId}'`);
    await negado(a.userId, `delete from public.despesas_fixas`);
    await negado(a.userId, `insert into public.caixinhas (id, user_id, nome) values (gen_random_uuid(), '${a.userId}', 'x')`);
  });

  it("meses_com_lancamento respeita o RLS de quem chama", async () => {
    const [{ r: meu }] = await como<{ r: unknown }[]>(a.userId, `select public.meses_com_lancamento('${a.espacoId}') as r`);
    expect(meu).toEqual({ mesesComDespesa: ["2026-10"], mesesComFatura: ["2026-10"] });
    const [{ r: alheio }] = await como<{ r: unknown }[]>(a.userId, `select public.meses_com_lancamento('${b.espacoId}') as r`);
    expect(alheio).toEqual({ mesesComDespesa: [], mesesComFatura: [] });
    await negado(null, `select public.meses_com_lancamento('${a.espacoId}')`);
  });

  it("o servidor (dono das tabelas, sem role da API) segue enxergando tudo", async () => {
    expect(await prisma.espaco.count()).toBe(2);
    expect(await prisma.user.count()).toBe(2);
  });
});
