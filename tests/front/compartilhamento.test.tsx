// CompartilharModal: contato existente vs "+ Nova pessoa", compartilhar uma
// linha da fatura (inteira / percentual / valor fixo) ou um valor avulso
// (recorrente ou só do mês), remover, e as guardas de validação.
import { beforeEach, describe, expect, it } from "bun:test";
import {
  campo,
  diaDoMes,
  digitarMoney,
  digitarNumero,
  esperarAusente,
  esperarQuantidade,
  espacoAtivo,
  goTo,
  mesAtual,
  money,
  renderApp,
  resetDb,
  screen,
  seedRoles,
  within,
  type Api,
} from "./harness";

beforeEach(async () => {
  await resetDb();
  await seedRoles();
});

const ym = mesAtual();

// Cartão com duas linhas na fatura do mês: uma avulsa e uma fixa parcelada.
async function cartaoComFatura(api: Api) {
  const esp = await espacoAtivo(api);
  const cartao = await api.post("/cartoes", { nome: "Nubank", limite: 5000, diaVencimento: 10 });
  await api.post(`/despesas/espacos/${esp}/mes`, {
    mes: ym,
    descricao: "Mercado",
    valor: 400,
    data: diaDoMes(6),
    cartaoId: cartao.id,
  });
  await api.post(`/despesas/espacos/${esp}/fixas`, {
    descricao: "Notebook",
    valor: 200,
    cartaoId: cartao.id,
    parcelado: true,
    parcelaAtual: 1,
    totalParcelas: 5,
  });
  return { esp, cartao };
}

async function abrirCompartilhar(opts: { comContato?: boolean } = {}) {
  const ctx = await renderApp({
    roles: ["admin"],
    skipReset: true,
    setup: async ({ api }) => {
      await cartaoComFatura(api);
      if (opts.comContato) await api.post("/contatos", { nome: "Maria", email: "maria@teste.local" });
    },
  });
  await goTo("cartoes", ctx.user1);
  await ctx.user1.click(await screen.findByRole("button", { name: "Compartilhar cartão" }));
  const dialog = await screen.findByRole("dialog");
  return { ...ctx, dialog, ui: within(dialog) };
}

