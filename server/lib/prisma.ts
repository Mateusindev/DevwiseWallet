import { PrismaClient } from "@prisma/client";

// Singleton via globalThis — evita esgotar conexões no hot-reload do Next.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
