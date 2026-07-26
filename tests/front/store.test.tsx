// store/FinanceContext.jsx — as ações que nenhuma tela dispara hoje (renomear
// espaço, editar/remover categoria, excluir a página ativa, restaurar dados de
// exemplo) e o comportamento do reducer nos casos de borda.
//
// Nada é mockado: o provider real fala com o app Hono pela ponte de fetch. Um
// componente-sonda expõe o contexto pro teste.
import { beforeEach, describe, expect, it } from "bun:test";
import { useEffect } from "react";
import {
  act,
  createUser,
  installFetchBridge,
  login,
  render,
  resetDb,
  screen,
  seedRoles,
} from "./harness";
import { FinanceProvider, useFinance } from "@/store/FinanceContext.jsx";

beforeEach(async () => {
  await resetDb();
  await seedRoles();
});

type Fin = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function Sonda({ aoMontar }: { aoMontar: (fin: Fin) => void }) {
  const fin = useFinance() as Fin;
  useEffect(() => { aoMontar(fin); });
  return (
    <div>
      <span data-testid="status">{fin.status}</span>
      <span data-testid="espacos">{fin.espacos.map((e: Fin) => e.nome).join(",")}</span>
      <span data-testid="categorias">{fin.categorias.map((c: Fin) => c.nome).join(",")}</span>
      <span data-testid="caixinhas">{fin.caixinhas.map((c: Fin) => c.nome).join(",")}</span>
      <span data-testid="ativo">
        {fin.espacos.find((e: Fin) => e.id === fin.activeEspacoId)?.nome ?? "—"}
      </span>
      <span data-testid="fixas">{fin.despesasFixas.map((d: Fin) => d.descricao).join(",")}</span>
    </div>
  );
}

// Provider real com sessão real; devolve o contexto vivo (sempre o do último render).
async function montarStore() {
  const user = await createUser({ roles: ["admin"] });
  const bridge = installFetchBridge();
  await login(user.email, user.senha);

  let atual: Fin = {};
  render(<FinanceProvider><Sonda aoMontar={(fin) => { atual = fin; }} /></FinanceProvider>);
  await screen.findByText("ready");

  return { user, bridge, fin: () => atual };
}

const txt = (id: string) => screen.getByTestId(id).textContent;

describe("boot", () => {
  it("sai de loading pra ready e traz os defaults do back", async () => {
    const { fin } = await montarStore();

    expect(txt("status")).toBe("ready");
    expect(txt("categorias")).toContain("Moradia");
    expect(fin().activeEspacoId).toBeTruthy();
  });

  it("erro no /state vira status error com a mensagem do back", async () => {
    const user = await createUser({ permissions: ["caixinha:view"] });
    installFetchBridge();
    await login(user.email, user.senha);

    render(<FinanceProvider><Sonda aoMontar={() => {}} /></FinanceProvider>);

    expect(await screen.findByText("error")).toBeInTheDocument();
  });
});

