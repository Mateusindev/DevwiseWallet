import { randomBytes } from "node:crypto";
import type { Contato } from "@prisma/client";
import { cartaoShareRepository, type ShareComDono, type ShareComContato } from "./cartao-share.repository";
import { cartaoService } from "../cartao/cartao.service";
import { espacoService } from "../espaco/espaco.service";
import { orcamentoRepository } from "../orcamento/orcamento.repository";
import { AppError, NotFoundError } from "@/server/lib/errors";
import { num, numOrNull, round, currentMonth, parseDate } from "@/server/lib/serialize";
import { sugereCategoria } from "@/lib/calc";
import type { AuthUser } from "@/server/auth/auth.service";
import {
  addMonths,
  devidoNoMes,
  rateioDaLinha,
  shareComprometido,
  shareParcela,
  shareValorNoMes,
  validaRateio,
} from "./rateio";
import type {
  CreateContatoDTO,
  UpdateContatoDTO,
  CreateShareDTO,
  UpdateShareDTO,
  RateioDTO,
  ConviteDTO,
  AdotarDTO,
  AdiantarDTO,
} from "./cartao-share.dto";

const DIAS_CONVITE = 14;
const MAX_DESCRICAO = 120;

// ── Views ────────────────────────────────────────────────────────────────────

function contatoView(c: Contato) {
  return {
    id: c.id,
    nome: c.nome,
    email: c.email,
    userId: c.userId,
    vinculado: c.userId != null,
    status: c.status,
    convidadoEm: c.convidadoEm?.toISOString() ?? null,
    respondidoEm: c.respondidoEm?.toISOString() ?? null,
    reciproco: c.espelhoDeId != null,
  };
}

function cartaoDoShare(s: ShareComDono | ShareComContato) {
  const c =
    ("cartao" in s ? s.cartao : null) ??
    (s.despesaFixa && "cartao" in s.despesaFixa ? s.despesaFixa.cartao : null) ??
    (s.despesaMes && "cartao" in s.despesaMes ? s.despesaMes.cartao : null);
  return c ?? null;
}

// Visão do dono: quem leva quanto desta linha.
function shareView(s: ShareComContato, mes: string) {
  const cartao = cartaoDoShare(s);
  return {
    id: s.id,
    cartaoId: cartao?.id ?? null,
    contatoId: s.contatoId,
    contatoNome: s.contato?.nome ?? "",
    contatoStatus: s.contato?.status ?? "local",
    tipo: s.tipo,
    descricao: s.descricao,
    despesaFixaId: s.despesaFixaId,
    despesaMesId: s.despesaMesId,
    percentual: numOrNull(s.percentual),
    valor: numOrNull(s.valor),
    mesRef: s.mesRef,
    linhaDescricao: s.despesaFixa?.descricao ?? s.despesaMes?.descricao ?? null,
    valorMes: shareValorNoMes(s, mes),
    comprometido: shareComprometido(s, mes),
    parcela: shareParcela(s, mes),
  };
}

// Descrição da despesa que nasce na conta de quem deve: "Nubank · Jiu-jitsu (João)"
// — sem isso vira "Despesa 3" na lista dele.
function descricaoAdotada(s: ShareComDono, donoNome: string): string {
  const cartao = cartaoDoShare(s);
  const linha = s.descricao || s.despesaFixa?.descricao || s.despesaMes?.descricao || "Compartilhado";
  return `${cartao ? `${cartao.nome} · ` : ""}${linha} (${donoNome})`.slice(0, MAX_DESCRICAO);
}

// Data dentro do mês, no dia pedido (clampado no último dia do mês).
function dataNoMes(mes: string, dia: number): Date {
  const [y, m] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = String(Math.min(Math.max(dia, 1), ultimo)).padStart(2, "0");
  return parseDate(`${mes}-${d}`);
}

type CartaoResumo = { id: string; nome: string; bandeira: string | null; cor: string } | null;

function cartaoResumo(s: ShareComDono): CartaoResumo {
  const c = cartaoDoShare(s);
  return c ? { id: c.id, nome: c.nome, bandeira: c.bandeira, cor: c.cor } : null;
}

type AdocaoRow = {
  modo: string;
  espacoId: string | null;
  despesaFixaId: string | null;
  despesaMesId: string | null;
  valorAdotado: unknown;
};

