-- fn_cap passa a respeitar app_config/access_overrides.users.<username>.chapters (exceção por pessoa).
create or replace function public.fn_cap(p_cap text)
returns boolean
language sql stable security definer
set search_path to 'public'
as $function$
  select case
    when r.role is null then false
    when r.role = 'admin' then true
    else coalesce(
      (select (c.value #> array['users', public.fn_my_username(), 'chapters']) ? p_cap
         from public.app_config c
        where c.key = 'access_overrides'
          and c.value #> array['users', public.fn_my_username(), 'chapters'] is not null),
      (select (c.value -> r.role) ? p_cap from public.app_config c where c.key = 'role_permissions'),
      false)
  end
  from (select public.fn_my_role() as role) r;
$function$;
