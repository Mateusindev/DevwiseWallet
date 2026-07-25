import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { z, ZodError } from "zod";
import { zValidator } from "./validator";

// App mínimo espelhando o onError central de app/api/[[...route]]/route.ts —
// o contrato do zValidator custom é: LANÇAR o ZodError, não responder sozinho.
const schema = z.object({ nome: z.string().min(1), valor: z.number() });

const app = new Hono()
  .onError((err, c) => {
    if (err instanceof ZodError) return c.json({ error: "Validação falhou", issues: err.issues }, 422);
    return c.json({ error: "Erro interno" }, 500);
  })
  .post("/json", zValidator("json", schema), (c) => c.json(c.req.valid("json")))
  .get("/query", zValidator("query", z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/) })), (c) =>
    c.json(c.req.valid("query"))
  );

const postJson = (body: unknown) =>
  app.request("/json", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("zValidator", () => {
  it("payload válido passa e chega tipado no handler", async () => {
    const res = await postJson({ nome: "Aluguel", valor: 300 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ nome: "Aluguel", valor: 300 });
  });

  it("payload inválido vira 422 com issues (não 400 do @hono/zod-validator)", async () => {
    const res = await postJson({ nome: "", valor: "trezentos" });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("Validação falhou");
    expect(body.issues.length).toBe(2);
  });

  it("campo faltando também é 422", async () => {
    const res = await postJson({ nome: "X" });
    expect(res.status).toBe(422);
  });

  it("valida outros targets além de json (query)", async () => {
    expect((await app.request("/query?mes=2026-06")).status).toBe(200);
    expect((await app.request("/query?mes=junho")).status).toBe(422);
  });
});