// Uma linha do "o que devo": o quanto, o que já foi adiantado, e o que a adoção
// virou no orçamento de quem deve.
function linhaDevidaView(
  s: ShareComDono,
  mes: string,
  adocao: AdocaoRow | null,
  quitadoAte: string | null
) {
  const cheio = shareValorNoMes(s, mes);
  const parte = devidoNoMes(s, mes, { modo: adocao?.modo ?? "", quitadoAte });
  return {
    id: s.id,
    tipo: s.tipo,
    descricao: s.descricao,
    linhaDescricao: s.despesaFixa?.descricao ?? s.despesaMes?.descricao ?? null,
    percentual: numOrNull(s.percentual),
    valor: numOrNull(s.valor),
    mesRef: s.mesRef,
    cartao: cartaoResumo(s),
    valorMes: parte,
    valorCheio: cheio,
    comprometido: shareComprometido(s, mes, quitadoAte),
    parcela: shareParcela(s, mes),
    quitadoAte,
    ignorado: adocao?.modo === "ignorado",
    adocao: adocao
      ? {
          modo: adocao.modo,
          espacoId: adocao.espacoId,
          despesaFixaId: adocao.despesaFixaId,
          despesaMesId: adocao.despesaMesId,
          valorAdotado: numOrNull(adocao.valorAdotado as never),
        }
      : null,
    // dono mudou o percentual depois da adoção → a despesa criada envelheceu
    divergente:
      adocao != null &&
      adocao.modo !== "ignorado" &&
      adocao.valorAdotado != null &&
      round(num(adocao.valorAdotado as never)) !== round(cheio),
  };
}

type LinhaDevida = ReturnType<typeof linhaDevidaView>;
type OrfaView = {
  shareId: string;
  modo: string;
  espacoId: string | null;
  despesaFixaId: string | null;
  despesaMesId: string | null;
  descricao: string | null;
  valorAdotado: number | null;
  aviso: string;
};
type GrupoDevido = {
  chave: string;
  tipo: "cartao" | "outros";
  titulo: string;
  cartao: CartaoResumo;
  linhas: LinhaDevida[];
};

function diaDaLinha(s: ShareComDono): number {
  if (s.despesaFixa) return s.despesaFixa.diaVencimento;
  if (s.despesaMes) return s.despesaMes.data.getUTCDate();
  return cartaoDoShare(s)?.diaVencimento ?? 1;
}

