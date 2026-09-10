// Integração da camada de Server Functions — banco real, sessão real.
//
// A suíte antiga (as outras *.test.ts daqui) cobre a regra de negócio pelas
// rotas Hono, que chamam os MESMOS services. O que ela não cobre é o que a
// action pode errar por conta própria: a permission declarada, o schema
// escolhido e o service chamado. É isso que este arquivo testa, módulo a
// módulo, junto com as invariantes de segurança (401, 403, 404-não-403, 422
// com issues por campo).
//
// `cookies()` do next/headers é a única coisa mockada — do token pra dentro é
// tudo real: verifyToken, getSessionUser com roles do banco, can(), zod DTO,
// service, repository e Prisma.
import { describe, expect, it, beforeEach, mock } from "bun:test";
import { resetDb, seedRoles, createUser, prisma } from "./harness";
import { authService } from "@/server/auth/auth.service";
import { currentMonth } from "@/server/lib/serialize";

let cookieAtual = "";

mock.module("next/headers", () => ({
  cookies: async () => ({
    get: (nome: string) => (cookieAtual ? { name: nome, value: cookieAtual } : undefined),
    set: () => {},
    delete: () => {},
  }),
}));

const categoria = await import("@/server/modules/categoria/categoria.actions");
const caixinha = await import("@/server/modules/caixinha/caixinha.actions");
const movimentacao = await import("@/server/modules/movimentacao/movimentacao.actions");
const espaco = await import("@/server/modules/espaco/espaco.actions");
const cartao = await import("@/server/modules/cartao/cartao.actions");
const orcamento = await import("@/server/modules/orcamento/orcamento.actions");
const share = await import("@/server/modules/cartao-share/cartao-share.actions");
const admin = await import("@/server/modules/admin/admin.actions");
const bootstrap = await import("@/server/modules/bootstrap/bootstrap.actions");
const auth = await import("@/server/auth/auth.actions");

// Entra na sessão de um usuário criado direto no banco.
async function entraComo(opts: Parameters<typeof createUser>[0] = {}) {
  const user = await createUser(opts);
  cookieAtual = await authService.signToken(user.id);
  return user;
}

// `data` de um resultado que precisa ter dado certo (erro vira falha legível).
function dados<T>(r: { ok: boolean; data?: T; status?: number; error?: string }): T {
  if (!r.ok) throw new Error(`action falhou: ${r.status} ${r.error}`);
  return r.data as T;
}

beforeEach(async () => {
  await resetDb();
  await seedRoles();
  cookieAtual = "";
});

// ── Invariantes que valem pra toda action ────────────────────────────────────

describe("sessão e permission", () => {
  it("sem cookie: 401 em leitura e em escrita", async () => {
    expect(await categoria.listarCategorias()).toMatchObject({ status: 401 });
    expect(await categoria.criarCategoria({ nome: "X" })).toMatchObject({ status: 401 });
  });

  it("token inválido é sessão inexistente, não erro 500", async () => {
    cookieAtual = "nao.e.um.jwt";
    expect(await categoria.listarCategorias()).toMatchObject({ ok: false, status: 401 });
  });

  it("usuário desativado perde a sessão mesmo com token válido", async () => {
    const user = await entraComo({ roles: ["membro"] });
    await prisma.user.update({ where: { id: user.id }, data: { ativo: false } });
    expect(await categoria.listarCategorias()).toMatchObject({ status: 401 });
  });

  it("permission faltando: 403 com a permission no texto", async () => {
    await entraComo({ permissions: ["categoria:view"] });
    expect(await categoria.criarCategoria({ nome: "X" })).toMatchObject({
      ok: false,
      status: 403,
      error: "Sem permissão: categoria:manage",
    });
  });

  it("alias histórico de permission continua abrindo a porta", async () => {
    // roles antigas têm cartao:share, não share:manage
    await entraComo({ permissions: ["cartao:share", "cartao:view"] });
    expect(await share.listarContatos()).toMatchObject({ ok: true });
  });

  it("permission negada não deixa o service rodar", async () => {
    await entraComo({ permissions: ["categoria:view"] });
    await categoria.criarCategoria({ nome: "Não deve existir" });
    expect(await prisma.categoria.count()).toBe(0);
  });
});

