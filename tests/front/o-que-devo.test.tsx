// Painel "O que devo" (MeusCompartilhamentos): a conta A compartilha linhas da
// fatura com um contato que tem o email da conta B; B, com cartao:view_shared,
// vê o painel. Duas sessões no mesmo teste — cada `installFetchBridge` tem o
// seu cookie jar.
import { beforeEach, describe, expect, it } from "bun:test";
import {
  api,
  createUser,
  diaDoMes,
  esperarAusente,
  espacoAtivo,
  goTo,
  installFetchBridge,
  login,
  mesAtual,
  money,
  prisma,
  renderApp,
  resetDb,
  screen,
  seedRoles,
  within,
} from "./harness";

beforeEach(async () => {
  await resetDb();
  await seedRoles();
});

const ym = mesAtual();
const EMAIL_B = "b@teste.local";

// Conta A (dona do cartão) montada só por API — sem render. O jar dela é
// descartado no fim pra não vazar a sessão pro render da conta B.
async function contaQueCompartilha(opts: { valorLinha?: number; comParcela?: boolean } = {}) {
  const { valorLinha = 400, comParcela = false } = opts;
  const dona = await createUser({ nome: "Ana", roles: ["admin"] });
  const bridge = installFetchBridge();
  await login(dona.email, dona.senha);

  const esp = await espacoAtivo(api);
  const cartao = await api.post("/cartoes", { nome: "Nubank", limite: 5000, diaVencimento: 10, cor: "violet" });
  const despesa = await api.post(`/despesas/espacos/${esp}/mes`, {
    mes: ym,
    descricao: "Mercado",
    valor: valorLinha,
    data: diaDoMes(6),
    cartaoId: cartao.id,
  });
  const contato = await api.post("/contatos", { nome: "Bruno", email: EMAIL_B });
  await api.post(`/cartoes/${cartao.id}/shares`, {
    contatoId: contato.id,
    tipo: "linha",
    despesaMesId: despesa.id,
  });

  if (comParcela) {
    const fixa = await api.post(`/despesas/espacos/${esp}/fixas`, {
      descricao: "Notebook",
      valor: 200,
      cartaoId: cartao.id,
      parcelado: true,
      parcelaAtual: 1,
      totalParcelas: 4,
    });
    await api.post(`/cartoes/${cartao.id}/shares`, {
      contatoId: contato.id,
      tipo: "linha",
      despesaFixaId: fixa.id,
      percentual: 50,
    });
  }

  bridge.restore();
  return { dona, cartao, contato };
}

