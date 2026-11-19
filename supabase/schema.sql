-- =====================================================================
-- Mapa das Congregações – Distrito Icoaraci
-- Esquema do banco (Supabase / PostgreSQL). Execute no SQL Editor do Supabase.
-- Pode ser executado de novo sem perder dados (idempotente).
--
-- Papéis de usuário:
--   pendente – criou a conta e aguarda aprovação (não vê nada)
--   leitor   – vê o mapa e as análises
--   editor   – além de ver, edita/posiciona as congregações da SUA área
--   admin    – edita tudo, importa planilha e aprova/gerencia usuários
-- =====================================================================

-- ---------- Tabelas ----------
-- 33 áreas numeradas + 2 grupos à parte, cada uma num dos 5 setores.
create table if not exists public.areas (
  nome         text primary key check (
                 nome ~ '^Área ([1-9]|[12][0-9]|3[0-3])$'
                 or nome in ('Templo Central', 'Manancial de Bênção')),
  setor        smallint check (setor between 1 and 5),
  responsavel  text,                     -- pastor/evangelista/presbítero responsável
  ordem        smallint not null default 0
);

create table if not exists public.perfis (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  nome       text,
  papel      text not null default 'pendente'
             check (papel in ('pendente', 'leitor', 'editor', 'admin')),
  area       text references public.areas(nome) on update cascade on delete set null, -- área do editor
  criado_em  timestamptz not null default now()
);

create table if not exists public.congregacoes (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (length(trim(nome)) > 0),
  area           text not null references public.areas(nome) on update cascade,
  sede_area      boolean not null default false,   -- congregação-sede da área
  bairro         text,
  localidade     text,                              -- comunidade/conjunto (ex.: Tapajós, Eduardo Angelim)
  dirigente      text,
  endereco       text,
  observacoes    text,
  -- Coordenadas WGS84; a faixa cobre a Grande Belém e evita pontos invertidos/errados.
  lat            double precision check (lat between -1.60 and -1.00),
  lng            double precision check (lng between -48.70 and -48.20),
  constraint coordenadas_completas check ((lat is null) = (lng is null)),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid references auth.users(id) on delete set null
);

-- No máximo uma sede por área.
create unique index if not exists congregacoes_uma_sede_por_area
  on public.congregacoes (area) where sede_area;

create table if not exists public.historico (
  id             bigint generated always as identity primary key,
  congregacao_id uuid,
  acao           text not null,          -- inclusão | alteração | exclusão
  antes          jsonb,
  depois         jsonb,
  usuario        uuid,
  usuario_email  text,
  em             timestamptz not null default now()
);
create index if not exists historico_congregacao on public.historico (congregacao_id, em desc);

-- ---------- Funções auxiliares ----------
create or replace function public.meu_papel() returns text
  language sql stable security definer set search_path = public as
$$ select papel from public.perfis where id = auth.uid() $$;

create or replace function public.minha_area() returns text
  language sql stable security definer set search_path = public as
$$ select area from public.perfis where id = auth.uid() $$;

-- Define a sede de uma área (desmarca a anterior). Respeita as permissões de quem chama.
create or replace function public.definir_sede(cid uuid) returns void
  language plpgsql security invoker set search_path = public as
$$
declare a text;
begin
  select area into a from public.congregacoes where id = cid;
  if a is null then raise exception 'Congregação não encontrada ou sem permissão'; end if;
  update public.congregacoes set sede_area = false where area = a and sede_area and id <> cid;
  update public.congregacoes set sede_area = true where id = cid;
  if not found then raise exception 'Sem permissão para alterar esta congregação'; end if;
end
$$;

-- ---------- Gatilhos ----------
-- Cria o perfil (pendente) quando alguém se cadastra.
create or replace function public.novo_usuario() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  insert into public.perfis (id, email, nome)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end
$$;
drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.novo_usuario();

-- Só administradores mudam papel, área e e-mail de um perfil.
-- (Comandos rodados direto no SQL Editor – papel "postgres" – não são bloqueados.)
create or replace function public.proteger_perfil() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if current_user in ('authenticated', 'anon') and coalesce(public.meu_papel(), '') <> 'admin' then
    new.papel := old.papel; new.area := old.area; new.email := old.email;
  end if;
  return new;
