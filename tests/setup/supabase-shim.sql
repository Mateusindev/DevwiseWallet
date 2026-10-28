-- Imitação mínima do que o Supabase já traz pronto, pra rodar a migração de RLS
-- (`prisma/manual/20261028-rls-leitura-direta.sql`) num Postgres comum: os
-- roles da API (`anon`, `authenticated`, `authenticator`) e `auth.uid()`.
--
-- NUNCA aplicar no Supabase — lá tudo isso existe e é do sistema.
-- Usado pelo teste de integração de RLS e pelo PostgREST local.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit password 'authenticator';
  end if;
end
$$;

grant anon, authenticated to authenticator;
grant usage on schema public to anon, authenticated;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated;

-- Mesma definição do Supabase: lê o `sub` das claims que o PostgREST (ou o
-- teste, com set_config) colocou na transação.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
