// Despesas fixas: CRUD, toggle ativa/pausada, parcelamento (label, quitadas,
// fora do total), reancoragem no editar e o resumo "N/M pagas · faltam X".
import { beforeEach, describe, expect, it } from "bun:test";
import {
  addMeses,
  campo,
  digitarMoney,
  digitarNumero,
  esperarSemDialog,
  espacoAtivo,
  goTo,
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

async function cenarioBase(api: Api) {
  const esp = await espacoAtivo(api);
  await api.patch(`/despesas/espacos/${esp}`, { rendaMensal: 5000 });
  return esp;
}

const linhaDe = (descricao: string) => screen.getByText(descricao).closest("li")!;

describe("CRUD", () => {
  it("cria pelo modal com categoria e dia de vencimento", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        await cenarioBase(api);
        await api.post("/categorias", { nome: "Casa", cor: "blue" });
      },
    });
    await goTo("fixas", user1);
    expect(await screen.findByText("Nenhuma despesa fixa cadastrada.")).toBeInTheDocument();

    await user1.click(screen.getByRole("button", { name: /Nova fixa/ }));
    const dialog = await screen.findByRole("dialog");
    const ui = within(dialog);
    await user1.type(ui.getByPlaceholderText(/Aluguel, internet/), "Aluguel");
    await digitarMoney(user1, campo(dialog, "Valor mensal"), "120000"); // 1.200,00
    await digitarNumero(user1, campo(dialog, "Dia do vencimento"), 10);
    await user1.selectOptions(campo(dialog, "Categoria"), "Casa");
    await user1.click(ui.getByRole("button", { name: "Salvar" }));

    await esperarSemDialog();
    expect(await screen.findByText("Aluguel")).toBeInTheDocument();
    expect(screen.getByText("vence dia 10")).toBeInTheDocument();
    expect(within(linhaDe("Aluguel")).getByText("Casa")).toBeInTheDocument();

    const esp = await espacoAtivo(api);
    expect((await api.get(`/despesas/espacos/${esp}`)).despesasFixas[0]).toMatchObject({
      descricao: "Aluguel",
      valor: 1200,
      diaVencimento: 10,
      ativa: true,
    });
  });

  it("ordena por valor desc e o total do título soma só as que caem no mês", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        await api.post(`/despesas/espacos/${esp}/fixas`, { descricao: "Internet", valor: 120 });
        await api.post(`/despesas/espacos/${esp}/fixas`, { descricao: "Aluguel", valor: 1500 });
        await api.post(`/despesas/espacos/${esp}/fixas`, { descricao: "Streaming", valor: 40 });
      },
    });
    await goTo("fixas", user1);
    await screen.findByText("Aluguel");

    const nomes = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(nomes[0]).toContain("Aluguel");
    expect(nomes[1]).toContain("Internet");
    expect(nomes[2]).toContain("Streaming");
    expect(screen.getByText(`${money(1660)}/mês`)).toBeInTheDocument();
  });

  it("editar altera valor e o total acompanha", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        await api.post(`/despesas/espacos/${esp}/fixas`, { descricao: "Internet", valor: 120 });
      },
    });
    await goTo("fixas", user1);

    await user1.click(await screen.findByRole("button", { name: "Editar Internet" }));
    const dialog = await screen.findByRole("dialog");
    await digitarMoney(user1, campo(dialog, "Valor mensal"), "15000"); // 150,00
    await user1.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await esperarSemDialog();
    expect(await screen.findByText(`${money(150)}/mês`)).toBeInTheDocument();
    const esp = await espacoAtivo(api);
    expect((await api.get(`/despesas/espacos/${esp}`)).despesasFixas[0].valor).toBe(150);
  });

  it("excluir confirma com aviso de histórico", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        await api.post(`/despesas/espacos/${esp}/fixas`, { descricao: "Internet", valor: 120 });
      },
    });
    await goTo("fixas", user1);

    await user1.click(await screen.findByRole("button", { name: "Remover Internet" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/apaga o histórico de pagamentos/)).toBeInTheDocument();
    await user1.click(within(dialog).getByRole("button", { name: /Excluir/ }));

    await esperarSemDialog();
    expect(await screen.findByText("Nenhuma despesa fixa cadastrada.")).toBeInTheDocument();
    const esp = await espacoAtivo(api);
    expect((await api.get(`/despesas/espacos/${esp}`)).despesasFixas).toEqual([]);
  });

  it("descrição vazia mostra erro inline sem request", async () => {
    const { user1, bridge } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await cenarioBase(api); },
    });
    await goTo("fixas", user1);

    await user1.click(screen.getByRole("button", { name: /Nova fixa/ }));
    const ui = within(await screen.findByRole("dialog"));
    bridge.calls.length = 0;
    await user1.click(ui.getByRole("button", { name: "Salvar" }));

    expect(await ui.findAllByText("Dê um nome para a despesa.")).not.toHaveLength(0);
    expect(bridge.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

describe("ativa / pausada", () => {
  it("desmarcar tira do total e aplica opacidade; marcar devolve", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        await api.post(`/despesas/espacos/${esp}/fixas`, { descricao: "Streaming", valor: 40 });
        await api.post(`/despesas/espacos/${esp}/fixas`, { descricao: "Aluguel", valor: 1000 });
      },
    });
    await goTo("fixas", user1);
    await screen.findByText(`${money(1040)}/mês`);

    const check = within(linhaDe("Streaming")).getByRole("checkbox");
    await user1.click(check);

    expect(await screen.findByText(`${money(1000)}/mês`)).toBeInTheDocument();
    expect(linhaDe("Streaming").className).toContain("opacity-50");
    const esp = await espacoAtivo(api);
    const pausada = (await api.get(`/despesas/espacos/${esp}`)).despesasFixas.find(
      (d: { descricao: string }) => d.descricao === "Streaming"
    );
    expect(pausada.ativa).toBe(false);

    await user1.click(within(linhaDe("Streaming")).getByRole("checkbox"));
    expect(await screen.findByText(`${money(1040)}/mês`)).toBeInTheDocument();
  });

  it("pausada não entra no resumo de pagamentos", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        const s = await api.post(`/despesas/espacos/${esp}/fixas`, { descricao: "Streaming", valor: 40 });
        await api.patch(`/despesas/espacos/${esp}/fixas/${s.id}`, { ativa: false });
        await api.post(`/despesas/espacos/${esp}/fixas`, { descricao: "Aluguel", valor: 1000 });
      },
    });
    await goTo("fixas", user1);
    await screen.findByText("Aluguel");

    // só o Aluguel conta: 0/1 pagas
    expect(screen.getByText(/0\/1 pagas/)).toBeInTheDocument();
  });
});