describe("estado inicial", () => {
  it("abre com o nome do cartão e sem nada compartilhado", async () => {
    const { ui } = await abrirCompartilhar();

    expect(ui.getByText("Compartilhar · Nubank")).toBeInTheDocument();
    expect(ui.getByText("Nada compartilhado ainda.")).toBeInTheDocument();
  });

  it("o select de linha lista a fatura do mês (com a parcela)", async () => {
    const { dialog } = await abrirCompartilhar();

    // o modal carrega contatos/linhas/shares em paralelo ao abrir
    await within(dialog).findByRole("option", { name: /Mercado/ });
    const opcoes = within(campo(dialog, "Linha"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(opcoes.some((t) => t?.includes("Mercado"))).toBe(true);
    expect(opcoes.some((t) => t?.includes("Notebook") && t.includes("(1/5)"))).toBe(true);
  });
});

describe("compartilhar uma linha", () => {
  it("linha inteira com contato existente", async () => {
    const { user1, dialog, ui, api } = await abrirCompartilhar({ comContato: true });

    await within(dialog).findByRole("option", { name: /Mercado/ });
    await user1.selectOptions(campo(dialog, "Pessoa"), "Maria");
    const linha = within(campo(dialog, "Linha")).getAllByRole("option").find((o) => o.textContent?.includes("Mercado"))!;
    await user1.selectOptions(campo(dialog, "Linha"), (linha as HTMLOptionElement).value);
    await user1.click(ui.getByRole("button", { name: /Compartilhar$/ }));

    expect(await ui.findByText(/Maria ·/)).toBeInTheDocument();
    expect(ui.getByText(`${money(400)} este mês`)).toBeInTheDocument();

    const [cartao] = await api.get("/cartoes");
    const shares = await api.get(`/cartoes/${cartao.id}/shares`);
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({ tipo: "linha", valorMes: 400 });
  });

  it("percentual divide o valor da linha", async () => {
    const { user1, dialog, ui, api } = await abrirCompartilhar({ comContato: true });

    await within(dialog).findByRole("option", { name: /Mercado/ });
    await user1.selectOptions(campo(dialog, "Pessoa"), "Maria");
    const linha = within(campo(dialog, "Linha")).getAllByRole("option").find((o) => o.textContent?.includes("Mercado"))!;
    await user1.selectOptions(campo(dialog, "Linha"), (linha as HTMLOptionElement).value);
    await user1.selectOptions(campo(dialog, "Quanto dessa linha"), "percentual");
    await digitarNumero(user1, campo(dialog, "Percentual"), 25);
    await user1.click(ui.getByRole("button", { name: /Compartilhar$/ }));

    expect(await ui.findByText(`${money(100)} este mês`)).toBeInTheDocument();
    const [cartao] = await api.get("/cartoes");
    expect((await api.get(`/cartoes/${cartao.id}/shares`))[0]).toMatchObject({ percentual: 25 });
  });

  it("valor fixo por mês na linha parcelada mostra a parcela", async () => {
    const { user1, dialog, ui, api } = await abrirCompartilhar({ comContato: true });

    await within(dialog).findByRole("option", { name: /Mercado/ });
    await user1.selectOptions(campo(dialog, "Pessoa"), "Maria");
    const linha = within(campo(dialog, "Linha")).getAllByRole("option").find((o) => o.textContent?.includes("Notebook"))!;
    await user1.selectOptions(campo(dialog, "Linha"), (linha as HTMLOptionElement).value);
    await user1.selectOptions(campo(dialog, "Quanto dessa linha"), "valor");
    await digitarMoney(user1, campo(dialog, "Valor por mês"), "5000"); // 50,00
    await user1.click(ui.getByRole("button", { name: /Compartilhar$/ }));

    // a linha do share junta valor + parcela num <p> só
    expect(await ui.findByText(/parcela 1\/5 · faltam 4/)).toHaveTextContent(
      `${money(50)} este mês · parcela 1/5 · faltam 4`
    );

    const [cartao] = await api.get("/cartoes");
    expect((await api.get(`/cartoes/${cartao.id}/shares`))[0]).toMatchObject({ valor: 50 });
  });
});

describe("compartilhar um valor avulso", () => {
  it("recorrente (todo mês) grava sem mesRef", async () => {
    const { user1, dialog, ui, api } = await abrirCompartilhar({ comContato: true });

    await within(dialog).findByRole("option", { name: "Maria" });
    await user1.selectOptions(campo(dialog, "Pessoa"), "Maria");
    await user1.selectOptions(campo(dialog, "O que compartilhar"), "valor");
    await digitarMoney(user1, campo(dialog, "Valor"), "12000"); // 120,00
    await user1.click(ui.getByRole("button", { name: /Compartilhar$/ }));

    expect(await ui.findByText(/valor \(todo mês\)/)).toBeInTheDocument();
    const [cartao] = await api.get("/cartoes");
    expect((await api.get(`/cartoes/${cartao.id}/shares`))[0]).toMatchObject({
      tipo: "valor",
      mesRef: null,
      valorMes: 120,
    });
  });

  it("pontual grava o mês de referência", async () => {
    const { user1, dialog, ui, api } = await abrirCompartilhar({ comContato: true });

    await within(dialog).findByRole("option", { name: "Maria" });
    await user1.selectOptions(campo(dialog, "Pessoa"), "Maria");
    await user1.selectOptions(campo(dialog, "O que compartilhar"), "valor");
    await digitarMoney(user1, campo(dialog, "Valor"), "8000"); // 80
    await user1.selectOptions(campo(dialog, "Recorrência"), "pontual");
    await user1.click(ui.getByRole("button", { name: /Compartilhar$/ }));

    expect(await ui.findByText(new RegExp(`valor \\(${ym}\\)`))).toBeInTheDocument();
    const [cartao] = await api.get("/cartoes");
    expect((await api.get(`/cartoes/${cartao.id}/shares`))[0]).toMatchObject({ mesRef: ym });
  });
});

describe("contato novo", () => {
  it("'+ Nova pessoa' cria o contato e reusa no próximo compartilhamento", async () => {
    const { user1, dialog, ui, api } = await abrirCompartilhar();

    await user1.selectOptions(campo(dialog, "Pessoa"), "__novo__");
    await user1.type(ui.getByPlaceholderText("Maria"), "João");
    await user1.type(ui.getByPlaceholderText("maria@email.com"), "joao@teste.local");
    await user1.selectOptions(campo(dialog, "O que compartilhar"), "valor");
    await digitarMoney(user1, campo(dialog, "Valor"), "5000");
    await user1.click(ui.getByRole("button", { name: /Compartilhar$/ }));

    expect(await ui.findByText(/João ·/)).toBeInTheDocument();
    const contatos = await api.get("/contatos");
    expect(contatos).toHaveLength(1);
    expect(contatos[0]).toMatchObject({ nome: "João", email: "joao@teste.local" });

    // o select volta apontando pro contato criado → segundo share reusa
    expect((campo(dialog, "Pessoa") as HTMLSelectElement).value).toBe(contatos[0].id);
    await digitarMoney(user1, campo(dialog, "Valor"), "3000");
    await user1.click(ui.getByRole("button", { name: /Compartilhar$/ }));

    await esperarQuantidade(() => screen.queryAllByText(/João ·/), 2, "shares");
    expect(await api.get("/contatos")).toHaveLength(1);
  });
});

describe("guardas", () => {
  it("sem contato escolhido, erro inline", async () => {
    const { user1, ui } = await abrirCompartilhar();

    await user1.click(ui.getByRole("button", { name: /Compartilhar$/ }));
    expect(await ui.findByRole("alert")).toHaveTextContent("Escolha ou cadastre um contato.");
  });

  it("'+ Nova pessoa' sem nome, erro inline", async () => {
    const { user1, dialog, ui } = await abrirCompartilhar();

    await user1.selectOptions(campo(dialog, "Pessoa"), "__novo__");
    await user1.click(ui.getByRole("button", { name: /Compartilhar$/ }));

    expect(await ui.findByRole("alert")).toHaveTextContent("Informe o nome da pessoa.");
  });

  it("tipo linha sem linha selecionada, erro inline", async () => {
    const { user1, dialog, ui } = await abrirCompartilhar({ comContato: true });

    await within(dialog).findByRole("option", { name: "Maria" });
    await user1.selectOptions(campo(dialog, "Pessoa"), "Maria");
    await user1.click(ui.getByRole("button", { name: /Compartilhar$/ }));

    expect(await ui.findByRole("alert")).toHaveTextContent("Selecione uma linha da fatura.");
  });

  it("tipo valor sem valor, erro inline", async () => {
    const { user1, dialog, ui } = await abrirCompartilhar({ comContato: true });

    await within(dialog).findByRole("option", { name: "Maria" });
    await user1.selectOptions(campo(dialog, "Pessoa"), "Maria");
    await user1.selectOptions(campo(dialog, "O que compartilhar"), "valor");
    await user1.click(ui.getByRole("button", { name: /Compartilhar$/ }));

    expect(await ui.findByRole("alert")).toHaveTextContent("Informe o valor.");
  });
});

describe("remover", () => {
  it("remove o share e recarrega a lista", async () => {
    const { user1, ui, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const { cartao } = await cartaoComFatura(api);
        const contato = await api.post("/contatos", { nome: "Maria" });
        await api.post(`/cartoes/${cartao.id}/shares`, {
          contatoId: contato.id,
          tipo: "valor",
          valor: 90,
          mesRef: null,
        });
      },
    }).then(async (ctx) => {
      await goTo("cartoes", ctx.user1);
      await ctx.user1.click(await screen.findByRole("button", { name: "Compartilhar cartão" }));
      const dialog = await screen.findByRole("dialog");
      return { ...ctx, ui: within(dialog) };
    });

    expect(await ui.findByText(/Maria ·/)).toBeInTheDocument();
    await user1.click(ui.getByRole("button", { name: "Remover" }));

    await esperarAusente(() => screen.queryByText(/Maria ·/), "share");
    expect(ui.getByText("Nada compartilhado ainda.")).toBeInTheDocument();
    const [cartao] = await api.get("/cartoes");
    expect(await api.get(`/cartoes/${cartao.id}/shares`)).toEqual([]);
  });
});
