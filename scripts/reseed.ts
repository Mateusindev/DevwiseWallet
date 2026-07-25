import { prisma } from "@/server/lib/prisma";
import { reseed } from "@/server/modules/dev/seed";

// Restaura os dados de exemplo de um usuário (mesmo reseed do POST /api/dev/reset).
// Uso: bun run seed:dev [email] — sem email, usa o usuário mais antigo do banco.
const email = process.argv[2]?.toLowerCase();
const user = email
  ? await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } })
  : await prisma.user.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, email: true } });

if (!user) {
  console.error(
    email
      ? `usuário não encontrado: ${email}`
      : "nenhum usuário no banco — rode antes: bun run seed:auth"
  );
  process.exit(1);
}

await reseed(user.id);
console.log(`✔ dados de exemplo restaurados para ${user.email}`);
process.exit(0);
