import { describe, expect, it, beforeEach, mock } from "bun:test";
import { AppError, NotFoundError } from "@/server/lib/errors";

type Row = Record<string, unknown>;

const db: {
  contatos: Row[];
  shares: Row[];
  users: Row[];
  updated: { id: string; data: Row } | null;
  contatoDeletado: string | null;
  shareCriado: Row | null;
  shareAtualizado: { id: string; data: Row } | null;
  shareDeletado: string | null;
  linhaExiste: boolean;
} = {
  contatos: [],
  shares: [],
  users: [],
  updated: null,
  contatoDeletado: null,
  shareCriado: null,
  shareAtualizado: null,
  shareDeletado: null,
  linhaExiste: true,
};

mock.module("@/server/modules/cartao/cartao.service", () => ({
  cartaoService: {
    getOrThrow: async (_userId: string, id: string) => {
      if (id === "alheio") throw new NotFoundError(`Cartão não encontrado: ${id}`);
      return { id };
    },
  },
}));

mock.module("@/server/modules/cartao-share/cartao-share.repository", () => ({
  cartaoShareRepository: {
    contatoList: async (ownerId: string) => db.contatos.filter((c) => c.ownerId === ownerId),
    contatoFindById: async (id: string, ownerId: string) =>
      db.contatos.find((c) => c.id === id && c.ownerId === ownerId) ?? null,
    contatoCreate: async (data: Row) => {
      const c = { id: "c-new", ...data };
      db.contatos.push(c);
      return c;
    },
    contatosByUserId: async (userId: string) => db.contatos.filter((c) => c.userId === userId),
    contatosUnlinkedByEmail: async (email: string) =>
      db.contatos.filter((c) => c.email === email && c.userId == null),
    contatoUpdate: async (id: string, data: Row) => {
      const c = db.contatos.find((r) => r.id === id)!;
      Object.assign(c, data);
      db.updated = { id, data };
      return c;
    },
    contatoDelete: async (id: string) => {
      db.contatoDeletado = id;
      db.contatos = db.contatos.filter((c) => c.id !== id);
    },
    userByEmail: async (email: string) => db.users.find((u) => u.email === email) ?? null,
    sharesByContatoIds: async (ids: string[]) =>
      db.shares.filter((s) => ids.includes(s.contatoId as string)),
    sharesByCartao: async (cartaoId: string) => db.shares.filter((s) => s.cartaoId === cartaoId),
    shareFindById: async (id: string) => db.shares.find((s) => s.id === id) ?? null,
    shareCreate: async (data: Row) => {
      db.shareCriado = data;
      return { id: "s-new", despesaFixa: null, despesaMes: null, ...data };
    },
    shareUpdate: async (id: string, data: Row) => {
      db.shareAtualizado = { id, data };
      const atual = db.shares.find((s) => s.id === id) ?? {};
      return { despesaFixa: null, despesaMes: null, ...atual, ...data };
    },
    shareDelete: async (id: string) => {
      db.shareDeletado = id;
    },
    despesaFixaExists: async () => (db.linhaExiste ? { id: "ok" } : null),
    despesaMesExists: async () => (db.linhaExiste ? { id: "ok" } : null),
  },
}));

const { shareValorNoMes, shareParcela, shareComprometido, cartaoShareService } = await import(
  "./cartao-share.service"
);

const OWNER = "dono-1"; // dono do cartão/agenda

const parcelada = (over: Row = {}) => ({
  parcelado: true,
  parcelaAtual: 1,
  totalParcelas: 10,
  parcelaMesRef: "2026-01",
  valor: 200,
  descricao: "Notebook",
  ...over,
});

beforeEach(() => {
  db.contatos = [];
  db.shares = [];
  db.users = [];
  db.updated = null;
  db.contatoDeletado = null;
  db.shareCriado = null;
  db.shareAtualizado = null;
  db.shareDeletado = null;
  db.linhaExiste = true;
});

const MES_CORRENTE = new Date().toISOString().slice(0, 7);

