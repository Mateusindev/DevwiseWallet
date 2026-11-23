-- Caixinha rendendo % do CDI + Selic atual por usuário.
-- Aditiva (duas colunas nullable). Aplicar com:
--   bunx prisma db execute --file prisma/manual/20261122-caixinha-cdi.sql --schema prisma/schema.prisma
-- RLS: as policies de SELECT já cobrem as tabelas inteiras (colunas novas
-- entram sozinhas na leitura direta).
alter table public.caixinhas    add column if not exists percentual_cdi decimal(6, 2);
alter table public.app_settings add column if not exists selic          decimal(5, 2);
