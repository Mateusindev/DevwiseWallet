// Dashboard: hero de patrimônio, metas, grid de caixinhas, gráficos do
// orçamento e o select de "visualizar página".
//
// Todo cenário é montado pela API real (opção `setup` do renderApp) — os
// números vêm do back, então nenhum agregado é recalculado no teste.
import { beforeEach, describe, expect, it } from "bun:test";
import {
  byMoney,
  diaDoMes,
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

beforeEach(async () => {
  await resetDb();
  await seedRoles();
});

const ym = mesAtual();

describe("hero de patrimônio", () => {
  it("soma saldo e aporte mensal de todas as caixinhas", async () => {
    await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const a = await api.post("/caixinhas", { nome: "Viagem", aporteMensal: 300, meta: 5000 });
        const b = await api.post("/caixinhas", { nome: "Carro", aporteMensal: 200 });
        await api.patch(`/caixinhas/${a.id}`, { saldo: 1200 });
        await api.patch(`/caixinhas/${b.id}`, { saldo: 800.5 });
      },
    });

    const hero = screen.getByText("Total guardado").closest("div")!;
    expect(within(hero).getByText(money(2000.5))).toBeInTheDocument();
    expect(screen.getByText(money(500))).toBeInTheDocument(); // aporte mensal somado
  });

  it("progresso das metas conta só caixinhas com meta", async () => {
    await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const a = await api.post("/caixinhas", { nome: "Meta batida", meta: 1000 });
        const b = await api.post("/caixinhas", { nome: "Meta no meio", meta: 1000 });
        await api.post("/caixinhas", { nome: "Sem meta", aporteMensal: 10 });
        await api.patch(`/caixinhas/${a.id}`, { saldo: 1500 }); // clampa em 1000
        await api.patch(`/caixinhas/${b.id}`, { saldo: 500 });
      },
    });

    expect(screen.getByText("1/2 metas")).toBeInTheDocument();
    // guardado = min(1500,1000) + 500 = 1500 de 2000 → 75%
    expect(screen.getByText("75%")).toBeInTheDocument();
  });

  it("sem nenhuma meta mostra 'sem metas' e nenhum contador", async () => {
    await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        await api.post("/caixinhas", { nome: "Livre", aporteMensal: 50 });
      },
    });

    expect(screen.getByText("sem metas")).toBeInTheDocument();
    expect(screen.queryByText(/^\d+\/\d+ metas$/)).not.toBeInTheDocument();
  });

  it("conta nova (sem caixinha) mostra zeros e a grid vazia", async () => {
    await renderApp({ roles: ["admin"], skipReset: true });

    expect(screen.getAllByText(money(0)).length).toBeGreaterThan(0);
    expect(screen.getByText("sem metas")).toBeInTheDocument();
    expect(screen.getByText("Caixinhas")).toBeInTheDocument();
  });
});

describe("grid e legenda", () => {
  it("respeitam a ordem de criação (campo ordem), não a alfabética", async () => {
    await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        await api.post("/caixinhas", { nome: "Zebra", aporteMensal: 1 });
        await api.post("/caixinhas", { nome: "Alfa", aporteMensal: 2 });
      },
    });

    const cards = screen.getAllByRole("button", { name: /^Abrir / });
    expect(cards.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Abrir Zebra",
      "Abrir Alfa",
    ]);

    // cada nome aparece duas vezes (legenda do hero, depois o card) e a ordem
    // é a mesma nos dois lugares
    // (o nó da legenda também carrega o saldo dentro — só o nome interessa aqui)
    const nomes = screen
      .getAllByText(/^(Zebra|Alfa)$/)
      .map((n) => (n.textContent!.startsWith("Zebra") ? "Zebra" : "Alfa"));
    expect(nomes).toEqual([
      "Zebra",
      "Alfa",
      "Zebra",
      "Alfa",
    ]);
  });

  it("card mostra saldo, aporte/mês e o texto de meta do back", async () => {
    await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const c = await api.post("/caixinhas", { nome: "Viagem", aporteMensal: 250, meta: 1000 });
        await api.patch(`/caixinhas/${c.id}`, { saldo: 250 });
      },
    });

    expect(screen.getByText(`${money(250)}/mês`)).toBeInTheDocument();
    expect(screen.getByText(`Meta ${money(1000)}`)).toBeInTheDocument();
    // 25% aparece duas vezes: progresso geral das metas (hero) e o do card
    expect(screen.getAllByText("25%")).toHaveLength(2);
    // faltam 750 · 3 meses de aporte
    expect(screen.getByText(byMoney(750))).toBeInTheDocument();
    expect(screen.getByText("3 meses")).toBeInTheDocument();
  });
});

