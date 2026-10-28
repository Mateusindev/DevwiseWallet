// ── Finance API (Hono RPC) ──────────────────────────────────────────────
// Single seam entre UI e dados. Mesmas funções/shapes de sempre, mas por
// baixo usa o client tipado do Hono (hc) — rota, método e payload conferidos
// pelo TypeScript contra o AppType exportado pela rota catch-all.
import { hc } from "hono/client";
import type { InferRequestType } from "hono/client";
import type { z } from "zod";
import type { AppType } from "@/app/api/[[...route]]/route";
import type { ActionResult } from "@/server/next/action";
import { entrar, cadastrar, sair, usuarioLogado } from "@/server/auth/auth.actions";
import { estadoInicial } from "@/server/modules/bootstrap/bootstrap.actions";
import {
  listarCategorias,
  criarCategoria,
  atualizarCategoria,
  removerCategoria,
} from "@/server/modules/categoria/categoria.actions";
import type {
  createCategoriaSchema,
  updateCategoriaSchema,
} from "@/server/modules/categoria/categoria.dto";
import {
  criarCaixinha,
  atualizarCaixinha,
  removerCaixinha,
} from "@/server/modules/caixinha/caixinha.actions";
import type {
  createCaixinhaSchema,
  updateCaixinhaSchema,
} from "@/server/modules/caixinha/caixinha.dto";
import { criarMovimentacao, removerMovimentacao } from "@/server/modules/movimentacao/movimentacao.actions";
import { resetarDados } from "@/server/modules/dev/dev.actions";
import {
  listarEspacos,
  resumoDoMes,
  orcamentoDoEspaco,
  definirEspacoAtivo,
  criarEspaco,
  atualizarEspaco,
  removerEspaco,
  ocultarEspacoNoMes,
  restaurarEspacoNoMes,
} from "@/server/modules/espaco/espaco.actions";
import type { createEspacoSchema } from "@/server/modules/espaco/espaco.dto";
import {
  listarCartoes,
  listarParceladas,
  resumoDeCartoes,
  linhasDaFatura,
  criarCartao,
  atualizarCartao,
  removerCartao,
} from "@/server/modules/cartao/cartao.actions";
import type { createCartaoSchema, updateCartaoSchema } from "@/server/modules/cartao/cartao.dto";
import {
  bootstrapAdmin,
  listarUsuarios,
  criarUsuario,
  atualizarUsuario,
  removerUsuario,
  listarRoles,
  criarRole,
  atualizarRole,
  removerRole,
  listarPermissions,
} from "@/server/modules/admin/admin.actions";
import type {
  createUserSchema,
  updateUserSchema,
  createRoleSchema,
  updateRoleSchema,
} from "@/server/modules/admin/admin.dto";
import {
  criarDespesaFixa,
  atualizarDespesaFixa,
  alternarDespesaFixa,
  removerDespesaFixa,
  definirPagamentoFixa,
  loteDeFixas,
  definirRendaDoMes,
  limparRendaDoMes,
  criarDespesaMes,
  atualizarDespesaMes,
  removerDespesaMes,
  definirPagoDaDespesaMes,
  loteDeDespesasMes,
  criarReceitaMes,
  atualizarReceitaMes,
  removerReceitaMes,
  pularReceitaNoMes,
  desfazerPuloDaReceita,
  encerrarReceitaNoMes,
} from "@/server/modules/orcamento/orcamento.actions";
import type {
  addDespesaFixaSchema,
  updateDespesaFixaSchema,
  addDespesaMesSchema,
  updateDespesaMesSchema,
  addReceitaMesSchema,
  updateReceitaMesSchema,
  bulkFixaSchema,
  bulkMesSchema,
} from "@/server/modules/orcamento/orcamento.dto";
import {
  listarContatos,
  criarContato,
  atualizarContato,
  removerContato,
  criarConvite as criarConviteAction,
  listarSharesDoCartao,
  criarShare,
  atualizarShare,
  removerShare,
  salvarRateioDaLinha,
  lerRateioDaLinha,
  listarMeusConvites,
  lerConvitePorToken,
  aceitarConvite as aceitarConviteAction,
  recusarConvite as recusarConviteAction,
  listarMeusCompartilhamentos,
  adotarShare as adotarShareAction,
  ignorarShare as ignorarShareAction,
  desfazerAdocao as desfazerAdocaoAction,
  adiantarShare as adiantarShareAction,
  sincronizarShare as sincronizarShareAction,
  abrirRateio,
  painelDoCartao,
} from "@/server/modules/cartao-share/cartao-share.actions";
import type {
  createContatoSchema,
  updateContatoSchema,
  createShareSchema,
  updateShareSchema,
  rateioSchema,
  conviteSchema,
  adotarSchema,
  adiantarSchema,
} from "@/server/modules/cartao-share/cartao-share.dto";

