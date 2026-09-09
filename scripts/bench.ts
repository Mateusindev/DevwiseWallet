// Baseline de performance (Fase 0.6 do PLANO-SERVER-FUNCTIONS).
//
// Mede o custo REAL de cada cenário do app contra o banco: quantas requests o
// front dispara, quantas queries o servidor faz e quantos ms/bytes cada uma
// custa. Roda o app Hono de verdade via `app.request()` — nada mockado —, então
// serve pra comparar antes/depois de qualquer fase sem subir servidor.
//
//   bun run bench            (usa BENCH_DATABASE_URL ou o banco de teste)
//
// O banco é truncado: o nome precisa conter "test" ou "bench".
process.env.PRISMA_QUERY_LOG = "1";

const url =
  process.env.BENCH_DATABASE_URL ??
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/cofre_test";
if (!/(test|bench)/i.test(new URL(url).pathname)) {
  throw new Error(`BENCH_DATABASE_URL precisa apontar pra um banco de teste (recebido: ${url})`);
}
process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
process.env.AUTH_SECRET ??= "bench-secret";

const { app } = await import("@/server/app");
const { prisma } = await import("@/server/lib/prisma");
const { hashPassword } = await import("@/server/auth/password");
const { seedDefaultRoles } = await import("@/server/auth/default-roles");
const { addMonths, currentMonth } = await import("@/server/lib/serialize");

// ── Instrumentação ──────────────────────────────────────────────────────────

let queries = 0;
(prisma as unknown as { $on: (e: string, cb: () => void) => void }).$on("query", () => {
  queries += 1;
});

let cookie = "";
let requests = 0;
let bytes = 0;

async function req(method: string, path: string, body?: unknown) {
  requests += 1;
  const res = await app.request(`/api${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  bytes += text.length;
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

type Medida = { cenario: string; requests: number; queries: number; ms: number; kb: number };
const medidas: Medida[] = [];

async function cenario(nome: string, fn: () => Promise<void>) {
  requests = 0;
  queries = 0;
  bytes = 0;
  const t0 = performance.now();
  await fn();
  const ms = performance.now() - t0;
  medidas.push({
    cenario: nome,
    requests,
    queries,
    ms: Math.round(ms),
    kb: Math.round(bytes / 102.4) / 10,
  });
}

// ── Dataset ─────────────────────────────────────────────────────────────────
// Perfil "usuário de dois anos": 3 espaços, 4 cartões, 24 meses de histórico.

const MESES = 24;
const ESPACOS = 3;
const CARTOES = 4;
const FIXAS_POR_ESPACO = 20;
const AVULSAS_POR_MES = 25;

const TABELAS = [
  "user_roles", "cartao_shares", "contatos", "movimentacoes", "pagamentos_fixas",
  "despesas_fixas", "despesas_mes", "receitas_mes", "rendas_mensais",
  "espaco_mes_oculto", "app_settings", "caixinhas", "cartoes", "categorias",
  "espacos", "roles", "users",
];

const hoje = currentMonth();
const meses = Array.from({ length: MESES }, (_, i) => addMonths(hoje, i - (MESES - 1)));

async function seed() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABELAS.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`
  );
  await seedDefaultRoles(prisma);
  const role = await prisma.role.findUniqueOrThrow({ where: { nome: "membro" } });
  const user = await prisma.user.create({
    data: {
      email: "bench@teste.local",
      nome: "Bench",
      senhaHash: hashPassword("senha123"),
      roles: { create: [{ roleId: role.id }] },
    },
  });

  const categorias = await Promise.all(
    ["Casa", "Mercado", "Transporte", "Lazer", "Saúde"].map((nome, i) =>
      prisma.categoria.create({ data: { userId: user.id, nome, cor: "violet", ordem: i } })
    )
  );
  const cartoes = await Promise.all(
    Array.from({ length: CARTOES }, (_, i) =>
      prisma.cartao.create({
        data: { userId: user.id, nome: `Cartão ${i + 1}`, limite: 8000, diaVencimento: 10, cor: "violet", ordem: i },
      })
    )
  );
  const espacos = await Promise.all(
    Array.from({ length: ESPACOS }, (_, i) =>
      prisma.espaco.create({
        data: { userId: user.id, nome: `Espaço ${i + 1}`, tipo: "outro", emoji: "📁", rendaMensal: 9000, moeda: "BRL" },
      })
    )
  );
  await prisma.appSettings.create({ data: { userId: user.id, activeEspacoId: espacos[0].id } });

  for (const esp of espacos) {
    await prisma.despesaFixa.createMany({
      data: Array.from({ length: FIXAS_POR_ESPACO }, (_, i) => ({
        espacoId: esp.id,
        descricao: `Fixa ${i + 1}`,
        valor: 50 + i * 7,
        diaVencimento: (i % 28) + 1,
        ativa: true,
        categoriaId: categorias[i % categorias.length].id,
        cartaoId: i % 2 === 0 ? cartoes[i % CARTOES].id : null,
        parcelado: i % 5 === 0,
        parcelaAtual: i % 5 === 0 ? 2 : null,
        totalParcelas: i % 5 === 0 ? 12 : null,
        parcelaMesRef: i % 5 === 0 ? hoje : null,
      })),
    });
    await prisma.despesaMes.createMany({
      data: meses.flatMap((mes) =>
        Array.from({ length: AVULSAS_POR_MES }, (_, i) => ({
          espacoId: esp.id,
          mes,
          descricao: `Compra ${i + 1}`,
          valor: 20 + i,
          data: new Date(`${mes}-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`),
          paga: i % 3 === 0,
          valorPago: i % 3 === 0 ? 20 + i : 0,
          categoriaId: categorias[i % categorias.length].id,
          cartaoId: i % 2 === 0 ? cartoes[i % CARTOES].id : null,
        }))
      ),
    });
    await prisma.rendaMensal.createMany({
      data: meses.map((ym) => ({ espacoId: esp.id, ym, valor: 9000 })),
    });
  }

  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "bench@teste.local", senha: "senha123" }),
  });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  return { user, espacos, cartoes };
}

