import { describe, expect, it, beforeEach, mock } from "bun:test";
import { AppError, NotFoundError } from "@/server/lib/errors";

type Row = Record<string, unknown>;

const db: {
  contatos: Row[];
  shares: Row[];
  users: Row[];
  convites: Row[];
  adocoes: Row[];
  adiantamentos: Row[];
  fixas: Row[];
  mensais: Row[];
  pagamentos: Row[];
  rateioSalvo: { campo: string; linhaId: string; shares: Row[]; abateShares?: boolean } | null;
} = {
  contatos: [],
  shares: [],
  users: [],
  convites: [],
  adocoes: [],
  adiantamentos: [],
  fixas: [],
  mensais: [],
  pagamentos: [],
  rateioSalvo: null,
};

let seqId = 0;
const novoId = (p: string) => `${p}-${++seqId}`;

mock.module("@/server/modules/cartao/cartao.service", () => ({
  cartaoService: {
    getOrThrow: async (_userId: string, id: string) => {
      if (id === "alheio") throw new NotFoundError(`Cartão não encontrado: ${id}`);
      return { id, nome: "Nubank", diaVencimento: 10 };
    },
  },
}));

mock.module("@/server/modules/espaco/espaco.service", () => ({
  espacoService: {
    getOrThrow: async (_userId: string, id: string) => {
      if (id === "espaco-alheio") throw new NotFoundError(`Espaço de despesa não encontrado: ${id}`);
      return { id };
    },
  },
}));

mock.module("@/server/modules/orcamento/orcamento.repository", () => ({
  orcamentoRepository: {
    createDespesaFixa: async (data: Row) => {
      const d = { id: novoId("df"), ...data };
      db.fixas.push(d);
      return d;
    },
    createDespesaMes: async (data: Row) => {
      const d = { id: novoId("dm"), ...data };
      db.mensais.push(d);
      return d;
    },
    findDespesaFixa: async (id: string) => db.fixas.find((d) => d.id === id) ?? null,
    findDespesaMes: async (id: string) => db.mensais.find((d) => d.id === id) ?? null,
    updateDespesaFixa: async (id: string, data: Row) => {
      const d = db.fixas.find((r) => r.id === id)!;
      Object.assign(d, data);
      return d;
    },
    updateDespesaMes: async (id: string, data: Row) => {
      const d = db.mensais.find((r) => r.id === id)!;
      Object.assign(d, data);
      return d;
    },
    deleteDespesaFixa: async (id: string) => {
      db.fixas = db.fixas.filter((d) => d.id !== id);
    },
    deleteDespesaMes: async (id: string) => {
      db.mensais = db.mensais.filter((d) => d.id !== id);
    },
    upsertPagamentoFixa: async (espacoId: string, despesaFixaId: string, ym: string, valorPago: number) => {
      db.pagamentos.push({ espacoId, despesaFixaId, ym, valorPago });
    },
  },
}));

