import type { Cartao } from "@prisma/client";
import { cartaoRepository } from "./cartao.repository";
import { NotFoundError } from "@/server/lib/errors";
import { round, currentMonth } from "@/server/lib/serialize";
import {
  cartaoView,
  agregadosDoCartao,
  cartoesComAgregados,
  resumoPorMesView,
  faturaLinhasView,
  parceladasView,
} from "./cartao.view";
import type { CreateCartaoDTO, UpdateCartaoDTO } from "./cartao.dto";

// A montagem mora em `cartao.view.ts`: é a mesma que o navegador usa quando lê
// direto do Supabase.
export { cartaoView, agregadosDoCartao };

export const cartaoService = {
  // 404 (não 403) quando o cartão é de outro dono — não vaza existência.
  async getOrThrow(userId: string, id: string): Promise<Cartao> {
    const c = await cartaoRepository.findById(id, userId);
    if (!c) throw new NotFoundError(`Cartão não encontrado: ${id}`);
    return c;
  },

  // Linhas da fatura de um cartão no mês: fixas ativas na janela + avulsas do mês.
  // Alimenta o seletor de "compartilhar linha".
  async faturaLinhas(userId: string, cartaoId: string, mes = currentMonth()) {
    await this.getOrThrow(userId, cartaoId);
    const [fixas, avulsas] = await Promise.all([
      cartaoRepository.fixasAtivasDoCartao(cartaoId),
      cartaoRepository.avulsasDoCartaoNoMes(cartaoId, mes),
    ]);
    return faturaLinhasView(mes, fixas, avulsas);
  },

  // Parceladas em aberto do dono (todos os espaços) + o que já foi pago no mês.
  // Cru de propósito: o painel de quitação da aba de cartões roda o mesmo cálculo
  // do front (lib/calc.js quitacaoParceladas) sobre estes dados, sem duplicar a
  // matemática de parcela nos dois lados.
  async parceladasEmAberto(userId: string, mes = currentMonth()) {
    const [fixas, pagamentos] = await Promise.all([
      cartaoRepository.parceladasDoUsuario(userId),
      cartaoRepository.pagamentosDoUsuarioNoMes(userId, mes),
    ]);
    return parceladasView(mes, fixas, pagamentos);
  },

  // Resumo da fatura mês a mês, por cartão e por categoria. Um endpoint só:
  // 24 meses × N cartões viraria centenas de requests no front.
  //
  // Escopo = conta (todos os espaços), igual ao `comprometido` de cada card:
  // fatura é assunto de cartão, não de espaço.
  async resumoPorMes(userId: string, de: string, ate: string) {
    const [fixas, avulsas] = await Promise.all([
      cartaoRepository.fixasComCartaoDoUsuario(userId),
      cartaoRepository.avulsasComCartaoNoIntervalo(userId, de, ate),
    ]);
    return resumoPorMesView(de, ate, fixas, avulsas);
  },

  // Lista com agregados de um mês (default: mês corrente).
  // 3 queries fixas — antes era 1 + 3N, e como quase toda mutação de despesa
  // recarregava os cartões, o N+1 vinha de brinde a cada ação do usuário.
  async listWithAggregates(userId: string, mes = currentMonth()) {
    const [cartoes, fixas, avulsas] = await Promise.all([
      cartaoRepository.list(userId),
      cartaoRepository.fixasComCartaoDoUsuario(userId),
      cartaoRepository.avulsasComCartaoNoIntervalo(userId, mes, mes),
    ]);
    return cartoesComAgregados(cartoes, fixas, avulsas, mes);
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
