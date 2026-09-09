// Integração: /api/contatos, /api/cartoes/:id/shares, /api/shares/:id e
// /api/me/compartilhamentos — agenda do dono, divisão da fatura e a visão
// "o que devo" (com vínculo lazy do contato por email).
import { describe, expect, it, beforeEach } from "bun:test";
import { account, resetDb, seedRoles, type Client } from "./harness";
import { currentMonth } from "@/server/lib/serialize";

let dono: { api: Client; user: { id: string; email: string } };
let api: Client;
let esp: string;
let cartaoId: string;

const UUID_ZERO = "00000000-0000-0000-0000-000000000000";

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

beforeEach(async () => {
  await resetDb();
  await seedRoles();
  const conta = await account({ roles: ["membro"] });
  dono = { api: conta.api, user: conta.user };
  api = conta.api;
  esp = (await api.post("/despesas/espacos", { nome: "Principal" })).body.id;
  cartaoId = (await api.post("/cartoes", { nome: "Nubank", limite: 8000 })).body.id;
});

const novoContato = async (body: Record<string, unknown> = {}) =>
  (await api.post("/contatos", { nome: "Maria", ...body })).body;

const novaFixa = async (body: Record<string, unknown> = {}) =>
  (
    await api.post(`/despesas/espacos/${esp}/fixas`, {
      descricao: "Streaming",
      valor: 40,
      cartaoId,
      ...body,
    })
  ).body;

const novaAvulsa = async (body: Record<string, unknown> = {}) =>
  (
    await api.post(`/despesas/espacos/${esp}/mes`, {
      mes: currentMonth(),
      descricao: "Compra",
      valor: 300,
      cartaoId,
      ...body,
    })
  ).body;

// Contato só enxerga share depois de aceitar: o vínculo por email cria convite
// pendente, não acesso liberado.
const aceitaConvites = async (pessoa: { api: Client }) => {
  for (const cv of (await pessoa.api.get("/me/convites")).body) {
    await pessoa.api.post(`/me/convites/${cv.id}/aceitar`);
  }
};

// ── Contatos ────────────────────────────────────────────────────────────────

describe("contatos", () => {
  it("cria sem email (não vinculado)", async () => {
    const res = await api.post("/contatos", { nome: "  Maria  " });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: res.body.id,
      nome: "Maria",
      email: null,
      userId: null,
      vinculado: false,
      status: "local",
      reciproco: false,
      convidadoEm: null,
      respondidoEm: null,
    });
  });

  it("vincula na hora quando já existe usuário com o email", async () => {
    const parceira = await account({ email: "parceira@teste.local", roles: ["leitor"] });
    const c = await novoContato({ email: "parceira@teste.local" });
    expect(c).toMatchObject({ userId: parceira.user.id, vinculado: true });
  });

  it("segundo contato com o mesmo usuário na mesma agenda fica sem vínculo", async () => {
    await account({ email: "parceira@teste.local", roles: ["leitor"] });
    const primeiro = await novoContato({ nome: "Maria", email: "parceira@teste.local" });
    const segundo = await novoContato({ nome: "Maria (2)", email: "parceira@teste.local" });

    expect(primeiro.vinculado).toBe(true);
    expect(segundo).toMatchObject({ email: "parceira@teste.local", userId: null, vinculado: false });
  });

  it("a mesma pessoa pode ser contato de donos diferentes", async () => {
    const parceira = await account({ email: "parceira@teste.local", roles: ["leitor"] });
    const meu = await novoContato({ email: "parceira@teste.local" });

    const outroDono = await account({ roles: ["membro"] });
    const dele = (await outroDono.api.post("/contatos", { nome: "Maria", email: "parceira@teste.local" }))
      .body;

    expect(meu.userId).toBe(parceira.user.id);
    expect(dele.userId).toBe(parceira.user.id);
  });

  it("lista por nome asc, só da agenda do dono", async () => {
    await novoContato({ nome: "Zeca" });
    await novoContato({ nome: "Ana" });

    const outroDono = await account({ roles: ["membro"] });
    await outroDono.api.post("/contatos", { nome: "Da outra agenda" });

    const res = await api.get("/contatos");
    expect(res.body.map((c: { nome: string }) => c.nome)).toEqual(["Ana", "Zeca"]);
  });

  it("patch de email reavalia o vínculo; null desvincula", async () => {
    const parceira = await account({ email: "parceira@teste.local", roles: ["leitor"] });
    const c = await novoContato({ email: null });
    expect(c.vinculado).toBe(false);

    const vinculado = await api.patch(`/contatos/${c.id}`, { email: "parceira@teste.local" });
    expect(vinculado.body).toMatchObject({ userId: parceira.user.id, vinculado: true });

    const solto = await api.patch(`/contatos/${c.id}`, { email: null });
    expect(solto.body).toMatchObject({ email: null, userId: null, vinculado: false });
  });

  it("patch só de nome preserva o vínculo", async () => {
    const parceira = await account({ email: "parceira@teste.local", roles: ["leitor"] });
    const c = await novoContato({ email: "parceira@teste.local" });
    const res = await api.patch(`/contatos/${c.id}`, { nome: "Maria Silva" });
    expect(res.body).toMatchObject({ nome: "Maria Silva", userId: parceira.user.id });
  });

  it("email inválido → 422", async () => {
    expect((await api.post("/contatos", { nome: "X", email: "nao-e-email" })).status).toBe(422);
    expect((await api.post("/contatos", { nome: "  " })).status).toBe(422);
  });

  it("delete leva os shares em cascata", async () => {
    const c = await novoContato();
    const fixa = await novaFixa();
    await api.post(`/cartoes/${cartaoId}/shares`, {
      contatoId: c.id,
      tipo: "linha",
      despesaFixaId: fixa.id,
    });

    const res = await api.delete(`/contatos/${c.id}`);
    expect(res.body).toEqual({ id: c.id });
    expect((await api.get(`/cartoes/${cartaoId}/shares`)).body).toEqual([]);
  });

  it("contato de outra agenda → 404", async () => {
    const outroDono = await account({ roles: ["membro"] });
    const alheio = (await outroDono.api.post("/contatos", { nome: "Alheio" })).body;

    expect((await api.patch(`/contatos/${alheio.id}`, { nome: "Hack" })).status).toBe(404);
    expect((await api.delete(`/contatos/${alheio.id}`)).status).toBe(404);
  });
});

