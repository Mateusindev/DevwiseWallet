import type { Espaco } from "@prisma/client";
import { espacoRepository, type EspacoComOrcamento } from "./espaco.repository";
import { AppError, NotFoundError } from "@/server/lib/errors";
import {
  num,
  isoDate,
  round,
  parcelaView,
  addMonths,
  currentMonth,
  parcelaAtivaNoMes,
} from "@/server/lib/serialize";
import { aplicaDivisao, CONTATO_INATIVO, type ShareLike } from "../cartao-share/rateio";
import type { CreateEspacoDTO, UpdateEspacoDTO } from "./espaco.dto";

// Janela de histórico carregada por leitura de orçamento. 12/12 cobre com folga
// a série de 6 meses do Início e o planejamento do ano; sair dela é o caso raro
// que o front refaz.
const JANELA_ATRAS = 12;
const JANELA_FRENTE = 12;

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

// Quanto a linha pesa no orçamento do dono (espelha lib/calc.js#valorEfetivoLinha).
// Contato `recusado` fica fora da soma: a recusa de um não faz o dono pagar menos.
function valorEfetivo(valor: number, abateShares: boolean, shares: ShareComContato[]) {
  if (!abateShares) return valor;
  const soma = round(
    shares
      .filter((s) => (s.contato?.status ?? "local") !== CONTATO_INATIVO)
      .reduce((t, s) => t + aplicaDivisao(valor, s), 0)
  );
  return round(Math.max(valor - soma, 0));
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
  // As três leituras não dependem uma da outra: em série eram três voltas de
  // rede no caminho crítico do boot.
  async listWithActive(userId: string) {
    const [espacos, ativoGravado, ocultos] = await Promise.all([
      espacoRepository.list(userId),
      espacoRepository.getActiveEspacoId(userId),
      espacoRepository.listOcultos(userId),
    ]);
    let activeEspacoId = ativoGravado;
    const exists = activeEspacoId && espacos.some((e) => e.id === activeEspacoId);
    if (!exists) {
      activeEspacoId = espacos[0]?.id ?? null;
      await espacoRepository.setActiveEspacoId(userId, activeEspacoId);
    }
    const espacosOcultos = ocultos.map((o) => ({ espacoId: o.espacoId, ym: o.ym }));
    return { espacos: espacos.map(espacoView), activeEspacoId, espacosOcultos };
  },

  // Oculta o espaço só no mês `ym` (exclusão reversível daquele mês).
  //   guarda: não deixa ocultar o último espaço visível do mês.
  async ocultarNoMes(userId: string, id: string, ym: string) {
    await this.getOrThrow(userId, id);
    const [espacos, ocultos] = await Promise.all([
      espacoRepository.list(userId),
      espacoRepository.listOcultos(userId),
    ]);
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

  // Orçamento do espaço numa JANELA de meses ao redor de `ym` (o front refaz a
  // busca quando o seletor sai dela). Devolve `janela` pra ele saber o alcance
  // do que recebeu, e as listas de meses com lançamento pros pontinhos do
  // seletor — que precisam enxergar além da janela.
  async getOrcamento(userId: string, espacoId: string, ym = currentMonth()) {
    const de = addMonths(ym, -JANELA_ATRAS);
    const ate = addMonths(ym, JANELA_FRENTE);
    const [esp, meses] = await Promise.all([
      espacoRepository.findWithOrcamento(espacoId, userId, de, ate),
      espacoRepository.mesesComLancamento(espacoId),
    ]);
    if (!esp) throw new NotFoundError(`Espaço de despesa não encontrado: ${espacoId}`);
    return { ...orcamentoView(esp), janela: { de, ate }, ...meses };
  },

  // Gasto do mês por espaço — o gráfico "por página" do Início. Uma request e
  // três queries no lugar de um getOrcamento por espaço (que ainda traria o
  // histórico inteiro só pra somar um mês).
  async resumoPorEspaco(userId: string, ym = currentMonth()) {
    const { espacos, fixas, avulsas } = await espacoRepository.resumoDoMes(userId, ym);
    const saiu = new Map<string, number>();
    const soma = (espacoId: string, v: number) => saiu.set(espacoId, (saiu.get(espacoId) ?? 0) + v);

    for (const d of fixas) {
      if (!parcelaAtivaNoMes(d, ym)) continue; // parcelada quitada sai sozinha
      soma(d.espacoId, valorEfetivo(num(d.valor), d.abateShares, d.shares as ShareComContato[]));
    }
    for (const d of avulsas) {
      soma(d.espacoId, valorEfetivo(num(d.valor), d.abateShares, d.shares as ShareComContato[]));
    }

    return {
      ym,
      espacos: espacos.map((e) => ({
        espacoId: e.id,
        nome: e.nome,
        emoji: e.emoji,
        saiu: round(saiu.get(e.id) ?? 0),
      })),
    };
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
