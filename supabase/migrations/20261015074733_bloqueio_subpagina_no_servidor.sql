-- Sub-páginas bloqueadas ("off" em app_config/access_overrides) passam a ser aplicadas no servidor, não só no cliente.
-- Antes: users.<u>.off só escondia o menu; a RLS (fn_cap) e o agente IA continuavam a devolver os dados.
create or replace function public.fn_sec_off(p_sec text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $f$
  select case
    when fn_my_role() is null then true
    when fn_my_role() = 'admin' then false
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
grant execute on function public.fn_sec_off(text) to authenticated;

-- Dados do Controlo de Obras: exigem capítulo prod E sub-página "producao" não bloqueada.
do $$
declare p record; q text; w text;
begin
  for p in select tablename, policyname, qual, with_check from pg_policies
           where schemaname='public' and tablename in ('co_mensal','co_obra','co_custo_det','co_existencia')
  loop
    q := case when p.qual is not null then replace(p.qual, 'fn_cap(''prod''::text)', '(fn_cap(''prod''::text) AND NOT fn_sec_off(''producao''::text))') end;
    w := case when p.with_check is not null then replace(p.with_check, 'fn_cap(''prod''::text)', '(fn_cap(''prod''::text) AND NOT fn_sec_off(''producao''::text))') end;
    if q is not null and w is not null then
      execute format('alter policy %I on public.%I using (%s) with check (%s)', p.policyname, p.tablename, q, w);
    elsif q is not null then
      execute format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename, q);
    elsif w is not null then
      execute format('alter policy %I on public.%I with check (%s)', p.policyname, p.tablename, w);
    end if;
  end loop;
end $$;
