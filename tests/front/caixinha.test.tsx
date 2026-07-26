// Caixinhas: CRUD pelo modal, detalhe com histórico, aporte/despesa mexendo no
// saldo (que vem do back) e as variantes do card.
import { beforeEach, describe, expect, it } from "bun:test";
import {
  byMoney,
  campo,
  diaDoMes,
  digitarMoney,
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

const abrir = (nome: string) => screen.getByRole("button", { name: `Abrir ${nome}` });

describe("criar caixinha", () => {
  it("cria pelo modal e o card aparece na grid", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      // já existe reserva → o clique em "Nova" abre direto o form comum
      setup: async ({ api }) => {
        await api.post("/caixinhas", { nome: "Reserva", tipo: "emergencia", meta: 1000 });
      },
    });

    await user1.click(screen.getByRole("button", { name: /Nova/ }));
    const dialog = await screen.findByRole("dialog");
    const ui = within(dialog);

    await user1.type(ui.getByPlaceholderText(/Reserva de Sonhos/), "Viagem");
    await digitarMoney(user1, campo(dialog, "Aporte mensal"), "25000"); // 250,00
    await digitarMoney(user1, campo(dialog, "Meta"), "300000"); // 3.000,00
    await user1.click(ui.getByRole("button", { name: "Criar caixinha" }));

    expect(await screen.findByRole("button", { name: "Abrir Viagem" })).toBeInTheDocument();
    expect(screen.getByText(`${money(250)}/mês`)).toBeInTheDocument();
    expect(screen.getByText(`Meta ${money(3000)}`)).toBeInTheDocument();

    // e o back gravou de fato
    const criada = (await api.get("/caixinhas")).find((c: { nome: string }) => c.nome === "Viagem");
    expect(criada).toMatchObject({ aporteMensal: 250, meta: 3000, saldo: 0 });
  });

  it("nome vazio não fecha o modal e mostra erro inline (sem request)", async () => {
    const { user1, bridge } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        await api.post("/caixinhas", { nome: "Reserva", tipo: "emergencia", meta: 1000 });
      },
    });

    await user1.click(screen.getByRole("button", { name: /Nova/ }));
    const dialog = await screen.findByRole("dialog");
    bridge.calls.length = 0;
    await within(dialog).getByRole("button", { name: "Criar caixinha" }).click();

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Dê um nome para a caixinha."
    );
    expect(bridge.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("meta 0 é gravada como null (card cai na variante 'sem meta')", async () => {
    const { user1, api } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        await api.post("/caixinhas", { nome: "Reserva", tipo: "emergencia", meta: 1000 });
      },
    });

    await user1.click(screen.getByRole("button", { name: /Nova/ }));
    const ui = within(await screen.findByRole("dialog"));
    await user1.type(ui.getByPlaceholderText(/Reserva de Sonhos/), "Livre");
    await user1.click(ui.getByRole("button", { name: "Criar caixinha" }));

    expect(await screen.findByRole("button", { name: "Abrir Livre" })).toBeInTheDocument();
    const criada = (await api.get("/caixinhas")).find((c: { nome: string }) => c.nome === "Livre");
    expect(criada.meta).toBeNull();
    expect(screen.getByText("Sem meta definida. Acumulando livremente.")).toBeInTheDocument();
  });
});

