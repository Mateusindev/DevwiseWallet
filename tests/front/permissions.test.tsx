// Matriz permission × tela. Cada linha "❌" do TESTES-FRONTEND.md vira DUAS
// asserções: a UI de mutação não aparece E a rota nega. São bugs independentes
// — `can()` é só cosmético, a autoridade é o back.
import { beforeEach, describe, expect, it } from "bun:test";
import { goTo, renderApp, resetDb, screen, seedRoles } from "./harness";

beforeEach(async () => {
  await resetDb();
  await seedRoles();
});

// Request crua pela mesma ponte/sessão do render — pra checar o que o back faz
// quando o front esconde o botão.
async function req(method: string, path: string, body?: unknown) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.status;
}

describe("dashboard — movimentacao:manage e caixinha:manage", () => {
  it("membro vê as ações de aporte/despesa e o 'Nova' das caixinhas", async () => {
    // com zero caixinhas as ações de movimentação somem (não há de onde tirar
    // nem pra onde levar dinheiro) — o cenário precisa de uma caixinha
    await renderApp({
      roles: ["membro"],
      skipReset: true,
      setup: async ({ api }) => { await api.post("/caixinhas", { nome: "Viagem", cor: "blue" }); },
    });

    // dois "Aporte": o do header e o do card da caixinha
    expect(screen.getAllByRole("button", { name: /^Aporte$/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Registrar despesa" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nova/ })).toBeInTheDocument();
  });

  it("leitor não vê nenhuma delas — e as rotas negam", async () => {
    await renderApp({ roles: ["leitor"], skipReset: true });

    expect(screen.queryByRole("button", { name: /Aporte/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Registrar despesa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Nova$/ })).not.toBeInTheDocument();

    expect(await req("POST", "/caixinhas", { nome: "X" })).toBe(403);
    expect(await req("POST", "/movimentacoes", { caixinhaId: "x", tipo: "aporte", valor: 1 })).toBe(403);
  });
});

describe("dashboard — orcamento:view", () => {
  it("bloco de gráficos aparece pro leitor (é view)", async () => {
    await renderApp({ roles: ["leitor"], skipReset: true });
    expect(screen.getByText("Gráficos do orçamento")).toBeInTheDocument();
  });

  it("sem orcamento:view o bloco inteiro some", async () => {
    await renderApp({
      permissions: ["state:view", "caixinha:view", "cartao:view"],
      skipReset: true,
    });
    expect(screen.queryByText("Gráficos do orçamento")).not.toBeInTheDocument();
    expect(screen.getByText("Total guardado")).toBeInTheDocument();
  });
});

describe("despesas — orcamento:manage e espaco:manage", () => {
  it("membro vê os gatilhos de lançamento e o '+' de página", async () => {
    const { user1 } = await renderApp({ roles: ["membro"], skipReset: true, seed: true });
    await goTo("fixas", user1);

    expect(await screen.findByRole("button", { name: /Lançar receita/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Adicionar/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nova fixa/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Editar$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Novo espaço de despesa" })).toBeInTheDocument();
  });

  it("leitor não vê nenhum gatilho — e as rotas de mutação negam", async () => {
    const { user1 } = await renderApp({ roles: ["leitor"], skipReset: true, seed: true });
    await goTo("fixas", user1);

    expect(await screen.findByText(/^Despesas ·/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Lançar receita/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Adicionar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nova fixa/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Editar$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Novo espaço de despesa" })).not.toBeInTheDocument();

    const { espacos } = await (await fetch("/api/despesas/espacos")).json();
    const esp = espacos[0].id;
    expect(await req("POST", `/despesas/espacos/${esp}/fixas`, { descricao: "X", valor: 1 })).toBe(403);
    expect(await req("POST", "/despesas/espacos", { nome: "Outra" })).toBe(403);
    expect(await req("PUT", "/despesas/espacos/active", { id: esp })).toBe(403);
  });
});

describe("cartões — cartao:manage, cartao:share e cartao:view_shared", () => {
  it("membro edita/compartilha, mas não vê o painel 'O que devo'", async () => {
    const { user1 } = await renderApp({ roles: ["membro"], skipReset: true, seed: true });
    await goTo("cartoes", user1);

    expect(await screen.findByRole("button", { name: /Novo cartão/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Editar cartão" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Compartilhar cartão" }).length).toBeGreaterThan(0);
    // membro não tem cartao:view_shared
    expect(screen.queryByText("O que devo")).not.toBeInTheDocument();
  });

  it("leitor só lê: sem botões, com o painel 'O que devo', e as rotas negam", async () => {
    const { user1 } = await renderApp({ roles: ["leitor"], skipReset: true, seed: true });
    await goTo("cartoes", user1);

    expect(await screen.findByText("Cartões de crédito")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Novo cartão/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar cartão" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remover cartão" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compartilhar cartão" })).not.toBeInTheDocument();

    expect(await req("POST", "/cartoes", { nome: "X", limite: 1000 })).toBe(403);
    expect(await req("GET", "/me/compartilhamentos")).toBe(200); // tem view_shared
  });

  it("sem cartao:view_shared a rota do 'O que devo' nega", async () => {
    await renderApp({
      permissions: ["state:view", "caixinha:view", "cartao:view"],
      skipReset: true,
    });
    expect(await req("GET", "/me/compartilhamentos")).toBe(403);
  });
});

describe("admin — user:view / role:view", () => {
  it("admin vê as duas abas", async () => {
    const { user1 } = await renderApp({ roles: ["admin"], skipReset: true });
    await goTo("admin", user1);

    expect(await screen.findByRole("button", { name: /Usuários/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Roles/ })).toBeInTheDocument();
  });

  it("só role:view: a aba de usuários não existe e a rota nega", async () => {
    const { user1 } = await renderApp({ permissions: ["state:view", "role:view"], skipReset: true });
    await goTo("admin", user1);

    expect(await screen.findByRole("button", { name: /Roles/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Usuários/ })).not.toBeInTheDocument();

    expect(await req("GET", "/admin/users")).toBe(403);
    expect(await req("GET", "/admin/roles")).toBe(200);
  });

  it("membro nem chega na área e as rotas de admin negam", async () => {
    await renderApp({ roles: ["membro"], skipReset: true });

    expect(screen.queryAllByRole("button", { name: "Admin" })).toHaveLength(0);
    expect(await req("GET", "/admin/users")).toBe(403);
    expect(await req("GET", "/admin/roles")).toBe(403);
    expect(await req("POST", "/admin/roles", { nome: "x", permissions: [] })).toBe(403);
  });
});

describe("isolamento entre contas", () => {
  it("caixinha de outro dono responde 404 e não aparece na tela", async () => {
    // conta A com dados de exemplo
    const a = await renderApp({ roles: ["admin"], skipReset: true, seed: true });
    const caixinhasA = await (await fetch("/api/caixinhas")).json();
    const idA = caixinhasA[0].id;
    a.bridge.restore();

    // conta B na mesma base, sem tocar nos dados de A
    const b = await renderApp({ roles: ["admin"], skipReset: true, seed: true });
    // o render de A já saiu do document (cleanup roda por teste, não por render):
    // aqui as duas árvores coexistem, então a query é a plural
    expect(await screen.findAllByText("Total guardado")).not.toHaveLength(0);

    expect(await req("GET", `/caixinhas/${idA}`)).toBe(404);
    expect(await req("PATCH", `/caixinhas/${idA}`, { nome: "invadida" })).toBe(404);
    expect(await req("DELETE", `/caixinhas/${idA}`)).toBe(404);

    const caixinhasB = await (await fetch("/api/caixinhas")).json();
    expect(caixinhasB.map((c: { id: string }) => c.id)).not.toContain(idA);
    b.bridge.restore();
  });
});
