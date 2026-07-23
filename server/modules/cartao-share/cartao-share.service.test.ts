import { describe, expect, it, beforeEach, mock } from "bun:test";

type Row = Record<string, unknown>;

const db: {
  contatos: Row[];
  shares: Row[];
  users: Row[];
  updated: { id: string; data: Row } | null;
} = { contatos: [], shares: [], users: [], updated: null };

mock.module("@/server/modules/cartao/cartao.service", () => ({
  cartaoService: { getOrThrow: async (id: string) => ({ id }) },
}));

mock.module("@/server/modules/cartao-share/cartao-share.repository", () => ({
  cartaoShareRepository: {
    contatoList: async () => db.contatos,
    contatoFindById: async (id: string) => db.contatos.find((c) => c.id === id) ?? null,
    contatoCreate: async (data: Row) => {
      const c = { id: "c-new", ...data };
      db.contatos.push(c);
      return c;
    },
    contatoByUserId: async (userId: string) => db.contatos.find((c) => c.userId === userId) ?? null,
    contatoUnlinkedByEmail: async (email: string) =>
      db.contatos.find((c) => c.email === email && c.userId == null) ?? null,
    contatoUpdate: async (id: string, data: Row) => {
      const c = db.contatos.find((r) => r.id === id)!;
      Object.assign(c, data);
      db.updated = { id, data };
      return c;
    },
    userByEmail: async (email: string) => db.users.find((u) => u.email === email) ?? null,
    sharesByContato: async (contatoId: string) => db.shares.filter((s) => s.contatoId === contatoId),
    despesaFixaExists: async () => ({ id: "ok" }),
    despesaMesExists: async () => ({ id: "ok" }),
  },
}));

const { shareValorNoMes, shareParcela, shareComprometido, cartaoShareService } = await import(
  "./cartao-share.service"
);

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
});

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
    const v = await cartaoShareService.createContato({ nome: "Ana", email: "ana@x.com" });
    expect(v.userId).toBe("u-9");
    expect(v.vinculado).toBe(true);
  });

  it("sem usuário correspondente fica sem vínculo", async () => {
    const v = await cartaoShareService.createContato({ nome: "Bia", email: "bia@x.com" });
    expect(v.userId).toBeNull();
    expect(v.vinculado).toBe(false);
  });
});

describe("resolveContato — claim lazy por email", () => {
  it("casa por email e persiste o vínculo", async () => {
    db.contatos = [{ id: "c-1", nome: "Ana", email: "ana@x.com", userId: null }];
    const c = await cartaoShareService.resolveContato({ id: "u-9", email: "ana@x.com" } as never);
    expect(c?.id).toBe("c-1");
    expect(db.updated).toEqual({ id: "c-1", data: { userId: "u-9" } });
  });

  it("sem contato correspondente retorna null", async () => {
    const c = await cartaoShareService.resolveContato({ id: "u-9", email: "z@x.com" } as never);
    expect(c).toBeNull();
  });
});

describe("meusCompartilhamentos", () => {
  it("agrupa por cartão e soma devido/comprometido", async () => {
    db.contatos = [{ id: "c-1", nome: "Ana", email: "ana@x.com", userId: "u-9" }];
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
        cartao: { id: "cart-1", nome: "Nubank", bandeira: "master", cor: "violet" },
      },
    ];
    const [g] = await cartaoShareService.meusCompartilhamentos({ id: "u-9", email: "ana@x.com" } as never, "2026-03");
    expect(g.cartao.nome).toBe("Nubank");
    expect(g.devidoMes).toBe(100); // 200 × 50%
    expect(g.comprometido).toBe(700); // 7 restantes × 100
    expect(g.linhas[0].parcela).toEqual({ parcelaAtual: 3, totalParcelas: 10, restantes: 7 });
  });
});
