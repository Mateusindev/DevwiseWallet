import { Hono } from "hono";
import { zValidator } from "@/server/lib/validator";
import { requireAnyPermission, type AuthEnv } from "@/server/auth/middleware";
import { cartaoShareService } from "./cartao-share.service";
import {
  createContatoSchema,
  updateContatoSchema,
  createShareSchema,
  updateShareSchema,
  rateioSchema,
  rateioQuerySchema,
  conviteSchema,
  adotarSchema,
  adiantarSchema,
  desfazerAdocaoSchema,
  shareQuerySchema,
} from "./cartao-share.dto";

// `cartao:share` / `cartao:view_shared` são os aliases históricos: as roles antigas
// seguem funcionando enquanto o catálogo migra pras permissions de `share:`.
const gerir = () => requireAnyPermission("share:manage", "cartao:share");
const agenda = () => requireAnyPermission("contato:manage", "share:manage", "cartao:share");
const verDevido = () => requireAnyPermission("share:view_shared", "cartao:view_shared");
const adotar = () => requireAnyPermission("share:adotar", "share:view_shared", "cartao:view_shared");

export const cartaoShareRoutes = new Hono<AuthEnv>()
  // ── Contatos (agenda do dono logado) ────────────────────────────────────────
  .get("/contatos", agenda(), async (c) =>
    c.json(await cartaoShareService.listContatos(c.get("user").id))
  )
  .post("/contatos", agenda(), zValidator("json", createContatoSchema), async (c) =>
    c.json(await cartaoShareService.createContato(c.get("user").id, c.req.valid("json")), 201)
  )
  .patch("/contatos/:id", agenda(), zValidator("json", updateContatoSchema), async (c) =>
    c.json(
      await cartaoShareService.updateContato(c.get("user").id, c.req.param("id"), c.req.valid("json"))
    )
  )
  .delete("/contatos/:id", agenda(), async (c) =>
    c.json(await cartaoShareService.removeContato(c.get("user").id, c.req.param("id")))
  )
  // Convite: sem infra de email, devolve o token/link pra UI copiar.
  .post("/contatos/:id/convite", agenda(), zValidator("json", conviteSchema), async (c) =>
    c.json(
      await cartaoShareService.criarConvite(c.get("user").id, c.req.param("id"), c.req.valid("json")),
      201
    )
  )
  // ── Shares (dono) ───────────────────────────────────────────────────────────
  .get("/cartoes/:id/shares", gerir(), zValidator("query", shareQuerySchema), async (c) =>
    c.json(
      await cartaoShareService.listByCartao(c.get("user").id, c.req.param("id"), c.req.valid("query").ym)
    )
  )
  // atalho histórico: o :id vira o cartão do share avulso (modo linha ignora)
  .post("/cartoes/:id/shares", gerir(), zValidator("json", createShareSchema), async (c) =>
    c.json(
      await cartaoShareService.createShare(c.get("user").id, c.req.valid("json"), c.req.param("id")),
      201
    )
  )
  .post("/shares", gerir(), zValidator("json", createShareSchema), async (c) =>
    c.json(await cartaoShareService.createShare(c.get("user").id, c.req.valid("json")), 201)
  )
  // rateio N-a-N de uma linha: substitui o conjunto inteiro numa transação
  .post("/shares/rateio", gerir(), zValidator("json", rateioSchema), zValidator("query", shareQuerySchema), async (c) =>
    c.json(
      await cartaoShareService.salvarRateio(c.get("user").id, c.req.valid("json"), c.req.valid("query").ym)
    )
  )
  .get("/shares/rateio", gerir(), zValidator("query", rateioQuerySchema), async (c) => {
    const { ym, ...ref } = c.req.valid("query");
    return c.json(await cartaoShareService.rateioDaLinha(c.get("user").id, ref, ym));
  })
  .get("/despesas/espacos/:esp/fixas/:id/rateio", gerir(), zValidator("query", shareQuerySchema), async (c) =>
    c.json(
      await cartaoShareService.rateioDaLinha(
        c.get("user").id,
        { despesaFixaId: c.req.param("id") },
        c.req.valid("query").ym
      )
    )
  )
  .get("/despesas/espacos/:esp/mes/:id/rateio", gerir(), zValidator("query", shareQuerySchema), async (c) =>
    c.json(
      await cartaoShareService.rateioDaLinha(
        c.get("user").id,
        { despesaMesId: c.req.param("id") },
        c.req.valid("query").ym
      )
    )
  )
  .patch("/shares/:id", gerir(), zValidator("json", updateShareSchema), async (c) =>
    c.json(
      await cartaoShareService.updateShare(c.get("user").id, c.req.param("id"), c.req.valid("json"))
    )
  )
  .delete("/shares/:id", gerir(), async (c) =>
    c.json(await cartaoShareService.removeShare(c.get("user").id, c.req.param("id")))
  )
  // ── Convites (quem recebe) ──────────────────────────────────────────────────
  .get("/me/convites", verDevido(), async (c) =>
    c.json(await cartaoShareService.meusConvites(c.get("user")))
  )
  .get("/me/convites/token/:token", verDevido(), async (c) =>
    c.json(await cartaoShareService.convitePorToken(c.get("user"), c.req.param("token")))
  )
  .post("/me/convites/:id/aceitar", verDevido(), async (c) =>
    c.json(await cartaoShareService.aceitarConvite(c.get("user"), c.req.param("id")))
  )
  .post("/me/convites/:id/recusar", verDevido(), async (c) =>
    c.json(await cartaoShareService.recusarConvite(c.get("user"), c.req.param("id")))
  )
  // ── Visão de quem deve ("o que devo") ───────────────────────────────────────
  .get("/me/compartilhamentos", verDevido(), zValidator("query", shareQuerySchema), async (c) =>
    c.json(await cartaoShareService.meusCompartilhamentos(c.get("user"), c.req.valid("query").ym))
  )
  .post(
    "/me/compartilhamentos/:shareId/adotar",
    adotar(),
    zValidator("json", adotarSchema),
    async (c) =>
      c.json(
        await cartaoShareService.adotar(c.get("user"), c.req.param("shareId"), c.req.valid("json")),
        201
      )
  )
  .post(
    "/me/compartilhamentos/:shareId/ignorar",
    adotar(),
    zValidator("query", shareQuerySchema),
    async (c) =>
      c.json(
        await cartaoShareService.ignorar(c.get("user"), c.req.param("shareId"), c.req.valid("query").ym)
      )
  )
  .delete(
    "/me/compartilhamentos/:shareId/adocao",
    adotar(),
    zValidator("query", desfazerAdocaoSchema),
    async (c) =>
      c.json(
        await cartaoShareService.desfazerAdocao(
          c.get("user"),
          c.req.param("shareId"),
          c.req.valid("query").removerDespesa
        )
      )
  )
  .post(
    "/me/compartilhamentos/:shareId/adiantar",
    adotar(),
    zValidator("json", adiantarSchema),
    async (c) =>
      c.json(await cartaoShareService.adiantar(c.get("user"), c.req.param("shareId"), c.req.valid("json")))
  )
  .post(
    "/me/compartilhamentos/:shareId/sincronizar",
    adotar(),
    zValidator("query", shareQuerySchema),
    async (c) =>
      c.json(
        await cartaoShareService.sincronizar(
          c.get("user"),
          c.req.param("shareId"),
          c.req.valid("query").ym
        )
      )
  );