mock.module("@/server/modules/cartao-share/cartao-share.repository", () => ({
  cartaoShareRepository: {
    contatoList: async (ownerId: string) => db.contatos.filter((c) => c.ownerId === ownerId),
    contatoFindById: async (id: string, ownerId: string) =>
      db.contatos.find((c) => c.id === id && c.ownerId === ownerId) ?? null,
    contatoCreate: async (data: Row) => {
      const c = { id: novoId("ct"), status: "local", convidadoEm: null, respondidoEm: null, espelhoDeId: null, ...data };
      db.contatos.push(c);
      return c;
    },
    contatoUpdate: async (id: string, data: Row) => {
      const c = db.contatos.find((r) => r.id === id)!;
      Object.assign(c, data);
      return c;
    },
    contatoDelete: async (id: string) => {
      db.contatos = db.contatos.filter((c) => c.id !== id);
    },
    contatosByUserId: async (userId: string) => db.contatos.filter((c) => c.userId === userId),
    contatosUnlinkedByEmail: async (email: string) =>
      db.contatos.filter((c) => c.email === email && c.userId == null),
    userByEmail: async (email: string) => db.users.find((u) => u.email === email) ?? null,
    userById: async (id: string) => db.users.find((u) => u.id === id) ?? null,

    despesaFixaDoDono: async (id: string) => db.fixas.find((d) => d.id === id) ?? null,
    despesaMesDoDono: async (id: string) => db.mensais.find((d) => d.id === id) ?? null,
    despesasCategorizadas: async () => [],

    sharesByCartao: async (cartaoId: string) => db.shares.filter((s) => s.cartaoId === cartaoId),
    sharesByLinha: async (campo: string, id: string) => db.shares.filter((s) => s[campo] === id),
    sharesByContatoIds: async (ids: string[]) => db.shares.filter((s) => ids.includes(s.contatoId as string)),
    shareFindById: async (id: string) => db.shares.find((s) => s.id === id) ?? null,
    shareFindByIdParaDevedor: async (id: string, userId: string) => {
      const s = db.shares.find((r) => r.id === id);
      if (!s) return null;
      const c = db.contatos.find((r) => r.id === s.contatoId);
      return c?.userId === userId && c?.status === "ativo" ? s : null;
    },
    shareCreate: async (data: Row) => {
      const s = { id: novoId("sh"), despesaFixa: null, despesaMes: null, contato: null, ...data };
      db.shares.push(s);
      return s;
    },
    shareUpdate: async (id: string, data: Row) => {
      const s = db.shares.find((r) => r.id === id)!;
      Object.assign(s, data);
      return s;
    },
    shareDelete: async (id: string) => {
      db.shares = db.shares.filter((s) => s.id !== id);
    },
    replaceRateio: async (campo: string, linhaId: string, shares: Row[], abateShares?: boolean) => {
      db.rateioSalvo = { campo, linhaId, shares, abateShares };
      db.shares = db.shares.filter((s) => s[campo] !== linhaId);
      for (const s of shares) db.shares.push({ id: novoId("sh"), despesaFixa: null, despesaMes: null, ...s });
    },

    conviteCreate: async (data: Row) => {
      const cv = { id: novoId("cv"), status: "convidado", createdAt: new Date(), ...data };
      db.convites.push(cv);
      return cv;
    },
    convitesPendentesPorEmail: async (email: string) =>
      db.convites
        .filter((cv) => cv.email === email && cv.status === "convidado")
        .map((cv) => ({
          ...cv,
          owner: db.users.find((u) => u.id === cv.ownerId) ?? { id: cv.ownerId, nome: "?" },
          contato: db.contatos.find((c) => c.id === cv.contatoId) ?? { id: cv.contatoId, nome: "?" },
        })),
    conviteFindById: async (id: string) => db.convites.find((cv) => cv.id === id) ?? null,
    conviteFindByToken: async (token: string) => db.convites.find((cv) => cv.token === token) ?? null,
    convitesPendentesDoContato: async (contatoId: string) =>
      db.convites.filter((cv) => cv.contatoId === contatoId && cv.status === "convidado"),
    conviteUpdate: async (id: string, data: Row) => {
      const cv = db.convites.find((r) => r.id === id)!;
      Object.assign(cv, data);
      return cv;
    },
    aceitarConvite: async (args: Row) => {
      const contato = db.contatos.find((c) => c.id === args.contatoId)!;
      Object.assign(contato, { userId: args.aceitanteId, status: "ativo", respondidoEm: new Date() });
      const espelho = {
        id: novoId("ct"),
        ownerId: args.aceitanteId,
        nome: args.ownerNome,
        userId: args.ownerId,
        status: "ativo",
        espelhoDeId: contato.id,
      };
      db.contatos.push(espelho);
      contato.espelhoDeId = espelho.id;
      const cv = db.convites.find((c) => c.id === args.conviteId)!;
      cv.status = "ativo";
      return { contato, espelho };
    },

    adocoesByUser: async (userId: string) => db.adocoes.filter((a) => a.userId === userId),
    adocaoFind: async (shareId: string, userId: string) =>
      db.adocoes.find((a) => a.shareId === shareId && a.userId === userId) ?? null,
    adocaoUpsert: async (shareId: string, _userId: string, data: Row) => {
      const i = db.adocoes.findIndex((a) => a.shareId === shareId);
      if (i >= 0) db.adocoes[i] = { ...db.adocoes[i], ...data };
      else db.adocoes.push({ ...data });
      return db.adocoes.find((a) => a.shareId === shareId)!;
    },
    adocaoUpdate: async (shareId: string, data: Row) => {
      const a = db.adocoes.find((r) => r.shareId === shareId)!;
      Object.assign(a, data);
      return a;
    },
    adocaoDelete: async (shareId: string) => {
      db.adocoes = db.adocoes.filter((a) => a.shareId !== shareId);
    },
    adiantamentoCreate: async (data: Row) => {
      const ad = { id: novoId("ad"), createdAt: new Date(), ...data };
      db.adiantamentos.push(ad);
      return ad;
    },
    adiantamentosByUser: async (userId: string) => db.adiantamentos.filter((a) => a.userId === userId),
  },
}));

