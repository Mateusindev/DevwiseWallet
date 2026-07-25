import { caixinhaService } from "../caixinha/caixinha.service";
import { movimentacaoService } from "../movimentacao/movimentacao.service";
import { espacoService } from "../espaco/espaco.service";
import { cartaoService } from "../cartao/cartao.service";
import { categoriaService } from "../categoria/categoria.service";

// GET /state — estado inicial completo do usuário logado.
export async function getState(userId: string) {
  // Garante espaço + categorias padrão pra quem ainda não tem nada (conta nova).
  // Caixinhas começam vazias — o usuário cria (inclui a reserva de emergência).
  await espacoService.ensureDefaults(userId);
  await categoriaService.ensureDefaults(userId);

  const [caixinhas, movimentacoes, { espacos, activeEspacoId, espacosOcultos }, cartoes, categorias] =
    await Promise.all([
      caixinhaService.list(userId),
      movimentacaoService.list(userId),
      espacoService.listWithActive(userId),
      cartaoService.listWithAggregates(userId),
      categoriaService.list(userId),
    ]);

  const orcamento = activeEspacoId ? await espacoService.getOrcamento(userId, activeEspacoId) : null;

  return { caixinhas, movimentacoes, espacos, activeEspacoId, espacosOcultos, cartoes, categorias, orcamento };
}