describe("validação e erro", () => {
  it("payload inválido vira 422 com issue no campo (é o que o form usa)", async () => {
    await entraComo({ roles: ["membro"] });
    const r = await categoria.criarCategoria({ nome: "   " });
    expect(r).toMatchObject({ ok: false, status: 422, error: "Validação falhou" });
    const issues = (r as { issues: { path: (string | number)[] }[] }).issues;
    expect(issues.some((i) => i.path[0] === "nome")).toBe(true);
  });

  it("defaults do DTO são aplicados pela action, não pelo componente", async () => {
    await entraComo({ roles: ["membro"] });
    expect(dados(await categoria.criarCategoria({}))).toMatchObject({
      nome: "Nova categoria",
      cor: "blue",
    });
  });

  it("recurso de outro dono responde 404, não 403", async () => {
    const dono = await entraComo({ roles: ["membro"] });
    const alheia = dados(await categoria.criarCategoria({ nome: "Alheia" })) as { id: string };

    await entraComo({ roles: ["membro"] });
    expect(await categoria.atualizarCategoria(alheia.id, { nome: "Hack" })).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(dono.id).toBeDefined();
  });
});

// ── Um caminho feliz por módulo ──────────────────────────────────────────────

describe("auth", () => {
  it("entrar devolve o AuthUser; senha errada é 401", async () => {
    const user = await createUser({ roles: ["membro"], senha: "senha123" });
    expect(dados(await auth.entrar({ email: user.email, senha: "senha123" }))).toMatchObject({
      id: user.id,
      email: user.email,
    });
    expect(await auth.entrar({ email: user.email, senha: "errada" })).toMatchObject({ status: 401 });
  });

  it("usuarioLogado devolve null sem sessão (não 401)", async () => {
    expect(dados(await auth.usuarioLogado())).toBeNull();
  });
});

describe("categoria / caixinha / movimentação", () => {
  it("CRUD de categoria", async () => {
    await entraComo({ roles: ["membro"] });
    const c = dados(await categoria.criarCategoria({ nome: "Casa" })) as { id: string };
    expect(dados(await categoria.atualizarCategoria(c.id, { nome: "Lar" }))).toMatchObject({
      nome: "Lar",
    });
    expect(dados(await categoria.listarCategorias())).toHaveLength(1);
    expect(dados(await categoria.removerCategoria(c.id))).toEqual({ id: c.id });
  });

  it("movimentação devolve o retorno composto e mexe no saldo", async () => {
    await entraComo({ roles: ["membro"] });
    const cx = dados(await caixinha.criarCaixinha({ nome: "Reserva" })) as { id: string };
    const r = dados(
      await movimentacao.criarMovimentacao({ caixinhaId: cx.id, tipo: "aporte", valor: 250 })
    ) as { movimentacao: { valor: number }; caixinha: { saldo: number } };
    expect(r.movimentacao.valor).toBe(250);
    expect(r.caixinha.saldo).toBe(250);
  });

  it("caixinha de outro dono → 404", async () => {
    await entraComo({ roles: ["membro"] });
    const alheia = dados(await caixinha.criarCaixinha({ nome: "Alheia" })) as { id: string };
    await entraComo({ roles: ["membro"] });
    expect(await caixinha.removerCaixinha(alheia.id)).toMatchObject({ status: 404 });
  });
});