describe("espaços", () => {
  it("renameEspaco atualiza a lista (UPSERT_ESPACO)", async () => {
    const { fin } = await montarStore();
    const id = fin().activeEspacoId;

    await act(async () => { await fin().renameEspaco(id, "Casa nova"); });

    expect(txt("espacos")).toContain("Casa nova");
    expect(txt("ativo")).toBe("Casa nova");
  });

  it("excluir a página ATIVA troca pro espaço que o back devolveu", async () => {
    const { fin } = await montarStore();
    const primeiro = fin().activeEspacoId;

    await act(async () => { await fin().addEspaco({ nome: "Viagem", emoji: "✈️" }); });
    const viagem = fin().espacos.find((e: Fin) => e.nome === "Viagem");
    await act(async () => { await fin().setActiveEspaco(viagem.id); });
    await act(async () => {
      await fin().addDespesaFixa({ descricao: "Passagem", valor: 900, diaVencimento: 5 });
    });
    expect(txt("fixas")).toBe("Passagem");

    await act(async () => { await fin().removeEspaco(viagem.id); });

    // volta pro primeiro espaço E recarrega o orçamento dele (fixas trocam)
    expect(fin().activeEspacoId).toBe(primeiro);
    expect(txt("espacos")).not.toContain("Viagem");
    expect(txt("fixas")).toBe("");
  });

  it("excluir uma página NÃO ativa mantém o orçamento carregado", async () => {
    const { fin } = await montarStore();
    const primeiro = fin().activeEspacoId;

    await act(async () => {
      await fin().addDespesaFixa({ descricao: "Aluguel", valor: 600, diaVencimento: 5 });
      await fin().addEspaco({ nome: "Viagem", emoji: "✈️" });
    });
    const viagem = fin().espacos.find((e: Fin) => e.nome === "Viagem");

    await act(async () => { await fin().removeEspaco(viagem.id); });

    expect(fin().activeEspacoId).toBe(primeiro);
    expect(txt("fixas")).toBe("Aluguel");
  });

  it("setActiveEspaco com o id que já está ativo é no-op (sem request)", async () => {
    const { fin, bridge } = await montarStore();
    const id = fin().activeEspacoId;

    bridge.calls.length = 0;
    await act(async () => { await fin().setActiveEspaco(id); });

    expect(bridge.calls).toHaveLength(0);
    expect(fin().orcamentoStatus).toBe("ready");
  });

  it("ocultar/restaurar do mês mexe só em espacosOcultos", async () => {
    const { fin } = await montarStore();
    const ym = new Date().toISOString().slice(0, 7);

    await act(async () => { await fin().addEspaco({ nome: "Viagem", emoji: "✈️" }); });
    const viagem = fin().espacos.find((e: Fin) => e.nome === "Viagem");

    await act(async () => { await fin().ocultarEspacoMes(viagem.id, ym); });
    expect(fin().espacosOcultos).toEqual([{ espacoId: viagem.id, ym }]);

    // idempotente: ocultar de novo não duplica
    await act(async () => { await fin().ocultarEspacoMes(viagem.id, ym); });
    expect(fin().espacosOcultos).toHaveLength(1);

    await act(async () => { await fin().restaurarEspacoMes(viagem.id, ym); });
    expect(fin().espacosOcultos).toEqual([]);
  });
});

describe("categorias", () => {
  it("update e remove refletem no estado", async () => {
    const { fin } = await montarStore();

    await act(async () => { await fin().addCategoria({ nome: "Pets", cor: "cyan" }); });
    const pets = fin().categorias.find((c: Fin) => c.nome === "Pets");
    expect(pets).toBeDefined();

    await act(async () => { await fin().updateCategoria(pets.id, { nome: "Pet shop" }); });
    expect(txt("categorias")).toContain("Pet shop");
    expect(txt("categorias")).not.toContain("Pets,");

    await act(async () => { await fin().removeCategoria(pets.id); });
    expect(txt("categorias")).not.toContain("Pet shop");
  });
});

describe("reset", () => {
  it("resetAll troca os dados pelos de exemplo e refaz o boot", async () => {
    const { fin } = await montarStore();

    await act(async () => { await fin().addCaixinha({ nome: "Minha caixinha" }); });
    expect(txt("caixinhas")).toContain("Minha caixinha");

    await act(async () => { await fin().resetAll(); });

    expect(txt("status")).toBe("ready");
    expect(txt("caixinhas")).toContain("Reserva de emergência");
    expect(txt("caixinhas")).not.toContain("Minha caixinha");
  });
});

describe("cartões e movimentações", () => {
  it("upsert de cartão faz merge (não substitui o agregado)", async () => {
    const { fin } = await montarStore();

    await act(async () => { await fin().addCartao({ nome: "Nubank", limite: 1000 }); });
    const cartao = fin().cartoes[0];
    expect(cartao).toMatchObject({ nome: "Nubank", limite: 1000 });

    await act(async () => { await fin().updateCartao(cartao.id, { limite: 2000 }); });
    expect(fin().cartoes[0]).toMatchObject({ nome: "Nubank", limite: 2000 });
    expect(fin().cartoes).toHaveLength(1);

    await act(async () => { await fin().removeCartao(cartao.id); });
    expect(fin().cartoes).toEqual([]);
  });

  it("aporte e despesa variável atualizam saldo e histórico", async () => {
    const { fin } = await montarStore();

    await act(async () => { await fin().addCaixinha({ nome: "Viagem" }); });
    const cx = fin().caixinhas[0];

    await act(async () => {
      await fin().addAporte({ caixinhaId: cx.id, valor: 300, descricao: "Aporte" });
      await fin().addDespesaVariavel({ caixinhaId: cx.id, valor: 100, descricao: "Gasto" });
    });

    expect(fin().caixinhas[0].saldo).toBe(200);
    expect(fin().movimentacoes).toHaveLength(2);

    await act(async () => { await fin().removeMovimentacao(fin().movimentacoes[1].id); });
    expect(fin().caixinhas[0].saldo).toBe(300);
    expect(fin().movimentacoes).toHaveLength(1);
  });

  it("remover a caixinha leva as movimentações dela do estado", async () => {
    const { fin } = await montarStore();

    await act(async () => { await fin().addCaixinha({ nome: "Viagem" }); });
    const cx = fin().caixinhas[0];
    await act(async () => {
      await fin().addAporte({ caixinhaId: cx.id, valor: 50, descricao: "Aporte" });
    });
    expect(fin().movimentacoes).toHaveLength(1);

    await act(async () => { await fin().removeCaixinha(cx.id); });

    expect(fin().caixinhas).toEqual([]);
    expect(fin().movimentacoes).toEqual([]);
  });
});