end
$$;
drop trigger if exists proteger_perfil on public.perfis;
create trigger proteger_perfil before update on public.perfis
  for each row execute function public.proteger_perfil();

-- Carimbo de quem alterou e quando.
create or replace function public.carimbar() returns trigger
  language plpgsql as
$$
begin
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  return new;
end
$$;
drop trigger if exists carimbar on public.congregacoes;
create trigger carimbar before insert or update on public.congregacoes
  for each row execute function public.carimbar();

-- Histórico de todas as mudanças.
create or replace function public.registrar_historico() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  insert into public.historico (congregacao_id, acao, antes, depois, usuario, usuario_email)
  values (
    coalesce(new.id, old.id),
    case tg_op when 'INSERT' then 'inclusão' when 'UPDATE' then 'alteração' else 'exclusão' end,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    auth.uid(),
    (select email from public.perfis where id = auth.uid()));
  return null;
end
$$;
drop trigger if exists registrar_historico on public.congregacoes;
create trigger registrar_historico after insert or update or delete on public.congregacoes
  for each row execute function public.registrar_historico();

-- ---------- Segurança por linha (RLS) ----------
alter table public.areas        enable row level security;
alter table public.perfis       enable row level security;
alter table public.congregacoes enable row level security;
alter table public.historico    enable row level security;

drop policy if exists areas_ver on public.areas;
create policy areas_ver on public.areas for select to authenticated
  using (public.meu_papel() in ('leitor', 'editor', 'admin'));
drop policy if exists areas_gerir on public.areas;
create policy areas_gerir on public.areas for all to authenticated
  using (public.meu_papel() = 'admin') with check (public.meu_papel() = 'admin');

drop policy if exists perfis_ver on public.perfis;
create policy perfis_ver on public.perfis for select to authenticated
  using (id = auth.uid() or public.meu_papel() = 'admin');
drop policy if exists perfis_editar on public.perfis;
create policy perfis_editar on public.perfis for update to authenticated
  using (id = auth.uid() or public.meu_papel() = 'admin');
drop policy if exists perfis_excluir on public.perfis;
create policy perfis_excluir on public.perfis for delete to authenticated
  using (public.meu_papel() = 'admin' and id <> auth.uid());

drop policy if exists congregacoes_ver on public.congregacoes;
create policy congregacoes_ver on public.congregacoes for select to authenticated
  using (public.meu_papel() in ('leitor', 'editor', 'admin'));
drop policy if exists congregacoes_incluir on public.congregacoes;
create policy congregacoes_incluir on public.congregacoes for insert to authenticated
  with check (public.meu_papel() = 'admin'
              or (public.meu_papel() = 'editor' and area = public.minha_area()));
drop policy if exists congregacoes_editar on public.congregacoes;
create policy congregacoes_editar on public.congregacoes for update to authenticated
  using      (public.meu_papel() = 'admin' or (public.meu_papel() = 'editor' and area = public.minha_area()))
  with check (public.meu_papel() = 'admin' or (public.meu_papel() = 'editor' and area = public.minha_area()));
drop policy if exists congregacoes_excluir on public.congregacoes;
create policy congregacoes_excluir on public.congregacoes for delete to authenticated
  using (public.meu_papel() = 'admin');

drop policy if exists historico_ver on public.historico;
create policy historico_ver on public.historico for select to authenticated
  using (public.meu_papel() in ('editor', 'admin'));

-- ---------- Permissões de acesso às tabelas ----------
-- Explícitas para não depender dos privilégios padrão do projeto. Quem pode ver/alterar cada linha
-- continua sendo decidido pelas regras de RLS acima; visitantes sem login (anon) não recebem nada.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.areas, public.perfis, public.congregacoes to authenticated;
grant select on public.historico to authenticated;
grant execute on function public.meu_papel(), public.minha_area(), public.definir_sede(uuid) to authenticated;
revoke all on public.areas, public.perfis, public.congregacoes, public.historico from anon;

-- ---------- Tempo real (mudanças aparecem na hora para todos) ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and tablename = 'congregacoes') then
    alter publication supabase_realtime add table public.congregacoes;
  end if;
end
$$;

-- ---------- Primeiro administrador ----------
-- Depois de criar sua conta pelo site, rode (trocando o e-mail):
--   update public.perfis set papel = 'admin' where email = 'seu-email@exemplo.com';
