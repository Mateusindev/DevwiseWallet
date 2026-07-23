import type { ValidationTargets } from "hono";
import type { ZodType } from "zod";
import { zValidator as zv } from "@hono/zod-validator";

// zValidator que lança ZodError em vez de responder 400 direto —
// o onError central converte pra 422 com issues (paridade com a api Fastify).
export const zValidator = <T extends ZodType, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T
) =>
  zv(target, schema, (result) => {
    if (!result.success) throw result.error;
  });
