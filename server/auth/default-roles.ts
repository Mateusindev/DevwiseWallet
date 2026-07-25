import type { PrismaClient } from "@prisma/client";

// Roles padrão do produto — fonte única usada pelos seeds (scripts/seed-auth.ts,
// scripts/seed-test-account.ts) e pelos testes de integração.
// RBAC → PBAC: role = rótulo de atribuição; permissions granulares mandam.
export const DEFAULT_ROLES: { nome: string; descricao: string; permissions: string[] }[] = [
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
      "cartao:view_shared", // ver o que devo nas faturas de outras pessoas
      "categoria:view",
      "espaco:view",
      "orcamento:view",
    ],
  },
];

// Upsert idempotente das roles padrão (permissions sempre atualizadas pra
// versão daqui).
export async function seedDefaultRoles(db: Pick<PrismaClient, "role">) {
  for (const r of DEFAULT_ROLES) {
    await db.role.upsert({
      where: { nome: r.nome },
      create: r,
      update: { descricao: r.descricao, permissions: r.permissions },
    });
  }
  return DEFAULT_ROLES;
}
