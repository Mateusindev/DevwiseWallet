import type { Espaco } from "@prisma/client";
import { espacoRepository, type EspacoComOrcamento } from "./espaco.repository";
import { AppError, NotFoundError } from "@/server/lib/errors";
import { num, isoDate, round, parcelaView } from "@/server/lib/serialize";
import { aplicaDivisao, type ShareLike } from "../cartao-share/rateio";
import type { CreateEspacoDTO, UpdateEspacoDTO } from "./espaco.dto";

export function espacoView(esp: Espaco) {
  return { id: esp.id, nome: esp.nome, tipo: esp.tipo, emoji: esp.emoji };
}

// Rateio da linha no formato que o front desenha (iniciais + valor efetivo).
// Independe do mês de propósito: a parte de cada contato é sempre a mesma fatia
// da linha; quem some no mês é a linha inteira (parcela encerrada), e disso o
// front já cuida com `parcelaAtivaNoMes`.
type ShareComContato = ShareLike & { contato: { id: string; nome: string; status: string } | null };

// A base vem por parâmetro: aqui o share está aninhado DENTRO da despesa, então
// ele não carrega `despesaFixa`/`despesaMes` pra `linhaBase` derivar sozinha.
function rateioView(shares: ShareComContato[], base: number) {
  return shares.map((s) => ({
    shareId: s.id,
    contatoId: s.contatoId,
    nome: s.contato?.nome ?? "",
    status: s.contato?.status ?? "local",
    percentual: s.percentual != null ? num(s.percentual) : null,
    valor: aplicaDivisao(base, s),
  }));
}

// Monta o blob de orçamento no formato que o front espera.
export function orcamentoView(esp: EspacoComOrcamento) {
  const rendasMensais: Record<string, number> = {};
  for (const r of esp.rendasMensais) rendasMensais[r.ym] = num(r.valor);

  return {
    despesasFixas: esp.despesasFixas.map((d) => ({
      id: d.id,
      descricao: d.descricao,
      valor: num(d.valor),
      diaVencimento: d.diaVencimento,
      ativa: d.ativa,
      categoriaId: d.categoriaId,
      nota: d.nota,
      abateShares: d.abateShares,
      rateio: rateioView(d.shares as ShareComContato[], num(d.valor)),
      ...parcelaView(d),
    })),
    despesasMes: esp.despesasMes.map((d) => ({
      id: d.id,
      mes: d.mes,
      descricao: d.descricao,
      valor: num(d.valor),
      data: isoDate(d.data),
      paga: d.paga,
      valorPago: num(d.valorPago),
      cartaoId: d.cartaoId,
      categoriaId: d.categoriaId,
      nota: d.nota,
      abateShares: d.abateShares,
      rateio: rateioView(d.shares as ShareComContato[], num(d.valor)),
      fitid: d.fitid, // o front usa pra marcar o que já veio de um OFX
    })),
    receitasMes: esp.receitasMes.map((r) => ({
      id: r.id,
      mes: r.mes,
      descricao: r.descricao,
      valor: num(r.valor),
      data: isoDate(r.data),
      recorrente: r.recorrente,
      mesFim: r.mesFim,
    })),
    // mesmo formato de espacosOcultos/pagamentosFixas: lista plana de exceções
    receitasSkips: esp.receitasMes.flatMap((r) =>
      r.skips.map((s) => ({ receitaId: s.receitaId, ym: s.ym }))
    ),
    pagamentosFixas: esp.pagamentosFixas.map((p) => ({
      despesaFixaId: p.despesaFixaId,
      ym: p.ym,
      valorPago: num(p.valorPago),
    })),
    rendasMensais,
    config: { rendaMensal: num(esp.rendaMensal), moeda: esp.moeda },
  };
}