describe("nova caixinha — dois passos", () => {
  it("sem reserva ainda, o clique abre a escolha de tipo", async () => {
    const { user1 } = await renderApp({ roles: ["admin"], skipReset: true });

    await user1.click(screen.getByRole("button", { name: /Nova/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Reserva de emergência")).toBeInTheDocument();
    expect(within(dialog).getByText("Caixinha comum")).toBeInTheDocument();
    expect(within(dialog).queryByText("Nome")).not.toBeInTheDocument();
  });

  it("com reserva já criada, vai direto pro form de caixinha comum", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        await api.post("/caixinhas", { nome: "Reserva", tipo: "emergencia", meta: 1000 });
      },
    });

    await user1.click(screen.getByRole("button", { name: /Nova/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Nome")).toBeInTheDocument();
    expect(within(dialog).queryByText("Caixinha comum")).not.toBeInTheDocument();
  });
});

describe("gráficos do orçamento", () => {
  it("blocos vazios quando não há despesa nem cartão", async () => {
    await renderApp({ roles: ["admin"], skipReset: true });

    expect(screen.getByText("Nenhuma despesa neste mês.")).toBeInTheDocument();
    expect(screen.getByText("Nenhum cartão cadastrado.")).toBeInTheDocument();
    expect(screen.getByText("Nenhuma despesa fixa ativa.")).toBeInTheDocument();
  });

  it("despesas por categoria somam fixas que caem no mês + avulsas, com 'Sem categoria'", async () => {
    await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await espacoAtivo(api);
        const cat = await api.post("/categorias", { nome: "Casa", cor: "blue" });
        await api.post(`/despesas/espacos/${esp}/fixas`, {
          descricao: "Aluguel",
          valor: 600,
          categoriaId: cat.id,
        });
        await api.post(`/despesas/espacos/${esp}/mes`, {
          mes: ym,
          descricao: "Mercado",
          valor: 400,
        });
      },
    });

    const bloco = screen.getByText("Despesas por categoria").closest("div")!;
    expect(within(bloco).getByText("Casa")).toBeInTheDocument();
    expect(within(bloco).getByText("Sem categoria")).toBeInTheDocument();
    // 600 de 1000 e 400 de 1000
    expect(within(bloco).getByText("60%")).toBeInTheDocument();
    expect(within(bloco).getByText("40%")).toBeInTheDocument();
  });

  it("uso dos cartões vem do agregado do back", async () => {
    await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await espacoAtivo(api);
        const cartao = await api.post("/cartoes", { nome: "Nubank", limite: 2000 });
        await api.post(`/despesas/espacos/${esp}/mes`, {
          mes: ym,
          descricao: "Compra",
          valor: 500,
          data: diaDoMes(10),
          cartaoId: cartao.id,
        });
      },
    });

    const bloco = screen.getByText("Uso dos cartões").closest("div")!;
    expect(await within(bloco).findByText(money(2000))).toBeInTheDocument();
    expect(within(bloco).getByText(money(500))).toBeInTheDocument();
    expect(within(bloco).getByText(money(1500))).toBeInTheDocument();
    expect(within(bloco).getByText("25%")).toBeInTheDocument();
  });
});

describe("select 'visualizar página'", () => {
  it("busca o orçamento do outro espaço sem trocar o ativo", async () => {
    const { user1, bridge, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const esp = await espacoAtivo(api);
        await api.post(`/despesas/espacos/${esp}/fixas`, { descricao: "Aluguel", valor: 600 });
        const outra = await api.post("/despesas/espacos", { nome: "Viagem", emoji: "✈️" });
        await api.post(`/despesas/espacos/${outra.id}/fixas`, { descricao: "Passagem", valor: 900 });
        // volta o ativo pro primeiro (criar espaço torna o novo ativo)
        await api.put("/despesas/espacos/active", { id: esp });
      },
    });

    const { activeEspacoId: ativoAntes, espacos } = await api.get("/despesas/espacos");
    const outra = espacos.find((e: { nome: string }) => e.nome === "Viagem")!;

    const select = screen.getByRole("combobox", { name: /Visualizar página/ });
    bridge.calls.length = 0;
    await user1.selectOptions(select, outra.id);

    expect(await screen.findByText("Passagem")).toBeInTheDocument();
    // nenhum PUT /active: o espaço ativo do contexto não muda
    expect(bridge.calls.filter((c) => c.path.includes("/active"))).toHaveLength(0);
    const { activeEspacoId: ativoDepois } = await api.get("/despesas/espacos");
    expect(ativoDepois).toBe(ativoAntes);

    // e a tela de Despesas continua na página ativa
    await goTo("fixas", user1);
    expect(await screen.findByText(/^Despesas ·/)).toBeInTheDocument();
    expect(screen.getByText("Aluguel")).toBeInTheDocument();
  });
});
