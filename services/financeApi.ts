// ── Finance API (Hono RPC) ──────────────────────────────────────────────
// Single seam entre UI e dados. Mesmas funções/shapes de sempre, mas por
// baixo usa o client tipado do Hono (hc) — rota, método e payload conferidos
// pelo TypeScript contra o AppType exportado pela rota catch-all.
import { hc } from "hono/client";
import type { InferRequestType } from "hono/client";
import type { AppType } from "@/app/api/[[...route]]/route";

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
export async function getBootstrap() {
  return unwrap(client.api.state.$get());
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

export async function getOrcamento(espacoId: string) {
  return unwrap(client.api.despesas.espacos[":esp"].$get({ param: { esp: espacoId } }));
}

// Oculta / restaura o espaço só no mês ym (exclusão reversível daquele mês).
export async function ocultarEspacoMes(id: string, ym: string) {
  return unwrap(client.api.despesas.espacos[":id"].ocultar[":ym"].$post({ param: { id, ym } }));
}

export async function restaurarEspacoMes(id: string, ym: string) {
  return unwrap(client.api.despesas.espacos[":id"].ocultar[":ym"].$delete({ param: { id, ym } }));
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

// ── Compartilhamento de cartão (contatos + shares) ────────────────────────────
export type ContatoView = Awaited<ReturnType<typeof getContatos>>[number];
export type CartaoShareView = Awaited<ReturnType<typeof getCartaoShares>>[number];
export type MeuCompartilhamento = Awaited<ReturnType<typeof getMeusCompartilhamentos>>[number];

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

// O que o usuário logado deve nos cartões de outras pessoas.
export async function getMeusCompartilhamentos(ym?: string) {
  return unwrap(client.api.me.compartilhamentos.$get({ query: ym ? { ym } : {} }));
}

// ── Categorias de despesa (da conta, não por espaço) ─────────────────────────
export async function getCategorias() {
  return unwrap(client.api.categorias.$get());
}

export async function addCategoria(dto: Body<typeof client.api.categorias.$post>) {
  return unwrap(client.api.categorias.$post({ json: dto }));
}

export async function updateCategoria(id: string, patch: Body<(typeof client.api.categorias)[":id"]["$patch"]>) {
  return unwrap(client.api.categorias[":id"].$patch({ param: { id }, json: patch }));
}

export async function removeCategoria(id: string) {
  return unwrap(client.api.categorias[":id"].$delete({ param: { id } }));
}

// ── Dev helper ─────────────────────────────────────────────────────────────
export async function resetState() {
  return unwrap(client.api.dev.reset.$post());
}