describe("orçamento do espaço ativo", () => {
  it("receita do mês: add, update e remove", async () => {
    const { fin } = await montarStore();
    const ym = new Date().toISOString().slice(0, 7);

    await act(async () => {
      await fin().addReceitaMes({ mes: ym, descricao: "Freela", valor: 500 });
    });
    const receita = fin().receitasMes[0];
    expect(receita).toMatchObject({ descricao: "Freela", valor: 500 });

    await act(async () => { await fin().updateReceitaMes(receita.id, { valor: 800 }); });
    expect(fin().receitasMes[0].valor).toBe(800);

    await act(async () => { await fin().removeReceitaMes(receita.id); });
    expect(fin().receitasMes).toEqual([]);
  });

  it("renda: override do mês, salário fixo e limpar o override", async () => {
    const { fin } = await montarStore();
    const ym = new Date().toISOString().slice(0, 7);

    await act(async () => { await fin().setRendaMes(ym, 4200); });
    expect(fin().rendasMensais[ym]).toBe(4200);

    await act(async () => { await fin().setRendaFixa(3000); });
    expect(fin().config.rendaMensal).toBe(3000);

    await act(async () => { await fin().clearRendaMes(ym); });
    expect(fin().rendasMensais[ym]).toBeUndefined();
  });

  it("pagamento de fixa: valor > 0 entra na lista, 0 sai", async () => {
    const { fin } = await montarStore();
    const ym = new Date().toISOString().slice(0, 7);

    await act(async () => {
      await fin().addDespesaFixa({ descricao: "Aluguel", valor: 1000, diaVencimento: 5 });
    });
    const fixa = fin().despesasFixas[0];

    await act(async () => { await fin().setPagamentoFixa(fixa.id, ym, 400); });
    expect(fin().pagamentosFixas).toEqual([
      { despesaFixaId: fixa.id, ym, valorPago: 400 },
    ]);

    await act(async () => { await fin().setPagamentoFixa(fixa.id, ym, 0); });
    expect(fin().pagamentosFixas).toEqual([]);
  });

  it("toggle da fixa e remoção limpam os pagamentos dela", async () => {
    const { fin } = await montarStore();
    const ym = new Date().toISOString().slice(0, 7);

    await act(async () => {
      await fin().addDespesaFixa({ descricao: "Aluguel", valor: 1000, diaVencimento: 5 });
    });
    const fixa = fin().despesasFixas[0];
    await act(async () => { await fin().setPagamentoFixa(fixa.id, ym, 1000); });

    await act(async () => { await fin().toggleDespesaFixa(fixa.id); });
    expect(fin().despesasFixas[0].ativa).toBe(false);

    await act(async () => { await fin().removeDespesaFixa(fixa.id); });
    expect(fin().despesasFixas).toEqual([]);
    expect(fin().pagamentosFixas).toEqual([]);
  });

  it("despesa do mês: add, update, pagar e remover", async () => {
    const { fin } = await montarStore();
    const ym = new Date().toISOString().slice(0, 7);

    await act(async () => {
      await fin().addDespesaMes({ mes: ym, descricao: "Mercado", valor: 200 });
    });
    const dm = fin().despesasMes[0];

    await act(async () => { await fin().updateDespesaMes(dm.id, { valor: 250 }); });
    expect(fin().despesasMes[0].valor).toBe(250);

    await act(async () => { await fin().setPagaMes(dm.id, 250); });
    expect(fin().despesasMes[0]).toMatchObject({ valorPago: 250, paga: true });

    await act(async () => { await fin().removeDespesaMes(dm.id); });
    expect(fin().despesasMes).toEqual([]);
  });
});