// ── Shares (visão do dono) ──────────────────────────────────────────────────

describe("POST /api/cartoes/:id/shares", () => {
  it("linha com percentual divide a fixa", async () => {
    const c = await novoContato();
    const fixa = await novaFixa({ valor: 40 });

    const res = await api.post(`/cartoes/${cartaoId}/shares`, {
      contatoId: c.id,
      tipo: "linha",
      despesaFixaId: fixa.id,
      percentual: 50,
      descricao: "Metade do streaming",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      // modo linha não grava cartão: ele é derivado da despesa apontada
      cartaoId: null,
      contatoId: c.id,
      tipo: "linha",
      descricao: "Metade do streaming",
      despesaFixaId: fixa.id,
      despesaMesId: null,
      percentual: 50,
      valor: null,
      mesRef: null,
      linhaDescricao: "Streaming",
      valorMes: 20,
      comprometido: 0,
      parcela: null,
    });
  });

  it("linha sem percentual nem valor = linha inteira", async () => {
    const c = await novoContato();
    const fixa = await novaFixa({ valor: 99.9 });
    const res = await api.post(`/cartoes/${cartaoId}/shares`, {
      contatoId: c.id,
      tipo: "linha",
      despesaFixaId: fixa.id,
    });
    expect(res.body).toMatchObject({ percentual: null, valor: null, valorMes: 99.9 });
  });

  it("valor fixo acima da base é recusado (a soma não pode passar da linha)", async () => {
    const c = await novoContato();
    const fixa = await novaFixa({ valor: 40 });
    const res = await api.post(`/cartoes/${cartaoId}/shares`, {
      contatoId: c.id,
      tipo: "linha",
      despesaFixaId: fixa.id,
      valor: 100,
    });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain("passa do valor da linha");
  });

  it("linha apontando despesa do mês só vale naquele mês", async () => {
    const c = await novoContato();
    const avulsa = await novaAvulsa({ valor: 300 });

    const criado = await api.post(`/cartoes/${cartaoId}/shares`, {
      contatoId: c.id,
      tipo: "linha",
      despesaMesId: avulsa.id,
      percentual: 30,
    });
    expect(criado.body).toMatchObject({ despesaMesId: avulsa.id, valorMes: 90 });

    const outroMes = await api.get(
      `/cartoes/${cartaoId}/shares?ym=${addMonths(currentMonth(), 1)}`
    );
    expect(outroMes.body[0].valorMes).toBe(0);
  });

  it("linha parcelada devolve parcela e comprometido", async () => {
    const c = await novoContato();
    const fixa = await novaFixa({
      descricao: "Jiu-jitsu",
      valor: 200,
      parcelado: true,
      parcelaAtual: 3,
      totalParcelas: 12,
    });

    const res = await api.post(`/cartoes/${cartaoId}/shares`, {
      contatoId: c.id,
      tipo: "linha",
      despesaFixaId: fixa.id,
      percentual: 50,
    });

    expect(res.body).toMatchObject({
      valorMes: 100,
      comprometido: 900, // (12 - 3) × 100
      parcela: { parcelaAtual: 3, totalParcelas: 12, restantes: 9 },
    });
  });

  it("parcelamento encerrado zera o valor do mês", async () => {
    const c = await novoContato();
    const fixa = await novaFixa({ valor: 200, parcelado: true, parcelaAtual: 12, totalParcelas: 12 });
    await api.post(`/cartoes/${cartaoId}/shares`, {
      contatoId: c.id,
      tipo: "linha",
      despesaFixaId: fixa.id,
    });

    const depois = await api.get(`/cartoes/${cartaoId}/shares?ym=${addMonths(currentMonth(), 1)}`);
    expect(depois.body[0]).toMatchObject({ valorMes: 0, comprometido: 0 });
  });

  it("valor recorrente (mesRef null) vale todo mês", async () => {
    const c = await novoContato();
    const res = await api.post(`/cartoes/${cartaoId}/shares`, {
      contatoId: c.id,
      tipo: "valor",
      valor: 80,
      descricao: "Combinado mensal",
    });
    expect(res.body).toMatchObject({ tipo: "valor", valor: 80, mesRef: null, valorMes: 80 });

    const futuro = await api.get(`/cartoes/${cartaoId}/shares?ym=${addMonths(currentMonth(), 5)}`);
    expect(futuro.body[0].valorMes).toBe(80);
  });

  it("valor pontual só conta no mesRef", async () => {
    const c = await novoContato();
    const mes = currentMonth();
    await api.post(`/cartoes/${cartaoId}/shares`, {
      contatoId: c.id,
      tipo: "valor",
      valor: 120,
      mesRef: mes,
    });

    expect((await api.get(`/cartoes/${cartaoId}/shares?ym=${mes}`)).body[0].valorMes).toBe(120);
    expect(
      (await api.get(`/cartoes/${cartaoId}/shares?ym=${addMonths(mes, 1)}`)).body[0].valorMes
    ).toBe(0);
  });

  it("percentual é ignorado no tipo valor", async () => {
    const c = await novoContato();
    const res = await api.post(`/cartoes/${cartaoId}/shares`, {
      contatoId: c.id,
      tipo: "valor",
      valor: 50,
      percentual: 30,
    });
    expect(res.body).toMatchObject({ percentual: null, valor: 50, valorMes: 50 });
  });

  it("DTO rejeita combinações inválidas → 422", async () => {
    const c = await novoContato();
    const fixa = await novaFixa();
    const avulsa = await novaAvulsa();
    const post = (body: Record<string, unknown>) => api.post(`/cartoes/${cartaoId}/shares`, body);

    // linha sem referência
    expect((await post({ contatoId: c.id, tipo: "linha" })).status).toBe(422);
    // linha com as duas referências
    expect(
      (await post({ contatoId: c.id, tipo: "linha", despesaFixaId: fixa.id, despesaMesId: avulsa.id }))
        .status
    ).toBe(422);
    // percentual + valor juntos
    expect(
      (await post({ contatoId: c.id, tipo: "linha", despesaFixaId: fixa.id, percentual: 50, valor: 10 }))
        .status
    ).toBe(422);
    // valor sem valor
    expect((await post({ contatoId: c.id, tipo: "valor" })).status).toBe(422);
    // valor apontando linha
    expect((await post({ contatoId: c.id, tipo: "valor", valor: 10, despesaFixaId: fixa.id })).status).toBe(
      422
    );
    // percentual acima de 100
    expect(
      (await post({ contatoId: c.id, tipo: "linha", despesaFixaId: fixa.id, percentual: 101 })).status
    ).toBe(422);
  });

  it("cartão, contato ou linha de outro dono → 404", async () => {
    const c = await novoContato();
    const fixa = await novaFixa();

    const outroDono = await account({ roles: ["membro"] });
    const cartaoAlheio = (await outroDono.api.post("/cartoes", { nome: "Alheio" })).body.id;
    const contatoAlheio = (await outroDono.api.post("/contatos", { nome: "Alheio" })).body.id;
    const espAlheio = (await outroDono.api.post("/despesas/espacos", { nome: "Alheio" })).body.id;
    const fixaAlheia = (
      await outroDono.api.post(`/despesas/espacos/${espAlheio}/fixas`, { descricao: "X", valor: 10 })
    ).body.id;

    // cartão de outro dono (só o tipo `valor` grava cartaoId — no modo linha
    // o cartão vem da despesa e o :id da URL é ignorado)
    expect(
      (await api.post(`/cartoes/${cartaoAlheio}/shares`, {
        contatoId: c.id,
        tipo: "valor",
        valor: 10,
      })).status
    ).toBe(404);

    // contato de outra agenda
    expect(
      (await api.post(`/cartoes/${cartaoId}/shares`, {
        contatoId: contatoAlheio,
        tipo: "linha",
        despesaFixaId: fixa.id,
      })).status
    ).toBe(404);

    // linha de outro dono
    const alheia = await api.post(`/cartoes/${cartaoId}/shares`, {
      contatoId: c.id,
      tipo: "linha",
      despesaFixaId: fixaAlheia,
    });
    expect(alheia.status).toBe(404);
    expect(alheia.body.error).toContain("Despesa fixa não encontrada");

    // despesa do mês inexistente
    const semAvulsa = await api.post(`/cartoes/${cartaoId}/shares`, {
      contatoId: c.id,
      tipo: "linha",
      despesaMesId: UUID_ZERO,
    });
    expect(semAvulsa.status).toBe(404);
    expect(semAvulsa.body.error).toContain("Despesa do mês não encontrada");
  });
});

