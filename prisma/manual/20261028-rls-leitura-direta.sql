-- Leitura direta do Supabase (PostgREST) pelo navegador — RLS de LEITURA.
--
-- Aplicar no Supabase com:
--   bunx prisma db execute --file prisma/manual/20261028-rls-leitura-direta.sql --schema prisma/schema.prisma
-- (usa a DIRECT_URL). Idempotente: pode rodar de novo.
--
-- O que muda:
--   · RLS LIGADO em TODAS as tabelas do schema public. Hoje elas estão expostas
--     pela API REST do Supabase pra qualquer um com a anon key (inclusive
--     `users.senha_hash`) — com RLS ligado e sem policy, anon não vê nada.
--   · Policies SÓ de SELECT, SÓ pro role `authenticated`, SÓ nas tabelas que o
--     navegador lê (orçamento, cartões, caixinhas, categorias, espaços), e SÓ
--     linhas do próprio dono — o mesmo escopo que os repositories aplicam
--     (`userId`, ou a relação até o dono). Nenhuma policy de escrita: toda
--     escrita continua nas Server Actions (Prisma), com as regras de negócio.
--   · users, roles, user_roles, convites, share_adocoes e share_adiantamentos
--     ficam sem policy nenhuma: só o servidor lê.
--
-- Por que o servidor (Prisma) não é afetado: ele conecta como `postgres`, que é
-- o DONO das tabelas (criadas pelo `prisma db push`), e RLS não vale pro dono
-- sem FORCE. Conferir antes de aplicar:
--   select tablename, tableowner from pg_tables where schemaname = 'public';
-- Se alguma tabela tiver outro dono, NÃO aplicar sem ajustar.
--
-- O token que chega no PostgREST é emitido pelo próprio app
-- (`server/auth/supabase-token.ts`, assinado com SUPABASE_JWT_SECRET) com
-- `sub` = id do usuário em `users` e `role` = authenticated — `auth.uid()` é
-- esse id.

begin;

-- ── RLS em tudo ─────────────────────────────────────────────────────────────
alter table public.users               enable row level security;
alter table public.roles               enable row level security;
alter table public.user_roles          enable row level security;
alter table public.contatos            enable row level security;
alter table public.cartao_shares       enable row level security;
alter table public.caixinhas           enable row level security;
alter table public.movimentacoes       enable row level security;
alter table public.cartoes             enable row level security;
alter table public.categorias          enable row level security;
alter table public.espacos             enable row level security;
alter table public.espaco_mes_oculto   enable row level security;
alter table public.app_settings        enable row level security;
alter table public.despesas_fixas      enable row level security;
alter table public.pagamentos_fixas    enable row level security;
alter table public.despesas_mes        enable row level security;
alter table public.receitas_mes        enable row level security;
alter table public.receita_mes_skip    enable row level security;
alter table public.rendas_mensais      enable row level security;
alter table public.convites            enable row level security;
alter table public.share_adocoes       enable row level security;
alter table public.share_adiantamentos enable row level security;

-- ── Agregados raiz: coluna do dono ──────────────────────────────────────────
-- `(select auth.uid())` e não `auth.uid()`: vira initplan, avaliado uma vez
-- por query em vez de uma vez por linha.
drop policy if exists leitura_dono on public.caixinhas;
create policy leitura_dono on public.caixinhas
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists leitura_dono on public.cartoes;
create policy leitura_dono on public.cartoes
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists leitura_dono on public.categorias;
create policy leitura_dono on public.categorias
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists leitura_dono on public.espacos;
create policy leitura_dono on public.espacos
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists leitura_dono on public.app_settings;
create policy leitura_dono on public.app_settings
  for select to authenticated using (user_id = (select auth.uid()));

-- Contato: só a agenda do próprio dono (o rateio embutido na linha desenha as
-- iniciais). O lado de quem DEVE continua no servidor.
drop policy if exists leitura_dono on public.contatos;
create policy leitura_dono on public.contatos
  for select to authenticated using (owner_id = (select auth.uid()));

