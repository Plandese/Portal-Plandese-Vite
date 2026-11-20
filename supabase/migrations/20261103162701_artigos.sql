-- Base de dados de materiais (catálogo de artigos) na Supabase.
-- Antes vivia só no ficheiro public/artigos-data.js; agora a tabela é a fonte e o ficheiro fica como cópia de arranque (offline/primeiro carregamento).
-- O portal pede o catálogo completo em UMA chamada (artigos_catalogo) no formato antigo: { "100_Metal": { label, items: [[código, designação, unidade], …] }, … }

create table if not exists artigos_grupos (
  chave text primary key,            -- ex.: 100_Metal
  label text not null,               -- ex.: Aço e Metais
  ordem int not null default 0
);
create table if not exists artigos (
  id bigint generated always as identity primary key,
  grupo text not null references artigos_grupos(chave) on update cascade on delete cascade,
  codigo text not null default '',   -- há artigos de mão-de-obra sem código
  designacao text not null default '',
  unidade text not null default '',
  ordem int not null default 0,
  atualizado_em timestamptz not null default now()
);
create index if not exists artigos_codigo_idx on artigos (codigo);
create index if not exists artigos_grupo_idx on artigos (grupo, ordem);

alter table artigos_grupos enable row level security;
alter table artigos enable row level security;
drop policy if exists artigos_grupos_ler on artigos_grupos;
create policy artigos_grupos_ler on artigos_grupos for select to authenticated using (true);
drop policy if exists artigos_grupos_admin on artigos_grupos;
create policy artigos_grupos_admin on artigos_grupos for all to authenticated using (fn_my_role() = 'admin') with check (fn_my_role() = 'admin');
drop policy if exists artigos_ler on artigos;
create policy artigos_ler on artigos for select to authenticated using (true);
drop policy if exists artigos_admin on artigos;
create policy artigos_admin on artigos for all to authenticated using (fn_my_role() = 'admin') with check (fn_my_role() = 'admin');

-- json (e não jsonb) para manter a ordem dos grupos e dos artigos
create or replace function artigos_catalogo() returns json language sql stable as $$
  select coalesce(json_object_agg(g.chave, json_build_object('label', g.label, 'items', coalesce(i.items, '[]'::json)) order by g.ordem), '{}'::json)
  from artigos_grupos g
  left join lateral (select json_agg(json_build_array(a.codigo, a.designacao, a.unidade) order by a.ordem, a.id) items from artigos a where a.grupo = g.chave) i on true
$$;
-- muda sempre que o catálogo muda: o portal só volta a descarregar quando a versão é outra
create or replace function artigos_versao() returns text language sql stable as $$
  select (select count(*) from artigos) || '-' || coalesce((select max(atualizado_em)::text from artigos), '') || '-' || (select count(*) from artigos_grupos)
$$;
grant execute on function artigos_catalogo() to authenticated;
grant execute on function artigos_versao() to authenticated;
revoke execute on function artigos_catalogo() from anon;
revoke execute on function artigos_versao() from anon;
