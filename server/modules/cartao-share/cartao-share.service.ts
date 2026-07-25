import type { Cartao, Contato, CartaoShare, DespesaFixa, DespesaMes } from "@prisma/client";
import { cartaoShareRepository } from "./cartao-share.repository";
import { cartaoService } from "../cartao/cartao.service";
import { AppError, NotFoundError } from "@/server/lib/errors";
import { num, numOrNull, round, currentMonth, effectiveParcela, parcelaAtivaNoMes } from "@/server/lib/serialize";
import type { AuthUser } from "@/server/auth/auth.service";
import type { CreateContatoDTO, UpdateContatoDTO, CreateShareDTO, UpdateShareDTO } from "./cartao-share.dto";

type ShareRow = CartaoShare & {
  despesaFixa: DespesaFixa | null;
  despesaMes: DespesaMes | null;
};
type ShareWithCartao = ShareRow & { cartao: Cartao };

// ── Cálculo (puro) ───────────────────────────────────────────────────────────

// Valor da linha apontada (0 se share é do tipo "valor").
function linhaBase(s: ShareRow): number {
  if (s.despesaFixa) return num(s.despesaFixa.valor);
  if (s.despesaMes) return num(s.despesaMes.valor);
  return 0;
}

// Aplica a divisão (percentual / valor fixo / linha inteira) sobre a base.
function aplicaDivisao(base: number, s: ShareRow): number {
  if (s.percentual != null) return round((base * num(s.percentual)) / 100);
  if (s.valor != null) return round(Math.min(num(s.valor), base));
  return round(base);
}

// Quanto o contato deve neste share, no mês `mes`.
export function shareValorNoMes(s: ShareRow, mes: string): number {
  if (s.tipo === "valor") {
    return s.mesRef == null || s.mesRef === mes ? num(s.valor) : 0;
  }
  const ativo = s.despesaFixa
    ? parcelaAtivaNoMes(s.despesaFixa, mes)
    : s.despesaMes
      ? s.despesaMes.mes === mes
      : false;
  return ativo ? aplicaDivisao(linhaBase(s), s) : 0;
}

// Info de parcela (só quando a linha é fixa parcelada).
export function shareParcela(s: ShareRow, mes: string) {
  const d = s.despesaFixa;
  if (!d || !d.parcelado || !d.totalParcelas) return null;
  const eff = effectiveParcela(d, mes) ?? 0;
  return {
    parcelaAtual: eff,
    totalParcelas: d.totalParcelas,
    restantes: Math.max(d.totalParcelas - eff, 0),
  };
}

// Comprometido futuro do contato neste share: parcelas restantes × parte por mês.
export function shareComprometido(s: ShareRow, mes: string): number {
  const p = shareParcela(s, mes);
  if (!p) return 0;
  return round(p.restantes * aplicaDivisao(linhaBase(s), s));
}

// ── Views ────────────────────────────────────────────────────────────────────

function contatoView(c: Contato) {
  return { id: c.id, nome: c.nome, email: c.email, userId: c.userId, vinculado: c.userId != null };
}

