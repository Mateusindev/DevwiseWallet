// Cartões: CRUD pelo modal, totais e agregados de fatura (todos calculados no
// back), troca de mês, "estourado" e o SetNull nas despesas ao excluir.
import { beforeEach, describe, expect, it } from "bun:test";
import {
  addMeses,
  campo,
  diaDoMes,
  digitarMoney,
  digitarNumero,
  esperarAusente,
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

const cardDe = (nome: string) =>
  screen.getByText(nome).closest<HTMLElement>("div.rounded-2xl")!;

async function comCartao(api: Api, { limite = 5000 } = {}) {
  const esp = await espacoAtivo(api);
  const cartao = await api.post("/cartoes", {
    nome: "Nubank",
    limite,
    diaVencimento: 10,
    diaFechamento: 3,
    bandeira: "Visa",
  });
  return { esp, cartao };
}

describe("lista", () => {
  it("sem cartões mostra o vazio e nenhum total", async () => {
    const { user1 } = await renderApp({ roles: ["admin"], skipReset: true });
    await goTo("cartoes", user1);

    expect(await screen.findByText("Nenhum cartão cadastrado.")).toBeInTheDocument();
    expect(screen.queryByText("Limite total")).not.toBeInTheDocument();
  });

  it("card traz limite, vencimento, fechamento e bandeira", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await comCartao(api); },
    });
    await goTo("cartoes", user1);

    const card = cardDe("Nubank");
    expect(within(card).getByText(`Visa · limite ${money(5000)}`)).toBeInTheDocument();
    expect(within(card).getByText(/Vence dia 10 · fecha dia 3/)).toBeInTheDocument();
    expect(within(card).getByText("Fatura do mês")).toBeInTheDocument();
    expect(within(card).getByText("Parcelas em aberto")).toBeInTheDocument();
  });

  it("totais somam limite e comprometido de todos os cartões", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const { esp, cartao } = await comCartao(api, { limite: 4000 });
        await api.post("/cartoes", { nome: "Inter", limite: 1000, diaVencimento: 5 });
        await api.post(`/despesas/espacos/${esp}/mes`, {
          mes: ym,
          descricao: "Compra",
          valor: 1000,
          data: diaDoMes(10),
          cartaoId: cartao.id,
        });
      },
    });
    await goTo("cartoes", user1);

    expect(await screen.findByText("Limite total")).toBeInTheDocument();
    expect(screen.getByText(money(5000))).toBeInTheDocument(); // 4000 + 1000
    expect(screen.getAllByText(money(1000)).length).toBeGreaterThan(0); // comprometido
    expect(screen.getAllByText(money(4000)).length).toBeGreaterThan(0); // disponível
    expect(screen.getByText("20%")).toBeInTheDocument(); // 1000 / 5000
  });
});

