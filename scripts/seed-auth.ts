// Seed idempotente de roles + usuário admin.
//   bun scripts/seed-auth.ts [email] [senha]
// Roles são upsertadas (permissions sempre atualizadas pra versão de
// server/auth/default-roles.ts); o admin só é criado se não existir.
import { prisma } from "../server/lib/prisma";
import { hashPassword } from "../server/auth/password";
import { seedDefaultRoles } from "../server/auth/default-roles";

const email = (process.argv[2] ?? "admin@wallet.local").toLowerCase();
const senha = process.argv[3] ?? "admin123";

for (const r of await seedDefaultRoles(prisma)) {
  console.log(`role ok: ${r.nome} [${r.permissions.join(", ")}]`);
}

const existing = await prisma.user.findUnique({ where: { email } });
if (existing) {
  console.log(`admin já existe: ${email}`);
} else {
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { nome: "admin" } });
  await prisma.user.create({
    data: {
      email,
      nome: "Admin",
      senhaHash: hashPassword(senha),
      roles: { create: [{ roleId: adminRole.id }] },
    },
  });
  console.log(`admin criado: ${email} / senha: ${senha} — TROCAR depois`);
}

await prisma.$disconnect();