describe("parcelamento", () => {
  const comParcelada = (parcelaAtual: number, totalParcelas: number) =>
    renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        const cartao = await api.post("/cartoes", { nome: "Nubank", limite: 5000 });
        await api.post(`/despesas/espacos/${esp}/fixas`, {
          descricao: "Notebook",
          valor: 500,
          cartaoId: cartao.id,
          parcelado: true,
          parcelaAtual,
          totalParcelas,
        });
      },
    });

  it("mostra 'parcela X/Y · faltam N (R$ …)'", async () => {
    const { user1 } = await comParcelada(3, 10);
    await goTo("fixas", user1);

    const linha = linhaDe("Notebook");
    expect(within(linha).getByText(/parcela 3\/10/)).toBeInTheDocument();
    expect(within(linha).getByText(new RegExp(`faltam 7 \\(${money(3500).replace(/[.$()]/g, "\\$&")}`))).toBeInTheDocument();
  });

  it("última parcela mostra '· última'", async () => {
    const { user1 } = await comParcelada(10, 10);
    await goTo("fixas", user1);

    expect(within(linhaDe("Notebook")).getByText(/· última/)).toBeInTheDocument();
  });

  it("parcela quitada sai do total do mês e mostra 'parcelas quitadas'", async () => {
    const seguinte = addMeses(1);
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        const cartao = await api.post("/cartoes", { nome: "Nubank", limite: 5000 });
        // âncora 2/2 no mês corrente → no mês seguinte a parcela efetiva é a 3ª
        await api.post(`/despesas/espacos/${esp}/fixas`, {
          descricao: "Notebook",
          valor: 500,
          cartaoId: cartao.id,
          parcelado: true,
          parcelaAtual: 2,
          totalParcelas: 2,
        });
        // dá ao select uma opção pro mês seguinte
        await api.post(`/despesas/espacos/${esp}/mes`, {
          mes: seguinte,
          descricao: "Qualquer",
          valor: 10,
        });
      },
    });
    await goTo("fixas", user1);
    await screen.findByText("Notebook");
    expect(screen.getByText(`${money(500)}/mês`)).toBeInTheDocument();

    await user1.selectOptions(screen.getAllByRole("combobox")[0], seguinte);

    expect(await screen.findByText(/parcelas quitadas \(2\/2\)/)).toBeInTheDocument();
    expect(screen.getByText(`${money(0)}/mês`)).toBeInTheDocument();
    // e sem PagarControl, já que não cai no mês
    expect(within(linhaDe("Notebook")).queryByRole("button", { name: "Pagar" })).not.toBeInTheDocument();
  });

  it("editar re-ancora a parcela efetiva do mês (prefill mostra a atual)", async () => {
    const { user1, api } = await comParcelada(3, 10);
    await goTo("fixas", user1);

    await user1.click(await screen.findByRole("button", { name: "Editar Notebook" }));
    const dialog = await screen.findByRole("dialog");
    expect((campo(dialog, "Parcela atual") as HTMLInputElement).value).toBe("3");

    await digitarNumero(user1, campo(dialog, "Parcela atual"), 5);
    await user1.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await esperarSemDialog();
    expect(await screen.findByText(/parcela 5\/10/)).toBeInTheDocument();
    const esp = await espacoAtivo(api);
    expect((await api.get(`/despesas/espacos/${esp}`)).despesasFixas[0]).toMatchObject({
      parcelaAtual: 5,
      totalParcelas: 10,
    });
  });

  it("tirar o cartão limpa o parcelamento", async () => {
    const { user1, api } = await comParcelada(3, 10);
    await goTo("fixas", user1);

    await user1.click(await screen.findByRole("button", { name: "Editar Notebook" }));
    const dialog = await screen.findByRole("dialog");
    await user1.selectOptions(campo(dialog, "Cartão de crédito"), "");
    // sem cartão os campos de parcela somem
    expect(within(dialog).queryByText("Compra parcelada")).not.toBeInTheDocument();
    await user1.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await esperarSemDialog();
    const esp = await espacoAtivo(api);
    expect((await api.get(`/despesas/espacos/${esp}`)).despesasFixas[0]).toMatchObject({
      cartaoId: null,
      parcelado: false,
    });
    expect(screen.queryByText(/parcela /)).not.toBeInTheDocument();
  });

  it("parcelamento só existe com cartão selecionado", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        await cenarioBase(api);
        await api.post("/cartoes", { nome: "Nubank", limite: 5000 });
      },
    });
    await goTo("fixas", user1);

    await user1.click(screen.getByRole("button", { name: /Nova fixa/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("Compra parcelada")).not.toBeInTheDocument();

    await user1.selectOptions(campo(dialog, "Cartão de crédito"), "Nubank");
    expect(within(dialog).getByText("Compra parcelada")).toBeInTheDocument();
  });
});
