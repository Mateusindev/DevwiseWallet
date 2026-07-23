// Seed idempotente de roles + usuário admin.
//   bun scripts/seed-auth.ts [email] [senha]
// Roles são upsertadas (permissions sempre atualizadas pra versão daqui);
// o admin só é criado se não existir.
import { prisma } from "../server/lib/prisma";
import { hashPassword } from "../server/auth/password";

// RBAC → PBAC: role = rótulo de atribuição; permissions granulares mandam.
const ROLES: { nome: string; descricao: string; permissions: string[] }[] = [
  {
    nome: "admin",
    descricao: "Acesso total, incluindo utilitários de dev",
    permissions: ["*"],
  },
  {
    nome: "membro",
    descricao: "Usa o app inteiro; sem utilitários de dev/admin",
    permissions: [
      "state:view",
      "caixinha:*",
      "movimentacao:*",
      "cartao:*",
      "categoria:*",
      "espaco:*",
      "orcamento:*",
    ],
  },
  {
    nome: "leitor",
    descricao: "Só visualização",
    permissions: [
      "state:view",
      "caixinha:view",
      "movimentacao:view",
      "cartao:view",
      "categoria:view",
      "espaco:view",
      "orcamento:view",
    ],
  },
];

const email = (process.argv[2] ?? "admin@wallet.local").toLowerCase();
const senha = process.argv[3] ?? "admin123";

for (const r of ROLES) {
  await prisma.role.upsert({
    where: { nome: r.nome },
    create: r,
    update: { descricao: r.descricao, permissions: r.permissions },
  });
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
