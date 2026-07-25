import type { Cartao, DespesaFixa } from "@prisma/client";
import { cartaoRepository } from "./cartao.repository";
import { NotFoundError } from "@/server/lib/errors";
import { num, round, currentMonth, effectiveParcela, parcelaAtivaNoMes } from "@/server/lib/serialize";
import type { CreateCartaoDTO, UpdateCartaoDTO } from "./cartao.dto";

// Parcelas futuras (depois do mês `mes`) de uma fixa parcelada, já auto-avançadas.
function parcelasRestantes(d: DespesaFixa, mes: string) {
  if (!d.parcelado || !d.totalParcelas) return 0;
  const eff = effectiveParcela(d, mes) ?? 0;
  return Math.max(d.totalParcelas - eff, 0);
}

// View básica (sem agregados) — usada onde só precisa do cadastro.
export function cartaoView(c: Cartao) {
  return {
    id: c.id,
    nome: c.nome,
    bandeira: c.bandeira,
    limite: num(c.limite),
    diaFechamento: c.diaFechamento,
    diaVencimento: c.diaVencimento,
    cor: c.cor,
    ordem: c.ordem,
  };
}

export const cartaoService = {
  async getOrThrow(userId: string, id: string): Promise<Cartao> {
    const c = await cartaoRepository.findById(userId, id);
    if (!c) throw new NotFoundError(`Cartão não encontrado: ${id}`);
    return c;
  },

  // Agregados de um cartão num mês: fatura do mês, comprometido futuro, disponível.
  async withAggregates(c: Cartao, mes: string) {
    const [fixasAtivas, avulsasMes, fixasParc] = await Promise.all([
      cartaoRepository.fixasAtivasDoCartao(c.id),
      cartaoRepository.avulsasDoCartaoNoMes(c.id, mes),
      cartaoRepository.fixasParceladas(c.id),
    ]);

    // fixas: parcelada conta só dentro da janela (quitadas saem sozinhas); fixa normal sempre.
    const fixasNoMes = fixasAtivas.reduce((s, d) => (parcelaAtivaNoMes(d, mes) ? s + num(d.valor) : s), 0);
    // avulsas do mês não parcelam — somam direto.
    const avulsasTotal = avulsasMes.reduce((s, d) => s + num(d.valor), 0);
    const faturaMes = round(fixasNoMes + avulsasTotal);

    // comprometido futuro = parcelas de fixas que ainda vão cair depois do mês visto
    const comprometido = round(
      fixasParc.reduce((s, d) => s + parcelasRestantes(d, mes) * num(d.valor), 0)
    );

    const limite = num(c.limite);
    return {
      ...cartaoView(c),
      faturaMes,
      comprometido,
      disponivel: round(limite - faturaMes - comprometido),
    };
  },

  // Linhas da fatura de um cartão no mês: fixas ativas na janela + avulsas do mês.
  async faturaLinhas(userId: string, cartaoId: string, mes = currentMonth()) {
    await this.getOrThrow(userId, cartaoId);
    const [fixas, avulsas] = await Promise.all([
      cartaoRepository.fixasAtivasDoCartao(cartaoId),
      cartaoRepository.avulsasDoCartaoNoMes(cartaoId, mes),
    ]);
    const linhasFixas = fixas
      .filter((d) => parcelaAtivaNoMes(d, mes))
      .map((d) => {
        const eff = effectiveParcela(d, mes);
        return {
          id: d.id,
          tipo: "fixa" as const,
          descricao: d.descricao,
          valor: num(d.valor),
          parcelado: d.parcelado,
          parcelaAtual: eff,
          totalParcelas: d.totalParcelas,
        };
      });
    const linhasAvulsas = avulsas.map((d) => ({
      id: d.id,
      tipo: "mes" as const,
      descricao: d.descricao,
      valor: num(d.valor),
      parcelado: false,
      parcelaAtual: null,
      totalParcelas: null,
    }));
    return [...linhasFixas, ...linhasAvulsas];
  },

  // Lista com agregados de um mês (default: mês corrente).
  async listWithAggregates(userId: string, mes = currentMonth()) {
    const cartoes = await cartaoRepository.list(userId);
    return Promise.all(cartoes.map((c) => this.withAggregates(c, mes)));
  },

  async create(userId: string, dto: CreateCartaoDTO) {
    const ordem = (await cartaoRepository.count(userId)) + 1;
    const c = await cartaoRepository.create({
      userId,
      nome: dto.nome,
      bandeira: dto.bandeira ?? null,
      limite: round(dto.limite),
      diaFechamento: dto.diaFechamento ?? null,
      diaVencimento: dto.diaVencimento,
      cor: dto.cor,
      ordem,
    });
    return cartaoView(c);
  },

  async update(userId: string, id: string, patch: UpdateCartaoDTO) {
    await this.getOrThrow(userId, id);
    const data: Record<string, unknown> = { ...patch };
    if (patch.limite != null) data.limite = round(patch.limite);
    const c = await cartaoRepository.update(id, data);
    return cartaoView(c);
  },

  async remove(userId: string, id: string) {
    await this.getOrThrow(userId, id);
    await cartaoRepository.delete(id); // despesas mantêm-se, cartao_id vira NULL (SetNull)
    return { id };
  },
};