const client = hc<AppType>("/");

// Corpo (json) esperado por um endpoint, inferido do próprio client.
type Body<T> = InferRequestType<T> extends { json: infer J } ? J : never;

// `ApiError` mora em arquivo próprio: a leitura direta (`leituraDireta.ts`)
// também lança, e importar daqui fecharia ciclo.
import { ApiError } from "./apiError";
import {
  getBootstrapDireto,
  getOrcamentoDireto,
  getResumoEspacosDireto,
  getResumoCartoesDireto,
  getCartoesDireto,
  getParceladasDireto,
  getFaturaLinhasDireto,
} from "./leituraDireta";
import { esquecerToken } from "@/lib/supabase";
export { ApiError };

// Leitura quente: direto do Supabase quando este ambiente/usuário permite
// (`leituraDireta.ts` devolve null quando não), senão pela Server Action. O
// shape é o mesmo nos dois caminhos — quem chama não sabe de onde veio.
async function diretoOuAction<T>(direto: () => Promise<T | null>, action: () => Promise<T>): Promise<T> {
  return (await direto()) ?? action();
}

// Server Function: o resultado é discriminado (não há status HTTP), então o
// ApiError é reconstruído aqui — `useFormState` continua vendo `issues` no 422.
function unwrapAction<T>(r: ActionResult<T>): T {
  if (r.ok) return r.data;
  throw new ApiError(r.error, r.status, r.issues);
}

// ── Cache de leitura ────────────────────────────────────────────────────────
// O dispatcher de Server Actions do Next é SERIAL por cliente: duas leituras
// disparadas juntas viram fila, e cada uma custa uma volta de rede até o banco.
// Sem cache, trocar de aba remontava os componentes e refazia tudo do zero —
// era o "toda tela demora" que se sentia no app.
//
// `ler` dedupa chamada idêntica em voo e reaproveita o resultado por
// TTL_LEITURA_MS. Não é cache de verdade: toda mutação chama
// `invalidarLeituras()` (o wrapper das actions do FinanceContext faz isso pra
// todas de uma vez), então a janela serve pra matar rajada de request, não pra
// servir dado velho.
const TTL_LEITURA_MS = 20_000;
const leituras = new Map<string, { em: number; p: Promise<unknown> }>();

export function invalidarLeituras() {
  leituras.clear();
}

// Escrita: desfaz o cache de leitura. Fica AQUI, no seam, e não em cada tela —
// é o que garante que nenhuma mutação nova esqueça de invalidar.
async function mutar<T>(p: Promise<ActionResult<T>>): Promise<T> {
  try {
    return unwrapAction(await p);
  } finally {
    invalidarLeituras();
  }
}

function ler<T>(chave: string, fn: () => Promise<T>): Promise<T> {
  const atual = leituras.get(chave);
  if (atual && Date.now() - atual.em < TTL_LEITURA_MS) return atual.p as Promise<T>;
  // erro não fica em cache: a próxima tentativa tem que ir no servidor de novo
  const p = fn().catch((e) => {
    if (leituras.get(chave)?.p === p) leituras.delete(chave);
    throw e;
  });
  leituras.set(chave, { em: Date.now(), p });
  return p;
}

// Resposta do hc: propaga mensagem de erro do back-end, devolve JSON tipado.
async function unwrap<
  R extends { ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }
>(p: Promise<R>): Promise<Awaited<ReturnType<R["json"]>>> {
  const res = await p;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, data?.issues);
  }
  return data;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
// JWT fica em cookie httpOnly — o front nunca vê o token, só o AuthUser.
export type AuthUser = Awaited<ReturnType<typeof login>>;

// Token de leitura direta é por usuário: login novo nunca herda o anterior.
export async function login(email: string, senha: string) {
  esquecerToken();
  return mutar(entrar({ email, senha }));
}

export async function register(nome: string, email: string, senha: string) {
  esquecerToken();
  return mutar(cadastrar({ nome, email, senha }));
}

export async function logout() {
  esquecerToken();
  return mutar(sair());
}