describe("espaço e orçamento", () => {
  it("orçamento vem por janela e com os meses que ficaram de fora", async () => {
    await entraComo({ roles: ["membro"] });
    const esp = dados(await espaco.criarEspaco({ nome: "Casa" })) as { id: string };
    await orcamento.criarDespesaMes(esp.id, { mes: "2020-01", descricao: "Antiga", valor: 10 });
    await orcamento.criarDespesaMes(esp.id, { mes: "2026-09", descricao: "Atual", valor: 20 });

    const orc = dados(await espaco.orcamentoDoEspaco(esp.id, "2026-09")) as {
      janela: { de: string; ate: string };
      despesasMes: { descricao: string }[];
      mesesComDespesa: string[];
    };
    expect(orc.janela).toEqual({ de: "2025-09", ate: "2027-09" });
    expect(orc.despesasMes.map((d) => d.descricao)).toEqual(["Atual"]);
    expect(orc.mesesComDespesa).toEqual(["2020-01", "2026-09"]);
  });

  it("resumo do mês soma fixa + avulsa por espaço", async () => {
    await entraComo({ roles: ["membro"] });
    const esp = dados(await espaco.criarEspaco({ nome: "Casa" })) as { id: string };
    await orcamento.criarDespesaFixa(esp.id, { descricao: "Aluguel", valor: 1000 });
    await orcamento.criarDespesaMes(esp.id, { mes: "2026-09", descricao: "Mercado", valor: 250 });

    const r = dados(await espaco.resumoDoMes("2026-09")) as { espacos: { saiu: number }[] };
    expect(r.espacos[0].saiu).toBe(1250);
  });

  it("mutação de despesa devolve os agregados de fatura junto", async () => {
    await entraComo({ roles: ["membro"] });
    const esp = dados(await espaco.criarEspaco({ nome: "Casa" })) as { id: string };
    const ct = dados(await cartao.criarCartao({ nome: "Nubank", limite: 5000 })) as { id: string };

    const r = dados(
      await orcamento.criarDespesaMes(esp.id, {
        mes: currentMonth(),
        descricao: "Compra",
        valor: 300,
        cartaoId: ct.id,
      })
    ) as { despesa: { valor: number }; cartoes: { id: string; faturaMes: number }[] };

    expect(r.despesa.valor).toBe(300);
    expect(r.cartoes).toEqual([expect.objectContaining({ id: ct.id, faturaMes: 300 })]);
  });

  it("lote é tudo ou nada: id de outro espaço derruba antes de escrever", async () => {
    await entraComo({ roles: ["membro"] });
    const a = dados(await espaco.criarEspaco({ nome: "A" })) as { id: string };
    const b = dados(await espaco.criarEspaco({ nome: "B" })) as { id: string };
    const daA = dados(await orcamento.criarDespesaMes(a.id, { mes: "2026-09", descricao: "A", valor: 10 })) as {
      despesa: { id: string };
    };
    const daB = dados(await orcamento.criarDespesaMes(b.id, { mes: "2026-09", descricao: "B", valor: 10 })) as {
      despesa: { id: string };
    };

    expect(
      await orcamento.loteDeDespesasMes(a.id, { ids: [daA.despesa.id, daB.despesa.id], op: "excluir" })
    ).toMatchObject({ status: 404 });
    expect(await prisma.despesaMes.count()).toBe(2);
  });

  it("ym fora do formato vira 422 (antes vinha cru do path)", async () => {
    await entraComo({ roles: ["membro"] });
    const esp = dados(await espaco.criarEspaco({ nome: "Casa" })) as { id: string };
    expect(await orcamento.definirRendaDoMes(esp.id, "2026-9", 100)).toMatchObject({ status: 422 });
  });

  it("cartão de outra conta no payload → 404 e nada é criado", async () => {
    await entraComo({ roles: ["membro"] });
    const alheio = dados(await cartao.criarCartao({ nome: "Alheio" })) as { id: string };

    await entraComo({ roles: ["membro"] });
    const esp = dados(await espaco.criarEspaco({ nome: "Casa" })) as { id: string };
    expect(
      await orcamento.criarDespesaFixa(esp.id, { descricao: "X", valor: 10, cartaoId: alheio.id })
    ).toMatchObject({ status: 404 });
    expect(await prisma.despesaFixa.count()).toBe(0);
  });
});