describe("agregados vindos do back", () => {
  it("fatura do mês soma despesas avulsas e fixas do cartão", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const { esp, cartao } = await comCartao(api, { limite: 5000 });
        await api.post(`/despesas/espacos/${esp}/mes`, {
          mes: ym,
          descricao: "Mercado",
          valor: 300,
          data: diaDoMes(5),
          cartaoId: cartao.id,
        });
        await api.post(`/despesas/espacos/${esp}/fixas`, {
          descricao: "Streaming",
          valor: 50,
          cartaoId: cartao.id,
        });
      },
    });
    await goTo("cartoes", user1);

    const card = cardDe("Nubank");
    expect(within(card).getByText(money(350))).toBeInTheDocument();
    expect(within(card).getByText(money(4650))).toBeInTheDocument(); // disponível
  });

  it("parcelas futuras entram em 'Parcelas em aberto', não na fatura do mês", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const { esp, cartao } = await comCartao(api, { limite: 5000 });
        // 1/4 de 100 → 100 no mês + 300 comprometidos
        await api.post(`/despesas/espacos/${esp}/fixas`, {
          descricao: "Notebook",
          valor: 100,
          cartaoId: cartao.id,
          parcelado: true,
          parcelaAtual: 1,
          totalParcelas: 4,
        });
      },
    });
    await goTo("cartoes", user1);

    const card = cardDe("Nubank");
    expect(within(card).getByText(money(100))).toBeInTheDocument();
    expect(within(card).getByText(money(300))).toBeInTheDocument();
    expect(within(card).getByText(money(4600))).toBeInTheDocument();
  });

  it("estourar o limite pinta o disponível de negativo", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const { esp, cartao } = await comCartao(api, { limite: 200 });
        await api.post(`/despesas/espacos/${esp}/mes`, {
          mes: ym,
          descricao: "Compra grande",
          valor: 500,
          data: diaDoMes(2),
          cartaoId: cartao.id,
        });
      },
    });
    await goTo("cartoes", user1);

    const card = cardDe("Nubank");
    const negativo = within(card).getByText(`-${money(300)}`);
    expect(negativo.className).toContain("text-rose-400");
  });

  it("trocar o mês recarrega os agregados", async () => {
    const proximo = addMeses(1);
    const { user1, bridge } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const { esp, cartao } = await comCartao(api, { limite: 5000 });
        await api.post(`/despesas/espacos/${esp}/mes`, {
          mes: ym,
          descricao: "Deste mês",
          valor: 400,
          data: diaDoMes(5),
          cartaoId: cartao.id,
        });
        await api.post(`/despesas/espacos/${esp}/mes`, {
          mes: proximo,
          descricao: "Do próximo",
          valor: 900,
          data: `${proximo}-05`,
          cartaoId: cartao.id,
        });
      },
    });
    await goTo("cartoes", user1);
    expect(await within(cardDe("Nubank")).findByText(money(400))).toBeInTheDocument();

    bridge.calls.length = 0;
    await user1.selectOptions(screen.getAllByRole("combobox")[0], proximo);

    expect(await within(cardDe("Nubank")).findByText(money(900))).toBeInTheDocument();
    expect(bridge.calls.some((c) => c.path.includes(`/api/cartoes?ym=${proximo}`))).toBe(true);
  });

  it("o select cobre de −3 a +6 meses", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await comCartao(api); },
    });
    await goTo("cartoes", user1);

    const opcoes = within(screen.getAllByRole("combobox")[0])
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    expect(opcoes).toHaveLength(10);
    expect(opcoes[0]).toBe(addMeses(-3));
    expect(opcoes.at(-1)).toBe(addMeses(6));
    expect(opcoes).toContain(ym);
  });
});