describe("detalhe", () => {
  const cenario = async () =>
    renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const cx = await api.post("/caixinhas", { nome: "Viagem", aporteMensal: 200, meta: 1000 });
        await api.post("/movimentacoes", {
          caixinhaId: cx.id,
          tipo: "aporte",
          valor: 300,
          descricao: "Primeiro aporte",
          data: diaDoMes(5),
        });
        await api.post("/movimentacoes", {
          caixinhaId: cx.id,
          tipo: "despesa",
          valor: 100,
          descricao: "Passagem",
          data: diaDoMes(20),
        });
      },
    });

  it("header traz saldo e meta; histórico agrupa por mês, desc por data", async () => {
    const { user1 } = await cenario();
    await user1.click(abrir("Viagem"));

    expect(await screen.findByText("Saldo atual")).toBeInTheDocument();
    expect(screen.getByText(money(200))).toBeInTheDocument(); // 300 − 100
    expect(screen.getByText("Histórico · 2 movimentações")).toBeInTheDocument();

    const itens = screen.getAllByRole("listitem");
    expect(itens[0]).toHaveTextContent("Passagem"); // dia 20 antes do dia 5
    expect(itens[0]).toHaveTextContent(`−${money(100)}`);
    expect(itens[1]).toHaveTextContent("Primeiro aporte");
    expect(itens[1]).toHaveTextContent(`+${money(300)}`);
  });

  it("aporte pelo detalhe atualiza o saldo do header (valor vindo do back)", async () => {
    const { user1 } = await cenario();
    await user1.click(abrir("Viagem"));

    await user1.click(await screen.findByRole("button", { name: "Aporte" }));
    const ui = within(await screen.findByRole("dialog"));
    // sugestão = aporteMensal da caixinha. Regex porque o nome acessível NÃO é
    // normalizado pelo byRole — o NBSP do fmtMoney sobrevive nele.
    await user1.click(ui.getByRole("button", { name: /Usar valor planejado/ }));
    await user1.click(ui.getByRole("button", { name: "Adicionar" }));

    expect(await screen.findByText(money(400))).toBeInTheDocument();
    expect(screen.getByText("Histórico · 3 movimentações")).toBeInTheDocument();
  });

  it("despesa acima do saldo avisa e deixa a caixinha negativa", async () => {
    const { user1 } = await cenario();
    await user1.click(abrir("Viagem"));

    // "Despesa" exato: a nav tem "Despesas", que casaria com /Despesa/
    await user1.click(await screen.findByRole("button", { name: "Despesa" }));
    const dialog = await screen.findByRole("dialog");
    const ui = within(dialog);
    await digitarMoney(user1, campo(dialog, "Valor"), "50000"); // 500,00 > 200
    expect(
      ui.getByText("⚠ Valor maior que o saldo — a caixinha ficará negativa.")
    ).toBeInTheDocument();

    await user1.click(ui.getByRole("button", { name: "Registrar saída" }));
    expect(await screen.findByText(`-${money(300)}`)).toBeInTheDocument();
  });

  it("remover movimentação reverte o saldo", async () => {
    const { user1 } = await cenario();
    await user1.click(abrir("Viagem"));

    const [primeiro] = await screen.findAllByRole("button", { name: "Remover movimentação" });
    await user1.click(primeiro); // remove a despesa de 100

    expect(await screen.findByText(money(300))).toBeInTheDocument();
    expect(screen.getByText("Histórico · 1 movimentações")).toBeInTheDocument();
  });

  it("valor ≤ 0 no aporte é barrado no front (nenhum request)", async () => {
    const { user1, bridge } = await cenario();
    await user1.click(abrir("Viagem"));

    await user1.click(await screen.findByRole("button", { name: "Aporte" }));
    const ui = within(await screen.findByRole("dialog"));
    bridge.calls.length = 0;
    await user1.click(ui.getByRole("button", { name: "Adicionar" }));

    expect(await ui.findByRole("alert")).toHaveTextContent("Informe um valor maior que zero.");
    expect(bridge.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("editar pelo detalhe muda nome e meta", async () => {
    const { user1 } = await cenario();
    await user1.click(abrir("Viagem"));

    await user1.click(await screen.findByRole("button", { name: "Editar caixinha" }));
    const ui = within(await screen.findByRole("dialog"));
    const nome = ui.getByDisplayValue("Viagem");
    await user1.clear(nome);
    await user1.type(nome, "Viagem Chile");
    await user1.click(ui.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByText("Viagem Chile")).toBeInTheDocument();
  });

  it("excluir confirma, volta pro dashboard e leva as movimentações (cascade)", async () => {
    const { user1, api } = await cenario();
    const [cx] = await api.get("/caixinhas");
    await user1.click(abrir("Viagem"));

    await user1.click(await screen.findByRole("button", { name: "Excluir caixinha" }));
    const ui = within(await screen.findByRole("dialog"));
    expect(ui.getByText(/todas as movimentações/)).toBeInTheDocument();
    await user1.click(ui.getByRole("button", { name: /Excluir/ }));

    expect(await screen.findByText("Total guardado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Abrir Viagem" })).not.toBeInTheDocument();
    expect(await api.get("/caixinhas")).toEqual([]);
    expect(await prisma.movimentacao.count({ where: { caixinhaId: cx.id } })).toBe(0);
  });

  it("cancelar a exclusão não apaga nada", async () => {
    const { user1, api } = await cenario();
    await user1.click(abrir("Viagem"));

    await user1.click(await screen.findByRole("button", { name: "Excluir caixinha" }));
    const ui = within(await screen.findByRole("dialog"));
    await user1.click(ui.getByRole("button", { name: "Cancelar" }));

    expect(screen.getByText("Saldo atual")).toBeInTheDocument();
    expect(await api.get("/caixinhas")).toHaveLength(1);
  });

  it("histórico vazio tem o convite pro primeiro aporte", async () => {
    const { user1 } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        await api.post("/caixinhas", { nome: "Nova", aporteMensal: 100 });
      },
    });

    await user1.click(abrir("Nova"));
    expect(
      await screen.findByText("Nenhuma movimentação ainda. Registre o primeiro aporte.")
    ).toBeInTheDocument();
  });
});

