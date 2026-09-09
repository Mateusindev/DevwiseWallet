"use server";

import { acao, acaoValidada } from "@/server/next/action";
import { espacoService } from "./espaco.service";
import {
  createEspacoSchema,
  updateEspacoSchema,
  setActiveSchema,
  orcamentoQuerySchema,
} from "./espaco.dto";

export async function listarEspacos() {
  return acao("espaco:view", (user) => espacoService.listWithActive(user.id));
}

// Gasto do mês por espaço — o gráfico do Início numa chamada só.
export async function resumoDoMes(ym?: string) {
  return acaoValidada("espaco:view", orcamentoQuerySchema, { ym }, (user, q) =>
    espacoService.resumoPorEspaco(user.id, q.ym)
  );
}

export async function orcamentoDoEspaco(espacoId: string, ym?: string) {
  return acaoValidada("espaco:view", orcamentoQuerySchema, { ym }, (user, q) =>
    espacoService.getOrcamento(user.id, espacoId, q.ym)
  );
}

export async function definirEspacoAtivo(input: unknown) {
  return acaoValidada("espaco:manage", setActiveSchema, input, (user, dto) =>
    espacoService.setActive(user.id, dto.id)
  );
}

export async function criarEspaco(input: unknown) {
  return acaoValidada("espaco:manage", createEspacoSchema, input, (user, dto) =>
    espacoService.create(user.id, dto)
  );
}

export async function atualizarEspaco(id: string, input: unknown) {
  return acaoValidada("espaco:manage", updateEspacoSchema, input, (user, dto) =>
    espacoService.update(user.id, id, dto)
  );
}

export async function removerEspaco(id: string) {
  return acao("espaco:manage", (user) => espacoService.remove(user.id, id));
}

// Exclusão só naquele mês, reversível.
export async function ocultarEspacoNoMes(id: string, ym: string) {
  return acao("espaco:manage", (user) => espacoService.ocultarNoMes(user.id, id, ym));
}

export async function restaurarEspacoNoMes(id: string, ym: string) {
  return acao("espaco:manage", (user) => espacoService.restaurarNoMes(user.id, id, ym));
}