describe("shareValorNoMes — tipo valor", () => {
  it("recorrente (mesRef null) vale todo mês", () => {
    const s = { tipo: "valor", valor: 150, mesRef: null } as never;
    expect(shareValorNoMes(s, "2026-07")).toBe(150);
    expect(shareValorNoMes(s, "2026-12")).toBe(150);
  });

  it("pontual vale só no mesRef", () => {
    const s = { tipo: "valor", valor: 150, mesRef: "2026-07" } as never;
    expect(shareValorNoMes(s, "2026-07")).toBe(150);
    expect(shareValorNoMes(s, "2026-08")).toBe(0);
  });
});

describe("shareValorNoMes — tipo linha", () => {
  it("linha inteira = valor da despesa", () => {
    const s = { tipo: "linha", despesaFixa: parcelada(), despesaMes: null } as never;
    expect(shareValorNoMes(s, "2026-03")).toBe(200);
  });

  it("percentual aplica sobre a base", () => {
    const s = { tipo: "linha", percentual: 30, despesaFixa: parcelada(), despesaMes: null } as never;
    expect(shareValorNoMes(s, "2026-03")).toBe(60);
  });

  it("valor fixo limita à base", () => {
    const s = { tipo: "linha", valor: 500, despesaFixa: parcelada(), despesaMes: null } as never;
    expect(shareValorNoMes(s, "2026-03")).toBe(200); // min(500, 200)
  });

  it("fora da janela de parcelas = 0", () => {
    const s = { tipo: "linha", despesaFixa: parcelada(), despesaMes: null } as never;
    // âncora parcela 1 em 2026-01, total 10 → parcela 11 em 2026-11 (fora)
    expect(shareValorNoMes(s, "2026-11")).toBe(0);
  });

  it("despesa avulsa só conta no próprio mês", () => {
    const s = { tipo: "linha", despesaMes: { valor: 80, mes: "2026-07", descricao: "X" }, despesaFixa: null } as never;
    expect(shareValorNoMes(s, "2026-07")).toBe(80);
    expect(shareValorNoMes(s, "2026-08")).toBe(0);
  });
});

describe("shareParcela / shareComprometido", () => {
  it("reporta parcela atual, total e restantes", () => {
    const s = { tipo: "linha", despesaFixa: parcelada(), despesaMes: null } as never;
    // 2026-03 → parcela efetiva 3 de 10
    expect(shareParcela(s, "2026-03")).toEqual({ parcelaAtual: 3, totalParcelas: 10, restantes: 7 });
  });

  it("comprometido = restantes × parte por mês", () => {
    const s = { tipo: "linha", percentual: 50, despesaFixa: parcelada(), despesaMes: null } as never;
    // 2026-03 → 7 restantes × (200×50%) = 7 × 100
    expect(shareComprometido(s, "2026-03")).toBe(700);
  });

  it("linha não parcelada não tem parcela", () => {
    const s = { tipo: "linha", despesaFixa: { valor: 50, parcelado: false, descricao: "Y" }, despesaMes: null } as never;
    expect(shareParcela(s, "2026-03")).toBeNull();
    expect(shareComprometido(s, "2026-03")).toBe(0);
  });
});

describe("createContato — vínculo lazy por email", () => {
  it("associa userId se já existe usuário com o email", async () => {
    db.users = [{ id: "u-9", email: "ana@x.com" }];
    const v = await cartaoShareService.createContato(OWNER, { nome: "Ana", email: "ana@x.com" });
    expect(v.userId).toBe("u-9");
    expect(v.vinculado).toBe(true);
  });

  it("sem usuário correspondente fica sem vínculo", async () => {
    const v = await cartaoShareService.createContato(OWNER, { nome: "Bia", email: "bia@x.com" });
    expect(v.userId).toBeNull();
    expect(v.vinculado).toBe(false);
  });

  it("usuário já vinculado nesta agenda não vira 2º contato vinculado", async () => {
    db.users = [{ id: "u-9", email: "ana@x.com" }];
    db.contatos = [{ id: "c-1", ownerId: OWNER, nome: "Ana", email: "ana@x.com", userId: "u-9" }];
    const v = await cartaoShareService.createContato(OWNER, { nome: "Ana 2", email: "ana@x.com" });
    expect(v.userId).toBeNull();
  });
});