describe("conta que deve", () => {
  it("vê o painel com o cartão, o dono e o valor do mês", async () => {
    await contaQueCompartilha();

    const { user1 } = await renderApp({
      email: EMAIL_B,
      roles: ["leitor"], // leitor tem cartao:view_shared
      skipReset: true,
    });
    await goTo("cartoes", user1);

    const painel = (await screen.findByText("O que devo")).closest("div")!;
    expect(within(painel).getByText("Nubank")).toBeInTheDocument();
    expect(within(painel).getByText("fatura de Ana")).toBeInTheDocument();
    // 400 aparece duas vezes: total devido do cartão e a linha em si
    expect(within(painel).getAllByText(money(400))).toHaveLength(2);
    expect(within(painel).getByText("Mercado")).toBeInTheDocument();
  });

  it("mostra a parcela e o total de parcelas futuras", async () => {
    await contaQueCompartilha({ comParcela: true });

    const { user1 } = await renderApp({ email: EMAIL_B, roles: ["leitor"], skipReset: true });
    await goTo("cartoes", user1);

    const painel = (await screen.findByText("O que devo")).closest("div")!;
    // 50% de 200 = 100 na parcela 1/4
    expect(within(painel).getByText(/1\/4 \(faltam 3\)/)).toBeInTheDocument();
    expect(within(painel).getByText(money(100))).toBeInTheDocument();
    // devido do mês = 400 + 100
    expect(within(painel).getByText(money(500))).toBeInTheDocument();
    expect(within(painel).getByText(/parcelas futuras/)).toHaveTextContent(money(300));
  });

  it("o vínculo é lazy: o contato passa a apontar pro usuário no primeiro acesso", async () => {
    const { dona } = await contaQueCompartilha();

    const conta = await renderApp({ email: EMAIL_B, roles: ["leitor"], skipReset: true });
    await goTo("cartoes", conta.user1);
    await screen.findByText("O que devo");
    conta.bridge.restore();

    // logando de novo como a dona, o contato aparece vinculado
    const bridge = installFetchBridge();
    await login(dona.email, dona.senha);
    const [contato] = await api.get("/contatos");
    expect(contato).toMatchObject({ nome: "Bruno", vinculado: true });
    bridge.restore();
  });

  it("sem share nenhum o painel não aparece", async () => {
    await createUser({ nome: "Ana", roles: ["admin"] });

    const { user1 } = await renderApp({ email: EMAIL_B, roles: ["leitor"], skipReset: true });
    await goTo("cartoes", user1);
    await screen.findByText("Cartões de crédito");

    expect(screen.queryByText("O que devo")).not.toBeInTheDocument();
  });

  it("sem cartao:view_shared o painel some (e a rota nega)", async () => {
    await contaQueCompartilha();

    const conta = await renderApp({
      email: EMAIL_B,
      permissions: ["state:view", "caixinha:view", "cartao:view", "orcamento:view"],
      skipReset: true,
    });
    await goTo("cartoes", conta.user1);
    await screen.findByText("Cartões de crédito");

    expect(screen.queryByText("O que devo")).not.toBeInTheDocument();
    expect(await conta.api.status("GET", "/me/compartilhamentos")).toBe(403);
  });

  it("o cartão da outra pessoa não entra na lista de cartões de B", async () => {
    await contaQueCompartilha();

    const { user1, api: apiB } = await renderApp({ email: EMAIL_B, roles: ["leitor"], skipReset: true });
    await goTo("cartoes", user1);
    await screen.findByText("O que devo");

    // "Nubank" aparece só dentro do painel "O que devo"
    expect(await apiB.get("/cartoes")).toEqual([]);
    expect(screen.getByText("Nenhum cartão cadastrado.")).toBeInTheDocument();
  });

  it("falha da API aparece como erro no painel, não como 'não devo nada'", async () => {
    await contaQueCompartilha();

    const { user1, user } = await renderApp({ email: EMAIL_B, roles: ["leitor"], skipReset: true });
    await goTo("cartoes", user1);
    await screen.findByText("O que devo");

    // admin tira cartao:view_shared da role enquanto a tela está aberta: a
    // próxima busca volta 403 (roles são lidas do banco a cada request)
    const [vinculo] = await prisma.userRole.findMany({ where: { userId: user.id } });
    await prisma.role.update({
      where: { id: vinculo.roleId },
      data: { permissions: ["state:view", "caixinha:view", "cartao:view", "orcamento:view"] },
    });

    const proximo = `${ym.slice(0, 4)}-${String(Number(ym.slice(5)) + 1).padStart(2, "0")}`;
    if (proximo.endsWith("13")) return; // virada de ano: caso coberto pelos outros
    await user1.selectOptions(screen.getAllByRole("combobox")[0], proximo);

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("Não consegui carregar o que você deve");
    expect(alerta).toHaveTextContent("Sem permissão: cartao:view_shared");
    // o título continua: o painel some só quando não há nada a dever
    expect(screen.getByText("O que devo")).toBeInTheDocument();
  });

  it("no mês seguinte o grupo sai da lista em vez de vir zerado", async () => {
    await contaQueCompartilha();

    const { user1, api: apiB } = await renderApp({ email: EMAIL_B, roles: ["leitor"], skipReset: true });
    await goTo("cartoes", user1);
    const painel = (await screen.findByText("O que devo")).closest("div")!;
    expect(within(painel).getAllByText(money(400)).length).toBeGreaterThan(0);

    const proximo = `${ym.slice(0, 4)}-${String(Number(ym.slice(5)) + 1).padStart(2, "0")}`;
    if (proximo.endsWith("13")) return; // virada de ano: caso coberto pelos outros
    await user1.selectOptions(screen.getAllByRole("combobox")[0], proximo);

    // o share é de uma linha que só existe no mês corrente: no mês seguinte não
    // devo nada e não há parcela futura, então o back não devolve o grupo e o
    // painel inteiro sai da tela (antes ficava com "R$ 0,00")
    await esperarAusente(() => screen.queryByText("O que devo"), "painel O que devo");
    expect(await apiB.get(`/me/compartilhamentos?ym=${proximo}`)).toEqual([]);
  });
});
