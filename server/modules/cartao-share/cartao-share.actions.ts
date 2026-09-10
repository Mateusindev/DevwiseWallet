"use server";

// Server Functions do compartilhamento — o módulo mais novo e o mais complexo
// (24 rotas). Aqui também vivem as duas leituras colapsadas (4.2 e 4.3): eram
// Promise.all no componente, e o dispatcher de Server Actions é serial por
// cliente, então elas viravam N chamadas em fila.
import { acao, acaoValidada, erroDaAction, type ActionResult } from "@/server/next/action";
import { requireAnyPerm } from "@/server/next/session";
import { authService } from "@/server/auth/auth.service";
import { AppError } from "@/server/lib/errors";
import { cartaoShareService } from "./cartao-share.service";
import { cartaoService } from "../cartao/cartao.service";
import {
  createContatoSchema,
  updateContatoSchema,
  createShareSchema,
  updateShareSchema,
  rateioSchema,
  rateioQuerySchema,
  conviteSchema,
  adotarSchema,
  adiantarSchema,
  desfazerAdocaoSchema,
  shareQuerySchema,
} from "./cartao-share.dto";

// Mesmos conjuntos do arquivo de rotas: `cartao:share` / `cartao:view_shared`
// são os aliases históricos, que seguem abrindo a porta enquanto as roles
// migram pras permissions de `share:`.
const GERIR = ["share:manage", "cartao:share"];
const AGENDA = ["contato:manage", "share:manage", "cartao:share"];
const VER_DEVIDO = ["share:view_shared", "cartao:view_shared"];
const ADOTAR = ["share:adotar", "share:view_shared", "cartao:view_shared"];

// ── Contatos (agenda do dono) ────────────────────────────────────────────────

export async function listarContatos() {
  return acao(AGENDA, (user) => cartaoShareService.listContatos(user.id));
}

export async function criarContato(input: unknown) {
  return acaoValidada(AGENDA, createContatoSchema, input, (user, dto) =>
    cartaoShareService.createContato(user.id, dto)
  );
}

export async function atualizarContato(id: string, input: unknown) {
  return acaoValidada(AGENDA, updateContatoSchema, input, (user, dto) =>
    cartaoShareService.updateContato(user.id, id, dto)
  );
}

export async function removerContato(id: string) {
  return acao(AGENDA, (user) => cartaoShareService.removeContato(user.id, id));
}

// Sem infra de email: o retorno traz o token e o link pra UI copiar.
export async function criarConvite(contatoId: string, input: unknown) {
  return acaoValidada(AGENDA, conviteSchema, input, (user, dto) =>
    cartaoShareService.criarConvite(user.id, contatoId, dto)
  );
}

// ── Shares (lado do dono) ────────────────────────────────────────────────────

export async function listarSharesDoCartao(cartaoId: string, ym?: string) {
  return acaoValidada(GERIR, shareQuerySchema, { ym }, (user, q) =>
    cartaoShareService.listByCartao(user.id, cartaoId, q.ym)
  );
}

// `cartaoId` é o atalho histórico da URL: vira o cartão do share avulso, e o
// modo `linha` o ignora (lá o cartão é derivado da despesa apontada).
export async function criarShare(input: unknown, cartaoId?: string) {
  return acaoValidada(GERIR, createShareSchema, input, (user, dto) =>
    cartaoShareService.createShare(user.id, dto, cartaoId)
  );
}

export async function atualizarShare(id: string, input: unknown) {
  return acaoValidada(GERIR, updateShareSchema, input, (user, dto) =>
    cartaoShareService.updateShare(user.id, id, dto)
  );
}

export async function removerShare(id: string) {
  return acao(GERIR, (user) => cartaoShareService.removeShare(user.id, id));
}

// Rateio N-a-N de uma linha: substitui o conjunto inteiro numa transação.
export async function salvarRateioDaLinha(input: unknown, ym?: string) {
  return acaoValidada(GERIR, rateioSchema, input, (user, dto) =>
    cartaoShareService.salvarRateio(user.id, dto, shareQuerySchema.parse({ ym }).ym)
  );
}

export async function lerRateioDaLinha(ref: { despesaFixaId?: string; despesaMesId?: string }, ym?: string) {
  return acaoValidada(GERIR, rateioQuerySchema, { ...ref, ym }, (user, q) => {
    const { ym: mes, ...linha } = q;
    return cartaoShareService.rateioDaLinha(user.id, linha, mes);
  });
}