const { cartaoShareService } = await import("./cartao-share.service");

const OWNER = "dono-1";
const DEVEDOR = { id: "user-2", email: "maria@exemplo.com", nome: "Maria", roles: [], permissions: [] };

const aluguel = () => ({
  id: "df-aluguel",
  espacoId: "esp-dono",
  descricao: "Aluguel",
  valor: 1800,
  diaVencimento: 5,
  cartaoId: null,
  parcelado: false,
  parcelaAtual: null,
  totalParcelas: null,
  parcelaMesRef: null,
  abateShares: false,
});

const jiujitsu = () => ({
  id: "df-jj",
  espacoId: "esp-dono",
  descricao: "Jiu-jitsu",
  valor: 200,
  diaVencimento: 10,
  cartaoId: "ct-1",
  parcelado: true,
  parcelaAtual: 1,
  totalParcelas: 12,
  parcelaMesRef: "2026-06",
  abateShares: false,
});

// Share já aceito pela Maria, apontando a fixa parcelada — base dos testes de adoção.
function cenarioAceito() {
  db.contatos.push({
    id: "ct-maria",
    ownerId: OWNER,
    nome: "Maria",
    email: DEVEDOR.email,
    userId: DEVEDOR.id,
    status: "ativo",
    espelhoDeId: null,
  });
  db.users.push({ id: OWNER, nome: "João", email: "joao@wallet.local" });
  db.fixas.push(jiujitsu());
  db.shares.push({
    id: "sh-jj",
    cartaoId: null,
    contatoId: "ct-maria",
    tipo: "linha",
    descricao: "",
    despesaFixaId: "df-jj",
    despesaMesId: null,
    percentual: 50,
    valor: null,
    mesRef: null,
    despesaFixa: jiujitsu(),
    despesaMes: null,
    contato: {
      id: "ct-maria",
      nome: "Maria",
      status: "ativo",
      userId: DEVEDOR.id,
      ownerId: OWNER,
      owner: { id: OWNER, nome: "João" },
    },
  });
}

beforeEach(() => {
  db.contatos = [];
  db.shares = [];
  db.users = [];
  db.convites = [];
  db.adocoes = [];
  db.adiantamentos = [];
  db.fixas = [];
  db.mensais = [];
  db.pagamentos = [];
  db.rateioSalvo = null;
  seqId = 0;
});

describe("contatos", () => {
  it("contato nasce local — ter email não dá acesso a nada", async () => {
    db.users.push({ id: DEVEDOR.id, email: DEVEDOR.email, nome: "Maria" });
    const c = await cartaoShareService.createContato(OWNER, { nome: "Maria", email: DEVEDOR.email });
    expect(c.status).toBe("local");
    expect(c.userId).toBe(DEVEDOR.id); // vínculo existe, acesso não
    expect(c.reciproco).toBe(false);
  });

  it("contato de outro dono é 404, não 403", async () => {
    db.contatos.push({ id: "ct-x", ownerId: "outro", nome: "X" });
    expect(cartaoShareService.getContatoOrThrow(OWNER, "ct-x")).rejects.toThrow(NotFoundError);
  });
});

describe("share de linha sem cartão (aluguel)", () => {
  beforeEach(() => {
    db.contatos.push({ id: "ct-maria", ownerId: OWNER, nome: "Maria", status: "local" });
    db.contatos.push({ id: "ct-carlos", ownerId: OWNER, nome: "Carlos", status: "local" });
    db.fixas.push(aluguel());
  });

  it("aceita fixa sem cartão e não grava cartaoId (é derivado da linha)", async () => {
    const s = await cartaoShareService.createShare(OWNER, {
      contatoId: "ct-maria",
      tipo: "linha",
      despesaFixaId: "df-aluguel",
      percentual: 33,
    });
    expect(s.despesaFixaId).toBe("df-aluguel");
    expect(db.shares[0].cartaoId).toBeNull();
  });

  it("barra a soma acima de 100% considerando quem já está na linha", async () => {
    await cartaoShareService.createShare(OWNER, {
      contatoId: "ct-maria",
      tipo: "linha",
      despesaFixaId: "df-aluguel",
      percentual: 60,
    });
    expect(
      cartaoShareService.createShare(OWNER, {
        contatoId: "ct-carlos",
        tipo: "linha",
        despesaFixaId: "df-aluguel",
        percentual: 50,
      })
    ).rejects.toThrow(AppError);
  });

  it("share avulso sem cartão é 422 — não existe fatura pra pendurar", async () => {
    expect(
      cartaoShareService.createShare(OWNER, { contatoId: "ct-maria", tipo: "valor", valor: 50 })
    ).rejects.toThrow(AppError);
  });
});