-- ── Filhos: herdam o dono pela FK ───────────────────────────────────────────
drop policy if exists leitura_dono on public.movimentacoes;
create policy leitura_dono on public.movimentacoes
  for select to authenticated using (
    caixinha_id in (select id from public.caixinhas where user_id = (select auth.uid()))
  );

drop policy if exists leitura_dono on public.espaco_mes_oculto;
create policy leitura_dono on public.espaco_mes_oculto
  for select to authenticated using (
    espaco_id in (select id from public.espacos where user_id = (select auth.uid()))
  );

drop policy if exists leitura_dono on public.despesas_fixas;
create policy leitura_dono on public.despesas_fixas
  for select to authenticated using (
    espaco_id in (select id from public.espacos where user_id = (select auth.uid()))
  );

drop policy if exists leitura_dono on public.pagamentos_fixas;
create policy leitura_dono on public.pagamentos_fixas
  for select to authenticated using (
    espaco_id in (select id from public.espacos where user_id = (select auth.uid()))
  );

drop policy if exists leitura_dono on public.despesas_mes;
create policy leitura_dono on public.despesas_mes
  for select to authenticated using (
    espaco_id in (select id from public.espacos where user_id = (select auth.uid()))
  );

drop policy if exists leitura_dono on public.receitas_mes;
create policy leitura_dono on public.receitas_mes
  for select to authenticated using (
    espaco_id in (select id from public.espacos where user_id = (select auth.uid()))
  );

drop policy if exists leitura_dono on public.rendas_mensais;
create policy leitura_dono on public.rendas_mensais
  for select to authenticated using (
    espaco_id in (select id from public.espacos where user_id = (select auth.uid()))
  );

drop policy if exists leitura_dono on public.receita_mes_skip;
create policy leitura_dono on public.receita_mes_skip
  for select to authenticated using (
    receita_id in (
      select r.id from public.receitas_mes r
      join public.espacos e on e.id = r.espaco_id
      where e.user_id = (select auth.uid())
    )
  );

-- Share: só os do próprio dono (posse é pelo contato — `contato.owner_id`).
drop policy if exists leitura_dono on public.cartao_shares;
create policy leitura_dono on public.cartao_shares
  for select to authenticated using (
    contato_id in (select id from public.contatos where owner_id = (select auth.uid()))
  );

-- ── Grants: só SELECT, só nas tabelas com policy ────────────────────────────
-- O Supabase dá ALL pros roles da API por default privileges; RLS já barra a
-- escrita (não há policy de insert/update/delete), e o revoke deixa explícito.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke select on all tables in schema public from anon;
grant select on
  public.caixinhas, public.movimentacoes, public.cartoes, public.categorias,
  public.espacos, public.espaco_mes_oculto, public.app_settings, public.contatos,
  public.despesas_fixas, public.pagamentos_fixas, public.despesas_mes,
  public.receitas_mes, public.receita_mes_skip, public.rendas_mensais,
  public.cartao_shares
  to authenticated;

-- ── Meses com lançamento (pontinhos do seletor de mês) ──────────────────────
-- O PostgREST não faz `group by`; isto é o `mesesComLancamento` do
-- espaco.repository. `security invoker`: roda com o RLS de quem chamou, então
-- espaço alheio devolve listas vazias.
create or replace function public.meses_com_lancamento(p_espaco uuid)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select json_build_object(
    'mesesComDespesa', coalesce(
      (select json_agg(m order by m) from (select distinct mes as m from despesas_mes where espaco_id = p_espaco) d),
      '[]'::json),
    'mesesComFatura', coalesce(
      (select json_agg(m order by m) from (select distinct mes as m from despesas_mes where espaco_id = p_espaco and cartao_id is not null) f),
      '[]'::json)
  );
$$;

revoke execute on function public.meses_com_lancamento(uuid) from public, anon;
grant execute on function public.meses_com_lancamento(uuid) to authenticated;

commit;
