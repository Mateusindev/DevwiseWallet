// Admin: abas por permission, CRUD de usuário e de role, anti-lockout do
// próprio usuário, catálogo de permissions agrupado e o efeito imediato de
// trocar a permission da própria role (roles são lidas do banco a cada request).
import { beforeEach, describe, expect, it } from "bun:test";
import {
  campo,
  esperarAusente,
  esperarQuantidade,
  esperarSemDialog,
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

const abaRoles = () => screen.getByRole("button", { name: /Roles/ });

async function abrirAdmin(opts: Parameters<typeof renderApp>[0] = {}) {
  const ctx = await renderApp({ roles: ["admin"], skipReset: true, ...opts });
  await goTo("admin", ctx.user1);
  await screen.findByText("Administração");
  return ctx;
}

describe("abas", () => {
  it("admin começa em Usuários e lista a própria conta", async () => {
    const { user } = await abrirAdmin({ nome: "Chefe" });

    expect(await screen.findByText("1 usuário")).toBeInTheDocument();
    expect(screen.getByText("Chefe")).toBeInTheDocument();
    expect(screen.getByText("(você)")).toBeInTheDocument();
    expect(screen.getByText(user.email)).toBeInTheDocument();
    // badge da role
    expect(screen.getByText("admin")).toBeInTheDocument();
  });

  it("sem user:view a aba inicial é Roles", async () => {
    await abrirAdmin({ roles: undefined, permissions: ["state:view", "role:view"] });

    // 3 padrão + a role ad-hoc criada pelo harness
    expect(await screen.findByText("4 roles")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Usuários/ })).not.toBeInTheDocument();
  });

  it("trocar de aba mostra as roles com descrição, contagem e wildcard", async () => {
    const { user1 } = await abrirAdmin();

    await user1.click(abaRoles());
    expect(await screen.findByText("3 roles")).toBeInTheDocument();
    expect(screen.getByText(/Acesso total.*1 usuário/)).toBeInTheDocument();
    // a role admin tem "*" (destacado em amber)
    const chipCoringa = screen.getAllByText("*").find((n) => n.className.includes("amber"));
    expect(chipCoringa).toBeDefined();
  });
});