// null = sem sessão; componente decide mostrar login.
export async function me() {
  return unwrapAction(await usuarioLogado());
}

// ── Admin: usuários e roles (PBAC: user:* / role:*) ──────────────────────────
export type AdminUserView = Awaited<ReturnType<typeof listUsers>>[number];
export type AdminRoleView = Awaited<ReturnType<typeof listRoles>>[number];

// Tela inteira numa chamada: users + roles + catálogo de permissions, com o
// Promise.all rodando no servidor (o dispatcher do cliente é sequencial).
export async function getAdminBootstrap() {
  return ler(`admin:bootstrap`, async () => unwrapAction(await bootstrapAdmin()));
}

export async function listUsers() {
  return unwrapAction(await listarUsuarios());
}

export async function createUser(dto: z.input<typeof createUserSchema>) {
  return mutar(criarUsuario(dto));
}

export async function updateUser(id: string, patch: z.input<typeof updateUserSchema>) {
  return mutar(atualizarUsuario(id, patch));
}

export async function deleteUser(id: string) {
  return mutar(removerUsuario(id));
}

export async function listRoles() {
  return unwrapAction(await listarRoles());
}

export async function createRole(dto: z.input<typeof createRoleSchema>) {
  return mutar(criarRole(dto));
}

export async function updateRole(id: string, patch: z.input<typeof updateRoleSchema>) {
  return mutar(atualizarRole(id, patch));
}

export async function deleteRole(id: string) {
  return mutar(removerRole(id));
}

export async function listPermissions() {
  return unwrapAction(await listarPermissions());
}

// ── Boot ─────────────────────────────────────────────────────────────────────
// `ym` centra a janela de histórico do orçamento que vem embutido. No boot
// servido isso já vem pronto do RSC; aqui é o caminho do refresh.
export async function getBootstrap(ym?: string) {
  return diretoOuAction(
    () => getBootstrapDireto(ym),
    async () => unwrapAction(await estadoInicial(ym))
  );
}

// ── Caixinhas / movimentações (da conta, não por espaço) ─────────────────────
export async function addAporte({
  caixinhaId,
  valor,
  descricao,
  data,
}: {
  caixinhaId: string;
  valor: number;
  descricao?: string;
  data?: string;
}) {
  return mutar(criarMovimentacao({ caixinhaId, tipo: "aporte", valor, descricao, data }));
}

export async function addDespesaVariavel({
  caixinhaId,
  valor,
  descricao,
  data,
}: {
  caixinhaId: string;
  valor: number;
  descricao?: string;
  data?: string;
}) {
  return mutar(criarMovimentacao({ caixinhaId, tipo: "despesa", valor, descricao, data }));
}

export async function removeMovimentacao(id: string) {
  return mutar(removerMovimentacao(id));
}

export async function addCaixinha(dto: z.input<typeof createCaixinhaSchema>) {
  return mutar(criarCaixinha(dto));
}

export async function updateCaixinha(id: string, patch: z.input<typeof updateCaixinhaSchema>) {
  return mutar(atualizarCaixinha(id, patch));
}

export async function removeCaixinha(id: string) {
  return mutar(removerCaixinha(id));
}

// ── Espaços de despesa ────────────────────────────────────────────────────────
export async function getEspacos() {
  return unwrapAction(await listarEspacos());
}

export async function setActiveEspaco(id: string) {
  return mutar(definirEspacoAtivo({ id }));
}

export async function addEspaco(dto: z.input<typeof createEspacoSchema>) {
  return mutar(criarEspaco(dto));
}

export async function renameEspaco(id: string, nome: string) {
  return mutar(atualizarEspaco(id, { nome }));
}

export async function removeEspaco(id: string) {
  return mutar(removerEspaco(id));
}

// Traz o orçamento numa janela de meses ao redor de `ym` (o payload devolve
// `janela` — quem consome refaz a busca quando o mês visto sai dela).
export async function getOrcamento(espacoId: string, ym?: string) {
  return ler(`orcamento:${espacoId}:${ym ?? ""}`, () =>
    diretoOuAction(
      () => getOrcamentoDireto(espacoId, ym),
      async () => unwrapAction(await orcamentoDoEspaco(espacoId, ym))
    )
  );
}

// Gasto do mês por espaço — base do gráfico "por página" do Início.
export async function getResumoEspacos(ym?: string) {
  return ler(`resumoEspacos:${ym ?? ""}`, () =>
    diretoOuAction(() => getResumoEspacosDireto(ym), async () => unwrapAction(await resumoDoMes(ym)))
  );
}