describe("rateio N-a-N", () => {
  beforeEach(() => {
    db.contatos.push({ id: "ct-maria", ownerId: OWNER, nome: "Maria", status: "local" });
    db.contatos.push({ id: "ct-carlos", ownerId: OWNER, nome: "Carlos", status: "local" });
    db.fixas.push(aluguel());
  });

  it("substitui o conjunto inteiro e grava o abateShares", async () => {
    await cartaoShareService.salvarRateio(
      OWNER,
      {
        despesaFixaId: "df-aluguel",
        abateShares: true,
        itens: [
          { contatoId: "ct-maria", percentual: 33 },
          { contatoId: "ct-carlos", percentual: 33 },
        ],
      },
      "2026-06"
    );
    expect(db.rateioSalvo?.abateShares).toBe(true);
    expect(db.rateioSalvo?.shares).toHaveLength(2);
    expect(db.rateioSalvo?.shares.every((s) => s.cartaoId === null)).toBe(true);
  });

  it("não escreve nada quando a soma estoura", async () => {
    expect(
      cartaoShareService.salvarRateio(OWNER, {
        despesaFixaId: "df-aluguel",
        itens: [
          { contatoId: "ct-maria", percentual: 60 },
          { contatoId: "ct-carlos", percentual: 50 },
        ],
      })
    ).rejects.toThrow(AppError);
    expect(db.rateioSalvo).toBeNull();
  });

  it("contato de outro dono no payload derruba antes de escrever", async () => {
    db.contatos.push({ id: "ct-alheio", ownerId: "outro", nome: "Alheio", status: "local" });
    expect(
      cartaoShareService.salvarRateio(OWNER, {
        despesaFixaId: "df-aluguel",
        itens: [{ contatoId: "ct-alheio", percentual: 10 }],
      })
    ).rejects.toThrow(NotFoundError);
    expect(db.rateioSalvo).toBeNull();
  });
});

describe("convite e aceite", () => {
  beforeEach(() => {
    db.users.push({ id: OWNER, nome: "João", email: "joao@wallet.local" });
    db.users.push({ id: DEVEDOR.id, nome: "Maria", email: DEVEDOR.email });
    db.contatos.push({ id: "ct-maria", ownerId: OWNER, nome: "Maria", email: null, userId: null, status: "local" });
  });

  it("convidar marca o contato como convidado e devolve o link com token", async () => {
    const cv = await cartaoShareService.criarConvite(OWNER, "ct-maria", { email: DEVEDOR.email });
    expect(cv.token).toBeTruthy();
    expect(cv.link).toBe(`/?convite=${cv.token}`);
    expect(db.contatos[0].status).toBe("convidado");
  });

  it("antes do aceite a pessoa não vê nada", async () => {
    await cartaoShareService.criarConvite(OWNER, "ct-maria", { email: DEVEDOR.email });
    db.shares.push({ id: "sh-1", contatoId: "ct-maria", tipo: "valor", valor: 40, mesRef: null });
    const r = await cartaoShareService.meusCompartilhamentos(DEVEDOR, "2026-06");
    expect(r.donos).toEqual([]);
  });

  it("aceitar vincula os dois lados (espelho na agenda de quem aceitou)", async () => {
    const cv = await cartaoShareService.criarConvite(OWNER, "ct-maria", { email: DEVEDOR.email });
    const r = await cartaoShareService.aceitarConvite(DEVEDOR, cv.id);
    expect(r.status).toBe("ativo");
    const doDono = db.contatos.find((c) => c.id === "ct-maria")!;
    const espelho = db.contatos.find((c) => c.ownerId === DEVEDOR.id)!;
    expect(doDono.status).toBe("ativo");
    expect(espelho.userId).toBe(OWNER);
    expect(espelho.espelhoDeId).toBe("ct-maria");
    expect(doDono.espelhoDeId).toBe(espelho.id);
  });

  it("convite de outro email é 404 — não vaza existência", async () => {
    const cv = await cartaoShareService.criarConvite(OWNER, "ct-maria", { email: DEVEDOR.email });
    expect(
      cartaoShareService.aceitarConvite({ ...DEVEDOR, email: "carlos@exemplo.com" }, cv.id)
    ).rejects.toThrow(NotFoundError);
  });

  it("recusar esconde os shares sem apagar nada do dono", async () => {
    const cv = await cartaoShareService.criarConvite(OWNER, "ct-maria", { email: DEVEDOR.email });
    await cartaoShareService.recusarConvite(DEVEDOR, cv.id);
    expect(db.contatos[0].status).toBe("recusado");
    expect(await cartaoShareService.meusCompartilhamentos(DEVEDOR, "2026-06")).toEqual({
      donos: [],
      orfas: [],
    });
  });

  it("contato só com email vira convite pendente, não acesso liberado", async () => {
    db.contatos.push({
      id: "ct-legado",
      ownerId: "dono-2",
      nome: "Maria",
      email: DEVEDOR.email,
      userId: null,
      status: "local",
    });
    const convites = await cartaoShareService.meusConvites(DEVEDOR);
    expect(convites.some((c) => c.dono.id === "dono-2")).toBe(true);
    expect(db.contatos.find((c) => c.id === "ct-legado")!.status).toBe("convidado");
  });
});