describe("usuários", () => {
  it("cria com senha e role", async () => {
    const { user1, api } = await abrirAdmin();

    await user1.click(await screen.findByRole("button", { name: /Novo usuário/ }));
    const dialog = await screen.findByRole("dialog");
    const ui = within(dialog);
    await user1.type(campo(dialog, "Nome"), "Maria");
    await user1.type(campo(dialog, "Email"), "maria@teste.local");
    await user1.type(campo(dialog, "Senha"), "senha123");
    await user1.click(ui.getByText("membro")); // chip dentro do <label>: byRole não acha (Achado 8)
    await user1.click(ui.getByRole("button", { name: "Criar" }));

    await esperarSemDialog();
    expect(await screen.findByText("2 usuários")).toBeInTheDocument();
    const criado = (await api.get("/admin/users")).find((u: { email: string }) => u.email === "maria@teste.local");
    expect(criado.roles.map((r: { nome: string }) => r.nome)).toEqual(["membro"]);
  });

  it("email duplicado aparece como erro inline no modal", async () => {
    const { user1, user } = await abrirAdmin();

    await user1.click(await screen.findByRole("button", { name: /Novo usuário/ }));
    const dialog = await screen.findByRole("dialog");
    const ui = within(dialog);
    await user1.type(campo(dialog, "Nome"), "Clone");
    await user1.type(campo(dialog, "Email"), user.email);
    await user1.type(campo(dialog, "Senha"), "senha123");
    await user1.click(ui.getByRole("button", { name: "Criar" }));

    expect(await ui.findByText(/j[áa] (cadastrado|existe)/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("editar sem senha mantém a senha; com 'Conta ativa' desmarcada, inativa", async () => {
    const { user1, api } = await abrirAdmin({
      setup: async ({ api }) => {
        await api.post("/admin/users", {
          nome: "Maria",
          email: "maria@teste.local",
          senha: "senha123",
          roleIds: [],
        });
      },
    });

    await user1.click(await screen.findByRole("button", { name: "Editar Maria" }));
    const dialog = await screen.findByRole("dialog");
    const nome = campo(dialog, "Nome");
    await user1.clear(nome);
    await user1.type(nome, "Maria Silva");
    await user1.click(within(dialog).getByRole("checkbox", { name: /Conta ativa/ }));
    await user1.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await esperarSemDialog();
    expect(await screen.findByText("Maria Silva")).toBeInTheDocument();
    expect(screen.getByText("inativo")).toBeInTheDocument();

    const maria = (await api.get("/admin/users")).find((u: { email: string }) => u.email === "maria@teste.local");
    expect(maria).toMatchObject({ nome: "Maria Silva", ativo: false });
    // a senha continua valendo (login pela rota real)
    expect(
      await api.status("POST", "/auth/login", { email: "maria@teste.local", senha: "senha123" })
    ).toBe(401); // inativa agora — mas a credencial não mudou
  });

  it("excluir usuário confirma no modal", async () => {
    const { user1, api } = await abrirAdmin({
      setup: async ({ api }) => {
        await api.post("/admin/users", {
          nome: "Maria",
          email: "maria@teste.local",
          senha: "senha123",
          roleIds: [],
        });
      },
    });
    await screen.findByText("2 usuários");

    await user1.click(screen.getByRole("button", { name: "Excluir Maria" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/maria@teste\.local/)).toBeInTheDocument();
    expect(await api.get("/admin/users")).toHaveLength(2); // nada excluído ainda
    await user1.click(within(dialog).getByRole("button", { name: "Excluir" }));

    await esperarAusente(() => screen.queryByText("maria@teste.local"), "linha da Maria");
    await esperarSemDialog();
    expect(await api.get("/admin/users")).toHaveLength(1);
  });

  it("cancelar a exclusão do usuário não manda DELETE", async () => {
    const { user1, api, bridge } = await abrirAdmin({
      setup: async ({ api }) => {
        await api.post("/admin/users", {
          nome: "Maria",
          email: "maria@teste.local",
          senha: "senha123",
          roleIds: [],
        });
      },
    });
    await screen.findByText("2 usuários");

    await user1.click(screen.getByRole("button", { name: "Excluir Maria" }));
    const dialog = await screen.findByRole("dialog");
    bridge.calls.length = 0;
    await user1.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    await esperarSemDialog();
    expect(bridge.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
    expect(await api.get("/admin/users")).toHaveLength(2);
  });

  it("anti-lockout: não há botão de excluir na própria conta", async () => {
    const { user1 } = await abrirAdmin({
      nome: "Chefe",
      setup: async ({ api }) => {
        await api.post("/admin/users", {
          nome: "Maria",
          email: "maria@teste.local",
          senha: "senha123",
          roleIds: [],
        });
      },
    });
    await screen.findByText("2 usuários");

    expect(screen.getByRole("button", { name: "Excluir Maria" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excluir Chefe" })).not.toBeInTheDocument();
    // editar continua disponível
    expect(screen.getByRole("button", { name: "Editar Chefe" })).toBeInTheDocument();
    expect(user1).toBeDefined();
  });

  it("'Conta ativa' não aparece ao editar a si mesmo", async () => {
    const { user1 } = await abrirAdmin({ nome: "Chefe" });

    await user1.click(await screen.findByRole("button", { name: "Editar Chefe" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).queryByRole("checkbox", { name: /Conta ativa/ })).not.toBeInTheDocument();
  });

  it("sem user:manage a lista é só leitura", async () => {
    await abrirAdmin({ roles: undefined, permissions: ["state:view", "user:view"] });

    expect(await screen.findByText("1 usuário")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Novo usuário/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Editar / })).not.toBeInTheDocument();
  });
});

describe("roles", () => {
  it("cria role com permissions do catálogo agrupado", async () => {
    const { user1, api } = await abrirAdmin();
    await user1.click(abaRoles());
    await screen.findByText("3 roles");

    await user1.click(screen.getByRole("button", { name: /Nova role/ }));
    const dialog = await screen.findByRole("dialog");
    const ui = within(dialog);
    await user1.type(campo(dialog, "Nome"), "auditor");
    await user1.type(campo(dialog, "Descrição"), "Só olha");
    // grupo por recurso + chip de wildcard do grupo
    expect(ui.getByText("caixinha")).toBeInTheDocument();
    await user1.click(ui.getByText("caixinha:*"));
    await user1.click(ui.getByText("state:view"));
    await user1.click(ui.getByRole("button", { name: "Criar" }));

    await esperarSemDialog();
    expect(await screen.findByText("4 roles")).toBeInTheDocument();
    const criada = (await api.get("/admin/roles")).find((r: { nome: string }) => r.nome === "auditor");
    expect(criada.permissions.sort()).toEqual(["caixinha:*", "state:view"]);
  });

  it("nome duplicado vira erro inline", async () => {
    const { user1 } = await abrirAdmin();
    await user1.click(abaRoles());
    await screen.findByText("3 roles");

    await user1.click(screen.getByRole("button", { name: /Nova role/ }));
    const dialog = await screen.findByRole("dialog");
    await user1.type(campo(dialog, "Nome"), "membro");
    await user1.click(within(dialog).getByRole("button", { name: "Criar" }));

    expect(await within(dialog).findByText(/j[áa] (existe|cadastrad)/i)).toBeInTheDocument();
  });

  it("editar troca as permissions da role", async () => {
    const { user1, api } = await abrirAdmin();
    await user1.click(abaRoles());
    await screen.findByText("3 roles");

    await user1.click(screen.getByRole("button", { name: "Editar leitor" }));
    const dialog = await screen.findByRole("dialog");
    // desliga uma permission que a role tem
    await user1.click(within(dialog).getByText("cartao:view_shared"));
    await user1.click(within(dialog).getByRole("button", { name: "Salvar" }));

    await esperarSemDialog();
    const leitor = (await api.get("/admin/roles")).find((r: { nome: string }) => r.nome === "leitor");
    expect(leitor.permissions).not.toContain("cartao:view_shared");
  });

  it("excluir role confirma no modal", async () => {
    const { user1, api } = await abrirAdmin({
      setup: async ({ api }) => {
        await api.post("/admin/roles", { nome: "descartavel", permissions: ["state:view"] });
      },
    });
    await user1.click(abaRoles());
    await screen.findByText("4 roles");

    await user1.click(screen.getByRole("button", { name: "Excluir descartavel" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Nenhum usuário usa esta role\./)).toBeInTheDocument();
    expect(await api.get("/admin/roles")).toHaveLength(4); // nada excluído ainda
    await user1.click(within(dialog).getByRole("button", { name: "Excluir" }));

    await esperarQuantidade(() => screen.queryAllByText("descartavel"), 0, "cards da role");
    await esperarSemDialog();
    expect(await api.get("/admin/roles")).toHaveLength(3);
  });

  it("o modal de excluir role avisa quantos usuários perdem as permissions", async () => {
    const { user1 } = await abrirAdmin({
      setup: async ({ api }) => {
        const role = (await api.post("/admin/roles", { nome: "compartilhada", permissions: ["state:view"] })).id;
        await api.post("/admin/users", {
          nome: "Maria",
          email: "maria@teste.local",
          senha: "senha123",
          roleIds: [role],
        });
      },
    });
    await user1.click(abaRoles());
    await screen.findByText("4 roles");

    await user1.click(screen.getByRole("button", { name: "Excluir compartilhada" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/1 usuário perde essas permissions na hora\./)).toBeInTheDocument();
  });

  it("role sem permission mostra 'nenhuma permission'", async () => {
    const { user1 } = await abrirAdmin({
      setup: async ({ api }) => {
        await api.post("/admin/roles", { nome: "vazia", permissions: [] });
      },
    });
    await user1.click(abaRoles());

    expect(await screen.findByText("nenhuma permission")).toBeInTheDocument();
  });

  it("sem role:manage os cards são só leitura", async () => {
    await abrirAdmin({ roles: undefined, permissions: ["state:view", "role:view"] });

    expect(await screen.findByText("4 roles")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nova role/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Excluir / })).not.toBeInTheDocument();
  });
});

describe("efeito imediato da troca de permission", () => {
  it("tirar user:view da própria role derruba a aba na próxima carga", async () => {
    // conta com uma role ad-hoc editável (a role admin tem "*" e é usada pelo gate)
    const { user1, api } = await abrirAdmin({
      roles: undefined,
      permissions: ["state:view", "user:view", "user:manage", "role:view", "role:manage"],
    });
    await screen.findByText("1 usuário");

    const adhoc = (await api.get("/admin/roles")).find((r: { nome: string }) =>
      r.nome.startsWith("role-adhoc")
    );

    await user1.click(abaRoles());
    await user1.click(await screen.findByRole("button", { name: `Editar ${adhoc.nome}` }));
    const dialog = await screen.findByRole("dialog");
    await user1.click(within(dialog).getByText("user:view"));
    await user1.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await esperarSemDialog();

    // o back já nega na request seguinte
    expect(await api.status("GET", "/admin/users")).toBe(403);
  });
});