describe("contatos — leitura e escrita na agenda do dono", () => {
  it("listContatos só devolve a agenda do dono, com a flag vinculado", async () => {
    db.contatos = [
      { id: "c-1", ownerId: OWNER, nome: "Ana", email: "ana@x.com", userId: "u-9" },
      { id: "c-2", ownerId: OWNER, nome: "Bia", email: null, userId: null },
      { id: "c-3", ownerId: "outro-dono", nome: "Caio", email: null, userId: null },
    ];
    const vs = await cartaoShareService.listContatos(OWNER);
    expect(vs).toEqual([
      { id: "c-1", nome: "Ana", email: "ana@x.com", userId: "u-9", vinculado: true },
      { id: "c-2", nome: "Bia", email: null, userId: null, vinculado: false },
    ]);
  });

  it("contato de outra agenda → 404", async () => {
    db.contatos = [{ id: "c-3", ownerId: "outro-dono", nome: "Caio", email: null, userId: null }];
    expect(cartaoShareService.getContatoOrThrow(OWNER, "c-3")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("createContato sem email não tenta vincular", async () => {
    const v = await cartaoShareService.createContato(OWNER, { nome: "Bia" });
    expect(v).toMatchObject({ nome: "Bia", email: null, userId: null, vinculado: false });
  });

  it("updateContato só do nome não mexe no vínculo", async () => {
    db.contatos = [{ id: "c-1", ownerId: OWNER, nome: "Ana", email: "ana@x.com", userId: "u-9" }];
    await cartaoShareService.updateContato(OWNER, "c-1", { nome: "Ana Maria" });
    expect(db.updated).toEqual({ id: "c-1", data: { nome: "Ana Maria" } });
  });

  it("trocar o email reavalia o vínculo", async () => {
    db.users = [{ id: "u-7", email: "novo@x.com" }];
    db.contatos = [{ id: "c-1", ownerId: OWNER, nome: "Ana", email: "ana@x.com", userId: null }];
    const v = await cartaoShareService.updateContato(OWNER, "c-1", { email: "novo@x.com" });
    expect(v.userId).toBe("u-7");
  });

  it("limpar o email desfaz o vínculo", async () => {
    db.contatos = [{ id: "c-1", ownerId: OWNER, nome: "Ana", email: "ana@x.com", userId: "u-9" }];
    const v = await cartaoShareService.updateContato(OWNER, "c-1", { email: null });
    expect(v.userId).toBeNull();
    expect(v.vinculado).toBe(false);
  });

  it("editar o próprio contato não conflita consigo mesmo (exceptContatoId)", async () => {
    db.users = [{ id: "u-9", email: "ana@x.com" }];
    db.contatos = [{ id: "c-1", ownerId: OWNER, nome: "Ana", email: "ana@x.com", userId: "u-9" }];
    const v = await cartaoShareService.updateContato(OWNER, "c-1", { email: "ana@x.com" });
    expect(v.userId).toBe("u-9");
  });

  it("removeContato apaga (shares caem em cascata)", async () => {
    db.contatos = [{ id: "c-1", ownerId: OWNER, nome: "Ana", email: null, userId: null }];
    expect(await cartaoShareService.removeContato(OWNER, "c-1")).toEqual({ id: "c-1" });
    expect(db.contatoDeletado).toBe("c-1");
  });

  it("removeContato de outra agenda → 404 e nada é apagado", async () => {
    db.contatos = [{ id: "c-1", ownerId: "outro-dono", nome: "Ana", email: null, userId: null }];
    expect(cartaoShareService.removeContato(OWNER, "c-1")).rejects.toBeInstanceOf(NotFoundError);
    expect(db.contatoDeletado).toBeNull();
  });
});

describe("shares — gestão pelo dono", () => {
  const contatoNaAgenda = () => {
    db.contatos = [{ id: "c-1", ownerId: OWNER, nome: "Ana", email: null, userId: null }];
  };

  it("listByCartao devolve as linhas do cartão já calculadas no mês", async () => {
    db.shares = [
      {
        id: "s-1",
        cartaoId: "cart-1",
        contatoId: "c-1",
        tipo: "linha",
        percentual: 50,
        valor: null,
        mesRef: null,
        descricao: "",
        despesaFixa: parcelada(),
        despesaMes: null,
      },
    ];
    const [v] = await cartaoShareService.listByCartao(OWNER, "cart-1", "2026-03");
    expect(v).toMatchObject({ id: "s-1", linhaDescricao: "Notebook", valorMes: 100, comprometido: 700 });
  });

  it("listByCartao de cartão alheio → 404", async () => {
    expect(cartaoShareService.listByCartao(OWNER, "alheio", "2026-03")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("createShare tipo linha guarda o percentual e não usa mesRef", async () => {
    contatoNaAgenda();
    await cartaoShareService.createShare(OWNER, "cart-1", {
      contatoId: "c-1",
      tipo: "linha",
      despesaFixaId: "df-1",
      percentual: 33.335,
      mesRef: "2026-03",
    });
    expect(db.shareCriado).toMatchObject({
      cartaoId: "cart-1",
      contatoId: "c-1",
      tipo: "linha",
      despesaFixaId: "df-1",
      despesaMesId: null,
      percentual: 33.34,
      mesRef: null, // mesRef só vale pro tipo valor
      descricao: "",
    });
  });

  it("createShare tipo valor guarda mesRef e ignora percentual", async () => {
    contatoNaAgenda();
    await cartaoShareService.createShare(OWNER, "cart-1", {
      contatoId: "c-1",
      tipo: "valor",
      valor: 150.005,
      percentual: 50,
      mesRef: "2026-03",
      descricao: "Combustível",
    });
    expect(db.shareCriado).toMatchObject({
      tipo: "valor",
      valor: 150.01,
      percentual: null,
      mesRef: "2026-03",
      descricao: "Combustível",
    });
  });

  it("createShare tipo valor sem mesRef vira recorrente", async () => {
    contatoNaAgenda();
    await cartaoShareService.createShare(OWNER, "cart-1", { contatoId: "c-1", tipo: "valor", valor: 100 });
    expect(db.shareCriado!.mesRef).toBeNull();
  });

  it("createShare em cartão alheio → 404", async () => {
    contatoNaAgenda();
    expect(
      cartaoShareService.createShare(OWNER, "alheio", { contatoId: "c-1", tipo: "valor", valor: 10 })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("createShare com contato fora da agenda → 404", async () => {
    expect(
      cartaoShareService.createShare(OWNER, "cart-1", { contatoId: "fantasma", tipo: "valor", valor: 10 })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("createShare apontando linha que não é do dono → 404", async () => {
    contatoNaAgenda();
    db.linhaExiste = false;
    expect(
      cartaoShareService.createShare(OWNER, "cart-1", { contatoId: "c-1", tipo: "linha", despesaFixaId: "alheia" })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      cartaoShareService.createShare(OWNER, "cart-1", { contatoId: "c-1", tipo: "linha", despesaMesId: "alheia" })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(db.shareCriado).toBeNull();
  });

  it("createShare devolve a view já calculada no mês corrente", async () => {
    contatoNaAgenda();
    const v = await cartaoShareService.createShare(OWNER, "cart-1", {
      contatoId: "c-1",
      tipo: "valor",
      valor: 80,
      mesRef: MES_CORRENTE,
    });
    expect(v.valorMes).toBe(80);
  });

  it("updateShare arredonda percentual/valor e aceita limpá-los", async () => {
    db.shares = [{ id: "s-1", cartaoId: "cart-1", tipo: "linha", despesaFixa: null, despesaMes: null }];
    await cartaoShareService.updateShare(OWNER, "s-1", { percentual: 12.345, valor: null });
    expect(db.shareAtualizado).toEqual({ id: "s-1", data: { percentual: 12.35, valor: null } });
  });

  it("updateShare recusa mesRef em share que não é do tipo valor", async () => {
    db.shares = [{ id: "s-1", cartaoId: "cart-1", tipo: "linha", despesaFixa: null, despesaMes: null }];
    expect(cartaoShareService.updateShare(OWNER, "s-1", { mesRef: "2026-03" })).rejects.toBeInstanceOf(AppError);
    expect(db.shareAtualizado).toBeNull();
  });

  it("updateShare aceita mesRef em share do tipo valor", async () => {
    db.shares = [{ id: "s-1", cartaoId: "cart-1", tipo: "valor", despesaFixa: null, despesaMes: null }];
    await cartaoShareService.updateShare(OWNER, "s-1", { mesRef: "2026-03" });
    expect(db.shareAtualizado!.data).toEqual({ mesRef: "2026-03" });
  });

  it("updateShare / removeShare de share alheio → 404", async () => {
    expect(cartaoShareService.updateShare(OWNER, "fantasma", { descricao: "x" })).rejects.toBeInstanceOf(NotFoundError);
    expect(cartaoShareService.removeShare(OWNER, "fantasma")).rejects.toBeInstanceOf(NotFoundError);
    expect(db.shareDeletado).toBeNull();
  });

  it("removeShare apaga e devolve o id", async () => {
    db.shares = [{ id: "s-1", cartaoId: "cart-1", tipo: "valor", despesaFixa: null, despesaMes: null }];
    expect(await cartaoShareService.removeShare(OWNER, "s-1")).toEqual({ id: "s-1" });
    expect(db.shareDeletado).toBe("s-1");
  });
});

describe("resolveContatos — claim lazy por email", () => {
  it("casa por email e persiste o vínculo", async () => {
    db.contatos = [{ id: "c-1", ownerId: "dono-1", nome: "Ana", email: "ana@x.com", userId: null }];
    const cs = await cartaoShareService.resolveContatos({ id: "u-9", email: "ana@x.com" } as never);
    expect(cs.map((c) => c.id)).toEqual(["c-1"]);
    expect(db.updated).toEqual({ id: "c-1", data: { userId: "u-9" } });
  });

  it("reivindica um contato por dono (vários donos = vários contatos)", async () => {
    db.contatos = [
      { id: "c-1", ownerId: "dono-1", nome: "Ana", email: "ana@x.com", userId: null },
      { id: "c-2", ownerId: "dono-2", nome: "Ana", email: "ana@x.com", userId: null },
      { id: "c-3", ownerId: "dono-2", nome: "Ana dup", email: "ana@x.com", userId: null },
    ];
    const cs = await cartaoShareService.resolveContatos({ id: "u-9", email: "ana@x.com" } as never);
    expect(cs.map((c) => c.id)).toEqual(["c-1", "c-2"]); // c-3 fica de fora (mesmo dono)
  });

  it("sem contato correspondente retorna vazio", async () => {
    const cs = await cartaoShareService.resolveContatos({ id: "u-9", email: "z@x.com" } as never);
    expect(cs).toEqual([]);
  });
});

describe("meusCompartilhamentos", () => {
  it("agrupa por cartão, soma devido/comprometido e expõe o dono", async () => {
    db.contatos = [{ id: "c-1", ownerId: OWNER, nome: "Ana", email: "ana@x.com", userId: "u-9" }];
    db.shares = [
      {
        id: "s-1",
        cartaoId: "cart-1",
        contatoId: "c-1",
        tipo: "linha",
        percentual: 50,
        valor: null,
        mesRef: null,
        descricao: "",
        despesaFixa: parcelada(),
        despesaMes: null,
        cartao: {
          id: "cart-1",
          nome: "Nubank",
          bandeira: "master",
          cor: "violet",
          user: { id: OWNER, nome: "João" },
        },
      },
    ];
    const [g] = await cartaoShareService.meusCompartilhamentos({ id: "u-9", email: "ana@x.com" } as never, "2026-03");
    expect(g.cartao.nome).toBe("Nubank");
    expect(g.dono).toEqual({ id: OWNER, nome: "João" });
    expect(g.devidoMes).toBe(100); // 200 × 50%
    expect(g.comprometido).toBe(700); // 7 restantes × 100
    expect(g.linhas[0].parcela).toEqual({ parcelaAtual: 3, totalParcelas: 10, restantes: 7 });
  });
});