// Oculta / restaura o espaço só no mês ym (exclusão reversível daquele mês).
export async function ocultarEspacoMes(id: string, ym: string) {
  return mutar(ocultarEspacoNoMes(id, ym));
}

export async function restaurarEspacoMes(id: string, ym: string) {
  return mutar(restaurarEspacoNoMes(id, ym));
}

// Resumo da fatura mês a mês (por cartão e por categoria) — base dos gráficos.
export async function getResumoCartoes(de?: string, ate?: string) {
  return ler(`resumoCartoes:${de ?? ""}:${ate ?? ""}`, () =>
    diretoOuAction(() => getResumoCartoesDireto(de, ate), async () => unwrapAction(await resumoDeCartoes(de, ate)))
  );
}

// ── Despesas fixas (por espaço) ──────────────────────────────────────────────
export async function addDespesaFixa(espacoId: string, dto: z.input<typeof addDespesaFixaSchema>) {
  return mutar(criarDespesaFixa(espacoId, dto));
}

export async function toggleDespesaFixa(espacoId: string, id: string) {
  return mutar(alternarDespesaFixa(espacoId, id));
}

export async function updateDespesaFixa(espacoId: string, id: string, patch: z.input<typeof updateDespesaFixaSchema>) {
  return mutar(atualizarDespesaFixa(espacoId, id, patch));
}

export async function removeDespesaFixa(espacoId: string, id: string) {
  return mutar(removerDespesaFixa(espacoId, id));
}

// Define quanto pago da fixa no mês ym (valor absoluto) -> { despesaFixaId, ym, valorPago, pago }.
export async function setPagamentoFixa(espacoId: string, id: string, ym: string, valorPago: number) {
  return mutar(definirPagamentoFixa(espacoId, id, ym, valorPago));
}

// Ação em lote nas fixas: pagar/despagar (no mês `ym`), excluir, categoria,
// cartão, ativar/pausar. Uma requisição, transação no back.
export async function bulkDespesasFixas(espacoId: string, dto: z.input<typeof bulkFixaSchema>) {
  return mutar(loteDeFixas(espacoId, dto));
}

// Receita recorrente: pular um mês, desfazer o pulo e encerrar daquele mês em diante.
export async function skipReceitaMes(espacoId: string, id: string, ym: string) {
  return mutar(pularReceitaNoMes(espacoId, id, ym));
}

export async function unskipReceitaMes(espacoId: string, id: string, ym: string) {
  return mutar(desfazerPuloDaReceita(espacoId, id, ym));
}

export async function encerrarReceitaMes(espacoId: string, id: string, ym: string) {
  return mutar(encerrarReceitaNoMes(espacoId, id, ym));
}

// ── Renda do mês (por espaço) ─────────────────────────────────────────────────
export async function setRendaMes(espacoId: string, ym: string, valor: number) {
  return mutar(definirRendaDoMes(espacoId, ym, valor));
}

// Remove o override do mês → volta a herdar o salário fixo do espaço.
export async function clearRendaMes(espacoId: string, ym: string) {
  return mutar(limparRendaDoMes(espacoId, ym));
}

// Salário fixo mensal = default do espaço (RendaMensal cai como fallback).
export async function setRendaFixa(espacoId: string, rendaMensal: number) {
  return mutar(atualizarEspaco(espacoId, { rendaMensal }));
}

// ── Despesas do mês (por espaço) ──────────────────────────────────────────────
export async function addDespesaMes(espacoId: string, dto: z.input<typeof addDespesaMesSchema>) {
  return mutar(criarDespesaMes(espacoId, dto));
}

export async function updateDespesaMes(espacoId: string, id: string, patch: z.input<typeof updateDespesaMesSchema>) {
  return mutar(atualizarDespesaMes(espacoId, id, patch));
}

export async function removeDespesaMes(espacoId: string, id: string) {
  return mutar(removerDespesaMes(espacoId, id));
}

// Import de OFX: cria as despesas do mês e devolve o que foi ignorado por fitid
// repetido.
export async function importDespesasMes(espacoId: string, dto: Body<(typeof client.api.despesas.espacos)[":esp"]["mes"]["import"]["$post"]>) {
  // única rota que não é action (payload passa do cap de 1MB) — invalida na mão
  invalidarLeituras();
  return unwrap(
    client.api.despesas.espacos[":esp"].mes.import.$post({ param: { esp: espacoId }, json: dto })
  );
}

