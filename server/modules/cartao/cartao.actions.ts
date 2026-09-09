"use server";

import { acao, acaoValidada } from "@/server/next/action";
import { cartaoService } from "./cartao.service";
import { createCartaoSchema, updateCartaoSchema, cartaoQuerySchema, resumoQuerySchema } from "./cartao.dto";
import { addMonths, currentMonth } from "@/server/lib/serialize";

export async function listarCartoes(ym?: string) {
  return acaoValidada("cartao:view", cartaoQuerySchema, { ym }, (user, q) =>
    cartaoService.listWithAggregates(user.id, q.ym)
  );
}

// Parceladas em aberto do dono (todos os espaços) — painel de quitação.
export async function listarParceladas(ym?: string) {
  return acaoValidada("cartao:view", cartaoQuerySchema, { ym }, (user, q) =>
    cartaoService.parceladasEmAberto(user.id, q.ym)
  );
}

// Janela default do resumo: 6 meses terminando no mês pedido.
export async function resumoDeCartoes(de?: string, ate?: string) {
  return acaoValidada("cartao:view", resumoQuerySchema, { de, ate }, (user, q) => {
    const fim = q.ate ?? currentMonth();
    return cartaoService.resumoPorMes(user.id, q.de ?? addMonths(fim, -5), fim);
  });
}

export async function linhasDaFatura(cartaoId: string, ym?: string) {
  return acaoValidada("cartao:view", cartaoQuerySchema, { ym }, (user, q) =>
    cartaoService.faturaLinhas(user.id, cartaoId, q.ym)
  );
}

export async function criarCartao(input: unknown) {
  return acaoValidada("cartao:manage", createCartaoSchema, input, (user, dto) =>
    cartaoService.create(user.id, dto)
  );
}

export async function atualizarCartao(id: string, input: unknown) {
  return acaoValidada("cartao:manage", updateCartaoSchema, input, (user, dto) =>
    cartaoService.update(user.id, id, dto)
  );
}

export async function removerCartao(id: string) {
  return acao("cartao:manage", (user) => cartaoService.remove(user.id, id));
}