export const cartaoShareService = {
  // ── Contatos ──────────────────────────────────────────────────────────────
  async listContatos(ownerId: string) {
    return (await cartaoShareRepository.contatoList(ownerId)).map(contatoView);
  },

  async getContatoOrThrow(ownerId: string, id: string): Promise<Contato> {
    const c = await cartaoShareRepository.contatoFindById(id, ownerId);
    if (!c) throw new NotFoundError(`Contato não encontrado: ${id}`);
    return c;
  },

  // Contato nasce `local`: ter email não dá acesso a nada. O acesso só abre com
  // convite aceito (era isso que vazava antes — a pessoa via a dívida sem consentir).
  async createContato(ownerId: string, dto: CreateContatoDTO) {
    const email = dto.email ?? null;
    const userId = email ? await this.vinculavelPor(ownerId, email) : null;
    const c = await cartaoShareRepository.contatoCreate({ ownerId, nome: dto.nome, email, userId });
    return contatoView(c);
  },

  async updateContato(ownerId: string, id: string, patch: UpdateContatoDTO) {
    await this.getContatoOrThrow(ownerId, id);
    const data: Record<string, unknown> = {};
    if (patch.nome != null) data.nome = patch.nome;
    if (patch.email !== undefined) {
      data.email = patch.email;
      // reavalia vínculo quando o email muda
      data.userId = patch.email ? await this.vinculavelPor(ownerId, patch.email, id) : null;
    }
    const c = await cartaoShareRepository.contatoUpdate(id, data);
    return contatoView(c);
  },

  async removeContato(ownerId: string, id: string) {
    await this.getContatoOrThrow(ownerId, id);
    await cartaoShareRepository.contatoDelete(id); // shares e convites caem em cascata
    return { id };
  },

  // userId do usuário com esse email, ou null se não existe / já está vinculado
  // a outro contato desta mesma agenda (unique ownerId+userId).
  async vinculavelPor(ownerId: string, email: string, exceptContatoId?: string): Promise<string | null> {
    const user = await cartaoShareRepository.userByEmail(email);
    if (!user) return null;
    const jaNaAgenda = (await cartaoShareRepository.contatosByUserId(user.id)).some(
      (c) => c.ownerId === ownerId && c.id !== exceptContatoId
    );
    return jaNaAgenda ? null : user.id;
  },

  // ── Convites (dono) ───────────────────────────────────────────────────────
  async criarConvite(ownerId: string, contatoId: string, dto: ConviteDTO) {
    const contato = await this.getContatoOrThrow(ownerId, contatoId);
    const email = (dto.email ?? contato.email)?.toLowerCase().trim();
    if (!email) throw new AppError("Informe o email de quem vai receber o convite", 422);
    if (contato.status === "ativo") throw new AppError("Esse contato já aceitou o compartilhamento", 422);

    const dias = dto.diasValidade ?? DIAS_CONVITE;
    const expiraEm = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
    const token = randomBytes(24).toString("base64url");

    await cartaoShareRepository.contatoUpdate(contatoId, {
      email,
      status: "convidado",
      convidadoEm: new Date(),
      userId: await this.vinculavelPor(ownerId, email, contatoId),
    });
    const convite = await cartaoShareRepository.conviteCreate({
      ownerId,
      contatoId,
      email,
      token,
      expiraEm,
    });
    return {
      id: convite.id,
      contatoId,
      email,
      token,
      // sem infra de email no projeto: a UI mostra o link pra copiar (decisão 9.2)
      link: `/?convite=${token}`,
      expiraEm: expiraEm.toISOString(),
    };
  },

  // ── Convites (quem recebe) ────────────────────────────────────────────────
  // Fallback pra contas pré-existentes: contato cadastrado só com email vira
  // convite pendente na primeira visita — não vira acesso liberado.
  async sincronizaConvites(user: AuthUser) {
    const vinculados = await cartaoShareRepository.contatosByUserId(user.id);
    const donos = new Set(vinculados.map((c) => c.ownerId));
    const soltos = await cartaoShareRepository.contatosUnlinkedByEmail(user.email);

    const pendentes = [...vinculados.filter((c) => c.status === "convidado")];
    for (const c of soltos) {
      if (donos.has(c.ownerId)) continue; // 1 contato por dono
      donos.add(c.ownerId);
      const atualizado = (await cartaoShareRepository.contatoUpdate(c.id, {
        userId: user.id,
        status: c.status === "local" ? "convidado" : c.status,
        convidadoEm: c.convidadoEm ?? new Date(),
      })) as Contato;
      if (atualizado.status === "convidado") pendentes.push(atualizado);
    }

    // um convite aberto por contato pendente, pra tudo passar pelo mesmo aceite
    for (const c of pendentes) {
      if ((await cartaoShareRepository.convitesPendentesDoContato(c.id)).length > 0) continue;
      await cartaoShareRepository.conviteCreate({
        ownerId: c.ownerId,
        contatoId: c.id,
        email: user.email,
        token: randomBytes(24).toString("base64url"),
        expiraEm: new Date(Date.now() + DIAS_CONVITE * 24 * 60 * 60 * 1000),
      });
    }
  },

  async meusConvites(user: AuthUser) {
    await this.sincronizaConvites(user);
    const agora = new Date();
    return (await cartaoShareRepository.convitesPendentesPorEmail(user.email))
      .filter((cv) => cv.expiraEm > agora)
      .map((cv) => ({
        id: cv.id,
        token: cv.token,
        dono: { id: cv.owner.id, nome: cv.owner.nome },
        comoMeChamou: cv.contato.nome,
        criadoEm: cv.createdAt.toISOString(),
        expiraEm: cv.expiraEm.toISOString(),
      }));
  },

  async convitePorToken(user: AuthUser, token: string) {
    const cv = await cartaoShareRepository.conviteFindByToken(token);
    if (!cv || cv.email !== user.email) throw new NotFoundError("Convite não encontrado");
    return { id: cv.id, status: cv.status, expirado: cv.expiraEm <= new Date() };
  },

  async aceitarConvite(user: AuthUser, id: string) {
    const cv = await cartaoShareRepository.conviteFindById(id);
    // 404 e não 403: convite de outra pessoa não vaza existência
    if (!cv || cv.email !== user.email) throw new NotFoundError(`Convite não encontrado: ${id}`);
    if (cv.status !== "convidado") throw new AppError("Esse convite já foi respondido", 422);
    if (cv.expiraEm <= new Date()) throw new AppError("Esse convite expirou", 422);

    const dono = await cartaoShareRepository.userById(cv.ownerId);
    if (!dono) throw new NotFoundError("Dono do convite não encontrado");

    // espelho: o contato recíproco na agenda de quem aceitou
    const espelho = (await cartaoShareRepository.contatosByUserId(cv.ownerId)).find(
      (c) => c.ownerId === user.id
    );

    const { contato, espelho: criado } = await cartaoShareRepository.aceitarConvite({
      conviteId: cv.id,
      contatoId: cv.contatoId,
      aceitanteId: user.id,
      aceitanteNome: user.nome,
      aceitanteEmail: user.email,
      ownerId: dono.id,
      ownerNome: dono.nome,
      ownerEmail: dono.email,
      espelhoExistenteId: espelho?.id ?? null,
    });
    return { id: cv.id, contatoId: contato.id, espelhoId: criado.id, status: "ativo" as const };
  },

  async recusarConvite(user: AuthUser, id: string) {
    const cv = await cartaoShareRepository.conviteFindById(id);
    if (!cv || cv.email !== user.email) throw new NotFoundError(`Convite não encontrado: ${id}`);
    if (cv.status !== "convidado") throw new AppError("Esse convite já foi respondido", 422);
    await cartaoShareRepository.conviteUpdate(id, { status: "recusado" });
    // recusa esconde os shares de quem recusou sem apagar nada do dono
    await cartaoShareRepository.contatoUpdate(cv.contatoId, {
      status: "recusado",
      respondidoEm: new Date(),
    });
    return { id, status: "recusado" as const };
  },

  // ── Shares (visão do dono) ──────────────────────────────────────────────────
  async listByCartao(ownerId: string, cartaoId: string, mes = currentMonth()) {
    await cartaoService.getOrThrow(ownerId, cartaoId);
    const shares = await cartaoShareRepository.sharesByCartao(cartaoId);
    // o OR do repositório pega linhas do cartão de QUALQUER dono — filtra aqui
    return shares
      .filter((s) => s.contato?.ownerId === ownerId)
      .map((s) => shareView(s, mes));
  },

  // Carrega a linha apontada garantindo que ela é do dono (id alheio no payload
  // contaminaria o agregado do outro — mesma regra do assertVinculos).
  async linhaDoDono(ownerId: string, dto: { despesaFixaId?: string; despesaMesId?: string }) {
    if (dto.despesaFixaId) {
      const d = await cartaoShareRepository.despesaFixaDoDono(dto.despesaFixaId, ownerId);
      if (!d) throw new NotFoundError(`Despesa fixa não encontrada: ${dto.despesaFixaId}`);
      return { campo: "despesaFixaId" as const, id: d.id, valor: num(d.valor), cartaoId: d.cartaoId };
    }
    if (dto.despesaMesId) {
      const d = await cartaoShareRepository.despesaMesDoDono(dto.despesaMesId, ownerId);
      if (!d) throw new NotFoundError(`Despesa do mês não encontrada: ${dto.despesaMesId}`);
      return { campo: "despesaMesId" as const, id: d.id, valor: num(d.valor), cartaoId: d.cartaoId };
    }
    return null;
  },

  async createShare(ownerId: string, dto: CreateShareDTO, cartaoIdPadrao?: string) {
    await this.getContatoOrThrow(ownerId, dto.contatoId);
    const linha = await this.linhaDoDono(ownerId, dto);

    if (dto.tipo === "valor") {
      const cartaoId = dto.cartaoId ?? cartaoIdPadrao;
      if (!cartaoId) throw new AppError("Compartilhamento avulso precisa de um cartão", 422);
      await cartaoService.getOrThrow(ownerId, cartaoId);
      const s = await cartaoShareRepository.shareCreate({
        cartaoId,
        contatoId: dto.contatoId,
        tipo: "valor",
        descricao: dto.descricao ?? "",
        percentual: null,
        valor: round(dto.valor as number),
        mesRef: dto.mesRef ?? null,
      });
      return shareView(s, currentMonth());
    }

    // modo linha: o cartão é DERIVADO da despesa — fica null aqui de propósito,
    // senão trocar a linha de cartão deixaria o share apontando o cartão velho.
    const outros = await cartaoShareRepository.sharesByLinha(linha!.campo, linha!.id);
    const erro = validaRateio(linha!.valor, [
      ...outros
        .filter((o) => o.contato?.status !== "recusado")
        .map((o) => ({ percentual: numOrNull(o.percentual), valor: numOrNull(o.valor) })),
      { percentual: dto.percentual ?? null, valor: dto.valor ?? null },
    ]);
    if (erro) throw new AppError(erro, 422);

    const s = await cartaoShareRepository.shareCreate({
      cartaoId: null,
      contatoId: dto.contatoId,
      tipo: "linha",
      descricao: dto.descricao ?? "",
      despesaFixaId: dto.despesaFixaId ?? null,
      despesaMesId: dto.despesaMesId ?? null,
      percentual: dto.percentual != null ? round(dto.percentual) : null,
      valor: dto.valor != null ? round(dto.valor) : null,
      mesRef: null,
    });
    return shareView(s, currentMonth());
  },

  async updateShare(ownerId: string, id: string, patch: UpdateShareDTO) {
    const cur = await cartaoShareRepository.shareFindById(id, ownerId);
    if (!cur) throw new NotFoundError(`Compartilhamento não encontrado: ${id}`);
    const data: Record<string, unknown> = {};
    if (patch.descricao != null) data.descricao = patch.descricao;
    if (patch.percentual !== undefined)
      data.percentual = patch.percentual != null ? round(patch.percentual) : null;
    if (patch.valor !== undefined) data.valor = patch.valor != null ? round(patch.valor) : null;
    if (patch.mesRef !== undefined) {
      if (cur.tipo !== "valor") throw new AppError("mesRef só se aplica a share do tipo valor");
      data.mesRef = patch.mesRef;
    }

    // mexer na parte de um contato pode estourar a soma da linha
    if (cur.tipo === "linha" && (patch.percentual !== undefined || patch.valor !== undefined)) {
      const campo = cur.despesaFixaId ? ("despesaFixaId" as const) : ("despesaMesId" as const);
      const linhaId = (cur.despesaFixaId ?? cur.despesaMesId) as string;
      const base = num(cur.despesaFixa?.valor ?? cur.despesaMes?.valor);
      const outros = (await cartaoShareRepository.sharesByLinha(campo, linhaId)).filter(
        (o) => o.id !== id && o.contato?.status !== "recusado"
      );
      const erro = validaRateio(base, [
        ...outros.map((o) => ({ percentual: numOrNull(o.percentual), valor: numOrNull(o.valor) })),
        {
          percentual: (data.percentual as number | null) ?? null,
          valor: (data.valor as number | null) ?? null,
        },
      ]);
      if (erro) throw new AppError(erro, 422);
    }

    const s = await cartaoShareRepository.shareUpdate(id, data);
    return shareView(s, currentMonth());
  },

  async removeShare(ownerId: string, id: string) {
    const cur = await cartaoShareRepository.shareFindById(id, ownerId);
    if (!cur) throw new NotFoundError(`Compartilhamento não encontrado: ${id}`);
    await cartaoShareRepository.shareDelete(id);
    return { id };
  },

  // Rateio de uma linha entre N pessoas: substitui o conjunto inteiro numa
  // transação, validando a soma uma vez só.
  async salvarRateio(ownerId: string, dto: RateioDTO, mes = currentMonth()) {
    const linha = await this.linhaDoDono(ownerId, dto);
    if (!linha) throw new AppError("Informe a linha a ratear", 422);

    for (const i of dto.itens) await this.getContatoOrThrow(ownerId, i.contatoId);
    const erro = validaRateio(
      linha.valor,
      dto.itens.map((i) => ({ percentual: i.percentual ?? null, valor: i.valor ?? null }))
    );
    if (erro) throw new AppError(erro, 422);

    await cartaoShareRepository.replaceRateio(
      linha.campo,
      linha.id,
      dto.itens.map((i) => ({
        cartaoId: null,
        contatoId: i.contatoId,
        tipo: "linha" as const,
        descricao: i.descricao ?? "",
        despesaFixaId: linha.campo === "despesaFixaId" ? linha.id : null,
        despesaMesId: linha.campo === "despesaMesId" ? linha.id : null,
        percentual: i.percentual != null ? round(i.percentual) : null,
        valor: i.valor != null ? round(i.valor) : null,
        mesRef: null,
      })),
      dto.abateShares
    );
    return this.rateioDaLinha(ownerId, dto, mes);
  },

  async rateioDaLinha(
    ownerId: string,
    ref: { despesaFixaId?: string; despesaMesId?: string },
    mes = currentMonth()
  ) {
    const linha = await this.linhaDoDono(ownerId, ref);
    if (!linha) throw new AppError("Informe a linha", 422);
    const shares = await cartaoShareRepository.sharesByLinha(linha.campo, linha.id);
    const r = rateioDaLinha(linha.valor, shares, mes);
    return {
      despesaFixaId: linha.campo === "despesaFixaId" ? linha.id : null,
      despesaMesId: linha.campo === "despesaMesId" ? linha.id : null,
      valor: linha.valor,
      ...r,
      shares: shares.map((s) => shareView(s, mes)),
    };
  },

  // ── Visão de quem deve ("o que devo") ─────────────────────────────────────
  // Só contato ATIVO (aceitou). `local`/`convidado`/`recusado` não veem nada.
  async contatosAtivos(user: AuthUser): Promise<Contato[]> {
    await this.sincronizaConvites(user);
    return (await cartaoShareRepository.contatosByUserId(user.id)).filter((c) => c.status === "ativo");
  },

  async meusCompartilhamentos(user: AuthUser, mes = currentMonth()) {
    const contatos = await this.contatosAtivos(user);
    const adocoes = await cartaoShareRepository.adocoesByUser(user.id);
    const porShare = new Map(adocoes.map((a) => [a.shareId, a]));
    const quitados = await this.quitadoPorShare(user.id);

    const shares = contatos.length
      ? await cartaoShareRepository.sharesByContatoIds(contatos.map((c) => c.id))
      : [];
    const vistos = new Set(shares.map((s) => s.id));

    const donos = new Map<
      string,
      { dono: { id: string; nome: string }; grupos: Map<string, GrupoDevido> }
    >();

    for (const s of shares) {
      const donoId = s.contato.owner.id;
      const entry = donos.get(donoId) ?? {
        dono: { id: donoId, nome: s.contato.owner.nome },
        grupos: new Map<string, GrupoDevido>(),
      };
      donos.set(donoId, entry);

      const cartao = cartaoResumo(s);
      const chave = cartao ? `cartao:${cartao.id}` : "outros";
      const grupo: GrupoDevido = entry.grupos.get(chave) ?? {
        chave,
        // linha sem cartão (aluguel) é o caso que o schema antigo nem aceitava
        tipo: cartao ? "cartao" : "outros",
        titulo: cartao ? cartao.nome : "Fora do cartão",
        cartao,
        linhas: [],
      };
      const adocao = porShare.get(s.id) ?? null;
      grupo.linhas.push(linhaDevidaView(s, mes, adocao, quitados.get(s.id) ?? adocao?.quitadoAte ?? null));
      entry.grupos.set(chave, grupo);
    }

    // linha ignorada não entra em nenhum total — ela some da conta, não da lista
    const soma = (ls: { valorMes: number; comprometido: number; ignorado: boolean }[]) => ({
      devidoMes: round(ls.filter((l) => !l.ignorado).reduce((t, l) => t + l.valorMes, 0)),
      comprometido: round(ls.filter((l) => !l.ignorado).reduce((t, l) => t + l.comprometido, 0)),
    });

    const lista = [...donos.values()].map((e) => {
      const grupos = [...e.grupos.values()].map((g) => ({ ...g, ...soma(g.linhas) }));
      return { dono: e.dono, ...soma(grupos.flatMap((g) => g.linhas)), grupos };
    });

    // Adoção cujo share sumiu: a despesa criada é do devedor e NÃO é apagada —
    // ela só ganha o aviso e a opção de excluir.
    const orfas: OrfaView[] = [];
    for (const a of adocoes) {
      if (vistos.has(a.shareId) || a.modo === "ignorado") continue;
      const despesa = a.despesaFixaId
        ? await orcamentoRepository.findDespesaFixa(a.despesaFixaId, user.id)
        : a.despesaMesId
          ? await orcamentoRepository.findDespesaMes(a.despesaMesId, user.id)
          : null;
      orfas.push({
        shareId: a.shareId,
        modo: a.modo,
        espacoId: a.espacoId,
        despesaFixaId: a.despesaFixaId,
        despesaMesId: a.despesaMesId,
        descricao: despesa?.descricao ?? null,
        valorAdotado: numOrNull(a.valorAdotado),
        aviso: "Compartilhamento removido pelo dono",
      });
    }

    return { donos: lista, orfas };
  },

  // quitadoAte por share = maior cobreAte dos adiantamentos. Fonte da verdade
  // fica no adiantamento (a adoção só guarda cache) — assim dá pra adiantar sem
  // ter adotado.
  async quitadoPorShare(userId: string): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    for (const a of await cartaoShareRepository.adiantamentosByUser(userId)) {
      const atual = m.get(a.shareId);
      if (!atual || a.cobreAte > atual) m.set(a.shareId, a.cobreAte);
    }
    return m;
  },

  async shareDoDevedorOrThrow(user: AuthUser, shareId: string): Promise<ShareComDono> {
    const s = await cartaoShareRepository.shareFindByIdParaDevedor(shareId, user.id);
    if (!s) throw new NotFoundError(`Compartilhamento não encontrado: ${shareId}`);
    return s;
  },

  // ── Adoção ────────────────────────────────────────────────────────────────
  async adotar(user: AuthUser, shareId: string, dto: AdotarDTO) {
    const share = await this.shareDoDevedorOrThrow(user, shareId);
    // o espaço é do DEVEDOR — validar dono aqui é tão obrigatório quanto no dto do dono
    const espaco = await espacoService.getOrThrow(user.id, dto.espacoId);
    const mes = dto.ym ?? currentMonth();

    const anterior = await cartaoShareRepository.adocaoFind(shareId, user.id);
    if (anterior && (anterior.despesaFixaId || anterior.despesaMesId)) {
      throw new AppError("Esse compartilhamento já virou despesa. Desfaça antes de adotar de novo.", 422);
    }

    const parte = shareValorNoMes(share, mes);
    const descricao = descricaoAdotada(share, share.contato.owner.nome);
    const categoriaId = sugereCategoria(
      descricao,
      await cartaoShareRepository.despesasCategorizadas(user.id)
    ) as string | null;
    const nota = `Compartilhado por ${share.contato.owner.nome}`;

    let despesaFixaId: string | null = null;
    let despesaMesId: string | null = null;

    if (dto.modo === "fixa") {
      const f = share.despesaFixa;
      const nova = await orcamentoRepository.createDespesaFixa({
        espacoId: espaco.id,
        descricao,
        valor: parte,
        diaVencimento: diaDaLinha(share),
        categoriaId,
        nota,
        // cartão fica null: o cartão é do dono, não entra na fatura de quem deve
        cartaoId: null,
        // parcelas espelhadas da linha original — a fixa morre sozinha na última
        // (parcelaAtivaNoMes já faz isso, sem código novo)
        parcelado: f?.parcelado ?? false,
        parcelaAtual: f?.parcelado ? f.parcelaAtual : null,
        totalParcelas: f?.parcelado ? f.totalParcelas : null,
        parcelaMesRef: f?.parcelado ? f.parcelaMesRef : null,
      });
      despesaFixaId = nova.id;
    } else {
      const nova = await orcamentoRepository.createDespesaMes({
        espacoId: espaco.id,
        mes,
        descricao,
        valor: parte,
        data: dataNoMes(mes, diaDaLinha(share)),
        categoriaId,
        nota,
        cartaoId: null,
      });
      despesaMesId = nova.id;
    }

    await cartaoShareRepository.adocaoUpsert(shareId, user.id, {
      shareId,
      userId: user.id,
      modo: dto.modo,
      espacoId: espaco.id,
      despesaFixaId,
      despesaMesId,
      valorAdotado: parte,
      quitadoAte: anterior?.quitadoAte ?? null,
    });
    return { shareId, modo: dto.modo, espacoId: espaco.id, despesaFixaId, despesaMesId, valor: parte };
  },

  async ignorar(user: AuthUser, shareId: string, mes = currentMonth()) {
    const share = await this.shareDoDevedorOrThrow(user, shareId);
    const anterior = await cartaoShareRepository.adocaoFind(shareId, user.id);
    if (anterior && (anterior.despesaFixaId || anterior.despesaMesId)) {
      throw new AppError("Desfaça a adoção antes de ignorar.", 422);
    }
    await cartaoShareRepository.adocaoUpsert(shareId, user.id, {
      shareId,
      userId: user.id,
      modo: "ignorado",
      espacoId: null,
      despesaFixaId: null,
      despesaMesId: null,
      valorAdotado: shareValorNoMes(share, mes),
      quitadoAte: anterior?.quitadoAte ?? null,
    });
    return { shareId, modo: "ignorado" as const };
  },

  async desfazerAdocao(user: AuthUser, shareId: string, removerDespesa = false) {
    const a = await cartaoShareRepository.adocaoFind(shareId, user.id);
    if (!a) throw new NotFoundError(`Adoção não encontrada: ${shareId}`);
    if (removerDespesa) {
      if (a.despesaFixaId && (await orcamentoRepository.findDespesaFixa(a.despesaFixaId, user.id)))
        await orcamentoRepository.deleteDespesaFixa(a.despesaFixaId);
      if (a.despesaMesId && (await orcamentoRepository.findDespesaMes(a.despesaMesId, user.id)))
        await orcamentoRepository.deleteDespesaMes(a.despesaMesId);
    }
    await cartaoShareRepository.adocaoDelete(shareId);
    return { shareId, despesaRemovida: removerDespesa };
  },

  // Dono mexeu no percentual → reescreve a despesa adotada com o valor atual.
  async sincronizar(user: AuthUser, shareId: string, mes = currentMonth()) {
    const share = await this.shareDoDevedorOrThrow(user, shareId);
    const a = await cartaoShareRepository.adocaoFind(shareId, user.id);
    if (!a) throw new NotFoundError(`Adoção não encontrada: ${shareId}`);
    const parte = shareValorNoMes(share, mes);

    if (a.despesaFixaId) {
      const d = await orcamentoRepository.findDespesaFixa(a.despesaFixaId, user.id);
      if (!d) throw new NotFoundError("A despesa adotada não existe mais");
      const f = share.despesaFixa;
      await orcamentoRepository.updateDespesaFixa(a.despesaFixaId, {
        valor: parte,
        parcelado: f?.parcelado ?? false,
        parcelaAtual: f?.parcelado ? f.parcelaAtual : null,
        totalParcelas: f?.parcelado ? f.totalParcelas : null,
        parcelaMesRef: f?.parcelado ? f.parcelaMesRef : null,
      });
    } else if (a.despesaMesId) {
      const d = await orcamentoRepository.findDespesaMes(a.despesaMesId, user.id);
      if (!d) throw new NotFoundError("A despesa adotada não existe mais");
      await orcamentoRepository.updateDespesaMes(a.despesaMesId, { valor: parte });
    }
    await cartaoShareRepository.adocaoUpdate(shareId, { valorAdotado: parte });
    return { shareId, valor: parte };
  },

  // ── Adiantamento ──────────────────────────────────────────────────────────
  async adiantar(user: AuthUser, shareId: string, dto: AdiantarDTO) {
    const share = await this.shareDoDevedorOrThrow(user, shareId);
    const mes = dto.ym ?? currentMonth();
    const jaQuitado = (await this.quitadoPorShare(user.id)).get(shareId) ?? null;
    const inicio = jaQuitado && jaQuitado >= mes ? addMonths(jaQuitado, 1) : mes;

    const cobreAte = dto.cobreAte ?? addMonths(inicio, (dto.parcelas as number) - 1);
    if (cobreAte < inicio) throw new AppError("Esse período já está adiantado", 422);

    // soma real dos meses cobertos: parcela que já acabou não entra na conta
    let valor = 0;
    const meses: string[] = [];
    for (let m = inicio; m <= cobreAte; m = addMonths(m, 1)) {
      const v = shareValorNoMes(share, m);
      if (v > 0) meses.push(m);
      valor = round(valor + v);
    }
    if (valor <= 0) throw new AppError("Não há parcela a adiantar nesse período", 422);

    await cartaoShareRepository.adiantamentoCreate({
      shareId,
      userId: user.id,
      valor,
      ym: mes,
      cobreAte,
    });

    const a = await cartaoShareRepository.adocaoFind(shareId, user.id);
    if (a) {
      await cartaoShareRepository.adocaoUpdate(shareId, { quitadoAte: cobreAte });
      // fixa adotada: pinta os meses cobertos como pagos (o app já sabe ler isso)
      if (a.modo === "fixa" && a.despesaFixaId && a.espacoId) {
        const d = await orcamentoRepository.findDespesaFixa(a.despesaFixaId, user.id);
        if (d) {
          for (const m of meses) {
            await orcamentoRepository.upsertPagamentoFixa(a.espacoId, a.despesaFixaId, m, num(d.valor));
          }
          const p = shareParcela(share, mes);
          if (p && p.restantes > 0 && cobreAte >= addMonths(mes, p.restantes)) {
            await orcamentoRepository.updateDespesaFixa(a.despesaFixaId, { ativa: false });
          }
        }
      }
    }
    return { shareId, valor, cobreAte, meses };
  },
};