describe("compartilhamento", () => {
  it("painelDoCartao junta contatos, linhas e shares numa chamada", async () => {
    await entraComo({ roles: ["membro"] });
    const esp = dados(await espaco.criarEspaco({ nome: "Casa" })) as { id: string };
    const ct = dados(await cartao.criarCartao({ nome: "Nubank" })) as { id: string };
    const contato = dados(await share.criarContato({ nome: "Maria" })) as { id: string };
    const fixa = dados(
      await orcamento.criarDespesaFixa(esp.id, { descricao: "Streaming", valor: 40, cartaoId: ct.id })
    ) as { despesa: { id: string } };
    dados(
      await share.criarShare({
        contatoId: contato.id,
        tipo: "linha",
        despesaFixaId: fixa.despesa.id,
        percentual: 50,
      })
    );

    const p = dados(await share.painelDoCartao(ct.id)) as {
      contatos: unknown[];
      linhas: unknown[];
      shares: { valorMes: number }[];
    };
    expect(p.contatos).toHaveLength(1);
    expect(p.linhas).toHaveLength(1);
    expect(p.shares[0].valorMes).toBe(20);
  });

  it("abrirRateio junta contatos e o rateio da linha", async () => {
    await entraComo({ roles: ["membro"] });
    const esp = dados(await espaco.criarEspaco({ nome: "Casa" })) as { id: string };
    const contato = dados(await share.criarContato({ nome: "Maria" })) as { id: string };
    const fixa = dados(
      await orcamento.criarDespesaFixa(esp.id, { descricao: "Aluguel", valor: 1000 })
    ) as { despesa: { id: string } };
    dados(
      await share.criarShare({
        contatoId: contato.id,
        tipo: "linha",
        despesaFixaId: fixa.despesa.id,
        percentual: 30,
      })
    );

    const r = dados(await share.abrirRateio({ despesaFixaId: fixa.despesa.id })) as {
      contatos: unknown[];
      rateio: { soma: number; sobraDono: number };
    };
    expect(r.contatos).toHaveLength(1);
    expect(r.rateio).toMatchObject({ soma: 300, sobraDono: 700 });
  });

  it("só contato ativo enxerga o que deve", async () => {
    const dono = await entraComo({ roles: ["membro"] });
    const ct = dados(await cartao.criarCartao({ nome: "Nubank" })) as { id: string };
    const contato = dados(
      await share.criarContato({ nome: "Parceira", email: "parceira@teste.local" })
    ) as { id: string };
    // avulso na fatura: o tipo `valor` é o único que grava cartaoId
    dados(await share.criarShare({ contatoId: contato.id, tipo: "valor", valor: 80 }, ct.id));

    await entraComo({ email: "parceira@teste.local", roles: ["leitor"] });
    expect(dados(await share.listarMeusCompartilhamentos())).toMatchObject({ donos: [] });

    const convites = dados(await share.listarMeusConvites()) as { id: string }[];
    expect(convites).toHaveLength(1);
    dados(await share.aceitarConvite(convites[0].id));

    const meus = dados(await share.listarMeusCompartilhamentos()) as {
      donos: { dono: { id: string }; devidoMes: number }[];
    };
    expect(meus.donos).toHaveLength(1);
    expect(meus.donos[0]).toMatchObject({ dono: { id: dono.id }, devidoMes: 80 });
  });
});

describe("admin e boot", () => {
  it("bootstrapAdmin respeita a permission de cada parte", async () => {
    await entraComo({ permissions: ["role:view"] });
    const b = dados(await admin.bootstrapAdmin()) as {
      users: unknown;
      roles: unknown[];
      permissions: readonly string[];
    };
    expect(b.users).toBeNull();
    expect(b.roles).not.toBeNull();
    expect(b.permissions.length).toBeGreaterThan(0);
  });

  it("estadoInicial provisiona defaults e devolve o payload do dono", async () => {
    const user = await entraComo({ roles: ["membro"] });
    const s = dados(await bootstrap.estadoInicial()) as {
      userId: string;
      espacos: unknown[];
      categorias: unknown[];
      orcamento: unknown;
    };
    expect(s.userId).toBe(user.id);
    expect(s.espacos).toHaveLength(1);
    expect(s.categorias.length).toBeGreaterThan(0);
    expect(s.orcamento).not.toBeNull();
  });

  it("estadoInicial exige state:view", async () => {
    await entraComo({ permissions: ["caixinha:view"] });
    expect(await bootstrap.estadoInicial()).toMatchObject({ status: 403 });
  });
});
