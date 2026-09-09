"use server";

import { acao, acaoValidada } from "@/server/next/action";
import { movimentacaoService } from "./movimentacao.service";
import { createMovimentacaoSchema } from "./movimentacao.dto";

export async function listarMovimentacoes() {
  return acao("movimentacao:view", (user) => movimentacaoService.list(user.id));
}

// Retorno composto: a movimentação criada + a caixinha com o saldo já novo.
export async function criarMovimentacao(input: unknown) {
  return acaoValidada("movimentacao:manage", createMovimentacaoSchema, input, (user, dto) =>
    movimentacaoService.create(user.id, dto)
  );
}

export async function removerMovimentacao(id: string) {
  return acao("movimentacao:manage", (user) => movimentacaoService.remove(user.id, id));
}
