// Conta de testes — idempotente.
//   bun run seed:test [email] [senha] [roles-csv] [--no-data]
//   defaults: teste@wallet.local / teste123 / membro,leitor (+ dados de exemplo)
//
// Serve pra QA manual e pra logar no app sem tocar na conta admin. Roda contra
// o DATABASE_URL do ambiente — em CI/testes, aponte pro banco de teste:
//   TEST_DATABASE_URL=... bun run test:db:setup
//
// Roles: as padrão (server/auth/default-roles.ts) são upsertadas antes.
// "membro" cobre o app inteiro; "leitor" agrega cartao:view_shared ("o que devo").
// Nenhuma das duas dá admin/dev — pra isso use `bun run seed:auth`.
import { prisma } from "../server/lib/prisma";
import { hashPassword } from "../server/auth/password";
import { seedDefaultRoles } from "../server/auth/default-roles";
import { reseed } from "../server/modules/dev/seed";

const argv = process.argv.slice(2).filter((a) => a !== "--no-data");
const comDados = !process.argv.includes("--no-data");

const email = (argv[0] ?? "teste@wallet.local").toLowerCase();
const senha = argv[1] ?? "teste123";
const roleNomes = (argv[2] ?? "membro,leitor").split(",").map((r) => r.trim()).filter(Boolean);

await seedDefaultRoles(prisma);

const roles = await prisma.role.findMany({ where: { nome: { in: roleNomes } } });
const faltando = roleNomes.filter((n) => !roles.some((r) => r.nome === n));
if (faltando.length) {
  console.error(`role inexistente: ${faltando.join(", ")}`);
  process.exit(1);
}

// senha/roles/ativo sempre reafirmados — script é o dono do estado dessa conta
const user = await prisma.user.upsert({
  where: { email },
  create: {
    email,
    nome: "Conta de Testes",
    senhaHash: hashPassword(senha),
    ativo: true,
    roles: { create: roles.map((r) => ({ roleId: r.id })) },
  },
  update: {
    senhaHash: hashPassword(senha),
    ativo: true,
    roles: { deleteMany: {}, create: roles.map((r) => ({ roleId: r.id })) },
  },
  select: { id: true, email: true },
});

if (comDados) await reseed(user.id);

console.log(`✔ conta de testes: ${user.email} / senha: ${senha}`);
console.log(`  roles: ${roleNomes.join(", ")}`);
console.log(`  dados de exemplo: ${comDados ? "sim" : "não (--no-data)"}`);

await prisma.$disconnect();
