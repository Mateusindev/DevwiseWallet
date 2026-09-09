import { PrismaClient } from "@prisma/client";

// Singleton via globalThis — evita esgotar conexões no hot-reload do Next.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// PRISMA_QUERY_LOG=1 emite o evento "query" — é como scripts/bench.ts conta
// quantas idas ao banco cada cenário custa (ver Fase 0.6 do plano).
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(
    process.env.PRISMA_QUERY_LOG === "1"
      ? { log: [{ emit: "event", level: "query" }] }
      : undefined
  );

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
