import type { DespesaFixa, DespesaMes } from "@prisma/client";
import { orcamentoRepository } from "./orcamento.repository";
import { espacoService } from "../espaco/espaco.service";
import { cartaoService } from "../cartao/cartao.service";
import { categoriaService } from "../categoria/categoria.service";
import { AppError, NotFoundError } from "@/server/lib/errors";
import { num, isoDate, parseDate, round, parcelaAtivaNoMes, parcelaView, parcelaWrite, currentMonth } from "@/server/lib/serialize";
import type {
  ImportMesDTO,
  BulkFixaDTO,
  BulkMesDTO,
  AddDespesaFixaDTO,
  UpdateDespesaFixaDTO,
  AddDespesaMesDTO,
  UpdateDespesaMesDTO,
  AddReceitaMesDTO,
  UpdateReceitaMesDTO,
} from "./orcamento.dto";

// Garante que a entidade pertence ao espaço informado.
// O create valida isso no DTO (`data` dentro de `mes`); no update o mês vem do
// registro, então a checagem mora aqui.
function assertDataNoMes(data: string | undefined, mes: string) {
  if (data && data.slice(0, 7) !== mes) {
    throw new AppError(`A data precisa estar dentro de ${mes}`, 422);
  }
}

function assertPertence(found: { espacoId: string } | null, espacoId: string, label: string, id: string) {
  if (!found || found.espacoId !== espacoId) {
    throw new NotFoundError(`${label} não encontrada: ${id}`);
  }
}

// Cartão e categoria são agregados raiz de OUTRO módulo: uma despesa só pode
// apontar os do próprio dono. Sem isso, uma fixa entraria na fatura de um cartão
// de outra conta (o cálculo de fatura filtra por cartaoId, não por userId).
// Recurso de outro dono → 404 pelos getOrThrow, como no resto do app.
async function assertVinculos(
  userId: string,
  dto: { cartaoId?: string | null; categoriaId?: string | null }
) {
  if (dto.cartaoId) await cartaoService.getOrThrow(userId, dto.cartaoId);
  if (dto.categoriaId) await categoriaService.getOrThrow(userId, dto.categoriaId);
}

// Lote é tudo ou nada: um id que não é do dono (ou não é do espaço) derruba a
// operação inteira ANTES de qualquer escrita. 404 e não 403, como no getOrThrow.
function assertLoteCompleto<T>(encontradas: T[], ids: string[], label: string) {
  const pedidos = new Set(ids);
  if (encontradas.length !== pedidos.size) {
    throw new NotFoundError(`${label} não encontrada em algum id do lote`);
  }
}

function fixaView(d: DespesaFixa) {
  return {
    id: d.id,
    descricao: d.descricao,
    valor: num(d.valor),
    diaVencimento: d.diaVencimento,
    ativa: d.ativa,
    categoriaId: d.categoriaId,
    nota: d.nota,
    ...parcelaView(d),
  };
}

function mesView(d: DespesaMes) {
  return {
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
    fitid: d.fitid,
  };
}

// Quanto pago, clampado entre 0 e o valor devido (2 casas).
function clampPago(valorPago: number, valor: number): number {
  return Math.min(Math.max(round(valorPago), 0), round(valor));
}

function receitaView(r: {
  id: string;
  mes: string;
  descricao: string;
  valor: unknown;
  data: Date;
  recorrente: boolean;
  mesFim: string | null;
}) {
  return {
    id: r.id,
    mes: r.mes,
    descricao: r.descricao,
    valor: num(r.valor as never),
    data: isoDate(r.data),
    recorrente: r.recorrente,
    mesFim: r.mesFim,
  };
}

