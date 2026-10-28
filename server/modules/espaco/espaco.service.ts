import type { Espaco } from "@prisma/client";
import { espacoRepository } from "./espaco.repository";
import { AppError, NotFoundError } from "@/server/lib/errors";
import { round, addMonths, currentMonth } from "@/server/lib/serialize";
import { espacoView, orcamentoView, resumoPorEspacoView, espacoAtivo } from "./espaco.view";
import type { CreateEspacoDTO, UpdateEspacoDTO } from "./espaco.dto";

// A montagem (orcamentoView, resumo, rateio por linha) mora em `espaco.view.ts`:
// é a mesma que o navegador usa quando lê direto do Supabase.
export { espacoView, orcamentoView };

// Janela de histórico carregada por leitura de orçamento. 12/12 cobre com folga
// a série de 6 meses do Início e o planejamento do ano; sair dela é o caso raro
// que o front refaz. O navegador usa a mesma janela (`leituraDireta.ts`).
export const JANELA_ATRAS = 12;
export const JANELA_FRENTE = 12;

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
    const activeEspacoId = espacoAtivo(espacos, ativoGravado);
    if (activeEspacoId !== ativoGravado) await espacoRepository.setActiveEspacoId(userId, activeEspacoId);
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
    return resumoPorEspacoView(ym, espacos, fixas, avulsas);
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