describe("GET /api/cartoes/:id/shares", () => {
  it("lista os shares do cartão com os valores do mês pedido", async () => {
    const c = await novoContato();
    const fixa = await novaFixa({ valor: 40 });
    await api.post(`/cartoes/${cartaoId}/shares`, {
      contatoId: c.id,
      tipo: "linha",
      despesaFixaId: fixa.id,
      percentual: 50,
    });
    await api.post(`/cartoes/${cartaoId}/shares`, { contatoId: c.id, tipo: "valor", valor: 80 });

    const res = await api.get(`/cartoes/${cartaoId}/shares?ym=${currentMonth()}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((s: { valorMes: number }) => s.valorMes).sort()).toEqual([20, 80]);
  });

  it("cartão de outro dono → 404", async () => {
    const outroDono = await account({ roles: ["membro"] });
    const alheio = (await outroDono.api.post("/cartoes", { nome: "Alheio" })).body.id;
    expect((await api.get(`/cartoes/${alheio}/shares`)).status).toBe(404);
  });

  it("ym inválido → 422", async () => {
    expect((await api.get(`/cartoes/${cartaoId}/shares?ym=julho`)).status).toBe(422);
  });
});

describe("PATCH /api/shares/:id", () => {
  it("atualiza descrição, percentual e valor", async () => {
    const c = await novoContato();
    const fixa = await novaFixa({ valor: 40 });
    const share = (
      await api.post(`/cartoes/${cartaoId}/shares`, {
        contatoId: c.id,
        tipo: "linha",
        despesaFixaId: fixa.id,
        percentual: 50,
      })
    ).body;

    const res = await api.patch(`/shares/${share.id}`, { descricao: "Novo rótulo", percentual: 25 });
    expect(res.body).toMatchObject({ descricao: "Novo rótulo", percentual: 25, valorMes: 10 });

    // percentual null + valor fixo
    const trocado = await api.patch(`/shares/${share.id}`, { percentual: null, valor: 5 });
    expect(trocado.body).toMatchObject({ percentual: null, valor: 5, valorMes: 5 });
  });

  it("mesRef só em share do tipo valor", async () => {
    const c = await novoContato();
    const fixa = await novaFixa();
    const linha = (
      await api.post(`/cartoes/${cartaoId}/shares`, {
        contatoId: c.id,
        tipo: "linha",
        despesaFixaId: fixa.id,
      })
    ).body;

    const negado = await api.patch(`/shares/${linha.id}`, { mesRef: currentMonth() });
    expect(negado.status).toBe(400);
    expect(negado.body).toEqual({ error: "mesRef só se aplica a share do tipo valor" });

    const valor = (
      await api.post(`/cartoes/${cartaoId}/shares`, { contatoId: c.id, tipo: "valor", valor: 30 })
    ).body;
    const ok = await api.patch(`/shares/${valor.id}`, { mesRef: addMonths(currentMonth(), 1) });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ mesRef: addMonths(currentMonth(), 1), valorMes: 0 });
  });

  it("share de outro dono → 404", async () => {
    const outroDono = await account({ roles: ["membro"] });
    const cartaoAlheio = (await outroDono.api.post("/cartoes", { nome: "Alheio" })).body.id;
    const contatoAlheio = (await outroDono.api.post("/contatos", { nome: "Alheio" })).body.id;
    const shareAlheio = (
      await outroDono.api.post(`/cartoes/${cartaoAlheio}/shares`, {
        contatoId: contatoAlheio,
        tipo: "valor",
        valor: 10,
      })
    ).body;

    expect((await api.patch(`/shares/${shareAlheio.id}`, { valor: 999 })).status).toBe(404);
    expect((await api.delete(`/shares/${shareAlheio.id}`)).status).toBe(404);
  });
});

describe("DELETE /api/shares/:id", () => {
  it("remove", async () => {
    const c = await novoContato();
    const share = (
      await api.post(`/cartoes/${cartaoId}/shares`, { contatoId: c.id, tipo: "valor", valor: 10 })
    ).body;

    expect((await api.delete(`/shares/${share.id}`)).body).toEqual({ id: share.id });
    expect((await api.get(`/cartoes/${cartaoId}/shares`)).body).toEqual([]);
  });
});

// ── Visão "o que devo" ──────────────────────────────────────────────────────

describe("GET /api/me/compartilhamentos", () => {
  it("sem contato nenhum devolve lista vazia", async () => {
    const pessoa = await account({ roles: ["leitor"] });
    const res = await pessoa.api.get("/me/compartilhamentos");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ donos: [], orfas: [] });
  });

  it("só enxerga o que devo depois de aceitar o convite", async () => {
    const contato = await novoContato({ nome: "Parceira", email: "parceira@teste.local" });
    const fixa = await novaFixa({ valor: 40 });
    await api.post(`/cartoes/${cartaoId}/shares`, {
      contatoId: contato.id,
      tipo: "linha",
      despesaFixaId: fixa.id,
      percentual: 50,
    });

    const pessoa = await account({ email: "parceira@teste.local", roles: ["leitor"] });
    // antes do aceite: contato pendente não vê nada
    expect((await pessoa.api.get("/me/compartilhamentos")).body.donos).toEqual([]);

    await aceitaConvites(pessoa);
    expect((await pessoa.api.get("/me/compartilhamentos")).body.donos).toHaveLength(1);
  });

  it("vincula o contato lazy no aceite e agrupa por cartão", async () => {
    // dono cadastra o contato ANTES da pessoa ter conta
    const contato = await novoContato({ nome: "Parceira", email: "parceira@teste.local" });
    expect(contato.vinculado).toBe(false);

    const fixa = await novaFixa({ valor: 40 });
    await api.post(`/cartoes/${cartaoId}/shares`, {
      contatoId: contato.id,
      tipo: "linha",
      despesaFixaId: fixa.id,
      percentual: 50,
      descricao: "Metade do streaming",
    });
    await api.post(`/cartoes/${cartaoId}/shares`, {
      contatoId: contato.id,
      tipo: "valor",
      valor: 80,
      descricao: "Combinado mensal",
    });

    const pessoa = await account({ email: "parceira@teste.local", roles: ["leitor"] });
    await aceitaConvites(pessoa);
    const res = await pessoa.api.get("/me/compartilhamentos");

    expect(res.status).toBe(200);
    expect(res.body.donos).toHaveLength(1);
    expect(res.body.donos[0]).toMatchObject({
      dono: { id: dono.user.id },
      devidoMes: 100, // 20 + 80
      comprometido: 0,
    });
    expect(res.body.donos[0].grupos).toHaveLength(1);
    expect(res.body.donos[0].grupos[0]).toMatchObject({
      tipo: "cartao",
      cartao: { id: cartaoId, nome: "Nubank" },
      devidoMes: 100,
    });
    expect(res.body.donos[0].grupos[0].linhas).toHaveLength(2);

    // o vínculo ficou persistido na agenda do dono
    expect((await api.get("/contatos")).body[0]).toMatchObject({
      id: contato.id,
      userId: pessoa.user.id,
      vinculado: true,
      status: "ativo",
    });
  });

  it("agrupa por cartão e soma comprometido de parcelas", async () => {
    const contato = await novoContato({ email: "parceira@teste.local" });
    const parcelada = await novaFixa({
      descricao: "Jiu-jitsu",
      valor: 200,
      parcelado: true,
      parcelaAtual: 2,
      totalParcelas: 6,
    });
    await api.post(`/cartoes/${cartaoId}/shares`, {
      contatoId: contato.id,
      tipo: "linha",
      despesaFixaId: parcelada.id,
      percentual: 50,
    });

    const outroCartao = (await api.post("/cartoes", { nome: "Inter", limite: 3000 })).body.id;
    await api.post(`/cartoes/${outroCartao}/shares`, {
      contatoId: contato.id,
      tipo: "valor",
      valor: 25,
    });

    const pessoa = await account({ email: "parceira@teste.local", roles: ["leitor"] });
    await aceitaConvites(pessoa);
    const res = await pessoa.api.get("/me/compartilhamentos");

    expect(res.body.donos).toHaveLength(1);
    const grupos = res.body.donos[0].grupos;
    expect(grupos).toHaveLength(2);
    const nubank = grupos.find((g: { cartao: { nome: string } }) => g.cartao?.nome === "Nubank");
    const inter = grupos.find((g: { cartao: { nome: string } }) => g.cartao?.nome === "Inter");
    expect(nubank).toMatchObject({ devidoMes: 100, comprometido: 400 }); // (6-2) × 100
    expect(inter).toMatchObject({ devidoMes: 25, comprometido: 0 });
  });

  it("junta as faturas de donos diferentes", async () => {
    const c1 = await novoContato({ email: "parceira@teste.local" });
    await api.post(`/cartoes/${cartaoId}/shares`, { contatoId: c1.id, tipo: "valor", valor: 40 });

    const outroDono = await account({ roles: ["membro"] });
    const cartao2 = (await outroDono.api.post("/cartoes", { nome: "Santander" })).body.id;
    const c2 = (await outroDono.api.post("/contatos", { nome: "P", email: "parceira@teste.local" })).body;
    await outroDono.api.post(`/cartoes/${cartao2}/shares`, {
      contatoId: c2.id,
      tipo: "valor",
      valor: 15,
    });

    const pessoa = await account({ email: "parceira@teste.local", roles: ["leitor"] });
    await aceitaConvites(pessoa);
    const res = await pessoa.api.get("/me/compartilhamentos");

    expect(res.body.donos).toHaveLength(2);
    expect(res.body.donos.map((d: { devidoMes: number }) => d.devidoMes).sort()).toEqual([15, 40]);
    expect(new Set(res.body.donos.map((d: { dono: { id: string } }) => d.dono.id)).size).toBe(2);
  });

  it("respeita o ym pedido", async () => {
    const contato = await novoContato({ email: "parceira@teste.local" });
    await api.post(`/cartoes/${cartaoId}/shares`, {
      contatoId: contato.id,
      tipo: "valor",
      valor: 60,
      mesRef: currentMonth(),
    });

    const pessoa = await account({ email: "parceira@teste.local", roles: ["leitor"] });
    await aceitaConvites(pessoa);
    expect(
      (await pessoa.api.get(`/me/compartilhamentos?ym=${currentMonth()}`)).body.donos[0].devidoMes
    ).toBe(60);
    expect(
      (await pessoa.api.get(`/me/compartilhamentos?ym=${addMonths(currentMonth(), 1)}`)).body.donos[0]
        .devidoMes
    ).toBe(0);
  });

  it("exige share:view_shared (ou o alias cartao:view_shared)", async () => {
    const sem = await account({ permissions: ["state:view", "cartao:view"] });
    const res = await sem.api.get("/me/compartilhamentos");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Sem permissão: share:view_shared | cartao:view_shared" });
  });
});

describe("permissions da gestão de shares", () => {
  it("exige contato:manage / share:manage (ou o alias cartao:share)", async () => {
    const leitor = await account({ roles: ["leitor"] });
    expect((await leitor.api.get("/contatos")).status).toBe(403);
    const res = await leitor.api.post("/contatos", { nome: "X" });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: "Sem permissão: contato:manage | share:manage | cartao:share",
    });
    expect((await leitor.api.get(`/cartoes/${cartaoId}/shares`)).status).toBe(403);
  });
});
