// Wizard da reserva de emergência: a meta é DERIVADA (meses × gasto), nunca
// digitada, e criar faz duas requests (create + update do saldo, porque o
// create sempre zera o saldo).
import { beforeEach, describe, expect, it } from "bun:test";
import {
  campo,
  digitarMoney,
  digitarNumero,
  esperarSemDialog,
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

// Conta nova: sem reserva, o "Nova" abre o passo de escolha de tipo.
async function abrirWizard() {
  const ctx = await renderApp({ roles: ["admin"], skipReset: true });
  await ctx.user1.click(screen.getByRole("button", { name: /Nova/ }));
  const escolha = await screen.findByRole("dialog");
  await ctx.user1.click(within(escolha).getByText("Reserva de emergência"));
  const dialog = await screen.findByRole("dialog");
  return { ...ctx, dialog, ui: within(dialog) };
}

describe("criar reserva", () => {
  it("meta = meses × gasto, atualizada ao trocar o preset", async () => {
    const { user1, dialog, ui } = await abrirWizard();

    // default é 6 meses
    await digitarMoney(user1, campo(dialog, "Gasto por mês"), "200000"); // 2.000,00
    expect(ui.getByText(money(12000))).toBeInTheDocument();
    expect(ui.getByText(`6 meses × ${money(2000)}`)).toBeInTheDocument();

    await user1.click(ui.getByText("3 meses"));
    expect(ui.getByText(money(6000))).toBeInTheDocument();

    await user1.click(ui.getByText("12 meses"));
    expect(ui.getByText(money(24000))).toBeInTheDocument();
  });

  it("aceita número livre de meses além dos presets", async () => {
    const { user1, dialog, ui } = await abrirWizard();

    await digitarNumero(user1, campo(dialog, "Meses de segurança"), 9);
    await digitarMoney(user1, campo(dialog, "Gasto por mês"), "100000"); // 1.000,00

    expect(ui.getByText(money(9000))).toBeInTheDocument();
  });

  it("estimativa 'completa em ~N meses' usa o aporte informado", async () => {
    const { user1, dialog, ui } = await abrirWizard();

    await digitarMoney(user1, campo(dialog, "Gasto por mês"), "100000"); // meta 6.000
    await digitarMoney(user1, campo(dialog, "Já tenho guardado"), "100000"); // 1.000
    await digitarMoney(user1, campo(dialog, "Guardar por mês"), "50000"); // 500/mês

    // falta 5.000 / 500 = 10 meses
    expect(await ui.findByText(/10 meses/)).toBeInTheDocument();
  });

  it("cria com create + update do saldo e o card já sai configurado", async () => {
    const { user1, dialog, ui, bridge, api } = await abrirWizard();

    await digitarMoney(user1, campo(dialog, "Gasto por mês"), "100000"); // 1.000 → meta 6.000
    await digitarMoney(user1, campo(dialog, "Já tenho guardado"), "150000"); // 1.500
    await digitarMoney(user1, campo(dialog, "Guardar por mês"), "30000"); // 300

    bridge.calls.length = 0;
    await user1.click(ui.getByRole("button", { name: "Criar reserva" }));

    expect(
      await screen.findByRole("button", { name: "Abrir Reserva de emergência" })
    ).toBeInTheDocument();
    // o card aparece já no POST; o saldo só depois do PATCH — esperar o 25%
    // evita medir os requests no meio do caminho
    expect(await screen.findAllByText("25%")).not.toHaveLength(0);

    // create zera o saldo → o saldo inicial vai num PATCH depois
    expect(bridge.calls.filter((c) => c.method === "POST" && c.path === "/api/caixinhas")).toHaveLength(1);
    expect(bridge.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);

    const [reserva] = await api.get("/caixinhas");
    expect(reserva).toMatchObject({
      nome: "Reserva de emergência",
      tipo: "emergencia",
      meta: 6000,
      aporteMensal: 300,
      saldo: 1500,
    });
    expect(screen.getByText(`Meta ${money(6000)}`)).toBeInTheDocument();
    // 1.500 de 6.000 — no progresso geral do hero e no card
    expect(screen.getAllByText("25%")).toHaveLength(2);
    // saldo aparece no hero, no donut e no card
    expect(screen.getAllByText(money(1500)).length).toBeGreaterThan(1);
  });

  it("saldo inicial zero não gera o segundo request", async () => {
    const { user1, dialog, ui, bridge } = await abrirWizard();

    await digitarMoney(user1, campo(dialog, "Gasto por mês"), "100000");
    bridge.calls.length = 0;
    await user1.click(ui.getByRole("button", { name: "Criar reserva" }));

    expect(
      await screen.findByRole("button", { name: "Abrir Reserva de emergência" })
    ).toBeInTheDocument();
    expect(bridge.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("gasto zerado bloqueia o submit com erro inline (sem request)", async () => {
    const { user1, ui, bridge } = await abrirWizard();

    bridge.calls.length = 0;
    await user1.click(ui.getByRole("button", { name: "Criar reserva" }));

    expect(await ui.findByRole("alert")).toHaveTextContent("Informe seu gasto mensal.");
    expect(bridge.calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("meses zerado nem chega no submit — o input tem min=1", async () => {
    const { user1, dialog, ui, bridge } = await abrirWizard();

    const meses = campo(dialog, "Meses de segurança") as HTMLInputElement;
    expect(meses.min).toBe("1");
    await digitarNumero(user1, meses, 0);
    await digitarMoney(user1, campo(dialog, "Gasto por mês"), "100000");

    bridge.calls.length = 0;
    await user1.click(ui.getByRole("button", { name: "Criar reserva" }));

    // a validação nativa do input barra antes do handler: sem request e sem
    // mensagem de erro do form (o "Escolha quantos meses" só apareceria se o
    // submit rodasse)
    expect(bridge.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("ajustar reserva existente", () => {
  const comReserva = () =>
    renderApp({
      roles: ["admin"],
      skipReset: true,
      setup: async ({ api }) => {
        const cx = await api.post("/caixinhas", {
          nome: "Reserva de emergência",
          tipo: "emergencia",
          meta: 12000,
          aporteMensal: 700,
        });
        await api.patch(`/caixinhas/${cx.id}`, { saldo: 3000 });
      },
    });

  it("'Ajustar' abre com o gasto reconstruído da meta (meta / 6)", async () => {
    const { user1 } = await comReserva();

    await user1.click(screen.getByRole("button", { name: /Ajustar/ }));
    const dialog = await screen.findByRole("dialog");
    const ui = within(dialog);

    expect(ui.getByText("Configurar reserva de emergência")).toBeInTheDocument();
    // gasto = 12000 / 6 = 2000 → meta calculada volta a 12.000
    expect(ui.getByText(money(12000))).toBeInTheDocument();
    expect((campo(dialog, "Guardar por mês") as HTMLInputElement).value).toContain("700");
    expect((campo(dialog, "Já tenho guardado") as HTMLInputElement).value).toContain("3.000");
  });

  it("salvar grava meta, aporte e saldo num único PATCH", async () => {
    const { user1, bridge, api } = await comReserva();

    await user1.click(screen.getByRole("button", { name: /Ajustar/ }));
    const dialog = await screen.findByRole("dialog");
    const ui = within(dialog);

    await user1.click(ui.getByText("12 meses")); // meta 24.000
    await digitarMoney(user1, campo(dialog, "Guardar por mês"), "90000"); // 900

    bridge.calls.length = 0;
    await user1.click(ui.getByRole("button", { name: "Salvar reserva" }));

    await esperarSemDialog();
    expect(bridge.calls.filter((c) => c.method === "PATCH")).toHaveLength(1);

    const [reserva] = await api.get("/caixinhas");
    expect(reserva).toMatchObject({ meta: 24000, aporteMensal: 900, saldo: 3000 });
    expect(screen.getByText(`Meta ${money(24000)}`)).toBeInTheDocument();
  });
});
