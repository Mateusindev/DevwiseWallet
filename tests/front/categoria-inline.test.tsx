// CategoriaField: criar categoria de dentro do form de despesa. O modal vive
// num portal (senão seria <form> dentro de <form>) e a categoria criada já sai
// selecionada no select que a abriu.
import { beforeEach, describe, expect, it } from "bun:test";
import {
  campo,
  digitarMoney,
  esperarSemDialog,
  espacoAtivo,
  goTo,
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

const NOVA = "__nova__";

async function abrirFormFixa(opts: Parameters<typeof renderApp>[0] = {}) {
  const ctx = await renderApp({
    roles: ["admin"],
    skipReset: true,
    setup: async ({ api }) => { await espacoAtivo(api); },
    ...opts,
  });
  await goTo("fixas", ctx.user1);
  await ctx.user1.click(await screen.findByRole("button", { name: /Nova fixa/ }));
  const dialog = await screen.findByRole("dialog");
  return { ...ctx, dialog, ui: within(dialog) };
}

describe("criar categoria de dentro do form", () => {
  it("a opção '+ Nova categoria…' abre o modal em outro portal", async () => {
    const { user1, dialog } = await abrirFormFixa();

    await user1.selectOptions(campo(dialog, "Categoria"), NOVA);

    const dialogs = await screen.findAllByRole("dialog");
    expect(dialogs).toHaveLength(2); // o da despesa + o da categoria
    const catModal = dialogs.find((d) => d.getAttribute("aria-label") === "Nova categoria")!;
    expect(catModal).toBeDefined();
    // o modal da categoria NÃO está dentro do form da despesa
    expect(dialog.contains(catModal)).toBe(false);
    expect(catModal.querySelectorAll("form")).toHaveLength(1);
  });

  it("a categoria criada já sai selecionada e é gravada com a despesa", async () => {
    const { user1, dialog, ui, api } = await abrirFormFixa();

    await user1.selectOptions(campo(dialog, "Categoria"), NOVA);
    const catModal = (await screen.findAllByRole("dialog")).find(
      (d) => d.getAttribute("aria-label") === "Nova categoria"
    )!;
    const catUi = within(catModal);
    await user1.type(catUi.getByPlaceholderText(/Moradia, Alimentação/), "Rolês");
    await user1.click(catUi.getByRole("button", { name: "emerald" }));
    await user1.click(catUi.getByRole("button", { name: "Criar categoria" }));

    // o modal da categoria fecha, o da despesa continua
    await screen.findByRole("dialog");
    // o boot já cria categorias padrão (Moradia, Lazer, …) — nome novo pra não colidir
    const criada = (await api.get("/categorias")).find((c: { nome: string }) => c.nome === "Rolês");
    expect(criada).toMatchObject({ nome: "Rolês", cor: "emerald" });

    const select = campo(dialog, "Categoria") as HTMLSelectElement;
    expect(select.value).toBe(criada.id);
    expect(within(select).getByRole("option", { name: "Rolês" })).toBeInTheDocument();

    // salvar a fixa leva a categoria junto
    await user1.type(ui.getByPlaceholderText(/Aluguel, internet/), "Cinema");
    await digitarMoney(user1, campo(dialog, "Valor mensal"), "5000");
    await user1.click(ui.getByRole("button", { name: "Salvar" }));

    await esperarSemDialog();
    const esp = await espacoAtivo(api);
    const [fixa] = (await api.get(`/despesas/espacos/${esp}`)).despesasFixas;
    expect(fixa).toMatchObject({ descricao: "Cinema", categoriaId: criada.id });
    expect(within(screen.getByText("Cinema").closest("li")!).getByText("Rolês")).toBeInTheDocument();
  });

  it("cancelar o modal deixa o select em 'Sem categoria'", async () => {
    const { user1, dialog } = await abrirFormFixa();

    await user1.selectOptions(campo(dialog, "Categoria"), NOVA);
    const catModal = (await screen.findAllByRole("dialog")).find(
      (d) => d.getAttribute("aria-label") === "Nova categoria"
    )!;
    await user1.click(within(catModal).getByRole("button", { name: "Cancelar" }));

    expect((campo(dialog, "Categoria") as HTMLSelectElement).value).toBe("");
  });

  it("nome vazio mostra erro inline sem criar", async () => {
    const { user1, dialog, bridge } = await abrirFormFixa();

    await user1.selectOptions(campo(dialog, "Categoria"), NOVA);
    const catModal = (await screen.findAllByRole("dialog")).find(
      (d) => d.getAttribute("aria-label") === "Nova categoria"
    )!;
    bridge.calls.length = 0;
    await user1.click(within(catModal).getByRole("button", { name: "Criar categoria" }));

    expect(await within(catModal).findByRole("alert")).toHaveTextContent(
      "Dê um nome para a categoria."
    );
    expect(bridge.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("sem categoria:manage a opção não existe", async () => {
    const { dialog } = await abrirFormFixa({
      roles: undefined,
      permissions: [
        "state:view",
        "caixinha:view",
        "cartao:view",
        "espaco:view",
        "orcamento:view",
        "orcamento:manage",
        "categoria:view",
      ],
    });

    const opcoes = within(campo(dialog, "Categoria"))
      .getAllByRole("option")
      .map((o) => (o as HTMLOptionElement).value);
    // as categorias padrão continuam listadas — só o atalho de criar some
    expect(opcoes).not.toContain(NOVA);
    expect(opcoes.length).toBeGreaterThan(1);
    expect(within(dialog).queryByText("+ Nova categoria…")).not.toBeInTheDocument();
  });

  it("a mesma opção existe no form de despesa do mês", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await espacoAtivo(api); },
    });
    await goTo("fixas", user1);

    await user1.click(await screen.findByRole("button", { name: /Adicionar/ }));
    const dialog = await screen.findByRole("dialog");
    await user1.selectOptions(campo(dialog, "Categoria"), NOVA);

    const catModal = (await screen.findAllByRole("dialog")).find(
      (d) => d.getAttribute("aria-label") === "Nova categoria"
    )!;
    expect(catModal).toBeDefined();
  });
});
