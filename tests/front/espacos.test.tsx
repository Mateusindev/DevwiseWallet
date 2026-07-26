// EspacoTabs: troca de aba (recarrega só o orçamento), criar, ocultar/restaurar
// no mês (exclusão reversível), excluir permanente, as duas guardas e o pulo
// automático quando a página ativa fica oculta no mês visto.
import { beforeEach, describe, expect, it } from "bun:test";
import {
  addMeses,
  esperarAusente,
  esperarSemDialog,
  espacoAtivo,
  goTo,
  mesAtual,
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

// Duas páginas: a default ("Nosso"/primeira) com Aluguel, e "Viagem" com Passagem.
async function duasPaginas(api: Api) {
  const esp = await espacoAtivo(api);
  await api.post(`/despesas/espacos/${esp}/fixas`, { descricao: "Aluguel", valor: 600 });
  const outra = await api.post("/despesas/espacos", { nome: "Viagem", emoji: "✈️" });
  await api.post(`/despesas/espacos/${outra.id}/fixas`, { descricao: "Passagem", valor: 900 });
  await api.put("/despesas/espacos/active", { id: esp }); // criar torna o novo ativo
  return { esp, outra: outra.id };
}

const abaDe = (nome: string) => {
  const [botao] = screen.getAllByRole("button", { name: new RegExp(nome) });
  return botao;
};

describe("troca de aba", () => {
  it("recarrega só o orçamento; caixinhas seguem intactas", async () => {
    const { user1, bridge } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        await api.post("/caixinhas", { nome: "Reserva", aporteMensal: 100 });
        await duasPaginas(api);
      },
    });
    await goTo("fixas", user1);
    expect(await screen.findByText("Aluguel")).toBeInTheDocument();

    bridge.calls.length = 0;
    await user1.click(abaDe("Viagem"));

    expect(await screen.findByText("Passagem")).toBeInTheDocument();
    expect(screen.queryByText("Aluguel")).not.toBeInTheDocument();
    // nenhum GET /state: caixinhas não são recarregadas na troca de página
    expect(bridge.calls.filter((c) => c.path === "/api/state")).toHaveLength(0);
    expect(bridge.calls.some((c) => c.method === "PUT" && c.path.endsWith("/active"))).toBe(true);

    await goTo("dashboard", user1);
    expect(await screen.findByRole("button", { name: "Abrir Reserva" })).toBeInTheDocument();
  });

  it("aba ativa é marcada com aria-current", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await duasPaginas(api); },
    });
    await goTo("fixas", user1);

    await user1.click(abaDe("Viagem"));
    expect(await screen.findByText("Passagem")).toBeInTheDocument();
    expect(abaDe("Viagem")).toHaveAttribute("aria-current", "true");
  });
});

describe("criar página", () => {
  it("o espaço criado vira o ativo", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await espacoAtivo(api); },
    });
    await goTo("fixas", user1);

    await user1.click(screen.getByRole("button", { name: "Novo espaço de despesa" }));
    const dialog = await screen.findByRole("dialog");
    const ui = within(dialog);
    await user1.type(ui.getByPlaceholderText(/Nosso, Meu/), "Casa nova");
    await user1.click(ui.getByRole("button", { name: "Criar espaço" }));

    expect(await screen.findByText(/Despesas · Casa nova/)).toBeInTheDocument();
    const { activeEspacoId, espacos } = await api.get("/despesas/espacos");
    expect(espacos.find((e: { id: string }) => e.id === activeEspacoId).nome).toBe("Casa nova");
  });

  it("nome vazio mostra erro inline", async () => {
    const { user1, bridge } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await espacoAtivo(api); },
    });
    await goTo("fixas", user1);

    await user1.click(screen.getByRole("button", { name: "Novo espaço de despesa" }));
    const dialog = await screen.findByRole("dialog");
    bridge.calls.length = 0;
    await within(dialog).getByRole("button", { name: "Criar espaço" }).click();

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Dê um nome para o espaço.");
    expect(bridge.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });
});

