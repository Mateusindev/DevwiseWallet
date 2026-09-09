"use server";

// Server Functions do módulo de categoria — mesma superfície das 4 rotas Hono
// (`categoria.routes.ts`), chamando o mesmo service. A rota continua existindo:
// as duas camadas coexistem até a Fase 5, então reverter é reverter um commit.
import { acao, acaoValidada } from "@/server/next/action";
import { categoriaService } from "./categoria.service";
import { createCategoriaSchema, updateCategoriaSchema } from "./categoria.dto";

export async function listarCategorias() {
  return acao("categoria:view", (user) => categoriaService.list(user.id));
}

export async function criarCategoria(input: unknown) {
  return acaoValidada("categoria:manage", createCategoriaSchema, input, (user, dto) =>
    categoriaService.create(user.id, dto)
  );
}

export async function atualizarCategoria(id: string, input: unknown) {
  return acaoValidada("categoria:manage", updateCategoriaSchema, input, (user, dto) =>
    categoriaService.update(user.id, id, dto)
  );
}

export async function removerCategoria(id: string) {
  return acao("categoria:manage", (user) => categoriaService.remove(user.id, id));
}
