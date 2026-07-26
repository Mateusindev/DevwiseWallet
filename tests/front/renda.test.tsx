// RecebidoCard: salário fixo do espaço vs override de um mês só, promoção a
// fixo (grava o fixo E apaga o override), Enter salvando, e o reflexo no resumo.
import { beforeEach, describe, expect, it } from "bun:test";
import {
  addMeses,
  digitarMoney,
  esperarAusente,
  espacoAtivo,
  goTo,
  mesAtual,
  money,
  renderApp,
  resetDb,
  screen,
  seedRoles,
  within,
} from "./harness";
import { fmtMonthLabel } from "@/lib/format.js";

beforeEach(async () => {
  await resetDb();
  await seedRoles();
});

const ym = mesAtual();
const anterior = addMeses(-1);

// O bloco do salário: a label do mês + (em edição) o input, o ✓ e o checkbox.
const blocoSalario = (mes = ym) =>
  screen.getByText(`Salário em ${fmtMonthLabel(mes)}`).closest("div")!;
const editar = () => screen.getByRole("button", { name: /^Editar$/ });
const inputSalario = () =>
  blocoSalario().querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
// O ✓ é só ícone (sem aria-label — ver Achado 10): é o único button do bloco.
const salvar = () => within(blocoSalario()).getByRole("button");
const checkFixo = () => within(blocoSalario()).getByRole("checkbox");

describe("estado inicial", () => {
  it("sem nada configurado mostra 'Sem salário definido' e zero", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await espacoAtivo(api); },
    });
    await goTo("fixas", user1);

    expect(await screen.findByText("Sem salário definido")).toBeInTheDocument();
    expect(screen.getAllByText(money(0)).length).toBeGreaterThan(0);
  });

  it("salário fixo do espaço aparece como 'todos os meses'", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await espacoAtivo(api);
        await api.patch(`/despesas/espacos/${esp}`, { rendaMensal: 4000 });
      },
    });
    await goTo("fixas", user1);

    expect(await screen.findByText("Salário fixo — todos os meses")).toBeInTheDocument();
    expect(screen.getAllByText(money(4000)).length).toBeGreaterThan(0);
  });

  it("override do mês vence o fixo e é sinalizado como 'só neste mês'", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await espacoAtivo(api);
        await api.patch(`/despesas/espacos/${esp}`, { rendaMensal: 4000 });
        await api.put(`/despesas/espacos/${esp}/rendas/${ym}`, { valor: 5500 });
      },
    });
    await goTo("fixas", user1);

    expect(await screen.findByText("Só neste mês (edite p/ tornar fixo)")).toBeInTheDocument();
    expect(screen.getAllByText(money(5500)).length).toBeGreaterThan(0);
    expect(screen.queryByText(money(4000))).not.toBeInTheDocument();
  });
});

