import type { Cartao, DespesaFixa } from "@prisma/client";
import { cartaoRepository } from "./cartao.repository";
import { NotFoundError } from "@/server/lib/errors";
import { num, round, currentMonth, effectiveParcela, parcelaAtivaNoMes, parcelaView } from "@/server/lib/serialize";
import type { CreateCartaoDTO, UpdateCartaoDTO } from "./cartao.dto";

// 'YYYY-MM' + 1 mês (vira o ano sozinho).
function proximoMes(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

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
  // 404 (não 403) quando o cartão é de outro dono — não vaza existência.
  async getOrThrow(userId: string, id: string): Promise<Cartao> {
    const c = await cartaoRepository.findById(id, userId);
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
  // Alimenta o seletor de "compartilhar linha".
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

  // Parceladas em aberto do dono (todos os espaços) + o que já foi pago no mês.
  // Cru de propósito: o painel de quitação da aba de cartões roda o mesmo cálculo
  // do front (lib/calc.js quitacaoParceladas) sobre estes dados, sem duplicar a
  // matemática de parcela nos dois lados.
  async parceladasEmAberto(userId: string, mes = currentMonth()) {
    const [fixas, pagamentos] = await Promise.all([
      cartaoRepository.parceladasDoUsuario(userId),
      cartaoRepository.pagamentosDoUsuarioNoMes(userId, mes),
    ]);
    const ids = new Set(fixas.map((d) => d.id));
    return {
      mes,
      fixas: fixas.map((d) => ({
        id: d.id,
        descricao: d.descricao,
        valor: num(d.valor),
        ativa: d.ativa,
        diaVencimento: d.diaVencimento,
        categoriaId: d.categoriaId,
        espacoId: d.espacoId,
        espacoNome: d.espaco.nome,
        espacoEmoji: d.espaco.emoji,
        ...parcelaView(d),
      })),
      // só o que aponta pra uma parcelada listada — o resto é ruído pro painel
      pagamentos: pagamentos
        .filter((p) => ids.has(p.despesaFixaId))
        .map((p) => ({ despesaFixaId: p.despesaFixaId, ym: p.ym, valorPago: num(p.valorPago) })),
    };
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

    const avulsasPorMes = new Map<string, typeof avulsas>();
    for (const d of avulsas) {
      const lista = avulsasPorMes.get(d.mes);
      if (lista) lista.push(d);
      else avulsasPorMes.set(d.mes, [d]);
    }

    const meses = [];
    for (let ym = de; ym <= ate; ym = proximoMes(ym)) {
      const porCartao = new Map<string, number>();
      const porCategoria = new Map<string, number>();
      const soma = (mapa: Map<string, number>, chave: string, valor: number) =>
        mapa.set(chave, round((mapa.get(chave) ?? 0) + valor));

      // fixa parcelada só entra nos meses da janela dela; fixa normal, sempre
      for (const d of fixas) {
        if (!parcelaAtivaNoMes(d, ym)) continue;
        const valor = num(d.valor);
        soma(porCartao, d.cartaoId as string, valor);
        soma(porCategoria, d.categoriaId ?? "", valor);
      }
      for (const d of avulsasPorMes.get(ym) ?? []) {
        const valor = num(d.valor);
        soma(porCartao, d.cartaoId as string, valor);
        soma(porCategoria, d.categoriaId ?? "", valor);
      }

      const lista = (mapa: Map<string, number>, campo: "cartaoId" | "categoriaId") =>
        [...mapa.entries()]
          .map(([id, total]) => ({ [campo]: id || null, total }))
          .sort((a, b) => b.total - a.total);

      meses.push({
        ym,
        total: round([...porCartao.values()].reduce((s, v) => s + v, 0)),
        porCartao: lista(porCartao, "cartaoId") as { cartaoId: string | null; total: number }[],
        porCategoria: lista(porCategoria, "categoriaId") as { categoriaId: string | null; total: number }[],
      });
    }
    return { de, ate, meses };
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
