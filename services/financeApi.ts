// ── Finance API (Hono RPC) ──────────────────────────────────────────────
// Single seam entre UI e dados. Mesmas funções/shapes de sempre, mas por
// baixo usa o client tipado do Hono (hc) — rota, método e payload conferidos
// pelo TypeScript contra o AppType exportado pela rota catch-all.
import { hc } from "hono/client";
import type { InferRequestType } from "hono/client";
import type { z } from "zod";
import type { AppType } from "@/app/api/[[...route]]/route";
import type { ActionResult } from "@/server/next/action";
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

const client = hc<AppType>("/");

// Corpo (json) esperado por um endpoint, inferido do próprio client.
type Body<T> = InferRequestType<T> extends { json: infer J } ? J : never;

// Erro de API com o que o back mandou: `status` e, no 422, os `issues` do zod
// (é o que deixa o form marcar o campo culpado em vez de só mostrar
// "Validação falhou"). Continua sendo um Error — `catch (e) { e.message }` segue
// funcionando.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues?: unknown[]
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// Server Function: o resultado é discriminado (não há status HTTP), então o
// ApiError é reconstruído aqui — `useFormState` continua vendo `issues` no 422.
function unwrapAction<T>(r: ActionResult<T>): T {
  if (r.ok) return r.data;
  throw new ApiError(r.error, r.status, r.issues);
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

export async function login(email: string, senha: string) {
  return unwrap(client.api.auth.login.$post({ json: { email, senha } }));
}

export async function register(nome: string, email: string, senha: string) {
  return unwrap(client.api.auth.register.$post({ json: { nome, email, senha } }));
}

export async function logout() {
  return unwrap(client.api.auth.logout.$post());
}

// null = sem sessão (401); componente decide mostrar login.
export async function me() {
  const res = await client.api.auth.me.$get();
  if (res.status === 401) return null;
  return unwrap(Promise.resolve(res));
}

// ── Admin: usuários e roles (PBAC: user:* / role:*) ──────────────────────────
export type AdminUserView = Awaited<ReturnType<typeof listUsers>>[number];
export type AdminRoleView = Awaited<ReturnType<typeof listRoles>>[number];

export async function listUsers() {
  return unwrap(client.api.admin.users.$get());
}

export async function createUser(dto: Body<typeof client.api.admin.users.$post>) {
  return unwrap(client.api.admin.users.$post({ json: dto }));
}

export async function updateUser(id: string, patch: Body<(typeof client.api.admin.users)[":id"]["$patch"]>) {
  return unwrap(client.api.admin.users[":id"].$patch({ param: { id }, json: patch }));
}

export async function deleteUser(id: string) {
  return unwrap(client.api.admin.users[":id"].$delete({ param: { id } }));
}

export async function listRoles() {
  return unwrap(client.api.admin.roles.$get());
}

export async function createRole(dto: Body<typeof client.api.admin.roles.$post>) {
  return unwrap(client.api.admin.roles.$post({ json: dto }));
}

export async function updateRole(id: string, patch: Body<(typeof client.api.admin.roles)[":id"]["$patch"]>) {
  return unwrap(client.api.admin.roles[":id"].$patch({ param: { id }, json: patch }));
}

export async function deleteRole(id: string) {
  return unwrap(client.api.admin.roles[":id"].$delete({ param: { id } }));
}

export async function listPermissions() {
  return unwrap(client.api.admin.permissions.$get());
}

// ── Boot ─────────────────────────────────────────────────────────────────────
// `ym` centra a janela de histórico do orçamento que vem embutido.
export async function getBootstrap(ym?: string) {
  return unwrap(client.api.state.$get({ query: ym ? { ym } : {} }));
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
  return unwrap(
    client.api.movimentacoes.$post({ json: { caixinhaId, tipo: "aporte", valor, descricao, data } })
  );
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
  return unwrap(
    client.api.movimentacoes.$post({ json: { caixinhaId, tipo: "despesa", valor, descricao, data } })
  );
}

export async function removeMovimentacao(id: string) {
  return unwrap(client.api.movimentacoes[":id"].$delete({ param: { id } }));
}

export async function addCaixinha(dto: Body<typeof client.api.caixinhas.$post>) {
  return unwrap(client.api.caixinhas.$post({ json: dto }));
}

export async function updateCaixinha(id: string, patch: Body<(typeof client.api.caixinhas)[":id"]["$patch"]>) {
  return unwrap(client.api.caixinhas[":id"].$patch({ param: { id }, json: patch }));
}

export async function removeCaixinha(id: string) {
  return unwrap(client.api.caixinhas[":id"].$delete({ param: { id } }));
}

// ── Espaços de despesa ────────────────────────────────────────────────────────
export async function getEspacos() {
  return unwrap(client.api.despesas.espacos.$get());
}

export async function setActiveEspaco(id: string) {
  return unwrap(client.api.despesas.espacos.active.$put({ json: { id } }));
}

export async function addEspaco(dto: Body<typeof client.api.despesas.espacos.$post>) {
  return unwrap(client.api.despesas.espacos.$post({ json: dto }));
}

export async function renameEspaco(id: string, nome: string) {
  return unwrap(client.api.despesas.espacos[":id"].$patch({ param: { id }, json: { nome } }));
}

export async function removeEspaco(id: string) {
  return unwrap(client.api.despesas.espacos[":id"].$delete({ param: { id } }));
}

// Traz o orçamento numa janela de meses ao redor de `ym` (o payload devolve
// `janela` — quem consome refaz a busca quando o mês visto sai dela).
export async function getOrcamento(espacoId: string, ym?: string) {
  return unwrap(
    client.api.despesas.espacos[":esp"].$get({
      param: { esp: espacoId },
      query: ym ? { ym } : {},
    })
  );
}

// Gasto do mês por espaço — base do gráfico "por página" do Início.
export async function getResumoEspacos(ym?: string) {
  return unwrap(client.api.despesas.resumo.$get({ query: ym ? { ym } : {} }));
}

// Oculta / restaura o espaço só no mês ym (exclusão reversível daquele mês).
export async function ocultarEspacoMes(id: string, ym: string) {
  return unwrap(client.api.despesas.espacos[":id"].ocultar[":ym"].$post({ param: { id, ym } }));
}

export async function restaurarEspacoMes(id: string, ym: string) {
  return unwrap(client.api.despesas.espacos[":id"].ocultar[":ym"].$delete({ param: { id, ym } }));
}

// Resumo da fatura mês a mês (por cartão e por categoria) — base dos gráficos.
export async function getResumoCartoes(de?: string, ate?: string) {
  return unwrap(client.api.cartoes.resumo.$get({ query: { de, ate } }));
}

// ── Despesas fixas (por espaço) ──────────────────────────────────────────────
export async function addDespesaFixa(espacoId: string, dto: Body<(typeof client.api.despesas.espacos)[":esp"]["fixas"]["$post"]>) {
  return unwrap(client.api.despesas.espacos[":esp"].fixas.$post({ param: { esp: espacoId }, json: dto }));
}

export async function toggleDespesaFixa(espacoId: string, id: string) {
  return unwrap(
    client.api.despesas.espacos[":esp"].fixas[":id"].toggle.$patch({ param: { esp: espacoId, id } })
  );
}

export async function updateDespesaFixa(espacoId: string, id: string, patch: Body<(typeof client.api.despesas.espacos)[":esp"]["fixas"][":id"]["$patch"]>) {
  return unwrap(
    client.api.despesas.espacos[":esp"].fixas[":id"].$patch({ param: { esp: espacoId, id }, json: patch })
  );
}

export async function removeDespesaFixa(espacoId: string, id: string) {
  return unwrap(client.api.despesas.espacos[":esp"].fixas[":id"].$delete({ param: { esp: espacoId, id } }));
}

// Define quanto pago da fixa no mês ym (valor absoluto) -> { despesaFixaId, ym, valorPago, pago }.
export async function setPagamentoFixa(espacoId: string, id: string, ym: string, valorPago: number) {
  return unwrap(
    client.api.despesas.espacos[":esp"].fixas[":id"].pago[":ym"].$put({
      param: { esp: espacoId, id, ym },
      json: { valorPago },
    })
  );
}

// Ação em lote nas fixas: pagar/despagar (no mês `ym`), excluir, categoria,
// cartão, ativar/pausar. Uma requisição, transação no back.
export async function bulkDespesasFixas(espacoId: string, dto: Body<(typeof client.api.despesas.espacos)[":esp"]["fixas"]["bulk"]["$post"]>) {
  return unwrap(
    client.api.despesas.espacos[":esp"].fixas.bulk.$post({ param: { esp: espacoId }, json: dto })
  );
}

// Receita recorrente: pular um mês, desfazer o pulo e encerrar daquele mês em diante.
export async function skipReceitaMes(espacoId: string, id: string, ym: string) {
  return unwrap(
    client.api.despesas.espacos[":esp"].receitas[":id"].skip[":ym"].$put({ param: { esp: espacoId, id, ym } })
  );
}

export async function unskipReceitaMes(espacoId: string, id: string, ym: string) {
  return unwrap(
    client.api.despesas.espacos[":esp"].receitas[":id"].skip[":ym"].$delete({ param: { esp: espacoId, id, ym } })
  );
}

export async function encerrarReceitaMes(espacoId: string, id: string, ym: string) {
  return unwrap(
    client.api.despesas.espacos[":esp"].receitas[":id"].encerrar[":ym"].$patch({
      param: { esp: espacoId, id, ym },
    })
  );
}

// ── Renda do mês (por espaço) ─────────────────────────────────────────────────
export async function setRendaMes(espacoId: string, ym: string, valor: number) {
  return unwrap(
    client.api.despesas.espacos[":esp"].rendas[":ym"].$put({ param: { esp: espacoId, ym }, json: { valor } })
  );
}

// Remove o override do mês → volta a herdar o salário fixo do espaço.
export async function clearRendaMes(espacoId: string, ym: string) {
  return unwrap(client.api.despesas.espacos[":esp"].rendas[":ym"].$delete({ param: { esp: espacoId, ym } }));
}

// Salário fixo mensal = default do espaço (RendaMensal cai como fallback).
export async function setRendaFixa(espacoId: string, rendaMensal: number) {
  return unwrap(client.api.despesas.espacos[":id"].$patch({ param: { id: espacoId }, json: { rendaMensal } }));
}

// ── Despesas do mês (por espaço) ──────────────────────────────────────────────
export async function addDespesaMes(espacoId: string, dto: Body<(typeof client.api.despesas.espacos)[":esp"]["mes"]["$post"]>) {
  return unwrap(client.api.despesas.espacos[":esp"].mes.$post({ param: { esp: espacoId }, json: dto }));
}

export async function updateDespesaMes(espacoId: string, id: string, patch: Body<(typeof client.api.despesas.espacos)[":esp"]["mes"][":id"]["$patch"]>) {
  return unwrap(
    client.api.despesas.espacos[":esp"].mes[":id"].$patch({ param: { esp: espacoId, id }, json: patch })
  );
}

export async function removeDespesaMes(espacoId: string, id: string) {
  return unwrap(client.api.despesas.espacos[":esp"].mes[":id"].$delete({ param: { esp: espacoId, id } }));
}

// Import de OFX: cria as despesas do mês e devolve o que foi ignorado por fitid
// repetido.
export async function importDespesasMes(espacoId: string, dto: Body<(typeof client.api.despesas.espacos)[":esp"]["mes"]["import"]["$post"]>) {
  return unwrap(
    client.api.despesas.espacos[":esp"].mes.import.$post({ param: { esp: espacoId }, json: dto })
  );
}

// Ação em lote nas despesas do mês: pagar/despagar, excluir, categoria, cartão.
export async function bulkDespesasMes(espacoId: string, dto: Body<(typeof client.api.despesas.espacos)[":esp"]["mes"]["bulk"]["$post"]>) {
  return unwrap(
    client.api.despesas.espacos[":esp"].mes.bulk.$post({ param: { esp: espacoId }, json: dto })
  );
}

// Define quanto pago de uma despesa do mês (valor absoluto) -> despesa atualizada.
export async function setPagaMes(espacoId: string, id: string, valorPago: number) {
  return unwrap(
    client.api.despesas.espacos[":esp"].mes[":id"].pago.$put({ param: { esp: espacoId, id }, json: { valorPago } })
  );
}

// ── Receitas do mês (dinheiro extra por fora, por espaço) ─────────────────────
export async function addReceitaMes(espacoId: string, dto: Body<(typeof client.api.despesas.espacos)[":esp"]["receitas"]["$post"]>) {
  return unwrap(client.api.despesas.espacos[":esp"].receitas.$post({ param: { esp: espacoId }, json: dto }));
}

export async function updateReceitaMes(espacoId: string, id: string, patch: Body<(typeof client.api.despesas.espacos)[":esp"]["receitas"][":id"]["$patch"]>) {
  return unwrap(
    client.api.despesas.espacos[":esp"].receitas[":id"].$patch({ param: { esp: espacoId, id }, json: patch })
  );
}

export async function removeReceitaMes(espacoId: string, id: string) {
  return unwrap(client.api.despesas.espacos[":esp"].receitas[":id"].$delete({ param: { esp: espacoId, id } }));
}

// ── Cartões de crédito (da conta, não por espaço) ────────────────────────────
export async function getCartoes(ym?: string) {
  return unwrap(client.api.cartoes.$get({ query: ym ? { ym } : {} }));
}

export async function addCartao(dto: Body<typeof client.api.cartoes.$post>) {
  return unwrap(client.api.cartoes.$post({ json: dto }));
}

export async function updateCartao(id: string, patch: Body<(typeof client.api.cartoes)[":id"]["$patch"]>) {
  return unwrap(client.api.cartoes[":id"].$patch({ param: { id }, json: patch }));
}

export async function removeCartao(id: string) {
  return unwrap(client.api.cartoes[":id"].$delete({ param: { id } }));
}

// Parceladas em aberto da conta (todos os espaços) + pagamentos do mês.
// Base do painel de quitação na aba de cartões.
export async function getParceladas(ym?: string) {
  return unwrap(client.api.cartoes.parceladas.$get({ query: ym ? { ym } : {} }));
}

// Linhas da fatura de um cartão num mês (pra escolher qual compartilhar).
export async function getFaturaLinhas(cartaoId: string, ym?: string) {
  return unwrap(client.api.cartoes[":id"].fatura.$get({ param: { id: cartaoId }, query: ym ? { ym } : {} }));
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
  return unwrap(client.api.contatos.$get());
}

export async function addContato(dto: Body<typeof client.api.contatos.$post>) {
  return unwrap(client.api.contatos.$post({ json: dto }));
}

export async function updateContato(id: string, patch: Body<(typeof client.api.contatos)[":id"]["$patch"]>) {
  return unwrap(client.api.contatos[":id"].$patch({ param: { id }, json: patch }));
}

export async function removeContato(id: string) {
  return unwrap(client.api.contatos[":id"].$delete({ param: { id } }));
}

export async function getCartaoShares(cartaoId: string, ym?: string) {
  return unwrap(client.api.cartoes[":id"].shares.$get({ param: { id: cartaoId }, query: ym ? { ym } : {} }));
}

export async function addCartaoShare(cartaoId: string, dto: Body<(typeof client.api.cartoes)[":id"]["shares"]["$post"]>) {
  return unwrap(client.api.cartoes[":id"].shares.$post({ param: { id: cartaoId }, json: dto }));
}

export async function updateCartaoShare(id: string, patch: Body<(typeof client.api.shares)[":id"]["$patch"]>) {
  return unwrap(client.api.shares[":id"].$patch({ param: { id }, json: patch }));
}

export async function removeCartaoShare(id: string) {
  return unwrap(client.api.shares[":id"].$delete({ param: { id } }));
}

// Share que não é "de cartão": aponta uma fixa (aluguel) ou uma despesa do mês.
export async function addShare(dto: Body<typeof client.api.shares.$post>) {
  return unwrap(client.api.shares.$post({ json: dto }));
}

// Rateio N-a-N de uma linha: substitui o conjunto inteiro numa transação.
export async function salvarRateio(dto: Body<typeof client.api.shares.rateio.$post>, ym?: string) {
  return unwrap(client.api.shares.rateio.$post({ json: dto, query: ym ? { ym } : {} }));
}

// Rateio pelo id da linha (não precisa do espaço — quem vem da fatura não o tem).
export async function getRateio(
  ref: { despesaFixaId?: string; despesaMesId?: string },
  ym?: string
) {
  return unwrap(client.api.shares.rateio.$get({ query: { ...ref, ...(ym ? { ym } : {}) } }));
}

export async function getRateioFixa(espacoId: string, id: string, ym?: string) {
  return unwrap(
    client.api.despesas.espacos[":esp"].fixas[":id"].rateio.$get({
      param: { esp: espacoId, id },
      query: ym ? { ym } : {},
    })
  );
}

export async function getRateioMes(espacoId: string, id: string, ym?: string) {
  return unwrap(
    client.api.despesas.espacos[":esp"].mes[":id"].rateio.$get({
      param: { esp: espacoId, id },
      query: ym ? { ym } : {},
    })
  );
}

// ── Convite / aceite ─────────────────────────────────────────────────────────
// Sem infra de email: o retorno traz o token e o link pra UI copiar.
export async function criarConvite(
  contatoId: string,
  dto: Body<(typeof client.api.contatos)[":id"]["convite"]["$post"]>
) {
  return unwrap(client.api.contatos[":id"].convite.$post({ param: { id: contatoId }, json: dto }));
}

export async function getMeusConvites() {
  return unwrap(client.api.me.convites.$get());
}

export async function getConvitePorToken(token: string) {
  return unwrap(client.api.me.convites.token[":token"].$get({ param: { token } }));
}

export async function aceitarConvite(id: string) {
  return unwrap(client.api.me.convites[":id"].aceitar.$post({ param: { id } }));
}

export async function recusarConvite(id: string) {
  return unwrap(client.api.me.convites[":id"].recusar.$post({ param: { id } }));
}

// O que o usuário logado deve — agrupado por dono, com subgrupos por cartão.
export async function getMeusCompartilhamentos(ym?: string) {
  return unwrap(client.api.me.compartilhamentos.$get({ query: ym ? { ym } : {} }));
}

// ── Adoção da dívida (lado de quem deve) ─────────────────────────────────────
export async function adotarShare(
  shareId: string,
  dto: Body<(typeof client.api.me.compartilhamentos)[":shareId"]["adotar"]["$post"]>
) {
  return unwrap(client.api.me.compartilhamentos[":shareId"].adotar.$post({ param: { shareId }, json: dto }));
}

export async function ignorarShare(shareId: string, ym?: string) {
  return unwrap(
    client.api.me.compartilhamentos[":shareId"].ignorar.$post({
      param: { shareId },
      query: ym ? { ym } : {},
    })
  );
}

// `removerDespesa` também apaga a despesa criada; sem ele a despesa fica (é do
// devedor, não some por decisão de terceiro).
export async function desfazerAdocao(shareId: string, removerDespesa = false) {
  return unwrap(
    client.api.me.compartilhamentos[":shareId"].adocao.$delete({
      param: { shareId },
      query: removerDespesa ? { removerDespesa: "true" } : {},
    })
  );
}

export async function adiantarShare(
  shareId: string,
  dto: Body<(typeof client.api.me.compartilhamentos)[":shareId"]["adiantar"]["$post"]>
) {
  return unwrap(client.api.me.compartilhamentos[":shareId"].adiantar.$post({ param: { shareId }, json: dto }));
}

export async function sincronizarShare(shareId: string, ym?: string) {
  return unwrap(
    client.api.me.compartilhamentos[":shareId"].sincronizar.$post({
      param: { shareId },
      query: ym ? { ym } : {},
    })
  );
}

// ── Categorias de despesa (da conta, não por espaço) ─────────────────────────
// Primeiro módulo em Server Functions: mesma assinatura, mesmo shape de retorno
// — só a implementação por baixo mudou. As rotas Hono continuam de pé.
export async function getCategorias() {
  return unwrapAction(await listarCategorias());
}

export async function addCategoria(dto: z.input<typeof createCategoriaSchema>) {
  return unwrapAction(await criarCategoria(dto));
}

export async function updateCategoria(id: string, patch: z.input<typeof updateCategoriaSchema>) {
  return unwrapAction(await atualizarCategoria(id, patch));
}

export async function removeCategoria(id: string) {
  return unwrapAction(await removerCategoria(id));
}

// ── Dev helper ─────────────────────────────────────────────────────────────
export async function resetState() {
  return unwrap(client.api.dev.reset.$post());
}