describe("adoção", () => {
  beforeEach(cenarioAceito);

  it("vira fixa no espaço do devedor espelhando as parcelas", async () => {
    const r = await cartaoShareService.adotar(DEVEDOR, "sh-jj", {
      modo: "fixa",
      espacoId: "esp-maria",
      ym: "2026-06",
    });
    expect(r.valor).toBe(100); // 50% de 200
    const nova = db.fixas.find((d) => d.id === r.despesaFixaId)!;
    expect(nova.espacoId).toBe("esp-maria");
    expect(nova.valor).toBe(100);
    expect(nova.parcelado).toBe(true);
    expect(nova.parcelaAtual).toBe(1);
    expect(nova.totalParcelas).toBe(12);
    expect(nova.parcelaMesRef).toBe("2026-06");
    // o cartão é do dono — a despesa de quem deve não entra na fatura dele
    expect(nova.cartaoId).toBeNull();
    expect(nova.descricao).toBe("Jiu-jitsu (João)");
  });

  it("espaço de outro dono é 404", async () => {
    expect(
      cartaoShareService.adotar(DEVEDOR, "sh-jj", { modo: "fixa", espacoId: "espaco-alheio" })
    ).rejects.toThrow(NotFoundError);
  });

  it("share de quem não aceitou é 404", async () => {
    db.contatos[0].status = "convidado";
    expect(
      cartaoShareService.adotar(DEVEDOR, "sh-jj", { modo: "fixa", espacoId: "esp-maria" })
    ).rejects.toThrow(NotFoundError);
  });

  it("adotar duas vezes é 422 — desfaça antes", async () => {
    await cartaoShareService.adotar(DEVEDOR, "sh-jj", { modo: "fixa", espacoId: "esp-maria", ym: "2026-06" });
    expect(
      cartaoShareService.adotar(DEVEDOR, "sh-jj", { modo: "fixa", espacoId: "esp-maria", ym: "2026-06" })
    ).rejects.toThrow(AppError);
  });

  it("desfazer mantém a despesa por padrão — ela é do devedor", async () => {
    const r = await cartaoShareService.adotar(DEVEDOR, "sh-jj", {
      modo: "fixa",
      espacoId: "esp-maria",
      ym: "2026-06",
    });
    await cartaoShareService.desfazerAdocao(DEVEDOR, "sh-jj");
    expect(db.adocoes).toHaveLength(0);
    expect(db.fixas.some((d) => d.id === r.despesaFixaId)).toBe(true);

    db.adocoes.push({ shareId: "sh-jj", userId: DEVEDOR.id, modo: "fixa", despesaFixaId: r.despesaFixaId });
    await cartaoShareService.desfazerAdocao(DEVEDOR, "sh-jj", true);
    expect(db.fixas.some((d) => d.id === r.despesaFixaId)).toBe(false);
  });

  it("ignorar sai do devido e não some da lista", async () => {
    await cartaoShareService.ignorar(DEVEDOR, "sh-jj", "2026-06");
    const r = await cartaoShareService.meusCompartilhamentos(DEVEDOR, "2026-06");
    const linha = r.donos[0].grupos[0].linhas[0];
    expect(linha.ignorado).toBe(true);
    expect(r.donos[0].devidoMes).toBe(0);
  });

  it("dono muda o valor depois da adoção → divergente, e sincronizar reescreve", async () => {
    const r = await cartaoShareService.adotar(DEVEDOR, "sh-jj", {
      modo: "fixa",
      espacoId: "esp-maria",
      ym: "2026-06",
    });
    // o dono dobrou a parte da Maria
    db.shares[0].percentual = 100;
    (db.shares[0].despesaFixa as Row).valor = 200;

    const antes = await cartaoShareService.meusCompartilhamentos(DEVEDOR, "2026-06");
    expect(antes.donos[0].grupos[0].linhas[0].divergente).toBe(true);

    await cartaoShareService.sincronizar(DEVEDOR, "sh-jj", "2026-06");
    expect(db.fixas.find((d) => d.id === r.despesaFixaId)!.valor).toBe(200);
    const depois = await cartaoShareService.meusCompartilhamentos(DEVEDOR, "2026-06");
    expect(depois.donos[0].grupos[0].linhas[0].divergente).toBe(false);
  });

  it("share apagado pelo dono vira órfã com aviso — a despesa fica", async () => {
    const r = await cartaoShareService.adotar(DEVEDOR, "sh-jj", {
      modo: "fixa",
      espacoId: "esp-maria",
      ym: "2026-06",
    });
    db.shares = [];
    const v = await cartaoShareService.meusCompartilhamentos(DEVEDOR, "2026-06");
    expect(v.orfas).toHaveLength(1);
    expect(v.orfas[0].aviso).toContain("removido pelo dono");
    expect(db.fixas.some((d) => d.id === r.despesaFixaId)).toBe(true);
  });
});

