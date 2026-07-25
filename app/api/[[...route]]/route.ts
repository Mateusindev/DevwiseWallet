import { handle } from "hono/vercel";
import { app } from "@/server/app";

// O app Hono (rotas + onError) vive em server/app.ts; aqui só é plugado no
// runtime do Next. Ver server/app.ts.
export type { AppType } from "@/server/app";

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
