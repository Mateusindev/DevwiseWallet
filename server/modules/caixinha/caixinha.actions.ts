"use server";

import { acao, acaoValidada } from "@/server/next/action";
import { caixinhaService } from "./caixinha.service";
import { createCaixinhaSchema, updateCaixinhaSchema } from "./caixinha.dto";

export async function listarCaixinhas() {
  return acao("caixinha:view", (user) => caixinhaService.list(user.id));
}

export async function criarCaixinha(input: unknown) {
  return acaoValidada("caixinha:manage", createCaixinhaSchema, input, (user, dto) =>
    caixinhaService.create(user.id, dto)
  );
}

export async function atualizarCaixinha(id: string, input: unknown) {
  return acaoValidada("caixinha:manage", updateCaixinhaSchema, input, (user, dto) =>
    caixinhaService.update(user.id, id, dto)
  );
}

export async function removerCaixinha(id: string) {
  return acao("caixinha:manage", (user) => caixinhaService.remove(user.id, id));
}
