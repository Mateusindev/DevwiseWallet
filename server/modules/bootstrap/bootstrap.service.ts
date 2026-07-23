import { caixinhaService } from "../caixinha/caixinha.service";
import { movimentacaoService } from "../movimentacao/movimentacao.service";
import { espacoService } from "../espaco/espaco.service";
import { cartaoService } from "../cartao/cartao.service";
import { categoriaService } from "../categoria/categoria.service";

// GET /state — estado inicial completo (espelha getBootstrap() do mock).
export async function getState() {
  // Garante espaço + categorias padrão numa base vazia antes de montar o estado.
  // Caixinhas começam vazias — o usuário cria (inclui a reserva de emergência).
  await espacoService.ensureDefaults();
  await categoriaService.ensureDefaults();

  const [caixinhas, movimentacoes, { espacos, activeEspacoId, espacosOcultos }, cartoes, categorias] =
    await Promise.all([
      caixinhaService.list(),
      movimentacaoService.list(),
      espacoService.listWithActive(),
      cartaoService.listWithAggregates(),
      categoriaService.list(),
    ]);

  const orcamento = activeEspacoId ? await espacoService.getOrcamento(activeEspacoId) : null;

  return { caixinhas, movimentacoes, espacos, activeEspacoId, espacosOcultos, cartoes, categorias, orcamento };
}
