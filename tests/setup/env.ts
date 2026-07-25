// Preload de TODOS os testes (registrado em bunfig.toml → [test].preload).
//
// Aponta o Prisma pro banco de teste ANTES de qualquer import de
// server/lib/prisma (o PrismaClient lê DATABASE_URL na construção). Isso vale
// também pros testes unitários: mesmo que um mock de repositório escape, o
// máximo que acontece é escrever no banco de teste — nunca no de desenvolvimento.

export const DEFAULT_TEST_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5432/cofre_test";

const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;

// Guarda: banco de teste precisa se chamar como tal. Evita que um
// TEST_DATABASE_URL mal configurado trunque o banco de desenvolvimento.
if (!/test/i.test(new URL(url).pathname)) {
  throw new Error(
    `TEST_DATABASE_URL precisa apontar pra um banco com "test" no nome (recebido: ${url}). ` +
      "Os testes de integração truncam todas as tabelas."
  );
}

process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
process.env.AUTH_SECRET ??= "test-secret-integracao";
// NODE_ENV=test já vem do `bun test`; explícito porque auth/dev checam produção.
// (cast: o @types/node do Next declara NODE_ENV como readonly)
(process.env as { NODE_ENV?: string }).NODE_ENV = "test";
