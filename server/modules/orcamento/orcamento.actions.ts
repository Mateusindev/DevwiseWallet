"use server";

// Server Functions do orçamento — o maior módulo (20 rotas). O import de OFX
// NÃO está aqui de propósito: continua num Route Handler, porque o payload
// passa do cap de 1MB das actions e não é mutação com re-render (ver 4.4 do
// plano).
import { acao, acaoValidada } from "@/server/next/action";
import { orcamentoService } from "./orcamento.service";
import {
  addDespesaFixaSchema,
  updateDespesaFixaSchema,
  addDespesaMesSchema,
  updateDespesaMesSchema,
  addReceitaMesSchema,
  updateReceitaMesSchema,
  bulkFixaSchema,
  bulkMesSchema,
  setRendaSchema,
  setPagamentoSchema,
  ymParamSchema,
} from "./orcamento.dto";

const MANAGE = "orcamento:manage";

// `ym` chegava pela URL e era validado à parte (ymParamSchema); aqui vira mais
// um campo do payload, validado junto.
const pagamentoNoMesSchema = setPagamentoSchema.extend(ymParamSchema.shape);
const rendaNoMesSchema = setRendaSchema.extend(ymParamSchema.shape);

// ── Despesas fixas ───────────────────────────────────────────────────────────

export async function criarDespesaFixa(espacoId: string, input: unknown) {
  return acaoValidada(MANAGE, addDespesaFixaSchema, input, (user, dto) =>
    orcamentoService.addDespesaFixa(user.id, espacoId, dto)
  );
}

export async function atualizarDespesaFixa(espacoId: string, id: string, input: unknown) {
  return acaoValidada(MANAGE, updateDespesaFixaSchema, input, (user, dto) =>
    orcamentoService.updateDespesaFixa(user.id, espacoId, id, dto)
  );
}

export async function alternarDespesaFixa(espacoId: string, id: string) {
  return acao(MANAGE, (user) => orcamentoService.toggleDespesaFixa(user.id, espacoId, id));
}

export async function removerDespesaFixa(espacoId: string, id: string) {
  return acao(MANAGE, (user) => orcamentoService.removeDespesaFixa(user.id, espacoId, id));
}

export async function definirPagamentoFixa(espacoId: string, id: string, ym: string, valorPago: number) {
  return acaoValidada(MANAGE, pagamentoNoMesSchema, { ym, valorPago }, (user, dto) =>
    orcamentoService.setPagamentoFixa(user.id, espacoId, id, dto.ym, dto.valorPago)
  );
}

export async function loteDeFixas(espacoId: string, input: unknown) {
  return acaoValidada(MANAGE, bulkFixaSchema, input, (user, dto) =>
    orcamentoService.bulkFixa(user.id, espacoId, dto)
  );
}

// ── Renda do mês ─────────────────────────────────────────────────────────────

export async function definirRendaDoMes(espacoId: string, ym: string, valor: number) {
  return acaoValidada(MANAGE, rendaNoMesSchema, { ym, valor }, (user, dto) =>
    orcamentoService.setRenda(user.id, espacoId, dto.ym, dto.valor)
  );
}

export async function limparRendaDoMes(espacoId: string, ym: string) {
  return acaoValidada(MANAGE, ymParamSchema, { ym }, (user, dto) =>
    orcamentoService.clearRenda(user.id, espacoId, dto.ym)
  );
}

// ── Despesas do mês ──────────────────────────────────────────────────────────

export async function criarDespesaMes(espacoId: string, input: unknown) {
  return acaoValidada(MANAGE, addDespesaMesSchema, input, (user, dto) =>
    orcamentoService.addDespesaMes(user.id, espacoId, dto)
  );
}

export async function atualizarDespesaMes(espacoId: string, id: string, input: unknown) {
  return acaoValidada(MANAGE, updateDespesaMesSchema, input, (user, dto) =>
    orcamentoService.updateDespesaMes(user.id, espacoId, id, dto)
  );
}

export async function removerDespesaMes(espacoId: string, id: string) {
  return acao(MANAGE, (user) => orcamentoService.removeDespesaMes(user.id, espacoId, id));
}

export async function definirPagoDaDespesaMes(espacoId: string, id: string, valorPago: number) {
  return acaoValidada(MANAGE, setPagamentoSchema, { valorPago }, (user, dto) =>
    orcamentoService.setPagaMes(user.id, espacoId, id, dto.valorPago)
  );
}

export async function loteDeDespesasMes(espacoId: string, input: unknown) {
  return acaoValidada(MANAGE, bulkMesSchema, input, (user, dto) =>
    orcamentoService.bulkMes(user.id, espacoId, dto)
  );
}

// ── Receitas do mês ──────────────────────────────────────────────────────────

export async function criarReceitaMes(espacoId: string, input: unknown) {
  return acaoValidada(MANAGE, addReceitaMesSchema, input, (user, dto) =>
    orcamentoService.addReceitaMes(user.id, espacoId, dto)
  );
}

export async function atualizarReceitaMes(espacoId: string, id: string, input: unknown) {
  return acaoValidada(MANAGE, updateReceitaMesSchema, input, (user, dto) =>
    orcamentoService.updateReceitaMes(user.id, espacoId, id, dto)
  );
}

export async function removerReceitaMes(espacoId: string, id: string) {
  return acao(MANAGE, (user) => orcamentoService.removeReceitaMes(user.id, espacoId, id));
}

// Recorrente: pular só um mês, desfazer o pulo, encerrar daquele mês em diante.
export async function pularReceitaNoMes(espacoId: string, id: string, ym: string) {
  return acaoValidada(MANAGE, ymParamSchema, { ym }, (user, dto) =>
    orcamentoService.skipReceitaMes(user.id, espacoId, id, dto.ym)
  );
}

export async function desfazerPuloDaReceita(espacoId: string, id: string, ym: string) {
  return acaoValidada(MANAGE, ymParamSchema, { ym }, (user, dto) =>
    orcamentoService.unskipReceitaMes(user.id, espacoId, id, dto.ym)
  );
}

export async function encerrarReceitaNoMes(espacoId: string, id: string, ym: string) {
  return acaoValidada(MANAGE, ymParamSchema, { ym }, (user, dto) =>
    orcamentoService.encerrarReceitaMes(user.id, espacoId, id, dto.ym)
  );
}
