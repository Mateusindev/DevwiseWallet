import { caixinhaService } from "../caixinha/caixinha.service";
import { movimentacaoService } from "../movimentacao/movimentacao.service";
import { espacoService } from "../espaco/espaco.service";
import { cartaoService } from "../cartao/cartao.service";
import { categoriaService } from "../categoria/categoria.service";

// GET /state — estado inicial completo do usuário logado. `ym` centra a janela
// de histórico do orçamento (ver espacoService.getOrcamento).
//
// Custo: DUAS levas de queries paralelas (a segunda só porque o orçamento
// depende de saber qual é o espaço ativo). O que importa aqui não é o número de
// queries, é o número de idas ao banco EM SÉRIE: com o banco fora da máquina
// cada ida custa uma volta de rede inteira, e o boot fazia ~10 delas.
export async function getState(userId: string, ym?: string) {
  const tudo = () =>
    Promise.all([
      caixinhaService.list(userId),
      movimentacaoService.list(userId),
      espacoService.listWithActive(userId),
      cartaoService.listWithAggregates(userId, ym),
      categoriaService.list(userId),
    ]);

  let [caixinhas, movimentacoes, doUsuario, cartoes, categorias] = await tudo();

  // Provisionamento da conta nova (espaço + categorias padrão), idempotente.
  // Era um `count` de cada antes de tudo, em série, em TODO boot — agora a
  // própria leitura diz se falta algo e só a conta vazia paga a escrita (e a
  // releitura, que é UMA leva paralela).
  // Caixinhas continuam começando vazias: o usuário cria.
  if (doUsuario.espacos.length === 0 || categorias.length === 0) {
    await Promise.all([
      doUsuario.espacos.length === 0 ? espacoService.ensureDefaults(userId) : null,
      categorias.length === 0 ? categoriaService.ensureDefaults(userId) : null,
    ]);
    [caixinhas, movimentacoes, doUsuario, cartoes, categorias] = await tudo();
  }

  const { espacos, activeEspacoId, espacosOcultos } = doUsuario;
  const orcamento = activeEspacoId
    ? await espacoService.getOrcamento(userId, activeEspacoId, ym)
    : null;

  // `userId` volta no payload porque o boot pode chegar pronto do servidor
  // (RSC): o FinanceProvider precisa saber se aquele estado é da sessão atual
  // antes de adotá-lo — logout e login com outra conta reaproveitariam a mesma
  // Promise.
  return { userId, caixinhas, movimentacoes, espacos, activeEspacoId, espacosOcultos, cartoes, categorias, orcamento };
}
