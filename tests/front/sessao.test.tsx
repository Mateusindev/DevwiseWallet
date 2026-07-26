// Sessão: AuthGate + LoginForm + logout, com o app Hono real por trás.
// É o smoke da suíte inteira — se este arquivo passa, a ponte de fetch, o
// cookie jar httpOnly, o boot do FinanceProvider e o render do App funcionam.
import { beforeEach, describe, expect, it } from "bun:test";
import {
  createUser,
  renderAnon,
  renderApp,
  resetDb,
  screen,
  seedRoles,
  userEvent,
} from "./harness";

beforeEach(async () => {
  await resetDb();
  await seedRoles();
});

describe("gate de sessão", () => {
  it("sem cookie cai no login (não monta o app)", async () => {
    await renderAnon({ skipReset: true });

    expect(screen.getByPlaceholderText("email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.queryByText("Início")).not.toBeInTheDocument();
  });

  it("com cookie válido monta o app já com os dados do /state", async () => {
    await renderApp({ roles: ["admin"], skipReset: true, seed: true });

    // nav (sidebar + barra mobile) e conteúdo do dashboard
    expect(screen.getAllByRole("button", { name: "Início" }).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("Reserva de emergência")).length).toBeGreaterThan(0);
    expect(screen.queryByText("Carregando suas finanças…")).not.toBeInTheDocument();
  });
});

describe("login pela tela", () => {
  it("credencial correta troca o form pelo app", async () => {
    const conta = await createUser({ roles: ["admin"] });
    const u = userEvent.setup();
    await renderAnon({ skipReset: true });

    await u.type(screen.getByPlaceholderText("email"), conta.email);
    await u.type(screen.getByPlaceholderText("senha"), conta.senha);
    await u.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findAllByText("finanças pessoais")).not.toHaveLength(0);
    expect(screen.queryByPlaceholderText("email")).not.toBeInTheDocument();
  });

  it("credencial errada mostra a mensagem genérica do back e mantém o form", async () => {
    const conta = await createUser({ roles: ["admin"] });
    const u = userEvent.setup();
    await renderAnon({ skipReset: true });

    await u.type(screen.getByPlaceholderText("email"), conta.email);
    await u.type(screen.getByPlaceholderText("senha"), "errada123");
    await u.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByText("Email ou senha inválidos")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("email")).toBeInTheDocument();
  });

  it("conta inativa não entra", async () => {
    const conta = await createUser({ roles: ["admin"], ativo: false });
    const u = userEvent.setup();
    await renderAnon({ skipReset: true });

    await u.type(screen.getByPlaceholderText("email"), conta.email);
    await u.type(screen.getByPlaceholderText("senha"), conta.senha);
    await u.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByText("Email ou senha inválidos")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("email")).toBeInTheDocument();
  });
});

describe("cadastro", () => {
  it("cria a conta e já entra", async () => {
    const u = userEvent.setup();
    await renderAnon({ skipReset: true });

    await u.click(screen.getByRole("button", { name: /Criar conta/i }));
    await u.type(screen.getByPlaceholderText("nome"), "Fulana");
    await u.type(screen.getByPlaceholderText("email"), "fulana@teste.local");
    await u.type(screen.getByPlaceholderText("senha (mín. 6)"), "senha123");
    await u.click(screen.getByRole("button", { name: "Criar conta" }));

    expect(await screen.findAllByText("finanças pessoais")).not.toHaveLength(0);
  });

  it("email duplicado aparece como erro inline", async () => {
    await createUser({ email: "dup@teste.local", roles: ["admin"] });
    const u = userEvent.setup();
    await renderAnon({ skipReset: true });

    await u.click(screen.getByRole("button", { name: /Criar conta/i }));
    await u.type(screen.getByPlaceholderText("nome"), "Outra");
    await u.type(screen.getByPlaceholderText("email"), "dup@teste.local");
    await u.type(screen.getByPlaceholderText("senha (mín. 6)"), "senha123");
    await u.click(screen.getByRole("button", { name: "Criar conta" }));

    expect(await screen.findByText("Email já cadastrado")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("nome")).toBeInTheDocument();
  });

  it("alternar login↔cadastro limpa o erro e o campo nome", async () => {
    const u = userEvent.setup();
    await renderAnon({ skipReset: true });

    await u.type(screen.getByPlaceholderText("email"), "ninguem@teste.local");
    await u.type(screen.getByPlaceholderText("senha"), "seja-la-o-que-for");
    await u.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText("Email ou senha inválidos")).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: /Criar conta/i }));
    expect(screen.queryByText("Email ou senha inválidos")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("nome")).toBeInTheDocument();

    await u.click(screen.getByRole("button", { name: /Já tenho conta/i }));
    expect(screen.queryByPlaceholderText("nome")).not.toBeInTheDocument();
  });
});

describe("logout", () => {
  it("volta pro login e expira o cookie do jar", async () => {
    const { bridge, user1 } = await renderApp({ roles: ["admin"], skipReset: true });
    expect(bridge.jar.has("auth_token")).toBe(true);

    await user1.click(screen.getByTitle(/^Sair/));

    expect(await screen.findByPlaceholderText("email")).toBeInTheDocument();
    expect(bridge.jar.has("auth_token")).toBe(false);
  });
});