// Ação em lote nas despesas do mês: pagar/despagar, excluir, categoria, cartão.
export async function bulkDespesasMes(espacoId: string, dto: z.input<typeof bulkMesSchema>) {
  return mutar(loteDeDespesasMes(espacoId, dto));
}

// Define quanto pago de uma despesa do mês (valor absoluto) -> despesa atualizada.
export async function setPagaMes(espacoId: string, id: string, valorPago: number) {
  return mutar(definirPagoDaDespesaMes(espacoId, id, valorPago));
}

// ── Receitas do mês (dinheiro extra por fora, por espaço) ─────────────────────
export async function addReceitaMes(espacoId: string, dto: z.input<typeof addReceitaMesSchema>) {
  return mutar(criarReceitaMes(espacoId, dto));
}

export async function updateReceitaMes(espacoId: string, id: string, patch: z.input<typeof updateReceitaMesSchema>) {
  return mutar(atualizarReceitaMes(espacoId, id, patch));
}

export async function removeReceitaMes(espacoId: string, id: string) {
  return mutar(removerReceitaMes(espacoId, id));
}

// ── Cartões de crédito (da conta, não por espaço) ────────────────────────────
export async function getCartoes(ym?: string) {
  return ler(`cartoes:${ym ?? ""}`, () =>
    diretoOuAction(() => getCartoesDireto(ym), async () => unwrapAction(await listarCartoes(ym)))
  );
}

export async function addCartao(dto: z.input<typeof createCartaoSchema>) {
  return mutar(criarCartao(dto));
}

export async function updateCartao(id: string, patch: z.input<typeof updateCartaoSchema>) {
  return mutar(atualizarCartao(id, patch));
}

export async function removeCartao(id: string) {
  return mutar(removerCartao(id));
}

// Parceladas em aberto da conta (todos os espaços) + pagamentos do mês.
// Base do painel de quitação na aba de cartões.
export async function getParceladas(ym?: string) {
  return ler(`parceladas:${ym ?? ""}`, () =>
    diretoOuAction(() => getParceladasDireto(ym), async () => unwrapAction(await listarParceladas(ym)))
  );
}

// Linhas da fatura de um cartão num mês (pra escolher qual compartilhar).
export async function getFaturaLinhas(cartaoId: string, ym?: string) {
  return ler(`faturaLinhas:${cartaoId}:${ym ?? ""}`, () =>
    diretoOuAction(
      () => getFaturaLinhasDireto(cartaoId, ym),
      async () => unwrapAction(await linhasDaFatura(cartaoId, ym))
    )
  );
}

// ── Compartilhamento (contatos + shares + convites + adoção) ─────────────────
export type ContatoView = Awaited<ReturnType<typeof getContatos>>[number];
export type CartaoShareView = Awaited<ReturnType<typeof getCartaoShares>>[number];
export type MeusCompartilhamentos = Awaited<ReturnType<typeof getMeusCompartilhamentos>>;
export type MeuCompartilhamento = MeusCompartilhamentos["donos"][number];
export type GrupoDevido = MeuCompartilhamento["grupos"][number];
export type LinhaDevida = GrupoDevido["linhas"][number];
export type ConviteView = Awaited<ReturnType<typeof getMeusConvites>>[number];
export type RateioView = Awaited<ReturnType<typeof getRateio>>;

export async function getContatos() {
  return ler(`contatos`, async () => unwrapAction(await listarContatos()));
}

export async function addContato(dto: z.input<typeof createContatoSchema>) {
  return mutar(criarContato(dto));
}

export async function updateContato(id: string, patch: z.input<typeof updateContatoSchema>) {
  return mutar(atualizarContato(id, patch));
}

export async function removeContato(id: string) {
  return mutar(removerContato(id));
}

export async function getCartaoShares(cartaoId: string, ym?: string) {
  return unwrapAction(await listarSharesDoCartao(cartaoId, ym));
}

export async function addCartaoShare(cartaoId: string, dto: z.input<typeof createShareSchema>) {
  return mutar(criarShare(dto, cartaoId));
}

export async function updateCartaoShare(id: string, patch: z.input<typeof updateShareSchema>) {
  return mutar(atualizarShare(id, patch));
}

export async function removeCartaoShare(id: string) {
  return mutar(removerShare(id));
}