describe("conta sem caixinha nenhuma", () => {
  // Antes: os botões existiam com zero caixinhas, o submit mandava caixinhaId ""
  // e o 422 do zValidator não aparecia em lugar nenhum (o `<Field error>` só
  // renderiza quando o próprio campo está inválido). Agora as ações não existem
  // sem caixinha, e um erro do back tem slot próprio no form.
  it("as ações de movimentação não aparecem e o vazio orienta a criar", async () => {
    await renderApp({ roles: ["admin"], skipReset: true });

    expect(screen.getByText("Nenhuma caixinha ainda.")).toBeInTheDocument();
    expect(
      screen.getByText("Crie a primeira caixinha pra poder registrar aportes e despesas.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Aporte$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar despesa" })).not.toBeInTheDocument();
    // criar caixinha continua acessível
    expect(screen.getByRole("button", { name: /Nova/ })).toBeInTheDocument();
  });

  it("sem caixinha_manage o vazio manda falar com um admin", async () => {
    await renderApp({
      permissions: ["state:view", "caixinha:view", "movimentacao:manage"],
      skipReset: true,
    });

    expect(screen.getByText("Peça a um admin pra criar a primeira caixinha.")).toBeInTheDocument();
  });
});

describe("erro do back nos modais de movimentação", () => {
  // Repro do erro geral: a caixinha existe quando o modal abre e some antes do
  // submit (outra aba, outro dispositivo). O POST volta 404 e a mensagem do back
  // precisa aparecer — antes o modal só "não fazia nada".
  it("aporte numa caixinha que sumiu mostra a mensagem do back", async () => {
    const { user1, api, bridge } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await api.post("/caixinhas", { nome: "Viagem", cor: "blue" }); },
    });

    // o primeiro "Aporte" é o do header (o card da caixinha tem outro)
    await user1.click(screen.getAllByRole("button", { name: /^Aporte$/ })[0]);
    const dialog = await screen.findByRole("dialog");
    const ui = within(dialog);

    const [cx] = await api.get("/caixinhas");
    await api.delete(`/caixinhas/${cx.id}`);

    await digitarMoney(user1, campo(dialog, "Valor"), "5000");
    bridge.calls.length = 0;
    await user1.click(ui.getByRole("button", { name: "Adicionar" }));

    expect(await ui.findByRole("alert")).toHaveTextContent(/Caixinha não encontrada/);
    expect(bridge.calls.find((c) => c.method === "POST")!.status).toBe(404);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect((await api.get("/state")).movimentacoes).toEqual([]);
  });

  it("despesa variável na caixinha que sumiu: mesmo caminho", async () => {
    const { user1, api, bridge } = await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => { await api.post("/caixinhas", { nome: "Viagem", cor: "blue" }); },
    });

    await user1.click(screen.getByRole("button", { name: "Registrar despesa" }));
    const dialog = await screen.findByRole("dialog");
    const ui = within(dialog);

    const [cx] = await api.get("/caixinhas");
    await api.delete(`/caixinhas/${cx.id}`);

    await digitarMoney(user1, campo(dialog, "Valor"), "5000");
    bridge.calls.length = 0;
    await user1.click(ui.getByRole("button", { name: "Registrar saída" }));

    expect(await ui.findByRole("alert")).toHaveTextContent(/Caixinha não encontrada/);
    expect(bridge.calls.find((c) => c.method === "POST")!.status).toBe(404);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("variantes do card", () => {
  it("meta atingida troca o texto de 'Faltam' por '✓ Meta atingida'", async () => {
    await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const cx = await api.post("/caixinhas", { nome: "Batida", meta: 500 });
        await api.patch(`/caixinhas/${cx.id}`, { saldo: 500 });
      },
    });

    expect(screen.getByText("✓ Meta atingida")).toBeInTheDocument();
    expect(screen.queryByText(/^Faltam/)).not.toBeInTheDocument();
  });

  it("acumulaSobra mostra o badge e o texto do cofre flexível", async () => {
    await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        await api.post("/caixinhas", { nome: "Flexível", acumulaSobra: true });
      },
    });

    expect(screen.getByText("acumula sobra")).toBeInTheDocument();
    expect(screen.getByText("Cofre flexível — recebe o que sobra no mês.")).toBeInTheDocument();
  });

  it("sem aporte fixo o card diz isso em vez de 'R$ x/mês'", async () => {
    await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        await api.post("/caixinhas", { nome: "Sem aporte" });
      },
    });

    expect(screen.getByText("Sem aporte fixo")).toBeInTheDocument();
  });

  it("saldo negativo aparece (o back aceita ir abaixo de zero)", async () => {
    await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const cx = await api.post("/caixinhas", { nome: "Estourada" });
        await api.post("/movimentacoes", {
          caixinhaId: cx.id,
          tipo: "despesa",
          valor: 75.5,
          descricao: "Saque",
          data: diaDoMes(3),
        });
      },
    });

    // o valor aparece em vários lugares (hero, donut, card); o que interessa é
    // que o saldo do card usa o tom de negativo
    const negativos = screen.getAllByText(`-${money(75.5)}`);
    expect(negativos.length).toBeGreaterThan(1);
    expect(negativos.some((n) => n.className.includes("text-rose-400"))).toBe(true);
  });

  it("reserva sem meta e com caixinha:manage oferece 'Configurar reserva'", async () => {
    await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        await api.post("/caixinhas", { nome: "Reserva", tipo: "emergencia" });
      },
    });

    expect(screen.getByRole("button", { name: /Configurar reserva/ })).toBeInTheDocument();
    expect(screen.queryByText("Reserva ainda não configurada.")).not.toBeInTheDocument();
  });

  it("a mesma reserva, sem caixinha:manage, vira aviso estático", async () => {
    // um render por teste: `cleanup` é por teste, então dois renders no mesmo it
    // deixariam as duas árvores no document e a query pegaria a árvore errada
    await renderApp({
      permissions: ["state:view", "caixinha:view", "cartao:view", "orcamento:view"],
      skipReset: true,
      // pelo Prisma: esta conta não tem caixinha:manage, então o POST daria 403
      setup: async ({ user }) => {
        await prisma.caixinha.create({
          data: { userId: user.id, nome: "Reserva", tipo: "emergencia", ordem: 1 },
        });
      },
    });

    expect(screen.getByText("Reserva ainda não configurada.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Configurar reserva/ })).not.toBeInTheDocument();
  });

  it("reserva com meta oferece 'Ajustar' (só com caixinha:manage)", async () => {
    await renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        await api.post("/caixinhas", { nome: "Reserva", tipo: "emergencia", meta: 12000 });
      },
    });

    expect(screen.getByRole("button", { name: /Ajustar/ })).toBeInTheDocument();
    expect(screen.getByText(byMoney(12000))).toBeInTheDocument();
  });

  it("mês corrente aparece no header do dashboard", async () => {
    await renderApp({ roles: ["admin"], skipReset: true });
    const [ano, mes] = mesAtual().split("-");
    expect(screen.getByText(new RegExp(`de ${ano}$`))).toBeInTheDocument();
    expect(Number(mes)).toBeGreaterThan(0);
  });
});
