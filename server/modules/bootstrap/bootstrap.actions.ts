"use server";

import { acaoValidada } from "@/server/next/action";
import { orcamentoQuerySchema } from "../espaco/espaco.dto";
import { getState } from "./bootstrap.service";

// Estado inicial completo. No boot servido isso já roda no RSC (app/page.tsx);
// esta action é o caminho do refresh e do "restaurar dados".
export async function estadoInicial(ym?: string) {
  return acaoValidada("state:view", orcamentoQuerySchema, { ym }, (user, q) =>
    getState(user.id, q.ym)
  );
}
