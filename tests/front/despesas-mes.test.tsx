// Despesas avulsas do mês + receitas extras: CRUD pelos modais, ordenação,
// badges (categoria/cartão), notas, confirmações de exclusão e o reflexo no
// resumo do mês.
import { beforeEach, describe, expect, it } from "bun:test";
import {
  addMeses,
  campo,
  digitarMoney,
  esperarSemDialog,
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
import { fmtMonthLabel } from "@/lib/format.js";

beforeEach(async () => {
  await resetDb();
  await seedRoles();
});

const ym = mesAtual();
const proximo = addMeses(1);

async function cenarioBase(api: Api) {
  const esp = await espacoAtivo(api);
  await api.patch(`/despesas/espacos/${esp}`, { rendaMensal: 5000 });
  return esp;
}

const linhas = () => screen.getAllByRole("listitem");

describe("despesas do mês — CRUD", () => {
  it("cria pelo modal, entra na lista e no resumo", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await cenarioBase(api); },
    });
    await goTo("fixas", user1);
    await screen.findByText("Nenhuma despesa lançada neste mês.");

    await user1.click(screen.getByRole("button", { name: /Adicionar/ }));
    const dialog = await screen.findByRole("dialog");
    const ui = within(dialog);
    expect(ui.getByText(`Despesa de ${fmtMonthLabel(ym)}`)).toBeInTheDocument();
    // data default = dia 15 do mês visto
    expect((campo(dialog, "Data") as HTMLInputElement).value).toBe(`${ym}-15`);

    await user1.type(ui.getByPlaceholderText(/Mercado, transporte/), "Mercado");
    await digitarMoney(user1, campo(dialog, "Valor"), "25050"); // 250,50
    await user1.click(ui.getByRole("button", { name: "Adicionar" }));

    await esperarSemDialog();
    expect(await screen.findByText("Mercado")).toBeInTheDocument();
    expect(screen.getAllByText(money(250.5)).length).toBeGreaterThan(0);

    const esp = await espacoAtivo(api);
    const orc = await api.get(`/despesas/espacos/${esp}`);
    expect(orc.despesasMes).toHaveLength(1);
    expect(orc.despesasMes[0]).toMatchObject({ descricao: "Mercado", valor: 250.5, mes: ym });
  });

  it("ordena por valor desc, independente da ordem de criação", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        await api.post(`/despesas/espacos/${esp}/mes`, { mes: ym, descricao: "Barata", valor: 20 });
        await api.post(`/despesas/espacos/${esp}/mes`, { mes: ym, descricao: "Cara", valor: 900 });
        await api.post(`/despesas/espacos/${esp}/mes`, { mes: ym, descricao: "Média", valor: 300 });
      },
    });
    await goTo("fixas", user1);
    await screen.findByText("Cara");

    const nomes = linhas().map((li) => li.textContent);
    expect(nomes[0]).toContain("Cara");
    expect(nomes[1]).toContain("Média");
    expect(nomes[2]).toContain("Barata");
  });

  it("editar muda valor e descrição", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        await api.post(`/despesas/espacos/${esp}/mes`, { mes: ym, descricao: "Mercado", valor: 100 });
      },
    });
    await goTo("fixas", user1);

    await user1.click(await screen.findByRole("button", { name: "Editar Mercado" }));
    const dialog = await screen.findByRole("dialog");
    const ui = within(dialog);
    const nome = ui.getByDisplayValue("Mercado");
    await user1.clear(nome);
    await user1.type(nome, "Feira");
    await digitarMoney(user1, campo(dialog, "Valor"), "18000");
    await user1.click(ui.getByRole("button", { name: "Salvar" }));

    await esperarSemDialog();
    expect(await screen.findByText("Feira")).toBeInTheDocument();
    const esp = await espacoAtivo(api);
    expect((await api.get(`/despesas/espacos/${esp}`)).despesasMes[0]).toMatchObject({
      descricao: "Feira",
      valor: 180,
    });
  });

  it("excluir pede confirmação e some da lista", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        await api.post(`/despesas/espacos/${esp}/mes`, { mes: ym, descricao: "Mercado", valor: 100 });
      },
    });
    await goTo("fixas", user1);

    await user1.click(await screen.findByRole("button", { name: "Remover Mercado" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(new RegExp(`Apaga essa despesa de ${fmtMonthLabel(ym)}`))).toBeInTheDocument();
    await user1.click(within(dialog).getByRole("button", { name: /Excluir/ }));

    await esperarSemDialog();
    expect(await screen.findByText("Nenhuma despesa lançada neste mês.")).toBeInTheDocument();
    const esp = await espacoAtivo(api);
    expect((await api.get(`/despesas/espacos/${esp}`)).despesasMes).toEqual([]);
  });

  it("cancelar a exclusão mantém a despesa", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        await api.post(`/despesas/espacos/${esp}/mes`, { mes: ym, descricao: "Mercado", valor: 100 });
      },
    });
    await goTo("fixas", user1);

    await user1.click(await screen.findByRole("button", { name: "Remover Mercado" }));
    await user1.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" }));

    await esperarSemDialog();
    expect(screen.getByText("Mercado")).toBeInTheDocument();
  });

  it("descrição ou valor vazios mostram erro inline sem request", async () => {
    const { user1, bridge } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await cenarioBase(api); },
    });
    await goTo("fixas", user1);

    await user1.click(screen.getByRole("button", { name: /Adicionar/ }));
    const dialog = await screen.findByRole("dialog");
    const ui = within(dialog);
    bridge.calls.length = 0;
    await user1.click(ui.getByRole("button", { name: "Adicionar" }));
    // com descrição E valor inválidos, os dois Fields mostram a mesma mensagem
    // (cada um testa a sua condição sobre o mesmo `err`)
    expect(await ui.findAllByText("Dê um nome para a despesa.")).toHaveLength(2);

    await user1.type(ui.getByPlaceholderText(/Mercado, transporte/), "Sem valor");
    await user1.click(ui.getByRole("button", { name: "Adicionar" }));
    expect(await ui.findAllByText("Informe um valor maior que zero.")).toHaveLength(1);
    expect(bridge.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("despesa de outro mês não aparece no mês visto", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        await api.post(`/despesas/espacos/${esp}/mes`, { mes: ym, descricao: "Deste mês", valor: 10 });
        await api.post(`/despesas/espacos/${esp}/mes`, { mes: proximo, descricao: "Do próximo", valor: 20 });
      },
    });
    await goTo("fixas", user1);
    await screen.findByText("Deste mês");

    expect(screen.queryByText("Do próximo")).not.toBeInTheDocument();

    await user1.selectOptions(screen.getAllByRole("combobox")[0], proximo);
    expect(await screen.findByText("Do próximo")).toBeInTheDocument();
    expect(screen.queryByText("Deste mês")).not.toBeInTheDocument();
  });
});

