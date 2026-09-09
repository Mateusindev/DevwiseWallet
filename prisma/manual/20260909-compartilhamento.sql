-- Migração aditiva — compartilhamento N-a-N, agenda com aceite e adoção de dívida.
-- Gerado com `prisma migrate diff` e revisado: só CREATE TYPE / CREATE TABLE /
-- ADD COLUMN / DROP NOT NULL / CREATE INDEX / ADD FOREIGN KEY. Nada destrutivo.
--
-- ANTES DE APLICAR: os dois uniques novos falham se o mesmo contato já estiver
-- duas vezes na mesma linha. Rode as checagens abaixo e resolva na mão se
-- alguma delas voltar linha:
--
--   SELECT despesa_fixa_id, contato_id, count(*) FROM cartao_shares
--    WHERE despesa_fixa_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1;
--   SELECT despesa_mes_id, contato_id, count(*) FROM cartao_shares
--    WHERE despesa_mes_id IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1;
--
-- Aplicar:  bunx prisma db execute --schema prisma/schema.prisma --file <este arquivo>
-- NUNCA `prisma db push --accept-data-loss` contra o Supabase (tem usuário real lá).

-- CreateEnum
CREATE TYPE "contato_status" AS ENUM ('local', 'convidado', 'ativo', 'recusado');

-- CreateEnum
CREATE TYPE "share_adocao_modo" AS ENUM ('fixa', 'mes', 'ignorado');

-- AlterTable
ALTER TABLE "contatos" ADD COLUMN     "convidado_em" TIMESTAMPTZ(6),
ADD COLUMN     "espelho_de_id" UUID,
ADD COLUMN     "respondido_em" TIMESTAMPTZ(6),
ADD COLUMN     "status" "contato_status" NOT NULL DEFAULT 'local';

-- AlterTable
ALTER TABLE "cartao_shares" ALTER COLUMN "cartao_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "despesas_fixas" ADD COLUMN     "abate_shares" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "despesas_mes" ADD COLUMN     "abate_shares" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "convites" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "contato_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "contato_status" NOT NULL DEFAULT 'convidado',
    "expira_em" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "convites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_adocoes" (
    "share_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "modo" "share_adocao_modo" NOT NULL,
    "espaco_id" UUID,
    "despesa_fixa_id" UUID,
    "despesa_mes_id" UUID,
    "valor_adotado" DECIMAL(12,2),
    "quitado_ate" CHAR(7),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "share_adocoes_pkey" PRIMARY KEY ("share_id")
);

-- CreateTable
CREATE TABLE "share_adiantamentos" (
    "id" UUID NOT NULL,
    "share_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "ym" CHAR(7) NOT NULL,
    "cobre_ate" CHAR(7) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_adiantamentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "convites_token_key" ON "convites"("token");

-- CreateIndex
CREATE INDEX "convites_email_idx" ON "convites"("email");

-- CreateIndex
CREATE INDEX "convites_contato_id_idx" ON "convites"("contato_id");

-- CreateIndex
CREATE INDEX "share_adocoes_user_id_idx" ON "share_adocoes"("user_id");

-- CreateIndex
CREATE INDEX "share_adiantamentos_share_id_idx" ON "share_adiantamentos"("share_id");

-- CreateIndex
CREATE INDEX "share_adiantamentos_user_id_idx" ON "share_adiantamentos"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "share_fixa_contato_key" ON "cartao_shares"("despesa_fixa_id", "contato_id");

-- CreateIndex
CREATE UNIQUE INDEX "share_mes_contato_key" ON "cartao_shares"("despesa_mes_id", "contato_id");

-- AddForeignKey
ALTER TABLE "contatos" ADD CONSTRAINT "contatos_espelho_de_id_fkey" FOREIGN KEY ("espelho_de_id") REFERENCES "contatos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convites" ADD CONSTRAINT "convites_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convites" ADD CONSTRAINT "convites_contato_id_fkey" FOREIGN KEY ("contato_id") REFERENCES "contatos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_adocoes" ADD CONSTRAINT "share_adocoes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_adocoes" ADD CONSTRAINT "share_adocoes_espaco_id_fkey" FOREIGN KEY ("espaco_id") REFERENCES "espacos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_adocoes" ADD CONSTRAINT "share_adocoes_despesa_fixa_id_fkey" FOREIGN KEY ("despesa_fixa_id") REFERENCES "despesas_fixas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_adocoes" ADD CONSTRAINT "share_adocoes_despesa_mes_id_fkey" FOREIGN KEY ("despesa_mes_id") REFERENCES "despesas_mes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_adiantamentos" ADD CONSTRAINT "share_adiantamentos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Grandfather (decisão 9.1 do plano): quem já estava vinculado continua vendo os
-- shares — ninguém perde acesso numa atualização. Contato sem conta atrelada
-- segue "local" e passa a exigir convite.
UPDATE "contatos" SET "status" = 'ativo', "respondido_em" = now() WHERE "user_id" IS NOT NULL;
