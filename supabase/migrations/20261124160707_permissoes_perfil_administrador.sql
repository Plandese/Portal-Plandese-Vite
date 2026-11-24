-- Matriz de permissões: o perfil Administrador passa a ter coluna própria (páginas por perfil e exceções por pessoa).
-- Só a conta «admin» vê sempre tudo; os outros administradores seguem a matriz como os outros perfis.
-- Arranque sem perder acesso: o perfil Administrador fica com todos os capítulos e todas as páginas livres ligadas.
-- (As permissões próprias do administrador que não são páginas — app_config, utilizadores, histórico… — não mudam.)

-- ── 1. Dados: Administrador com tudo ligado ──
update public.app_config
   set value = value || jsonb_build_object('admin', jsonb_build_array('rh', 'cmp', 'fin', 'log', 'prod', 'def')), updated_at = now()
 where key = 'role_permissions' and not (value ? 'admin');
insert into public.app_config (key, value, updated_at)
  select 'role_permissions', jsonb_build_object('admin', jsonb_build_array('rh', 'cmp', 'fin', 'log', 'prod', 'def')), now()
  where not exists (select 1 from public.app_config where key = 'role_permissions');

update public.app_config
   set value = jsonb_set(jsonb_set(value, '{roles}', coalesce(value -> 'roles', '{}'::jsonb)), '{roles,admin}',
         coalesce(value #> '{roles,admin}', '{}'::jsonb) || jsonb_build_object('on',
           coalesce(value #> '{roles,admin,on}', '["balanco-fat","carteira","telas-finais","fornecedores","planos-trabalho","guias-teste","compras-teste"]'::jsonb))),
       updated_at = now()
 where key = 'access_overrides';

-- ── 2. Funções de acesso: a exceção deixa de ser o perfil e passa a ser a conta «admin» ──
create or replace function public.fn_cap(p_cap text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $function$
  select case
    when r.role is null then false
    when public.fn_my_username() = 'admin' then true
    else coalesce(
      (select (c.value #> array['users', public.fn_my_username(), 'chapters']) ? p_cap
         from public.app_config c
        where c.key = 'access_overrides'
          and c.value #> array['users', public.fn_my_username(), 'chapters'] is not null),
      (select (c.value -> r.role) ? p_cap from public.app_config c where c.key = 'role_permissions'),
      r.role = 'admin')   -- perfil Administrador sem linha na matriz: tudo, como antes
  end
  from (select public.fn_my_role() as role) r;
$function$;

create or replace function public.fn_sec_off(p_sec text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $f$
  select case
    when fn_my_role() is null then true
    when fn_my_username() = 'admin' then false
    else coalesce(
      (select (c.value #> array['users', fn_my_username(), 'off']) ? p_sec
         from app_config c where c.key='access_overrides'
          and c.value #> array['users', fn_my_username(), 'off'] is not null),
      (select (c.value #> array['roles', fn_my_role(), 'off']) ? p_sec
         from app_config c where c.key='access_overrides'
          and c.value #> array['roles', fn_my_role(), 'off'] is not null),
      false)
  end;
$f$;

create or replace function public.fn_pag_on(p_sec text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $f$
  select case
    when public.fn_my_role() is null then false
    when public.fn_my_username() = 'admin' then true
    when public.fn_sec_off(p_sec) then false
    else coalesce(
      (select (c.value #> array['users', public.fn_my_username(), 'on']) ? p_sec
         from public.app_config c where c.key = 'access_overrides'
          and c.value #> array['users', public.fn_my_username(), 'on'] is not null),
      (select (c.value #> array['roles', public.fn_my_role(), 'on']) ? p_sec
         from public.app_config c where c.key = 'access_overrides'
          and c.value #> array['roles', public.fn_my_role(), 'on'] is not null),
      public.fn_my_role() = 'admin')   -- perfil Administrador sem lista: tudo, como antes
  end;
$f$;

-- ── 3. Estrutura Central: só a conta «admin» passa à frente; os outros pelo Financeiro + página ──
drop policy if exists estrutura_central_so_financeiro on public.faturas;
create policy estrutura_central_so_financeiro on public.faturas
  as restrictive for all to authenticated
  using (
    coalesce(centro_custo, '') not ilike 'O099%'
    or public.fn_my_username() = 'admin'
    or (public.fn_cap('fin') and not public.fn_sec_off('estrutura-central'))
  )
  with check (
    coalesce(centro_custo, '') not ilike 'O099%'
    or public.fn_my_username() = 'admin'
    or (public.fn_cap('fin') and not public.fn_sec_off('estrutura-central'))
  );
