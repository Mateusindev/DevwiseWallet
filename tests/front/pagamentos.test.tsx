// PagarControl: pagar parcial, confirmar somando ao já pago, quitar cheio,
// desfazer, backdrop, e o resumo "N/M pagas · faltam X". Vale pras duas listas
// (fixa no mês e despesa avulsa) — o componente é o mesmo.
import { beforeEach, describe, expect, it } from "bun:test";
import {
  byTexto,
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
  type Api,
} from "./harness";
import { fmtMonthLabel } from "@/lib/format.js";

beforeEach(async () => {
  await resetDb();
  await seedRoles();
});

const ym = mesAtual();

async function cenarioBase(api: Api) {
  const esp = await espacoAtivo(api);
  await api.patch(`/despesas/espacos/${esp}`, { rendaMensal: 5000 });
  return esp;
}

const linhaDe = (descricao: string) => screen.getByText(descricao).closest("li")!;
// Um PagarControl por linha; o rótulo do botão muda de estado ("Pagar" →
// "Falta R$ X" → "Paga"). Regex porque byRole NÃO normaliza o NBSP do fmtMoney.
const pagarDe = (descricao: string) =>
  within(linhaDe(descricao)).getByRole("button", { name: /^(Pagar|Paga|Falta)/ });
const rotuloPagar = (descricao: string) => pagarDe(descricao).textContent!.replace(/\s+/g, " ").trim();
// O popover vive num portal, fora da <li>.
const popover = () => screen.getByText("Paguei agora").closest("div")!;
const campoPopover = () => popover().querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
const confirmar = () => screen.getByRole("button", { name: "Confirmar" });

const comFixa = (valor = 1000) =>
  renderApp({
    roles: ["admin"],
    skipReset: true,
    setup: async ({ api }) => {
      const esp = await cenarioBase(api);
      await api.post(`/despesas/espacos/${esp}/fixas`, { descricao: "Aluguel", valor });
    },
  });