describe("ocultar do mês (reversível)", () => {
  it("some da barra, aparece na faixa 'Ocultas em <mês>' e volta ao restaurar", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await duasPaginas(api); },
    });
    await goTo("fixas", user1);

    await user1.click(screen.getByRole("button", { name: `Ocultar Viagem de ${fmtMonthLabel(ym)}` }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Some só deste mês/)).toBeInTheDocument();
    await user1.click(within(dialog).getByRole("button", { name: /Ocultar do mês/ }));

    await esperarSemDialog();
    expect(await screen.findByText(`Ocultas em ${fmtMonthLabel(ym)}:`)).toBeInTheDocument();
    // o back registrou
    const { espacosOcultos } = await api.get("/state");
    expect(espacosOcultos).toEqual([{ espacoId: expect.any(String), ym }]);

    // restaurar volta a aba (o botão da faixa se identifica pelo title)
    await user1.click(screen.getByTitle(/^Restaurar Viagem/));
    await esperarAusente(
      () => screen.queryByText(`Ocultas em ${fmtMonthLabel(ym)}:`),
      "faixa de ocultas"
    );
    expect((await api.get("/state")).espacosOcultos).toEqual([]);
  });

  it("ocultar é só daquele mês — no mês seguinte a página continua lá", async () => {
    const outroMes = addMeses(1);
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const { esp, outra } = await duasPaginas(api);
        await api.post(`/despesas/espacos/${outra}/ocultar/${ym}`);
        // o select de mês vem do orçamento da página ATIVA — a despesa do mês
        // seguinte precisa estar nela, senão a opção não existe
        await api.post(`/despesas/espacos/${esp}/mes`, {
          mes: outroMes,
          descricao: "Hotel",
          valor: 300,
        });
      },
    });
    await goTo("fixas", user1);

    expect(await screen.findByText(`Ocultas em ${fmtMonthLabel(ym)}:`)).toBeInTheDocument();

    await user1.selectOptions(screen.getAllByRole("combobox")[0], outroMes);

    expect(screen.queryByText(`Ocultas em ${fmtMonthLabel(outroMes)}:`)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Viagem/ }).length).toBeGreaterThan(0);
  });

  it("ocultar a página ATIVA pula pra primeira visível", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const { outra } = await duasPaginas(api);
        await api.put("/despesas/espacos/active", { id: outra });
      },
    });
    await goTo("fixas", user1);
    expect(await screen.findByText("Passagem")).toBeInTheDocument();

    await user1.click(screen.getByRole("button", { name: `Ocultar Viagem de ${fmtMonthLabel(ym)}` }));
    await user1.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: /Ocultar do mês/ })
    );

    expect(await screen.findByText("Aluguel")).toBeInTheDocument();
    const { activeEspacoId, espacos } = await api.get("/despesas/espacos");
    expect(espacos.find((e: { id: string }) => e.id === activeEspacoId).nome).not.toBe("Viagem");
  });

  it("trocar o mês pra um onde a ativa está oculta também pula (efeito no mount)", async () => {
    const outroMes = addMeses(-1);
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const { outra } = await duasPaginas(api);
        await api.put("/despesas/espacos/active", { id: outra });
        await api.post(`/despesas/espacos/${outra}/ocultar/${outroMes}`);
        // garante o mês anterior no select
        await api.post(`/despesas/espacos/${outra}/mes`, {
          mes: outroMes,
          descricao: "Hotel",
          valor: 300,
        });
      },
    });
    await goTo("fixas", user1);
    expect(await screen.findByText("Passagem")).toBeInTheDocument();

    await user1.selectOptions(screen.getAllByRole("combobox")[0], outroMes);

    // pulou pra primeira visível naquele mês
    expect(await screen.findByText("Aluguel")).toBeInTheDocument();
  });
});

describe("excluir permanentemente", () => {
  it("aviso, remoção da barra e dados do espaço somem", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await duasPaginas(api); },
    });
    await goTo("fixas", user1);

    await user1.click(screen.getByRole("button", { name: "Excluir Viagem permanentemente" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/todos os dados dele em todos os meses/)).toBeInTheDocument();
    await user1.click(within(dialog).getByRole("button", { name: /Excluir permanentemente/ }));

    await esperarSemDialog();
    const { espacos } = await api.get("/despesas/espacos");
    expect(espacos.map((e: { nome: string }) => e.nome)).not.toContain("Viagem");
    expect(screen.queryByText("Passagem")).not.toBeInTheDocument();
  });

  it("cancelar não exclui", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await duasPaginas(api); },
    });
    await goTo("fixas", user1);

    await user1.click(screen.getByRole("button", { name: "Excluir Viagem permanentemente" }));
    await user1.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancelar" })
    );

    await esperarSemDialog();
    expect((await api.get("/despesas/espacos")).espacos).toHaveLength(2);
  });
});

describe("guardas", () => {
  it("com uma página só, nem ocultar nem excluir aparecem", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await espacoAtivo(api); },
    });
    await goTo("fixas", user1);
    await screen.findByText(/^Despesas ·/);

    expect(screen.queryByRole("button", { name: /^Ocultar / })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /permanentemente$/ })).not.toBeInTheDocument();
  });

  it("com duas, o 'ocultar' da última visível some quando a outra já está oculta", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const { outra } = await duasPaginas(api);
        await api.post(`/despesas/espacos/${outra}/ocultar/${ym}`);
      },
    });
    await goTo("fixas", user1);
    await screen.findByText("Aluguel");

    // só uma visível no mês → o X sai de cena, mas a lixeira permanente fica
    // (a guarda dela olha o total de espaços, não os visíveis no mês)
    expect(screen.queryByRole("button", { name: /^Ocultar / })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /permanentemente$/ })).toBeInTheDocument();
  });
});
