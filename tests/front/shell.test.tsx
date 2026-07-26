// Shell do app (App.jsx): nav filtrada por permission, view inicial, estados
// de boot (loading / error / retry) e volta do detalhe de caixinha.
import { beforeEach, describe, expect, it } from "bun:test";
import {
  createUser,
  goTo,
  installFetchBridge,
  login,
  prisma,
  renderApp,
  resetDb,
  screen,
  seedRoles,
  userEvent,
  waitForBoot,
  waitForSessao,
} from "./harness";
import { render } from "@testing-library/react";
import AuthGate from "@/components/AuthGate";
import { FinanceProvider } from "@/store/FinanceContext.jsx";
import App from "@/App.jsx";

beforeEach(async () => {
  await resetDb();
  await seedRoles();
});

const LABELS = ["Início", "Despesas", "Cartões", "Admin"];
const navVisivel = () =>
  LABELS.filter((l) => screen.queryAllByRole("button", { name: l }).length > 0);

describe("nav por permission", () => {
  it("admin vê as quatro áreas", async () => {
    await renderApp({ roles: ["admin"], skipReset: true });
    expect(navVisivel()).toEqual(["Início", "Despesas", "Cartões", "Admin"]);
  });

  it("membro não vê Admin", async () => {
    await renderApp({ roles: ["membro"], skipReset: true });
    expect(navVisivel()).toEqual(["Início", "Despesas", "Cartões"]);
  });

  it("leitor vê as mesmas áreas do membro (view-only é gating de ação, não de área)", async () => {
    await renderApp({ roles: ["leitor"], skipReset: true });
    expect(navVisivel()).toEqual(["Início", "Despesas", "Cartões"]);
  });

  it("role:view sozinho já abre a área de Admin", async () => {
    await renderApp({ permissions: ["state:view", "role:view"], skipReset: true });
    expect(navVisivel()).toEqual(["Admin"]);
  });
});

describe("view inicial", () => {
  it("é o primeiro item visível da nav, não o dashboard fixo", async () => {
    // sem caixinha:view o dashboard não entra na nav → cai em Despesas
    await renderApp({
      permissions: ["state:view", "orcamento:view", "espaco:view"],
      skipReset: true,
    });

    expect(await screen.findByText(/^Despesas ·/)).toBeInTheDocument();
    expect(screen.queryByText("Total guardado")).not.toBeInTheDocument();
  });

  it("com caixinha:view começa no dashboard", async () => {
    await renderApp({ roles: ["membro"], skipReset: true });
    expect(screen.getByText("Total guardado")).toBeInTheDocument();
  });
});

describe("conta sem nenhuma área", () => {
  it("mostra o aviso em vez da nav", async () => {
    await renderApp({ permissions: ["state:view"], skipReset: true });

    expect(
      screen.getByText("Sua conta não tem permissão pra ver nenhuma área. Fale com um admin.")
    ).toBeInTheDocument();
    expect(navVisivel()).toEqual([]);
  });
});

describe("estados de boot", () => {
  const arvore = (
    <AuthGate>
      <FinanceProvider>
        <App />
      </FinanceProvider>
    </AuthGate>
  );

  it("mostra 'Verificando sessão…' antes do /auth/me e o spinner antes do /state", async () => {
    const conta = await createUser({ roles: ["admin"] });
    installFetchBridge();
    await login(conta.email, conta.senha);

    render(arvore);
    // síncrono: nenhum efeito resolveu ainda
    expect(screen.getByText("Verificando sessão…")).toBeInTheDocument();

    await waitForSessao();
    expect(screen.getByText("Carregando suas finanças…")).toBeInTheDocument();

    await waitForBoot();
    expect(screen.getByText("Total guardado")).toBeInTheDocument();
  });

  it("erro no /state mostra a mensagem do back e o botão de retry", async () => {
    // sem state:view o GET /state responde 403 → BOOT_ERR
    await renderApp({ permissions: ["caixinha:view"], skipReset: true });

    expect(screen.getByText("Não consegui carregar os dados.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
    expect(screen.getByText(/permiss/i)).toBeInTheDocument();
  });

  it("'Tentar de novo' refaz o boot (roles são lidas do banco a cada request)", async () => {
    const { user } = await renderApp({ permissions: ["caixinha:view"], skipReset: true });
    const u = userEvent.setup();

    // concede state:view na role ad-hoc do usuário — sem novo login.
    // cartao:view entra junto porque o Dashboard chama reloadCartoes() no mount
    // sem catch: um 403 ali vira unhandled rejection e derruba o teste (é o
    // mesmo defeito do Achado 4, mas no reloadCartoes).
    const [vinculo] = await prisma.userRole.findMany({ where: { userId: user.id } });
    await prisma.role.update({
      where: { id: vinculo.roleId },
      data: { permissions: ["caixinha:view", "state:view", "cartao:view"] },
    });

    await u.click(screen.getByRole("button", { name: "Tentar de novo" }));

    expect(await screen.findByText("Total guardado")).toBeInTheDocument();
    expect(screen.queryByText("Não consegui carregar os dados.")).not.toBeInTheDocument();
  });
});

describe("navegação", () => {
  it("troca de área pelo item de nav", async () => {
    const { user1 } = await renderApp({ roles: ["admin"], skipReset: true });

    await goTo("cartoes", user1);
    expect(await screen.findByText("Cartões de crédito")).toBeInTheDocument();

    await goTo("admin", user1);
    expect(await screen.findByText("Administração")).toBeInTheDocument();

    await goTo("dashboard", user1);
    expect(await screen.findByText("Total guardado")).toBeInTheDocument();
  });

  it("abrir e voltar do detalhe da caixinha limpa a seleção", async () => {
    const { user1 } = await renderApp({ roles: ["admin"], skipReset: true, seed: true });

    await user1.click(await screen.findByRole("button", { name: "Abrir Reserva de emergência" }));
    expect(await screen.findByRole("button", { name: /Voltar/ })).toBeInTheDocument();

    await user1.click(screen.getByRole("button", { name: /Voltar/ }));
    expect(await screen.findByText("Total guardado")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Voltar/ })).not.toBeInTheDocument();
  });

  it("trocar de área também sai do detalhe", async () => {
    const { user1 } = await renderApp({ roles: ["admin"], skipReset: true, seed: true });

    await user1.click(await screen.findByRole("button", { name: "Abrir Reserva de emergência" }));
    expect(await screen.findByRole("button", { name: /Voltar/ })).toBeInTheDocument();

    await goTo("cartoes", user1);
    expect(await screen.findByText("Cartões de crédito")).toBeInTheDocument();

    await goTo("dashboard", user1);
    expect(screen.queryByRole("button", { name: /Voltar/ })).not.toBeInTheDocument();
  });
});
