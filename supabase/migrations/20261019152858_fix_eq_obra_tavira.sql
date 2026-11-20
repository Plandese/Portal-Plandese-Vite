create or replace function public.fn_eq_obra_por_local(p_local text) returns text
language sql stable security definer set search_path = public as $$
  select o.id from obras o
  where p_local is not null and (
    (substring(p_local from '^\s*[O0](\d{3})\y') is not null and o.nome ~ ('^O' || substring(p_local from '^\s*[O0](\d{3})\y') || '\y'))
    or lower(o.nome) = lower(btrim(p_local))
    or (p_local ~ '^9300049\y' and o.nome ~ '^O049\y')
  )
  order by o.nome limit 1
$$;
update public.equipamentos set obra_id = fn_eq_obra_por_local(ultimo_local);