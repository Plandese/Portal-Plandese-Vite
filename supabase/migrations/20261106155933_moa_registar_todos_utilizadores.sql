create or replace function public.fn_pode_registar_moa()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.fn_is_member();
$$;