-- Matriz de permissões: TODAS as páginas passam a gerir-se por perfil e por pessoa, sem regras fixas.
--
-- Páginas que não dependem de capítulo («livres»): balanco-fat, carteira, telas-finais, fornecedores,
-- planos-trabalho, guias-teste, compras-teste. Ligam-se em app_config/access_overrides:
--   roles.<perfil>.on  = [páginas]   ·   users.<username>.on = [páginas] (substitui a do perfil, como «off»)
-- e continuam a poder ser fechadas com «off». O servidor decide com fn_pag_on(página).
-- As antigas listas (clientes_acesso, telas_finais_acesso e os usernames fixos dos Planos de Trabalho)
-- passam para «on» de cada pessoa; as regras fixas por perfil (faturas/tesouraria/estrutura central)
-- passam para «off» do perfil e de quem tem exceções — ninguém ganha nem perde acesso com esta migração.

-- ── 1. Função de acesso às páginas livres ──
create or replace function public.fn_pag_on(p_sec text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $f$
  select case
    when public.fn_my_role() is null then false
    when public.fn_my_role() = 'admin' then true
    when public.fn_sec_off(p_sec) then false
    else coalesce(
      (select (c.value #> array['users', public.fn_my_username(), 'on']) ? p_sec
         from public.app_config c where c.key = 'access_overrides'
          and c.value #> array['users', public.fn_my_username(), 'on'] is not null),
      (select (c.value #> array['roles', public.fn_my_role(), 'on']) ? p_sec
         from public.app_config c where c.key = 'access_overrides'
          and c.value #> array['roles', public.fn_my_role(), 'on'] is not null),
      false)
  end;
$f$;
revoke all on function public.fn_pag_on(text) from public, anon;
grant execute on function public.fn_pag_on(text) to authenticated;

-- ── 2. Converter as regras antigas para a matriz (sem mudar quem vê o quê) ──
create or replace function pg_temp.uniao(a jsonb, b text[]) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(distinct x order by x), '[]'::jsonb)
    from (select jsonb_array_elements_text(coalesce(a, '[]'::jsonb)) x union select unnest(b)) t;
$$;

do $$
declare
  v jsonb;
  extra jsonb := jsonb_build_object(
    'diretor_obra', jsonb_build_array('estrutura-central'),
    'compras',      jsonb_build_array('faturas', 'tesouraria', 'faturas-aprovar', 'estrutura-central'));
  omissao jsonb := jsonb_build_object('diretor_obra', jsonb_build_array('faturas', 'tesouraria'), 'compras', '[]'::jsonb);
  r text; u text; papel text; lst jsonb; pags text[];
begin
  select value into v from public.app_config where key = 'access_overrides';
  v := jsonb_build_object('roles', coalesce(v -> 'roles', '{}'::jsonb), 'users', coalesce(v -> 'users', '{}'::jsonb));

  -- perfis: «off» explícito com as páginas que antes eram bloqueadas por regra fixa
  foreach r in array array['diretor_obra', 'compras'] loop
    v := jsonb_set(v, array['roles', r], coalesce(v #> array['roles', r], '{}'::jsonb) || jsonb_build_object('off',
           pg_temp.uniao(coalesce(v #> array['roles', r, 'off'], omissao -> r), array(select jsonb_array_elements_text(extra -> r)))));
  end loop;

  -- pessoas com «off» próprio (substitui o do perfil): recebem os mesmos bloqueios do seu perfil
  for u in select jsonb_object_keys(v -> 'users') loop
    if (v #> array['users', u]) ? 'off' then
      select role into papel from public.utilizadores where username = u;
      if papel in ('diretor_obra', 'compras') then
        v := jsonb_set(v, array['users', u, 'off'],
               pg_temp.uniao(v #> array['users', u, 'off'], array(select jsonb_array_elements_text(extra -> papel))));
      end if;
    end if;
  end loop;

  -- páginas livres: as listas antigas passam a «on» de cada pessoa
  for lst, pags in
    select coalesce((select value from public.app_config where key = 'clientes_acesso'), '[]'::jsonb), array['balanco-fat', 'carteira']
    union all select coalesce((select value from public.app_config where key = 'telas_finais_acesso'), '[]'::jsonb), array['telas-finais']
    union all select '["david.mosca", "manuel.fonseca"]'::jsonb, array['planos-trabalho']
  loop
    if jsonb_typeof(lst) <> 'array' then continue; end if;
    for u in select jsonb_array_elements_text(lst) loop
      select role into papel from public.utilizadores where username = u;
      if papel is null or papel = 'admin' then continue; end if;
      v := jsonb_set(v, array['users', u], coalesce(v #> array['users', u], '{}'::jsonb));
      v := jsonb_set(v, array['users', u, 'on'], pg_temp.uniao(v #> array['users', u, 'on'], pags));
    end loop;
  end loop;

  insert into public.app_config (key, value, updated_at) values ('access_overrides', v, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- ── 3. Clientes, Telas Finais e Planos de Trabalho seguem a matriz ──
create or replace function public.fn_clientes_acesso()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select public.fn_pag_on('balanco-fat') or public.fn_pag_on('carteira');
$$;

create or replace function public.fn_tf_acesso()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select public.fn_pag_on('telas-finais');
$$;

drop policy if exists so_david on public.planos_trabalho;
drop policy if exists pagina on public.planos_trabalho;
create policy pagina on public.planos_trabalho for all to authenticated
  using (public.fn_pag_on('planos-trabalho')) with check (public.fn_pag_on('planos-trabalho'));
drop policy if exists so_david on public.planos_trabalho_versoes;
drop policy if exists pagina on public.planos_trabalho_versoes;
create policy pagina on public.planos_trabalho_versoes for all to authenticated
  using (public.fn_pag_on('planos-trabalho')) with check (public.fn_pag_on('planos-trabalho'));

-- ── 4. Estrutura Central: quem tem o Financeiro e a página ligada (antes: só os perfis admin/financeiro) ──
drop policy if exists estrutura_central_so_financeiro on public.faturas;
create policy estrutura_central_so_financeiro on public.faturas
  as restrictive for all to authenticated
  using (
    coalesce(centro_custo, '') not ilike 'O099%'
    or public.fn_my_role() = 'admin'
    or (public.fn_cap('fin') and not public.fn_sec_off('estrutura-central'))
  )
  with check (
    coalesce(centro_custo, '') not ilike 'O099%'
    or public.fn_my_role() = 'admin'
    or (public.fn_cap('fin') and not public.fn_sec_off('estrutura-central'))
  );

-- ── 5. Lista de Fornecedores: quem tem a página pode editar (antes: só o capítulo Definições) ──
-- ── 6. Sistemas de teste (gt_* = Guias de Remessa (teste), ct_* = Compras (teste)): antes só o administrador ──
do $$
declare p record; q text; w text; pag text; resto int;
begin
  for p in select tablename, policyname, qual, with_check from pg_policies
           where schemaname = 'public' and (tablename = 'fornecedores' or tablename like 'gt\_%' or tablename like 'ct\_%')
  loop
    if p.tablename = 'fornecedores' then
      q := replace(p.qual, 'fn_cap(''def''::text)', '(fn_cap(''def''::text) OR fn_pag_on(''fornecedores''::text))');
      w := replace(p.with_check, 'fn_cap(''def''::text)', '(fn_cap(''def''::text) OR fn_pag_on(''fornecedores''::text))');
    else
      pag := case when p.tablename like 'gt\_%' then 'guias-teste' else 'compras-teste' end;
      q := regexp_replace(p.qual, '(public\.)?fn_my_role\(\) = ''admin''::text', format('fn_pag_on(%L::text)', pag), 'g');
      w := regexp_replace(p.with_check, '(public\.)?fn_my_role\(\) = ''admin''::text', format('fn_pag_on(%L::text)', pag), 'g');
    end if;
    if q is not distinct from p.qual and w is not distinct from p.with_check then continue; end if;
    if q is not null and w is not null then
      execute format('alter policy %I on public.%I using (%s) with check (%s)', p.policyname, p.tablename, q, w);
    elsif q is not null then
      execute format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename, q);
    else
      execute format('alter policy %I on public.%I with check (%s)', p.policyname, p.tablename, w);
    end if;
  end loop;

  -- as Compras (teste) também leem as guias do sistema de teste das guias
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gt_guias' and policyname = 'gt_guias_ler') then
    alter policy gt_guias_ler on public.gt_guias using (fn_pag_on('guias-teste') or fn_pag_on('compras-teste'));
  end if;

  -- não pode ficar nenhuma regra «só administrador» nestas tabelas
  select count(*) into resto from pg_policies
   where schemaname = 'public' and (tablename like 'gt\_%' or tablename like 'ct\_%')
     and (coalesce(qual, '') ~ 'fn_my_role\(\) = ''admin''' or coalesce(with_check, '') ~ 'fn_my_role\(\) = ''admin''');
  if resto > 0 then raise exception 'Ainda há % policies só para o administrador nas tabelas gt_/ct_', resto; end if;
end $$;

-- gt_importar_faturas: a verificação «só administrador» passa a ser a página Guias de Remessa (teste)
do $$
declare def text; novo text;
begin
  def := pg_get_functiondef('public.gt_importar_faturas()'::regprocedure);
  novo := replace(def, 'fn_my_role() is distinct from ''admin''', 'not fn_pag_on(''guias-teste'')');
  if novo = def then raise exception 'gt_importar_faturas: verificação de administrador não encontrada'; end if;
  execute novo;
end $$;