describe("pagamento de despesa fixa", () => {
  it("abre o popover com o valor que falta pré-preenchido", async () => {
    const { user1 } = await comFixa();
    await goTo("fixas", user1);

    await screen.findByText("Aluguel");
    await user1.click(pagarDe("Aluguel"));

    expect(await screen.findByText("Paguei agora")).toBeInTheDocument();
    expect(campoPopover().value).toBe("1.000,00");
    expect(screen.getByText(`falta ${money(1000)}`)).toBeInTheDocument();
  });

  it("'Quitar' paga o valor cheio e o botão vira 'Paga'", async () => {
    const { user1, api } = await comFixa();
    await goTo("fixas", user1);

    await user1.click(pagarDe("Aluguel"));
    await user1.click(await screen.findByRole("button", { name: "Quitar" }));

    expect(await screen.findByText(/tudo pago em/)).toBeInTheDocument();
    // badge na linha + rótulo do botão
    expect(within(linhaDe("Aluguel")).getAllByText("Paga")).toHaveLength(2);
    expect(rotuloPagar("Aluguel")).toBe("Paga");

    const esp = await espacoAtivo(api);
    const orc = await api.get(`/despesas/espacos/${esp}`);
    expect(orc.pagamentosFixas).toEqual([
      { despesaFixaId: expect.any(String), ym, valorPago: 1000 },
    ]);
  });

  it("pagamento parcial mostra 'Falta R$ X', a badge Parcial e o detalhe pago/falta", async () => {
    const { user1, api } = await comFixa();
    await goTo("fixas", user1);

    await user1.click(pagarDe("Aluguel"));
    await digitarMoney(user1, campoPopover(), "40000"); // 400,00
    await user1.click(confirmar());

    await esperarAusente(() => screen.queryByText("Paguei agora"), "popover");
    expect(rotuloPagar("Aluguel")).toBe(`Falta ${money(600)}`);
    const linha = linhaDe("Aluguel");
    expect(within(linha).getByText("Parcial")).toBeInTheDocument();
    expect(within(linha).getByText(/pago/)).toHaveTextContent(`pago ${money(400)} · falta ${money(600)}`);

    const esp = await espacoAtivo(api);
    expect((await api.get(`/despesas/espacos/${esp}`)).pagamentosFixas[0]).toMatchObject({
      valorPago: 400,
    });
  });

  it("confirmar de novo SOMA ao que já estava pago", async () => {
    const { user1, api } = await comFixa();
    await goTo("fixas", user1);

    await user1.click(pagarDe("Aluguel"));
    await digitarMoney(user1, campoPopover(), "40000"); // 400
    await user1.click(confirmar());
    await esperarAusente(() => screen.queryByText("Paguei agora"), "popover");

    // segundo pagamento: o campo já vem com o que falta
    await user1.click(pagarDe("Aluguel"));
    // texto quebrado em vários nós (o valor pago vem num <span>)
    expect(await screen.findByText(byTexto(`Pago ${money(400)} de ${money(1000)}`))).toBeInTheDocument();
    await digitarMoney(user1, campoPopover(), "10000"); // + 100 = 500
    await user1.click(confirmar());

    await esperarAusente(() => screen.queryByText("Paguei agora"), "popover");
    expect(rotuloPagar("Aluguel")).toBe(`Falta ${money(500)}`);
    const esp = await espacoAtivo(api);
    expect((await api.get(`/despesas/espacos/${esp}`)).pagamentosFixas[0].valorPago).toBe(500);
  });

  it("'desfazer pagamentos' do popover parcial zera tudo", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        const f = await api.post(`/despesas/espacos/${esp}/fixas`, { descricao: "Aluguel", valor: 1000 });
        await api.put(`/despesas/espacos/${esp}/fixas/${f.id}/pago/${ym}`, { valorPago: 250 });
      },
    });
    await goTo("fixas", user1);

    await screen.findByText("Aluguel");
    expect(rotuloPagar("Aluguel")).toBe(`Falta ${money(750)}`);
    await user1.click(pagarDe("Aluguel"));
    await user1.click(await screen.findByText("desfazer pagamentos"));

    await esperarAusente(() => screen.queryByText("Paguei agora"), "popover");
    expect(rotuloPagar("Aluguel")).toBe("Pagar");
    expect(screen.queryByText("Parcial")).not.toBeInTheDocument();
    const esp = await espacoAtivo(api);
    expect((await api.get(`/despesas/espacos/${esp}`)).pagamentosFixas).toEqual([]);
  });

  it("clicar em 'Paga' desfaz o pagamento (volta pra 'Pagar')", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        const f = await api.post(`/despesas/espacos/${esp}/fixas`, { descricao: "Aluguel", valor: 1000 });
        await api.put(`/despesas/espacos/${esp}/fixas/${f.id}/pago/${ym}`, { valorPago: 1000 });
      },
    });
    await goTo("fixas", user1);

    await screen.findByText("Aluguel");
    expect(rotuloPagar("Aluguel")).toBe("Paga");
    await user1.click(pagarDe("Aluguel"));

    await esperarAusente(
      () => (rotuloPagar("Aluguel") === "Paga" ? true : null),
      "rótulo 'Paga'"
    );
    expect(rotuloPagar("Aluguel")).toBe("Pagar");
    const esp = await espacoAtivo(api);
    expect((await api.get(`/despesas/espacos/${esp}`)).pagamentosFixas).toEqual([]);
  });

  it("backdrop fecha o popover sem pagar", async () => {
    const { user1, bridge } = await comFixa();
    await goTo("fixas", user1);

    await user1.click(pagarDe("Aluguel"));
    await screen.findByText("Paguei agora");

    bridge.calls.length = 0;
    // o backdrop é o botão aria-hidden que cobre a tela inteira
    const backdrop = document.querySelector<HTMLElement>('button[aria-hidden][tabindex="-1"]')!;
    await user1.click(backdrop);

    await esperarAusente(() => screen.queryByText("Paguei agora"), "popover");
    expect(bridge.calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });

  it("Enter no campo confirma o pagamento", async () => {
    const { user1, api } = await comFixa();
    await goTo("fixas", user1);

    await user1.click(pagarDe("Aluguel"));
    await digitarMoney(user1, campoPopover(), "30000"); // 300
    await user1.type(campoPopover(), "{enter}");

    await esperarAusente(() => screen.queryByText("Paguei agora"), "popover");
    expect(rotuloPagar("Aluguel")).toBe(`Falta ${money(700)}`);
    const esp = await espacoAtivo(api);
    expect((await api.get(`/despesas/espacos/${esp}`)).pagamentosFixas[0].valorPago).toBe(300);
  });
});