function shareView(s: ShareRow, mes: string) {
  return {
    id: s.id,
    cartaoId: s.cartaoId,
    contatoId: s.contatoId,
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

// ── Service ────────────────────────────────────────────────────────────────

export const cartaoShareService = {
  // ── Contatos (agenda do dono: ownerId = usuário logado) ─────────────────────
  async listContatos(ownerId: string) {
    return (await cartaoShareRepository.contatoList(ownerId)).map(contatoView);
  },

  async getContatoOrThrow(ownerId: string, id: string): Promise<Contato> {
    const c = await cartaoShareRepository.contatoFindById(ownerId, id);
    if (!c) throw new NotFoundError(`Contato não encontrado: ${id}`);
    return c;
  },

  async createContato(ownerId: string, dto: CreateContatoDTO) {
    const email = dto.email ?? null;
    // vínculo lazy: se já existe usuário com esse email, associa de cara
    const userId = email ? (await cartaoShareRepository.userByEmail(email))?.id ?? null : null;
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
      data.userId = patch.email ? (await cartaoShareRepository.userByEmail(patch.email))?.id ?? null : null;
    }
    const c = await cartaoShareRepository.contatoUpdate(id, data);
    return contatoView(c);
  },

  async removeContato(ownerId: string, id: string) {
    await this.getContatoOrThrow(ownerId, id);
    await cartaoShareRepository.contatoDelete(id); // shares caem em cascata
    return { id };
  },

  // ── Shares (visão do dono — userId = dono do cartão) ────────────────────────
  async listByCartao(userId: string, cartaoId: string, mes = currentMonth()) {
    await cartaoService.getOrThrow(userId, cartaoId); // cartão é do usuário
    const shares = await cartaoShareRepository.sharesByCartao(cartaoId);
    return shares.map((s) => shareView(s as ShareRow, mes));
  },

  async createShare(userId: string, cartaoId: string, dto: CreateShareDTO) {
    await cartaoService.getOrThrow(userId, cartaoId); // cartão é do usuário
    await this.getContatoOrThrow(userId, dto.contatoId); // contato é da agenda dele
    // linha compartilhada tem que ser de um espaço do próprio usuário
    if (dto.despesaFixaId && !(await cartaoShareRepository.despesaFixaOwned(userId, dto.despesaFixaId)))
      throw new NotFoundError(`Despesa fixa não encontrada: ${dto.despesaFixaId}`);
    if (dto.despesaMesId && !(await cartaoShareRepository.despesaMesOwned(userId, dto.despesaMesId)))
      throw new NotFoundError(`Despesa do mês não encontrada: ${dto.despesaMesId}`);
    const s = await cartaoShareRepository.shareCreate({
      cartaoId,
      contatoId: dto.contatoId,
      tipo: dto.tipo,
      descricao: dto.descricao ?? "",
      despesaFixaId: dto.despesaFixaId ?? null,
      despesaMesId: dto.despesaMesId ?? null,
      percentual: dto.tipo === "linha" && dto.percentual != null ? round(dto.percentual) : null,
      valor: dto.valor != null ? round(dto.valor) : null,
      mesRef: dto.tipo === "valor" ? dto.mesRef ?? null : null,
    });
    return shareView(s as ShareRow, currentMonth());
  },

  async updateShare(userId: string, id: string, patch: UpdateShareDTO) {
    const cur = await cartaoShareRepository.shareFindById(id);
    if (!cur || cur.cartao.userId !== userId) throw new NotFoundError(`Compartilhamento não encontrado: ${id}`);
    const data: Record<string, unknown> = {};
    if (patch.descricao != null) data.descricao = patch.descricao;
    if (patch.percentual !== undefined)
      data.percentual = patch.percentual != null ? round(patch.percentual) : null;
    if (patch.valor !== undefined) data.valor = patch.valor != null ? round(patch.valor) : null;
    if (patch.mesRef !== undefined) {
      if (cur.tipo !== "valor") throw new AppError("mesRef só se aplica a share do tipo valor");
      data.mesRef = patch.mesRef;
    }
    const s = await cartaoShareRepository.shareUpdate(id, data);
    return shareView(s as ShareRow, currentMonth());
  },

  async removeShare(userId: string, id: string) {
    const cur = await cartaoShareRepository.shareFindById(id);
    if (!cur || cur.cartao.userId !== userId) throw new NotFoundError(`Compartilhamento não encontrado: ${id}`);
    await cartaoShareRepository.shareDelete(id);
    return { id };
  },

  // ── Visão da pessoa compartilhada ("o que devo") ─────────────────────────────
  // Resolve os contatos do usuário logado (1 por dono que o convidou); vincula
  // lazy por email os contatos sem vínculo antes de listar.
  async resolveContatos(user: AuthUser): Promise<Contato[]> {
    const unlinked = await cartaoShareRepository.contatosUnlinkedByEmail(user.email);
    for (const c of unlinked) {
      // pode colidir com @@unique([ownerId, userId]) se o dono já tiver esse vínculo — ignora
      try {
        await cartaoShareRepository.contatoUpdate(c.id, { userId: user.id });
      } catch {
        /* vínculo já existe pra esse dono */
      }
    }
    return cartaoShareRepository.contatosByUserId(user.id);
  },

  async meusCompartilhamentos(user: AuthUser, mes = currentMonth()) {
    const contatos = await this.resolveContatos(user);
    if (contatos.length === 0) return [];
    const shares = (await cartaoShareRepository.sharesByContatoIds(contatos.map((c) => c.id))) as ShareWithCartao[];

    const porCartao = new Map<string, { cartao: Cartao; linhas: ShareRow[] }>();
    for (const s of shares) {
      const g = porCartao.get(s.cartaoId) ?? { cartao: s.cartao, linhas: [] };
      g.linhas.push(s);
      porCartao.set(s.cartaoId, g);
    }

    return [...porCartao.values()].map(({ cartao, linhas }) => {
      const views = linhas.map((s) => shareView(s, mes));
      return {
        cartao: { id: cartao.id, nome: cartao.nome, bandeira: cartao.bandeira, cor: cartao.cor },
        devidoMes: round(views.reduce((t, v) => t + v.valorMes, 0)),
        comprometido: round(views.reduce((t, v) => t + v.comprometido, 0)),
        linhas: views,
      };
    });
  },
};