// ── Cenários ────────────────────────────────────────────────────────────────

const { espacos } = await seed();
const espacoIds = espacos.map((e) => e.id);
const mesAnterior = addMonths(hoje, -1);

// aquece o pool/o plano de query — a primeira request paga o connect
await req("GET", "/state");

await cenario("boot (AuthGate.me + FinanceProvider.getBootstrap)", async () => {
  await req("GET", "/auth/me");
  await req("GET", "/state");
});

await cenario("troca de mês no Início (reloadCartoes + gráfico por espaço)", async () => {
  await req("GET", `/cartoes?ym=${mesAnterior}`);
  // gráfico por espaço: uma request agregada (antes, um getOrcamento por espaço)
  await req("GET", `/despesas/resumo?ym=${mesAnterior}`);
});

await cenario("trocar de espaço em Despesas", async () => {
  await req("PUT", "/despesas/espacos/active", { id: espacoIds[1] });
  await req("GET", `/despesas/espacos/${espacoIds[1]}`);
});

const fixaId = (await prisma.despesaFixa.findFirstOrThrow({ where: { espacoId: espacoIds[0] } })).id;
await cenario("marcar uma fixa como paga", async () => {
  await req("PUT", `/despesas/espacos/${espacoIds[0]}/fixas/${fixaId}/pago/${hoje}`, { valorPago: 120 });
  await req("GET", "/cartoes");
});

await cenario("adicionar uma despesa do mês", async () => {
  await req("POST", `/despesas/espacos/${espacoIds[0]}/mes`, {
    mes: hoje,
    descricao: "Bench",
    valor: 42,
  });
  await req("GET", "/cartoes");
});

await cenario("importar um OFX de 60 transações", async () => {
  await req("POST", `/despesas/espacos/${espacoIds[0]}/mes/import`, {
    mes: hoje,
    itens: Array.from({ length: 60 }, (_, i) => ({
      fitid: `bench-${Date.now()}-${i}`,
      descricao: `OFX ${i}`,
      valor: 10 + i,
      data: `${hoje}-05`,
    })),
  });
  await req("GET", "/cartoes");
});

// ── Saída ───────────────────────────────────────────────────────────────────

const total = medidas.reduce(
  (acc, m) => ({
    requests: acc.requests + m.requests,
    queries: acc.queries + m.queries,
    ms: acc.ms + m.ms,
    kb: Math.round((acc.kb + m.kb) * 10) / 10,
  }),
  { requests: 0, queries: 0, ms: 0, kb: 0 }
);

console.log(
  `\nbaseline · ${ESPACOS} espaços · ${CARTOES} cartões · ${MESES} meses · ` +
    `${ESPACOS * MESES * AVULSAS_POR_MES} despesas do mês\n`
);
console.table(medidas);
console.log("total:", total, "\n");

await prisma.$disconnect();

export {};
