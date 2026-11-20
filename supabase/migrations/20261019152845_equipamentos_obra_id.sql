alter table public.equipamentos add column obra_id text references public.obras(id) on delete set null;

create or replace function public.fn_eq_obra_por_local(p_local text) returns text
language sql stable security definer set search_path = public as $$
  select o.id from obras o
  where p_local is not null and (
    o.nome ~ ('^O' || substring(p_local from '^\s*[O0](\d{3})\y') || '\y') and substring(p_local from '^\s*[O0](\d{3})\y') is not null
    or lower(o.nome) = lower(btrim(p_local))
    or (substring(p_local from '^9300(\d{3})\y') is not null and o.nome ~ ('^O0' || substring(p_local from '^9300(\d{2})') || '\y') and p_local ilike '%tavira%')
  )
  order by o.nome limit 1
$$;

create or replace function public.trg_eq_obra() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.ultimo_local is distinct from old.ultimo_local then
    new.obra_id := fn_eq_obra_por_local(new.ultimo_local);
  end if;
  return new;
end $$;

create trigger eq_obra_auto before insert or update of ultimo_local on public.equipamentos
for each row execute function public.trg_eq_obra();

update public.equipamentos set obra_id = fn_eq_obra_por_local(ultimo_local);