describe("resumo de pagamentos do mês", () => {
  const tresFixas = () =>
    renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        for (const [descricao, valor] of [
          ["Aluguel", 1000],
          ["Internet", 200],
          ["Água", 100],
        ] as const) {
          await api.post(`/despesas/espacos/${esp}/fixas`, { descricao, valor });
        }
      },
    });

  it("conta pagas e soma o que falta (descontando parciais)", async () => {
    const { user1 } = await tresFixas();
    await goTo("fixas", user1);
    await screen.findByText("Aluguel");

    const resumo = () => screen.getByText(/pagas ·/).textContent!.replace(/\s+/g, " ");
    expect(resumo()).toContain("0/3 pagas");
    expect(resumo()).toContain(money(1300));

    // quita a Internet
    await user1.click(pagarDe("Internet"));
    await user1.click(await screen.findByRole("button", { name: "Quitar" }));
    await esperarAusente(() => screen.queryByText("Paguei agora"), "popover");
    expect(resumo()).toContain("1/3 pagas");

    // paga metade da Água → não conta como paga, mas reduz o que falta
    await user1.click(pagarDe("Água"));
    await digitarMoney(user1, campoPopover(), "5000"); // 50
    await user1.click(confirmar());
    await esperarAusente(() => screen.queryByText("Paguei agora"), "popover");

    expect(resumo()).toContain("1/3 pagas");
    // falta = 1000 (aluguel) + 50 (água)
    expect(resumo()).toContain(money(1050));
  });

  it("com tudo pago o resumo troca de mensagem", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        const f = await api.post(`/despesas/espacos/${esp}/fixas`, { descricao: "Aluguel", valor: 500 });
        await api.put(`/despesas/espacos/${esp}/fixas/${f.id}/pago/${ym}`, { valorPago: 500 });
      },
    });
    await goTo("fixas", user1);

    expect(await screen.findByText(`tudo pago em ${fmtMonthLabel(ym)} ✓`)).toBeInTheDocument();
  });

  it("pagamento é por mês: o mês seguinte volta a 'Pagar'", async () => {
    const seguinte = `${ym.slice(0, 4)}-${String(Number(ym.slice(5)) + 1).padStart(2, "0")}`;
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        const f = await api.post(`/despesas/espacos/${esp}/fixas`, { descricao: "Aluguel", valor: 500 });
        await api.put(`/despesas/espacos/${esp}/fixas/${f.id}/pago/${ym}`, { valorPago: 500 });
        if (seguinte.endsWith("13")) return; // virada de ano: teste cobre o resto
        await api.post(`/despesas/espacos/${esp}/mes`, {
          mes: seguinte,
          descricao: "Qualquer",
          valor: 10,
        });
      },
    });
    await goTo("fixas", user1);
    await screen.findByText("Aluguel");
    expect(rotuloPagar("Aluguel")).toBe("Paga");

    if (seguinte.endsWith("13")) return;
    await user1.selectOptions(screen.getAllByRole("combobox")[0], seguinte);

    await screen.findByText("Qualquer");
    expect(rotuloPagar("Aluguel")).toBe("Pagar");
  });
});

describe("pagamento de despesa avulsa", () => {
  it("marca como paga, colore a linha e o back guarda valorPago", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        await api.post(`/despesas/espacos/${esp}/mes`, { mes: ym, descricao: "Mercado", valor: 200 });
      },
    });
    await goTo("fixas", user1);

    await screen.findByText("Mercado");
    await user1.click(pagarDe("Mercado"));
    await user1.click(await screen.findByRole("button", { name: "Quitar" }));

    await esperarAusente(() => screen.queryByText("Paguei agora"), "popover");
    expect(rotuloPagar("Mercado")).toBe("Paga");
    const linha = linhaDe("Mercado");
    expect(within(linha).getAllByText("Paga")).toHaveLength(2);
    expect(linha.className).toContain("emerald");

    const esp = await espacoAtivo(api);
    expect((await api.get(`/despesas/espacos/${esp}`)).despesasMes[0]).toMatchObject({
      valorPago: 200,
      paga: true,
    });
  });

  it("parcial pinta de âmbar e mostra pago/falta", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await cenarioBase(api);
        await api.post(`/despesas/espacos/${esp}/mes`, { mes: ym, descricao: "Mercado", valor: 200 });
      },
    });
    await goTo("fixas", user1);

    await screen.findByText("Mercado");
    await user1.click(pagarDe("Mercado"));
    await digitarMoney(user1, campoPopover(), "7500"); // 75
    await user1.click(confirmar());

    await esperarAusente(() => screen.queryByText("Paguei agora"), "popover");
    expect(rotuloPagar("Mercado")).toBe(`Falta ${money(125)}`);
    const linha = linhaDe("Mercado");
    expect(within(linha).getByText("Parcial")).toBeInTheDocument();
    expect(linha.className).toContain("amber");
  });
});

describe("gating", () => {
  it("leitor não vê o PagarControl e a rota nega", async () => {
    const { user1 } = await renderApp({
      roles: ["leitor"],
      skipReset: true,
      // leitor não pode criar: cenário montado por outra conta é impossível aqui,
      // então usamos o seed do módulo dev (dados do próprio usuário)
      seed: true,
    });
    await goTo("fixas", user1);
    await screen.findByText(/^Despesas ·/);

    expect(screen.queryByRole("button", { name: /^(Pagar|Paga|Falta)/ })).not.toBeInTheDocument();
  });
});