// Share que não é "de cartão": aponta uma fixa (aluguel) ou uma despesa do mês.
export async function addShare(dto: z.input<typeof createShareSchema>) {
  return mutar(criarShare(dto));
}

// Rateio N-a-N de uma linha: substitui o conjunto inteiro numa transação.
export async function salvarRateio(dto: z.input<typeof rateioSchema>, ym?: string) {
  return mutar(salvarRateioDaLinha(dto, ym));
}

// Rateio pelo id da linha (não precisa do espaço — quem vem da fatura não o tem).
export async function getRateio(
  ref: { despesaFixaId?: string; despesaMesId?: string },
  ym?: string
) {
  return unwrapAction(await lerRateioDaLinha(ref, ym));
}

// Modal de rateio numa chamada: contatos + rateio atual da linha.
export async function getRateioBootstrap(
  ref: { despesaFixaId?: string; despesaMesId?: string },
  ym?: string
) {
  return ler(`rateioBootstrap:${ref.despesaFixaId ?? ref.despesaMesId}:${ym ?? ""}`, async () => unwrapAction(await abrirRateio(ref, ym)));
}

// Painel de compartilhamento do cartão numa chamada: contatos + linhas da
// fatura + shares.
export async function getPainelCartaoShare(cartaoId: string, ym?: string) {
  return ler(`painelCartao:${cartaoId}:${ym ?? ""}`, async () => unwrapAction(await painelDoCartao(cartaoId, ym)));
}

export async function getRateioFixa(espacoId: string, id: string, ym?: string) {
  return unwrapAction(await lerRateioDaLinha({ despesaFixaId: id }, ym));
}

export async function getRateioMes(espacoId: string, id: string, ym?: string) {
  return unwrapAction(await lerRateioDaLinha({ despesaMesId: id }, ym));
}

// ── Convite / aceite ─────────────────────────────────────────────────────────
// Sem infra de email: o retorno traz o token e o link pra UI copiar.
export async function criarConvite(contatoId: string, dto: z.input<typeof conviteSchema>) {
  return mutar(criarConviteAction(contatoId, dto));
}

export async function getMeusConvites() {
  return ler(`meusConvites`, async () => unwrapAction(await listarMeusConvites()));
}

export async function getConvitePorToken(token: string) {
  return unwrapAction(await lerConvitePorToken(token));
}

export async function aceitarConvite(id: string) {
  return mutar(aceitarConviteAction(id));
}

export async function recusarConvite(id: string) {
  return mutar(recusarConviteAction(id));
}

// O que o usuário logado deve — agrupado por dono, com subgrupos por cartão.
export async function getMeusCompartilhamentos(ym?: string) {
  return ler(`meusCompartilhamentos:${ym ?? ""}`, async () => unwrapAction(await listarMeusCompartilhamentos(ym)));
}

// ── Adoção da dívida (lado de quem deve) ─────────────────────────────────────
export async function adotarShare(shareId: string, dto: z.input<typeof adotarSchema>) {
  return mutar(adotarShareAction(shareId, dto));
}

export async function ignorarShare(shareId: string, ym?: string) {
  return mutar(ignorarShareAction(shareId, ym));
}

// `removerDespesa` também apaga a despesa criada; sem ele a despesa fica (é do
// devedor, não some por decisão de terceiro).
export async function desfazerAdocao(shareId: string, removerDespesa = false) {
  return mutar(desfazerAdocaoAction(shareId, removerDespesa));
}

export async function adiantarShare(shareId: string, dto: z.input<typeof adiantarSchema>) {
  return mutar(adiantarShareAction(shareId, dto));
}

export async function sincronizarShare(shareId: string, ym?: string) {
  return mutar(sincronizarShareAction(shareId, ym));
}

// ── Categorias de despesa (da conta, não por espaço) ─────────────────────────
// Primeiro módulo em Server Functions: mesma assinatura, mesmo shape de retorno
// — só a implementação por baixo mudou. As rotas Hono continuam de pé.
export async function getCategorias() {
  return unwrapAction(await listarCategorias());
}

export async function addCategoria(dto: z.input<typeof createCategoriaSchema>) {
  return mutar(criarCategoria(dto));
}

export async function updateCategoria(id: string, patch: z.input<typeof updateCategoriaSchema>) {
  return mutar(atualizarCategoria(id, patch));
}

export async function removeCategoria(id: string) {
  return mutar(removerCategoria(id));
}

// ── Dev helper ─────────────────────────────────────────────────────────────
export async function resetState() {
  return mutar(resetarDados());
}