// 'YYYY-MM' − 1 mês (usado pelo "encerrar deste mês em diante").
function mesAnterior(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const orcamentoService = {
  // ── Despesas fixas ─────────────────────────────────────────────────────────
  async addDespesaFixa(userId: string, espacoId: string, dto: AddDespesaFixaDTO) {
    await espacoService.getOrThrow(userId, espacoId);
    await assertVinculos(userId, dto);
    const df = await orcamentoRepository.createDespesaFixa({
      espacoId,
      descricao: dto.descricao,
      valor: round(dto.valor),
      diaVencimento: dto.diaVencimento,
      ativa: true,
      categoriaId: dto.categoriaId ?? null,
      nota: dto.nota || null,
      ...parcelaWrite(dto, currentMonth()),
    });
    return fixaView(df);
  },

  async updateDespesaFixa(userId: string, espacoId: string, id: string, patch: UpdateDespesaFixaDTO) {
    const found = await orcamentoRepository.findDespesaFixa(id, userId);
    assertPertence(found, espacoId, "Despesa fixa", id);
    await assertVinculos(userId, patch);
    const data: Record<string, unknown> = {};
    if (patch.descricao !== undefined) data.descricao = patch.descricao;
    if (patch.valor !== undefined) data.valor = round(patch.valor);
    if (patch.diaVencimento !== undefined) data.diaVencimento = patch.diaVencimento;
    if (patch.ativa !== undefined) data.ativa = patch.ativa;
    if ("categoriaId" in patch) data.categoriaId = patch.categoriaId ?? null;
    if ("nota" in patch) data.nota = patch.nota || null;
    // parcela/cartão: só toca se algum campo veio no patch
    if ("cartaoId" in patch || "parcelado" in patch || "parcelaAtual" in patch || "totalParcelas" in patch) {
      // editar parcela = restabelecer a âncora pro mês corrente ("agora estou na parcela X")
      Object.assign(data, parcelaWrite({ ...found!, ...patch }, currentMonth()));
    }
    const df = await orcamentoRepository.updateDespesaFixa(id, data);
    return fixaView(df);
  },

  async toggleDespesaFixa(userId: string, espacoId: string, id: string) {
    const found = await orcamentoRepository.findDespesaFixa(id, userId);
    assertPertence(found, espacoId, "Despesa fixa", id);
    const df = await orcamentoRepository.updateDespesaFixa(id, { ativa: !found!.ativa });
    return fixaView(df);
  },

  async removeDespesaFixa(userId: string, espacoId: string, id: string) {
    const found = await orcamentoRepository.findDespesaFixa(id, userId);
    assertPertence(found, espacoId, "Despesa fixa", id);
    await orcamentoRepository.deleteDespesaFixa(id);
    return { id };
  },

  // Define quanto foi pago da fixa no mês `ym` (valor absoluto, não delta).
  //   <= 0      → remove o registro (nada pago)
  //   >= valor  → quitada (clampa no valor)
  //   intermed. → pagamento parcial
  async setPagamentoFixa(userId: string, espacoId: string, id: string, ym: string, valorPago: number) {
    const found = await orcamentoRepository.findDespesaFixa(id, userId);
    assertPertence(found, espacoId, "Despesa fixa", id);
    const valor = num(found!.valor);
    const pago = clampPago(valorPago, valor);
    if (pago <= 0) {
      const existing = await orcamentoRepository.findPagamentoFixa(id, ym);
      if (existing) await orcamentoRepository.deletePagamentoFixa(id, ym);
      return { despesaFixaId: id, ym, valorPago: 0, pago: false };
    }
    await orcamentoRepository.upsertPagamentoFixa(espacoId, id, ym, pago);
    return { despesaFixaId: id, ym, valorPago: pago, pago: pago >= valor };
  },

  // ── Despesas do mês ──────────────────────────────────────────────────────
  async addDespesaMes(userId: string, espacoId: string, dto: AddDespesaMesDTO) {
    await espacoService.getOrThrow(userId, espacoId);
    await assertVinculos(userId, dto);
    const dm = await orcamentoRepository.createDespesaMes({
      espacoId,
      mes: dto.mes,
      descricao: dto.descricao,
      valor: round(dto.valor),
      data: parseDate(dto.data || `${dto.mes}-01`),
      cartaoId: dto.cartaoId ?? null,
      categoriaId: dto.categoriaId ?? null,
      nota: dto.nota || null,
    });
    return mesView(dm);
  },

  async updateDespesaMes(userId: string, espacoId: string, id: string, patch: UpdateDespesaMesDTO) {
    const found = await orcamentoRepository.findDespesaMes(id, userId);
    assertPertence(found, espacoId, "Despesa do mês", id);
    assertDataNoMes(patch.data, found!.mes);
    await assertVinculos(userId, patch);
    const data: Record<string, unknown> = {};
    if (patch.descricao !== undefined) data.descricao = patch.descricao;
    if (patch.valor !== undefined) data.valor = round(patch.valor);
    if (patch.data !== undefined) data.data = parseDate(patch.data);
    if ("cartaoId" in patch) data.cartaoId = patch.cartaoId ?? null;
    if ("categoriaId" in patch) data.categoriaId = patch.categoriaId ?? null;
    if ("nota" in patch) data.nota = patch.nota || null;
    const dm = await orcamentoRepository.updateDespesaMes(id, data);
    return mesView(dm);
  },

  async removeDespesaMes(userId: string, espacoId: string, id: string) {
    const found = await orcamentoRepository.findDespesaMes(id, userId);
    assertPertence(found, espacoId, "Despesa do mês", id);
    await orcamentoRepository.deleteDespesaMes(id);
    return { id };
  },

  // Importa transações de um OFX como despesas do mês.
  //   - `fitid` que já existe no espaço é ignorado (reimportar o mesmo arquivo
  //     não duplica nada);
  //   - cartão e cada categoria distinta são validados como do dono UMA vez
  //     (um getOrThrow por id único, não por item);
  //   - insere tudo numa transação.
  async importDespesasMes(userId: string, espacoId: string, dto: ImportMesDTO) {
    await espacoService.getOrThrow(userId, espacoId);
    if (dto.cartaoId) await cartaoService.getOrThrow(userId, dto.cartaoId);
    const categorias = [...new Set(dto.itens.map((i) => i.categoriaId).filter(Boolean))] as string[];
    for (const id of categorias) await categoriaService.getOrThrow(userId, id);

    const fitids = dto.itens.map((i) => i.fitid).filter(Boolean) as string[];
    const jaTem = new Set(
      fitids.length > 0
        ? (await orcamentoRepository.fitidsExistentes(espacoId, fitids)).map((r) => r.fitid)
        : []
    );

    const ignoradas: { fitid: string; motivo: "duplicado" }[] = [];
    const novas = [];
    const vistos = new Set<string>();
    for (const item of dto.itens) {
      // duplicado pode estar no banco OU repetido dentro do próprio arquivo
      if (item.fitid && (jaTem.has(item.fitid) || vistos.has(item.fitid))) {
        ignoradas.push({ fitid: item.fitid, motivo: "duplicado" });
        continue;
      }
      if (item.fitid) vistos.add(item.fitid);
      novas.push({
        espacoId,
        mes: dto.mes,
        descricao: item.descricao,
        valor: round(item.valor),
        data: parseDate(item.data),
        cartaoId: dto.cartaoId ?? null,
        categoriaId: item.categoriaId ?? null,
        fitid: item.fitid ?? null,
      });
    }

    const criadas = novas.length > 0 ? await orcamentoRepository.createDespesasMes(novas) : [];
    return { criadas: criadas.map(mesView), ignoradas };
  },

  // Aplica uma operação em várias despesas do mês numa só requisição.
  //   pagar/despagar · excluir · categoria · cartao
  // Sem isso o front faria N requests (e N reloadCartoes) e poderia parar no meio.
  async bulkMes(userId: string, espacoId: string, dto: BulkMesDTO) {
    await espacoService.getOrThrow(userId, espacoId);
    const linhas = await orcamentoRepository.findDespesasMesByIds(dto.ids, userId, espacoId);
    assertLoteCompleto(linhas, dto.ids, "Despesa do mês");
    await assertVinculos(userId, dto);

    const ids = linhas.map((l) => l.id);
    if (dto.op === "excluir") {
      await orcamentoRepository.deleteManyDespesaMes(ids);
      return { op: dto.op, aplicadas: [], removidos: ids, ignoradas: 0 };
    }
    if (dto.op === "pagar") {
      await orcamentoRepository.pagarDespesasMes(linhas.map((l) => ({ id: l.id, valor: num(l.valor) })));
    } else if (dto.op === "despagar") {
      await orcamentoRepository.updateManyDespesaMes(ids, { valorPago: 0, paga: false });
    } else if (dto.op === "categoria") {
      await orcamentoRepository.updateManyDespesaMes(ids, { categoriaId: dto.categoriaId ?? null });
    } else {
      await orcamentoRepository.updateManyDespesaMes(ids, { cartaoId: dto.cartaoId ?? null });
    }
    const atualizadas = await orcamentoRepository.findDespesasMesByIds(ids, userId, espacoId);
    return { op: dto.op, aplicadas: atualizadas.map(mesView), removidos: [], ignoradas: 0 };
  },

  // Idem para as fixas. `ym` importa: pagar/despagar mexem no PagamentoFixa do
  // mês, e parcelada fora da janela do mês é ignorada (não há o que pagar).
  async bulkFixa(userId: string, espacoId: string, dto: BulkFixaDTO) {
    await espacoService.getOrThrow(userId, espacoId);
    const linhas = await orcamentoRepository.findDespesasFixasByIds(dto.ids, userId, espacoId);
    assertLoteCompleto(linhas, dto.ids, "Despesa fixa");
    await assertVinculos(userId, dto);

    const ids = linhas.map((l) => l.id);
    if (dto.op === "excluir") {
      await orcamentoRepository.deleteManyDespesaFixa(ids);
      return { op: dto.op, aplicadas: [], removidos: ids, ignoradas: 0, pagamentos: [] };
    }

    let ignoradas = 0;
    if (dto.op === "pagar" || dto.op === "despagar") {
      const noMes = linhas.filter((l) => parcelaAtivaNoMes(l, dto.ym));
      ignoradas = linhas.length - noMes.length;
      const idsNoMes = noMes.map((l) => l.id);
      if (dto.op === "pagar") {
        const aPagar = noMes
          .map((l) => ({ id: l.id, valorPago: num(l.valor) }))
          .filter((l) => l.valorPago > 0);
        ignoradas += idsNoMes.length - aPagar.length;
        if (aPagar.length > 0) await orcamentoRepository.upsertPagamentosFixas(espacoId, dto.ym, aPagar);
      } else if (idsNoMes.length > 0) {
        await orcamentoRepository.deletePagamentosFixas(idsNoMes, dto.ym);
      }
      const pagos = await orcamentoRepository.findPagamentosFixasByIds(ids, dto.ym);
      return {
        op: dto.op,
        aplicadas: linhas.filter((l) => idsNoMes.includes(l.id)).map(fixaView),
        removidos: [],
        ignoradas,
        // o front precisa do estado final do mês: quem saiu da lista foi desquitado
        pagamentos: pagos.map((p) => ({ despesaFixaId: p.despesaFixaId, ym: p.ym, valorPago: num(p.valorPago) })),
      };
    }

    if (dto.op === "categoria") {
      await orcamentoRepository.updateManyDespesaFixa(ids, { categoriaId: dto.categoriaId ?? null });
    } else if (dto.op === "cartao") {
      // tirar o cartão tira o parcelamento junto: parcela é do cartão nesse fluxo
      const data = dto.cartaoId
        ? { cartaoId: dto.cartaoId }
        : { cartaoId: null, parcelado: false, parcelaAtual: null, totalParcelas: null, parcelaMesRef: null };
      await orcamentoRepository.updateManyDespesaFixa(ids, data);
    } else {
      await orcamentoRepository.updateManyDespesaFixa(ids, { ativa: dto.op === "ativar" });
    }
    const atualizadas = await orcamentoRepository.findDespesasFixasByIds(ids, userId, espacoId);
    return { op: dto.op, aplicadas: atualizadas.map(fixaView), removidos: [], ignoradas: 0, pagamentos: [] };
  },

  // Define quanto foi pago de uma despesa do mês (valor absoluto). paga = pago >= valor.
  async setPagaMes(userId: string, espacoId: string, id: string, valorPago: number) {
    const found = await orcamentoRepository.findDespesaMes(id, userId);
    assertPertence(found, espacoId, "Despesa do mês", id);
    const valor = num(found!.valor);
    const pago = clampPago(valorPago, valor);
    const dm = await orcamentoRepository.updateDespesaMes(id, { valorPago: pago, paga: pago >= valor && valor > 0 });
    return mesView(dm);
  },

  // ── Receitas do mês ──────────────────────────────────────────────────────
  async addReceitaMes(userId: string, espacoId: string, dto: AddReceitaMesDTO) {
    await espacoService.getOrThrow(userId, espacoId);
    const rm = await orcamentoRepository.createReceitaMes({
      espacoId,
      mes: dto.mes,
      descricao: dto.descricao,
      valor: round(dto.valor),
      data: parseDate(dto.data || `${dto.mes}-01`),
      recorrente: dto.recorrente ?? false,
      mesFim: dto.recorrente ? dto.mesFim ?? null : null,
    });
    return receitaView(rm);
  },

  async updateReceitaMes(userId: string, espacoId: string, id: string, patch: UpdateReceitaMesDTO) {
    const found = await orcamentoRepository.findReceitaMes(id, userId);
    assertPertence(found, espacoId, "Receita do mês", id);
    assertDataNoMes(patch.data, found!.mes);
    const data: Record<string, unknown> = {};
    if (patch.descricao !== undefined) data.descricao = patch.descricao;
    if (patch.valor !== undefined) data.valor = round(patch.valor);
    if (patch.data !== undefined) data.data = parseDate(patch.data);
    if (patch.recorrente !== undefined) {
      data.recorrente = patch.recorrente;
      // deixar de repetir apaga a janela (senão sobraria um fim órfão)
      if (!patch.recorrente) data.mesFim = null;
    }
    if ("mesFim" in patch && patch.recorrente !== false) data.mesFim = patch.mesFim ?? null;
    const rm = await orcamentoRepository.updateReceitaMes(id, data);
    return receitaView(rm);
  },

  // Pula a recorrente só no mês `ym` (os outros meses seguem valendo).
  async skipReceitaMes(userId: string, espacoId: string, id: string, ym: string) {
    const found = await orcamentoRepository.findReceitaMes(id, userId);
    assertPertence(found, espacoId, "Receita do mês", id);
    if (!found!.recorrente) throw new AppError("Só receita recorrente pode ser pulada num mês", 422);
    await orcamentoRepository.upsertSkipReceita(id, ym);
    return { receitaId: id, ym };
  },

  async unskipReceitaMes(userId: string, espacoId: string, id: string, ym: string) {
    const found = await orcamentoRepository.findReceitaMes(id, userId);
    assertPertence(found, espacoId, "Receita do mês", id);
    await orcamentoRepository.deleteSkipReceita(id, ym);
    return { receitaId: id, ym };
  },

  // "Deste mês em diante não recebo mais": fecha a janela no mês anterior a `ym`.
  // Se `ym` é a própria âncora, a recorrência deixa de existir (nada a manter).
  async encerrarReceitaMes(userId: string, espacoId: string, id: string, ym: string) {
    const found = await orcamentoRepository.findReceitaMes(id, userId);
    assertPertence(found, espacoId, "Receita do mês", id);
    if (!found!.recorrente) throw new AppError("Só receita recorrente pode ser encerrada", 422);
    if (ym <= found!.mes) {
      const rm = await orcamentoRepository.updateReceitaMes(id, { recorrente: false, mesFim: null });
      return receitaView(rm);
    }
    const rm = await orcamentoRepository.updateReceitaMes(id, { mesFim: mesAnterior(ym) });
    return receitaView(rm);
  },

  async removeReceitaMes(userId: string, espacoId: string, id: string) {
    const found = await orcamentoRepository.findReceitaMes(id, userId);
    assertPertence(found, espacoId, "Receita do mês", id);
    await orcamentoRepository.deleteReceitaMes(id);
    return { id };
  },

  // ── Renda mensal ─────────────────────────────────────────────────────────
  async setRenda(userId: string, espacoId: string, ym: string, valor: number) {
    await espacoService.getOrThrow(userId, espacoId);
    const r = await orcamentoRepository.upsertRenda(espacoId, ym, round(valor));
    return { ym: r.ym, valor: num(r.valor) };
  },

  // Remove o override do mês → o mês passa a herdar o salário fixo do espaço.
  async clearRenda(userId: string, espacoId: string, ym: string) {
    await espacoService.getOrThrow(userId, espacoId);
    await orcamentoRepository.deleteRenda(espacoId, ym);
    return { ym };
  },
};
