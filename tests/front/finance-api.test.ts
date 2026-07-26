// services/financeApi.ts — o único seam entre front e API. Aqui ele é exercido
// direto (sem componente), pelo mesmo caminho de sempre: ponte de fetch → app
// Hono → Prisma. Cobre o `unwrap` (propagação de erro, corpo vazio, 401 do me)
// e os endpoints que nenhuma tela dispara hoje.
import { beforeEach, describe, expect, it } from "bun:test";
import * as api from "@/services/financeApi";
import { createUser, espacoAtivo, installFetchBridge, login, resetDb, seedRoles } from "./harness";

beforeEach(async () => {
  await resetDb();
  await seedRoles();
});

async function sessao(opts: Parameters<typeof createUser>[0] = { roles: ["admin"] }) {
  const user = await createUser(opts);
  const bridge = installFetchBridge();
  await login(user.email, user.senha);
  return { user, bridge };
}

describe("unwrap", () => {
  it("propaga a mensagem de erro do back (não 'HTTP 4xx')", async () => {
    await sessao({ permissions: ["state:view"] });

    expect(api.getCartoes()).rejects.toThrow("Sem permissão: cartao:view");
  });

  it("erro de validação do zValidator chega como mensagem", async () => {
    await sessao();

    // valor negativo → 422 do zValidator
    expect(api.addCaixinha({ nome: "X", meta: -5 } as never)).rejects.toThrow();
  });

  it("DELETE devolve o corpo do back e o recurso some", async () => {
    await sessao();
    const cx = await api.addCaixinha({ nome: "Some" });

    expect(await api.removeCaixinha(cx.id)).toMatchObject({ id: cx.id });
    expect((await api.getBootstrap()).caixinhas).toEqual([]);
  });

  it("me() devolve null em 401 e o AuthUser quando logado", async () => {
    const { user, bridge } = await sessao();

    const eu = await api.me();
    expect(eu).toMatchObject({ email: user.email, roles: ["admin"] });
    expect(eu!.permissions).toContain("*");

    bridge.jar.clear(); // simula sessão perdida
    expect(await api.me()).toBeNull();
  });

  it("register/login/logout passam pelo mesmo unwrap", async () => {
    installFetchBridge();

    const novo = await api.register("Fulana", "fulana@teste.local", "senha123");
    expect(novo).toMatchObject({ email: "fulana@teste.local", roles: ["membro"] });

    expect(api.register("Outra", "fulana@teste.local", "senha123")).rejects.toThrow(
      "Email já cadastrado"
    );

    await api.logout();
    expect(await api.me()).toBeNull();

    const logada = await api.login("fulana@teste.local", "senha123");
    expect(logada.nome).toBe("Fulana");
  });
});

describe("endpoints sem UI própria", () => {
  it("renameEspaco troca o nome", async () => {
    await sessao();
    const esp = await espacoAtivo();

    const renomeado = await api.renameEspaco(esp, "Casa & Cia");
    expect(renomeado).toMatchObject({ id: esp, nome: "Casa & Cia" });
    const { espacos } = await api.getEspacos();
    expect(espacos.find((e) => e.id === esp)!.nome).toBe("Casa & Cia");
  });

  it("categoria: update e remove", async () => {
    await sessao();
    await espacoAtivo(); // boot cria as categorias padrão

    const nova = await api.addCategoria({ nome: "Pets", cor: "cyan" });
    const editada = await api.updateCategoria(nova.id, { nome: "Pet shop", cor: "rose" });
    expect(editada).toMatchObject({ nome: "Pet shop", cor: "rose" });

    await api.removeCategoria(nova.id);
    expect((await api.getCategorias()).find((c) => c.id === nova.id)).toBeUndefined();
  });

  it("contato: update e remove", async () => {
    await sessao();

    const contato = await api.addContato({ nome: "Maria", email: null });
    const editado = await api.updateContato(contato.id, { nome: "Maria Silva" });
    expect(editado).toMatchObject({ nome: "Maria Silva" });

    await api.removeContato(contato.id);
    expect(await api.getContatos()).toEqual([]);
  });

  it("share: update do percentual", async () => {
    await sessao();
    const esp = await espacoAtivo();
    const cartao = await api.addCartao({ nome: "Nubank", limite: 5000 });
    const fixa = await api.addDespesaFixa(esp, {
      descricao: "Streaming",
      valor: 100,
      cartaoId: cartao.id,
    });
    const contato = await api.addContato({ nome: "Maria", email: null });
    const share = await api.addCartaoShare(cartao.id, {
      contatoId: contato.id,
      tipo: "linha",
      despesaFixaId: fixa.id,
      percentual: 50,
    });

    const atualizado = await api.updateCartaoShare(share.id, { percentual: 25 });
    expect(atualizado).toMatchObject({ percentual: 25 });
    const [depois] = await api.getCartaoShares(cartao.id);
    expect(depois.valorMes).toBe(25);

    await api.removeCartaoShare(share.id);
    expect(await api.getCartaoShares(cartao.id)).toEqual([]);
  });

  it("resetState devolve a conta aos dados de exemplo", async () => {
    await sessao();
    await api.addCaixinha({ nome: "Minha caixinha" });

    await api.resetState();

    const { caixinhas } = await api.getBootstrap();
    const nomes = caixinhas.map((c) => c.nome);
    expect(nomes).not.toContain("Minha caixinha");
    expect(nomes).toContain("Reserva de emergência");
  });

  it("movimentação: remover devolve a caixinha com o saldo revertido", async () => {
    await sessao();
    const cx = await api.addCaixinha({ nome: "Viagem" });

    const { movimentacao, caixinha } = await api.addAporte({
      caixinhaId: cx.id,
      valor: 250,
      descricao: "Aporte",
    });
    expect(caixinha.saldo).toBe(250);

    const depois = await api.removeMovimentacao(movimentacao.id);
    expect(depois.caixinha.saldo).toBe(0);
  });

  it("getCartoes aceita ?ym e muda o agregado", async () => {
    await sessao();
    const esp = await espacoAtivo();
    const cartao = await api.addCartao({ nome: "Nubank", limite: 5000 });
    const ym = new Date().toISOString().slice(0, 7);
    await api.addDespesaMes(esp, {
      mes: ym,
      descricao: "Compra",
      valor: 100,
      cartaoId: cartao.id,
    });

    const [doMes] = await api.getCartoes(ym);
    expect(doMes.faturaMes).toBe(100);

    const outro = `${Number(ym.slice(0, 4)) - 1}-01`;
    const [deOutroMes] = await api.getCartoes(outro);
    expect(deOutroMes.faturaMes).toBe(0);
  });

  it("listPermissions devolve o catálogo usado pelo RoleModal", async () => {
    await sessao();

    const { permissions } = await api.listPermissions();
    expect(permissions).toContain("caixinha:manage");
    expect(permissions).toContain("cartao:view_shared");
  });
});