describe("CRUD", () => {
  it("cria pelo modal", async () => {
    const { user1, api } = await renderApp({ roles: ["admin"], skipReset: true });
    await goTo("cartoes", user1);

    await user1.click(await screen.findByRole("button", { name: /Novo cartão/ }));
    const dialog = await screen.findByRole("dialog");
    const ui = within(dialog);
    await user1.type(ui.getByPlaceholderText(/Nubank, Inter/), "Inter");
    await user1.type(ui.getByPlaceholderText(/Visa, Master/), "Master");
    await digitarMoney(user1, campo(dialog, "Limite"), "300000"); // 3.000,00
    await digitarNumero(user1, campo(dialog, "Dia do vencimento"), 15);
    await user1.click(ui.getByRole("button", { name: "Criar cartão" }));

    await esperarSemDialog();
    expect(await screen.findByText("Inter")).toBeInTheDocument();
    expect((await api.get("/cartoes"))[0]).toMatchObject({
      nome: "Inter",
      bandeira: "Master",
      limite: 3000,
      diaVencimento: 15,
      diaFechamento: null, // campo vazio vira null
    });
  });

  it("editar altera nome e limite", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await comCartao(api); },
    });
    await goTo("cartoes", user1);

    await user1.click(await screen.findByRole("button", { name: "Editar cartão" }));
    const dialog = await screen.findByRole("dialog");
    const nome = within(dialog).getByDisplayValue("Nubank");
    await user1.clear(nome);
    await user1.type(nome, "Nubank Ultravioleta");
    await digitarMoney(user1, campo(dialog, "Limite"), "1000000"); // 10.000,00
    await user1.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await esperarSemDialog();
    expect(await screen.findByText("Nubank Ultravioleta")).toBeInTheDocument();
    expect((await api.get("/cartoes"))[0]).toMatchObject({ limite: 10000 });
  });

  it("nome vazio mostra erro inline sem request", async () => {
    const { user1, bridge } = await renderApp({ roles: ["admin"], skipReset: true });
    await goTo("cartoes", user1);

    await user1.click(await screen.findByRole("button", { name: /Novo cartão/ }));
    const ui = within(await screen.findByRole("dialog"));
    bridge.calls.length = 0;
    await user1.click(ui.getByRole("button", { name: "Criar cartão" }));

    expect(await ui.findByRole("alert")).toHaveTextContent("Dê um nome para o cartão.");
    expect(bridge.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("excluir confirma no modal e desvincula as despesas (SetNull)", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const { esp, cartao } = await comCartao(api);
        await api.post(`/despesas/espacos/${esp}/mes`, {
          mes: ym,
          descricao: "Mercado",
          valor: 100,
          data: diaDoMes(4),
          cartaoId: cartao.id,
        });
      },
    });
    await goTo("cartoes", user1);

    await user1.click(await screen.findByRole("button", { name: "Remover cartão" }));

    // confirma no modal, como as outras exclusões do app
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/perdem o cartão/)).toBeInTheDocument();
    expect(await api.get("/cartoes")).toHaveLength(1); // nada excluído ainda
    await user1.click(within(dialog).getByRole("button", { name: "Excluir" }));

    await esperarAusente(() => screen.queryByText("Nubank"), "card do cartão");
    await esperarSemDialog();
    expect(await api.get("/cartoes")).toEqual([]);

    // SetNull: a despesa continua, sem cartão
    const esp = await espacoAtivo(api);
    const orc = await api.get(`/despesas/espacos/${esp}`);
    expect(orc.despesasMes).toHaveLength(1);
    expect(orc.despesasMes[0].cartaoId).toBeNull();
  });

  it("cancelar a exclusão não manda DELETE", async () => {
    const { user1, api, bridge } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await comCartao(api); },
    });
    await goTo("cartoes", user1);

    await user1.click(await screen.findByRole("button", { name: "Remover cartão" }));
    const dialog = await screen.findByRole("dialog");
    bridge.calls.length = 0;
    await user1.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await esperarSemDialog();
    expect(bridge.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    expect(await api.get("/cartoes")).toHaveLength(1);
    expect(screen.getByText("Nubank")).toBeInTheDocument();
  });

  it("cor escolhida é gravada", async () => {
    const { user1, api } = await renderApp({ roles: ["admin"], skipReset: true });
    await goTo("cartoes", user1);

    await user1.click(await screen.findByRole("button", { name: /Novo cartão/ }));
    const dialog = await screen.findByRole("dialog");
    await user1.type(within(dialog).getByPlaceholderText(/Nubank, Inter/), "Verde");
    await user1.click(within(dialog).getByRole("button", { name: "emerald" }));
    await user1.click(within(dialog).getByRole("button", { name: "Criar cartão" }));

    await esperarSemDialog();
    expect((await api.get("/cartoes"))[0].cor).toBe("emerald");
  });
});

describe("mês no cabeçalho", () => {
  it("começa no mês corrente", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await comCartao(api); },
    });
    await goTo("cartoes", user1);

    const select = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    expect(select.value).toBe(ym);
    expect(within(select).getByText(fmtMonthLabel(ym))).toBeInTheDocument();
  });
});