export const espacoService = {
  // Espaço padrão provisionado quando o usuário não tem nenhum: só "Meu"
  // (pessoal). Idempotente.
  async ensureDefaults(userId: string) {
    if ((await espacoRepository.count(userId)) > 0) return;
    const esp = await espacoRepository.create({
      userId,
      nome: "Meu",
      tipo: "pessoal",
      emoji: "🧍",
      rendaMensal: 0,
      moeda: "BRL",
    });
    await espacoRepository.setActiveEspacoId(userId, esp.id);
  },

  // 404 (não 403) quando o espaço é de outro dono — não vaza existência.
  async getOrThrow(userId: string, id: string): Promise<Espaco> {
    const esp = await espacoRepository.findById(id, userId);
    if (!esp) throw new NotFoundError(`Espaço de despesa não encontrado: ${id}`);
    return esp;
  },

  // Lista + espaço ativo (com fallback pro primeiro se o ativo sumir).
  async listWithActive(userId: string) {
    const espacos = await espacoRepository.list(userId);
    let activeEspacoId = await espacoRepository.getActiveEspacoId(userId);
    const exists = activeEspacoId && espacos.some((e) => e.id === activeEspacoId);
    if (!exists) {
      activeEspacoId = espacos[0]?.id ?? null;
      await espacoRepository.setActiveEspacoId(userId, activeEspacoId);
    }
    const espacosOcultos = (await espacoRepository.listOcultos(userId)).map((o) => ({
      espacoId: o.espacoId,
      ym: o.ym,
    }));
    return { espacos: espacos.map(espacoView), activeEspacoId, espacosOcultos };
  },

  // Oculta o espaço só no mês `ym` (exclusão reversível daquele mês).
  //   guarda: não deixa ocultar o último espaço visível do mês.
  async ocultarNoMes(userId: string, id: string, ym: string) {
    await this.getOrThrow(userId, id);
    const espacos = await espacoRepository.list(userId);
    const ocultos = await espacoRepository.listOcultos(userId);
    const ocultosNoMes = new Set(ocultos.filter((o) => o.ym === ym).map((o) => o.espacoId));
    const visiveis = espacos.filter((e) => !ocultosNoMes.has(e.id));
    if (visiveis.length <= 1 && visiveis.some((e) => e.id === id)) {
      throw new AppError("Não dá pra excluir a única página do mês.");
    }
    await espacoRepository.hide(id, ym);
    return { id, ym };
  },

  // Restaura o espaço no mês `ym` (desfaz a exclusão daquele mês).
  async restaurarNoMes(userId: string, id: string, ym: string) {
    await this.getOrThrow(userId, id);
    await espacoRepository.unhide(id, ym);
    return { id, ym };
  },

  async getOrcamento(userId: string, espacoId: string) {
    const esp = await espacoRepository.findWithOrcamento(espacoId, userId);
    if (!esp) throw new NotFoundError(`Espaço de despesa não encontrado: ${espacoId}`);
    return orcamentoView(esp);
  },

  async setActive(userId: string, id: string) {
    await this.getOrThrow(userId, id);
    await espacoRepository.setActiveEspacoId(userId, id);
    return { activeEspacoId: id };
  },

  async create(userId: string, dto: CreateEspacoDTO) {
    const esp = await espacoRepository.create({
      userId,
      nome: dto.nome,
      tipo: dto.tipo,
      emoji: dto.emoji,
      rendaMensal: round(dto.rendaMensal ?? 0),
      moeda: dto.moeda ?? "BRL",
    });
    // primeiro espaço vira ativo automaticamente
    if ((await espacoRepository.getActiveEspacoId(userId)) == null) {
      await espacoRepository.setActiveEspacoId(userId, esp.id);
    }
    return espacoView(esp);
  },

  async update(userId: string, id: string, patch: UpdateEspacoDTO) {
    await this.getOrThrow(userId, id);
    const data: Record<string, unknown> = { ...patch };
    if (patch.rendaMensal != null) data.rendaMensal = round(patch.rendaMensal);
    const esp = await espacoRepository.update(id, data);
    return espacoView(esp);
  },

  async remove(userId: string, id: string) {
    await this.getOrThrow(userId, id);
    if ((await espacoRepository.count(userId)) <= 1) {
      throw new AppError("Não dá pra remover o único espaço.");
    }
    await espacoRepository.delete(id); // cascata limpa orçamento
    // se era o ativo, reassina pro primeiro restante
    let activeEspacoId = await espacoRepository.getActiveEspacoId(userId);
    if (activeEspacoId === id || activeEspacoId == null) {
      const rest = await espacoRepository.list(userId);
      activeEspacoId = rest[0]?.id ?? null;
      await espacoRepository.setActiveEspacoId(userId, activeEspacoId);
    }
    return { id, activeEspacoId };
  },
};
