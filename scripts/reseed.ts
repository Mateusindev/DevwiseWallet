import { reseed } from "@/server/modules/dev/seed";

// Restaura os dados de exemplo (mesmo reseed do POST /api/dev/reset).
// Uso: bun run seed:dev
await reseed();
console.log("✔ dados de exemplo restaurados");
process.exit(0);
