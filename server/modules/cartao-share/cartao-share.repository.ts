import { Prisma } from "@prisma/client";
import { prisma } from "@/server/lib/prisma";

const withLinha = { include: { despesaFixa: true, despesaMes: true } } as const;

// Rateio: além da linha, quem é cada contato (nome + status do aceite).
const withLinhaEContato = {
  include: {
    despesaFixa: true,
    despesaMes: true,
    contato: { select: { id: true, nome: true, status: true, userId: true, ownerId: true } },
  },
} as const;

// Visão da pessoa compartilhada: o dono agora vem do CONTATO (o share pode não
// ter cartão — aluguel), e o cartão é derivado da linha quando existe.
const withDonoELinha = {
  include: {
    despesaFixa: { include: { cartao: true } },
    despesaMes: { include: { cartao: true } },
    cartao: true,
    contato: {
      select: {
        id: true,
        nome: true,
        status: true,
        userId: true,
        ownerId: true,
        owner: { select: { id: true, nome: true } },
      },
    },
  },
} as const;

export type ShareComDono = Prisma.CartaoShareGetPayload<typeof withDonoELinha>;
export type ShareComContato = Prisma.CartaoShareGetPayload<typeof withLinhaEContato>;

export const cartaoShareRepository = {
  // ── Contatos (agenda do dono) ──────────────────────────────────────────────
  contatoList(ownerId: string) {
    return prisma.contato.findMany({ where: { ownerId }, orderBy: { nome: "asc" } });
  },
  contatoFindById(id: string, ownerId: string) {
    return prisma.contato.findFirst({ where: { id, ownerId } });
  },
  contatoFindAnyById(id: string) {
    return prisma.contato.findUnique({ where: { id } });
  },
  contatoCreate(data: Prisma.ContatoUncheckedCreateInput) {
    return prisma.contato.create({ data });
  },
  contatoUpdate(id: string, data: Prisma.ContatoUncheckedUpdateInput) {
    return prisma.contato.update({ where: { id }, data });
  },
  contatoDelete(id: string) {
    return prisma.contato.delete({ where: { id } });
  },
  // Contatos que JÁ apontam pra este usuário — um por dono que o cadastrou.
  contatosByUserId(userId: string) {
    return prisma.contato.findMany({ where: { userId } });
  },
  // Contatos ainda sem vínculo com este email (candidatos a vínculo lazy).
  contatosUnlinkedByEmail(email: string) {
    return prisma.contato.findMany({ where: { email, userId: null } });
  },

  userByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  },
  userById(id: string) {
    return prisma.user.findUnique({ where: { id }, select: { id: true, nome: true, email: true } });
  },

  // Linhas compartilháveis: só as do próprio dono (evita apontar despesa alheia).
  despesaFixaExists(id: string, ownerId: string) {
    return prisma.despesaFixa.findFirst({
      where: { id, espaco: { userId: ownerId } },
      select: { id: true },
    });
  },
  despesaMesExists(id: string, ownerId: string) {
    return prisma.despesaMes.findFirst({
      where: { id, espaco: { userId: ownerId } },
      select: { id: true },
    });
  },
  despesaFixaDoDono(id: string, ownerId: string) {
    return prisma.despesaFixa.findFirst({ where: { id, espaco: { userId: ownerId } } });
  },
  despesaMesDoDono(id: string, ownerId: string) {
    return prisma.despesaMes.findFirst({ where: { id, espaco: { userId: ownerId } } });
  },

  // Descrições já categorizadas do usuário — alimenta o sugereCategoria da adoção.
  despesasCategorizadas(userId: string) {
    return prisma.despesaFixa
      .findMany({
        where: { espaco: { userId }, categoriaId: { not: null } },
        select: { descricao: true, categoriaId: true },
        take: 500,
      })
      .then(async (fixas) => [
        ...fixas,
        ...(await prisma.despesaMes.findMany({
          where: { espaco: { userId }, categoriaId: { not: null } },
          select: { descricao: true, categoriaId: true },
          take: 500,
        })),
      ]);
  },

  // ── Shares ──────────────────────────────────────────────────────────────
  // Shares que caem na fatura de um cartão: os avulsos amarrados nele + os que
  // apontam uma linha daquele cartão (o share de linha não guarda cartaoId).
  sharesByCartao(cartaoId: string) {
    return prisma.cartaoShare.findMany({
      where: {
        OR: [{ cartaoId }, { despesaFixa: { cartaoId } }, { despesaMes: { cartaoId } }],
      },
      ...withLinhaEContato,
    });
  },
  sharesByLinha(campo: "despesaFixaId" | "despesaMesId", id: string) {
    return prisma.cartaoShare.findMany({ where: { [campo]: id }, ...withLinhaEContato });
  },
  sharesByContatoIds(contatoIds: string[]) {
    return prisma.cartaoShare.findMany({
      where: { contatoId: { in: contatoIds } },
      ...withDonoELinha,
    });
  },
  // Share do dono = share de um contato da agenda dele (não mais "do cartão dele").
  shareFindById(id: string, ownerId: string) {
    return prisma.cartaoShare.findFirst({ where: { id, contato: { ownerId } }, ...withLinha });
  },
  // Share visível pra quem deve: contato dele, e só depois do aceite.
  shareFindByIdParaDevedor(id: string, userId: string) {
    return prisma.cartaoShare.findFirst({
      where: { id, contato: { userId, status: "ativo" } },
      ...withDonoELinha,
    });
  },
  shareCreate(data: Prisma.CartaoShareUncheckedCreateInput) {
    return prisma.cartaoShare.create({ data, ...withLinhaEContato });
  },
  shareUpdate(id: string, data: Prisma.CartaoShareUncheckedUpdateInput) {
    return prisma.cartaoShare.update({ where: { id }, data, ...withLinhaEContato });
  },
  shareDelete(id: string) {
    return prisma.cartaoShare.delete({ where: { id } });
  },

  // Rateio é substituição atômica: apaga o que havia da linha e recria. Evita
  // colidir com share_fixa_contato_key num "salvar" repetido.
  replaceRateio(
    campo: "despesaFixaId" | "despesaMesId",
    linhaId: string,
    shares: Prisma.CartaoShareUncheckedCreateInput[],
    abateShares?: boolean
  ) {
    const tabela = campo === "despesaFixaId" ? prisma.despesaFixa : prisma.despesaMes;
    return prisma.$transaction([
      prisma.cartaoShare.deleteMany({ where: { [campo]: linhaId } }),
      ...shares.map((data) => prisma.cartaoShare.create({ data })),
      ...(abateShares === undefined
        ? []
        : [(tabela as typeof prisma.despesaFixa).update({ where: { id: linhaId }, data: { abateShares } })]),
    ]);
  },

  // ── Convites ────────────────────────────────────────────────────────────
  conviteCreate(data: Prisma.CartaoShareConviteUncheckedCreateInput) {
    return prisma.cartaoShareConvite.create({ data });
  },
  convitesPendentesPorEmail(email: string) {
    return prisma.cartaoShareConvite.findMany({
      where: { email, status: "convidado" },
      include: {
        owner: { select: { id: true, nome: true } },
        contato: { select: { id: true, nome: true, ownerId: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  },
  conviteFindById(id: string) {
    return prisma.cartaoShareConvite.findUnique({ where: { id }, include: { contato: true } });
  },
  conviteFindByToken(token: string) {
    return prisma.cartaoShareConvite.findUnique({ where: { token }, include: { contato: true } });
  },
  convitesPendentesDoContato(contatoId: string) {
    return prisma.cartaoShareConvite.findMany({ where: { contatoId, status: "convidado" } });
  },
  conviteUpdate(id: string, data: Prisma.CartaoShareConviteUncheckedUpdateInput) {
    return prisma.cartaoShareConvite.update({ where: { id }, data });
  },

  // Aceite: vincula o contato do dono, cria o espelho na agenda de quem aceitou e
  // fecha o convite — tudo ou nada, senão sobra vínculo pela metade.
  aceitarConvite(args: {
    conviteId: string;
    contatoId: string;
    aceitanteId: string;
    aceitanteNome: string;
    aceitanteEmail: string;
    ownerId: string;
    ownerNome: string;
    ownerEmail: string;
    espelhoExistenteId: string | null;
  }) {
    const agora = new Date();
    return prisma.$transaction(async (tx) => {
      const contato = await tx.contato.update({
        where: { id: args.contatoId },
        data: {
          userId: args.aceitanteId,
          email: args.aceitanteEmail,
          status: "ativo",
          respondidoEm: agora,
        },
      });
      const espelho = args.espelhoExistenteId
        ? await tx.contato.update({
            where: { id: args.espelhoExistenteId },
            data: { status: "ativo", respondidoEm: agora, espelhoDeId: contato.id },
          })
        : await tx.contato.create({
            data: {
              ownerId: args.aceitanteId,
              nome: args.ownerNome,
              email: args.ownerEmail,
              userId: args.ownerId,
              status: "ativo",
              respondidoEm: agora,
              espelhoDeId: contato.id,
            },
          });
      await tx.contato.update({ where: { id: contato.id }, data: { espelhoDeId: espelho.id } });
      await tx.cartaoShareConvite.update({
        where: { id: args.conviteId },
        data: { status: "ativo" },
      });
      return { contato, espelho };
    });
  },

  // ── Adoção / adiantamento (lado do devedor) ────────────────────────────────
  adocoesByUser(userId: string) {
    return prisma.shareAdocao.findMany({ where: { userId } });
  },
  adocaoFind(shareId: string, userId: string) {
    return prisma.shareAdocao.findFirst({ where: { shareId, userId } });
  },
  adocaoUpsert(shareId: string, userId: string, data: Prisma.ShareAdocaoUncheckedCreateInput) {
    return prisma.shareAdocao.upsert({ where: { shareId }, create: data, update: { ...data, userId } });
  },
  adocaoUpdate(shareId: string, data: Prisma.ShareAdocaoUncheckedUpdateInput) {
    return prisma.shareAdocao.update({ where: { shareId }, data });
  },
  adocaoDelete(shareId: string) {
    return prisma.shareAdocao.delete({ where: { shareId } });
  },
  adiantamentoCreate(data: Prisma.ShareAdiantamentoUncheckedCreateInput) {
    return prisma.shareAdiantamento.create({ data });
  },
  adiantamentosByUser(userId: string) {
    return prisma.shareAdiantamento.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  },
};