// ── Convites (quem recebe) ───────────────────────────────────────────────────

export async function listarMeusConvites() {
  return acao(VER_DEVIDO, (user) => cartaoShareService.meusConvites(user));
}

export async function lerConvitePorToken(token: string) {
  return acao(VER_DEVIDO, (user) => cartaoShareService.convitePorToken(user, token));
}

export async function aceitarConvite(id: string) {
  return acao(VER_DEVIDO, (user) => cartaoShareService.aceitarConvite(user, id));
}

export async function recusarConvite(id: string) {
  return acao(VER_DEVIDO, (user) => cartaoShareService.recusarConvite(user, id));
}

// ── "O que devo" ─────────────────────────────────────────────────────────────

export async function listarMeusCompartilhamentos(ym?: string) {
  return acaoValidada(VER_DEVIDO, shareQuerySchema, { ym }, (user, q) =>
    cartaoShareService.meusCompartilhamentos(user, q.ym)
  );
}

export async function adotarShare(shareId: string, input: unknown) {
  return acaoValidada(ADOTAR, adotarSchema, input, (user, dto) =>
    cartaoShareService.adotar(user, shareId, dto)
  );
}

export async function ignorarShare(shareId: string, ym?: string) {
  return acaoValidada(ADOTAR, shareQuerySchema, { ym }, (user, q) =>
    cartaoShareService.ignorar(user, shareId, q.ym)
  );
}

export async function desfazerAdocao(shareId: string, removerDespesa?: boolean) {
  return acaoValidada(ADOTAR, desfazerAdocaoSchema, { removerDespesa }, (user, q) =>
    cartaoShareService.desfazerAdocao(user, shareId, q.removerDespesa)
  );
}

export async function adiantarShare(shareId: string, input: unknown) {
  return acaoValidada(ADOTAR, adiantarSchema, input, (user, dto) =>
    cartaoShareService.adiantar(user, shareId, dto)
  );
}

export async function sincronizarShare(shareId: string, ym?: string) {
  return acaoValidada(ADOTAR, shareQuerySchema, { ym }, (user, q) =>
    cartaoShareService.sincronizar(user, shareId, q.ym)
  );
}

// ── Leituras colapsadas (4.2 e 4.3) ──────────────────────────────────────────

// Modal de rateio: contatos + rateio atual da linha. Era Promise.all no
// componente (`Compartilhamento.jsx`).
export async function abrirRateio(
  ref: { despesaFixaId?: string; despesaMesId?: string },
  ym?: string
) {
  return acaoValidada(GERIR, rateioQuerySchema, { ...ref, ym }, async (user, q) => {
    const { ym: mes, ...linha } = q;
    const [contatos, rateio] = await Promise.all([
      cartaoShareService.listContatos(user.id),
      cartaoShareService.rateioDaLinha(user.id, linha, mes),
    ]);
    return { contatos, rateio };
  });
}

// Painel de compartilhamento de um cartão: contatos + linhas da fatura +
// shares. As três leituras exigiam permissions diferentes, então as duas são
// checadas aqui — `requireAnyPerm` sozinho seria "basta uma".
export async function painelDoCartao(
  cartaoId: string,
  ym?: string
): Promise<
  ActionResult<{
    contatos: Awaited<ReturnType<typeof cartaoShareService.listContatos>>;
    linhas: Awaited<ReturnType<typeof cartaoService.faturaLinhas>>;
    shares: Awaited<ReturnType<typeof cartaoShareService.listByCartao>>;
  }>
> {
  try {
    const user = await requireAnyPerm(...GERIR);
    if (!(await authService.can(user, "cartao:view"))) {
      throw new AppError("Sem permissão: cartao:view", 403);
    }
    const { ym: mes } = shareQuerySchema.parse({ ym });
    const [contatos, linhas, shares] = await Promise.all([
      cartaoShareService.listContatos(user.id),
      cartaoService.faturaLinhas(user.id, cartaoId, mes),
      cartaoShareService.listByCartao(user.id, cartaoId, mes),
    ]);
    return { ok: true, data: { contatos, linhas, shares } };
  } catch (err) {
    return erroDaAction(err);
  }
}