describe("badges e nota", () => {
  it("mostra categoria, cartão e a nota da despesa", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        const cat = await api.post("/categorias", { nome: "Casa", cor: "amber" });
        const cartao = await api.post("/cartoes", { nome: "Nubank", limite: 3000 });
        await api.post(`/despesas/espacos/${esp}/mes`, {
          mes: ym,
          descricao: "Geladeira",
          valor: 2500,
          categoriaId: cat.id,
          cartaoId: cartao.id,
          nota: "12x sem juros combinados",
        });
      },
    });
    await goTo("fixas", user1);

    const linha = (await screen.findByText("Geladeira")).closest("li")!;
    expect(within(linha).getByText("Casa")).toBeInTheDocument();
    expect(within(linha).getByText("Nubank")).toBeInTheDocument();
    expect(within(linha).getByText("12x sem juros combinados")).toBeInTheDocument();
  });
});

describe("receitas extras", () => {
  it("vazio traz a dica; criar soma no total do título e no 'Recebido'", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await cenarioBase(api); },
    });
    await goTo("fixas", user1);
    expect(await screen.findByText("Nenhuma receita extra neste mês.")).toBeInTheDocument();

    await user1.click(screen.getByRole("button", { name: /Lançar receita/ }));
    const dialog = await screen.findByRole("dialog");
    const ui = within(dialog);
    await user1.type(ui.getByPlaceholderText(/Freela, bônus/), "Freela");
    await digitarMoney(user1, campo(dialog, "Valor"), "80000"); // 800
    await user1.click(ui.getByRole("button", { name: "Adicionar" }));

    await esperarSemDialog();
    expect(await screen.findByText("Freela")).toBeInTheDocument();
    expect(screen.getByText(`+${money(800)}`)).toBeInTheDocument();
    // recebido = 5000 + 800
    expect(screen.getAllByText(money(5800)).length).toBeGreaterThan(0);
    // a linha "+ Receitas extras" só existe quando > 0
    expect(screen.getByText("+ Receitas extras")).toBeInTheDocument();

    const esp = await espacoAtivo(api);
    expect((await api.get(`/despesas/espacos/${esp}`)).receitasMes).toHaveLength(1);
  });

  it("sem receitas a linha '+ Receitas extras' não aparece no breakdown", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await cenarioBase(api); },
    });
    await goTo("fixas", user1);
    await screen.findByText("Nenhuma receita extra neste mês.");

    expect(screen.queryByText("+ Receitas extras")).not.toBeInTheDocument();
  });

  it("editar e excluir (com confirmação)", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        await api.post(`/despesas/espacos/${esp}/receitas`, {
          mes: ym,
          descricao: "Bônus",
          valor: 300,
        });
      },
    });
    await goTo("fixas", user1);

    await user1.click(await screen.findByRole("button", { name: "Editar Bônus" }));
    let ui = within(await screen.findByRole("dialog"));
    const nome = ui.getByDisplayValue("Bônus");
    await user1.clear(nome);
    await user1.type(nome, "Bônus anual");
    await user1.click(ui.getByRole("button", { name: "Salvar" }));
    await esperarSemDialog();
    expect(await screen.findByText("Bônus anual")).toBeInTheDocument();

    await user1.click(screen.getByRole("button", { name: "Remover Bônus anual" }));
    ui = within(await screen.findByRole("dialog"));
    expect(ui.getByText(new RegExp(`Apaga essa receita de ${fmtMonthLabel(ym)}`))).toBeInTheDocument();
    await user1.click(ui.getByRole("button", { name: /Excluir/ }));

    await esperarSemDialog();
    expect(await screen.findByText("Nenhuma receita extra neste mês.")).toBeInTheDocument();
    const esp = await espacoAtivo(api);
    expect((await api.get(`/despesas/espacos/${esp}`)).receitasMes).toEqual([]);
  });
});
