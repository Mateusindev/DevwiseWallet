import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AppError } from "@/server/lib/errors";
import { authRoutes } from "@/server/auth/auth.routes";
import { requireAuth, requirePermission } from "@/server/auth/middleware";
import { getState } from "@/server/modules/bootstrap/bootstrap.service";
import { zValidator } from "@/server/lib/validator";
import { orcamentoQuerySchema } from "@/server/modules/espaco/espaco.dto";
import { caixinhaRoutes } from "@/server/modules/caixinha/caixinha.routes";
import { movimentacaoRoutes } from "@/server/modules/movimentacao/movimentacao.routes";
import { espacoRoutes } from "@/server/modules/espaco/espaco.routes";
import { orcamentoRoutes } from "@/server/modules/orcamento/orcamento.routes";
import { cartaoRoutes } from "@/server/modules/cartao/cartao.routes";
import { cartaoShareRoutes } from "@/server/modules/cartao-share/cartao-share.routes";
import { categoriaRoutes } from "@/server/modules/categoria/categoria.routes";
import { adminRoutes } from "@/server/modules/admin/admin.routes";
import { devRoutes } from "@/server/modules/dev/dev.routes";

const base = new Hono().basePath("/api");

// ── Error handler central (paridade com o setErrorHandler do Fastify) ────────
base.onError((err, c) => {
  if (err instanceof ZodError) {
    return c.json({ error: "Validação falhou", issues: err.issues }, 422);
  }
  if (err instanceof AppError) {
    return c.json({ error: err.message }, err.statusCode as 400);
  }
  // registro não encontrado no Prisma (delete/update de id inexistente)
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    return c.json({ error: "Registro não encontrado" }, 404);
  }
  // erro levantado pelo próprio Hono (ex.: body JSON malformado → 400) —
  // mantém o status dele, no shape { error } do resto da API.
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: "Erro interno" }, 500);
});

// App Hono completo. Fica aqui (e não no route.ts do Next) pra poder ser
// importado direto — os testes de integração exercitam as rotas via
// `app.request()`, sem subir servidor.
export const app = base
  // públicas
  .get("/health", (c) => c.json({ status: "ok" }))
  .route("/", authRoutes)
  // tudo abaixo exige sessão (JWT no cookie httpOnly); cada rota exige a
  // permission granular dela (PBAC)
  .use(requireAuth)
  .get(
    "/state",
    requirePermission("state:view"),
    zValidator("query", orcamentoQuerySchema),
    async (c) => c.json(await getState(c.get("user").id, c.req.valid("query").ym))
  )
  .route("/", caixinhaRoutes)
  .route("/", movimentacaoRoutes)
  .route("/", espacoRoutes)
  .route("/", orcamentoRoutes)
  .route("/", cartaoRoutes)
  .route("/", cartaoShareRoutes)
  .route("/", categoriaRoutes)
  .route("/", adminRoutes)
  .route("/", devRoutes);

// Fonte dos tipos do client RPC (hc<AppType>).
export type AppType = typeof app;