describe("adiantamento", () => {
  beforeEach(cenarioAceito);

  it("adiantar 3 parcelas zera o devido nos 3 meses e derruba o comprometido", async () => {
    const r = await cartaoShareService.adiantar(DEVEDOR, "sh-jj", { parcelas: 3, ym: "2026-06" });
    expect(r.cobreAte).toBe("2026-08");
    expect(r.valor).toBe(300); // 3 × 100

    for (const m of ["2026-06", "2026-07", "2026-08"]) {
      const v = await cartaoShareService.meusCompartilhamentos(DEVEDOR, m);
      expect(v.donos[0].grupos[0].linhas[0].valorMes).toBe(0);
    }
    const set = await cartaoShareService.meusCompartilhamentos(DEVEDOR, "2026-09");
    expect(set.donos[0].grupos[0].linhas[0].valorMes).toBe(100);
    // em 2026-06 restavam 11 parcelas; 2 delas (jul/ago) saíram do comprometido
    expect((await cartaoShareService.meusCompartilhamentos(DEVEDOR, "2026-06")).donos[0].comprometido).toBe(900);
  });

  it("adiantar de novo continua de onde parou", async () => {
    await cartaoShareService.adiantar(DEVEDOR, "sh-jj", { parcelas: 2, ym: "2026-06" }); // cobre 06,07
    const r = await cartaoShareService.adiantar(DEVEDOR, "sh-jj", { parcelas: 2, ym: "2026-06" });
    expect(r.cobreAte).toBe("2026-09"); // 08,09
    expect(r.valor).toBe(200);
  });

  it("fixa adotada ganha pagamento nos meses cobertos", async () => {
    const a = await cartaoShareService.adotar(DEVEDOR, "sh-jj", {
      modo: "fixa",
      espacoId: "esp-maria",
      ym: "2026-06",
    });
    await cartaoShareService.adiantar(DEVEDOR, "sh-jj", { parcelas: 3, ym: "2026-06" });
    expect(db.pagamentos.map((p) => p.ym)).toEqual(["2026-06", "2026-07", "2026-08"]);
    expect(db.pagamentos.every((p) => p.despesaFixaId === a.despesaFixaId)).toBe(true);
  });

  it("adiantar além do fim das parcelas é 422", async () => {
    expect(cartaoShareService.adiantar(DEVEDOR, "sh-jj", { parcelas: 3, ym: "2028-01" })).rejects.toThrow(
      AppError
    );
  });
});