describe("editar", () => {
  const comEspaco = () =>
    renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await espacoAtivo(api); },
    });

  it("marcado como fixo grava o salário do espaço (vale nos outros meses)", async () => {
    const { user1, api } = await comEspaco();
    await goTo("fixas", user1);

    await user1.click(editar());
    await digitarMoney(user1, inputSalario(), "300000");
    await user1.click(salvar());

    expect(await screen.findByText("Salário fixo — todos os meses")).toBeInTheDocument();
    const esp = await espacoAtivo(api);
    const orc = await api.get(`/despesas/espacos/${esp}`);
    expect(orc.config.rendaMensal).toBe(3000);
    expect(orc.rendasMensais).toEqual({});
  });

  it("desmarcado grava override só do mês (o fixo continua zero)", async () => {
    const { user1, api } = await comEspaco();
    await goTo("fixas", user1);

    await user1.click(editar());
    await digitarMoney(user1, inputSalario(), "250000");
    await user1.click(checkFixo()); // desmarca "fixo" → override do mês
    await user1.click(salvar());

    expect(await screen.findByText("Só neste mês (edite p/ tornar fixo)")).toBeInTheDocument();
    const esp = await espacoAtivo(api);
    const orc = await api.get(`/despesas/espacos/${esp}`);
    expect(orc.config.rendaMensal).toBe(0);
    expect(orc.rendasMensais).toEqual({ [ym]: 2500 });
  });

  it("promover a fixo grava o fixo E apaga o override do mês", async () => {
    const { user1, api, bridge } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await espacoAtivo(api);
        await api.put(`/despesas/espacos/${esp}/rendas/${ym}`, { valor: 5000 });
      },
    });
    await goTo("fixas", user1);
    expect(await screen.findByText("Só neste mês (edite p/ tornar fixo)")).toBeInTheDocument();

    await user1.click(editar());
    // o checkbox abre desmarcado porque existe override; marcar promove a fixo
    expect(checkFixo()).not.toBeChecked();
    await user1.click(checkFixo());
    bridge.calls.length = 0;
    await user1.click(salvar());

    expect(await screen.findByText("Salário fixo — todos os meses")).toBeInTheDocument();
    // dois requests: PATCH do espaço (fixo) + DELETE do override
    expect(bridge.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);
    expect(bridge.calls.filter((c) => c.method === "DELETE")).toHaveLength(1);

    const esp = await espacoAtivo(api);
    const orc = await api.get(`/despesas/espacos/${esp}`);
    expect(orc.config.rendaMensal).toBe(5000);
    expect(orc.rendasMensais).toEqual({});
  });

  it("Enter no campo salva sem clicar no ✓", async () => {
    const { user1, api } = await comEspaco();
    await goTo("fixas", user1);

    await user1.click(editar());
    await digitarMoney(user1, inputSalario(), "180000");
    await user1.type(inputSalario(), "{enter}");

    expect(await screen.findByText("Salário fixo — todos os meses")).toBeInTheDocument();
    const esp = await espacoAtivo(api);
    expect((await api.get(`/despesas/espacos/${esp}`)).config.rendaMensal).toBe(1800);
  });

  it("o valor entra no resumo (Recebido e Sobrou)", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await espacoAtivo(api);
        await api.patch(`/despesas/espacos/${esp}`, { rendaMensal: 3000 });
        await api.post(`/despesas/espacos/${esp}/fixas`, { descricao: "Aluguel", valor: 1200 });
        await api.post(`/despesas/espacos/${esp}/mes`, {
          mes: ym,
          descricao: "Mercado",
          valor: 300,
        });
      },
    });
    await goTo("fixas", user1);
    await screen.findByText("Aluguel");

    // recebido 3000 · saiu 1500 · sobrou 1500
    expect(screen.getAllByText(money(3000)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(money(1500)).length).toBeGreaterThan(1);
    expect(screen.getByText("= Sobrou")).toBeInTheDocument();
  });

  it("override não vaza pro mês anterior", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await espacoAtivo(api);
        await api.patch(`/despesas/espacos/${esp}`, { rendaMensal: 2000 });
        await api.put(`/despesas/espacos/${esp}/rendas/${ym}`, { valor: 9000 });
        await api.put(`/despesas/espacos/${esp}/rendas/${anterior}`, { valor: 2000 });
      },
    });
    await goTo("fixas", user1);
    await screen.findByText("Só neste mês (edite p/ tornar fixo)");

    await user1.selectOptions(screen.getAllByRole("combobox")[0], anterior);

    expect(await screen.findByText(`Salário em ${fmtMonthLabel(anterior)}`)).toBeInTheDocument();
    expect(screen.queryByText(money(9000))).not.toBeInTheDocument();
    expect(screen.getAllByText(money(2000)).length).toBeGreaterThan(0);
  });

  it("digitar sem salvar não manda request nenhum", async () => {
    const { user1, api, bridge } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await espacoAtivo(api);
        await api.patch(`/despesas/espacos/${esp}`, { rendaMensal: 1000 });
      },
    });
    await goTo("fixas", user1);
    await screen.findByText("Salário fixo — todos os meses");

    await user1.click(editar());
    // em edição o "Editar" sai de cena
    await esperarAusente(() => screen.queryByRole("button", { name: /^Editar$/ }), "botão Editar");
    bridge.calls.length = 0;
    await digitarMoney(user1, inputSalario(), "999999");

    expect(bridge.calls).toHaveLength(0);
    const esp = await espacoAtivo(api);
    expect((await api.get(`/despesas/espacos/${esp}`)).config.rendaMensal).toBe(1000);
  });
});
